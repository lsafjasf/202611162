import {
  BENCHMARK_SEQUENCE,
  COSTS,
  THRESHOLDS,
  TOTAL_DAYS,
  advance,
  advanceBenchmark,
  createSimulation,
  ecologyMetrics,
  performAction,
  runValidationSuite,
  snapshot,
  statusFor,
  weatherLabel,
} from "./sim.js";
import { PolarAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const scene = $("#scene");
const timeline = $("#timeline");
const sceneContext = scene.getContext("2d");
const timelineContext = timeline.getContext("2d");
const audio = new PolarAudio();
const refs = {
  weatherTag: $("#weatherTag"),
  clockLabel: $("#clockLabel"),
  dayProgress: $("#dayProgress"),
  dayMarker: $("#dayMarker"),
  pauseBtn: $("#pauseBtn"),
  pauseLabel: $("#pauseLabel"),
  speedBtn: $("#speedBtn"),
  sequenceBtn: $("#sequenceBtn"),
  restartBtn: $("#restartBtn"),
  soundBtn: $("#soundBtn"),
  soundIcon: $("#soundIcon"),
  siteCode: $("#siteCode"),
  siteCoords: $("#siteCoords"),
  seedInput: $("#seedInput"),
  loadSeedBtn: $("#loadSeedBtn"),
  sentinelId: $("#sentinelId"),
  sentinelHealth: $("#sentinelHealth"),
  fingerprint: $("#fingerprint"),
  overallStatus: $("#overallStatus"),
  stationTemp: $("#stationTemp"),
  stationBar: $("#stationBar"),
  stationTrend: $("#stationTrend"),
  pipeDisplacement: $("#pipeDisplacement"),
  pipeBar: $("#pipeBar"),
  pipeTrend: $("#pipeTrend"),
  thawDepth: $("#thawDepth"),
  thawBar: $("#thawBar"),
  thawTrend: $("#thawTrend"),
  heatFlux: $("#heatFlux"),
  heatBar: $("#heatBar"),
  pipeLoad: $("#pipeLoad"),
  heatTrend: $("#heatTrend"),
  drainage: $("#drainage"),
  drainageBar: $("#drainageBar"),
  drainageTrend: $("#drainageTrend"),
  initialResourceNote: $("#initialResourceNote"),
  powerValue: $("#powerValue"),
  crewValue: $("#crewValue"),
  probeValue: $("#probeValue"),
  ecologyValue: $("#ecologyValue"),
  ecologyBar: $("#ecologyBar"),
  ecoLabel: $("#ecoLabel"),
  verifySentinel: $("#verifySentinel"),
  verifyWeather: $("#verifyWeather"),
  verifyResources: $("#verifyResources"),
  weatherChip: $("#weatherChip"),
  sceneWeather: $("#sceneWeather"),
  sceneWind: $("#sceneWind"),
  settleRate: $("#settleRate"),
  heatAnomaly: $("#heatAnomaly"),
  coverageValue: $("#coverageValue"),
  timelineStatus: $("#timelineStatus"),
  actionGuide: $("#actionGuide"),
  resultPanel: $("#lastResultPanel"),
  resultStamp: $("#resultStamp"),
  resultIcon: $("#resultIcon"),
  resultTitle: $("#resultTitle"),
  resultDetail: $("#resultDetail"),
  deltaTime: $("#deltaTime"),
  deltaPower: $("#deltaPower"),
  deltaEco: $("#deltaEco"),
  strategyComparison: $("#strategyComparison"),
  eventLog: $("#eventLog"),
  eventCount: $("#eventCount"),
  verifyBtn: $("#verifyBtn"),
  rerunBtn: $("#rerunBtn"),
  toast: $("#toast"),
  modalBackdrop: $("#modalBackdrop"),
  modalKicker: $("#modalKicker"),
  modalTitle: $("#modalTitle"),
  modalIntro: $("#modalIntro"),
  modalContent: $("#modalContent"),
  modalActions: $("#modalActions"),
  modalClose: $("#modalClose"),
  toolPrompt: $("#toolPrompt"),
  sceneWrap: $(".scene-wrap"),
};

const speeds = [1, 4, 8];
const toolCopy = {
  probe: "选择活动层中的位置布设探针。靠近虚线推荐点可提高监测覆盖。",
  cooling: "点击站点地基，启动冷媒回路并提高未来约一周的导冷能力。",
  drainage: "点击管线旁的排水沟，清除淤积并恢复排水效能。",
};
const promptCopy = {
  probe: "点击冻土剖面布设探针",
  cooling: "点击站点基础启动冷却泵",
  drainage: "点击排水沟执行清淤",
};

let state = createSimulation(677);
let validation = null;
let currentSeed = "677";
let paused = false;
let speed = 4;
let selectedTool = null;
let sequenceMode = false;
let samples = [];
let sceneSize = { width: 1, height: 1, dpr: 1 };
let timelineSize = { width: 1, height: 1, dpr: 1 };
let pointer = { x: 0, y: 0, inside: false };
let timelinePointer = null;
let lastFrame = performance.now();
let lastUi = 0;
let settleRate = 0;
let previousMetrics = { ...snapshot(state).metrics };
let outcomeShown = false;
let toastTimer = 0;
let renderedLogSignature = "";
let renderedResult = null;
let simulationAccumulator = 0;

const flakeSeeds = Array.from({ length: 118 }, (_, index) => {
  const x = (index * 0.61803398875 + 0.19) % 1;
  const y = (index * 0.347 + 0.11) % 1;
  return {
    x,
    y,
    speed: 0.08 + ((index * 0.071) % 1) * 0.18,
    drift: -0.06 + ((index * 0.043) % 1) * 0.13,
    size: 0.55 + ((index * 0.11) % 1) * 1.3,
    alpha: 0.18 + ((index * 0.13) % 1) * 0.46,
  };
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[character]));

function dayLabel() {
  const day = Math.min(TOTAL_DAYS, Math.floor(state.day));
  const minute = Math.floor((state.day % 1) * 24 * 60);
  const hour = Math.floor(minute / 60);
  return `D${String(day).padStart(2, "0")} · ${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function showToast(message, error = false) {
  refs.toast.textContent = message;
  refs.toast.classList.toggle("error", error);
  refs.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("show"), 2800);
}

function updateUrlSeed(seed) {
  const url = new URL(window.location.href);
  url.hash = `seed=${encodeURIComponent(seed)}`;
  window.history.replaceState(null, "", url);
}

function recordHistory(force = false) {
  const last = samples.at(-1);
  if (!force && last && state.day - last.day < 0.12) return;
  samples.push({
    day: state.day,
    temp: state.stationTemp,
    pipe: state.pipeDisplacement,
    eco: state.ecology,
  });
  if (samples.length > 720) samples.shift();
}

function renderStrategies() {
  if (!validation) return;
  const { rapid, staged } = validation.strategies;
  refs.strategyComparison.innerHTML = `
    <div class="strategy fast">
      <div class="strategy-head"><span class="strategy-badge">A · 快速</span><strong>${rapid.label}</strong></div>
      <span class="strategy-eco">${rapid.finalEcology.ecology.toFixed(1)}</span>
      <div class="strategy-meta">
        <span>净耗 <b>${rapid.powerUsed.toFixed(0)} kWh</b></span>
        <span>工时 <b>${rapid.crewUsed.toFixed(1)} h</b></span>
        <span>恢复 <b>${rapid.elapsed.toFixed(0)} d</b></span>
      </div>
    </div>
    <div class="strategy">
      <div class="strategy-head"><span class="strategy-badge low">B · 低耗</span><strong>${staged.label}</strong></div>
      <span class="strategy-eco">${staged.finalEcology.ecology.toFixed(1)}</span>
      <div class="strategy-meta">
        <span>净耗 <b>${staged.powerUsed.toFixed(0)} kWh</b></span>
        <span>工时 <b>${staged.crewUsed.toFixed(1)} h</b></span>
        <span>恢复 <b>${staged.elapsed.toFixed(0)} d</b></span>
      </div>
    </div>`;
}

function resetSimulation(seed = currentSeed, options = {}) {
  currentSeed = String(seed).trim() || "677";
  state = createSimulation(currentSeed);
  validation = runValidationSuite(currentSeed);
  samples = [];
  paused = false;
  selectedTool = null;
  sequenceMode = Boolean(options.benchmark);
  speed = options.benchmark ? 8 : 4;
  settleRate = 0;
  outcomeShown = false;
  previousMetrics = { ...snapshot(state).metrics };
  renderedLogSignature = "";
  renderedResult = null;
  simulationAccumulator = 0;
  recordHistory(true);
  refs.seedInput.value = currentSeed;
  refs.initialResourceNote.textContent = `初始 P${state.mission.initialResources.power} · C${state.mission.initialResources.crew}`;
  refs.speedBtn.textContent = `${speed}×`;
  refs.soundIcon.classList.remove("muted");
  renderStrategies();
  clearTool();
  updateUrlSeed(currentSeed);
  updateUI(true);
  if (!options.silent) {
    showToast(options.benchmark
      ? `基准序列启动 · ${state.mission.fingerprint} · 同 seed 九步复现`
      : `同 Seed ${currentSeed} 已重置 · 目标与天气序列未变`);
  }
}

function clearTool() {
  selectedTool = null;
  refs.sceneWrap.classList.remove("is-targeting", "valid");
  $$(".action-card").forEach((card) => card.classList.remove("selected"));
  refs.toolPrompt.classList.remove("valid");
  refs.toolPrompt.querySelector("span:last-child").textContent = "选择右侧干预工具，再点击场景执行";
  pointer = { ...pointer, inside: false };
}

function selectTool(tool) {
  if (state.ended) {
    showToast("模拟已经结束，请重开后继续", true);
    return;
  }
  if (selectedTool === tool) {
    clearTool();
    return;
  }
  selectedTool = tool;
  $$(".action-card").forEach((card) => card.classList.toggle("selected", card.dataset.action === tool));
  refs.sceneWrap.classList.add("is-targeting");
  refs.toolPrompt.querySelector("span:last-child").textContent = promptCopy[tool];
  refs.actionGuide.textContent = toolCopy[tool];
  audio.start();
}

function useTool(tool, point) {
  let payload = {};
  if (tool === "probe") {
    const depth = clamp((point.y - sceneSize.height * 0.23) / (sceneSize.height * 0.62), 0.22, 0.9);
    payload = { point: { x: point.x / sceneSize.width, depth } };
  }
  const result = performAction(state, tool, payload);
  if (result.ok) {
    showToast(`${result.title} · ${result.detail}`);
  } else {
    showToast(result.reason || result.title, true);
  }
  clearTool();
  updateUI(true);
}

function setPaused(next) {
  if (state.ended && !next) return;
  paused = next;
  refs.pauseLabel.textContent = paused ? "继续" : "暂停";
  refs.pauseBtn.classList.toggle("is-active", paused);
}

function resizeCanvas(canvas, context, target) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  target.width = Math.max(1, Math.round(rect.width));
  target.height = Math.max(1, Math.round(rect.height));
  target.dpr = dpr;
  canvas.width = Math.round(target.width * dpr);
  canvas.height = Math.round(target.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeAll() {
  resizeCanvas(scene, sceneContext, sceneSize);
  resizeCanvas(timeline, timelineContext, timelineSize);
}

function numberWithUnit(value, unit, digits = 1) {
  return `${Number(value).toFixed(digits)}<small>${unit}</small>`;
}

function signed(value, digits = 1) {
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}

function updateUI(force = false) {
  const current = snapshot(state);
  const weather = state.weather;
  const status = state.ended ? (state.outcome === "success" ? "steady" : "critical") : statusFor(state);
  const eco = ecologyMetrics(state);

  refs.weatherTag.textContent = weatherLabel(weather);
  refs.clockLabel.textContent = state.ended ? `D90 · 任务结束` : dayLabel();
  const progress = clamp(state.day / TOTAL_DAYS, 0, 1) * 100;
  refs.dayProgress.style.width = `${progress}%`;
  refs.dayMarker.style.left = `${progress}%`;
  refs.sceneWeather.textContent = `${weatherLabel(weather)} · ${weather.temperature.toFixed(1)}°C`;
  refs.sceneWind.textContent = `侧风 ${(weather.wind * 13.4).toFixed(1)} m/s · 日照 ${Math.round(weather.solar * 100)}%`;

  refs.stationTemp.innerHTML = numberWithUnit(current.metrics.stationTemp, "°C", 2);
  refs.stationBar.style.width = `${clamp((current.metrics.stationTemp + 8) / 7.8 * 100, 2, 100)}%`;
  const tempDelta = current.metrics.stationTemp - previousMetrics.stationTemp;
  refs.stationTrend.textContent = Math.abs(tempDelta) < 0.015 ? "稳定" : tempDelta > 0 ? `↑ ${Math.abs(tempDelta).toFixed(2)}°C` : `↓ ${Math.abs(tempDelta).toFixed(2)}°C`;
  $('[data-metric="station"]').classList.toggle("is-critical", current.metrics.stationTemp > THRESHOLDS.stationSafeMax);

  refs.pipeDisplacement.innerHTML = numberWithUnit(current.metrics.pipeDisplacement, "mm", 1);
  refs.pipeBar.style.width = `${clamp(current.metrics.pipeDisplacement / 25 * 100, 2, 100)}%`;
  refs.pipeBar.classList.toggle("is-warning", current.metrics.pipeDisplacement >= THRESHOLDS.pipeWarning);
  const pipeDelta = current.metrics.pipeDisplacement - previousMetrics.pipeDisplacement;
  refs.pipeTrend.textContent = pipeDelta > 0.006 ? `↑ ${pipeDelta.toFixed(2)} mm` : "稳定";
  $('[data-metric="pipe"]').classList.toggle("is-warning", current.metrics.pipeDisplacement >= THRESHOLDS.pipeWarning);
  $('[data-metric="pipe"]').classList.toggle("is-critical", current.metrics.pipeDisplacement > THRESHOLDS.pipeSafe);

  refs.thawDepth.innerHTML = numberWithUnit(current.metrics.thawDepth, "m", 2);
  refs.thawBar.style.width = `${clamp(current.metrics.thawDepth / 3.2 * 100, 2, 100)}%`;
  refs.thawTrend.textContent = current.metrics.thawDepth > THRESHOLDS.thawWarning ? "融深越限" : state.cooldown > 0.12 ? "冷媒抑制" : "冻结线清晰";

  refs.heatFlux.innerHTML = numberWithUnit(current.metrics.heatFlux, "W/m²", 1);
  refs.heatBar.style.width = `${clamp(current.metrics.heatFlux / 45 * 100, 2, 100)}%`;
  refs.pipeLoad.textContent = state.mission.pipeLoad;
  refs.heatTrend.textContent = state.heatFlux > 30 ? "热羽流增强" : "基线热流";

  refs.drainage.innerHTML = numberWithUnit(current.metrics.drainage, "%", 0);
  refs.drainageBar.style.width = `${clamp(current.metrics.drainage, 2, 100)}%`;
  refs.drainageBar.classList.toggle("is-warning", current.metrics.drainage < THRESHOLDS.drainageWarning * 100);
  refs.drainageTrend.textContent = current.metrics.drainage < 35 ? "接近堵塞" : "通畅";

  refs.powerValue.textContent = current.resources.power.toFixed(0);
  refs.crewValue.textContent = current.resources.crew.toFixed(1);
  refs.probeValue.textContent = current.resources.probes;
  refs.ecologyValue.textContent = eco.ecology.toFixed(1);
  refs.ecologyBar.style.width = `${clamp(eco.ecology, 2, 100)}%`;
  refs.ecoLabel.textContent = eco.ecology >= 75 ? "健康" : eco.ecology >= 55 ? "承压" : "退化";
  refs.ecoLabel.className = `eco-label ${eco.ecology < 55 ? "critical" : eco.ecology < 75 ? "warning" : ""}`;

  refs.overallStatus.className = `status-pill ${status}`;
  refs.overallStatus.textContent = state.ended
    ? (state.outcome === "success" ? "任务达成" : "任务失败")
    : status === "steady" ? "稳态" : status === "warning" ? "警戒" : "临界";
  refs.sentinelId.textContent = `${state.mission.sentinel.id} · ${state.mission.sentinel.species}`;
  refs.sentinelHealth.textContent = `${Math.round(eco.sentinelHealth)}%`;
  refs.fingerprint.textContent = state.mission.fingerprint;
  refs.seedInput.value = currentSeed;
  refs.verifySentinel.textContent = state.mission.sentinel.id;
  refs.verifyWeather.textContent = `90d · ${state.mission.fingerprint.slice(-4)}`;
  refs.verifyResources.textContent = `P${state.mission.initialResources.power} / C${state.mission.initialResources.crew}`;
  refs.siteCode.textContent = state.mission.siteCode;
  refs.siteCoords.textContent = `${state.mission.latitude.toFixed(2)}°N · ${state.mission.longitude.toFixed(2)}°E`;

  refs.settleRate.innerHTML = `${settleRate.toFixed(2)} <small>mm/d</small>`;
  refs.settleRate.className = settleRate > 0.3 ? "critical" : settleRate > 0.15 ? "warning" : "";
  refs.heatAnomaly.innerHTML = `${signed((state.heatFlux - 22) / 5.2, 1)} <small>σ</small>`;
  refs.heatAnomaly.className = state.heatFlux > 30 ? "warning" : "";
  refs.coverageValue.innerHTML = `${current.metrics.probeCoverage} <small>%</small>`;

  const speedLabel = state.ended ? "结束" : sequenceMode ? `序列 ${state.sequenceIndex}/${BENCHMARK_SEQUENCE.length}` : `${speed}×`;
  refs.speedBtn.textContent = speedLabel;
  refs.pauseLabel.textContent = state.ended ? "已完成" : paused ? "继续" : "暂停";
  refs.pauseBtn.classList.toggle("is-active", paused && !state.ended);
  refs.sequenceBtn.classList.toggle("is-active", sequenceMode && !state.ended);
  refs.timelineStatus.className = `timeline-status ${state.ended ? "done" : status}`;
  refs.timelineStatus.textContent = state.ended
    ? `第 90 天结束 · ${state.outcome === "success" ? "安全" : "越限"}`
    : sequenceMode
      ? `固定序列 · 已执行 ${state.sequenceIndex}/${BENCHMARK_SEQUENCE.length} 步`
      : status === "steady" ? "运行中 · 无越限" : status === "warning" ? "运行中 · 阈值逼近" : "运行中 · 需要干预";

  renderLastResult();
  renderEventLog();
  updateActionCards();
  previousMetrics = { ...current.metrics };

  if (state.ended && !outcomeShown) {
    outcomeShown = true;
    window.setTimeout(showOutcomeModal, 420);
  }
}

function updateActionCards() {
  $$(".action-card").forEach((card) => {
    const cost = COSTS[card.dataset.action];
    const unavailable = state.resources.power < cost.power || state.resources.crew < cost.crew
      || (cost.probes && state.resources.probes < cost.probes);
    card.classList.toggle("unavailable", unavailable);
    card.title = unavailable ? "资源不足；尝试操作可查看失败判定" : "";
  });
}

function renderLastResult() {
  const result = state.lastOp;
  if (!result) {
    refs.resultPanel.classList.add("empty");
    refs.resultStamp.textContent = "等待";
    refs.resultIcon.textContent = "·";
    refs.resultIcon.className = "result-icon";
    refs.resultTitle.textContent = "尚无操作记录";
    refs.resultDetail.textContent = "布设探针、启动冷却或清理排水沟后，这里会记录结果与资源变化。";
    refs.deltaTime.textContent = "—";
    refs.deltaPower.textContent = "—";
    refs.deltaEco.textContent = "—";
    return;
  }
  if (renderedResult === result) return;
  renderedResult = result;
  refs.resultPanel.classList.remove("empty");
  refs.resultStamp.textContent = result.before ? `D${result.before.day.toFixed(1)}` : "判定";
  refs.resultIcon.textContent = result.ok ? "✓" : "!";
  refs.resultIcon.className = `result-icon${result.ok ? "" : " fail"}`;
  refs.resultTitle.textContent = result.title;
  refs.resultDetail.textContent = result.ok
    ? `${result.detail} · 触发：${result.trigger}`
    : result.reason;
  if (result.before && result.after) {
    refs.deltaTime.textContent = `+${(result.elapsed ?? 0).toFixed(2)} d`;
    const power = result.after.resources.power - result.before.resources.power;
    const ecoDelta = result.after.ecology - result.before.ecology;
    refs.deltaPower.textContent = `${signed(power, 1)} kWh`;
    refs.deltaEco.textContent = `${signed(ecoDelta, 1)} ECO`;
    refs.deltaPower.className = power < -0.05 ? "negative" : power > 0.05 ? "positive" : "";
    refs.deltaEco.className = ecoDelta < -0.05 ? "negative" : ecoDelta > 0.05 ? "positive" : "";
  }
}

function renderEventLog() {
  const logs = state.logs.slice(0, 8);
  const signature = logs.map((entry) => entry.id).join("|");
  refs.eventCount.textContent = String(state.logs.length).padStart(2, "0");
  if (signature === renderedLogSignature) return;
  renderedLogSignature = signature;
  refs.eventLog.innerHTML = logs.map((entry) => `
    <div class="event-item ${entry.kind}">
      <span class="event-day">D${String(Math.floor(entry.day)).padStart(2, "0")}</span>
      <div class="event-copy">
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.detail)}</span>
      </div>
    </div>`).join("");
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function thawYAt(x, width, height, surface) {
  const base = surface + height * (0.115 + state.thawDepth * 0.068);
  return base + Math.sin((x / width) * Math.PI * 2.2 + 0.8) * height * 0.009;
}

function sceneGroundY() {
  return sceneSize.height * 0.23;
}

function drawSky(context, width, height, surface, time) {
  const sky = context.createLinearGradient(0, 0, 0, surface);
  sky.addColorStop(0, "#06151f");
  sky.addColorStop(0.55, "#0b2530");
  sky.addColorStop(1, "#173942");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, surface + 2);

  const horizon = context.createRadialGradient(width * 0.53, surface, 0, width * 0.53, surface, width * 0.62);
  horizon.addColorStop(0, "rgba(84, 169, 165, 0.18)");
  horizon.addColorStop(0.5, "rgba(44, 102, 120, 0.06)");
  horizon.addColorStop(1, "rgba(3, 12, 18, 0)");
  context.fillStyle = horizon;
  context.fillRect(0, 0, width, surface);

  context.save();
  context.globalCompositeOperation = "screen";
  for (let band = 0; band < 3; band += 1) {
    const y = surface * (0.22 + band * 0.13) + Math.sin(time * 0.12 + band) * 6;
    const aurora = context.createLinearGradient(0, y, width, y + height * 0.08);
    aurora.addColorStop(0, "rgba(74, 210, 176, 0)");
    aurora.addColorStop(0.36, `rgba(76, 220, 187, ${0.045 - band * 0.009})`);
    aurora.addColorStop(0.68, `rgba(105, 159, 226, ${0.036 - band * 0.006})`);
    aurora.addColorStop(1, "rgba(75, 176, 197, 0)");
    context.fillStyle = aurora;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= width; x += width / 24) {
      context.lineTo(x, y + Math.sin(x / width * Math.PI * 3.2 + band + time * 0.08) * height * 0.026);
    }
    context.lineTo(width, y + height * 0.12);
    context.lineTo(0, y + height * 0.12);
    context.closePath();
    context.fill();
  }
  context.restore();

  context.fillStyle = "rgba(220, 245, 244, 0.42)";
  for (let index = 0; index < 28; index += 1) {
    const x = ((index * 0.379 + 0.071) % 1) * width;
    const y = (0.03 + ((index * 0.197) % 1) * 0.15) * height;
    const twinkle = 0.35 + 0.3 * Math.sin(time * 0.5 + index);
    context.globalAlpha = twinkle;
    context.fillRect(x, y, index % 4 === 0 ? 1.3 : 0.7, index % 4 === 0 ? 1.3 : 0.7);
  }
  context.globalAlpha = 1;

  const farHills = context.createLinearGradient(0, surface - 55, 0, surface);
  farHills.addColorStop(0, "rgba(25, 55, 67, 0)");
  farHills.addColorStop(1, "rgba(25, 55, 67, 0.75)");
  context.fillStyle = farHills;
  context.beginPath();
  context.moveTo(0, surface);
  context.lineTo(0, surface - height * 0.01);
  for (let x = 0; x <= width; x += width / 16) {
    const y = surface - height * (0.015 + Math.abs(Math.sin(x / width * Math.PI * 2.5 + 0.7)) * 0.055);
    context.lineTo(x, y);
  }
  context.lineTo(width, surface);
  context.closePath();
  context.fill();
}

function drawSnowfall(context, width, height, surface, time, weather) {
  const intensity = 10 + Math.round(weather.snow * (flakesVisible()));
  context.save();
  for (let index = 0; index < intensity; index += 1) {
    const flake = flakeSeeds[index];
    const fallSpeed = flake.speed * (0.45 + weather.snow * 1.1);
    const y = ((flake.y + time * fallSpeed) % 1) * (surface + 12);
    const x = ((flake.x + time * flake.drift * (0.4 + weather.wind) + Math.sin(time * 0.7 + index) * 0.008) % 1 + 1) % 1;
    context.globalAlpha = flake.alpha * clamp(weather.snow + 0.2, 0.2, 1);
    context.fillStyle = "#d8f1f4";
    context.beginPath();
    context.arc(x * width, y, flake.size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 0.1 + weather.wind * 0.08;
  context.strokeStyle = "#bfe3e7";
  context.lineWidth = 0.7;
  for (let index = 0; index < 5; index += 1) {
    const y = surface * (0.26 + index * 0.12);
    const offset = ((time * (10 + weather.wind * 30) + index * 79) % (width + 160)) - 80;
    context.beginPath();
    context.moveTo(offset - 70, y);
    context.lineTo(offset, y + 9);
    context.stroke();
  }
  context.restore();
}

function flakesVisible() {
  return 76;
}

function drawGround(context, width, height, surface) {
  const soil = context.createLinearGradient(0, surface, 0, height);
  soil.addColorStop(0, "#263f43");
  soil.addColorStop(0.2, "#20383e");
  soil.addColorStop(0.54, "#18313a");
  soil.addColorStop(1, "#0d222b");
  context.fillStyle = soil;
  context.beginPath();
  context.moveTo(0, surface);
  for (let x = 0; x <= width; x += 10) {
    context.lineTo(x, surface + Math.sin(x / width * Math.PI * 3.1) * 1.8);
  }
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fill();

  const active = context.createLinearGradient(0, surface, 0, height * 0.46);
  active.addColorStop(0, "rgba(85, 100, 91, 0.23)");
  active.addColorStop(0.55, "rgba(111, 83, 61, 0.08)");
  active.addColorStop(1, "rgba(26, 53, 56, 0)");
  context.fillStyle = active;
  context.fillRect(0, surface, width, height * 0.28);

  context.save();
  context.strokeStyle = "rgba(170, 199, 192, 0.07)";
  context.lineWidth = 0.7;
  for (let y = surface + 26; y < height; y += 28) {
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= width; x += width / 12) {
      context.lineTo(x, y + Math.sin(x / width * Math.PI * 2 + y) * 3);
    }
    context.stroke();
  }
  context.fillStyle = "rgba(185, 217, 210, 0.13)";
  for (let index = 0; index < 68; index += 1) {
    const x = ((index * 0.381 + 0.047) % 1) * width;
    const y = surface + 25 + ((index * 0.271) % 1) * (height - surface - 30);
    const radius = 0.4 + (index % 3) * 0.35;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  context.save();
  context.fillStyle = "rgba(160, 218, 226, 0.06)";
  context.strokeStyle = "rgba(162, 224, 230, 0.1)";
  context.lineWidth = 1;
  for (let index = 0; index < 8; index += 1) {
    const x = width * (0.1 + index * 0.115);
    const top = height * (0.64 + (index % 3) * 0.04);
    context.beginPath();
    context.moveTo(x - width * 0.018, top);
    context.lineTo(x, top - height * 0.07);
    context.lineTo(x + width * 0.025, top + height * 0.04);
    context.lineTo(x + width * 0.005, top + height * 0.11);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawThawBoundary(context, width, height, surface) {
  const path = new Path2D();
  path.moveTo(0, thawYAt(0, width, height, surface));
  for (let x = 0; x <= width; x += 8) {
    path.lineTo(x, thawYAt(x, width, height, surface));
  }
  path.lineTo(width, surface);
  path.lineTo(0, surface);
  path.closePath();
  const melt = context.createLinearGradient(0, surface, 0, thawYAt(width, width, height, surface));
  melt.addColorStop(0, "rgba(122, 112, 86, 0.2)");
  melt.addColorStop(0.75, "rgba(167, 104, 66, 0.12)");
  melt.addColorStop(1, "rgba(232, 137, 79, 0.12)");
  context.fillStyle = melt;
  context.fill(path);

  context.save();
  context.strokeStyle = "rgba(235, 158, 99, 0.46)";
  context.lineWidth = 1.2;
  context.setLineDash([5, 5]);
  context.beginPath();
  for (let x = 0; x <= width; x += 8) {
    const y = thawYAt(x, width, height, surface);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.setLineDash([]);
  const labelX = width * 0.79;
  const labelY = thawYAt(labelX, width, height, surface) - 7;
  context.fillStyle = "rgba(239, 183, 122, 0.74)";
  context.font = "7px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText(`融化锋 ${state.thawDepth.toFixed(2)} m`, labelX, labelY);
  context.restore();
}

function drawHeatFields(context, width, height, surface) {
  const heat = clamp((state.heatFlux - 14) / 32, 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(state.day * 0.9);
  context.save();
  context.beginPath();
  context.rect(0, surface, width, height - surface);
  context.clip();

  const centers = [
    [width * 0.34, height * 0.43, 1.05],
    [width * 0.55, height * 0.44, 1.24],
    [width * 0.74, height * 0.43, 1.16],
    [width * 0.91, height * 0.42, 0.82],
    [width * 0.12, height * 0.46, 0.7],
  ];
  context.globalCompositeOperation = "screen";
  for (const [x, y, scale] of centers) {
    const radius = height * (0.1 + heat * 0.13) * scale;
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(255, 157, 81, ${0.1 + heat * 0.15})`);
    glow.addColorStop(0.32, `rgba(242, 123, 66, ${0.055 + heat * 0.085})`);
    glow.addColorStop(0.7, `rgba(204, 101, 73, ${0.02 + heat * 0.03})`);
    glow.addColorStop(1, "rgba(200, 83, 60, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.ellipse(x, y, radius, radius * 0.72, 0, 0, Math.PI * 2);
    context.fill();
  }

  const plume = context.createLinearGradient(0, height * 0.35, 0, height * 0.66);
  plume.addColorStop(0, `rgba(255, 170, 95, ${0.08 + heat * 0.08})`);
  plume.addColorStop(0.45, `rgba(242, 121, 64, ${0.035 + heat * 0.035})`);
  plume.addColorStop(1, "rgba(220, 95, 58, 0)");
  context.fillStyle = plume;
  for (let index = 0; index < 7; index += 1) {
    const x = width * (0.28 + index * 0.1);
    context.beginPath();
    context.ellipse(x, height * 0.46, width * 0.035, height * 0.14, -0.08, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = `rgba(255, 186, 113, ${0.13 + heat * 0.1})`;
  context.lineWidth = 1;
  for (let index = 0; index < 6; index += 1) {
    const x = width * (0.34 + index * 0.1) + Math.sin(state.day * 0.8 + index) * 4;
    context.beginPath();
    context.moveTo(x, height * 0.39);
    context.bezierCurveTo(
      x - 7, height * 0.44,
      x + 8 + pulse * 3, height * 0.5,
      x - 2, height * 0.55,
    );
    context.stroke();
  }
  context.restore();
}

function drawDrainage(context, width, height, surface) {
  const center = width * 0.79;
  const halfWidth = width * 0.058;
  const depth = height * 0.13;
  const waterY = surface + depth * (0.68 - state.drainage * 0.28);
  context.save();

  context.fillStyle = "rgba(2, 11, 15, 0.62)";
  context.beginPath();
  context.moveTo(center - halfWidth, surface - 1);
  context.lineTo(center - halfWidth * 0.58, surface + depth);
  context.lineTo(center + halfWidth * 0.58, surface + depth);
  context.lineTo(center + halfWidth, surface - 1);
  context.closePath();
  context.fill();

  const water = context.createLinearGradient(0, waterY, 0, surface + depth);
  water.addColorStop(0, "#3a7e82");
  water.addColorStop(1, "#123f4a");
  context.fillStyle = water;
  context.beginPath();
  context.moveTo(center - halfWidth * 0.83, waterY);
  context.quadraticCurveTo(center, waterY + 2.8, center + halfWidth * 0.84, waterY);
  context.lineTo(center + halfWidth * 0.55, surface + depth - 1);
  context.lineTo(center - halfWidth * 0.56, surface + depth - 1);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(136, 231, 221, 0.45)";
  context.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    const waveY = waterY + 5 + index * 7;
    context.beginPath();
    context.moveTo(center - halfWidth * 0.59, waveY);
    context.quadraticCurveTo(center - 2, waveY + Math.sin(state.day + index) * 1.5, center + halfWidth * 0.52, waveY);
    context.stroke();
  }

  context.fillStyle = "rgba(187, 225, 225, 0.5)";
  const iceCount = Math.round(3 + (1 - state.drainage) * 7);
  for (let index = 0; index < iceCount; index += 1) {
    const x = center - halfWidth * 0.47 + ((index * 0.29) % 1) * halfWidth * 0.9;
    const y = waterY - 2 - (index % 3) * 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 4.5, y + 1.7);
    context.lineTo(x + 2.8, y + 3.5);
    context.closePath();
    context.fill();
  }

  context.strokeStyle = "rgba(192, 224, 220, 0.32)";
  context.lineWidth = 0.8;
  context.setLineDash([2, 3]);
  context.beginPath();
  context.moveTo(center - halfWidth - 4, surface);
  context.lineTo(center - halfWidth * 0.62, surface + depth + 4);
  context.moveTo(center + halfWidth + 4, surface);
  context.lineTo(center + halfWidth * 0.62, surface + depth + 4);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = "rgba(117, 217, 210, 0.62)";
  context.font = "7px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText(`排水 ${Math.round(state.drainage * 100)}%`, center - 20, surface + depth + 13);

  if (selectedTool === "drainage") {
    const alpha = 0.25 + 0.28 * (0.5 + 0.5 * Math.sin(state.day * 5));
    context.strokeStyle = `rgba(116, 223, 208, ${alpha})`;
    context.lineWidth = 1.2;
    roundedRect(context, center - halfWidth - 8, surface - 5, halfWidth * 2 + 16, depth + 21, 7);
    context.stroke();
  }
  context.restore();
}

