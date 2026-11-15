import { AmbientAudioEngine } from "./audio.js";
import { PlaybackClock } from "./clock.js";
import {
  formatShort,
  formatTimecode,
  normalizeProject,
  roundTime,
  sampleAt,
  sortedCuts,
  validateProject,
} from "./core.js";
import { createDefaultProject } from "./defaults.js";
import { ProgramExporter, downloadBlob, projectFingerprint } from "./exporter.js";
import { StageRenderer, interpolateCameraPose } from "./renderer.js";

const STORAGE_KEY = "night-orbit-project-v1";
const $ = (id) => document.getElementById(id);

function loadStoredProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultProject();
    return normalizeProject(JSON.parse(raw));
  } catch (error) {
    console.warn("Saved project could not be restored.", error);
    return createDefaultProject();
  }
}

let project = loadStoredProject();
const renderer = new StageRenderer();
const audio = new AmbientAudioEngine();
const clock = new PlaybackClock(project, audio);

const state = {
  time: Number(project.ui?.playhead) || project.inPoint,
  selectedCutId: project.ui?.selectedCutId || project.cuts[1]?.id || project.cuts[0].id,
  zoom: Math.max(1, Number(project.ui?.zoom) || 1),
  playing: false,
  lastRenderedFrame: -1,
  lastMonitorFrame: -1,
  lastBeat: -1,
  savingTimer: null,
  dragging: false,
  exporting: false,
  compareBusy: false,
  audioRestarting: false,
  timelineWidth: 960,
  programFrameHash: null,
};

const cameraCanvases = new Map();
const exporter = new ProgramExporter({
  renderer,
  audio,
  onProgress: updateExportProgress,
});

function selectedCut() {
  return project.cuts.find((cut) => cut.id === state.selectedCutId) || project.cuts[0];
}

function selectedCutIndex() {
  return project.cuts.findIndex((cut) => cut.id === selectedCut().id);
}

function activeCameraAt(t = state.time) {
  return sampleAt(project, t).activeCamera;
}

function toast(message, type = "info", duration = 2800) {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.innerHTML = `<i></i><span>${message}</span>`;
  $("toastStack").appendChild(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 200);
  }, duration);
}

function setSaveState(label, saving = false) {
  $("saveState").textContent = label;
  $("saveState").parentElement.classList.toggle("saving", saving);
}

function snapshotProject() {
  const snapshot = JSON.parse(JSON.stringify(project));
  snapshot.updatedAt = new Date().toISOString();
  snapshot.ui = {
    playhead: state.time,
    zoom: state.zoom,
    selectedCutId: state.selectedCutId,
  };
  return snapshot;
}

function saveToStorage() {
  try {
    const snapshot = snapshotProject();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    project.updatedAt = snapshot.updatedAt;
    project.ui = snapshot.ui;
    setSaveState("已保存");
  } catch (error) {
    setSaveState("保存失败");
    toast("本地保存失败，请下载工程备份", "error");
    console.warn(error);
  }
}

function scheduleSave() {
  setSaveState("保存中", true);
  clearTimeout(state.savingTimer);
  state.savingTimer = setTimeout(saveToStorage, 260);
}

function markDirty({ save = true } = {}) {
  if (save) scheduleSave();
  renderInspector();
  renderTimeline();
}

function setCurrentTime(value, { seekMedia = false, force = false } = {}) {
  const target = roundTime(
    Math.max(project.inPoint, Math.min(project.outPoint, Number(value) || 0)),
    project.fps,
  );
  state.time = target;
  if (seekMedia && clock.playing) {
    void clock.seek(target);
  } else if (seekMedia) {
    clock.time = target;
  }
  if (force) state.lastRenderedFrame = -1;
}

function snapToBeat(seconds) {
  const beat = 60 / project.audio.bpm;
  const offset = (seconds - project.audio.start) / beat;
  let target = project.audio.start + Math.round(offset) * beat;
  target = Math.max(project.inPoint, Math.min(project.outPoint - 1 / project.fps, target));
  return roundTime(target, project.fps);
}

function findCutAt(time) {
  return project.cuts.find((cut) => Math.abs(cut.t - time) < 0.5 / project.fps) || null;
}

function addOrUpdateCut(cameraId, time = state.time, source = "camera") {
  const snapped = Math.abs(time - project.inPoint) < 0.5 / project.fps
    ? project.inPoint
    : snapToBeat(time);
  if (snapped >= project.outPoint - 1 / project.fps) {
    toast("出点前没有可用的节拍切点", "error");
    return null;
  }
  const existing = findCutAt(snapped);
  if (existing) {
    existing.camera = cameraId;
    state.selectedCutId = existing.id;
    markDirty();
    renderFrame(true);
    toast(`切点已更新为 CAM ${cameraId}`);
    return existing;
  }
  const template = selectedCut()?.transition || { type: "dissolve", duration: 0.55 };
  const cut = {
    id: `cut-${Date.now().toString(36)}`,
    t: snapped,
    camera: cameraId,
    transition: {
      type: template.type === "none" ? "dissolve" : template.type,
      duration: template.duration || 0.55,
    },
  };
  project.cuts.push(cut);
  project.cuts.sort((a, b) => a.t - b.t);
  state.selectedCutId = cut.id;
  if (!clock.playing) setCurrentTime(snapped);
  markDirty();
  renderFrame(true);
  toast(
    source === "cycle"
      ? `已在 ${formatShort(snapped)} 切到 CAM ${cameraId}`
      : `CAM ${cameraId} 已切入 · 吸附至节拍`,
  );
  return cut;
}

