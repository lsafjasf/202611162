import {
  EQUIPMENT_DEFS,
  NOMINAL_PARAMS,
  PARAM_LIMITS,
  PROCESS,
  ProductionEngine,
  findSafetyIssues,
  formatSimClock,
  getPrediction,
} from './engine.js';
import { LineCanvasRenderer } from './canvas.js';
import { MachineAudio } from './audio.js';
import { createDemoArchive, runVerificationSuite } from './scenarios.js';

const $ = (id) => document.getElementById(id);

const engine = new ProductionEngine({ sequence: 20, snapshotSequence: 3 });
const audio = new MachineAudio();
let timebase = 1;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let powerHistory = Array.from({ length: 14 }, () => 0.2);
let selectedBatches = [];
let shownCompletedBatches = new Set();
let toastTimer = null;
let verificationResults = [];
let previousState = 'idle';
let summaryWasOpen = false;
let pendingSnapshotId = null;
let lastLogSignature = '';

const els = {
  headerBatchId: $('headerBatchId'),
  headerCoil: $('headerCoil'),
  soundButton: $('soundButton'),
  soundLabel: $('soundLabel'),
  pauseButton: $('pauseButton'),
  resetButton: $('resetButton'),
  runStateBadge: $('runStateBadge'),
  canvasBatch: $('canvasBatch'),
  canvasClock: $('canvasClock'),
  coilQueue: $('coilQueue'),
  recoveryHud: $('recoveryHud'),
  recoveryCountdown: $('recoveryCountdown'),
  pauseOverlay: $('pauseOverlay'),
  failureOverlay: $('failureOverlay'),
  failureTime: $('failureTime'),
  failureDevice: $('failureDevice'),
  failureValue: $('failureValue'),
  failureLimit: $('failureLimit'),
  failureDetail: $('failureDetail'),
  failureResidual: $('failureResidual'),
  safeParamsButton: $('safeParamsButton'),
  recoverButton: $('recoverButton'),
  recoverHint: $('recoverHint'),
  tensionValue: $('tensionValue'),
  tensionBar: $('tensionBar'),
  heatValue: $('heatValue'),
  heatBar: $('heatBar'),
  diameterValue: $('diameterValue'),
  diameterNeedle: $('diameterNeedle'),
  powerValue: $('powerValue'),
  peakPowerMini: $('peakPowerMini'),
  powerBars: $('powerBars'),
  equipmentSummary: $('equipmentSummary'),
  equipmentStrip: $('equipmentStrip'),
  eventLog: $('eventLog'),
  speedRange: $('speedRange'),
  speedOutput: $('speedOutput'),
  lubeRange: $('lubeRange'),
  lubeOutput: $('lubeOutput'),
  die1Range: $('die1Range'),
  die2Range: $('die2Range'),
  die3Range: $('die3Range'),
  die1Output: $('die1Output'),
  die2Output: $('die2Output'),
  die3Output: $('die3Output'),
  presetButton: $('presetButton'),
  processForecast: $('processForecast'),
  forecastMeter: $('forecastMeter'),
  startButton: $('startButton'),
  faultMenuButton: $('faultMenuButton'),
  faultMenu: $('faultMenu'),
  snapshotButton: $('snapshotButton'),
  snapshotList: $('snapshotList'),
  runVerificationButton: $('runVerificationButton'),
  verificationGrid: $('verificationGrid'),
  verificationFootnote: $('verificationFootnote'),
  batchTableBody: $('batchTableBody'),
  comparePanel: $('comparePanel'),
  compareSubtitle: $('compareSubtitle'),
  compareCount: $('compareCount'),
  compareContent: $('compareContent'),
  summaryDialog: $('summaryDialog'),
  summaryContent: $('summaryContent'),
  toast: $('toast'),
};

const rangeElements = [
  { input: els.speedRange, output: els.speedOutput, suffix: 'm/min', digits: 0 },
  { input: els.lubeRange, output: els.lubeOutput, suffix: '%', digits: 0 },
  { input: els.die1Range, output: els.die1Output, suffix: '', digits: 3 },
  { input: els.die2Range, output: els.die2Output, suffix: '', digits: 3 },
  { input: els.die3Range, output: els.die3Output, suffix: '', digits: 3 },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, warning = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('is-warning', warning);
  els.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3400);
}

function resultLabel(result) {
  if (result === 'success') return { text: '全部合格', className: '' };
  if (result === 'partial') return { text: '完成 · 有废品', className: 'scrap' };
  if (result === 'cancelled') return { text: '批次中止', className: 'cancelled' };
  return { text: '全部报废', className: 'scrap' };
}

