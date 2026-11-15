import { FishwaySim, SPECIES, RECOVERY_PLANS, fishSuitability, hashSeed } from "./sim.js";
import { SceneRenderer } from "./render.js";
import { WaterAudio } from "./audio.js";

const FIXED_DT = 0.1;
const FIXED_MS = FIXED_DT * 1000;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pad = (value) => String(value).padStart(2, "0");
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const weatherGlyph = {
  sun: "☼",
  cloud: "☁",
  rain: "╱",
  mist: "≋",
  sunCloud: "◒",
};

const outcomeLabels = {
  stable: "稳态完成",
  critical: "临界状态",
  failure: "失败操作",
  observing: "观察中",
  neutral: "等待操作",
};

const initialSeed = new URLSearchParams(location.search).get("seed") || "FISHWAY-2026";
const sim = new FishwaySim(initialSeed);
const renderer = new SceneRenderer($("#scene"), sim);
const audio = new WaterAudio();
const runtime = {
  paused: false,
  step: 0,
  accumulator: 0,
  lastFrame: performance.now(),
  lastUi: 0,
  inputLog: [],
  replay: null,
  seenCompleted: new Set(),
  desiredControls: { ...sim.controls },
  drawerTab: "operations",
  lastPauseToast: 0,
  lastReplayStatus: null,
  speed: 1,
};

$("#seed-input").value = sim.seed;

function setFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}

function syncControlInputs() {
  runtime.desiredControls = { ...sim.controls };
  for (const key of ["gate", "vane", "lamp"]) {
    const input = $(`#${key}`);
    input.value = sim.controls[key];
    $(`#${key}-value`).textContent = `${sim.controls[key]}%`;
    setFill(input);
  }
}

function readControlInputs() {
  return {
    gate: Number($("#gate").value),
    vane: Number($("#vane").value),
    lamp: Number($("#lamp").value),
  };
}

function toast(message, type = "info", duration = 3000) {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toast-stack").append(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(5px)";
    setTimeout(() => node.remove(), 220);
  }, duration);
}

