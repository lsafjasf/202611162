import {
  DEFAULT_SEED,
  generateWorld,
  currentAt,
  waterAt,
  obstacleBottomAt,
  hazardAt,
  distanceToWarehouse,
  formatDistance,
  hashString,
} from "./world.js";

export const BATTERY_CAPACITY = 100;
export const CHECKPOINT_VERSION = 1;
export const SUMMARY_VERSION = 1;
export const FIXED_STEP = 1 / 60;

const CARGO_POSITIONS = [-56, 0, 56];
const RAFT_WIDTH = 104;
const TILT_WARNING = (12 * Math.PI) / 180;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function emptyInput() {
  return {
    left: false,
    right: false,
    trimLeft: false,
    trimRight: false,
    rackUp: false,
    rackDown: false,
    brake: false,
  };
}

function initialCargo(world) {
  return world.crates.map((crate) => ({
    ...crate,
    collected: false,
  }));
}

function initialCells(world) {
  return world.pickups.map((cell) => ({ ...cell, collected: false }));
}

function initialRaft(world) {
  return {
    x: world.startX,
    y: waterAt(world, world.startX) - 5,
    vx: 0,
    tilt: 0,
    trim: 0,
    rack: 0.52,
    heading: 0,
    bob: 0,
  };
}

export function createRun(worldOrSeed = DEFAULT_SEED) {
  const world =
    typeof worldOrSeed === "number" ? generateWorld(worldOrSeed) : worldOrSeed;
  const run = {
    version: CHECKPOINT_VERSION,
    world,
    status: "ready",
    time: 0,
    battery: BATTERY_CAPACITY,
    raft: initialRaft(world),
    cargo: initialCargo(world),
    cells: initialCells(world),
    delivered: 0,
    collisions: 0,
    collisionCooldown: 0,
    pickupTimer: 0,
    dockTimer: 0,
    strandingTimer: 0,
    pickupCargoId: null,
    currentZone: currentAt(world, world.startX),
    currentForce: 0,
    checkpointIds: [],
    lastCheckpoint: null,
    path: [{ x: world.startX, y: waterAt(world, world.startX), time: 0, state: "ready" }],
    collisionLog: [],
    failureReason: null,
    failureCause: null,
    finalSummary: null,
    stats: {
      thrustSeconds: 0,
      distance: 0,
      cellsUsed: 0,
      batterySpent: 0,
      ceilingHits: 0,
      maxTilt: 0,
    },
    eventCooldowns: {},
    telemetry: {},
  };
  return run;
}

export function startRun(run) {
  if (run.status === "ready" || run.status === "paused") {
    run.status = "playing";
  }
  if (!run.lastCheckpoint) {
    const first = run.world.checkpoints[0];
    if (first) {
      const snapshot = captureCheckpoint(run, first);
      run.checkpointIds.push(first.id);
      run.lastCheckpoint = snapshot;
    }
  }
  return run;
}

function carriedCargo(run) {
  return run.cargo.filter((crate) => crate.collected);
}

function loadMass(run) {
  return carriedCargo(run).reduce((sum, crate) => sum + crate.mass, 0);
}

function centerOfMass(run) {
  const cargo = carriedCargo(run);
  const mass = cargo.reduce((sum, crate) => sum + crate.mass, 0);
  if (mass <= 0) {
    return 0;
  }
  const weighted = cargo.reduce(
    (sum, crate) => sum + crate.mass * CARGO_POSITIONS[crate.slot + 1],
    0,
  );
  return weighted / mass + run.raft.trim;
}

function cargoTopAt(run, x, time) {
  const cargo = carriedCargo(run);
  if (cargo.length === 0) {
    return waterAt(run.world, x) - 48;
  }
  const deck = 14 + run.raft.rack * 78;
  const tiltLift = Math.abs(Math.sin(run.raft.tilt + time * 1.2)) * 12;
  return waterAt(run.world, x) - deck - 28 - tiltLift;
}

function currentFactor(run, time) {
  const zone = run.currentZone;
  if (!zone || zone.force === 0) {
    return 0;
  }
  return zone.force * (1 + Math.sin(time * 0.8 + zone.phase) * zone.wave);
}

function clearanceAt(run, x = run.raft.x) {
  const top = cargoTopAt(run, x, run.time);
  const bottom = obstacleBottomAt(run.world, x);
  return top - bottom;
}

