import { renderPingProbe, renderBeatProbe } from "./audio-engine.js";

function channelStats(data) {
  let peak = 0;
  let sum = 0;
  let clipCount = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = Math.abs(data[index]);
    peak = Math.max(peak, value);
    sum += data[index] * data[index];
    if (value >= 0.999) clipCount += 1;
  }
  return {
    peak,
    rms: Math.sqrt(sum / Math.max(1, data.length)),
    clipCount,
  };
}

export function measureDominantPitch(buffer, startSeconds = 0.24, lengthSeconds = 0.22) {
  const start = Math.max(0, Math.floor(startSeconds * buffer.sampleRate));
  const length = Math.min(
    Math.floor(lengthSeconds * buffer.sampleRate),
    buffer.length - start,
  );
  if (length < 64) return 0;

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const samples = new Float32Array(length);
  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((Math.PI * 2 * index) / Math.max(1, length - 1));
    const value = (left[start + index] + right[start + index]) * 0.5 * window;
    samples[index] = value;
    energy += value * value;
  }
  if (energy < 1e-8) return 0;

  let bestFrequency = 0;
  let bestMagnitude = -1;
  for (let frequency = 180; frequency <= 1500; frequency += 2) {
    const step = (Math.PI * 2 * frequency) / buffer.sampleRate;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      real += samples[index] * Math.cos(step * index);
      imaginary -= samples[index] * Math.sin(step * index);
    }
    const magnitude = real * real + imaginary * imaginary;
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      bestFrequency = frequency;
    }
  }
  return bestFrequency;
}

export function analyzeBuffer(buffer, options = {}) {
  if (!buffer || buffer.numberOfChannels < 1) {
    return {
      duration: 0,
      sampleRate: 0,
      channels: 0,
      peak: 0,
      peakL: 0,
      peakR: 0,
      rms: 0,
      rmsL: 0,
      rmsR: 0,
      clipCount: 0,
      silence: true,
      clipped: false,
      missingChannel: true,
      pitch: 0,
    };
  }

  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const leftStats = channelStats(left);
  const rightStats = channelStats(right);
  const peak = Math.max(leftStats.peak, rightStats.peak);
  const rms = Math.sqrt((leftStats.rms ** 2 + rightStats.rms ** 2) / 2);
  const missingChannel = buffer.numberOfChannels < 2
    || leftStats.rms < 0.0005
    || rightStats.rms < 0.0005;
  const pitchStart = Number.isFinite(options.pitchStart) ? options.pitchStart : 0.24;

  return {
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    peak,
    peakL: leftStats.peak,
    peakR: rightStats.peak,
    rms,
    rmsL: leftStats.rms,
    rmsR: rightStats.rms,
    clipCount: leftStats.clipCount + rightStats.clipCount,
    silence: rms < 0.0015,
    clipped: peak >= 0.995 || leftStats.clipCount + rightStats.clipCount > 0,
    missingChannel,
    pitch: measureDominantPitch(buffer, pitchStart, 0.22),
  };
}

export function formatDuration(seconds) {
  return `${Number(seconds).toFixed(3)} s`;
}

export function formatPeak(value) {
  return Number(value).toFixed(4);
}

export function formatDb(value) {
  if (!Number.isFinite(value) || value <= 0.00001) return "—";
  return `${(20 * Math.log10(value)).toFixed(1)} dBFS`;
}

export function computeSafety(report) {
  return {
    silence: !report.silence,
    clipping: !report.clipped,
    channels: !report.missingChannel,
  };
}

export function safetyPassed(safety) {
  return safety.silence && safety.clipping && safety.channels;
}