function statusLabel(state) {
  return {
    running: '运行中',
    paused: '已暂停',
    failed: '联锁停机',
    recovering: '恢复自检',
    complete: '批次完成',
    cancelled: '已重置',
    idle: '待机',
  }[state] || state;
}

function statusClass(state) {
  if (state === 'running') return 'is-running';
  if (state === 'paused') return 'is-paused';
  if (state === 'failed') return 'is-failed';
  if (state === 'recovering') return 'is-recovering';
  return 'is-idle';
}

function updateRangeVisual(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty('--range-fill', `${((value - min) / (max - min)) * 100}%`);
}

function syncControlsFromEngine() {
  const { params } = engine;
  els.speedRange.value = String(params.speed);
  els.lubeRange.value = String(params.lube);
  els.die1Range.value = String(params.dies[0]);
  els.die2Range.value = String(params.dies[1]);
  els.die3Range.value = String(params.dies[2]);
  for (const item of rangeElements) {
    const value = Number(item.input.value);
    item.output.innerHTML = item.suffix
      ? `${value.toFixed(item.digits)} <i>${item.suffix}</i>`
      : value.toFixed(item.digits);
    updateRangeVisual(item.input);
  }
  renderForecast();
  updateRecoveryHint();
}

function hydrateSnapshotData() {
  const demoRecords = createDemoArchive();
  engine.seedHistory(demoRecords.slice().reverse());
  const equipmentAtStart = EQUIPMENT_DEFS.map((item) => ({
    id: item.id,
    name: item.name,
    status: 'running',
    startedAt: 0,
    stoppedAt: null,
  }));
  for (const record of demoRecords.slice().reverse()) {
    engine.seedSnapshot({
      id: record.id === 'B-261116-001' ? 'S-01' : 'S-02',
      label: record.id === 'B-261116-001' ? '标准工艺基准' : '异常批次前快照',
      createdAt: record.createdAt,
      batchId: record.id,
      simElapsed: 0,
      params: record.startParams,
      equipment: equipmentAtStart,
      telemetry: { tension: 95.4, heat: 63, diameter: 0.8, power: 6.2 },
    });
  }
  selectedBatches = demoRecords.slice(0, 2).map((record) => record.id);
}

hydrateSnapshotData();
const renderer = new LineCanvasRenderer($('lineCanvas'), engine);
renderer.start();

function renderForecast() {
  const prediction = getPrediction(engine.params, true);
  const issues = findSafetyIssues(engine.params);
  const pressure = Math.max(
    prediction.tension / PROCESS.tensionLimit,
    prediction.heatTarget / PROCESS.heatLimit,
    prediction.diameterError / PROCESS.diameterTolerance,
  );
  const level = Math.min(10, Math.ceil(pressure * 10));
  const bars = [...els.forecastMeter.children];
  bars.forEach((bar, index) => {
    bar.className = '';
    if (index < level) {
      bar.classList.add(issues.length ? 'danger' : level >= 8 ? 'warn' : 'on');
    }
  });
  if (issues.length) {
    els.processForecast.textContent = `${issues[0].label}越限`;
    els.processForecast.className = 'danger';
  } else if (pressure >= 0.8) {
    els.processForecast.textContent = '接近联锁边界';
    els.processForecast.className = 'warning';
  } else {
    els.processForecast.textContent = `稳定 · ${prediction.diameter.toFixed(3)} mm`;
    els.processForecast.className = '';
  }
}

function deviceStatusText(device) {
  if (device.status === 'fault') return '故障';
  if (device.status === 'running') return '运行';
  if (device.status === 'stopped') return '已停止';
  return '待机';
}

function renderEquipment() {
  els.equipmentStrip.innerHTML = EQUIPMENT_DEFS.map((definition) => {
    const device = engine.equipment[definition.id];
    const start = device.startedAt === null ? '—' : formatSimClock(device.startedAt);
    const stop = device.stoppedAt === null ? '—' : formatSimClock(device.stoppedAt);
    const runningCount = Object.values(engine.equipment).filter((item) => item.status === 'running').length;
    const faultCount = Object.values(engine.equipment).filter((item) => item.status === 'fault').length;
    const summary = faultCount
      ? `${faultCount} 台设备故障`
      : runningCount
        ? `${runningCount} 台设备运行`
        : '4 台设备待机';
    if (definition.id === 'payoff') els.equipmentSummary.textContent = summary;
    return `
      <article class="equipment-item ${device.status === 'running' ? 'is-running' : ''} ${device.status === 'fault' ? 'is-fault' : ''}">
        <span class="device-symbol" aria-hidden="true"></span>
        <div class="device-info">
          <span>${escapeHtml(device.name)}</span>
          <div class="device-state-line"><i></i>${deviceStatusText(device)} · ${device.code}</div>
          <span class="device-clock">启 ${start} · 停 ${stop}</span>
        </div>
      </article>
    `;
  }).join('');
  if (!engine.batch) els.equipmentSummary.textContent = '4 台设备待机';
}

