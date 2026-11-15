import {
  BUFFERS,
  CARTONS,
  OFFSET_LIMIT,
  ORDERS,
  PHASES,
  SCENARIOS,
  TAPE_PATHS,
  clone
} from "./data.js";
import { PackingEngine, evaluateOrder } from "./engine.js";
import { LineAudio } from "./audio.js";
import { LineRenderer } from "./renderer.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const engine = new PackingEngine();
const audio = new LineAudio();
const renderer = new LineRenderer(
  $("#line-canvas"),
  $("#power-canvas"),
  engine
);

const validationStates = Object.fromEntries(
  Object.keys(SCENARIOS).map((key) => [
    key,
    { status: "idle", label: "未执行", detail: "等待验收" }
  ])
);

let selectedIndex = 0;
let draftRecipe = clone(engine.getRecipe(ORDERS[0].id));
let activeTab = "device";
let currentFault = null;
let currentSnapshotId = null;
let validationRun = null;
let latestResult = null;
let needsRefresh = true;
let lastRefreshAt = 0;
let lastLogSignature = "";
let lastExceptionSignature = "";

function initialize() {
  buildOrderList();
  buildOptionButtons();
  bindControls();
  bindEngineEvents();
  bindDialogs();
  syncDraftFromEngine();
  syncClock();
  setInterval(syncClock, 1000);
  refreshAll();
  requestAnimationFrame(loop);

  window.__PACKFLOW__ = {
    engine,
    audio,
    renderer,
    startScenario,
    selectOrder,
    saveSnapshot,
    getValidationStates: () => clone(validationStates),
    getDraft: () => clone(draftRecipe)
  };
}

function syncClock() {
  $("#clock-label").textContent = new Date().toLocaleTimeString("zh-CN", {
    hour12: false
  });
}

