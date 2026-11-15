import {
  GreenhouseSim,
  SCENARIOS,
  RECOVERY_THRESHOLDS,
  IDEAL_TEMP,
  formatClock,
  formatDuration,
} from "./sim.js";
import { GreenhouseRenderer } from "./render.js";
import { GreenhouseAudio } from "./audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const elements = {
  canvas: $("scene"),
  seedChip: $("seedChip"),
  seedInput: $("seedInput"),
  weatherChip: $("weatherChip"),
  weatherLabel: $("weatherLabel"),
  runStatus: $("runStatus"),
  pauseButton: $("pauseButton"),
  pauseIcon: $("pauseIcon"),
  pauseLabel: $("pauseLabel"),
  audioButton: $("audioButton"),
  dayLabel: $("dayLabel"),
  clockValue: $("clockValue"),
  clockPhase: $("clockPhase"),
  dayProgressBar: $("dayProgressBar"),
  tempCard: $("tempCard"),
  tempZone: $("tempZone"),
  tempValue: $("tempValue"),
  tempMarker: $("tempMarker"),
  tempSpark: $("tempSpark"),
  activeBeeLabel: $("activeBeeLabel"),
  activityValue: $("activityValue"),
  activityTrend: $("activityTrend"),
  activityBar: $("activityBar"),
  healthCard: $("healthCard"),
  colonyLabel: $("colonyLabel"),
  healthValue: $("healthValue"),
  healthDot: $("healthDot"),
  healthBar: $("healthBar"),
  pollenCard: $("pollenCard"),
  pollenRate: $("pollenRate"),
  pollenValue: $("pollenValue"),
  pollenTrend: $("pollenTrend"),
  pollenBar: $("pollenBar"),
  costLabel: $("costLabel"),
  budgetValue: $("budgetValue"),
  budgetTrend: $("budgetTrend"),
  releaseInput: $("releaseInput"),
  releaseOutput: $("releaseOutput"),
  thermostatInput: $("thermostatInput"),
  thermostatOutput: $("thermostatOutput"),
  shadeInput: $("shadeInput"),
  shadeOutput: $("shadeOutput"),
  fanOutput: $("fanOutput"),
  doseRisk: $("doseRisk"),
  frameTitle: $("frameTitle"),
  sunChip: $("sunChip"),
  targetBeeChip: $("targetBeeChip"),
  speedChip: $("speedChip"),
  couplingValue: $("couplingValue"),
  couplingHint: $("couplingHint"),
  weatherSequence: $("weatherSequence"),
  weatherCountdown: $("weatherCountdown"),
  latestOperation: $("latestOperation"),
  operationIcon: $("operationIcon"),
  operationEyebrow: $("operationEyebrow"),
  operationText: $("operationText"),
  operationDelta: $("operationDelta"),
  eventList: $("eventList"),
  thresholdBadge: $("thresholdBadge"),
  boostRecovery: $("boostRecovery"),
  ecologyRecovery: $("ecologyRecovery"),
  recoveryResult: $("recoveryResult"),
  sequenceHash: $("sequenceHash"),
  toast: $("toast"),
  resultDialog: $("resultDialog"),
  resultSeal: $("resultSeal"),
  resultEyebrow: $("resultEyebrow"),
  resultTitle: $("resultTitle"),
  resultBody: $("resultBody"),
  resultStats: $("resultStats"),
  speedSelect: $("speedSelect"),
};

const renderer = new GreenhouseRenderer(elements.canvas);
const audio = new GreenhouseAudio();
let sim = new GreenhouseSim("20261116");
let speed = 1;
let scenarioKey = null;
let selectedDose = 1;
let lastTimestamp = performance.now();
let lastUiUpdate = 0;
let lastEventId = 0;
let lastEndedHash = null;
let toastTimer = null;
let lastSparkSignature = "";
let lastAuditSignature = "";
let lastRenderedEventCount = -1;

