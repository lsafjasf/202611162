'use strict';
var assert = require('assert');
var path = require('path');
var S = require(path.join(__dirname, '..', 'js', 'sim.js'));
var H = require(path.join(__dirname, '..', 'tools', 'headless.js'));
var data = require(path.join(__dirname, '..', 'data', 'scenarios.json'));

/* 1. 同 seed 重开：目标个体、天气、初始资源完全一致。 */
var a = S.createSim(data.seed);
var b = S.createSim(data.seed);
assert.deepStrictEqual(
  a.cells.map(function (c) { return c.pest; }),
  b.cells.map(function (c) { return c.pest; }));
assert.deepStrictEqual(a.weather, b.weather);
assert.deepStrictEqual(a.resources, b.resources);
assert.deepStrictEqual(a.hotspots, b.hotspots);

/* 2. 固定序列重放两次，最终状态逐林班一致。 */
Object.keys(data.scenarios).forEach(function (name) {
  var acts = data.scenarios[name].actions;
  var f1 = H.fingerprint(H.run(data.seed, acts));
  var f2 = H.fingerprint(H.run(data.seed, acts));
  assert.strictEqual(f1, f2, name + ' replay fingerprint mismatch');
});

/* 3. 三档结论与生成数据一致。 */
Object.keys(data.scenarios).forEach(function (name) {
  var sim = H.run(data.seed, data.scenarios[name].actions);
  assert.strictEqual(sim.result, data.scenarios[name].result,
    name + ' result mismatch');
});
assert.strictEqual(data.scenarios.steady.result, 'success');
assert.strictEqual(data.scenarios.critical.result, 'marginal');
assert.strictEqual(data.scenarios.failure.result, 'fail');

/* 4. 恢复策略：两条路径从同一触发快照出发，最终指标与数据一致。 */
var rec = data.recovery;
assert.ok(rec.precision.result === 'success');
assert.ok(rec.broad.result === 'fail');
assert.ok(rec.precision.end.avgBenefit > rec.broad.end.avgBenefit,
  'precision preserves more benefit');
assert.ok(rec.precision.extraSpend > rec.broad.extraSpend,
  'precision costs more budget');
assert.ok(Math.abs(rec.triggerSnapshot.infectedRatio - S.CFG.RECOVER_INFECT)
  < 0.06, 'trigger near threshold');

/* 5. 时间连续性：相邻子步的害虫密度差有界，不存在跳变。 */
var sim = S.createSim(data.seed);
var prev = sim.cells.map(function (c) { return c.pest; });
var maxJump = 0;
for (var i = 0; i < 40; i++) {
  S.step(sim);
  sim.cells.forEach(function (c, j) {
    maxJump = Math.max(maxJump, Math.abs(c.pest - prev[j]));
    prev[j] = c.pest;
  });
}
assert.ok(maxJump < S.CFG.OUTBREAK_JUMP,
  'normal sub-step change smaller than an outbreak jump, got ' + maxJump);

/* 6. 暴发确实由“监测遗漏”驱动：高密度林班及时监测后不再暴发。 */
var watch = S.createSim(data.seed);
var steps = Math.round(S.CFG.DAYS / (S.CFG.STEP_H / 24));
for (var k = 0; k < steps; k++) {
  S.step(watch);
  watch.cells.forEach(function (c) {
    if (c.pest >= S.CFG.OUTBREAK_PEST - 5 &&
      watch.resources.sorties > 0 && watch.resources.budget >= 6) {
      S.survey(watch, c.x, c.y);
    }
  });
}
assert.ok(watch.events.length < data.scenarios.failure.events,
  'timely surveys reduce outbreaks');

console.log('engine test: all assertions passed');
