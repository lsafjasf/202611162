import "./styles.css";
import {
  PATCH_VERSION,
  TRACK_DEFS,
  clamp,
  clonePatch,
  createDefaultPatch,
  normalizePatch,
  panLabel,
  trackDefinition,
} from "./model.js";
import { DrumMachine } from "./sequencer.js";
import { drawFrequencySpark, drawWaveform, MeterCanvas, SequencerCanvas } from "./canvas.js";
import {
  analyzeAudioBuffer,
  formatDb,
  formatDuration,
  preflightSignature,
  renderPatch,
  sameRenderSignature,
} from "./export.js";
import { audioBufferToWav, downloadBlob } from "./wav.js";
import {
  lastPatchName,
  listPatches,
  loadPatch,
  savePatch,
} from "./storage.js";
import { runAcousticAudit } from "./audit.js";

const LAST_EXPORT_KEY = "grain16.lastExport.v1";
const $ = (selector) => document.querySelector(selector);

let patch = createDefaultPatch();
let selectedTrack = "kick";
let selectedStep = 0;
let dirty = true;
let toastTimer = 0;
let lastTelemetryPaint = 0;
let auditionTimer = 0;
let auditRunning = false;
let exportRunning = false;

const elements = {
  playBtn: $("#playBtn"),
  playLabel: $("#playLabel"),
  stopBtn: $("#stopBtn"),
  replayBtn: $("#replayBtn"),
  bpmInput: $("#bpmInput"),
  bpmDown: $("#bpmDown"),
  bpmUp: $("#bpmUp"),
  masterVolume: $("#masterVolume"),
  masterOut: $("#masterOut"),
  resetBtn: $("#resetBtn"),
  saveBtn: $("#saveBtn"),
  patchName: $("#patchName"),
  patchMenuBtn: $("#patchMenuBtn"),
  patchDrawer: $("#patchDrawer"),
  patchSelect: $("#patchSelect"),
  loadBtn: $("#loadBtn"),
  patchDirty: $("#patchDirty"),
  barsSelect: $("#barsSelect"),
  exportBtn: $("#exportBtn"),
  exportMeta: $("#exportMeta"),
  preflight: $("#preflight"),
  waveCanvas: $("#waveCanvas"),
  exportSignature: $("#exportSignature"),
  auditBtn: $("#auditBtn"),
  auditBadge: $("#auditBadge"),
  auditResults: $("#auditResults"),
  stepToggle: $("#stepToggle"),
  velocityInput: $("#velocityInput"),
  velocityOut: $("#velocityOut"),
  probabilityInput: $("#probabilityInput"),
  probabilityOut: $("#probabilityOut"),
  tuneInput: $("#tuneInput"),
  tuneOut: $("#tuneOut"),
  decayInput: $("#decayInput"),
  decayOut: $("#decayOut"),
  panInput: $("#panInput"),
  panOut: $("#panOut"),
  levelInput: $("#levelInput"),
  levelOut: $("#levelOut"),
  muteBtn: $("#muteBtn"),
  auditionBtn: $("#auditionBtn"),
  inspectorTitle: $("#inspectorTitle"),
  trackTabs: $("#trackTabs"),
  trackStrip: $("#trackStrip"),
  statusLed: $("#statusLed"),
  statusText: $("#statusText"),
  sampleRateText: $("#sampleRateText"),
  voiceCount: $("#voiceCount"),
  positionStep: $("#positionStep"),
  stepClock: $("#stepClock"),
  freqValue: $("#freqValue"),
  freqBand: $("#freqBand"),
  freqNote: $("#freqNote"),
  freqSpark: $("#freqSpark"),
  leftValue: $("#leftValue"),
  rightValue: $("#rightValue"),
  stereoBalance: $("#stereoBalance"),
  stereoState: $("#stereoState"),
  delayValue: $("#delayValue"),
  delayState: $("#delayState"),
  peakValue: $("#peakValue"),
  peakHold: $("#peakHold"),
  headroomState: $("#headroomState"),
  peakFill: $("#peakFill"),
  peakHoldMark: $("#peakHoldMark"),
  modal: $("#modal"),
  modalEyebrow: $("#modalEyebrow"),
  modalTitle: $("#modalTitle"),
  modalBody: $("#modalBody"),
  modalProgress: $("#modalProgress"),
  modalClose: $("#modalClose"),
  toast: $("#toast"),
};