function formatSigned(value, digits = 1) {
  const rounded = Number(value).toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function changeClass(value) {
  if (value > 0.04) return "up";
  if (value < -0.04) return "down";
  return "flat";
}

function getActiveTargetGroup() {
  const groups = sim.getGroups();
  return groups.find((group) => !group.completed) || groups[0];
}

function addInputEvent(action) {
  if (runtime.replay) return;
  runtime.inputLog.push({
    ...action,
    step: runtime.step,
    at: Number(sim.time.toFixed(1)),
  });
}

async function toggleSound(force) {
  const enabled = force ?? !audio.enabled;
  if (enabled) {
    try {
      await audio.enable();
    } catch {
      toast("浏览器未允许音频上下文，请再次点击声音按钮", "warning");
      return;
    }
  } else {
    audio.disable();
  }
  $("#sound-btn").classList.toggle("active", audio.enabled);
  $("#audio-state").textContent = audio.enabled ? "水声开启" : "静音";
}

function togglePause(force) {
  runtime.paused = force ?? !runtime.paused;
  $("#pause-overlay").hidden = !runtime.paused;
  $("#pause-btn").classList.toggle("active", runtime.paused);
  $("#pause-icon").textContent = runtime.paused ? "▶" : "Ⅱ";
  $("#pause-label").textContent = runtime.paused ? "继续" : "暂停";
  $("#run-state").textContent = runtime.paused ? "已暂停" : runtime.replay ? "回放中" : "运行中";
  if (audio.enabled) audio.update(sim.environment.flow, runtime.paused);
}

function cycleSpeed() {
  runtime.speed = runtime.speed === 1 ? 2 : runtime.speed === 2 ? 4 : 1;
  $("#speed-btn").textContent = `${runtime.speed}×`;
  toast(`模拟推进速度切换为 ${runtime.speed}×（固定步长不变）`, "info", 1800);
}

function applyControls() {
  if (runtime.replay) {
    toast("回放期间不可修改输入", "warning");
    return;
  }
  const controls = readControlInputs();
  const label =
    controls.gate === sim.controls.gate && controls.vane === sim.controls.vane
      ? "鱼道照明调节"
      : controls.lamp === sim.controls.lamp
        ? "鱼道闸门与导流板调节"
        : "鱼道综合调节";
  sim.applyControls(controls, { label });
  addInputEvent({ type: "controls", controls });
  syncControlInputs();
  toast(`${label}已下发 · 进入 4.4 秒观察窗口`, "info", 2200);
  $("#apply-controls").disabled = true;
  setTimeout(() => {
    $("#apply-controls").disabled = false;
  }, 600);
  updateUI(true);
}

function performRecovery(kind) {
  if (runtime.replay) {
    toast("回放期间不可执行恢复策略", "warning");
    return;
  }
  const report = sim.startRecovery(kind);
  if (!report) {
    toast("资源不足，无法执行该恢复策略", "danger");
    return;
  }
  addInputEvent({ type: "recovery", kind });
  syncControlInputs();
  toast(`${report.name}已启动 · 预计 ${report.duration}s 完成`, "info");
  updateUI(true);
}

function renderSpeciesStrip() {
  const groups = sim.getGroups();
  const target = getActiveTargetGroup();
  $("#species-strip").innerHTML = groups
    .map((group) => {
      const status = group.completed
        ? "已完成"
        : group.moving
          ? `${group.moving} 尾上溯`
          : group.passed
            ? "部分通过"
            : "等待窗口";
      return `
        <article class="species-card ${group.completed ? "completed" : ""}" style="--species-color:${group.color}" title="推荐：${group.flow[0]}-${group.flow[1]} m/s · 水深 ${group.depth[0]}-${group.depth[1]} m · 光照 ${group.light[0]}-${group.light[1]}">
          <div class="species-icon">${group.code}</div>
          <div class="species-info">
            <div class="species-name"><b>${group.name}组</b><span>${group.latin}</span></div>
            <div class="species-targets">${group.fish.map((fish) => fish.id).join(" · ")}${group.key === target.key && !group.completed ? " ← 当前" : ""}</div>
          </div>
          <div class="species-progress">
            <strong>${group.passed}/3</strong>
            <span>${status}</span>
            <div class="species-dots">${[0, 1, 2].map((index) => `<i class="${index < group.passed ? "done" : ""}"></i>`).join("")}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTargetHud() {
  const target = getActiveTargetGroup();
  const dot = $(".fish-dot");
  dot.className = `fish-dot ${target.key}`;
  $(".target-fish b").textContent = `${target.name}组 · ${target.passed}/3`;
  const pendingFish = target.fish.find((fish) => fish.state !== "passed") || target.fish[0];
  const suitability = fishSuitability(pendingFish, sim.environment);
  const windows = {
    流速: `${target.flow[0]}–${target.flow[1]} m/s`,
    水深: `${target.depth[0]}–${target.depth[1]} m`,
    光照: `${Math.round(target.light[0] * 1000)}–${Math.round(target.light[1] * 1000)} lux`,
    落差: `≤ ${target.headMax} m`,
  };
  $(".target-fish small").textContent = `${pendingFish.id} · 瓶颈 ${suitability.limiting} ${windows[suitability.limiting]}`;
  $("#bio-label").textContent = sim.bio.label;
  $("#pass-count").textContent = `${sim.bio.passed} / 9 通过`;
}

function renderMetrics() {
  const env = sim.environment;
  $("#metric-flow").textContent = env.flow.toFixed(2);
  $("#metric-depth").textContent = env.depth.toFixed(2);
  $("#metric-head").textContent = env.head.toFixed(2);
  $("#metric-light").textContent = Math.round(env.light * 1000);
  $("#metric-oxygen").textContent = env.oxygen.toFixed(1);
  $("#metric-risk").textContent = Math.round(env.predatorRisk * 100);
  $("#metric-stress").textContent = sim.bio.averageStress.toFixed(1);
  $("#metric-temp").textContent = `${env.temperature.toFixed(1)}°C`;
  $("#eco-score").textContent = sim.ecoScore;
  $("#hud-flow").textContent = (env.flow * 3.6).toFixed(2);
  $("#bar-flow").style.width = `${clamp((env.flow / 1.8) * 100, 0, 100)}%`;
  $("#bar-depth").style.width = `${clamp((env.depth / 1.4) * 100, 0, 100)}%`;
  $("#bar-head").style.width = `${clamp((env.head / 2.55) * 100, 0, 100)}%`;
  $("#bar-light").style.width = `${clamp((env.light / 1.15) * 100, 0, 100)}%`;
  $("#bar-oxygen").style.width = `${clamp((env.oxygen / 10.2) * 100, 0, 100)}%`;
  $("#bar-risk").style.width = `${clamp(env.predatorRisk * 100, 0, 100)}%`;
  $("#resource-power").textContent = `${Math.round(sim.resources.power)}%`;
  $("#resource-water").textContent = `${Math.round(sim.resources.water)}%`;
  $("#bar-power").style.width = `${sim.resources.power}%`;
  $("#bar-water").style.width = `${sim.resources.water}%`;

  const cycle = sim.getCycle();
  $("#weather-icon").textContent = weatherGlyph[cycle.weather.icon] || "◒";
  $("#weather-label").textContent = cycle.weatherLabel;
  $("#clock-label").textContent = cycle.timeLabel;
  $(".data-pill .mono + small, .scene-pills .data-pill:nth-child(2) small").textContent = `DAY ${pad(cycle.day)}`;
  $("#event-signature").textContent = sim.getEventSignature();
  $("#footer-targets").textContent = sim.fish.length;
  $("#footer-weather-count").textContent = sim.weatherSequence.length;
  $("#footer-fingerprint").textContent = sim.fingerprint;

  const spark = $("#hud-spark");
  const recent = sim.history.slice(-18);
  spark.innerHTML = recent
    .map((sample) => {
      const height = 3 + clamp(sample.flow / 1.8, 0, 1) * 11;
      return `<i style="height:${height.toFixed(1)}px;opacity:${(0.28 + height / 23).toFixed(2)}"></i>`;
    })
    .join("");
}

function compareCell(label, before, after, delta, digits = 1) {
  return `
    <div class="compare-cell">
      <span>${label}</span>
      <b>${Number(before).toFixed(digits)} → ${Number(after).toFixed(digits)}</b>
      <small class="${changeClass(delta)}">${formatSigned(delta, digits)}</small>
    </div>
  `;
}

function renderLastOperation() {
  const operation = sim.operations.at(-1);
  const empty = $("#operation-empty");
  const result = $("#operation-result");
  const badge = $("#last-outcome");
  if (!operation) {
    empty.hidden = false;
    result.hidden = true;
    badge.textContent = "等待操作";
    badge.className = "outcome-badge neutral";
    return;
  }

  empty.hidden = true;
  result.hidden = false;
  const pending = operation.status === "observing";
  const after = operation.after || sim.capture();
  const before = operation.before;
  const outcome = pending ? "observing" : operation.outcome;
  badge.textContent = pending ? `观察中 ${Math.max(0, operation.dueAt - sim.time).toFixed(1)}s` : outcomeLabels[outcome];
  badge.className = `outcome-badge ${outcome}`;
  $("#op-id").textContent = operation.id;
  $("#op-title").textContent = operation.label;
  $("#op-reason").textContent = pending
    ? `正在观察鱼群响应：${sim.bio.label}，已通过 ${after.bio.passed} 尾。`
    : operation.reason;
  $("#op-duration").textContent = pending ? (sim.time - operation.at).toFixed(1) : operation.delta.time.toFixed(1);
  $("#op-config").textContent = `闸${operation.afterControls.gate}% · 板${operation.afterControls.vane}% · 灯${operation.afterControls.lamp}%`;
  $("#op-compare").innerHTML = [
    compareCell("上游库容 %", before.resources.water, after.resources.water, after.resources.water - before.resources.water),
    compareCell("电网电力 %", before.resources.power, after.resources.power, after.resources.power - before.resources.power),
    compareCell("平均应激", before.bio.averageStress, after.bio.averageStress, after.bio.averageStress - before.bio.averageStress),
    compareCell("生态评分", before.ecoScore, after.ecoScore, after.ecoScore - before.ecoScore, 0),
  ].join("");
}

function renderExperiments() {
  const byKind = {};
  for (const operation of sim.operations) {
    if (operation.outcome) byKind[operation.outcome] = operation;
  }
  for (const row of $$(".experiment-row")) {
    const kind = row.dataset.kind;
    const operation = byKind[kind];
    row.classList.toggle("done", Boolean(operation));
    $(".matrix-mark", row).textContent = operation ? "●" : "○";
    $("strong", row).textContent = operation ? `${outcomeLabels[kind]} · ${operation.id}` : "待完成";
  }
  const recent = sim.events.at(-1);
  $("#event-ticker").textContent = recent ? `${recent.at.toFixed(1)}s · ${recent.message}` : "等待关键事件…";
}

function renderTriggerAndRecovery() {
  const trigger = sim.getTrigger();
  $("#trigger-box").classList.toggle("triggered", trigger.active);
  $("#trigger-label").textContent = trigger.label;
  $("#trigger-detail").textContent = trigger.detail;

  const triggerNow = sim.getTrigger();
  const recommendGentle = !triggerNow.predatorTriggered && !triggerNow.flowTriggered;
  const options = Object.values(RECOVERY_PLANS)
    .map((plan) => {
      const preview = sim.recoveryPreview(plan.id);
      const recommended = plan.id === "gentle" ? recommendGentle : !recommendGentle;
      return `
        <button class="recovery-option ${recommended ? "recommended" : ""}" type="button" data-recovery="${plan.id}" ${preview.available && !sim.pendingRecovery ? "" : "disabled"}>
          <div class="recovery-option-head"><b>${plan.name}</b><span>${plan.tag} · ${plan.duration}s</span></div>
          <div class="recovery-cost">
            <span>水 -${plan.cost.water}%</span><span>电 -${plan.cost.power}%</span><span>应激 +${plan.cost.stress}</span>
          </div>
          <p>${plan.description}</p>
          <div class="recovery-forecast"><span>生态 ${preview.currentEco} → <b>${preview.forecastEco}</b></span><span>${preview.available ? "可执行" : "资源不足"}</span></div>
        </button>
      `;
    })
    .join("");
  $("#recovery-options").innerHTML = options;

  const running = sim.pendingRecovery;
  const completed = [...sim.recoveryReports].reverse().find((report) => report.status === "complete");
  const report = $("#recovery-report");
  if (running) {
    report.hidden = false;
    $("#recovery-result-title").textContent = `${running.name} · 执行中`;
    $("#recovery-result-detail").textContent = `${running.trigger.label}，剩余 ${(running.dueAt - sim.time).toFixed(1)}s；已扣除水 ${running.cost.water}% / 电 ${running.cost.power}%。`;
  } else if (completed) {
    report.hidden = false;
    $("#recovery-result-title").textContent = `${completed.name} · ${completed.ecoDelta >= 0 ? "+" : ""}${completed.ecoDelta} 生态`;
    $("#recovery-result-detail").textContent = `${completed.trigger.detail} · 终值 流${completed.final.flow} / 差${completed.final.head}m / 风险${Math.round(completed.final.predatorRisk * 100)}% / 生态${completed.final.ecoScore}`;
  } else {
    report.hidden = true;
  }
}

function renderSuccess() {
  const overlay = $("#success-overlay");
  if (!sim.success) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  $("#success-stats").innerHTML = `
    <div><span>完成用时</span><b>${(sim.successAt / 60).toFixed(1)} min</b></div>
    <div><span>剩余库容</span><b>${sim.resources.water.toFixed(0)}%</b></div>
    <div><span>生态评分</span><b>${sim.ecoScore}</b></div>
  `;
}

function ledgerOperationEntry(operation) {
  const before = operation.before;
  const after = operation.after;
  if (!after) {
    return `
      <div class="ledger-entry">
        <div class="ledger-entry-head">
          <div class="ledger-entry-title"><span class="entry-id">${operation.id}</span><b>${escapeHtml(operation.label)}</b><small>${operation.at.toFixed(1)}s</small></div>
          <span class="outcome-badge observing">观察中</span>
        </div>
        <div class="ledger-reason"><b>记录中</b>${escapeHtml(operation.reason)}</div>
      </div>
    `;
  }
  return `
    <div class="ledger-entry">
      <div class="ledger-entry-head">
        <div class="ledger-entry-title"><span class="entry-id">${operation.id}</span><b>${escapeHtml(operation.label)}</b><small>T ${operation.at.toFixed(1)}s → ${operation.completedAt.toFixed(1)}s</small></div>
        <span class="outcome-badge ${operation.outcome}">${outcomeLabels[operation.outcome]}</span>
      </div>
      <div class="ledger-entry-body">
        <div class="ledger-metric"><span>配置变化</span><b>闸 ${operation.beforeControls.gate}→${operation.afterControls.gate} · 板 ${operation.beforeControls.vane}→${operation.afterControls.vane}</b><small>照明 ${operation.beforeControls.lamp}→${operation.afterControls.lamp}%</small></div>
        <div class="ledger-metric"><span>资源 / 时间</span><b>水 ${before.resources.water.toFixed(1)}→${after.resources.water.toFixed(1)}%</b><small>电 ${before.resources.power.toFixed(1)}→${after.resources.power.toFixed(1)}% · ${operation.delta.time}s</small></div>
        <div class="ledger-metric"><span>生物状态</span><b>应激 ${before.bio.averageStress}→${after.bio.averageStress}</b><small>${before.bio.label} → ${after.bio.label} · 通过 +${operation.delta.passed}</small></div>
        <div class="ledger-metric"><span>环境 / 生态</span><b>${before.environment.flow.toFixed(2)}→${after.environment.flow.toFixed(2)} m/s</b><small>落差 ${after.environment.head.toFixed(2)}m · 生态 ${before.ecoScore}→${after.ecoScore}</small></div>
      </div>
      <div class="ledger-reason"><b>判定</b>${escapeHtml(operation.reason)}</div>
    </div>
  `;
}

function renderLedgerOperations() {
  $("#ops-count").textContent = sim.operations.length;
  const list = $("#ledger-operations");
  list.innerHTML = sim.operations.length
    ? [...sim.operations].reverse().map(ledgerOperationEntry).join("")
    : `<div class="empty-ledger">尚无操作记录。<br>执行一次调节后，这里会显示资源、生物状态与时间的前后对照。</div>`;
}

function renderLedgerRecovery() {
  $("#recovery-count").textContent = sim.recoveryReports.length;
  const compare = Object.values(RECOVERY_PLANS)
    .map((plan) => {
      const preview = sim.recoveryPreview(plan.id);
      return `
        <article class="compare-plan ${plan.id === "gentle" ? "recommended" : ""}">
          <div class="compare-plan-head"><b>${plan.name}</b><span>${plan.tag} · ${plan.duration}s</span></div>
          <div class="compare-plan-grid">
            <div><span>水量代价</span><strong>-${plan.cost.water}%</strong></div>
            <div><span>电力代价</span><strong>-${plan.cost.power}%</strong></div>
            <div><span>应激代价</span><strong>+${plan.cost.stress}</strong></div>
          </div>
          <p>${plan.description} 预计生态 ${preview.currentEco} → ${preview.forecastEco}。</p>
          <div class="trigger-inline">触发：${escapeHtml(preview.trigger.detail)}</div>
        </article>
      `;
    })
    .join("");
  $("#recovery-compare-table").innerHTML = compare;
  const list = $("#ledger-recovery");
  if (!sim.recoveryReports.length) {
    list.innerHTML = `<div class="empty-ledger">尚无恢复记录。<br>触发阈值：落差 &gt; 1.78m；流速 &lt; 0.38 m/s；捕食风险 &gt; 52%。</div>`;
    return;
  }
  list.innerHTML = [...sim.recoveryReports]
    .reverse()
    .map((report) => {
      const running = report.status === "running";
      const after = report.after;
      return `
        <div class="ledger-entry">
          <div class="ledger-entry-head">
            <div class="ledger-entry-title"><span class="entry-id">${report.id}</span><b>${report.name}</b><small>${report.at.toFixed(1)}s · 触发：${escapeHtml(report.trigger.label)}</small></div>
            <span class="outcome-badge ${running ? "observing" : report.ecoDelta >= 0 ? "stable" : "critical"}">${running ? "执行中" : report.ecoDelta >= 0 ? `生态 +${report.ecoDelta}` : `生态 ${report.ecoDelta}`}</span>
          </div>
          <div class="ledger-entry-body">
            <div class="ledger-metric"><span>触发阈值</span><b>${escapeHtml(report.trigger.detail)}</b><small>开始 ${report.at.toFixed(1)}s · 计划 ${report.duration}s</small></div>
            <div class="ledger-metric"><span>资源代价</span><b>水 -${report.cost.water}% · 电 -${report.cost.power}%</b><small>生物应激 +${report.cost.stress}</small></div>
            <div class="ledger-metric"><span>最终生态指标</span><b>${after ? `生态 ${after.ecoScore}` : `预测 ${report.forecastEco}`}</b><small>${after ? `风险 ${Math.round(after.environment.predatorRisk * 100)}% · 应激 ${after.bio.averageStress}` : "等待完成观察"}</small></div>
            <div class="ledger-metric"><span>最终流态</span><b>${after ? `${after.environment.flow.toFixed(2)} m/s` : "—"}</b><small>${after ? `落差 ${after.environment.head.toFixed(2)}m · 溶氧 ${after.environment.oxygen.toFixed(1)}` : "—"}</small></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderReplayPane(status = null) {
  const visibleStatus = status || runtime.replay || runtime.lastReplayStatus;
  $("#replay-count").textContent = runtime.inputLog.length;
  $("#replay-length").textContent = `${runtime.inputLog.length} 条输入`;
  $("#replay-signature").textContent = visibleStatus?.expectedSignature || sim.getEventSignature();
  const verification = $("#replay-verification");
  verification.textContent = visibleStatus?.statusText || "尚未回放";
  verification.className =
    visibleStatus?.match === true ? "match" : visibleStatus?.match === false ? "mismatch" : "";
  $("#replay-btn").disabled = runtime.inputLog.length === 0 || Boolean(runtime.replay);
  const list = $("#replay-list");
  list.innerHTML = runtime.inputLog.length
    ? runtime.inputLog
        .map((event, index) => {
          const detail =
            event.type === "controls"
              ? `闸 ${event.controls.gate}% · 板 ${event.controls.vane}% · 灯 ${event.controls.lamp}%`
              : `${RECOVERY_PLANS[event.kind].name} · 水 -${RECOVERY_PLANS[event.kind].cost.water}%`;
          return `<div class="replay-entry"><span>${pad(index + 1)}</span><b>${detail}</b><small>步 ${event.step} / T ${event.at.toFixed(1)}s</small></div>`;
        })
        .join("")
    : `<div class="empty-ledger">固定序列为空。<br>先执行调节或恢复操作，再回到此处回放。</div>`;
}

function renderDeterminism() {
  const cycle = sim.getCycle();
  $("#det-seed").textContent = sim.seed;
  $("#det-fingerprint").textContent = sim.fingerprint;
  $("#det-fish").textContent = `${sim.fish.length} 尾 / ${sim.getGroups().length} 组`;
  $("#det-resources").textContent = `水 ${sim.scenario.initial.water}% · 电 ${sim.scenario.initial.power}%`;
  $("#det-weather").textContent = `${sim.weatherSequence.length} 段连续天气`;
  $("#det-events").textContent = sim.getEventSignature();
  $("#weather-ribbon").innerHTML = sim.weatherSequence
    .map(
      (weather) =>
        `<div class="${weather.id === cycle.weather.id ? "current" : ""}" title="${weather.label} · ${weather.temperature}°C">${weather.id}</div>`,
    )
    .join("");
  $("#target-table").innerHTML = Object.values(SPECIES)
    .map((species) => {
      const fish = sim.scenario.fish.filter((item) => item.species === species.key);
      return `
        <div class="target-group" style="--group-color:${species.color}">
          <h4>${species.name} · ${species.code}</h4>
          ${fish
            .map(
              (item) =>
                `<div class="target-row"><span>${item.id}</span><i>u₀ ${(item.u * 100).toFixed(1)}% · E₀ ${item.energy.toFixed(1)}</i></div>`,
            )
            .join("")}
        </div>
      `;
    })
    .join("");
}

function updateUI(force = false) {
  const now = performance.now();
  if (!force && now - runtime.lastUi < 100) return;
  runtime.lastUi = now;
  renderSpeciesStrip();
  renderTargetHud();
  renderMetrics();
  renderLastOperation();
  renderExperiments();
  renderTriggerAndRecovery();
  renderSuccess();
  renderLedgerOperations();
  renderLedgerRecovery();
  renderReplayPane();
  renderDeterminism();
  $("#run-state").textContent = runtime.paused ? "已暂停" : runtime.replay ? "回放中" : "运行中";
  $("#audio-state").textContent = audio.enabled ? "水声开启" : "静音";
  $("#target-fish .fish-dot").className = `fish-dot ${getActiveTargetGroup().key}`;

  for (const operation of sim.operations) {
    if (operation.outcome && !runtime.seenCompleted.has(operation.id)) {
      runtime.seenCompleted.add(operation.id);
      if (runtime.replay) continue;
      const text =
        operation.outcome === "failure"
          ? `${operation.id} 判定失败：${operation.reason}`
          : operation.outcome === "critical"
            ? `${operation.id} 进入临界：${operation.reason}`
            : `${operation.id} 稳态记录完成`;
      toast(text, operation.outcome === "failure" ? "danger" : operation.outcome === "critical" ? "warning" : "success", 3600);
    }
  }
}

function startReplay() {
  if (!runtime.inputLog.length) {
    toast("固定序列为空，请先执行至少一次操作", "warning");
    return;
  }
  if (sim.pendingOperation) sim.finalizeOperation();
  if (sim.pendingRecovery) sim.finalizeRecovery();
  const expectedTrace = sim.getEventTrace().map((event) => event.key);
  const expectedSignature = sim.getEventSignature();
  const endStep = runtime.step + 55;
  const originalTime = sim.time;
  sim.reset(sim.seed);
  renderer.setSim(sim);
  runtime.step = 0;
  runtime.accumulator = 0;
  runtime.seenCompleted.clear();
  runtime.paused = false;
  runtime.lastReplayStatus = null;
  runtime.replay = {
    events: runtime.inputLog.map((event) => ({ ...event })),
    cursor: 0,
    endStep,
    expectedTrace,
    expectedSignature,
    originalTime,
    statusText: "回放中 0%",
    match: null,
  };
  togglePause(false);
  syncControlInputs();
  $("#success-overlay").hidden = true;
  $("#run-state").textContent = "回放中";
  toast(`开始固定序列回放 · ${runtime.inputLog.length} 条输入 · 同 seed ${sim.seed}`, "info", 2600);
  updateUI(true);
}

function finishReplay() {
  const replay = runtime.replay;
  if (!replay) return;
  const actualTrace = sim.getEventTrace().map((event) => event.key);
  const prefix = actualTrace.slice(0, replay.expectedTrace.length);
  const match =
    prefix.length === replay.expectedTrace.length &&
    prefix.every((item, index) => item === replay.expectedTrace[index]);
  const actualSignature = hashSeed(prefix.join(">")).toString(16).toUpperCase().padStart(8, "0");
  runtime.lastReplayStatus = {
    expectedSignature: replay.expectedSignature,
    actualSignature,
    match,
    statusText: match ? "关键事件顺序一致" : "检测到顺序差异",
  };
  runtime.replay = null;
  togglePause(false);
  toast(
    match
      ? "回放完成：关键事件顺序与原始运行一致"
      : "回放完成：关键事件顺序出现差异，请查看账本",
    match ? "success" : "danger",
    4200,
  );
  updateUI(true);
}

function restartSameSeed() {
  const fingerprint = sim.fingerprint;
  const seed = sim.seed;
  runtime.replay = null;
  runtime.lastReplayStatus = null;
  runtime.step = 0;
  runtime.accumulator = 0;
  runtime.seenCompleted.clear();
  sim.reset(seed);
  renderer.setSim(sim);
  runtime.paused = false;
  togglePause(false);
  syncControlInputs();
  $("#success-overlay").hidden = true;
  toast(`同 seed 重开完成 · 指纹 ${fingerprint} · 目标个体 / 天气 / 初始资源一致`, "success", 4200);
  updateUI(true);
}

function applyNewSeed() {
  const nextSeed = $("#seed-input").value.trim().toUpperCase();
  if (!nextSeed) {
    toast("种子不能为空", "warning");
    return;
  }
  runtime.inputLog = [];
  runtime.replay = null;
  runtime.lastReplayStatus = null;
  runtime.step = 0;
  runtime.accumulator = 0;
  runtime.seenCompleted.clear();
  sim.reset(nextSeed);
  renderer.setSim(sim);
  runtime.paused = false;
  togglePause(false);
  syncControlInputs();
  $("#seed-input").value = sim.seed;
  $("#success-overlay").hidden = true;
  toast(`已载入 seed ${sim.seed} · 场景指纹 ${sim.fingerprint}`, "info", 3600);
  updateUI(true);
}

function openDrawer(tab = runtime.drawerTab) {
  $("#drawer-backdrop").hidden = false;
  $("#ledger-drawer").classList.add("open");
  $("#ledger-drawer").setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  switchDrawerTab(tab);
}

function closeDrawer() {
  $("#ledger-drawer").classList.remove("open");
  $("#drawer-backdrop").hidden = true;
  $("#ledger-drawer").setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
}

function switchDrawerTab(tab) {
  runtime.drawerTab = tab;
  for (const button of $$(".drawer-tab")) button.classList.toggle("active", button.dataset.tab === tab);
  for (const pane of $$(".drawer-pane")) pane.classList.toggle("active", pane.dataset.pane === tab);
}

function bindEvents() {
  for (const key of ["gate", "vane", "lamp"]) {
    const input = $(`#${key}`);
    input.addEventListener("input", () => {
      $(`#${key}-value`).textContent = `${input.value}%`;
      runtime.desiredControls[key] = Number(input.value);
      setFill(input);
    });
  }

  $("#apply-controls").addEventListener("click", applyControls);
  $("#pause-btn").addEventListener("click", () => togglePause());
  $("#restart-btn").addEventListener("click", restartSameSeed);
  $("#seed-apply").addEventListener("click", applyNewSeed);
  $("#seed-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyNewSeed();
  });
  $("#sound-btn").addEventListener("click", () => toggleSound());
  $("#speed-btn").addEventListener("click", cycleSpeed);
  $("#ledger-btn").addEventListener("click", () => openDrawer("operations"));
  $("#open-ledger-inline").addEventListener("click", () => openDrawer("operations"));
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  for (const button of $$(".drawer-tab")) {
    button.addEventListener("click", () => switchDrawerTab(button.dataset.tab));
  }
  $("#recovery-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-recovery]");
    if (button) performRecovery(button.dataset.recovery);
  });
  $("#recovery-info").addEventListener("click", () => openDrawer("recovery"));
  $("#replay-btn").addEventListener("click", startReplay);
  $("#success-ledger").addEventListener("click", () => openDrawer("operations"));
  $("#success-replay").addEventListener("click", () => {
    closeDrawer();
    startReplay();
  });
  $("#pause-overlay").addEventListener("click", () => togglePause(false));

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    const editing = tag === "INPUT" || tag === "TEXTAREA";
    if (event.code === "Space" && !editing) {
      event.preventDefault();
      togglePause();
    } else if (event.key === "Enter" && !editing) {
      event.preventDefault();
      applyControls();
    } else if (event.key.toLowerCase() === "m" && !editing) {
      toggleSound();
    } else if (event.key.toLowerCase() === "r" && !editing) {
      restartSameSeed();
    } else if (event.key === "Escape") {
      closeDrawer();
    }
  });
}

