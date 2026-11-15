// ===== UI 主逻辑 =====
const sim = new Simulation();
const snapshots = [];        // 设备快照
const batchHistory = [];     // 已完成批次(冻结, 不可修改)
let selectedSnap = null;
const selectedBatches = new Set();

const $ = (id) => document.getElementById(id);

// ---- 事件日志 ----
sim.on("event", (e) => {
  const li = document.createElement("li");
  li.className = `evt-${e.type}`;
  li.textContent = `[${e.t.toFixed(1)}s] ${e.msg}`;
  const log = $("eventLog");
  log.appendChild(li);
  log.parentElement.scrollTop = log.parentElement.scrollHeight;
});

// ---- 故障/越限弹窗 ----
sim.on("fault", (rec) => {
  showModal(
    rec.kind === "fault" ? "设备故障停机" : "参数越限保护停机",
    `<p>设备: <b>${rec.device}</b></p>
     <p>触发值: <span class="fault-val">${rec.triggerValue}</span></p>
     <p>${rec.detail}</p>
     <p>确认后将修复设备并进入 ${OBSERVE_TIME}s 恢复观察期, 验证无状态残留。</p>`,
    [{ label: "处理并恢复运行", fn: () => { sim.recover(); closeModal(); } }]
  );
});

// ---- 批次结束 ----
sim.on("batchEnd", (rec) => {
  batchHistory.push(Object.freeze(rec));   // 冻结, 防止修改已完成批次
  renderBatchHistory();
  const ex = rec.exceptions.length
    ? `<p>异常处理记录 ${rec.exceptions.length} 条(首条: ${rec.exceptions[0].device} / ${rec.exceptions[0].triggerValue})</p>`
    : "<p>无异常记录</p>";
  showModal(`批次 #${rec.id} 结束`,
    `<p>良品: <span class="ok-val">${rec.good}</span> · 废品: <span class="fault-val">${rec.bad}</span></p>
     <p>峰值功耗: ${rec.peakPower} kW</p>
     <p>停机原因: ${rec.stopReason}</p>${ex}`,
    [{ label: "开始下一批", fn: () => { startBatch(); closeModal(); } }]);
});

function startBatch(keepParams = true) {
  sim.resetBatch(keepParams);
  syncSliders();
  $("batchInfo").textContent = `批次 #${sim.batchId} · 目标: ${GOOD_TARGET} 块合格玻璃`;
}

// ---- 参数滑条 ----
const sliderMap = { inSpeed: "speed", inTemp: "temp", inFlow: "flow" };
const labelMap = { speed: "vSpeedVal", temp: "vTempVal", flow: "vFlowVal" };
for (const [id, key] of Object.entries(sliderMap)) {
  $(id).addEventListener("change", () => {
    const ok = sim.setParam(key, $(id).value);
    if (!ok) syncSliders();   // 越限已被钳位, 回显安全值
    updateLabels();
  });
  $(id).addEventListener("input", updateLabels);
}
function updateLabels() {
  for (const [id, key] of Object.entries(sliderMap))
    $(labelMap[key]).textContent = $(id).value;
}
function syncSliders() {
  $("inSpeed").value = sim.params.speed;
  $("inTemp").value = sim.params.temp;
  $("inFlow").value = sim.params.flow;
  updateLabels();
}

// ---- 按钮 ----
$("btnPause").addEventListener("click", () => {
  sim.paused = !sim.paused;
  $("btnPause").textContent = sim.paused ? "继续运行" : "暂停检查";
});
$("btnReset").addEventListener("click", () => {
  sim.log("warn", `批次 #${sim.batchId} 被手动重置`);
  startBatch(true);
});
$("btnFault").addEventListener("click", () => sim.injectFault());
$("btnSound").addEventListener("click", () => {
  const on = AudioSys.toggle();
  $("btnSound").textContent = `声音: ${on ? "开" : "关"}`;
});

// ---- 模态框 ----
function showModal(title, html, buttons) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = html;
  const box = $("modalBtns");
  box.innerHTML = "";
  buttons.forEach((b) => {
    const btn = document.createElement("button");
    btn.textContent = b.label;
    btn.addEventListener("click", b.fn);
    box.appendChild(btn);
  });
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }

// ---- 快照 ----
$("btnSnapshot").addEventListener("click", () => {
  const snap = {
    id: snapshots.length + 1,
    batchId: sim.batchId, t: +sim.time.toFixed(1),
    params: { ...sim.params },
    devices: Object.fromEntries(
      Object.entries(sim.devices).map(([k, d]) => [k, { on: d.on, fault: d.fault }])),
  };
  snapshots.push(snap);
  sim.log("ok", `已保存快照 S${snap.id} (批次#${snap.batchId} t=${snap.t}s)`);
  renderSnapshots();
});

function renderSnapshots() {
  const box = $("snapshotList");
  box.innerHTML = "";
  snapshots.forEach((s) => {
    const el = document.createElement("span");
    el.className = "snap-item" + (selectedSnap === s.id ? " selected" : "");
    el.textContent = `S${s.id}: ${s.params.speed}m/min ${s.params.temp}°C ${s.params.flow}%`;
    el.title = "点击应用参数到当前滑条";
    el.addEventListener("click", () => {
      selectedSnap = s.id;
      sim.params = { ...s.params };
      syncSliders();
      renderSnapshots();
    });
    box.appendChild(el);
  });
}

