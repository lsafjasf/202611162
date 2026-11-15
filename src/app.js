import {
  AMBIENT,
  CONTROL_LIMITS,
  DEVICE_NAMES,
  PROFILE,
  advance,
  cloneFrozen,
  createBatch,
  createSnapshot,
  formatClock,
  injectFault,
  pauseBatch,
  repairAndVerify,
  resumeBatch,
  setControls,
  startBatch
} from "./simulation.js";
import { drawKiln, drawTrend } from "./renderer.js";
import { KilnAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE_KEY = "kiln-sequence-state-v2";
const SPEEDS = [1, 4, 10];

const audio = new KilnAudio();
const kilnCanvas = $("#kiln-canvas");
const trendCanvas = $("#trend-canvas");
let speedIndex = 1;
let batchCounter = 1;
let current = null;
let completedBatches = [];
let snapshots = [];
let scenario = null;
let lastFrame = performance.now();
let lastUiPaint = 0;
let lastRevision = -1;
let lastStatus = "";
let lastPhase = "";
let lastLibrarySignature = "";
let soundMuted = false;

function loadStored() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return;
    batchCounter = Math.max(1, Number(saved.batchCounter) || 1);
    completedBatches = Array.isArray(saved.completedBatches)
      ? saved.completedBatches.slice(0, 24).map((record) => cloneFrozen(record))
      : [];
    snapshots = Array.isArray(saved.snapshots)
      ? saved.snapshots.slice(-12).map((snapshot) => cloneFrozen(snapshot))
      : [];
    const maxBatch = completedBatches.reduce(
      (max, record) => Math.max(max, Number(record.batchNumber) || 0),
      batchCounter
    );
    batchCounter = Math.max(batchCounter, maxBatch + 1);
  } catch {
    completedBatches = [];
    snapshots = [];
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        batchCounter,
        completedBatches: completedBatches.slice(0, 24),
        snapshots: snapshots.slice(-12)
      })
    );
  } catch {
    showToast("浏览器存储不可用", "当前会话仍可正常操作。", true);
  }
}

function makeNextBatch(controls, snapshotId = null) {
  const number = batchCounter;
  batchCounter += 1;
  return createBatch({
    controls,
    number,
    snapshotId
  });
}

function showToast(title, detail = "", warning = false) {
  const node = document.createElement("div");
  node.className = `toast${warning ? " warn" : ""}`;
  const strong = document.createElement("strong");
  strong.textContent = title;
  node.append(strong, document.createTextNode(detail));
  $("#toast-stack").append(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(6px)";
    node.style.transition = "opacity 220ms, transform 220ms";
    window.setTimeout(() => node.remove(), 240);
  }, 3600);
}

const controlDefinitions = [
  {
    key: "gas",
    name: "燃气比例阀",
    unit: "%",
    max: 100,
    limit: CONTROL_LIMITS.gas,
    color: "#f07d45"
  },
  {
    key: "vent",
    name: "助燃通风",
    unit: "%",
    max: 100,
    limit: CONTROL_LIMITS.minVent,
    color: "#8eb7b1"
  },
  {
    key: "door",
    name: "窑门开度",
    unit: "%",
    max: 100,
    limit: CONTROL_LIMITS.door,
    color: "#e7b85c"
  }
];

function buildControls() {
  const host = $("#control-sliders");
  host.innerHTML = controlDefinitions
    .map(
      (control) => `
        <div class="control-slider" data-control="${control.key}">
          <div class="slider-header">
            <span class="slider-name"><i class="device-dot" id="dot-${control.key}"></i>${control.name}</span>
            <span class="slider-value"><span id="value-${control.key}">0</span><small>${control.unit}</small></span>
          </div>
          <div class="slider-track-wrap">
            <input id="slider-${control.key}" type="range" min="0" max="${control.max}" value="0"
              aria-label="${control.name}" style="--slider-color:${control.color}" />
            <i class="limit-mark" style="left:${control.limit}%" data-label="${control.key === "vent" ? "下限" : control.key === "door" ? "热态限" : "上限"} ${control.limit}"></i>
          </div>
        </div>`
    )
    .join("");

  for (const control of controlDefinitions) {
    const input = $(`#slider-${control.key}`);
    input.addEventListener("input", () => {
      const accepted = setControls(current, { [control.key]: input.value });
      if (!accepted) {
        showToast("当前不可修改", "批次已完成或恢复验证正在进行。", true);
        paintControls();
        return;
      }
      paintControls();
      updateUi(true);
    });
  }
}

