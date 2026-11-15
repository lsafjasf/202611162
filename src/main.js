import {
  DEFAULT_SEED,
  LOW_TIDE_SECONDS,
  buildStateSummary,
  cargoTotal,
  createGame,
  depart,
  dock,
  dockContext,
  formatClock,
  generateWorld,
  homeDistance,
  loadCargo,
  recoverFromCheckpoint,
  setPaused,
  setRouteOrder,
  shipDraft,
  tideLevel,
  triggerFailure,
  updateGame,
} from "./core.js";
import { SeaAudio } from "./audio.js";
import { drawScene } from "./render.js";

const STORAGE_KEY = "tideway-state-summary-v1";
const FINGERPRINT_KEY = "tideway-layout-fingerprint-v1";
const WORLD = { width: 1200, height: 760 };

const elements = {
  canvas: document.querySelector("#gameCanvas"),
  seedLabel: document.querySelector("#seedLabel"),
  tideText: document.querySelector("#tideText"),
  tideChip: document.querySelector("#tideChip"),
  weatherLabel: document.querySelector("#weatherLabel"),
  speedReadout: document.querySelector("#speedReadout"),
  cargoReadout: document.querySelector("#cargoReadout"),
  zoneReadout: document.querySelector("#zoneReadout"),
  missionBadge: document.querySelector("#missionBadge"),
  objectiveList: document.querySelector("#objectiveList"),
  fuelSlots: document.querySelector("#fuelSlots"),
  batterySlots: document.querySelector("#batterySlots"),
  draftLabel: document.querySelector("#draftLabel"),
  routeButtons: [...document.querySelectorAll("[data-route]")],
  tideCountdown: document.querySelector("#tideCountdown"),
  tideFill: document.querySelector("#tideFill"),
  tideMarker: document.querySelector("#tideMarker"),
  castOffBtn: document.querySelector("#castOffBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  restartBtn: document.querySelector("#restartBtn"),
  failureBtn: document.querySelector("#failureBtn"),
  audioBtn: document.querySelector("#audioBtn"),
  summaryBtn: document.querySelector("#summaryBtn"),
  loadFuelBtn: document.querySelector("#loadFuelBtn"),
  loadBatteryBtn: document.querySelector("#loadBatteryBtn"),
  loadAllBtn: document.querySelector("#loadAllBtn"),
  logList: document.querySelector("#logList"),
  toast: document.querySelector("#toast"),
  overlay: document.querySelector("#overlay"),
  overlayKicker: document.querySelector("#overlayKicker"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayBody: document.querySelector("#overlayBody"),
  overlayActions: document.querySelector("#overlayActions"),
  layoutFingerprint: document.querySelector("#layoutFingerprint"),
  layoutAudit: document.querySelector("#layoutAudit"),
};

const context = elements.canvas.getContext("2d");
const audio = new SeaAudio();
let savedFingerprint = null;
try {
  savedFingerprint = localStorage.getItem(FINGERPRINT_KEY);
} catch {
  savedFingerprint = null;
}

let game = createGame(DEFAULT_SEED, { previousFingerprint: savedFingerprint });
let lastTime = performance.now();
let lastUiTime = 0;
let lastStatus = game.status;
let overlayMode = null;
let toastTimer = 0;
let clickPulses = [];
let lastDockKey = "";
let summaryAutoPaused = false;
const keys = { up: false, down: false, left: false, right: false };

function persistFingerprint() {
  try {
    localStorage.setItem(FINGERPRINT_KEY, game.world.fingerprint);
    savedFingerprint = game.world.fingerprint;
  } catch {
    savedFingerprint = game.world.fingerprint;
  }
}

persistFingerprint();

function flashButton(button, event) {
  if (!button) return;
  button.classList.remove("is-pressed");
  if (event && button.getBoundingClientRect) {
    const rect = button.getBoundingClientRect();
    button.style.setProperty("--px", `${event.clientX - rect.left}px`);
    button.style.setProperty("--py", `${event.clientY - rect.top}px`);
  }
  void button.offsetWidth;
  button.classList.add("is-pressed");
  window.setTimeout(() => button.classList.remove("is-pressed"), 320);
}

function showToast(text, tone = "info", duration = 2800) {
  if (!text) return;
  window.clearTimeout(toastTimer);
  elements.toast.textContent = text;
  elements.toast.className = `toast is-visible${tone === "warning" ? " is-warning" : tone === "success" ? " is-success" : ""}`;
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function ensureAudio() {
  audio.init().then(() => {
    audio.setMuted(elements.audioBtn.dataset.muted === "true");
    audio.update(game);
  }).catch(() => {
    showToast("浏览器未允许音频启动，可点击声音按钮重试。", "warning");
  });
}

function feedback(result, sound = "tap") {
  if (!result) return;
  const tone = result.tone || "info";
  showToast(result.message, tone);
  audio.cue(tone === "warning" ? "warning" : sound);
  renderUI(true);
}

function statusLabel(state) {
  if (state.status === "ready") return "待装载";
  if (state.status === "paused") return "已暂停";
  if (state.status === "failed") return "航行失败";
  if (state.status === "won") return "任务完成";
  const count = Object.values(state.delivered).filter(Boolean).length;
  return count === 2 ? "返港中" : `航行中 ${count}/2`;
}

function formatZone(state) {
  const contextInfo = dockContext(state);
  if (state.status === "ready") return "母港";
  if (contextInfo.type === "complete") return "母港·待确认";
  if (contextInfo.type === "island" || contextInfo.type === "wrong-island") {
    return contextInfo.island?.shortName || "灯塔码头";
  }
  if (homeDistance(state) < 72) return "母港";
  if (homeDistance(state) < 180) return "港口外海";
  return "近岸航路";
}

function tideClass(state) {
  const remaining = LOW_TIDE_SECONDS - state.elapsed;
  if (remaining < 25) return "is-danger";
  if (remaining < 55) return "is-watch";
  return "";
}

function cargoSlots(type, count) {
  return [0, 1].map((index) => (
    `<span class="slot${index < count ? ` is-filled ${type}` : ""}" title="${type === "fuel" ? "燃料" : "电池"} ${index + 1}"></span>`
  )).join("");
}

function renderUI(force = false) {
  const state = game;
  document.body.dataset.gameStatus = state.status;
  document.body.dataset.seed = String(state.seed);
  elements.seedLabel.textContent = state.seed;
  elements.layoutFingerprint.textContent = state.world.fingerprint;
  const level = tideLevel(state.elapsed);
  const remaining = Math.max(0, LOW_TIDE_SECONDS - state.elapsed);
  elements.tideText.textContent = `潮位 ${level.toFixed(2)} m`;
  elements.tideChip.className = `tide-chip ${tideClass(state)}`;
  elements.weatherLabel.textContent = remaining < 22
    ? "落潮临界 · 强流"
    : remaining < 48
      ? "潮势渐急 · 碎浪"
      : remaining < 78
        ? "东南风 · 中浪"
        : "东南风 · 轻浪";
  elements.speedReadout.textContent = `${(Math.abs(state.ship.speed) * 0.12).toFixed(1)} kn`;
  elements.cargoReadout.textContent = `${cargoTotal(state.cargo)} / 4`;
  elements.zoneReadout.textContent = formatZone(state);
  elements.missionBadge.textContent = statusLabel(state);
  elements.missionBadge.className = `mission-badge ${state.status === "failed" ? "is-danger" : state.status === "won" ? "is-success" : ""}`;
  elements.draftLabel.textContent = `吃水 ${shipDraft(state.cargo).toFixed(2)} m`;
  elements.tideCountdown.textContent = formatClock(remaining);
  elements.tideFill.style.width = `${Math.max(4, (level / 2.4) * 100)}%`;
  elements.tideFill.style.opacity = remaining < 26 ? "0.75" : "1";
  elements.tideMarker.style.left = `${(0.6 / 2.4) * 100}%`;

  elements.objectiveList.innerHTML = state.world.mission.targets.map((target) => {
    const done = state.delivered[target.id];
    return `
      <div class="objective${done ? " is-done" : ""}">
        <div class="objective-top">
          <strong>${target.shortName}</strong>
          <span class="objective-status">${done ? "✓ 已补给" : "待补给"}</span>
        </div>
        <div class="objective-items">
          <span class="mini-item fuel">燃料 1</span>
          <span class="mini-item battery">电池 1</span>
        </div>
      </div>`;
  }).join("");
  elements.fuelSlots.innerHTML = cargoSlots("fuel", state.cargo.fuel);
  elements.batterySlots.innerHTML = cargoSlots("battery", state.cargo.battery);

  elements.routeButtons.forEach((button) => {
    const selected = state.route[0] === (button.dataset.route === "east-first" ? "east" : "north");
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = state.status !== "ready";
  });

  const info = dockContext(state);
  if (state.status === "ready") {
    elements.castOffBtn.textContent = "解缆出发";
  } else if (state.status === "paused") {
    elements.castOffBtn.textContent = "继续航行";
  } else if (state.status === "failed") {
    elements.castOffBtn.textContent = "从检查点恢复";
  } else if (state.status === "won") {
    elements.castOffBtn.textContent = "再开一局";
  } else if (info.type === "complete") {
    elements.castOffBtn.textContent = "确认返港";
  } else if (info.type === "island") {
    elements.castOffBtn.textContent = `靠岸 ${info.island.shortName}`;
  } else if (info.type === "wrong-island") {
    elements.castOffBtn.textContent = `${info.island.shortName} · 顺序不符`;
  } else {
    elements.castOffBtn.textContent = "航行中 · 寻找泊位";
  }
  elements.pauseBtn.innerHTML = state.status === "paused" ? "继续 <kbd>P</kbd>" : "暂停 <kbd>P</kbd>";
  elements.loadFuelBtn.disabled = state.status !== "ready" || state.cargo.fuel >= 2 || state.resources.fuel <= 0;
  elements.loadBatteryBtn.disabled = state.status !== "ready" || state.cargo.battery >= 2 || state.resources.battery <= 0;
  elements.loadAllBtn.disabled = state.status !== "ready" || cargoTotal(state.cargo) >= 4;
  elements.failureBtn.disabled = state.status === "won";

  const audit = state.layoutAudit.matched;
  elements.layoutAudit.textContent = audit === true
    ? "固定种子复验：✓ 新局布局一致"
    : audit === false
      ? "固定种子复验：布局不一致"
      : "固定种子复验：重开一次即比对";
  elements.layoutAudit.className = audit === true ? "audit-ok" : audit === false ? "audit-bad" : "";

  elements.logList.innerHTML = state.logs.slice(0, 7).map((entry) => `
    <div class="log-item ${entry.tone || ""}">
      <time>${entry.clock}</time>
      <span>${entry.text}</span>
    </div>
  `).join("");

  if (force) {
    elements.castOffBtn.classList.toggle("is-ready", state.status === "ready" || info.canAct);
  }
}

function miniRouteMarkup(summary) {
  const state = game;
  const points = summary.route.sailedPath;
  const path = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const islands = state.world.islands.map((island) => {
    const done = state.delivered[island.id];
    return `
      <circle cx="${island.x}" cy="${island.y}" r="${done ? 16 : 13}" fill="${done ? "#84d7c7" : "#1c3b3f"}" stroke="${done ? "#d8fff7" : "#f5c45b"}" stroke-width="4"/>
      <text x="${island.x}" y="${island.y + 48}" fill="#d8e9e5" font-size="30" font-weight="700" text-anchor="middle">${island.shortName}</text>`;
  }).join("");
  return `
    <svg class="mini-route" viewBox="0 0 1200 760" role="img" aria-label="本次航行路径">
      <rect width="1200" height="760" rx="18" fill="#08252e"/>
      <path d="M 0 580 C 80 590, 120 660, 130 760" fill="none" stroke="#75694d" stroke-width="8" opacity=".55"/>
      <circle cx="${state.world.home.dock.x}" cy="${state.world.home.dock.y}" r="18" fill="#f5c45b"/>
      <text x="${state.world.home.dock.x}" y="${state.world.home.dock.y + 50}" fill="#f5c45b" font-size="30" font-weight="700" text-anchor="middle">母港</text>
      ${islands}
      <polyline points="${path}" fill="none" stroke="#75e8d3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
      <circle cx="${state.ship.x}" cy="${state.ship.y}" r="12" fill="#fff4cd"/>
    </svg>`;
}

function validationMarkup(summary) {
  const checks = [
    ["目标数量", summary.validation.objectiveCountOk, `${summary.objective.completedTargets}/${summary.objective.expectedTargets}`],
    ["资源守恒", summary.validation.resourceBalanceOk, `余 ${summary.resources.remaining.fuel} 燃料 / ${summary.resources.remaining.battery} 电池`],
    ["用时记录", summary.validation.timeRecorded, summary.timing.elapsedClock],
    ["返港判定", summary.validation.successRequiresReturn, summary.status === "success" ? "已返港" : "未结算"],
    ["布局复验", summary.layoutAudit.sameSeedLayoutVerified, summary.layoutAudit.sameSeedLayoutVerified ? "一致" : "待新局"],
  ];
  return checks.map(([label, ok, value]) => `
    <div class="check-row ${ok ? "is-ok" : "is-pending"}">
      <span>${label}</span>
      <strong>${ok ? "✓" : "·"} ${value}</strong>
    </div>
  `).join("");
}

function summaryMarkup(summary) {
  const failure = summary.failure
    ? `<div class="summary-alert"><span>失败原因</span><strong>${summary.failure.title}</strong><p>${summary.failure.detail}</p></div>`
    : summary.failureHistory.length
      ? `<div class="summary-note">恢复记录：${summary.failureHistory.map((item) => item.title).join(" · ")}</div>`
      : `<div class="summary-note">失败原因：无。全程未触发碰撞、搁浅或落潮失败。</div>`;
  return `
    <div class="summary-grid">
      <div class="summary-stat"><span>目标</span><strong>${summary.objective.completedTargets} / ${summary.objective.expectedTargets}</strong><small>两座灯塔</small></div>
      <div class="summary-stat"><span>剩余资源</span><strong>${summary.resources.remaining.fuel} / ${summary.resources.remaining.battery}</strong><small>燃料 / 电池</small></div>
      <div class="summary-stat"><span>最终用时</span><strong>${summary.timing.elapsedClock}</strong><small>${summary.timing.elapsedSeconds.toFixed(1)} 秒</small></div>
      <div class="summary-stat"><span>检查点恢复</span><strong>${summary.timing.recoveries}</strong><small>碰撞 ${summary.timing.collisions}</small></div>
    </div>
    <div class="summary-route">
      <div class="summary-route-head"><span>航行路径</span><strong>${summary.route.distanceUnits} 单位</strong></div>
      ${miniRouteMarkup(summary)}
    </div>
    ${failure}
    <div class="check-grid">${validationMarkup(summary)}</div>
    <p class="summary-seed">种子 ${summary.seed} · 海图指纹 <code>${summary.layoutFingerprint}</code></p>
  `;
}

function hideOverlay() {
  overlayMode = null;
  elements.overlay.classList.add("is-hidden");
}

function showOverlay({ mode, kicker, title, body, actions = [] }) {
  overlayMode = mode;
  elements.overlayKicker.textContent = kicker;
  elements.overlayTitle.textContent = title;
  elements.overlayBody.innerHTML = body;
  elements.overlayActions.replaceChildren();
  for (const action of actions) {
    const button = document.createElement("button");
    button.className = `btn ${action.primary ? "btn-primary" : "btn-ghost"}`;
    button.textContent = action.label;
    button.addEventListener("click", (event) => {
      flashButton(button, event);
      action.handler();
    });
    elements.overlayActions.append(button);
  }
  elements.overlay.classList.remove("is-hidden");
}

function persistSummary(summary) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
    document.body.dataset.summarySaved = "true";
    document.body.dataset.summaryStatus = summary.status;
  } catch {
    showToast("浏览器拒绝本地存储；可下载 JSON 保存摘要。", "warning");
  }
  window.__tideway.latestSummary = summary;
}

function downloadSummary(summary) {
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tideway-summary-${summary.seed}-${summary.status}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("状态摘要 JSON 已下载。", "success");
}

function openPauseOverlay() {
  showOverlay({
    mode: "pause",
    kicker: "VOYAGE PAUSED",
    title: "潮水仍在退去",
    body: `
      <p>航行计时与船只物理已冻结。检查甲板货舱和靠岸顺序后继续。</p>
      <div class="summary-grid compact-grid">
        <div class="summary-stat"><span>当前用时</span><strong>${formatClock(game.elapsed)}</strong><small>暂停不计时</small></div>
        <div class="summary-stat"><span>甲板载重</span><strong>${cargoTotal(game.cargo)} / 4</strong><small>吃水 ${shipDraft(game.cargo).toFixed(2)} m</small></div>
      </div>
      <p class="summary-note">最近检查点：${game.checkpoint ? `第 ${formatClock(game.checkpoint.elapsed)} 秒` : "母港待命"} · 恢复次数 ${game.recoveries}</p>`,
    actions: [
      { label: "继续航行", primary: true, handler: resumeGame },
      { label: "重开同种子新局", handler: startNewGame },
    ],
  });
}

function openFailureOverlay() {
  const summary = game.summary || buildStateSummary(game);
  const failure = game.failure || summary.failure;
  const checkpoint = game.checkpoint;
  showOverlay({
    mode: "failure",
    kicker: "VOYAGE FAILED · CHECKPOINT READY",
    title: failure?.title || "航行失败",
    body: `
      <p>${failure?.detail || "航行条件已失效。"}</p>
      <div class="summary-alert">
        <span>失败原因</span>
        <strong>${failure?.title || "未知"}</strong>
        <p>${failure?.detail || "无更多信息"}</p>
      </div>
      <div class="summary-grid compact-grid">
        <div class="summary-stat"><span>失败用时</span><strong>${formatClock(game.elapsed)}</strong><small>最终用时</small></div>
        <div class="summary-stat"><span>检查点</span><strong>${checkpoint ? formatClock(checkpoint.elapsed) : "—"}</strong><small>${checkpoint ? `${checkpoint.status === "ready" ? "母港" : "已记录"}快照` : "不可用"}</small></div>
        <div class="summary-stat"><span>完成目标</span><strong>${Object.values(game.delivered).filter(Boolean).length} / 2</strong><small>状态已写入摘要</small></div>
      </div>
      <p class="summary-note">恢复会回到最近检查点的位置、货物、潮位和用时，不需要刷新页面。</p>`,
    actions: [
      { label: "从检查点恢复", primary: true, handler: recoverGame },
      { label: "查看状态摘要", handler: openSummary },
      { label: "重开同种子新局", handler: startNewGame },
    ],
  });
}

function openWinOverlay() {
  const summary = game.summary || buildStateSummary(game);
  showOverlay({
    mode: "win",
    kicker: "SUPPLY COMPLETE · STATE SAVED",
    title: "双塔已亮，补给完成",
    body: summaryMarkup(summary),
    actions: [
      { label: "下载状态摘要", primary: true, handler: () => downloadSummary(summary) },
      { label: "重开同种子新局", handler: startNewGame },
      { label: "关闭查看海图", handler: hideOverlay },
    ],
  });
}

function openSummary() {
  const summary = buildStateSummary(game);
  const final = game.status === "won" || game.status === "failed";
  summaryAutoPaused = !final && game.status === "sailing";
  if (summaryAutoPaused) {
    setPaused(game, true);
    lastStatus = "paused";
  }
  if (final && !game.summary) {
    game.summary = summary;
    persistSummary(summary);
  }
  showOverlay({
    mode: "summary",
    kicker: "STATE SUMMARY",
    title: final ? summary.statusLabel : "航行状态摘要",
    body: summaryMarkup(summary),
    actions: [
      ...(final ? [{ label: "下载 JSON", primary: true, handler: () => downloadSummary(summary) }] : []),
      { label: final ? "返回结算" : "继续航行", primary: !final, handler: () => {
        if (game.status === "won") openWinOverlay();
        else if (game.status === "failed") openFailureOverlay();
        else {
          if (summaryAutoPaused) {
            setPaused(game, false);
            lastStatus = game.status;
            summaryAutoPaused = false;
          }
          hideOverlay();
        }
      } },
    ],
  });
}

function handleStatusTransition(previous, current) {
  if (previous === current) return;
  if (current === "won") {
    game.summary = game.summary || buildStateSummary(game);
    persistSummary(game.summary);
    audio.cue("success");
    window.setTimeout(openWinOverlay, 250);
  } else if (current === "failed") {
    game.summary = game.summary || buildStateSummary(game);
    persistSummary(game.summary);
    audio.cue("failure");
    window.setTimeout(openFailureOverlay, 220);
  } else if ((current === "sailing" || current === "ready") && overlayMode === "pause") {
    hideOverlay();
  }
}

function resumeGame() {
  const result = setPaused(game, false);
  hideOverlay();
  feedback(result, "tap");
}

function recoverGame() {
  const result = recoverFromCheckpoint(game);
  hideOverlay();
  lastStatus = game.status;
  feedback(result, "success");
}

function startNewGame() {
  const previousFingerprint = game.world.fingerprint;
  game = createGame(DEFAULT_SEED, { previousFingerprint });
  persistFingerprint();
  lastStatus = game.status;
  lastDockKey = "";
  clickPulses = [];
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
  hideOverlay();
  renderUI(true);
  const matched = game.layoutAudit.matched;
  showToast(
    matched
      ? "已用同一固定种子重开：布局指纹一致，关键位置未变化。"
      : "新局已开始，但海图指纹不一致，请检查种子配置。",
    matched ? "success" : "warning",
    4200,
  );
  audio.cue(matched ? "success" : "warning");
}

function handleCastOff() {
  ensureAudio();
  let result;
  if (game.status === "failed") {
    result = recoverFromCheckpoint(game);
    hideOverlay();
  } else if (game.status === "won") {
    startNewGame();
    return;
  } else if (game.status === "paused") {
    resumeGame();
    return;
  } else if (game.status === "ready") {
    result = depart(game);
  } else {
    result = dock(game);
  }
  feedback(result, result?.ok ? "dock" : "warning");
}

function togglePause() {
  ensureAudio();
  if (game.status === "won" || game.status === "failed") {
    showToast("结算完成后请重开新局。", "warning");
    audio.cue("warning");
    return;
  }
  if (game.status === "paused") {
    resumeGame();
    return;
  }
  const result = setPaused(game, true);
  lastStatus = game.status;
  feedback(result, "tap");
  openPauseOverlay();
}

function triggerDrill() {
  ensureAudio();
  if (game.status === "won") {
    showToast("任务已完成，失败演练已关闭。", "warning");
    return;
  }
  triggerFailure(game, "drill");
  lastStatus = game.status;
  game.summary = game.summary || buildStateSummary(game);
  persistSummary(game.summary);
  audio.cue("failure");
  openFailureOverlay();
}

function toggleAudio() {
  const currentlyMuted = elements.audioBtn.dataset.muted === "true";
  if (!audio.ready) {
    ensureAudio();
    elements.audioBtn.dataset.muted = "false";
    elements.audioBtn.textContent = "声音：开";
    showToast("音频引擎已启动：引擎声随油门变化。", "success");
    return;
  }
  const muted = !currentlyMuted;
  audio.setMuted(muted);
  elements.audioBtn.dataset.muted = String(muted);
  elements.audioBtn.textContent = muted ? "声音：关" : "声音：开";
  showToast(muted ? "音频已关闭。" : "音频已开启：海况越差，浪声越明显。", muted ? "info" : "success");
  if (!muted) audio.cue("tap");
}

function refreshDockPrompt() {
  if (game.status === "ready") {
    lastDockKey = "";
    return;
  }
  if (game.status !== "sailing") return;
  const info = dockContext(game);
  const key = `${info.type}:${info.island?.id || ""}:${game.nextStop || ""}`;
  if (key === lastDockKey) return;
  lastDockKey = key;
  if (info.type === "island") {
    showToast(`进入${info.island.shortName}泊位范围：按空格卸下 1 燃料 + 1 电池。`, "success");
    audio.cue("dock");
  } else if (info.type === "wrong-island") {
    showToast(`顺序不符：当前应先靠${game.world.islands.find((item) => item.id === game.nextStop)?.shortName}。`, "warning");
    audio.cue("warning");
  } else if (info.type === "complete") {
    showToast("双塔补给已完成。按空格确认返港并结算。", "success");
    audio.cue("success");
  } else if (info.type === "home") {
    showToast("已回到母港，但仍有灯塔未完成补给。", "warning");
    audio.cue("warning");
  }
}

elements.castOffBtn.addEventListener("click", (event) => {
  flashButton(elements.castOffBtn, event);
  handleCastOff();
});

elements.pauseBtn.addEventListener("click", (event) => {
  flashButton(elements.pauseBtn, event);
  togglePause();
});

elements.restartBtn.addEventListener("click", (event) => {
  flashButton(elements.restartBtn, event);
  startNewGame();
});

elements.failureBtn.addEventListener("click", (event) => {
  flashButton(elements.failureBtn, event);
  triggerDrill();
});

elements.audioBtn.addEventListener("click", (event) => {
  flashButton(elements.audioBtn, event);
  toggleAudio();
});

elements.summaryBtn.addEventListener("click", (event) => {
  flashButton(elements.summaryBtn, event);
  ensureAudio();
  audio.cue("tap");
  openSummary();
});

for (const button of [elements.loadFuelBtn, elements.loadBatteryBtn, elements.loadAllBtn]) {
  button.addEventListener("click", (event) => {
    flashButton(button, event);
    ensureAudio();
    const result = loadCargo(game, button.dataset.load);
    feedback(result, result?.ok ? "load" : "warning");
  });
}

for (const button of elements.routeButtons) {
  button.addEventListener("click", (event) => {
    flashButton(button, event);
    ensureAudio();
    const result = setRouteOrder(game, button.dataset.route);
    feedback(result, result?.ok ? "tap" : "warning");
  });
}

function canvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width * WORLD.width,
    y: (event.clientY - rect.top) / rect.height * WORLD.height,
  };
}

