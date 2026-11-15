import { IceFerryGame, STEP_SECONDS } from "./simulation.js";
import { FerryRenderer } from "./render.js";
import { FerryAudio } from "./audio.js";
import { verifyLayout } from "./scenario.js";
import {
  loadLatestSummary,
  saveFailedRun,
  saveRunSummary,
} from "./summary-store.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#gameCanvas");
const seedInput = $("#seedInput");
let game = new IceFerryGame(seedInput.value || 20261116);
const renderer = new FerryRenderer(canvas, game);
const audio = new FerryAudio();
let previousLayoutHash = game.scenario.hash;
let accumulator = 0;
let lastFrame = performance.now();
let lastHudUpdate = 0;
let flashTimer = null;
let lastSummary = null;
let modalKind = null;
let autosavedThisRun = false;

const held = {
  thrust: false,
  reverse: false,
  left: false,
  right: false,
  reel: false,
  pay: false,
};

const keyActions = {
  KeyW: ["thrust", "推进 +"],
  ArrowUp: ["thrust", "推进 +"],
  KeyS: ["reverse", "倒车 −"],
  ArrowDown: ["reverse", "倒车 −"],
  KeyA: ["left", "左舵 ◀"],
  ArrowLeft: ["left", "左舵 ◀"],
  KeyD: ["right", "右舵 ▶"],
  ArrowRight: ["right", "右舵 ▶"],
  KeyQ: ["reel", "收缆 ↑"],
  KeyE: ["pay", "放缆 ↓"],
};

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function showFlash(text, warning = false) {
  const node = $("#inputFlash");
  node.textContent = text;
  node.classList.toggle("warn", warning);
  node.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => node.classList.remove("show"), 1100);
}

function pushFeed(text, severity = "info") {
  const feed = $("#eventFeed");
  const item = document.createElement("div");
  item.className = `event-item ${severity === "danger" ? "danger" : severity === "good" ? "good" : ""}`;
  item.textContent = text;
  feed.prepend(item);
  while (feed.children.length > 4) feed.lastElementChild.remove();
  setTimeout(() => item.remove(), 9000);
}

function setHeld(action, pressed, label) {
  if (held[action] === pressed) return;
  held[action] = pressed;
  document.querySelectorAll(`[data-hold="${action}"]`).forEach((button) => {
    button.classList.toggle("pressed", pressed);
  });
  if (label) showFlash(`${label}${pressed ? " · 输入已生效" : " · 已释放"}`, false);
}

function releaseHeld() {
  for (const action of Object.keys(held)) setHeld(action, false);
}

function toggleCable() {
  audio.ensure();
  const attached = game.toggleCable();
  audio.playCable();
  showFlash(attached ? "C · 缆绳已系上最近冰锚" : "C · 缆绳已解开", !attached);
}

function setPaused(paused) {
  const nowPaused = game.togglePause(paused);
  if (nowPaused) openPauseModal();
  else closeModal();
  updateHud(true);
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  audio.ensure();
  const action = keyActions[event.code];
  if (action) {
    event.preventDefault();
    if (!event.repeat) setHeld(action[0], true, action[1]);
    return;
  }
  if (event.code === "KeyC" && !event.repeat) {
    event.preventDefault();
    toggleCable();
  } else if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat) {
    event.preventDefault();
    if (game.state.status === "running") setPaused(!game.state.paused);
  } else if (event.code === "KeyR" && !event.repeat) {
    event.preventDefault();
    restartGame();
  }
});

window.addEventListener("keyup", (event) => {
  const action = keyActions[event.code];
  if (!action) return;
  event.preventDefault();
  setHeld(action[0], false, action[1].replace(/[+−◀▶↑↓]/g, "").trim());
});

window.addEventListener("blur", releaseHeld);

document.querySelectorAll("[data-hold]").forEach((button) => {
  const action = button.dataset.hold;
  const label = button.querySelector("small")?.textContent || action;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    audio.ensure();
    button.setPointerCapture?.(event.pointerId);
    setHeld(action, true, label);
  });
  const release = () => setHeld(action, false, label);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

