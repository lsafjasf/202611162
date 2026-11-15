// app.js — 浏览器端交互：拖动视点、缩放旋转、图层、撤销、保存/载入、导出、暂停
(function () {
  'use strict';
  const S = window.IsoScene;
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const errorBox = document.getElementById('error');
  const statusBox = document.getElementById('status');

  const state = {
    params: S.defaultParams(),
    scene: null,
    view: null,
    layers: S.defaultLayers(),
    clock: S.createClock(),
    history: [],
  };

  function resize() {
    canvas.width = Math.max(320, window.innerWidth - 280);
    canvas.height = window.innerHeight;
    if (!state.view) state.view = S.defaultView(canvas.width, canvas.height);
    state.view.originX = canvas.width / 2;
    state.view.originY = canvas.height / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  function showError(msg) {
    errorBox.style.display = 'block';
    errorBox.textContent = '⚠ ' + msg;
  }
  function clearError() {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }

  // 简单稳定哈希（FNV-1a），用于界面展示几何状态摘要
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function geometrySummary() {
    const sc = state.scene;
    return JSON.stringify({
      b: sc.buildings.map(b => [b.id, +b.x.toFixed(4), +b.y.toFixed(4), +b.h.toFixed(4)]),
      t: sc.trees.length, l: sc.lamps.length, p: sc.pedestrians.length,
    });
  }

  function updateStatus() {
    const sc = state.scene;
    statusBox.textContent =
      `对象: 建筑${sc.buildings.length} 树${sc.trees.length} 灯${sc.lamps.length} 行人${sc.pedestrians.length}\n` +
      `几何哈希: ${fnv1a(geometrySummary())}\n` +
      `视图: rot=${state.view.rot.toFixed(3)} zoom=${state.view.zoom.toFixed(1)}\n` +
      `动画: ${state.clock.paused ? '已暂停' : '运行中'} t=${state.clock.time.toFixed(2)}s`;
  }

  function render() {
    try {
      const cmds = S.buildDrawCommands(state.scene, state.view, state.layers, state.clock.time);
      S.drawCommands(ctx, cmds, canvas.width, canvas.height);
    } catch (e) {
      showError('渲染失败: ' + e.message); // 保留上一帧，不清屏
    }
  }

  function frame(ts) {
    state.clock.tick(ts); // 暂停时 lastTs 仍更新，恢复后不会跳帧
    render();
    updateStatus();
    requestAnimationFrame(frame);
  }

  // ---------- 视图交互 ----------
  let drag = null;
  canvas.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY, rotate: e.button === 2 || e.shiftKey };
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.rotate) state.view.rot += dx * 0.01;
    else { state.view.panX += dx; state.view.panY += dy; }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.view.zoom = Math.min(40, Math.max(4, state.view.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, { passive: false });
  // ---------- 参数应用 / 撤销 ----------
  const PARAM_KEYS = ['seed', 'buildingCount', 'treeCount', 'lampCount', 'pedestrianCount', 'streetLength', 'streetWidth'];

  function fillParamInputs() {
    for (const k of PARAM_KEYS) document.getElementById('p-' + k).value = state.params[k];
    const sel = document.getElementById('sel-building');
    sel.innerHTML = '';
    state.scene.buildings.forEach((b, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${b.id} (h=${b.h.toFixed(1)})`;
      sel.appendChild(opt);
    });
    const b0 = state.scene.buildings[Number(sel.value) || 0];
    if (b0) document.getElementById('in-height').value = b0.h.toFixed(1);
  }

  function applyParams(next, pushHistory) {
    const chk = S.validateParams(next);
    if (!chk.ok) {
      showError('参数无效，已保留当前画面：\n' + chk.errors.join('\n'));
      return false;
    }
    if (pushHistory !== false) state.history.push(JSON.parse(JSON.stringify(state.params)));
    state.params = chk.value;
    state.scene = S.generateScene(state.params);
    clearError();
    fillParamInputs();
    return true;
  }

  document.getElementById('btn-apply').addEventListener('click', () => {
    const next = {};
    for (const k of PARAM_KEYS) next[k] = document.getElementById('p-' + k).value;
    next.heights = state.params.heights;
    applyParams(next);
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    const prev = state.history.pop();
    if (!prev) { showError('没有可撤销的操作'); return; }
    applyParams(prev, false);
  });

  document.getElementById('btn-height').addEventListener('click', () => {
    const idx = Number(document.getElementById('sel-building').value);
    const h = Number(document.getElementById('in-height').value);
    const heights = state.scene.buildings.map(() => null);
    heights[idx] = h;
    const next = Object.assign({}, state.params, { heights });
    applyParams(next);
  });

  document.getElementById('sel-building').addEventListener('change', (e) => {
    const b = state.scene.buildings[Number(e.target.value)];
    if (b) document.getElementById('in-height').value = b.h.toFixed(1);
  });

  // ---------- 图层 ----------
  const LAYER_NAMES = { ground: '地面', buildings: '建筑', trees: '树木', lamps: '路灯', pedestrians: '行人', shadows: '阴影', labels: '标注' };
  const layerBox = document.getElementById('layer-box');
  for (const key of Object.keys(LAYER_NAMES)) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.layers[key];
    cb.addEventListener('change', () => { state.layers[key] = cb.checked; });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + LAYER_NAMES[key]));
    layerBox.appendChild(label);
  }

  // ---------- 视图按钮 ----------
  document.getElementById('btn-rot-l').addEventListener('click', () => { state.view.rot -= Math.PI / 12; });
  document.getElementById('btn-rot-r').addEventListener('click', () => { state.view.rot += Math.PI / 12; });
  document.getElementById('btn-zoom-in').addEventListener('click', () => { state.view.zoom = Math.min(40, state.view.zoom * 1.2); });
  document.getElementById('btn-zoom-out').addEventListener('click', () => { state.view.zoom = Math.max(4, state.view.zoom / 1.2); });
  document.getElementById('btn-view-reset').addEventListener('click', () => {
    state.view = S.defaultView(canvas.width, canvas.height);
  });

  // ---------- 暂停 / 导出 / 保存 / 载入 ----------
  document.getElementById('btn-pause').addEventListener('click', (e) => {
    if (state.clock.paused) { state.clock.resume(); e.target.textContent = '暂停'; }
    else { state.clock.pause(); e.target.textContent = '恢复'; }
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    render(); // 确保导出的是当前帧
    const a = document.createElement('a');
    a.download = 'iso-street-' + Date.now() + '.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  document.getElementById('btn-save').addEventListener('click', () => {
    const data = JSON.stringify({ params: state.params, view: state.view }, null, 2);
    try { localStorage.setItem('iso-street-params', data); } catch (e) { /* 隐私模式等 */ }
    const a = document.createElement('a');
    a.download = 'iso-street-params.json';
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.click();
  });

  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('file-load').click();
  });
  document.getElementById('file-load').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (applyParams(data.params)) {
          if (data.view) state.view = Object.assign(S.defaultView(canvas.width, canvas.height), data.view);
        }
      } catch (err) {
        showError('载入失败: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  // ---------- 启动 ----------
  if (!applyParams(state.params, false)) throw new Error('默认参数无效');
  try {
    const saved = localStorage.getItem('iso-street-params');
    if (saved) {
      const data = JSON.parse(saved);
      if (applyParams(data.params, false) && data.view) {
        state.view = Object.assign(S.defaultView(canvas.width, canvas.height), data.view);
      }
    }
  } catch (e) { /* 忽略损坏的本地存档 */ }
  requestAnimationFrame(frame);
})();
