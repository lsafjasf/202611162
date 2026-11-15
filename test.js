/* 确定性验证：固定 seed 下重复运行，布局与胜负条件必须一致。 */
'use strict';
const G = require('./game.js');

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
  if (!cond) failures++;
}

/* 1. 同一 seed 两次生成世界，布局完全一致 */
const w1 = G.createWorld(G.SEED);
const w2 = G.createWorld(G.SEED);
check('世界布局哈希一致', G.layoutHash(w1) === G.layoutHash(w2), G.layoutHash(w1));
check('目标环坐标一致', JSON.stringify(w1.rings) === JSON.stringify(w2.rings));
check('岩柱坐标一致', JSON.stringify(w1.rocks) === JSON.stringify(w2.rocks));
check('风带参数一致', JSON.stringify(w1.windBands) === JSON.stringify(w2.windBands));

/* 2. “另开新局”布局相同 */
const newGame = G.createWorld(G.SEED);
check('新局布局哈希相同', G.layoutHash(newGame) === G.layoutHash(w1));

/* 3. 自动驾驶脚本：同一输入序列跑两次，结果逐位一致 */
function autopilot(world, s) {
  const nextRing = world.rings.find(r => r.x > s.x + 30);
  const rw = world.runway;
  const onFinal = s.x > rw.x - 2500;
  const ground = world.groundAt(s.x);
  const band = G.bandAt(world, s.y);
  const relVx = s.vx - band.speed * band.dir;
  // 优先级：地形逃逸 > 速度恢复 > 进近 > 追环 > 避障 > 最佳滑翔
  let targetVy;
  if (!onFinal && s.y < ground + 60) {
    targetVy = 3; // 地形逃逸
  } else if (s.vx < 17) {
    targetVy = -3; // 速度恢复：温和俯冲（最佳滑翔速度附近）
  } else if (onFinal) {
    const targetY = rw.y + Math.max(0, (rw.x + 180 - s.x) * 0.14);
    targetVy = Math.max(-10, Math.min(1, (targetY - s.y) * 0.1)); // 进近不爬升
    if (s.y < rw.y + 40) targetVy = Math.max(targetVy, -5); // 拉平
  } else if (nextRing && nextRing.x - s.x < 900 && nextRing.y < s.y + 60) {
    targetVy = Math.max(-8, Math.min(4, (nextRing.y - s.y) * 0.1));
  } else {
    targetVy = -1.5; // 最佳滑翔
    for (const rock of world.rocks) {
      const dx = rock.x - s.x;
      if (dx > 0 && dx < 1000) {
        const top = world.groundAt(rock.x) + rock.h + 60;
        if (s.y < top) targetVy = Math.max(targetVy, Math.min(3, (top - s.y) * 0.05));
      }
    }
    if (s.y < ground + 110) targetVy = Math.max(targetVy, Math.min(2, (ground + 110 - s.y) * 0.05));
  }
  // 积分项消除稳态误差（挂在状态上，仍是确定性仿真的一部分）
  s._apI = Math.max(-0.15, Math.min(0.15, (s._apI || 0) + (targetVy - s.vy) * G.DT * 0.1));
  // 跟踪航迹角：俯仰跟随飞行路径，避免大迎角失速
  let pitchTarget = Math.atan2(targetVy, Math.max(10, s.vx)) + 0.12;
  pitchTarget += (targetVy - s.vy) * 0.04 + s._apI; // 垂直速度反馈 + 积分
  if (onFinal && s.x > rw.x - 600 && s.vx > 20) pitchTarget += 0.22; // 近跑道减速
  pitchTarget = Math.max(-0.5, Math.min(0.38, pitchTarget));
  const pitch = (pitchTarget - s.pitch) * 6;
  return {
    pitch: Math.max(-1, Math.min(1, pitch)),
    wingsToggle: false,
    dropBallast: s.ballast > 0 && s.stalled,
  };
}

function runFlight(world) {
  const s = G.createState(world);
  const inputLog = [];
  let respawns = 0;
  for (let i = 0; i < 60 * 600 && s.status === 'flying'; i++) {
    const input = autopilot(world, s);
    inputLog.push(input);
    G.step(world, s, input, G.DT);
    if (s.status === 'dead' && s.checkpoint && respawns < 3) {
      G.respawnAtCheckpoint(s);
      respawns++;
    }
  }
  return { summary: G.buildSummary(world, s), inputLog };
}

const runA = runFlight(w1);
const runB = runFlight(w2);
const keyOf = (r) => JSON.stringify({
  targets: r.summary.targets, ballast: r.summary.ballastLeft,
  time: r.summary.timeSec, result: r.summary.result,
  fail: r.summary.failReason, path: r.summary.path,
});
check('重复运行胜负条件一致', runA.summary.result === runB.summary.result, runA.summary.result);
check('重复运行关键状态逐位一致', keyOf(runA) === keyOf(runB));

/* 4. 摘要字段齐全：目标数量 / 剩余资源 / 最终用时 */
const sm = runA.summary;
check('摘要含目标数量', sm.targets.total === G.WORLD.ringCount && sm.targets.hit >= 0,
  `${sm.targets.hit}/${sm.targets.total}`);
check('摘要含剩余压舱', typeof sm.ballastLeft === 'number', `left=${sm.ballastLeft}`);
check('摘要含最终用时', sm.timeSec > 0, `${sm.timeSec}s`);
check('摘要含路径点', sm.path.length > 10, `${sm.path.length} pts`);

/* 5. 失败场景可复现：持续满杆拉杆 → 失速坠地，两次结果一致 */
function runStall(world) {
  const s = G.createState(world);
  for (let i = 0; i < 60 * 600 && s.status === 'flying'; i++) {
    G.step(world, s, { pitch: 1, wingsToggle: false, dropBallast: false }, G.DT);
  }
  return G.buildSummary(world, s);
}
const f1 = runStall(w1);
const f2 = runStall(w2);
check('失败场景触发（失速/坠地）', f1.result === '失败' && !!f1.failReason, f1.failReason);
check('失败场景两次一致', f1.failReason === f2.failReason && f1.timeSec === f2.timeSec);

/* 6. 检查点恢复不依赖刷新：状态内复活后继续推进 */
{
  const s = G.createState(w1);
  for (let i = 0; i < 60 * 120 && !s.checkpoint; i++) {
    G.step(w1, s, autopilot(w1, s), G.DT);
  }
  check('自动驾驶可到达检查点', !!s.checkpoint, s.checkpoint ? `ring#${s.checkpoint.ringId}` : 'none');
  const cpX = s.checkpoint ? s.checkpoint.x : 0;
  s.status = 'dead'; s.failReason = '测试：模拟坠毁';
  G.respawnAtCheckpoint(s);
  check('检查点恢复后回到飞行状态', s.status === 'flying' && Math.abs(s.x - cpX) < 1);
}

console.log(`\n结果: ${runA.summary.result} | 目标 ${sm.targets.hit}/${sm.targets.total}` +
  ` | 剩余压舱 ${sm.ballastLeft} | 用时 ${sm.timeSec}s | 布局 #${sm.layout}`);
if (failures) { console.error(`${failures} 项失败`); process.exit(1); }
console.log('全部确定性检查通过');
