import {
  analyzeAudioBuffer,
  formatDb,
  preflightSignature,
  renderPatch,
  sameRenderSignature,
} from "./export.js";
import { TRACK_DEFS, clonePatch } from "./model.js";
import { loadPatch, removePatch, savePatch } from "./storage.js";

const AUDIT_PATCH_NAME = "__ACOUSTIC_AUDIT__";

function probePatch(source, bpm) {
  const patch = clonePatch(source);
  patch.name = AUDIT_PATCH_NAME;
  patch.bpm = bpm ?? patch.bpm;
  for (const def of TRACK_DEFS) {
    const track = patch.tracks[def.id];
    track.mute = true;
    track.steps = Array.from({ length: 16 }, () => ({
      on: false,
      velocity: 100,
      probability: 100,
    }));
  }
  return patch;
}

function quarterNoteKick(source, bpm, pan = 0, tune = null) {
  const patch = probePatch(source, bpm);
  const kick = patch.tracks.kick;
  kick.mute = false;
  kick.pan = pan;
  kick.tune = tune ?? kick.tune;
  kick.level = 94;
  kick.decay = 260;
  for (const step of [0, 4, 8, 12]) {
    kick.steps[step] = { on: true, velocity: 116, probability: 100 };
  }
  return patch;
}

function monoMix(buffer) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const data = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    data[index] = (left[index] + right[index]) * 0.5;
  }
  return data;
}

export function detectOnsets(buffer, blockSize = 128) {
  const data = monoMix(buffer);
  const blockCount = Math.floor(data.length / blockSize);
  const envelope = new Float32Array(blockCount);
  let maxEnergy = 0;
  for (let block = 0; block < blockCount; block += 1) {
    let sum = 0;
    const offset = block * blockSize;
    for (let index = 0; index < blockSize; index += 1) {
      sum += data[offset + index] ** 2;
    }
    envelope[block] = Math.sqrt(sum / blockSize);
    maxEnergy = Math.max(maxEnergy, envelope[block]);
  }
  if (maxEnergy < 0.0001) return [];

  const floor = maxEnergy * 0.06;
  const onsets = [];
  let armed = true;
  for (let block = 2; block < blockCount; block += 1) {
    const rise = envelope[block] - envelope[block - 2];
    const level = envelope[block];
    if (armed && level > floor && rise > maxEnergy * 0.035) {
      const time = (block * blockSize) / buffer.sampleRate;
      if (!onsets.length || time - onsets[onsets.length - 1] > 0.12) {
        onsets.push(time);
      }
      armed = false;
    }
    if (!armed && envelope[block] < maxEnergy * 0.018) armed = true;
  }
  return onsets;
}

export function estimatePitch(buffer, startSeconds, windowSeconds = 0.12) {
  const data = monoMix(buffer);
  const start = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const length = Math.min(
    Math.floor(windowSeconds * buffer.sampleRate),
    data.length - start - 2,
  );
  if (length < 256) return 0;
  let mean = 0;
  for (let index = 0; index < length; index += 1) mean += data[start + index];
  mean /= length;
  const window = new Float32Array(length);
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    window[index] = data[start + index] - mean;
    energy += window[index] * window[index];
  }
  if (energy < 0.00002) return 0;

  const minLag = Math.max(2, Math.floor(buffer.sampleRate / 220));
  const maxLag = Math.min(length - 2, Math.ceil(buffer.sampleRate / 24));
  let bestLag = 0;
  let bestCorrelation = -1;
  let previous = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let dot = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < length - lag; index += 1) {
      const left = window[index];
      const right = window[index + lag];
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = dot / Math.sqrt(leftEnergy * rightEnergy || 1);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
      previous = correlation;
    }
  }
  if (bestLag <= minLag || bestLag >= maxLag || bestCorrelation < 0.28) return 0;
  return buffer.sampleRate / bestLag;
}

function appendResult(results, result, onProgress) {
  const index = results.findIndex((item) => item.id === result.id);
  if (index >= 0) results[index] = result;
  else results.push(result);
  onProgress?.(results.slice());
}

