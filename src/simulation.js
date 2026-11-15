export const AMBIENT = 20;
export const PROFILE = Object.freeze({
  heatEnd: 150,
  holdEnd: 230,
  coolEnd: 360,
  chamberPeak: 1080,
  coolingFloor: 90
});

export const DEVICE_NAMES = Object.freeze({
  burner: "燃气比例阀",
  blower: "助燃风机",
  door: "窑门执行器",
  thermocouple: "窑体热电偶"
});

export const PIECES = Object.freeze([
  {
    id: "tea-bowl",
    name: "青釉茶盏",
    thickness: 0.6,
    targetPeak: 1070,
    shockLimit: 9.3,
    color: "#b9d8c7"
  },
  {
    id: "stoneware-jar",
    name: "灰陶小罐",
    thickness: 1.2,
    targetPeak: 1055,
    shockLimit: 9.0,
    color: "#d5a184"
  },
  {
    id: "moon-vase",
    name: "月白长瓶",
    thickness: 2.0,
    targetPeak: 1035,
    shockLimit: 8.8,
    color: "#c9c5b2"
  }
]);

export const DEFAULT_CONTROLS = Object.freeze({
  gas: 76,
  vent: 46,
  door: 0
});

export const CONTROL_LIMITS = Object.freeze({
  gas: 88,
  minVent: 18,
  door: 8,
  chamber: 1150
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, places = 1) => Number(value.toFixed(places));

function batchDate(number = 1, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  return `KY-${date}-${String(number).padStart(3, "0")}`;
}

export function phaseAt(elapsed) {
  if (elapsed < PROFILE.heatEnd) return "heating";
  if (elapsed < PROFILE.holdEnd) return "holding";
  if (elapsed < PROFILE.coolEnd) return "cooling";
  return "complete";
}

export function targetAt(elapsed) {
  if (elapsed <= PROFILE.heatEnd) {
    const progress = clamp(elapsed / PROFILE.heatEnd, 0, 1);
    const eased = 0.84 * progress + 0.16 * (1 - Math.cos(progress * Math.PI)) / 2;
    return AMBIENT + (PROFILE.chamberPeak - AMBIENT) * eased;
  }
  if (elapsed <= PROFILE.holdEnd) return PROFILE.chamberPeak;
  if (elapsed <= PROFILE.coolEnd) {
    const progress = (elapsed - PROFILE.holdEnd) / (PROFILE.coolEnd - PROFILE.holdEnd);
    return PROFILE.chamberPeak - (PROFILE.chamberPeak - PROFILE.coolingFloor) * progress;
  }
  return PROFILE.coolingFloor;
}

function makeEquipment() {
  return {
    burner: { on: false, since: null, health: "ok" },
    blower: { on: false, since: null, health: "ok" },
    door: { open: 0, since: null, health: "ok" }
  };
}

function makePieces() {
  return PIECES.map((piece) => ({
    ...piece,
    temp: AMBIENT,
    peak: AMBIENT,
    rate: 0,
    status: "safe",
    defect: null,
    shockSeconds: 0,
    reachedPeak: false
  }));
}

export function createBatch({
  controls = DEFAULT_CONTROLS,
  number = 1,
  now = new Date(),
  snapshotId = null
} = {}) {
  return {
    id: batchDate(number, now),
    number,
    createdAt: now.toISOString(),
    snapshotId,
    status: "ready",
    startedAt: null,
    completedAt: null,
    elapsed: 0,
    chamberTemp: AMBIENT,
    chamberRate: 0,
    phase: "heating",
    wallStartedAt: null,
    wallCompletedAt: null,
    controls: { ...DEFAULT_CONTROLS, ...controls },
    setupControls: { ...DEFAULT_CONTROLS, ...controls },
    equipment: makeEquipment(),
    pieces: makePieces(),
    logs: [],
    alarms: [],
    activeFault: null,
    failure: null,
    recovery: null,
    recoveryAudit: null,
    recoveryAudits: [],
    result: null,
    peakPower: 0,
    history: [],
    lastSampleAt: -1,
    timers: { gasLimit: 0, lowVent: 0, coldAir: 0, overTemp: 0, overRate: 0 },
    totals: {
      gasLimitSeconds: 0,
      lowVentSeconds: 0,
      coldAirSeconds: 0,
      overTempSeconds: 0,
      overRateSeconds: 0
    },
    alarmCount: 0,
    recoveredFaults: 0,
    revision: 0
  };
}

function logEvent(state, device, action, detail, type = "info") {
  state.logs.push({
    id: `evt-${state.logs.length + 1}`,
    t: round(state.elapsed, 1),
    device,
    action,
    detail,
    type
  });
  state.revision += 1;
}

function syncEquipment(state, next, source = "控制指令") {
  const { burner, blower, door } = state.equipment;
  if (burner.on !== next.burner) {
    burner.on = next.burner;
    burner.since = next.burner ? state.elapsed : null;
    logEvent(
      state,
      "burner",
      next.burner ? "启动" : "停止",
      next.burner ? `燃气指令 ${state.controls.gas}%` : `燃气指令 ${state.controls.gas}%`,
      next.burner ? "start" : "stop"
    );
  }
  if (blower.on !== next.blower) {
    blower.on = next.blower;
    blower.since = next.blower ? state.elapsed : null;
    logEvent(
      state,
      "blower",
      next.blower ? "启动" : "停止",
      next.blower ? `通风指令 ${state.controls.vent}%` : `通风指令 ${state.controls.vent}%`,
      next.blower ? "start" : "stop"
    );
  }
  if (next.door !== door.open) {
    const opening = next.door > door.open;
    door.open = next.door;
    door.since = state.elapsed;
    logEvent(
      state,
      "door",
      opening ? "开启" : "关闭",
      `窑门开度 ${round(next.door, 0)}% · ${source}`,
      opening ? "start" : "stop"
    );
  }
}

function updatePower(state) {
  const burnerKw = state.equipment.burner.on
    ? 0.65 + 16.5 * Math.pow(state.controls.gas / 100, 1.12)
    : 0;
  const blowerKw = state.equipment.blower.on
    ? 0.22 + 1.9 * Math.pow(state.controls.vent / 100, 1.15)
    : 0;
  const power = burnerKw + blowerKw;
  state.peakPower = Math.max(state.peakPower, power);
}

function effectiveActuators(state) {
  const fault = state.activeFault;
  const burnerFault = fault?.device === "burner";
  const blowerFault = fault?.device === "blower";
  const doorFault = fault?.device === "door";
  return {
    burner: state.equipment.burner.health === "fault" ? false : state.controls.gas > 0.5,
    blower: state.equipment.blower.health === "fault" ? false : state.controls.vent > 0.5,
    door: doorFault
      ? 38
      : state.equipment.door.health === "fault"
        ? 38
        : state.controls.door,
    burnerFault,
    blowerFault,
    doorFault
  };
}

export function startBatch(state) {
  if (state.status !== "ready") return false;
  state.setupControls = { ...state.controls };
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.wallStartedAt = Date.now();
  const actuators = effectiveActuators(state);
  syncEquipment(state, actuators, "批次启动");
  logEvent(state, "system", "批次开始", `${state.id} · 三件作品入窑`, "info");
  return true;
}

export function pauseBatch(state) {
  if (state.status !== "running") return false;
  state.status = "paused";
  logEvent(state, "system", "检查暂停", `窑内时间冻结于 ${formatClock(state.elapsed)}`, "check");
  return true;
}

export function resumeBatch(state) {
  if (state.status !== "paused") return false;
  state.status = "running";
  logEvent(state, "system", "继续烧成", `自 ${formatClock(state.elapsed)} 恢复`, "info");
  return true;
}

export function setControls(state, patch) {
  if (state.status === "completed" || state.status === "recovery") return false;
  for (const key of ["gas", "vent", "door"]) {
    if (patch[key] == null) continue;
    state.controls[key] = clamp(Number(patch[key]), 0, 100);
  }
  if (state.status === "running") {
    syncEquipment(state, effectiveActuators(state));
    updatePower(state);
  }
  state.revision += 1;
  return true;
}

export function formatClock(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function markDefect(piece, status, detail) {
  if (piece.status === "safe") {
    piece.status = status;
    piece.defect = detail;
  }
}

function triggerFailure(state, fault) {
  if (state.status === "completed") return;
  const recovered = state.status === "recovery";
  state.alarmCount += 1;
  state.activeFault = fault;
  state.status = "fault";
  state.failure = { ...fault, handled: false };
  if (recovered && state.recovery) {
    state.recovery.failed = true;
    state.recovery.failedReason = fault.detail;
    state.recoveryAudits.push({
      passed: false,
      duration: round(state.recovery.total - state.recovery.remaining, 1),
      failedReason: fault.detail,
      failedDevice: fault.deviceName,
      failedValue: fault.triggerValue,
      verifiedAt: state.elapsed
    });
  }
  logEvent(
    state,
    fault.device,
    "联锁停机",
    `${fault.title} · ${fault.triggerValue}`,
    "trip"
  );
}

export function injectFault(state, kind) {
  if (state.status !== "running") return false;
  if (kind === "burner") {
    state.equipment.burner.health = "fault";
    syncEquipment(state, effectiveActuators(state), "阀体卡滞");
    triggerFailure(state, {
      code: "BURNER_JAM",
      device: "burner",
      deviceName: DEVICE_NAMES.burner,
      title: "燃气阀卡滞",
      detail: `燃气指令为 ${state.controls.gas}%，但阀后流量降至 0%。燃烧中断，批次已安全暂停。`,
      triggerValue: `实际流量 0.0% / 指令 ${state.controls.gas}%`
    });
    return true;
  }
  if (kind === "blower") {
    state.equipment.blower.health = "fault";
    syncEquipment(state, effectiveActuators(state), "轴承过热");
    triggerFailure(state, {
      code: "BLOWER_BEARING",
      device: "blower",
      deviceName: DEVICE_NAMES.blower,
      title: "风机轴承过热",
      detail: "轴承温度越过联锁线，风机停转。助燃风量归零，未燃气体已切断。",
      triggerValue: "轴承 116°C > 95°C"
    });
    return true;
  }
  if (kind === "door") {
    state.equipment.door.health = "fault";
    const actuators = effectiveActuators(state);
    syncEquipment(state, actuators, "限位失效");
    triggerFailure(state, {
      code: "DOOR_LIMIT",
      device: "door",
      deviceName: DEVICE_NAMES.door,
      title: "窑门限位失效",
      detail: "执行器失去位置反馈，窑门在热态自行开启。冷风进入路径已触发停机。",
      triggerValue: `开度 ${actuators.door}% > 8%`
    });
    return true;
  }
  return false;
}

export function repairAndVerify(state) {
  if (state.status !== "fault" || !state.activeFault) return false;
  const fault = state.activeFault;
  if (state.equipment[fault.device]?.health === "fault") {
    state.equipment[fault.device].health = "ok";
  }
  state.timers = { gasLimit: 0, lowVent: 0, coldAir: 0, overTemp: 0, overRate: 0 };
  state.failure = null;
  state.activeFault = null;
  state.status = "recovery";
  state.recovery = {
    remaining: 20,
    total: 20,
    startElapsed: state.elapsed,
    failed: false,
    failedReason: null,
    baseline: {
      alarmCount: state.alarmCount,
      totals: { ...state.totals },
      defects: state.pieces.filter((piece) => piece.status !== "safe").length
    }
  };
  logEvent(
    state,
    fault.device,
    "维修复位",
    `${fault.title}已排除 · 开始 20 秒恢复验证`,
    "check"
  );
  return true;
}

function checkCurveMilestone(state, previousElapsed) {
  if (previousElapsed < PROFILE.holdEnd && state.elapsed >= PROFILE.holdEnd) {
    for (const piece of state.pieces) {
      if (piece.peak < piece.targetPeak - 28) {
        markDefect(
          piece,
          "underfired",
          `保温结束仅 ${round(piece.peak)}°C，低于 ${piece.targetPeak}°C 目标`
        );
      } else {
        piece.reachedPeak = true;
      }
    }
    logEvent(state, "thermocouple", "保温结束", "三件陶胎峰值温度已归档", "check");
  }
}

function updatePhysics(state, dt) {
  const { burner, blower, door } = state.equipment;
  const gas = burner.on ? state.controls.gas / 100 : 0;
  const vent = blower.on ? state.controls.vent / 100 : 0;
  const doorFraction = door.open / 100;
  const temperature = state.chamberTemp;
  const heat = 16 * Math.pow(gas, 1.25) * (0.62 + 0.38 * vent);
  const losses =
    (temperature - AMBIENT) *
    (0.0032 + 0.0016 * vent + 0.04 * Math.pow(doorFraction, 1.3));
  const coldAir =
    doorFraction > 0
      ? 0.75 * doorFraction * Math.sqrt(Math.max(0, temperature - AMBIENT) / 100)
      : 0;
  const nextTemperature = clamp(
    temperature + (heat - losses - coldAir) * dt,
    AMBIENT,
    1450
  );
  state.chamberRate = (nextTemperature - temperature) / dt;
  state.chamberTemp = nextTemperature;

  for (const piece of state.pieces) {
    const tau = 1.2 + piece.thickness * 1.45;
    const nextPiece = nextTemperature + (piece.temp - nextTemperature) * Math.exp(-dt / tau);
    piece.rate = (nextPiece - piece.temp) / dt;
    piece.temp = nextPiece;
    piece.peak = Math.max(piece.peak, piece.temp);
  }
}

function accrueCounters(state, dt) {
  const { burner, blower, door } = state.equipment;
  const { velocity, phase } = { velocity: state.chamberRate, phase: state.phase };

  if (state.controls.gas > CONTROL_LIMITS.gas && burner.on) {
    state.timers.gasLimit += dt;
    state.totals.gasLimitSeconds += dt;
  } else {
    state.timers.gasLimit = Math.max(0, state.timers.gasLimit - dt * 0.5);
  }

  if (state.controls.gas > 35 && blower.on && state.controls.vent < CONTROL_LIMITS.minVent) {
    state.timers.lowVent += dt;
    state.totals.lowVentSeconds += dt;
  } else {
    state.timers.lowVent = Math.max(0, state.timers.lowVent - dt * 0.35);
  }

  if (door.open > CONTROL_LIMITS.door && phase !== "cooling" && state.chamberTemp > 620) {
    state.timers.coldAir += dt * (door.open / 30);
    state.totals.coldAirSeconds += dt;
  } else {
    state.timers.coldAir = Math.max(0, state.timers.coldAir - dt * 0.25);
  }

  if (state.chamberTemp > CONTROL_LIMITS.chamber) {
    state.timers.overTemp += dt;
    state.totals.overTempSeconds += dt;
  } else {
    state.timers.overTemp = Math.max(0, state.timers.overTemp - dt);
  }

  let hottestExcess = null;
  for (const piece of state.pieces) {
    if (velocity > 0 && piece.rate > piece.shockLimit) {
      piece.shockSeconds += dt;
      state.timers.overRate += dt;
      state.totals.overRateSeconds += dt;
      if (!hottestExcess || piece.rate > hottestExcess.rate) {
        hottestExcess = piece;
      }
    } else {
      piece.shockSeconds = Math.max(0, piece.shockSeconds - dt * 0.6);
    }
  }
  return hottestExcess;
}

function evaluateInterlocks(state, hottestExcess) {
  if (hottestExcess && hottestExcess.shockSeconds >= 1.8) {
    markDefect(
      hottestExcess,
      "cracked",
      `升温 ${round(hottestExcess.rate)}°C/s 超过薄厚安全上限 ${hottestExcess.shockLimit}°C/s`
    );
    triggerFailure(state, {
      code: "THERMAL_SHOCK",
      device: "burner",
      deviceName: DEVICE_NAMES.burner,
      title: "升温速率越限",
      detail: `${hottestExcess.name}出现贯穿裂。过快的热膨胀已超过该厚度胎体的安全余量。`,
      triggerValue: `${round(hottestExcess.rate)}°C/s > ${hottestExcess.shockLimit}°C/s`
    });
    return true;
  }
  if (state.timers.gasLimit >= 3) {
    triggerFailure(state, {
      code: "GAS_OVER_LIMIT",
      device: "burner",
      deviceName: DEVICE_NAMES.burner,
      title: "燃气开度越限",
      detail: `燃气比例阀持续高于安全上限 3 秒，已切断燃烧器。`,
      triggerValue: `${round(state.controls.gas, 0)}% > ${CONTROL_LIMITS.gas}%`
    });
    return true;
  }
  if (state.timers.lowVent >= 5) {
    triggerFailure(state, {
      code: "LOW_COMBUSTION_AIR",
      device: "blower",
      deviceName: DEVICE_NAMES.blower,
      title: "助燃风量不足",
      detail: "燃气持续供给但风量低于完全燃烧下限，燃烧室进入欠氧状态，已执行联锁停气。",
      triggerValue: `${round(state.controls.vent, 0)}% < ${CONTROL_LIMITS.minVent}%`
    });
    return true;
  }
  if (state.timers.coldAir >= 1.2) {
    for (const piece of state.pieces) {
      markDefect(piece, "discolored", "热态冷风侵入导致釉面还原不均");
    }
    triggerFailure(state, {
      code: "EARLY_COLD_AIR",
      device: "door",
      deviceName: DEVICE_NAMES.door,
      title: "热态冷风侵入",
      detail: `保温尚未结束，窑门 ${round(state.equipment.door.open, 0)}% 开度引入冷风，三件作品出现色差风险。`,
      triggerValue: `${round(state.equipment.door.open, 0)}% > ${CONTROL_LIMITS.door}% · ${round(state.chamberTemp, 0)}°C`
    });
    return true;
  }
  if (state.timers.overTemp >= 0.8) {
    triggerFailure(state, {
      code: "CHAMBER_OVER_TEMP",
      device: "thermocouple",
      deviceName: DEVICE_NAMES.thermocouple,
      title: "窑体超温",
      detail: "主热电偶读数越过窑体材料上限，燃烧器与风机同时切断。",
      triggerValue: `${round(state.chamberTemp, 0)}°C > ${CONTROL_LIMITS.chamber}°C`
    });
    return true;
  }
  return false;
}

function sampleHistory(state, force = false) {
  const bucket = Math.floor(state.elapsed);
  if (!force && bucket === state.lastSampleAt) return;
  state.lastSampleAt = bucket;
  state.history.push({
    t: round(state.elapsed, 1),
    temp: round(state.chamberTemp, 1),
    target: round(targetAt(state.elapsed), 1),
    pieces: state.pieces.map((piece) => round(piece.temp, 1)),
    phase: state.phase
  });
  if (state.history.length > 420) state.history.shift();
}

function finalizeBatch(state) {
  if (state.status === "completed") return;
  state.elapsed = PROFILE.coolEnd;
  state.phase = "complete";
  for (const piece of state.pieces) {
    if (piece.peak > piece.targetPeak + 65) {
      markDefect(piece, "overfired", `峰值 ${round(piece.peak)}°C 超过目标上限`);
    } else if (piece.peak < piece.targetPeak - 28) {
      markDefect(piece, "underfired", `峰值 ${round(piece.peak)}°C 未达到目标温区`);
    } else if (piece.temp > 200) {
      markDefect(piece, "uncooled", `终温 ${round(piece.temp)}°C，缓冷未完成`);
    }
  }

  const nextActuators = { burner: false, blower: false, door: 0 };
  syncEquipment(state, nextActuators, "批次结束");
  state.controls.door = 0;
  const good = state.pieces.filter((piece) => piece.status === "safe").length;
  const waste = state.pieces.length - good;
  const recoveries = state.recoveredFaults;
  const shutdownReason =
    good === state.pieces.length
      ? `按计划停窑 · 三件良品${recoveries ? ` · 含 ${recoveries} 次异常恢复` : ""}`
      : `按计划停窑 · ${waste} 件未达标${recoveries ? ` · 含 ${recoveries} 次异常恢复` : ""}`;
  logEvent(
    state,
    "system",
    "批次完成",
    `${good} 件良品 / ${waste} 件废品 · 峰值 ${round(state.peakPower, 2)} kW`,
    good === state.pieces.length ? "info" : "stop"
  );
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  state.wallCompletedAt = Date.now();
  state.equipment.burner.on = false;
  state.equipment.blower.on = false;
  state.equipment.door.open = 0;
  sampleHistory(state, true);
  state.result = Object.freeze({
    batchId: state.id,
    completedAt: state.completedAt,
    good,
    waste,
    peakPower: round(state.peakPower, 2),
    shutdownReason,
    alarmCount: state.alarmCount,
    recoveredFaults: recoveries,
    duration: PROFILE.coolEnd,
    finalTemp: round(state.chamberTemp),
    controls: Object.freeze({ ...state.setupControls }),
    finalControls: Object.freeze({ ...state.controls }),
    pieces: Object.freeze(
      state.pieces.map((piece) =>
        Object.freeze({
          id: piece.id,
          name: piece.name,
          status: piece.status,
          peak: round(piece.peak),
          finalTemp: round(piece.temp),
          defect: piece.defect
        })
      )
    ),
    totals: Object.freeze({ ...state.totals }),
    recoveryAudits: Object.freeze(
      state.recoveryAudits.map((audit) => Object.freeze(structuredClone(audit)))
    )
  });
}

function finishRecovery(state) {
  const recovery = state.recovery;
  if (!recovery) return;
  state.recoveredFaults += 1;
  state.recoveryAudit = {
    passed: true,
    duration: recovery.total,
    baseline: structuredClone(recovery.baseline),
    final: {
      alarmCount: state.alarmCount,
      totals: { ...state.totals },
      defects: state.pieces.filter((piece) => piece.status !== "safe").length
    },
    newAlarms: state.alarmCount - recovery.baseline.alarmCount,
    timerResidue: { ...state.timers },
    verifiedAt: state.elapsed
  };
  state.recoveryAudits.push(structuredClone(state.recoveryAudit));
  state.timers = { gasLimit: 0, lowVent: 0, coldAir: 0, overTemp: 0, overRate: 0 };
  state.recovery = null;
  state.status = "running";
  logEvent(
    state,
    "system",
    "恢复验证通过",
    `固定运行 ${recovery.total}s · 新增报警 0 · 累计计数无增长`,
    "check"
  );
}

export function step(state, dt = 0.1) {
  if (state.status !== "running" && state.status !== "recovery") return state;
  if (state.status === "completed") return state;
  const increment = clamp(Number(dt) || 0, 0, 0.2);
  if (increment <= 0) return state;

  const previousElapsed = state.elapsed;
  state.elapsed = Math.min(PROFILE.coolEnd, state.elapsed + increment);
  const actualDt = state.elapsed - previousElapsed;
  if (actualDt <= 0) return state;
  state.phase = phaseAt(state.elapsed);

  syncEquipment(state, effectiveActuators(state));
  updatePower(state);
  updatePhysics(state, actualDt);
  const hottestExcess = accrueCounters(state, actualDt);
  sampleHistory(state);
  checkCurveMilestone(state, previousElapsed);

  if (evaluateInterlocks(state, hottestExcess)) return state;
  if (state.elapsed >= PROFILE.coolEnd) {
    finalizeBatch(state);
    return state;
  }

  if (state.status === "recovery" && state.recovery) {
    state.recovery.remaining = Math.max(0, state.recovery.remaining - actualDt);
    if (state.recovery.remaining <= 0) finishRecovery(state);
  }
  return state;
}

export function advance(state, seconds) {
  let remaining = Math.max(0, Number(seconds) || 0);
  let guard = 0;
  while (
    remaining > 0.0001 &&
    guard < 10000 &&
    (state.status === "running" || state.status === "recovery")
  ) {
    const increment = Math.min(0.1, remaining);
    const before = state.elapsed;
    step(state, increment);
    remaining -= increment;
    guard += 1;
    if (state.elapsed === before && state.status !== "running" && state.status !== "recovery") break;
  }
  return state;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createSnapshot(state, label = "") {
  const snapshot = {
    id: `SNAP-${String(state.number).padStart(2, "0")}-${state.logs.length + 1}`,
    label: label || `${state.id} · ${formatClock(state.elapsed)}`,
    savedAt: new Date().toISOString(),
    sourceBatchId: state.id,
    sourceStatus: state.status,
    elapsed: round(state.elapsed, 1),
    phase: state.phase,
    chamberTemp: round(state.chamberTemp, 1),
    controls: { ...state.controls },
    equipment: {
      burner: { ...state.equipment.burner },
      blower: { ...state.equipment.blower },
      door: { ...state.equipment.door }
    },
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      name: piece.name,
      status: piece.status,
      temp: round(piece.temp, 1),
      peak: round(piece.peak, 1)
    })),
    peakPower: round(state.peakPower, 2)
  };
  return deepFreeze(snapshot);
}

export function cloneFrozen(value) {
  return deepFreeze(structuredClone(value));
}