const engine = new DrumMachine(patch, {
  onTransport: (state) => updateTransport(state),
});
const sequencer = new SequencerCanvas($("#sequencerCanvas"), {
  onStep: handleGridStep,
  onMute: toggleTrackMute,
  onSelectTrack: selectTrack,
});
const meter = new MeterCanvas($("#meterCanvas"));

function markDirty() {
  dirty = true;
  elements.patchDirty.textContent = "UNSAVED";
  elements.patchDirty.classList.remove("is-saved");
}

function markSaved(label = "SAVED") {
  dirty = false;
  elements.patchDirty.textContent = label;
  elements.patchDirty.classList.add("is-saved");
}

function toast(message, isError = false) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast is-visible${isError ? " is-error" : ""}`;
  toastTimer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, 3600);
}

function setStatus(message, state = "idle") {
  elements.statusText.textContent = message;
  elements.statusLed.className = `status-led${state === "live" ? " is-live" : state === "error" ? " is-error" : ""}`;
}

function formatSignedDb(value) {
  if (!Number.isFinite(value)) return "−∞";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function updateTransport(state) {
  elements.playBtn.classList.toggle("is-playing", state.playing);
  elements.playBtn.classList.toggle("is-paused", state.paused);
  elements.playLabel.textContent = state.playing ? "暂停" : state.paused ? "继续" : "播放";
  if (state.playing) {
    setStatus(`音频时钟锁定 · ${state.bpm} BPM · ${state.sampleRate || "—"} Hz`, "live");
  } else if (state.paused) {
    setStatus(`已暂停于第 ${String(state.step + 1).padStart(2, "0")} 步 · 尾音已切断`);
  } else if (state.contextState === "running") {
    setStatus("已停止 · 所有合成声部已释放");
  }
  if (state.sampleRate) {
    elements.sampleRateText.textContent = `${(state.sampleRate / 1000).toFixed(1)} kHz / 32F`;
  }
}

function buildTrackControls() {
  elements.trackTabs.replaceChildren();
  elements.trackStrip.replaceChildren();
  for (const def of TRACK_DEFS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "track-tab";
    tab.dataset.trackId = def.id;
    tab.style.setProperty("--track-color", def.color);
    tab.innerHTML = `<b>${def.name}</b><span>${def.cn}</span>`;
    tab.addEventListener("click", () => selectTrack(def.id));
    elements.trackTabs.append(tab);

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "track-pill";
    pill.dataset.trackId = def.id;
    pill.style.setProperty("--track-color", def.color);
    pill.innerHTML = `<i></i><span>${def.name}</span><em>${def.cn}</em>`;
    pill.addEventListener("click", () => selectTrack(def.id));
    elements.trackStrip.append(pill);
  }
}

function refreshPatchList(preferredName = "") {
  const patches = listPatches();
  elements.patchSelect.replaceChildren();
  if (!patches.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无已保存补丁";
    elements.patchSelect.append(option);
    elements.loadBtn.disabled = true;
    return;
  }
  elements.loadBtn.disabled = false;
  for (const saved of patches) {
    const option = document.createElement("option");
    option.value = saved.name;
    option.textContent = `${saved.name} · ${saved.bpm} BPM`;
    elements.patchSelect.append(option);
  }
  const last = preferredName || lastPatchName();
  if (last && patches.some((saved) => saved.name === last)) {
    elements.patchSelect.value = last;
  }
}

function syncGlobalControls() {
  elements.bpmInput.value = patch.bpm;
  elements.masterVolume.value = patch.master;
  elements.masterOut.value = patch.master;
  elements.patchName.value = patch.name;
  elements.stepClock.textContent = `16TH · ${(60 / patch.bpm / 4 * 1000).toFixed(2)} ms`;
  refreshTrackClasses();
}

function refreshTrackClasses() {
  for (const def of TRACK_DEFS) {
    const track = patch.tracks[def.id];
    const tab = elements.trackTabs.querySelector(`[data-track-id="${def.id}"]`);
    const pill = elements.trackStrip.querySelector(`[data-track-id="${def.id}"]`);
    tab?.classList.toggle("is-active", def.id === selectedTrack);
    tab?.classList.toggle("is-muted", track.mute);
    pill?.classList.toggle("is-active", def.id === selectedTrack);
    pill?.classList.toggle("is-muted", track.mute);
    if (pill) pill.querySelector("em").textContent = track.mute ? "MUTED" : def.cn;
  }
  const active = trackDefinition(selectedTrack);
  sequencer.setSelected(active.id, selectedStep);
}

function syncInspector() {
  const def = trackDefinition(selectedTrack);
  const track = patch.tracks[def.id];
  const note = track.steps[selectedStep];
  elements.inspectorTitle.textContent = `${def.name} · ${String(selectedStep + 1).padStart(2, "0")}`;
  elements.stepToggle.classList.toggle("is-on", note.on);
  elements.stepToggle.querySelector("span").textContent = note.on ? "ON" : "OFF";
  elements.velocityInput.value = note.velocity;
  elements.velocityOut.value = note.velocity;
  elements.probabilityInput.value = note.probability;
  elements.probabilityOut.value = `${note.probability}%`;

  elements.tuneInput.min = def.tune.min;
  elements.tuneInput.max = def.tune.max;
  elements.tuneInput.step = def.tune.step;
  elements.tuneInput.value = track.tune;
  elements.tuneOut.value = `${track.tune} ${def.tune.unit}`;

  elements.decayInput.min = def.decay.min;
  elements.decayInput.max = def.decay.max;
  elements.decayInput.step = def.decay.step;
  elements.decayInput.value = track.decay;
  elements.decayOut.value = `${track.decay} ms`;

  elements.panInput.value = track.pan;
  elements.panOut.value = panLabel(track.pan);
  elements.levelInput.value = track.level;
  elements.levelOut.value = `${track.level}%`;
  elements.muteBtn.classList.toggle("is-muted", track.mute);
  elements.muteBtn.querySelector("span").textContent = track.mute ? "已静音" : "静音";
  updateKnobAngles();
  refreshTrackClasses();
}

function updateKnobAngles() {
  const controls = [
    [elements.tuneInput, Number(elements.tuneInput.min), Number(elements.tuneInput.max)],
    [elements.decayInput, Number(elements.decayInput.min), Number(elements.decayInput.max)],
    [elements.panInput, -100, 100],
    [elements.levelInput, 0, 120],
  ];
  for (const [input, min, max] of controls) {
    const ratio = (Number(input.value) - min) / Math.max(1, max - min);
    const angle = -135 + ratio * 270;
    input.parentElement.style.setProperty("--knob-angle", `${angle}deg`);
  }
}

function selectTrack(trackId) {
  if (!patch.tracks[trackId]) return;
  selectedTrack = trackId;
  syncInspector();
  sequencer.setSelected(trackId, selectedStep);
}

function selectStep(trackId, step) {
  selectedTrack = trackId;
  selectedStep = clamp(step, 0, 15);
  syncInspector();
  sequencer.setSelected(trackId, selectedStep);
}

function handleGridStep(trackId, step, editOnly) {
  const wasSelected = selectedTrack === trackId && selectedStep === step;
  selectedTrack = trackId;
  selectedStep = step;
  const note = patch.tracks[trackId].steps[step];
  if (!editOnly || !wasSelected) {
    note.on = !note.on;
    markDirty();
    if (note.on && engine.context?.state === "running") {
      void engine.audition(trackId, note.velocity);
    }
  }
  syncInspector();
  sequencer.setSelected(trackId, step);
}

function toggleTrackMute(trackId) {
  const track = patch.tracks[trackId];
  track.mute = !track.mute;
  engine.updateTrack(trackId);
  markDirty();
  syncInspector();
  toast(`${trackDefinition(trackId).name} ${track.mute ? "已静音" : "已恢复"}`);
}

function applyPatch(nextPatch, options = {}) {
  const normalized = normalizePatch(clonePatch(nextPatch));
  engine.stop();
  patch = normalized;
  engine.setPatch(patch);
  selectedTrack = options.trackId && patch.tracks[options.trackId] ? options.trackId : selectedTrack;
  selectedStep = clamp(selectedStep, 0, 15);
  syncGlobalControls();
  syncInspector();
  sequencer.setSelected(selectedTrack, selectedStep);
  if (options.saved) markSaved(options.label || "LOADED");
  else markDirty();
  elements.preflight.querySelectorAll(".preflight-item").forEach((item) => {
    item.classList.remove("is-pass", "is-fail");
  });
  elements.preflight.querySelector(".preflight-result").textContent = "待检查";
  elements.preflight.querySelector(".preflight-result").className = "preflight-result";
}

function setTempo(value) {
  const bpm = Math.round(clamp(value, 40, 220));
  if (bpm === patch.bpm) {
    elements.bpmInput.value = bpm;
    return;
  }
  patch.bpm = bpm;
  engine.setPatch(patch);
  elements.bpmInput.value = bpm;
  elements.stepClock.textContent = `16TH · ${(60 / bpm / 4 * 1000).toFixed(2)} ms`;
  markDirty();
}

function scheduleAudition(delay = 90) {
  if (!engine.context || engine.context.state !== "running") return;
  window.clearTimeout(auditionTimer);
  auditionTimer = window.setTimeout(() => {
    void engine.audition(selectedTrack, patch.tracks[selectedTrack].steps[selectedStep].velocity);
  }, delay);
}

function bindControls() {
  elements.playBtn.addEventListener("click", async () => {
    try {
      if (engine.playing) engine.pause();
      else await engine.play();
    } catch (error) {
      toast(error.message || "无法启动音频", true);
      setStatus("音频启动失败", "error");
    }
  });
  elements.stopBtn.addEventListener("click", () => engine.stop());
  elements.replayBtn.addEventListener("click", async () => {
    try {
      if (engine.playing) await engine.replay();
      else {
        await engine.ensureAudio();
        await engine.replay();
      }
      toast("已从第 01 步重播");
    } catch (error) {
      toast(error.message || "无法重播", true);
    }
  });
  elements.bpmDown.addEventListener("click", () => setTempo(patch.bpm - 1));
  elements.bpmUp.addEventListener("click", () => setTempo(patch.bpm + 1));
  elements.bpmInput.addEventListener("change", () => setTempo(elements.bpmInput.value));
  elements.bpmInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      setTempo(elements.bpmInput.value);
      elements.bpmInput.blur();
    }
  });
  elements.masterVolume.addEventListener("input", () => {
    patch.master = Number(elements.masterVolume.value);
    elements.masterOut.value = patch.master;
    engine.updateMaster();
    markDirty();
  });
  elements.resetBtn.addEventListener("click", () => {
    const name = patch.name;
    const reset = createDefaultPatch();
    reset.name = name;
    applyPatch(reset);
    setStatus("参数与音序已恢复为出厂默认值");
    toast("已重置全部声音与步进参数");
  });
  elements.saveBtn.addEventListener("click", () => {
    const name = elements.patchName.value.trim().toUpperCase() || "UNTITLED";
    patch.name = name.slice(0, 28);
    elements.patchName.value = patch.name;
    savePatch(patch);
    refreshPatchList(patch.name);
    markSaved(`SAVED · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    toast(`补丁「${patch.name}」已保存到本机`);
  });
  elements.patchName.addEventListener("input", () => {
    patch.name = elements.patchName.value.slice(0, 28).toUpperCase();
    markDirty();
  });
  elements.patchMenuBtn.addEventListener("click", () => {
    elements.patchDrawer.hidden = !elements.patchDrawer.hidden;
    if (!elements.patchDrawer.hidden) refreshPatchList();
  });
  elements.loadBtn.addEventListener("click", () => {
    const name = elements.patchSelect.value;
    if (!name) return;
    const loaded = loadPatch(name);
    if (!loaded) {
      toast("补丁不存在或已损坏", true);
      return;
    }
    applyPatch(loaded, { saved: true });
    refreshPatchList(name);
    elements.patchDrawer.hidden = true;
    toast(`已重新载入「${name}」`);
  });

  elements.stepToggle.addEventListener("click", () => {
    const note = patch.tracks[selectedTrack].steps[selectedStep];
    note.on = !note.on;
    markDirty();
    syncInspector();
    if (note.on && engine.context?.state === "running") {
      void engine.audition(selectedTrack, note.velocity);
    }
  });
  elements.velocityInput.addEventListener("input", () => {
    const note = patch.tracks[selectedTrack].steps[selectedStep];
    note.velocity = Number(elements.velocityInput.value);
    elements.velocityOut.value = note.velocity;
    markDirty();
    scheduleAudition(150);
  });
  elements.probabilityInput.addEventListener("input", () => {
    const note = patch.tracks[selectedTrack].steps[selectedStep];
    note.probability = Number(elements.probabilityInput.value);
    elements.probabilityOut.value = `${note.probability}%`;
    markDirty();
  });
  elements.tuneInput.addEventListener("input", () => {
    const def = trackDefinition(selectedTrack);
    const track = patch.tracks[selectedTrack];
    track.tune = Number(elements.tuneInput.value);
    elements.tuneOut.value = `${track.tune} ${def.tune.unit}`;
    updateKnobAngles();
    markDirty();
    scheduleAudition();
  });
  elements.decayInput.addEventListener("input", () => {
    const track = patch.tracks[selectedTrack];
    track.decay = Number(elements.decayInput.value);
    elements.decayOut.value = `${track.decay} ms`;
    updateKnobAngles();
    markDirty();
    scheduleAudition();
  });
  elements.panInput.addEventListener("input", () => {
    const track = patch.tracks[selectedTrack];
    track.pan = Number(elements.panInput.value);
    elements.panOut.value = panLabel(track.pan);
    updateKnobAngles();
    engine.updateTrack(selectedTrack);
    markDirty();
    scheduleAudition(60);
  });
  elements.levelInput.addEventListener("input", () => {
    const track = patch.tracks[selectedTrack];
    track.level = Number(elements.levelInput.value);
    elements.levelOut.value = `${track.level}%`;
    updateKnobAngles();
    engine.updateTrack(selectedTrack);
    markDirty();
    scheduleAudition(80);
  });
  elements.muteBtn.addEventListener("click", () => toggleTrackMute(selectedTrack));
  elements.auditionBtn.addEventListener("click", async () => {
    try {
      const note = patch.tracks[selectedTrack].steps[selectedStep];
      await engine.audition(selectedTrack, note.velocity);
    } catch (error) {
      toast(error.message || "试听失败", true);
    }
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    if (event.code !== "Space") return;
    event.preventDefault();
    elements.playBtn.click();
  });
}

