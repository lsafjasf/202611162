/* 参数与策略实验：为三档演示脚本寻找合适的固定操作序列。 */
'use strict';
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'sim.js'));
var H = require(path.join(__dirname, 'headless.js'));

function topPestCells(sim, n) {
  return sim.cells.slice().sort(function (a, b) {
    return b.pest - a.pest;
  }).slice(0, n).map(function (c) {
    return { x: c.x, y: c.y, pest: Math.round(c.pest) };
  });
}

/* 基于规则的自适应策略：扫描→按热区处置，intensity 控制投入强度。 */
function policy(seed, opts) {
  var sim = S.createSim(seed);
  var steps = Math.round(S.CFG.DAYS / (S.CFG.STEP_H / 24));
  var actions = [];
  var surveyGap = opts.surveyGap || 3;

  for (var i = 0; i < steps; i++) {
    S.step(sim);
    S.pruneDrones(sim);
    if (sim.finished) break;
    var day = sim.day;
    if (day % surveyGap !== 0) continue;

    if (opts.survey) {
      topPestCells(sim, opts.scanN || 4).forEach(function (t) {
        var r1 = S.survey(sim, t.x, t.y);
        if (r1.ok) actions.push({ at: sim.time, type: 'survey',
          x: t.x, y: t.y });
      });
    }
    var hot = sim.cells.filter(function (c) {
      return c.pest >= S.CFG.HOTSPOT_PEST;
    }).sort(function (a, b) { return b.pest - a.pest; });

    hot.slice(0, opts.maxInterventions || 3).forEach(function (c) {
      if (opts.spray && sim.resources.spray > 0 && sim.resources.budget >= 12 &&
        c.pest >= (opts.sprayAt || 50)) {
        var mode = opts.broad ? 'broad' : 'target';
        var r2 = S.spray(sim, c.x, c.y, mode);
        if (r2.ok) actions.push({ at: sim.time, type: 'spray',
          x: c.x, y: c.y, mode: mode });
      } else if (opts.traps && sim.resources.traps > 0 &&
        sim.resources.budget >= 8) {
        var r3 = S.placeTrap(sim, c.x, c.y);
        if (r3.ok) actions.push({ at: sim.time, type: 'trap',
          x: c.x, y: c.y });
      }
    });
  }
  return { sim: sim, actions: actions, metrics: S.metrics(sim) };
}

var seed = process.argv[2] || 'demo-seed-7';
var variants = [
  { name: 'steady', survey: true, surveyGap: 2, scanN: 5, spray: true,
    sprayAt: 32, traps: true, maxInterventions: 3 },
  { name: 'critical', survey: true, surveyGap: 4, scanN: 3, spray: true,
    sprayAt: 50, traps: true, maxInterventions: 2 },
  { name: 'failure', survey: false, surveyGap: 10, spray: false,
    sprayAt: 99, traps: false, maxInterventions: 1 }
];

variants.forEach(function (v) {
  var r = policy(seed, v);
  var m = r.metrics;
  console.log('[' + v.name + '] result=' + r.sim.result +
    ' infected=' + (m.infectedRatio * 100).toFixed(1) + '%' +
    ' benefit=' + m.avgBenefit.toFixed(1) +
    ' health=' + m.avgHealth.toFixed(1) +
    ' pest=' + m.avgPest.toFixed(1) +
    ' budget=' + r.sim.resources.budget +
    ' spray=' + r.sim.resources.spray +
    ' traps=' + r.sim.resources.traps +
    ' events=' + r.sim.events.length +
    ' actions=' + r.actions.length);
});

module.exports = { policy: policy, topPestCells: topPestCells };