function renderLogs() {
  const logs = engine.batch?.logs?.slice(-5).reverse() || [];
  const signature = logs.map((entry) => `${entry.at}-${entry.device}-${entry.action}`).join('|');
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;
  if (!logs.length) {
    els.eventLog.innerHTML = '<div class="log-line"><time>--:--.-</time><b>系统</b><span>等待批次启动，设备时序将在此记录</span></div>';
    return;
  }
  els.eventLog.innerHTML = logs.map((entry) => `
    <div class="log-line ${entry.type === 'alarm' ? 'is-alarm' : entry.type === 'pause' ? 'is-pause' : entry.type === 'system' ? 'is-system' : ''}">
      <time>${escapeHtml(entry.clock)}</time>
      <b>${escapeHtml(entry.device)}</b>
      <span>${escapeHtml(entry.action)} · ${escapeHtml(entry.detail)}</span>
    </div>
  `).join('');
}

function renderCoilQueue() {
  const attempts = engine.batch?.attempts || [];
  const current = engine.batch?.currentAttempt;
  els.coilQueue.innerHTML = Array.from({ length: PROCESS.coilsPerBatch }, (_, index) => {
    const attempt = attempts.find((item) => item.index === index);
    const active = current?.index === index;
    const status = attempt?.status || (active ? 'active' : 'pending');
    const className = status === 'good' ? 'is-good' : status === 'scrap' ? 'is-scrap' : active ? 'is-active' : '';
    const label = status === 'good' ? '良' : status === 'scrap' ? '废' : active ? '生产中' : '待产';
    return `<span class="coil-chip ${className}"><i></i>卷 ${String(index + 1).padStart(2, '0')} · ${label}</span>`;
  }).join('');
}

function setStateBadge(state) {
  els.runStateBadge.className = `state-badge ${statusClass(state)}`;
  els.runStateBadge.innerHTML = `<i></i><span>${statusLabel(state)}</span>`;
}