$("btnRerun").addEventListener("click", () => {
  if (!selectedSnap) { alert("请先点击选择一个快照"); return; }
  const s = snapshots.find((x) => x.id === selectedSnap);
  sim.log("warn", `用快照 S${s.id} 参数重跑新批次`);
  sim.params = { ...s.params };
  startBatch(true);
});

// ---- 已完成批次(只读) ----
function renderBatchHistory() {
  const box = $("batchHistory");
  box.innerHTML = "";
  batchHistory.forEach((b) => {
    const el = document.createElement("span");
    el.className = "batch-item" + (selectedBatches.has(b.id) ? " selected" : "");
    el.textContent = `#${b.id} 良${b.good}/废${b.bad} ${b.peakPower}kW`;
    el.title = `${b.stopReason} · 异常${b.exceptions.length}条 (点击选择用于对比)`;
    el.addEventListener("click", () => {
      selectedBatches.has(b.id) ? selectedBatches.delete(b.id) : selectedBatches.add(b.id);
      if (selectedBatches.size > 2) selectedBatches.delete([...selectedBatches][0]);
      renderBatchHistory();
    });
    box.appendChild(el);
  });
}

// ---- 并排比较 ----
$("btnCompare").addEventListener("click", () => {
  const view = $("compareView");
  if (selectedBatches.size !== 2) {
    view.innerHTML = "<p>请先在上方选择两个已完成批次。</p>";
    return;
  }
  const [a, b] = [...selectedBatches].map((id) => batchHistory.find((x) => x.id === id));
  if (a.exceptions.length + b.exceptions.length === 0) {
    view.innerHTML = "<p>对比要求: 两批中至少一批包含异常处理记录, 请加入一次故障/越限后的批次。</p>";
    return;
  }
  const row = (label, fa, fb) =>
    `<tr><th>${label}</th><td>${fa}</td><td>${fb}</td></tr>`;
  view.innerHTML = `<table>
    <tr><th>指标</th><th>批次 #${a.id}</th><th>批次 #${b.id}</th></tr>
    ${row("良品", a.good, b.good)}
    ${row("废品", a.bad, b.bad)}
    ${row("峰值功耗", a.peakPower + " kW", b.peakPower + " kW")}
    ${row("停机原因", a.stopReason, b.stopReason)}
    ${row("用时", a.duration + " s", b.duration + " s")}
    ${row("参数", fmtParams(a.params), fmtParams(b.params))}
    ${row("异常处理", fmtEx(a.exceptions), fmtEx(b.exceptions))}
  </table>`;
});

function fmtParams(p) { return `${p.speed}m/min · ${p.temp}°C · ${p.flow}%`; }
function fmtEx(list) {
  if (!list.length) return "无";
  return list.map((e) => `${e.device}: ${e.triggerValue}${e.recovered ? "(已恢复)" : ""}`).join("<br>");
}

// ---- 设备状态表 ----
function renderDevices() {
  const tbody = $("deviceTable").querySelector("tbody");
  tbody.innerHTML = "";
  const units = { heater: "°C", fan: "%", conveyor: "m/min" };
  for (const [k, d] of Object.entries(sim.devices)) {
    const tr = document.createElement("tr");
    const cls = d.fault ? "dev-fault" : d.on ? "dev-on" : "dev-off";
    const state = d.fault ? "故障" : d.on ? "运行" : "停止";
    tr.innerHTML = `<td>${d.label}</td><td class="${cls}">${state}</td>
      <td>${d.value.toFixed(1)} ${units[k]}</td>
      <td>${lastToggle(k)}</td>`;
    tbody.appendChild(tr);
  }
  $("powerNow").textContent =
    `当前功耗: ${sim.power.toFixed(1)} kW · 峰值: ${sim.peakPower.toFixed(1)} kW`;
}

function lastToggle(key) {
  const label = sim.devices[key].label;
  for (let i = sim.events.length - 1; i >= 0; i--) {
    const m = sim.events[i].msg;
    if (m.startsWith(label) && (m.includes("启动") || m.includes("停止")))
      return sim.events[i].t.toFixed(1) + "s";
  }
  return "-";
}

// ---- 主循环 ----
let last = performance.now(), acc = 0;
const DT = 0.1, SPEED = 5;   // 5 倍速
function loop(now) {
  const real = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  acc += real * SPEED;
  while (acc >= DT) { sim.step(DT); acc -= DT; }
  Render.draw(sim, real);
  renderDevices();
  $("simClock").textContent = `t = ${sim.time.toFixed(1)} s`;
  const st = $("simState");
  if (!sim.running) { st.textContent = "已停机"; st.className = "state-stopped"; }
  else if (sim.paused) { st.textContent = "已暂停(检查中)"; st.className = "state-paused"; }
  else { st.textContent = "运行中"; st.className = "state-running"; }
  $("observeTag").classList.toggle("hidden", sim.observeLeft <= 0);
  if (sim.observeLeft > 0)
    $("observeTag").textContent = `故障恢复观察期 ${sim.observeLeft.toFixed(0)}s`;
  const maxStress = sim.sheets.reduce((m, s) => Math.max(m, s.stress), 0);
  AudioSys.update(sim.devices.fan.value, maxStress, sim.running && !sim.paused);
  $("vThickVal").textContent = sim.thickness;
  $("inThick").value = sim.thickness;
  requestAnimationFrame(loop);
}

// ---- 初始化 ----
Render.init($("lineCanvas"));
$("inThick").disabled = true;   // 厚度由来料决定, 玩家需调曲线应对
startBatch(false);
requestAnimationFrame(loop);