function buildOrderList() {
  const list = $("#order-list");
  list.innerHTML = "";
  ORDERS.forEach((order, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "order-card";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="order-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="order-info">
        <strong>${order.name}</strong>
        <small>${order.code} · ${order.dims.join("×")}</small>
      </span>
      <span class="order-status-dot"></span>
    `;
    button.addEventListener("click", () => selectOrder(index));
    list.appendChild(button);
  });
}

function buildOptionButtons() {
  $("#box-options").innerHTML = Object.values(CARTONS)
    .map(
      (carton) => `
        <button class="option-button box-option" type="button" data-value="${carton.id}">
          <span class="option-icon box-${carton.id.toLowerCase()}"></span>
          <strong>${carton.label}</strong>
          <small>${carton.note}</small>
        </button>
      `
    )
    .join("");

  $("#buffer-options").innerHTML = Object.values(BUFFERS)
    .map(
      (buffer) => `
        <button class="option-button buffer-option" type="button" data-value="${buffer.id}">
          <span class="option-icon buffer-${buffer.id}"></span>
          <strong>${buffer.label}</strong>
          <small>${buffer.note}</small>
        </button>
      `
    )
    .join("");

  $("#tape-options").innerHTML = Object.values(TAPE_PATHS)
    .map(
      (tape) => `
        <button class="option-button tape-option" type="button" data-value="${tape.id}">
          <span class="option-icon tape-${tape.id.toLowerCase()}"></span>
          <strong>${tape.label}</strong>
          <small>${tape.note}</small>
        </button>
      `
    )
    .join("");

  $$(".box-option").forEach((button) => {
    button.addEventListener("click", () => updateDraft({ boxSize: button.dataset.value }));
  });
  $$(".buffer-option").forEach((button) => {
    button.addEventListener("click", () => updateDraft({ buffer: button.dataset.value }));
  });
  $$(".tape-option").forEach((button) => {
    button.addEventListener("click", () => updateDraft({ tapePath: button.dataset.value }));
  });
}

function bindControls() {
  $("#start-button").addEventListener("click", handleStart);
  $("#apply-button").addEventListener("click", applyDraft);
  $("#recommend-button").addEventListener("click", applyRecommended);
  $("#pause-button").addEventListener("click", togglePause);
  $("#reset-button").addEventListener("click", resetBatch);
  $("#snapshot-button").addEventListener("click", () => saveSnapshot("header"));
  $("#report-snapshot-button").addEventListener("click", () => saveSnapshot("report"));
  $("#sound-button").addEventListener("click", toggleSound);
  $("#validation-jump").addEventListener("click", () => {
    $(".validation-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#history-button").addEventListener("click", showHistory);
  $("#recover-button").addEventListener("click", recoverFault);
  $("#offset-range").addEventListener("input", handleOffsetInput);
  $("#tab-device").addEventListener("click", () => switchLogTab("device"));
  $("#tab-exception").addEventListener("click", () => switchLogTab("exception"));
  $("#rerun-snapshot").addEventListener("click", loadSnapshotForRerun);
  $("#compare-button").addEventListener("click", showComparison);

  $$(".validation-row").forEach((row) => {
    row.addEventListener("click", () => {
      if (!row.disabled) startScenario(row.dataset.scenario);
    });
  });
}

function bindDialogs() {
  $$("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.close);
      if (dialog?.open) dialog.close();
    });
  });
  $$("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function loop(timestamp) {
  const delta = Math.min(timestamp - (loop.lastAt || timestamp), 50);
  loop.lastAt = timestamp;
  engine.tick(delta);
  renderer.setPreview(
    ORDERS[selectedIndex],
    draftRecipe,
    engine.offset
  );
  renderer.draw();
  audio.update(engine);
  if (needsRefresh || timestamp - lastRefreshAt > 120) {
    refreshAll();
    lastRefreshAt = timestamp;
    needsRefresh = false;
  }
  requestAnimationFrame(loop);
}

function selectOrder(index) {
  if (!ORDERS[index]) return;
  selectedIndex = index;
  if (engine.canEdit() || engine.status === "fault") {
    syncDraftFromEngine();
  } else {
    draftRecipe = clone(engine.getRecipe(ORDERS[index].id));
  }
  needsRefresh = true;
}

function syncDraftFromEngine() {
  const recipe = engine.getRecipe(ORDERS[selectedIndex].id);
  if (recipe) draftRecipe = clone(recipe);
}

function updateDraft(patch) {
  if (!engine.canEdit()) {
    toast("运行中不可修改配方，请暂停并重置批次", "error");
    return;
  }
  draftRecipe = { ...draftRecipe, ...patch };
  needsRefresh = true;
  refreshAll();
}

function applyDraft(silent = false) {
  const order = ORDERS[selectedIndex];
  const result = engine.setRecipe(order.id, draftRecipe);
  if (!result.ok) {
    if (!silent) toast(result.reason, "error");
    return false;
  }
  draftRecipe = clone(result.recipe);
  if (!silent) toast(`${order.id} 配方已写入`);
  needsRefresh = true;
  refreshAll();
  return true;
}

function handleStart() {
  if (engine.status === "paused") {
    togglePause();
    return;
  }
  if (engine.status === "fault") {
    toast("设备仍在联锁状态，请先执行复位", "error");
    return;
  }
  if (!["idle", "complete"].includes(engine.status)) return;
  applyDraft(true);
  validationRun = null;
  const result = engine.startBatch({
    scenario: null,
    fresh: engine.status === "complete"
  });
  if (!result.ok && result.fault) {
    currentFault = result.fault;
  } else if (result.ok) {
    selectedIndex = 0;
    syncDraftFromEngine();
    toast(`${result.batchId} 已启动，8 个订单进入生产队列`);
  }
  needsRefresh = true;
  refreshAll();
}

function applyRecommended() {
  if (!engine.canEdit()) {
    toast("请先重置当前批次", "error");
    return;
  }
  const result = engine.applyRecommended();
  if (!result.ok) {
    toast(result.reason, "error");
    return;
  }
  selectedIndex = 0;
  syncDraftFromEngine();
  $("#offset-range").value = "0";
  toast("8 个订单已载入推荐配方，偏置归零");
  needsRefresh = true;
  refreshAll();
}

function togglePause() {
  let result;
  if (engine.status === "paused") {
    result = engine.resume();
    if (result.ok) toast("产线恢复运行，设备重新计时");
  } else {
    result = engine.pause();
    if (result.ok) toast("产线已暂停，可检查设备时序与配方");
  }
  if (!result?.ok) toast(result?.reason || "当前状态不可暂停", "error");
  needsRefresh = true;
  refreshAll();
}

function resetBatch() {
  if (
    validationRun &&
    !["pass", "fail"].includes(validationStates[validationRun.type].status)
  ) {
    setValidationState(
      validationRun.type,
      "fail",
      "批次重置",
      "验收流程被中断，未完成固定复检"
    );
  }
  validationRun = null;
  currentFault = null;
  engine.resetCurrentBatch();
  selectedIndex = 0;
  syncDraftFromEngine();
  $("#offset-range").value = String(engine.offset);
  toast(`当前批次已重置为 ${engine.runtime.id}`);
  needsRefresh = true;
  refreshAll();
}

function handleOffsetInput(event) {
  const result = engine.setOffset(Number(event.target.value));
  if (!result.ok) {
    event.target.value = String(engine.offset);
    toast(result.reason, "error");
    return;
  }
  if (currentFault?.kind === "parameter_limit") {
    renderFault(currentFault);
  }
  needsRefresh = true;
  refreshAll();
}

async function toggleSound() {
  const button = $("#sound-button");
  if (audio.enabled) {
    audio.disable();
    button.classList.add("is-muted");
    button.title = "开启声音";
    button.setAttribute("aria-label", "开启声音");
    toast("产线声音已关闭");
    return;
  }
  try {
    await audio.enable();
    button.classList.remove("is-muted");
    button.title = "关闭声音";
    button.setAttribute("aria-label", "关闭声音");
    toast("产线声音已开启：机械臂伺服 + 封口器");
  } catch {
    toast("当前浏览器无法启用声音", "error");
  }
}

function switchLogTab(tab) {
  activeTab = tab;
  const deviceActive = tab === "device";
  $("#tab-device").classList.toggle("active", deviceActive);
  $("#tab-exception").classList.toggle("active", !deviceActive);
  $("#tab-device").setAttribute("aria-selected", String(deviceActive));
  $("#tab-exception").setAttribute("aria-selected", String(!deviceActive));
  $("#device-log").hidden = !deviceActive;
  $("#exception-log").hidden = deviceActive;
}

function startScenario(type) {
  if (!SCENARIOS[type]) return;
  if (!["idle", "complete"].includes(engine.status)) {
    toast("请先重置当前批次，再启动验收场景", "error");
    return;
  }

  if (engine.status === "complete") {
    engine.resetCurrentBatch();
  }
  engine.applyRecommended();
  engine.setOffset(0);
  selectedIndex = 0;
  syncDraftFromEngine();
  $("#offset-range").value = "0";
  currentFault = null;
  validationRun = { type, startedAt: Date.now() };

  let labels = {
    normal: ["运行中", "8 个订单正常流转"],
    fault: ["运行中", "等待封口器注入"],
    limit: ["待联锁", "机械臂偏置 +30 mm"]
  };

  if (type === "limit") {
    engine.setOffset(30);
    $("#offset-range").value = "30";
  }
  const result = engine.startBatch({ scenario: type, fresh: false });
  if (!result.ok && result.fault) {
    currentFault = result.fault;
    if (type === "limit") {
      labels.limit = ["等待复位", `${result.fault.equipment} · ${result.fault.trigger}`];
    }
  }
  setValidationState(type, "running", labels[type][0], labels[type][1]);
  toast(`验收场景 ${type === "normal" ? "A" : type === "fault" ? "B" : "C"} 已启动`);
  needsRefresh = true;
  refreshAll();
}

function setValidationState(type, status, label, detail) {
  validationStates[type] = { status, label, detail };
  needsRefresh = true;
}

function recoverFault() {
  const result = engine.recoverFault();
  if (!result.ok) {
    toast(result.reason, "error");
    renderFault(currentFault);
    return;
  }
  currentFault = result.exception;
  if (validationRun && ["fault", "limit"].includes(validationRun.type)) {
    setValidationState(
      validationRun.type,
      "running",
      "复检中",
      "固定观察 3.0s · 检查状态残留"
    );
  }
  audio.cue("recover");
  toast("复位指令已下发，产线进入 3.0s 固定复检");
  needsRefresh = true;
  refreshAll();
}

function bindEngineEvents() {
  engine.on("change", () => {
    needsRefresh = true;
  });

  engine.on("order-start", ({ index }) => {
    selectedIndex = index;
    syncDraftFromEngine();
    needsRefresh = true;
  });

  engine.on("fault", (exception) => {
    currentFault = exception;
    audio.cue("fault");
    if (validationRun) {
      if (validationRun.type === "fault" && exception.scenarioInjected) {
        setValidationState(
          "fault",
          "running",
          "等待复位",
          `${exception.equipment} · ${exception.trigger}`
        );
      } else if (validationRun.type === "limit" && exception.kind === "parameter_limit") {
        setValidationState(
          "limit",
          "running",
          "等待复位",
          `${exception.equipment} · ${exception.trigger}`
        );
      }
    }
    needsRefresh = true;
  });

  engine.on("recovery-start", ({ exception }) => {
    if (validationRun && ["fault", "limit"].includes(validationRun.type)) {
      setValidationState(
        validationRun.type,
        "running",
        "复检中",
        `${exception.id} · 固定观察 3.0s`
      );
    }
  });

  engine.on("recovery-verified", ({ passed, residuals, checkedMs }) => {
    if (validationRun && ["fault", "limit"].includes(validationRun.type)) {
      setValidationState(
        validationRun.type,
        passed ? "pass" : "fail",
        passed ? "复检通过" : "复检失败",
        passed
          ? `${(checkedMs / 1000).toFixed(1)}s 无状态残留`
          : residuals.join("；")
      );
      if (passed) audio.cue("complete");
    }
    currentFault = null;
    needsRefresh = true;
  });

  engine.on("batch-complete", (result) => {
    latestResult = result;
    if (engine.getOpenException()) currentFault = engine.getOpenException();
    if (validationRun?.type === "normal") {
      const passed = result.good === 8 && result.waste === 0;
      setValidationState(
        "normal",
        passed ? "pass" : "fail",
        passed ? "全检通过" : "未通过",
        `${result.good} 良品 / ${result.waste} 废品`
      );
    } else if (validationRun) {
      const state = validationStates[validationRun.type];
      if (state.status !== "pass") {
        setValidationState(
          validationRun.type,
          "fail",
          "未闭环",
          "批次结束前未完成固定复检"
        );
      }
    }
    audio.cue("complete");
    needsRefresh = true;
    refreshAll();
    setTimeout(() => showReport(result), 420);
  });

  engine.on("snapshot", () => {
    needsRefresh = true;
  });
}

function refreshAll() {
  refreshOrders();
  refreshConfig();
  refreshLiveMetrics();
  refreshLogs();
  refreshValidation();
  refreshSnapshot();
  refreshActionStates();
  renderer.setPreview(ORDERS[selectedIndex], draftRecipe, engine.offset);
}

function refreshOrders() {
  const currentIndex = engine.runtime.currentOrderIndex;
  const canInspect = true;
  $$(".order-card").forEach((card, index) => {
    const status = engine.runtime.orders[index]?.status;
    card.classList.toggle("is-selected", index === selectedIndex);
    card.classList.toggle(
      "is-current",
      index === currentIndex && ["running", "recovering", "paused", "fault"].includes(engine.status)
    );
    card.classList.toggle("is-good", status === "good");
    card.classList.toggle("is-waste", status === "waste");
    card.disabled = !canInspect;
    card.setAttribute(
      "aria-label",
      `${ORDERS[index].id} ${ORDERS[index].name}，${statusLabel(status)}`
    );
  });
  const done = engine.runtime.good + engine.runtime.waste;
  $("#orders-done").textContent = String(done);
  $("#recommend-button").disabled = !engine.canEdit();
}

function statusLabel(status) {
  const labels = {
    pending: "待生产",
    running: "生产中",
    good: "良品",
    waste: "废品"
  };
  return labels[status] || "待生产";
}

function refreshConfig() {
  const order = ORDERS[selectedIndex];
  const evaluation = evaluateOrder(order, draftRecipe, engine.offset);
  $("#selected-order-id").textContent = order.id;
  $("#selected-product-name").textContent = order.name;
  $("#selected-product-spec").textContent =
    `尺寸 ${order.dims.join(" × ")} mm · ${order.mass} kg`;
  const fragility = $("#fragility-tag");
  fragility.textContent = order.fragility === 1 ? "常规 L1" : order.fragility === 2 ? "易碎 L2" : "高敏 L3";
  fragility.classList.toggle("low", order.fragility === 1);
  $("#recipe-target").textContent =
    `订单 ${String(selectedIndex + 1).padStart(2, "0")} / 08`;
  const glyph = $("#product-glyph");
  glyph.style.background = `linear-gradient(145deg, ${order.accent}33, #e3dfd2)`;
  glyph.querySelectorAll("span")[1].style.background = order.accent;

  $$(".box-option").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.value === draftRecipe.boxSize);
  });
  $$(".buffer-option").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.value === draftRecipe.buffer);
  });
  $$(".tape-option").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.value === draftRecipe.tapePath);
  });

  $("#offset-range").value = String(engine.offset);
  const offsetOutput = $("#offset-output");
  offsetOutput.textContent = `${engine.offset > 0 ? "+" : ""}${engine.offset} mm`;
  offsetOutput.classList.toggle("is-over", Math.abs(engine.offset) > OFFSET_LIMIT);

  setFitBar("space", evaluation.scores.space);
  setFitBar("cushion", evaluation.scores.cushion);
  setFitBar("seal", evaluation.scores.seal);
  const fitStatus = $("#fit-status");
  if (Math.abs(engine.offset) > OFFSET_LIMIT) {
    fitStatus.textContent = "偏置越限";
    fitStatus.classList.add("bad");
  } else if (evaluation.good) {
    fitStatus.textContent = "通过 · 可排产";
    fitStatus.classList.remove("bad");
  } else {
    fitStatus.textContent = `${evaluation.issues.length} 项风险`;
    fitStatus.classList.add("bad");
  }
  $("#fit-readout").title = evaluation.issues.map((issue) => issue.message).join("\n") || "配方预检通过";
}