function setPreflight(result) {
  const checks = ["silence", "clipping", "channels"];
  elements.preflight.querySelectorAll(".preflight-item").forEach((item, index) => {
    item.classList.remove("is-pass", "is-fail");
    if (!result) return;
    const check = result[checks[index]];
    item.classList.add(check.pass ? "is-pass" : "is-fail");
    item.title = check.detail;
  });
  const label = elements.preflight.querySelector(".preflight-result");
  label.classList.remove("is-pass", "is-fail");
  if (!result) {
    label.textContent = "待检查";
    return;
  }
  label.textContent = result.pass ? "PASS · 可导出" : "BLOCKED";
  label.classList.add(result.pass ? "is-pass" : "is-fail");
}

function exportMetadata(signature, bars) {
  return {
    duration: signature.duration,
    peakDb: signature.peakDb,
    rmsDb: signature.rmsDb,
    leftPeakDb: signature.left?.peakDb ?? -Infinity,
    rightPeakDb: signature.right?.peakDb ?? -Infinity,
    left: { peakDb: signature.left?.peakDb ?? -Infinity },
    right: { peakDb: signature.right?.peakDb ?? -Infinity },
    channels: signature.numberOfChannels,
    sampleRate: signature.sampleRate,
    bars,
    bpm: patch.bpm,
    name: patch.name,
    exportedAt: new Date().toISOString(),
  };
}

