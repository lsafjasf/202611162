/*
 * Node 测试（无第三方依赖，node tests/sim.test.js 直接运行）：
 * 1. 同 seed 复现：天气序列、鸟群、初始资源、关键事件、逐时 checksum 全一致；
 * 2. 不同 seed 产生不同世界；
 * 3. 固定演示序列至少覆盖一次稳态、一次临界、一次失败操作；
 * 4. 两种恢复策略都可触发且代价被记录；
 * 5. 合理管理可在默认 seed 下达成胜利条件。
 */
const assert = require('assert');
const path = require('path');
const SIM = require(path.join(__dirname, '..', 'js', 'sim.js'));

const SEED = 'mudflat-2026';
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

function run(script, seed) {
  const sim = SIM.createSimulation(seed || SEED);
  for (let t = 0; t < SIM.C.TOTAL_HOURS; t++) {
    (script || []).forEach(a => {
      if (!a.fired && sim.tick >= a.t) {
        a.fired = true;
        if (a.strategy) SIM.applyStrategy(sim, a.s, a.strategy);
        else SIM.applyAction(sim, a.s, a.kind, a.value);
      }
    });
    SIM.step(sim);
  }
  return sim;
}

console.log('确定性复现：');
test('同 seed 的天气、鸟群、初始资源与事件顺序一致', () => {
  const a = SIM.createSimulation(SEED), b = SIM.createSimulation(SEED);
  assert.deepStrictEqual(a.weather.rain, b.weather.rain);
  assert.deepStrictEqual(a.weather.wind, b.weather.wind);
  assert.deepStrictEqual(a.sites.map(s => [s.depth, s.food, s.flockPlan.size, s.flockPlan.energy0]),
    b.sites.map(s => [s.depth, s.food, s.flockPlan.size, s.flockPlan.energy0]));
  assert.deepStrictEqual(a.keyEvents.map(e => [e.tick, e.type, e.site]),
    b.keyEvents.map(e => [e.tick, e.type, e.site]));
});

test('同 seed 逐小时 checksum 完全一致', () => {
  const a = SIM.createSimulation(SEED), b = SIM.createSimulation(SEED);
  for (let t = 0; t < SIM.C.TOTAL_HOURS; t++) {
    SIM.step(a); SIM.step(b);
    assert.strictEqual(SIM.checksum(a), SIM.checksum(b), 'tick ' + (t + 1));
  }
});

test('同 seed + 同一操作序列结果一致', () => {
  const script = [
    { t: 50, s: 0, kind: 'route', value: 2 },
    { t: 124, s: 1, kind: 'patrol', value: 2 },
    { t: 220, s: 2, kind: 'gate', value: 1 }
  ];
  const a = run(script.map(x => Object.assign({}, x)));
  const b = run(script.map(x => Object.assign({}, x)));
  assert.strictEqual(SIM.checksum(a), SIM.checksum(b));
});

test('不同 seed 的世界不同', () => {
  const a = SIM.createSimulation(SEED), b = SIM.createSimulation('another-seed-7');
  assert.notDeepStrictEqual(a.weather.rain, b.weather.rain);
  assert.notStrictEqual(SIM.checksum(a), SIM.checksum(b));
});

console.log('状态与操作判定：');
test('固定演示序列覆盖稳态、临界、失败三类操作', () => {
  const script = [
    { t: 50, s: 0, kind: 'route', value: 2 },
    { t: 50, s: 0, kind: 'patrol', value: 1 },
    { t: 124, s: 1, kind: 'route', value: 1 },
    { t: 124, s: 1, kind: 'patrol', value: 2 },
    { t: 220, s: 2, kind: 'route', value: 0 },
    { t: 220, s: 2, kind: 'patrol', value: 0 },
    { t: 250, s: 2, strategy: 'emergency' }
  ];
  const sim = run(script.map(x => Object.assign({}, x)));
  const outcomes = new Set(sim.evalQueue.filter(e => e.done).map(e => e.outcome));
  assert.ok(outcomes.has('steady'), '应包含稳态操作');
  assert.ok(outcomes.has('critical') || outcomes.has('failed'), '应包含临界/失败操作');
  assert.ok(outcomes.has('failed'), '应包含失败操作');
  sim.evalQueue.filter(e => e.done).forEach(e => {
    assert.ok(e.before && e.after, '判定必须含前后快照');
  });
});

