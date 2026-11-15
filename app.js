import {
  DEFAULT_PARAMS,
  SonarAudio,
  clamp,
  channelMix,
  delayMs,
  normalizeParams,
  renderArchive,
} from "./audio-engine.js";
import {
  analyzeBuffer,
  compareExportSummaries,
  computeSafety,
  encodeWav,
  exportSummary,
  formatDuration,
  formatPeak,
  runAudioVerification,
  safetyPassed,
  sha256Hex,
} from "./analysis.js";
import { SonarCanvasRenderer } from "./canvas.js";

const ARCHIVE_KEY = "abyss-echo-archive-v1";
const MAX_CHARGES = 7;
const FIRE_COST = 1;
const FIRE_HEAT = 26;
const HEAT_LIMIT = 88;
const MARK_TOLERANCE = 4;
const SCAN_ANIMATION_SECONDS = 2.65;

const $ = (id) => document.getElementById(id);

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function createTargets(seed) {
  const random = mulberry32(seed);
  const first = 30 + random() * 15;
  const second = first + 24 + random() * 14;
  const third = Math.min(110, second + 24 + random() * 12);
  const distances = [first, second, third].map((distance) => Math.round(distance));
  const types = ["shoal", "rock", "shoal"];
  if (random() > 0.5) types.reverse();
  const angles = [-0.72, 0.08, 0.71];
  return distances.map((distance, index) => ({
    id: `echo-${index + 1}`,
    distance,
    type: types[index],
    angle: angles[index],
    strength: types[index] === "rock"
      ? 0.72 + random() * 0.22
      : 0.38 + random() * 0.22,
    found: false,
  }));
}

const seedFromQuery = Number(new URLSearchParams(window.location.search).get("seed"));
const initialSeed = Number.isFinite(seedFromQuery) && seedFromQuery > 0
  ? Math.floor(seedFromQuery)
  : 0x2f6e2b1;

const state = {
  phase: "ready",
  paused: false,
  charges: MAX_CHARGES,
  heat: 18,
  found: 0,
  targets: createTargets(initialSeed),
  params: { ...DEFAULT_PARAMS },
  selectedDistance: null,
  hasScanned: false,
  scanCount: 0,
  scanElapsed: 0,
  scanStartedAt: 0,
  lastScanDelays: [],
  elapsedMs: 0,
  lastFrame: performance.now(),
  lastMeterPaint: 0,
  peakHold: 0,
  lastSoundAt: 0,
  lastExport: null,
  baselineExport: null,
  loadedScenario: false,
  archive: null,
  verificationRunning: false,
  hintHold: null,
  lastExportSignature: null,
};

const audio = new SonarAudio();
const canvas = $("sonarCanvas");
const renderer = new SonarCanvasRenderer(canvas, {
  getState: () => state,
  onPickDistance: (distance) => selectDistance(distance),
});

let previewTimer = 0;
let convergenceTimer = 0;
let toastTimer = 0;

function firstUnresolvedTarget() {
  return state.targets.find((target) => !target.found) || null;
}

function sortedTargets() {
  return [...state.targets].sort((left, right) => left.distance - right.distance);
}