function deleteSelectedCut() {
  if (project.cuts.length <= 1) {
    toast("时间线至少保留一个镜头", "error");
    return;
  }
  const index = selectedCutIndex();
  const cut = project.cuts[index];
  if (Math.abs(cut.t - project.inPoint) < 1 / project.fps) {
    toast("不能删除入点镜头", "error");
    return;
  }
  project.cuts.splice(index, 1);
  const next = project.cuts[Math.max(0, index - 1)];
  state.selectedCutId = next.id;
  markDirty();
  renderFrame(true);
  toast("切点已删除，工程可撤销前请先保存");
}

function applyTransition(type) {
  const cut = selectedCut();
  if (!cut || Math.abs(cut.t - project.inPoint) < 1 / project.fps) {
    toast("入点镜头不需要入转场", "error");
    return;
  }
  cut.transition.type = type;
  markDirty();
  renderFrame(true);
}

function applyTransitionDuration(value) {
  const cut = selectedCut();
  if (!cut) return;
  cut.transition.duration = Number(value);
  markDirty({ save: false });
  scheduleSave();
  renderFrame(true);
}

function recordKeyframe() {
  const cameraId = activeCameraAt();
  const camera = project.cameras.find((item) => item.id === cameraId);
  if (!camera) return;
  const pose = interpolateCameraPose(camera, state.time);
  const existing = camera.keyframes.find(
    (key) => Math.abs(key.t - state.time) < 0.5 / project.fps,
  );
  const key = {
    t: roundTime(state.time, project.fps),
    position: { ...pose.position },
    target: { ...pose.target },
    fov: pose.fov,
  };
  if (existing) Object.assign(existing, key);
  else camera.keyframes.push(key);
  camera.keyframes.sort((a, b) => a.t - b.t);
  markDirty();
  renderFrame(true);
  toast(`CAM ${cameraId} 关键帧已记录 · ${camera.keyframes.length} KF`);
}

function renderCameraBank() {
  const grid = $("cameraGrid");
  grid.innerHTML = "";
  cameraCanvases.clear();
  project.cameras.forEach((camera) => {
    const button = document.createElement("button");
    button.className = "camera-card";
    button.dataset.camera = camera.id;
    button.style.setProperty("--camera-accent", camera.color);
    button.setAttribute("aria-label", `切换到 ${camera.name}`);
    button.innerHTML = `
      <canvas width="480" height="270"></canvas>
      <span class="camera-card-top"><span>${camera.name}</span><b>${camera.role}</b></span>
      <span class="camera-focus"></span>
      <span class="camera-card-bottom"><span>${camera.lens}</span><span>${camera.keyframes.length} KF</span></span>
    `;
    const canvas = button.querySelector("canvas");
    cameraCanvases.set(camera.id, canvas);
    button.addEventListener("click", () => {
      addOrUpdateCut(camera.id, state.time);
      flashViewer();
    });
    grid.appendChild(button);
  });
}

function renderSceneTabs() {
  const tabs = $("sceneTabs");
  tabs.innerHTML = "";
  project.scenes.forEach((scene, index) => {
    const button = document.createElement("button");
    button.className = `scene-tab ${scene.id === project.activeScene ? "active" : ""}`;
    button.style.setProperty("--swatch", scene.colors[0]);
    button.innerHTML = `<i></i><span>${scene.name}</span><small>0${index + 1}</small>`;
    button.addEventListener("click", async () => {
      if (project.activeScene === scene.id) return;
      project.activeScene = scene.id;
      markDirty();
      renderSceneTabs();
      renderFrame(true);
      if (clock.playing) {
        await clock.restartAudioAtCurrent();
        toast(`${scene.name}场景已切换 · 旧场景音频已停止`);
      } else {
        toast(`${scene.name}场景已切换 · 关键帧保持不变`);
      }
    });
    tabs.appendChild(button);
  });
  const scene = project.scenes.find((item) => item.id === project.activeScene);
  $("sceneLabel").textContent = scene.code;
  $("sceneNote").textContent = scene.note;
  $("sceneSwatch").style.setProperty("--scene-a", scene.colors[0]);
  $("sceneSwatch").style.setProperty("--scene-b", scene.colors[1]);
  $("sceneSwatch").style.setProperty("--scene-c", scene.colors[2]);
}

function flashViewer() {
  const hit = $("viewerHit");
  hit.classList.remove("flash");
  void hit.offsetWidth;
  hit.classList.add("flash");
}