function resetRuntime(instance, nextScenario = null) {
  sim = instance;
  scenarioKey = nextScenario;
  renderer.reset(sim);
  lastEventId = sim.events.at(-1)?.id || 0;
  lastEndedHash = null;
  lastSparkSignature = "";
  lastAuditSignature = "";
  lastRenderedEventCount = -1;
  selectedDose = 1;
  document.querySelectorAll("#doseControl button").forEach((button) => {
    button.classList.toggle("active", button.dataset.dose === "1");
  });
  updateDoseRisk();
  syncControls();
  setScenarioActive();
  if (elements.resultDialog.open) elements.resultDialog.close();
  updateUI(true);
}

function syncControls() {
  elements.releaseInput.value = sim.controls.releaseHour;
  elements.thermostatInput.value = sim.controls.thermostat;
  elements.shadeInput.value = sim.controls.shade;
  elements.releaseOutput.textContent = formatClock(sim.controls.releaseHour * 60);
  elements.thermostatOutput.textContent = `${sim.controls.thermostat.toFixed(1)}°C`;
  elements.shadeOutput.textContent = `${Math.round(sim.controls.shade)}%`;
  elements.fanOutput.textContent = sim.controls.fan === 0 ? "关闭" : sim.controls.fan === 1 ? "自动 · 1 档" : "强风 · 2 档";
  document.querySelectorAll("#fanControl button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.fan) === sim.controls.fan);
  });
  const replaying = sim.replayMode;
  [
    elements.releaseInput,
    elements.thermostatInput,
    elements.shadeInput,
    elements.seedInput,
    $("applySeedButton"),
  ].forEach((element) => {
    element.disabled = replaying;
  });
  document.querySelectorAll("#fanControl button, #doseControl button, #scenarioList button").forEach((button) => {
    button.disabled = replaying;
  });
}

function setScenarioActive() {
  document.querySelectorAll("#scenarioList button").forEach((button) => {
    button.classList.toggle("active", button.dataset.scenario === scenarioKey);
  });
}

function updateDoseRisk() {
  elements.doseRisk.textContent = selectedDose === 1 ? "规范剂量" : selectedDose === 1.6 ? "亚致死风险" : "危险 · 超量";
  elements.doseRisk.classList.toggle("danger", selectedDose > 1);
}