elements.canvas.addEventListener("pointerdown", (event) => {
  ensureAudio();
  const point = canvasPoint(event);
  const tone = game.status === "failed" || game.status === "won" ? "warning" : "info";
  clickPulses.push({ x: point.x, y: point.y, start: performance.now() / 1000, duration: 0.8, tone });

  if (game.status === "ready") {
    const clickedIsland = game.world.islands.find((island) => (
      Math.hypot(point.x - island.x, point.y - island.y) < island.radius + 25
    ));
    if (clickedIsland) {
      const order = clickedIsland.id === "east" ? "east-first" : "north-first";
      const result = setRouteOrder(game, order);
      feedback(result, "tap");
      return;
    }
    if (homeDistance({ ship: point, world: game.world }) < 125) {
      showToast("母港泊位：先装齐两舱物资，再点击“解缆出发”。", "info");
      return;
    }
  }

  if (game.status === "sailing") {
    const obstacle = game.world.driftwood.find((log) => (
      Math.hypot(point.x - log.x, point.y - log.y) < log.radius + 12
    ));
    if (obstacle) {
      showToast("参考航点落在漂木上，请绕行。", "warning");
      audio.cue("warning");
      return;
    }
    showToast(`参考航点已标记：${Math.round(point.x)}, ${Math.round(point.y)}（不接管航向）`, "info", 1900);
    audio.cue("tap");
    return;
  }

  if (game.status === "paused") {
    showToast("航行已暂停，点击“继续航行”后恢复。", "info");
  }
});

