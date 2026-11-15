import { createGame, stepGame, pauseGame, resumeGame, restartGame, buildSummary } from './engine.js';
import { STATUS, CONFIG } from './config.js';
import { createRenderer } from './renderer.js';
import { createAudio } from './audio.js';
import { saveSummary } from './storage.js';

const DEFAULT_SEED = 20261116;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = createRenderer(ctx);
const audio = createAudio();

let state = createGame(DEFAULT_SEED);
let lastTime = performance.now();
let accumulator = 0;
let summarySaved = false;

const input = {
  accelerate: false,
  brake: false,
  left: false,
  right: false,
  deploy: false,
  calibrate: false,
  recover: false
};

const KEY_MAP = {
  ArrowUp: 'accelerate',
  KeyW: 'accelerate',
  ArrowDown: 'brake',
  KeyS: 'brake',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyE: 'deploy',
  KeyC: 'calibrate',
  KeyR: 'recover'
};

const $ = (id) => document.getElementById(id);

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (event) => {
  audio.unlock();
  if (event.code === 'KeyP' || event.code === 'Space') {
    event.preventDefault();
    togglePause();
    return;
  }
  if (event.code === 'KeyN') {
    doRestart();
    return;
  }
  if (event.code === 'KeyM') {
    $('mute').textContent = audio.toggleMute() ? '🔇 已静音 (M)' : '🔊 声音开 (M)';
    return;
  }
  const action = KEY_MAP[event.code];
  if (action) {
    event.preventDefault();
    input[action] = true;
    pulse(action);
  }
});

window.addEventListener('keyup', (event) => {
  const action = KEY_MAP[event.code];
  if (action) input[action] = false;
});

function bindHold(id, action) {
  const el = $(id);
  const down = (event) => {
    event.preventDefault();
    audio.unlock();
    input[action] = true;
    pulse(action);
    el.setPointerCapture?.(event.pointerId);
  };
  const up = (event) => {
    event.preventDefault();
    input[action] = false;
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}

bindHold('btn-up', 'accelerate');
bindHold('btn-down', 'brake');
bindHold('btn-left', 'left');
bindHold('btn-right', 'right');
bindHold('btn-calibrate', 'calibrate');
$('btn-deploy').addEventListener('click', () => {
  audio.unlock();
  input.deploy = true;
  pulse('deploy');
  setTimeout(() => { input.deploy = false; }, 90);
});
$('btn-recover').addEventListener('click', () => {
  audio.unlock();
  input.recover = true;
  pulse('recover');
  setTimeout(() => { input.recover = false; }, 90);
});
$('pause').addEventListener('click', togglePause);
$('restart').addEventListener('click', doRestart);
$('new-game').addEventListener('click', doRestart);
$('save-summary').addEventListener('click', () => {
  if (state.endSummary) saveSummary(state.endSummary, true);
});

function pulse(action) {
  const buttonId = {
    accelerate: 'btn-up',
    brake: 'btn-down',
    left: 'btn-left',
    right: 'btn-right',
    deploy: 'btn-deploy',
    calibrate: 'btn-calibrate',
    recover: 'btn-recover'
  }[action];
  const el = $(buttonId);
  el?.classList.add('pressed');
  setTimeout(() => el?.classList.remove('pressed'), 140);
}

function togglePause() {
  if (state.status === STATUS.DRIVING) {
    pauseGame(state);
    $('pause').textContent = '▶ 继续 (P)';
  } else if (state.status === STATUS.PAUSED) {
    resumeGame(state);
    $('pause').textContent = '⏸ 暂停 (P)';
  }
}

function doRestart() {
  const seed = Number($('seed').value) || DEFAULT_SEED;
  restartGame(state);
  if (state.seed !== seed) {
    const fresh = createGame(seed);
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, fresh);
  }
  summarySaved = false;
  accumulator = 0;
  lastTime = performance.now();
  $('pause').textContent = '⏸ 暂停 (P)';
  $('overlay').classList.add('hidden');
  runLayoutSelfCheck(seed);
}

function updateHud() {
  const placed = state.targets.filter((t) => t.polePlaced).length;
  $('hud-time').textContent = `${state.timeLeft.toFixed(1)}s`;
  $('hud-fuel').textContent = `${state.fuel.toFixed(1)}/${CONFIG.fuelMax}`;
  $('hud-poles').textContent = `${state.polesCarried} 杆`;
  $('hud-targets').textContent = `${placed}/${state.targets.length}`;
  $('hud-wind').textContent = `${Math.round(state.wind.strength * 100)}%`;
  $('hud-grip').textContent = CONFIG.gripLabel?.[state.vehicle.terrain] || terrainLabel(state.vehicle.terrain);
  $('hud-seed').textContent = `${state.seed} · ${state.world.fingerprint}`;
  $('fuel-bar').style.width = `${(state.fuel / CONFIG.fuelMax) * 100}%`;
  $('calibration-progress').style.width = `${state.compass.calibrating ? state.compass.progress * 100 : 0}%`;

  const eventList = $('events');
  if (eventList.dataset.sig !== JSON.stringify(state.events[0] || null)) {
    eventList.innerHTML = state.events
      .slice(0, 7)
      .map((event) => `<li class="${event.kind}">[${event.t.toFixed(0)}s] ${event.text}</li>`)
      .join('');
    eventList.dataset.sig = JSON.stringify(state.events[0] || null);
  }

  for (const key of Object.keys(input)) {
    const el = $(`indicator-${key}`);
    if (el) el.classList.toggle('active', input[key] || (state.flash[key] || 0) > 0);
  }
}

