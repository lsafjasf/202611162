(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, places = 1) => Number(value.toFixed(places));
  const nowStamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

  const SPECS = {
    "180": { id: "180", label: "180 ml", short: "细罐", diameter: 45, height: 92, target: 180 },
    "330": { id: "330", label: "330 ml", short: "标准", diameter: 54, height: 116, target: 330 },
    "500": { id: "500", label: "500 ml", short: "大罐", diameter: 63, height: 140, target: 500 },
  };
  const SPEC_ORDER = ["180", "330", "500"];

  const DEVICES = {
    pump: { id: "P-01", name: "供料泵" },
    filler: { id: "F-01", name: "灌装机" },
    buffer: { id: "B-00", name: "缓存罐" },
    capper: { id: "C-02", name: "压盖机" },
    conveyor: { id: "T-03", name: "输送机" },
    inspector: { id: "V-04", name: "视觉检测" },
  };
  const DEVICE_KEYS = Object.keys(DEVICES);

  const LIMITS = {
    levelMax: 98,
    levelMin: 88,
    pressureMin: 1.8,
    pressureMax: 3.7,
    speedMax: 36,
  };

  const WORLD = { width: 920, height: 500, beltY: 424, fillX: 306, capX: 548, inspectX: 704, exitX: 884 };
  const TARGET_CANS = 12;
  const CANS_PER_SPEC = 4;
  const MAX_REJECTS = 2;
  const RECOVERY_DURATION = 6;

  let batchSequence = 1;
  let snapshotSequence = 1;
  let alarmTimer = null;
  let scenarioTimer = null;
  let uiClockAccumulator = 0;
  let lastFrame = performance.now();

  const makeBatch = () => ({
    id: `BATCH-${String(batchSequence).padStart(3, "0")}`,
    wallStart: performance.now(),
    params: { ...state.params },
    plannedSpecs: [...SPEC_ORDER],
    spawned: 0,
    done: 0,
    good: 0,
    reject: 0,
    peakPower: 0,
    anomalies: [],
    recoveries: [],
    deviceEvents: [],
    outcomes: [],
    status: "ready",
    reason: "尚未启动",
    started: false,
    completedAt: null,
  });

  const initialState = {
    params: { speed: 26, level: 94, pressure: 2.7 },
    lineState: "idle",
    lineReason: "等待启动",
    currentSpec: "180",
    selectedSpec: "180",
    phaseIndex: 0,
    phaseDone: 0,
    cans: [],
    fillStation: null,
    capStation: null,
    rejectedCans: [],
    canSequence: 0,
    spawnAccumulator: 0,
    simTime: 0,
    cacheLevel: 0.8,
    cacheFlush: null,
    equipmentFault: null,
    faultInfo: null,
    recovery: null,
    lastRecovery: null,
    pausedFrom: null,
    speedMultiplier: 1,
    soundEnabled: true,
    archive: [],
    snapshots: [],
    selectedBatchIds: [],
    activeTab: "devices",
    summaryRecord: null,
    inventory: { caps: 1240, cans: 1680, syrup: 72.4 },
    devices: {},
    batch: null,
    lastPower: 0,
    lastBeat: 0,
  };

  const state = { ...initialState };

  function resetDeviceRuntime() {
    state.devices = {};
    for (const key of DEVICE_KEYS) {
      state.devices[key] = {
        running: false,
        faulted: false,
        startedAt: 0,
        stoppedAt: 0,
        segments: [],
      };
    }
  }

  state.batch = makeBatch();
  resetDeviceRuntime();

  function batchClock() {
    if (!state.batch) return 0;
    return Math.max(0, (performance.now() - state.batch.wallStart) / 1000);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const tenths = Math.floor((safe % 1) * 10);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
  }

  function pushToast(message, type = "info", duration = 3000) {
    const stack = $("toastStack");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i></i><p>${message}</p>`;
    stack.appendChild(toast);
    while (stack.children.length > 3) stack.firstElementChild.remove();
    window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(4px)";
      toast.style.transition = "180ms ease";
      window.setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function addAnomaly(entry) {
    const record = {
      id: `ALM-${Date.now()}-${state.batch.anomalies.length}`,
      time: batchClock(),
      at: nowStamp(),
      kind: entry.kind || "故障",
      device: entry.device || "SYS",
      message: entry.message || "",
      trigger: entry.trigger || "",
      handled: Boolean(entry.handled),
    };
    state.batch.anomalies.push(record);
    return record;
  }

  function setDeviceRunning(key, running, reason, mode = "normal") {
    const device = state.devices[key];
    if (!device) return;
    if (device.running === running) return;
    const time = batchClock();
    device.running = running;
    device.faulted = running ? false : mode === "fault";
    if (running) {
      device.startedAt = time;
      device.segments.push({ start: time, end: null, mode: "run" });
    } else {
      device.stoppedAt = time;
      const open = [...device.segments].reverse().find((segment) => segment.end === null);
      if (open) {
        open.end = time;
        open.mode = mode;
      }
    }
    const event = {
      time,
      deviceKey: key,
      device: `${DEVICES[key].id} ${DEVICES[key].name}`,
      action: running ? "启动" : "停止",
      reason,
      mode: running ? "start" : mode,
    };
    state.batch.deviceEvents.push(event);
    renderDevices();
  }

  function startProductionDevices(reason = "批次运行") {
    for (const key of ["pump", "filler", "capper", "conveyor", "inspector"]) {
      setDeviceRunning(key, true, reason);
    }
    setDeviceRunning("buffer", false, "缓存出口关闭");
  }

  function stopProductionDevices(reason, mode = "normal") {
    for (const key of ["pump", "filler", "capper", "conveyor", "inspector"]) {
      setDeviceRunning(key, false, reason, mode);
    }
  }

  function closeAllDeviceSegments() {
    const time = batchClock();
    for (const key of DEVICE_KEYS) {
      const device = state.devices[key];
      if (device.running) setDeviceRunning(key, false, "批次结束");
      for (const segment of device.segments) {
        if (segment.end === null) segment.end = time;
      }
    }
  }

  function calculatePower() {
    const p = state.params;
    const running = ["running", "recovering", "flushing"].includes(state.lineState);
    const speedLoad = (p.speed / 40) * 0.72;
    const pressureLoad = (p.pressure / 4) * 0.38;
    const fillLoad = (p.level / 100) * 0.2;
    const lineLoad = running ? 0.42 : 0.08;
    const dynamicPulse = running ? Math.sin(state.simTime * 2.4) * 0.035 : 0;
    return Math.max(0.04, 0.36 + speedLoad + pressureLoad + fillLoad + lineLoad + dynamicPulse);
  }

  function updatePower() {
    const power = calculatePower();
    state.lastPower = power;
    state.batch.peakPower = Math.max(state.batch.peakPower, power);
  }

  function safetyViolation() {
    const p = state.params;
    if (p.level >= LIMITS.levelMax) {
      return {
        kind: "limit",
        key: "filler",
        code: "E-FILL-98",
        title: "高液位溢流",
        device: "F-01 灌装机",
        value: `液位 ${p.level.toFixed(1)}% / 上限 98.0%`,
        description: "灌装液位超过罐口安全线，泡沫与浆料已溢流。灌装阀联锁关闭，请降低液位后恢复。",
      };
    }
    if (p.level < LIMITS.levelMin) {
      return {
        kind: "limit",
        key: "filler",
        code: "E-FILL-LOW",
        title: "灌装量不足",
        device: "F-01 灌装机",
        value: `液位 ${p.level.toFixed(1)}% / 下限 88.0%`,
        description: "实际灌装量低于配方允许下限，继续运行将产生净含量不合格品。",
      };
    }
    if (p.pressure < LIMITS.pressureMin) {
      return {
        kind: "limit",
        key: "capper",
        code: "E-CAP-18",
        title: "封盖压力不足",
        device: "C-02 压盖机",
        value: `压力 ${p.pressure.toFixed(2)} bar / 下限 1.80 bar`,
        description: "压盖头未达到密封压力，卷封无法贴合罐口。在线测漏判定为漏气，设备已联锁停机。",
      };
    }
    if (p.pressure > LIMITS.pressureMax) {
      return {
        kind: "limit",
        key: "capper",
        code: "E-CAP-HIGH",
        title: "压盖压力过高",
        device: "C-02 压盖机",
        value: `压力 ${p.pressure.toFixed(2)} bar / 上限 3.70 bar`,
        description: "压盖压力超过卷封模具承载上限，存在罐盖变形与设备过载风险。",
      };
    }
    if (p.speed > LIMITS.speedMax) {
      return {
        kind: "limit",
        key: "conveyor",
        code: "E-BELT-36",
        title: "输送速度越限",
        device: "T-03 输送机",
        value: `供料速度 ${p.speed.toFixed(1)} 罐/分 / 上限 36.0`,
        description: "输送节拍超过灌装与压盖工位同步能力，罐体队列发生挤压。输送机已安全停止。",
      };
    }
    return null;
  }

  function triggerFault(info) {
    if (!info || ["fault", "finished"].includes(state.lineState)) return;
    const wasRecovering = state.lineState === "recovering";
    if (wasRecovering && state.recovery) state.recovery.failed = true;
    state.batch.peakPower = Math.max(state.batch.peakPower, calculatePower() + 0.68);
    state.faultInfo = {
      ...info,
      time: batchClock(),
      at: nowStamp(),
    };
    state.lineReason = `${info.device} · ${info.title}`;
    state.batch.status = "fault";
    state.lineState = "fault";
    stopProductionDevices(`${info.device} ${info.title}`, "fault");
    if (state.devices[info.key]) state.devices[info.key].faulted = true;
    const anomaly = addAnomaly({
      kind: info.kind === "limit" ? "参数越限" : "设备故障",
      device: info.device,
      message: info.title,
      trigger: info.value,
    });
    state.faultInfo.anomalyId = anomaly.id;
    state.alarmActive = true;
    startAlarm();
    renderAll();
  }

  function triggerEquipmentFault(type) {
    if (!["running", "recovering"].includes(state.lineState)) {
      pushToast("设备故障只能在产线运行时注入", "warn");
      return false;
    }
    const faults = {
      pump: {
        kind: "equipment",
        key: "pump",
        code: "E-PUMP-CURRENT",
        title: "供料泵轴承过载",
        device: "P-01 供料泵",
        value: "电机电流 8.9 A / 上限 7.5 A",
        description: "泵体轴承温升异常，变频器记录过流。供料阀与上游储罐已联锁隔离。",
      },
      cap: {
        kind: "equipment",
        key: "capper",
        code: "E-CAP-FEED",
        title: "压盖机供盖中断",
        device: "C-02 压盖机",
        value: "瓶盖供给 0 枚 / 最小 1 枚",
        description: "供盖轨道无料，压盖头空压。设备已联锁停机，中断罐将进入废品道。",
      },
      belt: {
        kind: "equipment",
        key: "conveyor",
        code: "E-BELT-JAM",
        title: "输送带卡料",
        device: "T-03 输送机",
        value: "线速度 0.00 m/s / 设定 0.42 m/s",
        description: "光电传感器检测到连续遮挡，驱动扭矩越过 108%。输送机已急停。",
      },
    };
    const info = faults[type];
    if (!info) return false;
    state.equipmentFault = info;
    triggerFault(info);
    pushToast(`${info.device} 故障已注入`, "error");
    return true;
  }

  function startAlarm() {
    stopAlarm();
    state.alarmActive = true;
    alarmTimer = window.setInterval(() => {
      if (!state.soundEnabled || !state.alarmActive) return;
      audio.alarmPulse();
    }, 420);
    if (state.soundEnabled) audio.alarmPulse();
  }

  function stopAlarm() {
    if (alarmTimer) window.clearInterval(alarmTimer);
    alarmTimer = null;
    state.alarmActive = false;
  }

  function discardInterruptedCans() {
    let discarded = 0;
    for (const stationKey of ["fillStation", "capStation"]) {
      const can = state[stationKey];
      if (!can) continue;
      const index = state.cans.indexOf(can);
      if (index >= 0) state.cans.splice(index, 1);
      state.rejectedCans.push({ ...can, x: 835, rejected: true, life: 0 });
      state[stationKey] = null;
      discarded += 1;
    }
    if (discarded > 0) {
      for (let i = 0; i < discarded; i += 1) {
        addAnomaly({
          kind: "故障清理",
          device: "V-04 视觉检测",
          message: "故障中断罐已转入废品道",
          trigger: "在线罐体状态不确定",
          handled: true,
        });
        recordCanResult(false, "故障中断 · 状态不确定", { fromFault: true, allowAfterFault: true });
      }
    }
  }

  function attemptRecovery() {
    if (state.lineState !== "fault" || !state.faultInfo) return;
    const violation = safetyViolation();
    const errorBox = $("recoverError");
    if (violation) {
      errorBox.hidden = false;
      errorBox.textContent = `参数仍越限：${violation.device} · ${violation.value}。请先调整至安全范围。`;
      addAnomaly({
        kind: "恢复受阻",
        device: violation.device,
        message: "恢复请求被安全联锁拒绝",
        trigger: violation.value,
        handled: false,
      });
      renderAnomalies();
      return;
    }

    const faultId = state.faultInfo.anomalyId;
    discardInterruptedCans();
    if (state.lineState === "finished") return;
    state.equipmentFault = null;
    state.faultInfo = null;
    state.lineState = "recovering";
    state.batch.status = "recovering";
    state.lineReason = "恢复观察窗口";
    stopAlarm();
    $("faultOverlay").hidden = true;
    $("recoverError").hidden = true;
    startProductionDevices("故障恢复 · 观察启动");
    state.recovery = {
      elapsed: 0,
      duration: RECOVERY_DURATION,
      startReject: state.batch.reject,
      startAnomalies: state.batch.anomalies.length,
      startDone: state.batch.done,
      faultAnomalyId: faultId,
      failed: false,
    };
    state.lastRecovery = null;
    renderAll();
    pushToast(`恢复观察开始：固定 ${RECOVERY_DURATION.toFixed(1)} 秒`, "warn");
  }

  function completeRecoveryIfReady() {
    if (!state.recovery || state.lineState !== "recovering") return;
    if (state.recovery.elapsed < state.recovery.duration) return;
    const newRejects = state.batch.reject - state.recovery.startReject;
    const newAnomalies = state.batch.anomalies.length - state.recovery.startAnomalies;
    const latentFault =
      Boolean(state.equipmentFault) ||
      Boolean(state.faultInfo) ||
      Boolean(state.alarmActive) ||
      state.lineState === "fault";
    const pass = !state.recovery.failed && newRejects === 0 && newAnomalies === 0 && !latentFault;
    const duration = state.recovery.duration;
    const result = {
      pass,
      duration,
      newRejects,
      newAnomalies,
      residualCount: latentFault ? 1 : 0,
      at: nowStamp(),
      time: batchClock(),
    };
    if (pass) {
      const target = state.batch.anomalies.find((item) => item.id === state.recovery.faultAnomalyId);
      if (target) target.handled = true;
      for (const item of state.batch.anomalies) {
        if (["设备故障", "参数越限"].includes(item.kind) && !item.handled) item.handled = true;
      }
    }
    const anomaly = addAnomaly({
      kind: pass ? "恢复验证" : "恢复失败",
      device: "SYS 联锁系统",
      message: pass ? `固定 ${duration.toFixed(1)}s 观察通过` : "恢复观察期间检测到残留",
      trigger: `废品 +${newRejects} / 异常 +${newAnomalies} / 残留 ${latentFault ? 1 : 0}`,
      handled: pass,
    });
    result.anomalyId = anomaly.id;
    state.batch.recoveries.push({ ...result });
    state.lastRecovery = { ...result };
    state.recovery = null;
    state.lineState = "running";
    state.batch.status = "running";
    state.lineReason = pass ? "恢复验证通过 · 继续生产" : "恢复观察失败";
    renderAll();
    pushToast(
      pass
        ? `恢复验证通过：${duration.toFixed(1)}s 内 0 废品、0 残留、0 错误累计`
        : `恢复验证失败：残留 ${latentFault ? 1 : 0} / 新异常 ${newAnomalies}`,
      pass ? "info" : "error",
      4200,
    );
    maybeBeginChangeover();
  }

  function maybeBeginChangeover() {
    if (state.lineState !== "running") return;
    if (state.batch.done >= TARGET_CANS) return;
    if (
      state.phaseIndex < SPEC_ORDER.length - 1 &&
      state.batch.done >= (state.phaseIndex + 1) * CANS_PER_SPEC
    ) {
      beginChangeover();
    }
  }

  function startLine() {
    if (state.lineState === "finished" || state.lineState === "idle") {
      if (state.lineState === "finished") createNewBatch(false);
      if (!state.batch.started) {
        state.batch.wallStart = performance.now();
        state.batch.started = true;
        state.batch.params = { ...state.params };
      }
      state.batch.status = "running";
      state.batch.reason = "生产运行中";
      state.lineState = "running";
      state.lineReason = "产线运行 · 参数闭环";
      startProductionDevices("操作员启动");
      state.spawnAccumulator = Math.max(0, 60 / state.params.speed - 0.42);
      updatePower();
      renderAll();
      audio.ensure();
      const violation = safetyViolation();
      if (violation) triggerFault(violation);
      else pushToast("产线启动，开始连续灌装", "info");
      return;
    }
    if (state.lineState === "paused") {
      resumeLine();
      return;
    }
    if (state.lineState === "changeover") {
      pushToast("请先选择下一规格并清空缓存", "warn");
      return;
    }
    if (state.lineState === "fault") {
      pushToast("请先排除故障并完成恢复观察", "error");
      return;
    }
    if (state.lineState === "flushing") {
      pushToast("缓存排空进行中", "warn");
      return;
    }
    if (state.lineState === "recovering") {
      pushToast("恢复观察窗口进行中", "warn");
    }
  }

  function pauseLine() {
    if (!["running", "recovering"].includes(state.lineState)) return;
    state.pausedFrom = state.lineState;
    state.lineState = "paused";
    state.batch.status = "paused";
    state.lineReason = "操作员暂停 · 安全检查";
    stopProductionDevices("暂停检查", "pause");
    $("inspectionOverlay").hidden = false;
    renderAll();
    audio.ensure();
    audio.pauseTone();
    pushToast("产线已暂停，全部关键设备停止并记录时刻", "warn");
  }

  function resumeLine() {
    if (state.lineState !== "paused") return;
    const nextState = state.pausedFrom === "recovering" ? "recovering" : "running";
    state.lineState = nextState;
    state.batch.status = nextState === "recovering" ? "recovering" : "running";
    state.lineReason = nextState === "recovering" ? "恢复观察继续" : "检查结束 · 恢复生产";
    state.pausedFrom = null;
    $("inspectionOverlay").hidden = true;
    startProductionDevices("检查结束 · 继续");
    renderAll();
    const violation = safetyViolation();
    if (violation) {
      triggerFault(violation);
    } else {
      pushToast("检查完成，产线恢复运行", "info");
    }
  }

  function beginChangeover() {
    if (state.phaseIndex >= SPEC_ORDER.length - 1) return;
    state.lineState = "changeover";
    state.batch.status = "changeover";
    state.lineReason = "规格切换 · 等待清空缓存";
    state.selectedSpec = null;
    state.cacheLevel = 1.05;
    stopProductionDevices("换规格暂停", "pause");
    const next = SPEC_ORDER[state.phaseIndex + 1];
    $("changeoverTitle").textContent = `下一规格 · ${SPECS[next].label}`;
    $("changeoverOverlay").hidden = false;
    renderAll();
    pushToast(`第 ${state.phaseIndex + 1} 规格完成。选择 ${SPECS[next].label} 并清空缓存`, "warn", 4200);
  }

  function clearCacheAndChange() {
    if (state.lineState !== "changeover") {
      pushToast("仅在规格切换时需要清空缓存", "warn");
      return;
    }
    const next = SPEC_ORDER[state.phaseIndex + 1];
    if (state.selectedSpec !== next) {
      pushToast(`请先选择目标规格 ${SPECS[next].label}`, "warn");
      return;
    }
    state.lineState = "flushing";
    state.batch.status = "flushing";
    state.lineReason = "缓存排空 · 防止混液";
    state.cacheFlush = { elapsed: 0, duration: 1.7, nextSpec: next };
    setDeviceRunning("buffer", true, "排空旧规格缓存");
    $("changeoverOverlay").hidden = true;
    renderAll();
    pushToast("缓存排空中：旧规格浆料正在退出管路", "warn");
  }

  function finishCacheFlush() {
    const flush = state.cacheFlush;
    if (!flush) return;
    const next = flush.nextSpec;
    state.cacheFlush = null;
    setDeviceRunning("buffer", false, "缓存排空完成");
    state.phaseIndex += 1;
    state.phaseDone = 0;
    state.currentSpec = next;
    state.selectedSpec = next;
    state.cacheLevel = 0.35;
    state.lineState = "running";
    state.batch.status = "running";
    state.lineReason = `已切换 ${SPECS[next].label} · 缓存洁净`;
    startProductionDevices(`换型完成 · ${SPECS[next].label}`);
    state.spawnAccumulator = Math.max(0, 60 / state.params.speed - 0.3);
    renderAll();
    audio.ensure();
    audio.changeoverTone();
    pushToast(`缓存已清空，开始 ${SPECS[next].label} 规格生产`, "info");
  }

  function determineCanQuality(can) {
    const levelJitter = ((can.id % 3) - 1) * 0.14;
    const pressureJitter = (can.id % 2 === 0 ? -1 : 1) * 0.018;
    const level = state.params.level + levelJitter;
    const pressure = state.params.pressure + pressureJitter;
    const speed = state.params.speed;
    const reasons = [];

    if (level < 88) reasons.push(`净含量不足 ${level.toFixed(1)}%`);
    else if (level < 90.5 && can.id % 2 === 0) reasons.push(`液位偏低 ${level.toFixed(1)}%`);
    else if (level > 96.8 && can.id % 3 === 0) reasons.push(`液位偏高 ${level.toFixed(1)}%`);

    if (pressure < 2.18) reasons.push(`封口漏气 ${pressure.toFixed(2)} bar`);
    else if (pressure < 2.35 && can.id % 2 === 0) reasons.push(`卷封压力临界 ${pressure.toFixed(2)} bar`);
    else if (pressure > 3.55 && can.id % 2 === 0) reasons.push(`罐盖变形 ${pressure.toFixed(2)} bar`);

    if (speed > 33 && pressure < 2.5 && can.id % 3 !== 0) {
      reasons.push(`高速压盖错位 ${speed.toFixed(1)} 罐/分`);
    }

    return {
      ok: reasons.length === 0,
      reasons,
      level,
      pressure,
    };
  }

  function recordCanResult(ok, reason, options = {}) {
    if (["finished", "idle"].includes(state.lineState)) return;
    state.batch.done += 1;
    state.phaseDone += 1;
    if (!options.allowAfterFault && state.lineState === "fault") {
      state.batch.done -= 1;
      state.phaseDone -= 1;
      return;
    }
    if (ok) {
      state.batch.good += 1;
    } else {
      state.batch.reject += 1;
      addAnomaly({
        kind: "废品",
        device: "V-04 视觉检测",
        message: options.fromFault ? "故障中断罐判定为废品" : reason,
        trigger: options.fromFault ? "联锁停机导致状态不确定" : reason,
        handled: false,
      });
    }
    state.batch.outcomes.push({ ok, reason, fromFault: Boolean(options.fromFault) });
    state.batch.reason = reason;
    if (state.batch.reject > MAX_REJECTS) {
      finalizeBatch("failed", `废品超限 · V-04 视觉检测 · ${reason}`);
      return;
    }
    if (state.batch.done >= TARGET_CANS) {
      const okBatch = state.batch.reject <= MAX_REJECTS;
      finalizeBatch(
        okBatch ? "success" : "failed",
        okBatch
          ? `12 罐完成 · 3 种规格 · 废品 ${state.batch.reject} 罐`
          : `废品超限 · ${state.batch.reject} 罐不合格`,
      );
      return;
    }
    if (!options.fromFault && state.lineState !== "fault") maybeBeginChangeover();
    renderAll();
  }

  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const key of Object.keys(value)) deepFreeze(value[key]);
    }
    return value;
  }

  function finalizeBatch(status, stopReason) {
    if (state.lineState === "finished") return;
    state.batch.peakPower = Math.max(state.batch.peakPower, calculatePower());
    state.batch.status = status;
    state.batch.reason = stopReason;
    state.lineReason = stopReason;
    stopProductionDevices(stopReason, status === "success" ? "normal" : "fault");
    closeAllDeviceSegments();
    stopAlarm();
    state.lineState = "finished";
    state.equipmentFault = null;
    state.faultInfo = null;
    state.recovery = null;
    $("recoveryBanner").hidden = true;

    const deviceSegments = {};
    for (const key of DEVICE_KEYS) {
      deviceSegments[key] = state.devices[key].segments.map((segment) => ({ ...segment }));
    }
    const record = deepFreeze({
      id: state.batch.id,
      status,
      good: state.batch.good,
      reject: state.batch.reject,
      done: state.batch.done,
      peakPower: round(state.batch.peakPower, 2),
      stopReason,
      params: { ...state.batch.params },
      specs: [...state.batch.plannedSpecs],
      anomalies: state.batch.anomalies.map((item) => ({ ...item })),
      recoveries: state.batch.recoveries.map((item) => ({ ...item })),
      deviceEvents: state.batch.deviceEvents.map((item) => ({ ...item })),
      deviceSegments,
      duration: batchClock(),
      completedAt: nowStamp(),
      completedIso: new Date().toISOString(),
    });
    state.archive.unshift(record);
    const previous = state.archive[1];
    state.selectedBatchIds = previous ? [record.id, previous.id] : [record.id];
    state.summaryRecord = record;
    renderAll();
    showSummary(record);
  }

  function showSummary(record) {
    const success = record.status === "success";
    const card = document.querySelector("#summaryOverlay .summary-card");
    card.classList.toggle("failed", !success);
    $("summaryDot").className = `blink-dot ${success ? "green" : "red"}`;
    $("summaryKicker").textContent = success ? "批次完成" : "批次终止";
    $("summaryTitle").textContent = success ? "批次合格 · 已归档" : "批次失败 · 已归档";
    $("summaryGood").textContent = record.good;
    $("summaryReject").textContent = record.reject;
    $("summaryPeak").textContent = record.peakPower.toFixed(2);
    const handlingCount = record.anomalies.filter((item) =>
      ["设备故障", "参数越限", "恢复验证", "恢复失败", "故障清理", "恢复受阻"].includes(item.kind),
    ).length;
    $("summaryAnomalies").textContent = handlingCount;
    $("summaryReason").textContent = record.stopReason;
    $("summaryOverlay").hidden = false;
  }

  function createNewBatch(showToast = true) {
    if (scenarioTimer) window.clearTimeout(scenarioTimer);
    scenarioTimer = null;
    stopAlarm();
    if (["running", "recovering", "paused", "changeover", "flushing"].includes(state.lineState)) {
      stopProductionDevices("重置当前批次", "pause");
    }
    batchSequence += 1;
    state.batch = makeBatch();
    resetDeviceRuntime();
    state.lineState = "idle";
    state.lineReason = "等待启动";
    state.currentSpec = "180";
    state.selectedSpec = "180";
    state.phaseIndex = 0;
    state.phaseDone = 0;
    state.cans = [];
    state.fillStation = null;
    state.capStation = null;
    state.rejectedCans = [];
    state.canSequence = 0;
    state.spawnAccumulator = 0;
    state.simTime = 0;
    state.cacheLevel = 0.8;
    state.cacheFlush = null;
    state.equipmentFault = null;
    state.faultInfo = null;
    state.recovery = null;
    state.lastRecovery = null;
    state.pausedFrom = null;
    state.summaryRecord = null;
    $("faultOverlay").hidden = true;
    $("changeoverOverlay").hidden = true;
    $("inspectionOverlay").hidden = true;
    $("summaryOverlay").hidden = true;
    $("recoveryBanner").hidden = true;
    $("recoverError").hidden = true;
    renderAll();
    if (showToast) pushToast(`已重置当前批次，新批次 ${state.batch.id}`, "info");
  }

  function spawnCan() {
    const spec = SPECS[state.currentSpec];
    state.canSequence += 1;
    state.batch.spawned += 1;
    state.cans.push({
      id: state.canSequence,
      spec: spec.id,
      width: spec.diameter,
      height: spec.height,
      x: 82,
      y: WORLD.beltY,
      state: "incoming",
      fill: 0,
      fillProgress: 0,
      capProgress: 0,
      inspectProgress: 0,
      capped: false,
      quality: null,
      wobble: Math.random() * Math.PI * 2,
      hue: 40 + (state.canSequence % 4) * 3,
    });
  }

  function updateCans(dt) {
    const fillDuration = 1.16 - clamp(state.params.speed * 0.011, 0.1, 0.38);
    const capDuration = 0.52;
    const targetFill = clamp(state.params.level / 100, 0.55, 1.08);
    const speedPx = 32 + state.params.speed * 1.28;

    if (state.fillStation) {
      const can = state.fillStation;
      can.fillProgress = clamp(can.fillProgress + dt / fillDuration, 0, 1);
      can.fill = targetFill * can.fillProgress;
      if (can.fillProgress >= 1) {
        can.fill = targetFill;
        can.state = "filled";
        state.fillStation = null;
      }
    }

    if (state.capStation) {
      const can = state.capStation;
      can.capProgress = clamp(can.capProgress + dt / capDuration, 0, 1);
      if (can.capProgress >= 1) {
        can.capped = true;
        can.quality = determineCanQuality(can);
        can.state = "capped";
        state.capStation = null;
      }
    }

    const moving = state.cans
      .filter((can) => !["filling", "capping", "inspecting"].includes(can.state))
      .sort((a, b) => b.x - a.x);

    for (const can of moving) {
      let maxX = WORLD.exitX + 40;
      for (const other of state.cans) {
        if (other === can || other.x <= can.x + 1) continue;
        maxX = Math.min(maxX, other.x - other.width / 2 - can.width / 2 - 13);
      }
      can.x = Math.min(can.x + speedPx * dt, maxX);
    }

    for (const can of state.cans) {
      if (
        can.state === "incoming" &&
        !state.fillStation &&
        can.x >= WORLD.fillX - 2 &&
        can.x < WORLD.capX
      ) {
        can.state = "filling";
        can.x = WORLD.fillX;
        can.fillProgress = 0;
        can.fill = 0;
        state.fillStation = can;
      }
      if (
        can.state === "filled" &&
        !state.capStation &&
        can.x >= WORLD.capX - 2 &&
        can.x < WORLD.inspectX
      ) {
        can.state = "capping";
        can.x = WORLD.capX;
        can.capProgress = 0;
        state.capStation = can;
      }
      if (can.state === "capped" && can.x >= WORLD.inspectX - 2 && can.x < WORLD.exitX) {
        can.state = "inspecting";
        can.x = WORLD.inspectX;
        can.inspectProgress = 0;
      }
      if (can.state === "inspecting") {
        can.inspectProgress += dt;
        if (can.inspectProgress >= 0.28) {
          can.state = "inspected";
        }
      }
    }

    const remaining = [];
    for (const can of state.cans) {
      if (can.x > WORLD.exitX && ["capped", "inspected"].includes(can.state)) {
        const ok = Boolean(can.quality && can.quality.ok);
        const reason = ok ? "灌装与卷封合格" : can.quality?.reasons.join(" / ") || "质量检测失败";
        recordCanResult(ok, reason);
      } else {
        remaining.push(can);
      }
    }
    state.cans = remaining;

    for (const rejected of state.rejectedCans) rejected.life += dt;
    state.rejectedCans = state.rejectedCans.filter((can) => can.life < 1.8).slice(-4);
  }

  function updateSimulation(rawDt) {
    const dt = clamp(rawDt, 0, 0.12);
    if (state.lineState === "flushing" && state.cacheFlush) {
      state.simTime += dt;
      state.cacheFlush.elapsed += dt;
      const ratio = clamp(state.cacheFlush.elapsed / state.cacheFlush.duration, 0, 1);
      state.cacheLevel = 0.18 + (1.05 - 0.18) * (1 - ratio);
      if (ratio >= 1) finishCacheFlush();
      return;
    }

    if (!["running", "recovering"].includes(state.lineState)) return;
    state.simTime += dt;
    updatePower();

    const violation = safetyViolation();
    if (violation) {
      triggerFault(violation);
      return;
    }

    if (state.lineState === "recovering" && state.recovery) {
      state.recovery.elapsed = Math.min(state.recovery.duration, state.recovery.elapsed + dt);
    }

    const interval = 60 / state.params.speed;
    state.spawnAccumulator += dt;
    const phaseCap = Math.min(TARGET_CANS, (state.phaseIndex + 1) * CANS_PER_SPEC);
    if (state.spawnAccumulator >= interval && state.batch.spawned < phaseCap) {
      state.spawnAccumulator -= interval;
      spawnCan();
    }

    updateCans(dt);
    if (state.lineState === "recovering") completeRecoveryIfReady();

    if (state.soundEnabled && batchClock() - state.lastBeat > 0.54) {
      state.lastBeat = batchClock();
      audio.mechanicalBeat(round(state.lastPower, 2));
    }
  }

  const STATE_LABELS = {
    idle: "待机",
    running: "运行",
    paused: "检查暂停",
    changeover: "换型暂停",
    flushing: "缓存排空",
    recovering: "恢复观察",
    fault: "故障停机",
    finished: "批次结束",
  };

  function renderControls() {
    const controls = [
      ["feedSpeed", "feedSpeedValue", state.params.speed, 12, 40, 1],
      ["fillLevel", "fillLevelValue", state.params.level, 80, 102, 1],
      ["capPressure", "capPressureValue", state.params.pressure, 1, 4, 2],
    ];
    for (const [inputId, outputId, value, min, max, places] of controls) {
      const input = $(inputId);
      const percent = ((value - min) / (max - min)) * 100;
      input.value = value;
      input.style.setProperty("--fill", `${percent}%`);
      $(outputId).innerHTML = `${Number(value).toFixed(places)} <em>${inputId === "capPressure" ? "bar" : inputId === "fillLevel" ? "%" : "罐/分"}</em>`;
    }
    $("feedSpeed").classList.toggle("danger", state.params.speed > LIMITS.speedMax);
    $("fillLevel").classList.toggle("danger", state.params.level >= LIMITS.levelMax);
    $("capPressure").classList.toggle(
      "danger",
      state.params.pressure < LIMITS.pressureMin || state.params.pressure > LIMITS.pressureMax,
    );

    const nextSpec = SPEC_ORDER[state.phaseIndex + 1] || null;
    for (const button of document.querySelectorAll(".spec-card")) {
      const spec = button.dataset.spec;
      const activeSpec = state.selectedSpec || state.currentSpec;
      button.classList.toggle("active", spec === activeSpec);
      let disabled = true;
      if (state.lineState === "idle") disabled = spec !== "180";
      if (state.lineState === "changeover") disabled = spec !== nextSpec;
      button.disabled = disabled;
      if (state.lineState === "changeover" && spec === nextSpec) {
        button.title = "点击选择该规格，然后清空缓存";
      } else if (state.lineState === "idle" && spec === "180") {
        button.title = "本批次从 180 ml 开始";
      } else {
        button.title = "运行中不可切换规格";
      }
    }
    if (state.lineState === "changeover") {
      $("recipeHint").textContent = `待换型 ${SPECS[nextSpec].label}`;
    } else {
      $("recipeHint").textContent = `当前 ${SPECS[state.currentSpec].label}`;
    }

    const canFlush = state.lineState === "changeover";
    $("flushBtn").disabled = !canFlush;
    $("flushHint").textContent = canFlush
      ? `换型至 ${SPECS[nextSpec].label} 前必须执行`
      : "切换规格时必需";
    if (nextSpec) {
      const nextSelected = state.selectedSpec === nextSpec;
      $("changeoverFlushBtn").disabled = !nextSelected;
      $("changeoverFlushBtn").textContent = nextSelected
        ? "清空缓存并换型"
        : `请先选择 ${SPECS[nextSpec].label}`;
    }

    const pauseMode = ["running", "recovering"].includes(state.lineState);
    const startBtn = $("startPauseBtn");
    const label = startBtn.querySelector("span");
    if (state.lineState === "paused") {
      label.textContent = "继续生产";
      startBtn.disabled = false;
    } else if (pauseMode) {
      label.textContent = "暂停检查";
      startBtn.disabled = false;
    } else if (state.lineState === "fault") {
      label.textContent = "等待故障恢复";
      startBtn.disabled = true;
    } else if (state.lineState === "changeover") {
      label.textContent = "等待换型";
      startBtn.disabled = true;
    } else if (state.lineState === "flushing") {
      label.textContent = "缓存排空中";
      startBtn.disabled = true;
    } else if (state.lineState === "finished") {
      label.textContent = "开始新批次";
      startBtn.disabled = false;
    } else {
      label.textContent = "启动产线";
      startBtn.disabled = false;
    }
    for (const button of document.querySelectorAll(".fault-button")) {
      button.disabled = !pauseMode;
    }
    $("snapshotBtn").disabled = false;
    $("snapshotCount").textContent = state.snapshots.length;
    $("snapshotTabCount").textContent = state.snapshots.length;
  }

  function renderStatus() {
    const pill = $("linePill");
    const cleanState = state.lineState;
    pill.className = "live-pill";
    if (["running", "recovering", "flushing"].includes(cleanState)) pill.classList.add("running");
    if (cleanState === "fault") pill.classList.add("fault");
    pill.querySelector("span").textContent = STATE_LABELS[cleanState] || "待机";

    const batchLive = $("batchLive");
    batchLive.className = "batch-live";
    if (["running", "recovering", "flushing"].includes(cleanState)) batchLive.classList.add("running");
    if (cleanState === "fault") batchLive.classList.add("fault");
    const liveLabels = {
      idle: "IDLE",
      running: "LIVE",
      paused: "HOLD",
      changeover: "SETUP",
      flushing: "FLUSH",
      recovering: "RECOVERY",
      fault: "FAULT",
      finished: "SEALED",
    };
    batchLive.textContent = liveLabels[cleanState] || "IDLE";

    const canvasStatus = $("canvasStatus");
    canvasStatus.className = "canvas-status";
    if (["running", "flushing"].includes(cleanState)) canvasStatus.classList.add("running");
    if (cleanState === "recovering") canvasStatus.classList.add("recovering");
    if (cleanState === "fault") canvasStatus.classList.add("fault");
    $("canvasStatusText").textContent = state.lineReason;

    $("inspectionOverlay").hidden = cleanState !== "paused";
    $("changeoverOverlay").hidden = cleanState !== "changeover";
    if (cleanState === "fault" && state.faultInfo) {
      $("faultOverlay").hidden = false;
      $("faultTitle").textContent = state.faultInfo.title;
      $("faultDevice").textContent = state.faultInfo.device;
      $("faultValue").textContent = state.faultInfo.value;
      $("faultDescription").textContent = state.faultInfo.description;
      $("recoverBtn").textContent =
        state.faultInfo.kind === "equipment" ? "模拟修复并观察" : "调整参数并观察";
    }

    const banner = $("recoveryBanner");
    if (cleanState === "recovering" && state.recovery) {
      banner.hidden = false;
      const remaining = Math.max(0, state.recovery.duration - state.recovery.elapsed);
      $("recoveryCountdown").textContent = `${remaining.toFixed(1)}s`;
      $("recoveryText").textContent =
        `固定 ${state.recovery.duration.toFixed(1)} 秒 · 监控废品、异常与联锁残留`;
    } else {
      banner.hidden = true;
    }
  }

  function renderBatch() {
    $("headerBatchId").textContent = state.batch.id;
    $("doneCount").textContent = state.batch.done;
    $("goodCount").textContent = state.batch.good;
    $("rejectCount").textContent = state.batch.reject;
    $("peakPower").textContent = state.batch.peakPower.toFixed(2);
    $("progressCount").textContent = state.batch.done;
    $("progressRing").style.setProperty("--progress", `${(state.batch.done / TARGET_CANS) * 360}deg`);
    $("qualityMargin").textContent = `${Math.max(0, MAX_REJECTS - state.batch.reject)} 罐`;
    $("qualityMargin").style.color = state.batch.reject >= MAX_REJECTS ? "var(--red)" : "var(--mint)";

    const slots = $("qualitySlots").children;
    for (let index = 0; index < slots.length; index += 1) {
      const outcome = state.batch.outcomes[index];
      slots[index].className = outcome ? (outcome.ok ? "good" : "bad") : "";
      if (!outcome && state.lineState !== "idle" && state.batch.done === index) {
        slots[index].className = "current";
      }
    }

    const currentSpec = SPECS[state.currentSpec];
    if (state.lineState === "finished") {
      $("batchPhaseLabel").textContent = state.summaryRecord?.status === "success" ? "批次合格" : "批次终止";
      $("batchPhaseSub").textContent = state.summaryRecord?.stopReason || "已归档";
    } else if (state.lineState === "fault") {
      $("batchPhaseLabel").textContent = "故障联锁停机";
      $("batchPhaseSub").textContent = state.faultInfo?.device || "等待恢复";
    } else if (state.lineState === "changeover") {
      $("batchPhaseLabel").textContent = "换型待清缓存";
      $("batchPhaseSub").textContent = `即将切换 ${SPECS[SPEC_ORDER[state.phaseIndex + 1]].label}`;
    } else if (state.lineState === "flushing") {
      $("batchPhaseLabel").textContent = "缓存排空中";
      $("batchPhaseSub").textContent = `目标 ${SPECS[state.cacheFlush?.nextSpec || state.currentSpec].label}`;
    } else {
      $("batchPhaseLabel").textContent = `${currentSpec.label} · 第 ${Math.min(4, state.phaseDone + 1)} 罐`;
      const next = SPEC_ORDER[state.phaseIndex + 1];
      if (state.phaseIndex < SPEC_ORDER.length - 1) {
        $("batchPhaseSub").textContent = `${CANS_PER_SPEC - state.phaseDone} 罐后切换至 ${SPECS[next].label}`;
      } else {
        $("batchPhaseSub").textContent = `最后阶段 · 目标 ${TARGET_CANS} 罐`;
      }
    }

    $("currentReason").textContent = state.lineReason;
    $("livePower").textContent = `${state.lastPower.toFixed(2)} kW`;
    $("liveRate").textContent =
      `${["running", "recovering"].includes(state.lineState) ? state.params.speed.toFixed(1) : "0.0"} cpm`;
    const shownLevel = state.fillStation ? state.params.level : state.params.level;
    $("actualLevel").textContent = `${shownLevel.toFixed(1)}%`;
    $("actualPressure").textContent = `${state.params.pressure.toFixed(2)} bar`;
    $("cacheLevel").textContent = `${state.cacheLevel.toFixed(2)} L`;
    $("levelBar").style.width = `${clamp(shownLevel / 102, 0, 1) * 100}%`;
    $("pressureBar").style.width = `${clamp(state.params.pressure / 4, 0, 1) * 100}%`;
    $("cacheBar").style.width = `${clamp(state.cacheLevel / 1.1, 0, 1) * 100}%`;
  }

  function renderPhases() {
    const phases = document.querySelectorAll(".phase");
    for (const phase of phases) {
      const index = Number(phase.dataset.phase);
      phase.classList.toggle("active", index === state.phaseIndex);
      phase.classList.toggle("done", index < state.phaseIndex || state.lineState === "finished");
    }
  }

  function renderDevices() {
    const health = $("deviceHealth");
    health.innerHTML = DEVICE_KEYS.map((key) => {
      const device = state.devices[key];
      const info = DEVICES[key];
      const status = device.faulted ? "FAULT" : device.running ? "RUN" : "STOP";
      return `<div class="health-chip ${device.running ? "on" : ""} ${device.faulted ? "fault" : ""}" data-device="${key}">
        <i></i><span>${info.id} ${info.name}</span><b>${status}</b>
      </div>`;
    }).join("");

    const range = Math.max(24, batchClock());
    const timeline = $("deviceTimeline");
    timeline.innerHTML = DEVICE_KEYS.map((key) => {
      const info = DEVICES[key];
      const device = state.devices[key];
      const segments = device.segments.map((segment) => {
        const start = clamp(segment.start / range, 0, 1) * 100;
        const end = clamp((segment.end ?? batchClock()) / range, 0, 1) * 100;
        const width = Math.max(0.6, end - start);
        const modeClass = segment.mode === "fault" ? "fault" : segment.mode === "pause" ? "paused" : "";
        return `<i class="timeline-segment ${modeClass}" style="left:${start}%;width:${width}%"></i>`;
      }).join("");
      return `<div class="timeline-row">
        <div class="timeline-name ${device.running ? "" : "off"} ${device.faulted ? "fault" : ""}">
          <i></i>${info.id} ${info.name}
        </div>
        <div class="timeline-track">${segments}</div>
      </div>`;
    }).join("");

    const events = [...state.batch.deviceEvents].reverse().slice(0, 20);
    $("deviceEventCount").textContent = state.batch.deviceEvents.length;
    $("eventLog").innerHTML = events.length
      ? events.map((event) => {
          const badgeClass = event.action === "启动" ? "" : event.mode === "fault" ? "fault" : "stop";
          return `<div class="event-row">
            <time>${formatTime(event.time)}</time>
            <span>${event.device} · ${event.reason}</span>
            <b class="${badgeClass}">${event.action}</b>
          </div>`;
        }).join("")
      : `<div class="empty-state"><span>◷</span><p>启动产线后记录设备启停<small>每台设备单独计时</small></p></div>`;
  }

  function renderAnomalies() {
    const list = $("anomalyList");
    $("anomalyCount").textContent = state.batch.anomalies.length;
    if (!state.batch.anomalies.length) {
      list.innerHTML = `<div class="empty-state"><span>◎</span><p>暂无异常<br><small>故障注入与参数越限会记录在此</small></p></div>`;
      return;
    }
    list.innerHTML = [...state.batch.anomalies]
      .reverse()
      .slice(0, 12)
      .map(
        (item) => `<div class="anomaly-item ${item.handled ? "handled" : ""}">
          <span>${item.kind}</span>
          <p>${item.message}<small>${item.device} · ${item.trigger}</small></p>
          <em>${formatTime(item.time)}</em>
        </div>`,
      )
      .join("");
  }

  function renderRecoveryRecord() {
    const box = $("recoveryRecord");
    const icon = box.querySelector(".recovery-icon");
    const title = box.querySelector("strong");
    const detail = box.querySelector("p");
    const small = box.querySelector("small");
    box.classList.remove("pass", "fail");
    if (state.recovery) {
      const remaining = Math.max(0, state.recovery.duration - state.recovery.elapsed);
      icon.textContent = "◌";
      small.textContent = "恢复验证";
      title.textContent = "固定窗口观察中";
      detail.textContent = `剩余 ${remaining.toFixed(1)}s · 新废品 ${state.batch.reject - state.recovery.startReject}`;
    } else if (state.lastRecovery) {
      box.classList.add(state.lastRecovery.pass ? "pass" : "fail");
      icon.textContent = state.lastRecovery.pass ? "✓" : "!";
      small.textContent = "恢复验证";
      title.textContent = state.lastRecovery.pass ? "通过 · 无状态残留" : "失败 · 存在残留";
      detail.textContent = `${state.lastRecovery.duration.toFixed(1)}s · 废品 +${state.lastRecovery.newRejects} · 异常 +${state.lastRecovery.newAnomalies} · 残留 ${state.lastRecovery.residualCount}`;
    } else {
      icon.textContent = "◇";
      small.textContent = "恢复验证";
      title.textContent = "尚未执行";
      detail.textContent = "故障恢复后将进行固定窗口检查";
    }
  }

  function auditItems(record) {
    return record.anomalies.filter((item) =>
      ["设备故障", "参数越限", "恢复验证", "恢复失败", "故障清理", "恢复受阻"].includes(item.kind),
    );
  }

  function renderArchive() {
    const archive = $("batchArchive");
    $("batchCount").textContent = state.archive.length;
    if (!state.archive.length) {
      archive.innerHTML = `<div class="empty-archive"><span>▤</span><p>尚无已完成批次<small>选择两个只读结果可并排比较</small></p></div>`;
    } else {
      archive.innerHTML = state.archive
        .map((record) => {
          const selected = state.selectedBatchIds.includes(record.id);
          const success = record.status === "success";
          return `<button class="batch-card ${selected ? "selected" : ""} ${success ? "" : "failed"}" type="button" data-batch="${record.id}">
            <header><strong>${record.id}</strong><span>${success ? "合格" : "失败"}</span></header>
            <div class="batch-mini-metrics">
              <span>良 <b>${record.good}</b></span>
              <span>废 <b>${record.reject}</b></span>
              <span>峰 <b>${record.peakPower.toFixed(2)} kW</b></span>
            </div>
            <div class="batch-reason" title="${record.stopReason}">${record.stopReason}</div>
            <span class="lock-mark">▣ 只读</span>
          </button>`;
        })
        .join("");
    }

    const compare = $("comparePanel");
    const selected = state.selectedBatchIds
      .map((id) => state.archive.find((record) => record.id === id))
      .filter(Boolean);
    if (selected.length < 2) {
      compare.innerHTML = `<div class="compare-empty"><span>⇄</span><p>选择两个已完成批次进行对比<small>结果归档后不可编辑</small></p></div>`;
      return;
    }
    const [a, b] = selected;
    const auditA = auditItems(a);
    const auditB = auditItems(b);
    const handledA = auditA.filter((item) => item.handled).length;
    const handledB = auditB.filter((item) => item.handled).length;
    const auditLine =
      auditA.find((item) => item.handled) ||
      auditB.find((item) => item.handled) ||
      auditA[0] ||
      auditB[0];
    compare.innerHTML = `<table class="compare-table">
      <thead><tr><th>对比项</th><th><b>${a.id}</b></th><th><b>${b.id}</b></th></tr></thead>
      <tbody>
        <tr><td>批次结果</td><td class="${a.status === "success" ? "good" : "bad"}">${a.status === "success" ? "合格" : "失败"}</td><td class="${b.status === "success" ? "good" : "bad"}">${b.status === "success" ? "合格" : "失败"}</td></tr>
        <tr><td>良品 / 废品</td><td>${a.good} / ${a.reject}</td><td>${b.good} / ${b.reject}</td></tr>
        <tr><td>峰值功耗</td><td>${a.peakPower.toFixed(2)} kW</td><td>${b.peakPower.toFixed(2)} kW</td></tr>
        <tr><td>供料 / 液位 / 压力</td><td>${a.params.speed.toFixed(1)} / ${a.params.level.toFixed(1)}% / ${a.params.pressure.toFixed(2)}</td><td>${b.params.speed.toFixed(1)} / ${b.params.level.toFixed(1)}% / ${b.params.pressure.toFixed(2)}</td></tr>
        <tr><td>异常处理</td><td class="${handledA ? "good" : ""}">${handledA} / ${auditA.length}</td><td class="${handledB ? "good" : ""}">${handledB} / ${auditB.length}</td></tr>
        <tr><td>停机原因</td><td class="reason" title="${a.stopReason}">${a.stopReason}</td><td class="reason" title="${b.stopReason}">${b.stopReason}</td></tr>
      </tbody>
    </table>
    <div class="compare-audit">异常处理记录：${
      auditLine
        ? `${auditLine.kind} · ${auditLine.device} · ${auditLine.handled ? "已处理" : "待处理"} · ${auditLine.trigger}`
        : "两批次均无设备故障或参数越限记录"
    }</div>`;
  }

  function renderSnapshots() {
    const list = $("snapshotList");
    $("snapshotCount").textContent = state.snapshots.length;
    $("snapshotTabCount").textContent = state.snapshots.length;
    if (!state.snapshots.length) {
      list.innerHTML = `<div class="empty-state horizontal"><span>▣</span><p>还没有设备快照<small>保存当前参数后可修改参数重跑</small></p></div>`;
      return;
    }
    list.innerHTML = state.snapshots
      .map(
        (snapshot) => `<div class="snapshot-card">
          <header><strong>${snapshot.id}</strong><small>${snapshot.at}</small></header>
          <div class="snapshot-params">
            ${SPECS[snapshot.spec].label} · ${snapshot.speed.toFixed(1)} 罐/分<br>
            液位 ${snapshot.level.toFixed(1)}% · 压力 ${snapshot.pressure.toFixed(2)} bar
          </div>
          <div class="snapshot-actions">
            <button type="button" data-snapshot-action="load" data-snapshot="${snapshot.id}">载入参数</button>
            <button type="button" data-snapshot-action="rerun" data-snapshot="${snapshot.id}">重跑</button>
            <button type="button" data-snapshot-action="delete" data-snapshot="${snapshot.id}">删除</button>
          </div>
        </div>`,
      )
      .join("");
  }

  function renderAll() {
    renderControls();
    renderStatus();
    renderBatch();
    renderPhases();
    renderDevices();
    renderAnomalies();
    renderRecoveryRecord();
    renderArchive();
    renderSnapshots();
  }

  function renderLiveUI() {
    renderStatus();
    renderBatch();
    renderPhases();
    renderDevices();
    renderRecoveryRecord();
  }

  const canvas = $("lineCanvas");
  const ctx = canvas.getContext("2d");
  let canvasMetrics = { width: 0, height: 0, scale: 1, offsetX: 0, offsetY: 0 };

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const scale = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
    canvasMetrics = {
      width: rect.width,
      height: rect.height,
      scale,
      offsetX: (rect.width - WORLD.width * scale) / 2,
      offsetY: (rect.height - WORLD.height * scale) / 2,
      dpr,
    };
  }

  function rr(x, y, w, h, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
  }

  function drawTank() {
    const x = 32;
    const y = 142;
    const w = 168;
    const h = 206;
    const liquid = clamp(state.params.level / 108, 0.1, 0.95);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 26;
    rr(x, y, w, h, 22);
    const shell = ctx.createLinearGradient(x, y, x + w, y);
    shell.addColorStop(0, "#26322c");
    shell.addColorStop(0.4, "#435147");
    shell.addColorStop(0.7, "#27332d");
    shell.addColorStop(1, "#1a2420");
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.restore();

    ctx.save();
    rr(x + 7, y + 7, w - 14, h - 14, 17);
    ctx.clip();
    ctx.fillStyle = "rgba(6,12,10,.8)";
    ctx.fillRect(x, y, w, h);
    const liquidTop = y + 24 + (h - 44) * (1 - liquid);
    const juice = ctx.createLinearGradient(0, liquidTop, 0, y + h - 10);
    juice.addColorStop(0, "rgba(239,174,62,.92)");
    juice.addColorStop(0.55, "rgba(184,112,27,.92)");
    juice.addColorStop(1, "rgba(94,53,12,.96)");
    ctx.fillStyle = juice;
    ctx.fillRect(x + 8, liquidTop, w - 16, h - liquidTop);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, liquidTop, (w - 16) / 2, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(246,190,81,.32)";
    ctx.fill();
    for (let i = 0; i < 9; i += 1) {
      const bx = x + 24 + ((i * 47 + state.simTime * 11) % (w - 40));
      const by = liquidTop + 24 + ((i * 29 + state.simTime * 7) % Math.max(20, h - (liquidTop - y) - 28));
      ctx.beginPath();
      ctx.arc(bx, by, 1.3 + (i % 3) * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,220,135,.28)";
      ctx.fill();
    }
    const glass = ctx.createLinearGradient(x, 0, x + w, 0);
    glass.addColorStop(0, "rgba(255,255,255,.11)");
    glass.addColorStop(0.2, "rgba(255,255,255,.02)");
    glass.addColorStop(0.75, "rgba(255,255,255,.04)");
    glass.addColorStop(1, "rgba(255,255,255,.13)");
    ctx.fillStyle = glass;
    ctx.fillRect(x + 7, y + 7, w - 14, h - 14);
    ctx.restore();

    ctx.strokeStyle = "rgba(190,216,194,.23)";
    ctx.lineWidth = 1;
    rr(x, y, w, h, 22);
    ctx.stroke();
    ctx.fillStyle = "rgba(190,216,194,.08)";
    ctx.fillRect(x + 18, y + 30, 4, h - 60);

    ctx.save();
    ctx.font = "600 10px ui-monospace, 'Noto Sans SC', monospace";
    ctx.fillStyle = "#dce7dc";
    ctx.fillText("F-00  浆料罐", x + 16, y - 16);
    ctx.font = "8px ui-monospace, 'Noto Sans SC', monospace";
    ctx.fillStyle = "rgba(194,210,197,.55)";
    ctx.fillText("FEED RESERVOIR", x + 16, y - 5);
    ctx.textAlign = "right";
    ctx.fillStyle = "#d8ef99";
    ctx.fillText(`${state.params.level.toFixed(1)}%`, x + w - 16, y + 22);
    ctx.restore();

    ctx.strokeStyle = "rgba(160,186,166,.25)";
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(x + w, y + 64);
    ctx.lineTo(248, y + 64);
    ctx.lineTo(248, 298);
    ctx.stroke();
    ctx.strokeStyle = "rgba(8,15,12,.92)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(210,226,213,.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawStationFrame(x, color, label, sublabel) {
    ctx.save();
    ctx.strokeStyle = "rgba(160,186,166,.23)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x - 38, 95);
    ctx.lineTo(x - 38, 354);
    ctx.lineTo(x + 38, 354);
    ctx.lineTo(x + 38, 95);
    ctx.stroke();
    ctx.strokeStyle = "rgba(8,14,12,.9)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    rr(x - 42, 88, 84, 15, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = "600 7px ui-monospace, 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#d9e6dc";
    ctx.fillText(label, x, 137);
    ctx.font = "6px ui-monospace, 'Noto Sans SC', monospace";
    ctx.fillStyle = "rgba(194,210,197,.45)";
    ctx.fillText(sublabel, x, 147);
    ctx.restore();
  }

  function drawConveyor() {
    const y = WORLD.beltY;
    ctx.save();
    const beltGlow = ctx.createLinearGradient(0, y - 10, 0, y + 28);
    beltGlow.addColorStop(0, "rgba(95,125,101,.36)");
    beltGlow.addColorStop(0.45, "rgba(45,62,53,.9)");
    beltGlow.addColorStop(1, "rgba(17,26,22,.95)");
    rr(34, y - 8, 852, 26, 7);
    ctx.fillStyle = beltGlow;
    ctx.fill();
    ctx.strokeStyle = "rgba(174,199,178,.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const offset = ["running", "recovering", "flushing"].includes(state.lineState)
      ? (state.simTime * (24 + state.params.speed * 1.5)) % 34
      : 0;
    ctx.save();
    rr(38, y - 5, 844, 19, 4);
    ctx.clip();
    for (let x = 30 - offset; x < 900; x += 34) {
      ctx.fillStyle = "rgba(189,215,191,.055)";
      ctx.fillRect(x, y - 5, 4, 19);
    }
    ctx.restore();

    for (let x = 60; x < 880; x += 104) {
      ctx.beginPath();
      ctx.arc(x, y + 20, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#1b2822";
      ctx.fill();
      ctx.strokeStyle = "rgba(190,215,192,.16)";
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(174,199,178,.17)";
    ctx.lineWidth = 4;
    for (const x of [190, 420, 640]) {
      ctx.beginPath();
      ctx.moveTo(x, y + 20);
      ctx.lineTo(x - 5, 472);
      ctx.moveTo(x, y + 20);
      ctx.lineTo(x + 5, 472);
      ctx.stroke();
    }
    ctx.font = "600 7px ui-monospace, 'Noto Sans SC', monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(190,212,193,.36)";
    ctx.fillText("T-03  CONVEYOR / 0.42 m·s⁻¹", 46, y + 48);
    ctx.restore();
  }

  function drawCan(can) {
    const bottom = can.y;
    const top = bottom - can.height;
    const left = can.x - can.width / 2;
    const bodyHeight = can.height;
    const level = clamp(can.fill, 0, 1.08);
    const wobble = can.state === "filling" ? Math.sin(state.simTime * 25) * 0.45 : 0;
    const bad = can.quality && !can.quality.ok;

    ctx.save();
    ctx.translate(wobble, 0);
    ctx.beginPath();
    ctx.ellipse(can.x, bottom + 3, can.width * 0.56, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.fill();

    const shell = ctx.createLinearGradient(left, top, left + can.width, top);
    shell.addColorStop(0, bad ? "rgba(121,49,43,.92)" : "rgba(114,123,112,.92)");
    shell.addColorStop(0.14, bad ? "rgba(220,100,87,.95)" : "rgba(205,213,198,.96)");
    shell.addColorStop(0.4, bad ? "rgba(174,76,65,.96)" : "rgba(139,151,136,.96)");
    shell.addColorStop(0.7, bad ? "rgba(112,46,40,.96)" : "rgba(93,104,95,.96)");
    shell.addColorStop(1, bad ? "rgba(73,31,27,.96)" : "rgba(54,64,57,.96)");
    rr(left, top, can.width, bodyHeight, 7);
    ctx.fillStyle = shell;
    ctx.fill();

    ctx.save();
    rr(left + 4, top + 5, can.width - 8, bodyHeight - 10, 5);
    ctx.clip();
    if (level > 0) {
      const liquidTop = bottom - 7 - (bodyHeight - 14) * level;
      const liquid = ctx.createLinearGradient(0, liquidTop, 0, bottom - 5);
      liquid.addColorStop(0, `hsla(${can.hue + 4}, 82%, 61%, .93)`);
      liquid.addColorStop(1, `hsla(${can.hue - 8}, 72%, 37%, .96)`);
      ctx.fillStyle = liquid;
      ctx.fillRect(left + 4, liquidTop, can.width - 8, bottom - liquidTop);
      ctx.beginPath();
      ctx.ellipse(can.x, liquidTop, (can.width - 9) / 2, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${can.hue + 8}, 90%, 68%, .58)`;
      ctx.fill();
    }
    ctx.fillStyle = "rgba(244,249,241,.18)";
    ctx.fillRect(left + 8, top + 9, Math.max(2, can.width * 0.06), bodyHeight - 20);
    ctx.restore();

    ctx.beginPath();
    ctx.ellipse(can.x, top + 2, can.width / 2, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = bad ? "rgba(143,66,57,.95)" : "rgba(193,205,190,.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(238,245,237,.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (can.capped || (can.state === "capping" && can.capProgress > 0.7)) {
      ctx.beginPath();
      ctx.ellipse(can.x, top + 1, can.width / 2 + 1.5, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = bad ? "#d87362" : "#d4ae68";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,235,174,.55)";
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(can.x, top + 1, can.width / 2 - 5, 3, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(66,47,22,.48)";
      ctx.stroke();
    }

    if (can.width >= 45) {
      ctx.save();
      ctx.translate(can.x, top + bodyHeight * 0.54);
      ctx.rotate(-Math.PI / 2);
      ctx.font = "600 7px ui-monospace, 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(22,30,25,.62)";
      ctx.fillText(`${SPECS[can.spec].id} ML`, 0, 1.8);
      ctx.restore();
    }

    if (can.state === "inspecting") {
      ctx.strokeStyle = "rgba(111,184,233,.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      rr(left - 5, top - 6, can.width + 10, bodyHeight + 11, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (bad) {
      ctx.strokeStyle = "rgba(255,98,95,.75)";
      ctx.lineWidth = 1.2;
      rr(left - 3, top - 3, can.width + 6, bodyHeight + 6, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFillHead() {
    const active = state.fillStation;
    const canTop = active ? active.y - active.height : WORLD.beltY - 100;
    const nozzleEnd = clamp(canTop - 5, 276, 318);
    ctx.save();
    ctx.strokeStyle = "rgba(171,195,175,.23)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(WORLD.fillX, 92);
    ctx.lineTo(WORLD.fillX, 236);
    ctx.stroke();
    ctx.strokeStyle = "rgba(44,58,49,.95)";
    ctx.lineWidth = 6;
    ctx.stroke();

    const head = ctx.createLinearGradient(WORLD.fillX - 18, 0, WORLD.fillX + 18, 0);
    head.addColorStop(0, "#48594c");
    head.addColorStop(0.5, "#a7b3a2");
    head.addColorStop(1, "#39483d");
    rr(WORLD.fillX - 20, 224, 40, 34, 5);
    ctx.fillStyle = head;
    ctx.fill();
    ctx.strokeStyle = "rgba(214,230,216,.19)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(34,44,36,.9)";
    ctx.fillRect(WORLD.fillX - 8, 255, 16, 11);
    ctx.fillStyle = active ? "#c8f36a" : "rgba(200,243,106,.26)";
    ctx.beginPath();
    ctx.arc(WORLD.fillX, 236, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      ctx.shadowColor = "rgba(200,243,106,.65)";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "rgba(183,202,187,.4)";
    ctx.fillRect(WORLD.fillX - 2.5, 266, 5, nozzleEnd - 266);

    if (active) {
      const streamTop = nozzleEnd;
      const streamBottom = active.y - active.height + 6;
      const stream = ctx.createLinearGradient(0, streamTop, 0, streamBottom);
      stream.addColorStop(0, "rgba(247,201,87,.9)");
      stream.addColorStop(0.6, "rgba(230,155,44,.88)");
      stream.addColorStop(1, "rgba(187,106,25,.9)");
      ctx.strokeStyle = stream;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(WORLD.fillX, streamTop);
      for (let y = streamTop; y <= streamBottom; y += 6) {
        const wave = Math.sin((y + state.simTime * 180) * 0.16) * 1.4;
        ctx.lineTo(WORLD.fillX + wave, y);
      }
      ctx.stroke();
      for (let i = 0; i < 5; i += 1) {
        const dropY = streamTop + ((state.simTime * 92 + i * 19) % Math.max(8, streamBottom - streamTop));
        ctx.beginPath();
        ctx.arc(WORLD.fillX + Math.sin(dropY) * 1.4, dropY, 1.1 + (i % 2) * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(250,196,72,.84)";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(WORLD.fillX, active.y - active.height + 5, 5, 2.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(251,192,62,.55)";
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCapHead() {
    const active = state.capStation;
    const canTop = active ? active.y - active.height : WORLD.beltY - 110;
    const extension = active ? clamp(active.capProgress, 0, 1) * 36 : 0;
    const headBottom = clamp(232 + extension, 232, canTop - 8);
    ctx.save();
    ctx.strokeStyle = "rgba(176,196,180,.23)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(WORLD.capX, 92);
    ctx.lineTo(WORLD.capX, headBottom - 28);
    ctx.stroke();
    ctx.strokeStyle = "rgba(40,52,44,.96)";
    ctx.lineWidth = 5;
    ctx.stroke();

    const head = ctx.createLinearGradient(WORLD.capX - 23, 0, WORLD.capX + 23, 0);
    head.addColorStop(0, "#4c594c");
    head.addColorStop(0.42, "#c0c3ae");
    head.addColorStop(0.7, "#7f8879");
    head.addColorStop(1, "#39443a");
    rr(WORLD.capX - 26, headBottom - 30, 52, 30, 6);
    ctx.fillStyle = head;
    ctx.fill();
    ctx.strokeStyle = "rgba(226,232,213,.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(22,29,24,.92)";
    rr(WORLD.capX - 16, headBottom - 6, 32, 8, 3);
    ctx.fill();
    ctx.fillStyle = active ? "#f1b35b" : "rgba(241,179,91,.3)";
    ctx.fillRect(WORLD.capX - 10, headBottom - 33, 20, 2);
    if (active) {
      ctx.shadowColor = "rgba(241,179,91,.45)";
      ctx.shadowBlur = 10;
      ctx.fillRect(WORLD.capX - 10, headBottom - 33, 20, 2);
    }

    ctx.strokeStyle = "rgba(193,211,193,.24)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WORLD.capX - 16, 184);
    ctx.lineTo(WORLD.capX + 16, 184);
    ctx.stroke();
    ctx.fillStyle = "rgba(183,202,187,.56)";
    ctx.font = "7px ui-monospace, 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${state.params.pressure.toFixed(2)} bar`, WORLD.capX, 177);
    ctx.restore();
  }

  function drawInspector() {
    const active = state.cans.find((can) => can.state === "inspecting");
    ctx.save();
    ctx.strokeStyle = "rgba(111,184,233,.26)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(WORLD.inspectX - 30, 196);
    ctx.lineTo(WORLD.inspectX - 30, 382);
    ctx.lineTo(WORLD.inspectX + 30, 382);
    ctx.lineTo(WORLD.inspectX + 30, 196);
    ctx.stroke();
    rr(WORLD.inspectX - 22, 188, 44, 17, 3);
    ctx.fillStyle = "rgba(29,55,65,.8)";
    ctx.fill();
    ctx.fillStyle = active ? "#79ccf5" : "rgba(111,184,233,.35)";
    ctx.beginPath();
    ctx.arc(WORLD.inspectX, 196, 3, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      const scanY = active.y - active.height * 0.58;
      ctx.shadowColor = "rgba(111,184,233,.7)";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(111,184,233,.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(WORLD.inspectX - 26, scanY);
      ctx.lineTo(WORLD.inspectX + 26, scanY);
      ctx.stroke();
      ctx.fillStyle = "rgba(111,184,233,.11)";
      ctx.fillRect(WORLD.inspectX - 26, scanY - 20, 52, 40);
    }
    ctx.restore();
  }

  function drawRejectBin() {
    const x = 810;
    const y = 350;
    ctx.save();
    rr(x, y, 76, 66, 6);
    ctx.fillStyle = "rgba(36,31,26,.8)";
    ctx.fill();
    ctx.strokeStyle = "rgba(237,141,69,.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    rr(x + 3, y + 3, 70, 60, 4);
    ctx.clip();
    for (let i = -40; i < 100; i += 13) {
      ctx.strokeStyle = "rgba(237,141,69,.13)";
      ctx.beginPath();
      ctx.moveTo(x + i, y + 66);
      ctx.lineTo(x + i + 60, y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(237,141,69,.7)";
    ctx.font = "600 7px ui-monospace, 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("REJECT / 废品", x + 38, y + 31);
    ctx.font = "13px ui-monospace, 'Noto Sans SC', monospace";
    ctx.fillText(String(state.batch.reject), x + 38, y + 50);
    ctx.restore();

    for (const rejected of state.rejectedCans) {
      ctx.save();
      ctx.translate(rejected.x, WORLD.beltY - rejected.height / 2 - rejected.life * 34);
      ctx.rotate(rejected.life * 1.4);
      ctx.globalAlpha = clamp(1.8 - rejected.life, 0, 1);
      drawCan({ ...rejected, x: 0, y: rejected.height / 2, width: Math.min(rejected.width, 28), height: rejected.height * 0.48 });
      ctx.restore();
    }
  }

  function drawScene() {
    resizeCanvas();
    const { width, height, scale, offsetX, offsetY, dpr } = canvasMetrics;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#0a1310");
    bg.addColorStop(0.55, "#08110e");
    bg.addColorStop(1, "#060c0a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.save();
    rr(0, 0, WORLD.width, WORLD.height, 0);
    ctx.clip();

    const glow = ctx.createRadialGradient(430, 90, 10, 430, 90, 500);
    glow.addColorStop(0, "rgba(140,174,99,.085)");
    glow.addColorStop(1, "rgba(8,13,11,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.strokeStyle = "rgba(160,190,166,.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WORLD.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 390);
      ctx.stroke();
    }
    for (let y = 0; y <= 390; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(5,10,8,.45)";
    ctx.fillRect(0, 355, WORLD.width, 125);
    ctx.strokeStyle = "rgba(174,199,178,.055)";
    ctx.beginPath();
    ctx.moveTo(0, 386);
    ctx.lineTo(WORLD.width, 386);
    ctx.stroke();

    drawTank();
    drawStationFrame(WORLD.fillX, "rgba(200,243,106,.72)", "F-01  灌装", "FILL / 94% TARGET");
    drawStationFrame(WORLD.capX, "rgba(241,179,91,.72)", "C-02  压盖", "SEAL / PRESSURE");
    drawStationFrame(WORLD.inspectX, "rgba(111,184,233,.68)", "V-04  检测", "VISION / LEAK");
    drawConveyor();
    drawFillHead();
    drawCapHead();
    drawInspector();
    drawRejectBin();

    const orderedCans = [...state.cans].sort((a, b) => a.x - b.x);
    for (const can of orderedCans) drawCan(can);

    ctx.save();
    ctx.font = "6px ui-monospace, 'Noto Sans SC', monospace";
    ctx.fillStyle = "rgba(173,197,177,.27)";
    ctx.textAlign = "left";
    ctx.fillText("FLOW DIRECTION  →", 48, 390);
    ctx.textAlign = "right";
    ctx.fillText("CAN BODY FLOW / 12 CANS PER BATCH", WORLD.width - 38, 390);
    ctx.restore();

    if (state.lineState === "fault") {
      ctx.save();
      ctx.strokeStyle = `rgba(255,98,95,${0.35 + Math.sin(state.simTime * 9) * 0.15})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(4, 4, WORLD.width - 8, WORLD.height - 8);
      ctx.fillStyle = "rgba(120,20,18,.045)";
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.restore();
    }

    ctx.restore();
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.master = null;
    }

    ensure() {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return;
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = 0.16;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") this.context.resume();
    }

    tone(frequency, duration, type = "sine", volume = 0.1, delay = 0, endFrequency = null) {
      if (!this.context || !state.soundEnabled) return;
      const start = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    mechanicalBeat(power) {
      this.ensure();
      const level = clamp(power / 2.4, 0.04, 0.14);
      this.tone(92, 0.045, "sine", level, 0, 54);
      this.tone(1340 + (Math.round(power * 100) % 90), 0.018, "square", 0.027);
      this.tone(610, 0.025, "triangle", 0.018, 0.035);
    }

    pauseTone() {
      this.ensure();
      this.tone(420, 0.1, "triangle", 0.06);
      this.tone(260, 0.15, "sine", 0.05, 0.1);
    }

    changeoverTone() {
      this.ensure();
      this.tone(520, 0.08, "sine", 0.055);
      this.tone(720, 0.11, "sine", 0.05, 0.11);
    }

    alarmPulse() {
      this.ensure();
      this.tone(740, 0.17, "sawtooth", 0.07, 0, 700);
      this.tone(480, 0.2, "square", 0.045, 0.19, 430);
    }
  }

  const audio = new AudioEngine();

  function setParams(params) {
    state.params = {
      speed: params.speed ?? state.params.speed,
      level: params.level ?? state.params.level,
      pressure: params.pressure ?? state.params.pressure,
    };
    updatePower();
    renderControls();
    renderBatch();
  }

  function saveSnapshot() {
    const snapshot = {
      id: `SNAP-${String(snapshotSequence).padStart(3, "0")}`,
      at: nowStamp(),
      spec: state.currentSpec,
      speed: state.params.speed,
      level: state.params.level,
      pressure: state.params.pressure,
      phaseIndex: state.phaseIndex,
      deviceState: Object.fromEntries(
        DEVICE_KEYS.map((key) => [key, state.devices[key].running ? "run" : "stop"]),
      ),
      createdAt: new Date().toISOString(),
    };
    snapshotSequence += 1;
    state.snapshots.unshift(snapshot);
    renderAll();
    pushToast(`设备状态已保存为 ${snapshot.id}`, "info");
  }

  function loadSnapshot(id, autoStart = false) {
    const snapshot = state.snapshots.find((item) => item.id === id);
    if (!snapshot) return;
    if (["running", "recovering", "paused", "changeover", "flushing", "fault"].includes(state.lineState)) {
      pushToast("请先重置当前批次，再载入快照", "warn");
      return;
    }
    if (state.lineState === "finished") createNewBatch(false);
    setParams({ speed: snapshot.speed, level: snapshot.level, pressure: snapshot.pressure });
    state.currentSpec = "180";
    state.selectedSpec = "180";
    state.phaseIndex = 0;
    state.phaseDone = 0;
    renderAll();
    pushToast(`已载入 ${snapshot.id}，可从 180 ml 重新生产`, "info");
    if (autoStart) startLine();
  }

  function switchTab(name) {
    state.activeTab = name;
    for (const tab of document.querySelectorAll(".console-tab")) {
      tab.classList.toggle("active", tab.dataset.tab === name);
    }
    for (const panel of document.querySelectorAll(".console-page")) {
      panel.classList.toggle("active", panel.dataset.panel === name);
    }
    const notes = {
      devices: ["启停时刻按批次时钟记录，精度 0.1 s", "devices"],
      batches: ["已完成批次不可编辑，选择两项可并排比较", "batches"],
      snapshots: ["快照保存参数与设备状态，可载入或重跑", "snapshots"],
    };
    const [text, className] = notes[name] || notes.devices;
    $("consoleNote").innerHTML = `<span class="pulse-dot ${className === "batches" ? "blue" : ""}"></span> ${text}`;
  }

  function selectBatch(id) {
    const index = state.selectedBatchIds.indexOf(id);
    if (index >= 0) {
      state.selectedBatchIds.splice(index, 1);
    } else {
      state.selectedBatchIds.push(id);
      if (state.selectedBatchIds.length > 2) state.selectedBatchIds.shift();
    }
    renderArchive();
  }

  function resetToSafeParams() {
    setParams({ speed: 26, level: 94, pressure: 2.7 });
  }

  function runScenario(type) {
    createNewBatch(false);
    resetToSafeParams();
    switchTab("devices");
    if (type === "normal") {
      startLine();
      pushToast("正常生产剧本：安全参数，完整生产 12 罐", "info");
      return;
    }
    if (type === "fault") {
      startLine();
      pushToast("设备故障剧本：1.6 秒后注入 C-02 供盖中断", "warn");
      scenarioTimer = window.setTimeout(() => {
        if (["running", "recovering"].includes(state.lineState)) triggerEquipmentFault("cap");
      }, 1600);
      return;
    }
    if (type === "limit") {
      setParams({ speed: 26, level: 100.5, pressure: 2.7 });
      startLine();
      pushToast("参数越限剧本：液位 100.5% 触发溢流联锁", "warn");
    }
  }

  function setupEvents() {
    $("feedSpeed").addEventListener("input", (event) => {
      setParams({ speed: Number(event.target.value) });
      if (["running", "recovering"].includes(state.lineState)) {
        const violation = safetyViolation();
        if (violation) triggerFault(violation);
      }
    });
    $("fillLevel").addEventListener("input", (event) => {
      setParams({ level: Number(event.target.value) });
      if (["running", "recovering"].includes(state.lineState)) {
        const violation = safetyViolation();
        if (violation) triggerFault(violation);
      }
    });
    $("capPressure").addEventListener("input", (event) => {
      setParams({ pressure: Number(event.target.value) });
      if (["running", "recovering"].includes(state.lineState)) {
        const violation = safetyViolation();
        if (violation) triggerFault(violation);
      }
    });

    $("startPauseBtn").addEventListener("click", () => {
      audio.ensure();
      if (["running", "recovering"].includes(state.lineState)) pauseLine();
      else startLine();
    });
    $("resetBtn").addEventListener("click", () => createNewBatch(true));
    $("faultResetBtn").addEventListener("click", () => {
      $("faultOverlay").hidden = true;
      createNewBatch(true);
    });
    $("flushBtn").addEventListener("click", clearCacheAndChange);
    $("changeoverFlushBtn").addEventListener("click", clearCacheAndChange);
    $("resumeInspectionBtn").addEventListener("click", resumeLine);
    $("recoverBtn").addEventListener("click", attemptRecovery);
    $("snapshotBtn").addEventListener("click", saveSnapshot);

    for (const button of document.querySelectorAll(".spec-card")) {
      button.addEventListener("click", () => {
        const next = SPEC_ORDER[state.phaseIndex + 1];
        if (state.lineState !== "changeover" || button.dataset.spec !== next) return;
        state.selectedSpec = button.dataset.spec;
        renderControls();
        audio.ensure();
        audio.changeoverTone();
      });
    }
    for (const button of document.querySelectorAll(".fault-button")) {
      button.addEventListener("click", () => triggerEquipmentFault(button.dataset.fault));
    }
    for (const button of document.querySelectorAll(".scenario-button")) {
      button.addEventListener("click", () => runScenario(button.dataset.scenario));
    }
    for (const tab of document.querySelectorAll(".console-tab")) {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    }

    $("deviceHealth").addEventListener("click", () => switchTab("devices"));
    $("batchArchive").addEventListener("click", (event) => {
      const card = event.target.closest("[data-batch]");
      if (card) selectBatch(card.dataset.batch);
    });
    $("snapshotList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-snapshot-action]");
      if (!button) return;
      const id = button.dataset.snapshot;
      if (button.dataset.snapshotAction === "load") loadSnapshot(id, false);
      if (button.dataset.snapshotAction === "rerun") loadSnapshot(id, true);
      if (button.dataset.snapshotAction === "delete") {
        state.snapshots = state.snapshots.filter((item) => item.id !== id);
        renderAll();
        pushToast(`${id} 已删除`, "info");
      }
    });

    $("summaryCompareBtn").addEventListener("click", () => {
      $("summaryOverlay").hidden = true;
      switchTab("batches");
    });
    $("summaryNewBtn").addEventListener("click", () => {
      $("summaryOverlay").hidden = true;
      createNewBatch(false);
      pushToast("新批次已就绪", "info");
    });
    $("speedToggle").addEventListener("click", () => {
      const next = state.speedMultiplier === 1 ? 2 : state.speedMultiplier === 2 ? 4 : 1;
      state.speedMultiplier = next;
      $("speedToggle").textContent = `${next}×`;
      pushToast(`模拟速度 ${next}×`, "info", 1600);
    });
    $("soundToggle").addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      $("soundToggle").classList.toggle("muted", !state.soundEnabled);
      if (state.soundEnabled) {
        audio.ensure();
        audio.changeoverTone();
      } else {
        stopAlarm();
        if (state.lineState === "fault") state.alarmActive = false;
      }
      pushToast(state.soundEnabled ? "机械节拍与报警音已开启" : "声音已静音", "info", 1800);
    });

    document.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea")) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        clearCacheAndChange();
      }
    });
    window.addEventListener("resize", drawScene);
  }

  function animate(now) {
    const realDt = clamp((now - lastFrame) / 1000, 0, 0.1);
    lastFrame = now;
    let remaining = realDt * state.speedMultiplier;
    while (remaining > 0.0001) {
      const step = Math.min(0.05, remaining);
      updateSimulation(step);
      remaining -= step;
    }
    drawScene();
    uiClockAccumulator += realDt;
    if (uiClockAccumulator >= 0.11) {
      uiClockAccumulator = 0;
      renderLiveUI();
    }
    requestAnimationFrame(animate);
  }

  function init() {
    setupEvents();
    renderAll();
    switchTab("devices");
    const updateClock = () => {
      const now = new Date();
      $("clock").textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
    };
    updateClock();
    window.setInterval(updateClock, 1000);
    $("speedToggle").textContent = `${state.speedMultiplier}×`;
    $("soundToggle").title = "开关机械音与故障报警";
    drawScene();
    lastFrame = performance.now();
    requestAnimationFrame(animate);

    window.__CANLINE__ = {
      getState: () => ({
        lineState: state.lineState,
        lineReason: state.lineReason,
        batch: {
          id: state.batch.id,
          done: state.batch.done,
          good: state.batch.good,
          reject: state.batch.reject,
          spawned: state.batch.spawned,
          phaseIndex: state.phaseIndex,
          cans: state.cans.map((can) => ({ id: can.id, state: can.state, x: Math.round(can.x) })),
          anomalies: state.batch.anomalies.map((item) => ({ ...item })),
          recoveries: state.batch.recoveries.map((item) => ({ ...item })),
        },
        params: { ...state.params },
        archive: state.archive.map((item) => ({
          id: item.id,
          status: item.status,
          good: item.good,
          reject: item.reject,
          peakPower: item.peakPower,
          stopReason: item.stopReason,
          anomalyCount: item.anomalies.length,
          recoveries: item.recoveries.map((recovery) => ({ ...recovery })),
        })),
        snapshots: state.snapshots.map((item) => ({ ...item })),
      }),
      start: startLine,
      pause: pauseLine,
      reset: () => createNewBatch(false),
      flush: clearCacheAndChange,
      recover: attemptRecovery,
      fault: triggerEquipmentFault,
      archiveImmutable: () =>
        state.archive.every(
          (record) =>
            Object.isFrozen(record) &&
            Object.isFrozen(record.anomalies) &&
            Object.isFrozen(record.deviceSegments),
        ),
      probeArchiveMutation: () => {
        const record = state.archive[0];
        if (!record) return null;
        const before = record.good;
        try {
          record.good = 999;
        } catch {
          // Frozen archives reject writes in strict mode.
        }
        return { before, after: record.good };
      },
      selectSpec: (spec) => {
        if (state.lineState === "changeover" && SPEC_ORDER.includes(spec)) {
          state.selectedSpec = spec;
          renderControls();
        }
      },
    };
  }

  init();
})();
