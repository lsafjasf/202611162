import {
  DEFAULT_SEED,
  generateWorld,
  formatSignature,
  formatDistance,
} from "./world.js";
import {
  FIXED_STEP,
  createRun,
  startRun,
  stepRun,
  emptyInput,
  buildTelemetry,
  buildSummary,
  captureCheckpoint,
  restoreCheckpoint,
  serializeCheckpoint,
  parseCheckpoint,
  triggerFailureDrill,
  formatElapsed,
} from "./simulation.js";
import { CaveRenderer, drawRouteSummary } from "./render.js";
import { CaveAudio } from "./audio.js";

const SEED = DEFAULT_SEED;
const STORAGE = {
  checkpoint: "abyssal-freight.checkpoint.v1",
  summary: "abyssal-freight.summary.v1",
  current: "abyssal-freight.current.v1",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#gameCanvas"),
  minimap: $("#minimap"),
  briefingModal: $("#briefingModal"),
  pauseModal: $("#pauseModal"),
  endModal: $("#endModal"),
  summaryModal: $("#summaryModal"),
  feedMessage: $("#feedMessage"),
  feedTime: $(".feed-time"),
  feedSeed: $("#feedSeed"),
  batteryFill: $("#batteryFill"),
  batteryValue: $("#batteryValue"),
  batteryCell: $(".battery-cell"),
  cargoValue: $("#cargoValue"),
  cargoSub: $("#cargoSub"),
  timeValue: $("#timeValue"),
  checkpointValue: $("#checkpointValue"),
  checkpointSub: $("#checkpointSub"),
  objectiveCargo: $("#objectiveCargo"),
  objectiveDistance: $("#objectiveDistance"),
  objectiveCheckpoint: $("#objectiveCheckpoint"),
  seedBadge: $("#seedBadge"),
  seedNote: $("#seedNote"),
  clearanceValue: $("#clearanceValue"),
  clearanceFill: $("#clearanceFill"),
  clearanceTrack: $(".clearance-track"),
  clearanceHint: $("#clearanceHint"),
  tiltValue: $("#tiltValue"),
  tiltNeedle: $("#tiltNeedle"),
  tiltGauge: $(".tilt-gauge"),
  tiltHint: $("#tiltHint"),
  speedValue: $("#speedValue"),
  currentValue: $("#currentValue"),
  loadValue: $("#loadValue"),
  collisionValue: $("#collisionValue"),
  attitudeFill: $("#attitudeFill"),
  routeProgress: $("#routeProgress"),
  centerPrompt: $("#centerPrompt"),
  inputEcho: $("#inputEcho"),
  toastStack: $("#toastStack"),
  audioButton: $("#audioButton"),
  audioLabel: $("#audioLabel"),
  pauseButton: $("#pauseButton"),
  restartButton: $("#restartButton"),
  sameSeedButton: $("#sameSeedButton"),
  startButton: $("#startButton"),
  resumeStoredButton: $("#resumeStoredButton"),
  briefingSeed: $("#briefingSeed"),
  briefingSignature: $("#briefingSignature"),
  storageNote: $("#storageNote"),
  pauseBattery: $("#pauseBattery"),
  pauseCargo: $("#pauseCargo"),
  pauseCheckpoint: $("#pauseCheckpoint"),
  resumeButton: $("#resumeButton"),
  pauseRestartButton: $("#pauseRestartButton"),
  endOverline: $("#endOverline"),
  endTitle: $("#endTitle"),
  endReason: $("#endReason"),
  endTarget: $("#endTarget"),
  endBattery: $("#endBattery"),
  endCells: $("#endCells"),
  endTime: $("#endTime"),
  endCollisions: $("#endCollisions"),
  endRouteLength: $("#endRouteLength"),
  endFailureSummary: $("#endFailureSummary"),
  endSaveLine: $("#endSaveLine"),
  endMap: $("#endMap"),
  endSameSeedButton: $("#endSameSeedButton"),
  downloadSummaryButton: $("#downloadSummaryButton"),
  endRestoreButton: $("#endRestoreButton"),
  resultSeal: $("#resultSeal"),
  resultCard: $(".result-card"),
  failureDemoButton: $("#failureDemoButton"),
  summaryButton: $("#summaryButton"),
  summaryJson: $("#summaryJson"),
  closeSummaryButton: $("#closeSummaryButton"),
  summaryDownloadButton: $("#summaryDownloadButton"),
  summaryCopyButton: $("#summaryCopyButton"),
};

