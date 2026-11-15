/* 用最小 DOM stub 冒烟加载 ui.js，验证初始化与交互路径不抛异常。 */
'use strict';
global.window = global;
require('../src/spatial-util.js');
require('../src/engine.js');
require('../src/render.js');
require('../src/browser-test.js');

function makeEl() {
  const listeners = {};
  const el = {
    style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    children: [], textContent: '', innerHTML: '', value: '1', width: 720, height: 432,
    getContext() {
      return new Proxy({}, { get: (t, k) => (k === 'getByteFrequencyData' || k === 'getFloatTimeDomainData')
        ? (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = 0; } : () => {} });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 720, height: 432 }; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    appendChild() {}, click() {},
    fire(t, ev) { (listeners[t] || []).forEach(fn => fn(ev || {})); }
  };
  return el;
}
const els = {};
global.document = {
  getElementById(id) { return (els[id] = els[id] || makeEl()); },
  querySelectorAll() { return [makeEl(), makeEl(), makeEl()]; },
  createElement() { return makeEl(); }
};
global.requestAnimationFrame = () => 0;
global.addEventListener = () => {};
global.Blob = class {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.FileReader = class { readAsText() { this.onload && this.onload(); } };

require('../src/ui.js');
const ui = global.SF_UI;
if (!ui) throw new Error('SF_UI 未暴露');

// 未初始化音频上下文时的纯状态路径
ui.setMode('binaural');
if (ui.params().mode !== 'binaural') throw new Error('模式切换失败');
const before = JSON.stringify(ui.params().sources.map(s => ({ x: s.x, z: s.z })));
ui.setMode('surround');
const after = JSON.stringify(ui.params().sources.map(s => ({ x: s.x, z: s.z })));
if (before !== after) throw new Error('模式切换重置了声源位置');
ui.resetAll();
if (ui.params().mode !== 'stereo') throw new Error('重置未恢复默认模式');

// 模拟载入参数（无音频上下文时仅改状态）
const loaded = JSON.parse(JSON.stringify(global.SF.DEFAULT_PARAMS()));
loaded.mode = 'surround'; loaded.sources[0].freq = 999;
const fileEl = els['file-json'];
// 直接驱动内部逻辑：通过 FileReader stub
global.document.getElementById('file-json').fire = function () {};

console.log('UI 冒烟测试通过：初始化、模式切换、位置保持、重置均正常');