function showToast(message, tone = "neutral") {
  if (toastTimer) clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast show ${tone}`;
  toastTimer = setTimeout(() => {
    elements.toast.className = "toast";
  }, 3600);
}

function setPaused(nextPaused) {
  if (sim.ended) return;
  sim.running = !nextPaused;
  elements.runStatus.textContent = nextPaused ? "已暂停" : "运行中";
  elements.runStatus.classList.toggle("paused", nextPaused);
  elements.frameTitle.textContent = nextPaused ? "温室 04 · 模拟已暂停" : "温室 04 · 授粉进行中";
  elements.pauseIcon.textContent = nextPaused ? "▶" : "Ⅱ";
  elements.pauseLabel.textContent = nextPaused ? "继续" : "暂停";
}

function togglePause() {
  if (sim.ended) return;
  setPaused(sim.running);
}

function startScenario(key) {
  const config = SCENARIOS[key];
  if (!config) return;
  const instance = new GreenhouseSim(config.seed, { scenario: key });
  Object.entries(config.controls).forEach(([control, value]) => {
    instance.setControl(control, value, { record: true });
  });
  config.script.forEach((action) => {
    instance.actions.push({
      at: action.at,
      kind: action.kind,
      payload: { ...action.payload },
    });
  });
  instance.queueScript(config.script);
  resetRuntime(instance, key);
  showToast(`${config.label}已载入：seed ${config.seed}，${config.script.length ? `${config.script.length} 个自动操作已排程` : "从当前环境开始观察"}。`);
}

function restartSameSeed() {
  const next = new GreenhouseSim(sim.seed);
  resetRuntime(next, null);
  showToast(`同 seed ${sim.seed} 重开：目标个体、天气序列与初始资源已复原。`, "success");
}

function replayFixedSequence() {
  const source = sim.actions.length ? sim.actions : sim.replaySource || [];
  const nextScenario = scenarioKey;
  if (source.length === 0) {
    showToast("本轮没有可重放的显式操作；将按同 seed 和默认配置重开。");
  }
  const instance = new GreenhouseSim(sim.seed);
  instance.scenario = nextScenario;
  instance.loadReplay(sim.seed, source);
  instance.scenario = nextScenario;
  resetRuntime(instance, nextScenario);
  showToast(`固定序列复现启动：${source.length} 个操作按原模拟时间依次注入。`, "success");
}

function setTrend(element, text, tone = "neutral") {
  element.textContent = text;
  element.className = `trend ${tone}`;
}

function drawTemperatureSpark() {
  const history = sim.temperatureHistory.slice(-18);
  if (history.length < 2) return;
  const signature = `${history.length}:${Math.round(history[history.length - 1].at)}:${history
    .at(-1)
    .value.toFixed(1)}:${sim.temperature.toFixed(2)}`;
  if (signature === lastSparkSignature) return;
  lastSparkSignature = signature;
  const width = 48;
  const height = 17;
  const min = 15;
  const max = 37;
  const points = history
    .map((point, index) => {
      const x = (index / (history.length - 1)) * width;
      const y = height - clamp((point.value - min) / (max - min), 0, 1) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = sim.temperature > 31 ? "#ed6d62" : sim.temperature > 28 ? "#f1bc63" : "#b9d98a";
  elements.tempSpark.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function renderEvents(force = false) {
  if (!force && lastRenderedEventCount === sim.events.length) return;
  lastRenderedEventCount = sim.events.length;
  elements.eventList.replaceChildren();
  const events = sim.events.slice(-18).reverse();
  for (const event of events) {
    const row = document.createElement("li");
    const severityClass =
      event.severity === "danger" ? "critical" : event.severity === "warning" ? "critical" : "";
    row.className = `event-row ${event.kind === "operation" ? "operation" : ""} ${
      event.kind === "recovery" ? "recovery" : ""
    } ${severityClass}`;
    const time = document.createElement("time");
    time.textContent = event.clock;
    const title = document.createElement("strong");
    title.textContent = event.title;
    const detail = document.createElement("small");
    detail.textContent = event.detail || "—";
    row.append(time, title, detail);
    elements.eventList.append(row);
  }
}

function renderRecovery() {
  const canRecover = sim.recoveryTriggered && !sim.ended;
  elements.thresholdBadge.textContent = canRecover ? "已触发" : sim.ended ? "实验结束" : "未触发";
  elements.thresholdBadge.classList.toggle("active", canRecover);
  elements.boostRecovery.disabled = !canRecover || sim.budget < 52 || sim.replayMode;
  elements.ecologyRecovery.disabled = !canRecover || sim.budget < 18 || sim.replayMode;
  document.querySelectorAll(".recovery-card").forEach((card) => {
    card.classList.toggle("ready", canRecover);
    card.classList.toggle(
      "used",
      sim.recoveries.some((recovery) => recovery.strategy === card.dataset.recovery),
    );
  });

  if (sim.recoveries.length === 0) {
    elements.recoveryResult.hidden = true;
    return;
  }
  const latest = sim.recoveries.at(-1);
  elements.recoveryResult.hidden = false;
  const label = latest.strategy === "boost" ? "A · 应急补蜂" : "B · 生态稳控";
  if (latest.after) {
    elements.recoveryResult.innerHTML = "";
    const heading = document.createElement("span");
    heading.textContent = `最近恢复评估 · ${label} · ¥${latest.cost}`;
    const body = document.createElement("b");
    body.textContent = `触发「${latest.trigger}」 → 健康 ${latest.after.health.toFixed(0)} / 工蜂 ${latest.after.population.toFixed(0)} / 坐果 ${latest.after.fruits}/3 / ${latest.after.clock}`;
    elements.recoveryResult.append(heading, body);
  } else {
    elements.recoveryResult.innerHTML = "";
    const heading = document.createElement("span");
    heading.textContent = `恢复评估进行中 · ${label} · ¥${latest.cost}`;
    const body = document.createElement("b");
    body.textContent = `触发「${latest.trigger}」 · 预计 ${formatDuration(latest.due - sim.minutes)} 后记录最终指标`;
    elements.recoveryResult.append(heading, body);
  }
}

function updateUI(force = false) {
  const metrics = sim.metrics();
  const weather = sim.weatherAt(sim.minutes);
  const releaseMinutes = sim.controls.releaseHour * 60;
  const beforeRelease = sim.minutes < releaseMinutes;
  const afterWindow = sim.minutes >= 17 * 60 + 30;

  elements.seedChip.textContent = `SEED ${sim.seed}`;
  elements.seedInput.value = sim.seed;
  elements.clockValue.textContent = metrics.clock;
  elements.dayLabel.textContent = `第 1 天 · ${formatDuration(sim.minutes - 360)}`;
  elements.dayProgressBar.style.width = `${clamp(((sim.minutes - 360) / 720) * 100, 0, 100)}%`;
  setTrend(
    elements.clockPhase,
    sim.ended ? "实验结束" : beforeRelease ? "放蜂前" : afterWindow ? "归巢期" : "授粉窗口",
    sim.ended ? "neutral" : beforeRelease ? "neutral" : "up",
  );

  elements.tempValue.textContent = metrics.temperature.toFixed(1);
  const hot = metrics.temperature > RECOVERY_THRESHOLDS.temperature;
  const warm = metrics.temperature > IDEAL_TEMP.max;
  const cold = metrics.temperature < 19;
  elements.tempZone.textContent = hot ? "热临界" : warm ? "偏热区" : cold ? "低温区" : "舒适区";
  elements.tempCard.classList.toggle("alert", hot || cold);
  elements.tempCard.classList.toggle("warning", warm && !hot);
  elements.tempMarker.style.left = `${clamp(((metrics.temperature - 15) / 22) * 100, 0, 100)}%`;
  drawTemperatureSpark();

  elements.activityValue.textContent = Math.round(metrics.activity);
  elements.activeBeeLabel.textContent = `${Math.round(metrics.activeBees)} / ${Math.round(metrics.population)} 出巢`;
  elements.activityBar.style.width = `${clamp(metrics.activity, 0, 100)}%`;
  setTrend(
    elements.activityTrend,
    beforeRelease ? "等待放蜂" : sim.ended ? "采集结束" : metrics.activity > 48 ? "活跃采集" : metrics.activity > 20 ? "低效访花" : "活跃度不足",
    metrics.activity > 48 ? "up" : metrics.activity < 20 && !beforeRelease ? "warn" : "neutral",
  );

  elements.healthValue.textContent = Math.round(metrics.health);
  elements.colonyLabel.textContent = `${metrics.population.toFixed(0)} 只工蜂`;
  elements.healthBar.style.width = `${clamp(metrics.health, 0, 100)}%`;
  elements.healthDot.style.background = hot || metrics.health < 60 ? "var(--red)" : metrics.health < 75 ? "var(--amber)" : "var(--green)";
  elements.healthDot.style.boxShadow = hot || metrics.health < 60 ? "0 0 10px rgba(237,109,98,.55)" : "0 0 10px rgba(185,217,138,.5)";
  elements.healthCard.classList.toggle("alert", metrics.health < 60);
  elements.healthCard.classList.toggle("warning", metrics.health >= 60 && metrics.health < 75);

  elements.pollenValue.textContent = metrics.pollen.toFixed(0);
  elements.pollenBar.style.width = `${clamp(metrics.pollen, 0, 100)}%`;
  elements.pollenRate.textContent = `消耗 ${sim.lastPollenRate.toFixed(2)} /min`;
  setTrend(elements.pollenTrend, metrics.pollen < 20 ? "低位警戒" : metrics.pollen < 35 ? "储备偏低" : "储备稳定", metrics.pollen < 20 ? "down" : "neutral");
  elements.pollenCard.classList.toggle("warning", metrics.pollen < 20);

  elements.budgetValue.textContent = metrics.budget;
  elements.costLabel.textContent = `已用 ¥${metrics.spent}`;
  setTrend(elements.budgetTrend, metrics.budget >= 36 ? "可执行 2 次协议" : metrics.budget >= 18 ? "可执行 1 次协议" : "预算紧张", metrics.budget < 18 ? "down" : "neutral");
  const tickCount = 10;
  const spentTicks = Math.round((metrics.spent / Math.max(sim.initialResources.budget, 1)) * tickCount);
  elements.budgetValue
    .closest(".budget-card")
    .querySelectorAll(".budget-ticks i")
    .forEach((tick, index) => {
      tick.classList.toggle("spent", index >= tickCount - spentTicks);
    });

  elements.weatherLabel.textContent = `${weather.label} · 风 ${sim.wind.toFixed(1)} m/s`;
  elements.weatherChip.querySelector(".weather-icon").textContent = sim.cloud > 0.6 ? "☁" : sim.cloud > 0.35 ? "☼" : "☀";
  elements.weatherSequence.textContent = weather.sequence.join(" → ");
  elements.weatherCountdown.textContent = `下次变化 ${formatDuration(weather.nextChange)}`;
  elements.sunChip.textContent = `光照 ${Math.round(sim.light)} lux`;
  elements.targetBeeChip.textContent = `追踪蜂 #${sim.trackedBee.id}`;
  elements.speedChip.textContent = `${speed}×`;
  elements.couplingValue.textContent = (
    (sim.activeBees / 38) *
    (0.45 + sim.pollen / 100) *
    (hot ? 0.42 : cold ? 0.25 : 1)
  ).toFixed(2);
  elements.couplingHint.textContent = `光照 ${Math.round(sim.light)} lux · 花粉 ${Math.round(sim.pollen)}% · 风 ${sim.wind.toFixed(1)} m/s`;

  elements.operationEyebrow.textContent = `${sim.ended ? "实验结束" : "最近操作"} · ${formatClock(sim.lastOperation.at)}`;
  elements.operationText.textContent = sim.lastOperation.title;
  elements.operationDelta.textContent = sim.lastOperation.delta;
  elements.operationIcon.textContent = sim.lastOperation.icon;
  elements.latestOperation.className = `latest-operation ${
    sim.lastOperation.tone === "danger" ? "danger" : sim.lastOperation.tone === "warning" ? "warning" : ""
  }`;

  elements.pauseButton.disabled = sim.ended;
  elements.pauseIcon.textContent = sim.running ? "Ⅱ" : "▶";
  elements.pauseLabel.textContent = sim.running ? "暂停" : "继续";
  elements.runStatus.textContent = sim.ended ? (sim.result?.success ? "任务完成" : "任务失败") : sim.running ? (sim.replayMode ? "序列复现" : "运行中") : "已暂停";
  elements.runStatus.classList.toggle("paused", !sim.running && !sim.ended);
  elements.frameTitle.textContent = sim.ended
    ? sim.result?.success
      ? "温室 04 · 三畦作物全部坐果"
      : "温室 04 · 实验结束"
    : !sim.running
      ? "温室 04 · 模拟已暂停"
      : hot
        ? "温室 04 · 热临界观察"
        : "温室 04 · 授粉进行中";

  renderEvents(force);
  renderRecovery();
  const auditSignature = `${sim.events.length}:${Math.round(sim.minutes)}:${sim.actions.length}`;
  if (force || auditSignature !== lastAuditSignature) {
    lastAuditSignature = auditSignature;
    elements.sequenceHash.textContent = sim.sequenceHash();
  }
}