function terrainLabel(type) {
  if (type === 'sand') return '沙地 72%';
  if (type === 'silt') return '粉土 48%';
  return '砾石 100%';
}

function showEndOverlay() {
  if (state.status !== STATUS.WON && state.status !== STATUS.FAILED) return;
  if (!state.endSummary) state.endSummary = buildSummary(state);
  const summary = state.endSummary;
  const overlay = $('overlay');
  overlay.classList.remove('hidden', 'win', 'fail');
  overlay.classList.add(summary.status === STATUS.WON ? 'win' : 'fail');
  $('overlay-title').textContent = summary.status === STATUS.WON ? '任务完成' : '任务失败';
  $('overlay-reason').textContent = summary.endReason;
  $('overlay-stats').innerHTML = `
    <li>目标完成：${summary.targetsCompleted}/${summary.targetsTotal}</li>
    <li>剩余燃料：${summary.fuelLeft}/${summary.fuelMax}</li>
    <li>最终用时：${summary.elapsed}s / ${summary.timeLimit}s</li>
    <li>携带测量杆：${summary.polesCarried}，脱落未回收：${summary.droppedPolesRemaining}</li>
    <li>路径采样点：${summary.pathPoints}</li>
    <li>Seed / 布局指纹：${summary.seed} / ${summary.layoutFingerprint}</li>
  `;
  drawMiniMap();
  if (!summarySaved) {
    saveSummary(summary);
    summarySaved = true;
  }
}

function drawMiniMap() {
  const map = $('overlay-map');
  const mc = map.getContext('2d');
  const scale = Math.min(map.width / state.world.width, map.height / state.world.height);
  const ox = (map.width - state.world.width * scale) / 2;
  const oy = (map.height - state.world.height * scale) / 2;
  const px = (x) => ox + x * scale;
  const py = (y) => oy + y * scale;
  mc.fillStyle = '#20282e';
  mc.fillRect(0, 0, map.width, map.height);
  mc.strokeStyle = 'rgba(232,226,210,0.6)';
  mc.strokeRect(ox, oy, state.world.width * scale, state.world.height * scale);

  mc.strokeStyle = '#6fb3e0';
  mc.lineWidth = 1.5;
  mc.beginPath();
  state.path.forEach((point, i) => {
    if (i === 0) mc.moveTo(px(point.x), py(point.y));
    else mc.lineTo(px(point.x), py(point.y));
  });
  mc.stroke();

  for (const target of state.targets) {
    mc.fillStyle = target.polePlaced ? '#6fbf83' : '#e2604d';
    mc.beginPath();
    mc.arc(px(target.x), py(target.y), 4, 0, Math.PI * 2);
    mc.fill();
  }
  mc.fillStyle = '#d9c98f';
  mc.fillRect(px(state.world.camp.x) - 4, py(state.world.camp.y) - 4, 8, 8);
  mc.fillStyle = '#e8e2d2';
  mc.font = '10px sans-serif';
  mc.textAlign = 'left';
  mc.fillText('蓝线=行驶路径  绿点=已布杆  方块=营地', 6, map.height - 8);
}

function showStrandedBanner() {
  const banner = $('stranded-banner');
  if (state.status === STATUS.STRANDED) {
    banner.classList.remove('hidden');
    banner.textContent = `⚠ ${state.endReason} 按 R 或点击“检查点恢复”，将回到最近检查点（耗油 ${CONFIG.recoverFuelCost}、耗时 ${CONFIG.recoverTimeCost}s）`;
  } else {
    banner.classList.add('hidden');
  }
}

function frame(now) {
  const frameDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (state.status !== STATUS.PAUSED && state.status !== STATUS.WON && state.status !== STATUS.FAILED) {
    accumulator = Math.min(accumulator + frameDt, 8 / 30);
    const step = 1 / 30;
    let loops = 0;
    while (accumulator >= step && loops < 8) {
      stepGame(state, step, input);
      accumulator -= step;
      loops += 1;
    }
  }
  audio.update(state);
  renderer.render(state, { width: canvas.width, height: canvas.height });
  updateHud();
  showStrandedBanner();
  showEndOverlay();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function runLayoutSelfCheck(seed) {
  const first = createGame(seed);
  const second = createGame(seed);
  const sameFingerprint = first.world.fingerprint === second.world.fingerprint;
  const sameRocks = JSON.stringify(first.world.rocks) === JSON.stringify(second.world.rocks);
  const sameTargets = JSON.stringify(first.world.targets) === JSON.stringify(second.world.targets);
  const ok = sameFingerprint && sameRocks && sameTargets;
  const el = $('layout-check');
  el.className = `layout-check ${ok ? 'ok' : 'bad'}`;
  el.innerHTML = ok
    ? `同 seed 连开两局：布局一致<br/>指纹 <code>${first.world.fingerprint}</code><br/>测点/岩台/地标位置逐值相同`
    : '布局自检失败：两次生成结果不一致';
}

runLayoutSelfCheck(DEFAULT_SEED);