function showExportSignature(metadata, comparison = null) {
  elements.exportSignature.querySelector("b").textContent =
    `${metadata.duration.toFixed(3)} s · ${formatDb(metadata.peakDb)} dB`;
  const note = comparison
    ? comparison.pass
      ? `RELOAD MATCH · Δ${Math.abs(comparison.durationDelta).toFixed(4)} s`
      : "CHANGED SINCE LAST"
    : "NEW BASELINE";
  elements.exportSignature.querySelector("em").textContent = note;
  elements.exportSignature.querySelector("em").style.color = comparison
    ? comparison.pass ? "var(--mint)" : "var(--amber)"
    : "";
}

function compareToLastExport(signature, bars) {
  let previous = null;
  try {
    previous = JSON.parse(localStorage.getItem(LAST_EXPORT_KEY) || "null");
  } catch {
    previous = null;
  }
  if (!previous || previous.bars !== bars) return { previous: null, comparison: null };
  const current = exportMetadata(signature, bars);
  const comparison = {
    ...sameRenderSignature(previous, current, 0.02),
    durationDelta: Math.abs(previous.duration - current.duration),
    peakDelta: Math.abs(previous.peakDb - current.peakDb),
    previous,
  };
  return { previous, comparison };
}

function openModal(title, body, eyebrow = "AUDIO RENDER") {
  elements.modalEyebrow.textContent = eyebrow;
  elements.modalTitle.textContent = title;
  elements.modalBody.textContent = body;
  elements.modalProgress.style.width = "8%";
  elements.modalClose.hidden = true;
  elements.modal.hidden = false;
}