function drawStation(context, width, height, surface) {
  const x = width * 0.052;
  const y = height * 0.085;
  const w = width * 0.145;
  const h = height * 0.105;
  const ground = surface + height * 0.015;
  context.save();

  context.strokeStyle = "rgba(165, 208, 210, 0.25)";
  context.lineWidth = 2;
  const legs = [x + w * 0.15, x + w * 0.47, x + w * 0.82];
  for (const legX of legs) {
    context.beginPath();
    context.moveTo(legX, y + h);
    context.lineTo(legX, height * 0.515);
    context.stroke();
    context.strokeStyle = "rgba(165, 208, 210, 0.13)";
    context.beginPath();
    context.moveTo(legX - 8, height * 0.512);
    context.lineTo(legX + 8, height * 0.512);
    context.stroke();
    context.strokeStyle = "rgba(165, 208, 210, 0.25)";
  }

  const building = context.createLinearGradient(x, y, x, y + h);
  building.addColorStop(0, "#37535a");
  building.addColorStop(1, "#182f37");
  context.fillStyle = building;
  roundedRect(context, x, y, w, h, 4);
  context.fill();
  context.strokeStyle = "rgba(183, 222, 222, 0.24)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = "#0b2029";
  context.beginPath();
  context.moveTo(x - 6, y + 2);
  context.lineTo(x + w * 0.48, y - height * 0.035);
  context.lineTo(x + w + 6, y + 2);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(188, 232, 231, 0.24)";
  context.stroke();

  const windowGlow = context.createLinearGradient(x, y, x, y + h);
  windowGlow.addColorStop(0, "#e9c77e");
  windowGlow.addColorStop(1, "#9f7845");
  context.fillStyle = windowGlow;
  for (let index = 0; index < 3; index += 1) {
    roundedRect(context, x + 9 + index * w * 0.25, y + h * 0.38, w * 0.13, h * 0.25, 1);
    context.fill();
  }
  context.fillStyle = "rgba(212, 240, 236, 0.58)";
  context.fillRect(x, y + h * 0.12, w, 1.2);
  context.fillRect(x, y + h * 0.17, w, 0.7);

  context.strokeStyle = "rgba(187, 226, 228, 0.5)";
  context.beginPath();
  context.moveTo(x + w * 0.73, y - 5);
  context.lineTo(x + w * 0.73, y - h * 0.38);
  context.stroke();
  context.fillStyle = state.cooldown > 0.1 ? "#74dfd0" : "#bd805f";
  context.beginPath();
  context.arc(x + w * 0.73, y - h * 0.4, 1.8, 0, Math.PI * 2);
  context.fill();

  const pumpX = x + w + 10;
  const pumpY = surface - height * 0.055;
  roundedRect(context, pumpX, pumpY, width * 0.04, height * 0.052, 3);
  context.fillStyle = "rgba(19, 42, 49, 0.92)";
  context.fill();
  context.strokeStyle = "rgba(116, 223, 208, 0.25)";
  context.stroke();
  const pumping = state.cooldown > 0.06;
  context.fillStyle = pumping ? "#74dfd0" : "#886f56";
  context.beginPath();
  context.arc(pumpX + width * 0.013, pumpY + height * 0.022, 2.2 + (pumping ? Math.sin(state.day * 12) * 0.5 : 0), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(195, 226, 225, 0.54)";
  context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText("PUMP", pumpX + 2, pumpY - 4);

  const coolAlpha = 0.1 + state.cooldown * 0.52;
  context.strokeStyle = `rgba(116, 223, 208, ${coolAlpha})`;
  context.lineWidth = 1.1;
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(pumpX + width * 0.02, pumpY + height * 0.05);
  context.lineTo(x + w * 0.82, height * 0.33);
  context.lineTo(x + w * 0.82, height * 0.5);
  context.lineTo(x + w * 0.47, height * 0.5);
  context.lineTo(x + w * 0.47, height * 0.34);
  context.lineTo(x + w * 0.15, height * 0.5);
  context.lineTo(x + w * 0.15, height * 0.33);
  context.stroke();
  context.setLineDash([]);

  if (pumping) {
    for (let index = 0; index < 4; index += 1) {
      const phase = (state.day * 1.8 + index * 0.25) % 1;
      const dotY = height * (0.34 + phase * 0.15);
      context.fillStyle = `rgba(166, 246, 235, ${0.35 + (1 - phase) * 0.45})`;
      context.beginPath();
      context.arc(x + w * 0.47, dotY, 1.6, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.fillStyle = "rgba(205, 236, 234, 0.63)";
  context.font = "7px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText("STATION 04", x + 2, y + h + 12);
  context.fillStyle = "rgba(109, 148, 151, 0.54)";
  context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText(`${state.stationTemp.toFixed(1)}°C / FOUNDATION`, x + 2, y + h + 21);

  if (selectedTool === "cooling") {
    const alpha = 0.24 + 0.25 * (0.5 + 0.5 * Math.sin(state.day * 5));
    context.strokeStyle = `rgba(116, 223, 208, ${alpha})`;
    context.setLineDash([5, 4]);
    roundedRect(context, x - 10, y - 15, w + 25, height * 0.62, 9);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function drawSnowCap(context, width, height, surface) {
  context.save();
  context.fillStyle = "rgba(211, 235, 234, 0.76)";
  context.beginPath();
  context.moveTo(0, surface);
  for (let x = 0; x <= width; x += 8) {
    const depth = 1.6 + Math.sin(x / width * Math.PI * 5.1 + 0.3) * 1.8;
    context.lineTo(x, surface + depth);
  }
  context.lineTo(width, surface + 8);
  context.lineTo(0, surface + 8);
  context.closePath();
  context.fill();
  context.fillStyle = "rgba(235, 248, 246, 0.3)";
  context.beginPath();
  context.moveTo(0, surface);
  for (let x = 0; x <= width; x += 8) {
    const drift = 0.5 + Math.sin(x / width * Math.PI * 4.4 + 1.2) * 1.4;
    context.lineTo(x, surface - drift);
  }
  context.lineTo(width, surface);
  context.closePath();
  context.fill();
  context.restore();
}

function drawPipeline(context, width, height, surface) {
  const x0 = width * 0.225;
  const x1 = width * 0.948;
  const baseY = height * 0.37;
  const shift = clamp(state.pipeDisplacement / THRESHOLDS.pipeSafe, 0, 1.6) * height * 0.014;
  const pipeY = baseY + shift;
  const radius = clamp(height * 0.028, 11, 18);
  const critical = state.pipeDisplacement > THRESHOLDS.pipeSafe;
  const warning = state.pipeDisplacement >= THRESHOLDS.pipeWarning;
  const supports = [0.29, 0.41, 0.53, 0.66, 0.89].map((value) => width * value);
  context.save();

  context.strokeStyle = "rgba(194, 216, 212, 0.16)";
  context.lineWidth = 2;
  for (const supportX of supports) {
    context.beginPath();
    context.moveTo(supportX - 9, pipeY + radius);
    context.lineTo(supportX, height * 0.525);
    context.moveTo(supportX + 9, pipeY + radius);
    context.lineTo(supportX, height * 0.525);
    context.stroke();
    context.fillStyle = "rgba(179, 213, 210, 0.12)";
    context.beginPath();
    context.ellipse(supportX, height * 0.528, 12, 3, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "rgba(255, 198, 132, 0.18)";
  context.setLineDash([4, 5]);
  context.beginPath();
  context.moveTo(x0, baseY);
  context.lineTo(x1, baseY);
  context.stroke();
  context.setLineDash([]);

  const body = context.createLinearGradient(0, pipeY - radius, 0, pipeY + radius);
  body.addColorStop(0, "#5f7c80");
  body.addColorStop(0.22, "#adc1bd");
  body.addColorStop(0.48, "#435f64");
  body.addColorStop(0.78, "#263f47");
  body.addColorStop(1, "#192f39");
  roundedRect(context, x0, pipeY - radius, x1 - x0, radius * 2, radius);
  context.fillStyle = body;
  context.fill();
  context.strokeStyle = critical ? "rgba(255, 113, 100, 0.72)" : warning ? "rgba(247, 191, 104, 0.55)" : "rgba(198, 228, 225, 0.3)";
  context.lineWidth = 1;
  context.stroke();

  context.strokeStyle = "rgba(230, 248, 245, 0.36)";
  context.beginPath();
  context.moveTo(x0 + radius * 1.4, pipeY - radius * 0.48);
  context.lineTo(x1 - radius * 1.6, pipeY - radius * 0.48);
  context.stroke();

  for (let index = 0; index < 7; index += 1) {
    const jointX = x0 + (x1 - x0) * (0.12 + index * 0.13);
    context.strokeStyle = "rgba(9, 24, 29, 0.38)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(jointX, pipeY - radius + 2);
    context.lineTo(jointX, pipeY + radius - 2);
    context.stroke();
  }

  const warmGlow = context.createLinearGradient(0, pipeY + radius * 0.2, 0, pipeY + radius + height * 0.08);
  warmGlow.addColorStop(0, `rgba(255, 167, 91, ${0.15 + clamp(state.heatFlux / 80, 0, 0.4)})`);
  warmGlow.addColorStop(1, "rgba(255, 140, 75, 0)");
  context.fillStyle = warmGlow;
  context.fillRect(x0, pipeY + radius * 0.1, x1 - x0, height * 0.1);

  context.fillStyle = "rgba(255, 226, 193, 0.7)";
  context.font = "7px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText(`PIPE LOAD ${state.mission.pipeLoad} t/seg`, x0 + 4, pipeY - radius - 7);
  context.fillStyle = critical ? "rgba(255, 132, 121, 0.82)" : warning ? "rgba(247, 191, 104, 0.82)" : "rgba(140, 187, 187, 0.7)";
  context.fillText(`Δ ${state.pipeDisplacement.toFixed(1)} mm`, x1 - 58, pipeY - radius - 7);

  for (const weightX of [0.49, 0.68, 0.85]) {
    const x = width * weightX;
    const weight = Math.max(1, state.mission.pipeLoad / 20);
    context.strokeStyle = "rgba(247, 191, 104, 0.42)";
    context.fillStyle = "rgba(247, 191, 104, 0.42)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, pipeY - radius - 17);
    context.lineTo(x, pipeY - radius - 4);
    context.stroke();
    context.beginPath();
    context.moveTo(x - 3, pipeY - radius - 8);
    context.lineTo(x, pipeY - radius - 3);
    context.lineTo(x + 3, pipeY - radius - 8);
    context.closePath();
    context.fill();
    context.font = "5.5px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    context.fillText(`${weight.toFixed(0)}↓`, x + 5, pipeY - radius - 10);
  }

  if (critical || warning) {
    const alpha = 0.2 + 0.2 * (0.5 + 0.5 * Math.sin(state.day * 6));
    context.strokeStyle = critical ? `rgba(255, 113, 100, ${alpha})` : `rgba(247, 191, 104, ${alpha})`;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x0, pipeY + radius + 4);
    context.lineTo(x1, pipeY + radius + 4);
    context.stroke();
  }
  context.restore();
}

function hotspotPoint(hotspot, width, height, surface) {
  return {
    x: hotspot.x * width,
    y: surface + hotspot.depth * height * 0.62,
  };
}

function drawProbes(context, width, height, surface) {
  context.save();
  const targetAlpha = selectedTool === "probe" ? 0.62 : 0.28;
  for (const hotspot of state.mission.hotspots) {
    const point = hotspotPoint(hotspot, width, height, surface);
    context.strokeStyle = `rgba(157, 231, 220, ${targetAlpha})`;
    context.fillStyle = `rgba(157, 231, 220, ${targetAlpha * 0.75})`;
    context.lineWidth = 0.8;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(point.x, surface + 3);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.stroke();
    context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    context.fillText(`${hotspot.id} 推荐`, point.x + 10, point.y + 2);
  }

  const depths = [0.38, 0.5, 0.62];
  for (const probe of state.probes) {
    const point = {
      x: probe.x * width,
      y: surface + probe.depth * height * 0.62,
    };
    const depthIndex = state.probes.indexOf(probe) % depths.length;
    const sensorY = gestureProbeY(point, depths[depthIndex], height, surface);
    context.strokeStyle = "rgba(116, 223, 208, 0.62)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(point.x, surface + 4);
    context.lineTo(point.x, sensorY);
    context.stroke();
    context.fillStyle = "rgba(10, 28, 34, 0.95)";
    roundedRect(context, point.x - 5, surface - 10, 10, 12, 2);
    context.fill();
    context.strokeStyle = "rgba(116, 223, 208, 0.5)";
    context.stroke();
    context.fillStyle = "#74dfd0";
    context.beginPath();
    context.arc(point.x, sensorY, 2.8, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(116, 223, 208, 0.24)";
    context.beginPath();
    context.arc(point.x, sensorY, 6, 0, Math.PI * 2);
    context.stroke();
    context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    context.fillText(`${probe.id} ${probe.onTarget ? "●" : "○"}`, point.x + 6, sensorY - 5);
  }
  context.restore();
}

function gestureProbeY(point, ratio, height, surface) {
  return point.y + (height * 0.12) * ratio;
}

function drawSceneLabels(context, width, height, surface) {
  context.save();
  context.fillStyle = "rgba(169, 202, 203, 0.35)";
  context.font = "6.5px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText("ACTIVE LAYER / 活动层", width * 0.04, surface + height * 0.11);
  context.fillStyle = "rgba(148, 193, 204, 0.34)";
  context.fillText("PERMAFROST / 永久冻土", width * 0.11, height * 0.79);
  context.fillText("ICE-RICH SILT", width * 0.11, height * 0.79 + 11);

  context.strokeStyle = "rgba(170, 206, 207, 0.16)";
  context.fillStyle = "rgba(170, 206, 207, 0.35)";
  context.lineWidth = 0.7;
  for (let index = 0; index < 4; index += 1) {
    const y = surface + index * height * 0.16;
    context.beginPath();
    context.moveTo(4, y);
    context.lineTo(10, y);
    context.stroke();
    context.fillText(`${index * 0.8}m`, 12, y + 2);
  }
  context.restore();
}

function toolHit(tool, point) {
  const width = sceneSize.width;
  const height = sceneSize.height;
  const surface = sceneGroundY();
  if (tool === "probe") {
    return point.y > surface + 6 && point.y < height * 0.93 && point.x > width * 0.2 && point.x < width * 0.96;
  }
  if (tool === "cooling") {
    return point.x > width * 0.025 && point.x < width * 0.27
      && point.y > height * 0.06 && point.y < height * 0.62;
  }
  if (tool === "drainage") {
    return point.x > width * 0.71 && point.x < width * 0.86
      && point.y > surface - 10 && point.y < height * 0.5;
  }
  return false;
}

function drawToolCursor(context, width, height, surface) {
  if (!selectedTool || !pointer.inside) return;
  const valid = toolHit(selectedTool, pointer);
  const color = valid ? "116, 223, 208" : "247, 191, 104";
  context.save();
  context.strokeStyle = `rgba(${color}, 0.68)`;
  context.fillStyle = `rgba(${color}, 0.07)`;
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  if (selectedTool === "probe") {
    const depth = clamp((pointer.y - surface) / (height * 0.62), 0.22, 0.9);
    const targetY = surface + depth * height * 0.62;
    roundedRect(context, pointer.x - 11, pointer.y - 11, 22, 22, 11);
    context.stroke();
    context.beginPath();
    context.moveTo(pointer.x, pointer.y + 11);
    context.lineTo(pointer.x, targetY);
    context.stroke();
    context.beginPath();
    context.arc(pointer.x, targetY, 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = `rgba(${color}, 0.7)`;
    context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    context.fillText(`DEPTH ${depth.toFixed(2)}m`, pointer.x + 13, pointer.y + 3);
  } else {
    context.beginPath();
    context.arc(pointer.x, pointer.y, 15, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(pointer.x - 22, pointer.y);
    context.lineTo(pointer.x + 22, pointer.y);
    context.moveTo(pointer.x, pointer.y - 22);
    context.lineTo(pointer.x, pointer.y + 22);
    context.stroke();
  }
  context.restore();
}

function renderScene() {
  const width = sceneSize.width;
  const height = sceneSize.height;
  if (width < 2 || height < 2) return;
  const context = sceneContext;
  const surface = sceneGroundY();
  context.clearRect(0, 0, width, height);
  drawSky(context, width, height, surface, state.day);
  drawSnowfall(context, width, height, surface, state.day, state.weather);
  drawGround(context, width, height, surface);
  drawThawBoundary(context, width, height, surface);
  drawHeatFields(context, width, height, surface);
  drawSnowCap(context, width, height, surface);
  drawDrainage(context, width, height, surface);
  drawStation(context, width, height, surface);
  drawPipeline(context, width, height, surface);
  drawProbes(context, width, height, surface);
  drawSceneLabels(context, width, height, surface);
  drawToolCursor(context, width, height, surface);

  if (paused && !state.ended) {
    context.save();
    const label = "SIMULATION PAUSED";
    context.font = "7px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    const labelWidth = context.measureText(label).width + 18;
    roundedRect(context, width - labelWidth - 14, surface + 10, labelWidth, 18, 4);
    context.fillStyle = "rgba(4, 16, 22, 0.72)";
    context.fill();
    context.fillStyle = "rgba(247, 191, 104, 0.7)";
    context.fillText(label, width - labelWidth - 5, surface + 22);
    context.restore();
  }
}

function renderTimeline() {
  const width = timelineSize.width;
  const height = timelineSize.height;
  if (width < 2 || height < 2) return;
  const context = timelineContext;
  context.clearRect(0, 0, width, height);
  const left = 24;
  const right = width - 9;
  const bottom = height - 13;
  const xForDay = (day) => left + clamp(day / TOTAL_DAYS, 0, 1) * (right - left);

  context.save();
  context.strokeStyle = "rgba(164, 204, 207, 0.075)";
  context.lineWidth = 0.7;
  for (let day = 0; day <= 90; day += 15) {
    const x = xForDay(day);
    context.beginPath();
    context.moveTo(x, 3);
    context.lineTo(x, bottom);
    context.stroke();
    context.fillStyle = "rgba(132, 164, 168, 0.42)";
    context.font = "5.5px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
    context.fillText(`D${day}`, x - (day === 90 ? 11 : 0), height - 2);
  }
  context.fillStyle = "rgba(128, 162, 165, 0.35)";
  context.font = "5.5px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
  context.fillText("−8°", 2, 13);
  context.fillText("−1.5°", 2, 34);
  context.fillText("0", 12, 50);
  context.fillText("18", 8, 66);

  const tempTop = 7;
  const tempBottom = 34;
  const pipeTop = 45;
  const pipeBottom = 65;
  const tempY = (value) => tempTop + clamp((value + 8) / 7.5, 0, 1) * (tempBottom - tempTop);
  const pipeY = (value) => pipeBottom - clamp(value / 25, 0, 1) * (pipeBottom - pipeTop);

  context.setLineDash([3, 4]);
  context.strokeStyle = "rgba(255, 113, 100, 0.24)";
  context.beginPath();
  context.moveTo(left, tempY(THRESHOLDS.stationSafeMax));
  context.lineTo(right, tempY(THRESHOLDS.stationSafeMax));
  context.stroke();
  context.strokeStyle = "rgba(247, 191, 104, 0.28)";
  context.beginPath();
  context.moveTo(left, pipeY(THRESHOLDS.pipeSafe));
  context.lineTo(right, pipeY(THRESHOLDS.pipeSafe));
  context.stroke();
  context.setLineDash([]);

  if (samples.length > 1) {
    const tempGradient = context.createLinearGradient(left, 0, right, 0);
    tempGradient.addColorStop(0, "rgba(182, 232, 244, 0.32)");
    tempGradient.addColorStop(0.7, "rgba(182, 232, 244, 0.85)");
    tempGradient.addColorStop(1, "#d4f9ff");
    context.strokeStyle = tempGradient;
    context.lineWidth = 1.2;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xForDay(sample.day);
      const y = tempY(sample.temp);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    const pipeGradient = context.createLinearGradient(left, 0, right, 0);
    pipeGradient.addColorStop(0, "rgba(247, 191, 104, 0.28)");
    pipeGradient.addColorStop(1, "#ffc56f");
    context.strokeStyle = pipeGradient;
    context.lineWidth = 1.1;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xForDay(sample.day);
      const y = pipeY(sample.pipe);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();

    const last = samples.at(-1);
    const currentX = xForDay(last.day);
    context.fillStyle = "#b6e8f4";
    context.beginPath();
    context.arc(currentX, tempY(last.temp), 1.7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f7bf68";
    context.beginPath();
    context.arc(currentX, pipeY(last.pipe), 1.7, 0, Math.PI * 2);
    context.fill();
  }

  for (const event of state.mission.keyEvents) {
    const x = xForDay(event.day);
    const critical = event.severity === "critical";
    context.fillStyle = critical ? "rgba(255, 113, 100, 0.8)" : "rgba(247, 191, 104, 0.55)";
    context.beginPath();
    context.arc(x, bottom - 1, critical ? 2 : 1.5, 0, Math.PI * 2);
    context.fill();
    if (state.day >= event.day) {
      context.strokeStyle = context.fillStyle;
      context.beginPath();
      context.moveTo(x, bottom - 4);
      context.lineTo(x, bottom - 9);
      context.stroke();
    }
  }

  for (const entry of state.logs) {
    if (entry.kind !== "operation") continue;
    const x = xForDay(entry.day);
    context.fillStyle = "rgba(116, 223, 208, 0.75)";
    context.fillRect(x - 1.5, 39, 3, 3);
  }

  const currentX = xForDay(state.day);
  context.strokeStyle = "rgba(238, 251, 250, 0.22)";
  context.beginPath();
  context.moveTo(currentX, 2);
  context.lineTo(currentX, bottom);
  context.stroke();

  if (timelinePointer) {
    const hoverDay = clamp((timelinePointer.x - left) / (right - left) * TOTAL_DAYS, 0, TOTAL_DAYS);
    const x = xForDay(hoverDay);
    const nearest = samples.reduce((best, sample) => (
      Math.abs(sample.day - hoverDay) < Math.abs(best.day - hoverDay) ? sample : best
    ), samples[0]);
    context.strokeStyle = "rgba(255, 255, 255, 0.2)";
    context.setLineDash([2, 3]);
    context.beginPath();
    context.moveTo(x, 2);
    context.lineTo(x, bottom);
    context.stroke();
    context.setLineDash([]);
    if (nearest) {
      const label = `D${nearest.day.toFixed(0)}  ${nearest.temp.toFixed(1)}°C  ${nearest.pipe.toFixed(1)}mm`;
      context.font = "6px SFMono-Regular, Consolas, 'Polar Noto SC', monospace";
      const boxWidth = context.measureText(label).width + 10;
      const boxX = clamp(x + 5, left, width - boxWidth - 4);
      roundedRect(context, boxX, 1, boxWidth, 13, 3);
      context.fillStyle = "rgba(4, 16, 22, 0.9)";
      context.fill();
      context.fillStyle = "rgba(210, 235, 233, 0.8)";
      context.fillText(label, boxX + 5, 10);
    }
  }
  context.restore();
}

function closeModal() {
  refs.modalBackdrop.hidden = true;
  refs.modalContent.innerHTML = "";
  refs.modalActions.innerHTML = "";
}

function openModal({ kicker = "MISSION CONTROL", title, intro = "", content = "", actions = [] }) {
  refs.modalKicker.textContent = kicker;
  refs.modalTitle.textContent = title;
  refs.modalIntro.textContent = intro;
  refs.modalContent.innerHTML = content;
  refs.modalActions.innerHTML = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `modal-button ${action.className || ""}`.trim();
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    refs.modalActions.append(button);
  }
  refs.modalBackdrop.hidden = false;
}

function compareMarkup(before, after) {
  return `
    <div class="compare-values">
      <div><span>D${before.day.toFixed(0)}</span><b>${before.metrics.pipeDisplacement.toFixed(1)} mm</b></div>
      <i>→</i>
      <div><span>D${after.day.toFixed(0)}</span><b>${after.metrics.pipeDisplacement.toFixed(1)} mm</b></div>
    </div>
    <div class="compare-values">
      <div><span>ECO ${before.ecology.toFixed(1)}</span><b>${before.metrics.stationTemp.toFixed(1)}°C</b></div>
      <i>→</i>
      <div><span>ECO ${after.ecology.toFixed(1)}</span><b>${after.metrics.stationTemp.toFixed(1)}°C</b></div>
    </div>`;
}

function checkCard(entry, label, status, className) {
  return `
    <article class="check-card ${className}">
      <div class="check-label"><span>${label}</span><b class="check-status">${status}</b></div>
      ${compareMarkup(entry.before, entry.after)}
      <div class="check-line"><span>资源变化</span><b>${signed(entry.after.resources.power - entry.before.resources.power, 0)} kWh</b></div>
      <div class="check-line"><span>生态变化</span><b>${signed(entry.ecologyDelta, 1)}</b></div>
      <div class="check-line"><span>经过时间</span><b>+${entry.elapsed.toFixed(1)} d</b></div>
      <p class="check-note">${escapeHtml(entry.trigger)}</p>
    </article>`;
}

function showVerificationModal() {
  validation = runValidationSuite(currentSeed);
  renderStrategies();
  const mission = state.mission;
  const { rapid, staged } = validation.strategies;
  const content = `
    <div class="identity-box">
      <div><span>SEED / 序列指纹</span><b>${escapeHtml(mission.seed)} · ${escapeHtml(mission.fingerprint)}</b></div>
      <div><span>目标个体</span><b>${escapeHtml(mission.sentinel.id)} · ${escapeHtml(mission.sentinel.species)}</b></div>
      <div><span>初始资源</span><b>P${mission.initialResources.power} / C${mission.initialResources.crew} / ${mission.initialResources.probes} probe</b></div>
      <div><span>关键事件顺序</span><b>${mission.keyEvents.map((event) => `D${event.day} ${event.label}`).join(" → ")}</b></div>
    </div>
    <p class="modal-section-title">三项情景校核 <span>同一 seed · 实际引擎推演</span></p>
    <div class="check-grid">
      ${checkCard(validation.steady, "稳态 / 探针校准", "PASS", "steady")}
      ${checkCard(validation.critical, "临界 / 阈值处置", "RECOVER", "critical")}
      ${checkCard(validation.failure, "失败操作 / 资源不足", "FAILED", "failure")}
    </div>
    <p class="modal-section-title">恢复策略代价比较 <span>从同一临界状态分叉</span></p>
    <div class="strategy-table">
      <div>策略</div><div>净耗电力</div><div>占用工时</div><div>恢复用时</div><div>最终生态</div>
      <div><b>${rapid.label}</b></div><div>${rapid.powerUsed.toFixed(0)} kWh</div><div>${rapid.crewUsed.toFixed(1)} h</div><div>${rapid.elapsed.toFixed(0)} d</div><div>${rapid.finalEcology.ecology.toFixed(1)}</div>
      <div class="low-cost"><b>${staged.label}</b></div><div>${staged.powerUsed.toFixed(0)} kWh</div><div>${staged.crewUsed.toFixed(1)} h</div><div>${staged.elapsed.toFixed(0)} d</div><div>${staged.finalEcology.ecology.toFixed(1)}</div>
    </div>
    <div class="identity-box">
      <div><span>快速策略最终指标</span><b>植被 ${rapid.finalEcology.vegetation.toFixed(1)} · 地衣 ${rapid.finalEcology.lichen.toFixed(1)}</b></div>
      <div><span>低耗策略最终指标</span><b>植被 ${staged.finalEcology.vegetation.toFixed(1)} · 地衣 ${staged.finalEcology.lichen.toFixed(1)}</b></div>
      <div><span>触发阈值</span><b>位移 ≥ ${THRESHOLDS.pipeWarning}mm · 地温 &gt; ${THRESHOLDS.stationSafeMax}°C · 排水 &lt; 35%</b></div>
      <div><span>固定序列</span><b>${BENCHMARK_SEQUENCE.length} 个动作 · D${BENCHMARK_SEQUENCE[0].day}—D${BENCHMARK_SEQUENCE.at(-1).day}</b></div>
    </div>`;
  openModal({
    kicker: "DETERMINISM AUDIT / SEED LOCKED",
    title: "情景与确定性校核",
    intro: "稳态、临界与失败操作均已完成一次，并比较操作前/后的资源、生态与时间。同 seed 重开会重建相同目标个体、天气序列、初始资源及任务点位。",
    content,
    actions: [
      { label: "关闭", onClick: closeModal },
      {
        label: "同 Seed 重开",
        onClick: () => {
          closeModal();
          resetSimulation(currentSeed);
        },
      },
      {
        label: "复现基准序列",
        className: "primary",
        onClick: () => {
          closeModal();
          resetSimulation(currentSeed, { benchmark: true });
          audio.start();
        },
      },
    ],
  });
}

function showOutcomeModal() {
  const success = state.outcome === "success";
  const current = snapshot(state);
  const eco = ecologyMetrics(state);
  const resourcesUsed = {
    power: state.mission.initialResources.power - current.resources.power,
    crew: state.mission.initialResources.crew - current.resources.crew,
  };
  const violation = [
    current.metrics.pipeDisplacement > THRESHOLDS.pipeSafe ? `管线位移 ${current.metrics.pipeDisplacement.toFixed(1)} mm > ${THRESHOLDS.pipeSafe} mm` : "",
    current.metrics.stationTemp > THRESHOLDS.stationSafeMax ? `地温 ${current.metrics.stationTemp.toFixed(1)}°C > ${THRESHOLDS.stationSafeMax}°C` : "",
    current.metrics.stationTemp < THRESHOLDS.stationSafeMin ? `地温 ${current.metrics.stationTemp.toFixed(1)}°C < ${THRESHOLDS.stationSafeMin}°C` : "",
  ].filter(Boolean).join(" · ");
  const content = `
    <div class="outcome-hero ${success ? "" : "failure"}">
      <div class="outcome-ring">${success ? "✓" : "!"}</div>
      <div class="outcome-copy">
        <h3>${success ? "九十天守护达成" : "安全阈值被突破"}</h3>
        <p>${success ? "管线位移与站点温度均在安全区，生态样带保持完整。" : violation || "管线位移或站点温度未能保持在安全范围。"}</p>
      </div>
    </div>
    <div class="outcome-stats">
      <div class="outcome-stat"><span>最终位移</span><b>${current.metrics.pipeDisplacement.toFixed(1)}</b> <small>mm</small></div>
      <div class="outcome-stat"><span>站点温度</span><b>${current.metrics.stationTemp.toFixed(1)}</b> <small>°C</small></div>
      <div class="outcome-stat"><span>生态完整性</span><b>${eco.ecology.toFixed(1)}</b> <small>/100</small></div>
      <div class="outcome-stat"><span>哨兵健康</span><b>${eco.sentinelHealth.toFixed(1)}</b> <small>%</small></div>
    </div>
    <div class="identity-box">
      <div><span>资源净变化</span><b>P ${signed(-resourcesUsed.power, 0)} kWh · C ${signed(-resourcesUsed.crew, 1)} h</b></div>
      <div><span>最终植被 / 地衣</span><b>${eco.vegetation.toFixed(1)} / ${eco.lichen.toFixed(1)}</b></div>
      <div><span>目标个体</span><b>${state.mission.sentinel.id} · ${state.mission.sentinel.species}</b></div>
      <div><span>序列指纹</span><b>${state.mission.fingerprint}</b></div>
    </div>
    <div class="identity-box">
      <div><span>初始资源</span><b>${state.mission.initialResources.power} kWh · ${state.mission.initialResources.crew} h · ${state.mission.initialResources.probes} 探针</b></div>
      <div><span>剩余资源</span><b>${current.resources.power.toFixed(0)} kWh · ${current.resources.crew.toFixed(1)} h · ${current.resources.probes} 探针</b></div>
      <div><span>操作次数</span><b>${state.operationCount} 次 / ${state.probes.length} 支探针</b></div>
      <div><span>触发阈值</span><b>位移 ${THRESHOLDS.pipeSafe} mm · 地温 ${THRESHOLDS.stationSafeMin}～${THRESHOLDS.stationSafeMax}°C</b></div>
    </div>`;
  openModal({
    kicker: success ? "MISSION COMPLETE / SAFE ENVELOPE" : "MISSION REVIEW / THRESHOLD BREACH",
    title: success ? "管线与冻土保持稳定" : "本轮守护失败",
    intro: "结果来自连续 90 天热流、融深、沉降和生态状态积分，不是逐帧随机判定。",
    content,
    actions: [
      {
        label: "同 Seed 重开",
        onClick: () => {
          closeModal();
          resetSimulation(currentSeed);
        },
      },
      {
        label: "按基准序列重演",
        className: "primary",
        onClick: () => {
          closeModal();
          resetSimulation(currentSeed, { benchmark: true });
        },
      },
    ],
  });
}

function eventPoint(event, element) {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

refs.pauseBtn.addEventListener("click", () => {
  if (state.ended) {
    showToast("本轮已经结束，可用同 Seed 重开", true);
    return;
  }
  audio.start();
  setPaused(!paused);
});

refs.speedBtn.addEventListener("click", () => {
  if (sequenceMode) {
    showToast("固定序列使用 8× 速度；重开可恢复手动节奏");
    return;
  }
  const index = speeds.indexOf(speed);
  speed = speeds[(index + 1) % speeds.length];
  refs.speedBtn.textContent = `${speed}×`;
});

refs.sequenceBtn.addEventListener("click", () => {
  audio.start();
  resetSimulation(currentSeed, { benchmark: true });
});

refs.restartBtn.addEventListener("click", () => {
  resetSimulation(currentSeed);
});

refs.soundBtn.addEventListener("click", () => {
  audio.enabled = !audio.enabled;
  audio.setEnabled(audio.enabled);
  refs.soundBtn.classList.toggle("is-active", !audio.enabled);
  refs.soundIcon.classList.toggle("muted", !audio.enabled);
  showToast(audio.enabled ? "环境声音已开启 · 风声与泵机随状态变化" : "环境声音已静音");
});

refs.loadSeedBtn.addEventListener("click", () => {
  const nextSeed = refs.seedInput.value.trim().slice(0, 12);
  if (!nextSeed) {
    showToast("请输入 seed", true);
    return;
  }
  resetSimulation(nextSeed);
});

refs.seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") refs.loadSeedBtn.click();
});

$$(".action-card").forEach((card) => {
  card.addEventListener("click", () => {
    audio.start();
    selectTool(card.dataset.action);
  });
});

refs.verifyBtn.addEventListener("click", showVerificationModal);
refs.rerunBtn.addEventListener("click", showVerificationModal);
refs.modalClose.addEventListener("click", closeModal);
refs.modalBackdrop.addEventListener("click", (event) => {
  if (event.target === refs.modalBackdrop) closeModal();
});

scene.addEventListener("pointermove", (event) => {
  pointer = { ...eventPoint(event, scene), inside: true };
  if (selectedTool) {
    const valid = toolHit(selectedTool, pointer);
    refs.toolPrompt.classList.toggle("valid", valid);
    refs.toolPrompt.querySelector("span:last-child").textContent = valid
      ? promptCopy[selectedTool]
      : selectedTool === "probe" ? "点击冻土剖面，避开天空与边缘" : "目标不匹配 · 请点击高亮区域";
  }
});

scene.addEventListener("pointerleave", () => {
  pointer.inside = false;
  refs.toolPrompt.classList.remove("valid");
  if (selectedTool) refs.toolPrompt.querySelector("span:last-child").textContent = promptCopy[selectedTool];
});

scene.addEventListener("pointerdown", (event) => {
  audio.start();
  if (!selectedTool) {
    showToast("先从右侧选择一项干预工具");
    return;
  }
  const point = eventPoint(event, scene);
  if (!toolHit(selectedTool, point)) {
    showToast(selectedTool === "probe" ? "请在冻土剖面内布设探针" : "点击目标区域才能执行该操作", true);
    return;
  }
  useTool(selectedTool, point);
});

timeline.addEventListener("pointermove", (event) => {
  timelinePointer = eventPoint(event, timeline);
});

timeline.addEventListener("pointerleave", () => {
  timelinePointer = null;
});

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (!refs.modalBackdrop.hidden && event.key !== "Escape") return;
  if (event.code === "Space") {
    event.preventDefault();
    if (!state.ended) setPaused(!paused);
  } else if (event.key === "1") {
    selectTool("probe");
  } else if (event.key === "2") {
    selectTool("cooling");
  } else if (event.key === "3") {
    selectTool("drainage");
  } else if (event.key.toLowerCase() === "r") {
    resetSimulation(currentSeed);
  } else if (event.key === "Escape") {
    if (!refs.modalBackdrop.hidden) closeModal();
    else clearTool();
  }
});

document.addEventListener("pointerdown", () => {
  if (audio.enabled) audio.start();
}, { once: true });

const sceneObserver = new ResizeObserver(() => {
  resizeAll();
});
sceneObserver.observe(scene);
sceneObserver.observe(timeline);
window.addEventListener("resize", resizeAll);

function animationFrame(now) {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.08);
  lastFrame = now;
  if (!paused && !state.ended) {
    const previousDay = state.day;
    const previousPipe = state.pipeDisplacement;
    simulationAccumulator += elapsed * speed * 0.7;
    const fixedStep = 0.025;
    let safety = 0;
    while (simulationAccumulator >= fixedStep && safety < 60 && !state.ended) {
      if (sequenceMode) advanceBenchmark(state, fixedStep);
      else advance(state, fixedStep);
      simulationAccumulator -= fixedStep;
      safety += 1;
    }
    const dayDelta = state.day - previousDay;
    if (dayDelta > 0) settleRate = Math.max(0, (state.pipeDisplacement - previousPipe) / dayDelta);
    recordHistory();
  }
  if (now - lastUi > 95) {
    updateUI();
    audio.update(state.weather, state.cooldown, paused);
    lastUi = now;
  }
  renderScene();
  renderTimeline();
  requestAnimationFrame(animationFrame);
}

resizeAll();
const initialSeed = new URLSearchParams(window.location.hash.slice(1)).get("seed") || "677";
resetSimulation(initialSeed, { silent: true });
lastFrame = performance.now();
requestAnimationFrame(animationFrame);
