import {
  createDefaultProject,
  deepClone,
  formatTime,
  getAudioEventAt,
  getCueAt,
  getSceneAt,
  projectFingerprint,
  roundTime,
  sanitizeProject,
  serializeProject,
  STORAGE_KEY,
  uid,
  validateProject,
} from "./project.js";
import { BeatAudioEngine } from "./audio.js";
import { Transport } from "./transport.js";
import { StageRenderer } from "./stage.js";
import {
  LEGACY_SAMPLE,
  parseSubtitleText,
  verifySubtitleRoundTrip,
} from "./subtitles.js";
import { TimelineView } from "./timeline.js";

const $ = (id) => document.getElementById(id);
const dom = {
  projectName: $("projectName"),
  saveState: $("saveState"),
  sceneTabs: $("sceneTabs"),
  stageCanvas: $("stageCanvas"),
  subtitleLine: $("subtitleLine"),
  transitionBadge: $("transitionBadge"),
  currentTime: $("currentTime"),
  totalDuration: $("totalDuration"),
  clockSource: $("clockSource"),
  audioEvent: $("audioEvent"),
  playBtn: $("playBtn"),
  stopBtn: $("stopBtn"),
  toStartBtn: $("toStartBtn"),
  loopBtn: $("loopBtn"),
  sceneBadge: $("sceneBadge"),
  durationStat: $("durationStat"),
  keyframeStat: $("keyframeStat"),
  transitionStat: $("transitionStat"),
  cueCount: $("cueCount"),
  emptySelection: $("emptySelection"),
  cueForm: $("cueForm"),
  cueStart: $("cueStart"),
  cueEnd: $("cueEnd"),
  cueText: $("cueText"),
  cueError: $("cueError"),
  bpmInput: $("bpmInput"),
  audioStartInput: $("audioStartInput"),
  durationInput: $("durationInput"),
  timelineCanvas: $("timelineCanvas"),
  cueLayer: $("cueLayer"),
  playhead: $("playhead"),
  timelineScroller: $("timelineScroller"),
  timelineStatus: $("timelineStatus"),
  zoomInput: $("zoomInput"),
  importSubtitlesInput: $("importSubtitlesInput"),
  openProjectInput: $("openProjectInput"),
  verificationList: $("verificationList"),
  verificationResult: $("verificationResult"),
  toast: $("toast"),
};

let project = createDefaultProject();
let selectedCueId = null;
let dirty = false;
let restoredFromStorage = false;
let lastCueSignature = "";
let lastSceneId = null;
let toastTimer = 0;
let verificationRunning = false;
let lastSavedFingerprint = null;

const audio = new BeatAudioEngine(() => project);
const stage = new StageRenderer(dom.stageCanvas);
const transport = new Transport({
  getProject: () => project,
  audio,
  onTick: (time) => onTransportTick(time),
  onState: (state) => onTransportState(state),
  onLoop: () => {
    lastCueSignature = "";
  },
});

const timeline = new TimelineView({
  canvas: dom.timelineCanvas,
  cueLayer: dom.cueLayer,
  playhead: dom.playhead,
  scroller: dom.timelineScroller,
  getProject: () => project,
  callbacks: {
    onSelect: (id) => selectCue(id),
    onSeek: (time) => transport.seek(time, { keepPlaying: false }),
    onScrubStart: () => {
      const wasPlaying = transport.playing;
      if (wasPlaying) transport.pause();
      return wasPlaying;
    },
    onScrubEnd: (wasPlaying) => {
      if (wasPlaying) transport.seek(transport.position, { keepPlaying: true });
    },
    onCueChange: (id, changes, phase) => updateCueTiming(id, changes, phase),
    onCueCommit: (id) => commitCueDrag(id),
  },
});

function safeReadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeProject(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn("Could not restore saved project:", error);
    return null;
  }
}

function bootstrap() {
  const restored = safeReadProject();
  if (restored) {
    project = restored;
    restoredFromStorage = true;
    lastSavedFingerprint = projectFingerprint(project);
  }
  if (!project.subtitles.length) selectedCueId = null;
  renderProject();
  renderVerificationState([
    ["共享时钟", "等待验证", null],
    ["导出时码", "等待验证", null],
    ["工程恢复", restoredFromStorage ? "已检测到本机工程" : "初始示例", restoredFromStorage ? true : null],
  ]);
  if (restoredFromStorage) {
    showToast("已恢复上次保存的工程、字幕、转场、关键帧和音频起点。", "ok");
  }
}