function primaryDelay() {
  return state.lastScanDelays.length
    ? state.lastScanDelays[0]
    : delayMs(sortedTargets()[0]?.distance || 0);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function paintMissionHint(text, hot = false) {
  const note = $("fireNote");
  note.textContent = text;
  note.classList.toggle("is-hot", hot);
}

function setMissionHint(text, hot = false, holdMs = 0) {
  state.hintHold = holdMs > 0
    ? { text, hot, until: performance.now() + holdMs }
    : null;
  paintMissionHint(text, hot);
}

function renderResources() {
  setText("chargeReadout", String(state.charges));
  setText("foundReadout", `${state.found}/3`.replace("/3", ""));
  $("foundReadout").innerHTML = `${state.found}<small>/3</small>`;
  setText("heatReadout", String(Math.round(state.heat)));
  $("heatReadout").innerHTML = `${Math.round(state.heat)}<small>%</small>`;
  $("heatBar").style.width = `${clamp(state.heat, 0, 100)}%`;

  $("chargePips").innerHTML = Array.from({ length: MAX_CHARGES }, (_, index) =>
    `<i class="${index >= state.charges ? "is-spent" : ""}"></i>`
  ).join("");

  $("foundPips").querySelectorAll("i").forEach((pip, index) => {
    pip.classList.toggle("is-found", index < state.found);
  });

  const scanning = state.hasScanned && state.scanElapsed < SCAN_ANIMATION_SECONDS;
  const locked = state.phase === "ended" || state.phase === "loaded";
  const tooHot = state.heat >= HEAT_LIMIT;
  const canFire = !state.paused && !locked && !scanning && state.charges > 0 && !tooHot;
  $("fireButton").disabled = !canFire;

  if (state.paused) {
    paintMissionHint("声呐已暂停；继续后热量与回波计时恢复。");
  } else if (locked) {
    paintMissionHint("本次测绘已结束，参数可继续用于归档复核。");
  } else if (tooHot) {
    paintMissionHint(`换能器 ${Math.round(state.heat)}% 过热，等待冷却至 ${HEAT_LIMIT - 1}% 以下。`, true);
  } else if (scanning) {
    paintMissionHint("回波正在收敛，等待三组返回完成。");
  } else if (state.charges <= 0) {
    paintMissionHint("机会耗尽。错误标点会直接占用一次发射机会。", true);
  } else {
    const nextHeat = Math.min(100, Math.round(state.heat + FIRE_HEAT));
    paintMissionHint(`发射后换能器约 ${nextHeat}%；连续扫描会累积热量。`);
  }
  if (state.hintHold && performance.now() < state.hintHold.until) {
    paintMissionHint(state.hintHold.text, state.hintHold.hot);
  } else {
    state.hintHold = null;
  }

  const missionState = $("missionState");
  missionState.classList.remove("is-active", "is-safe");
  if (state.phase === "ended") {
    missionState.textContent = state.found === 3 ? "测绘完成" : "任务结束";
    missionState.classList.add("is-safe");
  } else if (state.phase === "loaded") {
    missionState.textContent = "档案复测";
    missionState.classList.add("is-active");
  } else if (state.paused) {
    missionState.textContent = "已暂停";
  } else if (scanning) {
    missionState.textContent = "接收回波";
    missionState.classList.add("is-active");
  } else if (state.hasScanned) {
    missionState.textContent = "可标点";
    missionState.classList.add("is-active");
  } else {
    missionState.textContent = "待命";
  }

  $("canvasHint").textContent = locked
    ? "档案已锁定；导出并比较两次离线渲染"
    : state.hasScanned
      ? "点击网格选择距离，再确认标点"
      : "先发射声呐，等待回波延迟与波形出现";

  $("markButton").disabled = !state.hasScanned
    || state.selectedDistance === null
    || state.paused
    || locked
    || scanning
    || state.charges <= 0;
  setText(
    "selectedDistance",
    state.selectedDistance === null ? "未选择" : `${state.selectedDistance} m`,
  );
}

function echoBars(type, strength) {
  const count = 15;
  return Array.from({ length: count }, (_, index) => {
    const center = 7;
    const distance = Math.abs(index - center);
    const envelope = Math.exp(-distance / (type === "rock" ? 2.2 : 4.8));
    const jitter = ((index * 37 + Math.round(strength * 100)) % 9) / 9;
    const height = Math.max(2, Math.round((3 + envelope * 14 + jitter * 3) * strength));
    return `<i class="${type === "shoal" ? "is-soft" : ""}" style="height:${height}px"></i>`;
  }).join("");
}

function renderEchoes() {
  const list = $("echoList");
  setText("scanCount", state.hasScanned ? `SCAN ${String(state.scanCount).padStart(2, "0")}` : "NO SCAN");
  if (!state.hasScanned) {
    list.innerHTML = '<div class="echo-empty">发射声呐后，三组回波将在此展开。</div>';
    return;
  }

  list.innerHTML = sortedTargets().map((target, index) => {
    const shape = target.type === "rock" ? "锐回波 / ROCK" : "宽回波 / SHOAL";
    return `
      <div class="echo-row ${target.found ? "is-resolved" : ""}">
        <span class="echo-index">${["I", "II", "III"][index]}</span>
        <div class="echo-shape" aria-hidden="true">${echoBars(target.type, target.strength)}</div>
        <div class="echo-meta">
          <b>${shape}</b>
          <small>Δt ${delayMs(target.distance)} ms · 强 ${target.strength.toFixed(2)}</small>
        </div>
      </div>
    `;
  }).join("");
}

function renderParams() {
  const params = state.params;
  const mix = channelMix(params.beam);
  $("frequencySlider").value = String(params.frequency);
  $("beamSlider").value = String(Math.round(params.beam * 100));
  $("beatSlider").value = String(params.bpm);
  $("gainSlider").value = String(Math.round(params.gain * 100));
  setText("frequencyValue", `${params.frequency} Hz`);
  setText("beamValue", `L ${mix.left} / R ${mix.right}`);
  setText("beatValue", `${params.bpm} BPM`);
  setText("gainValue", `${Math.round(params.gain * 100)}%`);
  $("frequencyReadout").innerHTML = `${params.frequency} <small>Hz</small>`;
  setText("channelReadout", `L ${mix.left} · R ${mix.right}`);
  $("frequencyMeter").style.width = `${((params.frequency - 280) / 640) * 100}%`;
  $("delayReadout").innerHTML = state.hasScanned
    ? `${primaryDelay()} <small>ms</small>`
    : "— <small>ms</small>";
  $("delayMeter").style.width = state.hasScanned
    ? `${clamp((primaryDelay() / 1320) * 100, 3, 100)}%`
    : "0%";
}

function setConvergenceSettling() {
  const badge = $("convergenceBadge");
  badge.classList.add("is-settling");
  badge.innerHTML = "<i></i> 校准中…";
  clearTimeout(convergenceTimer);
  convergenceTimer = window.setTimeout(() => {
    badge.classList.remove("is-settling");
    badge.innerHTML = "<i></i> 参数已同步 · 声音/仪表";
  }, 260);
}

function setAudioStatus(mode, label) {
  const pill = $("audioStatus");
  pill.classList.remove("is-live", "is-paused");
  if (mode === "live") pill.classList.add("is-live");
  if (mode === "paused") pill.classList.add("is-paused");
  pill.innerHTML = `<i></i> ${label}`;
}

function updatePauseButton() {
  $("pauseIcon").textContent = state.paused ? "▶" : "Ⅱ";
  $("pauseLabel").textContent = state.paused ? "继续" : "暂停";
  $("pauseButton").setAttribute("aria-label", state.paused ? "继续音频与计时" : "暂停音频与计时");
}

async function togglePause() {
  state.paused = !state.paused;
  updatePauseButton();
  if (state.paused) {
    await audio.pause();
    setAudioStatus("paused", "音频已暂停");
  } else {
    try {
      await audio.resume();
      setAudioStatus("live", "音频运行");
    } catch (error) {
      setAudioStatus("idle", "音频待命");
    }
  }
  renderResources();
}

function schedulePreview(delay = 120) {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    if (state.paused) return;
    try {
      const played = await audio.preview();
      if (played) {
        state.lastSoundAt = performance.now();
        setAudioStatus("live", "音频运行");
      }
    } catch (error) {
      setAudioStatus("idle", "音频待命");
    }
  }, delay);
}

