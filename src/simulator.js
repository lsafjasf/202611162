export const DEVICE_DEFS = Object.freeze({
  feeder: { label: "给纸单元", short: "FEED" },
  inkPump: { label: "供墨泵", short: "INK" },
  cylinder: { label: "压印滚筒", short: "CYL" },
  dryer: { label: "干燥风机", short: "DRY" },
  cutter: { label: "裁切刀", short: "CUT" },
  tensionSensor: { label: "张力传感器", short: "TNS" }
});

export const PARAM_SPECS = Object.freeze({
  pressure: {
    label: "滚筒压力",
    unit: "N/mm",
    min: 0,
    max: 100,
    safe: [46, 58],
    hard: [20, 88],
    target: 52
  },
  ink: {
    label: "墨量",
    unit: "%",
    min: 0,
    max: 100,
    safe: [44, 56],
    hard: [12, 88],
    target: 50
  },
  dryer: {
    label: "干燥风速",
    unit: "m/s",
    min: 0,
    max: 100,
    safe: [54, 70],
    hard: [18, 94],
    target: 62
  },
  tension: {
    label: "纸卷张力",
    unit: "N",
    min: 0,
    max: 100,
    safe: [42, 58],
    hard: [22, 86],
    target: 50
  }
});

export const DEFAULT_PARAMS = Object.freeze({
  pressure: 52,
  ink: 50,
  dryer: 62,
  tension: 50
});

export const FAULT_TYPES = Object.freeze({
  bearing: {
    device: "cylinder",
    title: "滚筒轴承卡滞",
    detail: "压印滚筒阻力突增，套准反馈丢失。",
    triggerLabel: "轴承温度",
    triggerValue: "96.4 °C",
    threshold: "停机阈值 82 °C",
    impact: "套准漂移 / 重影废页",
    advice: "待滚筒降温并复位编码器后恢复。"
  },
  inkLoss: {
    device: "inkPump",
    title: "供墨压力丢失",
    detail: "墨泵出口压力低于闭环控制下限。",
    triggerLabel: "墨泵压力",
    triggerValue: "0.18 bar",
    threshold: "控制下限 1.20 bar",
    impact: "墨色中断 / 网点缺失",
    advice: "检查墨泵联轴器与管路后恢复。"
  },
  fanStall: {
    device: "dryer",
    title: "干燥风机失速",
    detail: "风机转速与设定风速不一致，干燥窗失控。",
    triggerLabel: "风机转速",
    triggerValue: "412 rpm",
    threshold: "目标下限 900 rpm",
    impact: "油墨未干 / 堆积废页",
    advice: "清除风道堵塞并重新标定变频器。"
  },
  tensionDrift: {
    device: "tensionSensor",
    title: "张力传感器漂移",
    detail: "传感器读数偏离校准曲线，纸带波动。",
    triggerLabel: "张力偏差",
    triggerValue: "+18.6 N",
    threshold: "允许偏差 ±4.0 N",
    impact: "纸带蛇行 / 套准偏差",
    advice: "重新张紧纸带并执行零点标定。"
  }
});