function processNewEvents() {
  const updates = sim.events.filter((event) => event.id > lastEventId);
  if (updates.length === 0) return;
  lastEventId = updates.at(-1).id;
  const important = updates.find(
    (event) => event.kind === "critical" || event.kind === "recovery" || event.kind === "failure" || event.kind === "success",
  );
  if (important) {
    showToast(
      `${important.clock} ${important.title}：${important.detail}`,
      important.severity === "danger" ? "danger" : important.severity === "success" ? "success" : "neutral",
    );
  }
}

function showResult() {
  if (!sim.result) return;
  const key = `${sim.result.seed}:${sim.result.success}:${sim.result.clock}:${sim.sequenceHash()}`;
  if (key === lastEndedHash) return;
  lastEndedHash = key;
  updateUI(true);
  const result = sim.result;
  elements.resultDialog.classList.toggle("failure", !result.success);
  elements.resultSeal.textContent = result.success ? "✓" : "×";
  elements.resultEyebrow.textContent = result.success ? "EXPERIMENT COMPLETE" : "EXPERIMENT TERMINATED";
  elements.resultTitle.textContent = result.success ? "三块作物全部坐果" : "实验未能达成任务";
  elements.resultBody.textContent = result.reason;
  elements.resultStats.replaceChildren();
  const stats = [
    ["结束时间", result.clock],
    ["蜂群健康", `${Math.round(result.metrics.health)} / 100`],
    ["存活工蜂", `${Math.round(result.metrics.population)} 只`],
    ["完成坐果", `${result.metrics.fruits} / 3`],
    ["剩余花粉", `${Math.round(result.metrics.pollen)}%`],
    ["剩余预算", `¥${result.metrics.budget}`],
  ];
  stats.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "result-stat";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("b");
    number.textContent = value;
    item.append(name, number);
    elements.resultStats.append(item);
  });
  if (!elements.resultDialog.open) elements.resultDialog.showModal();
  audio.complete(result.success);
}