function setFitBar(name, value) {
  const bar = $(`#fit-${name}-bar`);
  const text = $(`#fit-${name}`);
  bar.style.width = `${value}%`;
  bar.classList.toggle("warning", value < 85 && value >= 55);
  bar.classList.toggle("bad", value < 55);
  text.textContent = `${value}%`;
}

function refreshLiveMetrics() {
  const runtime = engine.runtime;
  const done = runtime.good + runtime.waste;
  const currentOrder = engine.getCurrentOrder();
  const phase = PHASES[runtime.phaseIndex];
  const totalPhaseMs = PHASES.reduce((total, item) => total + item.duration, 0);
  const completedPhaseMs = PHASES
    .slice(0, runtime.phaseIndex)
    .reduce((total, item) => total + item.duration, 0);
  const activeFraction = Math.min(1, (completedPhaseMs + runtime.phaseElapsed) / totalPhaseMs);
  let overall = done / ORDERS.length;
  if (currentOrder && !["complete", "idle"].includes(engine.status)) {
    overall = Math.min(1, (done + activeFraction) / ORDERS.length);
  }
  if (engine.status === "complete") overall = 1;

  $("#good-count").textContent = String(runtime.good).padStart(2, "0");
  $("#waste-count").textContent = String(runtime.waste).padStart(2, "0");
  $("#peak-power").innerHTML = `${runtime.peakPower.toFixed(2)}<em>kW</em>`;
  $("#exception-count").textContent = String(runtime.exceptions.length).padStart(2, "0");
  $("#progress-fill").style.width = `${Math.round(overall * 100)}%`;
  $("#progress-value").textContent = `${Math.round(overall * 100)}%`;
  $("#progress-copy").textContent = currentOrder
    ? `${currentOrder.id} · ${phase?.label || "换箱"}`
    : engine.status === "complete"
      ? `批次完成 · ${runtime.good + runtime.waste} / 8 已判定`
      : "尚未装载订单";

  const yieldValue = done ? Math.round((runtime.good / done) * 100) : 0;
  $("#yield-metric").innerHTML = done
    ? `${yieldValue}<small>%</small>`
    : "--<small>%</small>";
  $("#cycle-metric").innerHTML = currentOrder
    ? `${(totalPhaseMs / 1000).toFixed(1)}<small>s</small>`
    : "--<small>s</small>";
  $("#power-metric").innerHTML = `${runtime.currentPower.toFixed(2)}<small>kW</small>`;
  $("#power-footer").textContent = `${runtime.currentPower.toFixed(2)} kW`;
  $("#batch-label").textContent = `BATCH ${engine.batchSeq.toString().padStart(3, "0")}`;
  $("#yield-metric").title = `${runtime.good} 良品 / ${runtime.waste} 废品`;

  $("#canvas-order-id").textContent = currentOrder?.id || ORDERS[selectedIndex].id;
  $("#canvas-order-progress").textContent =
    `${String(done).padStart(2, "0")} / ${String(ORDERS.length).padStart(2, "0")}`;
  $("#arm-angle").textContent =
    `${engine.animation.armAngle >= 0 ? "+" : ""}${engine.animation.armAngle.toFixed(1)}°`;

  const headings = {
    idle: "等待批次启动",
    running: currentOrder ? `正在装箱 · ${currentOrder.name}` : "批次运行中",
    recovering: "恢复运行 · 固定复检",
    paused: "产线暂停 · 安全检查",
    fault: currentFault ? `${currentFault.equipmentName}联锁停机` : "联锁停机",
    complete: "批次完成 · 数据已冻结"
  };
  $("#stage-heading").textContent = headings[engine.status] || "等待批次启动";

  const chip = $("#batch-status-chip");
  chip.className = "status-chip";
  if (engine.status === "fault") {
    chip.classList.add("danger");
    chip.textContent = "联锁停机";
  } else if (engine.status === "paused") {
    chip.classList.add("warning");
    chip.textContent = "已暂停";
  } else if (engine.status === "recovering") {
    chip.classList.add("warning");
    chip.textContent = "恢复复检";
  } else if (engine.status === "complete") {
    chip.textContent = "已完成";
  } else if (engine.status === "running") {
    chip.textContent = "生产中";
  } else {
    chip.classList.add("neutral");
    chip.textContent = "待机";
  }

  $$(".device-pill").forEach((pill) => {
    const device = engine.devices[pill.dataset.device];
    pill.classList.toggle("is-on", Boolean(device?.active));
    pill.classList.toggle("is-fault", device?.health === "fault");
  });

  $$("#phase-steps span").forEach((step, index) => {
    const active = index === runtime.phaseIndex &&
      ["running", "recovering", "paused", "fault"].includes(engine.status);
    const complete = index < runtime.phaseIndex ||
      engine.status === "complete";
    step.classList.toggle("is-active", active);
    step.classList.toggle("is-done", complete && !active);
  });

  $("#pause-flag").hidden = engine.status !== "paused";
  if (engine.status === "fault" && currentFault) renderFault(currentFault);
  else $("#fault-panel").hidden = true;
}

