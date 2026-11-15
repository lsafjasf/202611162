import { CONFIG, STATUS } from './config.js';
import { pushEvent, setCheckpoint } from './helpers.js';

function strand(state, reason) {
  state.status = STATUS.STRANDED;
  state.endReason = reason;
  state.vehicle.speed = 0;
  state.prevDeploy = false;
  state.prevRecover = false;
  dropPole(state, '碰撞冲击导致一台测量设备脱落。');
  pushEvent(state, `${reason} 可从检查点恢复（按 R 或点击“检查点恢复”）。`, 'fail');
}

function dropPole(state, reason) {
  if (state.polesCarried <= 0) return;
  state.polesCarried -= 1;
  state.droppedPoles.push({
    x: state.vehicle.x + 26,
    y: state.vehicle.y + 26,
    t: state.elapsed
  });
  pushEvent(state, `${reason}（剩余携带 ${state.polesCarried} 杆）`, 'warn');
}

export function handleCollisions(state) {
  const v = state.vehicle;
  for (const rock of state.world.rocks) {
    const dx = v.x - rock.x;
    const dy = v.y - rock.y;
    const minDist = rock.radius + CONFIG.vehicleRadius;
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) continue;

    const impact = Math.abs(v.speed);
    const nx = dist > 0 ? dx / dist : 1;
    const ny = dist > 0 ? dy / dist : 0;
    v.x = rock.x + nx * minDist;
    v.y = rock.y + ny * minDist;

    if (impact >= CONFIG.collisionStrandSpeed) {
      strand(state, `高速撞上岩台（${Math.round(impact)} px/s），车辆搁浅。`);
      return;
    }
    v.speed = -v.speed * 0.32;
    if (!state.flash.rock) pushEvent(state, '低速擦碰岩台，车辆被弹开。', 'warn');
    state.flash.rock = 0.25;
  }

  pickUpDroppedPoles(state);
}

function pickUpDroppedPoles(state) {
  const v = state.vehicle;
  const before = state.droppedPoles.length;
  state.droppedPoles = state.droppedPoles.filter((pole) => {
    if (Math.hypot(v.x - pole.x, v.y - pole.y) > CONFIG.pickupRange) return true;
    state.polesCarried += 1;
    state.timeLeft = Math.max(0, state.timeLeft - 2);
    state.elapsed += 2;
    pushEvent(state, '回收一台脱落设备，耗时 2 秒。', 'good');
    return false;
  });
  if (state.droppedPoles.length !== before) state.flash.pickup = 0.25;
}

export function deployPole(state) {
  const v = state.vehicle;
  const target = state.targets.find((item) => !item.polePlaced
    && Math.hypot(v.x - item.x, v.y - item.y) <= CONFIG.targetRange);
  if (!target) {
    state.flash.deploy = 0.25;
    return;
  }
  if (state.polesCarried <= 0) {
    pushEvent(state, '没有可用测量杆，先回收脱落设备。', 'warn');
    state.flash.deploy = 0.25;
    return;
  }
  state.polesCarried -= 1;
  target.polePlaced = true;
  state.flash.deploy = 0.25;
  pushEvent(state, `测点 ${target.id} 布置完成。`, 'good');
  setCheckpoint(state);
}

export function calibrate(state, dt) {
  const near = state.world.landmarks.some((mark) => Math.hypot(
    state.vehicle.x - mark.x, state.vehicle.y - mark.y
  ) <= CONFIG.calibrationRange);
  state.compass.calibrating = near;
  if (!near) {
    state.compass.progress = 0;
    state.flash.calibrate = 0.2;
    return;
  }
  state.compass.progress = Math.min(1, state.compass.progress + dt / CONFIG.calibrateTime);
  state.flash.calibrate = 0.2;
  if (state.compass.progress >= 1) {
    state.compass.error = CONFIG.calibrationError;
    state.compass.progress = 0;
    pushEvent(state, '罗盘校准完成，方位误差显著降低。', 'good');
  }
}

export function recover(state) {
  if (state.status !== STATUS.STRANDED && state.status !== STATUS.DRIVING) return;
  if (state.recoverCooldown > 0) {
    state.flash.recover = 0.2;
    return;
  }
  const cp = state.checkpoint;
  if (!cp) return;
  state.vehicle.x = cp.x;
  state.vehicle.y = cp.y;
  state.vehicle.angle = cp.angle;
  state.vehicle.speed = 0;
  state.vehicle.steering = 0;
  state.fuel = Math.max(0, cp.fuel - CONFIG.recoverFuelCost);
  state.polesCarried = cp.polesCarried;
  state.targets = cp.targets.map((t) => ({ ...t }));
  state.elapsed += CONFIG.recoverTimeCost;
  state.timeLeft = Math.max(0, CONFIG.timeLimit - state.elapsed);
  state.recoverCooldown = CONFIG.recoverCooldown;
  state.status = STATUS.DRIVING;
  state.endReason = '';
  state.flash.recover = 0.3;
  pushEvent(state, `已从检查点恢复：耗油 ${CONFIG.recoverFuelCost}，耗时 ${CONFIG.recoverTimeCost} 秒。`, 'warn');
  if (state.fuel <= 0) {
    state.status = STATUS.FAILED;
    state.endReason = '检查点恢复后燃料不足，任务失败。';
  }
}

export function buildSummary(state) {
  const placed = state.targets.filter((t) => t.polePlaced).length;
  const targetList = state.targets.map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    polePlaced: t.polePlaced
  }));
  return {
    seed: state.seed,
    layoutFingerprint: state.world.fingerprint,
    status: state.status,
    endReason: state.endReason,
    elapsed: Number(state.elapsed.toFixed(2)),
    timeLimit: CONFIG.timeLimit,
    timeLeft: Number(state.timeLeft.toFixed(2)),
    fuelLeft: Number(Math.min(CONFIG.fuelMax, state.fuel).toFixed(2)),
    fuelMax: CONFIG.fuelMax,
    targetsTotal: state.targets.length,
    targetsCompleted: placed,
    polesCarried: state.polesCarried,
    droppedPolesRemaining: state.droppedPoles.length,
    pathPoints: state.path.length,
    targets: targetList,
    camp: { x: state.world.camp.x, y: state.world.camp.y }
  };
}