async function applyParams(nextParams, options = {}) {
  state.params = normalizeParams({ ...state.params, ...nextParams });
  await audio.setParams(state.params);
  renderParams();
  updateSaveAvailability();
  if (options.preview !== false) {
    setConvergenceSettling();
    schedulePreview(options.previewDelay ?? 115);
  }
}

function currentExportSignature() {
  return JSON.stringify({
    params: state.params,
    targets: sortedTargets().map(({ distance, type, strength }) => ({ distance, type, strength })),
  });
}

function updateSaveAvailability() {
  const button = $("saveButton");
  if (!button) return;
  button.disabled = !state.lastExport || state.lastExportSignature !== currentExportSignature();
}

function readParamsFromControls() {
  return {
    frequency: Number($("frequencySlider").value),
    beam: Number($("beamSlider").value) / 100,
    bpm: Number($("beatSlider").value),
    gain: Number($("gainSlider").value) / 100,
  };
}

async function resetParams() {
  await applyParams(DEFAULT_PARAMS, { preview: true, previewDelay: 40 });
}

function selectDistance(distance) {
  if (state.phase === "ended" || state.phase === "loaded") return;
  state.selectedDistance = distance;
  renderResources();
  if (!state.hasScanned) {
    setMissionHint("距离已选；发射声呐后即可确认或修正标点。");
  }
}