const movementKeys = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (typing) return;
  if (movementKeys.has(event.code)) {
    event.preventDefault();
    ensureAudio();
    if (game.status !== "sailing" && !event.repeat) {
      const hint = game.status === "ready"
        ? "尚未解缆：装齐物资后点击“解缆出发”。"
        : game.status === "paused"
          ? "航行已暂停，继续后才能操舵。"
          : game.status === "won"
            ? "任务已完成，可按重开开始新局。"
            : "当前航行失败，请从检查点恢复。";
      showToast(hint, "info", 1700);
      audio.cue("tap");
    }
    if (event.code === "KeyW" || event.code === "ArrowUp") keys.up = true;
    if (event.code === "KeyS" || event.code === "ArrowDown") keys.down = true;
    if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = true;
    if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = true;
    return;
  }
  if (event.code === "KeyP") {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === "KeyR") {
    event.preventDefault();
    ensureAudio();
    startNewGame();
    return;
  }
  if (event.code === "KeyM") {
    event.preventDefault();
    toggleAudio();
    return;
  }
  if (event.code === "Space" && !event.repeat) {
    event.preventDefault();
    handleCastOff();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "KeyW" || event.code === "ArrowUp") keys.up = false;
  if (event.code === "KeyS" || event.code === "ArrowDown") keys.down = false;
  if (event.code === "KeyA" || event.code === "ArrowLeft") keys.left = false;
  if (event.code === "KeyD" || event.code === "ArrowRight") keys.right = false;
});