let world = generateWorld(SEED);
let run = createRun(world);
let storedCheckpoint = readStoredCheckpoint();
let input = emptyInput();
let virtualKeys = new Set();
let pressedKeys = new Set();
let accumulator = 0;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let lastAutosave = 0;
let endModalTimer = 0;
let started = false;
let audio = new CaveAudio();
let renderer = new CaveRenderer(elements.canvas, elements.minimap);
let verification = null;
let currentSummaryText = "";
let lastEndSummary = null;

const keyActions = {
  a: { input: "left", label: "左推进器接通", detail: "向左推进" },
  d: { input: "right", label: "右推进器接通", detail: "向右推进" },
  q: { input: "trimLeft", label: "配重向左滑移", detail: "降低左舷倾斜" },
  e: { input: "trimRight", label: "配重向右滑移", detail: "降低右舷倾斜" },
  w: { input: "rackUp", label: "货架升高", detail: "会增加顶部占用" },
  s: { input: "rackDown", label: "货架压低", detail: "可穿过低矮钟乳石" },
  " ": { input: "brake", label: "制动器咬合", detail: "快速降低航速" },
};

const keyLabels = {
  a: "A",
  d: "D",
  q: "Q",
  e: "E",
  w: "W",
  s: "S",
  " ": "SPACE",
};

function readStoredCheckpoint() {
  try {
    return parseCheckpoint(localStorage.getItem(STORAGE.checkpoint));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local storage can be disabled without breaking the run.
  }
}

function persistCheckpoint(snapshot = run.lastCheckpoint) {
  if (!snapshot) {
    return false;
  }
  return writeStorage(STORAGE.checkpoint, serializeCheckpoint(snapshot));
}

function persistSummary(summary, current = false) {
  const text = JSON.stringify(summary, null, 2);
  currentSummaryText = text;
  return writeStorage(current ? STORAGE.current : STORAGE.summary, text);
}

function initialize() {
  elements.seedBadge.textContent = `SEED ${SEED}`;
  elements.briefingSeed.textContent = String(SEED);
  elements.feedSeed.textContent = String(SEED);
  elements.briefingSignature.textContent = formatSignature(world.layoutSignature);
  elements.seedNote.textContent = `地图签名 ${formatSignature(
    world.layoutSignature,
  )}；地图、货箱与障碍均由固定种子生成`;

  const validCheckpoint =
    storedCheckpoint &&
    storedCheckpoint.seed === world.seed &&
    storedCheckpoint.layoutSignature === world.layoutSignature;
  if (validCheckpoint) {
    elements.resumeStoredButton.hidden = false;
    elements.storageNote.textContent = `发现检查点「${storedCheckpoint.checkpointLabel}」· ${formatElapsed(
      storedCheckpoint.savedAtElapsed,
    )} · 电量 ${storedCheckpoint.state.battery.toFixed(0)}%`;
  } else {
    storedCheckpoint = null;
  }

  bindEvents();
  updateUi(true);
  requestAnimationFrame(frame);
}

function bindEvents() {
  elements.startButton.addEventListener("click", () => startGame());
  elements.resumeStoredButton.addEventListener("click", () => resumeStoredCheckpoint());
  elements.pauseButton.addEventListener("click", () => togglePause());
  elements.pauseRestartButton.addEventListener("click", () => restartRun());
  elements.restartButton.addEventListener("click", () => restartRun());
  elements.sameSeedButton.addEventListener("click", () => startVerifiedNewGame());
  elements.endSameSeedButton.addEventListener("click", () => startVerifiedNewGame());
  elements.resumeButton.addEventListener("click", () => togglePause(false));
  elements.audioButton.addEventListener("click", () => toggleAudio());
  elements.failureDemoButton.addEventListener("click", () => runFailureDrill());
  elements.summaryButton.addEventListener("click", () => openCurrentSummary());
  elements.closeSummaryButton.addEventListener("click", () => closeModal(elements.summaryModal));
  elements.summaryDownloadButton.addEventListener("click", () => downloadCurrentSummary());
  elements.summaryCopyButton.addEventListener("click", () => copyCurrentSummary());
  elements.downloadSummaryButton.addEventListener("click", () => {
    if (lastEndSummary) {
      downloadSummary(lastEndSummary);
    }
  });
  elements.endRestoreButton.addEventListener("click", () => restoreLastCheckpoint());

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", releaseAllInputs);
  window.addEventListener("beforeunload", () => {
    if (run.status === "playing" && run.lastCheckpoint) {
      persistCheckpoint(run.lastCheckpoint);
    }
  });

  for (const button of $$(".key")) {
    const key = button.dataset.key;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      virtualKeys.add(key);
      setInputForKey(key, true);
      showInputFeedback(key);
      audio.ensure();
    });
    const release = () => {
      virtualKeys.delete(key);
      setInputForKey(key, false);
      syncKeyVisuals();
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  }

  for (const layer of [elements.summaryModal]) {
    layer.addEventListener("click", (event) => {
      if (event.target === layer) {
        closeModal(layer);
      }
    });
  }
}

