export const POWDERS = Object.freeze({
  A: Object.freeze({ id: "A", name: "基体树脂", short: "基体", color: "#dbb06f", density: 1.18 }),
  B: Object.freeze({ id: "B", name: "矿质填充", short: "填充", color: "#8db4a4", density: 2.62 }),
  C: Object.freeze({ id: "C", name: "活性色粉", short: "色粉", color: "#d16750", density: 0.91 }),
});

export const RECOMMENDED_ORDER = Object.freeze(["B", "A", "C"]);

export const PARAM_LIMITS = Object.freeze({
  rpm: Object.freeze({ min: 20, max: 110, safeMin: 55, safeMax: 105, unit: "rpm", label: "滚筒转速" }),
  mixTime: Object.freeze({ min: 8, max: 120, safeMin: 30, safeMax: 95, unit: "s", label: "混合时间" }),
  valve: Object.freeze({ min: 5, max: 90, safeMin: 20, safeMax: 65, unit: "%", label: "出料阀开度" }),
});

export const STAGE_LABELS = Object.freeze({
  idle: "待开机",
  feeding: "加料中",
  mixing: "混合中",
  discharging: "出料中",
  complete: "批次完成",
  interlock: "联锁停机",
});

export const RECOVERY_WINDOW = 8;
export const FEED_DURATION = 6;
export const DISCHARGE_DURATION = 6;

export const FAULT_CATALOG = Object.freeze({
  motor_overheat: Object.freeze({
    id: "motor_overheat",
    equipmentId: "motor",
    equipmentName: "主电机 M-01",
    trigger: "绕组温度",
    value: 106.8,
    unit: "°C",
    threshold: 95,
    phase: "mixing",
    delay: 3.2,
    message: "绕组温度超过联锁阈值，变频器已切断主电机输出。",
  }),
  fan_stall: Object.freeze({
    id: "fan_stall",
    equipmentId: "fan",
    equipmentName: "除尘风机 F-02",
    trigger: "实际风量",
    value: 31,
    unit: "m³/h",
    threshold: 120,
    phase: "feeding",
    delay: 1.7,
    message: "风机转速反馈丢失，筒内微正压导致粉尘外逸风险。",
  }),
  valve_jam: Object.freeze({
    id: "valve_jam",
    equipmentId: "valve",
    equipmentName: "出料阀 V-04",
    trigger: "阀位反馈偏差",
    value: 27,
    unit: "%",
    threshold: 12,
    phase: "discharging",
    delay: 1.1,
    message: "阀位指令与反馈偏差过大，出料流量不可控。",
  }),
  inverter_comm: Object.freeze({
    id: "inverter_comm",
    equipmentId: "inverter",
    equipmentName: "变频器 VFD-01",
    trigger: "通讯响应时间",
    value: 2800,
    unit: "ms",
    threshold: 1500,
    phase: "mixing",
    delay: 2.4,
    message: "控制总线连续超时，主传动进入安全停机。",
  }),
});

const DEFAULT_PARAMS = Object.freeze({
  feedOrder: ["B", "A", "C"],
  rpm: 82,
  mixTime: 42,
  valve: 44,
  fault: "",
});

