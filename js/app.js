(function () {
  "use strict";

  const CONFIG = {
    targetGood: 10,
    recoveryMs: 8000,
    baseCycleFactor: 42000,
    safe: {
      pressure: { min: 35, max: 72 },
      offset: { min: -0.45, max: 0.45 },
      speed: { min: 10, max: 26 },
    },
    bufferLimit: 8,
  };

  const DEVICE_DEFS = [
    { id: "RB-01", name: "放料机械臂", role: "Robotic arm", short: "机械臂" },
    { id: "AL-02", name: "CCD 对位平台", role: "Alignment stage", short: "对位台" },
    { id: "VP-01", name: "吸盘真空单元", role: "Vacuum unit", short: "真空" },
    { id: "ST-03", name: "叠片热压台", role: "Stack table", short: "叠片台" },
    { id: "BF-03", name: "进料缓存单元", role: "Buffer feeder", short: "缓存" },
  ];

  const STATUS_LABELS = {
    idle: "待机 · 等待启动",
    running: "自动运行 · 叠片中",
    paused: "暂停检查 · 设备已停机",
    fault: "安全联锁 · 产线停机",
    recovering: "恢复验证 · 固定 8 秒",
    finished: "批次结束 · 数据已归档",
  };

  const STATUS_CODES = {
    idle: "STANDBY",
    running: "AUTO RUN",
    paused: "HOLD",
    fault: "INTERLOCK",
    recovering: "RECOVERY",
    finished: "ARCHIVED",
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const elements = {
    globalStatus: $("#global-status"),
    globalBeacon: $("#global-beacon"),
    statusCode: $("#status-code"),
    clock: $("#clock"),
    audioToggle: $("#audio-toggle"),
    audioLabel: $("#audio-label"),
    pressure: $("#pressure-range"),
    pressureValue: $("#pressure-value"),
    offset: $("#offset-range"),
    offsetValue: $("#offset-value"),
    speed: $("#speed-range"),
    speedValue: $("#speed-value"),
    parameterState: $("#parameter-state"),
    parameterFeedback: $("#parameter-feedback"),
    startButton: $("#start-button"),
    startLabel: $("#start-label"),
    pauseButton: $("#pause-button"),
    resetButton: $("#reset-button"),
    snapshotButton: $("#snapshot-button"),
    snapshotApply: $("#snapshot-apply"),
    snapshotMeta: $("#snapshot-meta"),
    batchStatePill: $("#batch-state-pill"),
    batchKicker: $("#batch-kicker"),
    kpiGood: $("#kpi-good"),
    kpiYield: $("#kpi-yield"),
    kpiPower: $("#kpi-power"),
    kpiEvents: $("#kpi-events"),
    kpiGoodNote: $("#kpi-good-note"),
    kpiWasteNote: $("#kpi-waste-note"),
    kpiYieldTrend: $("#kpi-yield-trend"),
    kpiPowerNote: $("#kpi-power-note"),
    kpiDowntimeTag: $("#kpi-downtime-tag"),
    kpiRecoveryNote: $("#kpi-recovery-note"),
    progressText: $("#progress-text"),
    progressBar: $("#progress-bar"),
    stackSlots: $("#stack-slots"),
    batchGood: $("#batch-good"),
    batchWaste: $("#batch-waste"),
    batchPeak: $("#batch-peak"),
    batchRecovery: $("#batch-recovery"),
    batchDowntime: $("#batch-downtime"),
    cycleClock: $("#cycle-clock"),
    alignReadout: $("#align-readout"),
    bufferReadout: $("#buffer-readout"),
    vacuumReadout: $("#vacuum-readout"),
    canvasStatus: $("#canvas-status"),
    pausedCover: $("#paused-cover"),
    eventCount: $("#event-count"),
    eventLog: $("#event-log"),
    emptyEvents: $("#empty-events"),
    deviceList: $("#device-list"),
    compareContent: $("#compare-content"),
    archiveCount: $("#archive-count"),
    historyButton: $("#history-button"),
    faultModal: $("#fault-modal"),
    faultTime: $("#fault-time"),
    faultTitle: $("#fault-title"),
    faultCode: $("#fault-code"),
    faultDevice: $("#fault-device"),
    faultDeviceRole: $("#fault-device-role"),
    faultValue: $("#fault-value"),
    faultThreshold: $("#fault-threshold"),
    faultDescription: $("#fault-description"),
    abortFaultButton: $("#abort-fault-button"),
    recoverButton: $("#recover-button"),
    batchModal: $("#batch-modal"),
    resultBanner: $("#result-banner"),
    resultTitle: $("#result-title"),
    resultId: $("#result-id"),
    resultGood: $("#result-good"),
    resultWaste: $("#result-waste"),
    resultPower: $("#result-power"),
    resultEvents: $("#result-events"),
    resultDowntime: $("#result-downtime"),
    resultRecovery: $("#result-recovery"),
    resultDevices: $("#result-devices"),
    resultCompareButton: $("#result-compare-button"),
    resultCloseButton: $("#result-close-button"),
    historyModal: $("#history-modal"),
    historyClose: $("#history-close"),
    historyList: $("#history-list"),
    toastStack: $("#toast-stack"),
    srStatus: $("#sr-status"),
  };

  const now = () => Date.now();
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, digits = 1) => Number(value.toFixed(digits));
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const pad = (value) => String(value).padStart(2, "0");

  function formatClock(timestamp = now()) {
    if (!timestamp) return "--:--:--";
    const d = new Date(timestamp);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatPrecise(timestamp) {
    if (!timestamp) return "--:--:--";
    const d = new Date(timestamp);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "00:00";
    const total = Math.floor(ms / 1000);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function createDevices() {
    return DEVICE_DEFS.map((definition) => ({
      ...definition,
      status: "off",
      lastStartedAt: null,
      lastStoppedAt: null,
      totalRunMs: 0,
      segmentStartedAt: null,
      startCount: 0,
      stopCount: 0,
      faultDetail: null,
    }));
  }

  const app = {
    phase: "idle",
    params: { pressure: 58, offset: 0.08, speed: 20 },
    devices: createDevices(),
    batch: null,
    archives: [],
    snapshots: [],
    compareIds: [],
    lastResult: null,
    fault: null,
    nextBatchNumber: 148,
    cycleElapsed: 0,
    cycleProgress: 0,
    lastProgress: 0,
    bufferLoad: 0,
    power: 0,
    peakPower: 0,
    currentCycleMs: 2800,
    recoveryRemaining: 0,
    recoveryBaseline: null,
    lastFrame: 0,
    uiAccumulator: 0,
    limitCheckAccumulator: 0,
    pendingScenarioTimer: null,
    pendingScenarioName: null,
    soundActive: false,
  };

  window.__LAMINA__ = {
    getState: () => ({
      phase: app.phase,
      params: { ...app.params },
      batch: app.batch,
      archives: app.archives,
      compareIds: [...app.compareIds],
      recoveryRemaining: app.recoveryRemaining,
      fault: app.fault,
      bufferLoad: app.bufferLoad,
      power: app.power,
    }),
    setParam,
    start: startBatch,
    pause: pauseBatch,
    reset: resetCurrentBatch,
    scenario: runScenario,
    injectFault: injectEquipmentFault,
    recover: beginRecovery,
    saveSnapshot: takeSnapshot,
    compare: renderComparison,
  };

  function showToast(title, detail, tone = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    toast.innerHTML = `<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
    elements.toastStack.appendChild(toast);
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(8px)";
      toast.style.transition = "0.2s ease";
      window.setTimeout(() => toast.remove(), 220);
    }, 3400);
  }

  function announce(message) {
    elements.srStatus.textContent = "";
    window.setTimeout(() => {
      elements.srStatus.textContent = message;
    }, 30);
  }

  function newBatch(reason = "手动新建") {
    const id = `B-${String(app.nextBatchNumber).padStart(4, "0")}`;
    app.nextBatchNumber += 1;
    const timestamp = now();
    app.batch = {
      id,
      sequence: app.nextBatchNumber - 1,
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
      activeStartedAt: null,
      params: { ...app.params },
      good: 0,
      waste: 0,
      cycles: 0,
      peakPower: 0,
      events: [],
      timeline: [],
      groups: [],
      downtimeReasons: [],
      faultCount: 0,
      fault: null,
      recovery: { status: "not-triggered", attempts: 0, checks: [] },
      outcome: null,
      stopReason: reason,
    };
    app.cycles = 0;
    app.cycleElapsed = 0;
    app.cycleProgress = 0;
    app.lastProgress = 0;
    app.bufferLoad = 0;
    app.power = 0;
    app.peakPower = 0;
    app.fault = null;
    app.recoveryRemaining = 0;
    app.recoveryBaseline = null;
    app.devices = createDevices();
    clearScenarioTimer();
    hideFaultModal();
    hideBatchModal();
    renderAll();
  }

  function setParam(name, value, options = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const limits = name === "offset" ? { min: -1, max: 1 } : name === "pressure" ? { min: 20, max: 90 } : { min: 8, max: 32 };
    const rounded = name === "offset" ? round(clamp(numeric, limits.min, limits.max), 2) : Math.round(clamp(numeric, limits.min, limits.max));
    app.params[name] = rounded;

    const input = elements[name];
    if (input) input.value = String(rounded);
    renderParameterUI();

    if (!options.silent && app.phase === "running") {
      checkParameterLimit();
    }
  }

  function parameterAnalysis() {
    const errors = [];
    const warnings = [];
    const { pressure, offset, speed } = app.params;
    const absOffset = Math.abs(offset);

    if (pressure > CONFIG.safe.pressure.max) {
      errors.push({
        code: "E-VP01-H",
        deviceId: "VP-01",
        title: "吸盘压力超过隔膜耐压",
        value: `${pressure} kPa`,
        threshold: `安全上限 ${CONFIG.safe.pressure.max} kPa`,
        description: "真空吸盘压力过高，隔膜局部受压超过材料屈服点，存在压伤与微短路风险。真空阀与叠片轴已联锁停机。",
      });
    } else if (pressure < CONFIG.safe.pressure.min) {
      errors.push({
        code: "E-VP01-L",
        deviceId: "VP-01",
        title: "吸盘压力低于抓取下限",
        value: `${pressure} kPa`,
        threshold: `安全下限 ${CONFIG.safe.pressure.min} kPa`,
        description: "真空度不足，极片在搬运过程中有掉片风险。吸盘真空单元未达到抓取确认阈值。",
      });
    } else if (pressure > 66) {
      warnings.push("吸盘压力接近隔膜耐压上限");
    }

    if (absOffset > CONFIG.safe.offset.max) {
      errors.push({
        code: "E-AL02-X",
        deviceId: "AL-02",
        title: "对位偏移超出短路窗口",
        value: `${offset >= 0 ? "+" : ""}${offset.toFixed(2)} mm`,
        threshold: `允许窗口 ±${CONFIG.safe.offset.max.toFixed(2)} mm`,
        description: "CCD 对位偏差越过极片安全搭接窗口，正负极边缘净距不足，可能形成短路。对位平台与放料轴已联锁停机。",
      });
    } else if (absOffset > 0.28) {
      warnings.push("对位偏移接近短路风险窗口");
    }

    if (speed > CONFIG.safe.speed.max) {
      errors.push({
        code: "E-BF03-J",
        deviceId: "BF-03",
        title: "进料节拍超过缓存释放能力",
        value: `${speed} 组/min`,
        threshold: `安全上限 ${CONFIG.safe.speed.max} 组/min`,
        description: "来料速度超过缓存释放能力，入口光电检测到堆料。进料缓存单元触发堵塞联锁，机械臂与对位平台已同步停机。",
      });
    } else if (speed < CONFIG.safe.speed.min) {
      errors.push({
        code: "E-BF03-S",
        deviceId: "BF-03",
        title: "进料节拍低于稳定下限",
        value: `${speed} 组/min`,
        threshold: `安全下限 ${CONFIG.safe.speed.min} 组/min`,
        description: "节拍低于供料伺服稳定区间，缓存张力闭环无法维持。为避免薄片起皱，产线已联锁停机。",
      });
    } else if (speed > 23) {
      warnings.push("缓存占用接近预警水位");
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  function renderParameterUI() {
    const values = {
      pressure: `${app.params.pressure} <small>kPa</small>`,
      offset: `${app.params.offset >= 0 ? "+" : ""}${app.params.offset.toFixed(2)} <small>mm</small>`,
      speed: `${app.params.speed} <small>组/min</small>`,
    };
    elements.pressureValue.innerHTML = values.pressure;
    elements.offsetValue.innerHTML = values.offset;
    elements.speedValue.innerHTML = values.speed;

    const ranges = { pressure: [20, 90], offset: [-1, 1], speed: [8, 32] };
    ["pressure", "offset", "speed"].forEach((name) => {
      const [min, max] = ranges[name];
      const percent = ((app.params[name] - min) / (max - min)) * 100;
      const input = elements[name];
      input.style.setProperty("--range-fill", `${percent}%`);

      const analysis = parameterAnalysis();
      const hasError = analysis.errors.some((item) => item.deviceId === (name === "pressure" ? "VP-01" : name === "offset" ? "AL-02" : "BF-03"));
      const hasWarning = analysis.warnings.some((text) => text.includes(name === "pressure" ? "吸盘" : name === "offset" ? "对位" : "缓存"));
      const wrapper = input.closest(".parameter");
      wrapper.classList.toggle("is-danger", hasError);
      wrapper.classList.toggle("is-warning", !hasError && hasWarning);
    });

    const analysis = parameterAnalysis();
    const stateLabel = analysis.errors.length ? "越限" : analysis.warnings.length ? "接近边界" : "窗口内";
    elements.parameterState.textContent = stateLabel;
    elements.parameterState.style.color = analysis.errors.length ? "var(--red)" : analysis.warnings.length ? "var(--amber)" : "";

    const feedback = elements.parameterFeedback;
    feedback.className = "parameter-feedback";
    if (analysis.errors.length) {
      feedback.classList.add("danger");
      feedback.innerHTML = `<span class="feedback-icon">!</span><span>${escapeHtml(analysis.errors[0].title)} · 将触发联锁</span>`;
    } else if (analysis.warnings.length) {
      feedback.classList.add("warning");
      feedback.innerHTML = `<span class="feedback-icon">!</span><span>${escapeHtml(analysis.warnings[0])}</span>`;
    } else {
      feedback.innerHTML = `<span class="feedback-icon">✓</span><span>三项参数均处于工艺窗口</span>`;
    }
  }

  function checkParameterLimit() {
    if (app.phase !== "running") return false;
    const analysis = parameterAnalysis();
    if (!analysis.ok) {
      triggerFault(analysis.errors[0], "参数越限");
      return true;
    }
    return false;
  }

  function logEvent(kind, title, detail, options = {}) {
    if (!app.batch) return;
    const event = {
      id: `${app.batch.id}-${app.batch.events.length + 1}`,
      timestamp: options.timestamp || now(),
      kind,
      title,
      detail: detail || "",
      deviceId: options.deviceId || "SYSTEM",
      deviceName: options.deviceName || "产线控制",
      handling: options.handling || "自动记录",
    };
    app.batch.events.push(event);
    renderEventLog();
    return event;
  }

  function deviceStart(device, reason) {
    if (device.status === "on") return;
    const timestamp = now();
    device.status = "on";
    device.faultDetail = null;
    device.lastStartedAt = timestamp;
    device.segmentStartedAt = timestamp;
    device.startCount += 1;
    if (app.batch) {
      app.batch.timeline.push({
        timestamp,
        deviceId: device.id,
        deviceName: device.name,
        action: "start",
        reason,
      });
    }
  }

  function deviceStop(device, status, reason) {
    if (device.status !== "on") {
      device.status = status;
      return;
    }
    const timestamp = now();
    if (device.segmentStartedAt) {
      device.totalRunMs += Math.max(0, timestamp - device.segmentStartedAt);
    }
    device.segmentStartedAt = null;
    device.lastStoppedAt = timestamp;
    device.stopCount += 1;
    device.status = status;
    if (app.batch) {
      app.batch.timeline.push({
        timestamp,
        deviceId: device.id,
        deviceName: device.name,
        action: "stop",
        reason,
      });
    }
  }

  function startAllDevices(reason) {
    app.devices.forEach((device) => deviceStart(device, reason));
    if (app.batch) {
      logEvent("info", "关键设备启动", `5 台设备已同步启动 · ${reason}`, {
        handling: "自动留痕",
        timestamp: now(),
      });
    }
    renderDevices();
  }

  function stopAllDevices(reason, finalStatus = "off") {
    app.devices.forEach((device) => {
      if (device.status === "on") deviceStop(device, finalStatus, reason);
    });
    if (app.batch) {
      logEvent("info", "关键设备停机", `5 台设备已同步停止 · ${reason}`, {
        handling: "自动留痕",
      });
    }
    renderDevices();
  }

  function getDevice(deviceId) {
    return app.devices.find((device) => device.id === deviceId);
  }

  function startBatch() {
    if (["running", "fault", "recovering"].includes(app.phase)) return;
    if (app.phase === "paused") {
      resumeBatch();
      return;
    }
    if (!app.batch || app.phase === "finished") {
      newBatch("启动批次");
    }

    app.batch.startedAt = app.batch.startedAt || now();
    app.batch.params = { ...app.params };
    app.batch.outcome = null;
    app.phase = "running";
    app.cycleElapsed = 0;
    app.cycleProgress = 0;
    app.lastProgress = 0;
    app.lastFrame = performance.now();
    app.batch.activeStartedAt = now();
    logEvent("info", "批次启动", `${app.batch.id} · 目标 ${CONFIG.targetGood} 组合格叠片`, {
      handling: "操作员启动",
    });
    startAllDevices("批次启动");
    showToast("批次已启动", `${app.batch.id} 进入自动叠片节拍`, "success");
    announce("批次已启动，产线自动运行");
    renderAll();

    const analysis = parameterAnalysis();
    if (!analysis.ok) {
      triggerFault(analysis.errors[0], "启动参数校验");
    }
  }

  function pauseBatch() {
    if (app.phase === "paused") {
      resumeBatch();
      return;
    }
    if (app.phase !== "running") return;
    app.phase = "paused";
    stopAllDevices("操作员暂停检查", "paused");
    if (app.batch) {
      app.batch.downtimeReasons.push("操作员暂停检查");
      logEvent("warn", "暂停检查", "机械臂、对位、真空、叠片台与缓存已同步停机", {
        handling: "操作员暂停",
      });
    }
    if (window.LaminaAudio) window.LaminaAudio.setMotion(0, 0, false);
    showToast("已暂停", "关键设备已停机并记录停止时刻", "warn");
    announce("批次已暂停，可检查设备状态");
    renderAll();
  }

  function resumeBatch() {
    if (app.phase !== "paused") return;
    app.phase = "running";
    app.lastFrame = performance.now();
    if (app.batch) {
      logEvent("info", "恢复运行", "暂停检查完成，设备按原批次继续运行", {
        handling: "操作员恢复",
      });
    }
    startAllDevices("暂停检查完成");
    showToast("检查完成", "设备重新启动，当前批次继续", "success");
    announce("设备已恢复，批次继续运行");
    renderAll();
  }

  function resetCurrentBatch() {
    clearScenarioTimer();
    if (!app.batch) {
      newBatch("操作员重置");
      return;
    }

    const meaningful = app.batch.cycles > 0
      || app.batch.faultCount > 0
      || app.batch.recovery.attempts > 0
      || ["running", "paused", "recovering"].includes(app.phase);

    if (meaningful) {
      if (app.phase === "running" || app.phase === "paused" || app.phase === "recovering") {
        stopAllDevices("操作员重置当前批次");
      }
      archiveCurrentBatch("aborted", "操作员重置当前批次");
    } else {
      newBatch("操作员重置");
      showToast("批次已重置", "当前计数已清零，未产生可归档数据", "info");
    }
  }

  function triggerFault(fault, source = "自动联锁") {
    if (app.phase === "fault" || app.phase === "finished") return;
    clearScenarioTimer();
    const timestamp = now();
    app.fault = {
      ...fault,
      source,
      timestamp,
    };
    app.phase = "fault";

    const target = getDevice(fault.deviceId);
    stopAllDevices(`安全联锁：${fault.title}`);
    if (target) {
      target.status = "fault";
      target.lastStoppedAt = timestamp;
      target.faultDetail = `${fault.value} / ${fault.threshold}`;
    }

    if (app.batch) {
      app.batch.faultCount += 1;
      app.batch.fault = { ...app.fault };
      app.batch.lastParams = { ...app.params };
      app.batch.downtimeReasons.push(`${fault.deviceId} ${fault.title}`);
      app.batch.recovery.status = "required";
      logEvent("danger", fault.title, `${fault.value} · ${fault.threshold}`, {
        deviceId: fault.deviceId,
        deviceName: target ? `${target.name} · ${target.id}` : fault.deviceId,
        handling: "等待人工复位",
      });
    }

    if (window.LaminaAudio) {
      window.LaminaAudio.setMotion(0, 0, false);
      window.LaminaAudio.faultAlarm();
    }
    showFaultModal();
    showToast("安全联锁停机", `${fault.deviceId} · ${fault.value}`, "danger");
    announce(`设备故障，${fault.deviceId} 触发 ${fault.value}，产线已停机`);
    renderAll();
  }

  function injectEquipmentFault() {
    if (app.phase === "fault" || app.phase === "finished") return;
    if (app.phase === "paused") {
      showToast("请先恢复运行", "暂停状态下不注入设备故障", "warn");
      return;
    }
    if (app.phase === "idle" || app.phase === "recovering") {
      showToast("无法注入", "设备故障需在自动运行状态下注入", "warn");
      return;
    }
    const fault = {
      code: "E-SV04",
      deviceId: "RB-01",
      deviceName: "放料机械臂 · RB-01",
      deviceRole: "Robotic arm / 伺服驱动",
      title: "机械臂伺服过流",
      value: "11.8 A",
      threshold: "保护阈值 9.5 A",
      description: "放料机械臂 Z 轴伺服电流超过驱动器保护阈值，驱动器封锁输出。产线安全联锁已停止全部运动轴。",
    };
    triggerFault(fault, "设备故障注入");
  }

  function beginRecovery() {
    if (app.phase !== "fault") return;
    const previousFault = app.batch ? app.batch.fault : null;
    const originalParams = { ...app.params };
    const corrected = [];

    if (app.params.pressure > CONFIG.safe.pressure.max) corrected.push(`吸盘压力 ${app.params.pressure}→${CONFIG.safe.pressure.max} kPa`);
    if (app.params.pressure < CONFIG.safe.pressure.min) corrected.push(`吸盘压力 ${app.params.pressure}→${CONFIG.safe.pressure.min} kPa`);
    if (app.params.offset > CONFIG.safe.offset.max) corrected.push(`对位偏移 ${app.params.offset.toFixed(2)}→${CONFIG.safe.offset.max.toFixed(2)} mm`);
    if (app.params.offset < CONFIG.safe.offset.min) corrected.push(`对位偏移 ${app.params.offset.toFixed(2)}→${CONFIG.safe.offset.min.toFixed(2)} mm`);
    if (app.params.speed > CONFIG.safe.speed.max) corrected.push(`节拍速度 ${app.params.speed}→${CONFIG.safe.speed.max} 组/min`);
    if (app.params.speed < CONFIG.safe.speed.min) corrected.push(`节拍速度 ${app.params.speed}→${CONFIG.safe.speed.min} 组/min`);

    app.params.pressure = clamp(app.params.pressure, CONFIG.safe.pressure.min, CONFIG.safe.pressure.max);
    app.params.offset = round(clamp(app.params.offset, CONFIG.safe.offset.min, CONFIG.safe.offset.max), 2);
    app.params.speed = clamp(app.params.speed, CONFIG.safe.speed.min, CONFIG.safe.speed.max);
    syncParameterInputs();

    hideFaultModal();
    app.fault = null;
    app.bufferLoad = 0;
    app.cycleElapsed = 0;
    app.cycleProgress = 0;
    app.lastProgress = 0;
    app.recoveryRemaining = CONFIG.recoveryMs;
    app.recoveryBaseline = {
      faultCount: app.batch ? app.batch.faultCount : 0,
      waste: app.batch ? app.batch.waste : 0,
      cycles: app.batch ? app.batch.cycles : 0,
      startedAt: now(),
      corrected,
      previousFault,
    };
    app.phase = "recovering";
    app.devices.forEach((device) => {
      device.status = "off";
      device.faultDetail = null;
    });

    if (app.batch) {
      app.batch.recovery.attempts += 1;
      app.batch.recovery.status = "validating";
      app.batch.recovery.startedAt = now();
      app.batch.recovery.corrected = corrected;
      app.batch.downtimeReasons.push("复位恢复验证");
      logEvent("recovery", "复位完成", corrected.length ? `越限参数已回退：${corrected.join("；")}` : "故障锁存已清除，缓存已清空", {
        deviceId: previousFault ? previousFault.deviceId : "SYSTEM",
        handling: "人工复位",
      });
    }
    startAllDevices("复位恢复验证");
    showToast("复位成功", "开始固定 8 秒恢复验证，期间不累计产出", "info");
    announce("设备已复位，开始八秒恢复验证");
    renderAll();
  }

  function completeRecovery() {
    if (app.phase !== "recovering" || !app.batch) return;
    const baseline = app.recoveryBaseline || {};
    const checks = [
      { label: "故障计数未增长", passed: app.batch.faultCount === baseline.faultCount, detail: `Δ${app.batch.faultCount - baseline.faultCount}` },
      { label: "废品计数未累计", passed: app.batch.waste === baseline.waste, detail: `Δ${app.batch.waste - baseline.waste}` },
      { label: "缓存占用已回落", passed: app.bufferLoad <= 2, detail: `${app.bufferLoad}/8` },
      { label: "故障锁存已清除", passed: !app.fault, detail: "0 锁存" },
      { label: "关键设备状态同步", passed: app.devices.every((device) => device.status === "on"), detail: `${app.devices.filter((device) => device.status === "on").length}/5 ON` },
    ];
    const passed = checks.every((check) => check.passed);
    app.batch.recovery.status = passed ? "passed" : "failed";
    app.batch.recovery.completedAt = now();
    app.batch.recovery.durationMs = CONFIG.recoveryMs;
    app.batch.recovery.checks = checks;

    if (!passed) {
      const failed = checks.find((check) => !check.passed);
      triggerFault({
        code: "E-RCV01",
        deviceId: "BF-03",
        title: "恢复验证发现状态残留",
        value: failed ? failed.detail : "校验失败",
        threshold: "恢复验证要求全部归零",
        description: "固定时长恢复验证检测到残留状态，设备再次进入安全停机。批次暂停继续计数。",
      }, "恢复验证");
      return;
    }

    app.phase = "running";
    app.recoveryRemaining = 0;
    app.recoveryBaseline = null;
    app.lastFrame = performance.now();
    logEvent("recovery", "恢复验证通过", "8.0s · 故障Δ0 · 废品Δ0 · 缓存回落 · 5/5 设备同步", {
      deviceId: "SYSTEM",
      handling: "自动验证完成",
    });
    showToast("恢复验证通过", "无隐藏状态残留，当前批次继续运行", "success");
    announce("恢复验证通过，产线继续运行");
    renderAll();
  }

  function completeCycle() {
    if (app.phase !== "running" || !app.batch) return;
    const cycleNumber = app.batch.cycles + 1;
    const offsetJitter = (Math.random() - 0.5) * 0.025;
    const groupOffset = clamp(app.params.offset + offsetJitter, -1, 1);

    app.batch.cycles = cycleNumber;
    app.batch.peakPower = Math.max(app.batch.peakPower, app.peakPower);
    app.peakPower = app.batch.peakPower;

    app.bufferLoad = clamp(
      app.bufferLoad + (app.params.speed >= 24 ? 2 : 1) - (app.params.speed <= 23 && cycleNumber % 2 === 0 ? 1 : 0),
      0,
      CONFIG.bufferLimit,
    );

    if (app.bufferLoad >= CONFIG.bufferLimit) {
      triggerFault({
        code: "E-BF03-F",
        deviceId: "BF-03",
        title: "缓存堵塞 · 堆料满载",
        value: `${app.bufferLoad} / ${CONFIG.bufferLimit} 槽`,
        threshold: `缓存安全占用 ≤ ${CONFIG.bufferLimit - 1} 槽`,
        description: `节拍速度 ${app.params.speed} 组/min 持续高于缓存释放能力，入口缓存达到 ${CONFIG.bufferLimit}/8。光电联锁已停止进料与机械臂。`,
      }, "缓存联锁");
      return;
    }

    const absOffset = Math.abs(groupOffset);
    let risk = 0.025;
    risk += Math.max(0, absOffset - 0.16) * 0.36;
    risk += Math.max(0, app.params.pressure - 62) * 0.009;
    risk += Math.max(0, app.params.speed - 21) * 0.014;
    risk += Math.max(0, app.bufferLoad - 3) * 0.008;
    const good = Math.random() >= risk;
    let defect = null;
    if (!good) {
      if (absOffset > 0.3) defect = "对位偏差导致极片边缘净距不足";
      else if (app.params.pressure > 65) defect = "隔膜局部压痕，绝缘耐压不合格";
      else if (app.bufferLoad >= 4 || app.params.speed >= 23) defect = "缓存挤压导致隔膜褶皱";
      else defect = "极片边缘微裂，绝缘检测不合格";
    }

    const group = {
      index: cycleNumber,
      offset: round(groupOffset, 3),
      good,
      defect,
      completedAt: now(),
    };
    app.batch.groups.push(group);

    if (good) {
      app.batch.good += 1;
      logEvent("info", `叠片 #${String(cycleNumber).padStart(2, "0")} 合格`, `合格 ${app.batch.good}/${CONFIG.targetGood} · ΔX ${groupOffset >= 0 ? "+" : ""}${groupOffset.toFixed(3)} mm · ${app.params.speed} 组/min`, {
        deviceId: "ST-03",
        deviceName: "叠片热压台 · ST-03",
        handling: "质量判定通过",
      });
    } else {
      app.batch.waste += 1;
      logEvent("warn", `叠片 #${String(cycleNumber).padStart(2, "0")} 判废`, `${defect} · 缓存 ${app.bufferLoad}/8`, {
        deviceId: app.params.offset > 0.3 ? "AL-02" : "ST-03",
        deviceName: app.params.offset > 0.3 ? "CCD 对位平台 · AL-02" : "叠片热压台 · ST-03",
        handling: "自动剔除至废料箱",
      });
    }

    if (app.batch.good >= CONFIG.targetGood) {
      finishSuccessfulBatch();
      return;
    }

    renderAll();
  }

  function finishSuccessfulBatch() {
    if (!app.batch) return;
    stopAllDevices("达到十组合格叠片");
    app.batch.downtimeReasons = app.batch.downtimeReasons.filter((reason) => !reason.includes("目标达成"));
    app.batch.downtimeReasons.push("目标达成 · 正常停机");
    archiveCurrentBatch("success", "十组合格叠片完成，设备正常停机");
  }

  function archiveCurrentBatch(outcome, stopReason) {
    if (!app.batch) return null;
    const timestamp = now();
    const batch = app.batch;
    batch.endedAt = timestamp;
    batch.durationMs = Math.max(0, timestamp - (batch.startedAt || batch.createdAt));
    batch.peakPower = round(Math.max(batch.peakPower, app.peakPower), 1);
    batch.outcome = outcome;
    batch.stopReason = stopReason;
    batch.lastParams = { ...app.params };
    batch.yieldRate = batch.good + batch.waste > 0
      ? round((batch.good / (batch.good + batch.waste)) * 100, 1)
      : 0;
    batch.deviceSnapshot = app.devices.map((device) => ({
      id: device.id,
      name: device.name,
      role: device.role,
      status: device.status,
      lastStartedAt: device.lastStartedAt,
      lastStoppedAt: device.lastStoppedAt,
      totalRunMs: device.totalRunMs + (device.status === "on" && device.segmentStartedAt ? timestamp - device.segmentStartedAt : 0),
      startCount: device.startCount,
      stopCount: device.stopCount,
    }));
    if (outcome === "fault" && batch.fault) {
      batch.stopReason = `${batch.fault.deviceId} · ${batch.fault.title}`;
    }

    const archived = deepFreeze(structuredClone(batch));
    app.archives.push(archived);
    app.compareIds = app.archives.slice(-2).map((run) => run.id);
    app.lastResult = archived;
    app.batch = null;
    app.phase = "finished";
    app.power = 0;
    app.cycleElapsed = 0;
    app.cycleProgress = 0;
    app.fault = null;
    app.recoveryRemaining = 0;
    if (window.LaminaAudio) window.LaminaAudio.setMotion(0, 0, false);
    clearScenarioTimer();
    hideFaultModal();
    showBatchModal(archived);
    renderAll();
    return archived;
  }

  function clearScenarioTimer() {
    if (app.pendingScenarioTimer) {
      window.clearTimeout(app.pendingScenarioTimer);
      app.pendingScenarioTimer = null;
    }
  }

  function syncParameterInputs() {
    elements.pressure.value = String(app.params.pressure);
    elements.offset.value = String(app.params.offset);
    elements.speed.value = String(app.params.speed);
    renderParameterUI();
  }

  function renderAll() {
    renderStatus();
    renderControls();
    renderKpi();
    renderBatchPanel();
    renderDevices();
    renderEventLog();
    renderComparison();
    renderSnapshot();
    elements.archiveCount.textContent = String(app.archives.length);
  }

  function renderStatus() {
    const phase = app.phase;
    elements.globalStatus.textContent = STATUS_LABELS[phase] || STATUS_LABELS.idle;
    elements.statusCode.textContent = STATUS_CODES[phase] || "STANDBY";
    elements.globalBeacon.className = `status-beacon ${phase}`;

    elements.alignReadout.textContent = `ΔX ${app.params.offset >= 0 ? "+" : ""}${app.params.offset.toFixed(2)} mm`;
    elements.bufferReadout.textContent = `${app.bufferLoad} / 8`;
    elements.vacuumReadout.textContent = `−${app.params.pressure} kPa`;
    elements.cycleClock.textContent = `CYCLE ${String(app.batch ? app.batch.cycles : 0).padStart(4, "0")}`;
    elements.pausedCover.hidden = phase !== "paused";

    let statusText = "设备待机 · 等待批次启动";
    if (phase === "running") {
      const currentGroup = app.batch ? app.batch.good + app.batch.waste + 1 : 1;
      statusText = `RB-01 搬运中 · 当前第 ${currentGroup} 组 · 节拍 ${app.params.speed} 组/min · 实时功耗 ${app.power.toFixed(1)} kW`;
    } else if (phase === "paused") {
      statusText = "全轴停止 · 设备启停时刻已写入批次时序 · 可安全检查";
    } else if (phase === "fault") {
      statusText = app.fault ? `联锁停机 · ${app.fault.deviceId} · ${app.fault.value}` : "安全联锁停机";
    } else if (phase === "recovering") {
      statusText = `恢复验证运行 · 剩余 ${(app.recoveryRemaining / 1000).toFixed(1)} s · 本阶段不计产出`;
    } else if (phase === "finished") {
      statusText = "批次结果已冻结归档 · 只读";
    }
    elements.canvasStatus.textContent = statusText;
  }

  function renderControls() {
    const disabledParams = app.phase === "fault" || app.phase === "recovering";
    [elements.pressure, elements.offset, elements.speed].forEach((input) => {
      input.disabled = disabledParams;
    });

    const canStart = app.phase === "idle" || app.phase === "paused";
    elements.startButton.disabled = !canStart;
    elements.startLabel.textContent = app.phase === "paused"
      ? "继续运行"
      : app.phase === "running"
        ? "运行中"
        : app.phase === "recovering"
          ? "恢复验证中"
          : app.phase === "fault"
            ? "联锁停机"
            : "启动批次";
    elements.pauseButton.disabled = app.phase !== "running";
    elements.pauseButton.innerHTML = app.phase === "paused" ? "<span>Ⅱ</span> 已暂停" : "<span>Ⅱ</span> 暂停检查";
    elements.resetButton.disabled = app.phase === "recovering";
    $$(".scenario-button").forEach((button) => {
      button.disabled = app.phase === "recovering" || app.phase === "fault";
    });
  }

  function renderKpi() {
    const batch = app.batch;
    const good = batch ? batch.good : 0;
    const waste = batch ? batch.waste : 0;
    const total = good + waste;
    const yieldRate = total ? (good / total) * 100 : null;
    const faults = batch ? batch.faultCount : 0;
    const peak = batch ? Math.max(batch.peakPower, app.peakPower) : 0;
    const recovery = batch ? batch.recovery : null;

    elements.kpiGood.textContent = String(good).padStart(2, "0");
    elements.kpiYield.textContent = yieldRate === null ? "—" : yieldRate.toFixed(1);
    elements.kpiPower.textContent = peak.toFixed(1);
    elements.kpiEvents.textContent = String(faults).padStart(2, "0");
    elements.kpiGoodNote.textContent = good >= CONFIG.targetGood ? "目标达成" : `目标 ${CONFIG.targetGood} 组`;
    elements.kpiWasteNote.textContent = `废品 ${waste} 组`;
    elements.kpiYieldTrend.textContent = yieldRate === null ? "基线" : good >= CONFIG.targetGood ? "达标" : "跟踪中";
    elements.kpiYieldTrend.className = `trend ${yieldRate !== null && yieldRate >= 90 ? "up" : ""}`;
    elements.kpiPowerNote.textContent = `实时 ${app.power.toFixed(1)} kW`;
    elements.kpiDowntimeTag.textContent = faults ? `停机 ${faults} 次` : "无停机";
    elements.kpiDowntimeTag.className = `trend ${faults ? "danger" : "neutral"}`;
    elements.kpiRecoveryNote.textContent = recovery && recovery.status === "passed"
      ? "验证无残留"
      : recovery && recovery.status === "validating"
        ? "验证进行中"
        : recovery && recovery.status === "required"
          ? "等待复位"
          : "状态干净";
  }

  function renderBatchPanel() {
    const batch = app.batch;
    const good = batch ? batch.good : 0;
    const waste = batch ? batch.waste : 0;
    const groups = batch ? batch.groups : [];
    const phaseLabels = {
      idle: "待启动",
      running: "生产中",
      paused: "已暂停",
      fault: "联锁",
      recovering: "恢复验证",
      finished: "已归档",
    };
    elements.batchStatePill.textContent = phaseLabels[app.phase] || "待启动";
    elements.batchKicker.textContent = batch ? `BATCH · ${batch.id}` : "BATCH · --";
    elements.batchStatePill.className = `live-pill ${app.phase}`;
    elements.progressText.textContent = `${good} / ${CONFIG.targetGood}`;
    elements.progressBar.style.width = `${clamp((good / CONFIG.targetGood) * 100, 0, 100)}%`;

    elements.stackSlots.innerHTML = Array.from({ length: CONFIG.targetGood }, (_, index) => {
      const group = groups[index];
      const stateClass = group ? group.good ? "good" : "waste" : "";
      return `<span class="stack-slot ${stateClass}" title="${group ? `第 ${index + 1} 组 ${group.good ? "合格" : "废品"}` : `第 ${index + 1} 组待叠片`}"></span>`;
    }).join("");

    elements.batchGood.textContent = String(good);
    elements.batchWaste.textContent = String(waste);
    elements.batchPeak.innerHTML = `${(batch ? Math.max(batch.peakPower, app.peakPower) : 0).toFixed(1)} <small>kW</small>`;
    const recovery = batch ? batch.recovery : null;
    elements.batchRecovery.textContent = recovery
      ? recovery.status === "passed"
        ? "已通过"
        : recovery.status === "validating"
          ? `${(app.recoveryRemaining / 1000).toFixed(1)}s`
          : recovery.status === "required"
            ? "待复位"
            : "未触发"
      : "未触发";
    const downtime = batch && batch.downtimeReasons.length
      ? batch.downtimeReasons[batch.downtimeReasons.length - 1]
      : "无 · 正常运行";
    elements.batchDowntime.textContent = downtime;
    elements.batchDowntime.className = /联锁|故障|越限|堵塞|重置/.test(downtime) ? "danger" : "";
  }

  function renderDevices() {
    elements.deviceList.innerHTML = app.devices.map((device) => {
      const running = device.status === "on";
      const elapsed = device.totalRunMs + (running && device.segmentStartedAt ? now() - device.segmentStartedAt : 0);
      const stateLabel = device.status === "on"
        ? "RUN"
        : device.status === "fault"
          ? "FAULT"
          : device.status === "paused"
            ? "HOLD"
            : "STOP";
      return `
        <div class="device-row ${device.status}" title="${escapeHtml(device.faultDetail || device.role)}">
          <span class="device-led"></span>
          <div class="device-info">
            <div class="device-name"><b>${escapeHtml(device.id)}</b>${escapeHtml(device.name)}</div>
            <div class="device-times">
              <span>START ${formatClock(device.lastStartedAt)}</span>
              <span>STOP ${formatClock(device.lastStoppedAt)}</span>
              <span>Σ ${formatDuration(elapsed)}</span>
            </div>
          </div>
          <span class="device-state">${stateLabel}</span>
        </div>`;
    }).join("");
  }

  function renderEventLog() {
    const events = app.batch ? app.batch.events : [];
    elements.eventCount.textContent = `${events.length} 条记录`;
    elements.emptyEvents.hidden = events.length > 0;
    elements.eventLog.innerHTML = events.slice(-60).reverse().map((event) => {
      const rowClass = event.kind === "danger" ? "danger-row" : event.kind === "warn" ? "warn-row" : event.kind === "recovery" ? "recovery-row" : "";
      return `
        <tr class="${rowClass}">
          <td>${formatPrecise(event.timestamp)}</td>
          <td>${escapeHtml(event.deviceId)} · ${escapeHtml(event.deviceName.split(" · ")[0])}</td>
          <td class="event-name"><span class="event-dot"></span>${escapeHtml(event.title)}</td>
          <td title="${escapeHtml(event.detail)}">${escapeHtml(event.detail)}</td>
          <td>${escapeHtml(event.handling)}</td>
        </tr>`;
    }).join("");
  }

  function renderComparison() {
    if (app.archives.length < 2) {
      const remaining = 2 - app.archives.length;
      elements.compareContent.innerHTML = `
        <div class="compare-empty">
          <span class="empty-glyph">A/B</span>
          <strong>${app.archives.length === 1 ? "已完成 1 批，还需 1 批" : "等待完成两次批次"}</strong>
          <p>保存快照 → 修改参数 → 重跑，即可并排查看差异。归档后不可修改。</p>
        </div>`;
      return;
    }

    let selected = app.compareIds.map((id) => app.archives.find((run) => run.id === id)).filter(Boolean);
    if (selected.length < 2) selected = app.archives.slice(-2);
    const [runA, runB] = selected.slice(-2);
    const abnormalA = runA.faultCount > 0 || runA.outcome !== "success" || runA.recovery.attempts > 0;
    const abnormalB = runB.faultCount > 0 || runB.outcome !== "success" || runB.recovery.attempts > 0;
    const reason = (run) => run.stopReason || run.downtimeReasons[run.downtimeReasons.length - 1] || "正常停机";
    const deltaGood = runB.good - runA.good;
    const deltaWaste = runB.waste - runA.waste;
    const deltaPower = runB.peakPower - runA.peakPower;

    const card = (label, run, abnormal) => `
      <div class="compare-card ${abnormal ? "abnormal" : ""}">
        <div class="compare-card-head">
          <strong>${label} · ${escapeHtml(run.id)}</strong>
          <span class="compare-badge">${abnormal ? `异常 ${run.faultCount}` : "合格"}</span>
        </div>
        <div class="compare-metrics">
          <div><span>良品</span><b>${run.good}</b></div>
          <div><span>废品</span><b>${run.waste}</b></div>
          <div><span>良率</span><b>${run.yieldRate.toFixed(1)}%</b></div>
          <div><span>峰值</span><b>${run.peakPower.toFixed(1)}kW</b></div>
          <div><span>恢复</span><b>${run.recovery.attempts ? "已处理" : "—"}</b></div>
          <div><span>异常</span><b>${run.faultCount}</b></div>
        </div>
        <div class="compare-reason" title="${escapeHtml(reason(run))}">${escapeHtml(reason(run))}</div>
      </div>`;

    elements.compareContent.innerHTML = `
      <div class="comparison-grid">
        ${card("A", runA, abnormalA)}
        <div class="compare-vs">VS</div>
        ${card("B", runB, abnormalB)}
      </div>
      <div class="compare-delta">
        <span>B 相对 A</span>
        <span>良品 <strong class="${deltaGood < 0 ? "bad" : ""}">${deltaGood >= 0 ? "+" : ""}${deltaGood}</strong> · 废品 <strong class="${deltaWaste > 0 ? "bad" : ""}">${deltaWaste >= 0 ? "+" : ""}${deltaWaste}</strong> · 峰值 <strong class="${deltaPower > 0 ? "bad" : ""}">${deltaPower >= 0 ? "+" : ""}${deltaPower.toFixed(1)}kW</strong></span>
      </div>`;
  }

  function renderSnapshot() {
    const latest = app.snapshots[app.snapshots.length - 1];
    elements.snapshotApply.disabled = !latest;
    if (!latest) {
      elements.snapshotMeta.textContent = "尚未保存快照";
      return;
    }
    elements.snapshotMeta.textContent = `${latest.id} · ${formatClock(latest.timestamp)} · ${latest.params.pressure}kPa / ${latest.params.offset >= 0 ? "+" : ""}${latest.params.offset.toFixed(2)}mm / ${latest.params.speed}组/min`;
  }

  function takeSnapshot() {
    const timestamp = now();
    const snapshot = deepFreeze(structuredClone({
      id: `S-${String(app.snapshots.length + 1).padStart(2, "0")}`,
      timestamp,
      params: { ...app.params },
      phase: app.phase,
      batchId: app.batch ? app.batch.id : null,
      devices: app.devices.map((device) => ({
        id: device.id,
        name: device.name,
        status: device.status,
        lastStartedAt: device.lastStartedAt,
        lastStoppedAt: device.lastStoppedAt,
      })),
    }));
    app.snapshots.push(snapshot);
    renderSnapshot();
    if (app.batch) {
      logEvent("info", "设备状态快照已保存", `${snapshot.id} · 参数与 5 台设备状态已冻结`, {
        handling: "可重跑对比",
      });
    }
    showToast("快照已保存", `${snapshot.id} 可在修改参数前作为 A 组基线`, "success");
  }

  function applySnapshot() {
    const snapshot = app.snapshots[app.snapshots.length - 1];
    if (!snapshot) return;
    app.params = { ...snapshot.params };
    syncParameterInputs();
    if (app.batch) {
      logEvent("info", "应用设备快照", `${snapshot.id} · 参数已恢复，设备时序保持当前值`, {
        handling: "准备重跑",
      });
    }
    showToast("快照已应用", `${snapshot.id} 的工艺参数已恢复`, "info");
    if (app.phase === "running") checkParameterLimit();
  }

  function showFaultModal() {
    if (!app.fault) return;
    const fault = app.fault;
    const device = getDevice(fault.deviceId);
    elements.faultTime.textContent = formatClock(fault.timestamp);
    elements.faultTitle.textContent = fault.title;
    elements.faultCode.textContent = fault.code || "E-INTERLOCK";
    elements.faultDevice.textContent = device ? `${device.name} · ${device.id}` : (fault.deviceName || fault.deviceId);
    elements.faultDeviceRole.textContent = device ? device.role : (fault.deviceRole || "Critical device");
    elements.faultValue.textContent = fault.value;
    elements.faultThreshold.textContent = fault.threshold;
    elements.faultDescription.textContent = `${fault.description} 恢复时将执行固定 8 秒验证；越限参数会回退至安全边界。`;
    elements.faultModal.hidden = false;
  }

  function hideFaultModal() {
    elements.faultModal.hidden = true;
  }

  function showBatchModal(run) {
    const abnormal = run.outcome !== "success";
    elements.resultBanner.classList.toggle("failure", abnormal);
    elements.resultBanner.querySelector(".result-check").textContent = abnormal ? "!" : "✓";
    elements.resultTitle.textContent = abnormal
      ? run.outcome === "fault" ? "异常停机 · 批次归档" : "批次中止 · 数据归档"
      : "十组合格 · 批次完成";
    elements.resultId.textContent = run.id;
    elements.resultGood.textContent = String(run.good);
    elements.resultWaste.textContent = String(run.waste);
    elements.resultPower.textContent = run.peakPower.toFixed(1);
    elements.resultEvents.textContent = String(run.faultCount);
    elements.resultDowntime.textContent = run.stopReason || "无停机";
    elements.resultRecovery.textContent = run.recovery.attempts
      ? `${run.recovery.attempts} 次 · ${run.recovery.status === "passed" ? "验证通过" : "未完成"}`
      : "无需恢复";
    elements.resultDevices.textContent = `${run.deviceSnapshot ? run.deviceSnapshot.length : 5} 台设备 · ${run.timeline.length} 条启停记录`;
    elements.resultCompareButton.textContent = app.archives.length >= 2 ? "查看 A/B 对比" : "加入 A/B 对比";
    elements.batchModal.hidden = false;
  }

  function hideBatchModal() {
    elements.batchModal.hidden = true;
  }

  function showHistory() {
    elements.historyList.innerHTML = app.archives.length
      ? app.archives.slice().reverse().map((run) => {
        const abnormal = run.faultCount > 0 || run.outcome !== "success";
        return `
          <div class="history-item">
            <div class="history-id">${escapeHtml(run.id)}<small>${escapeHtml(formatClock(run.endedAt))}</small></div>
            <div class="history-params">${run.params.pressure}kPa · ${run.params.offset >= 0 ? "+" : ""}${run.params.offset.toFixed(2)}mm · ${run.params.speed}组/min</div>
            <div class="history-metric"><span>良品</span>${run.good}</div>
            <div class="history-metric"><span>废品</span>${run.waste}</div>
            <div class="history-metric"><span>峰值</span>${run.peakPower.toFixed(1)}kW</div>
            <div class="history-reason" title="${escapeHtml(run.stopReason || "")}">${escapeHtml(run.stopReason || "正常停机")}</div>
            <span class="history-status ${abnormal ? "abnormal" : ""}">${abnormal ? `异常 ${run.faultCount}` : "合格"}</span>
          </div>`;
      }).join("")
      : `<div class="history-empty">暂无已归档批次</div>`;
    elements.historyModal.hidden = false;
  }

  function runScenario(name) {
    if (app.phase === "recovering") {
      showToast("恢复验证中", "固定时长验证期间不能切换验收场景", "warn");
      return;
    }
    clearScenarioTimer();

    if (name === "normal") {
      if (["running", "paused", "fault"].includes(app.phase)) {
        showToast("当前批次未结束", "请重置当前批次或完成十组合格叠片后执行正常生产验收", "warn");
        return;
      }
      app.params = { pressure: 58, offset: 0.08, speed: 20 };
      syncParameterInputs();
      newBatch("验收：正常生产");
      startBatch();
      return;
    }

    if (name === "fault") {
      if (app.phase === "paused") {
        showToast("请先继续运行", "暂停时无法注入机械臂伺服故障", "warn");
        return;
      }
      if (app.phase === "running") {
        injectEquipmentFault();
        return;
      }
      if (app.phase === "fault") return;
      app.params = { pressure: 58, offset: 0.08, speed: 20 };
      syncParameterInputs();
      newBatch("验收：设备故障");
      startBatch();
      app.pendingScenarioTimer = window.setTimeout(() => {
        app.pendingScenarioTimer = null;
        if (app.phase === "running") injectEquipmentFault();
      }, 1200);
      showToast("设备故障场景", "运行 1.2 秒后注入 RB-01 伺服过流", "warn");
      return;
    }

    if (name === "limit") {
      if (app.phase === "paused") {
        showToast("请先继续运行", "暂停时修改越限参数不会触发联锁", "warn");
        return;
      }
      if (app.phase === "running") {
        setParam("speed", 32);
        return;
      }
      if (app.phase === "fault") return;
      app.params = { pressure: 58, offset: 0.08, speed: 32 };
      syncParameterInputs();
      newBatch("验收：参数越限");
      startBatch();
      return;
    }
  }

  function updatePower(delta) {
    let target = 0.12;
    if (app.phase === "running" || app.phase === "recovering") {
      const motion = window.LaminaRenderer.armMotion(app.cycleProgress, 900, 450);
      target = 1.35
        + motion.velocity * 2.15
        + app.params.speed * 0.075
        + app.params.pressure * 0.011
        + Math.random() * 0.24;
    } else if (app.phase === "fault") {
      target = 0.32;
    } else if (app.phase === "paused") {
      target = 0.18;
    }
    app.power += (target - app.power) * Math.min(1, delta / 240);
    app.peakPower = Math.max(app.peakPower, app.power);
    if (app.batch && app.phase !== "finished") {
      app.batch.peakPower = Math.max(app.batch.peakPower, app.power);
    }
  }

  function renderFrameSnapshot() {
    return {
      status: app.phase === "finished" ? "idle" : app.phase,
      progress: app.cycleProgress,
      params: { ...app.params },
      bufferLoad: Math.round(app.bufferLoad),
      groups: app.batch ? app.batch.groups : [],
      cycleIndex: app.batch ? app.batch.cycles : 0,
      recoveryRemaining: app.recoveryRemaining,
      fault: app.fault,
    };
  }

  function simulationFrame(timestamp) {
    const delta = app.lastFrame ? Math.min(220, Math.max(0, timestamp - app.lastFrame)) : 16;
    app.lastFrame = timestamp;

    if (app.phase === "running") {
      app.currentCycleMs = CONFIG.baseCycleFactor / app.params.speed;
      app.cycleElapsed += delta;
      app.limitCheckAccumulator += delta;

      const previousProgress = app.lastProgress;
      app.cycleProgress = app.cycleElapsed / app.currentCycleMs;
      if (previousProgress < 0.12 && app.cycleProgress >= 0.12 && window.LaminaAudio) {
        window.LaminaAudio.tick("pick");
      }
      if (previousProgress < 0.72 && app.cycleProgress >= 0.72 && window.LaminaAudio) {
        window.LaminaAudio.tick("place");
      }

      while (app.phase === "running" && app.cycleElapsed >= app.currentCycleMs) {
        app.cycleElapsed -= app.currentCycleMs;
        app.cycleProgress = app.cycleElapsed / app.currentCycleMs;
        completeCycle();
      }
      app.lastProgress = app.cycleProgress;

      if (app.limitCheckAccumulator >= 180) {
        app.limitCheckAccumulator = 0;
        checkParameterLimit();
      }
      updatePower(delta);
    } else if (app.phase === "recovering") {
      app.recoveryRemaining = Math.max(0, app.recoveryRemaining - delta);
      app.cycleElapsed = (app.cycleElapsed + delta) % 2600;
      app.cycleProgress = app.cycleElapsed / 2600;
      app.bufferLoad = Math.max(0, app.bufferLoad - delta / 600);
      updatePower(delta);
      if (app.recoveryRemaining <= 0) completeRecovery();
    } else {
      updatePower(delta);
    }

    if (window.LaminaAudio) {
      const motion = window.LaminaRenderer.armMotion(app.cycleProgress, 900, 450);
      const active = app.phase === "running" || app.phase === "recovering";
      window.LaminaAudio.setMotion(motion.velocity, app.cycleProgress, active);
    }

    window.LaminaRenderer.draw(renderFrameSnapshot(), timestamp);
    app.uiAccumulator += delta;
    if (app.uiAccumulator >= 90 && ["running", "recovering"].includes(app.phase)) {
      app.uiAccumulator = 0;
      renderStatus();
      renderKpi();
      renderBatchPanel();
      renderDevices();
      elements.archiveCount.textContent = String(app.archives.length);
    }
    window.requestAnimationFrame(simulationFrame);
  }

  function abortFaultedBatch() {
    if (app.phase !== "fault" || !app.batch) return;
    const run = app.batch;
    hideFaultModal();
    archiveCurrentBatch("fault", run.fault ? `${run.fault.deviceId} · ${run.fault.title}` : "设备故障停机");
  }

  function bindEvents() {
    elements.pressure.addEventListener("input", (event) => setParam("pressure", event.target.value));
    elements.offset.addEventListener("input", (event) => setParam("offset", event.target.value));
    elements.speed.addEventListener("input", (event) => setParam("speed", event.target.value));

    elements.startButton.addEventListener("click", startBatch);
    elements.pauseButton.addEventListener("click", pauseBatch);
    elements.resetButton.addEventListener("click", resetCurrentBatch);
    elements.snapshotButton.addEventListener("click", takeSnapshot);
    elements.snapshotApply.addEventListener("click", applySnapshot);

    $$(".scenario-button").forEach((button) => {
      button.addEventListener("click", () => runScenario(button.dataset.scenario));
    });

    elements.audioToggle.addEventListener("click", async () => {
      const enabled = await window.LaminaAudio.toggle();
      elements.audioToggle.setAttribute("aria-pressed", String(enabled));
      elements.audioLabel.textContent = enabled ? "声音开启" : "声音关闭";
      if (enabled) {
        showToast("机械声场已开启", "音高与增益随机械臂运动实时变化", "info");
      }
    });

    elements.recoverButton.addEventListener("click", beginRecovery);
    elements.abortFaultButton.addEventListener("click", abortFaultedBatch);
    elements.resultCloseButton.addEventListener("click", () => {
      hideBatchModal();
      newBatch("新批次");
    });
    elements.resultCompareButton.addEventListener("click", () => {
      if (app.lastResult) {
        app.compareIds = app.archives.slice(-2).map((run) => run.id);
        renderComparison();
      }
      hideBatchModal();
      newBatch("A/B 对比准备");
      showToast(
        app.archives.length >= 2 ? "A/B 对比已就绪" : "已加入 A 组基线",
        app.archives.length >= 2 ? "右侧面板已并排显示最近两次归档结果" : "完成下一批后将自动并排对比",
        "success",
      );
    });
    elements.historyButton.addEventListener("click", showHistory);
    elements.historyClose.addEventListener("click", () => {
      elements.historyModal.hidden = true;
    });

    document.addEventListener("keydown", (event) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.code === "Space") {
        event.preventDefault();
        if (app.phase === "running" || app.phase === "paused") pauseBatch();
        else if (app.phase === "idle") startBatch();
      }
      if (event.key === "Escape" && !elements.historyModal.hidden) {
        elements.historyModal.hidden = true;
      }
    });
  }

  function seedComparisonBaseline() {
    const timestamp = now();
    const commonDevices = DEVICE_DEFS.map((device) => ({
      ...device,
      status: "off",
      lastStartedAt: timestamp - 96000,
      lastStoppedAt: timestamp - 24000,
      totalRunMs: 72000,
      startCount: 1,
      stopCount: 1,
    }));
    const baseRun = {
      createdAt: timestamp - 120000,
      startedAt: timestamp - 96000,
      endedAt: timestamp - 24000,
      durationMs: 72000,
      params: { pressure: 58, offset: 0.08, speed: 20 },
      lastParams: { pressure: 58, offset: 0.08, speed: 20 },
      groups: Array.from({ length: 10 }, (_, index) => ({ index: index + 1, offset: 0.08, good: true, defect: null })),
      timeline: [],
      deviceSnapshot: commonDevices,
    };
    const runA = {
      ...baseRun,
      id: "B-0146",
      good: 10,
      waste: 0,
      cycles: 10,
      peakPower: 5.9,
      events: [
        { id: "B-0146-1", timestamp: timestamp - 96000, kind: "info", title: "批次启动", detail: "目标 10 组合格叠片", deviceId: "SYSTEM", deviceName: "产线控制", handling: "操作员启动" },
        { id: "B-0146-2", timestamp: timestamp - 31000, kind: "info", title: "叠片 #10 合格", detail: "合格 10/10", deviceId: "ST-03", deviceName: "叠片热压台 · ST-03", handling: "质量判定通过" },
      ],
      downtimeReasons: ["目标达成 · 正常停机"],
      faultCount: 0,
      fault: null,
      recovery: { status: "not-triggered", attempts: 0, checks: [] },
      outcome: "success",
      stopReason: "十组合格叠片完成，设备正常停机",
      yieldRate: 100,
    };
    const runB = {
      ...baseRun,
      id: "B-0147",
      good: 10,
      waste: 1,
      cycles: 11,
      peakPower: 8.4,
      params: { pressure: 61, offset: 0.19, speed: 23 },
      lastParams: { pressure: 61, offset: 0.19, speed: 23 },
      events: [
        { id: "B-0147-1", timestamp: timestamp - 82000, kind: "danger", title: "缓存堵塞 · 堆料满载", detail: "8 / 8 槽 · 缓存安全占用 ≤ 7 槽", deviceId: "BF-03", deviceName: "进料缓存单元 · BF-03", handling: "等待人工复位" },
        { id: "B-0147-2", timestamp: timestamp - 78000, kind: "recovery", title: "复位完成", detail: "缓存已清空，8 秒验证启动", deviceId: "BF-03", deviceName: "进料缓存单元 · BF-03", handling: "人工复位" },
        { id: "B-0147-3", timestamp: timestamp - 70000, kind: "recovery", title: "恢复验证通过", detail: "8.0s · 故障Δ0 · 废品Δ0 · 缓存回落 · 5/5 设备同步", deviceId: "SYSTEM", deviceName: "产线控制", handling: "自动验证完成" },
      ],
      downtimeReasons: ["BF-03 缓存堵塞 · 堆料满载", "复位恢复验证", "目标达成 · 正常停机"],
      faultCount: 1,
      fault: { code: "E-BF03-F", deviceId: "BF-03", title: "缓存堵塞 · 堆料满载", value: "8 / 8 槽", threshold: "缓存安全占用 ≤ 7 槽" },
      recovery: { status: "passed", attempts: 1, checks: [], durationMs: 8000 },
      outcome: "success",
      stopReason: "目标达成 · 正常停机",
      yieldRate: 90.9,
    };
    app.archives.push(deepFreeze(runA), deepFreeze(runB));
    app.compareIds = ["B-0146", "B-0147"];
  }

  function initialize() {
    window.LaminaRenderer.init($("#machine-canvas"));
    bindEvents();
    seedComparisonBaseline();
    syncParameterInputs();
    newBatch("系统初始化");
    elements.clock.textContent = formatClock();
    window.setInterval(() => {
      elements.clock.textContent = formatClock();
      if (["running", "recovering"].includes(app.phase)) renderDevices();
    }, 1000);
    window.requestAnimationFrame(simulationFrame);
  }

  initialize();
})();