export async function runAcousticAudit(sourcePatch, options = {}) {
  const results = [];
  const onProgress = options.onProgress;
  const latencyMs = Number(options.latencyMs) || 0;

  appendResult(results, {
    id: "tempo",
    label: "TEMPO / 节拍时基",
    status: "running",
    detail: "离线渲染 96 与 144 BPM…",
  }, onProgress);

  const lowTempo = quarterNoteKick(sourcePatch, 96);
  const highTempo = quarterNoteKick(sourcePatch, 144);
  const [lowTempoRender, highTempoRender] = await Promise.all([
    renderPatch(lowTempo, 1),
    renderPatch(highTempo, 1),
  ]);
  const lowOnsets = detectOnsets(lowTempoRender.buffer);
  const highOnsets = detectOnsets(highTempoRender.buffer);
  const lowInterval = meanInterval(lowOnsets);
  const highInterval = meanInterval(highOnsets);
  const tempoPass = lowOnsets.length >= 4
    && highOnsets.length >= 4
    && Math.abs(lowInterval - 625) < 24
    && Math.abs(highInterval - 416.67) < 20
    && lowInterval - highInterval > 170;
  appendResult(results, {
    id: "tempo",
    label: "TEMPO / 节拍时基",
    status: tempoPass ? "pass" : "fail",
    detail: `${lowInterval.toFixed(1)} → ${highInterval.toFixed(1)} ms 实际击打间距`,
    data: { lowInterval, highInterval, lowOnsets, highOnsets },
  }, onProgress);

  appendResult(results, {
    id: "stereo",
    label: "STEREO / 左右声道",
    status: "running",
    detail: "对比 Hard-L 与 Hard-R 离线能量…",
  }, onProgress);

  const [leftRender, rightRender] = await Promise.all([
    renderPatch(quarterNoteKick(sourcePatch, 120, -92), 1),
    renderPatch(quarterNoteKick(sourcePatch, 120, 92), 1),
  ]);
  const leftStats = analyzeAudioBuffer(leftRender.buffer);
  const rightStats = analyzeAudioBuffer(rightRender.buffer);
  const leftBalance = dbRatio(leftStats.left.rms, leftStats.right.rms);
  const rightBalance = dbRatio(rightStats.right.rms, rightStats.left.rms);
  const stereoPass = leftBalance > 8 && rightBalance > 8;
  appendResult(results, {
    id: "stereo",
    label: "STEREO / 左右声道",
    status: stereoPass ? "pass" : "fail",
    detail: `L 偏置 ${formatSignedDb(leftBalance)} · R 偏置 ${formatSignedDb(rightBalance)}`,
    data: { leftBalance, rightBalance, leftStats, rightStats },
  }, onProgress);

  appendResult(results, {
    id: "pitch",
    label: "PITCH / 关键音高",
    status: "running",
    detail: "分析底鼓 42 Hz 与 84 Hz 渲染波形…",
  }, onProgress);

  const [lowPitchRender, highPitchRender] = await Promise.all([
    renderPatch(quarterNoteKick(sourcePatch, 120, 0, 42), 1),
    renderPatch(quarterNoteKick(sourcePatch, 120, 0, 84), 1),
  ]);
  const lowPitch = estimatePitch(lowPitchRender.buffer, 0.16, 0.14);
  const highPitch = estimatePitch(highPitchRender.buffer, 0.16, 0.14);
  const pitchPass = lowPitch > 20 && highPitch > 36
    && highPitch > lowPitch * 1.32
    && highPitch - lowPitch > 14;
  appendResult(results, {
    id: "pitch",
    label: "PITCH / 关键音高",
    status: pitchPass ? "pass" : "fail",
    detail: `${lowPitch.toFixed(1)} → ${highPitch.toFixed(1)} Hz 波形基频`,
    data: { lowPitch, highPitch },
  }, onProgress);

  appendResult(results, {
    id: "reload",
    label: "RELOAD / 重载一致性",
    status: "running",
    detail: "保存、重新载入并二次导出…",
  }, onProgress);

  savePatch({ ...clonePatch(sourcePatch), name: AUDIT_PATCH_NAME });
  const reloaded = loadPatch(AUDIT_PATCH_NAME);
  const before = await renderPatch(clonePatch(sourcePatch), 2);
  const after = await renderPatch(reloaded, 2);
  const comparison = sameRenderSignature(before.signature, after.signature);
  const reloadPass = Boolean(reloaded) && comparison.pass;
  const kickBefore = estimatePitch(before.buffer, 0.16, 0.14);
  const kickAfter = estimatePitch(after.buffer, 0.16, 0.14);
  removePatch(AUDIT_PATCH_NAME);
  appendResult(results, {
    id: "reload",
    label: "RELOAD / 重载一致性",
    status: reloadPass ? "pass" : "fail",
    detail: `${before.signature.duration.toFixed(3)} = ${after.signature.duration.toFixed(3)} s · 峰值 ${formatDb(before.signature.peakDb)} = ${formatDb(after.signature.peakDb)} dB · 音高 ${kickBefore.toFixed(1)} = ${kickAfter.toFixed(1)} Hz · I/O ${latencyMs.toFixed(1)} ms`,
    data: { before, after, comparison, kickBefore, kickAfter, latencyMs },
  }, onProgress);

  const preflight = preflightSignature(before.signature);
  appendResult(results, {
    id: "preflight",
    label: "PREFLIGHT / 导出检查",
    status: preflight.pass ? "pass" : "fail",
    detail: preflight.pass
      ? "非静音 · 无削波 · L/R 完整"
      : [preflight.silence, preflight.clipping, preflight.channels]
        .filter((check) => !check.pass)
        .map((check) => check.detail)
        .join(" · "),
    data: { preflight, signature: before.signature },
  }, onProgress);

  return {
    pass: results.every((result) => result.status === "pass"),
    results,
    baseline: before.signature,
  };
}

function meanInterval(onsets) {
  if (onsets.length < 2) return 0;
  return ((onsets[onsets.length - 1] - onsets[0]) / (onsets.length - 1)) * 1000;
}

function dbRatio(a, b) {
  if (!(a > 0) || !(b > 0)) return -60;
  return 20 * Math.log10(a / b);
}

function formatSignedDb(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB`;
}
