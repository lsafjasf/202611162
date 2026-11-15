/* 森林虫害模拟核心引擎：纯函数式状态推进，所有随机量来自确定性 RNG。
   时间以固定子步长积分（连续变化），不使用逐帧随机。 */
(function (global) {
  'use strict';
  var RNG = (typeof require !== 'undefined' ? require('./rng.js') : global.RNG);

  var CFG = {
    COLS: 10,
    ROWS: 7,
    DAYS: 21,
    STEP_H: 0.25,                // 每个子步 = 6 小时
    HOTSPOT_PEST: 35,            // 热区判定阈值
    INFECTED_PEST: 5,            // 感染判定阈值
    PEST_R: 0.22,                // 害虫内禀增长率 / 天
    PEST_K: 100,                 // 害虫承载容量
    BENEFIT_R: 0.05,             // 益虫恢复率 / 天
    DISPERSE_BASE: 0.014,        // 基础扩散比例 / 天
    OUTBREAK_PEST: 45,           // 暴发触发密度
    OUTBREAK_JUMP: 20,           // 暴发时密度跳升
    OUTBREAK_SURVEY_GAP: 2.0,    // 超过该天数未监测才可能暴发
    TRAP_KILL: 7.5,              // 单个诱捕器日捕杀量
    TRAP_LIFE: 7,                // 诱捕器有效天数
    SPRAY_KILL: 0.82,            // 喷药害虫杀灭比例
    SPRAY_BENEFIT_HIT: 0.55,     // 喷药对益虫的误伤比例
    SPRAY_RESIDUE: 0.10,         // 残留衰减率 / 天
    RECOVER_INFECT: 0.25,        // 恢复策略触发：感染面积占比
    FAIL_INFECT: 0.55,           // 失败线：感染面积占比
    FAIL_BENEFIT: 35,            // 失败线：平均益虫密度
    WIN_INFECT: 0.25,            // 成功线：感染面积占比
    WIN_BENEFIT: 55              // 成功线：平均益虫密度
  };

  var DIRS = [
    { name: 'E', dx: 1, dy: 0 }, { name: 'SE', dx: 1, dy: 1 },
    { name: 'S', dx: 0, dy: 1 }, { name: 'SW', dx: -1, dy: 1 },
    { name: 'W', dx: -1, dy: 0 }, { name: 'NW', dx: -1, dy: -1 },
    { name: 'N', dx: 0, dy: -1 }, { name: 'NE', dx: 1, dy: -1 }
  ];

  function idx(x, y) { return y * CFG.COLS + x; }
  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < CFG.COLS && y < CFG.ROWS;
  }

  function makeCell(x, y) {
    return {
      x: x, y: y,
      pest: 0,            // 害虫密度 0-100
      benefit: 100,       // 益虫密度 0-100
      health: 100,        // 植被健康 0-100
      residue: 0,         // 农药残留 0-1
      traps: 0,           // 当前诱捕器数量
      trapAge: [],        // 各诱捕器已工作天数
      observed: 0,        // 最近一次监测到的害虫密度
      lastSurvey: -99,    // 最近监测时间（天）
      outbreakBoost: 0    // 暴发后扩散增强剩余天数
    };
  }

  /* 预生成 22 天的风向风速：固定序列，重开后逐日一致。 */
  function makeWeather(rng) {
    var seq = [];
    for (var d = 0; d <= CFG.DAYS; d++) {
      var dir = rng.pick(DIRS).name;
      var speed = rng.float(0.4, 1.0);
      seq.push({ day: d, dir: dir, speed: speed });
    }
    return seq;
  }

  function createSim(seed) {
    var rng = new RNG.Rng(seed);
    var cells = [];
    for (var y = 0; y < CFG.ROWS; y++) {
      for (var x = 0; x < CFG.COLS; x++) cells.push(makeCell(x, y));
    }

    /* 初始斑块状虫害：3 个随机中心，每个向 1-2 个相邻林班扩散。 */
    var centers = [];
    var guard = 0;
    while (centers.length < 3 && guard++ < 200) {
      var cx = rng.int(1, CFG.COLS - 2);
      var cy = rng.int(1, CFG.ROWS - 2);
      if (centers.some(function (c) {
        return Math.abs(c.x - cx) + Math.abs(c.y - cy) < 3;
      })) continue;
      centers.push({ x: cx, y: cy });
    }
    var hotspots = [];
    centers.forEach(function (c) {
      var c0 = cells[idx(c.x, c.y)];
      c0.pest = rng.float(42, 55);
      hotspots.push({ x: c.x, y: c.y });
      var spreadN = rng.int(1, 2);
      var opts = DIRS.filter(function (g) {
        return inBounds(c.x + g.dx, c.y + g.dy);
      });
      for (var i = 0; i < spreadN; i++) {
        var g = opts[rng.int(0, opts.length - 1)];
        var nb = cells[idx(c.x + g.dx, c.y + g.dy)];
        nb.pest = Math.max(nb.pest, rng.float(14, 26));
        hotspots.push({ x: nb.x, y: nb.y });
      }
    });

    var weather = makeWeather(rng);
    return {
      seed: seed,
      rng: rng,
      cells: cells,
      weather: weather,
      day: 0,
      subStep: 0,
      time: 0,
      finished: false,
      result: null,
      log: [],
      events: [],
      drones: [],
      resources: { sorties: 4, traps: 12, spray: 12, budget: 220 },
      totals: { surveys: 0, trapsLaid: 0, sprayUsed: 0 },
      initialSnapshot: null,
      hotspots: hotspots
    };
  }

  function dirByName(name) {
    for (var i = 0; i < DIRS.length; i++) if (DIRS[i].name === name) return DIRS[i];
    return DIRS[0];
  }

  function windAt(sim, day) {
    return sim.weather[Math.min(Math.floor(day), sim.weather.length - 1)];
  }

  /* 单步：6 小时固定积分，保证状态随时间连续变化。 */
  function step(sim) {
    if (sim.finished) return sim;
    var dt = CFG.STEP_H / 24;
    var prevDay = Math.floor(sim.time);
    sim.time = Math.round((sim.time + CFG.STEP_H / 24) * 1e6) / 1e6;
    sim.day = Math.floor(sim.time);
    sim.subStep++;
    var wind = windAt(sim, sim.day);
    var wdir = dirByName(wind.dir);

    growAndDisperse(sim, dt, wind, wdir);
    processTraps(sim, dt);
    decayAndBenefit(sim, dt);
    updateHealth(sim, dt);

    /* 整数天边界：检查监测遗漏导致的暴发，并刷新无人机架次。 */
    if (sim.day > prevDay) {
      checkOutbreaks(sim);
      sim.resources.sorties = Math.min(4, sim.resources.sorties + 1);
      checkEnd(sim);
    }
    return sim;
  }

  function growAndDisperse(sim, dt, wind, wdir) {
    var n = sim.cells.length;
    var inflow = new Array(n).fill(0);
    for (var i = 0; i < n; i++) {
      var c = sim.cells[i];
      if (c.pest <= 0) continue;
      var boost = 1 + c.outbreakBoost * 0.8;
      var logistic = CFG.PEST_R * c.pest * (1 - c.pest / CFG.PEST_K);
      c.pest = Math.max(0, c.pest + logistic * dt);
      var outFrac = CFG.DISPERSE_BASE * boost * wind.speed * dt;
      var total = c.pest * outFrac;
      var windShare = 0.72;
      var wx = c.x + wdir.dx, wy = c.y + wdir.dy;
      if (inBounds(wx, wy)) inflow[idx(wx, wy)] += total * windShare;
      var rest = total * (1 - windShare);
      var neigh = [];
      for (var k = 0; k < DIRS.length; k++) {
        var g = DIRS[k];
        if (inBounds(c.x + g.dx, c.y + g.dy)) neigh.push(g);
      }
      var each = rest / neigh.length;
      neigh.forEach(function (g) {
        inflow[idx(c.x + g.dx, c.y + g.dy)] += each;
      });
      c.pest = Math.max(0, c.pest - total);
    }
    for (var j = 0; j < n; j++) {
      sim.cells[j].pest = Math.min(CFG.PEST_K, sim.cells[j].pest + inflow[j]);
      if (sim.cells[j].outbreakBoost > 0) {
        sim.cells[j].outbreakBoost = Math.max(0, sim.cells[j].outbreakBoost - dt);
      }
    }
  }

  function processTraps(sim, dt) {
    sim.cells.forEach(function (c) {
      if (c.traps <= 0) return;
      var kill = Math.min(c.pest, CFG.TRAP_KILL * c.traps * dt);
      c.pest -= kill;
      for (var i = c.trapAge.length - 1; i >= 0; i--) {
        c.trapAge[i] += dt;
        if (c.trapAge[i] >= CFG.TRAP_LIFE) {
          c.trapAge.splice(i, 1);
          c.traps--;
        }
      }
    });
  }

  function decayAndBenefit(sim, dt) {
    sim.cells.forEach(function (c) {
      c.residue *= Math.pow(1 - CFG.SPRAY_RESIDUE, dt);
      if (c.residue < 0.005) c.residue = 0;
      var suppression = c.residue * 0.9 + (c.pest > 30 ? 0.25 : 0);
      var regen = CFG.BENEFIT_R * c.benefit * (1 - c.benefit / 100) * dt;
      c.benefit = Math.max(0, Math.min(100,
        c.benefit + regen * (1 - suppression) - c.residue * 1.2 * dt));
    });
  }

  function updateHealth(sim, dt) {
    sim.cells.forEach(function (c) {
      var damage = c.pest >= CFG.INFECTED_PEST ? (c.pest / 100) * 2.2 * dt : 0;
      var recovery = c.pest < CFG.INFECTED_PEST ? 1.4 * dt : 0;
      c.health = Math.max(0, Math.min(100, c.health - damage + recovery));
    });
  }

  /* 监测遗漏：高密度且长期未监测的林班在下一轮暴发。 */
  function checkOutbreaks(sim) {
    sim.cells.forEach(function (c) {
      var gap = sim.time - c.lastSurvey;
      if (c.pest >= CFG.OUTBREAK_PEST && gap > CFG.OUTBREAK_SURVEY_GAP) {
        c.pest = Math.min(CFG.PEST_K, c.pest + CFG.OUTBREAK_JUMP);
        c.outbreakBoost = 2;
        sim.events.push({ day: sim.day, type: 'outbreak',
          x: c.x, y: c.y, pest: Math.round(c.pest) });
      }
    });
  }

  function checkEnd(sim) {
    if (sim.day < CFG.DAYS) return;
    var m = metrics(sim);
    sim.finished = true;
    if (m.infectedRatio >= CFG.FAIL_INFECT || m.avgBenefit <= CFG.FAIL_BENEFIT) {
      sim.result = 'fail';
    } else if (m.infectedRatio <= CFG.WIN_INFECT && m.avgBenefit >= CFG.WIN_BENEFIT) {
      sim.result = 'success';
    } else {
      sim.result = 'marginal';
    }
  }

  function clampCost(sim, cost, label) {
    if (sim.resources.budget < cost) {
      sim.log.unshift({ day: sim.time, msg: label + '失败：预算不足', ok: false });
      return false;
    }
    sim.resources.budget -= cost;
    return true;
  }

  /* 无人机监测：刷新林班观测值，消除暴发风险；留下飞行轨迹供渲染。 */
  function survey(sim, x, y) {
    if (sim.finished) return { ok: false, msg: '模拟已结束' };
    if (!inBounds(x, y)) return { ok: false, msg: '目标超出林区' };
    if (sim.resources.sorties < 1) return { ok: false, msg: '无人机架次不足' };
    if (!clampCost(sim, 6, '监测')) return { ok: false, msg: '预算不足' };
    sim.resources.sorties--;
    sim.totals.surveys++;
    var c = sim.cells[idx(x, y)];
    c.lastSurvey = sim.time;
    c.observed = c.pest;
    sim.drones.push({
      x0: -0.5, y0: CFG.ROWS / 2, x1: x, y1: y,
      start: sim.time, duration: 0.6, kind: 'survey'
    });
    sim.log.unshift({ day: sim.time,
      msg: '无人机监测 林班(' + x + ',' + y + ')，害虫密度 ' + c.pest.toFixed(1),
      ok: true, kind: 'survey', x: x, y: y });
    return { ok: true };
  }

  function placeTrap(sim, x, y) {
    if (sim.finished) return { ok: false, msg: '模拟已结束' };
    if (!inBounds(x, y)) return { ok: false, msg: '目标超出林区' };
    if (sim.resources.traps < 1) return { ok: false, msg: '诱捕器库存不足' };
    if (!clampCost(sim, 8, '布设诱捕器')) return { ok: false, msg: '预算不足' };
    sim.resources.traps--;
    var c = sim.cells[idx(x, y)];
    c.traps++;
    c.trapAge.push(0);
    sim.totals.trapsLaid++;
    sim.drones.push({
      x0: -0.5, y0: CFG.ROWS / 2, x1: x, y1: y,
      start: sim.time, duration: 0.6, kind: 'trap'
    });
    sim.log.unshift({ day: sim.time,
      msg: '在(' + x + ',' + y + ')布设诱捕器（有效 ' + CFG.TRAP_LIFE + ' 天）',
      ok: true, kind: 'trap', x: x, y: y });
    return { ok: true };
  }

  function neighborhood(sim, cx, cy, radius) {
    var out = [];
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var x = cx + dx, y = cy + dy;
        if (inBounds(x, y)) out.push(sim.cells[idx(x, y)]);
      }
    }
    return out;
  }

  /* 喷药：target=局部 3x3；broad=广域 5x5，误伤益虫更多。 */
  function spray(sim, x, y, mode) {
    if (sim.finished) return { ok: false, msg: '模拟已结束' };
    if (!inBounds(x, y)) return { ok: false, msg: '目标超出林区' };
    if (sim.resources.spray < 1) return { ok: false, msg: '喷药剂量不足' };
    var broad = mode === 'broad';
    var cost = broad ? 18 : 12;
    if (!clampCost(sim, cost, '喷药')) return { ok: false, msg: '预算不足' };
    sim.resources.spray--;
    sim.totals.sprayUsed++;
    var radius = broad ? 2 : 1;
    var area = neighborhood(sim, x, y, radius);
    var benefitHit = broad ? CFG.SPRAY_BENEFIT_HIT : CFG.SPRAY_BENEFIT_HIT * 0.7;
    area.forEach(function (c) {
      c.pest *= 1 - CFG.SPRAY_KILL;
      c.benefit *= 1 - benefitHit;
      c.residue = Math.min(1, c.residue + (broad ? 0.85 : 0.6));
    });
    sim.drones.push({
      x0: -0.5, y0: CFG.ROWS / 2, x1: x, y1: y,
      start: sim.time, duration: 0.6, kind: broad ? 'spray-broad' : 'spray'
    });
    sim.log.unshift({ day: sim.time,
      msg: (broad ? '广域' : '局部') + '喷药覆盖 ' + area.length +
        ' 个林班，益虫误伤 ' + Math.round(benefitHit * 100) + '%',
      ok: true, kind: 'spray', x: x, y: y, broad: broad });
    return { ok: true };
  }

  function pruneDrones(sim) {
    sim.drones = sim.drones.filter(function (d) {
      return sim.time - d.start < d.duration + 0.15;
    });
  }

  function metrics(sim) {
    var n = sim.cells.length;
    var pestSum = 0, benefitSum = 0, healthSum = 0;
    var infected = 0, hot = 0, trapCells = 0;
    sim.cells.forEach(function (c) {
      pestSum += c.pest;
      benefitSum += c.benefit;
      healthSum += c.health;
      if (c.pest >= CFG.INFECTED_PEST) infected++;
      if (c.pest >= CFG.HOTSPOT_PEST) hot++;
      if (c.traps > 0) trapCells++;
    });
    return {
      avgPest: pestSum / n,
      avgBenefit: benefitSum / n,
      avgHealth: healthSum / n,
      infected: infected,
      infectedRatio: infected / n,
      hotspots: hot,
      trapCells: trapCells
    };
  }

  function snapshot(sim, label) {
    var m = metrics(sim);
    return {
      label: label || '',
      day: sim.time,
      budget: sim.resources.budget,
      sorties: sim.resources.sorties,
      traps: sim.resources.traps,
      spray: sim.resources.spray,
      infectedRatio: m.infectedRatio,
      avgPest: m.avgPest,
      avgBenefit: m.avgBenefit,
      avgHealth: m.avgHealth,
      hotspots: m.hotspots
    };
  }

  var MUTABLE_KEYS = ['cells', 'day', 'subStep', 'time', 'finished', 'result',
    'log', 'events', 'drones', 'resources', 'totals', 'hotspots'];

  function snapshotState(sim) {
    var data = { rngA: sim.rng.getState() };
    MUTABLE_KEYS.forEach(function (k) { data[k] = sim[k]; });
    return JSON.parse(JSON.stringify(data));
  }

  function restoreState(sim, data) {
    sim.rng.setState(data.rngA);
    MUTABLE_KEYS.forEach(function (k) { sim[k] = data[k]; });
    return sim;
  }

  function cloneSim(sim) {
    var copy = createSim(sim.seed);
    restoreState(copy, snapshotState(sim));
    return copy;
  }

  global.PEST_SIM = { CFG: CFG, DIRS: DIRS, idx: idx, inBounds: inBounds,
    makeCell: makeCell, createSim: createSim, step: step, windAt: windAt,
    checkEnd: checkEnd, survey: survey, placeTrap: placeTrap, spray: spray,
    neighborhood: neighborhood, metrics: metrics, snapshot: snapshot,
    pruneDrones: pruneDrones, snapshotState: snapshotState,
    restoreState: restoreState, cloneSim: cloneSim };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.PEST_SIM;
  }
})(typeof window !== 'undefined' ? window : globalThis);
