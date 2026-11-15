import { Clock } from './clock.js';
import { AudioEngine } from './audio.js';
import { createDefaultProject, ASPECTS, SOURCE_W, SOURCE_H } from './model.js';
import { ensureValidCrop } from './crop.js';
import { renderScene } from './animation.js';
import { renderClipFrame, renderSourceOverlay } from './render.js';
import { createTimeline } from './timeline.js';
import { createInspector } from './inspector.js';
import { wireCropDrag } from './crop-drag.js';
import { saveProject, loadProject, snapshotProject, restoreBackup, clearBackup } from './project.js';
import { exportClips } from './exporter.js';

const state = {
  project: null,
  clock: null,
  audio: null,
  activeClipId: 'landscape',
  timeline: null,
  inspector: null,
  sourceCanvas: null,
  sourceCtx: null,
  outCanvas: null,
  outCtx: null,
  lastSave: null,
};

const $ = (id) => document.getElementById(id);

function activeScene() {
  return state.project.scenes.find((s) => s.id === state.project.activeSceneId);
}

function activeClip() {
  return activeScene().clips.find((c) => c.id === state.activeClipId);
}

function validateAllClips() {
  const scene = activeScene();
  for (const clip of scene.clips) {
    clip.crop = ensureValidCrop(scene, clip, clip.aspect);
  }
}

function drawFrame(time) {
  const scene = activeScene();
  renderSourceOverlay(state.sourceCtx, state.project, scene, state.activeClipId, time);
  const clip = activeClip();
  const [outW, outH] = ASPECTS[clip.aspect].out;
  if (state.outCanvas.width !== outW) state.outCanvas.width = outW;
  if (state.outCanvas.height !== outH) state.outCanvas.height = outH;
  const clipWithSubs = { ...clip, _subtitles: scene.subtitles };
  renderClipFrame(state.outCtx, { ...scene, _sourceCanvas: state.sourceCanvas },
    clipWithSubs, time, outW, outH);
  $('clockReadout').textContent = `${time.toFixed(3)} s`;
  $('transportTime').textContent = `${time.toFixed(3)} / ${scene.duration.toFixed(3)} s`;
  state.timeline?.updatePlayhead(time);
}

function refreshAll() {
  validateAllClips();
  state.timeline.render();
  state.inspector.render();
  drawFrame(state.clock.currentTime);
}

function updateClip(clipId, patch) {
  const scene = activeScene();
  const clip = scene.clips.find((c) => c.id === clipId);
  Object.assign(clip, patch);
  clip.crop = ensureValidCrop(scene, clip, clip.aspect);
  refreshAll();
}

function updateCrop(clipId, crop) {
  const clip = activeScene().clips.find((c) => c.id === clipId);
  clip.crop = crop;
  state.inspector.render();
  drawFrame(state.clock.currentTime);
}

function selectClip(clipId) {
  state.activeClipId = clipId;
  state.inspector.render();
  drawFrame(state.clock.currentTime);
}

async function switchScene(sceneId) {
  if (state.project.activeSceneId === sceneId) return;
  state.audio.stop();
  state.clock.reset();
  state.project.activeSceneId = sceneId;
  state.activeClipId = 'landscape';
  state.clock.duration = activeScene().duration;
  validateAllClips();
  state.audio.setScene(activeScene());
  refreshAll();
  $('audioStatus').textContent = '音频：已随场景重置';
  $('audioStatus').classList.remove('running');
}

async function startPlayback() {
  await state.audio.ensureContext();
  state.audio.setMuted(state.project.muted);
  state.audio.setScene(activeScene());
  state.audio.start();
  state.clock.play();
  $('audioStatus').textContent = '音频：与画面共用时钟运行';
  $('audioStatus').classList.add('running');
}

function pausePlayback() {
  state.clock.pause();
}

function seekTo(time) {
  state.clock.seek(time);
  state.audio.seek();
  drawFrame(state.clock.currentTime);
}

function doSave() {
  const result = saveProject(state.project);
  state.lastSave = result;
  $('exportReport').textContent = `工程已保存（${result.bytes} 字节，${result.savedAt}）`;
  return result;
}

function reopenProject() {
  const restored = loadProject();
  if (!restored) throw new Error('没有已保存的工程');
  teardown();
  boot(restored);
  $('exportReport').textContent = '工程已重新打开：时间线、字幕、转场与音频起始均已恢复';
}