const SHEET_CYCLE_MS = 760;
const RECOVERY_AUDIT_MS = 5000;
const ROLL_CHANGE_MS = 1800;
const ROLL_STOP_ORDER = ["inkPump", "feeder", "cylinder", "dryer", "cutter"];
const ROLL_START_ORDER = ["feeder", "cylinder", "dryer", "cutter", "inkPump"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDevices() {
  return Object.fromEntries(
    Object.keys(DEVICE_DEFS).map((id) => [
      id,
      { id, on: false, faulted: false }
    ])
  );
}

export class PressSimulator {
  constructor({ params = DEFAULT_PARAMS, seed = 664 } = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.seed = seed;
    this.batchSerial = 0;
    this.snapshotSerial = 0;
    this.timeMs = 0;
    this.sheetProgress = 0;
    this.phase = "ready";
    this.devices = createDevices();
    this.fault = null;
    this.rollChange = null;
    this.recoveryAudit = null;
    this.powerKw = 0;
    this.history = [];
    this.snapshots = [];
    this.eventQueue = [];
    this.transient = { ghost: 0, buildup: 0, registration: 0, strike: false };
    this._createBatch();
  }

  setParams(patch) {
    for (const [key, rawValue] of Object.entries(patch)) {
      const spec = PARAM_SPECS[key];
      if (!spec) continue;
      const value = Number(rawValue);
      this.params[key] = round(clamp(Number.isFinite(value) ? value : spec.target, spec.min, spec.max), 1);
    }
    if (this.batch && !["complete", "ended"].includes(this.batch.status)) {
      this.batch.paramsFinal = { ...this.params };
    }
    return { ...this.params };
  }

  _createBatch() {
    this.batchSerial += 1;
    const id = `B-${String(this.batchSerial).padStart(3, "0")}`;
    const now = Date.now();
    this.batch = {
      id,
      serial: this.batchSerial,
      createdAt: now,
      startedAtMs: null,
      endedAtMs: null,
      status: "ready",
      paramsInitial: { ...this.params },
      paramsFinal: { ...this.params },
      startState: this._deviceState(),
      goodCount: 0,
      wasteCount: 0,
      goodStreak: 0,
      peakPower: 0,
      stopReason: null,
      events: [],
      sheets: [],
      anomalies: [],
      recoveryAudits: []
    };
    this.timeMs = 0;
    this.sheetProgress = 0;
    this.phase = "ready";
    this.devices = createDevices();
    this.fault = null;
    this.rollChange = null;
    this.recoveryAudit = null;
    this.powerKw = 0.38;
    this.transient = { ghost: 0, buildup: 0, registration: 0, strike: false };
    this.rng = mulberry32(this.seed + this.batchSerial * 7919);
    return this.batch;
  }

  _deviceState() {
    return Object.fromEntries(
      Object.entries(this.devices).map(([id, device]) => [
        id,
        { on: device.on, faulted: device.faulted }
      ])
    );
  }

  _clockAt(atMs) {
    const base = this.batch?.createdAt || Date.now();
    return new Date(base + atMs).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  _recordEvent(deviceId, action, reason, extra = {}) {
    if (!this.batch) return;
    const device = DEVICE_DEFS[deviceId] || DEVICE_DEFS.tensionSensor;
    const event = {
      id: `${this.batch.id}-E${this.batch.events.length + 1}`,
      device: deviceId,
      deviceLabel: device.label,
      action,
      atMs: Math.round(this.timeMs),
      clock: this._clockAt(this.timeMs),
      reason,
      ...extra
    };
    this.batch.events.push(event);
    this.eventQueue.push({ type: "device", event });
    return event;
  }

  _setDevice(deviceId, on, reason) {
    const device = this.devices[deviceId];
    if (!device || device.on === on) return false;
    device.on = on;
    if (on) device.faulted = false;
    this._recordEvent(deviceId, on ? "start" : "stop", reason);
    return true;
  }

  _stopAll(reason, faultedDevice = null) {
    for (const id of Object.keys(this.devices)) {
      this._setDevice(id, false, reason);
      if (id === faultedDevice) this.devices[id].faulted = true;
    }
  }

  _startProductionDevices(reason) {
    for (const id of ["feeder", "cylinder", "dryer", "tensionSensor", "cutter", "inkPump"]) {
      this._setDevice(id, true, reason);
    }
  }

  start() {
    if (["complete", "ended"].includes(this.phase)) this._createBatch();
    if (this.phase !== "ready") return false;
    this.batch.status = "running";
    this.batch.startedAtMs = 0;
    this.phase = "running";
    this._startProductionDevices("批次启动");
    this._checkParameterGuard();
    return this.phase === "running";
  }

  pause() {
    if (this.phase !== "running") return false;
    this.phase = "paused";
    this.batch.status = "paused";
    this._stopAll("暂停检查");
    this.powerKw = 0.38;
    return true;
  }

  resume() {
    if (this.phase !== "paused") return false;
    this.phase = "running";
    this.batch.status = "running";
    this._startProductionDevices("暂停检查结束");
    this._checkParameterGuard();
    return this.phase === "running";
  }

  resetCurrentBatch() {
    const previousId = this.batch?.id || null;
    this._stopAll("重置当前批次");
    this._createBatch();
    return previousId;
  }

  endBatch(reason = "操作员结束本批") {
    if (!this.batch || ["complete", "ended"].includes(this.batch.status)) return null;
    const activeFault = this.fault;
    this._stopAll(reason);
    this.batch.status = "ended";
    this.batch.endedAtMs = Math.round(this.timeMs);
    this.batch.stopReason = activeFault
      ? {
          code: activeFault.code,
          device: activeFault.device,
          deviceLabel: DEVICE_DEFS[activeFault.device]?.label || activeFault.deviceLabel,
          text: `设备故障：${activeFault.title}`,
          triggerValue: activeFault.triggerValue,
          threshold: activeFault.threshold
        }
      : {
          code: "manual-end",
          device: null,
          deviceLabel: "操作员",
          text: reason,
          triggerValue: null,
          threshold: null
        };
    this.fault = null;
    this.rollChange = null;
    this.recoveryAudit = null;
    this.phase = "ended";
    this.powerKw = 0.38;
    return this._archiveBatch();
  }

  changeRoll() {
    if (this.phase !== "running") return false;
    this.phase = "rollChange";
    this.batch.status = "rollChange";
    this._setDevice("inkPump", false, "换纸卷 · 供墨联锁");
    for (const id of ROLL_STOP_ORDER.filter((item) => item !== "inkPump")) {
      this._setDevice(id, false, "换纸卷");
    }
    if (this.sheetProgress > 0.08) {
      this.batch.wasteCount += 1;
      this.batch.goodStreak = 0;
      this.batch.sheets.push({
        n: this.batch.sheets.length + 1,
        good: false,
        defects: ["换卷中断"],
        atMs: Math.round(this.timeMs)
      });
    }
    this.sheetProgress = 0;
    this.rollChange = { active: true, elapsedMs: 0, durationMs: ROLL_CHANGE_MS };
    const anomaly = {
      id: `${this.batch.id}-A${this.batch.anomalies.length + 1}`,
      type: "rollChange",
      title: "换纸卷联锁",
      detail: "供墨泵先于纸带驱动停止，换卷期间禁止供墨。",
      atMs: Math.round(this.timeMs),
      clock: this._clockAt(this.timeMs),
      deviceLabel: DEVICE_DEFS.inkPump.label,
      triggerValue: "供墨 0%",
      threshold: "换卷期间必须为 0",
      handled: true
    };
    this.batch.anomalies.push(anomaly);
    this.eventQueue.push({ type: "rollChange", active: true });
    return true;
  }

  _finishRollChange() {
    for (const id of ROLL_START_ORDER) {
      this._setDevice(id, true, id === "inkPump" ? "换纸卷完成 · 供墨恢复" : "换纸卷完成");
    }
    this.rollChange = null;
    this.phase = "running";
    this.batch.status = "running";
    this.sheetProgress = 0;
    this.eventQueue.push({ type: "rollChange", active: false });
  }

  injectFault(type) {
    const faultType = FAULT_TYPES[type];
    if (!faultType || !["running", "paused"].includes(this.phase)) return false;
    this._triggerFault({
      source: "equipment",
      code: type,
      ...faultType,
      numericValue: null
    });
    return true;
  }

  _triggerFault(fault) {
    if (this.fault) return;
    this.fault = {
      ...fault,
      atMs: Math.round(this.timeMs),
      clock: this._clockAt(this.timeMs)
    };
    const previousPhase = this.phase;
    this.phase = "faulted";
    this.batch.status = "faulted";
    this.batch.goodStreak = 0;
    this._stopAll(`设备故障：${fault.title}`, fault.device);
    this.devices[fault.device].faulted = true;
    this.powerKw = 0.38;
    this.transient.strike = false;
    if (previousPhase === "rollChange") this.rollChange = null;
    const anomaly = {
      id: `${this.batch.id}-A${this.batch.anomalies.length + 1}`,
      type: "fault",
      source: fault.source,
      title: fault.title,
      detail: fault.detail,
      atMs: Math.round(this.timeMs),
      clock: this._clockAt(this.timeMs),
      device: fault.device,
      deviceLabel: DEVICE_DEFS[fault.device]?.label || fault.deviceLabel,
      triggerLabel: fault.triggerLabel,
      triggerValue: fault.triggerValue,
      threshold: fault.threshold,
      impact: fault.impact,
      handled: false
    };
    this.batch.anomalies.push(anomaly);
    if (this.recoveryAudit && !this.recoveryAudit.finished) {
      this.recoveryAudit.failed = true;
      this.recoveryAudit.errors.push(`故障复发：${fault.title}`);
    }
    this.eventQueue.push({ type: "fault", fault: { ...this.fault } });
  }

  recoverFault() {
    if (this.phase !== "faulted" || !this.fault) return false;
    const resolved = { ...this.fault };
    const anomaly = [...this.batch.anomalies]
      .reverse()
      .find((item) => item.type === "fault" && !item.handled);
    if (anomaly) {
      anomaly.handled = true;
      anomaly.resolvedAtMs = Math.round(this.timeMs);
      anomaly.resolution = "故障已排除，进入 5 秒恢复审计";
    }
    this.batch.anomalies.push({
      id: `${this.batch.id}-A${this.batch.anomalies.length + 1}`,
      type: "recovery",
      source: resolved.source,
      title: "异常恢复",
      detail: `已排除「${resolved.title}」，持续运行 5 秒进行状态残留检查。`,
      atMs: Math.round(this.timeMs),
      clock: this._clockAt(this.timeMs),
      device: resolved.device,
      deviceLabel: DEVICE_DEFS[resolved.device]?.label || resolved.deviceLabel,
      triggerValue: resolved.triggerValue,
      threshold: resolved.threshold,
      handled: true
    });
    this.fault = null;
    Object.values(this.devices).forEach((device) => {
      device.faulted = false;
    });
    this.transient = { ghost: 0, buildup: 0, registration: 0, strike: false };
    this.sheetProgress = 0;
    this.phase = "running";
    this.batch.status = "running";
    this._startProductionDevices("故障恢复");
    this._beginRecoveryAudit(resolved);
    this._checkParameterGuard();
    return this.phase === "running";
  }

  _beginRecoveryAudit(resolvedFault) {
    const audit = {
      id: `${this.batch.id}-R${this.batch.recoveryAudits.length + 1}`,
      faultTitle: resolvedFault.title,
      startedAtMs: Math.round(this.timeMs),
      durationMs: RECOVERY_AUDIT_MS,
      elapsedMs: 0,
      startGood: this.batch.goodCount,
      startWaste: this.batch.wasteCount,
      startSheets: this.batch.sheets.length,
      errors: [],
      failed: false,
      finished: false,
      passed: null
    };
    this.batch.recoveryAudits.push(audit);
    this.recoveryAudit = audit;
  }

  update(dtMs) {
    if (!this.batch || !["running", "rollChange"].includes(this.phase)) return;
    const dt = clamp(Number(dtMs) || 0, 0, 250);
    if (dt <= 0) return;
    this.timeMs += dt;
    this._updatePower();

    if (this.phase === "rollChange" && this.rollChange) {
      this.rollChange.elapsedMs += dt;
      this._updateRecoveryAudit(dt);
      if (this.rollChange.elapsedMs >= this.rollChange.durationMs) {
        this._finishRollChange();
      }
      return;
    }

    if (this.phase !== "running") return;
    this._checkParameterGuard();
    if (this.phase !== "running") return;
    this._updateRecoveryAudit(dt);
    this.sheetProgress += dt / SHEET_CYCLE_MS;
    if (this.sheetProgress >= 1) {
      this.sheetProgress -= 1;
      this._produceSheet();
    }
  }

  _updatePower() {
    if (!["running", "rollChange"].includes(this.phase)) {
      this.powerKw = 0.38;
      return;
    }
    let power = 0.38;
    if (this.devices.feeder.on) power += 0.62;
    if (this.devices.cylinder.on) power += 2.84;
    if (this.devices.dryer.on) power += 1.25 + this.params.dryer * 0.024;
    if (this.devices.cutter.on) power += 0.58;
    if (this.devices.inkPump.on) power += 0.46 + this.params.ink * 0.006;
    this.powerKw = round(power, 2);
    this.batch.peakPower = Math.max(this.batch.peakPower, this.powerKw);
  }

  _checkParameterGuard() {
    if (!["running", "paused"].includes(this.phase)) return false;
    const deviceForParam = {
      pressure: "cylinder",
      ink: "inkPump",
      dryer: "dryer",
      tension: "tensionSensor"
    };
    const impactForParam = {
      pressure: "滚筒过载 / 套准失控",
      ink: "墨量超过纸张吸收上限，发生透印",
      dryer: "风道过载 / 干燥失控",
      tension: "纸带断裂风险 / 套准漂移"
    };
    for (const [key, spec] of Object.entries(PARAM_SPECS)) {
      const value = this.params[key];
      const [hardLow, hardHigh] = spec.hard;
      if (value >= hardLow && value <= hardHigh) continue;
      const device = deviceForParam[key];
      this._triggerFault({
        source: "limit",
        code: `limit:${key}`,
        device,
        title: `参数越限 · ${spec.label}`,
        detail: `${spec.label}超出设备硬限，保护回路已切断主驱动。`,
        triggerLabel: spec.label,
        triggerValue: `${value.toFixed(1)} ${spec.unit}`,
        numericValue: value,
        threshold: `硬限 ${hardLow}–${hardHigh} ${spec.unit}`,
        impact: impactForParam[key],
        advice: `先将${spec.label}调回 ${spec.safe[0]}–${spec.safe[1]} ${spec.unit}，再执行恢复。`
      });
      return true;
    }
    return false;
  }

  _calculateSheet() {
    const p = this.params;
    const noise = (this.rng() - 0.5) * 0.014;
    const registrationMm = Math.abs((p.pressure - 52) * 0.014 + (p.tension - 50) * 0.01 + noise);
    const ghost = Math.max(0, Math.abs(p.pressure - 52) - 2.5) * 0.05
      + Math.max(0, Math.abs(p.tension - 50) - 5) * 0.02;
    const buildup = clamp((p.ink - 58) / 25, 0, 1)
      * clamp((70 - p.dryer) / 30, 0, 1);
    const strikeThrough = p.ink >= 82 || (p.ink >= 76 && p.dryer <= 42);
    const wetness = clamp((46 - p.dryer) / 22 + (p.ink - 60) / 70, 0, 1);
    const defects = [];
    if (registrationMm > 0.12) defects.push("套准偏差");
    if (ghost > 0.18) defects.push("重影");
    if (buildup > 0.2) defects.push("油墨堆积");
    if (strikeThrough) defects.push("透印");
    if (p.dryer < PARAM_SPECS.dryer.safe[0]) defects.push("干燥不足");
    if (p.tension < PARAM_SPECS.tension.safe[0] || p.tension > PARAM_SPECS.tension.safe[1]) {
      defects.push("张力波动");
    }
    return {
      good: defects.length === 0,
      defects,
      metrics: {
        registrationMm: round(registrationMm, 3),
        ghost: round(ghost, 3),
        buildup: round(buildup, 3),
        inkFilm: round(p.ink / 100, 3),
        wetness: round(wetness, 3),
        strikeThrough
      }
    };
  }

  _produceSheet() {
    if (this.phase !== "running") return;
    const measurement = this._calculateSheet();
    const sheet = {
      n: this.batch.sheets.length + 1,
      good: measurement.good,
      defects: measurement.defects,
      metrics: measurement.metrics,
      atMs: Math.round(this.timeMs)
    };
    this.batch.sheets.push(sheet);
    this.transient = {
      ghost: measurement.metrics.ghost,
      buildup: measurement.metrics.buildup,
      registration: measurement.metrics.registrationMm,
      strike: measurement.metrics.strikeThrough
    };
    if (sheet.good) {
      this.batch.goodCount += 1;
      this.batch.goodStreak += 1;
    } else {
      this.batch.wasteCount += 1;
      this.batch.goodStreak = 0;
    }
    this.eventQueue.push({ type: "sheet", sheet: { ...sheet } });
    if (this.batch.goodStreak >= 10) this._completeBatch();
  }

  _completeBatch() {
    const reason = {
      code: "ten-good",
      device: null,
      deviceLabel: "生产控制",
      text: "连续 10 张合格，批次完成",
      triggerValue: "10 / 10",
      threshold: "连续合格 ≥ 10"
    };
    this._stopAll("批次完成");
    this.batch.status = "completed";
    this.batch.endedAtMs = Math.round(this.timeMs);
    this.batch.stopReason = reason;
    this.batch.paramsFinal = { ...this.params };
    this.phase = "complete";
    this.powerKw = 0.38;
    this.eventQueue.push({ type: "batchComplete", batchId: this.batch.id });
    return this._archiveBatch();
  }

  _archiveBatch() {
    this.batch.paramsFinal = { ...this.params };
    const archived = deepFreeze(this.batch);
    this.history.push(archived);
    this.eventQueue.push({ type: "batchArchived", batchId: archived.id });
    return archived;
  }

  _updateRecoveryAudit(dt) {
    const audit = this.recoveryAudit;
    if (!audit || audit.finished) return;
    audit.elapsedMs += dt;
    const addError = (message) => {
      if (!audit.errors.includes(message)) {
        audit.failed = true;
        audit.errors.push(message);
      }
    };
    if (this.fault) addError(`故障未清除：${this.fault.title}`);
    if (this.rollChange?.active && this.devices.inkPump.on) {
      addError("换卷期间供墨泵仍在运行");
    }
    Object.entries(this.devices).forEach(([id, device]) => {
      if (device.faulted) addError(`${DEVICE_DEFS[id].label}故障锁存残留`);
    });
    if (this.phase === "running") {
      const required = ["feeder", "inkPump", "cylinder", "dryer", "cutter", "tensionSensor"];
      required.forEach((id) => {
        if (!this.devices[id].on) addError(`${DEVICE_DEFS[id].label}状态残留：应运行却停止`);
      });
    }
    if (this.batch.goodCount < audit.startGood || this.batch.wasteCount < audit.startWaste) {
      addError("计数器出现回退");
    }
    const completed = this.batch.sheets.length - audit.startSheets;
    const counted = this.batch.goodCount - audit.startGood + this.batch.wasteCount - audit.startWaste;
    if (counted > completed || counted < 0) addError("计数增量与裁切页数不一致");
    if (audit.elapsedMs >= audit.durationMs) {
      audit.elapsedMs = audit.durationMs;
      audit.finished = true;
      audit.passed = !audit.failed && !this.fault && this.phase === "running";
      this.eventQueue.push({ type: "recoveryAudit", audit: { ...audit, errors: [...audit.errors] } });
    }
  }

  getInvariantReport() {
    const audit = this.recoveryAudit;
    return {
      passed: audit ? audit.passed : null,
      finished: audit ? audit.finished : false,
      activeFault: Boolean(this.fault),
      illegalInkSupply: Boolean(this.rollChange?.active && this.devices.inkPump.on),
      stoppedDevicesRunning: this.phase === "faulted"
        ? Object.values(this.devices).filter((device) => device.on).length
        : 0,
      errors: audit ? [...audit.errors] : []
    };
  }

  saveSnapshot(label = "") {
    this.snapshotSerial += 1;
    const snapshot = deepFreeze({
      id: `S-${String(this.snapshotSerial).padStart(3, "0")}`,
      label: label || `批次 ${this.batch.id} 状态`,
      createdAt: Date.now(),
      batchId: this.batch.id,
      phase: this.phase,
      params: { ...this.params },
      devices: this._deviceState(),
      metrics: {
        goodCount: this.batch.goodCount,
        wasteCount: this.batch.wasteCount,
        peakPower: this.batch.peakPower
      }
    });
    this.snapshots.push(snapshot);
    return snapshot;
  }

  prepareSnapshotRun(snapshotId) {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return null;
    if (this.batch && !["complete", "ended"].includes(this.batch.status)) {
      this.endBatch(`切换快照 ${snapshot.id} 前结束当前批次`);
    }
    this.params = { ...snapshot.params };
    this._createBatch();
    this.batch.snapshotOrigin = snapshot.id;
    return this.batch;
  }

  drainEvents() {
    return this.eventQueue.splice(0);
  }

  getHistory() {
    return this.history.slice();
  }

  getSnapshots() {
    return this.snapshots.slice();
  }
}