function renderFault(exception) {
  if (!exception) {
    $("#fault-panel").hidden = true;
    return;
  }
  $("#fault-panel").hidden = false;
  $("#fault-title").textContent = `${exception.equipmentName} · ${exception.title}`;
  $("#fault-detail").textContent =
    `${exception.message} 触发时刻 ${exception.openedLabel}，批次 ${exception.batchId} 已停止计时。`;
  $("#fault-equipment").textContent = `${exception.equipment} ${exception.equipmentName}`;
  $("#fault-value").textContent = exception.trigger;
  const button = $("#recover-button");
  const blocked = exception.kind === "parameter_limit" && Math.abs(engine.offset) > OFFSET_LIMIT;
  button.disabled = blocked;
  button.textContent = exception.kind === "parameter_limit" ? "参数修正并复位" : "执行复位";
  $("#recovery-hint").textContent = blocked
    ? `先把偏置恢复到 ±${OFFSET_LIMIT} mm 内`
    : `确认安全后复位并复检 3.0s · 记录 ${exception.id}`;
}

function refreshActionStates() {
  const status = engine.status;
  const startButton = $("#start-button");
  const startLabel = $("#start-label");
  if (status === "running" || status === "recovering") {
    startButton.disabled = true;
    startLabel.textContent = "批次运行中";
  } else if (status === "paused") {
    startButton.disabled = false;
    startLabel.textContent = "继续运行";
  } else if (status === "fault") {
    startButton.disabled = true;
    startLabel.textContent = "等待故障复位";
  } else if (status === "complete") {
    startButton.disabled = false;
    startLabel.textContent = "启动新批次";
  } else {
    startButton.disabled = false;
    startLabel.textContent = "启动批次";
  }

  const pauseButton = $("#pause-button");
  pauseButton.disabled = !["running", "recovering", "paused"].includes(status);
  const paused = status === "paused";
  pauseButton.innerHTML = paused
    ? '<span class="play-icon"></span><span class="button-text">继续运行</span>'
    : '<span class="pause-icon"></span><span class="button-text">暂停检查</span>';

  const editable = engine.canEdit();
  $("#apply-button").disabled = !editable;
  $("#recommend-button").disabled = !editable;
  $("#offset-range").disabled = !(
    editable ||
    (status === "fault" && currentFault?.kind === "parameter_limit")
  );
  $$(".option-button").forEach((button) => {
    button.disabled = !editable;
  });
  $$(".validation-row").forEach((row) => {
    row.disabled = !["idle", "complete"].includes(status);
  });
}