function teardown() {
  state.audio?.stop();
  state.clock?.reset();
  state.offRenderTick?.();
  state.offRenderTick = null;
}

async function doExport() {
  const report = $('exportReport');
  report.textContent = '导出中…';
  snapshotProject(state.project);
  const fault = $('faultToggle').checked;
  try {
    const results = await exportClips(activeScene(), {
      faultInjected: fault,
      onProgress: (id, ratio) => {
        report.textContent = `导出 ${id}：${(ratio * 100).toFixed(0)}%`;
      },
    });
    clearBackup();
    window.__lastExport = results;
    report.textContent = results.map((r) =>
      `${r.aspect}: ${r.clipId}.webm `
      + `${r.width}x${r.height} 期望=${r.expectedDuration}s 实测=${r.measuredDuration}s `
      + `偏差=${r.durationDelta}s 事件=${r.firedEvents.length}`).join('\n');
    return results;
  } catch (error) {
    const rolledBack = restoreBackup();
    if (rolledBack) state.project = rolledBack;
    report.textContent = `导出失败，已保留并恢复原工程：${error.message}`;
    throw error;
  }
}

function populateSceneSelect() {
  const select = $('sceneSelect');
  select.innerHTML = '';
  for (const scene of state.project.scenes) {
    const option = document.createElement('option');
    option.value = scene.id;
    option.textContent = scene.name;
    select.appendChild(option);
  }
  select.value = state.project.activeSceneId;
}

function boot(project) {
  state.project = project;
  state.activeClipId = 'landscape';
  state.sourceCanvas = $('sourceCanvas');
  state.sourceCtx = state.sourceCanvas.getContext('2d');
  state.outCanvas = $('outputCanvas');
  state.outCtx = state.outCanvas.getContext('2d', { alpha: false });
  state.clock = new Clock({ duration: activeScene().duration, loop: project.loop });
  state.audio = new AudioEngine(state.clock);
  state.audio.muted = project.muted;
  validateAllClips();
  populateSceneSelect();
  state.timeline = createTimeline($('timeline'), {
    clock: state.clock,
    getScene: activeScene,
    onClipChange: (id, patch) => updateClip(id, patch),
    onSeek: seekTo,
  });
  state.inspector = createInspector($('clipTabs'), $('clipInspector'), $('subtitleList'), {
    getScene: activeScene,
    getActiveClipId: () => state.activeClipId,
    selectClip,
    updateClip,
    updateCrop,
  });
  wireCropDrag(state.sourceCanvas, {
    getScene: activeScene,
    getActiveClipId: () => state.activeClipId,
    updateCrop,
  });
  $('loopToggle').checked = project.loop;
  $('btnMute').textContent = project.muted ? '取消静音' : '静音';
  refreshAll();
}

function init() {
  $('btnPlay').addEventListener('click', startPlayback);
  $('btnPause').addEventListener('click', pausePlayback);
  $('btnSave').addEventListener('click', doSave);
  $('btnReload').addEventListener('click', reopenProject);
  $('btnExport').addEventListener('click', () => { doExport().catch(() => {}); });
  $('btnMute').addEventListener('click', () => {
    state.project.muted = !state.project.muted;
    $('btnMute').textContent = state.project.muted ? '取消静音' : '静音';
    state.audio.setMuted(state.project.muted);
  });
  $('loopToggle').addEventListener('change', (event) => {
    state.project.loop = event.target.checked;
    state.clock.loop = event.target.checked;
  });
  $('sceneSelect').addEventListener('change', (event) => switchScene(event.target.value));
  let project = null;
  try { project = loadProject(); } catch (error) { console.warn(error); }
  boot(project ?? createDefaultProject());
  state.offRenderTick = state.clock.onTick((time) => drawFrame(time));
  // 测试钩子：仅暴露纯函数与受控操作，不暴露可变内部状态。
  window.__workbench = {
    getState: () => state,
    activeScene,
    activeClip,
    seekTo,
    startPlayback,
    pausePlayback,
    switchScene,
    doSave,
    reopenProject,
    doExport,
    drawFrame,
    renderSceneTo: (ctx, time) => renderScene(ctx, activeScene(), time, SOURCE_W, SOURCE_H),
    resetProject: () => boot(createDefaultProject()),
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
