/* 离线渲染、WAV 编码、导出前检查（静音 / 削波 / 声道缺失）与信号分析 */
"use strict";

const EXPORT_SECONDS = 12;
const EXPORT_SR = 44100;

/* 用与实时完全相同的图与包络算法离线渲染；muteAlarm 用于延迟测量参考轨 */
async function renderOffline(p, seconds = EXPORT_SECONDS, initialEnv = { env: 0, smooth: 1 }, opts = {}) {
  const saved = { ...envState };
  envState.env = initialEnv.env;
  envState.smooth = initialEnv.smooth;

  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * EXPORT_SR), EXPORT_SR);
  const nodes = buildMixGraph(ctx, p);
  if (opts.muteAlarm) nodes.alarmBus.gain.value = 0;
  nodes.master.connect(ctx.destination);

  const automation = computeAutomation(0, seconds, p);
  applyAutomation(nodes.duckGain.gain, automation, 0);
  scheduleMusic(ctx, nodes, p, 0, seconds);
  scheduleAlarm(ctx, nodes, p, 0, seconds);

  const buffer = await ctx.startRendering();
  envState.env = saved.env;
  envState.smooth = saved.smooth;
  return buffer;
}

/* ---- 信号分析 ---- */
function analyzeBuffer(buffer) {
  const chL = buffer.getChannelData(0);
  const chR = buffer.getChannelData(1);
  let peak = 0, clipCount = 0, sumL = 0, sumR = 0;
  for (let i = 0; i < chL.length; i++) {
    const aL = Math.abs(chL[i]), aR = Math.abs(chR[i]);
    if (aL > peak) peak = aL;
    if (aR > peak) peak = aR;
    if (aL >= 0.999 || aR >= 0.999) clipCount++;
    sumL += chL[i] * chL[i];
    sumR += chR[i] * chR[i];
  }
  const rmsL = Math.sqrt(sumL / chL.length);
  const rmsR = Math.sqrt(sumR / chR.length);
  return {
    duration: buffer.duration,
    peak,
    clipCount,
    rmsL,
    rmsR,
    silent: peak < 1e-4,
    clipped: clipCount > 0,
    channelMissing: (rmsL < 1e-5 && rmsR > 1e-4) || (rmsR < 1e-5 && rmsL > 1e-4)
  };
}

/* 基频估计：对中段 1 秒做单声道自相关 */
function dominantFreq(buffer) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const start = Math.floor(sr * 3);
  const N = Math.min(sr, ch.length - start);
  const minLag = Math.floor(sr / 2000), maxLag = Math.floor(sr / 50);
  let bestLag = 0, bestVal = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < N - lag; i += 2) sum += ch[start + i] * ch[start + i + lag];
    if (sum > bestVal) { bestVal = sum; bestLag = lag; }
  }
  return bestLag ? sr / bestLag : 0;
}

/* 闪避延迟：渲染缓冲中，警报开始后音乐频段能量降至一半所需时间 */
function measureRenderedDuckDelay(buffer) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const win = Math.floor(sr * 0.01);
  const energy = [];
  for (let i = 0; i + win < ch.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += ch[i + j] * ch[i + j];
    energy.push(Math.sqrt(sum / win));
  }
  // 找第一次警报开始后的能量谷底
  const startIdx = 0;
  let minE = Infinity, minIdx = 0;
  for (let i = startIdx; i < Math.min(energy.length, 300); i++) {
    if (energy[i] < minE) { minE = energy[i]; minIdx = i; }
  }
  const half = energy[0] - (energy[0] - minE) * 0.5;
  for (let i = startIdx; i <= minIdx; i++) {
    if (energy[i] <= half) return i * 10; // ms
  }
  return 0;
}

/* ---- WAV 编码（16-bit PCM 立体声） ---- */
function bufferToWav(buffer) {
  const numCh = 2, sr = buffer.sampleRate;
  const chL = buffer.getChannelData(0);
  const chR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chL;
  const dataLen = chL.length * numCh * 2;
  const out = new ArrayBuffer(44 + dataLen);
  const v = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true);
  v.setUint16(34, 16, true); writeStr(36, "data"); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < chL.length; i++) {
    const l = Math.max(-1, Math.min(1, chL[i]));
    const r = Math.max(-1, Math.min(1, chR[i]));
    v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true); off += 2;
    v.setInt16(off, r < 0 ? r * 0x8000 : r * 0x7fff, true); off += 2;
  }
  return new Blob([out], { type: "audio/wav" });
}

/* 导出前检查：静音 / 削波 / 声道缺失 */
function preExportChecks(stats) {
  return [
    { name: "静音检查", pass: !stats.silent, detail: stats.silent ? "信号为静音" : `峰值 ${stats.peak.toFixed(3)}` },
    { name: "削波检查", pass: !stats.clipped, detail: stats.clipped ? `削波采样 ${stats.clipCount} 个` : "无削波" },
    { name: "声道缺失检查", pass: !stats.channelMissing, detail: `L RMS ${stats.rmsL.toFixed(4)} / R RMS ${stats.rmsR.toFixed(4)}` }
  ];
}
