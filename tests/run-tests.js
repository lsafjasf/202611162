import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, stepGame, restartGame, pauseGame, resumeGame, buildSummary } from '../src/engine.js';
import { CONFIG, STATUS } from '../src/config.js';
import { makeBot, nextObjective, runUntil } from './bot.js';

const here = dirname(fileURLToPath(import.meta.url));
const artifactDir = join(here, '..', 'artifacts');
mkdirSync(artifactDir, { recursive: true });

let passed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

function snapshot(state) {
  return {
    fp: state.world.fingerprint,
    targets: state.targets.map((t) => [t.x, t.y]),
    rocks: state.world.rocks.map((r) => [r.x, r.y, r.radius]),
    landmarks: state.world.landmarks.map((m) => [m.x, m.y]),
    terrain: state.world.terrain.join('')
  };
}

function drive(state, input, dt = 1 / 30) {
  return stepGame(state, dt, input);
}

console.log('1) 固定 seed 的布局与运行确定性');
{
  const a = createGame(20261116);
  const b = createGame(20261116);
  assert(JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b)), '同 seed 的两个新局布局完全一致');
  assert(a.world.fingerprint.length === 8, '布局指纹存在且为 8 位十六进制');

  const c = createGame(99);
  assert(JSON.stringify(snapshot(c)) !== JSON.stringify(snapshot(a)), '不同 seed 产生不同布局');

  for (let i = 0; i < 120; i += 1) drive(a, { accelerate: true, right: i % 2 === 0 });
  for (let i = 0; i < 120; i += 1) drive(b, { accelerate: true, right: i % 2 === 0 });
  assert(
    Math.abs(a.vehicle.x - b.vehicle.x) < 1e-9 && Math.abs(a.vehicle.y - b.vehicle.y) < 1e-9,
    '相同输入序列后车辆位置逐帧一致'
  );

  const windA = createGame(777);
  const windB = createGame(777);
  const seriesA = [];
  const seriesB = [];
  for (let i = 0; i < 180; i += 1) {
    stepGame(windA, 1 / 30, {});
    stepGame(windB, 1 / 30, {});
    seriesA.push(Number(windA.wind.strength.toFixed(6)));
    seriesB.push(Number(windB.wind.strength.toFixed(6)));
  }
  assert(
    seriesA.some((value) => value > 0.1),
    '强风会在模拟中实际产生并驱动沙尘/声音'
  );
  assert(
    JSON.stringify(seriesA) === JSON.stringify(seriesB)
      && Math.abs(windA.wind.angle - windB.wind.angle) < 1e-12,
    '同 seed 的风力强度与风向序列完全一致'
  );

  const cal = createGame(4242);
  cal.vehicle.x = cal.world.landmarks[0].x;
  cal.vehicle.y = cal.world.landmarks[0].y;
  cal.compass.error = CONFIG.maxCompassError;
  for (let i = 0; i < Math.ceil(CONFIG.calibrateTime * 30); i += 1) {
    stepGame(cal, 1 / 30, { calibrate: true });
  }
  assert(cal.compass.error <= CONFIG.calibrationError + 1e-9, '靠近地标按住 C 后罗盘误差降到校准值');
  cal.vehicle.x = 100;
  cal.vehicle.y = 100;
  stepGame(cal, 1 / 30, { calibrate: true });
  assert(cal.compass.calibrating === false && cal.compass.progress === 0, '离开地标范围后无法校准');
}

console.log('2) 自动驾驶完成三个测点并返回营地');
CONFIG.noWind = true;
let winGame;
{
  const state = createGame(20261116);
  const dt = 1 / 30;
  const bot = makeBot();
  let guard = 0;
  while (state.status === STATUS.DRIVING && guard < 240 * 30) {
    const input = bot.choose(state, nextObjective(state));
    const target = state.targets.find((t) => !t.polePlaced);
    if (target && Math.hypot(state.vehicle.x - target.x, state.vehicle.y - target.y) <= CONFIG.targetRange) {
      input.deploy = true;
    }
    stepGame(state, dt, input);
    guard += 1;
  }
  winGame = state;
  assert(state.status === STATUS.WON, `最终状态为胜利（实际：${state.status}）`);
  assert(state.targets.every((t) => t.polePlaced), '三个测点全部布置测量杆');
  assert(state.targets.length === 3, '目标数量为 3 并在摘要中可核对');
  assert(state.elapsed < CONFIG.timeLimit, `最终用时 ${state.elapsed.toFixed(1)}s 小于时限`);
  assert(state.fuel > 0 && state.fuel <= CONFIG.fuelMax, '仍有剩余燃料且未超出上限');
  assert(state.path.length > 10, '记录了完整行驶路径');

  const summary = buildSummary(state);
  assert(summary.targetsTotal === 3 && summary.targetsCompleted === 3, '摘要核对目标数量 3/3');
  assert(typeof summary.fuelLeft === 'number' && typeof summary.elapsed === 'number', '摘要含剩余资源与最终用时');
  writeFileSync(join(artifactDir, 'summary-win.json'), JSON.stringify(summary, null, 2));
}

