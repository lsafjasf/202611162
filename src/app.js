import {
  PARAM_LIMITS,
  POWDERS,
  RECOMMENDED_ORDER,
  STAGE_LABELS,
  PowderMixSimulator,
  clone,
  deepFreeze,
  describeFailure,
  formatClock,
} from "./simulator.js";
import { MachineAudio } from "./audio.js";
import { MixerCanvas } from "./mixerCanvas.js";

const STORAGE_KEY = "powder-mix-console-v1";
const $ = (selector) => document.querySelector(selector);

const dom = {
  acceptedCount: $("#acceptedCount"),
  campaignLights: $("#campaignLights"),
  soundToggle: $("#soundToggle"),
  soundIcon: $("#soundIcon"),
  pauseButton: $("#pauseButton"),
  resetButton: $("#resetButton"),
  systemState: $("#systemState"),
  batchNumber: $("#batchNumber"),
  stageLabel: $("#stageLabel"),
  clockLabel: $("#clockLabel"),
  scenarioHelp: $("#scenarioHelp"),
  recipeStatus: $("#recipeStatus"),
  feedOrder: $("#feedOrder"),
  rpmInput: $("#rpmInput"),
  rpmOutput: $("#rpmOutput"),
  rpmAlert: $("#rpmAlert"),
  timeInput: $("#timeInput"),
  timeOutput: $("#timeOutput"),
  timeAlert: $("#timeAlert"),
  valveInput: $("#valveInput"),
  valveOutput: $("#valveOutput"),
  valveAlert: $("#valveAlert"),
  faultSelect: $("#faultSelect"),
  presetFault: $("#presetFault"),
  startButton: $("#startButton"),
  speedSelect: $("#speedSelect"),
  canvasOverlay: $("#canvasOverlay"),
  pauseVeil: $("#pauseVeil"),
  uniformityValue: $("#uniformityValue"),
  uniformityBar: $("#uniformityBar"),
  agglomerationValue: $("#agglomerationValue"),
  agglomerationBar: $("#agglomerationBar"),
  entrainmentValue: $("#entrainmentValue"),
  entrainmentBar: $("#entrainmentBar"),
  faultBadge: $("#faultBadge"),
  powerValue: $("#powerValue"),
  peakPowerValue: $("#peakPowerValue"),
  equipmentList: $("#equipmentList"),
  sampleStatus: $("#sampleStatus"),
  sampleReadings: $("#sampleReadings"),
  batchProgressBar: $("#batchProgressBar"),
  batchProgressText: $("#batchProgressText"),
  eventCount: $("#eventCount"),
  eventLog: $("#eventLog"),
  saveSnapshotButton: $("#saveSnapshotButton"),
  snapshotHint: $("#snapshotHint"),
  snapshotList: $("#snapshotList"),
  compareButton: $("#compareButton"),
  snapshotCompareNote: $("#snapshotCompareNote"),
  ledgerCount: $("#ledgerCount"),
  clearAllButton: $("#clearAllButton"),
  batchTableWrap: $("#batchTableWrap"),
  failureModal: $("#failureModal"),
  failureTitle: $("#failureTitle"),
  failureDetails: $("#failureDetails"),
  failureClose: $("#failureClose"),
  recoveryPanel: $("#recoveryPanel"),
  recoverButton: $("#recoverButton"),
  failureResetButton: $("#failureResetButton"),
  compareModal: $("#compareModal"),
  compareGrid: $("#compareGrid"),
  compareVerdict: $("#compareVerdict"),
  compareClose: $("#compareClose"),
  scenarioModal: $("#scenarioModal"),
  scenarioClose: $("#scenarioClose"),
  toast: $("#toast"),
};

const audio = new MachineAudio();
const canvas = new MixerCanvas($("#mixerCanvas"), $("#powerCanvas"));

let stored = loadStoredState();
let batches = stored.batches;
let snapshots = stored.snapshots;
let nextBatchNumber = stored.nextBatchNumber;
let activeSnapshot = null;
let selectedBatchIds = [];
let archivedIds = new Set(batches.map((batch) => batch.id));
let shownFailureKey = "";
let lastRecoveryKey = "";
let lastEventCount = -1;
let lastBatchCount = -1;
let lastSnapshotCount = -1;
let toastTimer = null;
let lastFrame = performance.now();
let uiAccumulator = 0;
let speed = Number(dom.speedSelect.value) || 2;

const engine = new PowderMixSimulator({
  batchNumber: nextBatchNumber,
  params: batches[0]?.params || undefined,
});

