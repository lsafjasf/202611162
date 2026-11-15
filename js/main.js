/* 主控：传输控制、前瞻调度、导出、验证接线 */
"use strict";

let audioCtx = null;
let nodes = null;
let schedTimer = null;
let startCtxTime = 0;
let scheduledUntil = 0;
let isPlaying = false;
let lastExport = null; // { stats, freq, delay, blob }

const LOOKAHEAD = 0.25;
const CHUNK = 0.1;

const $ = id => document.getElementById(id);
const setStatus = msg => { $("transportStatus").textContent = msg; };

function pushHistory(pts) {
  for (const pt of pts) envHistory.push({ t: pt.t, env: pt.env, gain: pt.gain });
  const cutoff = envHistory[envHistory.length - 1].t - HISTORY_SECONDS - 2;
  while (envHistory.length && envHistory[0].t < cutoff) envHistory.shift();
}

function schedTick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime - startCtxTime;
  while (scheduledUntil < now + LOOKAHEAD) {
    const t0 = scheduledUntil, t1 = t0 + CHUNK;
    const pts = computeAutomation(t0, t1, params);
    applyAutomation(nodes.duckGain.gain, pts, startCtxTime);
    scheduleMusic(audioCtx, nodes, params, t0, t1);
    scheduleAlarm(audioCtx, nodes, params, t0, t1);
    pushHistory(pts);
    scheduledUntil = t1;
  }
}

function startGraph() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  nodes = buildMixGraph(audioCtx, params);
  nodes.master.connect(audioCtx.destination);
  meters.init(audioCtx, nodes.master);
  startCtxTime = audioCtx.currentTime + 0.05;
  scheduledUntil = 0;
  schedTimer = setInterval(schedTick, 40);
  schedTick();
}

function teardownGraph() {
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  nodes = null;
}

async function onPlay() {
  if (audioCtx && audioCtx.state === "suspended") {
    await audioCtx.resume();
    schedTimer = setInterval(schedTick, 40);
  } else if (!audioCtx) {
    startGraph();
  }
  isPlaying = true;
  $("btnPlay").disabled = true;
  $("btnPause").disabled = false;
  $("btnReplay").disabled = false;
  setStatus("播放中 — 调整参数，声音与仪表将在约 0.3s 内收敛。");
}

async function onPause() {
  if (!audioCtx) return;
  clearInterval(schedTimer); schedTimer = null;
  await audioCtx.suspend(); // 包络状态保留在 envState，恢复后无缝继续
  isPlaying = false;
  $("btnPlay").disabled = false;
  $("btnPause").disabled = true;
  setStatus(`已暂停。包络状态保持：env=${envState.env.toFixed(3)}，gain=${envState.smooth.toFixed(3)}`);
}

function onReplay() {
  // 重播：重建图，但保留同一包络状态，避免增益跳变 / 泵感
  teardownGraph();
  envHistory.length = 0;
  startGraph();
  isPlaying = true;
  $("btnPlay").disabled = true;
  $("btnPause").disabled = false;
  $("btnReplay").disabled = false;
  setStatus(`重播（包络状态延续：env=${envState.env.toFixed(3)}，gain=${envState.smooth.toFixed(3)}）。`);
}

function renderChecks(el, checks) {
  el.innerHTML = checks.map(c =>
    `<div class="${c.pass ? "ok" : "bad"}">${c.pass ? "✓" : "✗"} ${c.name} — ${c.detail}</div>`
  ).join("");
}