function renderTelemetry() {
  const telemetry = engine.telemetry;
  const active = Boolean(engine.batch && !['complete', 'cancelled'].includes(engine.state));
  const tension = active ? telemetry.tension : 0;
  const heat = active ? telemetry.heat : 24;
  const diameter = active ? telemetry.diameter : 0;
  const power = active ? telemetry.power : 0;
  els.tensionValue.textContent = active ? tension.toFixed(1) : '—';
  els.heatValue.textContent = active ? heat.toFixed(1) : '—';
  els.diameterValue.textContent = diameter && !engine.isFailed ? diameter.toFixed(3) : diameter ? diameter.toFixed(3) : '—';
  els.powerValue.textContent = active ? power.toFixed(1) : '—';
  els.tensionBar.style.width = `${Math.min(100, tension / PROCESS.tensionLimit * 100)}%`;
  els.tensionBar.style.background = tension >= PROCESS.tensionLimit
    ? 'linear-gradient(90deg, var(--amber), var(--red))'
    : '';
  els.heatBar.style.width = `${Math.min(100, heat / PROCESS.heatLimit * 100)}%`;
  els.heatBar.style.background = heat >= PROCESS.heatLimit
    ? 'linear-gradient(90deg, var(--amber), var(--red))'
    : '';
  const needlePosition = clampNumber(((diameter || PROCESS.targetDiameter) - 0.75) / 0.1 * 100, 1, 99);
  els.diameterNeedle.style.left = `${needlePosition}%`;
  els.diameterNeedle.style.background = Math.abs((diameter || 0.8) - PROCESS.targetDiameter) > PROCESS.diameterTolerance
    ? 'var(--red)'
    : 'var(--mint)';
  els.peakPowerMini.textContent = engine.batch
    ? `${(engine.batch.peakPower || 0).toFixed(1)} kW`
    : '— kW';
  if (active) {
    powerHistory.push(power);
    powerHistory = powerHistory.slice(-14);
  }
  const maxPower = Math.max(12, ...powerHistory);
  els.powerBars.innerHTML = powerHistory.map((value, index) => `
    <i class="${index === powerHistory.length - 1 ? 'hot' : ''}" style="height:${Math.max(7, value / maxPower * 100)}%"></i>
  `).join('');
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

function renderHeader() {
  const batch = engine.batch;
  els.headerBatchId.textContent = batch?.id || '待启动';
  const currentNumber = batch
    ? Math.min(PROCESS.coilsPerBatch, (batch.currentAttempt?.index ?? batch.attempts.length) + 1)
    : 0;
  els.headerCoil.textContent = `卷 ${batch ? currentNumber : 0} / 3`;
  els.canvasBatch.textContent = batch ? `${batch.id} · ${batch.label}` : 'NO ACTIVE BATCH';
  els.canvasClock.textContent = batch ? formatSimClock(batch.simElapsed) : '00:00.0';
  els.pauseButton.disabled = !batch || !['running', 'recovering', 'paused'].includes(engine.state);
  els.pauseButton.querySelector('span:last-child').textContent = engine.isPaused ? '继续' : '暂停';
  els.resetButton.disabled = !batch || engine.state === 'complete';
  els.startButton.disabled = engine.isActive;
  els.startButton.querySelector('span:last-child').textContent = engine.isActive ? '批次运行中' : '启动批次';
  els.recoveryHud.hidden = engine.state !== 'recovering';
  els.recoveryCountdown.textContent = (batch?.recoveryRemaining || 0).toFixed(1);
  els.pauseOverlay.hidden = engine.state !== 'paused';
  setStateBadge(engine.state);
}

function renderFailure() {
  const failed = engine.state === 'failed' && engine.lastFailure;
  els.failureOverlay.hidden = !failed;
  if (!failed) return;
  const failure = engine.lastFailure;
  const deviceName = failure.causeDevice && failure.causeDevice !== failure.device
    ? `${failure.device} / 根因 ${failure.causeDevice}`
    : failure.device;
  els.failureTime.textContent = `T+${formatSimClock(failure.at)}`;
  els.failureDevice.textContent = deviceName;
  els.failureValue.textContent = `${failure.value} ${failure.unit}`;
  els.failureLimit.textContent = `限值 ${failure.limit}`;
  els.failureDetail.textContent = `${failure.detail} 当前线卷 ${failure.attemptId} 已整段报废。`;
  const check = engine.lastRecoveryCheck;
  if (check) {
    els.failureResidual.hidden = false;
    els.failureResidual.textContent = `上次恢复自检：${check.passed ? '通过' : '失败'} · 残留张力 ${check.residual.tensionLoad} / 热 ${check.residual.thermalLoad} / 线径 ${check.residual.diameterError}`;
  } else {
    els.failureResidual.hidden = true;
  }
  updateRecoveryHint();
}

function updateRecoveryHint() {
  if (engine.state !== 'failed') {
    els.recoverHint.textContent = '';
    els.recoverButton.disabled = false;
    return;
  }
  const readiness = engine.checkRecoveryReady();
  if (readiness.ready) {
    els.recoverButton.disabled = false;
    els.recoverHint.textContent = '参数窗口安全，可进入固定 8.0 s 恢复自检。';
  } else {
    els.recoverButton.disabled = true;
    const issue = readiness.issues[0];
    els.recoverHint.textContent = `需先修正 ${issue.label}：${issue.value}（允许 ${issue.limit}）`;
  }
}

function renderSnapshots() {
  if (!engine.snapshots.length) {
    els.snapshotList.innerHTML = '<div class="snapshot-empty">尚无快照。保存后可载入参数进行重跑。</div>';
    return;
  }
  els.snapshotList.innerHTML = engine.snapshots.map((snapshot) => `
    <article class="snapshot-item">
      <div>
        <strong>${escapeHtml(snapshot.id)} · ${escapeHtml(snapshot.label)}</strong>
        <p>${snapshot.params.speed} m/min · 润滑 ${snapshot.params.lube}% · 模孔 ${snapshot.params.dies.map((die) => die.toFixed(3)).join(' / ')}</p>
      </div>
      <button type="button" data-snapshot-load="${escapeHtml(snapshot.id)}">载入重跑</button>
    </article>
  `).join('');
}

function renderVerification() {
  if (!verificationResults.length) return;
  const classes = { normal: '', equipment: 'is-fault', parameter: 'is-limit' };
  els.verificationGrid.innerHTML = verificationResults.map((result) => `
    <article class="verification-case ${classes[result.key] || ''}">
      <div class="case-topline">
        <span class="case-name"><i></i>${escapeHtml(result.title)}</span>
        <span class="case-status ${result.pass ? '' : 'fail'}">${result.pass ? 'VERIFIED' : 'FAILED'}</span>
      </div>
      <div class="case-trigger">${escapeHtml(result.triggerText)}</div>
      <div class="case-stats">
        <span>良品<b>${result.good}</b></span>
        <span>废品<b>${result.scrap}</b></span>
        <span>恢复<b class="${result.pass ? '' : 'danger'}">${result.recoveryText.startsWith('8.0 s 自检通过') ? '0 残留' : result.recoveryText.startsWith('无故障') ? '无需' : '异常'}</b></span>
      </div>
    </article>
  `).join('');
  const allPassed = verificationResults.every((result) => result.pass);
  els.verificationFootnote.textContent = allPassed
    ? '三项验证全部通过 · 每种故障均定位设备与触发值 · 恢复后固定 8.0 s 自检无累计残留'
    : '存在未通过项，请检查联锁逻辑与恢复状态清理';
  els.verificationFootnote.className = `verification-footnote ${allPassed ? '' : 'danger'}`;
}

function renderArchive() {
  const records = engine.history;
  if (!records.length) {
    els.batchTableBody.innerHTML = '<tr><td colspan="8" class="muted">暂无已完成批次</td></tr>';
    return;
  }
  els.batchTableBody.innerHTML = records.map((record) => {
    const result = resultLabel(record.result);
    const selected = selectedBatches.includes(record.id);
    return `
      <tr data-batch-row="${escapeHtml(record.id)}">
        <td><input class="compare-check" type="checkbox" data-compare-id="${escapeHtml(record.id)}" ${selected ? 'checked' : ''} aria-label="选择 ${escapeHtml(record.id)} 进行比较" /></td>
        <td class="batch-id">${escapeHtml(record.id)}</td>
        <td><span class="result-pill ${result.className}"><i></i>${result.text}</span></td>
        <td>${record.good}</td>
        <td class="${record.scrap ? 'danger' : ''}">${record.scrap}</td>
        <td>${record.peakPower.toFixed(1)} kW</td>
        <td title="${escapeHtml(record.shutdownReason)}">${escapeHtml(record.shutdownReason)}</td>
        <td>${record.anomaly
          ? `<span class="anomaly-flag">已处理 · ${escapeHtml(record.anomaly.device)}</span>`
          : '<span class="anomaly-flag none">无异常</span>'}</td>
      </tr>
    `;
  }).join('');
}

function compareRow(label, first, second, better = '') {
  return `
    <div class="compare-row ${better ? `is-better-${better}` : ''}">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(first)}</span>
      <span>${escapeHtml(second)}</span>
    </div>
  `;
}

function renderCompare() {
  const records = selectedBatches
    .map((id) => engine.history.find((record) => record.id === id))
    .filter(Boolean);
  els.compareCount.textContent = `${records.length} / 2`;
  els.compareSubtitle.textContent = records.length === 2
    ? `${records[0].id} ↔ ${records[1].id} · 只读结果`
    : '从档案中选择两个批次';
  if (records.length < 2) {
    els.compareContent.innerHTML = `
      <div class="compare-placeholder">
        <b>选择两个已完成批次</b>
        勾选左侧档案即可并排核对良品、功耗、停机与异常处理。
      </div>
    `;
    return;
  }
  const [first, second] = records;
  const firstResult = resultLabel(first.result);
  const secondResult = resultLabel(second.result);
  const firstRecovery = first.recoveryCheck
    ? `${first.recoveryCheck.passed ? '通过' : '失败'} / 残留 ${first.recoveryCheck.residual.tensionLoad + first.recoveryCheck.residual.thermalLoad + first.recoveryCheck.residual.diameterError}`
    : '无需恢复';
  const secondRecovery = second.recoveryCheck
    ? `${second.recoveryCheck.passed ? '通过' : '失败'} / 残留 ${second.recoveryCheck.residual.tensionLoad + second.recoveryCheck.residual.thermalLoad + second.recoveryCheck.residual.diameterError}`
    : '无需恢复';
  els.compareContent.innerHTML = `
    <div class="compare-head">
      <span>指标</span><span>${escapeHtml(first.id)}</span><span>${escapeHtml(second.id)}</span>
    </div>
    ${compareRow('结果', firstResult.text, secondResult.text, first.scrap < second.scrap ? 'first' : first.scrap > second.scrap ? 'second' : '')}
    ${compareRow('良品 / 废品', `${first.good} / ${first.scrap}`, `${second.good} / ${second.scrap}`, first.scrap < second.scrap ? 'first' : first.scrap > second.scrap ? 'second' : '')}
    ${compareRow('峰值功耗', `${first.peakPower.toFixed(1)} kW`, `${second.peakPower.toFixed(1)} kW`)}
    ${compareRow('批次时长', `${first.durationSec.toFixed(1)} s`, `${second.durationSec.toFixed(1)} s`)}
    ${compareRow('停机原因', first.shutdownReason, second.shutdownReason)}
    ${compareRow('异常处理', first.anomaly ? `${first.anomaly.device} / ${first.anomaly.displayValue}` : '无', second.anomaly ? `${second.anomaly.device} / ${second.anomaly.displayValue}` : '无')}
    ${compareRow('恢复自检', firstRecovery, secondRecovery)}
    <div class="compare-note">两批数据均来自完成时深冻结的只读档案。载入快照只会复制参数，不会修改任何已封存结果。</div>
  `;
}

function renderAll() {
  renderHeader();
  renderEquipment();
  renderLogs();
  renderCoilQueue();
  renderTelemetry();
  renderFailure();
  renderSnapshots();
  renderArchive();
  renderCompare();
}

function setSummaryDialog(record) {
  const title = record.result === 'cancelled'
    ? '批次中止 · 操作员重置'
    : record.good === 3
      ? '批次完成 · 三卷全部合格'
      : '批次完成 · 已计入废品';
  const recovery = record.recoveryCheck
    ? `<div class="summary-handling">异常处理：<b>${escapeHtml(record.anomaly?.device || '联锁设备')}</b> · ${record.recoveryCheck.passed ? `固定 8.0 s 自检通过，残留 0` : '恢复自检失败'}</div>`
    : '';
  els.summaryContent.innerHTML = `
    <div class="summary-hero ${record.scrap ? 'is-failed' : ''}">
      <div class="summary-kicker">
        <span>BATCH SEALED / ${escapeHtml(record.id)}</span>
        <span>${record.locked ? '只读封存' : ''}</span>
      </div>
      <h2>${title}</h2>
      <p>${escapeHtml(record.label)} · 时长 ${record.durationSec.toFixed(1)} s · 数据已锁定</p>
      <div class="summary-metrics">
        <div class="summary-metric"><span>良品</span><strong>${record.good}<small>卷</small></strong></div>
        <div class="summary-metric"><span>废品</span><strong class="${record.scrap ? 'danger' : ''}">${record.scrap}<small>卷</small></strong></div>
        <div class="summary-metric"><span>峰值功耗</span><strong>${record.peakPower.toFixed(1)}<small>kW</small></strong></div>
        <div class="summary-metric"><span>异常处理</span><strong>${record.anomaly ? '1' : '0'}<small>次</small></strong></div>
      </div>
      <div class="summary-reason ${record.scrap ? '' : 'is-clean'}">
        停机原因：${escapeHtml(record.shutdownReason)}
      </div>
      ${recovery}
    </div>
    <div class="summary-actions">
      <button class="button button-ghost" type="button" data-summary-action="close">关闭</button>
      <button class="button button-primary" type="button" data-summary-action="compare">并排比较</button>
    </div>
  `;
}

function openSummary(record) {
  setSummaryDialog(record);
  summaryWasOpen = true;
  if (typeof els.summaryDialog.showModal === 'function') {
    els.summaryDialog.showModal();
  } else {
    els.summaryDialog.setAttribute('open', '');
  }
}

function onBatchCompleted(record) {
  shownCompletedBatches.add(record.id);
  const priorCompleted = engine.history.find((item) => item.id !== record.id && item.result !== 'cancelled');
  selectedBatches = priorCompleted ? [priorCompleted.id, record.id] : [record.id];
  renderArchive();
  renderCompare();
  openSummary(record);
  toast(`批次 ${record.id} 已封存：良品 ${record.good} / 废品 ${record.scrap}`);
}

function refreshDynamic(now) {
  renderHeader();
  renderEquipment();
  renderLogs();
  renderCoilQueue();
  renderTelemetry();
  renderFailure();
  audio.update({
    running: engine.state === 'running',
    speed: engine.telemetry.motorSpeed || engine.params.speed,
    friction: engine.telemetry.friction || getPrediction(engine.params).friction,
    heat: engine.telemetry.heat,
    failed: engine.state === 'failed',
    paused: engine.state === 'paused',
    recovering: engine.state === 'recovering',
  });

  if (engine.state !== previousState) {
    if (engine.state === 'failed') {
      toast(`联锁停机：${engine.lastFailure?.device} ${engine.lastFailure?.displayValue}`, true);
    }
    if (previousState === 'recovering' && engine.state === 'running') {
      const check = engine.lastRecoveryCheck;
      toast(check?.passed ? '恢复自检通过：张力 / 热 / 线径累计均归零' : '恢复自检未通过，请检查设备');
    }
    previousState = engine.state;
  }

  if (engine.lastCompleted && !shownCompletedBatches.has(engine.lastCompleted.id)) {
    onBatchCompleted(engine.lastCompleted);
  }

  if (engine.state === 'complete' && els.summaryDialog.open === false && summaryWasOpen) {
    summaryWasOpen = false;
  }
  lastUiUpdate = now;
}

function simulationLoop(now) {
  const realDelta = Math.min(0.12, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (engine.batch && ['running', 'recovering'].includes(engine.state)) {
    engine.tick(realDelta * timebase);
  }
  if (now - lastUiUpdate >= 65) {
    refreshDynamic(now);
  }
  requestAnimationFrame(simulationLoop);
}

async function startProduction() {
  if (engine.isActive) return;
  try {
    if (audio.enabled) await audio.init();
  } catch {
    toast('浏览器阻止了音频启动，可点击声音按钮重试。', true);
  }
  engine.startBatch({
    label: `手动批次 · ${timebase}× 时基`,
    snapshotId: pendingSnapshotId,
  });
  pendingSnapshotId = null;
  powerHistory = Array.from({ length: 14 }, () => 0.2);
  previousState = 'running';
  refreshDynamic(performance.now());
  renderAll();
  toast(`批次已启动：三道模具联锁监控中`);
}

function togglePause() {
  if (engine.isPaused) {
    engine.resume();
    toast('继续运行，工艺时钟已恢复');
  } else {
    engine.pause();
    toast('生产已暂停，设备时序与累计值已冻结');
  }
  renderHeader();
  renderEquipment();
  renderLogs();
}

function resetBatch() {
  if (!engine.batch || engine.state === 'complete') {
    toast('当前没有可重置的活动批次。', true);
    return;
  }
  const result = engine.cancelCurrentBatch();
  if (!result.ok) {
    toast(result.reason, true);
    return;
  }
  previousState = 'idle';
  powerHistory = Array.from({ length: 14 }, () => 0.2);
  renderAll();
  toast(result.archived
    ? '当前批次已重置，未完成数据已封存为中止记录'
    : '当前批次已重置');
  if (result.record) {
    const prior = engine.history.find((record) => record.id !== result.record.id && record.result !== 'cancelled');
    selectedBatches = prior ? [prior.id, result.record.id] : [result.record.id];
    renderArchive();
    renderCompare();
    openSummary(result.record);
  }
}

function handleRangeInput(item, index) {
  const value = Number(item.input.value);
  if (index === 0) engine.setParams({ speed: value });
  if (index === 1) engine.setParams({ lube: value });
  if (index >= 2) {
    const dies = [...engine.params.dies];
    dies[index - 2] = value;
    engine.setParams({ dies });
  }
  item.output.innerHTML = item.suffix
    ? `${value.toFixed(item.digits)} <i>${item.suffix}</i>`
    : value.toFixed(item.digits);
  updateRangeVisual(item.input);
  renderForecast();
  updateRecoveryHint();
}

rangeElements.forEach((item, index) => {
  item.input.addEventListener('input', () => handleRangeInput(item, index));
});

els.presetButton.addEventListener('click', () => {
  if (engine.isActive && engine.state !== 'failed') {
    toast('运行中已应用标准工艺，联锁将实时复核。');
  }
  engine.applyNominalParams();
  syncControlsFromEngine();
});

els.startButton.addEventListener('click', startProduction);
els.pauseButton.addEventListener('click', togglePause);
els.resetButton.addEventListener('click', resetBatch);

document.querySelectorAll('[data-timebase]').forEach((button) => {
  button.addEventListener('click', () => {
    timebase = Number(button.dataset.timebase);
    document.querySelectorAll('[data-timebase]').forEach((item) => item.classList.toggle('active', item === button));
    toast(`仿真时基设为 ${timebase}×；恢复自检仍按 8.0 s 工艺时间执行`);
  });
});

els.soundButton.addEventListener('click', async () => {
  const next = !audio.enabled;
  try {
    await audio.setEnabled(next);
    els.soundButton.classList.toggle('sound-on', next);
    els.soundButton.classList.toggle('sound-off', !next);
    els.soundButton.setAttribute('aria-pressed', String(next));
    els.soundLabel.textContent = next ? '声音' : '静音';
    if (next) {
      audio.update({
        running: engine.state === 'running',
        speed: engine.telemetry.motorSpeed || engine.params.speed,
        friction: engine.telemetry.friction,
        heat: engine.telemetry.heat,
        failed: engine.state === 'failed',
        paused: engine.state === 'paused',
        recovering: engine.state === 'recovering',
      });
    }
  } catch {
    toast('当前浏览器无法启用实时音频。', true);
  }
});

els.faultMenuButton.addEventListener('click', () => {
  const open = els.faultMenu.hidden;
  els.faultMenu.hidden = !open;
  els.faultMenuButton.setAttribute('aria-expanded', String(open));
});

els.faultMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-fault]');
  if (!button) return;
  const result = engine.injectFault(button.dataset.fault);
  els.faultMenu.hidden = true;
  els.faultMenuButton.setAttribute('aria-expanded', 'false');
  if (!result.ok) {
    toast(result.reason, true);
    return;
  }
  toast(button.dataset.fault === 'pump'
    ? '润滑泵失压已注入：有效流量下降，模温将持续上升'
    : '收卷电机轴承故障已注入：变频器联锁响应', true);
  refreshDynamic(performance.now());
  renderLogs();
});

