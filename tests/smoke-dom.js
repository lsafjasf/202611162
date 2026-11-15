/* 用最小 DOM/Canvas/Audio 桩在 Node 中实例化真实游戏对象，覆盖渲染、输入与界面路径 */
const events = {};
const elements = {};

function makeEl(id) {
  return elements[id] ||= {
    id,
    textContent: '',
    style: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) { (events[`${id}:${type}`] ||= []).push(fn); },
    parentElement: { style: {} },
    getContext() { return makeCtx(); },
  };
}

function makeCtx() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'createLinearGradient') return { addColorStop: noop };
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; },
  });
}

class FakeAudioNode {
  constructor() {
    this.gain = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    this.frequency = { value: 0, setTargetAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }
  connect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 8000;
    this.destination = {};
  }
  resume() {}
  createGain() { return new FakeAudioNode(); }
  createOscillator() { return new FakeAudioNode(); }
  createBiquadFilter() { return new FakeAudioNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() {
    const n = new FakeAudioNode();
    n.loop = false;
    return n;
  }
}

globalThis.window = {
  addEventListener(type, fn) { (events[`window:${type}`] ||= []).push(fn); },
  AudioContext: FakeAudioContext,
  webkitAudioContext: FakeAudioContext,
};
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
};
globalThis.document = {
  getElementById: (id) => makeEl(id),
};
globalThis.console.table = undefined;

globalThis.SnowRng = require('../js/rng.js');
globalThis.SnowState = require('../js/state.js');
globalThis.SnowWorld = require('../js/world.js');
globalThis.SnowPhysics = require('../js/physics.js');
globalThis.SnowAudio = require('../js/audio.js');
require('../js/render.js');
require('../js/game.js');
const { SnowMailGame } = globalThis;

const canvas = makeEl('game');
canvas.width = 900;
canvas.height = 640;
const game = new SnowMailGame(canvas, {});

function fireKey(type, key) {
  for (const fn of events[`window:${type}`] || []) fn({ key, preventDefault() {}, repeat: false });
}
function click(id) {
  for (const fn of events[`${id}:click`] || []) fn({});
}

let pass = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`冒烟失败: ${msg}`);
  pass++;
  console.log(`  ✓ ${msg}`);
}

ok(game.selfTestResult.pass, '页面自检逻辑通过');
fireKey('keydown', 'arrowup');
ok(game.keys.has('arrowup'), '油门按键被识别并进入输入集合');
fireKey('keyup', 'arrowup');
fireKey('keydown', 'c');
ok(game.state.chains === true, '防滑链切换有状态反馈');
fireKey('keydown', 'c');
ok(game.state.chains === false, '再次切换卸除防滑链');

for (let i = 0; i < 120; i++) game.update(1 / 60);
ok(game.state.elapsed > 1.9, '固定步进累计游戏时间');
ok(game.state.fuel < 100, '燃油随时间消耗');
ok(game.state.path.length >= 1, '行驶路径被记录');

fireKey('keydown', 'p');
ok(game.state.status === 'paused', '暂停生效');
ok(!elements.overlay.classList.contains('hidden'), '暂停时显示覆盖层');
const fuelAtPause = game.state.fuel;
for (let i = 0; i < 30; i++) game.update(1 / 60);
ok(game.state.fuel === fuelAtPause, '暂停期间状态冻结');
fireKey('keydown', 'p');
ok(game.state.status === 'running', '恢复行驶');

const before = { x: game.state.x, y: game.state.y };
fireKey('keydown', 'r');
ok(game.state.x !== before.x || game.state.y !== before.y, 'R 键从检查点恢复位置');
ok(game.state.rescueCount === 1, '恢复次数被统计');

game.fail('测试失败：燃油耗尽');
ok(game.state.status === 'fail' && game.state.failReason.includes('燃油耗尽'), '失败场景与原因记录');
ok(!elements.overlay.classList.contains('hidden'), '失败覆盖层显示');
const stored = JSON.parse(globalThis.localStorage.getItem('snowmail.summary.v1'));
ok(stored && stored.latest && stored.latest.targetsTotal === 9, '状态摘要已写入 localStorage 且含目标数量');
ok('fuelLeft' in stored.latest && 'elapsedText' in stored.latest && 'failReason' in stored.latest, '摘要含剩余资源/用时/失败原因');
click('btn-overlay-recover');
ok(game.state.status === 'running', '失败后可从检查点恢复，无需刷新页面');
ok(game.state.fuel > 0 && game.state.health > 0, '恢复后获得救援资源');

click('btn-restart');
ok(game.state.elapsed === 0 && game.state.mail === 0, '重开重置进度');
ok(game.layoutDigest === game.selfTestResult.layoutHash, '重开后同一 seed 布局哈希不变');
const layoutBefore = JSON.stringify({
  mails: game.world.mails.map((m) => [m.x, m.y]),
  obstacles: game.world.obstacles.map((o) => [o.x, o.y]),
  checkpoints: game.world.checkpoints.map((c) => [c.x, c.y]),
  camp: game.world.camp,
});
const { generateWorld, layoutHash } = globalThis.SnowWorld;
const secondRun = generateWorld('POSTAL-ROUTE-649');
ok(layoutHash(secondRun) === game.layoutDigest, '另开一次新局：固定 seed 布局完全相同');
ok(layoutHash(generateWorld('OTHER-SEED-9')) !== game.layoutDigest, '更换 seed 才会改变布局');
const layoutAfter = JSON.stringify({
  mails: secondRun.mails.map((m) => [m.x, m.y]),
  obstacles: secondRun.obstacles.map((o) => [o.x, o.y]),
  checkpoints: secondRun.checkpoints.map((c) => [c.x, c.y]),
  camp: secondRun.camp,
});
ok(layoutBefore === layoutAfter, '两次新局关键对象坐标逐点一致');

console.log(`\nDOM 冒烟测试全部通过（${pass} 项）`);