function renderInspector() {
  const cut = selectedCut();
  const index = Math.max(0, selectedCutIndex());
  const firstCut = Math.abs(cut.t - project.inPoint) < 1 / project.fps;
  $("selectedCutLabel").textContent = `CUT ${String(index + 1).padStart(2, "0")}`;
  $("cutCameraName").textContent = `CAM ${cut.camera}`;
  $("cutTime").textContent = formatTimecode(cut.t, project.fps);
  const duration = firstCut ? 0 : cut.transition.duration;
  $("transitionValue").textContent = firstCut ? "无入转场" : `${duration.toFixed(2)}s`;
  $("transitionDuration").value = String(duration || 0.55);
  $("transitionDuration").disabled = firstCut;
  $("transStartLabel").textContent = formatShort(cut.t);
  $("transEndLabel").textContent = formatShort(Math.min(project.outPoint, cut.t + duration));
  $("transitionBar").style.width = firstCut
    ? "0%"
    : `${Math.min(100, (duration / 1.2) * 100)}%`;
  document.querySelectorAll("#transitionTypes button").forEach((button) => {
    button.classList.toggle("active", button.dataset.type === cut.transition.type);
    button.disabled = firstCut;
  });

  renderSceneTabs();
  const activeCamera = project.cameras.find((camera) => camera.id === activeCameraAt());
  $("keyframeCamera").textContent = activeCamera.name;
  $("keyframeCount").textContent = `${String(
    project.cameras.reduce((sum, camera) => sum + camera.keyframes.length, 0),
  ).padStart(2, "0")} KF`;
  const dots = $("keyframeDots");
  dots.innerHTML = "";
  activeCamera.keyframes.forEach((key) => {
    const dot = document.createElement("i");
    const ratio = (key.t - project.inPoint) / Math.max(0.001, project.outPoint - project.inPoint);
    dot.style.left = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    dot.title = `${formatShort(key.t)} · CAM ${activeCamera.id}`;
    dots.appendChild(dot);
  });

  $("bpmValue").textContent = String(project.audio.bpm);
  $("audioStartValue").textContent = formatShort(project.audio.start);
  $("audioStartHint").textContent = `${formatShort(project.audio.start)} · 已随工程保存`;
  $("audioStart").max = String(Math.max(0.1, project.outPoint));
  $("audioStart").value = String(project.audio.start);
  $("inLabel").textContent = formatShort(project.inPoint);
  $("outLabel").textContent = formatShort(project.outPoint);
  $("totalTime").textContent = formatTimecode(project.outPoint - project.inPoint, project.fps);

  const selectedCamera = project.cameras.find((camera) => camera.id === cut.camera);
  $("activeCamLabel").textContent = activeCameraAt();
  $("viewerAudio").textContent = `AUDIO ${project.audio.bpm} BPM`;
  $("viewerScene").textContent = sampleAt(project, state.time).transition.active
    ? "TRANSITION"
    : `LIVE · ${selectedCamera.role}`;
  $("projectTitle").textContent = project.title;
  document.title = `${project.title} — Night Orbit Studio`;
}

function layoutTimeline() {
  const scroller = $("timelineScroll");
  const available = Math.max(760, scroller.clientWidth);
  const width = Math.round(available * state.zoom);
  state.timelineWidth = width;
  $("timelineCanvas").style.width = `${width}px`;
  $("timelineZoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
}

function timeToPercent(time) {
  const duration = Math.max(0.001, project.outPoint - project.inPoint);
  return ((time - project.inPoint) / duration) * 100;
}

function renderRuler() {
  const ruler = $("ruler");
  ruler.innerHTML = "";
  const duration = project.outPoint - project.inPoint;
  const interval = state.timelineWidth > 1500 ? 0.5 : state.timelineWidth > 1100 ? 1 : 2;
  for (let offset = 0; offset <= duration + 1e-6; offset += interval) {
    const time = project.inPoint + offset;
    const tick = document.createElement("div");
    const major = Math.abs(offset % (interval * 2)) < 1e-6;
    tick.className = `ruler-tick ${major ? "major" : "minor"}`;
    tick.style.left = `${timeToPercent(time)}%`;
    tick.innerHTML = `<span>${formatShort(time)}</span>`;
    ruler.appendChild(tick);
  }
}

function renderCutTrack() {
  const track = $("cutTrack");
  track.innerHTML = "";
  const cuts = sortedCuts(project);
  cuts.forEach((cut, index) => {
    const end = index < cuts.length - 1 ? cuts[index + 1].t : project.outPoint;
    const startPct = timeToPercent(cut.t);
    const widthPct = timeToPercent(end) - startPct;
    const camera = project.cameras.find((item) => item.id === cut.camera);
    const block = document.createElement("button");
    block.className = `shot-block ${cut.id === state.selectedCutId ? "selected" : ""}`;
    block.dataset.cutId = cut.id;
    block.style.setProperty("--shot-color", camera.color);
    block.style.left = `calc(${startPct}% + 1px)`;
    block.style.width = `calc(${Math.max(0.1, widthPct)}% - 2px)`;
    const transition = cut.transition.type === "none"
      ? "CUT"
      : `${cut.transition.type.toUpperCase()} ${cut.transition.duration.toFixed(2)}s`;
    block.innerHTML = `
      <span class="shot-cam">${cut.camera}</span>
      <span class="shot-meta">${transition}</span>
      ${widthPct > 6 ? `<span class="shot-meta">${(end - cut.t).toFixed(2)}s</span>` : ""}
      <span class="shot-trim"></span>
    `;
    block.title = `${camera.name} · ${formatTimecode(cut.t, project.fps)} → ${formatTimecode(end, project.fps)}`;
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedCutId = cut.id;
      setCurrentTime(cut.t, { seekMedia: clock.playing });
      renderInspector();
      renderCutTrack();
      renderFrame(true);
    });
    track.appendChild(block);

    if (index > 0 && cut.transition.type !== "none" && cut.transition.duration > 0) {
      const mark = document.createElement("div");
      mark.className = "transition-mark";
      mark.style.left = `${timeToPercent(cut.t)}%`;
      mark.style.width = `${timeToPercent(cut.t + cut.transition.duration) - timeToPercent(cut.t)}%`;
      mark.title = `${cut.transition.type} ${cut.transition.duration.toFixed(2)}s`;
      track.appendChild(mark);
    }
  });
}