async function onExport() {
  setStatus("离线渲染混音中…");
  const buffer = await renderOffline(params, EXPORT_SECONDS);
  const refBuf = await renderOffline(params, EXPORT_SECONDS, { env: 0, smooth: 1 }, { muteAlarm: true });
  const stats = analyzeBuffer(buffer);
  const checks = preExportChecks(stats);
  renderChecks($("exportChecks"), checks);

  const freq = dominantFreq(buffer);
  const delay = measureRenderedDuckDelay(refBuf);
  const blob = bufferToWav(buffer);
  lastExport = { stats, freq, delay, blob };

  const allPass = checks.every(c => c.pass);
  if (allPass) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `duckmix_${Date.now()}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(`导出完成：${stats.duration.toFixed(2)}s，峰值 ${stats.peak.toFixed(3)}，音高 ${freq.toFixed(1)}Hz，延迟 ${delay}ms。`);
  } else {
    setStatus("导出被阻止：存在检查失败项，请先修正参数。");
  }
}

async function onReloadAndCompare() {
  const loaded = loadParams();
  if (!loaded) { $("consistencyReport").textContent = "未找到已保存参数，请先点击“保存参数”。"; return; }
  setStatus("重新载入参数并再次离线渲染…");

  const buffer = await renderOffline(params, EXPORT_SECONDS);
  const refBuf = await renderOffline(params, EXPORT_SECONDS, { env: 0, smooth: 1 }, { muteAlarm: true });
  const stats = analyzeBuffer(buffer);
  const freq = dominantFreq(buffer);
  const delay = measureRenderedDuckDelay(refBuf);

  if (!lastExport) {
    lastExport = { stats, freq, delay, blob: bufferToWav(buffer) };
    $("consistencyReport").textContent = "已重载并渲染基准文件，请修改参数后再次导出以对比。";
    return;
  }

  const rows = [
    ["导出时长 (s)", lastExport.stats.duration, stats.duration, 0.001],
    ["关键峰值", lastExport.stats.peak, stats.peak, 0.001],
    ["关键音高 (Hz)", lastExport.freq, freq, 1.5],
    ["闪避延迟 (ms)", lastExport.delay, delay, 20]
  ];
  let html = "<table><tr><th>指标</th><th>已保存导出</th><th>重载后导出</th><th>结果</th></tr>";
  for (const [name, a, b, tol] of rows) {
    const pass = Math.abs(a - b) <= tol;
    html += `<tr><td>${name}</td><td>${Number(a).toFixed(4)}</td><td>${Number(b).toFixed(4)}</td>` +
            `<td class="${pass ? "ok" : "bad"}">${pass ? "一致" : "不一致"}</td></tr>`;
  }
  html += "</table>";
  $("consistencyReport").innerHTML = html;
  lastExport = { stats, freq, delay, blob: bufferToWav(buffer) };
  setStatus("重载对比完成。");
}

async function onVerify() {
  $("verifyReport").textContent = "正在离线渲染对比样本…";
  const rows = await runDimensionChecks();
  let html = "<table><tr><th>维度</th><th>参数 A</th><th>参数 B</th><th>相对变化</th><th>结果</th></tr>";
  for (const r of rows) {
    html += `<tr><td>${r.name}</td><td>${r.valA.toFixed(3)}${r.unit}</td>` +
            `<td>${r.valB.toFixed(3)}${r.unit}</td><td>${(r.rel * 100).toFixed(1)}%</td>` +
            `<td class="${r.pass ? "ok" : "bad"}">${r.pass ? "✓ 真实改变" : "✗ 未改变"}</td></tr>`;
  }
  html += "</table>";
  $("verifyReport").innerHTML = html;
  setStatus("三维验证完成。");
}

/* 动画回路：仪表 + Canvas */
function animLoop() {
  if (audioCtx && audioCtx.state === "running") {
    const levels = meters.updateReadouts();
    meters.draw(levels);
  }
  requestAnimationFrame(animLoop);
}

window.addEventListener("DOMContentLoaded", () => {
  bindParamUI(() => {
    // 滤波截止直接作用于运行中的图，其余参数由下一轮调度拾取
    if (nodes) nodes.filter.frequency.setTargetAtTime(params.cutoff, audioCtx.currentTime, 0.05);
  });
  $("btnPlay").addEventListener("click", onPlay);
  $("btnPause").addEventListener("click", onPause);
  $("btnReplay").addEventListener("click", onReplay);
  $("btnResetParams").addEventListener("click", () => { resetParams(); setStatus("参数已重置为默认值。"); });
  $("btnExport").addEventListener("click", onExport);
  $("btnSaveParams").addEventListener("click", () => { saveParams(); setStatus("参数已保存到 localStorage。"); });
  $("btnReloadParams").addEventListener("click", onReloadAndCompare);
  $("btnVerify").addEventListener("click", onVerify);
  $("btnExport").disabled = false;
  animLoop();
});