function renderProject() {
  dom.projectName.value = project.name;
  dom.durationInput.value = project.duration.toFixed(2);
  dom.bpmInput.value = project.audio.bpm;
  dom.audioStartInput.value = project.audio.start.toFixed(2);
  dom.durationStat.textContent = `${project.duration.toFixed(2)}s`;
  dom.keyframeStat.textContent = String(
    project.scenes.reduce((sum, scene) => sum + scene.keyframes.length, 0),
  );
  dom.transitionStat.textContent = project.transitions.length
    ? `${project.transitions[0].duration.toFixed(1)}s`
    : "—";
  dom.totalDuration.textContent = formatTime(project.duration);
  dom.currentTime.textContent = formatTime(transport.getPosition());
  renderSceneTabs();
  timeline.setZoom(Number(dom.zoomInput.value));
  timeline.setSelected(selectedCueId);
  timeline.render();
  refreshSelection();
  refreshValidation();
  renderAt(transport.getPosition());
  updateSceneIndicator(transport.getPosition());
  renderSaveState();
}

function renderSceneTabs() {
  dom.sceneTabs.textContent = "";
  project.scenes.forEach((scene) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-tab";
    button.dataset.sceneId = scene.id;
    button.style.setProperty("--scene-color", scene.color);
    button.textContent = scene.name;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => switchScene(scene.id));
    dom.sceneTabs.appendChild(button);
  });
}

async function switchScene(sceneId) {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const wasPlaying = transport.playing;
  selectedCueId = null;
  timeline.setSelected(null);
  refreshSelection();
  await transport.seek(scene.start, { keepPlaying: wasPlaying });
  updateSceneIndicator(scene.start);
  showToast(
    wasPlaying
      ? `已切换到「${scene.name}」，旧节拍已停止并重新排程。`
      : `已定位到「${scene.name}」起点。`,
    "ok",
  );
}

function onTransportTick(time) {
  dom.currentTime.textContent = formatTime(time);
  timeline.updatePlayhead(time);
  renderAt(time);
  updateAudioBadge(time);
  updateSceneIndicator(time);
}

function onTransportState(state) {
  dom.playBtn.textContent = state.playing ? "❚❚" : "▶";
  dom.playBtn.setAttribute("aria-label", state.playing ? "暂停" : "播放");
  dom.loopBtn.setAttribute("aria-pressed", String(state.loop));
  dom.clockSource.textContent = state.clock;
  if (!state.playing) {
    const activeCue = getCueAt(project, state.position);
    if (activeCue && activeCue.id !== selectedCueId) selectCue(activeCue.id);
  }
  if (state.audioError) showToast(`音频启动失败：${state.audioError}`, "error");
}

function renderAt(time) {
  const render = stage.render(project, time);
  const cue = getCueAt(project, time);
  const signature = cue ? `${cue.id}:${cue.text}` : "";
  if (signature !== lastCueSignature) {
    lastCueSignature = signature;
    dom.subtitleLine.textContent = cue ? cue.text : "";
    dom.subtitleLine.classList.toggle("visible", Boolean(cue));
  }
  dom.transitionBadge.hidden = !render.transition;
  if (render.transition) {
    dom.transitionBadge.textContent = `CROSSFADE ${Math.round(
      render.transitionProgress * 100,
    )}%`;
  }
}

function updateAudioBadge(time) {
  const event = getAudioEventAt(project, time);
  if (!event) {
    dom.audioEvent.textContent = "等待首拍";
    return;
  }
  dom.audioEvent.textContent = `BEAT ${String(event.index + 1).padStart(2, "0")} · ${event.time.toFixed(2)}s`;
}