function abcsofTilt(run) {
  const mass = loadMass(run);
  const com = centerOfMass(run);
  const target =
    clamp(com / 48, -1, 1) * 0.45 +
    run.currentForce * 0.0024 +
    Math.sin(run.time * 1.1) * 0.008;
  const safeTarget = mass > 0 ? target : run.currentForce * 0.0016;
  return clamp(safeTarget, -0.31, 0.31);
}

function eventKey(run, key, duration = 0.8) {
  run.eventCooldowns[key] = Math.max(
    run.eventCooldowns[key] || 0,
    run.time + duration,
  );
}

export function stepRun(run, input = emptyInput(), dt = FIXED_STEP) {
  const events = [];
  if (run.status !== "playing") {
    return events;
  }
  const step = clamp(dt, 0, 0.05);
  run.time += step;

  const { raft, world } = run;
  const previousX = raft.x;
  const thrust =
    (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const mass = loadMass(run);
  const cargoCount = carriedCargo(run).length;

  if (input.trimLeft) {
    raft.trim = clamp(raft.trim - 31 * step, -42, 42);
  }
  if (input.trimRight) {
    raft.trim = clamp(raft.trim + 31 * step, -42, 42);
  }
  if (input.rackUp) {
    raft.rack = clamp(raft.rack + 0.48 * step, 0, 1);
  }
  if (input.rackDown) {
    raft.rack = clamp(raft.rack - 0.55 * step, 0, 1);
  }

  run.currentZone = currentAt(world, raft.x);
  run.currentForce = currentFactor(run, run.time);
  const inShallow =
    raft.x >= world.hazards.shallow.start &&
    raft.x <= world.hazards.shallow.end;

  const currentSensitivity = 1 + Math.abs(raft.tilt) * 1.1 + (1 - raft.rack) * 0.32;
  const baseAcceleration =
    (thrust * 92) / (1 + mass * 0.21) +
    run.currentForce * 0.62 * currentSensitivity;
  const drag = 0.51 + mass * 0.012 + (1 - raft.rack) * 0.16;
  raft.vx += (baseAcceleration - raft.vx * drag) * step;

  if (input.brake) {
    raft.vx *= Math.max(0, 1 - 3.8 * step);
  }
  if (inShallow) {
    raft.vx *= Math.max(0, 1 - 0.9 * step);
  }
  if (absTiltWarning(run) && cargoCount > 0) {
    raft.vx *= Math.max(0, 1 - 0.22 * step);
  }

  raft.vx = clamp(raft.vx, -115, 194);
  raft.x = clamp(raft.x + raft.vx * step, 62, world.warehouse.x + 34);
  run.stats.distance += Math.abs(raft.x - previousX);
  if (thrust !== 0) {
    run.stats.thrustSeconds += step;
  }

  const waterY = waterAt(world, raft.x);
  raft.y = waterY - 5;
  raft.bob = Math.sin(run.time * 2.1) * 1.8;
  raft.heading = clamp(run.currentForce * 0.0035 + raft.tilt * 0.3, -0.4, 0.4);
  raft.tilt += (abcsofTilt(run) - raft.tilt) * Math.min(1, step * 6.5);
  run.stats.maxTilt = Math.max(run.stats.maxTilt, Math.abs(raft.tilt));

  run.collisionCooldown = Math.max(0, run.collisionCooldown - step);
  run.pickupTimer = Math.max(0, run.pickupTimer - step * 0.7);
  for (const key of Object.keys(run.eventCooldowns)) {
    if (run.eventCooldowns[key] <= run.time) {
      delete run.eventCooldowns[key];
    }
  }

  const drain =
    0.052 +
    Math.abs(raft.vx) / 142 * 0.56 +
    Math.abs(thrust) * 0.18 +
    (absTiltWarning(run) ? 0.31 : 0) +
    (raft.rack < 0.12 && cargoCount > 0 ? 0.04 : 0);
  const beforeBattery = run.battery;
  run.battery = clamp(run.battery - drain * step, 0, BATTERY_CAPACITY);
  run.stats.batterySpent += Math.max(0, beforeBattery - run.battery);

  checkCeiling(run, events, step);
  checkPickups(run, events, step);
  checkCheckpoints(run, events);
  checkStranding(run, events, step, inShallow);
  checkDock(run, events, step);

  if (
    run.battery <= 0 &&
    run.status === "playing"
  ) {
    finishRun(
      run,
      "failure",
      "battery-empty",
      `电池耗尽：连续碰撞与电机负载让电量归零。共撞壁 ${run.collisions} 次。`,
    );
    events.push({
      type: "failure",
      title: "电量耗尽",
      message: "电机停机，航次中止。",
    });
  }

  if (
    Math.abs(raft.x - run.path[run.path.length - 1].x) >= 11 ||
    run.time - run.path[run.path.length - 1].time >= 1.2
  ) {
    run.path.push({
      x: Math.round(raft.x),
      y: Math.round(raft.y),
      time: Number(run.time.toFixed(2)),
      state: run.status,
    });
  }

  run.telemetry = buildTelemetry(run);
  return events;
}

function absTiltWarning(run) {
  return Math.abs(run.raft.tilt) > TILT_WARNING;
}

function checkCeiling(run, events, step) {
  const positions = [run.raft.x];
  for (const crate of carriedCargo(run)) {
    positions.push(run.raft.x + CARGO_POSITIONS[crate.slot + 1]);
  }
  let clearance = Infinity;
  for (const x of positions) {
    clearance = Math.min(clearance, clearanceAt(run, x));
  }

  if (clearance < 0 && run.collisionCooldown <= 0) {
    const damage = 6.2 + Math.min(3, Math.abs(run.raft.vx) * 0.022);
    const before = run.battery;
    run.battery = clamp(run.battery - damage, 0, BATTERY_CAPACITY);
    run.stats.batterySpent += Math.max(0, before - run.battery);
    run.raft.vx *= -0.24;
    run.raft.x = Math.max(62, run.raft.x - 5);
    run.collisions += 1;
    run.stats.ceilingHits += 1;
    run.collisionCooldown = 0.62;
    const entry = {
      type: "ceiling",
      label: "顶部钟乳石",
      time: Number(run.time.toFixed(2)),
      damage: Number(damage.toFixed(1)),
      clearance: Math.round(clearance),
    };
    run.collisionLog.push(entry);
    if (run.collisionLog.length > 12) {
      run.collisionLog.shift();
    }
    events.push({
      type: "collision",
      title: "撞上钟乳石",
      message: `净空不足，电量 -${damage.toFixed(1)}%。按 S 压低货架。`,
      severity: "alert",
      damage,
    });
  }
}

function nearestCargo(run) {
  return run.cargo
    .filter((crate) => !crate.collected)
    .sort((left, right) => Math.abs(left.x - run.raft.x) - Math.abs(right.x - run.raft.x))[0];
}

function checkPickups(run, events, step) {
  const nearest = nearestCargo(run);
  const distance = nearest ? Math.abs(nearest.x - run.raft.x) : Infinity;
  if (nearest && distance <= nearest.pickupRadius) {
    if (Math.abs(run.raft.vx) <= run.world.mission.pickupSpeedLimit) {
      run.pickupCargoId = nearest.id;
      run.pickupTimer += step;
      if (run.pickupTimer >= 0.42) {
        nearest.collected = true;
        run.pickupTimer = 0;
        run.pickupCargoId = null;
        run.raft.vx *= 0.72;
        events.push({
          type: "pickup",
          title: "物资箱已装载",
          message: `${nearest.name} 上筏：${carriedCargo(run).length} / ${run.world.mission.cargoTarget}。注意 Q / E 配重。`,
          severity: "gold",
        });
      }
    } else {
      run.pickupCargoId = nearest.id;
      if (!run.eventCooldowns["pickup-fast"]) {
        eventKey(run, "pickup-fast", 2.2);
        events.push({
          type: "hint",
          title: "减速靠泊",
          message: "速度过快，无法抓取货箱。松开推进或按 SPACE 制动。",
          severity: "alert",
        });
      }
    }
  } else {
    run.pickupCargoId = null;
  }

  for (const cell of run.cells) {
    if (!cell.collected && Math.abs(cell.x - run.raft.x) <= 32) {
      cell.collected = true;
      const gained = Math.min(cell.charge, BATTERY_CAPACITY - run.battery);
      run.battery = clamp(run.battery + cell.charge, 0, BATTERY_CAPACITY);
      run.stats.cellsUsed += 1;
      events.push({
        type: "cell",
        title: "回收备用电池",
        message: `电量 +${gained.toFixed(0)}%，当前 ${run.battery.toFixed(0)}%。`,
        severity: "gold",
      });
    }
  }
}

function checkCheckpoints(run, events) {
  for (const checkpoint of run.world.checkpoints) {
    if (
      !run.checkpointIds.includes(checkpoint.id) &&
      run.raft.x >= checkpoint.x - 2
    ) {
      run.checkpointIds.push(checkpoint.id);
      const snapshot = captureCheckpoint(run, checkpoint);
      run.lastCheckpoint = snapshot;
      events.push({
        type: "checkpoint",
        title: "检查点已记录",
        message: `${checkpoint.label} · 电量 ${run.battery.toFixed(0)}% · ${formatElapsed(run.time)}`,
        severity: "safe",
      });
    }
  }
}

function checkStranding(run, events, step, inShallow) {
  if (inShallow && Math.abs(run.raft.vx) < 18) {
    run.strandingTimer += step;
  } else {
    run.strandingTimer = Math.max(0, run.strandingTimer - step * 1.7);
  }

  if (run.strandingTimer > 1.7 && !run.eventCooldowns["stranded-hint"]) {
    eventKey(run, "stranded-hint", 7);
    events.push({
      type: "hint",
      title: "浅滩滞留",
      message: `船速过低，${Math.max(0, 6.5 - run.strandingTimer).toFixed(1)} 秒后保护停机。按 D 推进脱困。`,
      severity: "alert",
    });
  }

  if (run.strandingTimer >= 6.5 && run.status === "playing") {
    finishRun(
      run,
      "failure",
      "stranded",
      "搁浅：船体在碎石浅滩失去推力，被回流压向碎石床；电池保护断开，航次中止。",
    );
    events.push({
      type: "failure",
      title: "货筏搁浅",
      message: "按检查点恢复，或同种子重新开始。",
    });
  }
}

function checkDock(run, events, step) {
  const target = run.world.mission.cargoTarget;
  const atDock =
    run.raft.x >= run.world.warehouse.x - run.world.warehouse.dockRadius;
  if (!atDock) {
    run.dockTimer = 0;
    return;
  }
  if (carriedCargo(run).length < target) {
    if (!run.eventCooldowns["missing-cargo"]) {
      eventKey(run, "missing-cargo", 4);
      events.push({
        type: "hint",
        title: "仓库缺货",
        message: `还需 ${target - carriedCargo(run).length} 只物资箱，沿航迹返回搜索。`,
        severity: "alert",
      });
    }
    run.dockTimer = 0;
    return;
  }
  if (Math.abs(run.raft.vx) > run.world.mission.dockSpeedLimit) {
    if (!run.eventCooldowns["dock-fast"]) {
      eventKey(run, "dock-fast", 2.5);
      events.push({
        type: "hint",
        title: "减速靠泊",
        message: "仓库闸门尚未对齐，按 SPACE 制动后靠泊。",
        severity: "alert",
      });
    }
    return;
  }
  run.dockTimer += step;
  if (run.dockTimer >= 0.75 && run.status === "playing") {
    run.delivered = target;
    finishRun(
      run,
      "success",
      "delivered",
      `全部 ${target} 只物资箱已入库，仓库闸门关闭。`,
    );
    events.push({
      type: "success",
      title: "任务完成",
      message: `3 / 3 物资箱入库 · 最终用时 ${formatElapsed(run.time)}。`,
      severity: "gold",
    });
  }
}

export function finishRun(run, outcome, cause, reason) {
  if (run.status === "failed" || run.status === "won") {
    return run;
  }
  run.status = outcome === "success" ? "won" : "failed";
  run.failureCause = cause;
  run.failureReason = outcome === "failure" ? reason : null;
  run.finalSummary = buildSummary(run);
  return run;
}

export function triggerFailureDrill(run) {
  if (run.status !== "playing" && run.status !== "ready" && run.status !== "paused") {
    return null;
  }
  const scenario = run.world.failureScenario;
  run.strandingTimer = 6.5;
  run.battery = Math.min(run.battery, 7);
  finishRun(run, "failure", "drill", scenario.reason);
  return {
    type: "failure",
    title: "故障演练：搁浅",
    message: "已触发固定失败场景。可从自动检查点恢复。",
  };
}

export function buildTelemetry(run) {
  const clearancePx = clearanceAt(run);
  const mass = loadMass(run);
  const cargo = carriedCargo(run);
  const com = centerOfMass(run);
  const nearest = nearestCargo(run);
  const nextCheckpoint =
    run.world.checkpoints.find(
      (checkpoint) => !run.checkpointIds.includes(checkpoint.id),
    ) || null;
  const hazard = hazardAt(run.world, run.raft.x);
  return {
    clearancePx,
    clearanceCm: Math.round(clearancePx * 1.9),
    tiltRadians: run.raft.tilt,
    tiltDegrees: (run.raft.tilt * 180) / Math.PI,
    speedKnots: Math.abs(run.raft.vx) * 0.19,
    currentZone: run.currentZone,
    currentForce: run.currentForce,
    loadMass: mass,
    centerOfMass: com,
    cargoCount: cargo.length,
    nearestCargo: nearest || null,
    distanceToCargo: nearest ? Math.abs(nearest.x - run.raft.x) : null,
    distanceToWarehouse: distanceToWarehouse(run.world, run.raft.x),
    distanceLabel: formatDistance(run.world, run.raft.x),
    nextCheckpoint,
    hazard,
    inShallow: hazard?.id === "gravel-shallows",
    strandingTimer: run.strandingTimer,
    dockTimer: run.dockTimer,
    atDock:
      run.raft.x >= run.world.warehouse.x - run.world.warehouse.dockRadius,
    tiltWarning: absTiltWarning(run),
    clearanceWarning: clearancePx < 24,
    carryingAll: cargo.length >= run.world.mission.cargoTarget,
  };
}

function compactPath(path, limit = 220) {
  if (path.length <= limit) {
    return path;
  }
  const stride = Math.ceil(path.length / limit);
  const points = [];
  for (let index = 0; index < path.length; index += stride) {
    points.push(path[index]);
  }
  const last = path[path.length - 1];
  if (points[points.length - 1] !== last) {
    points.push(last);
  }
  return points;
}

export function captureCheckpoint(run, checkpoint = run.lastCheckpoint || run.world.checkpoints[0]) {
  if (!checkpoint) {
    return null;
  }
  return {
    version: CHECKPOINT_VERSION,
    seed: run.world.seed,
    layoutSignature: run.world.layoutSignature,
    checkpointId: checkpoint.id,
    checkpointLabel: checkpoint.label,
    savedAtElapsed: Number(run.time.toFixed(2)),
    state: {
      status: "playing",
      time: run.time,
      battery: run.battery,
      raft: { ...run.raft },
      cargo: run.cargo.map((crate) => ({
        id: crate.id,
        collected: crate.collected,
      })),
      cells: run.cells.map((cell) => ({
        id: cell.id,
        collected: cell.collected,
      })),
      delivered: run.delivered,
      collisions: run.collisions,
      checkpointIds: [...run.checkpointIds],
      path: compactPath(run.path, 260).map((point) => ({ ...point })),
      collisionLog: run.collisionLog.map((entry) => ({ ...entry })),
      failureReason: run.failureReason,
      failureCause: run.failureCause,
      stats: { ...run.stats },
    },
  };
}

export function restoreCheckpoint(world, snapshot) {
  if (
    !snapshot ||
    snapshot.layoutSignature !== world.layoutSignature ||
    snapshot.seed !== world.seed
  ) {
    throw new Error("检查点与该地图 seed 不匹配");
  }
  const run = createRun(world);
  const state = snapshot.state;
  run.status = "playing";
  run.time = Number(state.time) || 0;
  run.battery = clamp(Number(state.battery) || 0, 0, BATTERY_CAPACITY);
  run.raft = { ...run.raft, ...state.raft };
  run.delivered = Number(state.delivered) || 0;
  run.collisions = Number(state.collisions) || 0;
  run.checkpointIds = Array.isArray(state.checkpointIds)
    ? [...state.checkpointIds]
    : [];
  run.path =
    Array.isArray(state.path) && state.path.length > 0
      ? state.path.map((point) => ({ ...point }))
      : [{ x: run.raft.x, y: run.raft.y, time: run.time, state: "restore" }];
  run.collisionLog = Array.isArray(state.collisionLog)
    ? state.collisionLog.map((entry) => ({ ...entry }))
    : [];
  run.stats = run.stats || {};
  Object.assign(run.stats, state.stats || {});
  run.failureReason = null;
  run.failureCause = null;
  run.finalSummary = null;
  run.collisionCooldown = 1;
  run.pickupTimer = 0;
  run.dockTimer = 0;
  run.strandingTimer = 0;

  for (const saved of state.cargo || []) {
    const crate = run.cargo.find((item) => item.id === saved.id);
    if (crate) {
      crate.collected = Boolean(saved.collected);
    }
  }
  for (const saved of state.cells || []) {
    const cell = run.cells.find((item) => item.id === saved.id);
    if (cell) {
      cell.collected = Boolean(saved.collected);
    }
  }
  if (!run.checkpointIds.includes(snapshot.checkpointId)) {
    run.checkpointIds.push(snapshot.checkpointId);
  }
  run.lastCheckpoint = {
    ...snapshot,
    state: {
      ...snapshot.state,
      raft: { ...snapshot.state.raft },
      cargo: snapshot.state.cargo.map((crate) => ({ ...crate })),
      cells: snapshot.state.cells.map((cell) => ({ ...cell })),
      checkpointIds: [...snapshot.state.checkpointIds],
      path: snapshot.state.path.map((point) => ({ ...point })),
      collisionLog: snapshot.state.collisionLog.map((entry) => ({ ...entry })),
      stats: { ...snapshot.state.stats },
    },
  };
  run.currentZone = currentAt(world, run.raft.x);
  run.telemetry = buildTelemetry(run);
  return run;
}

export function serializeCheckpoint(snapshot) {
  return JSON.stringify(snapshot);
}

export function parseCheckpoint(value) {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed?.version === CHECKPOINT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

export function formatElapsed(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(1).padStart(4, "0")}`;
}

export function summaryPath(run, limit = 120) {
  return compactPath(run.path, limit).map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
    t: Number((point.time || 0).toFixed(2)),
  }));
}

export function buildSummary(run) {
  const target = run.world.mission.cargoTarget;
  const aboard = carriedCargo(run).length;
  const outcome =
    run.status === "won" ? "success" : run.status === "failed" ? "failure" : "in-progress";
  const remainingCells = run.cells.filter((cell) => !cell.collected).length;
  const collisions = run.collisionLog.map((entry) => ({ ...entry }));
  const reasonSummary =
    outcome === "failure"
      ? run.failureReason || "未知故障"
      : outcome === "success"
        ? `无致命故障；撞壁 ${run.collisions} 次，最高倾斜 ${(
            (run.stats.maxTilt * 180) /
            Math.PI
          ).toFixed(1)}°。`
        : `航次进行中；已装载 ${aboard} / ${target}，撞壁 ${run.collisions} 次。`;

  return {
    version: SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    outcome,
    seed: run.world.seed,
    layoutSignature: run.world.layoutSignature,
    objective: {
      target,
      delivered: run.delivered,
      aboard: carriedCargo(run).length,
      remaining: Math.max(0, target - run.delivered),
      complete: run.delivered >= target,
      cargo: run.cargo.map((crate) => ({
        id: crate.id,
        name: crate.name,
        collected: crate.collected,
        x: crate.x,
        mass: crate.mass,
      })),
    },
    resources: {
      batteryPct: Number(run.battery.toFixed(1)),
      batteryCapacity: BATTERY_CAPACITY,
      reserveCellsRemaining: remainingCells,
      reserveCellsUsed: run.stats.cellsUsed,
      collisions: run.collisions,
      cargoMass: Number(loadMass(run).toFixed(2)),
    },
    timing: {
      elapsedSeconds: Number(run.time.toFixed(1)),
      formatted: formatElapsed(run.time),
    },
    route: {
      distanceMeters: Math.round(run.stats.distance * 0.9),
      startX: run.world.startX,
      endX: Math.round(run.raft.x),
      warehouseX: run.world.warehouse.x,
      checkpointCount: run.checkpointIds.length,
      points: summaryPath(run),
      cargoPoints: run.world.crates.map((crate) => ({
        id: crate.id,
        x: crate.x,
        collected: run.cargo.find((item) => item.id === crate.id)?.collected,
      })),
    },
    failure: {
      cause: run.failureCause,
      reason: run.failureReason,
      summary: reasonSummary,
      collisions,
      strandingSeconds: Number(run.strandingTimer.toFixed(1)),
    },
    checkpoint: {
      id: run.lastCheckpoint?.checkpointId || null,
      label: run.lastCheckpoint?.checkpointLabel || "未记录",
      elapsedSeconds: run.lastCheckpoint?.savedAtElapsed ?? 0,
    },
    world: {
      warehouse: { ...run.world.warehouse },
      hazards: JSON.parse(JSON.stringify(run.world.hazards)),
      failureScenario: { ...run.world.failureScenario },
    },
  };
}

export function summaryText(run) {
  return JSON.stringify(buildSummary(run), null, 2);
}

export function runIdentity(run) {
  return hashString(
    `${run.world.seed}:${run.world.layoutSignature}:${run.status}:${run.delivered}:${run.raft.x.toFixed(1)}`,
  );
}