console.log('3) 超时失败场景与失败摘要');
{
  const state = createGame(20261116);
  state.fuel = 100000;
  let guard = 0;
  while (state.status === STATUS.DRIVING && guard < CONFIG.timeLimit * 30 + 5) {
    stepGame(state, 1 / 30, { accelerate: true, left: true });
    guard += 1;
  }
  assert(state.status === STATUS.FAILED, '超时后状态为失败');
  assert(state.timeLeft === 0, '剩余时间归零');
  assert(/超时/.test(state.endReason), '失败原因明确写入 endReason');
  const summary = buildSummary(state);
  assert(summary.status === 'failed' && summary.endReason === state.endReason, '失败摘要带失败原因');
  assert(summary.targetsCompleted < 3, '失败时未完成全部目标，且数量可核对');
  writeFileSync(join(artifactDir, 'summary-fail.json'), JSON.stringify(summary, null, 2));
}

console.log('4) 高速碰撞搁浅 -> 检查点恢复（不刷新页面）');
{
  const state = createGame(20261116);
  const rock = state.world.rocks
    .map((r) => ({ r, d: Math.hypot(r.x - state.vehicle.x, r.y - state.vehicle.y) }))
    .sort((a, b) => a.d - b.d)[0].r;
  const dt = 1 / 30;
  for (let i = 0; i < 360 && state.status === STATUS.DRIVING; i += 1) {
    const desired = Math.atan2(rock.y - state.vehicle.y, rock.x - state.vehicle.x);
    let diff = desired - state.vehicle.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const input = { accelerate: true };
    if (diff > 0.05) input.right = true;
    if (diff < -0.05) input.left = true;
    stepGame(state, dt, input);
  }
  assert(state.status === STATUS.STRANDED, '高速撞击岩台后搁浅');
  assert(state.droppedPoles.length === 1, '碰撞掉落一台设备');
  const cp = { ...state.checkpoint };
  const before = { x: state.vehicle.x, y: state.vehicle.y };
  stepGame(state, dt, { accelerate: true });
  assert(state.status === STATUS.STRANDED && state.vehicle.x === before.x, '搁浅状态下油门无法移动');
  stepGame(state, dt, { recover: true });
  assert(state.status === STATUS.DRIVING, '按 R 后从检查点恢复为行驶状态');
  assert(Math.hypot(state.vehicle.x - cp.x, state.vehicle.y - cp.y) < 1e-9, '车辆回到检查点坐标');
  assert(state.elapsed >= cp.elapsed + CONFIG.recoverTimeCost, '恢复计入 5 秒耗时');
  assert(state.fuel <= cp.fuel - CONFIG.recoverFuelCost + 1e-9, '恢复扣除 6 点燃料');

  const pole = state.droppedPoles[0];
  state.vehicle.x = pole.x - 8;
  state.vehicle.y = pole.y;
  const carriedBeforePickup = state.polesCarried;
  stepGame(state, dt, {});
  assert(state.droppedPoles.length === 0, '驶近后回收掉落设备');
  assert(state.polesCarried === carriedBeforePickup + 1, '回收后测量杆数量 +1');
}

console.log('5) 暂停、重开与再次新局的同布局校验');
{
  const state = createGame(20261116);
  stepGame(state, 1 / 30, { accelerate: true });
  const movingPos = { x: state.vehicle.x, y: state.vehicle.y };
  pauseGame(state);
  assert(state.status === STATUS.PAUSED, '暂停生效');
  stepGame(state, 1 / 30, { accelerate: true });
  assert(state.vehicle.x === movingPos.x && state.vehicle.y === movingPos.y, '暂停期间世界冻结');
  resumeGame(state);
  assert(state.status === STATUS.DRIVING, '继续后恢复行驶');

  const fpBefore = state.world.fingerprint;
  restartGame(state);
  assert(state.world.fingerprint === fpBefore, '重开后同一 seed 布局指纹不变');
  assert(state.elapsed === 0 && state.fuel === CONFIG.fuelMax, '重开后时间与燃料重置');

  const another = createGame(20261116);
  assert(another.world.fingerprint === state.world.fingerprint, '另开一次新局验证布局相同');
  assert(
    JSON.stringify(another.world.rocks) === JSON.stringify(state.world.rocks),
    '岩石等关键对象位置逐值一致'
  );
}

console.log(`\n全部通过：${passed} 条断言。摘要已写入 artifacts/summary-win.json 与 artifacts/summary-fail.json`);