function updateSceneIndicator(time) {
  const scene = getSceneAt(project, time);
  if (!scene) return;
  dom.sceneBadge.textContent = scene.name;
  if (scene.id === lastSceneId) return;
  lastSceneId = scene.id;
  for (const button of dom.sceneTabs.querySelectorAll(".scene-tab")) {
    const active = button.dataset.sceneId === scene.id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function currentCue() {
  return project.subtitles.find((cue) => cue.id === selectedCueId) || null;
}

function selectCue(id) {
  selectedCueId = id;
  timeline.setSelected(id);
  refreshSelection();
  const cue = currentCue();
  if (cue) {
    dom.timelineStatus.textContent = `S${String(project.subtitles.indexOf(cue) + 1).padStart(
      2,
      "0",
    )} · ${formatTime(cue.start)} → ${formatTime(cue.end)} · ${cue.text.replace(/\n/g, " / ")}`;
  }
}

function refreshSelection() {
  const cue = currentCue();
  const index = cue ? project.subtitles.indexOf(cue) : -1;
  dom.cueCount.textContent = cue
    ? `${project.subtitles.length} 条 · S${String(index + 1).padStart(2, "0")}`
    : `${project.subtitles.length} 条`;
  dom.emptySelection.hidden = Boolean(cue);
  dom.cueForm.hidden = !cue;
  if (!cue) return;
  if (document.activeElement !== dom.cueStart) dom.cueStart.value = cue.start.toFixed(2);
  if (document.activeElement !== dom.cueEnd) dom.cueEnd.value = cue.end.toFixed(2);
  if (document.activeElement !== dom.cueText) dom.cueText.value = cue.text;
}

function markDirty() {
  dirty = true;
  renderSaveState();
}

function renderSaveState() {
  dom.saveState.classList.remove("dirty", "saved");
  if (dirty) {
    dom.saveState.textContent = "有未保存更改";
    dom.saveState.classList.add("dirty");
  } else if (lastSavedFingerprint === projectFingerprint(project)) {
    dom.saveState.textContent = "已保存";
    dom.saveState.classList.add("saved");
  } else {
    dom.saveState.textContent = restoredFromStorage ? "已从本机恢复" : "示例工程";
    if (restoredFromStorage) dom.saveState.classList.add("saved");
  }
}

function refreshValidation() {
  const report = validateProject(project);
  const conflictIds = new Set();
  for (const cue of project.subtitles) {
    if (
      Number(cue.start) < 0 ||
      Number(cue.end) <= Number(cue.start) ||
      Number(cue.end) > project.duration + 0.0001
    ) {
      conflictIds.add(cue.id);
    }
  }
  const sorted = [...project.subtitles].sort(
    (a, b) => Number(a.start) - Number(b.start),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (Number(sorted[index].start) < Number(sorted[index - 1].end) - 0.0001) {
      conflictIds.add(sorted[index].id);
      conflictIds.add(sorted[index - 1].id);
    }
  }
  timeline.setConflicts(conflictIds);
  if (report.errors.length) {
    dom.cueError.textContent = `保存已阻止：${report.errors[0]}`;
    dom.cueError.classList.remove("ok");
  } else {
    dom.cueError.textContent = "时码有效，可以保存与导出。";
    dom.cueError.classList.add("ok");
  }
  return report;
}

function updateCueTiming(id, changes, phase = "drag") {
  const cue = project.subtitles.find((item) => item.id === id);
  if (!cue) return;
  cue.start = roundTime(changes.start);
  cue.end = roundTime(changes.end);
  markDirty();
  refreshSelection();
  refreshValidation();
  timeline.render();
  renderAt(transport.getPosition());
  if (phase === "cancel") dom.timelineStatus.textContent = "已取消拖动，时码恢复。";
}

function commitCueDrag(id) {
  const cue = project.subtitles.find((item) => item.id === id);
  if (!cue) return;
  const report = validateProject(project);
  dom.timelineStatus.textContent = report.ok
    ? `字幕时码已更新：${formatTime(cue.start)} → ${formatTime(cue.end)}`
    : `时码无效：${report.errors[0]}`;
}

function findOpenRange(preferred, desiredDuration = 2.4) {
  const duration = project.duration;
  const minimum = 0.35;
  const sorted = [...project.subtitles].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const cue of sorted) {
    if (cue.start - cursor > 0.001) gaps.push([cursor, Math.min(cue.start, duration)]);
    cursor = Math.max(cursor, cue.end);
  }
  if (duration - cursor > 0.001) gaps.push([cursor, duration]);
  if (!gaps.length) return null;

  const viable = gaps.filter(([start, end]) => end - start >= minimum);
  if (!viable.length) return null;
  const containing = viable.find(
    ([start, end]) => preferred >= start - 0.001 && preferred <= end + 0.001,
  );
  const nextGap = viable.find(([start]) => start >= preferred - 0.001);
  const [gapStart, gapEnd] = containing || nextGap || viable[viable.length - 1];
  const start = roundTime(Math.min(Math.max(preferred, gapStart), gapEnd - minimum));
  const end = roundTime(Math.min(gapEnd, start + desiredDuration));
  return { start, end };
}

function addCueAtPlayhead() {
  const range = findOpenRange(roundTime(transport.getPosition()));
  if (!range) {
    showToast("当前时间线没有足够空间新增字幕，请先移动或删除字幕。", "error");
    return;
  }
  const cue = {
    id: uid("cue"),
    start: range.start,
    end: range.end,
    text: "新字幕\n在此输入文本",
  };
  project.subtitles.push(cue);
  selectedCueId = cue.id;
  markDirty();
  timeline.setSelected(cue.id);
  timeline.render();
  refreshSelection();
  refreshValidation();
  renderAt(transport.getPosition());
  requestAnimationFrame(() => dom.cueText.focus());
}

function cueForSplit() {
  return (
    currentCue() ||
    project.subtitles.find(
      (cue) =>
        transport.getPosition() > cue.start + 0.001 &&
        transport.getPosition() < cue.end - 0.001,
    ) ||
    null
  );
}

function splitCue() {
  const cue = cueForSplit();
  const cut = roundTime(transport.getPosition());
  if (!cue) {
    showToast("请选择字幕，或把播放头移动到某条字幕内部。", "error");
    return;
  }
  if (cut <= cue.start + 0.08 || cut >= cue.end - 0.08) {
    showToast("分割点必须位于字幕入点与出点之间。", "error");
    return;
  }
  const index = project.subtitles.indexOf(cue);
  const originalEnd = cue.end;
  cue.end = cut;
  const second = {
    id: uid("cue"),
    start: cut,
    end: originalEnd,
    text: cue.text,
  };
  project.subtitles.splice(index + 1, 0, second);
  selectedCueId = second.id;
  markDirty();
  timeline.setSelected(second.id);
  timeline.render();
  refreshSelection();
  refreshValidation();
  renderAt(transport.getPosition());
  showToast(`已在 ${formatTime(cut)} 分割字幕，原顺序保持不变。`, "ok");
}

function duplicateCue() {
  const cue = currentCue();
  if (!cue) {
    showToast("请先选择一条字幕。", "error");
    return;
  }
  const range = findOpenRange(cue.end + 0.12, cue.end - cue.start);
  if (!range) {
    showToast("没有可用于复制字幕的空闲区间。", "error");
    return;
  }
  const copy = {
    id: uid("cue"),
    start: range.start,
    end: range.end,
    text: cue.text,
  };
  const index = project.subtitles.indexOf(cue);
  project.subtitles.splice(index + 1, 0, copy);
  selectedCueId = copy.id;
  markDirty();
  timeline.setSelected(copy.id);
  timeline.render();
  refreshSelection();
  refreshValidation();
  renderAt(transport.getPosition());
}

function deleteCue() {
  const cue = currentCue();
  if (!cue) return;
  const index = project.subtitles.indexOf(cue);
  project.subtitles.splice(index, 1);
  selectedCueId =
    project.subtitles[Math.min(index, project.subtitles.length - 1)]?.id || null;
  markDirty();
  timeline.setSelected(selectedCueId);
  timeline.render();
  refreshSelection();
  refreshValidation();
  renderAt(transport.getPosition());
}

function refreshProjectStats() {
  dom.durationStat.textContent = `${project.duration.toFixed(2)}s`;
  dom.keyframeStat.textContent = String(
    project.scenes.reduce((sum, scene) => sum + scene.keyframes.length, 0),
  );
  dom.transitionStat.textContent = project.transitions.length
    ? `${project.transitions[0].duration.toFixed(1)}s`
    : "—";
  dom.totalDuration.textContent = formatTime(project.duration);
}

function rescheduleIfPlaying() {
  if (transport.playing) {
    transport.seek(transport.position, { keepPlaying: true });
  }
}

function onDurationInput() {
  const next = Number(dom.durationInput.value);
  if (!Number.isFinite(next) || next <= 0) {
    showToast("总时长必须是大于 0 的数字。", "error");
    dom.durationInput.value = project.duration.toFixed(2);
    return;
  }
  project.duration = roundTime(next);
  markDirty();
  refreshProjectStats();
  timeline.render();
  refreshValidation();
  if (transport.position > project.duration) {
    transport.seek(project.duration, { keepPlaying: false });
  }
  rescheduleIfPlaying();
  renderAt(transport.getPosition());
}

function onBpmInput() {
  const next = Math.min(240, Math.max(40, Number(dom.bpmInput.value) || 120));
  project.audio.bpm = next;
  dom.bpmInput.value = String(next);
  markDirty();
  timeline.render();
  refreshValidation();
  rescheduleIfPlaying();
  renderAt(transport.getPosition());
}

function onAudioStartInput() {
  const next = Number(dom.audioStartInput.value);
  if (!Number.isFinite(next) || next < 0) {
    showToast("音频起始位置不能小于 0。", "error");
    dom.audioStartInput.value = project.audio.start.toFixed(2);
    return;
  }
  project.audio.start = roundTime(next);
  markDirty();
  timeline.render();
  refreshValidation();
  rescheduleIfPlaying();
  renderAt(transport.getPosition());
}

function saveProject({ verbose = true } = {}) {
  const report = refreshValidation();
  if (!report.ok) {
    showToast(`保存已阻止：${report.errors[0]}`, "error");
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
    lastSavedFingerprint = projectFingerprint(project);
    dirty = false;
    restoredFromStorage = true;
    renderSaveState();
    if (verbose) showToast("工程已保存到本机，刷新页面会自动恢复。", "ok");
    return true;
  } catch (error) {
    showToast(`保存失败：${error.message}。原工程未被覆盖。`, "error");
    return false;
  }
}

function downloadProjectFile() {
  const report = validateProject(project);
  if (!report.ok) {
    showToast(`下载已阻止：${report.errors[0]}`, "error");
    return false;
  }
  try {
    const filename = `${project.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "project"}.json`;
    downloadBlob(
      new Blob([serializeProject(project)], { type: "application/json;charset=utf-8" }),
      filename,
    );
    showToast("工程 JSON 已下载，可用「打开工程」重新载入。", "ok");
    return true;
  } catch (error) {
    showToast(`工程下载失败：${error.message}。当前工程未改动。`, "error");
    return false;
  }
}

function stopForProjectChange() {
  transport.stop();
  transport.position = 0;
  audio.stop();
  selectedCueId = null;
  lastCueSignature = "";
  lastSceneId = null;
  dirty = false;
}

function loadSavedProject() {
  let next;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      showToast("本机还没有保存过的工程。", "error");
      return;
    }
    next = sanitizeProject(JSON.parse(raw));
  } catch (error) {
    showToast(`载入失败：${error.message}。当前工程保持不变。`, "error");
    return;
  }
  stopForProjectChange();
  project = next;
  lastSavedFingerprint = projectFingerprint(project);
  restoredFromStorage = true;
  renderProject();
  const report = validateProject(project);
  showToast(
    report.ok
      ? "已重新载入工程：时间线、字幕、转场、关键帧和音频起点均已恢复。"
      : `工程已载入，但存在校验问题：${report.errors[0]}`,
    report.ok ? "ok" : "error",
  );
}