function updateModal(progress, title, body) {
  elements.modalProgress.style.width = `${Math.max(4, Math.min(100, progress))}%`;
  if (title) elements.modalTitle.textContent = title;
  if (body) elements.modalBody.textContent = body;
}

function closeModal(delay = 0) {
  window.setTimeout(() => {
    elements.modal.hidden = true;
    elements.modalClose.hidden = false;
  }, delay);
}

function safeFilename(name) {
  return (name || "GRAIN16")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32) || "GRAIN16";
}

async function handleExport() {
  if (exportRunning) return;
  exportRunning = true;
  elements.exportBtn.disabled = true;
  const bars = Number(elements.barsSelect.value);
  const expectedDuration = 0.04 + bars * 16 * (60 / patch.bpm / 4) + 1.1;
  openModal(
    "正在离线渲染",
    `渲染 ${bars} 小节 · 预计 ${expectedDuration.toFixed(2)} 秒，并检查静音、削波和双声道。`,
  );
  try {
    updateModal(20, "正在合成鼓声", "每个声部由振荡器、滤波噪声与包络实时生成。");
    const rendered = await renderPatch(patch, bars);
    updateModal(72, "正在执行导出预检", "采样级检查：整段静音、0 dBFS 削波、L/R 声道能量。");
    const preflight = preflightSignature(rendered.signature);
    setPreflight(preflight);
    if (!preflight.pass) {
      const failed = Object.values(preflight)
        .filter((check) => check && typeof check === "object" && check.pass === false)
        .map((check) => check.detail)
        .join(" · ");
      updateModal(100, "导出被阻止", `预检未通过：${failed}`);
      toast(`导出已阻止：${failed}`, true);
      setStatus("WAV 预检未通过，未写入文件", "error");
      closeModal(3000);
      return;
    }

    updateModal(88, "正在编码 WAV", "16-bit PCM · 48 kHz · stereo interleaved。");
    const blob = audioBufferToWav(rendered.buffer);
    const { previous, comparison } = compareToLastExport(rendered.signature, bars);
    const filename = `${safeFilename(patch.name)}_${patch.bpm}bpm_${bars}bar.wav`;
    downloadBlob(blob, filename);
    drawWaveform(elements.waveCanvas, rendered.buffer);
    const metadata = exportMetadata(rendered.signature, bars);
    localStorage.setItem(LAST_EXPORT_KEY, JSON.stringify(metadata));
    showExportSignature(metadata, comparison);
    elements.exportMeta.textContent =
      `${formatDuration(metadata.duration)} · ${(blob.size / 1024 / 1024).toFixed(2)} MB · 16-bit`;
    updateModal(100, "WAV 已导出", `${filename} · ${formatDuration(metadata.duration)} · 峰值 ${formatDb(metadata.peakDb)} dBFS`);
    toast(
      comparison
        ? comparison.pass
          ? `WAV 已导出；与上次文件时长和峰值一致（Δ${comparison.peakDelta.toFixed(3)} dB）`
          : "WAV 已导出；与上次文件签名不同"
        : "WAV 已导出，已通过静音、削波与双声道检查",
      Boolean(comparison && !comparison.pass && previous),
    );
    setStatus(`WAV 导出完成 · ${metadata.duration.toFixed(3)} s · ${metadata.channels} CH`);
    closeModal(1300);
  } catch (error) {
    console.error(error);
    updateModal(100, "渲染失败", error.message || "未知音频错误");
    toast(`WAV 导出失败：${error.message || "未知错误"}`, true);
    setStatus("WAV 导出失败", "error");
    closeModal(2600);
  } finally {
    exportRunning = false;
    elements.exportBtn.disabled = false;
  }
}

