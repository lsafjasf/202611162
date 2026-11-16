import {
  DEFAULTS, validateParams, layout, makeViewTransform, createAnimClock,
  serializeParams, deserializeParams, exportSVG, sceneHash, summarizeScene,
} from './engine.js';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

// --- state -----------------------------------------------------------------
let params = { ...DEFAULTS };
let lastGoodScene = null;   // kept so invalid params never blank the canvas
let currentScene = null;
let lastErrorMessages = [];
const clock = createAnimClock();
const undoStack = [];
const redoStack = [];
const PRESET_KEY = 'toc-presets-v1';

// Canvas-backed measurer; recreated when fontSize changes. Words are
// measured whole so mixed CJK/Latin text never splits a word.
let measurer = null;
let measurerFontSize = 0;
function getMeasurer(fontSize) {
  if (measurer && measurerFontSize === fontSize) return measurer;
  measurerFontSize = fontSize;
  ctx.font = `${fontSize}px sans-serif`;
  const probe = ctx.measureText('国Mg');
  measurer = {
    measure(atom) {
      ctx.font = `${fontSize}px sans-serif`;
      return ctx.measureText(atom.text).width;
    },
    metrics: {
      ascent: probe.actualBoundingBoxAscent ?? fontSize * 0.8,
      descent: probe.actualBoundingBoxDescent ?? fontSize * 0.2,
    },
  };
  return measurer;
}

