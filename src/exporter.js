import { ASPECTS } from './model.js';
import { renderScene } from './animation.js';
import { renderClipFrame } from './render.js';

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 为一个片段建立独立的离线渲染上下文、音频图与 MediaRecorder。
async function recordClip(scene, clip, { onProgress, faultInjected }) {
  const [outW, outH] = ASPECTS[clip.aspect].out;
  const duration = clip.outPoint - clip.inPoint;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = 960;
  sourceCanvas.height = 540;
  const sourceCtx = sourceCanvas.getContext('2d');
  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d', { alpha: false });

  const Ctx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new Ctx();
  await audioCtx.resume();
  const destination = audioCtx.createMediaStreamDestination();
  const master = audioCtx.createGain();
  master.gain.value = 0.9;
  master.connect(destination);

  const videoStream = outCanvas.captureStream(0);
  const videoTrack = videoStream.getVideoTracks()[0];
  const stream = new MediaStream([videoTrack, ...destination.stream.getAudioTracks()]);
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('当前浏览器不支持 WebM MediaRecorder');
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  const firedEvents = [];
  const scheduled = new Set();
  function scheduleEvents(masterTime, now) {
    const localNow = masterTime - clip.inPoint;
    for (const beat of scene.audio.beats) {
      const local = beat - clip.inPoint;
      if (local < 0 || local > duration) continue;
      const key = `b:${beat}`;
      if (scheduled.has(key) || local < localNow - 0.03) continue;
      scheduled.add(key);
      const when = now + (local - localNow);
      tone(audioCtx, master, when, 150, 48, 0.16, 'sine', 0.5);
      firedEvents.push({ type: 'beat', time: Number(local.toFixed(3)) });
    }
    for (const cue of scene.audio.cues) {
      const local = cue.t - clip.inPoint;
      if (local < 0 || local > duration) continue;
      const key = `c:${cue.name}`;
      if (scheduled.has(key) || local < localNow - 0.03) continue;
      scheduled.add(key);
      const when = now + (local - localNow);
      tone(audioCtx, master, when, cue.freq, cue.freq, 0.22, 'triangle', 0.32);
      firedEvents.push({ type: 'cue', name: cue.name, time: Number(local.toFixed(3)) });
    }
  }

  function tone(ctx, out, when, f1, f2, len, type, vol) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f1, when);
    if (f2 !== f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), when + len * 0.7);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + len);
    osc.connect(gain).connect(out);
    osc.start(when);
    osc.stop(when + len + 0.02);
  }

  const exportScene = { ...scene, _sourceCanvas: sourceCanvas, _subtitles: scene.subtitles };
  function drawAt(masterTime) {
    renderScene(sourceCtx, scene, masterTime);
    const clipWithSubs = { ...clip, _subtitles: scene.subtitles };
    renderClipFrame(outCtx, exportScene, clipWithSubs, masterTime, outW, outH);
    videoTrack.requestFrame?.();
  }

  recorder.start(200);
  if (faultInjected) {
    recorder.stop();
    await stopped;
    videoTrack.stop();
    await audioCtx.close();
    throw new Error('注入故障：录制器意外停止');
  }

  const startPerf = performance.now();
  let startCtx = 0;
  let raf = 0;
  await new Promise((resolve) => {
    const frame = () => {
      const elapsed = (performance.now() - startPerf) / 1000;
      if (!startCtx) startCtx = audioCtx.currentTime + 0.05;
      const local = Math.min(duration, Math.max(0, elapsed));
      const masterTime = clip.inPoint + local;
      drawAt(masterTime);
      scheduleEvents(masterTime, startCtx + Math.max(0, elapsed - 0.05));
      onProgress?.(clip.id, local / duration);
      if (elapsed >= duration) {
        resolve();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    drawAt(clip.inPoint);
    raf = requestAnimationFrame(frame);
  });
  cancelAnimationFrame(raf);
  // 给最后一个 timeslice 留出刷盘时间，再停止录制器。
  await sleep(120);
  recorder.stop();
  await stopped;
  videoTrack.stop();
  await audioCtx.close();

  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  const measured = await measureBlobDuration(blob);
  return {
    clipId: clip.id,
    aspect: clip.aspect,
    blob,
    mimeType,
    expectedDuration: Number(duration.toFixed(3)),
    measuredDuration: measured,
    durationDelta: Number(Math.abs(measured - duration).toFixed(3)),
    firedEvents,
    width: outW,
    height: outH,
  };
}

async function measureBlobDuration(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('WebM 元数据读取失败'));
    });
    if (Number.isFinite(video.duration)) return Number(video.duration.toFixed(3));
    // 某些 MediaRecorder 输出不写时长头：seek 到末尾由容器时间戳反推。
    video.currentTime = Number.MAX_SAFE_INTEGER;
    await new Promise((resolve) => {
      video.onseeked = resolve;
      setTimeout(resolve, 2500);
    });
    if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
      return Number(video.currentTime.toFixed(3));
    }
    if (video.seekable.length) return Number(video.seekable.end(0).toFixed(3));
    throw new Error('无法测量 WebM 时长');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportClips(scene, { onProgress, faultInjected = false } = {}) {
  const results = [];
  for (const clip of scene.clips) {
    const result = await recordClip(scene, clip, { onProgress, faultInjected });
    results.push(result);
  }
  return results;
}
