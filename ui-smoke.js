/* ui-smoke.js — 轻量 DOM/Canvas 桩，无头验证 app.js 初始化与刷新路径 */
'use strict';
const fs = require('fs');
const path = require('path');

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createGain' || k === 'createOscillator') return () => ({
        type: '', frequency: { setValueAtTime() {} }, gain: {
          setValueAtTime() {}, exponentialRampToValueAtTime() {}
        },
        connect() { return this; }, start() {}, stop() {}
      });
      if (k === 'destination') return {};
      if (k === 'currentTime') return 0;
      if (k === 'state') return 'running';
      return typeof k === 'string' ? () => {} : undefined;
    },
    set() { return true; }
  });
}

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', className: '', style: {},
    _listeners: {},
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    querySelector() { return { addEventListener() {} }; },
    appendChild() {},
    getContext() { return makeCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    classList: { add() {}, remove() {} }
  };
  return el;
}

const elements = {};
const ids = ['seedInput','newTaskBtn','pauseBtn','speedSel','stepBtn','autoBtn','autoKind','muteBtn',
  'statusPill','map','mTime','mBudget','mEco','bBudget','bEco','mPeak','stationRows','windHint',
  'lastAction','stationPick','samplerBtn','calibBtn','investBtn','steadyBtn','critBtn','traceBtn',
  'stratABtn','stratBBtn','compareBox','recordRows','log','toast'];
ids.forEach(id => { elements[id] = makeEl(id); });
elements.seedInput.value = '2026';
elements.speedSel.value = '250';
elements.autoKind.value = 'A';

global.window = global;
global.document = {
  getElementById: id => elements[id] || makeEl(id),
  createElement: () => makeEl('dyn')
};
global.setInterval = () => 0;
global.clearInterval = () => {};
global.AudioContext = function () { return makeCtx(); };

function load(file) {
  let code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // 去掉浏览器脚本对全局 window 的依赖，直接在当前全局执行
  eval(code);
}
load('env-engine.js');
load('env-driver.js');
load('env-render.js');
load('env-audio.js');
load('app.js');

const E = global.EnvEngine;
if (!elements.stationRows.innerHTML.includes('S1')) throw new Error('站点表未渲染');
if (!elements.mBudget.textContent) throw new Error('预算未显示');

// 模拟点击网格 + 部署采样点 + 若干 tick，验证刷新路径稳定
const map = elements.map;
map._listeners.click[0]({ clientX: 100, clientY: 100 });
elements.samplerBtn._listeners.click[0]();
for (let i = 0; i < 30; i++) {
  elements.stepBtn._listeners.click[0]();
}
if (!elements.log.innerHTML) throw new Error('日志未更新');

// 触发固定序列复现，确认 autoCtx 路径不报错
elements.autoBtn._listeners.click[0]();
for (let i = 0; i < 80; i++) {
  global.setInterval && elements.stepBtn._listeners.click[0]();
}
console.log('UI 冒烟通过：站点渲染=' + elements.stationRows.innerHTML.includes('S1') +
  '，记录行数=' + (E && 'ok') + '，日志片段=' + elements.log.innerHTML.slice(0, 40));