$("#touchCable").addEventListener("click", toggleCable);

$("#soundToggle").addEventListener("click", async () => {
  await audio.ensure();
  audio.setEnabled(!audio.enabled);
  $("#soundToggle").textContent = `声音 ${audio.enabled ? "开" : "关"}`;
  $("#soundToggle").setAttribute("aria-pressed", String(audio.enabled));
  showFlash(audio.enabled ? "声音已开启：发动机 / 破冰 / 警报" : "声音已静音", !audio.enabled);
});

$("#pauseButton").addEventListener("click", () => {
  audio.ensure();
  if (game.state.status === "running") setPaused(!game.state.paused);
  else if (modalKind) closeModal();
});

$("#restartButton").addEventListener("click", () => restartGame());
$("#failureDemo").addEventListener("click", startFailureDemo);
$("#seedApply").addEventListener("click", applySeed);
seedInput.addEventListener("keydown", (event) => {
  if (event.code === "Enter") applySeed();
});
$("#summaryButton").addEventListener("click", showLastSummary);

function updateLayoutBadge(seed = game.seed) {
  const check = verifyLayout(seed);
  const node = $("#layoutCheck");
  node.textContent = `布局 ${check.hash} ${check.same ? "✓" : "!"}`;
  node.classList.toggle("warn", !check.same);
  node.title = `${check.floeCount} 块浮冰 · ${check.anchorCount} 个冰锚 · 任务 ${check.missionId}`;
  return check;
}

function resetLocalRunState() {
  releaseHeld();
  accumulator = 0;
  lastFrame = performance.now();
  autosavedThisRun = false;
  renderer.particles = [];
  renderer.setGame(game);
  game.clearInputs();
  closeModal();
  $("#eventFeed").replaceChildren();
}

function restartGame(seed = game.seed) {
  if (typeof seed !== "string" && typeof seed !== "number") seed = game.seed;
  audio.ensure();
  const checkBefore = previousLayoutHash;
  previousLayoutHash = game.scenario.hash;
  game.restart(seed);
  seedInput.value = game.seed;
  resetLocalRunState();
  const check = updateLayoutBadge(game.seed);
  pushFeed(`同种子新局：${game.seed} · 布局 ${check.hash}`, "good");
  showFlash(
    checkBefore && checkBefore === check.hash
      ? "已重开 · 新局布局指纹与上一局一致"
      : "已按固定种子重开新局",
    false,
  );
  updateHud(true);
}

function applySeed() {
  const seed = seedInput.value.trim() || "20261116";
  audio.ensure();
  game.restart(seed);
  resetLocalRunState();
  updateLayoutBadge(seed);
  const check = verifyLayout(seed);
  pushFeed(`固定种子 ${seed} · 布局 ${check.hash} · 二次生成一致 ${check.same ? "是" : "否"}`, "good");
  showFlash(`种子 ${seed} 已应用 · 布局校验${check.same ? "通过" : "失败"}`, !check.same);
  updateHud(true);
}

function startFailureDemo() {
  audio.ensure();
  game.startFailureDemo();
  resetLocalRunState();
  updateHud(true);
  showFlash("失败场景已载入：东岸 71° 偏角进港", true);
}

function closeModal() {
  $("#modal").hidden = true;
  modalKind = null;
}

function beginModal(kind, badge, title, copy) {
  modalKind = kind;
  $("#modal").hidden = false;
  $("#modalBadge").textContent = badge;
  $("#modalTitle").textContent = title;
  $("#modalCopy").textContent = copy;
  $("#modalStats").replaceChildren();
  $("#modalPath").replaceChildren();
  $("#modalReasons").replaceChildren();
  $("#modalActions").replaceChildren();
}

function addStat(label, value, tone = "") {
  const card = document.createElement("div");
  card.className = `stat-card ${tone}`;
  const key = document.createElement("span");
  key.textContent = label;
  const val = document.createElement("strong");
  val.textContent = value;
  card.append(key, val);
  $("#modalStats").append(card);
}

