// 确定性模拟内核：固定 1 小时步长，所有随机量在初始化时由 seed 预先生成。
(function (root) {
  "use strict";
  var RNG = (typeof require !== "undefined") ? require("./rng.js") : root.RNG;
  var CFG = (typeof require !== "undefined") ? require("./config.js") : root.CONFIG;
  var CULTIVARS = ["海稻 86", "耐盐小麦沧 6001", "甜高粱大力士", "碱蓬绿肥"];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // 由体积含水率与盐分(kg/m²)推 EC（dS/m），1 g/L ≈ 1.55 dS/m
  function layerEC(layer) {
    if (layer.water <= 0.01) return 0;
    var gPerL = (layer.salt * 1000) / layer.water;
    return gPerL * 1.55;
  }

  function generateForecast(seed) {
    var rainRng = RNG.stream(seed, "rain");
    var tideRng = RNG.stream(seed, "tide");
    var petRng = RNG.stream(seed, "pet");
    var out = [];
    for (var d = 0; d < CFG.TOTAL_DAYS; d++) {
      var rains = rainRng() < CFG.RAIN_PROB;
      var rainMm = rains ? -Math.log(1 - rainRng()) * CFG.RAIN_MEAN_MM : 0;
      var tideOn = tideRng() < CFG.TIDE_PROB;
      var tide = tideOn ? { on: true, level: CFG.TIDE_LEVEL_MEAN + tideRng() * 1.3 } : { on: false, level: 0 };
      out.push({ rainMm: rainMm, tide: tide, petMm: CFG.PET_MEAN_MM_D * (0.75 + petRng() * 0.5) });
    }
    return out;
  }

  function createSimulation(seed) {
    var soilRng = RNG.stream(seed, "soil");
    var idRng = RNG.stream(seed, "plot");
    var plotId = "P-" + ("0000" + (idRng() * 9000 + 1000 | 0)).slice(-4);
    var cultivar = CULTIVARS[(idRng() * CULTIVARS.length) | 0];
    var forecast = generateForecast(seed);

    var initEC = [3.8, 3.2, 2.2, 1.5];
    var layers = CFG.LAYERS.map(function (L, i) {
      var ec = initEC[i] * (0.88 + soilRng() * 0.24);
      var water = L.fc * L.depth * 0.92;
      var gPerL = ec / 1.55;
      return { water: water, salt: gPerL * water / 1000 };
    });

    var state = {
      seed: String(seed),
      plotId: plotId,
      cultivar: cultivar,
      hour: 0,
      day: 0,
      water: CFG.INIT.water,
      energy: CFG.INIT.energy,
      mulchLeft: CFG.INIT.mulch,
      mulchOn: false,
      layers: layers,
      gwDepth: CFG.INIT.gwDepth * (0.92 + soilRng() * 0.16),
      gwSalt: 5.5 + soilRng() * 1.5,
      forecast: forecast,
      crop: {
        health: CFG.CROP.health0,
        biomass: CFG.CROP.biomass0,
        dead: false,
        lastStress: 0,
        saltStress: 0,
        waterStress: 0
      },
      irrigOn: false,
      drainOn: false,
      status: "running",
      log: [],
      actions: [],
      lastAction: null,
      totals: {
        waterUsed: 0, energyUsed: 0, mulchUsed: 0,
        irrigationMm: 0, drainageMm: 0, rainMm: 0,
        evapMm: 0, tideIntrusionMm: 0, saltLeached: 0
      }
    };
    pushLog(state, "evt", "第 0 天开始：地块 " + plotId + "，作物 " + cultivar + "，根区初始盐渍化严重。");
    return state;
  }

  function pushLog(s, cls, msg) {
    s.log.push({ hour: s.hour, cls: cls, msg: msg });
    if (s.log.length > 400) s.log.shift();
  }

  function timeLabel(h) {
    var d = Math.floor(h / 24), hh = h % 24;
    return ("第" + (d + 1) + "天 " + ("0" + hh).slice(-2) + ":00");
  }

  function recordAction(s, type, ok, msg, value) {
    var rec = { hour: s.hour, type: type, ok: ok, msg: msg, value: !!value };
    s.actions.push(rec);
    s.lastAction = rec;
    pushLog(s, ok ? "good" : "bad", "[" + type + "] " + msg);
  }

  function toggleIrrigation(s) {
    if (s.status !== "running") return failClosed(s, "灌溉");
    if (!s.irrigOn && s.water <= 0) {
      recordAction(s, "灌溉", false, "淡水储量为 0，无法启动灌溉。");
      return;
    }
    s.irrigOn = !s.irrigOn;
    recordAction(s, "灌溉", true, s.irrigOn ? "灌溉泵开启，每小时用水 " + CFG.IRR_RATE_MM_H + "mm。" : "灌溉泵关闭。", s.irrigOn);
  }

  function toggleDrainage(s) {
    if (s.status !== "running") return failClosed(s, "排水");
    if (!s.drainOn && s.energy < CFG.DRAIN_ENERGY_H) {
      recordAction(s, "排水", false, "电能不足 " + CFG.DRAIN_ENERGY_H + "kWh，排水泵无法启动。");
      return;
    }
    s.drainOn = !s.drainOn;
    recordAction(s, "排水", true, s.drainOn ? "排水泵开启，每小时耗电 " + CFG.DRAIN_ENERGY_H + "kWh。" : "排水泵关闭。", s.drainOn);
  }

  function applyMulch(s) {
    if (s.status !== "running") return failClosed(s, "覆盖物");
    if (s.mulchOn) { recordAction(s, "覆盖物", false, "地表已铺设覆盖物，不能重复铺设。"); return; }
    if (s.mulchLeft <= 0) { recordAction(s, "覆盖物", false, "覆盖物库存为 0，铺设失败。"); return; }
    s.mulchLeft -= 1;
    s.mulchOn = true;
    s.totals.mulchUsed += 1;
    recordAction(s, "覆盖物", true, "铺设完成：土面蒸发将下降 " + Math.round(CFG.MULCH_EVAP_CUT * 100) + "%，抑制返盐。");
  }

  function failClosed(s, name) {
    recordAction(s, name, false, "模拟已结束，操作被拒绝。");
  }

  // 水（mm）携带 salt(kg/m²) 从 a 层移动到 b 层
  function moveWater(s, iA, iB, mm) {
    var a = s.layers[iA], b = s.layers[iB];
    mm = Math.min(mm, a.water);
    if (mm <= 0) return 0;
    var frac = mm / a.water;
    var saltMoved = a.salt * frac;
    a.water -= mm; b.water += mm;
    a.salt -= saltMoved; b.salt += saltMoved;
    return mm;
  }

  function stepHour(s) {
    if (s.status !== "running") return;
    var day = Math.floor(s.hour / 24), tod = s.hour % 24;
    var wx = s.forecast[day];
    var L = CFG.LAYERS;

    // 1) 降雨（均匀落在表层）
    var rainH = wx.rainMm / 24;
    s.layers[0].water += rainH;
    s.totals.rainMm += rainH;

    // 2) 灌溉泵：水量按 mm 入表层，资源按 m³/kWh 扣减
    if (s.irrigOn) {
      var needM3 = CFG.IRR_RATE_MM_H / CFG.MM_PER_M3;
      if (s.water < needM3 || s.energy < CFG.IRR_ENERGY_H) {
        s.irrigOn = false;
        recordAction(s, "灌溉", false, "资源耗尽，灌溉泵自动停机。");
      } else {
        s.water -= needM3; s.energy -= CFG.IRR_ENERGY_H;
        s.layers[0].water += CFG.IRR_RATE_MM_H;
        s.totals.waterUsed += needM3; s.totals.energyUsed += CFG.IRR_ENERGY_H;
        s.totals.irrigationMm += CFG.IRR_RATE_MM_H;
      }
    }

    // 3) 排水泵：先排底土持水，再降水位
    if (s.drainOn) {
      if (s.energy < CFG.DRAIN_ENERGY_H) {
        s.drainOn = false;
        recordAction(s, "排水", false, "电能耗尽，排水泵自动停机。");
      } else {
        s.energy -= CFG.DRAIN_ENERGY_H;
        s.totals.energyUsed += CFG.DRAIN_ENERGY_H;
        var bottom = s.layers[L.length - 1];
        var pumped = Math.min(CFG.DRAIN_RATE_MM_H * 0.4, Math.max(0, bottom.water - L[L.length - 1].wp * L[L.length - 1].depth));
        var removedSalt = bottom.salt * (pumped / Math.max(bottom.water, 1e-9));
        bottom.water -= pumped; bottom.salt -= removedSalt;
        s.totals.drainageMm += pumped; s.totals.saltLeached += removedSalt;
        s.gwDepth = clamp(s.gwDepth + (CFG.DRAIN_RATE_MM_H - pumped), CFG.GW_MIN_DEPTH, CFG.GW_MAX_DEPTH);
      }
    }

    // 4) 层间重力下渗：超过田间持水量的水下移
    for (var i = 0; i < L.length - 1; i++) {
      var excess = s.layers[i].water - L[i].fc * L[i].depth;
      if (excess > 0) moveWater(s, i, i + 1, excess * CFG.PERCOL_K);
    }

    // 5) 底层出流进入地下水
    var last = s.layers[L.length - 1], lastEx = last.water - L[L.length - 1].fc * L[L.length - 1].depth;
    if (lastEx > 0) {
      var out = Math.min(lastEx * CFG.PERCOL_K, last.water);
      var outSalt = last.salt * (out / Math.max(last.water, 1e-9));
      last.water -= out; last.salt -= outSalt;
      var gwCap = CFG.GW_MAX_DEPTH - s.gwDepth;
      var intoGW = Math.min(out, Math.max(0, gwCap));
      s.gwDepth -= intoGW;
      if (intoGW > 0) s.gwSalt = (s.gwSalt * 30 + (outSalt * 1000 / out) * intoGW) / (30 + intoGW);
      s.totals.saltLeached += outSalt;
    }

    // 6) 毛细上升：地下水位浅时，底土从地下水吸水带盐
    if (s.gwDepth < CFG.PROFILE_DEPTH) {
      var rise = (CFG.PROFILE_DEPTH - s.gwDepth) / CFG.PROFILE_DEPTH *
        CFG.CAPILLARY_K * (L[L.length - 1].fc * L[L.length - 1].depth);
      var room = L[L.length - 1].porosity * L[L.length - 1].depth - last.water;
      rise = Math.min(rise, Math.max(0, room));
      if (rise > 0) {
        last.water += rise;
        last.salt += rise * s.gwSalt / 1000;
        s.gwDepth += rise;
      }
    }
    s.gwDepth = clamp(s.gwDepth + CFG.GW_DRAIN_H, CFG.GW_MIN_DEPTH, CFG.GW_MAX_DEPTH);

    // 7) 潮汐：涨潮时刻（每日 2 时）施加一次潮涌，其余小时水位缓慢回落
    if (wx.tide.on && tod === 2) {
      var surge = wx.tide.level * 120;
      var before = s.gwDepth;
      s.gwDepth = clamp(s.gwDepth - surge, CFG.GW_MIN_DEPTH, CFG.GW_MAX_DEPTH);
      var intrusion = before - s.gwDepth;
      s.totals.tideIntrusionMm += intrusion;
      s.gwSalt = clamp(s.gwSalt + wx.tide.level * 1.1, 0, CFG.SEAWATER_SALT);
      pushLog(s, "evt", "潮汐顶托：潮位 " + wx.tide.level.toFixed(1) + "m，地下水位抬升 " + intrusion.toFixed(0) + "mm，咸度上升。");
    }

    // 8) 蒸发与蒸腾（白天 6-18 时，PET 按正弦分配）
    var dayFactor = (tod >= 6 && tod <= 18) ? Math.sin(((tod - 6) / 12) * Math.PI) : 0;
    var petH = wx.petMm / 24 * 2 * dayFactor;
    var evapCut = s.mulchOn ? (1 - CFG.MULCH_EVAP_CUT) : 1;
    var top = s.layers[0];
    var evap = Math.min(CFG.EVAP_BASE_MM_H * petH * 2.2 * evapCut, Math.max(0, top.water - L[0].wp * L[0].depth));
    var evapSaltFrac = evap / Math.max(top.water, 1e-9);
    top.water -= evap; // 纯水蒸发，盐全部留存 → 表土积盐
    s.totals.evapMm += evap;

    var rootWater = 0;
    for (var r = 0; r < CFG.ROOT_LAYERS; r++) rootWater += s.layers[r].water;
    var rootCap = 0, rootWP = 0;
    for (var r2 = 0; r2 < CFG.ROOT_LAYERS; r2++) {
      rootCap += L[r2].fc * L[r2].depth; rootWP += L[r2].wp * L[r2].depth;
    }
    var avail = clamp((rootWater - rootWP) / (rootCap - rootWP), 0, 1);
    var tran = Math.min(CFG.TRAN_BASE_MM_H * petH * 2.2 * avail, Math.max(0, s.layers[1].water - L[1].wp * L[1].depth));
    s.layers[1].water -= tran;

    s.hour += 1;
    stepDayBoundary(s);
  }

  function stepDayBoundary(s) {
    var newDay = Math.floor(s.hour / 24);
    if (newDay === s.day || s.hour >= CFG.TOTAL_HOURS) {
      if (s.hour >= CFG.TOTAL_HOURS) finish(s);
      return;
    }
    s.day = newDay;
    var c = s.crop, L = CFG.LAYERS;
    var ec = rootEC(s);
    var rw = 0, cap = 0, wp = 0;
    for (var i = 0; i < CFG.ROOT_LAYERS; i++) {
      rw += s.layers[i].water; cap += L[i].fc * L[i].depth; wp += L[i].wp * L[i].depth;
    }
    var theta = rw / (L[0].depth + L[1].depth);
    var saltStress = clamp((ec - CFG.CROP.ecStress) / (CFG.CROP.ecSevere - CFG.CROP.ecStress), 0, 1);
    var waterStress = clamp((CFG.CROP.waterStress - theta) / CFG.CROP.waterStress, 0, 1);
    var floodStress = clamp((CFG.CROP.gwStress - s.gwDepth) / (CFG.CROP.gwStress - CFG.CROP.gwSevere), 0, 1);
    var stress = clamp(Math.max(saltStress, waterStress * 0.9, floodStress), 0, 1);
    c.saltStress = saltStress; c.waterStress = waterStress; c.lastStress = stress;
    if (stress > 0.05) c.health -= (0.018 + stress * 0.05);
    else c.health = clamp(c.health + 0.012, 0, 1);
    c.health = clamp(c.health, 0, 1);
    if (stress < 0.25 && !c.dead) {
      c.biomass = clamp(c.biomass + CFG.CROP.growthRate * (1 - stress), 0, 1);
    } else {
      c.biomass = clamp(c.biomass - 0.012 * stress, 0, 1);
    }
    if (c.health <= CFG.CROP.deathHealth && !c.dead) {
      c.dead = true;
      pushLog(s, "bad", "作物枯萎死亡（健康度归零），任务失败。");
      finish(s);
      return;
    }
    if (newDay % 3 === 0) {
      pushLog(s, "evt", "第 " + (newDay + 1) + " 天：根区 EC " + ec.toFixed(2) +
        " dS/m，地下水位 " + s.gwDepth.toFixed(0) + "mm，健康 " + (c.health * 100).toFixed(0) + "%。");
    }
    if (s.hour >= CFG.TOTAL_HOURS) finish(s);
  }

  function rootEC(s) {
    var w = 0, salt = 0;
    for (var i = 0; i < CFG.ROOT_LAYERS; i++) { w += s.layers[i].water; salt += s.layers[i].salt; }
    if (w <= 0.01) return 0;
    return (salt * 1000 / w) * 1.55;
  }

  function profileEC(s) {
    return s.layers.map(layerEC);
  }

  function rootWaterContent(s) {
    var w = 0, d = 0;
    for (var i = 0; i < CFG.ROOT_LAYERS; i++) { w += s.layers[i].water; d += CFG.LAYERS[i].depth; }
    return w / d;
  }

  function evaluate(s) {
    var ec = rootEC(s);
    var c = s.crop;
    var checks = [
      ["根区 EC ≤ " + CFG.WIN.maxRootEC + " dS/m", ec <= CFG.WIN.maxRootEC, ec.toFixed(2) + " dS/m"],
      ["地下水位不浅于 " + CFG.WIN.maxGWDepthRise + "mm", s.gwDepth >= CFG.WIN.maxGWDepthRise, s.gwDepth.toFixed(0) + "mm"],
      ["生物量 ≥ " + CFG.WIN.minBiomass, c.biomass >= CFG.WIN.minBiomass, (c.biomass * 100).toFixed(0) + "%"],
      ["健康度 ≥ " + CFG.WIN.minHealth, c.health >= CFG.WIN.minHealth, (c.health * 100).toFixed(0) + "%"]
    ];
    var win = !c.dead && checks.every(function (k) { return k[1]; });
    return { win: win, checks: checks };
  }

  function finish(s) {
    if (s.status !== "running") return;
    s.irrigOn = false; s.drainOn = false;
    var ev = evaluate(s);
    s.status = ev.win ? "success" : (s.crop.dead ? "failed" : "failed");
    s.evaluation = ev;
    pushLog(s, ev.win ? "good" : "bad",
      "30 天模拟结束：" + (ev.win ? "各项指标达标，治理成功！" : "指标未全部达标，治理失败。"));
  }

  function runHours(s, n) {
    var guard = 0;
    while (n-- > 0 && s.status === "running" && guard++ < CFG.TOTAL_HOURS + 10) stepHour(s);
    return s;
  }

  // 按固定动作序列复现：动作在指定 hour 触发，结果只取决于 seed 与序列。
  function replay(seed, actions) {
    var s = createSimulation(seed);
    var queue = actions.slice().sort(function (a, b) { return a.hour - b.hour; });
    var idx = 0;
    while (s.status === "running") {
      while (idx < queue.length && queue[idx].hour === s.hour) {
        dispatch(s, queue[idx].type);
        idx++;
      }
      if (s.status !== "running") break;
      stepHour(s);
    }
    return s;
  }

  function dispatch(s, type) {
    if (type === "灌溉") toggleIrrigation(s);
    else if (type === "排水") toggleDrainage(s);
    else if (type === "覆盖物") applyMulch(s);
  }

  var api = {
    createSimulation: createSimulation,
    layerEC: layerEC,
    clamp: clamp,
    timeLabel: timeLabel,
    pushLog: pushLog,
    toggleIrrigation: toggleIrrigation,
    toggleDrainage: toggleDrainage,
    applyMulch: applyMulch,
    stepHour: stepHour,
    rootEC: rootEC,
    profileEC: profileEC,
    rootWaterContent: rootWaterContent,
    evaluate: evaluate,
    finish: finish,
    runHours: runHours,
    replay: replay,
    dispatch: dispatch
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== "undefined" ? window : globalThis);
