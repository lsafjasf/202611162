/* 三维验证（声道 / 频段 / 节拍）与保存-重载一致性对比 */
"use strict";

/* 简易 radix-2 FFT（用于频谱质心） */
function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

function spectralCentroid(buffer, startSec = 3.0) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const N = 8192;
  const start = Math.floor(sr * startSec); // 默认取警报结束后的纯音乐段
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
    re[i] = (ch[start + i] || 0) * w;
  }
  fftRadix2(re, im);
  let num = 0, den = 0;
  for (let i = 1; i < N / 2; i++) {
    const mag = Math.hypot(re[i], im[i]);
    num += mag * (i * sr / N);
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

function stereoCorrelation(buffer, startSec = 2.6) {
  const chL = buffer.getChannelData(0);
  const chR = buffer.getChannelData(1);
  const sr = buffer.sampleRate;
  const i0 = Math.floor(sr * startSec); // 跳过居中警报段，只看音乐
  let sLL = 0, sRR = 0, sLR = 0;
  for (let i = i0; i < chL.length; i += 4) {
    sLL += chL[i] * chL[i];
    sRR += chR[i] * chR[i];
    sLR += chL[i] * chR[i];
  }
  return sLR / Math.max(1e-12, Math.sqrt(sLL * sRR));
}

/* 节拍间隔：能量通量峰值的中位间隔（秒） */
function beatInterval(buffer) {
  const sr = buffer.sampleRate;
  const ch = buffer.getChannelData(0);
  const hop = Math.floor(sr * 0.01);
  const env = [];
  for (let i = 0; i + hop < ch.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += ch[i + j] * ch[i + j];
    env.push(Math.sqrt(sum / hop));
  }
  const onsets = [];
  for (let i = 2; i < env.length - 1; i++) {
    const flux = env[i] - env[i - 1];
    if (flux > 0.01 && flux >= env[i - 1] - env[i - 2] && flux >= env[i + 1] - env[i]) {
      if (!onsets.length || i - onsets[onsets.length - 1] > 10) onsets.push(i);
    }
  }
  if (onsets.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < onsets.length; i++) diffs.push((onsets[i] - onsets[i - 1]) * 0.01);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function metricRow(name, valA, valB, unit, minRelChange) {
  const rel = Math.abs(valB - valA) / Math.max(1e-9, Math.abs(valA));
  const pass = rel >= minRelChange;
  return { name, valA, valB, unit, pass, rel };
}

async function runDimensionChecks() {
  const base = { ...params };
  const rows = [];

  // 维度 1：立体声声道（width 0 → 1），看 L/R 相关性是否真实变化
  const bufW0 = await renderOffline({ ...base, width: 0 }, 4);
  const bufW1 = await renderOffline({ ...base, width: 1 }, 4);
  const corrA = stereoCorrelation(bufW0), corrB = stereoCorrelation(bufW1);
  rows.push(metricRow("声道（L/R 相关性，width 0→1）", corrA, corrB, "", 0.05));

  // 维度 2：频段（cutoff 400 → 6000），看频谱质心是否真实变化
  const bufC0 = await renderOffline({ ...base, cutoff: 400 }, 4);
  const bufC1 = await renderOffline({ ...base, cutoff: 6000 }, 4);
  const centA = spectralCentroid(bufC0), centB = spectralCentroid(bufC1);
  rows.push(metricRow("频段（频谱质心 Hz，cutoff 400→6000）", centA, centB, "Hz", 0.15));

  // 维度 3：节拍（bpm 80 → 160），看起音间隔是否真实变化
  const bufB0 = await renderOffline({ ...base, bpm: 80 }, 6);
  const bufB1 = await renderOffline({ ...base, bpm: 160 }, 6);
  const intA = beatInterval(bufB0), intB = beatInterval(bufB1);
  rows.push(metricRow("节拍（起音间隔 s，bpm 80→160）", intA, intB, "s", 0.2));

  return rows;
}

/* 保存参数 → 重新载入 → 再次导出，对比时长 / 峰值 / 音高 / 延迟 */
async function runConsistencyCheck() {
  const snapshot = saveParams();
  const loaded = loadParams();
  if (!loaded) return { ok: false, reason: "localStorage 无已保存参数" };

  const bufA = await renderOffline(snapshot, EXPORT_SECONDS);
  const bufB = await renderOffline(loaded, EXPORT_SECONDS);
  // 仅音乐参考轨：消除警报掩盖，测真实闪避延迟
  const refA = await renderOffline(snapshot, EXPORT_SECONDS, { env: 0, smooth: 1 }, { muteAlarm: true });
  const refB = await renderOffline(loaded, EXPORT_SECONDS, { env: 0, smooth: 1 }, { muteAlarm: true });
  const statsA = analyzeBuffer(bufA);
  const statsB = analyzeBuffer(bufB);
  const freqA = dominantFreq(bufA), freqB = dominantFreq(bufB);
  const delayA = measureRenderedDuckDelay(refA), delayB = measureRenderedDuckDelay(refB);

  const cmp = (a, b, tol) => Math.abs(a - b) <= tol;
  return {
    ok: true,
    rows: [
      { name: "导出时长 (s)", a: statsA.duration, b: statsB.duration, pass: cmp(statsA.duration, statsB.duration, 0.001) },
      { name: "关键峰值", a: statsA.peak, b: statsB.peak, pass: cmp(statsA.peak, statsB.peak, 0.001) },
      { name: "关键音高 (Hz)", a: freqA, b: freqB, pass: cmp(freqA, freqB, 1.5) },
      { name: "闪避延迟 (ms)", a: delayA, b: delayB, pass: cmp(delayA, delayB, 20) }
    ],
    buffers: { bufA, bufB, statsA, statsB }
  };
}