function addReasons(incidents, finalReason = null) {
  const box = $("#modalReasons");
  const heading = document.createElement("div");
  heading.className = "panel-kicker";
  heading.textContent = finalReason ? "失败原因摘要" : "碰撞 / 搁浅记录";
  box.append(heading);
  if (!incidents?.length) {
    const row = document.createElement("div");
    row.className = "reason-row";
    row.innerHTML = "<span>未发生碰撞、偏角擦碰或搁浅。</span><span>—</span>";
    box.append(row);
    return;
  }
  const shown = incidents.slice(-8);
  for (const incident of shown) {
    const row = document.createElement("div");
    row.className = "reason-row";
    const left = document.createElement("span");
    left.textContent = `${incident.reason} · ${incident.detail}`;
    const right = document.createElement("span");
    right.textContent = formatClockValue(incident.at);
    row.append(left, right);
    box.append(row);
  }
  if (incidents.length > shown.length) {
    const row = document.createElement("div");
    row.className = "reason-row";
    row.innerHTML = `<span>另有 ${incidents.length - shown.length} 条记录，完整内容在下载摘要中。</span><span>…</span>`;
    box.append(row);
  }
}

function addActions(actions) {
  const box = $("#modalActions");
  for (const action of actions) {
    const button = document.createElement("button");
    button.textContent = action.label;
    if (action.primary) button.classList.add("primary");
    if (action.danger) button.classList.add("danger");
    button.addEventListener("click", action.onClick);
    box.append(button);
  }
}

function pathSvg(summary) {
  const path = summary.path || [];
  if (path.length < 2) {
    return `<p>本次航程没有足够路径采样。</p>`;
  }
  const points = path.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return `
    <svg viewBox="0 0 1200 720" preserveAspectRatio="none" role="img" aria-label="本次航行路径">
      <defs>
        <linearGradient id="miniRiver" x1="0" x2="1">
          <stop offset="0" stop-color="#12343c"/>
          <stop offset="0.5" stop-color="#071f29"/>
          <stop offset="1" stop-color="#12343c"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="720" fill="#07171f"/>
      <rect x="160" width="880" height="720" fill="url(#miniRiver)"/>
      <path d="M160 0 L160 720" stroke="#9fc5c5" stroke-width="18" opacity=".36"/>
      <path d="M1040 0 L1040 720" stroke="#9fc5c5" stroke-width="18" opacity=".36"/>
      <line x1="250" y1="360" x2="950" y2="360" stroke="#77beb7" stroke-width="2" stroke-dasharray="12 12" opacity=".35"/>
      <polyline points="${points}" fill="none" stroke="#a9fff0" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>
      <circle cx="${path[0].x}" cy="${path[0].y}" r="12" fill="#ffc46e"/>
      <circle cx="${path[path.length - 1].x}" cy="${path[path.length - 1].y}" r="12" fill="#79efa2"/>
    </svg>
    <p>路径 ${summary.pathLength || 0} px · ${summary.pathSamples || path.length} 个采样点 · 起点黄 / 终点绿</p>`;
}

function openPauseModal() {
  beginModal(
    "pause",
    "航行已冻结",
    "暂停",
    "物理步进、燃油计时与浮冰漂移均已停止。每次输入都保留在当前状态中。",
  );
  addStat("时间", game.formatClock(), "");
  addStat("往返", `${game.state.roundTrips} / 3`, game.state.roundTrips >= 3 ? "good" : "");
  addStat("靠岸", `${game.state.dockings} / 6`, "");
  addStat("燃油", `${game.state.resources.fuel.toFixed(0)}%`, "");
  addStat("船体", `${game.state.resources.hull.toFixed(0)}%`, game.state.resources.hull < 40 ? "warn" : "");
  addStat("检查点", game.state.checkpointLabel, "");
  addActions([
    { label: "继续航行", primary: true, onClick: () => setPaused(false) },
    {
      label: "从检查点恢复",
      onClick: () => {
        game.recoverCheckpoint();
        closeModal();
        showFlash(`已恢复检查点：${game.state.checkpointLabel}`);
        updateHud(true);
      },
    },
    { label: "同种子重开", onClick: () => restartGame() },
  ]);
}

