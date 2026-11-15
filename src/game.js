import { DEFAULT_SEED, createWorld, worldFingerprint, worldsMatch } from "./world.js";
import {
  buildRunSummary,
  createInitialState,
  dockingFeedback,
  dockReached,
  findObstacleHit,
  findShallowHit,
  groupReached,
  isWithinDockDockSpeed,
  makeCheckpoint,
  restoreCheckpoint,
  summarizeIncidents,
  tideAt,
} from "./model.js";
import { HarborAudio } from "./audio.js";
import { HarborRenderer, drawSummaryMap } from "./renderer.js";

const byId = (id) => document.getElementById(id);
const canvas = byId("gameCanvas");
const context = canvas.getContext("2d");
const summaryCanvas = byId("summaryMap");
const audio = new HarborAudio();
const SEED = DEFAULT_SEED;
const SUMMARY_KEY = "tidalRepairRun.latestSummary";
const HISTORY_KEY = "tidalRepairRun.history";
const DRIVE_KEYS = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "reverse",
  ArrowDown: "reverse",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};
const KEY_LABELS = {
  forward: "W · 前进推进",
  reverse: "S · 倒车推进",
  left: "A · 左转",
  right: "D · 右转",
};
const INPUT_COLORS = {
  forward: "#58e0c1",
  reverse: "#ffc45d",
  left: "#75bdf0",
  right: "#ff9baa",
};

let world = createWorld(SEED);
let renderer = new HarborRenderer(context, world);
let state = createInitialState(world);
let previousWorld = world;
let layoutAudit = {
  compared: false,
  sameLayout: true,
  message: "首次生成，等待下一局比对",
};
let latestSummary = null;
let lastFrame = performance.now();
let sceneTime = 0;
let pathTimer = 0;
let wakeTimer = 0;
let toastTimer = null;
let wrongTargetCooldown = 0;
let dockWarningCooldown = 0;
let lastSaveError = "";

const inputSources = {
  forward: new Set(),
  reverse: new Set(),
  left: new Set(),
  right: new Set(),
};

function resetCheckpoint(label = "码头") {
  const checkpoint = makeCheckpoint(state, label);
  state.checkpoints = [checkpoint];
  state.checkpointLabel = label;
  return checkpoint;
}

function setWorld(nextWorld, message) {
  previousWorld = world;
  world = nextWorld;
  renderer = new HarborRenderer(context, world);
  const sameLayout = worldsMatch(previousWorld, world);
  layoutAudit = {
    compared: true,
    sameLayout,
    message: sameLayout
      ? `${message}：布局指纹一致 · ${worldFingerprint(world)}`
      : `${message}：布局发生变化，请检查种子`,
  };
  updateLayoutPanel();
}

function newRun({ autoStart = false, compareLayout = true, message = "同种子新局" } = {}) {
  if (compareLayout) {
    setWorld(createWorld(SEED), message);
  }
  state = createInitialState(world);
  resetCheckpoint("码头");
  latestSummary = null;
  wrongTargetCooldown = 0;
  dockWarningCooldown = 0;
  clearAllInputs();
  hideOverlays();
  syncHud();
  if (autoStart) {
    startRun();
  } else {
    byId("introOverlay").classList.remove("hidden");
    showToast("新局已生成 · 布局指纹与上一局比对完成");
  }
}

async function startRun() {
  const started = await audio.ensure();
  if (!started) showToast("音频不可用，驾驶与画面仍可正常使用");
  state.mode = "playing";
  byId("introOverlay").classList.add("hidden");
  byId("resultOverlay").classList.add("hidden");
  showToast("启航 · 先检查 01 号浮标组");
  flashInput("启航", "#58e0c1", true);
  syncHud();
}

function hideOverlays() {
  for (const overlay of ["introOverlay", "pauseOverlay", "incidentOverlay", "resultOverlay"]) {
    byId(overlay).classList.add("hidden");
  }
}

function showToast(message, duration = 2400) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), duration);
}