function performSpray() {
  if (sim.ended || sim.replayMode) return;
  const result = sim.perform("spray", { dose: selectedDose });
  if (!result.ok) {
    showToast(result.message, "danger");
    return;
  }
  audio.spray(selectedDose);
  updateUI(true);
  showToast(
    selectedDose > 1
      ? `超量喷药已执行：工蜂 ${result.before.population.toFixed(0)} → ${result.after.population.toFixed(0)}，健康 ${result.before.health.toFixed(0)} → ${result.after.health.toFixed(0)}。`
      : "规范喷药已执行，毒性残留保持在低水平。",
    selectedDose > 1 ? "danger" : "neutral",
  );
}

function performRecovery(strategy) {
  if (sim.ended || sim.replayMode) return;
  const result = sim.perform("recovery", { strategy });
  if (!result.ok) {
    showToast(result.message, "danger");
    return;
  }
  syncControls();
  updateUI(true);
  showToast(
    strategy === "boost"
      ? "策略 A 已执行：立即补充 12 只工蜂，代价 ¥52 + 12% 花粉。"
      : "策略 B 已执行：降低温控与光照负荷，90 分钟内缓慢修复，代价 ¥18。",
    "success",
  );
}

function exportRecord() {
  const payload = sim.exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `greenhouse-bees-${sim.seed}-${sim.sequenceHash()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast(`实验记录已导出，序列指纹 ${sim.sequenceHash()}。`, "success");
}

const sliderBindings = [
  {
    input: elements.releaseInput,
    key: "releaseHour",
    format: (value) => formatClock(value * 60),
  },
  {
    input: elements.thermostatInput,
    key: "thermostat",
    format: (value) => `${value.toFixed(1)}°C`,
  },
  {
    input: elements.shadeInput,
    key: "shade",
    format: (value) => `${Math.round(value)}%`,
  },
];

sliderBindings.forEach(({ input, key, format }) => {
  const output = key === "releaseHour" ? elements.releaseOutput : key === "thermostat" ? elements.thermostatOutput : elements.shadeOutput;
  input.addEventListener("input", () => {
    if (sim.replayMode) return;
    const value = Number(input.value);
    sim.setControl(key, value, { record: false });
    output.textContent = format(value);
  });
  input.addEventListener("change", () => {
    if (sim.replayMode) return;
    sim.recordAction("control", { key, value: Number(input.value) });
    showToast(`${input.closest(".control-group").querySelector(".control-label span").textContent}已记录为序列操作。`);
  });
});

document.querySelectorAll("#fanControl button").forEach((button) => {
  button.addEventListener("click", () => {
    if (sim.replayMode || sim.ended) return;
    sim.setControl("fan", Number(button.dataset.fan), { record: true });
    syncControls();
    updateUI(true);
  });
});

document.querySelectorAll("#doseControl button").forEach((button) => {
  button.addEventListener("click", () => {
    if (sim.replayMode || sim.ended) return;
    selectedDose = Number(button.dataset.dose);
    document.querySelectorAll("#doseControl button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    updateDoseRisk();
  });
});

elements.sprayButton = $("sprayButton");
elements.sprayButton.addEventListener("click", performSpray);
$("ventButton").addEventListener("click", () => {
  if (sim.ended || sim.replayMode) return;
  const result = sim.perform("vent");
  if (!result.ok) return showToast(result.message, "danger");
  updateUI(true);
  showToast("通风已开启：热平衡目标下降 2.2°C，持续 15 分钟。");
});
$("feedButton").addEventListener("click", () => {
  if (sim.ended || sim.replayMode) return;
  const result = sim.perform("feed");
  if (!result.ok) return showToast(result.message, "danger");
  updateUI(true);
  showToast(`花粉库存补充至 ${Math.round(sim.pollen)}%，预算剩余 ¥${sim.budget}。`);
});

elements.boostRecovery.addEventListener("click", () => performRecovery("boost"));
elements.ecologyRecovery.addEventListener("click", () => performRecovery("ecology"));
elements.pauseButton.addEventListener("click", togglePause);
$("restartButton").addEventListener("click", restartSameSeed);
$("fixedReplayButton").addEventListener("click", replayFixedSequence);
$("exportButton").addEventListener("click", exportRecord);

document.querySelectorAll("#scenarioList button").forEach((button) => {
  button.addEventListener("click", () => startScenario(button.dataset.scenario));
});

$("applySeedButton").addEventListener("click", () => {
  if (sim.replayMode) return;
  const clean = elements.seedInput.value.trim().replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 12) || "20261116";
  const instance = new GreenhouseSim(clean);
  resetRuntime(instance, null);
  showToast(
    `seed ${clean} 已载入：目标蜂 #${sim.trackedBee.id}，预算 ¥${sim.initialResources.budget}，花粉 ${sim.initialResources.pollen}%，工蜂 ${sim.initialResources.population} 只。`,
    "success",
  );
});