function refreshLogs() {
  const logs = engine.runtime.deviceLogs;
  const last = logs.at(-1);
  const signature = `${logs.length}:${last?.stopAt || "open"}:${engine.status}:${last?.deviceKey || ""}`;
  if (signature !== lastLogSignature) {
    lastLogSignature = signature;
    if (!logs.length) {
      $("#device-log").innerHTML =
        '<div class="empty-log">暂无设备时序<br>启动批次后将记录每台设备的启停时刻</div>';
    } else {
      const rows = [];
      logs.forEach((entry) => {
        rows.push({
          time: entry.startLabel,
          device: `${entry.deviceId} ${entry.deviceName}`,
          event: "启动",
          eventClass: "start",
          order: entry.orderId,
          duration: "--"
        });
        if (entry.stopAt) {
          rows.push({
            time: entry.stopLabel,
            device: `${entry.deviceId} ${entry.deviceName}`,
            event: entry.stopReason === "operator-pause" ? "暂停" : "停止",
            eventClass: "stop",
            order: entry.orderId,
            duration: `${entry.duration?.toFixed(2)}s`
          });
        }
      });
      $("#device-log").innerHTML = rows
        .reverse()
        .slice(0, 80)
        .map(
          (row) => `
            <div class="log-row">
              <span class="log-time">${row.time}</span>
              <span class="log-device">${row.device}</span>
              <span class="log-event ${row.eventClass}">${row.event}</span>
              <span class="log-order">${row.order.replace("ORD-", "")}</span>
              <span class="log-duration">${row.duration}</span>
            </div>
          `
        )
        .join("");
    }
  }

  const exceptions = engine.runtime.exceptions;
  const exceptionSignature = exceptions
    .map((item) => `${item.id}:${item.status}:${item.recovery?.passed}`)
    .join("|");
  $("#exception-badge").textContent = String(exceptions.length);
  if (exceptionSignature !== lastExceptionSignature) {
    lastExceptionSignature = exceptionSignature;
    if (!exceptions.length) {
      $("#exception-log").innerHTML =
        '<div class="empty-log">本批次暂无异常<br>设备故障与参数越限将在此闭环</div>';
    } else {
      $("#exception-log").innerHTML = [...exceptions]
        .reverse()
        .map(
          (item) => `
            <div class="exception-row">
              <span class="exception-icon">!</span>
              <span class="exception-main">
                <strong>${item.equipment} · ${item.title}</strong>
                <small>${item.trigger} · ${item.openedLabel} · ${item.id}</small>
              </span>
              <span class="exception-state ${item.status === "resolved" ? "" : "open"}">
                ${item.status === "resolved" ? "已闭环" : "处理中"}
              </span>
            </div>
          `
        )
        .join("");
    }
  }
}

