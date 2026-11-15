// 两种可复现的自动恢复策略（仅读取状态 + 调用确定性操作，不含随机）。
(function (root) {
  "use strict";
  var Sim = (typeof require !== "undefined") ? require("./simulation.js") : root.Sim;
  var CFG = (typeof require !== "undefined") ? require("./config.js") : root.CONFIG;

  // 策略 A：节水覆盖型。先铺覆盖物抑制蒸发返盐，只在 EC 超阈值时小水淋洗，
  // 排水谨慎，主要靠自然出流。代价偏向覆盖物、省电省水。
  function conservativeStep(s) {
    var T = CFG.THRESHOLDS, ec = Sim.rootEC(s);
    if (s.day >= 1 && !s.mulchOn && s.mulchLeft > 0) Sim.applyMulch(s);
    if (s.gwDepth < T.gwCritical && !s.drainOn) Sim.toggleDrainage(s);
    if ((s.gwDepth > 900 || s.energy < CFG.THRESHOLDS.energyLow) && s.drainOn) Sim.toggleDrainage(s);
    if (ec > T.ecHigh && !s.irrigOn && s.water > 12 && s.gwDepth > 750) Sim.toggleIrrigation(s);
    if ((ec < 1.8 || s.water < 8 || s.gwDepth < 700) && s.irrigOn) Sim.toggleIrrigation(s);
  }

  // 策略 B：强淋洗快排型。EC 一偏高就大水冲洗，排水泵积极降低水位防返盐。
  // 见效快、最终 EC 更低，但水电消耗显著更高。
  function aggressiveStep(s) {
    var T = CFG.THRESHOLDS, ec = Sim.rootEC(s);
    if (s.day >= 1 && !s.mulchOn && s.mulchLeft > 0) Sim.applyMulch(s);
    if (s.gwDepth < T.gwShallow && !s.drainOn) Sim.toggleDrainage(s);
    if (s.gwDepth > 1000 && s.drainOn) Sim.toggleDrainage(s);
    // 目标 EC 更低、冲洗更积极：维持在 1.0~1.4，宁可多用水换安全余量
    if (ec > 1.4 && !s.irrigOn && s.water > 10) Sim.toggleIrrigation(s);
    if ((ec < 1.0 || s.water < 6) && s.irrigOn) Sim.toggleIrrigation(s);
  }

  function runPolicy(seed, stepFn) {
    var s = Sim.createSimulation(seed);
    while (s.status === "running") {
      stepFn(s);
      Sim.stepHour(s);
    }
    return s;
  }

  function cost(s) {
    var p = CFG.PRICE, t = s.totals;
    return t.waterUsed * p.water + t.energyUsed * p.energy + t.mulchUsed * p.mulch;
  }

  var api = {
    conservativeStep: conservativeStep,
    aggressiveStep: aggressiveStep,
    runPolicy: runPolicy,
    cost: cost,
    POLICIES: [
      { id: "conservative", name: "策略A 节水覆盖型", step: conservativeStep,
        desc: "覆盖物抑蒸 + 阈值小水淋洗 + 谨慎排水，省水省电，见效较慢。" },
      { id: "aggressive", name: "策略B 强淋洗快排型", step: aggressiveStep,
        desc: "EC 偏高即大水冲洗，排水泵积极控水位，见效快但耗水耗电。" }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Policies = api;
})(typeof window !== "undefined" ? window : globalThis);