els.safeParamsButton.addEventListener('click', () => {
  engine.applyNominalParams();
  syncControlsFromEngine();
  updateRecoveryHint();
  toast('已恢复标准工艺参数，可执行恢复自检');
});

els.recoverButton.addEventListener('click', () => {
  const result = engine.recover();
  if (!result.ok) {
    const issueText = result.issues.map((issue) => `${issue.label} ${issue.value}`).join('；');
    els.recoverHint.textContent = `恢复被拦截：${issueText}`;
    toast('参数仍超出安全窗口，恢复未启动。', true);
    return;
  }
  els.failureOverlay.hidden = true;
  els.recoverHint.textContent = '';
  previousState = 'recovering';
  refreshDynamic(performance.now());
  renderEquipment();
  renderLogs();
  toast('恢复自检开始：设备重启，固定运行 8.0 s');
});

els.snapshotButton.addEventListener('click', () => {
  const snapshot = engine.saveSnapshot(`当前状态 · ${engine.batch?.id || '待机'}`);
  renderSnapshots();
  toast(`快照 ${snapshot.id} 已保存；载入后修改参数可创建重跑批次`);
});

els.snapshotList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-snapshot-load]');
  if (!button) return;
  const result = engine.restoreSnapshot(button.dataset.snapshotLoad);
  if (!result.ok) {
    toast(result.reason, true);
    return;
  }
  pendingSnapshotId = result.snapshot.id;
  syncControlsFromEngine();
  toast(`已载入 ${result.snapshot.id}；调整参数后启动，新批次将关联此快照`);
});

