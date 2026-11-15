/*
 * 滩涂迁徙停歇地模拟内核（无 DOM 依赖，可在 Node 中直接 require 测试）。
 *
 * 设计要点：
 * 1. 时间以小时为最小步长（step），14 天共 336 步，所有状态按小时连续积分。
 * 2. 全部随机量（天气、游客基数、鸟群规模、偷猎时刻、初始水深/食物）
 *    在 createSimulation 时由 seed 派生的独立随机流预生成，运行期只顺序读取，
 *    渲染帧率与模拟解耦，杜绝每帧随机跳变。
 * 3. 同 seed 重建后，目标个体（鸟群）、天气序列、初始资源、关键事件顺序一致，
 *    checksum 可用于自动化复现校验。
 */
(function (root) {
  'use strict';
  var RNG = (typeof module !== 'undefined' && module.exports) ? require('./rng.js') : root.RNG;

  var C = {
    SITE_NAMES: ['北沙洲', '中泥滩', '南芦湾'],
    TOTAL_HOURS: 14 * 24,
    DEPTH_MIN: 0, DEPTH_MAX: 90, OPT_LO: 15, OPT_HI: 35, FORAGE_ZERO: 60,
    GATE_RATE: 1.1, EVAP_RATE: 0.32,
    FOOD_MAX: 100, FOOD_REGROW: 0.45, FOOD_EAT: 0.006,
    DIST_DECAY: 0.03, FLUSH_AT: 60, FLUSH_CD: 6,
    TOUR_FACTOR: [0.75, 0.45, 0.18], TOUR_DIV: 0.55,
    PATROL_DIST: [0, 3.5, 8], PATROL_COST_H: [0, 8, 20],
    TICKET_PRICE: [0.3, 0.5, 0.9], GATE_COST_H: 15,
    ENERGY_DEPART: 70, ENERGY_FAIL: 60, VISIT_HOURS: 120,
    INITIAL_BUDGET: 12000,
    STRATEGY: {
      emergency: { price: 3200, foodAdd: 18, route: 2, patrol: 2, gate: 1, boost: 24, window: 36 },
      buffer: { price: 1400, foodAdd: 8, route: 1, patrol: 1, boost: 0, window: 48 }
    }
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 觅食区比例：15–35cm 全部可用，过深（>=60cm）或近乎干涸（<=4cm）时消失 */
  function forageFraction(depth) {
    if (depth >= C.FORAGE_ZERO || depth <= 4) return 0;
    if (depth >= C.OPT_LO && depth <= C.OPT_HI) return 1;
    if (depth < C.OPT_LO) return clamp((depth - 4) / (C.OPT_LO - 4), 0, 1);
    return clamp((C.FORAGE_ZERO - depth) / (C.FORAGE_ZERO - C.OPT_HI), 0, 1);
  }

  function siteStatus(s) {
    var ff = forageFraction(s.depth);
    if (ff < 0.05 || s.food < 5 || s.disturbance >= C.FLUSH_AT + 20 ||
        (s.flock && s.flock.energy < 12)) return 'failed';
    if (ff < 0.4 || s.food < 20 || s.disturbance >= 50 ||
        (s.flock && s.flock.energy < 25)) return 'critical';
    return 'steady';
  }

  function buildWeather(seed) {
    var rng = RNG.makeRng(seed, 'weather');
    var blocks = 56; // 每块 6 小时
    var rain = new Array(C.TOTAL_HOURS).fill(0);
    var wind = new Array(C.TOTAL_HOURS).fill(0);
    var stormTick = -1, stormSite = -1;
    for (var b = 0; b < blocks; b++) {
      var isStorm = rng() < 0.08;
      var br = isStorm ? 0.4 + rng() * 0.2 : (rng() < 0.3 ? rng() * 0.22 : 0);
      var bw = isStorm ? 0.65 + rng() * 0.35 : rng() * 0.3;
      for (var h = b * 6; h < b * 6 + 6 && h < C.TOTAL_HOURS; h++) {
        rain[h] = br; wind[h] = bw;
      }
      if (isStorm && stormTick < 0) {
        stormTick = b * 6 + RNG.intIn(rng, 1, 4);
        stormSite = RNG.intIn(rng, 0, 2);
      }
    }
    return { rain: rain, wind: wind, stormTick: stormTick, stormSite: stormSite };
  }

  function createSimulation(seed) {
    seed = String(seed);
    var weather = buildWeather(seed);
    var sites = [];
    var keyEvents = [];
    var arrivals = [48, 120, 216];
    for (var i = 0; i < 3; i++) {
      var frng = RNG.makeRng(seed, 'flock' + i);
      var prng = RNG.makeRng(seed, 'poach' + i);
      var foodRng = RNG.makeRng(seed, 'food' + i);
      var depthRng = RNG.makeRng(seed, 'depth' + i);
      var visitRng = RNG.makeRng(seed, 'visitors' + i);
      var size = RNG.intIn(frng, 70, 140);
      var energy0 = 38 + Math.round(frng() * 8);
      var poachAt = arrivals[i] + 18 + RNG.intIn(prng, 0, 60);
      var baseVisitors = [];
      for (var d = 0; d < 14; d++) baseVisitors.push(RNG.intIn(visitRng, 110, 220));
      var site = {
        index: i, name: C.SITE_NAMES[i],
        depth: 22 + Math.round(depthRng() * 18),
        food: 55 + Math.round(foodRng() * 20),
        disturbance: 8 + Math.round(foodRng() * 6),
        gate: 0, route: 1, patrol: 1,
        boostTicks: 0,
        exposure: [1.0, 0.85, 1.15][i],
        baseVisitors: baseVisitors,
        visitors: 0, revenue: 0,
        flock: null,
        flockPlan: { arrival: arrivals[i], size: size, energy0: energy0, poachAt: poachAt },
        record: null, flushCount: 0, poachBlocked: false,
        score: 70, scoreEma: 70
      };
      sites.push(site);
      keyEvents.push({ tick: arrivals[i], type: 'arrival', site: i, label: C.SITE_NAMES[i] + '鸟群抵达' });
      keyEvents.push({ tick: poachAt, type: 'poach', site: i, label: C.SITE_NAMES[i] + '疑似偷猎风险' });
    }
    if (weather.stormTick >= 0) {
      keyEvents.push({ tick: weather.stormTick, type: 'storm', site: weather.stormSite,
        label: '风暴潮袭击' + C.SITE_NAMES[weather.stormSite] });
    }
    keyEvents.sort(function (a, b) { return a.tick - b.tick; });
    return {
      seed: seed, tick: 0, over: false,
      weather: weather, sites: sites, keyEvents: keyEvents,
      firedEvents: [], budget: C.INITIAL_BUDGET,
      log: [], evalQueue: [], strategyRecords: [],
      nextLogId: 1, nextEvalId: 1
    };
  }

  function snapshot(sim) {
    return {
      tick: sim.tick, budget: Math.round(sim.budget * 100) / 100,
      sites: sim.sites.map(function (s) {
        return {
          name: s.name, depth: +s.depth.toFixed(2), food: +s.food.toFixed(2),
          disturbance: +s.disturbance.toFixed(2),
          birds: s.flock ? s.flock.count : 0,
          energy: s.flock ? +s.flock.energy.toFixed(2) : null,
          score: +s.scoreEma.toFixed(2), status: siteStatus(s)
        };
      })
    };
  }

  function tickWeatherLabel(sim, t) {
    var r = sim.weather.rain[t], w = sim.weather.wind[t];
    if (r > 0.5) return '暴雨';
    if (r > 0) return '降雨';
    if (w > 0.6) return '大风';
    return '晴';
  }

  function addLog(sim, text, kind) {
    sim.log.push({ id: sim.nextLogId++, tick: sim.tick, kind: kind || 'info', text: text });
    if (sim.log.length > 300) sim.log.shift();
  }

  function updateSite(sim, s) {
    var t = sim.tick, rain = sim.weather.rain[t], wind = sim.weather.wind[t];

    // 水深：降雨抬升、蒸发下降、水闸按档位缓慢排/蓄水
    s.depth += rain * 4.2 * s.exposure - C.EVAP_RATE * (1 - rain * 0.5) +
      (s.gate === 1 ? -C.GATE_RATE : s.gate === 2 ? C.GATE_RATE : 0);
    s.depth = clamp(s.depth, C.DEPTH_MIN, C.DEPTH_MAX);

    var ff = forageFraction(s.depth);

    // 游客数量与门票收入（按天基数 * 天气系数 * 路线系数）
    var day = Math.floor(t / 24);
    var weatherFactor = 1 - rain * 0.55 - wind * 0.25;
    s.visitors = Math.round(s.baseVisitors[day] * weatherFactor * C.TOUR_FACTOR[s.route]);
    var income = s.visitors * C.TICKET_PRICE[s.route];
    s.revenue += income;
    sim.budget += income;

    // 巡查费用与水闸运行费用
    sim.budget -= C.PATROL_COST_H[s.patrol] + (s.gate !== 0 ? C.GATE_COST_H : 0);

    // 干扰：游客近距离 + 巡查扰动；持续按比例衰减（连续演化而非跳变）
    var tourDist = s.visitors * C.TOUR_FACTOR[s.route] / C.TOUR_DIV;
    var target = tourDist + C.PATROL_DIST[s.patrol] + wind * 6 + (s.flock && s.flock.justFlushed ? 10 : 0);
    s.disturbance += (target - s.disturbance) * 0.3 - C.DIST_DECAY * s.disturbance;
    s.disturbance = clamp(s.disturbance, 0, 100);

    // 食物：自然缓慢恢复，鸟群按觅食区比例取食
    s.food += C.FOOD_REGROW * (0.4 + 0.6 * ff) * (s.boostTicks > 0 ? 2.2 : 1);
    if (s.flock) {
      var eat = C.FOOD_EAT * s.flock.count * (0.15 + 0.85 * ff);
      s.food -= eat;
    }
    s.food = clamp(s.food, 0, C.FOOD_MAX);

    // 鸟群能量、惊飞、饥饿、离场
    if (s.flock) {
      var f = s.flock;
      f.justFlushed = false;
      var gain = 0.38 * ff * clamp(s.food / 30, 0, 1.2);
      var cost = 0.07 + C.PATROL_DIST[s.patrol] * 0.012 + rain * 0.08 + wind * 0.05;
      f.energy = clamp(f.energy + gain - cost, 0, 100);
      var stay = t - f.arrival;

      if (s.disturbance >= C.FLUSH_AT && t - f.lastFlush >= C.FLUSH_CD) {
        f.lastFlush = t;
        f.justFlushed = true;
        f.energy = clamp(f.energy - 2.5, 0, 100);
        f.count = Math.max(0, f.count - Math.round(f.count * 0.05));
        s.flushCount++;
        addLog(sim, s.name + '鸟群惊飞！能量 -2.5，个体 -5%', 'bad');
      }
      if (f.energy < 15 && (t % 3 === 0)) {
        f.count = Math.max(0, f.count - Math.max(1, Math.round(f.count * 0.01)));
      }
      if (f.energy >= C.ENERGY_DEPART) {
        finishFlock(sim, s, true);
      } else if (stay >= C.VISIT_HOURS) {
        finishFlock(sim, s, f.energy >= C.ENERGY_FAIL && f.count >= f.size * 0.7);
      } else if (f.count <= 0) {
        finishFlock(sim, s, false);
      }
    }

    // 栖息地评分：水深适宜性 + 食物 + 干扰（EMA 平滑，连续变化）
    var inst = 0.4 * ff * 100 + 0.35 * s.food + 0.25 * (100 - s.disturbance);
    s.score = clamp(inst, 0, 100);
    s.scoreEma += (s.score - s.scoreEma) * 0.05;
    if (s.boostTicks > 0) s.boostTicks--;
  }

  function finishFlock(sim, s, success) {
    var f = s.flock;
    s.record = {
      site: s.name, size: f.size, remaining: f.count,
      arrival: f.arrival, departure: sim.tick,
      energy: +f.energy.toFixed(1), success: success,
      flushes: s.flushCount
    };
    addLog(sim, s.name + '鸟群' + (success ? '完成补给后迁徙离开 ✓' : '未达标离开（停留记录失败）✗'),
      success ? 'good' : 'bad');
    s.flock = null;
  }

  function fireEvents(sim) {
    var t = sim.tick;
    sim.keyEvents.forEach(function (ev) {
      if (ev.tick !== t || sim.firedEvents.indexOf(ev) >= 0) return;
      sim.firedEvents.push(ev);
      if (ev.type === 'arrival') {
        var s = sim.sites[ev.site];
        var p = s.flockPlan;
        s.flock = { size: p.size, count: p.size, energy: p.energy0,
          arrival: t, lastFlush: -99, justFlushed: false };
        s.flushCount = 0;
        addLog(sim, ev.label + '：' + p.size + ' 只，初始能量 ' + p.energy0, 'event');
      } else if (ev.type === 'poach') {
        handlePoach(sim, sim.sites[ev.site], ev);
      } else if (ev.type === 'storm') {
        var st = sim.sites[ev.site];
        st.depth = clamp(st.depth + 10 * st.exposure, C.DEPTH_MIN, C.DEPTH_MAX);
        st.disturbance = clamp(st.disturbance + 8, 0, 100);
        addLog(sim, ev.label + '：水深骤升、觅食区被压缩', 'bad');
      }
    });
  }

  function handlePoach(sim, s, ev) {
    var blocked = s.patrol === 2 || (s.patrol === 1 && s.disturbance < 40);
    s.poachBlocked = blocked;
    if (blocked) {
      addLog(sim, ev.label + '：巡查及时制止 ✓', 'good');
    } else {
      if (s.flock) s.flock.count = Math.max(0, s.flock.count - Math.round(s.flock.count * 0.12));
      s.scoreEma = clamp(s.scoreEma - 12, 0, 100);
      addLog(sim, ev.label + '：巡查不足，鸟群损失 12% 个体 ✗', 'bad');
    }
  }

  function checksum(sim) {
    var h = 2166136261 >>> 0;
    var parts = [sim.tick];
    sim.sites.forEach(function (s) {
      parts.push(s.name, s.depth.toFixed(3), s.food.toFixed(3), s.disturbance.toFixed(3),
        s.scoreEma.toFixed(3), s.gate, s.route, s.patrol,
        s.flock ? s.flock.count + ':' + s.flock.energy.toFixed(3) : 'none',
        s.record ? (s.record.success ? 'ok' : 'no') : '-', s.flushCount);
    });
    parts.push(sim.budget.toFixed(1));
    var str = sim.seed + '|' + parts.join('|');
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function step(sim) {
    if (sim.over) return sim;
    var t = sim.tick;
    if (t >= C.TOTAL_HOURS) { finalize(sim); return sim; }
    for (var i = 0; i < 3; i++) updateSite(sim, sim.sites[i]);
    sim.tick++;
    fireEvents(sim);
    processEvals(sim);
    finalizeStrategies(sim);
    if (sim.tick >= C.TOTAL_HOURS) finalize(sim);
    return sim;
  }

  function finalize(sim) {
    if (sim.over) return;
    sim.sites.forEach(function (s) {
      if (s.flock) finishFlock(sim, s, s.flock.energy >= C.ENERGY_FAIL && s.flock.count >= s.flock.size * 0.7);
    });
    var successCount = sim.sites.filter(function (s) { return s.record && s.record.success; }).length;
    var minScore = Math.min.apply(null, sim.sites.map(function (s) { return s.scoreEma; }));
    sim.over = true;
    finalizeStrategies(sim);
    sim.won = successCount >= 3 && minScore >= 50;
    sim.summary = {
      successCount: successCount,
      minScore: +minScore.toFixed(1),
      avgScore: +(sim.sites.reduce(function (a, s) { return a + s.scoreEma; }, 0) / 3).toFixed(1),
      remainingBudget: Math.round(sim.budget),
      totalRevenue: Math.round(sim.sites.reduce(function (a, s) { return a + s.revenue; }, 0))
    };
  }

  var ACTION_LABEL = {
    gate: ['水闸设为保持', '水闸设为排水', '水闸设为蓄水'],
    route: ['游客路线改为近滩线', '游客路线改为观鸟栈道', '游客路线改为远端环线'],
    patrol: ['巡查改为不巡查', '巡查改为常规频率', '巡查改为高频巡查']
  };

  function applyAction(sim, siteIndex, kind, value) {
    if (sim.over) return { ok: false, reason: '模拟已结束' };
    var s = sim.sites[siteIndex];
    if (!s || value < 0 || value > 2) return { ok: false, reason: '参数非法' };
    if (s[kind] === value) return { ok: false, reason: '设置未变化' };
    var before = snapshot(sim);
    var oldValue = s[kind];
    s[kind] = value;
    var entry = {
      id: sim.nextEvalId++, siteIndex: siteIndex, kind: kind, value: value,
      label: ACTION_LABEL[kind][value] + '（' + s.name + '）',
      startTick: sim.tick, dueTick: sim.tick + 24, done: false,
      before: before, after: null, outcome: null, note: ''
    };
    sim.evalQueue.push(entry);
    addLog(sim, '操作：' + entry.label, 'action');
    return { ok: true, entry: entry };
  }

  function processEvals(sim) {
    sim.evalQueue.forEach(function (e) {
      if (e.done || sim.tick < e.dueTick) return;
      e.done = true;
      e.after = snapshot(sim);
      var b = e.before.sites[e.siteIndex], a = e.after.sites[e.siteIndex];
      var status = siteStatus(sim.sites[e.siteIndex]);
      e.outcome = status;
      if (status === 'failed') {
        e.note = '失败操作：24 小时内觅食区/食物/干扰/鸟群能量突破失败阈值';
      } else if (status === 'critical') {
        e.note = '临界操作：栖息地承压（评分 ' + b.score.toFixed(1) + ' → ' + a.score.toFixed(1) + '）';
      } else {
        e.note = '稳态操作：栖息地保持健康（评分 ' + b.score.toFixed(1) + ' → ' + a.score.toFixed(1) + '）';
      }
      addLog(sim, e.label + ' → ' +
        (status === 'failed' ? '失败 ✗' : status === 'critical' ? '临界 ⚠' : '稳态 ✓'),
        status === 'failed' ? 'bad' : status === 'critical' ? 'warn' : 'good');
    });
  }

  function applyStrategy(sim, siteIndex, type) {
    if (sim.over) return { ok: false, reason: '模拟已结束' };
    var cfg = C.STRATEGY[type];
    if (!cfg) return { ok: false, reason: '未知策略' };
    var s = sim.sites[siteIndex];
    if (!s) return { ok: false, reason: '参数非法' };
    if (sim.budget < cfg.price) return { ok: false, reason: '预算不足（需 ' + cfg.price + ' 元）' };
    var before = snapshot(sim);
    sim.budget -= cfg.price;
    s.food = clamp(s.food + cfg.foodAdd, 0, C.FOOD_MAX);
    s.route = cfg.route;
    s.patrol = cfg.patrol;
    if (typeof cfg.gate === 'number') s.gate = cfg.gate;
    s.boostTicks = cfg.boost;
    var triggerDepth = +s.depth.toFixed(1), triggerFood = +s.food.toFixed(1),
      triggerDist = +s.disturbance.toFixed(1), triggerScore = +s.scoreEma.toFixed(1);
    var rec = {
      id: sim.strategyRecords.length + 1, siteIndex: siteIndex, site: s.name,
      type: type, typeName: type === 'emergency' ? '紧急封育（强干预）' : '弹性缓冲（弱干预）',
      tick: sim.tick, price: cfg.price, window: cfg.window,
      trigger: { depth: triggerDepth, food: triggerFood, disturbance: triggerDist, score: triggerScore },
      before: before, after: null, outcome: null,
      lostRevenue: 0
    };
    sim.strategyRecords.push(rec);
    addLog(sim, s.name + ' 执行「' + rec.typeName + '」，支出 ' + cfg.price + ' 元', 'strategy');
    return { ok: true, record: rec };
  }

  function finalizeStrategies(sim) {
    sim.strategyRecords.forEach(function (r) {
      if (r.after) return;
      var endTick = Math.min(C.TOTAL_HOURS, r.tick + r.window);
      if (sim.tick < endTick && !sim.over) return;
      r.after = snapshot(sim);
      var s = sim.sites[r.siteIndex];
      r.outcome = siteStatus(s);
      var b = r.before.sites[r.siteIndex], a = r.after.sites[r.siteIndex];
      var normalRevenue = C.TICKET_PRICE[1] * 165 * (r.window / 24) * C.TOUR_FACTOR[1];
      var actualRevenue = C.TICKET_PRICE[s.route] * 165 * (r.window / 24) * C.TOUR_FACTOR[s.route];
      r.lostRevenue = Math.max(0, Math.round(normalRevenue - actualRevenue));
      r.costTotal = r.price + r.lostRevenue;
      r.note = '评分 ' + b.score.toFixed(1) + ' → ' + a.score.toFixed(1) +
        '，直接支出 ' + r.price + ' 元，门票损失约 ' + r.lostRevenue + ' 元，合计代价 ' + r.costTotal + ' 元';
    });
  }

  var SIM = { C: C, clamp: clamp, forageFraction: forageFraction, siteStatus: siteStatus,
    createSimulation: createSimulation, snapshot: snapshot, tickWeatherLabel: tickWeatherLabel,
    addLog: addLog, updateSite: updateSite, fireEvents: fireEvents, finishFlock: finishFlock,
    step: step, finalize: finalize, applyAction: applyAction, processEvals: processEvals,
    applyStrategy: applyStrategy, finalizeStrategies: finalizeStrategies, checksum: checksum,
    ACTION_LABEL: ACTION_LABEL };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SIM;
  } else {
    root.SIM = SIM;
  }
})(typeof window !== 'undefined' ? window : globalThis);