function renderAuditResults(results) {
  elements.auditResults.replaceChildren();
  for (const result of results) {
    const row = document.createElement("div");
    row.className = `audit-row is-${result.status}`;
    row.innerHTML = `<i></i><span>${result.label}</span><b title="${escapeAttribute(result.detail)}">${result.detail}</b>`;
    elements.auditResults.append(row);
  }
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

async function handleAudit() {
  if (auditRunning) return;
  auditRunning = true;
  elements.auditBtn.disabled = true;
  elements.auditBadge.textContent = "RUNNING";
  elements.auditBadge.className = "audit-badge is-running";
  setStatus("声学验证中 · 离线重渲染真实音频");
  try {
    await engine.ensureAudio();
    const audit = await runAcousticAudit(patch, {
      latencyMs: engine.getLatencyMs(),
      onProgress: (results) => {
        renderAuditResults(results);
        elements.auditBadge.textContent = `${results.filter((result) => result.status === "pass").length}/${5}`;
      },
    });
    renderAuditResults(audit.results);
    elements.auditBadge.textContent = audit.pass ? "PASS 5/5" : "FAIL";
    elements.auditBadge.className = `audit-badge ${audit.pass ? "is-pass" : "is-fail"}`;
    if (audit.pass) {
      toast("声学验证 5/5 通过：时基、声像、音高、重载与预检均来自实际采样");
      setStatus("声学验证通过 · 5/5 · 离线采样比对", "live");
    } else {
      toast("声学验证未全部通过，请查看结果", true);
      setStatus("声学验证失败 · 请查看详细信息", "error");
    }
  } catch (error) {
    console.error(error);
    elements.auditBadge.textContent = "ERROR";
    elements.auditBadge.className = "audit-badge is-fail";
    toast(`验证失败：${error.message || "未知错误"}`, true);
    setStatus("声学验证异常", "error");
  } finally {
    auditRunning = false;
    elements.auditBtn.disabled = false;
  }
}

function updateTelemetry(metrics, now) {
  if (now - lastTelemetryPaint < 55) return;
  lastTelemetryPaint = now;
  const hasContext = Boolean(engine.context);
  const frequency = metrics.frequency > 0 ? metrics.frequency : 0;
  elements.freqValue.textContent = frequency > 0 ? String(Math.round(frequency)) : "—";
  if (frequency > 0) {
    elements.freqBand.textContent = frequency < 55
      ? "SUB BASS"
      : frequency < 100
        ? "LOW BAND"
        : frequency < 250
          ? "LOW MID"
          : "MIX PEAK";
    elements.freqNote.textContent = "KICK FUNDAMENTAL";
  } else {
    elements.freqBand.textContent = hasContext ? "等待鼓声" : "等待启动";
    elements.freqNote.textContent = "—";
  }
  elements.leftValue.textContent = formatSignedDb(metrics.left);
  elements.rightValue.textContent = formatSignedDb(metrics.right);
  const pan = Number.isFinite(metrics.pan) ? metrics.pan : 0;
  elements.stereoBalance.style.left = `${50 + clamp(pan, -1, 1) * 42}%`;
  if (!metrics.hasSignal) elements.stereoState.textContent = "无信号";
  else if (Math.abs(pan) < 0.06) elements.stereoState.textContent = "CENTER";
  else elements.stereoState.textContent = pan < 0 ? "LEFT ENERGY" : "RIGHT ENERGY";

  elements.delayValue.textContent = hasContext
    ? (metrics.delayMs < 0.05 ? "<0.1" : metrics.delayMs.toFixed(1))
    : "—";
  const delayDot = elements.delayState.parentElement.querySelector(".delay-dot");
  delayDot?.classList.toggle("is-live", metrics.state === "running");
  elements.delayState.textContent = !hasContext
    ? "尚未启动"
    : metrics.state === "running" ? "I/O LOCKED" : "SUSPENDED";

  elements.peakValue.textContent = formatDb(metrics.peak);
  elements.peakHold.textContent = `HOLD ${formatDb(metrics.peakHold)}`;
  if (!Number.isFinite(metrics.peak)) {
    elements.headroomState.textContent = "—";
  } else if (metrics.peak > -1) {
    elements.headroomState.textContent = "HOT";
  } else if (metrics.peak > -6) {
    elements.headroomState.textContent = "GOOD LEVEL";
  } else {
    elements.headroomState.textContent = "HEADROOM";
  }
  const peakPercent = Number.isFinite(metrics.peak)
    ? clamp(((metrics.peak + 60) / 60) * 100, 0, 100)
    : 0;
  const holdPercent = Number.isFinite(metrics.peakHold)
    ? clamp(((metrics.peakHold + 60) / 60) * 100, 0, 100)
    : 0;
  elements.peakFill.style.width = `${peakPercent}%`;
  elements.peakHoldMark.style.left = `${holdPercent}%`;
  elements.voiceCount.textContent = `${metrics.activeVoices} VOICES`;
}

function drawFrame(now) {
  const metrics = engine.readMetrics();
  const visual = engine.getVisualState();
  sequencer.draw({ patch, visual });
  meter.draw(metrics);
  drawFrequencySpark(elements.freqSpark, engine.getFrequencyHistory());
  updateTelemetry(metrics, now);
  const step = visual.step >= 0 ? visual.step + 1 : (engine.paused ? engine.pausedStep + 1 : 1);
  elements.positionStep.textContent = String(step).padStart(2, "0");
  requestAnimationFrame(drawFrame);
}

function restoreLastExportDisplay() {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_EXPORT_KEY) || "null");
    if (!last) return;
    elements.exportSignature.querySelector("b").textContent =
      `${last.duration.toFixed(3)} s · ${formatDb(last.peakDb)} dB`;
    elements.exportSignature.querySelector("em").textContent = "SESSION BASELINE";
    elements.exportMeta.textContent =
      `${formatDuration(last.duration)} · ${last.channels} CH · 16-bit`;
  } catch {
    // Invalid metadata is ignored; a new export replaces it.
  }
}

