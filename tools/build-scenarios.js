/* 生成三档固定操作序列与恢复策略对比，输出到 data/scenarios.json。
   同 seed 下：目标个体（初始斑块）、天气序列、初始资源完全一致。 */
'use strict';
var fs = require('fs');
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'sim.js'));
var E = require(path.join(__dirname, 'experiment.js'));

var SEED = 'demo-seed-7';
var STEPS = Math.round(S.CFG.DAYS / (S.CFG.STEP_H / 24));

var variants = {
  steady: { survey: true, surveyGap: 2, scanN: 5, spray: true,
    sprayAt: 32, traps: true, maxInterventions: 3 },
  critical: { survey: true, surveyGap: 4, scanN: 3, spray: true,
    sprayAt: 50, traps: true, maxInterventions: 2 },
  failure: { survey: false, surveyGap: 10, spray: false,
    sprayAt: 99, traps: false, maxInterventions: 1 }
};

/* 将固定操作序列在纯引擎上重放，记录触发点与结束快照。 */
function replay(actions, hook) {
  var sim = S.createSim(SEED);
  var startSnap = S.snapshot(sim, '初始状态');
  var ai = 0;
  var triggerSnap = null;
  for (var i = 0; i < STEPS; i++) {
    while (ai < actions.length && actions[ai].at <= sim.time) {
      var a = actions[ai++];
      if (a.type === 'survey') S.survey(sim, a.x, a.y);
      if (a.type === 'trap') S.placeTrap(sim, a.x, a.y);
      if (a.type === 'spray') S.spray(sim, a.x, a.y, a.mode || 'target');
    }
    S.step(sim);
    S.pruneDrones(sim);
    if (hook && !triggerSnap) triggerSnap = hook(sim);
  }
  return {
    sim: sim,
    start: startSnap,
    trigger: triggerSnap,
    end: S.snapshot(sim, '第 21 天')
  };
}

var out = { seed: SEED, generatedAt: new Date().toISOString(),
  config: S.CFG, scenarios: {}, recovery: {} };

Object.keys(variants).forEach(function (name) {
  var r = E.policy(SEED, variants[name]);
  var replayR = replay(r.actions, function (sim) {
    var m = S.metrics(sim);
    if (m.infectedRatio >= S.CFG.RECOVER_INFECT) {
      return S.snapshot(sim, '恢复触发点（感染≥' +
        Math.round(S.CFG.RECOVER_INFECT * 100) + '%）');
    }
    return null;
  });
  out.scenarios[name] = {
    label: { steady: '稳态（积极综合管控）',
      critical: '临界（监测与处置不足）',
      failure: '失败（几乎不干预）' }[name],
    actions: r.actions,
    result: replayR.sim.result,
    start: replayR.start,
    trigger: replayR.trigger,
    end: replayR.end,
    events: replayR.sim.events.length
  };
});

function continueFrom(state, strategy) {
  var sim = S.cloneSim(state);
  var triggerDay = sim.time;
  var spend = 0;
  for (var i = 0; i < STEPS; i++) {
    S.step(sim);
    S.pruneDrones(sim);
    if (sim.finished) break;
    var cadence = strategy === 'precision' ? 1 : 2;
    if (sim.day % cadence !== 0 || sim.day <= triggerDay) continue;
    var hot = sim.cells.filter(function (c) {
      return c.pest >= S.CFG.HOTSPOT_PEST;
    }).sort(function (a, b) { return b.pest - a.pest; });
    var cap = strategy === 'precision' ? 7 : 3;
    hot.slice(0, cap).forEach(function (c) {
      if (strategy === 'precision') {
        if (sim.resources.spray > 0 && sim.resources.budget >= 12 &&
          c.pest >= 30) {
          var r1 = S.spray(sim, c.x, c.y, 'target');
          if (r1.ok) spend += 12;
        } else if (sim.resources.traps > 0 && sim.resources.budget >= 8) {
          var r2 = S.placeTrap(sim, c.x, c.y);
          if (r2.ok) spend += 8;
        }
      } else if (sim.resources.spray > 0 && sim.resources.budget >= 18 &&
        c.pest >= 40) {
        var r3 = S.spray(sim, c.x, c.y, 'broad');
        if (r3.ok) spend += 18;
      }
    });
  }
  return { sim: sim, spend: spend };
}

/* 用失败档（不干预）推进到触发阈值，得到共同起点。 */
var base = S.createSim(SEED);
var triggerState = null;
var triggerDay = null;
for (var t = 0; t < STEPS; t++) {
  S.step(base);
  var mt = S.metrics(base);
  if (!triggerState && mt.infectedRatio >= S.CFG.RECOVER_INFECT) {
    triggerState = S.cloneSim(base);
    triggerDay = base.time;
    break;
  }
}

['precision', 'broad'].forEach(function (strategy) {
  var r = continueFrom(triggerState, strategy);
  out.recovery[strategy] = {
    label: strategy === 'precision' ? '精准恢复（局部喷药+诱捕器）'
      : '广域恢复（大面积喷药）',
    triggerDay: triggerDay,
    threshold: '感染面积≥' + Math.round(S.CFG.RECOVER_INFECT * 100) + '%',
    extraSpend: r.spend,
    sprayUsed: r.sim.totals.sprayUsed,
    trapsLaid: r.sim.totals.trapsLaid,
    result: r.sim.result,
    end: S.snapshot(r.sim, '恢复后第 21 天')
  };
});
out.recovery.triggerSnapshot = S.snapshot(triggerState, '恢复触发点');

var target = path.join(__dirname, '..', 'data', 'scenarios.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(out, null, 2));
console.log('written', target);
Object.keys(out.scenarios).forEach(function (n) {
  var s = out.scenarios[n];
  console.log(n, s.result, 'actions=' + s.actions.length,
    'infect ' + (s.start.infectedRatio * 100).toFixed(1) + '%->' +
    (s.end.infectedRatio * 100).toFixed(1) + '%',
    'benefit ' + s.end.avgBenefit.toFixed(1));
});
Object.keys(out.recovery).filter(function (k) {
  return k !== 'triggerSnapshot';
}).forEach(function (k) {
  var r = out.recovery[k];
  console.log('recovery/' + k, r.result, 'spend=' + r.extraSpend,
    'infect=' + (r.end.infectedRatio * 100).toFixed(1) + '%',
    'benefit=' + r.end.avgBenefit.toFixed(1),
    'health=' + r.end.avgHealth.toFixed(1));
});