function startGame() {
  closeModal(elements.briefingModal);
  closeModal(elements.pauseModal);
  closeModal(elements.endModal);
  run = createRun(world);
  startRun(run);
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  renderer.resetCamera(run);
  persistCheckpoint(run.lastCheckpoint);
  persistSummary(buildSummary(run), true);
  audio.ensure();
  setFeed(
    `启航。固定种子 ${SEED} 已锁定；先靠近第一只漂浮货箱并减速装载。`,
  );
  showToast("航次开始", `地图签名 ${formatSignature(world.layoutSignature)} · 目标 3 箱`, "gold");
  updateUi(true);
}

function resumeStoredCheckpoint() {
  if (!storedCheckpoint) {
    startGame();
    return;
  }
  try {
    run = restoreCheckpoint(world, storedCheckpoint);
  } catch (error) {
    showToast("检查点不可用", error.message, "alert");
    storedCheckpoint = null;
    startGame();
    return;
  }
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  closeModal(elements.briefingModal);
  renderer.resetCamera(run);
  persistCheckpoint(run.lastCheckpoint);
  setFeed(
    `已从「${run.lastCheckpoint.checkpointLabel}」恢复 · 电量 ${run.battery.toFixed(
      0,
    )}% · 计时 ${formatElapsed(run.time)}。`,
  );
  showToast("检查点已恢复", "无需刷新页面，物理与资源状态已回滚。", "safe");
  audio.ensure();
  updateUi(true);
}

function restoreLastCheckpoint() {
  const snapshot = run.lastCheckpoint;
  if (!snapshot) {
    startGame();
    return;
  }
  try {
    run = restoreCheckpoint(world, snapshot);
  } catch (error) {
    showToast("恢复失败", error.message, "alert");
    return;
  }
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  closeModal(elements.endModal);
  closeModal(elements.pauseModal);
  renderer.resetCamera(run);
  persistCheckpoint(run.lastCheckpoint);
  setFeed(
    `故障后恢复：回到「${run.lastCheckpoint.checkpointLabel}」 · 电量 ${run.battery.toFixed(
      0,
    )}% · 计时 ${formatElapsed(run.time)}。`,
  );
  showToast("已从检查点恢复", "碰撞与失败状态已清除，航次继续。", "safe");
  updateUi(true);
}

function togglePause(force) {
  if (run.status === "won" || run.status === "failed") {
    showToast("航次已结束", "请重开或恢复检查点后再暂停。", "alert");
    setFeed("当前航次已经结束，暂停操作不可用。", "alert");
    return;
  }
  if (run.status === "ready") {
    showToast("尚未启航", "先点击启航或按 D 启动电机。", "gold");
    setFeed("P 输入已收到；航次尚在任务简报阶段。");
    return;
  }
  const shouldPause =
    typeof force === "boolean" ? force : run.status !== "paused";
  if (shouldPause && run.status === "playing") {
    run.status = "paused";
    releaseAllInputs();
    elements.pauseBattery.textContent = `${run.battery.toFixed(0)}%`;
    elements.pauseCargo.textContent = `${run.cargo.filter((crate) => crate.collected).length} / ${
      world.mission.cargoTarget
    }`;
    elements.pauseCheckpoint.textContent =
      run.lastCheckpoint?.checkpointLabel || "未记录";
    openModal(elements.pauseModal);
    setFeed("航次暂停。计时、电量、暗流与碰撞检测均已冻结。");
    showToast("已暂停", "按 P 或点击继续恢复航程。", "gold");
  } else if (!shouldPause && run.status === "paused") {
    run.status = "playing";
    closeModal(elements.pauseModal);
    lastFrame = performance.now();
    accumulator = 0;
    setFeed("继续航程。电机与暗流模拟已恢复。");
    showToast("继续航程", "状态从暂停点原样恢复。", "safe");
  }
  updateUi(true);
}