// --- rendering -------------------------------------------------------------
function render(scene, viewParams) {
  const { width, height } = viewParams;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Single world->screen transform for text AND annotations: no drift.
  const t = makeViewTransform(viewParams);
  ctx.setTransform(
    t.scale * Math.cos(t.rotation), t.scale * Math.sin(t.rotation),
    -t.scale * Math.sin(t.rotation), t.scale * Math.cos(t.rotation),
    width / 2 + viewParams.panX - t.scale * (Math.cos(t.rotation) * width / 2 - Math.sin(t.rotation) * height / 2),
    height / 2 + viewParams.panY - t.scale * (Math.sin(t.rotation) * width / 2 + Math.cos(t.rotation) * height / 2),
  );

  for (const item of scene.drawList) {
    ctx.globalAlpha = item.alpha;
    if (item.type === 'background' || item.type === 'grid') continue;
    if (item.type === 'safeArea') {
      if (!viewParams.showSafeArea) continue;
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5 / t.scale;
      ctx.strokeRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
      ctx.setLineDash([]);
    } else if (item.type === 'polyline') {
      ctx.strokeStyle = item.id === 'baseline' ? '#3b82f6' : '#94a3b8';
      ctx.lineWidth = (item.id === 'baseline' ? 1.5 : 1) / t.scale;
      if (item.id === 'curve-guide') ctx.setLineDash([6, 4]);
      ctx.beginPath();
      item.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (item.type === 'atom') {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.angle);
      ctx.font = `${scene.params.fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = item.outside ? '#dc2626' : '#1e293b';
      ctx.fillText(item.text, 0, 0);
      if (item.outside) {
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5 / t.scale;
        const m = scene.params.fontSize;
        ctx.strokeRect(-item.width / 2 - 2, -m, item.width + 4, m * 1.25);
      }
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// --- main loop -------------------------------------------------------------
function frame(tms) {
  const time = clock.now(tms) / 1000;
  const scene = layout(params, getMeasurer(params.fontSize), { time });
  currentScene = scene;
  if (scene.ok) {
    lastGoodScene = scene;
    lastErrorMessages = [];
  } else {
    // Invalid params: keep last good frame, show explicit errors.
    lastErrorMessages = scene.errors;
  }
  render(lastGoodScene ?? scene, params);
  updateStatus(lastGoodScene ?? scene);
  requestAnimationFrame(frame);
}

function updateStatus(scene) {
  const errBox = $('errors');
  const warnBox = $('warnings');
  if (lastErrorMessages.length > 0) {
    errBox.hidden = false;
    errBox.textContent = '参数错误:\n' + lastErrorMessages.join('\n');
  } else {
    errBox.hidden = true;
  }
  if (scene.warnings.length > 0) {
    warnBox.hidden = false;
    warnBox.textContent = scene.warnings.join('\n');
  } else {
    warnBox.hidden = true;
  }
  $('scene-hash').textContent = sceneHash(scene);
  const s = scene.stats;
  $('stats-line').textContent = s
    ? `对象 ${s.drawCount} · 文字单元 ${s.atomCount} (词 ${s.wordCount}/汉 ${s.cjkCount}) · 弧长 ${s.totalLength}/${s.pathLength}`
    : '无有效排版结果';
}

// --- controls ---------------------------------------------------------------
const FIELD_MAP = {
  'in-text': 'text', 'in-fontSize': 'fontSize',
  'in-letterSpacing': 'letterSpacing', 'in-baselineOffset': 'baselineOffset',
  'in-radius': 'radius', 'in-arcAngle': 'arcAngle', 'in-align': 'align',
  'in-animSpeed': 'animSpeed', 'in-zoom': 'zoom', 'in-rotation': 'rotation',
  'in-showSafeArea': 'showSafeArea',
};

function syncInputs() {
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = params[key];
    else el.value = params[key];
  }
}

let undoTimer = null;
let pendingSnapshot = null;
function pushUndo() {
  // Capture the state BEFORE this burst of edits; commit after a short
  // debounce so a slider drag becomes one undo step.
  if (pendingSnapshot === null) pendingSnapshot = serializeParams(params);
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    if (pendingSnapshot !== null
        && undoStack[undoStack.length - 1] !== pendingSnapshot) {
      undoStack.push(pendingSnapshot);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    }
    pendingSnapshot = null;
  }, 250);
}

function applyParams(next, { recordUndo = true } = {}) {
  if (recordUndo) pushUndo();
  params = { ...params, ...next };
  syncInputs();
}

for (const [id, key] of Object.entries(FIELD_MAP)) {
  $(id).addEventListener('input', (e) => {
    const el = e.target;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? NaN : Number(el.value);
    else v = el.value;
    applyParams({ [key]: v });
  });
}

// --- buttons: pause / undo / redo / reset ----------------------------------
$('btn-pause').addEventListener('click', () => {
  const t = performance.now();
  if (clock.paused) {
    clock.resume(t);
    $('btn-pause').textContent = '暂停';
  } else {
    clock.pause(t);
    $('btn-pause').textContent = '继续';
  }
});

function undo() {
  clearTimeout(undoTimer);
  if (pendingSnapshot !== null) {
    undoStack.push(pendingSnapshot);
    pendingSnapshot = null;
  }
  if (undoStack.length === 0) return;
  redoStack.push(serializeParams(params));
  const { params: p } = deserializeParams(undoStack.pop());
  if (p) { params = p; syncInputs(); }
}
function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(serializeParams(params));
  const { params: p } = deserializeParams(redoStack.pop());
  if (p) { params = p; syncInputs(); }
}
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
});

$('btn-reset').addEventListener('click', () => {
  applyParams({ ...DEFAULTS });
  clock.reset();
});

// --- presets (localStorage) -------------------------------------------------
function loadPresetStore() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY)) ?? {}; }
  catch { return {}; }
}
function refreshPresetList() {
  const sel = $('preset-list');
  sel.innerHTML = '';
  for (const name of Object.keys(loadPresetStore())) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
}
$('btn-save').addEventListener('click', () => {
  const name = prompt('参数方案名称:', '方案1');
  if (!name) return;
  const store = loadPresetStore();
  store[name] = serializeParams(params);
  localStorage.setItem(PRESET_KEY, JSON.stringify(store));
  refreshPresetList();
});
$('btn-load-preset').addEventListener('click', () => {
  const name = $('preset-list').value;
  const json = loadPresetStore()[name];
  if (!json) return;
  const { params: p, errors } = deserializeParams(json);
  if (p) applyParams(p);
  if (errors.length) alert('载入警告:\n' + errors.join('\n'));
});
$('btn-del-preset').addEventListener('click', () => {
  const name = $('preset-list').value;
  const store = loadPresetStore();
  delete store[name];
  localStorage.setItem(PRESET_KEY, JSON.stringify(store));
  refreshPresetList();
});

// --- export / import / screenshot ------------------------------------------
function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btn-export-json').addEventListener('click', () => {
  download('text-curve-params.json',
    new Blob([serializeParams(params)], { type: 'application/json' }));
});
$('btn-import-json').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { params: p, errors } = deserializeParams(await file.text());
  if (p) applyParams(p);
  if (errors.length) alert('导入警告:\n' + errors.join('\n'));
  e.target.value = '';
});
$('btn-export-svg').addEventListener('click', () => {
  const scene = lastGoodScene ?? currentScene;
  if (!scene) return;
  download('text-curve.svg',
    new Blob([exportSVG(scene)], { type: 'image/svg+xml' }));
});
$('btn-shot').addEventListener('click', () => {
  canvas.toBlob((blob) => download('text-curve.png', blob), 'image/png');
});

// Deterministic pixel hash of the canvas (for tests / consistency checks).
function canvasHash() {
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 97) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// --- test / automation API ---------------------------------------------------
window.__app = {
  getParams: () => ({ ...params }),
  setParams: (next) => applyParams(next, { recordUndo: false }),
  getScene: () => currentScene,
  getLastGoodScene: () => lastGoodScene,
  getErrors: () => [...lastErrorMessages],
  sceneHash: () => sceneHash(lastGoodScene ?? currentScene),
  summarize: () => summarizeScene(lastGoodScene ?? currentScene),
  canvasHash,
  pause: () => { if (!clock.paused) $('btn-pause').click(); },
  resume: () => { if (clock.paused) $('btn-pause').click(); },
  isPaused: () => clock.paused,
  clockTime: () => clock.now(performance.now()),
  undo, redo,
  savePreset: (name) => {
    const store = loadPresetStore();
    store[name] = serializeParams(params);
    localStorage.setItem(PRESET_KEY, JSON.stringify(store));
    refreshPresetList();
  },
  loadPreset: (name) => {
    const { params: p, errors } = deserializeParams(loadPresetStore()[name] ?? '');
    if (p) applyParams(p);
    return errors;
  },
  exportSVG: () => exportSVG(lastGoodScene ?? currentScene),
  serialize: () => serializeParams(params),
};

// --- boot --------------------------------------------------------------------
syncInputs();
refreshPresetList();
clock.resume(performance.now());
requestAnimationFrame(frame);
