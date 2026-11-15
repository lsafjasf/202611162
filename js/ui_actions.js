// 操作序列导入/导出、高速复现与验证报告弹窗（浏览器端）。
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var modal = $("modal"), modalTitle = $("modalTitle"), modalBody = $("modalBody");
  var seqText = $("seqText"), modalRun = $("modalRun");

  function show(title, bodyText, showTextarea) {
    modalTitle.textContent = title;
    modalBody.textContent = bodyText || "";
    modalBody.style.display = bodyText ? "block" : "none";
    seqText.style.display = showTextarea ? "block" : "none";
    modalRun.classList.toggle("hidden", !showTextarea);
    modal.classList.remove("hidden");
  }
  $("modalClose").onclick = function () { modal.classList.add("hidden"); };

  function currentSeed() { return $("seedInput").value.trim() || "20261116"; }

  $("btnExport").onclick = function () {
    var s = window.MAIN.getState();
    var payload = {
      seed: s.seed,
      plotId: s.plotId,
      cultivar: s.cultivar,
      initial: { water: CFG.INIT.water, energy: CFG.INIT.energy, mulch: CFG.INIT.mulch },
      actions: s.actions.filter(function (a) { return a.ok; })
        .map(function (a) { return { hour: a.hour, type: a.type }; })
    };
    show("导出操作序列（可保存后在同 seed 复现）", "", true);
    seqText.value = JSON.stringify(payload, null, 1);
  };

  $("btnImport").onclick = function () {
    show("粘贴操作序列 JSON 后点击“导入运行”", "", true);
    seqText.value = "";
  };

  $("modalRun").onclick = function () {
    try {
      var data = JSON.parse(seqText.value);
      if (!data.seed || !Array.isArray(data.actions)) throw new Error("缺少 seed 或 actions 字段");
      $("seedInput").value = data.seed;
      var replayed = Sim.replay(data.seed, data.actions);
      window.MAIN.newGame(data.seed);
      var live = window.MAIN.getState();
      // 用 replay 的终态直接替换展示，保证与导入序列严格一致
      Object.keys(replayed).forEach(function (k) { live[k] = replayed[k]; });
      modal.classList.add("hidden");
      show("复现完成", "seed=" + data.seed + "\n地块 " + live.plotId + " · " + live.cultivar +
        "\n结果：" + (live.status === "success" ? "成功" : "失败") +
        "\n终态 EC " + Sim.rootEC(live).toFixed(2) + " dS/m，水位 " + live.gwDepth.toFixed(0) +
        "mm，生物量 " + (live.crop.biomass * 100).toFixed(0) + "%", false);
    } catch (e) {
      window.alert("序列无效：" + e.message);
    }
  };

  $("btnReplay").onclick = function () {
    var s = window.MAIN.getState();
    var actions = s.actions.filter(function (a) { return a.ok; })
      .map(function (a) { return { hour: a.hour, type: a.type }; });
    var replayed = Sim.replay(s.seed, actions);
    var replayed2 = Sim.replay(s.seed, actions);
    var same = JSON.stringify(Report.snapshot(replayed)) === JSON.stringify(Report.snapshot(replayed2)) &&
      JSON.stringify(Report.eventOrder(replayed)) === JSON.stringify(Report.eventOrder(replayed2));
    show("高速复现结果", "seed=" + s.seed + "，动作 " + actions.length + " 个\n" +
      "同一序列两次 replay 的终态与事件顺序" + (same ? "完全一致 ✅" : "不一致 ❌") + "\n\n" + Report.line(replayed), false);
  };

  $("btnReport").onclick = function () {
    var seed = currentSeed();
    var steady = Report.steadyScenario(seed);
    var critical = Report.criticalScenario(seed);
    var failure = Report.failureScenario(seed);
    var cmp = Report.policyCompare(seed);
    var txt = [];
    txt.push("seed = " + seed + "（地块/天气/初始资源由该 seed 唯一确定）");
    txt.push("\n【一、三类规定场景：前后资源 · 生物状态 · 时间】");
    [steady, critical, failure].forEach(function (sc) {
      txt.push("\n● " + sc.name);
      txt.push("  前: " + sc.before);
      txt.push("  后: " + sc.after);
      txt.push("  结论: " + sc.result);
    });
    txt.push("\n【二、两种恢复策略代价与触发阈值】");
    txt.push("触发阈值：EC 高 " + CFG.THRESHOLDS.ecHigh + " / 临界 " + CFG.THRESHOLDS.ecCritical +
      " dS/m；水位浅 " + CFG.THRESHOLDS.gwShallow + " / 临界 " + CFG.THRESHOLDS.gwCritical + " mm");
    cmp.forEach(function (r) {
      txt.push("\n● " + r.name + " [" + r.status + "]");
      txt.push("  用水 " + r.water + " m³，用电 " + r.energy + " kWh，覆盖 " + r.mulch +
        " 片，合计成本 " + r.cost + " 元，耗时 " + (r.hours / 24).toFixed(1) + " 天");
      txt.push("  最终生态：EC " + r.ec + " dS/m，水位 " + r.gw + "mm，健康 " + r.health +
        "%，生物量 " + r.biomass + "%");
    });
    var s1 = cmp[0], s2 = cmp[1];
    txt.push("\n对比：强淋洗比节水型多用水 " + (s2.water - s1.water).toFixed(1) + " m³、多耗电 " +
      (s2.energy - s1.energy) + " kWh、多花 " + (s2.cost - s1.cost).toFixed(1) +
      " 元，换来更低 EC（" + s2.ec + " vs " + s1.ec + "）与更大安全余量。");
    show("验证报告", txt.join("\n"), false);
  };
})();