async function fireSonar() {
  if (state.paused || state.phase === "ended" || state.phase === "loaded") return;
  if (state.hasScanned && state.scanElapsed < SCAN_ANIMATION_SECONDS) return;
  if (state.charges <= 0 || state.heat >= HEAT_LIMIT) {
    renderResources();
    return;
  }

  state.charges -= FIRE_COST;
  state.heat = Math.min(100, state.heat + FIRE_HEAT);
  state.scanCount += 1;
  state.hasScanned = true;
  state.scanElapsed = 0;
  state.scanStartedAt = performance.now();
  state.selectedDistance = null;
  state.lastScanDelays = sortedTargets().map((target) => delayMs(target.distance));
  state.phase = "scanning";

  renderResources();
  renderEchoes();
  renderParams();
  try {
    await audio.playScan(sortedTargets());
    state.lastSoundAt = performance.now();
    setAudioStatus("live", "音频运行");
  } catch (error) {
    setMissionHint("浏览器未能启动 Web Audio；请再次点击发射。", true, 3200);
  }
}

async function replayLastScan() {
  if (!state.hasScanned || state.paused) return;
  state.scanElapsed = 0;
  renderResources();
  try {
    const played = await audio.replayLast();
    if (played) {
      state.lastSoundAt = performance.now();
      setAudioStatus("live", "音频运行 · 重播");
    }
  } catch (error) {
    setMissionHint("重播失败：请确认浏览器允许音频。", true, 2800);
  }
}

function showMissionEnd(complete) {
  state.phase = "ended";
  const overlay = $("endOverlay");
  overlay.hidden = false;
  setText("endEyebrow", complete ? "MISSION COMPLETE" : "MISSION TERMINATED");
  setText(
    "endTitle",
    complete ? "三处障碍已完成测绘" : "声呐机会已耗尽",
  );
  setText(
    "endCopy",
    complete
      ? "盲水档案已建立。保存当前参数并导出回波，重新载入后可逐项复核。"
      : "未完成全部标点。仍可归档当前回波参数，用于离线复核。",
  );
  $("endStats").innerHTML = `
    <span>发射次数<b>${state.scanCount}</b></span>
    <span>定位障碍<b>${state.found}</b></span>
    <span>任务耗时<b>${formatClock(state.elapsedMs)}</b></span>
    <span>剩余机会<b>${state.charges}</b></span>
  `;
  renderResources();
  audio.playFeedback(complete ? "complete" : "error").catch(() => {});
}

