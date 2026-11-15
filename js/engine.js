import {
  BUFFERS,
  CARTONS,
  DEVICES,
  OFFSET_LIMIT,
  OFFSET_WARN,
  ORDERS,
  PHASES,
  TAPE_PATHS,
  clone,
  recommendedRecipe
} from "./data.js";

const AXIS_LABELS = ["长度", "宽度", "高度"];
const BOX_RANK = { S: 0, M: 1, L: 2 };

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatTrigger(value, limit) {
  return `${value} / 上限 ${limit}`;
}

export function evaluateOrder(order, recipe, offset = 0) {
  const carton = CARTONS[recipe.boxSize];
  const buffer = BUFFERS[recipe.buffer];
  const targetCarton = CARTONS[order.targetBox];
  const targetBuffer = BUFFERS[order.targetBuffer];
  const issues = [];
  const cushion = buffer.thickness;
  const minDims = order.dims.map((dimension) => dimension + cushion * 2 + 8);
  let fits = true;

  minDims.forEach((required, index) => {
    if (carton.dims[index] < required) {
      fits = false;
      issues.push({
        code: "CRUSH",
        severity: "critical",
        equipment: "箱体夹具",
        message: `${AXIS_LABELS[index]}空间不足，压伤风险 ${required} > ${carton.dims[index]} mm`
      });
    }
  });

  if (BOX_RANK[carton.id] > BOX_RANK[order.targetBox]) {
    const excess = Math.round((carton.volume / targetCarton.volume - 1) * 100);
    issues.push({
      code: "OVERSIZE",
      severity: "warning",
      equipment: "输送机",
      message: `纸箱过大，运输占用增加 ${excess}%`
    });
  }

  if (buffer.level !== targetBuffer.level) {
    const insufficient = buffer.level < targetBuffer.level;
    issues.push({
      code: insufficient ? "CUSHION_LOW" : "CUSHION_HIGH",
      severity: insufficient ? "critical" : "warning",
      equipment: "缓冲仓",
      message: insufficient
        ? `缓冲不足：${buffer.label} 低于 ${targetBuffer.label}`
        : `缓冲冗余：${buffer.label} 超出 ${targetBuffer.label}`
    });
  }

  if (recipe.tapePath !== order.targetTape) {
    issues.push({
      code: "TAPE_PATH",
      severity: "warning",
      equipment: "封口器",
      message: `胶带路径 ${recipe.tapePath} 与工艺要求 ${order.targetTape} 不符`
    });
  }

  if (Math.abs(offset) > OFFSET_LIMIT) {
    issues.push({
      code: "OFFSET_LIMIT",
      severity: "critical",
      equipment: "机械臂",
      message: `放置偏置 ${Math.abs(offset)} mm 超出设备上限 ${OFFSET_LIMIT} mm`
    });
  } else if (Math.abs(offset) > OFFSET_WARN) {
    issues.push({
      code: "BULGE",
      severity: "warning",
      equipment: "封口器",
      message: `产品偏置 ${Math.abs(offset)} mm，封口鼓起超差`
    });
  }

  const productVolume = order.dims.reduce((total, value) => total * value, 1);
  const occupancy = productVolume / carton.volume;
  const spaceScore = fits
    ? clamp(100 - Math.max(0, BOX_RANK[carton.id] - BOX_RANK[order.targetBox]) * 28)
    : clamp(38 - issues.filter((issue) => issue.code === "CRUSH").length * 10);
  const cushionScore = clamp(100 - Math.abs(buffer.level - targetBuffer.level) * 44);
  const sealMatches = recipe.tapePath === order.targetTape;
  const sealScore = clamp(
    100 - (sealMatches ? 0 : 42) - Math.max(0, Math.abs(offset) - OFFSET_WARN) * 3.4
  );

  return {
    good: issues.length === 0,
    issues,
    fits,
    occupancy,
    minDims,
    carton,
    buffer,
    scores: {
      space: Math.round(spaceScore),
      cushion: Math.round(cushionScore),
      seal: Math.round(sealScore)
    }
  };
}

