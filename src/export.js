import {
  createOfflineBuses,
  createDrumVoice,
  probabilityPasses,
  velocityToken,
} from "./synth.js";
import { TRACK_DEFS, clonePatch, normalizePatch } from "./model.js";

export const EXPORT_SAMPLE_RATE = 48000;
export const LEAD_IN_SECONDS = 0.04;
export const TAIL_SECONDS = 1.1;

export function exportDurationFor(patch, bars) {
  const loop = bars * 16 * (60 / patch.bpm / 4);
  return LEAD_IN_SECONDS + loop + TAIL_SECONDS;
}

export async function renderPatch(patch, bars = 2, options = {}) {
  const normalized = normalizePatch(clonePatch(patch));
  const sampleRate = options.sampleRate ?? EXPORT_SAMPLE_RATE;
  const duration = exportDurationFor(normalized, bars);
  const frameCount = Math.ceil(duration * sampleRate);
  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContextClass) throw new Error("当前浏览器不支持离线音频渲染");
  const context = new OfflineContextClass(2, frameCount, sampleRate);
  const master = context.createGain();
  master.gain.value = (normalized.master / 100) ** 1.45;
  master.connect(context.destination);
  const buses = createOfflineBuses(context, master, normalized);
  const stepDuration = 60 / normalized.bpm / 4;

  for (let bar = 0; bar < bars; bar += 1) {
    for (let step = 0; step < 16; step += 1) {
      const when = LEAD_IN_SECONDS + (bar * 16 + step) * stepDuration;
      for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex += 1) {
        const def = TRACK_DEFS[trackIndex];
        const track = normalized.tracks[def.id];
        const note = track.steps[step];
        if (!note.on || track.mute) continue;
        if (!probabilityPasses(normalized.seed, trackIndex, step, bar, note.probability)) continue;
        const token = velocityToken(normalized.seed, trackIndex, step, bar);
        createDrumVoice(
          context,
          buses[def.id].panner,
          def.id,
          track,
          when,
          note.velocity,
          token,
        );
      }
    }
  }

  const buffer = await context.startRendering();
  return {
    buffer,
    patch: normalized,
    bars,
    duration,
    signature: analyzeAudioBuffer(buffer),
  };
}

export function analyzeAudioBuffer(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  const channelStats = channels.map((data) => {
    let peak = 0;
    let square = 0;
    let clipped = 0;
    let nonzero = 0;
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index];
      const absolute = Math.abs(value);
      if (absolute > peak) peak = absolute;
      square += value * value;
      if (absolute >= 0.998) clipped += 1;
      if (absolute > 0.00001) nonzero += 1;
    }
    return {
      peak,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      rms: Math.sqrt(square / Math.max(1, data.length)),
      rmsDb: square > 0 ? 20 * Math.log10(Math.sqrt(square / data.length)) : -Infinity,
      clipped,
      nonzero,
    };
  });
  const peak = Math.max(...channelStats.map((stats) => stats.peak), 0);
  const rms = Math.sqrt(
    channelStats.reduce((sum, stats) => sum + stats.rms * stats.rms, 0) / channelStats.length,
  );
  const clipped = channelStats.reduce((sum, stats) => sum + stats.clipped, 0);
  const missingChannels = buffer.numberOfChannels < 2
    ? ["R"]
    : channelStats
      .map((stats, index) => ({ stats, name: index === 0 ? "L" : "R" }))
      .filter(({ stats }) => stats.peak < 0.0001)
      .map(({ name }) => name);
  const silent = peak < 0.0001;
  return {
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    peak,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rms,
    rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity,
    clipped,
    left: channelStats[0],
    right: channelStats[1] ?? null,
    silent,
    missingChannels,
    stereoSpreadDb: channelStats[1] && channelStats[0].rms > 0 && channelStats[1].rms > 0
      ? 20 * Math.log10(channelStats[1].rms / channelStats[0].rms)
      : 0,
  };
}

export function preflightSignature(signature) {
  const clipping = signature.clipped > 0 || signature.peak >= 0.998;
  const hasMissing = signature.missingChannels.length > 0;
  return {
    silence: {
      pass: !signature.silent,
      detail: signature.silent ? "检测到整段静音" : `峰值 ${formatDb(signature.peakDb)} dBFS`,
    },
    clipping: {
      pass: !clipping,
      detail: clipping ? `${signature.clipped} 个削波采样` : `峰值余量 ${formatDb(-signature.peakDb)} dB`,
    },
    channels: {
      pass: !hasMissing,
      detail: hasMissing ? `缺少 ${signature.missingChannels.join(" / ")}` : "L / R 均有信号",
    },
    pass: !signature.silent && !clipping && !hasMissing,
  };
}

export function sameRenderSignature(a, b, tolerance = 0.01) {
  const durationMatch = Math.abs(a.duration - b.duration) < 0.0005;
  const peakMatch = Math.abs(a.peakDb - b.peakDb) < tolerance;
  const rmsMatch = Math.abs(a.rmsDb - b.rmsDb) < tolerance;
  const channelsMatch = a.numberOfChannels === b.numberOfChannels
    && Math.abs((a.left?.peakDb ?? -Infinity) - (b.left?.peakDb ?? -Infinity)) < tolerance
    && Math.abs((a.right?.peakDb ?? -Infinity) - (b.right?.peakDb ?? -Infinity)) < tolerance;
  return { pass: durationMatch && peakMatch && rmsMatch && channelsMatch, durationMatch, peakMatch, rmsMatch, channelsMatch };
}

export function formatDb(value) {
  if (!Number.isFinite(value)) return "−∞";
  return value.toFixed(1);
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}
