/* Node 验证入口：固定种子下的布局、胜负、检查点恢复与状态摘要。 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const World = require('../js/world.js');
const Game = require('../js/game.js');
const Auto = require('./autopilot.js');

const SEED = 'MARSH-SEED-2026';
let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
}

console.log('1) 固定 seed 布局一致性');
check('同 seed 两次生成的 layoutHash 与对象位置完全相同', () => {
  const a = World.generateWorld(SEED);
  const b = World.generateWorld(SEED);
  assert.strictEqual(a.layoutHash, b.layoutHash);
  assert.deepStrictEqual(a.stations, b.stations);
  assert.deepStrictEqual(a.checkpoints, b.checkpoints);
  assert.deepStrictEqual(a.dock, b.dock);
  assert.deepStrictEqual(
    a.tiles.map((r) => r.map((t) => [t.depth, t.reed ? 1 : 0, t.grass ? 1 : 0, t.tide ? 1 : 0].join(''))),
    b.tiles.map((r) => r.map((t) => [t.depth, t.reed ? 1 : 0, t.grass ? 1 : 0, t.tide ? 1 : 0].join('')))
  );
});

check('另开一局（新实例）布局仍相同，异 seed 布局不同', () => {
  const again = World.generateWorld(SEED);
  const other = World.generateWorld('DIFFERENT-SEED');
  assert.strictEqual(again.layoutHash, World.generateWorld(SEED).layoutHash);
  assert.notStrictEqual(again.layoutHash, other.layoutHash);
});

console.log('2) 自动航行胜利场景确定性');
const win1 = Auto.run(SEED, Auto.followerPolicy, 240 * 30 * 2);
const win2 = Auto.run(SEED, Auto.followerPolicy, 240 * 30 * 2);
check('两次自动运行均胜利', () => {
  assert.strictEqual(win1.status, 'won');
  assert.strictEqual(win2.status, 'won');
});
check('最终用时、终点位置、剩余燃料、路径逐点一致', () => {
  assert.strictEqual(win1.elapsed, win2.elapsed);
  assert.strictEqual(win1.fuelRemaining, win2.fuelRemaining);
  assert.strictEqual(win1.pathPoints, win2.pathPoints);
  assert.deepStrictEqual(win1.path, win2.path);
});
check('三个泥样全部采集且剩余目标为 0', () => {
  assert.strictEqual(win1.targetTotal, 3);
  assert.strictEqual(win1.samplesCollected, 3);
  assert.strictEqual(win1.samplesRemaining, 0);
});
check('在时限内返航且仍有燃料', () => {
  assert.ok(win1.elapsed < win1.timeLimit);
  assert.ok(win1.fuelRemaining > 0);
});

console.log('3) 失败场景（燃料耗尽）');
const failRun = Auto.run(SEED, Auto.wasterPolicy, 240 * 30 * 3);
check('浪费航线最终失败且记录失败原因', () => {
  assert.strictEqual(failRun.status, 'failed');
  assert.ok(failRun.failureReason && failRun.failureReason.length > 0);
  assert.ok(failRun.fuelRemaining === 0 || failRun.elapsed >= failRun.timeLimit);
});
const failRun2 = Auto.run(SEED, Auto.wasterPolicy, 240 * 30 * 3);
check('失败场景同样可复现（原因与用时一致）', () => {
  assert.strictEqual(failRun.status, failRun2.status);
  assert.strictEqual(failRun.failureReason, failRun2.failureReason);
  assert.strictEqual(failRun.elapsed, failRun2.elapsed);
});

console.log('4) 检查点恢复（不刷新页面）');
check('搁浅后调用 recover 回到检查点并扣除燃料，模拟可继续', () => {
  const s = Game.createGame(SEED);
  const w = s.world;
  let shallow = null;
  for (let ty = 0; ty < w.rows && !shallow; ty++) {
    for (let tx = 0; tx < w.cols; tx++) {
      const t = w.tiles[ty][tx];
      if (t.depth >= 0 && Game.effectiveDepth(t, s.time) < Game.DRAFT) {
        shallow = { x: tx + 0.5, y: ty + 0.5 };
        break;
      }
    }
  }
  assert.ok(shallow, '地图中应存在会导致搁浅的浅水/泥滩');
  let guard = 0;
  while (!s.grounded && guard < 6000 && s.status === 'running') {
    const desired = Math.atan2(shallow.y - s.boat.y, shallow.x - s.boat.x);
    let diff = desired - s.boat.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    Game.setInput(s, 'left', diff < -0.15);
    Game.setInput(s, 'right', diff > 0.15);
    Game.setInput(s, 'up', Math.abs(diff) < 1.0);
    Game.step(s);
    guard++;
  }
  assert.ok(s.grounded, '应能在驶向浅滩后触底搁浅');
  const before = { x: s.boat.x, y: s.boat.y, fuel: s.fuel };
  Game.recover(s);
  assert.ok(Math.abs(s.boat.x - before.x) > 0.5 || Math.abs(s.boat.y - before.y) > 0.5);
  assert.ok(s.fuel < before.fuel);
  assert.strictEqual(s.status, 'running');
  Game.setInput(s, 'left', false);
  Game.setInput(s, 'right', false);
  for (let i = 0; i < 30; i++) Game.step(s);
  assert.strictEqual(s.status, 'running');
});

console.log('5) 状态摘要字段与持久化');
check('摘要至少包含目标数量、剩余资源、最终用时与路径', () => {
  ['targetTotal', 'samplesCollected', 'samplesRemaining', 'fuelRemaining', 'fuelMax',
   'elapsed', 'timeLimit', 'failureReason', 'path', 'pathPoints', 'layoutHash'].forEach((k) => {
    assert.ok(Object.prototype.hasOwnProperty.call(win1, k), '缺少字段 ' + k);
  });
});

const outDir = path.join(__dirname, '..', 'artifacts');
const summaryPath = path.join(outDir, 'last-summary.json');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(summaryPath, JSON.stringify(win1, null, 2), 'utf8');
check('摘要写入 artifacts/last-summary.json', () => {
  const loaded = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.strictEqual(loaded.targetTotal, 3);
  assert.ok(loaded.fuelRemaining >= 0);
  assert.ok(loaded.elapsed > 0);
});

console.log('\n全部 ' + passed + ' 项检查通过。');
console.log('胜利摘要：用时 ' + win1.elapsed + 's，剩余燃料 ' + win1.fuelRemaining +
  '，路径点 ' + win1.pathPoints + '，布局哈希 ' + win1.layoutHash);
console.log('失败摘要：' + failRun.failureReason + '（' + failRun.elapsed + 's）');