function verifyLayout(previousWorld, nextWorld) {
  let matched = 0;
  let total = 0;
  const check = (condition) => {
    total += 1;
    if (condition) {
      matched += 1;
    }
  };
  check(previousWorld.layoutSignature === nextWorld.layoutSignature);
  check(previousWorld.seed === nextWorld.seed);
  check(previousWorld.warehouse.x === nextWorld.warehouse.x);
  check(previousWorld.mission.cargoTarget === nextWorld.mission.cargoTarget);
  check(
    previousWorld.mission.pickupSpeedLimit === nextWorld.mission.pickupSpeedLimit &&
      previousWorld.mission.dockSpeedLimit === nextWorld.mission.dockSpeedLimit,
  );
  check(
    JSON.stringify(previousWorld.hazards) === JSON.stringify(nextWorld.hazards),
  );
  check(
    JSON.stringify(previousWorld.failureScenario) ===
      JSON.stringify(nextWorld.failureScenario),
  );
  check(
    previousWorld.stalactites.length === nextWorld.stalactites.length &&
      previousWorld.stalactites.every(
        (item, index) =>
          item.x === nextWorld.stalactites[index].x &&
          item.bottom === nextWorld.stalactites[index].bottom,
      ),
  );
  check(
    previousWorld.crates.every(
      (crate, index) =>
        crate.id === nextWorld.crates[index].id &&
        crate.x === nextWorld.crates[index].x &&
        crate.mass === nextWorld.crates[index].mass &&
        crate.slot === nextWorld.crates[index].slot,
    ),
  );
  check(
    previousWorld.checkpoints.every(
      (checkpoint, index) =>
        checkpoint.id === nextWorld.checkpoints[index].id &&
        checkpoint.x === nextWorld.checkpoints[index].x,
    ),
  );
  return {
    matched,
    total,
    ok: matched === total,
    signature: nextWorld.layoutSignature,
  };
}

function startVerifiedNewGame(announce = true) {
  clearTimeout(endModalTimer);
  const previousWorld = world;
  const nextWorld = generateWorld(SEED);
  verification = verifyLayout(previousWorld, nextWorld);
  world = nextWorld;
  run = createRun(world);
  startRun(run);
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  removeStorage(STORAGE.checkpoint);
  removeStorage(STORAGE.current);
  persistCheckpoint(run.lastCheckpoint);
  renderer.resetCamera(run);
  closeModal(elements.briefingModal);
  closeModal(elements.pauseModal);
  closeModal(elements.endModal);
  releaseAllInputs();
  elements.seedNote.textContent = verification.ok
    ? `同种子复验 ${verification.matched}/${verification.total} · 签名 ${formatSignature(
        verification.signature,
      )}`
    : `复验异常 ${verification.matched}/${verification.total}`;
  setFeed(
    verification.ok
      ? `同种子新局：布局复验通过（${verification.matched}/${verification.total}），关键对象位置与胜负条件一致。`
      : `布局复验失败：仅 ${verification.matched}/${verification.total} 项一致。`,
    verification.ok ? "safe" : "alert",
  );
  if (announce) {
    showToast(
      verification.ok ? "同种子布局一致" : "布局复验异常",
      verification.ok
        ? `${verification.matched}/${verification.total} 项关键对象与胜负条件吻合 · ${formatSignature(
            verification.signature,
          )}`
        : "请查看状态摘要中的地图签名。",
      verification.ok ? "safe" : "alert",
    );
  }
  audio.ensure();
  updateUi(true);
}

function restartRun() {
  const previous = world;
  const next = generateWorld(SEED);
  verification = verifyLayout(previous, next);
  world = next;
  run = createRun(world);
  startRun(run);
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  closeModal(elements.briefingModal);
  closeModal(elements.pauseModal);
  closeModal(elements.endModal);
  removeStorage(STORAGE.checkpoint);
  removeStorage(STORAGE.current);
  persistCheckpoint(run.lastCheckpoint);
  renderer.resetCamera(run);
  releaseAllInputs();
  setFeed(
    `已重开本局。固定种子 ${SEED} 重新生成：关键对象 ${verification.matched}/${verification.total} 项一致。`,
  );
  showToast("本局已重开", `检查点已重置 · 布局 ${verification.matched}/${verification.total} 一致`, "gold");
  updateUi(true);
}

function runFailureDrill() {
  if (run.status === "ready") {
    startGame();
  }
  if (run.status === "paused") {
    togglePause(false);
  }
  if (run.status !== "playing") {
    showToast("无法演练", "当前没有进行中的航次。", "alert");
    return;
  }
  releaseAllInputs();
  const drillEvent = triggerFailureDrill(run);
  if (!drillEvent) {
    return;
  }
  processEvents([drillEvent]);
  lastEndSummary = run.finalSummary;
  persistSummary(run.finalSummary);
  persistCheckpoint(run.lastCheckpoint);
  setFeed("已触发固定失败场景：碎石浅滩搁浅。检查点仍可用于恢复。", "alert");
  showEndModal(run.finalSummary);
  updateUi(true);
}