function paintControls() {
  for (const control of controlDefinitions) {
    const input = $(`#slider-${control.key}`);
    if (!input) continue;
    const value = current.controls[control.key];
    input.value = String(value);
    input.style.setProperty("--fill", `${value}%`);
    input.disabled = current.status === "completed" || current.status === "recovery";
    $(`#value-${control.key}`).textContent = String(Math.round(value));
    const device =
      control.key === "vent"
        ? current.equipment.blower
        : current.equipment[control.key === "gas" ? "burner" : "door"];
    const dot = $(`#dot-${control.key}`);
    dot.className = "device-dot";
    if (device.health === "fault") dot.classList.add("warn");
    else if (device.on || (control.key === "door" && device.open > 0)) dot.classList.add("on");
  }
}

function statusInfo(state) {
  return {
    ready: ["idle", "待机"],
    running: ["running", "烧成中"],
    paused: ["paused", "已暂停"],
    fault: ["fault", "联锁停机"],
    recovery: ["paused", "恢复验证"],
    completed: ["completed", "批次完成"]
  }[state.status] || ["idle", "待机"];
}

function updateStatusAndActions() {
  const [className, text] = statusInfo(current);
  const pill = $("#status-pill");
  pill.className = `status-pill ${className}`;
  pill.querySelector("span").textContent = text;
  $("#batch-id").textContent = current.id;
  $("#stage-tag").textContent = {
    heating: "升温",
    holding: "保温",
    cooling: "缓冷",
    complete: "完成"
  }[current.phase];

  const start = $("#start-button");
  const pause = $("#pause-button");
  const reset = $("#reset-button");
  const snapshotButton = $("#snapshot-button");
  start.disabled = ["running", "fault", "recovery"].includes(current.status);
  if (current.status === "ready") start.textContent = "开始烧成";
  else if (current.status === "paused") start.textContent = "继续烧成";
  else if (current.status === "completed") start.textContent = "开始下一批次";
  else if (current.status === "fault") start.textContent = "等待联锁复位";
  else if (current.status === "recovery") start.textContent = "恢复验证中";
  else start.textContent = "正在烧成";

  pause.disabled = !["running", "paused"].includes(current.status);
  pause.textContent = current.status === "paused" ? "恢复运行" : "暂停检查";
  reset.disabled = current.status === "recovery";
  reset.textContent = current.status === "completed" ? "新建空白批次" : "重置当前批次";
  snapshotButton.disabled = !["running", "paused", "fault"].includes(current.status);
  $("#goods-badge").textContent = current.result
    ? `${current.result.good}/3 良品`
    : current.status === "ready"
      ? "3 件待烧"
      : `${current.pieces.filter((piece) => piece.status === "safe").length}/3 稳定`;
  $("#event-count").textContent = `${current.logs.length} 条`;
  $("#exception-count").innerHTML = `${current.recoveredFaults} <i>次</i>`;
  $("#recovery-status").textContent = current.recoveryAudit
    ? `${current.recoveryAudit.passed ? "通过" : "失败"} · ${current.recoveryAudit.duration}s`
    : current.status === "recovery"
      ? "验证中"
      : "—";
}