function loadStoredState() {
  const fallback = { batches: [], snapshots: [], nextBatchNumber: 1 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const batches = Array.isArray(parsed.batches)
      ? parsed.batches.map((batch) => deepFreeze(batch))
      : [];
    const snapshots = Array.isArray(parsed.snapshots)
      ? parsed.snapshots.map((snapshot) => deepFreeze(snapshot))
      : [];
    const maxBatch = batches.reduce((max, batch) => Math.max(max, batch.batchNumber || 0), 0);
    return {
      batches,
      snapshots,
      nextBatchNumber: Math.max(Number(parsed.nextBatchNumber) || 1, maxBatch + 1),
    };
  } catch (error) {
    console.warn("Unable to restore console data", error);
    return fallback;
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ batches, snapshots, nextBatchNumber }),
    );
  } catch (error) {
    console.warn("Unable to persist console data", error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showToast(message, type = "normal", duration = 3200) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast show${type === "alarm" ? " alarm" : ""}`;
  toastTimer = setTimeout(() => {
    dom.toast.className = "toast";
  }, duration);
}

function paramAlerts() {
  const rpm = Number(dom.rpmInput.value);
  const mixTime = Number(dom.timeInput.value);
  const valve = Number(dom.valveInput.value);
  const data = {
    rpm: rpm < PARAM_LIMITS.rpm.safeMin
      ? "低于安全区：密度分层风险"
      : rpm > PARAM_LIMITS.rpm.safeMax
        ? "高于安全区：静电团聚风险"
        : "",
    mixTime: mixTime < PARAM_LIMITS.mixTime.safeMin
      ? "混合不足：取样偏差会增大"
      : mixTime > PARAM_LIMITS.mixTime.safeMax
        ? "混合过长：温升与能耗增加"
        : "",
    valve: valve > PARAM_LIMITS.valve.safeMax
      ? "开度过大：出料夹带未混合粉"
      : valve < PARAM_LIMITS.valve.safeMin
        ? "开度过小：出料时间延长"
        : "",
  };
  if (rpm > PARAM_LIMITS.rpm.max) data.rpm = `预检联锁：上限 ${PARAM_LIMITS.rpm.max} rpm`;
  if (mixTime > PARAM_LIMITS.mixTime.max) data.mixTime = `预检联锁：上限 ${PARAM_LIMITS.mixTime.max} s`;
  if (valve > PARAM_LIMITS.valve.max) data.valve = `预检联锁：上限 ${PARAM_LIMITS.valve.max}%`;
  return data;
}

function setRangeAppearance(input, output, suffix, value, unsafe) {
  output.textContent = `${value} ${suffix}`;
  input.classList.toggle("danger-param", unsafe);
}

function syncControlsFromEngine() {
  const params = engine.state.params;
  dom.feedOrder.dataset.order = params.feedOrder.join("");
  dom.rpmInput.value = String(params.rpm);
  dom.timeInput.value = String(params.mixTime);
  dom.valveInput.value = String(params.valve);
  dom.faultSelect.value = params.fault || "";
  updateRangeLabels();
  renderFeedOrder();
}

function updateRangeLabels() {
  const alerts = paramAlerts();
  const rpm = Number(dom.rpmInput.value);
  const mixTime = Number(dom.timeInput.value);
  const valve = Number(dom.valveInput.value);
  setRangeAppearance(dom.rpmInput, dom.rpmOutput, "rpm", rpm, Boolean(alerts.rpm));
  setRangeAppearance(dom.timeInput, dom.timeOutput, "s", mixTime, Boolean(alerts.mixTime));
  setRangeAppearance(dom.valveInput, dom.valveOutput, "%", valve, Boolean(alerts.valve));
  dom.rpmAlert.textContent = alerts.rpm;
  dom.timeAlert.textContent = alerts.mixTime;
  dom.valveAlert.textContent = alerts.valve;
}

function renderFeedOrder() {
  const order = engine.state.params.feedOrder;
  const locked = engine.state.running && !engine.state.completed || engine.state.failed;
  dom.feedOrder.innerHTML = order.map((id, index) => {
    const powder = POWDERS[id];
    const isRecommended = RECOMMENDED_ORDER[index] === id;
    return `
      <button class="feed-card" type="button" data-index="${index}" data-powder="${id}"
        ${locked ? "disabled" : ""} title="点击与后一位交换顺序">
        <span class="order-no">0${index + 1} ${isRecommended ? "· REC" : ""}</span>
        <strong>${escapeHtml(powder.short)}</strong>
        <small>${escapeHtml(powder.name)}</small>
      </button>
    `;
  }).join("");
}

function renderCampaign() {
  const accepted = batches.filter((batch) => batch.accepted);
  const count = Math.min(3, accepted.length);
  dom.acceptedCount.textContent = String(count);
  dom.campaignLights.innerHTML = [0, 1, 2].map((index) => {
    const done = index < count;
    const current = !done && index === count && count < 3;
    return `<span class="campaign-light${done ? " done" : current ? " current" : ""}">${done ? "✓" : index + 1}</span>`;
  }).join("");
}

function renderEquipment(state) {
  const statusText = {
    running: "运行",
    standby: "待机",
    fault: "故障",
  };
  dom.equipmentList.innerHTML = Object.values(state.equipment).map((device) => `
    <div class="equipment-row ${escapeHtml(device.status)}">
      <div class="equipment-name"><i></i><span>${escapeHtml(device.name)} · ${escapeHtml(device.code)}</span></div>
      <span class="equipment-state">${statusText[device.status] || device.status}</span>
      <span class="equipment-meta">启 ${device.startedAt == null ? "--" : formatClock(device.startedAt)} / 停 ${device.stoppedAt == null ? "--" : formatClock(device.stoppedAt)}</span>
    </div>
  `).join("");
}

function renderSamples(state) {
  const hasSamples = state.samples.some((sample) => sample.value != null);
  const status = state.phase === "mixing"
    ? "实时采集"
    : state.phase === "discharging"
      ? "出料前锁定"
      : state.completed
        ? "检测完成"
        : state.failed
          ? "数据冻结"
          : "等待取样";
  dom.sampleStatus.textContent = status;
  dom.sampleReadings.innerHTML = state.samples.map((sample) => {
    const good = hasSamples && sample.value >= 85;
    return `
      <div class="sample-reading${good ? " good" : ""}">
        <span>${sample.label}</span>
        <strong>${sample.value == null ? "--" : sample.value.toFixed(1)}</strong>
      </div>
    `;
  }).join("");
}

function renderEvents(state) {
  if (state.events.length === lastEventCount) return;
  lastEventCount = state.events.length;
  dom.eventCount.textContent = `${state.events.length} 条`;
  if (!state.events.length) {
    dom.eventLog.innerHTML = '<div class="event-empty">等待设备启停事件</div>';
    return;
  }
  dom.eventLog.innerHTML = [...state.events].reverse().slice(0, 60).map((event) => {
    const symbol = event.type === "alarm"
      ? "!"
      : event.type === "recovery"
        ? "↺"
        : event.type === "inspect"
          ? "II"
          : event.type === "stop"
            ? "■"
            : event.type === "start"
              ? "▶"
              : "·";
    return `
      <div class="event-row ${escapeHtml(event.type)}">
        <span class="event-time">${formatClock(event.time)}</span>
        <span class="event-symbol">${symbol}</span>
        <span class="event-device">${escapeHtml(event.deviceName)}</span>
        <span class="event-detail">${escapeHtml(event.detail)}</span>
      </div>
    `;
  }).join("");
}

function batchProgress(state) {
  const total = 6 + state.params.mixTime + 6;
  let elapsed = state.elapsed;
  if (state.phase === "complete") elapsed = total;
  const ratio = clamp(elapsed / total, 0, 1);
  const stageText = state.failed
    ? "联锁停在 " + (STAGE_LABELS[state.phase] || "当前阶段")
    : state.recovery?.active
      ? `恢复验证 ${state.recovery.elapsed.toFixed(1)} / ${state.recovery.required.toFixed(1)} s`
      : `${STAGE_LABELS[state.phase] || "待开机"} · ${Math.round(ratio * 100)}%`;
  return { ratio, stageText };
}

function renderTelemetry(state) {
  const uniformity = state.uniformity || 0;
  dom.uniformityValue.textContent = state.phase === "idle" ? "--" : `${uniformity.toFixed(1)}%`;
  dom.uniformityBar.style.width = `${clamp(uniformity, 0, 100)}%`;
  dom.agglomerationValue.textContent = state.agglomeration.toFixed(1);
  dom.agglomerationBar.style.width = `${clamp(state.agglomeration * 5, 0, 100)}%`;
  dom.entrainmentValue.textContent = state.entrainment.toFixed(1);
  dom.entrainmentBar.style.width = `${clamp(state.entrainment * 4, 0, 100)}%`;
  dom.powerValue.textContent = state.power.toFixed(1);
  dom.peakPowerValue.textContent = `${state.peakPower.toFixed(1)} kW`;
  dom.batchNumber.textContent = state.failed ? `B-${String(state.batchNumber).padStart(3, "0")}` : engine.batchId();
  dom.clockLabel.textContent = formatClock(state.elapsed);
  dom.stageLabel.textContent = state.failed ? "联锁停机" : STAGE_LABELS[state.phase] || "待开机";
  dom.pauseVeil.hidden = !state.paused || state.failed;
  renderEquipment(state);
  renderSamples(state);
  const progress = batchProgress(state);
  dom.batchProgressBar.style.width = `${progress.ratio * 100}%`;
  dom.batchProgressText.textContent = progress.stageText;

  if (state.failure) {
    dom.faultBadge.textContent = state.failure.equipmentName;
    dom.faultBadge.className = "mini-badge alarm";
    dom.systemState.textContent = "联锁停机";
  } else if (state.recovery?.active) {
    dom.faultBadge.textContent = `恢复验证 ${state.recovery.elapsed.toFixed(1)}s`;
    dom.faultBadge.className = "mini-badge quiet";
    dom.systemState.textContent = "恢复验证中";
  } else if (state.completed) {
    dom.faultBadge.textContent = "无告警";
    dom.faultBadge.className = "mini-badge quiet";
    dom.systemState.textContent = state.result?.accepted ? "批次完成" : "批次未通过";
  } else if (state.running && !state.paused) {
    dom.faultBadge.textContent = "无告警";
    dom.faultBadge.className = "mini-badge quiet";
    dom.systemState.textContent = "生产运行";
  } else {
    dom.faultBadge.textContent = "无告警";
    dom.faultBadge.className = "mini-badge quiet";
    dom.systemState.textContent = state.paused ? "检查暂停" : "系统待机";
  }

  const running = state.running && !state.paused;
  const lockInputs = state.running || state.failed;
  [dom.rpmInput, dom.timeInput, dom.valveInput, dom.faultSelect].forEach((input) => {
    input.disabled = lockInputs;
  });
  dom.faultSelect.disabled = state.running || state.failed;
  dom.pauseButton.disabled = !state.running || state.failed || state.completed;
  dom.pauseButton.textContent = state.paused ? "继续运行" : "暂停检查";
  dom.recipeStatus.textContent = state.failed
    ? "联锁停机"
    : state.completed
      ? "已封存"
      : running
        ? "生产中"
        : state.paused
          ? "检查中"
          : "待确认";
  dom.recipeStatus.className = `mini-badge${state.failed ? " alarm" : ""}`;
  dom.startButton.disabled = running || state.failed || state.paused;
  dom.startButton.textContent = state.completed
    ? "开始下一批"
    : state.paused
      ? "已暂停检查"
      : "启动生产批次";
  dom.canvasOverlay.querySelector(".overlay-label").textContent = state.failed
    ? "联锁停机"
    : state.paused
      ? "检查冻结"
      : state.phase === "mixing"
        ? "实时混合"
        : state.phase === "complete"
          ? "批次已封存"
          : "实时剖面";
  if (state.failed) dom.startButton.textContent = "联锁停机";
}

function renderSnapshotList() {
  dom.snapshotHint.textContent = batches.length
    ? "完成一批后保存快照，修改参数复跑，即可将两次结果并排比较。"
    : "先完成一个批次作为对照基线，再保存当前设备状态。";
  if (!snapshots.length) {
    dom.snapshotList.innerHTML = '<div class="snapshot-empty">尚未保存设备快照</div>';
  } else {
    dom.snapshotList.innerHTML = snapshots.map((snapshot) => `
      <div class="snapshot-item${activeSnapshot?.id === snapshot.id ? " selected" : ""}">
        <strong>${escapeHtml(snapshot.name)}</strong>
        <span>${snapshot.params.rpm} rpm · ${snapshot.params.mixTime}s · 阀 ${snapshot.params.valve}% · ${snapshot.baseResult ? `基准 ${escapeHtml(snapshot.baseResult.id)}` : "无基准结果"}</span>
        <button class="text-button" type="button" data-snapshot-id="${escapeHtml(snapshot.id)}">载入复跑</button>
      </div>
    `).join("");
  }
  dom.compareButton.disabled = selectedBatchIds.length !== 2;
  dom.snapshotCompareNote.textContent = selectedBatchIds.length === 1
    ? "已选择 1 条，再选择 1 条启用对照"
    : selectedBatchIds.length === 2
      ? "两条批次已选中，可并排比较"
      : "";
}

function renderBatchLedger() {
  dom.ledgerCount.textContent = `${batches.length} 批`;
  if (!batches.length) {
    dom.batchTableWrap.innerHTML = '<div class="empty-state">暂无已完成批次。完成一个生产批次后，结果将在这里永久封存。</div>';
    return;
  }
  dom.batchTableWrap.innerHTML = `
    <table class="batch-table">
      <thead>
        <tr>
          <th>对照</th><th>批次</th><th>完成时刻</th><th>参数</th><th>均匀度</th>
          <th>良品</th><th>废品</th><th>峰值功耗</th><th>停机原因</th><th>异常处理</th><th>封存</th>
        </tr>
      </thead>
      <tbody>
        ${batches.map((batch) => {
          const selected = selectedBatchIds.includes(batch.id);
          return `
            <tr>
              <td><button class="select-batch${selected ? " selected" : ""}" type="button" data-batch-id="${escapeHtml(batch.id)}" aria-label="选择 ${escapeHtml(batch.id)} 对比">✓</button></td>
              <td class="batch-id">${escapeHtml(batch.id)}</td>
              <td>${new Date(batch.createdAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</td>
              <td>${batch.params.rpm} rpm / ${batch.params.mixTime}s / ${batch.params.valve}%</td>
              <td class="${batch.uniformity >= 85 ? "result-good" : "result-bad"}">${batch.uniformity.toFixed(1)}%</td>
              <td>${batch.goodKg.toFixed(1)} kg</td>
              <td class="${batch.wasteKg > 10 ? "result-bad" : ""}">${batch.wasteKg.toFixed(1)} kg</td>
              <td>${batch.peakPower.toFixed(2)} kW</td>
              <td><span class="status-chip${batch.accepted ? "" : " failed"}">${batch.accepted ? "合格" : "不合格"}</span> ${escapeHtml(batch.shutdownReason)}</td>
              <td>${batch.incidents.length ? `${batch.incidents.length} 次` : "无"}</td>
              <td><span class="lock-note" title="封存后不可编辑">LOCK 只读</span></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function showFailure(failure) {
  if (!failure) return;
  const key = `${failure.code || failure.id}-${failure.at}`;
  shownFailureKey = key;
  dom.failureTitle.textContent = failure.kind === "limit" ? "参数越限联锁" : "设备故障联锁";
  dom.failureDetails.innerHTML = `
    <div class="failure-datum"><span>故障设备</span><strong>${escapeHtml(failure.equipmentName)}</strong></div>
    <div class="failure-datum"><span>触发参数</span><strong>${escapeHtml(failure.trigger)}</strong></div>
    <div class="failure-datum trigger"><span>触发值</span><strong>${escapeHtml(failure.valueText)}</strong></div>
    <div class="failure-datum"><span>联锁阈值 / 范围</span><strong>${escapeHtml(failure.thresholdText)}</strong></div>
    <div class="failure-datum"><span>发生时刻</span><strong>${formatClock(failure.at)}</strong></div>
    <div class="failure-datum"><span>停机动作</span><strong>设备输出已切断</strong></div>
    <p class="failure-message">${escapeHtml(failure.message)} ${failure.kind === "limit" ? "恢复时将自动限幅到安全值，并进入固定恢复验证窗。" : "恢复后将继续当前阶段，并运行固定 8 s 验证窗。"}</p>
  `;
  dom.recoveryPanel.hidden = true;
  dom.recoveryPanel.innerHTML = "";
  dom.recoverButton.disabled = false;
  dom.recoverButton.textContent = failure.kind === "limit"
    ? "恢复、限幅并验证"
    : "恢复设备并验证";
  dom.failureResetButton.disabled = false;
  dom.failureModal.hidden = false;
  audio.alarm();
}

function updateFailureModal(state) {
  if (dom.failureModal.hidden || state.failure) return;
  if (state.recovery?.active) {
    const progress = clamp(state.recovery.elapsed / state.recovery.required, 0, 1);
    dom.recoveryPanel.hidden = false;
    dom.recoveryPanel.innerHTML = `
      <strong>固定恢复验证窗进行中</strong><br>
      ${escapeHtml(state.recovery.source)} 已恢复启动 · ${state.recovery.elapsed.toFixed(1)} / ${state.recovery.required.toFixed(1)} s<br>
      <span style="display:block;height:2px;background:rgba(89,213,172,.16);margin-top:7px">
        <i style="display:block;width:${progress * 100}%;height:100%;background:#59d5ac"></i>
      </span>
    `;
    dom.recoverButton.disabled = true;
    dom.recoverButton.textContent = `验证中 ${state.recovery.elapsed.toFixed(1)} / ${state.recovery.required.toFixed(1)} s`;
    return;
  }
  if (state.recoveryVerification) {
    const verification = state.recoveryVerification;
    dom.recoveryPanel.hidden = false;
    dom.recoveryPanel.innerHTML = `
      <strong>${verification.passed ? "恢复验证通过" : "恢复验证未通过"}</strong><br>
      ${escapeHtml(verification.summary)}<br>
      活动故障 ${verification.deviceFaults} · 联锁残留 ${verification.latchedAlarms} · 新增错误 ${verification.addedErrors}
    `;
    dom.recoverButton.disabled = false;
    dom.recoverButton.textContent = verification.passed ? "验证通过 · 返回监控" : "关闭验证面板";
  }
}

function archiveCurrentResult() {
  const result = engine.state.result;
  if (!result || archivedIds.has(result.id)) return;
  const snapshotId = activeSnapshot?.id || null;
  const baseResult = activeSnapshot?.baseResult || null;
  const record = deepFreeze({
    ...clone(result),
    linkedSnapshotId: snapshotId,
  });
  batches.push(record);
  archivedIds.add(record.id);
  nextBatchNumber = Math.max(nextBatchNumber, record.batchNumber + 1);
  persist();
  renderCampaign();
  renderBatchLedger();
  renderSnapshotList();
  audio.chime(record.accepted);
  showToast(
    `${record.id} 已封存 · 良品 ${record.goodKg.toFixed(1)} kg / 废品 ${record.wasteKg.toFixed(1)} kg / 峰值 ${record.peakPower.toFixed(2)} kW · ${record.shutdownReason}`,
    record.accepted ? "normal" : "alarm",
    4800,
  );

  if (baseResult && baseResult.id !== record.id) {
    selectedBatchIds = [baseResult.id, record.id];
    dom.snapshotCompareNote.textContent = "快照复跑完成，正在生成双跑对照";
    renderSnapshotList();
    setTimeout(() => {
      const left = batches.find((batch) => batch.id === baseResult.id);
      const right = batches.find((batch) => batch.id === record.id);
      if (left && right) showComparison(left, right);
    }, 650);
  }
  activeSnapshot = null;

  const acceptedCount = batches.filter((batch) => batch.accepted).length;
  if (acceptedCount === 3) {
    setTimeout(() => {
      showToast("三批均匀度检测完成 · 批次验收通过", "normal", 5200);
    }, 500);
  }
}

function metricRow(label, left, right, unit = "", precision = 1, higherIsBetter = true) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const delta = rightNumber - leftNumber;
  const good = higherIsBetter ? delta >= 0 : delta <= 0;
  return `
    <div class="compare-metric ${Math.abs(delta) < 0.001 ? "" : good ? "delta-up" : "delta-down"}">
      <span>${label}</span>
      <b>${leftNumber.toFixed(precision)}${unit} → ${rightNumber.toFixed(precision)}${unit}</b>
    </div>
  `;
}

function incidentMarkup(batch) {
  if (!batch.incidents.length) {
    return '<div class="incident-entry none">无异常处理记录</div>';
  }
  return batch.incidents.map((incident) => `
    <div class="incident-entry">
      ${formatClock(incident.at)} · ${escapeHtml(incident.equipmentName)} · ${escapeHtml(incident.trigger)} ${escapeHtml(incident.valueText)}
      <br>${escapeHtml(incident.detail)}
    </div>
  `).join("");
}

function showComparison(left, right) {
  if (!left || !right) return;
  dom.compareGrid.innerHTML = [left, right].map((batch, index) => `
    <article class="compare-card">
      <div class="compare-card-head">
        <div>
          <span>${index === 0 ? "RUN A / 基准" : "RUN B / 复跑"}</span>
          <strong>${escapeHtml(batch.id)}</strong>
        </div>
        <span class="status-chip${batch.accepted ? "" : " failed"}">${batch.accepted ? "合格" : "不合格"}</span>
      </div>
      <div class="compare-card-body">
        <div class="compare-metric"><span>参数</span><b>${batch.params.rpm} rpm / ${batch.params.mixTime}s / 阀 ${batch.params.valve}%</b></div>
        <div class="compare-metric"><span>均匀度</span><b>${batch.uniformity.toFixed(1)}%</b></div>
        <div class="compare-metric"><span>良品 / 废品</span><b>${batch.goodKg.toFixed(1)} / ${batch.wasteKg.toFixed(1)} kg</b></div>
        <div class="compare-metric"><span>峰值功耗</span><b>${batch.peakPower.toFixed(2)} kW</b></div>
        <div class="compare-metric"><span>停机原因</span><b>${escapeHtml(batch.shutdownReason)}</b></div>
        <div class="compare-metric"><span>均匀度变化</span><b>${batch.uniformity >= 85 ? "达标" : "未达标"}</b></div>
        <div class="incident-list">
          <h4>异常处理记录</h4>
          ${incidentMarkup(batch)}
        </div>
      </div>
    </article>
  `).join("");

  const incidentCount = left.incidents.length + right.incidents.length;
  const recoveryPassed = [left, right]
    .map((batch) => batch.recoveryVerification)
    .filter(Boolean)
    .every((verification) => verification.passed);
  dom.compareVerdict.className = `compare-verdict${incidentCount ? "" : " warning"}`;
  dom.compareVerdict.innerHTML = incidentCount
    ? `✓ 包含 ${incidentCount} 条异常处理记录${recoveryPassed ? "；恢复验证通过，残留 0 / 新增错误 0" : "；请检查恢复验证结果"}`
    : "△ 本次对比缺少异常处理记录。请在任一批次中注入故障并完成恢复验证后再对比。";
  dom.compareModal.hidden = false;
  selectedBatchIds = [left.id, right.id];
  renderBatchLedger();
  renderSnapshotList();
}

function prepareNextBatch(startImmediately = false) {
  const params = clone(engine.state.params);
  engine.batchNumber = nextBatchNumber;
  engine.reset(params);
  lastEventCount = -1;
  shownFailureKey = "";
  lastRecoveryKey = "";
  activeSnapshot = null;
  syncControlsFromEngine();
  renderFeedOrder();
  if (startImmediately) {
    applyParamsToEngine();
    const response = engine.start();
    if (!response.ok && response.failure) showFailure(response.failure);
  }
  updateUI();
}

function applyParamsToEngine() {
  engine.setParams({
    feedOrder: [...dom.feedOrder.dataset.order],
    rpm: Number(dom.rpmInput.value),
    mixTime: Number(dom.timeInput.value),
    valve: Number(dom.valveInput.value),
    fault: dom.faultSelect.value,
  });
}

function resetCurrentBatch() {
  if (engine.state.failed) {
    dom.failureModal.hidden = true;
  } else if (engine.state.running && !engine.state.completed) {
    const proceed = window.confirm("重置会丢弃当前未完成批次，已完成批次不会被修改。继续？");
    if (!proceed) return;
  }
  if (engine.state.completed) {
    prepareNextBatch(false);
  } else {
    const params = clone(engine.state.params);
    engine.reset(params);
    activeSnapshot = null;
    lastEventCount = -1;
    shownFailureKey = "";
    lastRecoveryKey = "";
    syncControlsFromEngine();
    renderFeedOrder();
    updateUI();
    showToast("当前批次已复位，已完成批次保持不变");
  }
}

function loadSnapshot(snapshot) {
  if (engine.state.running && !engine.state.completed) {
    const proceed = window.confirm("载入快照将丢弃当前未完成批次。继续？");
    if (!proceed) return;
  }
  engine.batchNumber = nextBatchNumber;
  engine.reset(snapshot.params);
  activeSnapshot = snapshot;
  selectedBatchIds = [];
  shownFailureKey = "";
  lastRecoveryKey = "";
  lastEventCount = -1;
  dom.failureModal.hidden = true;
  syncControlsFromEngine();
  renderFeedOrder();
  renderSnapshotList();
  renderBatchLedger();
  updateUI();
  showToast(`快照“${snapshot.name}”已载入，修改参数后可重新运行`);
}

function saveSnapshot() {
  if (!batches.length) {
    showToast("请先完成一批生产，建立可对比的基准结果", "alarm");
    return;
  }
  const baseResult = batches[batches.length - 1];
  const snapshot = engine.captureSnapshot({
    name: `设备快照 ${snapshots.length + 1} · B-${String(nextBatchNumber).padStart(3, "0")}`,
    baseResult,
  });
  snapshots.push(snapshot);
  persist();
  renderSnapshotList();
  dom.snapshotCompareNote.textContent = `已保存 ${snapshot.id}，可修改参数后载入复跑`;
  showToast("设备状态已保存为只读快照");
}

function updateUI() {
  const state = engine.state;
  if (state.failed && state.failure) {
    const key = `${state.failure.code || state.failure.id}-${state.failure.at}`;
    if (key !== shownFailureKey) showFailure(state.failure);
  }
  if (state.completed && state.result && !archivedIds.has(state.result.id)) {
    archiveCurrentResult();
  }
  if (state.recoveryVerification) {
    const key = `${state.recoveryVerification.startAt}-${state.recoveryVerification.completedAt}`;
    if (key !== lastRecoveryKey) {
      lastRecoveryKey = key;
      const verification = state.recoveryVerification;
      showToast(
        verification.passed
          ? `恢复验证通过 · 固定窗 ${verification.window.toFixed(1)}s · 残留 0 · 新增错误 0`
          : `恢复验证失败 · ${verification.residualIssues.join("；")}`,
        verification.passed ? "normal" : "alarm",
        4400,
      );
      if (verification.passed) audio.chime(true);
    }
  }
  renderTelemetry(state);
  renderEvents(state);
  updateFailureModal(state);
}

function refreshAllViews() {
  renderCampaign();
  renderSnapshotList();
  renderBatchLedger();
  renderEvents(engine.state);
  renderTelemetry(engine.state);
}

dom.rpmInput.addEventListener("input", () => {
  applyParamsToEngine();
  updateRangeLabels();
});
dom.timeInput.addEventListener("input", () => {
  applyParamsToEngine();
  updateRangeLabels();
});
dom.valveInput.addEventListener("input", () => {
  applyParamsToEngine();
  updateRangeLabels();
});
dom.faultSelect.addEventListener("change", () => applyParamsToEngine());

dom.feedOrder.addEventListener("click", (event) => {
  const card = event.target.closest(".feed-card");
  if (!card || card.disabled) return;
  const index = Number(card.dataset.index);
  const order = [...engine.state.params.feedOrder];
  const nextIndex = (index + 1) % order.length;
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  engine.setParams({ feedOrder: order });
  dom.feedOrder.dataset.order = order.join("");
  renderFeedOrder();
});

dom.startButton.addEventListener("click", () => {
  audio.ensure();
  if (engine.state.completed) {
    prepareNextBatch(true);
    return;
  }
  applyParamsToEngine();
  const response = engine.start();
  lastEventCount = -1;
  shownFailureKey = "";
  lastRecoveryKey = "";
  renderFeedOrder();
  updateUI();
  if (!response.ok && response.failure) {
    showFailure(response.failure);
  } else if (response.ok) {
    showToast(`B-${String(engine.state.batchNumber).padStart(3, "0")} 已启动`);
  } else {
    showToast(response.message, "alarm");
  }
});

dom.pauseButton.addEventListener("click", () => {
  const response = engine.togglePause();
  if (response.ok) {
    showToast(response.paused ? "检查暂停：设备计时与取样已冻结" : "检查结束，批次继续运行");
    updateUI();
  }
});

dom.resetButton.addEventListener("click", resetCurrentBatch);

dom.soundToggle.addEventListener("click", () => {
  audio.ensure();
  audio.setMuted(!audio.muted);
  dom.soundToggle.setAttribute("aria-pressed", String(!audio.muted));
  dom.soundIcon.textContent = audio.muted ? "◌" : "◖";
  showToast(audio.muted ? "设备声场已静音" : "设备声场已开启");
});

dom.speedSelect.addEventListener("change", () => {
  speed = Number(dom.speedSelect.value) || 1;
  showToast(`仿真速度 ${speed}×`);
});

dom.presetFault.addEventListener("click", () => {
  if (engine.state.running || engine.state.failed) {
    showToast("请先复位当前批次再装载故障场景", "alarm");
    return;
  }
  dom.faultSelect.value = "motor_overheat";
  applyParamsToEngine();
  showToast("已装载主电机过热故障，启动批次即可触发");
});

dom.saveSnapshotButton.addEventListener("click", saveSnapshot);

dom.snapshotList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-snapshot-id]");
  if (!button) return;
  const snapshot = snapshots.find((item) => item.id === button.dataset.snapshotId);
  if (snapshot) loadSnapshot(snapshot);
});

dom.batchTableWrap.addEventListener("click", (event) => {
  const button = event.target.closest("[data-batch-id]");
  if (!button) return;
  const id = button.dataset.batchId;
  if (selectedBatchIds.includes(id)) {
    selectedBatchIds = selectedBatchIds.filter((item) => item !== id);
  } else {
    selectedBatchIds = [...selectedBatchIds, id].slice(-2);
  }
  renderBatchLedger();
  renderSnapshotList();
});

dom.compareButton.addEventListener("click", () => {
  const records = selectedBatchIds
    .map((id) => batches.find((batch) => batch.id === id))
    .filter(Boolean);
  if (records.length === 2) showComparison(records[0], records[1]);
});

dom.compareClose.addEventListener("click", () => {
  dom.compareModal.hidden = true;
});

dom.recoverButton.addEventListener("click", () => {
  audio.ensure();
  if (!engine.state.failure && engine.state.recoveryVerification) {
    dom.failureModal.hidden = true;
    return;
  }
  const response = engine.recover();
  if (!response.ok) {
    showToast(response.message, "alarm");
    return;
  }
  syncControlsFromEngine();
  renderFeedOrder();
  dom.recoverButton.disabled = true;
  dom.recoverButton.textContent = "恢复验证启动中…";
  updateUI();
});

dom.failureResetButton.addEventListener("click", () => {
  dom.failureModal.hidden = true;
  const params = clone(engine.state.params);
  engine.reset(params);
  activeSnapshot = null;
  shownFailureKey = "";
  lastRecoveryKey = "";
  lastEventCount = -1;
  syncControlsFromEngine();
  renderFeedOrder();
  updateUI();
  showToast("当前批次已丢弃，已完成批次未受影响");
});

dom.failureClose.addEventListener("click", () => {
  dom.failureModal.hidden = true;
  showToast(engine.state.failure ? "故障仍保持锁定，点击遥测区告警徽标可恢复" : "已返回实时监控", "alarm");
});

dom.faultBadge.addEventListener("click", () => {
  if (engine.state.failure) showFailure(engine.state.failure);
  else if (engine.state.recovery?.active || engine.state.recoveryVerification) {
    dom.failureModal.hidden = false;
    updateFailureModal(engine.state);
  }
});

dom.scenarioHelp.addEventListener("click", () => {
  dom.scenarioModal.hidden = false;
});

dom.scenarioClose.addEventListener("click", () => {
  dom.scenarioModal.hidden = true;
});

document.querySelectorAll(".load-scenario").forEach((button) => {
  button.addEventListener("click", () => {
    if (engine.state.running && !engine.state.completed) {
      showToast("请先暂停并重置当前批次，再装载验收参数", "alarm");
      return;
    }
    if (engine.state.failed) {
      showToast("请先处理联锁故障，再装载验收参数", "alarm");
      return;
    }
    if (engine.state.completed) prepareNextBatch(false);
    const presets = {
      normal: { rpm: 82, mixTime: 42, valve: 44, fault: "" },
      fault: { rpm: 82, mixTime: 42, valve: 44, fault: "motor_overheat" },
      limit: { rpm: 128, mixTime: 42, valve: 44, fault: "" },
    };
    const preset = presets[button.dataset.scenario];
    if (!preset) return;
    engine.setParams(preset);
    syncControlsFromEngine();
    dom.scenarioModal.hidden = true;
    const messages = {
      normal: "正常参数已装载，完成三批均匀度 ≥ 85% 即通过",
      fault: "设备故障场景已装载：启动后将触发主电机过热联锁",
      limit: "参数越限场景已装载：启动预检将显示 128 / 110 rpm",
    };
    showToast(messages[button.dataset.scenario]);
  });
});

dom.clearAllButton.addEventListener("click", () => {
  const proceed = window.confirm("清空所有批次、快照和当前批次？此操作不可撤销。");
  if (!proceed) return;
  batches = [];
  snapshots = [];
  nextBatchNumber = 1;
  activeSnapshot = null;
  selectedBatchIds = [];
  archivedIds = new Set();
  localStorage.removeItem(STORAGE_KEY);
  dom.failureModal.hidden = true;
  dom.compareModal.hidden = true;
  engine.batchNumber = 1;
  engine.reset();
  lastEventCount = -1;
  shownFailureKey = "";
  lastRecoveryKey = "";
  syncControlsFromEngine();
  refreshAllViews();
  showToast("演示数据已清空，设备回到初始待机状态");
});

[dom.compareModal, dom.scenarioModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.hidden = true;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  dom.compareModal.hidden = true;
  dom.scenarioModal.hidden = true;
});

document.addEventListener("pointerdown", () => audio.ensure(), { once: true });

function frame(now) {
  const realDelta = clamp((now - lastFrame) / 1000, 0, 0.12);
  lastFrame = now;
  if (!document.hidden) {
    engine.step(realDelta * speed);
    uiAccumulator += realDelta;
    if (uiAccumulator >= 0.08) {
      updateUI();
      uiAccumulator = 0;
    }
  }
  canvas.render(engine.state);
  audio.update(engine.state);
  requestAnimationFrame(frame);
}

syncControlsFromEngine();
refreshAllViews();
requestAnimationFrame(frame);