function init() {
  elements.barsSelect.value = "2";
  buildTrackControls();
  bindControls();
  syncGlobalControls();
  syncInspector();
  refreshPatchList();
  setPreflight(null);
  restoreLastExportDisplay();
  elements.exportBtn.addEventListener("click", handleExport);
  elements.auditBtn.addEventListener("click", handleAudit);
  elements.modalClose.addEventListener("click", () => {
    elements.modal.hidden = true;
  });
  elements.patchSelect.addEventListener("change", () => {
    elements.loadBtn.disabled = !elements.patchSelect.value;
  });
  markDirty();
  requestAnimationFrame(drawFrame);

  window.__grain16 = {
    version: PATCH_VERSION,
    getPatch: () => clonePatch(patch),
    applyPatch: (next) => applyPatch(next),
    save: () => savePatch(patch),
    load: (name) => {
      const loaded = loadPatch(name);
      if (loaded) applyPatch(loaded, { saved: true });
      return loaded ? clonePatch(loaded) : null;
    },
    render: (bars = 2) => renderPatch(patch, bars),
    analyze: (buffer) => analyzeAudioBuffer(buffer),
    preflight: (buffer) => preflightSignature(analyzeAudioBuffer(buffer)),
    audit: () => runAcousticAudit(patch, { latencyMs: engine.getLatencyMs() }),
    engine,
    sequencer,
    getState: () => ({
      playing: engine.playing,
      paused: engine.paused,
      bpm: patch.bpm,
      durationFor2Bars: renderPatch ? 0.04 + 2 * 16 * (60 / patch.bpm / 4) + 1.1 : 0,
      latencyMs: engine.getLatencyMs(),
    }),
  };
}

init();