function flashInput(label, color = "#58e0c1", persistent = false) {
  state.inputPulse = 1;
  state.inputColor = color;
  state.lastInput = label;
  byId("inputEvent").textContent = label;
  const ripple = byId("inputRipple");
  const stage = byId("viewport").getBoundingClientRect();
  ripple.style.left = `${(state.boat.x / world.width) * stage.width}px`;
  ripple.style.top = `${(state.boat.y / world.height) * stage.height}px`;
  ripple.classList.remove("flash");
  void ripple.offsetWidth;
  ripple.classList.add("flash");
  if (!persistent) state.lastInputAt = performance.now();
}

function clearAllInputs() {
  for (const set of Object.values(inputSources)) set.clear();
  document.querySelectorAll(".touch-button.pressed").forEach((button) => {
    button.classList.remove("pressed");
  });
  document.querySelectorAll("kbd.pressed").forEach((key) => key.classList.remove("pressed"));
  state.throttle = 0;
  state.steer = 0;
}

function saveSummary(summary) {
  latestSummary = summary;
  try {
    localStorage.setItem(SUMMARY_KEY, JSON.stringify(summary));
    const previous = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    const history = [summary, ...previous].slice(0, 8);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    lastSaveError = "";
    byId("saveNote").textContent = `状态摘要已保存 · ${SUMMARY_KEY}`;
  } catch (error) {
    lastSaveError = error.message;
    byId("saveNote").textContent = `本地存储不可用，请导出 JSON · ${error.message}`;
  }
}