async function confirmMark() {
  if (state.selectedDistance === null || state.paused) return;
  if (state.phase === "ended" || state.phase === "loaded") return;
  if (!state.hasScanned || state.charges <= 0) return;

  const unresolved = state.targets.filter((target) => !target.found);
  const nearest = unresolved.reduce((best, target) => {
    if (!best) return target;
    return Math.abs(target.distance - state.selectedDistance)
      < Math.abs(best.distance - state.selectedDistance)
      ? target
      : best;
  }, null);
  const error = nearest
    ? Math.abs(nearest.distance - state.selectedDistance)
    : Infinity;

  if (nearest && error <= MARK_TOLERANCE) {
    nearest.found = true;
    state.found += 1;
    state.selectedDistance = null;
    audio.playFeedback("confirm").catch(() => {});
    setMissionHint(`标点命中：${nearest.distance} m · ${nearest.type === "rock" ? "岩壁" : "浅滩"}`, false, 2400);
    renderResources();
    renderEchoes();
    if (state.found >= 3) showMissionEnd(true);
    return;
  }

  state.charges -= 1;
  state.heat = Math.min(100, state.heat + 7);
  state.selectedDistance = null;
  audio.playFeedback("error").catch(() => {});
  if (state.charges <= 0) {
    setMissionHint("错误标点消耗了最后一次机会。", true, 4000);
    renderResources();
    renderEchoes();
    showMissionEnd(false);
    return;
  }
  setMissionHint(`标点偏离容差 ${error === Infinity ? "—" : `${error.toFixed(0)} m`}，消耗 1 次机会。`, true, 3200);
  renderResources();
  renderEchoes();
}

function formatClock(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function readArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return null;
    const archive = JSON.parse(raw);
    if (archive?.version !== 1 || !Array.isArray(archive.targets) || archive.targets.length !== 3) {
      return null;
    }
    return archive;
  } catch (error) {
    return null;
  }
}

function refreshArchiveButtons() {
  state.archive = readArchive();
  $("loadButton").disabled = !state.archive;
  $("saveButton").disabled = !state.lastExport;
  if (state.archive && !state.loadedScenario) {
    $("archiveState").textContent = "发现存档";
    $("archiveState").classList.add("is-ready");
  }
}

function updateSafetyChecks(safety) {
  const mapping = [
    ["checkSilence", safety ? safety.silence : null],
    ["checkClip", safety ? safety.clipping : null],
    ["checkChannels", safety ? safety.channels : null],
  ];
  for (const [id, passed] of mapping) {
    const element = $(id);
    element.classList.remove("is-pass", "is-fail");
    if (passed === true) element.classList.add("is-pass");
    if (passed === false) element.classList.add("is-fail");
  }
}

function updateExportReadout(summary) {
  setText("exportDuration", formatDuration(summary.duration));
  setText("exportPeaks", `${formatPeak(summary.peakL)} / ${formatPeak(summary.peakR)}`);
  setText("exportDelay", `${summary.delayMs} ms`);
}