function detectOnsets(buffer, thresholdRatio = 0.2, minSpacing = 0.16) {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const binSize = Math.max(1, Math.floor(buffer.sampleRate * 0.008));
  const bins = [];
  for (let start = 0; start < buffer.length; start += binSize) {
    let sum = 0;
    const end = Math.min(buffer.length, start + binSize);
    for (let index = start; index < end; index += 1) {
      const mono = (left[index] + right[index]) * 0.5;
      sum += mono * mono;
    }
    bins.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const max = Math.max(...bins);
  const threshold = Math.max(0.002, max * thresholdRatio);
  const onsets = [];
  const spacingBins = Math.max(1, Math.floor(minSpacing / 0.008));

  for (let index = 1; index < bins.length - 1; index += 1) {
    if (bins[index] < threshold) continue;
    if (bins[index] < bins[index - 1] || bins[index] < bins[index + 1]) continue;
    if (onsets.length && index - onsets[onsets.length - 1] < spacingBins) {
      if (bins[index] > bins[onsets[onsets.length - 1]]) {
        onsets[onsets.length - 1] = index;
      }
      continue;
    }
    onsets.push(index);
  }

  return {
    count: onsets.length,
    times: onsets.map((index) => index * 0.008),
  };
}

function result(pass, text, detail) {
  return { pass, text, detail };
}

export async function runAudioVerification(params) {
  const lowPing = await renderPingProbe({ ...params, frequency: 340 }, 0, 0.8);
  const highPing = await renderPingProbe({ ...params, frequency: 840 }, 0, 0.8);
  const lowReport = analyzeBuffer(lowPing, { pitchStart: 0.08 });
  const highReport = analyzeBuffer(highPing, { pitchStart: 0.08 });
  const frequencyPass = lowReport.pitch > 0
    && highReport.pitch > lowReport.pitch * 1.45
    && highReport.pitch > 500;
  const frequency = result(
    frequencyPass,
    `${lowReport.pitch} → ${highReport.pitch} Hz`,
    `340 / 840 Hz 输入；实测主导 ${lowReport.pitch} / ${highReport.pitch} Hz`,
  );

  const leftPing = await renderPingProbe({ ...params, frequency: 620 }, -0.92, 0.7);
  const rightPing = await renderPingProbe({ ...params, frequency: 620 }, 0.92, 0.7);
  const leftReport = analyzeBuffer(leftPing, { pitchStart: 0.08 });
  const rightReport = analyzeBuffer(rightPing, { pitchStart: 0.08 });
  const leftRatio = leftReport.rmsL / Math.max(1e-8, leftReport.rmsR);
  const rightRatio = rightReport.rmsR / Math.max(1e-8, rightReport.rmsL);
  const stereoPass = leftRatio > 1.45 && rightRatio > 1.45;
  const stereo = result(
    stereoPass,
    `L×${leftRatio.toFixed(1)} / R×${rightRatio.toFixed(1)}`,
    `左声束 L/R=${leftRatio.toFixed(2)}；右声束 R/L=${rightRatio.toFixed(2)}`,
  );

  const slowBeat = await renderBeatProbe({ ...params, frequency: 620 }, 52, 3.15);
  const fastBeat = await renderBeatProbe({ ...params, frequency: 620 }, 124, 3.15);
  const slowOnsets = detectOnsets(slowBeat, 0.18, 0.22);
  const fastOnsets = detectOnsets(fastBeat, 0.18, 0.14);
  const fastInterval = fastOnsets.times.length > 1
    ? (fastOnsets.times.at(-1) - fastOnsets.times[0]) / (fastOnsets.times.length - 1)
    : 0;
  const slowInterval = slowOnsets.times.length > 1
    ? (slowOnsets.times.at(-1) - slowOnsets.times[0]) / (slowOnsets.times.length - 1)
    : 0;
  const beatPass = fastOnsets.count >= slowOnsets.count + 2
    && fastInterval > 0
    && slowInterval > fastInterval * 1.4;
  const beat = result(
    beatPass,
    `${slowOnsets.count} → ${fastOnsets.count} 脉冲`,
    `52 BPM 间隔 ${slowInterval.toFixed(2)} s；124 BPM 间隔 ${fastInterval.toFixed(2)} s`,
  );

  return {
    frequency,
    stereo,
    beat,
    passed: frequency.pass && stereo.pass && beat.pass,
  };
}

export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : null;
  let byteOffset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const leftValue = Math.max(-1, Math.min(1, left[frame]));
    view.setInt16(byteOffset, leftValue < 0 ? leftValue * 0x8000 : leftValue * 0x7fff, true);
    byteOffset += 2;
    if (right) {
      const rightValue = Math.max(-1, Math.min(1, right[frame]));
      view.setInt16(byteOffset, rightValue < 0 ? rightValue * 0x8000 : rightValue * 0x7fff, true);
      byteOffset += 2;
    }
  }

  return {
    blob: new Blob([wav], { type: "audio/wav" }),
    arrayBuffer: wav,
    bytes: dataSize + 44,
  };
}

export async function sha256Hex(arrayBuffer) {
  if (!globalThis.crypto?.subtle) return "unavailable";
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function exportSummary(report, firstDelayMs, hash = "pending") {
  return {
    duration: report.duration,
    pitch: report.pitch,
    delayMs: firstDelayMs,
    peakL: report.peakL,
    peakR: report.peakR,
    rms: report.rms,
    channels: report.channels,
    hash,
  };
}

function relativeClose(a, b, tolerance) {
  return Math.abs(a - b) <= Math.max(tolerance, Math.abs(a) * tolerance * 0.2);
}

export function compareExportSummaries(first, second) {
  if (!first || !second) {
    return {
      pass: false,
      reason: "缺少第一次或第二次导出摘要",
      checks: [],
    };
  }
  const checks = [
    {
      key: "duration",
      label: "导出时长",
      pass: relativeClose(first.duration, second.duration, 1 / 48000),
      before: formatDuration(first.duration),
      after: formatDuration(second.duration),
    },
    {
      key: "pitch",
      label: "关键音高",
      pass: Math.abs(first.pitch - second.pitch) <= 4,
      before: `${first.pitch} Hz`,
      after: `${second.pitch} Hz`,
    },
    {
      key: "delay",
      label: "回波延迟",
      pass: first.delayMs === second.delayMs,
      before: `${first.delayMs} ms`,
      after: `${second.delayMs} ms`,
    },
    {
      key: "peakL",
      label: "左声道峰值",
      pass: Math.abs(first.peakL - second.peakL) <= 0.0005,
      before: formatPeak(first.peakL),
      after: formatPeak(second.peakL),
    },
    {
      key: "peakR",
      label: "右声道峰值",
      pass: Math.abs(first.peakR - second.peakR) <= 0.0005,
      before: formatPeak(first.peakR),
      after: formatPeak(second.peakR),
    },
  ];
  const hashMatch = first.hash !== "pending" && first.hash === second.hash;
  checks.push({
    key: "hash",
    label: "PCM 校验和（参考）",
    pass: hashMatch,
    informational: true,
    before: first.hash.slice(0, 12),
    after: second.hash.slice(0, 12),
  });
  const requiredChecks = checks.filter((check) => !check.informational);
  return {
    pass: requiredChecks.every((check) => check.pass),
    checks,
    reason: requiredChecks.every((check) => check.pass) ? "两次离线渲染关键指标一致" : "存在不一致项",
  };
}