function refreshValidation() {
  let passed = 0;
  Object.entries(validationStates).forEach(([type, state]) => {
    if (state.status === "pass") passed += 1;
    const row = $(`.validation-row[data-scenario="${type}"]`);
    if (!row) return;
    row.classList.toggle("is-running", state.status === "running");
    row.classList.toggle("is-pass", state.status === "pass");
    row.classList.toggle("is-fail", state.status === "fail");
    row.querySelector(".validation-state").textContent = state.label;
    row.title = state.detail;
  });
  const chip = $("#validation-chip");
  chip.textContent = `${passed} / 3`;
  chip.className = `status-chip ${passed === 3 ? "" : "neutral"}`;
  $("#validation-jump").textContent = `验收 ${passed} / 3`;
}

function refreshSnapshot() {
  const latest = engine.snapshots.at(-1);
  if (!latest) {
    $("#snapshot-empty").hidden = false;
    $("#snapshot-saved").hidden = true;
    return;
  }
  currentSnapshotId = latest.id;
  $("#snapshot-empty").hidden = true;
  $("#snapshot-saved").hidden = false;
  $("#snapshot-name").textContent = latest.id;
  $("#snapshot-time").textContent = latest.capturedLabel;
  const healthy = Object.values(latest.equipment).filter((device) => device.health === "ok").length;
  $("#snapshot-meta").textContent =
    `设备 ${healthy}/5 正常 · 基准 ${latest.batchId || "未绑定批次"} · 偏置 ${latest.offset >= 0 ? "+" : ""}${latest.offset} mm`;
  const comparison = engine.getComparison(latest.id);
  const compareButton = $("#compare-button");
  compareButton.disabled = !comparison;
  compareButton.title = comparison
    ? `比较 ${comparison.base.id} 与 ${comparison.current.id}`
    : "需完成第二个不同批次后比较";
}

