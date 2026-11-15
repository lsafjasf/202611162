import {
  PressSimulator,
  PARAM_SPECS,
  DEVICE_DEFS
} from "./simulator.js";
import { PressRenderer } from "./renderer.js";
import { PressAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const canvas = $("#pressCanvas");
const simulator = new PressSimulator();
const renderer = new PressRenderer(canvas, simulator);
const audio = new PressAudio();
const ui = {
  phaseLabel: $("#phaseLabel"),
  lineStatus: $("#lineStatus"),
  batchLabel: $("#batchLabel"),
  soundBtn: $("#soundBtn"),
  runBtn: $("#runBtn"),
  runBtnText: $("#runBtnText"),
  resetBtn: $("#resetBtn"),
  rollBtn: $("#rollBtn"),
  endBtn: $("#endBtn"),
  injectFaultBtn: $("#injectFaultBtn"),
  faultSelect: $("#faultSelect"),
  recoverBtn: $("#recoverBtn"),
  faultOverlay: $("#faultOverlay"),
  faultTitle: $("#faultTitle"),
  faultDetail: $("#faultDetail"),
  faultDevice: $("#faultDevice"),
  faultTrigger: $("#faultTrigger"),
  faultThreshold: $("#faultThreshold"),
  faultImpact: $("#faultImpact"),
  goodCount: $("#goodCount"),
  wasteCount: $("#wasteCount"),
  goodStreak: $("#goodStreak"),
  streakPips: $("#streakPips"),
  powerNow: $("#powerNow"),
  peakPower: $("#peakPower"),
  regValue: $("#regValue"),
  qualityHint: $("#qualityHint"),
  canvasClock: $("#canvasClock"),
  canvasReg: $("#canvasReg"),
  canvasInk: $("#canvasInk"),
  canvasDry: $("#canvasDry"),
  eventCount: $("#eventCount"),
  deviceStrip: $("#deviceStrip"),
  eventList: $("#eventList"),
  auditPanel: $("#auditPanel"),
  auditState: $("#auditState"),
  auditTime: $("#auditTime"),
  auditBar: $("#auditBar"),
  auditResidual: $("#auditResidual"),
  auditCounter: $("#auditCounter"),
  auditErrors: $("#auditErrors"),
  historyList: $("#historyList"),
  compareA: $("#compareA"),
  compareB: $("#compareB"),
  compareTable: $("#compareTable"),
  snapshotList: $("#snapshotList"),
  saveSnapshotBtn: $("#saveSnapshotBtn"),
  toastStack: $("#toastStack"),
  batchDialog: $("#batchDialog"),
  dialogKicker: $("#dialogKicker"),
  dialogTitle: $("#dialogTitle"),
  reportStats: $("#reportStats"),
  reportReason: $("#reportReason"),
  reportAnomalies: $("#reportAnomalies")
};

const phaseText = {
  ready: "待机",
  running: "生产中",
  paused: "暂停检查",
  rollChange: "换卷中",
  faulted: "故障停机",
  complete: "批次完成",
  ended: "已归档"
};

const runText = {
  ready: "启动生产",
  running: "暂停检查",
  paused: "继续生产",
  rollChange: "换卷中",
  faulted: "故障停机",
  complete: "开始下一批",
  ended: "开始下一批"
};

let lastFrame = performance.now();
let lastSheet = null;
let eventRevision = -1;
let deviceRevision = "";
let compareInitialized = false;
let modalBatchId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatElapsed(ms) {
  const seconds = Math.max(0, ms) / 1000;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function toast(message, type = "info") {
  if (ui.toastStack.children.length >= 3) ui.toastStack.firstElementChild?.remove();
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  ui.toastStack.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function setParamInputs() {
  $$("input[data-param]").forEach((input) => {
    const key = input.dataset.param;
    const value = simulator.params[key];
    if (document.activeElement !== input) input.value = value;
    const row = input.closest(".param-row");
    const spec = PARAM_SPECS[key];
    row.classList.toggle("out-of-safe", value < spec.safe[0] || value > spec.safe[1]);
    row.classList.toggle("out-of-hard", value < spec.hard[0] || value > spec.hard[1]);
    row.querySelector("output").innerHTML = `<b>${value.toFixed(0)}</b> ${spec.unit}`;
  });
}

function updateMetrics() {
  const batch = simulator.batch;
  ui.phaseLabel.textContent = phaseText[simulator.phase] || simulator.phase;
  ui.batchLabel.textContent = batch.id;
  ui.lineStatus.classList.toggle("is-running", ["running", "rollChange"].includes(simulator.phase));
  ui.lineStatus.classList.toggle("is-faulted", simulator.phase === "faulted");
  ui.goodCount.textContent = batch.goodCount;
  ui.wasteCount.textContent = batch.wasteCount;
  ui.goodStreak.textContent = batch.goodStreak;
  ui.powerNow.textContent = simulator.powerKw.toFixed(2);
  ui.peakPower.textContent = batch.peakPower.toFixed(2);
  ui.regValue.textContent = simulator.transient.registration.toFixed(2);
  ui.canvasClock.textContent = `T+${formatElapsed(simulator.timeMs)}`;
  ui.canvasReg.textContent = `Δ ${simulator.transient.registration.toFixed(2)} mm`;
  ui.canvasInk.textContent = `${simulator.params.ink.toFixed(0)}%`;
  ui.canvasDry.textContent = simulator.params.dryer.toFixed(0);

  const quality = ui.regValue.closest(".quality-metric");
  const registrationBad = simulator.transient.registration > 0.12 || simulator.transient.ghost > 0.18;
  const inkBad = simulator.transient.buildup > 0.2 || simulator.transient.strike;
  quality.classList.toggle("warning", registrationBad && !inkBad);
  quality.classList.toggle("bad", registrationBad || inkBad);
  if (simulator.phase === "faulted") {
    ui.qualityHint.textContent = "保护停机";
  } else if (!lastSheet) {
    ui.qualityHint.textContent = "等待纸带";
  } else if (lastSheet.good) {
    ui.qualityHint.textContent = `第 ${lastSheet.n} 张 · 合格`;
  } else {
    ui.qualityHint.textContent = `第 ${lastSheet.n} 张 · ${lastSheet.defects.join(" / ")}`;
  }

  const pips = ui.streakPips.children;
  if (!pips.length) {
    for (let index = 0; index < 10; index += 1) {
      ui.streakPips.append(document.createElement("i"));
    }
  }
  [...ui.streakPips.children].forEach((pip, index) => {
    pip.classList.toggle("on", index < batch.goodStreak);
  });
}

function updateControls() {
  const phase = simulator.phase;
  ui.runBtnText.textContent = runText[phase] || "启动生产";
  ui.runBtn.classList.toggle("is-pause", phase === "running");
  ui.runBtn.disabled = ["faulted", "rollChange"].includes(phase);
  ui.rollBtn.disabled = phase !== "running";
  ui.endBtn.disabled = ["complete", "ended"].includes(phase);
  ui.injectFaultBtn.disabled = !["running", "paused"].includes(phase);
  ui.faultSelect.disabled = !["running", "paused"].includes(phase);
  ui.recoverBtn.disabled = phase !== "faulted";
  setParamInputs();
}

function updateFaultPanel() {
  const fault = simulator.fault;
  if (!fault) {
    ui.faultOverlay.classList.add("is-hidden");
    return;
  }
  ui.faultOverlay.classList.remove("is-hidden");
  ui.faultTitle.textContent = fault.title;
  ui.faultDetail.textContent = fault.detail;
  ui.faultDevice.textContent = DEVICE_DEFS[fault.device]?.label || fault.device;
  ui.faultTrigger.textContent = fault.triggerValue;
  ui.faultThreshold.textContent = fault.threshold;
  ui.faultImpact.textContent = fault.impact;
}

function updateDeviceStrip() {
  const signature = Object.values(simulator.devices)
    .map((device) => `${device.on ? 1 : 0}${device.faulted ? 1 : 0}`)
    .join("");
  if (signature === deviceRevision) return;
  deviceRevision = signature;
  ui.deviceStrip.innerHTML = Object.entries(DEVICE_DEFS).map(([id, def]) => {
    const device = simulator.devices[id];
    const className = device.faulted ? "faulted" : device.on ? "on" : "";
    const state = device.faulted ? "FAULT" : device.on ? "RUN" : "STOP";
    return `
      <div class="device-chip ${className}">
        <span><i class="device-dot"></i>${def.short}</span>
        <strong>${state}</strong>
      </div>`;
  }).join("");
}

function renderEvents(force = false) {
  const count = simulator.batch.events.length;
  if (!force && count === eventRevision) return;
  eventRevision = count;
  ui.eventCount.textContent = `${count} EVENTS`;
  if (!count) {
    ui.eventList.innerHTML = '<div class="empty-state">设备启动后，这里会按时间记录每一次启停。</div>';
    return;
  }
  const rows = simulator.batch.events.slice(-80).reverse().map((event) => {
    const stop = event.action === "stop";
    return `
      <div class="event-row ${stop ? "stop" : "start"}">
        <span class="event-time">${event.clock}</span>
        <i class="event-dot"></i>
        <span class="event-main">
          <strong>${escapeHtml(event.deviceLabel)}</strong>
          <small>${escapeHtml(event.reason)} · T+${(event.atMs / 1000).toFixed(1)}s</small>
        </span>
        <span class="event-action">${stop ? "STOP" : "START"}</span>
      </div>`;
  });
  ui.eventList.innerHTML = rows.join("");
}

function updateAuditPanel() {
  const audits = simulator.batch.recoveryAudits;
  const audit = audits[audits.length - 1];
  if (!audit) {
    ui.auditPanel.classList.add("is-hidden");
    return;
  }
  ui.auditPanel.classList.remove("is-hidden");
  ui.auditPanel.classList.toggle("passed", audit.finished && audit.passed);
  ui.auditPanel.classList.toggle("failed", audit.finished && !audit.passed);
  const ratio = Math.min(1, audit.elapsedMs / audit.durationMs);
  ui.auditBar.style.width = `${ratio * 100}%`;
  ui.auditTime.textContent = `${(audit.elapsedMs / 1000).toFixed(1)} / ${(audit.durationMs / 1000).toFixed(1)} s`;
  ui.auditState.textContent = !audit.finished
    ? "恢复审计中"
    : audit.passed ? "恢复审计通过" : "恢复审计失败";
  const residualError = audit.errors.some((error) => /残留|供墨|状态/.test(error));
  const counterError = audit.errors.some((error) => /计数/.test(error));
  ui.auditResidual.textContent = !audit.finished
    ? "状态残留检查中"
    : residualError ? "检测到状态残留" : "状态残留 0";
  ui.auditCounter.textContent = !audit.finished
    ? "计数一致性检查中"
    : counterError ? "计数不一致" : "计数增量一致";
  ui.auditResidual.classList.toggle("ok", audit.finished && !residualError);
  ui.auditCounter.classList.toggle("ok", audit.finished && !counterError);
  ui.auditErrors.textContent = audit.errors.join(" · ");
}

function sortedHistory() {
  return simulator.getHistory().slice().sort((a, b) => a.serial - b.serial);
}

function renderHistory() {
  const history = sortedHistory();
  if (!history.length) {
    ui.historyList.innerHTML = '<div class="empty-state small">完成或结束一个批次后生成报告。</div>';
  } else {
    ui.historyList.innerHTML = history.slice().reverse().map((batch) => {
      const abnormal = batch.anomalies.length > 0;
      const status = batch.status === "completed" ? "COMPLETE" : "ARCHIVED";
      return `
        <button class="history-card" type="button" data-batch="${batch.id}">
          <div class="history-top">
            <span class="history-id">${batch.id}</span>
            <span class="history-badge ${abnormal ? "abnormal" : ""}">${status}${abnormal ? " · EXCEPTION" : ""}</span>
          </div>
          <div class="history-stats">
            <span>良 <b>${batch.goodCount}</b></span>
            <span>废 <b>${batch.wasteCount}</b></span>
            <span>峰值 <b>${batch.peakPower.toFixed(2)} kW</b></span>
          </div>
          <p class="history-reason">${escapeHtml(batch.stopReason?.text || "批次结束")}</p>
        </button>`;
    }).join("");
  }

  const oldA = ui.compareA.value;
  const oldB = ui.compareB.value;
  const options = history.map((batch) => `<option value="${batch.id}">${batch.id}</option>`).join("");
  ui.compareA.innerHTML = options;
  ui.compareB.innerHTML = options;
  if (history.length >= 2) {
    if (!compareInitialized || !history.some((batch) => batch.id === oldA)) {
      ui.compareA.value = history[history.length - 2].id;
    } else {
      ui.compareA.value = oldA;
    }
    if (!compareInitialized || !history.some((batch) => batch.id === oldB)) {
      ui.compareB.value = history[history.length - 1].id;
    } else {
      ui.compareB.value = oldB;
    }
    compareInitialized = true;
  }
  ui.compareA.disabled = history.length < 2;
  ui.compareB.disabled = history.length < 2;
  renderCompare();
}

function compareRow(label, left, right, className = "") {
  return `
    <div class="compare-row ${className}">
      <span>${label}</span>
      <b>${left}</b>
      <b>${right}</b>
    </div>`;
}

function anomalySummary(batch) {
  const faults = batch.anomalies.filter((item) => item.type === "fault");
  const recoveries = batch.anomalies.filter((item) => item.type === "recovery");
  const audits = batch.recoveryAudits || [];
  if (!faults.length && !recoveries.length) return "无异常";
  const first = faults[0];
  const audit = audits[audits.length - 1];
  const auditText = audit
    ? audit.finished ? `恢复审计 ${audit.passed ? "PASS" : "FAIL"} · ${(audit.elapsedMs / 1000).toFixed(1)}s` : "审计进行中"
    : "未执行恢复审计";
  return `<span class="anomaly-cell">${faults.length} 次异常 / ${recoveries.length} 次处理<small>${escapeHtml(first?.title || "换卷联锁")} · ${escapeHtml(first?.triggerValue || "已联锁")} / ${auditText}</small></span>`;
}

function paramSummary(batch) {
  const p = batch.paramsFinal;
  return `P${p.pressure.toFixed(0)} / I${p.ink.toFixed(0)} / D${p.dryer.toFixed(0)} / T${p.tension.toFixed(0)}`;
}

function renderCompare() {
  const history = sortedHistory();
  if (history.length < 2) {
    ui.compareTable.innerHTML = '<div class="empty-state small">至少需要两个归档批次。<br>保存快照 → 修改参数 → 重跑即可对照。</div>';
    return;
  }
  const left = history.find((batch) => batch.id === ui.compareA.value) || history[history.length - 2];
  const right = history.find((batch) => batch.id === ui.compareB.value) || history[history.length - 1];
  const duration = (batch) => `${((batch.endedAtMs || 0) / 1000).toFixed(1)} s`;
  ui.compareTable.innerHTML = [
    `<div class="compare-row header"><span>指标</span><b>${left.id}</b><b>${right.id}</b></div>`,
    compareRow("良品", left.goodCount, right.goodCount),
    compareRow("废品", left.wasteCount, right.wasteCount),
    compareRow("峰值功耗", `${left.peakPower.toFixed(2)} kW`, `${right.peakPower.toFixed(2)} kW`),
    compareRow("停机原因", escapeHtml(left.stopReason?.text || "—"), escapeHtml(right.stopReason?.text || "—")),
    compareRow("参数 P/I/D/T", paramSummary(left), paramSummary(right)),
    compareRow("异常处理", anomalySummary(left), anomalySummary(right)),
    compareRow("批次用时", duration(left), duration(right)),
    compareRow("数据状态", "已冻结", "已冻结")
  ].join("");
}

function showBatchReport(batch) {
  if (!batch) return;
  modalBatchId = batch.id;
  const complete = batch.status === "completed";
  ui.dialogKicker.textContent = complete ? "BATCH COMPLETE · 连续十张合格" : "BATCH ARCHIVED · 批次已归档";
  ui.dialogTitle.textContent = `${batch.id} 批次报告`;
  ui.reportStats.innerHTML = `
    <div class="report-stat"><span>良品</span><strong>${batch.goodCount}<small> 张</small></strong></div>
    <div class="report-stat"><span>废品</span><strong>${batch.wasteCount}<small> 张</small></strong></div>
    <div class="report-stat"><span>峰值功耗</span><strong>${batch.peakPower.toFixed(2)}<small> kW</small></strong></div>
    <div class="report-stat"><span>批次用时</span><strong>${((batch.endedAtMs || 0) / 1000).toFixed(1)}<small> s</small></strong></div>`;
  const reason = batch.stopReason || {};
  const reasonDevice = reason.deviceLabel ? ` · ${reason.deviceLabel}` : "";
  const reasonValue = reason.triggerValue ? ` · 触发 ${reason.triggerValue}` : "";
  ui.reportReason.innerHTML = `<strong>停机原因 / ${escapeHtml(reasonDevice.replace(" · ", ""))}</strong><br>${escapeHtml(reason.text || "—")}${escapeHtml(reasonValue)}`;

  const anomalies = batch.anomalies || [];
  if (!anomalies.length) {
    ui.reportAnomalies.innerHTML = "<strong>异常处理记录</strong><br>本批次无设备故障或联锁事件。";
  } else {
    const rows = anomalies.map((item) => {
      const status = item.type === "fault"
        ? item.handled ? "已处理" : "未处理"
        : item.type === "recovery" ? "已恢复" : "联锁完成";
      return `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.deviceLabel || "")} · ${escapeHtml(item.triggerValue || "")} <em>[${status}]</em></li>`;
    }).join("");
    ui.reportAnomalies.innerHTML = `<strong>异常处理记录 · ${anomalies.length} 条</strong><ul>${rows}</ul>`;
  }
  if (!ui.batchDialog.open) ui.batchDialog.showModal();
}

function renderSnapshots() {
  const snapshots = simulator.getSnapshots();
  if (!snapshots.length) {
    ui.snapshotList.innerHTML = '<span class="snapshot-empty">保存后可修改参数重跑，并保留原始设备状态。</span>';
    return;
  }
  ui.snapshotList.innerHTML = snapshots.slice().reverse().map((snapshot) => `
    <div class="snapshot-chip">
      <span class="snap-id">${snapshot.id}</span>
      <span class="snap-meta">${snapshot.batchId} · I${snapshot.params.ink.toFixed(0)} / D${snapshot.params.dryer.toFixed(0)}</span>
      <button type="button" data-snapshot-load="${snapshot.id}">载入</button>
      <button type="button" data-snapshot-run="${snapshot.id}">立即重跑</button>
    </div>`).join("");
}

function resetTransientUi() {
  lastSheet = null;
  eventRevision = -1;
  deviceRevision = "";
}

function processEvents(events) {
  for (const event of events) {
    if (event.type === "sheet") {
      lastSheet = event.sheet;
      audio.cut();
    } else if (event.type === "fault") {
      audio.fault();
      toast(`${event.fault.title} · ${event.fault.triggerValue}`, "danger");
    } else if (event.type === "rollChange") {
      if (event.active) {
        audio.rollChange();
        toast("换纸卷：供墨泵已先行停止", "warning");
      } else {
        toast("换卷完成，供墨已在设备启动序列末端恢复");
      }
    } else if (event.type === "recoveryAudit") {
      toast(
        event.audit.passed
          ? `恢复审计通过：${(event.audit.elapsedMs / 1000).toFixed(1)}s 无状态残留`
          : `恢复审计失败：${event.audit.errors.join("；")}`,
        event.audit.passed ? "info" : "danger"
      );
    } else if (event.type === "batchArchived") {
      renderHistory();
      const archived = simulator.getHistory().find((batch) => batch.id === event.batchId);
      showBatchReport(archived);
    }
  }
}

function syncUi() {
  updateMetrics();
  updateControls();
  updateFaultPanel();
  updateDeviceStrip();
  renderEvents();
  updateAuditPanel();
}

async function ensureAudio() {
  try {
    await audio.ensureStarted();
  } catch {
    toast("浏览器未允许音频启动，生产模拟仍可继续", "warning");
  }
}

async function handleRunButton() {
  await ensureAudio();
  const phase = simulator.phase;
  if (phase === "ready") {
    const started = simulator.start();
    toast(started ? "生产启动：连续十张合格自动完成" : "保护回路阻止启动，请检查参数", started ? "info" : "danger");
  } else if (phase === "running") {
    simulator.pause();
    toast("已暂停：设备全部停机，当前批次进度保留", "warning");
  } else if (phase === "paused") {
    const resumed = simulator.resume();
    toast(resumed ? "检查完成，生产继续" : "参数越限，恢复失败", resumed ? "info" : "danger");
  } else if (phase === "complete" || phase === "ended") {
    resetTransientUi();
    const started = simulator.start();
    toast(started ? "新批次已启动" : "新批次启动被保护回路阻止", started ? "info" : "danger");
  }
}

function handleReset() {
  const previous = simulator.resetCurrentBatch();
  resetTransientUi();
  toast(`当前批次已重置${previous ? `（原批次 ${previous} 未归档）` : ""}`);
}

function handleRollChange() {
  if (simulator.changeRoll()) {
    deviceRevision = "";
    toast("换纸卷开始：供墨泵已停止，纸带驱动同步退出", "warning");
  }
}

function handleEndBatch() {
  const archived = simulator.endBatch();
  if (archived) toast(`${archived.id} 已结束并归档`);
}

function handleInjectFault() {
  const type = ui.faultSelect.value;
  if (simulator.injectFault(type)) {
    toast("故障已注入，保护回路切断主驱动", "danger");
  } else {
    toast("故障注入仅在运行或暂停状态可用", "warning");
  }
}

function handleRecovery() {
  const previous = simulator.fault;
  const recovered = simulator.recoverFault();
  if (recovered) {
    toast(`${previous?.title || "故障"}已排除，开始 5 秒恢复审计`);
  } else {
    toast("恢复失败：参数仍越限或设备未复位", "danger");
  }
}

function handleParameter(event) {
  const input = event.target.closest("input[data-param]");
  if (!input) return;
  simulator.setParams({ [input.dataset.param]: input.value });
  setParamInputs();
}

async function handleSnapshotRun(event) {
  const loadButton = event.target.closest("button[data-snapshot-load]");
  const runButton = event.target.closest("button[data-snapshot-run]");
  const button = loadButton || runButton;
  if (!button) return;
  const snapshotId = loadButton
    ? loadButton.dataset.snapshotLoad
    : runButton.dataset.snapshotRun;
  const snapshot = simulator.getSnapshots().find((item) => item.id === snapshotId);
  if (!snapshot) return;
  simulator.prepareSnapshotRun(snapshotId);
  resetTransientUi();
  setParamInputs();
  if (loadButton) {
    syncUi();
    toast(`已载入 ${snapshotId}，可修改参数后启动生产`);
    return;
  }
  await ensureAudio();
  simulator.start();
  toast(`已从 ${snapshotId} 载入设备状态，新批次开始运行`);
}

function handleSaveSnapshot() {
  const snapshot = simulator.saveSnapshot();
  renderSnapshots();
  toast(`设备状态已保存为 ${snapshot.id}`);
}

function handleSound() {
  const enabled = ui.soundBtn.getAttribute("aria-pressed") !== "true";
  ui.soundBtn.setAttribute("aria-pressed", String(enabled));
  audio.setEnabled(enabled);
  if (enabled) ensureAudio();
}

function bindEvents() {
  ui.runBtn.addEventListener("click", handleRunButton);
  ui.resetBtn.addEventListener("click", handleReset);
  ui.rollBtn.addEventListener("click", handleRollChange);
  ui.endBtn.addEventListener("click", handleEndBatch);
  ui.injectFaultBtn.addEventListener("click", handleInjectFault);
  ui.recoverBtn.addEventListener("click", handleRecovery);
  ui.soundBtn.addEventListener("click", handleSound);
  $$("input[data-param]").forEach((input) => input.addEventListener("input", handleParameter));
  ui.saveSnapshotBtn.addEventListener("click", handleSaveSnapshot);
  ui.snapshotList.addEventListener("click", handleSnapshotRun);
  ui.compareA.addEventListener("change", renderCompare);
  ui.compareB.addEventListener("change", renderCompare);
  ui.historyList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-batch]");
    if (!card) return;
    const batch = simulator.getHistory().find((item) => item.id === card.dataset.batch);
    if (batch) showBatchReport(batch);
  });
  ui.batchDialog.addEventListener("close", () => {
    modalBatchId = null;
  });
}

function frame(now) {
  const dt = Math.min(80, Math.max(0, now - lastFrame));
  lastFrame = now;
  simulator.update(dt);
  processEvents(simulator.drainEvents());
  renderer.render(dt);
  audio.update(simulator);
  syncUi();
  requestAnimationFrame(frame);
}

function init() {
  setParamInputs();
  renderHistory();
  renderSnapshots();
  resetTransientUi();
  syncUi();
  bindEvents();
  renderer.render(0);
  requestAnimationFrame(frame);
}

init();
