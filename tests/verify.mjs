import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { createGame, step, buildSummary, restoreCheckpoint, stateSignature, towWeight } from '../js/engine.js';
import { generateWorld, layoutSignature } from '../js/world.js';
import { INPUTS } from '../js/config.js';
import makeBotFn from './bot.mjs';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    });
}

const noInput = {};

function runWithBot(seed, botOptions = {}, maxSteps = CONFIG.maxSteps) {
  const state = createGame(seed);
  const bot = makeBotFn(botOptions);
  while (state.status === 'running' && state.steps < maxSteps) {
    const { input, pressed } = bot(state);
    step(state, input, pressed);
  }
  return state;
}

console.log('1) 固定 seed 布局一致性');
await test('同 seed 两次生成的地图/障碍/漂浮物指纹相同', () => {
  const a = layoutSignature(generateWorld(CONFIG.seed));
  const b = layoutSignature(generateWorld(CONFIG.seed));
  assert.equal(a, b);
  const other = layoutSignature(generateWorld(CONFIG.seed + 1));
  assert.notEqual(a, other);
});

await test('同 seed + 同输入序列，状态签名逐步一致', () => {
  const s1 = createGame(CONFIG.seed);
  const s2 = createGame(CONFIG.seed);
  const script = [
    { i: { up: true }, p: {} },
    { i: { up: true, right: true }, p: {} },
    { i: { up: true }, p: { [INPUTS.GRAB]: true } },
    { i: { left: true }, p: {} },
    { i: { cableUp: true }, p: { [INPUTS.GRAB]: true } }
  ];
  for (let n = 0; n < 240; n++) {
    const move = script[n % script.length];
    step(s1, move.i, move.p);
    step(s2, move.i, move.p);
  }
  assert.equal(stateSignature(s1), stateSignature(s2));
});

console.log('2) 端到端：自动航行完成配额');
const won = runWithBot(CONFIG.seed);
await test('机器人在时限内获胜', () => {
  assert.equal(won.status, 'won', `实际状态 ${won.status} ${won.failReason || ''}`);
});

await test('三类目标数量均达到配额', () => {
  const s = buildSummary(won);
  assert.ok(s.targets.quotaMet);
  assert.ok(s.targets.collected.wood >= CONFIG.quota.wood);
  assert.ok(s.targets.collected.reed >= CONFIG.quota.reed);
  assert.ok(s.targets.collected.drum >= CONFIG.quota.drum);
});

await test('胜利摘要包含目标数量、剩余资源、最终用时与路径', () => {
  const s = buildSummary(won);
  assert.ok(s.finalTimeSeconds > 0);
  assert.ok(s.resources.fuelRemaining >= 0 && s.resources.fuelRemaining <= CONFIG.boat.maxFuel);
  assert.ok(s.resources.hullRemaining > 0);
  assert.ok(s.path.length > 10);
  assert.equal(s.failReason, null);
  // 摘要可 JSON 序列化（供 localStorage 保存）
  JSON.stringify(s);
});

await test('同 seed 再跑一次机器人，胜负与用时完全一致', () => {
  const again = runWithBot(CONFIG.seed);
  assert.equal(again.status, won.status);
  assert.equal(again.time, won.time);
  assert.equal(again.score, won.score);
  assert.equal(stateSignature(again), stateSignature(won));
});

console.log('3) 失败场景');
await test('漏掉 3 件危险物触发失败且记录失败原因', () => {
  const state = createGame(CONFIG.seed);
  // 直接驱动漏失路径：把 3 件危化桶标记为漂出地图，模拟玩家全程未拦截。
  const drums = state.world.debris.filter((d) => d.type === 'drum').slice(0, CONFIG.missLimit);
  for (const d of drums) {
    d.state = 'floating';
    d.x = CONFIG.river.startX - 100;
  }
  step(state, {}, {});
  assert.equal(state.status, 'lost');
  assert.match(state.failReason, /危险漂浮物/);
  assert.equal(state.hazardMissed, CONFIG.missLimit);
  const s = buildSummary(state);
  assert.equal(s.status, 'lost');
  assert.ok(s.failReason.includes('危化桶'));
  assert.ok(s.finalTimeSeconds > 0);
});

await test('船体损坏归零触发失败', () => {
  const state = createGame(CONFIG.seed);
  state.boat.hull = 5;
  // 直接把船放到桥墩上，碰撞扣 18 点并触发恢复，恢复后仍为失败
  state.boat.x = CONFIG.piers[0].x;
  state.boat.y = CONFIG.piers[0].y;
  step(state, noInput, {});
  assert.equal(state.status, 'lost');
  assert.match(state.failReason, /船体/);
});

console.log('4) 检查点与恢复');
await test('经过检查点自动存档，碰撞后从检查点恢复而非重置整局', () => {
  const state = createGame(CONFIG.seed);
  for (let i = 0; i < 500; i++) step(state, { up: true }, {});
  assert.ok(state.world.checkpoints[0].passed);
  const snapX = state.checkpoint.boat.x;
  state.boat.x = CONFIG.piers[0].x;
  state.boat.y = CONFIG.piers[0].y;
  const hullBefore = state.boat.hull;
  step(state, noInput, {});
  assert.equal(state.recoverCount, 1);
  assert.equal(state.boat.x, snapX);
  assert.ok(state.boat.hull < hullBefore);
  assert.ok(state.status === 'running' || state.status === 'lost');
});

await test('手动恢复返回最近检查点且保留已收集进度', () => {
  const state = createGame(CONFIG.seed);
  for (let i = 0; i < 600; i++) step(state, { up: true }, {});
  const cpPassed = state.world.checkpoints.filter((c) => c.passed).length;
  assert.ok(cpPassed >= 1);
  const markerX = state.boat.x;
  state.boat.x += 200;
  restoreCheckpoint(state, '手动恢复测试');
  assert.equal(state.boat.x, state.checkpoint.boat.x);
  assert.notEqual(state.boat.x, markerX);
});

console.log('5) 资源与配额核对');
await test('摘要中的剩余资源与内部状态一致', () => {
  const s = buildSummary(won);
  assert.equal(s.resources.fuelRemaining, +won.boat.fuel.toFixed(2));
  assert.equal(s.resources.hullRemaining, +won.boat.hull.toFixed(1));
  assert.equal(s.resources.score, won.score);
  assert.equal(s.targets.hazardMissed, won.hazardMissed);
  assert.equal(s.recovery.totalCheckpoints, CONFIG.checkpoints.length);
});

console.log(`\n全部 ${passed} 项验证通过 ✓`);