function frame(now) {
  const realDelta = Math.min(0.12, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  if (run.status === "playing" && started) {
    accumulator += realDelta;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 8) {
      const events = stepRun(run, input, FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
      if (events.length > 0) {
        processEvents(events);
      }
      if (run.status !== "playing") {
        accumulator = 0;
        break;
      }
    }
    if (steps === 8) {
      accumulator = 0;
    }
  } else {
    accumulator = 0;
  }

  const telemetry = run.telemetry?.clearancePx !== undefined ? run.telemetry : buildTelemetry(run);
  audio.setMotion({
    speed: run.raft.vx,
    thrust: input.right || input.left ? 1 : 0,
    battery: run.battery,
    tilt: run.raft.tilt,
    clearance: telemetry.clearancePx,
    paused: run.status !== "playing",
  });
  audio.update(realDelta, telemetry, run.status !== "playing");

  renderer.render(run, { paused: run.status !== "playing" });

  if (now - lastUiUpdate > 65) {
    lastUiUpdate = now;
    updateUi();
  }

  if (run.status === "playing" && now - lastAutosave > 5500) {
    lastAutosave = now;
    persistSummary(buildSummary(run), true);
    persistCheckpoint(run.lastCheckpoint);
  }

  requestAnimationFrame(frame);
}

function processEvents(events) {
  for (const event of events) {
    const severity =
      event.severity === "alert"
        ? "alert"
        : event.severity === "gold"
          ? "gold"
          : event.severity === "safe"
            ? "safe"
            : "";
    if (event.title) {
      showToast(event.title, event.message, severity);
    }
    if (event.message) {
      setFeed(event.message, severity);
    }

    if (event.type === "collision") {
      renderer.impact(Math.max(0.5, (event.damage || 6) / 7));
      audio.collision(clamp01((event.damage || 6) / 8));
    } else if (event.type === "pickup") {
      audio.pickup();
      renderer.impact(0.18);
    } else if (event.type === "cell") {
      audio.pickup();
    } else if (event.type === "checkpoint") {
      audio.checkpoint();
      const saved = persistCheckpoint(run.lastCheckpoint);
      persistSummary(buildSummary(run), true);
      if (!saved) {
        showToast("本地存储不可用", "检查点只保留在当前页面内存中。", "alert");
      }
    } else if (event.type === "success" || event.type === "failure") {
      handleEndEvent(event);
    }
  }
}

function handleEndEvent(event) {
  lastEndSummary = run.finalSummary || buildSummary(run);
  persistSummary(lastEndSummary);
  if (run.status === "won") {
    removeStorage(STORAGE.checkpoint);
    storedCheckpoint = null;
    audio.success();
  } else {
    persistCheckpoint(run.lastCheckpoint);
    audio.failure();
  }
  updateUi(true);
  clearTimeout(endModalTimer);
  endModalTimer = setTimeout(() => showEndModal(lastEndSummary), event.type === "success" ? 720 : 480);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function setFeed(message, severity = "") {
  elements.feedMessage.textContent = message;
  elements.feedMessage.classList.toggle("is-alert", severity === "alert");
  elements.feedTime.textContent = `SYS ${formatElapsed(run.time).slice(0, 5)}`;
}

function showToast(title, message, severity = "") {
  const toast = document.createElement("div");
  toast.className = `toast${severity ? ` is-${severity}` : ""}`;
  const label = document.createElement("b");
  label.textContent = title;
  const copy = document.createElement("span");
  copy.textContent = message;
  toast.append(label, copy);
  elements.toastStack.append(toast);
  while (elements.toastStack.children.length > 3) {
    elements.toastStack.firstElementChild.remove();
  }
  setTimeout(() => {
    toast.classList.add("is-out");
    setTimeout(() => toast.remove(), 280);
  }, severity === "alert" ? 4200 : 3200);
}

function handleKeyDown(event) {
  const raw = event.key === " " ? " " : event.key.toLowerCase();
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }

  if (event.code === "Escape") {
    if (elements.summaryModal.classList.contains("is-open")) {
      closeModal(elements.summaryModal);
      event.preventDefault();
    }
    return;
  }

  if (raw === "p") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (raw === "r") {
    event.preventDefault();
    restartRun();
    return;
  }
  if (raw === "m") {
    event.preventDefault();
    toggleAudio();
    return;
  }

  const action = keyActions[raw];
  if (!action) {
    return;
  }
  event.preventDefault();
  audio.ensure();

  if (run.status === "ready") {
    startGame();
  }
  if (run.status === "paused") {
    showToast("航次暂停", "输入已记录为视觉反馈，但不会推进模拟。", "gold");
    elements.inputEcho.textContent = `${keyLabels[raw]} · 暂停中`;
    return;
  }
  if (run.status === "won" || run.status === "failed") {
    showToast("航次已结束", "重开或恢复检查点后才能继续操作。", "alert");
    return;
  }

  if (!pressedKeys.has(raw)) {
    pressedKeys.add(raw);
    refreshInput();
    syncKeyVisuals();
    showInputFeedback(raw);
  }
}

function handleKeyUp(event) {
  const raw = event.key === " " ? " " : event.key.toLowerCase();
  if (keyActions[raw]) {
    event.preventDefault();
    pressedKeys.delete(raw);
    refreshInput();
    syncKeyVisuals();
  }
}

function releaseAllInputs() {
  pressedKeys.clear();
  virtualKeys.clear();
  input = emptyInput();
  syncKeyVisuals();
}

function refreshInput() {
  input = emptyInput();
  for (const key of new Set([...pressedKeys, ...virtualKeys])) {
    const action = keyActions[key];
    if (action) {
      input[action.input] = true;
    }
  }
}

function setInputForKey(key, active) {
  if (active) {
    virtualKeys.add(key);
  } else {
    virtualKeys.delete(key);
  }
  refreshInput();
  syncKeyVisuals();
}

function syncKeyVisuals() {
  const active = new Set([...pressedKeys, ...virtualKeys]);
  for (const button of $$(".key")) {
    button.classList.toggle("is-active", active.has(button.dataset.key));
  }
}

function showInputFeedback(key) {
  const action = keyActions[key];
  if (!action) {
    return;
  }
  elements.inputEcho.textContent = `${keyLabels[key]} · ${action.label}`;
  setFeed(`${keyLabels[key]} 输入 · ${action.label}：${action.detail}`);
  showToast(
    `${keyLabels[key]} · ${action.label}`,
    action.detail,
    key === " " ? "gold" : "",
  );
}

async function toggleAudio() {
  const enabled = await audio.toggle();
  elements.audioLabel.textContent = enabled ? "声音" : "静音";
  elements.audioButton.classList.toggle("is-muted", !enabled);
  showToast(
    enabled ? "声音已开启" : "声音已静音",
    enabled ? "电机、回声与碰撞音效随船体状态变化。" : "图像与交互仍保持运行。",
    enabled ? "safe" : "",
  );
}

function updateUi(force = false) {
  const telemetry = buildTelemetry(run);
  const collected = run.cargo.filter((crate) => crate.collected).length;
  const target = world.mission.cargoTarget;
  const batteryPct = Math.max(0, Math.min(100, run.battery));
  const checkpointLabel = run.lastCheckpoint?.checkpointLabel || "入洞口";

  elements.batteryFill.style.width = `${batteryPct}%`;
  elements.batteryValue.textContent = `${batteryPct.toFixed(0)}%`;
  elements.batteryCell.classList.toggle("is-low", batteryPct < 24);
  elements.cargoValue.textContent = `${collected} / ${target}`;
  elements.cargoSub.textContent =
    run.status === "won"
      ? "全部入库"
      : `${run.delivered} 已入库 · ${collected} 在筏上`;
  elements.timeValue.textContent = formatElapsed(run.time);
  elements.checkpointValue.textContent = checkpointLabel;
  elements.checkpointSub.textContent = run.lastCheckpoint
    ? `记录 ${formatElapsed(run.lastCheckpoint.savedAtElapsed)}`
    : "自动记录";
  elements.objectiveCheckpoint.textContent = checkpointLabel;
  elements.objectiveCargo.textContent = `${collected} / ${target}`;
  elements.objectiveDistance.textContent = formatDistance(world, run.raft.x);

  const clearanceCm = telemetry.clearanceCm;
  elements.clearanceValue.textContent = `${clearanceCm > 0 ? "+" : ""}${clearanceCm} cm`;
  elements.clearanceValue.classList.toggle(
    "is-warning",
    telemetry.clearanceWarning,
  );
  elements.clearanceFill.style.width = `${Math.max(
    3,
    Math.min(100, ((telemetry.clearancePx + 40) / 320) * 100),
  )}%`;
  elements.clearanceTrack.classList.toggle(
    "is-danger",
    telemetry.clearanceWarning,
  );
  elements.clearanceHint.textContent = telemetry.clearanceWarning
    ? "净空不足 · 按 S 压低货架"
    : telemetry.clearancePx < 90
      ? "低矮洞段 · 保持货架低位"
      : "保持货架低于钟乳石";

  const tiltDegrees = telemetry.tiltDegrees;
  elements.tiltValue.textContent = `${tiltDegrees > 0 ? "+" : ""}${tiltDegrees.toFixed(
    1,
  )}°`;
  elements.tiltValue.classList.toggle("is-warning", telemetry.tiltWarning);
  elements.tiltNeedle.style.transform = `rotate(${Math.max(
    -27,
    Math.min(27, tiltDegrees),
  )}deg)`;
  elements.tiltGauge.classList.toggle("is-danger", telemetry.tiltWarning);
  elements.tiltHint.textContent = telemetry.tiltWarning
    ? "偏载耗电增加 · 用 Q / E 调平"
    : "Q 左移配重 · E 右移配重";
  elements.speedValue.textContent = `${telemetry.speedKnots.toFixed(1)} kn`;
  const current = telemetry.currentZone;
  elements.currentValue.textContent =
    Math.abs(telemetry.currentForce) < 1
      ? "平流"
      : `${telemetry.currentForce > 0 ? "→" : "←"} ${current.label.replace(
          "水流",
          "",
        )} ${Math.abs(telemetry.currentForce).toFixed(0)}`;
  elements.currentValue.classList.toggle(
    "is-warning",
    telemetry.currentForce < -18,
  );
  elements.loadValue.textContent =
    telemetry.loadMass <= 0
      ? "空载"
      : `${telemetry.loadMass.toFixed(1)} t · ${collected}/${target}`;
  elements.collisionValue.textContent = `${run.collisions} 次`;
  elements.collisionValue.classList.toggle("is-warning", run.collisions > 0);
  elements.attitudeFill.style.left = `${clamp(
    50 + (telemetry.centerOfMass / 48) * 46,
    4,
    96,
  )}%`;
  elements.routeProgress.textContent = `${Math.max(
    0,
    Math.min(100, Math.round((run.raft.x / world.warehouse.x) * 100)),
  )}%`;

  elements.pauseButton.children[1].textContent =
    run.status === "paused" ? "继续" : "暂停";
  elements.audioButton.classList.toggle("is-muted", !audio.enabled);
  elements.audioLabel.textContent = audio.enabled ? "声音" : "静音";

  if (!force) {
    updatePrompt(telemetry, collected, target);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updatePrompt(telemetry, collected, target) {
  if (
    run.status === "won" ||
    run.status === "failed" ||
    run.status === "paused" ||
    !started
  ) {
    elements.centerPrompt.classList.add("is-hidden");
    return;
  }

  let key = "D";
  let title = "向右推进";
  let detail = "穿越暗河，沿航迹寻找货箱";

  if (telemetry.atDock) {
    if (collected >= target) {
      key = "SPACE";
      title = "减速靠泊";
      detail = "速度低于 9 kn，等待闸门对齐";
    } else {
      key = "A";
      title = "仓库缺少物资箱";
      detail = `还需 ${target - collected} 只 · 沿航迹折返`;
    }
  } else if (telemetry.inShallow && telemetry.strandingTimer > 0.35) {
    key = "D";
    title = "浅滩滞留";
    detail = `按 D 推进脱困 · 保护停机 ${Math.max(
      0,
      6.5 - telemetry.strandingTimer,
    ).toFixed(1)}s`;
  } else if (telemetry.clearanceWarning) {
    key = "S";
    title = "顶部净空不足";
    detail = "压低货架穿过钟乳石";
  } else if (
    telemetry.nearestCargo &&
    telemetry.distanceToCargo < 130
  ) {
    key = "SPACE";
    title = "靠近漂浮货箱";
    detail = `距离 ${Math.round(telemetry.distanceToCargo)} m · 减速至 15 kn 以下`;
  } else if (telemetry.tiltWarning) {
    key = telemetry.centerOfMass > 0 ? "Q" : "E";
    title = "船体偏载";
    detail = "移动配重，倾斜回到安全范围";
  }

  elements.centerPrompt.classList.remove("is-hidden");
  elements.centerPrompt.querySelector(".prompt-key").textContent = key;
  elements.centerPrompt.querySelector("b").textContent = title;
  elements.centerPrompt.querySelector("small").textContent = detail;
}

function openModal(element) {
  for (const layer of $$(".modal-layer")) {
    layer.classList.remove("is-open");
  }
  element.classList.add("is-open");
}

function closeModal(element) {
  element.classList.remove("is-open");
}

function showEndModal(summary) {
  if (!summary) {
    return;
  }
  lastEndSummary = summary;
  currentSummaryText = JSON.stringify(summary, null, 2);
  const success = summary.outcome === "success";
  elements.resultCard.classList.toggle("is-failure", !success);
  elements.endOverline.textContent = success ? "MISSION COMPLETE" : "RUN ABORTED";
  elements.endTitle.textContent = success
    ? "补给已入库"
    : summary.failure.cause === "stranded" || summary.failure.cause === "drill"
      ? "货筏搁浅"
      : summary.failure.cause === "battery-empty"
        ? "电量耗尽"
        : "航次中止";
  elements.endReason.textContent = success
    ? `${summary.objective.delivered} / ${summary.objective.target} 只物资箱安全抵达地下仓库。`
    : summary.failure.reason;
  elements.resultSeal.textContent = success ? "✓" : "×";
  elements.endTarget.textContent = `${summary.objective.delivered} / ${summary.objective.target}`;
  elements.endBattery.textContent = `${summary.resources.batteryPct.toFixed(1)}%`;
  elements.endCells.textContent = String(summary.resources.reserveCellsRemaining);
  elements.endTime.textContent = summary.timing.formatted;
  elements.endCollisions.textContent = `${summary.resources.collisions} / ${summary.route.checkpointCount}`;
  elements.endRouteLength.textContent = `${summary.route.distanceMeters} m`;
  elements.endFailureSummary.textContent = summary.failure.summary;
  elements.endSaveLine.textContent = success
    ? "成功摘要已保存到本机；可下载 JSON 复核目标、资源与用时。"
    : "失败摘要与最后检查点已保存；恢复无需刷新页面。";
  elements.endRestoreButton.hidden = success || !run.lastCheckpoint;
  openModal(elements.endModal);
  requestAnimationFrame(() => drawRouteSummary(elements.endMap, summary));
}

function openCurrentSummary() {
  const summary =
    run.status === "won" || run.status === "failed"
      ? run.finalSummary || buildSummary(run)
      : buildSummary(run);
  currentSummaryText = JSON.stringify(summary, null, 2);
  persistSummary(summary, true);
  elements.summaryJson.textContent = currentSummaryText;
  openModal(elements.summaryModal);
  showToast("状态摘要已保存", "包含目标、电量、用时、航迹与故障摘要。", "safe");
}

async function copyCurrentSummary() {
  try {
    await navigator.clipboard.writeText(currentSummaryText);
    showToast("摘要已复制", "JSON 已写入剪贴板。", "safe");
  } catch {
    showToast("复制失败", "可改用下载摘要 JSON。", "alert");
  }
}

function downloadCurrentSummary() {
  if (!currentSummaryText) {
    openCurrentSummary();
  }
  try {
    downloadSummary(JSON.parse(currentSummaryText));
  } catch {
    showToast("摘要不可用", "请先重新生成状态摘要。", "alert");
  }
}

function downloadSummary(summary) {
  const blob = new Blob([JSON.stringify(summary, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const outcome = summary.outcome || "state";
  link.href = url;
  link.download = `abyssal-freight-${summary.seed}-${outcome}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("摘要已导出", `文件：${link.download}`, "gold");
}

if (new URLSearchParams(window.location.search).has("debug")) {
  window.__abyssal = {
    snapshot() {
      const telemetry = buildTelemetry(run);
      return {
        status: run.status,
        time: run.time,
        x: run.raft.x,
        vx: run.raft.vx,
        rack: run.raft.rack,
        battery: run.battery,
        collisions: run.collisions,
        cargo: run.cargo.map((crate) => ({
          id: crate.id,
          x: crate.x,
          collected: crate.collected,
          slot: crate.slot,
          mass: crate.mass,
        })),
        telemetry: {
          clearancePx: telemetry.clearancePx,
          tiltDegrees: telemetry.tiltDegrees,
          centerOfMass: telemetry.centerOfMass,
          nearestCargo: telemetry.nearestCargo,
          distanceToCargo: telemetry.distanceToCargo,
          distanceToWarehouse: telemetry.distanceToWarehouse,
          atDock: telemetry.atDock,
          strandingTimer: telemetry.strandingTimer,
        },
        lastCheckpoint: run.lastCheckpoint?.checkpointLabel || null,
      };
    },
    summary() {
      return buildSummary(run);
    },
  };
}

initialize();
