// 前端主控：固定步长推进 + rAF 渲染，UI 与音频绑定。
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("fieldCanvas");
  var state = null, paused = false, speed = 2;
  var acc = 0, lastTs = 0, clock = 0;
  var audio = new PumpAudio();
  var HOUR_MS = 120; // 1× 速度下 1 模拟小时 = 120ms

  function newGame(seed) {
    state = Sim.createSimulation(seed);
    paused = false; acc = 0;
    $("btnPause").textContent = "暂停";
    $("btnIrrigate").disabled = false;
    $("btnDrain").disabled = false;
    syncPumpButtons();
    renderAll();
  }

  function syncPumpButtons() {
    $("btnIrrigate").classList.toggle("active", state.irrigOn);
    $("btnIrrigate").textContent = "淡水灌溉（" + (state.irrigOn ? "开" : "关") + "）";
    $("btnDrain").classList.toggle("active", state.drainOn);
    $("btnDrain").textContent = "排水泵（" + (state.drainOn ? "开" : "关") + "）";
    $("btnMulch").disabled = state.mulchOn || state.mulchLeft <= 0 || state.status !== "running";
    audio.setPumps(state.irrigOn, state.drainOn);
  }

  function cls(v, warnAt, dangerAt, lower) {
    if (lower) return v <= dangerAt ? "danger" : (v <= warnAt ? "warn" : "ok");
    return v >= dangerAt ? "danger" : (v >= warnAt ? "warn" : "ok");
  }

  function row(label, value, c) {
    return "<tr><td>" + label + "</td><td class='num " + (c || "") + "'>" + value + "</td></tr>";
  }

  function renderMetrics() {
    var ec = Sim.rootEC(state), theta = Sim.rootWaterContent(state);
    var c = state.crop, T = CFG.THRESHOLDS;
    var html = [
      row("地块 / 作物", state.plotId + " · " + state.cultivar),
      row("模拟时间", Sim.timeLabel(state.hour) + "（30天）"),
      row("根区 EC（盐度）", ec.toFixed(2) + " dS/m", cls(ec, T.ecHigh, T.ecCritical)),
      row("根区体积含水率", (theta * 100).toFixed(1) + "%", cls(theta, 0.16, CFG.CROP.waterStress, true)),
      row("地下水位埋深", state.gwDepth.toFixed(0) + " mm", cls(state.gwDepth, T.gwShallow, T.gwCritical, true)),
      row("地下水咸度", state.gwSalt.toFixed(2) + " g/L"),
      row("作物健康度", (c.health * 100).toFixed(0) + "%", cls(1 - c.health, 0.2, 0.5)),
      row("作物生物量", (c.biomass * 100).toFixed(0) + "%（目标≥80%）"),
      row("淡水储量", state.water.toFixed(1) + " m³", cls(CFG.INIT.water - state.water, CFG.INIT.water * 0.6, CFG.INIT.water * 0.85)),
      row("电能储量", state.energy.toFixed(0) + " kWh", cls(CFG.INIT.energy - state.energy, CFG.INIT.energy * 0.6, CFG.INIT.energy * 0.85)),
      row("覆盖物库存", state.mulchLeft + " 片" + (state.mulchOn ? "（已铺设）" : "")),
      row("累计用水 / 用电", state.totals.waterUsed.toFixed(1) + " m³ / " + state.totals.energyUsed.toFixed(0) + " kWh"),
      row("累计排水 / 降雨", state.totals.drainageMm.toFixed(0) + " mm / " + state.totals.rainMm.toFixed(0) + " mm")
    ].join("");
    $("metricsTable").innerHTML = html;
  }

  function renderLastAction() {
    var la = state.lastAction;
    if (!la) { $("lastAction").textContent = "尚无操作。"; return; }
    $("lastAction").innerHTML = "<span class='t'>" + Sim.timeLabel(la.hour) + "</span> [" + la.type + "] " +
      "<span class='" + (la.ok ? "ok" : "danger") + "'>" + (la.ok ? "成功" : "失败") + "</span> · " + la.msg;
  }

  function renderLog() {
    var box = $("logBox");
    box.innerHTML = state.log.slice(-60).map(function (l) {
      return "<div class='" + l.cls + "'><span class='t'>" + Sim.timeLabel(l.hour) + "</span> " + l.msg + "</div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  function renderAll() {
    renderMetrics(); renderLastAction(); renderLog();
    Renderer.render(canvas, state, 0, clock);
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    var dt = ts - lastTs; lastTs = ts; clock += dt;
    if (!paused && state.status === "running") {
      acc += dt * speed;
      var guard = 0;
      while (acc >= HOUR_MS && state.status === "running" && guard++ < 64) {
        Sim.stepHour(state);
        acc -= HOUR_MS;
      }
    }
    audio.update();
    Renderer.render(canvas, state, paused ? 0 : Math.min(acc / HOUR_MS, 1), clock);
    renderMetrics(); renderLog();
    if (state.status !== "running") onEnded();
    requestAnimationFrame(loop);
  }

  var endedShown = false;
  function onEnded() {
    syncPumpButtons();
    $("btnIrrigate").disabled = true; $("btnDrain").disabled = true; $("btnMulch").disabled = true;
    if (endedShown) return;
    endedShown = true;
    var ev = state.evaluation;
    audio[state.status === "success" ? "success" : "warn"]();
    var text = (state.status === "success" ? "✅ 治理成功\n" : "❌ 治理失败\n") +
      ev.checks.map(function (k) { return (k[1] ? "✔ " : "✘ ") + k[0] + "：" + k[2]; }).join("\n");
    window.alert(text);
  }

  function op(fn) {
    if (state.status !== "running") { audio.warn(); return; }
    audio.click(); fn(); syncPumpButtons(); renderLastAction(); renderMetrics();
  }

  $("btnIrrigate").onclick = function () { op(function () { Sim.toggleIrrigation(state); }); };
  $("btnDrain").onclick = function () { op(function () { Sim.toggleDrainage(state); }); };
  $("btnMulch").onclick = function () { op(function () { Sim.applyMulch(state); }); };
  $("btnPause").onclick = function () {
    paused = !paused;
    this.textContent = paused ? "继续" : "暂停";
  };
  $("speedSelect").onchange = function (e) { speed = parseInt(e.target.value, 10); };
  $("btnRestart").onclick = function () { endedShown = false; newGame($("seedInput").value.trim() || "default"); };
  $("btnNewSeed").onclick = function () {
    $("seedInput").value = "seed-" + Math.floor(Math.random() * 1e6);
    endedShown = false; newGame($("seedInput").value);
  };

  window.addEventListener("DOMContentLoaded", function () {
    newGame($("seedInput").value.trim() || "20261116");
    requestAnimationFrame(loop);
    window.MAIN = { getState: function () { return state; }, newGame: newGame };
  });
})();