function saveSnapshot(source = "header") {
  const snapshot = engine.saveSnapshot({
    note: source === "report" ? "批次报告导出" : "设备状态手动快照"
  });
  currentSnapshotId = snapshot.id;
  audio.cue("snapshot");
  needsRefresh = true;
  refreshAll();
  toast(
    `${snapshot.id} 已冻结：5 台设备状态${snapshot.batchId ? ` · 基准批次 ${snapshot.batchId}` : ""}`
  );
  return snapshot;
}

function loadSnapshotForRerun() {
  if (!currentSnapshotId) {
    toast("请先保存设备快照", "error");
    return;
  }
  if (!engine.canEdit()) {
    toast("请先重置当前批次再加载快照", "error");
    return;
  }
  const result = engine.loadSnapshot(currentSnapshotId);
  if (!result.ok) {
    toast(result.reason, "error");
    return;
  }
  selectedIndex = 0;
  syncDraftFromEngine();
  $("#offset-range").value = String(engine.offset);
  toast(`${result.snapshot.id} 参数已载入，可修改后启动复跑`);
  needsRefresh = true;
  refreshAll();
}

function showReport(result) {
  if (!result) return;
  const dialog = $("#report-dialog");
  $("#report-title").textContent = `BATCH ${result.id} · 生产报告`;
  $("#report-freeze-note").textContent =
    `已冻结 ${result.endedLabel} · ${result.deviceLogs.length} 条设备时序`;
  $("#report-kpis").innerHTML = [
    ["良品", result.good, "箱", `${result.good}/8 全检通过`],
    ["废品", result.waste, "箱", result.waste ? "详见订单判定" : "无废品"],
    ["峰值功耗", result.peakPower.toFixed(2), "kW", "实时采样峰值"],
    ["运行时长", (result.durationMs / 1000).toFixed(1), "s", `${result.cycleCount} 个节拍`]
  ]
    .map(
      ([label, value, unit, note]) => `
        <div class="report-kpi">
          <span>${label}</span>
          <strong>${value}<small>${unit}</small></strong>
          <em>${note}</em>
        </div>
      `
    )
    .join("");

  $("#report-orders").innerHTML = result.orders
    .map(
      (order) => `
        <div class="report-order">
          <span class="report-order-no">${order.id.replace("ORD-", "NO.")}</span>
          <span>
            <strong>${order.name}</strong>
            <small>${order.verdict === "good" ? "全检通过" : order.issues[0]?.message || "未完成"}</small>
          </span>
          <span class="verdict ${order.verdict}">${order.verdict === "good" ? "良品" : "废品"}</span>
        </div>
      `
    )
    .join("");

  $("#report-reasons").innerHTML = result.downtimeReasons.length
    ? result.downtimeReasons.map((reason) => `<div class="reason-item">${reason}</div>`).join("")
    : '<div class="reason-item ok">本批次无停机，设备按节拍连续运行</div>';

  $("#report-exceptions").innerHTML = result.exceptions.length
    ? result.exceptions
        .map(
          (exception) => `
            <div class="reason-item ${exception.status === "resolved" ? "ok" : ""}">
              ${exception.id} · ${exception.equipment} · ${exception.trigger}
              ${exception.recovery?.passed ? " · 3.0s 复检无残留" : ""}
            </div>
          `
        )
        .join("")
    : '<div class="reason-item ok">无异常处理记录</div>';
  if (!dialog.open) dialog.showModal();
}