function animate(now) {
  const elapsed = Math.min(now - runtime.lastFrame, 120);
  runtime.lastFrame = now;
  if (!runtime.paused) {
    runtime.accumulator += elapsed * (runtime.replay ? 4 : runtime.speed);
    while (runtime.accumulator >= FIXED_MS) {
      if (runtime.replay && runtime.replay.cursor < runtime.replay.events.length) {
        while (
          runtime.replay.cursor < runtime.replay.events.length &&
          runtime.replay.events[runtime.replay.cursor].step <= runtime.step
        ) {
          const action = runtime.replay.events[runtime.replay.cursor];
          if (action.type === "recovery") sim.startRecovery(action.kind);
          else sim.applyControls(action.controls, { label: "固定序列回放调节" });
          runtime.replay.cursor += 1;
        }
      }
      sim.step(FIXED_DT);
      runtime.step += 1;
      runtime.accumulator -= FIXED_MS;

      if (runtime.replay) {
        const progress = clamp(runtime.step / runtime.replay.endStep, 0, 1);
        runtime.replay.statusText = `回放中 4× · ${Math.round(progress * 100)}%`;
        if (!runtime.paused && runtime.step >= runtime.replay.endStep) {
          finishReplay();
          break;
        }
      }
    }
  }

  renderer.draw();
  audio.update(sim.environment.flow, runtime.paused);
  updateUI();
  requestAnimationFrame(animate);
}

function init() {
  bindEvents();
  syncControlInputs();
  $("#seed-input").value = sim.seed;
  $("#footer-targets").textContent = sim.fish.length;
  $("#footer-weather-count").textContent = sim.weatherSequence.length;
  $("#footer-fingerprint").textContent = sim.fingerprint;
  $("#pass-count").textContent = "0 / 9 通过";
  updateUI(true);
  requestAnimationFrame((now) => {
    runtime.lastFrame = now;
    requestAnimationFrame(animate);
  });
}

init();