function downloadSummary() {
  if (!latestSummary) return;
  const blob = new Blob([JSON.stringify(latestSummary, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tidal-run-${latestSummary.seed}-${latestSummary.outcome}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("状态摘要 JSON 已导出");
}

function activeInput(action) {
  return inputSources[action].size > 0;
}

function setDirection(action, source, active, keyElement) {
  if (active) {
    inputSources[action].add(source);
    if (keyElement) keyElement.classList.add("pressed");
    if (state.mode === "playing") {
      flashInput(KEY_LABELS[action], INPUT_COLORS[action]);
    } else if (state.mode === "paused") {
      showToast("任务已暂停 · 点击「继续」后输入生效");
    } else if (state.mode === "intro") {
      showToast("先点击「启航」，驾驶输入才会生效");
    }
  } else {
    inputSources[action].delete(source);
    if (keyElement && !activeInput(action)) keyElement.classList.remove("pressed");
    if (state.mode === "playing") {
      byId("inputEvent").textContent = "输入释放 · 滑行";
    }
  }
  syncControlInputs();
}

function syncControlInputs() {
  state.throttle = activeInput("forward") ? 1 : activeInput("reverse") ? -1 : 0;
  state.steer = (activeInput("right") ? 1 : 0) - (activeInput("left") ? 1 : 0);
  byId("throttleBar").style.width = `${((state.throttle + 1) / 2) * 100}%`;
  byId("steerNeedle").style.left = `${50 + state.steer * 46}%`;
}

function pauseGame() {
  if (state.mode !== "playing") return;
  state.mode = "paused";
  clearAllInputs();
  byId("pauseCheckpoint").textContent = `当前检查点：${state.checkpointLabel}`;
  byId("pauseOverlay").classList.remove("hidden");
  showToast("已暂停 · 时间与潮流冻结");
  syncHud();
}

async function resumeGame() {
  if (state.mode !== "paused") return;
  await audio.ensure();
  state.mode = "playing";
  byId("pauseOverlay").classList.add("hidden");
  showToast("继续航行 · 惯性保留");
  syncHud();
}

function triggerIncident(kind, detail, hit = null) {
  if (state.mode !== "playing") return;
  state.mode = "incident";
  state.boat.vx = 0;
  state.boat.vy = 0;
  state.throttle = 0;
  state.steer = 0;
  clearAllInputs();
  const damage = kind === "collision" ? 15 : 0;
  if (damage) {
    state.hull = Math.max(0, state.hull - damage);
    state.totalHullLost += damage;
  }
  const incident = {
    kind,
    detail,
    time: state.elapsed,
    x: hit?.x ?? state.boat.x,
    y: hit?.y ?? state.boat.y,
  };
  state.incidents.push(incident);
  state.incident = incident;
  state.lastEvent = detail;
  audio.impact(kind === "collision" ? 0.8 : 0.42);
  byId("incidentKicker").textContent = kind === "collision" ? "COLLISION" : "GROUNDING";
  byId("incidentTitle").textContent = kind === "collision" ? "船体发生碰撞" : "船只搁浅";
  byId("incidentDetail").textContent =
    kind === "collision"
      ? `${detail}。船体受损 ${damage}，可从最近检查点恢复。`
      : `${detail}。船底触沙，可从最近检查点恢复。`;
  byId("incidentCheckpoint").textContent = state.checkpointLabel;
  byId("incidentOverlay").classList.remove("hidden");
  syncHud();
}

function recoverFromCheckpoint() {
  const checkpoint = state.checkpoints[state.checkpoints.length - 1];
  if (!checkpoint) {
    showToast("没有可用检查点");
    return;
  }
  state = restoreCheckpoint(state, checkpoint);
  byId("incidentOverlay").classList.add("hidden");
  clearAllInputs();
  syncHud();
  showToast(`已恢复到「${checkpoint.label}」 · 目标与资源已回滚`);
  flashInput("检查点恢复", "#58e0c1");
}

function endRun(outcome, reason) {
  if (state.mode === "complete" || state.mode === "failed") return;
  state.mode = outcome === "success" ? "complete" : "failed";
  state.boat.vx = 0;
  state.boat.vy = 0;
  clearAllInputs();
  byId("pauseOverlay").classList.add("hidden");
  byId("incidentOverlay").classList.add("hidden");
  const summary = buildRunSummary({
    world,
    state,
    outcome,
    reason,
    endedAt: new Date().toISOString(),
    layoutCheck: { ...layoutAudit },
  });
  saveSummary(summary);
  populateSummary(summary);
  byId("resultOverlay").classList.remove("hidden");
  drawSummaryMap(summaryCanvas, world, state, summary);
  audio.chime(outcome === "success");
  syncHud();
}

function populateSummary(summary) {
  const success = summary.outcome === "success";
  byId("resultKicker").textContent = success ? "MISSION COMPLETE" : "MISSION FAILED";
  byId("resultTitle").textContent = success ? "维修件已送达" : "本航次失败";
  byId("resultLead").textContent = success
    ? `三组浮标按序检查完成，最终用时 ${summary.timing.finalTimeSeconds.toFixed(1)} 秒。`
    : summary.failure.reason;
  const stamp = byId("resultStamp");
  stamp.textContent = success ? "完成" : "失败";
  stamp.classList.toggle("failed", !success);
  byId("summaryTargets").textContent = `${summary.objectives.checked} / ${summary.objectives.targetCount}`;
  byId("summaryFuel").textContent = `${summary.resources.fuelRemaining}%`;
  byId("summaryHull").textContent = `${summary.resources.hullRemaining}%`;
  byId("summaryTime").textContent = `${summary.timing.finalTimeSeconds.toFixed(1)} s`;
  byId("summaryFailure").textContent = success
    ? "无任务失败 · 成功返航"
    : summary.failure.reason;
  byId("summaryIncidents").textContent = summarizeIncidents(state);
  byId("saveNote").textContent = lastSaveError
    ? `本地存储不可用，请导出 JSON · ${lastSaveError}`
    : `状态摘要已保存 · ${SUMMARY_KEY}`;
}

function toggleSound() {
  audio.ensure().then((available) => {
    if (!available) {
      showToast("此浏览器不支持 Web Audio");
      return;
    }
    audio.setMuted(!audio.muted);
    const button = byId("soundBtn");
    button.setAttribute("aria-pressed", String(!audio.muted));
    button.classList.toggle("active", !audio.muted);
    byId("soundLabel").textContent = audio.muted ? "声音 关" : "声音 开";
    showToast(audio.muted ? "声音已关闭" : "声音已开启 · 发动机与浪声随状态变化");
  });
}

function restartRun(autoStart = state.mode !== "intro") {
  showToast("正在以相同种子生成新局…", 1200);
  newRun({ autoStart, compareLayout: true, message: "同种子重开" });
  if (autoStart) showToast("新局已启航 · 地图、任务和障碍与上一局一致");
}

function bindEvents() {
  window.addEventListener("keydown", (event) => {
    const action = DRIVE_KEYS[event.code];
    if (action) {
      event.preventDefault();
      const keyElement = byId(
        action === "left"
          ? "keyA"
          : action === "right"
            ? "keyD"
            : action === "forward"
              ? "keyW"
              : "keyS",
      );
      setDirection(action, `key:${event.code}`, true, keyElement);
      return;
    }
    if (event.code === "Space" || event.code === "KeyP") {
      event.preventDefault();
      if (state.mode === "playing") pauseGame();
      else if (state.mode === "paused") resumeGame();
      else if (state.mode === "intro" && event.code === "Space") startRun();
      else showToast("当前状态不能暂停");
      return;
    }
    if (event.code === "Enter" && state.mode === "intro") {
      event.preventDefault();
      startRun();
      return;
    }
    if (event.code === "KeyR") {
      event.preventDefault();
      restartRun(state.mode !== "intro");
    }
  });

  window.addEventListener("keyup", (event) => {
    const action = DRIVE_KEYS[event.code];
    if (!action) return;
    event.preventDefault();
    setDirection(action, `key:${event.code}`, false, null);
  });

  byId("startBtn").addEventListener("click", startRun);
  byId("pauseBtn").addEventListener("click", () => {
    if (state.mode === "playing") pauseGame();
    else if (state.mode === "paused") resumeGame();
    else showToast(state.mode === "intro" ? "请先点击启航" : "本局已结束");
  });
  byId("resumeBtn").addEventListener("click", resumeGame);
  byId("pauseRestartBtn").addEventListener("click", () => restartRun(true));
  byId("restartBtn").addEventListener("click", () => restartRun(state.mode !== "intro"));
  byId("soundBtn").addEventListener("click", toggleSound);
  byId("recoverBtn").addEventListener("click", recoverFromCheckpoint);
  byId("abandonBtn").addEventListener("click", () => {
    endRun("failure", "任务中止：玩家在事故后选择放弃并结算");
  });
  byId("failDemoBtn").addEventListener("click", () => {
    state.fuel = 0;
    state.totalFuelUsed = world.mission.startingFuel;
    state.lastEvent = "燃油耗尽（失败演示）";
    byId("pauseOverlay").classList.add("hidden");
    endRun("failure", "燃油耗尽（失败演示：剩余资源归零）");
  });
  byId("resultRestartBtn").addEventListener("click", () => restartRun(true));
  byId("resultCheckBtn").addEventListener("click", () => {
    restartRun(true);
    showToast("另开新局完成 · 布局指纹已重新比对", 3200);
  });
  byId("seedCheckBtn").addEventListener("click", () => {
    restartRun(true);
    showToast("另开新局完成 · 地图、任务和障碍均已比对", 3200);
  });
  byId("resultExportBtn").addEventListener("click", downloadSummary);

  for (const button of document.querySelectorAll(".touch-button")) {
    const action = button.dataset.input;
    const release = (event) => {
      event.preventDefault();
      setDirection(action, `pointer:${action}`, false, null);
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add("pressed");
      setDirection(action, `pointer:${action}`, true, null);
    });
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", (event) => {
      if (event.buttons) release(event);
    });
  }

  canvas.addEventListener("pointerdown", () => {
    canvas.focus();
    if (state.mode === "playing") showToast("驾驶已就绪 · WASD / 方向键控制");
  });
}