function renderConsistencyReport(before, after) {
  const report = $("consistencyReport");
  report.classList.remove("is-pass", "is-fail");
  if (!before) {
    const text = report.querySelector("p");
    if (after) {
      text.textContent = `第一次导出通过。时长 ${formatDuration(after.duration)}，关键音高 ${after.pitch} Hz，`
        + `首回波 ${after.delayMs} ms。保存参数后重载，再导出即可逐项比较。`;
    }
    return;
  }

  if (!after) {
    report.querySelector("p").textContent = "已载入第一次导出摘要。再次渲染导出后，将比较音高、延迟、时长、左右峰值与 PCM 校验和。";
    return;
  }

  const comparison = compareExportSummaries(before, after);
  report.classList.add(comparison.pass ? "is-pass" : "is-fail");
  const lines = comparison.checks.map((check) =>
    `${check.informational ? "≈" : check.pass ? "✓" : "×"} ${check.label}: ${check.before} → ${check.after}`
  );
  const note = comparison.pass && !comparison.checks.find((check) => check.key === "hash")?.pass
    ? "（末位差异 ≤ 1 LSB，允许浮点舍入）"
    : "";
  report.querySelector("p").textContent =
    `${comparison.pass ? "两次导出关键指标一致。" : "两次导出存在差异。"}${note}\n${lines.join("\n")}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportCurrentArchive() {
  const button = $("exportButton");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "离线渲染中…";
  $("archiveState").textContent = "渲染中";
  $("archiveState").classList.add("is-ready");
  updateSafetyChecks(null);

  try {
    const targets = sortedTargets();
    const rendered = await renderArchive(state.params, targets, 9.6);
    const report = analyzeBuffer(rendered.buffer, { pitchStart: 0.3 });
    const safety = computeSafety(report);
    updateSafetyChecks(safety);

    const provisional = exportSummary(report, delayMs(targets[0].distance));
    updateExportReadout(provisional);

    if (!safetyPassed(safety)) {
      $("archiveState").textContent = "检查未通过";
      renderConsistencyReport(state.baselineExport, null);
      const failures = [
        safety.silence ? "" : "检测到静音",
        safety.clipping ? "" : "检测到削波",
        safety.channels ? "" : "检测到声道缺失",
      ].filter(Boolean);
      $("consistencyReport").classList.add("is-fail");
      $("consistencyReport").querySelector("p").textContent = `导出已阻止：${failures.join("、")}。请调整增益后重试。`;
      return;
    }

    const encoded = encodeWav(rendered.buffer);
    const hash = await sha256Hex(encoded.arrayBuffer);
    const summary = exportSummary(report, delayMs(targets[0].distance), hash);
    state.lastExport = summary;
    state.lastExportSignature = currentExportSignature();
    updateSaveAvailability();
    $("archiveState").textContent = state.loadedScenario ? "复导完成" : "首导完成";
    const suffix = state.loadedScenario ? "reload" : "first";
    downloadBlob(encoded.blob, `abyss-echo-${Date.now()}-${suffix}.wav`);
    renderConsistencyReport(state.baselineExport, summary);
  } catch (error) {
    $("archiveState").textContent = "导出失败";
    $("consistencyReport").classList.add("is-fail");
    $("consistencyReport").querySelector("p").textContent = `离线渲染失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "渲染并导出 WAV";
  }
}

function saveCurrentParams() {
  if (!state.lastExport) {
    $("consistencyReport").querySelector("p").textContent = "请先完成一次通过安全检查的导出，再保存参数。";
    return;
  }
  if (state.lastExportSignature !== currentExportSignature()) {
    $("consistencyReport").classList.add("is-fail");
    $("consistencyReport").querySelector("p").textContent =
      "参数已在导出后发生变化。请重新导出当前参数，再保存档案。";
    return;
  }
  const archive = {
    version: 1,
    savedAt: new Date().toISOString(),
    params: { ...state.params },
    targets: state.targets.map((target) => ({ ...target })),
    export: { ...state.lastExport },
    scanCount: state.scanCount,
    found: state.found,
    elapsedMs: state.elapsedMs,
  };
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
    state.archive = archive;
    $("loadButton").disabled = false;
    $("archiveState").textContent = "参数已保存";
    $("archiveState").classList.add("is-ready");
    $("consistencyReport").classList.remove("is-fail");
    $("consistencyReport").querySelector("p").textContent =
      `已保存 ${state.params.frequency} Hz / ${state.params.bpm} BPM 与第一次导出摘要。点击“重载并复测”恢复参数。`;
  } catch (error) {
    $("consistencyReport").classList.add("is-fail");
    $("consistencyReport").querySelector("p").textContent = `无法写入本地存档：${error.message}`;
  }
}

