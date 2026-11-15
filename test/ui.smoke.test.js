// UI 冒烟测试: 用最小 DOM 桩跑通 main.js 初始化与关键交互
const fs = require("fs");
const path = require("path");

function makeEl(id) {
  const el = {
    id, children: [], style: {}, value: "0", textContent: "", _innerHTML: "",
    className: "", disabled: false, title: "", parentElement: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, force) { force ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    click() { (this.listeners.click || []).forEach((f) => f()); },
    appendChild(c) { this.children.push(c); c.parentElement = this; },
    querySelector() { return makeEl("tbody"); },
    scrollTop: 0, scrollHeight: 0,
    getContext() {
      const grad = { addColorStop() {} };
      return new Proxy({}, { get: (t, k) =>
        k === "createLinearGradient" ? () => grad : () => {} ,
        set: () => true });
    },
    width: 960, height: 320,
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = v; if (v === "") this.children = []; },
  });
  return el;
}

const ids = ["batchInfo","simClock","simState","observeTag","eventLog","deviceTable",
  "powerNow","inSpeed","inTemp","inFlow","inThick","vSpeedVal","vTempVal","vFlowVal",
  "vThickVal","btnPause","btnReset","btnFault","btnSound","btnSnapshot","btnRerun",
  "btnCompare","snapshotList","batchHistory","compareView","modal","modalTitle",
  "modalBody","modalBtns","lineCanvas"];
const els = Object.fromEntries(ids.map((id) => [id, makeEl(id)]));
els.inSpeed.value = "2.5"; els.inTemp.value = "540"; els.inFlow.value = "55";
els.eventLog.parentElement = makeEl("logPanel");

let rafCb = null;
global.document = { getElementById: (id) => els[id], createElement: () => makeEl("dyn") };
global.window = {};
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.alert = () => {};

const load = (f) => eval(fs.readFileSync(path.join(__dirname, "../js", f), "utf8"));
global.AudioSys = undefined; global.Render = undefined;
eval(fs.readFileSync(path.join(__dirname, "../js/audio.js"), "utf8") + "\nglobalThis.AudioSys = AudioSys;");
eval(fs.readFileSync(path.join(__dirname, "../js/sim.js"), "utf8") +
  "\nObject.assign(globalThis, { Simulation, ZONE_LEN, LINE_LEN, AMBIENT, LIMITS, OBSERVE_TIME, SPAWN_INTERVAL, GOOD_TARGET, BAD_LIMIT });");
eval(fs.readFileSync(path.join(__dirname, "../js/render.js"), "utf8") + "\nglobalThis.Render = Render;");
eval(fs.readFileSync(path.join(__dirname, "../js/main.js"), "utf8") +
  "\nglobalThis.__ui = { sim, snapshots, batchHistory, startBatch };");

const { sim, batchHistory } = globalThis.__ui;
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"} ${n}`); };

console.log("UI 冒烟测试");
check("初始化后批次为 #1", sim.batchId === 1);
check("厚度滑条已禁用", els.inThick.disabled === true);

// 跑若干帧
let t = 0;
for (let i = 0; i < 50; i++) { const cb = rafCb; rafCb = null; cb((t += 16)); }
check("主循环推进仿真时钟", sim.time > 0);
check("设备表已渲染", els.deviceTable.children.length >= 0);

// 暂停/继续
els.btnPause.click();
check("暂停生效", sim.paused === true);
els.btnPause.click();
check("恢复运行", sim.paused === false);

// 越限 -> 弹窗 -> 处理恢复
els.inTemp.value = "780";
(els.inTemp.listeners.change || []).forEach((f) => f());
check("越限触发停机", sim.running === false);
check("弹窗显示", !els.modal.classList.contains("hidden"));
check("弹窗含设备名", els.modalBody.innerHTML.includes("热风加热器"));
els.modalBtns.children[0].click();
check("处理后恢复运行", sim.running === true);

// 快照保存与应用
els.btnSnapshot.click();
check("快照已保存", globalThis.__ui.snapshots.length === 1);

// 故障注入与恢复
sim.injectFault();
check("故障停机", sim.running === false);
els.modalBtns.children[0].click();
check("故障恢复", sim.running === true && sim.observeLeft > 0);

// 加速跑完一批
let guard = 0;
while (batchHistory.length === 0 && guard++ < 50000) sim.step(0.1);
check("批次结束入历史", batchHistory.length === 1);
check("批次记录含四项指标",
  ["good","bad","peakPower","stopReason"].every((k) => k in batchHistory[0]));
check("批次含异常处理记录", batchHistory[0].exceptions.length >= 2);
check("批次数据已冻结", Object.isFrozen(batchHistory[0]));

// 弹窗确认下一批
els.modalBtns.children[0].click();
check("下一批开始", sim.batchId === 2 && sim.running === true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