function completeGroup(group) {
  if (!state.visited.includes(group.id)) state.visited.push(group.id);
  state.loaded = state.visited.length;
  state.nextTarget = Math.min(world.mission.targetCount + 1, group.id + 1);
  const pathEnd = state.path[state.path.length - 1];
  if (!pathEnd || Math.hypot(pathEnd.x - group.x, pathEnd.y - group.y) > 1) {
    state.path.push({ x: group.x, y: group.y });
  }
  state.checkpointLabel = `浮标 ${group.label}`;
  state.checkpoints.push(makeCheckpoint(state, state.checkpointLabel));
  state.lastEvent = `已检查浮标组 ${group.label}`;
  flashInput(`检查点 · ${group.label}`, group.color);
  audio.chime(true);
  if (state.loaded === world.mission.targetCount) {
    showToast("三组浮标检查完成 · 维修件已装载，立即返航", 3200);
    byId("targetHint").textContent = "减速返回左侧码头卸货";
  } else {
    const next = world.groups[state.nextTarget - 1];
    showToast(`已检查 ${group.label} · 下一目标 ${next.label} · 载重增加`, 3000);
  }
  syncHud();
}

function updateWake(dt) {
  for (const particle of state.wake) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.size += dt * 3.2;
  }
  state.wake = state.wake.filter((particle) => particle.life > 0);
}

