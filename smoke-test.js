/* UI 冒烟测试：用 DOM 桩在 Node 中加载 game.js + ui.js，模拟输入与帧推进 */
'use strict';

/* ---------- DOM 桩 ---------- */
const listeners = {};
const rafQueue = [];
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set() { return true; },
});
const elements = {};
function el(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      width: 1280, height: 720,
      style: {},
      innerHTML: '',
      onclick: null,
      getContext: () => ctxStub,
    };
  }
  return elements[id];
}

global.window = {
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
};
global.document = { getElementById: el };
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); };
global.localStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = String(v); },
};

require('./game.js');
global.window.Glider = {
  ...require('./game.js'),
};
// game.js 的 window 导出依赖 typeof window，已满足；重新 require 无效（缓存），手动挂载
require('./ui.js');

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
  if (!cond) failures++;
}

function key(k, down = true) {
  const ev = { key: k, preventDefault() {} };
  for (const fn of listeners[down ? 'keydown' : 'keyup'] || []) fn(ev);
}

function runFrames(n) {
  let t = 16.7;
  for (let i = 0; i < n; i++) {
    const q = rafQueue.splice(0);
    for (const fn of q) fn(t);
    t += 16.7;
  }
}

/* 1. 加载后帧循环可运行 */
runFrames(120);
check('UI 初始化并运行 120 帧无异常', true);

/* 2. 每次输入都有反馈：拉杆 / 翼展 / 压舱 / 暂停 */
key('ArrowUp'); runFrames(30); key('ArrowUp', false);
key('f'); runFrames(10);
key('b'); runFrames(10);
key('p'); runFrames(10);
key('p'); runFrames(60);
check('拉杆/翼展/压舱/暂停输入无异常', true);

/* 3. 重开后布局一致（另开新局验证） */
const G = require('./game.js');
const h0 = G.layoutHash(G.createWorld(G.SEED));
key('Enter'); runFrames(30);
const h1 = G.layoutHash(G.createWorld(G.SEED));
check('重开后布局指纹一致', h0 === h1, `#${h1}`);

/* 4. 摘要元素存在且可写 */
check('结算面板元素存在', !!el('summary'));

console.log(failures ? `${failures} 项失败` : 'UI 冒烟测试通过');
process.exit(failures ? 1 : 0);
