// 最小 DOM/Canvas 桩，验证 main.js 的初始化与主循环不抛异常。
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => {
  if (k === 'canvas') return { width: 960, height: 600 };
  if (k === 'measureText') return () => ({ width: 10 });
  return typeof k === 'string' ? noop : undefined;
}});
const elements = {};
function makeEl(id) {
  return elements[id] || (elements[id] = {
    id, hidden: false, style: {}, textContent: '', width: 960, height: 600,
    getContext: () => ctx2d,
    addEventListener: noop,
    get width() { return 960; }, get height() { return 600; }
  });
}
globalThis.window = {
  addEventListener: noop,
  AudioContext: undefined
};
globalThis.document = {
  getElementById: makeEl,
  documentElement: {}
};
globalThis.performance = { now: () => Date.now() };
let rafCount = 0;
globalThis.requestAnimationFrame = (fn) => {
  if (rafCount++ < 120) setTimeout(() => fn(Date.now()), 0);
};
globalThis.localStorage = {
  store: new Map(),
  setItem(k, v) { this.store.set(k, v); },
  getItem(k) { return this.store.get(k) ?? null; }
};
globalThis.console = console;
await import('../../js/main.js');
await new Promise((r) => setTimeout(r, 300));
console.log('DOM 冒烟通过，requestAnimationFrame 帧数:', rafCount);
console.log('localStorage 键:', [...localStorage.store.keys()]);
