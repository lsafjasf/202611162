// 用最小 DOM 桩在 Node 中加载 src/main.js，验证 UI 接线与主循环。
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const elements = new Map();
const listeners = {};
const saved = [];

function makeElement(id) {
  const classSet = new Set();
  return {
    id,
    value: id === 'seed' ? '20261116' : '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: {},
    classList: (() => {
      return {
        add(...names) { names.forEach((n) => classSet.add(n)); },
        remove(...names) { names.forEach((n) => classSet.delete(n)); },
        toggle(name, on) { on ? classSet.add(name) : classSet.delete(name); },
        contains(name) { return classSet.has(name); }
      };
    })(),
    set className(value) {
      classSet.clear();
      value.split(/\s+/).filter(Boolean).forEach((n) => classSet.add(n));
    },
    get className() {
      return [...classSet].join(' ');
    }
    ,
    addEventListener(type, fn) {
      (this._listeners ||= {})[type] = fn;
    },
    click() { this._listeners?.click?.({ preventDefault() {} }); },
    setPointerCapture() {}
  };
}

const ids = [
  'game', 'seed', 'pause', 'restart', 'mute', 'stranded-banner', 'overlay', 'overlay-title',
  'overlay-reason', 'overlay-stats', 'save-summary', 'new-game', 'hud-time', 'hud-fuel',
  'hud-poles', 'hud-targets', 'hud-wind', 'hud-grip', 'hud-seed', 'fuel-bar',
  'calibration-progress', 'events', 'btn-up', 'btn-down', 'btn-left', 'btn-right',
  'btn-deploy', 'btn-calibrate', 'btn-recover',
  'indicator-accelerate', 'indicator-brake', 'indicator-left', 'indicator-right',
  'indicator-deploy', 'indicator-calibrate', 'indicator-recover', 'layout-check', 'overlay-map'
];
for (const id of ids) elements.set(id, makeElement(id));

const canvas = elements.get('game');
canvas.clientWidth = 900;
canvas.clientHeight = 600;
const ctxStub = () => ({
  save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {}, fillText() {},
  beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
  createRadialGradient: () => ({ addColorStop() {} }),
  setLineDash() {}, closePath() {},
  get fillStyle() { return ''; }, set fillStyle(_) {},
  get strokeStyle() { return ''; }, set strokeStyle(_) {},
  get font() { return ''; }, set font(_) {},
  get lineWidth() { return 1; }, set lineWidth(_) {},
  get textAlign() { return ''; }, set textAlign(_) {}
});
canvas.getContext = ctxStub;
elements.get('overlay-map').getContext = ctxStub;
elements.get('overlay-map').width = 260;
elements.get('overlay-map').height = 190;

globalThis.performance = { now: () => Date.now() };
let rafCallback = null;
globalThis.requestAnimationFrame = (fn) => { rafCallback = fn; };
globalThis.window = {
  addEventListener(type, fn) { listeners[type] = fn; },
  AudioContext: undefined
};
globalThis.document = {
  getElementById: (id) => elements.get(id),
  createElement: () => ({ click() {}, set href(_) {}, set download(_) {} })
};
globalThis.localStorage = {
  store: {},
  setItem(k, v) { this.store[k] = v; saved.push(v); },
  getItem(k) { return this.store[k] || null; }
};
globalThis.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };

await import(pathToFileURL(join(here, '..', 'src', 'main.js')).href);

function assert(cond, msg) {
  if (!cond) throw new Error(`DOM 冒烟断言失败：${msg}`);
  console.log(`  ✓ ${msg}`);
}

function frame(ms = 40) {
  const cb = rafCallback;
  rafCallback = null;
  cb(performance.now() + ms);
}

console.log('6) 浏览器 UI 接线冒烟测试');
frame();
assert(elements.get('hud-seed').textContent.includes('1b60a2e4'), 'HUD 显示 seed 与布局指纹');
assert(elements.get('hud-targets').textContent === '0/3', '初始测点进度为 0/3');

listeners.keydown({ code: 'ArrowUp', preventDefault() {} });
frame();
assert(elements.get('indicator-accelerate').classList.contains('active'), '油门按键有可见反馈');
listeners.keyup({ code: 'ArrowUp' });

listeners.keydown({ code: 'KeyP', preventDefault() {} });
const frozenTime = elements.get('hud-time').textContent;
frame(100);
assert(elements.get('hud-time').textContent === frozenTime, '暂停后 HUD 时间冻结');
listeners.keydown({ code: 'KeyP', preventDefault() {} });

elements.get('btn-deploy').click();
frame();
assert(elements.get('indicator-deploy').classList.contains('active'), '布杆按钮有可见反馈');

elements.get('restart').click();
frame();
assert(elements.get('hud-targets').textContent === '0/3', '重开按钮重置任务进度');
assert(saved.length === 0, '进行中重开不会误存摘要');

assert(typeof listeners.keydown === 'function' && typeof listeners.keyup === 'function', '键盘监听已注册');
assert(elements.get('layout-check').classList.contains('ok'), '页面内固定 seed 布局自检通过');

const { createGame: makeGame, stepGame } = await import(pathToFileURL(join(here, '..', 'src', 'engine.js')).href);
const { CONFIG: cfg, STATUS: st } = await import(pathToFileURL(join(here, '..', 'src', 'config.js')).href);
cfg.noWind = true;
const driven = makeGame(20261116);
const { makeBot, nextObjective } = await import(pathToFileURL(join(here, 'bot.js')).href);
const bot = makeBot();
let guard = 0;
while (driven.status === st.DRIVING && guard < cfg.timeLimit * 30) {
  const botInput = bot.choose(driven, nextObjective(driven));
  const target = driven.targets.find((t) => !t.polePlaced);
  if (target && Math.hypot(driven.vehicle.x - target.x, driven.vehicle.y - target.y) <= cfg.targetRange) {
    botInput.deploy = true;
  }
  stepGame(driven, 1 / 30, botInput);
  guard += 1;
}
assert(driven.status === st.WON, 'DOM 测试环境中可复现固定胜利路径');
assert(driven.endSummary.targetsCompleted === 3 && driven.endSummary.fuelLeft > 0, '胜利摘要含目标数量与剩余资源');

const { saveSummary } = await import(pathToFileURL(join(here, '..', 'src', 'storage.js')).href);
saveSummary(driven.endSummary);
assert(saved.length === 1 && JSON.parse(saved[0]).status === 'won', '状态摘要可写入 localStorage');
console.log('DOM 冒烟测试通过。');
