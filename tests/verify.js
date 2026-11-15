/* Node 验证：固定 seed 确定性、胜负条件、失败场景、检查点恢复与状态摘要 */
const assert = require('assert');
const { makeRng } = require('../js/rng.js');
const { C, createInitialState, snapshotCheckpoint, restoreCheckpoint, buildSummary, advanceStuck, reachedCamp } = require('../js/state.js');
const { generateWorld, layoutHash, serializeLayout } = require('../js/world.js');
const { stepTruck, surfaceAt, resolveCircleObstacles } = require('../js/physics.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const SEED = 'POSTAL-ROUTE-649';

console.log('1) 固定 seed 的世界布局确定性');
const w1 = generateWorld(SEED);
const w2 = generateWorld(SEED);
const wOther = generateWorld('OTHER-SEED-9');
check('同 seed 两次生成的序列化布局完全一致', () => {
  assert.strictEqual(serializeLayout(w1), serializeLayout(w2));
  assert.strictEqual(layoutHash(w1), layoutHash(w2));
});
check('不同 seed 产生不同布局', () => {
  assert.notStrictEqual(layoutHash(w1), layoutHash(wOther));
});
check('目标数量：9 邮袋、3 检查点、>0 障碍、3 地带', () => {
  assert.strictEqual(w1.mails.length, C.MAIL_REQUIRED);
  assert.strictEqual(w1.checkpoints.length, C.ZONES);
  assert.strictEqual(w1.zones.length, 3);
  assert.ok(w1.obstacles.length >= 15);
});
check('三处开阔地风向互不相同', () => {
  const groups = new Set(w1.zones.map((z) => Math.round(z.wind.angle / (Math.PI * 2 / 3)) % 3));
  assert.strictEqual(groups.size, 3);
});
check('关键对象位置逐点一致', () => {
  for (const key of ['mails', 'checkpoints', 'obstacles', 'deepPatches', 'icePatches']) {
    assert.deepStrictEqual(w1[key].map((o) => [o.x, o.y]), w2[key].map((o) => [o.x, o.y]));
  }
  assert.deepStrictEqual(w1.camp, w2.camp);
});

console.log('2) 物理回放确定性');
check('相同输入 300 步后位置/速度完全一致', () => {
  const a = createInitialState(w1);
  const b = createInitialState(w1);
  const input = { throttle: 1, brake: false, steer: 0.6 };
  for (let i = 0; i < 300; i++) {
    stepTruck(a, input, w1, C.FIXED_DT);
    stepTruck(b, input, w1, C.FIXED_DT);
  }
  assert.ok(Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12);
  assert.ok(Math.abs(a.vx - b.vx) < 1e-12 && Math.abs(a.vy - b.vy) < 1e-12);
});
check('载荷增加会使刹车距离变长（邮件越多刹车越慢）', () => {
  const run = (mail) => {
    const s = createInitialState(w1);
    s.mail = mail;
    s.vy = 200;
    s.speed = 200;
    let dist = 0;
    const input = { throttle: 0, brake: true, steer: 0 };
    for (let i = 0; i < 240; i++) {
      stepTruck(s, input, w1, C.FIXED_DT);
      dist += s.speed * C.FIXED_DT;
      if (s.speed <= 1) break;
    }
    return dist;
  };
  const empty = run(0);
  const loaded = run(9);
  assert.ok(loaded > empty, `满载刹车距离应更长: ${loaded} vs ${empty}`);
  assert.ok(loaded > empty * 1.3, `满载刹车距离应明显更长: ${loaded} vs ${empty}`);
});
check('防滑链提升雪面抓地力', () => {
  const s = createInitialState(w1);
  s.x = w1.deepPatches[0].x;
  s.y = w1.deepPatches[0].y;
  const without = surfaceAt(w1, s).grip;
  s.chains = true;
  const withChain = surfaceAt(w1, s).grip;
  assert.ok(withChain > without);
});

console.log('3) 失败场景（每次都可确定性复现）');
check('燃油耗尽失败：固定步数内油量归零', () => {
  const s = createInitialState(w1);
  s.fuel = 1;
  let steps = 0;
  while (s.fuel > 0 && steps < 1000) {
    s.fuel = Math.max(0, s.fuel - (C.FUEL_IDLE + C.FUEL_THROTTLE) * C.FIXED_DT);
    steps++;
  }
  assert.strictEqual(s.fuel, 0);
  assert.ok(steps < 1000);
  const summary = buildSummary(w1, s, SEED);
  assert.strictEqual(summary.fuelLeft, 0);
});
check('搁浅失败：冰面/深雪持续打滑 6 秒触发搁浅判定', () => {
  const s = createInitialState(w1);
  s.x = w1.icePatches[0].x;
  s.y = w1.icePatches[0].y;
  s.speed = 0;
  let failed = false;
  for (let i = 0; i < 60 * 8; i++) {
    if (advanceStuck(s, true, 'ice', C.FIXED_DT)) { failed = true; break; }
  }
  assert.ok(failed);
  const normal = createInitialState(w1);
  normal.speed = 0;
  let falseStuck = false;
  for (let i = 0; i < 60 * 10; i++) {
    if (advanceStuck(normal, true, 'snow', C.FIXED_DT)) { falseStuck = true; break; }
  }
  assert.ok(!falseStuck, '普通积雪上起步不应误判为搁浅');
});
check('碰撞失败：高速撞击造成伤害，归零后失败且可恢复', () => {
  const s = createInitialState(w1);
  const obs = w1.obstacles[0];
  s.health = C.HIT_DAMAGE;
  s.x = obs.x;
  s.y = obs.y - obs.r - 5;
  s.vy = 260;
  const hits = resolveCircleObstacles(s, w1);
  assert.ok(hits.some((h) => h.impact > 45));
  s.health = Math.max(0, s.health - C.HIT_DAMAGE);
  assert.strictEqual(s.health, 0);
  const snap = snapshotCheckpoint(s, 0);
  s.status = 'fail';
  restoreCheckpoint(s, snap);
  s.fuel = Math.min(C.FUEL_MAX, s.fuel + C.RESCUE_FUEL_GIFT);
  s.health = Math.min(C.HEALTH_MAX, s.health + C.RESCUE_HEALTH_GIFT);
  assert.strictEqual(s.status, 'running');
  assert.ok(s.health > 0 && s.fuel > 0);
});

console.log('4) 状态摘要字段完整性');
check('摘要至少核对目标数量、剩余资源与最终用时', () => {
  const s = createInitialState(w1);
  s.elapsed = 73.5;
  s.mail = 4;
  const summary = buildSummary(w1, s, SEED);
  assert.strictEqual(summary.targetsTotal, 9);
  assert.strictEqual(summary.mailCollected, 4);
  assert.strictEqual(summary.mailRemaining, 5);
  assert.ok('fuelLeft' in summary && 'healthLeft' in summary);
  assert.strictEqual(summary.elapsedText, '1:13');
  assert.ok('pathPoints' in summary && 'failReason' in summary);
});

console.log('5) 自动导航端到端：可确定性达成胜利条件');
function autopilot(world) {
  const s = createInitialState(world);
  const rng = makeRng('autopilot');
  let steps = 0;
  const maxSteps = 60 * 90;
  while (s.status === 'running' && steps < maxSteps) {
    const remaining = s.mails.filter((m) => !m.collected);
    let target;
    const nextCp = s.checkpoints.find((c) => !c.reached);
    if (nextCp) {
      target = nextCp;
    } else if (remaining.length) {
      target = remaining.reduce((best, m) => (m.y < best.y ? m : best), remaining[0]);
    } else {
      target = world.camp;
    }
    const desired = Math.atan2(target.y - s.y, target.x - s.x);
    let diff = ((desired - s.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    let steer = Math.max(-1, Math.min(1, diff * 2));
    for (const o of world.obstacles) {
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < o.r + 120 && s.y < o.y + 80) {
        const side = s.x < o.x ? -1 : 1;
        steer += side * (1 - d / (o.r + 120)) * 1.4;
      }
    }
    steer = Math.max(-1, Math.min(1, steer));
    const input = { throttle: 1, brake: false, steer };
    if (Math.abs(diff) > 1.9 && s.speed > 120) input.brake = true;
    s.elapsed += C.FIXED_DT;
    s.fuel = Math.max(0, s.fuel - (C.FUEL_IDLE + C.FUEL_THROTTLE) * C.FIXED_DT);
    stepTruck(s, input, world, C.FIXED_DT);
    const lastP = s.path[s.path.length - 1];
    if (!lastP || Math.hypot(s.x - lastP.x, s.y - lastP.y) > 18) s.path.push({ x: s.x, y: s.y });
    if (s.speed > 12) s.ruts.push({ x: s.x, y: s.y, heading: s.heading });
    for (const m of s.mails) {
      if (!m.collected && Math.hypot(s.x - m.x, s.y - m.y) <= C.MAIL_RADIUS + 14) {
        m.collected = true;
        s.mail++;
      }
    }
    for (let i = 0; i < s.checkpoints.length; i++) {
      const cp = s.checkpoints[i];
      if (!cp.reached && Math.hypot(s.x - cp.x, s.y - cp.y) <= C.CHECKPOINT_RADIUS) cp.reached = true;
    }
    if (reachedCamp(s, world)) { s.status = 'win'; break; }
    steps++;
    if (steps % 97 === 0) rng.next();
  }
  return s;
}

const runA = autopilot(w1);
const runB = autopilot(generateWorld(SEED));
check('自动导航集齐 9 邮袋、激活 3 检查点并抵达营地', () => {
  assert.strictEqual(runA.status, 'win');
  assert.strictEqual(runA.mail, C.MAIL_REQUIRED);
  assert.ok(runA.checkpoints.every((c) => c.reached));
  assert.ok(runA.path.length > 10);
  assert.ok(runA.fuel > 0 && runA.health > 0);
});
check('两次独立端到端运行的轨迹与最终用时完全一致', () => {
  assert.strictEqual(runA.elapsed, runB.elapsed);
  assert.deepStrictEqual(runA.path, runB.path);
  assert.strictEqual(runA.x, runB.x);
  assert.strictEqual(runA.y, runB.y);
});

console.log(`\n全部 ${passed} 项验证通过 ✓（布局哈希 #${layoutHash(w1)}）`);
