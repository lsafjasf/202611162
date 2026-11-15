// 离线验证报告：稳态/临界/失败三场景、双策略代价、同 seed 确定性校验。
(function (root) {
  "use strict";
  var Sim = (typeof require !== "undefined") ? require("./simulation.js") : root.Sim;
  var P = (typeof require !== "undefined") ? require("./policies.js") : root.Policies;
  var CFG = (typeof require !== "undefined") ? require("./config.js") : root.CONFIG;

  function snapshot(s) {
    return {
      hour: s.hour, day: s.day,
      rootEC: +Sim.rootEC(s).toFixed(3),
      gwDepth: +s.gwDepth.toFixed(1),
      theta: +Sim.rootWaterContent(s).toFixed(4),
      health: +s.crop.health.toFixed(4),
      biomass: +s.crop.biomass.toFixed(4),
      water: +s.water.toFixed(3),
      energy: +s.energy.toFixed(2),
      gwSalt: +s.gwSalt.toFixed(3),
      layerSalt: s.layers.map(function (l) { return +l.salt.toFixed(5); })
    };
  }

  // 关键事件首次发生的时间与类型，用于同 seed 顺序比对
  function eventOrder(s) {
    return s.log.filter(function (l) { return l.cls === "evt" || l.cls === "bad"; })
      .map(function (l) { return l.hour + ":" + l.msg.slice(0, 12); });
  }

  function line(s) {
    return "EC " + Sim.rootEC(s).toFixed(2) + " | 水位 " + s.gwDepth.toFixed(0) +
      "mm | 健康 " + (s.crop.health * 100).toFixed(0) + "% | 生物量 " +
      (s.crop.biomass * 100).toFixed(0) + "% | 水 " + s.water.toFixed(1) +
      "m³ | 电 " + s.energy.toFixed(0) + "kWh | 用时 " + (s.hour / 24).toFixed(1) + "天";
  }

  // 场景一：稳态——强淋洗策略全程把指标压在安全区
  function steadyScenario(seed) {
    var s = Sim.createSimulation(seed);
    var maxStress = 0, minEC = 99;
    while (s.status === "running") {
      P.aggressiveStep(s);
      Sim.stepHour(s);
      maxStress = Math.max(maxStress, s.crop.lastStress);
      minEC = Math.min(minEC, Sim.rootEC(s));
    }
    return {
      name: "稳态运行（策略B 强淋洗快排）",
      before: "初始 EC " + Sim.rootEC(Sim.createSimulation(seed)).toFixed(2) + " dS/m（重度盐渍化）",
      after: line(s),
      result: s.status === "success" ? "达标成功，全程最大胁迫 " + maxStress.toFixed(2) : "未达稳态",
      state: s
    };
  }

  // 场景二：临界——刻意拖延到 EC 与水位双告警才抢救
  function criticalScenario(seed) {
    var s = Sim.createSimulation(seed);
    var alarmHour = -1;
    while (s.status === "running") {
      var ec = Sim.rootEC(s), T = CFG.THRESHOLDS;
      var critical = ec >= T.ecCritical || s.gwDepth <= T.gwCritical;
      if (critical && alarmHour < 0) {
        alarmHour = s.hour;
        Sim.pushLog(s, "bad", "进入临界状态：EC " + ec.toFixed(2) + " / 水位 " + s.gwDepth.toFixed(0) + "mm，立即抢救。");
      }
      if (alarmHour >= 0) {
        if (s.gwDepth < T.gwShallow && !s.drainOn) Sim.toggleDrainage(s);
        if (s.gwDepth > 1000 && s.drainOn) Sim.toggleDrainage(s);
        if (ec > 1.4 && !s.irrigOn && s.water > 10) Sim.toggleIrrigation(s);
        if ((ec < 1.0 || s.water < 6) && s.irrigOn) Sim.toggleIrrigation(s);
      }
      Sim.stepHour(s);
    }
    return {
      name: "临界抢救（拖延至双阈值告警）",
      before: "第 " + (alarmHour / 24).toFixed(1) + " 天触发临界阈值（EC≥" + CFG.THRESHOLDS.ecCritical +
        " 或水位≤" + CFG.THRESHOLDS.gwCritical + "mm）",
      after: line(s),
      result: s.status === "success" ? "抢救成功，但健康度/资源代价更高" : "抢救失败",
      state: s, alarmHour: alarmHour
    };
  }

  // 场景三：失败操作——只灌溉不排水，抬升地下水位且浪费淡水
  function failureScenario(seed) {
    var s = Sim.createSimulation(seed);
    var startWater = s.water, startEnergy = s.energy;
    while (s.status === "running") {
      var ec = Sim.rootEC(s);
      // 典型错误：EC 一高就持续开灌溉，从不排水
      if (ec > 1.0 && !s.irrigOn) Sim.toggleIrrigation(s);
      if (ec < 0.8 && s.irrigOn) Sim.toggleIrrigation(s);
      Sim.stepHour(s);
    }
    return {
      name: "失败操作（只灌溉不排水）",
      before: "淡水 " + startWater.toFixed(0) + "m³ / 电能 " + startEnergy.toFixed(0) + "kWh，根区 EC " +
        Sim.rootEC(Sim.createSimulation(seed)).toFixed(2),
      after: line(s),
      result: "淡水浪费 " + s.totals.waterUsed.toFixed(1) + "m³，地下水位抬升至 " + s.gwDepth.toFixed(0) +
        "mm，作物" + (s.crop.dead ? "枯死" : "未达标"),
      state: s
    };
  }

  function policyCompare(seed) {
    var rows = P.POLICIES.map(function (pol) {
      var s = P.runPolicy(seed, pol.step);
      return {
        name: pol.name, desc: pol.desc, status: s.status,
        ec: +Sim.rootEC(s).toFixed(2), gw: +s.gwDepth.toFixed(0),
        health: +(s.crop.health * 100).toFixed(0), biomass: +(s.crop.biomass * 100).toFixed(0),
        water: +s.totals.waterUsed.toFixed(1), energy: +s.totals.energyUsed.toFixed(0),
        mulch: s.totals.mulchUsed, cost: +P.cost(s).toFixed(1),
        hours: s.hour
      };
    });
    return rows;
  }

  var api = {
    snapshot: snapshot, eventOrder: eventOrder, line: line,
    steadyScenario: steadyScenario, criticalScenario: criticalScenario,
    failureScenario: failureScenario, policyCompare: policyCompare
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Report = api;
})(typeof window !== "undefined" ? window : globalThis);