function updateGame(dt) {
  state.elapsed += dt;
  wrongTargetCooldown = Math.max(0, wrongTargetCooldown - dt);
  dockWarningCooldown = Math.max(0, dockWarningCooldown - dt);
  const tide = tideAt(world, state.elapsed);
  const boat = state.boat;
  const loaded = state.loaded;
  const speedMultiplier = 1 - Math.min(0.36, loaded * 0.11);
  const steeringMultiplier = 1 - Math.min(0.3, loaded * 0.085);
  const speed = Math.hypot(boat.vx, boat.vy);
  const throttle = state.throttle;
  const reverseFactor = throttle < 0 ? 0.58 : 1;
  const acceleration = 102 * speedMultiplier * reverseFactor;
  const turnAuthority = 0.3 + Math.min(speed / 74, 1) * 0.7;
  boat.angle += state.steer * 1.48 * steeringMultiplier * turnAuthority * dt;
  boat.vx += Math.cos(boat.angle) * throttle * acceleration * dt;
  boat.vy += Math.sin(boat.angle) * throttle * acceleration * dt;
  boat.vx += tide.current.x * 0.52 * dt;
  boat.vy += tide.current.y * 0.52 * dt;
  const drag = Math.exp(-0.82 * dt);
  boat.vx *= drag;
  boat.vy *= drag;
  const maxSpeed = loaded > 0 ? 100 - Math.min(loaded * 4, 12) : 148;
  const newSpeed = Math.hypot(boat.vx, boat.vy);
  if (newSpeed > maxSpeed) {
    boat.vx = (boat.vx / newSpeed) * maxSpeed;
    boat.vy = (boat.vy / newSpeed) * maxSpeed;
  }
  boat.x += boat.vx * dt;
  boat.y += boat.vy * dt;

  const burnRate = 0.34 + Math.abs(throttle) * 0.72 + speed * 0.0032;
  const burn = Math.min(state.fuel, burnRate * dt);
  state.fuel = Math.max(0, state.fuel - burn);
  state.totalFuelUsed += burn;

  pathTimer += dt;
  const lastPath = state.path[state.path.length - 1];
  if (pathTimer > 0.12 && Math.hypot(boat.x - lastPath.x, boat.y - lastPath.y) > 3.5) {
    state.path.push({ x: boat.x, y: boat.y });
    pathTimer = 0;
  }

  wakeTimer += dt;
  if (speed > 12 && wakeTimer > Math.max(0.035, 0.17 - speed / 1400)) {
    const sternX = boat.x - Math.cos(boat.angle) * 18;
    const sternY = boat.y - Math.sin(boat.angle) * 18;
    state.wake.push({
      x: sternX,
      y: sternY,
      vx: -Math.cos(boat.angle) * 6 + Math.sin(sceneTime + state.wake.length) * 4,
      vy: -Math.sin(boat.angle) * 6 + Math.cos(sceneTime + state.wake.length) * 4,
      life: 1.2,
      maxLife: 1.2,
      size: 3.5 + speed * 0.018,
    });
    wakeTimer = 0;
  }
  updateWake(dt);

  const shoreLimit = renderer.shoreX(boat.y, tide) + 20;
  if (boat.x < shoreLimit || boat.x > world.width - 22 || boat.y < 24 || boat.y > world.height - 24) {
    triggerIncident("collision", "船体擦碰航道岸线", { x: boat.x, y: boat.y });
    return;
  }

  const obstacle = findObstacleHit(world, boat);
  if (obstacle) {
    const name = obstacle.kind === "pontoon" ? "浮桥" : "渔网";
    triggerIncident("collision", `船体与${name}发生碰撞`, { x: boat.x, y: boat.y });
    return;
  }

  const shallow = findShallowHit(world, state);
  if (shallow) {
    triggerIncident("grounding", "船底进入退潮浅滩并搁浅", { x: boat.x, y: boat.y });
    return;
  }

  if (state.loaded < world.mission.targetCount) {
    const target = world.groups[state.nextTarget - 1];
    if (target && groupReached(target, boat)) {
      completeGroup(target);
    } else if (wrongTargetCooldown <= 0) {
      const wrong = world.groups.find(
        (group) =>
          group.id !== state.nextTarget &&
          !state.visited.includes(group.id) &&
          groupReached(group, boat),
      );
      if (wrong) {
        showToast(`顺序错误 · 当前必须先检查 ${world.groups[state.nextTarget - 1].label}`);
        wrongTargetCooldown = 2.6;
      }
    }
  } else if (dockReached(world, boat)) {
    if (isWithinDockDockSpeed(boat)) {
      const dockPoint = {
        x: world.dock.x + world.dock.width,
        y: world.dock.y + world.dock.height / 2,
      };
      const pathEnd = state.path[state.path.length - 1];
      if (!pathEnd || Math.hypot(pathEnd.x - dockPoint.x, pathEnd.y - dockPoint.y) > 1) {
        state.path.push(dockPoint);
      }
      state.lastEvent = "三组浮标检查完成，维修件已送达码头";
      endRun("success", null);
      return;
    }
    if (dockWarningCooldown <= 0) {
      showToast(`靠岸速度过快 · ${dockingFeedback(world, state)}`);
      dockWarningCooldown = 2.8;
    }
  }

  if (state.elapsed >= world.mission.timeLimit) {
    state.elapsed = world.mission.timeLimit;
    endRun("failure", "潮窗关闭：未能在 150 秒内完成检查并返航");
    return;
  }
  if (state.fuel <= 0) {
    endRun("failure", "燃油耗尽：船只失去动力，维修件未能送达");
  }
}