function controlHint() {
  if (current.status === "fault") {
    return "联锁已切断。先修正越限参数，再执行维修与 20 秒恢复验证。";
  }
  if (current.status === "recovery") return "固定 20 秒恢复审计中：正在核对报警、累计计数与瞬时计时器。";
  if (current.status === "completed") return "本批次已冻结归档。参数副本只能用于新建批次。";
  if (current.status === "ready") return "建议燃气 76 / 通风 46 / 窑门 0；三件胎厚不同，热冲击上限依次降低。";
  if (current.phase === "heating") {
    const delta = PROFILE.chamberPeak - current.chamberTemp;
    if (current.controls.vent < CONTROL_LIMITS.minVent && current.controls.gas > 35) {
      return "助燃风低于 18%，欠氧计时正在累积，请立即开大风量。";
    }
    if (current.chamberRate > 8.8) return "升温偏快，最厚胎体接近开裂阈值；略降燃气。";
    if (delta > 180) return "继续升温；燃气约 76%，助燃风保持 46% 以上。";
    return "接近目标温区，开始收小燃气，为保温段留出余量。";
  }
  if (current.phase === "holding") {
    if (current.chamberTemp > PROFILE.chamberPeak + 18) return "窑温偏高，将燃气降至 38–42% 并保持通风。";
    return "保温段：燃气约 42%，窑门必须关闭；让三件陶胎均温。";
  }
  if (current.phase === "cooling") {
    return "缓冷段：燃气归零，窑门开至 34–40%，让冷风均匀进入。";
  }
  return "等待下一批次。";
}

function renderEquipment() {
  const items = [
    {
      key: "burner",
      name: DEVICE_NAMES.burner,
      active: current.equipment.burner.on,
      health: current.equipment.burner.health,
      detail: current.equipment.burner.on ? `${current.controls.gas}%` : "关闭"
    },
    {
      key: "blower",
      name: DEVICE_NAMES.blower,
      active: current.equipment.blower.on,
      health: current.equipment.blower.health,
      detail: current.equipment.blower.on ? `${current.controls.vent}%` : "关闭"
    },
    {
      key: "door",
      name: DEVICE_NAMES.door,
      active: current.equipment.door.open > 0,
      health: current.equipment.door.health,
      detail: `${Math.round(current.equipment.door.open)}%`
    }
  ];
  $("#equipment-list").innerHTML = items
    .map((item) => {
      const status =
        item.health === "fault" ? "故障" : item.active ? "运行" : current.status === "ready" ? "待机" : "停止";
      return `<div class="equipment-row">
        <span><i class="device-dot ${item.health === "fault" ? "warn" : item.active ? "on" : ""}"></i>${item.name}</span>
        <em>${status} · ${item.detail}</em>
      </div>`;
    })
    .join("");
}

function pieceStatusText(piece) {
  return {
    safe: "稳定",
    cracked: "开裂",
    discolored: "色差",
    underfired: "欠火",
    overfired: "过火",
    uncooled: "缓冷不足"
  }[piece.status] || piece.status;
}

