/* UI 层：Canvas 绘制、声音、交互、快照对比、场景验证 */
(function () {
'use strict';
const { Sim, BATCHES, DEVICE_DEFS, RECOVERY_TIME } = window.FDSim;
const sim = new Sim();
sim.randomFaults = true; // 自由生产模式：随机设备故障

const $ = id => document.getElementById(id);
const canvas = $('chamber'), ctx = canvas.getContext('2d');

let snap = null;            // 设备状态快照
let compareA = null;        // 快照时的运行汇总
let compareB = null;        // 重跑后的运行汇总
let rerunActive = false;

/* ---------- 声音 ---------- */
const AudioSys = {
  ctx: null, pumpOsc: null, pumpGain: null, compOsc: null, compGain: null,
  alarmOsc: null, alarmGain: null, lfo: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.pumpOsc = c.createOscillator(); this.pumpOsc.type = 'sawtooth';
    this.pumpGain = c.createGain(); this.pumpGain.gain.value = 0;
    this.pumpOsc.connect(this.pumpGain).connect(c.destination); this.pumpOsc.start();
    this.compOsc = c.createOscillator(); this.compOsc.type = 'sine';
    this.compGain = c.createGain(); this.compGain.gain.value = 0;
    this.compOsc.connect(this.compGain).connect(c.destination); this.compOsc.start();
    this.alarmOsc = c.createOscillator(); this.alarmOsc.type = 'square';
    this.alarmOsc.frequency.value = 880;
    this.alarmGain = c.createGain(); this.alarmGain.gain.value = 0;
    this.alarmOsc.connect(this.alarmGain).connect(c.destination); this.alarmOsc.start();
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 3;
    const lfoGain = c.createGain(); lfoGain.gain.value = 0.04;
    this.lfo.connect(lfoGain).connect(this.alarmGain.gain); this.lfo.start();
  },
  update() {
    if (!this.ctx) return;
    const mute = $('mute').checked;
    const d = sim.devices, bs = sim.bs;
    const pumpLoad = d.pump.on ? Math.min(1, bs.pressure / 1000) : 0;
    this.pumpOsc.frequency.value = 60 + (1 - pumpLoad) * 60;
    this.pumpGain.gain.value = (!mute && d.pump.on) ? 0.05 + pumpLoad * 0.05 : 0;
    this.compGain.gain.value = (!mute && d.compressor.on) ? 0.045 : 0;
    this.alarmGain.gain.value = (!mute && (bs.halted || bs.failed)) ? 0.05 : 0;
  },
};
document.addEventListener('pointerdown', () => AudioSys.init(), { once: true });

/* ---------- 主循环 ---------- */
let lastT = performance.now();
function loop(now) {
  const realDt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const speed = +$('speed').value;
  let simDt = realDt * speed;
  while (simDt > 0) { const step = Math.min(0.5, simDt); sim.tick(step); simDt -= step; }
  if (rerunActive && sim.allDone) { compareB = makeSummary(); rerunActive = false; renderCompare(); }
  draw();
  updatePanels();
  AudioSys.update();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- Canvas 绘制 ---------- */
const PHASE_NAMES = { prefreeze: '预冻', primary: '一次干燥', secondary: '二次干燥' };

function draw() {
  const bs = sim.bs, d = sim.devices, b = sim.batch;
  ctx.clearRect(0, 0, 640, 480);
  ctx.fillStyle = '#0b0f16'; ctx.fillRect(0, 0, 640, 480);

  // 仓体剖面
  const cx = 40, cy = 50, cw = 400, ch = 300;
  ctx.strokeStyle = bs.halted || bs.failed ? '#ff5468' : '#4a5a70';
  ctx.lineWidth = bs.halted || bs.failed ? 3 : 2;
  roundRect(cx, cy, cw, ch, 24); ctx.stroke();
  ctx.fillStyle = '#141c28'; roundRect(cx, cy, cw, ch, 24); ctx.fill();

  // 加热搁板 + 样品（三层）
  for (let i = 0; i < 3; i++) {
    const y = cy + 70 + i * 85;
    ctx.fillStyle = d.heater.on ? '#7a4a2a' : '#3a4556';
    ctx.fillRect(cx + 20, y, cw - 110, 8);
    if (d.heater.on) { // 加热丝微光
      ctx.strokeStyle = 'rgba(255,120,60,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx + 20, y + 4); ctx.lineTo(cx + cw - 90, y + 4); ctx.stroke();
    }
    drawSamples(cx + 30, y, cw - 150, bs, b);
  }

  // 冷凝器盘管（右侧）+ 霜层
  const coilX = cx + cw - 60;
  ctx.strokeStyle = d.condenser.on ? '#6fb7ff' : '#3a4556'; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let y = cy + 30; y < cy + ch - 30; y += 24) {
    ctx.moveTo(coilX - 12, y); ctx.lineTo(coilX + 12, y + 12); ctx.lineTo(coilX - 12, y + 24);
  }
  ctx.stroke();
  if (bs.frost > 0.02) { // 霜层厚度随 frost 增长
    ctx.strokeStyle = `rgba(230,245,255,${0.35 + bs.frost * 0.6})`;
    ctx.lineWidth = 2 + bs.frost * 14;
    ctx.beginPath();
    for (let y = cy + 30; y < cy + ch - 30; y += 24) {
      ctx.moveTo(coilX - 12, y); ctx.lineTo(coilX + 12, y + 12); ctx.lineTo(coilX - 12, y + 24);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#8a97a8'; ctx.font = '11px sans-serif';
  ctx.fillText('冷凝器', coilX - 18, cy + ch - 8);

  // 仓内文字信息
  ctx.fillStyle = '#dfe6ee'; ctx.font = '13px sans-serif';
  ctx.fillText(`批次 ${sim.batchIndex + 1}/3 · ${b.name} · ${bs.done ? '完成' : bs.failed ? '失败' : PHASE_NAMES[bs.phase]}`, cx + 14, cy + 24);
  if (bs.recovery > 0) {
    ctx.fillStyle = '#9fe8bb';
    ctx.fillText(`恢复验证中 ${Math.ceil(bs.recovery)}s / ${RECOVERY_TIME}s`, cx + 14, cy + 42);
  }
  if (bs.defrostT > 0) {
    ctx.fillStyle = '#8fd3ff';
    ctx.fillText(`化霜中 ${Math.ceil(bs.defrostT)}s`, cx + 14, cy + 42);
  }

  drawDeviceBox(60, 400, 'pump', '真空泵');
  drawDeviceBox(200, 400, 'compressor', '压缩机');
  drawDeviceBox(340, 400, 'heater', '加热板');
  drawDeviceBox(480, 400, 'condenser', '冷凝器');

  // 故障红闪
  if ((bs.halted || bs.failed) && Math.floor(performance.now() / 400) % 2 === 0) {
    ctx.strokeStyle = 'rgba(255,84,104,0.8)'; ctx.lineWidth = 4;
    roundRect(cx - 4, cy - 4, cw + 8, ch + 8, 28); ctx.stroke();
  }
}

function drawSamples(x, shelfY, w, bs, b) {
  const n = 8, mw = w / n;
  const moistRatio = bs.moisture / b.moisture0;
  for (let i = 0; i < n; i++) {
    const h = 6 + moistRatio * 20;
    const sx = x + i * mw + 3, sy = shelfY - h;
    if (bs.collapsed || bs.failed) {
      ctx.fillStyle = '#4a3a3a'; // 塌陷：暗色扁平
      ctx.fillRect(sx, shelfY - 5, mw - 6, 5);
    } else {
      const frozen = bs.productTemp < 0;
      ctx.fillStyle = frozen ? mixColor(b.color, '#bfe8ff', 0.45) : b.color;
      ctx.fillRect(sx, sy, mw - 6, h);
      if (frozen) { // 冰晶高光
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(sx, sy, mw - 6, 2);
      }
    }
  }
}

function drawDeviceBox(x, y, key, label) {
  const dev = sim.devices[key];
  ctx.fillStyle = dev.fault ? '#4a1520' : dev.on ? '#16324a' : '#1a2330';
  ctx.strokeStyle = dev.fault ? '#ff5468' : dev.on ? '#3f9d63' : '#2a3648';
  ctx.lineWidth = 2;
  roundRect(x, y, 110, 56, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = dev.fault ? '#ffb3bc' : '#c6d2e0';
  ctx.font = '12px sans-serif';
  ctx.fillText(label + (dev.fault ? ' ✕故障' : dev.on ? ' ●运行' : ' ○停止'), x + 10, y + 20);
  if (dev.on) { // 转子动画
    const a = performance.now() / 120;
    ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x + 92, y + 40, 8, a, a + 4.2); ctx.stroke();
  }
  ctx.fillStyle = '#6b7889'; ctx.font = '10px sans-serif';
  ctx.fillText(`启${dev.starts} 停${dev.stops}`, x + 10, y + 44);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mixColor(hexA, hexB, t) {
  const pa = [1, 3, 5].map(i => parseInt(hexA.substr(i, 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(hexB.substr(i, 2), 16));
  return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',') + ')';
}

/* ---------- 面板刷新 ---------- */
let lastEventCount = -1, lastResultCount = -1;

function updatePanels() {
  const bs = sim.bs, b = sim.batch;
  $('g-temp').textContent = bs.productTemp.toFixed(1) + ' ℃';
  $('g-press').textContent = bs.pressure > 1000 ? (bs.pressure / 1000).toFixed(1) + ' kPa' : bs.pressure.toFixed(0) + ' Pa';
  $('g-moist').textContent = (bs.moisture * 100).toFixed(1) + ' %';
  $('g-frost').textContent = (bs.frost * 100).toFixed(0) + ' %';
  $('g-power').textContent = bs.power.toFixed(1) + ' kW';

  const phaseTxt = bs.done ? '完成' : bs.failed ? '失败' : bs.halted ? '故障停机' : PHASE_NAMES[bs.phase];
  $('run-status').textContent = sim.allDone
    ? (sim.results.every(r => r.stopReason === '正常完成') ? '🎉 三批全部达标' : '生产结束（有未达标批次）')
    : `批次${sim.batchIndex + 1} ${b.name} · ${phaseTxt} · t=${bs.t.toFixed(0)}s` + (sim.paused ? ' · 已暂停' : '');

  // 设备状态
  $('device-list').innerHTML = Object.keys(DEVICE_DEFS).map(k => {
    const dev = sim.devices[k];
    const cls = dev.fault ? 'dev fault' : dev.on ? 'dev on' : 'dev';
    const st = dev.fault ? '故障' : dev.on ? '运行' : '停止';
    return `<span class="${cls}">${DEVICE_DEFS[k].label} ${st} (启${dev.starts}/停${dev.stops})</span>`;
  }).join('');

  // 事件日志（增量）
  if (sim.events.length !== lastEventCount) {
    lastEventCount = sim.events.length;
    const el = $('event-log');
    el.innerHTML = sim.events.slice(-80).map(e =>
      `<div class="${e.cls}">[${e.t.toFixed(0).padStart(5)}s|批${e.batch + 1}] ${e.device} ${e.action} ${e.detail}</div>`
    ).join('');
    el.scrollTop = el.scrollHeight;
  }

  // 结果表（增量）
  if (sim.results.length !== lastResultCount) {
    lastResultCount = sim.results.length;
    $('result-table').querySelector('tbody').innerHTML = sim.results.map(r =>
      `<tr><td>${r.name}</td><td>${r.good}</td><td>${r.waste}</td><td>${r.peakPower} kW</td><td>${r.stopReason}</td></tr>`
    ).join('');
  }

  // 批次标签页
  $('batch-tabs').innerHTML = BATCHES.map((bb, i) => {
    let cls = i === sim.batchIndex ? 'active' : '';
    if (i < sim.results.length) cls += sim.results[i].stopReason === '正常完成' ? ' done' : ' failed';
    if (i < sim.results.length || i > sim.batchIndex) cls += ' locked';
    return `<button class="${cls}" data-i="${i}">${bb.name}</button>`;
  }).join('');
  $('batch-label').textContent = `— 当前：${b.name}（初始含水 ${(b.moisture0 * 100).toFixed(0)}%）`;
  $('batch-hint').textContent =
    `要求：预冻≤${b.prefreezeReq}℃ · 真空≤${b.vacuumReq}Pa · 斜率≤${b.maxRamp}℃/min · 塌陷温度 ${b.collapseTemp}℃`;

  // 按钮状态
  const curDone = sim.results.length > sim.batchIndex;
  $('btn-start').disabled = sim.running || sim.allDone;
  $('btn-start').textContent = curDone ? '▶ 下一批次' : sim.running ? '运行中…' : '▶ 开始批次';
  $('btn-pause').disabled = !sim.running;
  $('btn-pause').textContent = sim.paused ? '▶ 继续' : '⏸ 暂停检查';
  $('btn-reset').disabled = curDone || sim.allDone;
  $('btn-defrost').disabled = !sim.running || bs.defrostT > 0 || bs.halted ||
    (bs.phase !== 'primary' && bs.phase !== 'secondary');
  $('btn-repair').classList.toggle('hidden', !(bs.halted && bs.repairT <= 0));
  $('btn-repair').disabled = !bs.halted;

  // 失败横幅
  const banner = $('failure-banner');
  if (bs.halted && bs.failureInfo) {
    banner.classList.remove('hidden');
    banner.textContent = `⚠ 设备故障停机\n设备：${bs.failureInfo.device}\n触发值：${bs.failureInfo.text}` +
      (bs.repairT > 0 ? `\n维修中… 剩余 ${Math.ceil(bs.repairT)}s` : '\n请点击「维修设备」');
  } else if (bs.failed && bs.failureInfo) {
    banner.classList.remove('hidden');
    banner.textContent = `✕ 批次失败\n设备：${bs.failureInfo.device}\n触发值：${bs.failureInfo.text}`;
  } else {
    banner.classList.add('hidden');
  }
}

/* ---------- 参数控件 ---------- */
function bindParam(id, key, fmt) {
  const el = $(id);
  el.addEventListener('input', () => {
    $('o-' + key).textContent = el.value;
    if (!sim.setParams(sim.batchIndex, { [key]: +el.value })) {
      $('o-' + key).textContent = sim.params[sim.batchIndex][key]; // 已完成批次拒绝修改
    }
  });
}
bindParam('p-prefreeze', 'prefreeze');
bindParam('p-vacuum', 'vacuum');
bindParam('p-ramp', 'ramp');

function syncSliders() {
  const p = sim.params[sim.batchIndex];
  $('p-prefreeze').value = p.prefreeze; $('o-prefreeze').textContent = p.prefreeze;
  $('p-vacuum').value = p.vacuum; $('o-vacuum').textContent = p.vacuum;
  $('p-ramp').value = p.ramp; $('o-ramp').textContent = p.ramp;
}
syncSliders();

/* ---------- 控制按钮 ---------- */
$('btn-start').addEventListener('click', () => {
  if (sim.results.length > sim.batchIndex) { sim.nextBatch(); syncSliders(); }
  sim.start();
});
$('btn-pause').addEventListener('click', () => sim.pauseToggle());
$('btn-reset').addEventListener('click', () => { sim.resetCurrentBatch(); syncSliders(); });
$('btn-defrost').addEventListener('click', () => sim.startDefrost());
$('btn-repair').addEventListener('click', () => sim.repair());

/* ---------- 快照 / 对比 ---------- */
function makeSummary() {
  return {
    results: sim.results.map(r => ({
      name: r.name, good: r.good, waste: r.waste,
      peakPower: r.peakPower, stopReason: r.stopReason, params: r.params,
    })),
    exceptions: sim.exceptions.map(e => `批${e.batch + 1} ${e.type}·${e.device}：${e.trigger}${e.handled ? '（已处理）' : ''}`),
  };
}

$('btn-snapshot').addEventListener('click', () => {
  snap = sim.snapshot();
  compareA = makeSummary();
  compareB = null;
  $('btn-rerun').disabled = false;
  $('snapshot-info').textContent =
    `已保存快照：批次${sim.batchIndex + 1} · t=${sim.absT.toFixed(0)}s · 已完成 ${sim.results.length} 批`;
  renderCompare();
});

$('btn-rerun').addEventListener('click', () => {
  if (!snap) return;
  sim.restore(snap);
  rerunActive = true;
  compareB = null;
  syncSliders();
  $('snapshot-info').textContent = '已从快照恢复，可修改参数后重新运行（结果实时填入对比列 B）';
  renderCompare();
});

function summaryHtml(s) {
  if (!s || !s.results.length) return '<div>（暂无已完成批次）</div>';
  let h = '<table class="cmp-table"><tr><th>批次</th><th>良品</th><th>废品</th><th>峰值功耗</th><th>停机原因</th></tr>';
  h += s.results.map(r =>
    `<tr><td>${r.name}</td><td>${r.good}</td><td>${r.waste}</td><td>${r.peakPower}kW</td><td>${r.stopReason}</td></tr>`
  ).join('') + '</table>';
  if (s.exceptions.length) {
    h += '<div class="exc">异常处理记录：<br>' + s.exceptions.join('<br>') + '</div>';
  }
  return h;
}

function renderCompare() {
  if (!compareA) { $('compare').innerHTML = ''; return; }
  const noExc = compareA.exceptions.length === 0 &&
    (!compareB || compareB.exceptions.length === 0);
  $('compare').innerHTML =
    `<div class="cmp-col"><h3>A · 快照时</h3>${summaryHtml(compareA)}</div>` +
    `<div class="cmp-col"><h3>B · 重跑</h3>${compareB ? summaryHtml(compareB) : '（等待重跑完成）'}</div>` +
    (noExc ? '<div class="exc" style="width:100%">提示：两次运行均无异常处理记录，可触发一次设备故障或参数越限后再对比</div>' : '');
}

/* ---------- 场景验证 ---------- */
document.querySelectorAll('#scenario-panel [data-scn]').forEach(btn => {
  btn.addEventListener('click', () => {
    const r = window.FDScenarios.runScenario(btn.dataset.scn);
    const el = $('scenario-report');
    el.innerHTML = `<b class="${r.pass ? 'pass' : 'fail'}">【${r.name}】${r.pass ? 'PASS ✔' : 'FAIL ✘'}</b>\n` +
      r.lines.map(l => `<span class="${l.ok ? 'pass' : 'fail'}">${l.ok ? '✓' : '✗'} ${l.text}</span>`).join('\n');
  });
});
})();