function createDeviceState() {
  return Object.fromEntries(
    Object.entries(DEVICES).map(([key, device]) => [
      key,
      {
        key,
        id: device.id,
        name: device.name,
        power: device.power,
        active: false,
        health: "ok",
        activeLogId: null,
        startedAt: null
      }
    ])
  );
}

function timeLabel(timestamp) {
  if (!timestamp) return "--:--:--";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export class PackingEngine {
  constructor({ speed = 1 } = {}) {
    this.speed = speed;
    this.batchSeq = 0;
    this.exceptionSeq = 0;
    this.snapshotSeq = 0;
    this.recipes = Object.fromEntries(ORDERS.map((order) => [order.id, recommendedRecipe(order)]));
    this.offset = 0;
    this.devices = createDeviceState();
    this.completedBatches = [];
    this.snapshots = [];
    this.listeners = new Map();
    this.status = "idle";
    this.previousStatus = "idle";
    this.runtime = this.createRuntime();
    this.lastTickAt = null;
    this.activeScenario = null;
    this.powerHistory = [0.6];
    this.powerSampleAt = 0;
    this.animation = {
      clock: 0,
      beltOffset: 0,
      armAngle: 0,
      sealProgress: 0,
      flash: 0
    };
  }

  createRuntime() {
    this.batchSeq += 1;
    const id = `B${String(this.batchSeq).padStart(3, "0")}`;
    return {
      id,
      status: "idle",
      scenario: null,
      startedAt: null,
      endedAt: null,
      totalElapsed: 0,
      currentOrderIndex: -1,
      phaseIndex: 0,
      phaseElapsed: 0,
      gapRemaining: 0,
      currentPower: 0.6,
      peakPower: 0.6,
      good: 0,
      waste: 0,
      cycles: [],
      orders: ORDERS.map((order) => ({
        id: order.id,
        status: "pending",
        verdict: null,
        issues: [],
        completedAt: null
      })),
      deviceLogs: [],
      exceptions: [],
      downtimeReasons: [],
      recipeSnapshot: clone(this.recipes),
      offsetSnapshot: this.offset,
      completed: false,
      aborted: false,
      recoveryObservation: null,
      faultInjected: false
    };
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(handler);
    return () => this.listeners.get(eventName)?.delete(handler);
  }

  emit(eventName, payload) {
    this.listeners.get(eventName)?.forEach((handler) => handler(payload));
  }

  getRecipe(orderId) {
    return this.recipes[orderId];
  }

  getCurrentOrder() {
    const index = this.runtime.currentOrderIndex;
    return index >= 0 ? ORDERS[index] : null;
  }

  getOpenException() {
    return this.runtime.exceptions.find((item) => item.status !== "resolved") || null;
  }

  canEdit() {
    return ["idle", "complete"].includes(this.status);
  }

  setRecipe(orderId, nextRecipe) {
    if (!this.canEdit() && this.status !== "fault") {
      return { ok: false, reason: "运行中不可修改配方" };
    }
    const current = this.recipes[orderId];
    if (!current) return { ok: false, reason: "订单不存在" };
    const boxSize = CARTONS[nextRecipe.boxSize] ? nextRecipe.boxSize : current.boxSize;
    const buffer = BUFFERS[nextRecipe.buffer] ? nextRecipe.buffer : current.buffer;
    const tapePath = TAPE_PATHS[nextRecipe.tapePath] ? nextRecipe.tapePath : current.tapePath;
    this.recipes[orderId] = { boxSize, buffer, tapePath };
    this.emit("change", { type: "recipe" });
    return { ok: true, recipe: clone(this.recipes[orderId]) };
  }

  setOffset(value) {
    if (!this.canEdit() && this.status !== "fault") {
      return { ok: false, reason: "运行中不可修改偏置" };
    }
    if (this.status === "fault") {
      const open = this.getOpenException();
      if (open?.kind !== "parameter_limit") {
        return { ok: false, reason: "设备故障期间不可修改参数" };
      }
    }
    const parsed = clamp(Number(value) || 0, -30, 30);
    this.offset = Math.round(parsed);
    this.emit("change", { type: "offset" });
    return { ok: true, offset: this.offset };
  }

  applyRecommended() {
    if (!this.canEdit()) return { ok: false, reason: "请先重置当前批次" };
    ORDERS.forEach((order) => {
      this.recipes[order.id] = recommendedRecipe(order);
    });
    this.offset = 0;
    this.emit("change", { type: "recipe-bulk" });
    return { ok: true };
  }

  startBatch({ scenario = null, fresh = false } = {}) {
    if (["running", "paused", "recovering"].includes(this.status)) {
      return { ok: false, reason: "批次正在运行" };
    }
    if (this.status === "fault") {
      return { ok: false, reason: "请先处理当前联锁故障" };
    }
    if (fresh || this.runtime.completed || this.runtime.aborted || this.runtime.startedAt) {
      this.runtime = this.createRuntime();
    }

    this.activeScenario = scenario;
    this.runtime.scenario = scenario;
    this.runtime.startedAt = Date.now();
    this.runtime.startedLabel = timeLabel(this.runtime.startedAt);
    this.runtime.status = "running";
    this.runtime.recipeSnapshot = clone(this.recipes);
    this.runtime.offsetSnapshot = this.offset;
    this.status = "running";
    this.lastTickAt = null;
    this.powerHistory = [0.6];
    Object.values(this.devices).forEach((device) => {
      device.health = "ok";
      device.active = false;
      device.activeLogId = null;
    });

    if (Math.abs(this.offset) > OFFSET_LIMIT) {
      this.raiseParameterLimitFault();
      return { ok: false, fault: this.getOpenException(), batchId: this.runtime.id };
    }

    this.startOrder(0);
    this.emit("batch-start", { batchId: this.runtime.id, scenario });
    this.emit("change", { type: "start" });
    return { ok: true, batchId: this.runtime.id };
  }

  startOrder(index) {
    if (index >= ORDERS.length) return;
    this.runtime.currentOrderIndex = index;
    this.runtime.phaseIndex = 0;
    this.runtime.phaseElapsed = 0;
    this.runtime.gapRemaining = 0;
    this.runtime.orders[index].status = "running";
    this.runtime.orders[index].startedAt = Date.now();
    this.beginPhase();
    this.emit("order-start", { index, order: ORDERS[index] });
    this.emit("change", { type: "order-start" });
  }

  beginPhase() {
    const phase = PHASES[this.runtime.phaseIndex];
    if (!phase) return;
    phase.devices.forEach((deviceKey) => this.activateDevice(deviceKey, phase.id));
    this.updatePower();
    this.emit("phase", {
      phase: phase.id,
      index: this.runtime.phaseIndex,
      orderIndex: this.runtime.currentOrderIndex
    });
    this.emit("change", { type: "phase" });
  }

  activateDevice(deviceKey, phaseId, reason = "auto") {
    const device = this.devices[deviceKey];
    if (!device || device.active || device.health === "fault") return;
    const now = Date.now();
    const entry = {
      id: this.runtime.deviceLogs.length + 1,
      deviceKey,
      deviceId: device.id,
      deviceName: device.name,
      orderId: this.getCurrentOrder()?.id || "--",
      phase: phaseId,
      startAt: now,
      startLabel: timeLabel(now),
      startedClock: round(this.runtime.totalElapsed, 2),
      stopAt: null,
      stopLabel: null,
      stoppedClock: null,
      duration: null,
      stopReason: null,
      reason
    };
    this.runtime.deviceLogs.push(entry);
    device.active = true;
    device.activeLogId = entry.id;
    device.startedAt = now;
    this.emit("device", { state: "start", entry });
    this.emit("change", { type: "device" });
  }

  stopDevice(deviceKey, reason = "phase-end") {
    const device = this.devices[deviceKey];
    if (!device || !device.active) return;
    const now = Date.now();
    const entry = this.runtime.deviceLogs.find((item) => item.id === device.activeLogId);
    if (entry) {
      entry.stopAt = now;
      entry.stopLabel = timeLabel(now);
      entry.stoppedClock = round(this.runtime.totalElapsed, 2);
      entry.duration = round(
        Math.max(0, entry.stoppedClock - entry.startedClock),
        2
      );
      entry.stopReason = reason;
      this.emit("device", { state: "stop", entry });
    }
    device.active = false;
    device.activeLogId = null;
    device.startedAt = null;
    this.emit("change", { type: "device" });
  }

  stopAllDevices(reason) {
    Object.keys(this.devices).forEach((key) => this.stopDevice(key, reason));
    this.updatePower();
  }

  advancePhase() {
    const phase = PHASES[this.runtime.phaseIndex];
    phase.devices.forEach((deviceKey) => this.stopDevice(deviceKey, "phase-end"));
    if (this.runtime.phaseIndex < PHASES.length - 1) {
      this.runtime.phaseIndex += 1;
      this.runtime.phaseElapsed = 0;
      this.beginPhase();
      return;
    }
    this.finishOrder();
  }

  finishOrder() {
    const index = this.runtime.currentOrderIndex;
    const order = ORDERS[index];
    const runtimeOrder = this.runtime.orders[index];
    const recipe = this.runtime.recipeSnapshot[order.id];
    const evaluation = evaluateOrder(order, recipe, this.runtime.offsetSnapshot);
    runtimeOrder.status = evaluation.good ? "good" : "waste";
    runtimeOrder.verdict = evaluation.good ? "good" : "waste";
    runtimeOrder.issues = evaluation.issues;
    runtimeOrder.evaluation = evaluation;
    runtimeOrder.recipe = clone(recipe);
    runtimeOrder.completedAt = Date.now();
    runtimeOrder.completedLabel = timeLabel(runtimeOrder.completedAt);
    if (evaluation.good) this.runtime.good += 1;
    else this.runtime.waste += 1;
    this.runtime.cycles.push({
      orderId: order.id,
      duration: PHASES.reduce((total, phase) => total + phase.duration, 0),
      verdict: runtimeOrder.verdict
    });
    this.emit("order-complete", {
      index,
      order,
      evaluation,
      verdict: runtimeOrder.verdict
    });
    this.emit("change", { type: "order-complete" });

    if (index >= ORDERS.length - 1) {
      this.completeBatch();
      return;
    }
    this.runtime.gapRemaining = 180;
    this.updatePower();
  }

  updatePower() {
    const activePower = Object.values(this.devices)
      .filter((device) => device.active)
      .reduce((total, device) => total + device.power, 0);
    const wave = this.status === "running" || this.status === "recovering"
      ? Math.sin(this.runtime.totalElapsed / 170) * 0.06
      : 0;
    this.runtime.currentPower = round(0.6 + activePower + wave, 2);
    this.runtime.peakPower = Math.max(this.runtime.peakPower, this.runtime.currentPower);
    if (this.runtime.totalElapsed - this.powerSampleAt >= 120) {
      this.powerSampleAt = this.runtime.totalElapsed;
      this.powerHistory.push(this.runtime.currentPower);
      if (this.powerHistory.length > 90) this.powerHistory.shift();
    }
  }

  tick(deltaMs = 16) {
    const dt = Math.max(0, Math.min(Number(deltaMs) || 0, 5000));
    if (dt === 0) return;
    this.animation.clock += dt / 1000;
    if (this.status !== "paused" && this.status !== "fault") {
      this.animation.beltOffset = (this.animation.beltOffset + dt * 0.075) % 64;
    }
    const running = ["running", "recovering"].includes(this.status);
    if (!running) {
      this.updatePower();
      return;
    }

    this.runtime.totalElapsed += dt;
    this.animation.armAngle = Math.sin(this.animation.clock * 2.3) * 12;
    this.animation.sealProgress = this.runtime.phaseIndex === 3
      ? clamp(this.runtime.phaseElapsed / PHASES[3].duration, 0, 1)
      : 0;

    if (
      this.runtime.scenario === "fault" &&
      !this.runtime.faultInjected &&
      this.runtime.phaseIndex === 3 &&
      this.runtime.phaseElapsed > 100 &&
      !this.getOpenException()
    ) {
      this.runtime.faultInjected = true;
      this.injectFault("sealer", { scenario: true });
      return;
    }

    if (this.runtime.recoveryObservation) {
      this.runtime.recoveryObservation.elapsed += dt;
      if (this.runtime.recoveryObservation.elapsed >= this.runtime.recoveryObservation.duration) {
        this.finalizeRecovery();
      }
    }

    let remaining = dt;
    let guard = 0;
    while (remaining > 0 && guard < 60) {
      guard += 1;
      if (!["running", "recovering"].includes(this.status)) break;

      if (this.runtime.gapRemaining > 0) {
        const consume = Math.min(remaining, this.runtime.gapRemaining);
        this.runtime.gapRemaining -= consume;
        remaining -= consume;
        if (this.runtime.gapRemaining <= 0) {
          this.startOrder(this.runtime.currentOrderIndex + 1);
        }
        continue;
      }

      if (this.runtime.currentOrderIndex < 0) {
        this.startOrder(0);
        continue;
      }

      const phase = PHASES[this.runtime.phaseIndex];
      if (!phase) break;
      const phaseRemaining = Math.max(0, phase.duration - this.runtime.phaseElapsed);
      if (remaining < phaseRemaining) {
        this.runtime.phaseElapsed += remaining;
        remaining = 0;
      } else {
        this.runtime.phaseElapsed = phase.duration;
        remaining -= phaseRemaining || 1;
        this.advancePhase();
      }
    }
    this.updatePower();
    this.emit("tick", { runtime: this.runtime, powerHistory: this.powerHistory });
  }

  makeException({
    kind,
    equipmentKey,
    code,
    title,
    trigger,
    triggerValue,
    limit,
    message
  }) {
    const device = DEVICES[equipmentKey];
    this.exceptionSeq += 1;
    const now = Date.now();
    return {
      id: `EX-${String(this.exceptionSeq).padStart(3, "0")}`,
      kind,
      equipmentKey,
      equipment: device.id,
      equipmentName: device.name,
      code,
      title,
      trigger,
      triggerValue,
      limit,
      message,
      orderId: this.getCurrentOrder()?.id || ORDERS[0].id,
      batchId: this.runtime.id,
      openedAt: now,
      openedLabel: timeLabel(now),
      openedClock: round(this.runtime.totalElapsed, 2),
      resolvedAt: null,
      resolvedLabel: null,
      status: "open",
      recoveryStartedAt: null,
      recovery: null
    };
  }

  raiseFault(exception) {
    this.runtime.status = "fault";
    this.status = "fault";
    this.stopAllDevices("interlock");
    this.runtime.exceptions.push(exception);
    this.runtime.downtimeReasons.push(
      `${exception.equipment} ${exception.title}：${exception.trigger}`
    );
    this.runtime.currentPower = 0.15;
    this.emit("fault", exception);
    this.emit("change", { type: "fault" });
  }

  raiseParameterLimitFault() {
    const exception = this.makeException({
      kind: "parameter_limit",
      equipmentKey: "roboticArm",
      code: "ARM_OFFSET_LIMIT",
      title: "放置偏置参数越限",
      trigger: `${Math.abs(this.offset)} mm / 上限 ${OFFSET_LIMIT} mm`,
      triggerValue: Math.abs(this.offset),
      limit: OFFSET_LIMIT,
      message: "机械臂目标位姿超出安全包络，批次在入箱前被安全联锁拦截。"
    });
    this.raiseFault(exception);
  }

  injectFault(kind = "sealer", options = {}) {
    if (!["running", "recovering"].includes(this.status)) {
      return { ok: false, reason: "仅运行中的产线可注入故障" };
    }
    if (this.getOpenException()) return { ok: false, reason: "已有未处理故障" };

    const profiles = {
      sealer: {
        equipmentKey: "sealer",
        code: "SEAL_TEMP_HIGH",
        title: "封口温度超限",
        trigger: "241.8 °C / 上限 220.0 °C",
        triggerValue: 241.8,
        limit: 220,
        message: "封口器温控回路触发安全联锁，输送机与机械臂已同步停止。"
      },
      roboticArm: {
        equipmentKey: "roboticArm",
        code: "ARM_TORQUE_HIGH",
        title: "机械臂扭矩超限",
        trigger: "112.0% / 上限 105.0%",
        triggerValue: 112,
        limit: 105,
        message: "机械臂关节负载异常，产线进入安全保持状态。"
      }
    };
    const profile = profiles[kind] || profiles.sealer;
    this.devices[profile.equipmentKey].health = "fault";
    const exception = this.makeException({
      kind: "equipment_fault",
      ...profile,
      message: options.scenario
        ? `${profile.message} 验收场景 B 自动注入。`
        : profile.message
    });
    exception.scenarioInjected = Boolean(options.scenario);
    this.raiseFault(exception);
    return { ok: true, exception };
  }

  pause() {
    if (!["running", "recovering"].includes(this.status)) {
      return { ok: false, reason: "当前状态不可暂停" };
    }
    this.previousStatus = this.status;
    this.status = "paused";
    this.runtime.status = "paused";
    this.runtime.pausedAt = Date.now();
    this.stopAllDevices("operator-pause");
    this.emit("paused", { at: this.runtime.pausedAt });
    this.emit("change", { type: "pause" });
    return { ok: true };
  }

  resume() {
    if (this.status !== "paused") return { ok: false, reason: "产线未暂停" };
    this.status = this.previousStatus === "recovering" ? "recovering" : "running";
    this.runtime.status = this.status;
    this.runtime.resumeAt = Date.now();
    this.beginPhase();
    this.emit("resumed", { at: this.runtime.resumeAt });
    this.emit("change", { type: "resume" });
    return { ok: true };
  }

  recoverFault() {
    const exception = this.getOpenException();
    if (!exception) return { ok: false, reason: "没有待处理故障" };
    if (
      exception.kind === "parameter_limit" &&
      Math.abs(this.offset) > OFFSET_LIMIT
    ) {
      return {
        ok: false,
        reason: `请先将偏置恢复到 ±${OFFSET_LIMIT} mm 内`
      };
    }
    if (exception.kind === "parameter_limit") {
      this.runtime.offsetSnapshot = this.offset;
    }

    Object.values(this.devices).forEach((device) => {
      if (device.health === "fault") device.health = "ok";
    });
    exception.status = "recovering";
    exception.recoveryStartedAt = Date.now();
    exception.recoveryLabel = timeLabel(exception.recoveryStartedAt);
    exception.recovery = {
      duration: 3000,
      elapsed: 0,
      residuals: [],
      passed: null
    };
    this.runtime.recoveryObservation = {
      duration: 3000,
      elapsed: 0,
      exceptionId: exception.id
    };
    this.status = "recovering";
    this.runtime.status = "recovering";
    this.lastTickAt = null;
    if (this.runtime.currentOrderIndex < 0) {
      this.startOrder(0);
    } else {
      this.runtime.phaseElapsed = 0;
      this.beginPhase();
    }
    this.emit("recovery-start", { exception });
    this.emit("change", { type: "recovery-start" });
    return { ok: true, exception };
  }

  finalizeRecovery() {
    const observation = this.runtime.recoveryObservation;
    if (!observation) return;
    const exception = this.runtime.exceptions.find((item) => item.id === observation.exceptionId);
    const residuals = [];
    Object.values(this.devices).forEach((device) => {
      if (device.health !== "ok") residuals.push(`${device.id} 健康状态残留`);
    });
    if (Math.abs(this.offset) > OFFSET_LIMIT) {
      residuals.push("偏置参数仍越限");
    }
    if (this.runtime.currentPower > 8.5) residuals.push("功耗采样异常");
    if (exception?.status === "resolved") residuals.push("异常记录重复");

    if (exception) {
      exception.status = "resolved";
      exception.resolvedAt = Date.now();
      exception.resolvedLabel = timeLabel(exception.resolvedAt);
      exception.handledBy = "操作员复位";
      exception.recovery.elapsed = observation.duration;
      exception.recovery.residuals = residuals;
      exception.recovery.passed = residuals.length === 0;
    }
    this.runtime.recoveryObservation = null;
    this.status = "running";
    this.runtime.status = "running";
    this.emit("recovery-verified", {
      exception,
      passed: residuals.length === 0,
      residuals,
      checkedMs: observation.duration
    });
    this.emit("change", { type: "recovery-verified" });
  }

  completeBatch() {
    if (this.runtime.completed) return;
    this.stopAllDevices("batch-end");
    this.runtime.endedAt = Date.now();
    this.runtime.completed = true;
    this.runtime.status = "complete";
    this.status = "complete";
    this.runtime.currentPower = 0.6;
    const result = deepFreeze(this.buildBatchResult());
    this.completedBatches.push(result);
    this.emit("batch-complete", result);
    this.emit("change", { type: "complete" });
  }

  buildBatchResult() {
    const orders = ORDERS.map((order, index) => {
      const runtimeOrder = this.runtime.orders[index];
      return {
        id: order.id,
        code: order.code,
        name: order.name,
        dims: [...order.dims],
        recipe: runtimeOrder.recipe
          ? clone(runtimeOrder.recipe)
          : clone(this.runtime.recipeSnapshot[order.id]),
        verdict: runtimeOrder.verdict || "pending",
        issues: clone(runtimeOrder.issues || []),
        completedLabel: runtimeOrder.completedLabel || "--:--:--"
      };
    });
    return {
      id: this.runtime.id,
      scenario: this.runtime.scenario,
      startedAt: this.runtime.startedAt,
      endedAt: this.runtime.endedAt,
      startedLabel: this.runtime.startedLabel,
      endedLabel: timeLabel(this.runtime.endedAt),
      durationMs: Math.round(this.runtime.totalElapsed),
      good: this.runtime.good,
      waste: this.runtime.waste,
      peakPower: round(this.runtime.peakPower, 2),
      currentPower: round(this.runtime.currentPower, 2),
      offset: this.runtime.offsetSnapshot,
      recipes: clone(this.runtime.recipeSnapshot),
      orders,
      downtimeReasons: clone(this.runtime.downtimeReasons),
      exceptions: clone(this.runtime.exceptions),
      deviceLogs: clone(this.runtime.deviceLogs),
      cycleCount: this.runtime.cycles.length
    };
  }

  resetCurrentBatch() {
    Object.keys(this.devices).forEach((key) => this.stopDevice(key, "reset"));
    this.runtime.aborted = true;
    this.runtime.status = "aborted";
    this.runtime = this.createRuntime();
    Object.values(this.devices).forEach((device) => {
      device.health = "ok";
      device.active = false;
      device.activeLogId = null;
    });
    this.status = "idle";
    this.activeScenario = null;
    this.powerHistory = [0.6];
    this.lastTickAt = null;
    this.emit("reset", { batchId: this.runtime.id });
    this.emit("change", { type: "reset" });
    return { ok: true, batchId: this.runtime.id };
  }

  saveSnapshot({ note = "" } = {}) {
    this.snapshotSeq += 1;
    const latest = this.completedBatches.at(-1) || null;
    const now = Date.now();
    const snapshot = {
      id: `SNAP-${String(this.snapshotSeq).padStart(3, "0")}`,
      capturedAt: now,
      capturedLabel: timeLabel(now),
      note,
      offset: this.offset,
      recipes: clone(this.recipes),
      equipment: Object.fromEntries(
        Object.entries(this.devices).map(([key, device]) => [
          key,
          {
            id: device.id,
            health: device.health,
            active: device.active
          }
        ])
      ),
      batchId: latest?.id || null,
      batchGood: latest?.good ?? null,
      batchWaste: latest?.waste ?? null
    };
    deepFreeze(snapshot);
    this.snapshots.push(snapshot);
    this.emit("snapshot", snapshot);
    return snapshot;
  }

  loadSnapshot(snapshotId) {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return { ok: false, reason: "快照不存在" };
    if (!this.canEdit() && this.status !== "fault") {
      return { ok: false, reason: "请暂停并重置当前批次" };
    }
    this.recipes = clone(snapshot.recipes);
    this.offset = snapshot.offset;
    Object.entries(snapshot.equipment).forEach(([key, deviceState]) => {
      if (this.devices[key]) this.devices[key].health = deviceState.health;
    });
    this.emit("change", { type: "snapshot-load" });
    return { ok: true, snapshot };
  }

  getComparison(snapshotId) {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot?.batchId) return null;
    const base = this.completedBatches.find((batch) => batch.id === snapshot.batchId);
    const current = [...this.completedBatches]
      .reverse()
      .find((batch) => batch.id !== snapshot.batchId);
    if (!base || !current) return null;
    return { base, current, snapshot };
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}