elements.seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("applySeedButton").click();
});

elements.audioButton.addEventListener("click", async () => {
  try {
    const enabled = await audio.toggle();
    elements.audioButton.setAttribute("aria-pressed", String(enabled));
    showToast(enabled ? "Web Audio 已开启：蜂鸣随活跃度变化，风机声随档位变化。" : "声音已关闭。");
  } catch {
    showToast("浏览器未能启动 Web Audio。", "danger");
  }
});

elements.speedSelect.addEventListener("change", () => {
  speed = Number(elements.speedSelect.value);
  elements.speedChip.textContent = `${speed}×`;
});

$("resultRestart").addEventListener("click", () => {
  elements.resultDialog.close();
  restartSameSeed();
});
$("resultClose").addEventListener("click", () => elements.resultDialog.close());

document.addEventListener("keydown", (event) => {
  if (event.target.closest("input, select, textarea, button")) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key.toLowerCase() === "r") {
    restartSameSeed();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && sim.running && !sim.ended) {
    setPaused(true);
    showToast("页面转入后台，模拟已自动暂停。");
  }
});

function frame(timestamp) {
  const realSeconds = Math.min(0.2, Math.max(0, (timestamp - lastTimestamp) / 1000));
  lastTimestamp = timestamp;
  if (sim.running && !sim.ended) sim.advance(realSeconds, speed);
  renderer.update(sim, realSeconds, speed);
  renderer.draw(sim);
  audio.update(sim);
  processNewEvents();
  if (timestamp - lastUiUpdate > 80) {
    updateUI();
    lastUiUpdate = timestamp;
  }
  if (sim.ended) showResult();
  requestAnimationFrame(frame);
}

syncControls();
updateUI(true);
renderer.draw(sim);
requestAnimationFrame((timestamp) => {
  lastTimestamp = timestamp;
  frame(timestamp);
});