window.addEventListener("blur", () => {
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
});

window.addEventListener("pointerdown", () => ensureAudio(), { once: true });

function animationFrame(now) {
  const delta = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;

  if (game.status === "sailing") {
    const throttle = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    const steering = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    updateGame(game, delta, { throttle, steering });
  }

  handleStatusTransition(lastStatus, game.status);
  lastStatus = game.status;
  clickPulses = clickPulses.filter((pulse) => time - pulse.start < pulse.duration + 0.1);

  if (game.status === "sailing") refreshDockPrompt();
  audio.update(game);
  drawScene(context, game, { time, clickPulses });

  if (now - lastUiTime > 100) {
    lastUiTime = now;
    renderUI();
  }
  requestAnimationFrame(animationFrame);
}

window.__tideway = {
  get state() {
    return game;
  },
  get summary() {
    return game.summary;
  },
  getSummary() {
    return buildStateSummary(game);
  },
  saveSummary() {
    const summary = buildStateSummary(game);
    game.summary = summary;
    persistSummary(summary);
    return summary;
  },
  restart: startNewGame,
  pause: togglePause,
  recover: recoverGame,
  triggerFailure: triggerDrill,
  dock: handleCastOff,
  verifyLayout(seed = DEFAULT_SEED) {
    const first = generateWorld(seed);
    const second = generateWorld(seed);
    return {
      seed,
      first: first.fingerprint,
      second: second.fingerprint,
      matched: first.fingerprint === second.fingerprint,
    };
  },
};

renderUI(true);
showToast("母港待命：先装齐 2 燃料 + 2 电池，再解缆出发。", "info", 4200);
requestAnimationFrame(animationFrame);
