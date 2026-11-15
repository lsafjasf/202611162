import { CONFIG, INPUTS } from './config.js';
import { createGame, step, buildSummary, restoreCheckpoint } from './engine.js';
import { layoutSignature } from './world.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = createRenderer(ctx, canvas);
const audio = createAudio();

const STORAGE_KEY = 'cleanup-boat-summary-v1';

let state = createGame(CONFIG.seed);
let prevEventCount = 0;
let savedForEnd = false;
const ui = {
  input: { up: false, down: false, left: false, right: false, cableUp: false, cableDown: false },
  pressedGrab: false
};
const pressedEdges = new Set();
const keyMap = {
  ArrowUp: INPUTS.UP, KeyW: INPUTS.CABLE_UP,
  ArrowDown: INPUTS.DOWN, KeyS: INPUTS.CABLE_DOWN,
  ArrowLeft: INPUTS.LEFT, ArrowRight: INPUTS.RIGHT,
  Space: INPUTS.GRAB, KeyG: INPUTS.GRAB
};

window.addEventListener('keydown', (e) => {
  audio.resume();
  if (e.code === 'KeyP' || e.code === 'Escape') return togglePause();
  if (e.code === 'KeyR') return restartSameSeed();
  if (e.code === 'KeyN') return newRunSameSeed();
  if (e.code === 'KeyM') return toggleMute();
  if (e.code === 'KeyH') return toggleHelp();
  if (e.code === 'KeyK') return manualRecover();
  const action = keyMap[e.code];
  if (!action) return;
  e.preventDefault();
  if (e.repeat) return;
  if (action === INPUTS.GRAB) {
    pressedEdges.add(INPUTS.GRAB);
    ui.pressedGrab = true;
    setTimeout(() => (ui.pressedGrab = false), 180);
  } else {
    ui.input[action] = true;
  }
});

window.addEventListener('keyup', (e) => {
  const action = keyMap[e.code];
  if (action && action !== INPUTS.GRAB) ui.input[action] = false;
});

function togglePause() {
  if (state.status === 'running') state.status = 'paused';
  else if (state.status === 'paused') state.status = 'running';
}

function restartSameSeed() {
  state = createGame(CONFIG.seed);
  prevEventCount = 0;
  savedForEnd = false;
  pressedEdges.clear();
  Object.keys(ui.input).forEach((k) => (ui.input[k] = false));
  flashBanner('已用同一 seed 重开');
}

// 另开一次新局：验证同 seed 下关键对象布局完全相同。
function newRunSameSeed() {
  const probe = createGame(CONFIG.seed);
  const same = layoutSignature(probe.world) === layoutSignature(state.world);
  state = probe;
  prevEventCount = 0;
  savedForEnd = false;
  flashBanner(same ? '新局布局与上一局一致（同 seed 校验通过）' : '警告：布局不一致！');
  document.getElementById('seed-check').textContent =
    `同 seed 布局校验：${same ? '通过 ✓' : '失败 ✗'}`;
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  document.getElementById('mute-btn').textContent = audio.muted ? '🔇 已静音(M)' : '🔊 声音(M)';
}

function toggleHelp() {
  const panel = document.getElementById('help');
  panel.hidden = !panel.hidden;
}

function manualRecover() {
  if (state.status !== 'running' || !state.checkpoint) return;
  restoreCheckpoint(state, '玩家手动恢复');
  flashBanner('已从最近检查点恢复（未刷新页面）');
}

function flashBanner(text) {
  const el = document.getElementById('banner');
  el.textContent = text;
  el.style.opacity = '1';
  setTimeout(() => (el.style.opacity = '0'), 2200);
}

function saveSummary() {
  const summary = buildSummary(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(summary, null, 2));
  } catch (err) {
    console.warn('localStorage 不可用，摘要仅输出到控制台', err);
  }
  console.table({
    status: summary.status,
    finalTime: summary.finalTimeSeconds,
    wood: summary.targets.collected.wood,
    reed: summary.targets.collected.reed,
    drum: summary.targets.collected.drum,
    hazardMissed: summary.targets.hazardMissed,
    fuel: summary.resources.fuelRemaining,
    hull: summary.resources.hullRemaining,
    score: summary.resources.score
  });
  return summary;
}

function handleEvents() {
  if (state.events.length === prevEventCount) return;
  const fresh = state.events.slice(0, state.events.length - prevEventCount);
  for (const ev of fresh) {
    if (ev.kind === 'collision') audio.collision();
    else if (ev.kind === 'unload') audio.unload();
    else if (ev.kind === 'grab' || ev.kind === 'checkpoint' || ev.kind === 'snap' || ev.kind === 'miss') {
      audio.blip(ev.kind);
    }
  }
  prevEventCount = state.events.length;
  if ((state.status === 'won' || state.status === 'lost') && !savedForEnd) {
    saveSummary();
    savedForEnd = true;
  }
}

// 固定步长循环：显示帧率可以波动，模拟始终按 fixedDt 推进，保证确定性。
let last = performance.now();
let acc = 0;
function frame(now) {
  let frameTime = (now - last) / 1000;
  last = now;
  frameTime = Math.min(frameTime, 0.1);
  if (state.status === 'running') {
    acc += frameTime;
    while (acc >= CONFIG.fixedDt) {
      const pressed = { [INPUTS.GRAB]: pressedEdges.has(INPUTS.GRAB) };
      step(state, ui.input, pressed);
      pressedEdges.delete(INPUTS.GRAB);
      acc -= CONFIG.fixedDt;
      handleEvents();
      if (state.status !== 'running') break;
    }
    const b = state.boat;
    const inEddy = state.world.eddies.some(
      (e) => Math.hypot(b.x - e.x, b.y - e.y) < CONFIG.eddy.radius
    );
    audio.update(Math.hypot(b.vx, b.vy), inEddy, state.tension);
  }
  renderer.draw(state, ui);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 屏幕按钮：同样走输入通道，每次点击都触发可见反馈。
function bindHold(buttonId, action) {
  const el = document.getElementById(buttonId);
  const on = (e) => {
    e.preventDefault();
    audio.resume();
    ui.input[action] = true;
  };
  const off = (e) => {
    e.preventDefault();
    ui.input[action] = false;
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}
bindHold('btn-up', INPUTS.UP);
bindHold('btn-down', INPUTS.DOWN);
bindHold('btn-left', INPUTS.LEFT);
bindHold('btn-right', INPUTS.RIGHT);
bindHold('btn-cable-up', INPUTS.CABLE_UP);
bindHold('btn-cable-down', INPUTS.CABLE_DOWN);

document.getElementById('btn-grab').addEventListener('click', () => {
  audio.resume();
  pressedEdges.add(INPUTS.GRAB);
  ui.pressedGrab = true;
  setTimeout(() => (ui.pressedGrab = false), 180);
});
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-restart').addEventListener('click', restartSameSeed);
document.getElementById('btn-newrun').addEventListener('click', newRunSameSeed);
document.getElementById('btn-recover').addEventListener('click', manualRecover);
document.getElementById('mute-btn').addEventListener('click', toggleMute);
document.getElementById('help-btn').addEventListener('click', toggleHelp);

// 启动即做一次同 seed 布局自检并展示结果。
{
  const a = layoutSignature(createGame(CONFIG.seed).world);
  const b = layoutSignature(createGame(CONFIG.seed).world);
  document.getElementById('seed-check').textContent =
    `同 seed 布局校验：${a === b ? '通过 ✓' : '失败 ✗'}`;
  document.getElementById('seed-label').textContent = `seed ${CONFIG.seed}`;
}