const EQUIPMENT_DEFS = Object.freeze([
  { id: "feeder", name: "螺旋加料机", code: "SC-03" },
  { id: "motor", name: "主电机", code: "M-01" },
  { id: "fan", name: "除尘风机", code: "F-02" },
  { id: "valve", name: "出料阀", code: "V-04" },
  { id: "inverter", name: "主变频器", code: "VFD-01" },
]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 1) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function formatClock(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function equipmentSnapshot() {
  return Object.fromEntries(
    EQUIPMENT_DEFS.map((item) => [
      item.id,
      {
        ...item,
        status: "standby",
        startedAt: null,
        stoppedAt: null,
        startCount: 0,
        stopCount: 0,
      },
    ]),
  );
}

function sanitizeParams(params = {}) {
  const source = { ...DEFAULT_PARAMS, ...params };
  const order = Array.isArray(source.feedOrder) ? [...source.feedOrder] : [...DEFAULT_PARAMS.feedOrder];
  const uniqueOrder = ["A", "B", "C"].every((id) => order.includes(id)) && new Set(order).size === 3
    ? order
    : [...DEFAULT_PARAMS.feedOrder];
  return {
    feedOrder: uniqueOrder,
    rpm: clamp(Number(source.rpm) || DEFAULT_PARAMS.rpm, 0, 180),
    mixTime: clamp(Number(source.mixTime) || DEFAULT_PARAMS.mixTime, 1, 180),
    valve: clamp(Number(source.valve) || 0, 0, 100),
    fault: FAULT_CATALOG[source.fault] ? source.fault : "",
  };
}

export class PowderMixSimulator {
  constructor(options = {}) {
    this.batchNumber = options.batchNumber || 1;
    this.reset(options.params);
  }

  reset(params = this.state?.params) {
    const nextParams = sanitizeParams(params || DEFAULT_PARAMS);
    this.state = {
      batchNumber: this.batchNumber,
      phase: "idle",
      stageElapsed: 0,
      stageDuration: 0,
      elapsed: 0,
      running: false,
      paused: false,
      failed: false,
      completed: false,
      params: nextParams,
      feedIndex: 0,
      uniformity: 8,
      initialUniformity: 8,
      agglomeration: 0,
      stratification: 0,
      entrainment: 0,
      power: 0,
      peakPower: 0,
      energy: 0,
      errorCount: 0,
      equipment: equipmentSnapshot(),
      events: [],
      samples: this.emptySamples(),
      failure: null,
      armedFault: nextParams.fault || null,
      incidents: [],
      latches: {
        motorOverheat: false,
        fanStall: false,
        valveJam: false,
        commTimeout: false,
      },
      signals: {
        motorTemp: 38,
        fanFlow: 0,
        valveFeedback: 0,
        commLatency: 12,
      },
      recovery: null,
      recoveryVerification: null,
      result: null,
      seed: this.batchNumber * 7919 + nextParams.rpm * 13,
    };
    this.addEvent("system", "批次控制器", `${this.batchId()} 已复位`, "inspect");
    return this.state;
  }

  batchId() {
    return `B-${String(this.batchNumber).padStart(3, "0")}`;
  }

  emptySamples() {
    return [0, 1, 2, 3, 4].map((index) => ({
      id: index + 1,
      label: `S${index + 1}`,
      value: null,
      x: 0.14 + index * 0.18,
    }));
  }

  setParams(partial) {
    if (this.state.running && !this.state.paused) {
      return { ok: false, message: "运行中不能修改配方参数" };
    }
    if (this.state.failed) {
      return { ok: false, message: "请先处理当前联锁故障" };
    }
    this.state.params = sanitizeParams({ ...this.state.params, ...partial });
    this.state.armedFault = this.state.params.fault || null;
    return { ok: true, params: { ...this.state.params } };
  }

  addEvent(deviceId, deviceName, detail, type = "info", at = this.state.elapsed) {
    const event = {
      id: `${this.batchId()}-${this.state.events.length + 1}`,
      time: round(at, 1),
      deviceId,
      deviceName,
      detail,
      type,
    };
    this.state.events.push(event);
    return event;
  }

  startEquipment(id, detail = "启动") {
    const device = this.state.equipment[id];
    if (!device || device.status === "running") return;
    device.status = "running";
    device.startedAt = round(this.state.elapsed, 1);
    device.startCount += 1;
    this.addEvent(id, `${device.name} ${device.code}`, detail, "start");
  }

  stopEquipment(id, detail = "停止") {
    const device = this.state.equipment[id];
    if (!device || device.status !== "running") return;
    device.status = "standby";
    device.stoppedAt = round(this.state.elapsed, 1);
    device.stopCount += 1;
    this.addEvent(id, `${device.name} ${device.code}`, detail, "stop");
  }

  findLimitFailure() {
    const { rpm, mixTime, valve } = this.state.params;
    if (rpm < PARAM_LIMITS.rpm.min || rpm > PARAM_LIMITS.rpm.max) {
      return {
        kind: "limit",
        code: "LIMIT_RPM",
        equipmentId: "motor",
        equipmentName: "主电机 M-01",
        trigger: "滚筒转速",
        value: rpm,
        unit: "rpm",
        threshold: rpm > PARAM_LIMITS.rpm.max ? PARAM_LIMITS.rpm.max : PARAM_LIMITS.rpm.min,
        thresholdText: `${PARAM_LIMITS.rpm.min}–${PARAM_LIMITS.rpm.max} rpm`,
        message: `转速 ${rpm} rpm 超出主传动允许范围，变频器拒绝输出。`,
        alarmKey: "motorOverheat",
      };
    }
    if (mixTime < PARAM_LIMITS.mixTime.min || mixTime > PARAM_LIMITS.mixTime.max) {
      return {
        kind: "limit",
        code: "LIMIT_TIME",
        equipmentId: "timer",
        equipmentName: "批次计时器 T-01",
        trigger: "混合时长",
        value: mixTime,
        unit: "s",
        threshold: mixTime > PARAM_LIMITS.mixTime.max ? PARAM_LIMITS.mixTime.max : PARAM_LIMITS.mixTime.min,
        thresholdText: `${PARAM_LIMITS.mixTime.min}–${PARAM_LIMITS.mixTime.max} s`,
        message: `混合时长 ${mixTime} s 超出计时器允许范围，批次预检未通过。`,
        alarmKey: "commTimeout",
      };
    }
    if (valve < PARAM_LIMITS.valve.min || valve > PARAM_LIMITS.valve.max) {
      return {
        kind: "limit",
        code: "LIMIT_VALVE",
        equipmentId: "valve",
        equipmentName: "出料阀 V-04",
        trigger: "出料阀开度",
        value: valve,
        unit: "%",
        threshold: valve > PARAM_LIMITS.valve.max ? PARAM_LIMITS.valve.max : PARAM_LIMITS.valve.min,
        thresholdText: `${PARAM_LIMITS.valve.min}–${PARAM_LIMITS.valve.max}%`,
        message: `出料阀指令 ${valve}% 超出机械行程，联锁阻止批次启动。`,
        alarmKey: "valveJam",
      };
    }
    return null;
  }

  start() {
    if (this.state.running && !this.state.completed) {
      return { ok: false, message: "批次正在运行" };
    }
    if (this.state.failed) {
      return { ok: false, message: "请先处理当前联锁故障" };
    }
    if (this.state.completed) {
      return { ok: false, message: "当前批次已经封存，请重置或载入快照" };
    }

    const limitFailure = this.findLimitFailure();
    if (limitFailure) {
      this.triggerParameterFailure(limitFailure);
      return { ok: false, failure: this.state.failure };
    }

    this.beginProduction("批次启动");
    return { ok: true };
  }

  beginProduction(reason) {
    const orderScore = this.orderScore();
    this.state.phase = "feeding";
    this.state.stageElapsed = 0;
    this.state.stageDuration = FEED_DURATION;
    this.state.running = true;
    this.state.paused = false;
    this.state.failed = false;
    this.state.completed = false;
    this.state.failure = null;
    this.state.feedIndex = 0;
    this.state.initialUniformity = 8 + orderScore * 2;
    this.state.uniformity = this.state.initialUniformity;
    this.state.armedFault = this.state.params.fault || null;
    this.addEvent("system", "批次控制器", `${reason} · 顺序 ${this.state.params.feedOrder.join("→")}`, "start");
    this.startEquipment("feeder", "加料启动");
    this.startEquipment("fan", "除尘联动启动");
    this.updateDerived(0);
  }

  triggerParameterFailure(failure) {
    this.state.phase = "interlock";
    this.state.running = true;
    this.state.paused = true;
    this.state.failed = true;
    this.state.errorCount += 1;
    const record = {
      ...failure,
      at: round(this.state.elapsed, 1),
      valueText: `${failure.value} ${failure.unit}`.trim(),
      recovered: false,
    };
    this.state.failure = record;
    this.state.incidents.push({
      type: "failure",
      kind: "limit",
      equipmentName: failure.equipmentName,
      trigger: failure.trigger,
      valueText: record.valueText,
      thresholdText: failure.thresholdText,
      at: record.at,
      detail: failure.message,
      recovered: false,
    });
    if (failure.alarmKey && failure.alarmKey in this.state.latches) {
      this.state.latches[failure.alarmKey] = true;
    }
    this.addEvent(
      failure.equipmentId,
      failure.equipmentName,
      `参数联锁 · ${failure.trigger} ${record.valueText}（限值 ${failure.thresholdText}）`,
      "alarm",
    );
  }

  triggerEquipmentFailure() {
    const catalog = FAULT_CATALOG[this.state.armedFault];
    if (!catalog || this.state.failed || this.state.recovery?.active) return false;

    for (const id of Object.keys(this.state.equipment)) {
      this.stopEquipment(id, "联锁停机");
    }
    const device = this.state.equipment[catalog.equipmentId];
    if (device) device.status = "fault";
    this.state.phaseBeforeFailure = this.state.phase;
    this.state.failed = true;
    this.state.paused = true;
    this.state.armedFault = null;
    this.state.errorCount += 1;
    const latchMap = {
      motor_overheat: "motorOverheat",
      fan_stall: "fanStall",
      valve_jam: "valveJam",
      inverter_comm: "commTimeout",
    };
    const latch = latchMap[catalog.id];
    if (latch) this.state.latches[latch] = true;

    if (catalog.equipmentId === "motor") this.state.signals.motorTemp = catalog.value;
    if (catalog.equipmentId === "fan") this.state.signals.fanFlow = catalog.value;
    if (catalog.equipmentId === "valve") this.state.signals.valveFeedback = this.state.params.valve + catalog.value;
    if (catalog.equipmentId === "inverter") this.state.signals.commLatency = catalog.value;

    const record = {
      ...catalog,
      kind: "equipment",
      valueText: `${catalog.value} ${catalog.unit}`,
      thresholdText: `${catalog.threshold} ${catalog.unit}`,
      at: round(this.state.elapsed, 1),
      recovered: false,
    };
    this.state.failure = record;
    this.state.incidents.push({
      type: "failure",
      kind: "equipment",
      equipmentName: catalog.equipmentName,
      trigger: catalog.trigger,
      valueText: record.valueText,
      thresholdText: record.thresholdText,
      at: record.at,
      detail: catalog.message,
      recovered: false,
    });
    this.addEvent(
      catalog.equipmentId,
      catalog.equipmentName,
      `联锁停机 · ${catalog.trigger} ${record.valueText}（阈值 ${record.thresholdText}）`,
      "alarm",
    );
    this.updateDerived(0);
    return true;
  }

  recover() {
    if (!this.state.failure) return { ok: false, message: "当前没有待恢复故障" };
    const previousFailure = this.state.failure;
    const baselineErrors = this.state.errorCount;

    for (const device of Object.values(this.state.equipment)) {
      if (device.status === "fault") device.status = "standby";
    }
    Object.keys(this.state.latches).forEach((key) => {
      this.state.latches[key] = false;
    });
    this.state.signals.commLatency = 12;
    this.state.failure = null;
    this.state.failed = false;
    this.state.paused = false;

    if (previousFailure.kind === "limit") {
      this.state.params.rpm = clamp(this.state.params.rpm, PARAM_LIMITS.rpm.min, PARAM_LIMITS.rpm.safeMax);
      this.state.params.mixTime = clamp(this.state.params.mixTime, PARAM_LIMITS.mixTime.safeMin, PARAM_LIMITS.mixTime.safeMax);
      this.state.params.valve = clamp(this.state.params.valve, PARAM_LIMITS.valve.safeMin, PARAM_LIMITS.valve.safeMax);
      this.state.phase = "idle";
      this.state.running = false;
      this.beginProduction("参数限幅后恢复");
    } else {
      this.resumeEquipmentForPhase();
      this.addEvent(
        previousFailure.equipmentId,
        previousFailure.equipmentName,
        "人工复位 · 设备恢复启动",
        "recovery",
      );
    }

    this.state.recovery = {
      active: true,
      elapsed: 0,
      required: RECOVERY_WINDOW,
      baselineErrors,
      source: previousFailure.equipmentName,
      startedAt: round(this.state.elapsed, 1),
      passed: null,
    };
    const incident = [...this.state.incidents].reverse().find((item) => item.type === "failure" && !item.recovered);
    if (incident) {
      incident.recovered = true;
      incident.recoveredAt = round(this.state.elapsed, 1);
    }
    return { ok: true, recovery: { ...this.state.recovery } };
  }

  resumeEquipmentForPhase() {
    if (this.state.phase === "feeding") {
      this.startEquipment("feeder", "恢复后继续加料");
      this.startEquipment("fan", "恢复后继续除尘");
    } else if (this.state.phase === "mixing") {
      this.startEquipment("motor", "恢复后继续混合");
      this.startEquipment("fan", "恢复后继续除尘");
    } else if (this.state.phase === "discharging") {
      this.startEquipment("fan", "恢复后继续除尘");
      this.startEquipment("valve", `恢复后继续出料 · ${this.state.params.valve}%`);
    }
  }

  togglePause() {
    if (!this.state.running || this.state.failed || this.state.completed) {
      return { ok: false, paused: this.state.paused };
    }
    this.state.paused = !this.state.paused;
    this.addEvent(
      "system",
      "检查员",
      this.state.paused ? "检查暂停 · 时间与状态冻结" : "检查结束 · 继续运行",
      "inspect",
    );
    return { ok: true, paused: this.state.paused };
  }

  orderScore() {
    return this.state.params.feedOrder.reduce(
      (score, id, index) => score + (RECOMMENDED_ORDER[index] === id ? 1 : 0),
      0,
    ) / 3;
  }

  step(dt) {
    const delta = clamp(Number(dt) || 0, 0, 2);
    if (!this.state.running || this.state.paused || this.state.failed || this.state.completed) {
      return this.state;
    }
    this.state.elapsed = round(this.state.elapsed + delta, 2);
    this.updateStage(delta);

    if (this.state.recovery?.active && !this.state.failed) {
      this.state.recovery.elapsed = round(this.state.recovery.elapsed + delta, 2);
      if (this.state.recovery.elapsed >= this.state.recovery.required) {
        this.verifyRecovery();
      }
    }

    this.updateDerived(delta);
    if (this.state.phase === "complete" && !this.state.result && !this.state.recovery?.active) {
      this.finishBatch();
    }
    return this.state;
  }

  updateStage(dt) {
    if (this.state.failed || this.state.phase === "complete") return;
    this.state.stageElapsed = round(this.state.stageElapsed + dt, 2);
    this.maybeInjectFault();
    if (this.state.failed) return;

    if (this.state.phase === "feeding") {
      const progress = clamp(this.state.stageElapsed / this.state.stageDuration, 0, 1);
      this.state.feedIndex = Math.min(3, Math.floor(progress * 3));
      this.state.uniformity = this.state.initialUniformity + progress * 5;
      if (this.state.stageElapsed >= this.state.stageDuration) {
        this.stopEquipment("feeder", "三组分加料完成");
        this.startEquipment("motor", `混合启动 · ${this.state.params.rpm} rpm`);
        this.state.phase = "mixing";
        this.state.stageElapsed = 0;
        this.state.stageDuration = this.state.params.mixTime;
        this.addEvent("system", "批次控制器", "加料完成 · 进入混合阶段", "info");
      }
      return;
    }

    if (this.state.phase === "mixing") {
      this.updateMixing(dt);
      if (this.state.stageElapsed >= this.state.stageDuration) {
        this.stopEquipment("motor", "混合计时完成");
        this.startEquipment("valve", `出料启动 · 开度 ${this.state.params.valve}%`);
        this.state.phase = "discharging";
        this.state.stageElapsed = 0;
        this.state.stageDuration = DISCHARGE_DURATION;
        this.addEvent("system", "批次控制器", "混合完成 · 进入出料阶段", "info");
      }
      return;
    }

    if (this.state.phase === "discharging") {
      this.updateDischarge(dt);
      if (this.state.stageElapsed >= this.state.stageDuration) {
        this.stopEquipment("valve", "出料完成 · 阀门关闭");
        this.stopEquipment("fan", "除尘停机");
        this.state.phase = "complete";
        this.state.stageElapsed = this.state.stageDuration;
        this.addEvent("system", "批次控制器", "出料完成 · 等待批次封存", "info");
      }
    }
  }

  maybeInjectFault() {
    const catalog = FAULT_CATALOG[this.state.armedFault];
    if (!catalog || this.state.failed || this.state.recovery?.active) return;
    if (this.state.phase === catalog.phase && this.state.stageElapsed >= catalog.delay) {
      this.triggerEquipmentFailure();
    }
  }

  rpmFactor() {
    const rpm = this.state.params.rpm;
    if (rpm < PARAM_LIMITS.rpm.safeMin) {
      return 0.28 + ((rpm - 10) / 45) * 0.5;
    }
    if (rpm <= 100) {
      return 0.78 + ((rpm - PARAM_LIMITS.rpm.safeMin) / 45) * 0.42;
    }
    return Math.max(0.15, 1.2 - (rpm - 100) * 0.055);
  }

  updateMixing(dt) {
    const rpm = this.state.params.rpm;
    const progress = clamp(this.state.stageElapsed / this.state.stageDuration, 0, 1);
    const rpmEffect = this.rpmFactor();
    const timeEffect = clamp(0.45 + this.state.params.mixTime / 80, 0.5, 1.2);
    const equilibrium = clamp(18 + 45 * rpmEffect + 25 * timeEffect + 8 * this.orderScore(), 25, 98);
    const rate = 0.045 + rpmEffect * 0.055;
    this.state.uniformity += (equilibrium - this.state.uniformity) * (1 - Math.exp(-rate * dt));

    if (rpm > 100) {
      this.state.agglomeration += (rpm - 100) * 0.11 * (0.55 + progress * 0.65) * dt;
    }
    if (rpm < PARAM_LIMITS.rpm.safeMin) {
      this.state.stratification += (PARAM_LIMITS.rpm.safeMin - rpm) * 0.045 * (0.5 + progress) * dt;
    }
    this.state.uniformity -= (this.state.agglomeration * 0.012 + this.state.stratification * 0.008) * dt;
    this.state.uniformity = clamp(this.state.uniformity, 5, 99.2);
    this.state.agglomeration = clamp(this.state.agglomeration, 0, 45);
    this.state.stratification = clamp(this.state.stratification, 0, 40);
    this.state.samples = this.getSampleValues();
  }

  updateDischarge(dt) {
    const valve = this.state.params.valve;
    if (valve > 65 && this.state.uniformity < 85) {
      const openingRisk = (valve - 65) / 35;
      const qualityRisk = (85 - this.state.uniformity) / 70;
      this.state.entrainment += (0.25 + openingRisk * qualityRisk * 14) * dt;
    }
    if (valve > 82) {
      this.state.entrainment += (valve - 82) * 0.055 * dt;
    }
    this.state.entrainment = clamp(this.state.entrainment, 0, 60);
    this.state.samples = this.getSampleValues();
  }

  updateDerived(dt) {
    if (this.state.failed) {
      this.state.power = 0;
      return;
    }
    if (!this.state.running) return;

    let targetPower = 0;
    if (this.state.phase === "feeding") {
      targetPower = (this.state.equipment.feeder.status === "running" ? 1.3 : 0)
        + (this.state.equipment.fan.status === "running" ? 1.25 : 0);
    } else if (this.state.phase === "mixing") {
      targetPower = (this.state.equipment.motor.status === "running"
        ? 1.2 + (this.state.params.rpm / 100) ** 2 * 5.6 + this.state.agglomeration * 0.025
        : 0) + (this.state.equipment.fan.status === "running" ? 1.3 : 0);
    } else if (this.state.phase === "discharging") {
      targetPower = (this.state.equipment.fan.status === "running" ? 2.15 : 0)
        + (this.state.equipment.valve.status === "running" ? 0.35 : 0);
    }

    if (!this.state.paused) {
      this.state.power = round(targetPower + this.state.agglomeration * 0.008, 2);
      this.state.peakPower = Math.max(this.state.peakPower, this.state.power);
      this.state.energy += (this.state.power * dt) / 3600;
      this.updateSignals(dt);
    }
  }

  updateSignals(dt) {
    const rate = 1 - Math.exp(-dt * 0.85);
    const motorTarget = this.state.equipment.motor.status === "running"
      ? 43 + this.state.power * 3.6
      : 37;
    const fanTarget = this.state.equipment.fan.status === "running" ? 184 : 0;
    const valveTarget = this.state.equipment.valve.status === "running" ? this.state.params.valve : 0;
    this.state.signals.motorTemp += (motorTarget - this.state.signals.motorTemp) * rate;
    this.state.signals.fanFlow += (fanTarget - this.state.signals.fanFlow) * rate;
    this.state.signals.valveFeedback += (valveTarget - this.state.signals.valveFeedback) * rate;
    this.state.signals.commLatency += (12 - this.state.signals.commLatency) * rate;
  }

  getSampleValues() {
    const offsets = [-4.2, -1.4, 0.5, 2.7, -2.2];
    return this.emptySamples().map((sample, index) => {
      const wave = Math.sin(this.state.seed + index * 1.7 + this.state.stageElapsed * 0.21) * 0.55;
      const layerBias = this.state.stratification > 0
        ? (sample.x - 0.5) * this.state.stratification * 0.16
        : 0;
      const clumpBias = this.state.agglomeration > 0 && index === 3
        ? -this.state.agglomeration * 0.16
        : 0;
      return {
        ...sample,
        value: round(clamp(this.state.uniformity + offsets[index] + wave + layerBias + clumpBias, 0, 100), 1),
      };
    });
  }

  verifyRecovery() {
    const recovery = this.state.recovery;
    if (!recovery?.active) return null;
    recovery.active = false;
    const deviceFaults = Object.values(this.state.equipment).filter((item) => item.status === "fault").length;
    const latchedAlarms = Object.values(this.state.latches).filter(Boolean).length;
    const addedErrors = Math.max(0, this.state.errorCount - recovery.baselineErrors);
    const residualIssues = [];
    if (deviceFaults > 0) residualIssues.push(`${deviceFaults} 台设备残留故障态`);
    if (latchedAlarms > 0) residualIssues.push(`${latchedAlarms} 个联锁标志未复位`);
    if (addedErrors > 0) residualIssues.push(`恢复期间新增 ${addedErrors} 条错误`);
    if (this.state.signals.motorTemp >= 95) residualIssues.push("电机绕组温度仍高于阈值");
    if (this.state.equipment.fan.status === "running" && this.state.signals.fanFlow < 120) {
      residualIssues.push("风机风量未回到工作区");
    }
    if (this.state.signals.commLatency >= 1500) residualIssues.push("变频器通讯仍有延迟");

    const passed = residualIssues.length === 0 && !this.state.failed;
    const verification = {
      passed,
      window: recovery.required,
      startAt: recovery.startedAt,
      completedAt: round(this.state.elapsed, 1),
      source: recovery.source,
      baselineErrors: recovery.baselineErrors,
      addedErrors,
      deviceFaults,
      latchedAlarms,
      residualIssues,
      summary: passed
        ? `固定 ${recovery.required.toFixed(1)} s 恢复窗通过 · 残留 0 · 错误累计 +0`
        : `恢复验证失败 · ${residualIssues.join("；")}`,
    };
    recovery.passed = passed;
    this.state.recoveryVerification = verification;
    this.state.incidents.push({
      type: "recovery",
      equipmentName: recovery.source,
      trigger: "恢复验证",
      valueText: `${recovery.required.toFixed(1)} s`,
      thresholdText: "残留 0 / 新增错误 0",
      at: verification.completedAt,
      detail: verification.summary,
      recovered: passed,
    });
    this.addEvent(
      "system",
      "恢复验证器",
      `${verification.summary} · 设备故障 ${deviceFaults} / 联锁 ${latchedAlarms}`,
      passed ? "recovery" : "alarm",
    );
    return verification;
  }

  finishBatch() {
    if (this.state.result || this.state.failed) return this.state.result;
    this.state.running = false;
    this.state.completed = true;
    this.state.phase = "complete";
    this.state.power = 0;
    for (const id of Object.keys(this.state.equipment)) {
      this.stopEquipment(id, "批次结束");
    }

    const totalMass = 120;
    const qualityGap = Math.max(0, 85 - this.state.uniformity);
    const wasteRate = clamp(
      0.8
        + this.state.entrainment * 0.8
        + this.state.agglomeration * 0.18
        + qualityGap * 0.32,
      0.6,
      35,
    );
    const wasteKg = round(totalMass * (wasteRate / 100), 1);
    const goodKg = round(totalMass - wasteKg, 1);
    const recoveryPassed = !this.state.recoveryVerification || this.state.recoveryVerification.passed;
    const accepted = this.state.uniformity >= 85 && wasteRate <= 8 && recoveryPassed;
    const primaryIncident = this.state.incidents.find((item) => item.type === "failure");
    let shutdownReason = "正常完成";
    if (!accepted) {
      shutdownReason = `质量未达标 · 均匀度 ${round(this.state.uniformity, 1)}%`;
    } else if (primaryIncident) {
      shutdownReason = `恢复后完成 · ${primaryIncident.equipmentName}已处理`;
    }

    this.addEvent(
      "system",
      "批次控制器",
      `${accepted ? "批次合格" : "批次不合格"} · 良品 ${goodKg.toFixed(1)} kg / 废品 ${wasteKg.toFixed(1)} kg`,
      accepted ? "recovery" : "alarm",
    );

    const result = {
      id: this.batchId(),
      batchNumber: this.batchNumber,
      createdAt: new Date().toISOString(),
      duration: round(this.state.elapsed, 1),
      accepted,
      uniformity: round(this.state.uniformity, 1),
      averageUniformity: round(
        this.state.samples.reduce((sum, sample) => sum + (sample.value || 0), 0) / this.state.samples.length,
        1,
      ),
      goodKg,
      wasteKg,
      goodRate: round(100 - wasteRate, 1),
      wasteRate: round(wasteRate, 1),
      peakPower: round(this.state.peakPower, 2),
      energy: round(this.state.energy, 3),
      agglomeration: round(this.state.agglomeration, 1),
      stratification: round(this.state.stratification, 1),
      entrainment: round(this.state.entrainment, 1),
      shutdownReason,
      params: clone(this.state.params),
      samples: clone(this.state.samples),
      incidents: clone(this.state.incidents),
      recoveryVerification: this.state.recoveryVerification
        ? clone(this.state.recoveryVerification)
        : null,
      errorCount: this.state.errorCount,
      equipment: clone(this.state.equipment),
      events: clone(this.state.events),
      qualityThreshold: 85,
      snapshotRunId: null,
    };
    this.state.result = deepFreeze(result);
    return this.state.result;
  }

  captureSnapshot(meta = {}) {
    const snapshot = {
      id: `SNAP-${Date.now().toString(36).toUpperCase()}`,
      name: meta.name || `设备快照 · ${this.batchId()}`,
      createdAt: new Date().toISOString(),
      batchNumber: this.batchNumber,
      params: clone(this.state.params),
      equipment: clone(this.state.equipment),
      signals: clone(this.state.signals),
      incidents: clone(this.state.incidents),
      errorCount: this.state.errorCount,
      recoveryVerification: clone(this.state.recoveryVerification),
      baseResult: meta.baseResult ? clone(meta.baseResult) : null,
    };
    return deepFreeze(snapshot);
  }

  hasActiveRecovery() {
    return Boolean(this.state.recovery?.active);
  }

  getRecoveryProgress() {
    if (!this.state.recovery) return null;
    return {
      ...this.state.recovery,
      progress: clamp(this.state.recovery.elapsed / this.state.recovery.required, 0, 1),
    };
  }
}

export function describeFailure(failure) {
  if (!failure) return "";
  return `${failure.equipmentName} · ${failure.trigger} = ${failure.valueText}（触发限值 ${failure.thresholdText}）`;
}