async function loadSavedParams() {
  const archive = readArchive();
  if (!archive) {
    $("consistencyReport").querySelector("p").textContent = "没有可用存档。请先导出并保存参数。";
    return;
  }

  state.params = normalizeParams(archive.params);
  await audio.setParams(state.params);
  state.targets = archive.targets.map((target) => ({
    ...target,
    found: Boolean(target.found),
  })).sort((left, right) => left.distance - right.distance);
  state.found = state.targets.filter((target) => target.found).length;
  state.scanCount = Number(archive.scanCount) || 1;
  state.elapsedMs = Number(archive.elapsedMs) || 0;
  state.hasScanned = true;
  state.scanElapsed = SCAN_ANIMATION_SECONDS + 0.2;
  state.selectedDistance = null;
  state.phase = "loaded";
  state.loadedScenario = true;
  state.baselineExport = archive.export ? { ...archive.export } : null;
  state.lastScanDelays = sortedTargets().map((target) => delayMs(target.distance));
  state.lastExport = null;
  state.archive = archive;
  $("endOverlay").hidden = true;
  $("archiveState").textContent = "已重载 · 待复导";
  $("archiveState").classList.add("is-ready");
  $("saveButton").disabled = true;
  $("loadButton").disabled = false;
  updateSafetyChecks(null);
  setText("exportDuration", "—");
  setText("exportPeaks", "— / —");
  setText("exportDelay", "—");
  renderParams();
  renderEchoes();
  renderResources();
  renderConsistencyReport(state.baselineExport, null);
  await audio.playFeedback("confirm").catch(() => {});
  document.querySelector(".archive-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}

function setVerificationCard(kind, status, text, detail) {
  const card = document.querySelector(`.verify-card[data-test="${kind}"]`);
  card.classList.remove("is-running", "is-pass", "is-fail");
  if (status) card.classList.add(`is-${status}`);
  setText(`${kind}TestText`, text);
  setText(`${kind}TestResult`, status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "—");
  if (detail) card.title = detail;
}

async function runVerification(auto = false) {
  if (state.verificationRunning) return;
  state.verificationRunning = true;
  const button = $("runVerificationButton");
  button.disabled = true;
  button.textContent = "验证中…";
  $("verificationProgress").hidden = false;
  $("verificationProgress").value = 0;
  setText("verificationSummary", "正在渲染真实声学样本并检测波形、声道能量和脉冲间隔…");
  ["frequency", "stereo", "beat"].forEach((kind) => {
    setVerificationCard(kind, "running", "离线渲染中…");
  });

  const progressTimer = window.setInterval(() => {
    const progress = $("verificationProgress");
    progress.value = Math.min(2, Number(progress.value) + 1);
  }, 180);

  try {
    const results = await runAudioVerification(state.params);
    const kinds = ["frequency", "stereo", "beat"];
    kinds.forEach((kind, index) => {
      const result = results[kind];
      setVerificationCard(kind, result.pass ? "pass" : "fail", result.text, result.detail);
      $("verificationProgress").value = index + 1;
    });
    setText(
      "verificationSummary",
      results.passed
        ? `3 / 3 通过：音高、左右声道与节拍均由真实离线样本验证。${auto ? "（页面载入时自动验证）" : ""}`
        : "存在未通过维度；请查看卡片提示并重新运行。",
    );
  } catch (error) {
    ["frequency", "stereo", "beat"].forEach((kind) => {
      setVerificationCard(kind, "fail", "无法渲染", error.message);
    });
    setText("verificationSummary", `验证失败：${error.message}`);
  } finally {
    window.clearInterval(progressTimer);
    state.verificationRunning = false;
    button.disabled = false;
    button.textContent = "重新运行验证";
    window.setTimeout(() => {
      $("verificationProgress").hidden = true;
    }, 900);
  }
}

function paintMeters(now) {
  const meters = audio.readMeters();
  const elapsed = Math.max(0, now - state.lastSoundAt);
  state.peakHold = Math.max(meters.peak, state.peakHold * 0.93);
  if (elapsed > 1800 && state.peakHold < 0.0015) state.peakHold = 0;

  const peakText = state.peakHold > 0.00001
    ? (20 * Math.log10(state.peakHold)).toFixed(1)
    : "—";
  $("peakReadout").innerHTML = `${peakText} <small>dBFS</small>`;
  $("leftMeter").style.width = `${clamp(meters.leftRms * 520, 0, 100)}%`;
  $("rightMeter").style.width = `${clamp(meters.rightRms * 520, 0, 100)}%`;

  if (!state.paused && now - state.lastSoundAt < 700) {
    const totalRms = meters.leftRms + meters.rightRms;
    if (totalRms > 0.0001) {
      const left = Math.round((meters.leftRms / totalRms) * 100);
      setText("channelReadout", `L ${left} · R ${100 - left}`);
    } else {
      const mix = channelMix(state.params.beam);
      setText("channelReadout", `L ${mix.left} · R ${mix.right}`);
    }
  }
}

function renderClock() {
  setText("missionClock", `T+ ${formatClock(state.elapsedMs)}`);
}

let lastResourcePaint = 0;
let lastScanningState = false;

function animationFrame(now) {
  const delta = Math.min(120, Math.max(0, now - state.lastFrame));
  state.lastFrame = now;

  if (!state.paused) {
    state.elapsedMs += delta;
    state.heat = Math.max(0, state.heat - (delta / 1000) * 2.35);
    if (state.hasScanned && state.phase !== "loaded") {
      state.scanElapsed = Math.min(8, state.scanElapsed + delta / 1000);
    }

    const scanningNow = state.hasScanned
      && state.scanElapsed < SCAN_ANIMATION_SECONDS
      && state.phase !== "loaded";
    if (lastScanningState && !scanningNow && state.phase === "scanning") {
      state.phase = "ready";
      renderResources();
    }
    lastScanningState = scanningNow;
  }

  if (now - state.lastMeterPaint > 72) {
    paintMeters(now);
    state.lastMeterPaint = now;
  }
  if (now - lastResourcePaint > 180) {
    renderResources();
    renderClock();
    lastResourcePaint = now;
  }
  renderer.draw(now);
  requestAnimationFrame(animationFrame);
}

function bindEvents() {
  ["frequencySlider", "beamSlider", "beatSlider", "gainSlider"].forEach((id) => {
    $(id).addEventListener("input", async () => {
      await applyParams(readParamsFromControls());
    });
  });

  $("pauseButton").addEventListener("click", togglePause);
  $("replayButton").addEventListener("click", replayLastScan);
  $("resetParamsButton").addEventListener("click", resetParams);
  $("auditionButton").addEventListener("click", async () => {
    try {
      await audio.ensureContext();
      await audio.preview();
      state.lastSoundAt = performance.now();
      setAudioStatus("live", "音频运行");
    } catch (error) {
      setAudioStatus("idle", "音频待命");
    }
  });
  $("fireButton").addEventListener("click", fireSonar);
  $("markButton").addEventListener("click", confirmMark);
  $("runVerificationButton").addEventListener("click", () => runVerification(false));
  $("exportButton").addEventListener("click", exportCurrentArchive);
  $("saveButton").addEventListener("click", saveCurrentParams);
  $("loadButton").addEventListener("click", loadSavedParams);
  $("endArchiveButton").addEventListener("click", () => {
    document.querySelector(".archive-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => $("exportButton").focus(), 450);
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.code === "Space") {
      event.preventDefault();
      fireSonar();
    } else if (event.key.toLowerCase() === "r") {
      replayLastScan();
    } else if (event.key.toLowerCase() === "p") {
      togglePause();
    }
  });
}

function initialize() {
  renderResources();
  renderEchoes();
  renderParams();
  renderClock();
  refreshArchiveButtons();
  updatePauseButton();
  bindEvents();
  requestAnimationFrame(animationFrame);
  window.setTimeout(() => runVerification(true), 950);
}

initialize();