els.runVerificationButton.addEventListener('click', () => {
  els.runVerificationButton.disabled = true;
  els.runVerificationButton.textContent = '验证运行中…';
  setTimeout(() => {
    verificationResults = runVerificationSuite();
    renderVerification();
    els.runVerificationButton.disabled = false;
    els.runVerificationButton.textContent = '重新验证三种工况';
    toast('三种工况已用独立引擎回放完成，未影响当前批次');
  }, 40);
});

els.batchTableBody.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-compare-id]');
  if (!checkbox) return;
  const id = checkbox.dataset.compareId;
  if (checkbox.checked) {
    if (selectedBatches.length >= 2) {
      checkbox.checked = false;
      toast('最多并排比较两个批次，请先取消一个勾选。', true);
      return;
    }
    selectedBatches.push(id);
  } else {
    selectedBatches = selectedBatches.filter((item) => item !== id);
  }
  renderCompare();
});

els.summaryContent.addEventListener('click', (event) => {
  const button = event.target.closest('[data-summary-action]');
  if (!button) return;
  const action = button.dataset.summaryAction;
  els.summaryDialog.close();
  summaryWasOpen = false;
  if (action === 'compare') {
    document.getElementById('comparePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

els.summaryDialog.addEventListener('close', () => {
  summaryWasOpen = false;
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    togglePause();
  }
});

verificationResults = runVerificationSuite();
syncControlsFromEngine();
renderVerification();
renderAll();
requestAnimationFrame((now) => {
  lastFrame = now;
  lastUiUpdate = now;
  requestAnimationFrame(simulationLoop);
});