function renderTitleTrack() {
  const track = $("titleTrack");
  track.innerHTML = "";
  project.subtitles.forEach((subtitle) => {
    const block = document.createElement("div");
    block.className = "title-block";
    const start = timeToPercent(subtitle.start);
    const end = timeToPercent(subtitle.end);
    block.style.left = `calc(${start}% + 1px)`;
    block.style.width = `calc(${Math.max(0.4, end - start)}% - 2px)`;
    block.textContent = subtitle.text;
    block.title = `${formatTimecode(subtitle.start, project.fps)} → ${formatTimecode(subtitle.end, project.fps)}`;
    block.addEventListener("click", () => {
      setCurrentTime(subtitle.start, { seekMedia: clock.playing });
      renderFrame(true);
    });
    track.appendChild(block);
  });
  document.querySelectorAll(".track-label")[2].querySelector("small").textContent =
    `${project.subtitles.length} CLIPS`;
}

function drawWaveform() {
  const canvas = $("waveformCanvas");
  const width = Math.max(1, Math.round(state.timelineWidth));
  const height = 86;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  const duration = project.outPoint - project.inPoint;
  const y = height / 2;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(141,255,186,0.08)");
  gradient.addColorStop(0.5, "rgba(141,255,186,0.22)");
  gradient.addColorStop(1, "rgba(141,255,186,0.08)");
  ctx.fillStyle = gradient;
  for (let pixel = 0; pixel < width; pixel += 2) {
    const time = project.inPoint + (pixel / width) * duration;
    const beat = Math.abs(Math.sin(time * Math.PI * (project.audio.bpm / 60)));
    const drift = Math.sin(time * 2.3) * 0.18 + Math.sin(time * 0.71) * 0.14;
    const amplitude = 3 + beat * 12 + Math.abs(drift) * 24;
    ctx.fillRect(pixel, y - amplitude / 2, 1, amplitude);
  }
  const beatDuration = 60 / project.audio.bpm;
  ctx.strokeStyle = "rgba(141,255,186,0.19)";
  ctx.lineWidth = 1;
  for (
    let beatTime = project.audio.start;
    beatTime <= project.outPoint + 1e-6;
    beatTime += beatDuration
  ) {
    const x = ((beatTime - project.inPoint) / duration) * width;
    const beatNumber = Math.round((beatTime - project.audio.start) / beatDuration);
    const downbeat = beatNumber % project.audio.beatsPerBar === 0;
    ctx.strokeStyle = downbeat ? "rgba(141,255,186,0.5)" : "rgba(141,255,186,0.18)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    const locked = project.cuts.some((cut) => Math.abs(cut.t - beatTime) < 1 / project.fps);
    if (locked) {
      ctx.fillStyle = "#d9ff63";
      ctx.beginPath();
      ctx.arc(x, 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "rgba(141,255,186,0.48)";
  ctx.font = "6px 'DM Mono', monospace";
  ctx.fillText(`${project.audio.bpm} BPM · SYNTH AMBIENCE`, 8, 84);
}

function renderTimeline() {
  layoutTimeline();
  renderRuler();
  renderCutTrack();
  renderTitleTrack();
  drawWaveform();
  $("playhead").style.left = `${timeToPercent(state.time)}%`;
  $("inMarker").style.left = "0%";
  $("outMarker").style.left = "100%";
  $("loopButton").classList.toggle("active", project.loop);
}

function updatePlayUI() {
  const playing = clock.playing;
  state.playing = playing;
  $("playPause").classList.toggle("is-playing", playing);
  $("playPause").setAttribute("aria-label", playing ? "暂停" : "播放");
  $("audioMeter").classList.toggle("playing", playing);
  $("viewerStatus");
}

function updateMeter(sample) {
  const levels = document.querySelectorAll("#audioMeter i");
  const liveLevel = clock.playing ? audio.meter() : 0;
  levels.forEach((bar, index) => {
    const wave = Math.abs(Math.sin((sample.t + index * 0.065) * Math.PI * 1.8));
    const height = 3 + wave * 13 + sample.beat.pulse * 11 + liveLevel * 13;
    bar.style.height = `${Math.min(28, height)}px`;
    bar.style.setProperty(
      "--meter-color",
      sample.beat.beatInBar === 0 ? "#d9ff63" : index % 4 === 0 ? "#8dffba" : "#67c88c",
    );
  });
}

function renderFrame(force = false) {
  const sample = sampleAt(project, state.time);
  const frameKey = Math.round((state.time - project.inPoint) * project.fps);
  if (force || state.lastRenderedFrame !== frameKey) {
    renderer.renderProgram($("programCanvas").getContext("2d"), project, state.time, 1280, 720);
    state.lastRenderedFrame = frameKey;
  }
  const monitorDue =
    force || state.lastMonitorFrame < 0 || frameKey - state.lastMonitorFrame >= 2;
  if (monitorDue) {
    cameraCanvases.forEach((canvas, cameraId) => {
      renderer.renderPreview(canvas.getContext("2d"), project, cameraId, state.time, 480, 270);
    });
    state.lastMonitorFrame = frameKey;
  }
  document.querySelectorAll(".camera-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.camera === sample.activeCamera);
  });
  $("activeCamLabel").textContent = sample.activeCamera;
  $("viewerTimecode").textContent = formatTimecode(state.time, project.fps);
  $("currentTime").textContent = formatTimecode(state.time, project.fps);
  $("playhead").style.left = `${timeToPercent(state.time)}%`;
  $("viewerScene").textContent = sample.transition.active
    ? `TRANSITION ${sample.outgoingCamera} → ${sample.activeCamera}`
    : `LIVE · CAM ${sample.activeCamera}`;
  $("viewerAudio").textContent = sample.beat.audible
    ? `BEAT ${String(Math.max(0, sample.beat.beatIndex) + 1).padStart(2, "0")} · ${project.audio.bpm} BPM`
    : "AUDIO WAITING";
  if (
    sample.beat.beatIndex >= 0 &&
    sample.beat.beatIndex !== state.lastBeat &&
    clock.playing
  ) {
    state.lastBeat = sample.beat.beatIndex;
    flashViewer();
  }
  updateMeter(sample);
  updatePlayUI();
}

async function togglePlayback() {
  if (state.exporting) return;
  if (clock.playing) {
    const pausedAt = clock.pause();
    setCurrentTime(pausedAt, { force: true });
    updatePlayUI();
    renderFrame(true);
    scheduleSave();
    return;
  }
  if (clock.time >= project.outPoint - 1 / project.fps) {
    await seekTo(project.inPoint);
  }
  await clock.play();
  state.lastBeat = -1;
  updatePlayUI();
  renderFrame(true);
}

async function seekTo(time, { save = true } = {}) {
  const target = Math.max(project.inPoint, Math.min(project.outPoint, time));
  if (clock.playing) await clock.seek(target);
  else clock.time = roundTime(target, project.fps);
  state.time = clock.time;
  state.lastRenderedFrame = -1;
  state.lastMonitorFrame = -1;
  renderFrame(true);
  if (save) scheduleSave();
}

function seekFromPointer(event) {
  const ruler = $("ruler");
  const rect = ruler.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const time =
    project.inPoint + fraction * Math.max(0.001, project.outPoint - project.inPoint);
  void seekTo(time, { save: false });
}

function animationLoop() {
  if (clock.playing) {
    const raw = clock.nowRaw();
    if (raw >= project.outPoint - 1 / (project.fps * 2)) {
      if (project.loop) {
        state.time = project.outPoint;
        renderFrame(true);
        void clock.loopToStart();
      } else {
        clock.pause();
        state.time = project.outPoint;
        updatePlayUI();
        renderFrame(true);
        scheduleSave();
      }
    } else {
      state.time = clock.now();
      renderFrame();
    }
  }
  requestAnimationFrame(animationLoop);
}

async function switchScene(sceneId) {
  if (project.activeScene === sceneId) return;
  project.activeScene = sceneId;
  markDirty();
  renderSceneTabs();
  renderFrame(true);
  if (clock.playing) {
    await clock.restartAudioAtCurrent();
  }
}

function jumpToCut(direction) {
  const cuts = sortedCuts(project);
  const candidates =
    direction < 0
      ? cuts.filter((cut) => cut.t < state.time - 1 / project.fps)
      : cuts.filter((cut) => cut.t > state.time + 1 / project.fps);
  const target =
    direction < 0
      ? candidates[candidates.length - 1]
      : candidates[0];
  if (target) {
    state.selectedCutId = target.id;
    void seekTo(target.t);
    renderInspector();
    renderCutTrack();
  }
}

async function cycleCutAtPlayhead() {
  const snapped = snapToBeat(state.time);
  const existing = findCutAt(snapped);
  const currentIndex = project.cameras.findIndex(
    (camera) => camera.id === (existing?.camera || activeCameraAt()),
  );
  const next = project.cameras[(currentIndex + 1) % project.cameras.length];
  addOrUpdateCut(next.id, snapped, "cycle");
}

function updateExportProgress({ progress, status }) {
  $("exportProgress").hidden = false;
  const percent = Math.round(progress * 100);
  $("exportBar").style.width = `${percent}%`;
  $("exportPercent").textContent = `${percent}%`;
  $("exportStatus").textContent = status;
}

function renderExportSummary() {
  const validation = validateProject(project);
  const duration = project.outPoint - project.inPoint;
  const frames = Math.round(duration * project.fps);
  $("exportRange").textContent = `${formatShort(project.inPoint)} → ${formatShort(project.outPoint)}`;
  $("exportDuration").textContent = `${formatShort(duration)} / ${frames}f`;
  $("exportShots").textContent = `${project.cuts.length} CUTS · ${project.cameras.length} CAM`;
  $("integrityText").textContent = validation.valid
    ? `入点、出点、${project.subtitles.length} 条字幕与 ${project.cuts.length} 个切点已对齐；音频起点 ${formatShort(project.audio.start)}。`
    : validation.issues.join("；");
  $("startExport").disabled = !validation.valid;
}

function openExportModal() {
  clearTimeout(state.savingTimer);
  saveToStorage();
  renderExportSummary();
  $("exportResult").hidden = true;
  $("exportProgress").hidden = true;
  $("startExport").hidden = false;
  $("startExport").disabled = false;
  $("exportModal").hidden = false;
}

function closeExportModal() {
  if (state.exporting) return;
  $("exportModal").hidden = true;
}

async function runExport() {
  if (state.exporting) return;
  const includeVideo = $("exportVideo").checked;
  const includeShots = $("exportShots").checked;
  if (!includeVideo && !includeShots) {
    toast("请至少选择一种交付文件", "error");
    return;
  }
  if (clock.playing) {
    setCurrentTime(clock.pause(), { force: true });
  }
  clock.time = state.time;
  const originalFingerprint = await projectFingerprint(project);
  state.exporting = true;
  $("startExport").disabled = true;
  $("startExport").textContent = "正在导出…";
  $("exportResult").hidden = true;
  $("exportProgress").hidden = false;
  $("exportModal").querySelector(".modal-close").disabled = true;
  $("exportBar").style.width = "1%";
  $("exportPercent").textContent = "0%";
  try {
    const result = await exporter.run(project, {
      video: includeVideo,
      shots: includeShots,
    });
    const currentFingerprint = await projectFingerprint(project);
    const preserved = currentFingerprint === originalFingerprint;
    $("exportResult").hidden = false;
    $("exportResult").innerHTML = `
      <b>导出完成</b> · ${result.manifest.range.timecodeIn} → ${result.manifest.range.timecodeOut}<br>
      时长 ${formatShort(result.manifest.range.duration)} / ${result.manifest.range.frameCount} 帧 ·
      ${result.manifest.shots.length} 个镜头<br>
      ${result.video ? `视频容器 ${formatShort(result.video.measuredDuration || 0)} · 帧内校验 ${result.manifest.video.durationWithinOneFrame ? "通过" : "需检查"}<br>` : ""}
      工程${preserved ? "保持不变" : "发生变更"} · ${result.downloads.length} 个文件已下载<br>
      指纹 ${result.fingerprint}`
    toast(`导出完成：${result.downloads.length} 个交付文件`);
  } catch (error) {
    const currentFingerprint = await projectFingerprint(project);
    const preserved = error.projectUnchanged ?? currentFingerprint === originalFingerprint;
    $("exportResult").hidden = false;
    $("exportResult").innerHTML = `
      <b style="color:#ff887d">导出失败</b><br>
      ${error.message}<br>
      原工程${preserved ? "完整保留，可继续编辑" : "状态异常，已停止自动保存"} · 指纹 ${originalFingerprint}`;
    toast(preserved ? "导出失败，原工程未改动" : "导出失败，请检查工程状态", "error", 4200);
  } finally {
    state.exporting = false;
    $("startExport").disabled = false;
    $("startExport").textContent = "再次导出";
    $("exportModal").querySelector(".modal-close").disabled = false;
    updateExportProgress({ progress: 1, status: "任务结束" });
  }
}

function canvasHash(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < data.length; index += 4) {
    hash ^= data[index];
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 1];
    hash = Math.imul(hash, 16777619);
    hash ^= data[index + 2];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function comparableAudioEvent(sample) {
  return {
    event: sample.audioEvent,
    beat: sample.beat.beatIndex,
    beatInBar: sample.beat.beatInBar,
    subtitle: sample.subtitle,
    camera: sample.activeCamera,
    transition: sample.transition,
  };
}

function waitAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function runFrameComparison(timeOverride) {
  if (state.compareBusy || state.exporting) return null;
  state.compareBusy = true;
  await document.fonts?.ready;
  if (clock.playing) setCurrentTime(clock.pause(), { force: true });
  const duration = project.outPoint - project.inPoint;
  const requested =
    Number.isFinite(timeOverride) && timeOverride > project.inPoint && timeOverride < project.outPoint
      ? timeOverride
      : state.time > project.inPoint + 0.2 && state.time < project.outPoint - 0.2
        ? state.time
        : project.inPoint + duration * 0.62;
  const target = roundTime(
    Math.max(project.inPoint, Math.min(project.outPoint - 1 / project.fps, requested)),
    project.fps,
  );
  $("compareOverlay").hidden = false;
  $("compareVerdict").className = "compare-verdict";
  $("compareVerdict").innerHTML = "<span>…</span> 正在捕获暂停帧与重播序列";
  const canvasA = $("compareA");
  const canvasB = $("compareB");
  const ctxA = canvasA.getContext("2d", { willReadFrequently: true });
  const ctxB = canvasB.getContext("2d", { willReadFrequently: true });

  setCurrentTime(target, { force: true });
  renderer.renderComparison(ctxA, project, target, 640, 360);
  const hashA = canvasHash(canvasA);
  const eventA = comparableAudioEvent(sampleAt(project, target));
  $("compareTimeA").textContent = formatTimecode(target, project.fps);

  const startFrame = Math.round((project.inPoint) * project.fps);
  const targetFrame = Math.round(target * project.fps);
  setCurrentTime(project.inPoint, { force: true });
  for (let frame = startFrame; frame <= targetFrame; frame += 3) {
    const t = frame / project.fps;
    renderer.renderComparison(ctxB, project, Math.min(target, t), 640, 360);
    if (frame % 30 === 0) {
      $("compareVerdict").innerHTML = `<span>↻</span> 正在从入点重播 · ${formatTimecode(
        Math.min(target, t),
        project.fps,
      )}`;
      await waitAnimationFrame();
    }
  }
  renderer.renderComparison(ctxB, project, target, 640, 360);
  const hashB = canvasHash(canvasB);
  const eventB = comparableAudioEvent(sampleAt(project, target));
  $("compareTimeB").textContent = formatTimecode(target, project.fps);
  const pixelsMatch = hashA === hashB;
  const audioMatches = JSON.stringify(eventA) === JSON.stringify(eventB);
  const passed = pixelsMatch && audioMatches;
  $("compareVerdict").className = `compare-verdict ${passed ? "ok" : "bad"}`;
  $("compareVerdict").innerHTML = passed
    ? `<span>✓</span> 通过 · 像素 ${hashA} / ${hashB} · ${eventA.event.type.toUpperCase()} 第 ${eventA.beat + 1} 拍 · 字幕「${eventA.subtitle?.text || "无"}」一致`
    : `<span>✕</span> 不一致 · 像素 ${hashA} / ${hashB} · 音频 ${eventA.event.type}/${eventB.event.type}`;
  setCurrentTime(target, { force: true });
  state.programFrameHash = hashA;
  state.compareBusy = false;
  return {
    passed,
    target,
    hashA,
    hashB,
    eventA,
    eventB,
    pixelDataA: canvasA.toDataURL("image/png"),
    pixelDataB: canvasB.toDataURL("image/png"),
  };
}

function closeCompare() {
  if (state.compareBusy) return;
  $("compareOverlay").hidden = true;
}

function redrawEverything({ resetTime = false } = {}) {
  clock.setProject(project);
  if (resetTime) {
    state.time = Number(project.ui?.playhead) || project.inPoint;
    clock.time = state.time;
  } else {
    state.time = Math.max(project.inPoint, Math.min(project.outPoint, state.time));
    clock.time = state.time;
  }
  state.selectedCutId =
    project.cuts.find((cut) => cut.id === (project.ui?.selectedCutId || state.selectedCutId))?.id ||
    project.cuts[1]?.id ||
    project.cuts[0].id;
  state.lastRenderedFrame = -1;
  state.lastMonitorFrame = -1;
  renderCameraBank();
  renderSceneTabs();
  renderInspector();
  renderTimeline();
  renderFrame(true);
  updatePlayUI();
}

function downloadProject() {
  const snapshot = snapshotProject();
  const name = `${project.title.replace(/[\\/:*?"<>|]+/g, "-") || "night-orbit"}-project.json`;
  downloadBlob(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" }),
    name,
  );
  saveToStorage();
  toast(`工程已保存 · ${name}`);
}

async function loadProjectFile(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const next = normalizeProject(JSON.parse(raw));
    const validation = validateProject(next);
    if (!validation.valid) throw new Error(validation.issues.join("；"));
    if (clock.playing) clock.pause();
    audio.stop("project-load");
    project = next;
    state.zoom = Math.max(1, Number(project.ui?.zoom) || 1);
    state.selectedCutId = project.ui?.selectedCutId || project.cuts[1]?.id || project.cuts[0].id;
    redrawEverything({ resetTime: true });
    saveToStorage();
    toast(`工程已恢复 · ${project.subtitles.length} 条字幕 / ${project.cuts.length} 个切点`);
  } catch (error) {
    toast(`打开失败，原工程未改动：${error.message}`, "error", 4500);
  } finally {
    $("projectFile").value = "";
  }
}

function editProjectTitle() {
  const button = $("projectTitle");
  button.contentEditable = "true";
  button.focus();
  const range = document.createRange();
  range.selectNodeContents(button);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function finishProjectTitle() {
  const button = $("projectTitle");
  const next = button.textContent.trim().slice(0, 48);
  button.contentEditable = "false";
  if (next && next !== project.title) {
    project.title = next;
    markDirty();
    document.title = `${project.title} — Night Orbit Studio`;
  } else {
    button.textContent = project.title;
  }
}

function bindEvents() {
  $("playPause").addEventListener("click", () => void togglePlayback());
  $("toStart").addEventListener("click", () => void seekTo(project.inPoint));
  $("toEnd").addEventListener("click", () => void seekTo(project.outPoint));
  $("loopButton").addEventListener("click", () => {
    project.loop = !project.loop;
    renderTimeline();
    scheduleSave();
    toast(project.loop ? "循环播放已开启" : "循环播放已关闭");
  });
  $("transitionTypes").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-type]");
    if (button && !button.disabled) applyTransition(button.dataset.type);
  });
  $("transitionDuration").addEventListener("input", (event) => {
    $("transitionValue").textContent = `${Number(event.target.value).toFixed(2)}s`;
    applyTransitionDuration(event.target.value);
  });
  $("addKeyframe").addEventListener("click", recordKeyframe);
  $("audioStart").addEventListener("input", (event) => {
    project.audio.start = roundTime(Number(event.target.value), project.fps);
    $("audioStartValue").textContent = formatShort(project.audio.start);
    $("audioStartHint").textContent = `${formatShort(project.audio.start)} · 松开后重排音频`;
    scheduleSave();
    drawWaveform();
    renderFrame(true);
  });
  $("audioStart").addEventListener("change", async () => {
    if (clock.playing) {
      await clock.restartAudioAtCurrent();
      toast(`音频已从 ${formatShort(project.audio.start)} 重新排程`);
    }
    renderInspector();
  });
  $("zoomIn").addEventListener("click", () => {
    state.zoom = Math.min(3, Math.round((state.zoom + 0.25) * 100) / 100);
    renderTimeline();
    scheduleSave();
  });
  $("zoomOut").addEventListener("click", () => {
    state.zoom = Math.max(1, Math.round((state.zoom - 0.25) * 100) / 100);
    renderTimeline();
    scheduleSave();
  });
  $("cutHere").addEventListener("click", () => void cycleCutAtPlayhead());
  $("deleteCut").addEventListener("click", deleteSelectedCut);
  $("selectTool").addEventListener("click", () => {
    $("selectTool").classList.add("active");
  });

  $("ruler").addEventListener("pointerdown", async (event) => {
    event.preventDefault();
    if (clock.playing) {
      clock.pause();
      state.time = clock.time;
      updatePlayUI();
    }
    state.dragging = true;
    $("ruler").setPointerCapture(event.pointerId);
    seekFromPointer(event);
  });
  $("ruler").addEventListener("pointermove", (event) => {
    if (state.dragging) seekFromPointer(event);
  });
  const finishDrag = () => {
    if (!state.dragging) return;
    state.dragging = false;
    saveToStorage();
  };
  $("ruler").addEventListener("pointerup", finishDrag);
  $("ruler").addEventListener("pointercancel", finishDrag);

  $("saveProject").addEventListener("click", downloadProject);
  $("loadProject").addEventListener("click", () => $("projectFile").click());
  $("projectFile").addEventListener("change", (event) =>
    void loadProjectFile(event.target.files?.[0]),
  );
  $("projectTitle").addEventListener("click", editProjectTitle);
  $("projectTitle").addEventListener("blur", finishProjectTitle);
  $("projectTitle").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("projectTitle").blur();
    }
    if (event.key === "Escape") {
      $("projectTitle").textContent = project.title;
      $("projectTitle").blur();
    }
  });

  $("openExport").addEventListener("click", openExportModal);
  $("closeExport").addEventListener("click", closeExportModal);
  $("exportModal").addEventListener("click", (event) => {
    if (event.target === $("exportModal")) closeExportModal();
  });
  $("startExport").addEventListener("click", () => void runExport());
  $("runCompare").addEventListener("click", () => void runFrameComparison());
  $("closeCompare").addEventListener("click", closeCompare);
  $("compareOverlay").addEventListener("click", (event) => {
    if (event.target === $("compareOverlay")) closeCompare();
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target.isContentEditable) return;
    if (event.code === "Space") {
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === "j" || event.key === "J") {
      jumpToCut(-1);
    } else if (event.key === "k" || event.key === "K") {
      jumpToCut(1);
    } else if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !["INPUT", "TEXTAREA"].includes(tag)
    ) {
      event.preventDefault();
      deleteSelectedCut();
    } else if (event.key === "Escape") {
      closeExportModal();
      closeCompare();
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderTimeline();
      renderFrame(true);
    }, 120);
  });

  window.addEventListener("beforeunload", () => {
    clearTimeout(state.savingTimer);
    saveToStorage();
  });
}