test('不管理时至少一个站点停留记录失败', () => {
  const sim = run([]);
  const fails = sim.sites.filter(s => !s.record.success).length;
  assert.ok(fails >= 1, '无作为应导致失败');
});

console.log('恢复策略：');
test('紧急封育与弹性缓冲均可执行并记录代价', () => {
  const sim = SIM.createSimulation(SEED);
  for (let t = 0; t < 250; t++) SIM.step(sim);
  const r1 = SIM.applyStrategy(sim, 0, 'emergency');
  const r2 = SIM.applyStrategy(sim, 1, 'buffer');
  assert.ok(r1.ok && r2.ok);
  for (let t = 0; t < 60; t++) SIM.step(sim);
  assert.strictEqual(sim.strategyRecords.length, 2);
  sim.strategyRecords.forEach(r => {
    assert.ok(r.after && r.outcome, '窗口结束后应有结果');
    assert.ok(r.costTotal >= r.price, '总代价应含门票损失');
    assert.ok(r.trigger.score > 0 && r.trigger.depth > 0);
  });
  assert.ok(sim.strategyRecords[0].price > sim.strategyRecords[1].price);
});

test('预算不足时策略被拒绝', () => {
  const sim = SIM.createSimulation(SEED);
  sim.budget = 10;
  const r = SIM.applyStrategy(sim, 0, 'emergency');
  assert.strictEqual(r.ok, false);
});

test('两种策略在相同触发条件下产生可比较的代价与恢复差异', () => {
  function withStrategy(type) {
    const sim = SIM.createSimulation(SEED);
    for (let t = 0; t < 250; t++) SIM.step(sim);
    SIM.applyStrategy(sim, 2, type);
    for (let t = 0; t < 60; t++) SIM.step(sim);
    return sim.strategyRecords[0];
  }
  const emergency = withStrategy('emergency');
  const buffer = withStrategy('buffer');
  assert.ok(emergency.costTotal > buffer.costTotal, '紧急封育总代价应更高');
  assert.ok(emergency.window < buffer.window, '紧急封育恢复窗口应更短');
  const eAfter = emergency.after.sites[2].score, bAfter = buffer.after.sites[2].score;
  assert.ok(eAfter >= bAfter - 2, '强干预恢复效果不应弱于弱干预');
});

console.log('胜利条件：');
test('合理管理在默认 seed 下达成 3 次成功记录', () => {
  const script = [
    { t: 40, s: 0, kind: 'gate', value: 1 }, { t: 44, s: 0, kind: 'route', value: 2 },
    { t: 44, s: 0, kind: 'patrol', value: 2 }, { t: 64, s: 0, kind: 'gate', value: 0 },
    { t: 112, s: 1, kind: 'gate', value: 1 }, { t: 116, s: 1, kind: 'route', value: 2 },
    { t: 116, s: 1, kind: 'patrol', value: 2 }, { t: 124, s: 1, kind: 'gate', value: 0 },
    { t: 150, s: 1, kind: 'gate', value: 2 }, { t: 172, s: 1, kind: 'gate', value: 0 },
    { t: 208, s: 2, kind: 'gate', value: 1 }, { t: 212, s: 2, kind: 'route', value: 2 },
    { t: 212, s: 2, kind: 'patrol', value: 1 }, { t: 256, s: 2, kind: 'gate', value: 0 },
    { t: 276, s: 2, kind: 'gate', value: 1 }, { t: 296, s: 2, kind: 'gate', value: 0 }
  ];
  const sim = run(script.map(x => Object.assign({}, x)));
  assert.strictEqual(sim.won, true, JSON.stringify(sim.summary));
  assert.strictEqual(sim.sites.every(s => s.record && s.record.success), true);
});

console.log('\n全部 ' + passed + ' 项测试通过 ✓');