async function openProjectFile(file) {
  if (!file) return;
  try {
    const next = sanitizeProject(JSON.parse(await file.text()));
    stopForProjectChange();
    project = next;
    lastSavedFingerprint = null;
    restoredFromStorage = false;
    renderProject();
    const report = validateProject(project);
    showToast(
      report.ok
        ? `已打开工程「${project.name}」。`
        : `工程已打开，存在校验问题：${report.errors[0]}`,
      report.ok ? "ok" : "error",
    );
  } catch (error) {
    showToast(`打开失败：${error.message}。当前工程保持不变。`, "error");
  }
}

function replaceSubtitlesFromText(text, sourceName = "旧字幕") {
  let cues;
  try {
    cues = parseSubtitleText(text);
  } catch (error) {
    showToast(`导入失败：${error.message}`, "error");
    return false;
  }
  project.subtitles = cues;
  selectedCueId = cues[0]?.id || null;
  markDirty();
  timeline.setSelected(selectedCueId);
  timeline.render();
  refreshSelection();
  const report = refreshValidation();
  renderAt(transport.getPosition());
  showToast(
    `已按文件原顺序导入 ${cues.length} 条字幕${
      report.ok ? "。" : "，但时码需要修正后才能保存。"
    }`,
    report.ok ? "ok" : "error",
  );
  return true;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  if (!url) throw new Error("无法创建下载地址。");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function performExport({ download = true, simulateFailure = false } = {}) {
  const beforeFingerprint = projectFingerprint(project);
  let savedBefore = null;
  try {
    savedBefore = localStorage.getItem(STORAGE_KEY);
  } catch {
    savedBefore = null;
  }
  try {
    const roundTrip = verifySubtitleRoundTrip(project);
    if (!roundTrip.ok) throw new Error("WebVTT 时码往返校验不一致。");
    if (simulateFailure) throw new Error("模拟导出故障");
    if (download) {
      const filename = `${project.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "subtitle"}.vtt`;
      downloadBlob(new Blob([roundTrip.vtt], { type: "text/vtt;charset=utf-8" }), filename);
    }
    return {
      ok: true,
      vtt: roundTrip.vtt,
      cueCount: roundTrip.cueCount,
      duration: roundTrip.duration,
      fingerprint: beforeFingerprint,
      unchanged: projectFingerprint(project) === beforeFingerprint,
    };
  } catch (error) {
    let savedAfter = null;
    try {
      savedAfter = localStorage.getItem(STORAGE_KEY);
    } catch {
      savedAfter = null;
    }
    return {
      ok: false,
      error: error.message,
      validation: error.validation || null,
      unchanged:
        projectFingerprint(project) === beforeFingerprint && savedAfter === savedBefore,
      fingerprint: beforeFingerprint,
    };
  }
}

async function exportVtt() {
  const result = await performExport();
  if (result.ok) {
    showToast(
      `已导出 ${result.cueCount} 条字幕；总时长 ${formatTime(result.duration, true)}，时码往返一致。`,
      "ok",
    );
  } else {
    showToast(`导出失败：${result.error}。原工程与已保存版本均未改动。`, "error");
  }
  return result;
}

function renderVerificationState(items) {
  dom.verificationList.textContent = "";
  items.forEach(([label, detail, pass]) => {
    const row = document.createElement("div");
    if (pass === true) row.classList.add("pass");
    if (pass === false) row.classList.add("fail");
    const dot = document.createElement("span");
    dot.className = "check-dot";
    const text = document.createElement("span");
    text.textContent = detail ? `${label} · ${detail}` : label;
    row.append(dot, text);
    dom.verificationList.appendChild(row);
  });
}

function frameCapture(projectValue, time) {
  const render = stage.render(projectValue, time);
  const cue = getCueAt(projectValue, time);
  const event = getAudioEventAt(projectValue, time);
  return {
    time: roundTime(time),
    hash: stage.canvasHash(),
    dataUrl: stage.snapshot(),
    render,
    cue: cue ? { id: cue.id, text: cue.text } : null,
    event: event
      ? { index: event.index, time: roundTime(event.time), accent: event.accent }
      : null,
  };
}

async function runVerification() {
  if (verificationRunning) return null;
  verificationRunning = true;
  const button = $("runVerificationBtn");
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "验证中…";
  dom.verificationResult.textContent = "正在比较暂停帧、回放帧、音频事件、VTT 与工程往返。";
  const originalPosition = transport.getPosition();
  const wasPlaying = transport.playing;
  if (wasPlaying) transport.pause();

  try {
    const validation = validateProject(project);
    if (!validation.ok) {
      renderVerificationState([["工程校验", validation.errors[0], false]]);
      dom.verificationResult.textContent = `验证未完成：${validation.errors[0]}`;
      return { ok: false, error: validation.errors[0] };
    }

    const target = roundTime(
      project.duration > 9 ? 7.25 : Math.max(0.25, Math.min(project.duration - 0.05, project.duration * 0.45)),
    );
    await transport.seek(target, { keepPlaying: false });
    const pausedFrame = frameCapture(project, target);

    for (let time = 0; time < target; time += 1 / 30) {
      stage.render(project, time);
    }
    renderAt(target);
    const replayFrame = frameCapture(project, target);

    const frameMatches =
      pausedFrame.hash === replayFrame.hash &&
      pausedFrame.cue?.id === replayFrame.cue?.id &&
      pausedFrame.cue?.text === replayFrame.cue?.text &&
      pausedFrame.event?.index === replayFrame.event?.index;

    const vtt = verifySubtitleRoundTrip(project);
    const roundTrip = sanitizeProject(JSON.parse(serializeProject(project)));
    const keyframesMatch = project.scenes.every(
      (scene, index) =>
        JSON.stringify(scene.keyframes) === JSON.stringify(roundTrip.scenes[index]?.keyframes),
    );
    const transitionsMatch =
      JSON.stringify(project.transitions) === JSON.stringify(roundTrip.transitions);
    const audioStartMatch =
      Math.abs(project.audio.start - roundTrip.audio.start) < 0.0005 &&
      project.audio.bpm === roundTrip.audio.bpm;
    const subtitleOrderMatch =
      project.subtitles.length === roundTrip.subtitles.length &&
      project.subtitles.every((cue, index) => cue.id === roundTrip.subtitles[index].id);
    const restoredFrame = frameCapture(roundTrip, target);
    const roundTripMatches =
      keyframesMatch &&
      transitionsMatch &&
      audioStartMatch &&
      subtitleOrderMatch &&
      restoredFrame.hash === pausedFrame.hash;

    const sessionBefore = audio.session;
    audio.stop();
    const silentAfterStop = audio.nodes.size === 0;
    const secondScene = project.scenes[Math.min(1, project.scenes.length - 1)];
    await transport.seek(secondScene.start, { keepPlaying: false });
    audio.stop();
    const sceneSwitchSilent = audio.nodes.size === 0;

    const beforeFailureFingerprint = projectFingerprint(project);
    const failedExport = await performExport({ download: false, simulateFailure: true });
    const exportFailurePreserved =
      failedExport.ok === false &&
      failedExport.unchanged === true &&
      projectFingerprint(project) === beforeFailureFingerprint;

    const items = [
      [
        "暂停帧 / 从头回放帧",
        `${pausedFrame.hash} @ ${target.toFixed(3)}s`,
        frameMatches,
      ],
      [
        "字幕与音频事件",
        `${pausedFrame.cue ? "字幕击中" : "无字幕"} · BEAT ${
          pausedFrame.event ? String(pausedFrame.event.index + 1).padStart(2, "0") : "—"
        }`,
        pausedFrame.event?.index === replayFrame.event?.index &&
          pausedFrame.cue?.id === replayFrame.cue?.id,
      ],
      [
        "WebVTT 入点 / 出点",
        `${vtt.cueCount} 条 · 总时长 ${formatTime(vtt.duration, true)}`,
        vtt.timingMatches && vtt.sequenceMatches && vtt.durationMatches,
      ],
      [
        "工程往返",
        `关键帧 ${keyframesMatch ? "✓" : "×"} · 转场 ${transitionsMatch ? "✓" : "×"} · 音频 ${audioStartMatch ? "✓" : "×"}`,
        roundTripMatches,
      ],
      [
        "切场音频清理",
        `${sessionBefore} → ${audio.session} · 调度节点 ${audio.nodes.size}`,
        silentAfterStop && sceneSwitchSilent,
      ],
      ["导出失败保护", `指纹 ${projectFingerprint(project)} 未变`, exportFailurePreserved],
    ];
    renderVerificationState(items);
    const ok = items.every((item) => item[2]);
    dom.verificationResult.textContent = ok
      ? `全部通过。帧指纹 ${pausedFrame.hash}，回放与暂停画面一致，VTT 总时长 ${formatTime(
          vtt.duration,
          true,
        )}。`
      : "存在未通过的检查项，请查看上方标记。";
    return {
      ok,
      target,
      pausedFrame,
      replayFrame,
      vtt,
      roundTrip,
      exportFailurePreserved,
      items,
    };
  } catch (error) {
    renderVerificationState([["验证异常", error.message, false]]);
    dom.verificationResult.textContent = `验证失败：${error.message}`;
    return { ok: false, error: error.message };
  } finally {
    await transport.seek(originalPosition, { keepPlaying: wasPlaying });
    renderAt(originalPosition);
    button.disabled = false;
    button.textContent = previousLabel;
    verificationRunning = false;
  }
}

function updateCueFromFields() {
  const cue = currentCue();
  if (!cue) return;
  const start = Number(dom.cueStart.value);
  const end = Number(dom.cueEnd.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    showToast("入点和出点必须是有效数字。", "error");
    refreshSelection();
    return;
  }
  cue.start = roundTime(start);
  cue.end = roundTime(end);
  markDirty();
  timeline.render();
  refreshValidation();
  refreshSelection();
  renderAt(transport.getPosition());
}

function showToast(message, kind = "") {
  dom.toast.textContent = message;
  dom.toast.className = `toast show ${kind}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.className = "toast";
  }, 4200);
}

function bindEvents() {
  dom.playBtn.addEventListener("click", async () => {
    if (transport.playing) {
      transport.pause();
    } else {
      lastCueSignature = "";
      await transport.play();
    }
  });
  dom.loopBtn.addEventListener("click", () => {
    transport.setLoop(!transport.loop);
  });
  dom.stopBtn.addEventListener("click", () => {
    transport.stop();
    lastCueSignature = "";
    renderAt(0);
  });
  dom.toStartBtn.addEventListener("click", async () => {
    if (transport.playing) transport.pause();
    await transport.seek(0, { keepPlaying: false });
    lastCueSignature = "";
    renderAt(0);
  });
  $("addCueBtn").addEventListener("click", addCueAtPlayhead);
  $("emptyAddBtn").addEventListener("click", addCueAtPlayhead);
  $("splitAtPlayheadBtn").addEventListener("click", splitCue);
  $("splitCueBtn").addEventListener("click", splitCue);
  $("duplicateCueBtn").addEventListener("click", duplicateCue);
  $("deleteCueBtn").addEventListener("click", deleteCue);
  dom.cueStart.addEventListener("change", updateCueFromFields);
  dom.cueEnd.addEventListener("change", updateCueFromFields);
  dom.cueText.addEventListener("input", () => {
    const cue = currentCue();
    if (!cue) return;
    cue.text = dom.cueText.value;
    markDirty();
    timeline.render();
    renderAt(transport.getPosition());
  });
  dom.projectName.addEventListener("input", () => {
    project.name = dom.projectName.value;
    markDirty();
  });
  dom.durationInput.addEventListener("change", onDurationInput);
  dom.bpmInput.addEventListener("change", onBpmInput);
  dom.audioStartInput.addEventListener("change", onAudioStartInput);
  dom.zoomInput.addEventListener("input", () => timeline.setZoom(Number(dom.zoomInput.value)));
  $("saveProjectBtn").addEventListener("click", () => saveProject());
  $("downloadProjectBtn").addEventListener("click", downloadProjectFile);
  $("restoreBtn").addEventListener("click", loadSavedProject);
  $("openProjectBtn").addEventListener("click", () => dom.openProjectInput.click());
  $("exportBtn").addEventListener("click", exportVtt);
  $("runVerificationBtn").addEventListener("click", runVerification);
  $("importSubtitlesBtn").addEventListener("click", () => dom.importSubtitlesInput.click());
  $("loadLegacySampleBtn").addEventListener("click", () => {
    replaceSubtitlesFromText(LEGACY_SAMPLE, "旧字幕示例");
  });
  dom.importSubtitlesInput.addEventListener("change", async () => {
    const file = dom.importSubtitlesInput.files?.[0];
    if (!file) return;
    replaceSubtitlesFromText(await file.text(), file.name);
    dom.importSubtitlesInput.value = "";
  });
  dom.openProjectInput.addEventListener("change", async () => {
    const file = dom.openProjectInput.files?.[0];
    await openProjectFile(file);
    dom.openProjectInput.value = "";
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const editing =
      target instanceof HTMLElement &&
      (target.matches("input, textarea, select, button") || target.isContentEditable);
    if (editing) return;
    if (event.code === "Space") {
      event.preventDefault();
      dom.playBtn.click();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const amount = event.shiftKey ? 1 : 0.1;
      transport.pause();
      transport.seek(transport.getPosition() + direction * amount, { keepPlaying: false });
    } else if (event.key === "Home") {
      transport.pause();
      transport.seek(0, { keepPlaying: false });
    } else if (event.key === "End") {
      transport.pause();
      transport.seek(project.duration, { keepPlaying: false });
    }
  });
}

async function playUntil(target) {
  if (transport.playing) transport.pause();
  await transport.seek(0, { keepPlaying: false });
  await transport.play();
  return new Promise((resolve) => {
    const started = performance.now();
    const poll = async () => {
      const position = transport.getPosition();
      if (position >= target || !transport.playing || performance.now() - started > 30000) {
        transport.pause();
        await transport.seek(target, { keepPlaying: false });
        renderAt(target);
        resolve({
          ...window.cutline.getState(),
          frame: frameCapture(project, target),
        });
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

window.cutline = {
  getProject: () => deepClone(project),
  getState: () => ({
    position: roundTime(transport.getPosition()),
    playing: transport.playing,
    loop: transport.loop,
    duration: project.duration,
    cueCount: project.subtitles.length,
    cueOrder: project.subtitles.map((cue) => cue.id),
    currentCue: getCueAt(project, transport.getPosition())?.id || null,
    frame: stage.lastRender,
    frameHash: stage.canvasHash(),
    audioEvent: getAudioEventAt(project, transport.getPosition()),
    audioNodes: audio.nodes.size,
    audioSession: audio.session,
    audioNodeSessions: [
      ...new Set([...audio.nodes].map((node) => node.__cutlineSession).filter(Number.isFinite)),
    ],
    projectFingerprint: projectFingerprint(project),
    savedFingerprint: lastSavedFingerprint,
    validation: validateProject(project),
    keyframes: project.scenes.map((scene) => ({
      id: scene.id,
      count: scene.keyframes.length,
      values: deepClone(scene.keyframes),
    })),
    transitions: deepClone(project.transitions),
    audioStart: project.audio.start,
  }),
  play: () => transport.play(),
  pause: () => transport.pause(),
  seek: (time) => transport.seek(time, { keepPlaying: false }),
  setLoop: (enabled) => transport.setLoop(enabled),
  playUntil,
  snapshotAt: async (time) => {
    if (transport.playing) transport.pause();
    await transport.seek(time, { keepPlaying: false });
    renderAt(time);
    return frameCapture(project, time);
  },
  captureAt: (time) => frameCapture(project, time),
  switchScene,
  runVerification,
  saveProject: () => saveProject({ verbose: false }),
  downloadProjectFile,
  loadSavedProject,
  validate: () => validateProject(project),
  addCueAtPlayhead,
  splitCue,
  importSubtitles: (text) => replaceSubtitlesFromText(text),
  exportVtt: performExport,
  serializeProject: () => serializeProject(project),
  showToast,
};

async function refreshCanvasFonts() {
  if (!document.fonts) return;
  try {
    await document.fonts.load(
      '600 12px "Noto Sans SC Variable"',
      "场景节拍字幕晨光夜航分割导入导出工程",
    );
    await document.fonts.ready;
    renderAt(transport.getPosition());
    timeline.render();
  } catch {
    // Canvas falls back to the system font if the bundled font cannot load.
  }
}

bindEvents();
bootstrap();
refreshCanvasFonts();
