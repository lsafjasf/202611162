/* Node 冒烟测试：用 DOM 桩执行 game.js，验证主循环/交互/快照对比无运行时错误 */
'use strict';
const fs = require('fs');

const handlers = {};
function makeEl(id) {
  const el = {
    id, textContent: '', innerHTML: '', value: id === 'speed' ? '8' : '0',
    checked: false, disabled: false, scrollTop: 0, scrollHeight: 0, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(ev, fn) { (handlers[id] ||= {})[ev] = fn; },
    querySelector() { return makeEl(id + '>tbody'); },
    getContext() {
      return new Proxy({}, { get: (t, k) => (typeof k === 'string' ? () => {} : undefined), set: () => true });
    },
  };
  return el;
}
const els = {};
global.window = global;
global.document = {
  getElementById(id) { return (els[id] ||= makeEl(id)); },
  querySelectorAll() { return []; },
  addEventListener() {},
};
let simTime = 0;
global.performance = { now: () => simTime * 1000 };
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; };

global.FDSim = require('./sim.js');
global.FDScenarios = require('./scenarios.js');
eval(fs.readFileSync('./game.js', 'utf8'));

function frames(n) {
  for (let i = 0; i < n; i++) { simTime += 0.05; const cb = rafCb; rafCb = null; cb(simTime * 1000); }
}
const click = id => handlers[id].click();
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else console.log('ok: ' + msg); };

frames(5);
assert(els['g-temp'].textContent.includes('℃'), '仪表盘刷新');
click('btn-start');
frames(200);
click('btn-pause'); // 暂停检查
frames(5);
assert(els['run-status'].textContent.includes('已暂停'), '暂停检查生效');
click('btn-pause');
click('btn-defrost'); // 可能因阶段不符被忽略，不应报错
frames(4000); // 8× 速度跑完批次1
assert(els['result-table'] !== undefined, '结果表存在');
click('btn-snapshot');
assert(els['snapshot-info'].textContent.includes('已保存快照'), '快照保存');
click('btn-rerun');
assert(els['snapshot-info'].textContent.includes('已从快照恢复'), '快照恢复');
// 修改参数重跑
els['p-ramp'].value = '1.5';
handlers['p-ramp'].input();
click('btn-start');
frames(4000);
click('btn-reset'); // 重置当前批次
frames(100);
click('btn-start');
frames(20000); // 跑完全部批次
assert(els['compare'].innerHTML.includes('cmp-col'), '对比列渲染');
assert(els['event-log'].innerHTML.includes('启动'), '设备启停时刻已记录');
console.log('UI 冒烟测试完成');