function renderPieces() {
  $("#piece-list").innerHTML = current.pieces
    .map((piece) => {
      const progress = Math.min(100, (piece.peak / piece.targetPeak) * 100);
      const wall = piece.thickness <= 0.8 ? "薄胎" : piece.thickness <= 1.4 ? "中胎" : "厚胎";
      return `<article class="piece-card ${piece.status}">
        <div class="piece-vessel ${piece.status}" aria-hidden="true"></div>
        <div class="piece-main">
          <div class="piece-title"><strong>${piece.name}</strong><span>${wall} · ${piece.thickness.toFixed(1)} cm</span></div>
          <div class="piece-temperature"><strong>${piece.temp.toFixed(0)}</strong><span>°C / 峰值 ${piece.peak.toFixed(0)}</span></div>
          <div class="piece-track"><i style="width:${Math.max(1, progress)}%"></i></div>
          <div class="piece-meta">
            <span>目标 ${piece.targetPeak}°C · 热限 ${piece.shockLimit}</span>
            <span class="piece-state">${pieceStatusText(piece)}</span>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function renderLog() {
  const entries = current.logs.slice(-40);
  if (!entries.length) {
    $("#event-log").innerHTML = '<p class="empty-note">设备动作将在这里留下不可更改的时间戳。</p>';
    return;
  }
  $("#event-log").innerHTML = entries
    .map((entry) => {
      const name =
        DEVICE_NAMES[entry.device] ||
        (entry.device === "system" ? "批次系统" : entry.device);
      return `<div class="event-row ${entry.type}">
        <time>${formatClock(entry.t)}</time>
        <span title="${entry.detail}">${name} · ${entry.action}</span>
        <em>${entry.type === "trip" ? "TRIP" : entry.type === "check" ? "AUDIT" : entry.type === "start" ? "ON" : entry.type === "stop" ? "OFF" : "LOG"}</em>
      </div>`;
    })
    .join("");
  const log = $("#event-log");
  log.scrollTop = log.scrollHeight;
}

function renderPhaseTrack() {
  const order = ["heating", "holding", "cooling"];
  const index = order.indexOf(current.phase);
  $$("#phase-track li").forEach((item, itemIndex) => {
    item.className = "";
    const marker = item.querySelector("em");
    if (current.phase === "complete" || itemIndex < index) {
      item.classList.add("done");
      marker.textContent = "完成";
    } else if (itemIndex === index) {
      item.classList.add("active");
      marker.textContent = current.status === "paused" ? "检查中" : "进行中";
    } else {
      marker.textContent = "等待";
    }
  });
}

function renderFailure() {
  const overlay = $("#failure-overlay");
  if (current.status !== "fault" || !current.failure) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  $("#failure-device").textContent = current.failure.deviceName;
  $("#failure-title").textContent = current.failure.title;
  $("#failure-detail").textContent = current.failure.detail;
  $("#failure-value").textContent = current.failure.triggerValue;
}

function renderRecovery() {
  const overlay = $("#recovery-overlay");
  if (current.status !== "recovery" || !current.recovery) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  $("#recovery-count").textContent = String(Math.ceil(current.recovery.remaining));
  $("#recovery-note").textContent = `核对报警计数、历史累计与瞬时计时器 · 剩余 ${current.recovery.remaining.toFixed(1)}s`;
}

function renderSummary() {
  const result = current.result;
  $("#good-count").textContent = result ? String(result.good) : "—";
  $("#waste-count").textContent = result ? String(result.waste) : "—";
  $("#summary-power").textContent = `${(result?.peakPower ?? current.peakPower).toFixed(2)} kW`;
  $("#shutdown-reason").textContent = result
    ? result.shutdownReason
    : current.status === "fault"
      ? `${current.failure.deviceName}联锁 · ${current.failure.triggerValue}`
      : "烧成进行中 · 结算于缓冷结束后生成";
}

function renderSnapshots() {
  const host = $("#snapshot-list");
  if (!snapshots.length) {
    host.innerHTML = '<p class="empty-note">尚未保存快照</p>';
    return;
  }
  host.innerHTML = snapshots
    .map(
      (snapshot, index) => `<div class="snapshot-chip">
        <span title="${snapshot.sourceBatchId} · ${snapshot.phase}">${formatClock(snapshot.elapsed)} · G${snapshot.controls.gas} / V${snapshot.controls.vent} / D${snapshot.controls.door}</span>
        <button type="button" data-load-snapshot="${index}">载入重跑</button>
      </div>`
    )
    .join("");
}

function renderArchive() {
  const body = $("#archive-body");
  if (!completedBatches.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-note">完成的批次会冻结在这里，允许复制参数，不允许改写结果。</td></tr>';
    $("#compare-button").disabled = true;
    return;
  }
  body.innerHTML = [...completedBatches]
    .reverse()
    .map(
      (record) => `<tr>
        <td>${record.batchId}</td>
        <td class="${record.good === 3 ? "result-success" : "result-waste"}">${record.good === 3 ? "全良" : "含废品"}</td>
        <td>${record.good} / ${record.waste}</td>
        <td>${record.peakPower.toFixed(2)} kW</td>
        <td>${record.alarmCount} 报警 · ${record.recoveredFaults} 恢复</td>
        <td>${record.shutdownReason}</td>
        <td><button type="button" class="table-action" data-copy-batch="${record.batchId}">参数副本</button></td>
      </tr>`
    )
    .join("");
  $("#compare-button").disabled = completedBatches.length < 2;
}

function compareRecord(record) {
  return `<section class="compare-batch">
    <header><strong>${record.batchId}</strong><span>${new Date(record.completedAt).toLocaleString("zh-CN", { hour12: false })}</span></header>
    <div class="compare-stat"><span>产出</span><strong>${record.good} 良品 / ${record.waste} 废品</strong></div>
    <div class="compare-stat"><span>峰值功耗</span><strong>${record.peakPower.toFixed(2)} kW</strong></div>
    <div class="compare-stat"><span>异常 / 恢复</span><strong>${record.alarmCount} / ${record.recoveredFaults}</strong></div>
    <div class="compare-stat"><span>启动参数</span><strong>G${record.controls.gas} · V${record.controls.vent} · D${record.controls.door}</strong></div>
    <div class="compare-stat"><span>结束参数</span><strong>G${record.finalControls?.gas ?? "—"} · V${record.finalControls?.vent ?? "—"} · D${record.finalControls?.door ?? "—"}</strong></div>
    <div class="compare-stat"><span>停机原因</span><strong>${record.shutdownReason}</strong></div>
    <div class="compare-stat"><span>恢复审计</span><strong>${record.recoveryAudits?.length ? record.recoveryAudits.map((audit) => `${audit.passed ? "通过" : "失败"} ${audit.duration}s`).join(" / ") : "无"}</strong></div>
    <div class="compare-stat"><span>陶器结果</span><strong>${record.pieces.map((piece) => `${piece.name}:${pieceStatusText(piece)}`).join(" · ")}</strong></div>
  </section>`;
}

function openCompare() {
  const pair = completedBatches.slice(-2);
  if (pair.length < 2) return;
  const [first, second] = pair;
  const powerDelta = second.peakPower - first.peakPower;
  const outcomeChanged = (first.good === 3) !== (second.good === 3);
  const exceptionTotal = first.alarmCount + second.alarmCount;
  const gasDelta = second.controls.gas - first.controls.gas;
  const ventDelta = second.controls.vent - first.controls.vent;
  const doorDelta = second.controls.door - first.controls.door;
  $("#compare-content").innerHTML = `
    <div class="compare-grid">${compareRecord(first)}${compareRecord(second)}</div>
    <div class="compare-delta">
      峰值功耗差 <b>${powerDelta >= 0 ? "+" : ""}${powerDelta.toFixed(2)} kW</b>；
      启动参数差 <b>燃气 ${gasDelta >= 0 ? "+" : ""}${gasDelta}% / 通风 ${ventDelta >= 0 ? "+" : ""}${ventDelta}% / 窑门 ${doorDelta >= 0 ? "+" : ""}${doorDelta}%</b>；
      产出结论${outcomeChanged ? "<b>发生变化</b>" : "保持一致"}；
      两批共记录 <b>${exceptionTotal} 条异常触发</b>、<b>${first.recoveredFaults + second.recoveredFaults} 次恢复审计</b>。
      两侧数据均来自已完成批次的冻结副本，当前控制台无法改写。
    </div>`;
  $("#compare-dialog").showModal();
}

function updateUi(force = false) {
  const now = performance.now();
  if (!force && now - lastUiPaint < 80) return;
  lastUiPaint = now;

  const rate = current.chamberRate;
  $("#sim-clock").textContent = formatClock(current.elapsed);
  $("#chamber-temp").innerHTML = `${current.chamberTemp.toFixed(1)}<i>°C</i>`;
  $("#temp-rate").innerHTML = `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}<i>°C/s</i>`;
  $("#burn-status").textContent = current.equipment.burner.on
    ? `燃烧器运行 · ${Math.round(current.controls.gas)}%`
    : current.status === "fault"
      ? "燃烧器联锁切断"
      : "燃烧器关闭";
  $("#airflow-readout").textContent = `风量 ${Math.round(
    current.equipment.blower.on ? current.controls.vent : 0
  )}% · 窑门 ${Math.round(current.equipment.door.open)}%`;
  $("#control-hint").textContent = controlHint();
  $("#control-hint").className = `control-hint${
    dangerConditions(current) ? " is-danger" : ""
  }`;
  $("#peak-power").innerHTML = `${current.peakPower.toFixed(2)} <i>kW</i>`;
  $("#exception-count").innerHTML = `${current.recoveredFaults} <i>次</i>`;

  paintControls();
  updateStatusAndActions();
  renderPieces();
  renderSummary();
  renderFailure();
  renderRecovery();

  if (
    current.revision !== lastRevision ||
    current.status !== lastStatus ||
    current.phase !== lastPhase
  ) {
    renderEquipment();
    renderLog();
    renderPhaseTrack();
    lastRevision = current.revision;
    lastStatus = current.status;
    lastPhase = current.phase;
  }

  const librarySignature = `${completedBatches.length}:${snapshots.length}:${batchCounter}`;
  if (librarySignature !== lastLibrarySignature) {
    renderArchive();
    renderSnapshots();
    lastLibrarySignature = librarySignature;
  }
}

function dangerConditions(state) {
  if (state.status === "completed" || state.status === "ready") return false;
  return (
    state.controls.gas > CONTROL_LIMITS.gas ||
    (state.controls.gas > 35 && state.controls.vent < CONTROL_LIMITS.minVent) ||
    (state.phase !== "cooling" && state.controls.door > CONTROL_LIMITS.door && state.chamberTemp > 620) ||
    state.chamberTemp > CONTROL_LIMITS.chamber
  );
}

async function beginCurrentBatch() {
  if (current.status === "ready") {
    startBatch(current);
    await audio.start();
  } else if (current.status === "paused") {
    resumeBatch(current);
    await audio.start();
  }
  if (scenario) {
    speedIndex = SPEEDS.length - 1;
    updateSpeedButton();
  }
  updateUi(true);
}

function applyControlsIfChanged(patch) {
  const changed = Object.entries(patch).some(
    ([key, value]) => Math.round(current.controls[key]) !== Math.round(value)
  );
  if (changed) setControls(current, patch);
}

function applyScenarioControls() {
  if (!scenario) return;
  if (scenario.kind === "normal") {
    if (current.phase === "heating") {
      applyControlsIfChanged({ gas: 76, vent: 46, door: 0 });
    } else if (current.phase === "holding") {
      applyControlsIfChanged({
        gas: current.chamberTemp < PROFILE.chamberPeak - 5 ? 52 : 42,
        vent: 46,
        door: 0
      });
    } else if (current.phase === "cooling") {
      applyControlsIfChanged({ gas: 0, vent: 50, door: 34 });
    }
    return;
  }
  if (scenario.kind === "fault") {
    if (!scenario.triggered && current.elapsed >= 30) {
      scenario.triggered = true;
      injectFault(current, "burner");
      audio.stop();
      showToast("验收场景 02：燃气阀卡滞", "联锁已暂停批次；请维修并完成 20 秒恢复审计。", true);
      return;
    }
    if (scenario.triggered && current.recoveredFaults > 0) {
      applyNormalSchedule();
    }
    return;
  }
  if (scenario.kind === "limit") {
    if (!scenario.triggered && current.elapsed >= 16) {
      scenario.triggered = true;
      applyControlsIfChanged({ gas: 76, vent: 12, door: 0 });
      showToast("验收场景 03：助燃风不足", "通风已设为 12%，低于 18% 安全下限。", true);
      return;
    }
    if (scenario.triggered && current.recoveredFaults > 0) {
      applyNormalSchedule();
    }
    return;
  }
}

function applyNormalSchedule() {
  if (current.phase === "heating") {
    applyControlsIfChanged({ gas: 76, vent: 46, door: 0 });
  } else if (current.phase === "holding") {
    applyControlsIfChanged({
      gas: current.chamberTemp < PROFILE.chamberPeak - 5 ? 52 : 42,
      vent: 46,
      door: 0
    });
  } else if (current.phase === "cooling") {
    applyControlsIfChanged({ gas: 0, vent: 50, door: 34 });
  }
}

function archiveCompletedBatch() {
  if (current.status !== "completed" || !current.result) return;
  if (completedBatches.some((record) => record.batchId === current.id)) return;
  const record = cloneFrozen({
    ...current.result,
    batchNumber: current.number,
    logs: current.logs.map((entry) => ({ ...entry })),
    history: current.history.map((sample) => ({ ...sample }))
  });
  completedBatches.push(record);
  while (completedBatches.length > 24) completedBatches.shift();
  scenario = null;
  audio.stop();
  persist();
  showToast(
    `批次 ${record.batchId} 已完成`,
    `${record.good} 件良品 / ${record.waste} 件废品 · 峰值 ${record.peakPower.toFixed(2)} kW · ${record.shutdownReason}`
  );
  window.setTimeout(() => {
    $(".lower-deck")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 420);
}

function simulationLoop() {
  const now = performance.now();
  requestAnimationFrame(simulationLoop);
  const previousStatus = current.status;
  if (current.status === "running" || current.status === "recovery") {
    applyScenarioControls();
    const seconds = Math.min(0.25, (now - lastFrame) / 1000) * SPEEDS[speedIndex];
    advance(current, seconds);
  }
  lastFrame = now;

  if (previousStatus === "running" && current.status === "fault") {
    audio.stop();
    updateUi(true);
  }
  if (current.status === "completed" && previousStatus !== "completed") {
    archiveCompletedBatch();
    lastLibrarySignature = "";
    updateUi(true);
  }

  const powered = ["running", "recovery"].includes(current.status);
  audio.update({
    gas: current.equipment.burner.on ? current.controls.gas : 0,
    vent: current.equipment.blower.on ? current.controls.vent : 0,
    door: current.equipment.door.open,
    powered
  });
  drawKiln(kilnCanvas, current, now);
  drawTrend(trendCanvas, current);
  updateUi();
}

async function handleStartButton() {
  if (current.status === "completed") {
    current = makeNextBatch({ gas: 76, vent: 46, door: 0 });
    scenario = null;
    lastRevision = -1;
    lastStatus = "";
    lastPhase = "";
    persist();
    startBatch(current);
    await audio.start();
    showToast("新批次已开始", `${current.id} · 三件作品入窑`);
    updateUi(true);
    return;
  }
  await beginCurrentBatch();
}

async function handlePauseButton() {
  if (current.status === "running") {
    pauseBatch(current);
    audio.stop();
    showToast("已暂停检查", "窑内时间冻结，设备状态与全部累计值保持不变。");
  } else if (current.status === "paused") {
    resumeBatch(current);
    await audio.start();
    showToast("烧成继续", "从暂停时刻恢复，不补算离线时间。");
  }
  updateUi(true);
}

function handleReset() {
  if (current.status === "recovery") return;
  current = makeNextBatch({ gas: 76, vent: 46, door: 0 });
  scenario = null;
  audio.stop();
  lastRevision = -1;
  lastStatus = "";
  lastPhase = "";
  persist();
  showToast("当前批次已重置", `${current.id} 已建立为空白批次；已完成批次不受影响。`);
  updateUi(true);
}

function saveSnapshot() {
  if (!["running", "paused", "fault"].includes(current.status)) return;
  const snapshot = createSnapshot(
    current,
    `${current.id} · ${formatClock(current.elapsed)} · G${current.controls.gas}/V${current.controls.vent}/D${current.controls.door}`
  );
  snapshots.push(snapshot);
  while (snapshots.length > 12) snapshots.shift();
  persist();
  renderSnapshots();
  showToast(
    "设备快照已冻结",
    `记录 ${current.controls.gas}/${current.controls.vent}/${current.controls.door} 与三台设备状态，可载入重跑。`
  );
}

async function handleRepair() {
  if (current.status !== "fault") return;
  const faultDevice = current.failure?.deviceName || "设备";
  if (!repairAndVerify(current)) return;
  await audio.start();
  showToast(
    `${faultDevice}已复位`,
    "固定 20 秒恢复验证开始；任何新增报警或累计值变化都会判定失败。"
  );
  updateUi(true);
}

function loadSnapshot(index) {
  const snapshot = snapshots[index];
  if (!snapshot) return;
  if (["running", "paused", "fault", "recovery"].includes(current.status)) {
    showToast("请先重置当前批次", "为避免覆盖运行中数据，快照只能在待机或完成状态载入。", true);
    return;
  }
  current = makeNextBatch({ ...snapshot.controls }, snapshot.id);
  scenario = null;
  audio.stop();
  lastRevision = -1;
  lastStatus = "";
  lastPhase = "";
  persist();
  showToast(
    "快照已载入为新批次",
    `${current.id} 已复制 G${snapshot.controls.gas}/V${snapshot.controls.vent}/D${snapshot.controls.door}；修改参数后开始重跑。`
  );
  updateUi(true);
}

function copyBatchParameters(batchId) {
  const record = completedBatches.find((batch) => batch.batchId === batchId);
  if (!record) return;
  if (["running", "paused", "fault", "recovery"].includes(current.status)) {
    showToast("请先重置当前批次", "完成批次的参数只能复制到新的待机批次。", true);
    return;
  }
  current = makeNextBatch({ ...record.controls });
  scenario = null;
  audio.stop();
  lastRevision = -1;
  lastStatus = "";
  lastPhase = "";
  persist();
  showToast(
    "已复制冻结参数",
    `源批次 ${record.batchId} 保持不变；可修改参数后运行新批次。`
  );
  updateUi(true);
}

function launchScenario(kind) {
  if (["running", "paused", "fault", "recovery"].includes(current.status)) {
    showToast("请先重置当前批次", "验收场景需要建立独立批次，避免覆盖运行数据。", true);
    return;
  }
  current = makeNextBatch({ gas: 76, vent: 46, door: 0 });
  scenario = { kind, triggered: false };
  speedIndex = SPEEDS.length - 1;
  updateSpeedButton();
  audio.stop();
  lastRevision = -1;
  lastStatus = "";
  lastPhase = "";
  startBatch(current);
  audio.start();
  const messages = {
    normal: ["验收场景 01：正常生产", "自动跟随厚薄安全曲线，完成后生成批次结算。"],
    fault: ["验收场景 02：设备故障", "将在窑内时间 00:30 注入燃气阀卡滞，请随后维修验证。"],
    limit: ["验收场景 03：参数越限", "将在窑内时间 00:16 把助燃风降至 12%，触发欠氧联锁。"]
  };
  showToast(...messages[kind]);
  updateUi(true);
}

function updateSpeedButton() {
  $("#speed-label").textContent = `×${SPEEDS[speedIndex]}`;
}

function bindEvents() {
  $("#start-button").addEventListener("click", handleStartButton);
  $("#pause-button").addEventListener("click", handlePauseButton);
  $("#reset-button").addEventListener("click", handleReset);
  $("#snapshot-button").addEventListener("click", saveSnapshot);
  $("#repair-button").addEventListener("click", handleRepair);
  $("#compare-button").addEventListener("click", openCompare);
  $("#close-compare").addEventListener("click", () => $("#compare-dialog").close());
  $("#speed-button").addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    updateSpeedButton();
    showToast("模拟速度已切换", `当前为 ×${SPEEDS[speedIndex]}，设备联锁按窑内时间计算。`);
  });
  $("#sound-button").addEventListener("click", async () => {
    soundMuted = !soundMuted;
    const button = $("#sound-button");
    button.setAttribute("aria-pressed", String(!soundMuted));
    $("#sound-label").textContent = soundMuted ? "声音关" : "声音开";
    await audio.setMuted(soundMuted);
  });
  $$(".scenario-grid button").forEach((button) => {
    button.addEventListener("click", () => launchScenario(button.dataset.scenario));
  });
  $("#snapshot-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-load-snapshot]");
    if (button) loadSnapshot(Number(button.dataset.loadSnapshot));
  });
  $("#archive-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-batch]");
    if (button) copyBatchParameters(button.dataset.copyBatch);
  });
}

function init() {
  loadStored();
  current = makeNextBatch({ gas: 76, vent: 46, door: 0 });
  buildControls();
  bindEvents();
  updateSpeedButton();
  lastFrame = performance.now();
  updateUi(true);
  requestAnimationFrame(simulationLoop);
}

init();