function openFailureModal() {
  const state = game.state;
  const summary = state.failureSummary || game.buildSummary("failed");
  beginModal(
    "failure",
    state.demoFailure ? "失败场景演练" : "航行中止",
    state.failureReason || "航行失败",
    state.incidents[state.incidents.length - 1]?.detail || "船体无法继续航行。",
  );
  addStat("失败用时", game.formatClock(), "warn");
  addStat("已完成往返", `${state.roundTrips} / 3`, "");
  addStat("已送达", `${state.delivered} / 6`, "");
  addStat("剩余船体", `${state.resources.hull.toFixed(0)}%`, "warn");
  addStat("检查点", game.state.checkpointLabel, "good");
  addStat("摘要记录", `${summary.failureReasons.length} 条`, "");
  $("#modalPath").innerHTML = pathSvg(summary);
  addReasons(summary.failureReasons, state.failureReason);
  saveFailureSummary(summary);
  addActions([
    {
      label: "从检查点恢复",
      primary: true,
      onClick: () => {
        game.recoverCheckpoint();
        closeModal();
        showFlash(`已从 ${game.state.checkpointLabel} 恢复，无需刷新页面`, false);
        pushFeed(`检查点恢复成功：${game.state.checkpointLabel}`, "good");
        updateHud(true);
      },
    },
    { label: "同种子重开", onClick: () => restartGame() },
    { label: "下载失败摘要", onClick: () => downloadSummary(summary) },
  ]);
}

function openWinModal(summary, fromSaved = false) {
  beginModal(
    "win",
    fromSaved ? "已保存的完成摘要" : "任务完成",
    "维修队已全部送达",
    `固定种子 ${summary.seed} 下完成 3 次往返。路径、资源与失败原因摘要均已保存。`,
  );
  addStat("目标往返", `${summary.achieved.rounds} / ${summary.targets.rounds}`, "good");
  addStat("可靠岸次", `${summary.achieved.dockings} / ${summary.targets.dockings}`, "good");
  addStat("送达人数", `${summary.achieved.crew} / ${summary.targets.crew}`, "good");
  addStat("最终用时", summary.finalElapsedLabel, "good");
  addStat("剩余燃油", `${summary.remainingResources.fuel.toFixed(1)}%`, "");
  addStat("剩余船体", `${summary.remainingResources.hull.toFixed(1)}%`, "");
  addStat("剩余缆索", `${summary.remainingResources.cable.toFixed(1)}%`, "");
  addStat("航行记录", `${summary.failureReasons.length} 条`, summary.failureReasons.length ? "warn" : "good");
  $("#modalPath").innerHTML = pathSvg(summary);
  addReasons(summary.failureReasons);
  addActions([
    {
      label: "关闭并查看完整路径",
      primary: true,
      onClick: () => {
        closeModal();
        showFlash("结算路径已在画布高亮显示");
      },
    },
    { label: "同种子新局", onClick: () => restartGame() },
    { label: "下载状态摘要", onClick: () => downloadSummary(summary) },
  ]);
}

