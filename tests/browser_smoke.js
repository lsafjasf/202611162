// 无浏览器环境下的前端冒烟测试：用最小 DOM 桩加载全部浏览器脚本并驱动一帧。
global.window = global;
global.requestAnimationFrame = function () { return 0; };
global.window.addEventListener = function (ev, fn) { if (ev === "DOMContentLoaded") domReady = fn; };

function makeEl(id) {
  return {
    id: id, style: {}, classList: { _s: {}, toggle: function (k, v) { this._s[k] = v; }, remove: function () {} },
    textContent: "", innerHTML: "", value: "", disabled: false, hidden: false,
    getContext: function () {
      return new Proxy({}, { get: function (t, p) {
        if (p === "createLinearGradient") return function () { return { addColorStop: function () {} }; };
        if (p === "createBuffer" || p === "createOscillator" || p === "createGain") return undefined;
        return typeof p === "string" ? function () {} : undefined;
      }, set: function () { return true; } });
    },
    width: 720, height: 460, scrollTop: 0, scrollHeight: 0,
    onclick: null, onchange: null
  };
}
var ids = ["fieldCanvas", "seedInput", "btnNewSeed", "btnRestart", "btnPause", "speedSelect",
  "btnIrrigate", "btnDrain", "btnMulch", "btnExport", "btnImport", "btnReplay", "btnReport",
  "metricsTable", "lastAction", "logBox", "modal", "modalTitle", "modalBody", "seqText",
  "modalClose", "modalRun"];
var registry = {};
ids.forEach(function (id) { registry[id] = makeEl(id); });
global.document = {
  getElementById: function (id) { return registry[id] || makeEl(id); },
  addEventListener: function (ev, fn) { if (ev === "DOMContentLoaded") domReady = fn; }
};
var domReady = null;
global.alert = function () {};

require("../js/rng.js"); require("../js/config.js");
global.Sim = require("../js/simulation.js");
global.Policies = require("../js/policies.js");
global.Report = require("../js/report.js");
global.CONFIG = require("../js/config.js");
global.CFG = global.CONFIG;
// AudioContext 缺失时 PumpAudio 应安全降级
require("../js/audio.js");
require("../js/renderer.js");
require("../js/main.js");
require("../js/ui_actions.js");

var assert = require("assert");
domReady();
var s = window.MAIN.getState();
assert(s && s.seed === "20261116", "主状态初始化失败");

// 渲染器对初始/中途/结束态都不应抛错
Renderer.render(registry.fieldCanvas, s, 0, 16);
Sim.toggleIrrigation(s); Sim.stepHour(s);
Renderer.render(registry.fieldCanvas, s, 0.5, 32);
Sim.runHours(s, 720);
Renderer.render(registry.fieldCanvas, s, 0, 64);

// 三个按钮回调可执行
registry.btnReport.onclick();
assert(registry.modalTitle.textContent.length > 0, "报告弹窗未生成");
registry.btnExport.onclick();
assert(registry.seqText.value.indexOf("\"seed\"") >= 0, "导出序列缺 seed");
registry.seqText.value = registry.seqText.value;
registry.btnImport.onclick();
registry.modalRun.onclick();

console.log("浏览器冒烟测试通过：初始化、渲染、操作、报告与导入复现均无异常。");
