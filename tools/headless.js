/* 无头跑批：在 Node 中驱动引擎，用于参数调试、确定性校验与脚本生成。 */
'use strict';
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'sim.js'));

function run(seed, actions) {
  var sim = S.createSim(seed);
  actions = actions || [];
  var ai = 0;
  var steps = Math.round(S.CFG.DAYS / (S.CFG.STEP_H / 24));
  for (var i = 0; i < steps; i++) {
    while (ai < actions.length && actions[ai].at <= sim.time) {
      var a = actions[ai++];
      if (a.type === 'survey') S.survey(sim, a.x, a.y);
      if (a.type === 'trap') S.placeTrap(sim, a.x, a.y);
      if (a.type === 'spray') S.spray(sim, a.x, a.y, a.mode || 'target');
    }
    S.step(sim);
    S.pruneDrones(sim);
  }
  return sim;
}

function fingerprint(sim) {
  return sim.cells.map(function (c) {
    return [c.pest.toFixed(4), c.benefit.toFixed(4), c.health.toFixed(4),
      c.traps].join('|');
  }).join(';');
}

if (require.main === module) {
  var seed = process.argv[2] || 'demo-seed-7';
  var a = run(seed, []);
  var b = run(seed, []);
  var c = run(seed + '-x', []);
  console.log('seed:', seed);
  console.log('weather[0..3]:', JSON.stringify(a.weather.slice(0, 4)));
  console.log('hotspots:', JSON.stringify(a.hotspots));
  console.log('baseline metrics:', JSON.stringify(S.metrics(a), null, 0));
  console.log('result:', a.result, 'events:', a.events.length);
  console.log('determinism same-seed:', fingerprint(a) === fingerprint(b));
  console.log('different-seed differs:', fingerprint(a) !== fingerprint(c));
  console.log('weather reproducible:',
    JSON.stringify(a.weather) === JSON.stringify(b.weather));
}

module.exports = { run: run, fingerprint: fingerprint };