function showComparison() {
  const pair = currentSnapshotId ? engine.getComparison(currentSnapshotId) : null;
  if (!pair) {
    toast("需要快照基准批次与至少一个后续完成批次", "error");
    return;
  }
  const { base, current, snapshot } = pair;
  $("#compare-grid").innerHTML = [
    comparisonColumn(base, `快照基准 · ${snapshot.id}`, "BASE", snapshot.capturedLabel),
    comparisonColumn(current, "最新复跑", "CURRENT", current.endedLabel, base)
  ].join("");
  const dialog = $("#compare-dialog");
  if (!dialog.open) dialog.showModal();
}

function comparisonColumn(batch, title, tag, timestamp, baseline = null) {
  const delta = (value, baseValue, invert = false) => {
    if (baseline === null) return "";
    const diff = Math.round((value - baseValue) * 100) / 100;
    if (Math.abs(diff) < 0.001) return '<span class="compare-delta">±0</span>';
    const good = invert ? diff < 0 : diff > 0;
    return `<span class="compare-delta ${good ? "up" : "down"}">${diff > 0 ? "+" : ""}${diff}</span>`;
  };
  const orders = batch.orders
    .map(
      (order) => `
        <div class="compare-row">
          <span>${order.id} ${order.name}</span>
          <b class="${order.verdict === "waste" ? "bad" : ""}">${order.verdict === "good" ? "良品" : "废品"}</b>
        </div>
      `
    )
    .join("");
  const exceptions = batch.exceptions.length
    ? batch.exceptions
        .map(
          (exception) => `
            <div class="compare-row">
              <span>${exception.equipment} · ${exception.trigger}</span>
              <b class="${exception.recovery?.passed ? "" : "bad"}">${exception.recovery?.passed ? "3.0s复检通过" : "已复位"}</b>
            </div>
          `
        )
        .join("")
    : '<div class="compare-row"><span>本批次无异常处理记录</span><b>—</b></div>';
  const reasons = batch.downtimeReasons.length
    ? batch.downtimeReasons
        .map((reason) => `<div class="compare-row"><span>${reason}</span><b>停机</b></div>`)
        .join("")
    : '<div class="compare-row"><span>连续运行，无停机</span><b>0</b></div>';
  return `
    <article class="compare-column">
      <div class="compare-column-head">
        <span>${tag} · ${timestamp}</span>
        <h3>${title}</h3>
        <small>BATCH ${batch.id} · ${batch.good}/8 良品</small>
      </div>
      <div class="compare-stats">
        <div class="compare-stat"><span>良品</span><strong>${batch.good}${baseline ? delta(batch.good, baseline.good) : ""}</strong></div>
        <div class="compare-stat"><span>废品</span><strong>${batch.waste}${baseline ? delta(batch.waste, baseline.waste, true) : ""}</strong></div>
        <div class="compare-stat"><span>峰值功耗</span><strong>${batch.peakPower.toFixed(2)}${baseline ? delta(batch.peakPower, baseline.peakPower, true) : ""}</strong></div>
        <div class="compare-stat"><span>异常次数</span><strong>${batch.exceptions.length}${baseline ? delta(batch.exceptions.length, baseline.exceptions.length, true) : ""}</strong></div>
      </div>
      <div class="compare-list">
        <h4>订单判定 · 只读</h4>
        ${orders}
        <h4>停机原因</h4>
        ${reasons}
        <h4>异常处理记录</h4>
        ${exceptions}
      </div>
    </article>
  `;
}

function showHistory() {
  const list = $("#history-list");
  if (!engine.completedBatches.length) {
    list.innerHTML =
      '<div class="empty-log" style="height:140px">暂无已冻结批次<br>完成一个批次后可在此查看只读报告</div>';
  } else {
    list.innerHTML = [...engine.completedBatches]
      .reverse()
      .map(
        (batch) => `
          <div class="history-row">
            <span>${batch.endedLabel}</span>
            <span>
              <strong>BATCH ${batch.id} · ${batch.good} 良品 / ${batch.waste} 废品</strong>
              <small>峰值 ${batch.peakPower.toFixed(2)} kW · ${batch.downtimeReasons.length} 次停机 · 数据只读</small>
            </span>
            <button class="button button-outline history-view" type="button" data-batch-id="${batch.id}">查看报告</button>
          </div>
        `
      )
      .join("");
    $$(".history-view", list).forEach((button) => {
      button.addEventListener("click", () => {
        const result = engine.completedBatches.find((batch) => batch.id === button.dataset.batchId);
        $("#history-dialog").close();
        showReport(result);
      });
    });
  }
  const dialog = $("#history-dialog");
  if (!dialog.open) dialog.showModal();
}

function toast(message, type = "info") {
  const stack = $("#toast-stack");
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : ""}`;
  element.textContent = message;
  stack.appendChild(element);
  setTimeout(() => {
    element.style.opacity = "0";
    element.style.transform = "translateY(6px)";
    setTimeout(() => element.remove(), 220);
  }, 3000);
}

initialize();