function formatClockValue(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

function saveCompletedSummary(summary) {
  if (autosavedThisRun) return;
  autosavedThisRun = true;
  const storage = { getItem: storageGet, setItem: storageSet };
  const stored = saveRunSummary(storage, summary);
  lastSummary = stored;
  $("#summaryReadout").textContent =
    `摘要已保存 · ${stored.targets.rounds} 往返 / ${stored.remainingResources.hull.toFixed(1)}% 船体 / ${stored.finalElapsedLabel}`;
  pushFeed("完成摘要已写入 localStorage，可下载 JSON", "good");
}

function saveFailureSummary(summary) {
  saveFailedRun(
    { getItem: storageGet, setItem: storageSet },
    summary,
  );
}

function downloadSummary(summary) {
  const payload = JSON.stringify(
    {
      ...summary,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ice-ferry-${summary.seed}-${summary.outcome}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showFlash("状态摘要 JSON 已下载");
}

function showLastSummary() {
  let summary = lastSummary;
  if (!summary) {
    summary = loadLatestSummary({ getItem: storageGet, setItem: storageSet });
  }
  if (!summary) {
    showFlash("还没有已保存的完成摘要", true);
    pushFeed("完成三次往返后会自动保存状态摘要", "warn");
    return;
  }
  openWinModal(summary, true);
}

function handleEvents(events) {
  for (const event of events) {
    const receivedAt = event.type;
    if (receivedAt === "collision" || receivedAt === "hard-landing") {
      renderer.burst(game.state.ferry.x, game.state.ferry.y, "#d6fff8", 18, receivedAt === "collision" ? 1.25 : 0.8);
      audio.playIce(receivedAt === "collision" ? 1 : 0.55);
      if (game.state.resources.hull < 38) audio.playAlarm();
    } else if (receivedAt === "dock") {
      audio.playDock();
      renderer.burst(game.state.ferry.x, game.state.ferry.y, "#ffe0a1", 14, 0.6);
    } else if (receivedAt === "checkpoint") {
      audio.playCheckpoint();
    } else if (receivedAt === "cable-attach" || receivedAt === "cable-release" || receivedAt === "cable-break") {
      audio.playCable();
    } else if (receivedAt === "failure") {
      audio.playAlarm(true);
      renderer.burst(game.state.ferry.x, game.state.ferry.y, "#ff9d83", 24, 1.5);
    } else if (receivedAt === "win") {
      audio.playDock();
      audio.playCheckpoint();
    }

    if (event.text) pushFeed(event.text, event.severity);
    if (receivedAt === "win" && game.state.summary) {
      saveCompletedSummary(game.state.summary);
      openWinModal(game.state.summary);
    } else if (receivedAt === "failure") {
      openFailureModal();
    }
  }
}

let pipsInitialized = false;

function ensureRoundPips() {
  if (pipsInitialized) return;
  pipsInitialized = true;
  const pips = $("#roundPips");
  for (let i = 0; i < 3; i += 1) {
    const pip = document.createElement("div");
    pip.className = "round-pip";
    const fill = document.createElement("i");
    pip.append(fill);
    pips.append(pip);
  }
}

function setBar(id, value, invert = false) {
  const node = $(id);
  const clamped = Math.max(0, Math.min(100, value));
  node.style.width = `${clamped}%`;
  node.classList.toggle("low", clamped < 42);
  node.classList.toggle("critical", clamped < 18);
  if (invert) node.style.background = "";
}

function updateHud(force = false) {
  const state = game.state;
  const mission = game.mission;
  ensureRoundPips();
  document.querySelectorAll(".round-pip").forEach((pip, index) => {
    pip.classList.toggle("done", index < state.roundTrips);
    pip.classList.toggle(
      "active",
      index === state.roundTrips && state.roundTrips < mission.rounds && state.status === "running",
    );
  });
  $("#roundValue").textContent = `${state.roundTrips} / ${mission.rounds}`;
  $("#dockValue").textContent = `${state.dockings} / ${mission.targetDockings}`;
  $("#crewValue").textContent = `${state.delivered} / ${mission.targetCrew}`;
  $("#clockReadout").textContent = game.formatClock();
  $("#checkpointReadout").textContent = `检查点：${state.checkpointLabel}`;

  setBar("#fuelBar", state.resources.fuel);
  setBar("#hullBar", state.resources.hull);
  setBar("#cableBar", state.resources.cable);
  $("#fuelValue").textContent = state.resources.fuel.toFixed(0);
  $("#hullValue").textContent = state.resources.hull.toFixed(0);
  $("#cableValue").textContent = state.resources.cable.toFixed(0);

  $("#loadValue").textContent = `${game.loadTons.toFixed(1)} / ${mission.capacityTons.toFixed(1)} t`;
  const overload = $("#overloadFlag");
  overload.textContent = game.overloaded ? "超载 · 机动下降" : "机动正常";
  overload.classList.toggle("over", game.overloaded);

  const throttlePercent = Math.round(state.ferry.throttle * 100);
  $("#throttleReadout").textContent = `${throttlePercent > 0 ? "+" : ""}${throttlePercent}%`;
  const throttleBar = $("#throttleBar");
  throttleBar.style.width = `${Math.min(100, Math.abs(throttlePercent))}%`;
  throttleBar.style.background =
    throttlePercent < 0
      ? "linear-gradient(90deg, #558fc4, #9edcff)"
      : "linear-gradient(90deg, #2e9c91, #77eadc)";

  let headingDegrees = (state.ferry.heading * 180) / Math.PI;
  headingDegrees = (headingDegrees + 360) % 360;
  $("#headingReadout").textContent = `${String(Math.round(headingDegrees)).padStart(3, "0")}°`;
  $("#headingNeedle").style.transform = `translateY(-1px) rotate(${headingDegrees}deg)`;

  const cable = state.cable;
  const cableReadout = cable.attached
    ? `${Math.round(cable.length)} m · ${Math.round(cable.tension * 100)}%`
    : cable.action;
  $("#cableReadout").textContent = cableReadout;
  $("#tensionBar").style.width = `${Math.round(cable.tension * 100)}%`;
  const targetBox = $(".cable-target");
  targetBox.classList.toggle("attached", cable.attached);
  if (cable.attached) {
    const anchor = state.anchors.find((item) => item.id === cable.anchorId);
    $("#cableTargetText").textContent = `${anchor?.label || "冰锚"}已系 · Q 收缆 / E 放缆 / C 解缆`;
  } else {
    const candidate = state.anchors.find((item) => item.id === cable.candidateId);
    $("#cableTargetText").textContent = candidate
      ? `已进入${candidate.label}系缆范围 · 按 C 或点击“系”`
      : "靠近黄标冰锚后按 C 系缆";
  }

  const runState = $("#runState");
  runState.classList.remove("paused", "danger");
  if (state.status === "won") {
    runState.textContent = "完成";
    runState.classList.add("paused");
  } else if (state.status === "failed") {
    runState.textContent = "失败";
    runState.classList.add("danger");
  } else if (state.paused) {
    runState.textContent = "暂停";
    runState.classList.add("paused");
  } else if (state.demoFailure) {
    runState.textContent = "演练";
    runState.classList.add("danger");
  } else {
    runState.textContent = "航行";
  }
  $("#pauseButton").textContent = state.paused ? "继续" : "暂停";

  if (force) {
    const summary = loadLatestSummary({ getItem: storageGet, setItem: storageSet });
    if (summary) {
      $("#summaryReadout").textContent =
        `摘要：${summary.achieved.rounds}/${summary.targets.rounds} 往返 · 船体 ${summary.remainingResources.hull.toFixed(1)}% · ${summary.finalElapsedLabel}`;
    }
  }
}

function gameLoop(now) {
  const delta = Math.min(0.08, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (game.state.status === "running" && !game.state.paused) {
    accumulator = Math.min(accumulator + delta, STEP_SECONDS * 12);
    let iterations = 0;
    while (accumulator >= STEP_SECONDS && iterations < 12) {
      game.input = { ...held };
      game.step();
      accumulator -= STEP_SECONDS;
      iterations += 1;
      if (game.state.status !== "running" || game.state.paused) break;
    }
    audio.updateEngine(game.state.ferry.throttle, game.overloaded);
  } else {
    audio.updateEngine(0, game.overloaded);
    accumulator = 0;
  }
  handleEvents(game.drainEvents());
  renderer.render(now);
  if (now - lastHudUpdate > 70) {
    updateHud();
    lastHudUpdate = now;
  }
  requestAnimationFrame(gameLoop);
}

updateLayoutBadge(game.seed);
updateHud(true);
showFlash("W/S 推进 · A/D 船头 · C 系缆 · P 暂停", false);
pushFeed(`固定种子 ${game.seed} · 布局 ${game.scenario.hash}`, "good");
pushFeed(`${game.mission.profile}：${game.mission.briefing}`, "warn");

window.__iceFerry = {
  get game() {
    return game;
  },
  renderer,
  audio,
  restart: restartGame,
  verifyLayout,
  summary: () => game.buildSummary(),
};

requestAnimationFrame(gameLoop);