function updateLayoutPanel() {
  byId("fingerprint").textContent = worldFingerprint(world);
  const result = byId("layoutResult");
  const dot = byId("layoutStatusDot");
  result.textContent = layoutAudit.message;
  result.classList.toggle("success", layoutAudit.compared && layoutAudit.sameLayout);
  result.classList.toggle("failure", layoutAudit.compared && !layoutAudit.sameLayout);
  dot.classList.toggle("success", layoutAudit.compared && layoutAudit.sameLayout);
  dot.classList.toggle("failure", layoutAudit.compared && !layoutAudit.sameLayout);
}

function syncHud() {
  const tide = tideAt(world, state.elapsed);
  const speed = Math.hypot(state.boat.vx, state.boat.vy);
  const target = world.groups[state.nextTarget - 1];
  const finishedTargets = state.loaded >= world.mission.targetCount;
  byId("targetNumber").textContent = finishedTargets ? "⌂" : target ? target.label : "—";
  byId("targetName").textContent = finishedTargets
    ? "码头 · 返航卸货"
    : target
      ? `浮标组 ${["A", "B", "C"][target.id - 1]}-${target.label}`
      : "任务完成";
  if (!finishedTargets && target) {
    byId("targetHint").textContent = `驶入${target.color === "#58e0c1" ? "青色" : target.color === "#ffc45d" ? "黄色" : "红色"}浮标圈`;
  }

  byId("speedReadout").textContent = `${(speed * 0.055).toFixed(1)} kn`;
  byId("tideReadout").textContent = `${Math.round(tide.level * 100)}%`;
  byId("tideBar").style.width = `${tide.level * 100}%`;
  const currentKnots = (tide.current.strength * 0.045 + 0.2).toFixed(1);
  byId("currentReadout").textContent = `→ ${currentKnots}`;
  byId("currentStrength").textContent = `${currentKnots} kn`;
  byId("currentArrow").style.transform = `rotate(${tide.current.angle}rad)`;
  byId("waveReadout").textContent = `浪高 ${tide.waveHeight.toFixed(2)} m`;
  const tideChip = byId("tideChip");
  tideChip.textContent = Math.abs(tide.flow) < 0.14 ? "平潮" : tide.flow > 0 ? "涨潮" : "落潮";

  const remaining = Math.max(0, world.mission.timeLimit - state.elapsed);
  byId("clockReadout").textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(
    Math.floor(remaining % 60),
  ).padStart(2, "0")}`;
  byId("clockReadout").style.color = remaining < 30 ? "#ff7d8f" : "";

  byId("fuelValue").textContent = Math.round(state.fuel);
  byId("hullValue").textContent = Math.round(state.hull);
  byId("fuelBar").style.width = `${state.fuel}%`;
  byId("hullBar").style.width = `${state.hull}%`;
  byId("fuelBar").classList.toggle("low", state.fuel < 25);
  byId("hullBar").classList.toggle("low", state.hull < 45);
  byId("loadChip").textContent = state.loaded ? `载重 ${state.loaded} / 3` : "空载";
  const speedMultiplier = 1 - Math.min(0.36, state.loaded * 0.11);
  const steeringMultiplier = 1 - Math.min(0.3, state.loaded * 0.085);
  byId("penaltyNote").classList.toggle("loaded", state.loaded > 0);
  byId("penaltyNote").textContent = state.loaded
    ? `载货 ${state.loaded} 组：最高航速 ${Math.round(speedMultiplier * 100)}% · 转向 ${Math.round(
        steeringMultiplier * 100,
      )}%`
    : "空载：满速与灵活转向";

  document.querySelectorAll(".part-pips span").forEach((pip, index) => {
    pip.classList.toggle("filled", index < state.loaded);
  });
  document.querySelectorAll(".route-node").forEach((node) => {
    const route = node.dataset.route;
    node.classList.toggle("done", route !== "dock" && state.visited.includes(Number(route)));
    node.classList.toggle(
      "active",
      finishedTargets ? route === "dock" : Number(route) === state.nextTarget,
    );
  });
  document.querySelectorAll("#checklist li").forEach((item) => {
    const group = item.dataset.group;
    const done = group !== "dock" && state.visited.includes(Number(group));
    const active = finishedTargets
      ? group === "dock"
      : group !== "dock" && Number(group) === state.nextTarget;
    item.classList.toggle("done", done);
    item.classList.toggle("active", active);
    const small = item.querySelector("small");
    if (small) {
      if (done) small.textContent = "已检查 · 检查点已保存";
      else if (active) small.textContent = group === "dock" ? "减速靠岸卸货" : "当前目标 · 驶入浮标圈";
      else small.textContent = group === "dock" ? "完成三组后返回码头" : "尚未解锁";
    }
  });
}

let hudAccumulator = 0;
function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.04);
  lastFrame = now;
  sceneTime += dt;
  state.inputPulse = Math.max(0, (state.inputPulse || 0) - dt * 1.9);
  if (state.mode === "playing") {
    updateGame(dt);
  }
  hudAccumulator += dt;
  if (hudAccumulator > 0.08) {
    syncHud();
    hudAccumulator = 0;
  }
  audio.update({
    throttle: state.throttle,
    speed: Math.hypot(state.boat.vx, state.boat.vy),
    waveHeight: tideAt(world, state.elapsed).waveHeight,
    active: state.mode === "playing",
  });
  renderer.draw(state, sceneTime);
  requestAnimationFrame(loop);
}

function init() {
  resetCheckpoint("码头");
  bindEvents();
  updateLayoutPanel();
  syncHud();
  byId("soundBtn").classList.add("active");
  window.__tidalGame = {
    getState: () => structuredClone(state),
    getWorld: () => structuredClone(world),
    getSummary: () => (latestSummary ? structuredClone(latestSummary) : null),
    getLayoutAudit: () => ({ ...layoutAudit }),
    fingerprint: () => worldFingerprint(world),
    start: startRun,
    restart: () => restartRun(true),
    pause: pauseGame,
    resume: resumeGame,
    demoFailure: () => {
      state.fuel = 0;
      state.totalFuelUsed = world.mission.startingFuel;
      endRun("failure", "燃油耗尽（失败演示：剩余资源归零）");
    },
    compareNewRun: () => {
      restartRun(true);
      return worldFingerprint(world);
    },
  };
  if (new URLSearchParams(window.location.search).has("qa")) {
    window.__tidalGame.qa = {
      teleport: (x, y, options = {}) => {
        state.boat.x = x;
        state.boat.y = y;
        state.boat.vx = options.vx || 0;
        state.boat.vy = options.vy || 0;
        if (typeof options.angle === "number") state.boat.angle = options.angle;
      },
      setElapsed: (seconds) => {
        state.elapsed = seconds;
      },
    };
  }
  requestAnimationFrame(loop);
}

init();