function installDebugApi() {
  window.studio = {
    version: "1.0.0",
    getProject: () => JSON.parse(JSON.stringify(project)),
    getState: () => ({
      time: state.time,
      frame: Math.round((state.time - project.inPoint) * project.fps),
      playing: clock.playing,
      activeCamera: activeCameraAt(),
      sceneId: project.activeScene,
      selectedCutId: state.selectedCutId,
      cutCount: project.cuts.length,
      keyframeCount: project.cameras.reduce((sum, camera) => sum + camera.keyframes.length, 0),
      subtitleCount: project.subtitles.length,
      audioStart: project.audio.start,
      audioGeneration: audio.generation,
      audioLastStart: audio.lastStart,
      fingerprint: null,
      lastExport: exporter.lastExport,
    }),
    sampleAt: (time = state.time) => sampleAt(project, time),
    seekTo: async (time) => {
      await seekTo(time);
      return state.time;
    },
    play: async () => {
      if (!clock.playing) await togglePlayback();
      return state.time;
    },
    pause: () => {
      if (clock.playing) {
        setCurrentTime(clock.pause(), { force: true });
        updatePlayUI();
        renderFrame(true);
      }
      return state.time;
    },
    compareAt: (time) => runFrameComparison(time),
    runExport: async (options = {}) => exporter.run(project, options),
    simulateExportFailure: () => {
      window.__NIGHT_ORBIT_FAIL_EXPORT__ = true;
    },
    canvasHash: () => canvasHash($("programCanvas")),
    projectFingerprint: () => projectFingerprint(project),
    saveNow: () => saveToStorage(),
    storageKey: STORAGE_KEY,
    validate: () => validateProject(project),
  };
}

async function init() {
  if (!project.ui) {
    project.ui = {
      playhead: state.time,
      zoom: state.zoom,
      selectedCutId: state.selectedCutId,
    };
  }
  state.time = Math.max(project.inPoint, Math.min(project.outPoint, state.time));
  clock.time = state.time;
  $("fpsLabel").textContent = `${project.fps} FPS`;
  $("resolutionLabel").textContent = `${project.export.width} × ${project.export.height}`;
  bindEvents();
  redrawEverything({ resetTime: false });
  installDebugApi();
  saveToStorage();
  requestAnimationFrame(animationLoop);
}

void init();
