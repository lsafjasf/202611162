/* 浏览器主控：固定步长循环、输入反馈、暂停/重开/恢复、摘要与持久化。 */
(function () {
  'use strict';

  var DEFAULT_SEED = 'MARSH-SEED-2026';
  var Game = window.MarshGame;
  var Renderer = window.MarshRenderer;
  var AudioEngine = window.MarshAudio;

  var canvas = document.getElementById('game');
  var audio = new AudioEngine();
  var renderer = null;
  var state = null;
  var paused = false;
  var lastTs = 0;
  var accumulator = 0;
  var muted = false;
  var lastEventType = null;

  var el = {
    fuel: document.getElementById('fuel-fill'),
    fuelText: document.getElementById('fuel-text'),
    samples: document.getElementById('samples-text'),
    time: document.getElementById('time-text'),
    tide: document.getElementById('tide-fill'),
    tideText: document.getElementById('tide-text'),
    seed: document.getElementById('seed-text'),
    hash: document.getElementById('hash-text'),
    log: document.getElementById('event-log'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayBody: document.getElementById('overlay-body'),
    buttons: {}
  };

  ['btn-up', 'btn-down', 'btn-left', 'btn-right', 'btn-action',
   'btn-pause', 'btn-restart', 'btn-recover', 'btn-mute'].forEach(function (id) {
    el.buttons[id] = document.getElementById(id);
  });

  function newGame(seedText) {
    state = Game.createGame(seedText || DEFAULT_SEED);
    paused = false;
    accumulator = 0;
    summarized = false;
    lastEventType = null;
    renderer = new Renderer(canvas, state.world);
    renderer.resize();
    window.__marshState = state;
    el.seed.textContent = state.seed;
    el.hash.textContent = state.world.layoutHash;
    el.overlay.style.display = 'none';
    el.log.innerHTML = '';
    pushLog('info', '新局开始，布局哈希 ' + state.world.layoutHash);
    updateHud();
  }

  window.addEventListener('resize', function () {
    if (renderer) renderer.resize();
  });

  function pushLog(kind, message) {
    var row = document.createElement('div');
    row.className = 'log-' + kind;
    row.textContent = '[' + state.time.toFixed(1) + 's] ' + message;
    el.log.insertBefore(row, el.log.firstChild);
    while (el.log.children.length > 9) el.log.removeChild(el.log.lastChild);
  }

  function syncLog() {
    var newest = state.events[state.events.length - 1];
    if (newest && newest !== lastEventType) {
      lastEventType = newest;
      pushLog(newest.type, newest.message);
      if (newest.type === 'fail' || newest.type === 'entangle') audio.scrape();
      if (newest.type === 'sample' || newest.type === 'checkpoint') audio.blip(660, 0.18, 'sine', 0.2);
      if (newest.type === 'recover') audio.splash();
    }
  }

  var keyMap = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'action'
  };

  function setControl(key, pressed, sourceId) {
    Game.setInput(state, key, pressed);
    var btn = el.buttons['btn-' + key];
    if (btn) btn.classList.toggle('active', pressed);
    if (pressed) pulse(sourceId || ('btn-' + key));
  }

  function pulse(id) {
    var node = id && document.getElementById(id);
    if (!node) return;
    node.classList.remove('pulse');
    void node.offsetWidth;
    node.classList.add('pulse');
  }

  window.addEventListener('keydown', function (e) {
    if (keyMap[e.code]) {
      e.preventDefault();
      audio.ensure();
      if (!paused && state.status === 'running') setControl(keyMap[e.code], true);
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      togglePause();
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      doRecover();
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      audio.ensure();
      var seedInput = document.getElementById('seed-input');
      newGame((seedInput.value || '').trim() || DEFAULT_SEED);
    }
  });

  window.addEventListener('keyup', function (e) {
    if (keyMap[e.code]) {
      e.preventDefault();
      setControl(keyMap[e.code], false);
    }
  });

  function bindHold(id, key) {
    var node = el.buttons[id];
    var down = function (e) {
      e.preventDefault();
      audio.ensure();
      if (!paused && state.status === 'running') setControl(key, true, id);
    };
    var up = function (e) {
      e.preventDefault();
      setControl(key, false, id);
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointerleave', up);
  }

  bindHold('btn-up', 'up');
  bindHold('btn-down', 'down');
  bindHold('btn-left', 'left');
  bindHold('btn-right', 'right');
  bindHold('btn-action', 'action');

  function togglePause() {
    if (state.status !== 'running') return;
    paused = !paused;
    pulse('btn-pause');
    el.buttons['btn-pause'].textContent = paused ? '继续 (P)' : '暂停 (P)';
    pushLog('info', paused ? '游戏已暂停' : '游戏继续');
  }

  function doRecover() {
    if (state.status !== 'running') return;
    audio.ensure();
    var before = state.recoveries;
    Game.recover(state);
    pulse('btn-recover');
    if (state.recoveries !== before) audio.splash();
  }

  el.buttons['btn-pause'].addEventListener('click', togglePause);
  el.buttons['btn-recover'].addEventListener('click', doRecover);
  el.buttons['btn-restart'].addEventListener('click', function () {
    audio.ensure();
    pulse('btn-restart');
    newGame(state.seed);
  });
  el.buttons['btn-mute'].addEventListener('click', function () {
    muted = !muted;
    audio.setMuted(muted);
    el.buttons['btn-mute'].textContent = muted ? '取消静音' : '静音';
    pulse('btn-mute');
  });

  function updateHud() {
    var pct = (state.fuel / Game.FUEL_MAX) * 100;
    el.fuel.style.width = pct + '%';
    el.fuel.className = 'bar-fill ' + (pct < 25 ? 'danger' : pct < 50 ? 'warn' : 'ok');
    el.fuelText.textContent = state.fuel.toFixed(1) + ' / ' + Game.FUEL_MAX;
    el.samples.textContent = state.collected + ' / 3' + (state.collected === 3 ? '（返航）' : '');
    el.time.textContent = state.time.toFixed(1) + ' / ' + Game.LIMIT + ' s';
    var tideNow = Game.tideOffset(state.time);
    var tidePct = ((tideNow + 0.2) / 0.36) * 100;
    el.tide.style.width = Math.max(0, Math.min(100, tidePct)) + '%';
    el.tideText.textContent = tideNow > 0.05 ? '高水位' : tideNow < -0.12 ? '低水位（航道变窄）' : '退潮中';
  }

  function showSummary() {
    var summary = Game.buildSummary(state);
    saveSummary(summary);
    el.overlay.style.display = 'flex';
    el.overlayTitle.textContent = summary.status === 'won' ? '任务完成' : '任务失败';
    var rows = [
      ['结果', summary.result],
      ['失败原因', summary.failureReason || '—'],
      ['泥样目标', summary.samplesCollected + ' / ' + summary.targetTotal + '（剩余 ' + summary.samplesRemaining + '）'],
      ['剩余燃料', summary.fuelRemaining + ' / ' + summary.fuelMax],
      ['最终用时', summary.elapsed + ' / ' + summary.timeLimit + ' s'],
      ['恢复次数', summary.recoveries],
      ['路径点数', summary.pathPoints],
      ['布局哈希', summary.layoutHash],
      ['种子', summary.seed]
    ];
    el.overlayBody.innerHTML = rows.map(function (r) {
      return '<div class="summary-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
    }).join('') +
      '<div class="summary-path">黄色虚线为本局实际航行路径，完整路径与事件已保存到 localStorage（marsh_last_summary）。</div>';
  }

  function saveSummary(summary) {
    try {
      localStorage.setItem('marsh_last_summary', JSON.stringify(summary));
      var history = JSON.parse(localStorage.getItem('marsh_history') || '[]');
      history.push({
        at: new Date().toISOString(),
        seed: summary.seed,
        layoutHash: summary.layoutHash,
        status: summary.status,
        samplesCollected: summary.samplesCollected,
        targetTotal: summary.targetTotal,
        fuelRemaining: summary.fuelRemaining,
        elapsed: summary.elapsed,
        failureReason: summary.failureReason
      });
      localStorage.setItem('marsh_history', JSON.stringify(history.slice(-20)));
    } catch (err) {
      pushLog('error', '摘要保存失败：' + err.message);
    }
  }

  var summarized = false;
  function loop(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!paused && state.status === 'running') {
      accumulator += dt;
      var guard = 0;
      while (accumulator >= Game.STEP && guard < 240) {
        Game.step(state);
        accumulator -= Game.STEP;
        guard++;
      }
      if (accumulator > Game.STEP) accumulator = Game.STEP;
      audio.updatePropeller(state.boat.speed, state.grounded);
      if (state.grounded && Math.floor(state.time * 2) !== Math.floor((state.time - dt) * 2)) {
        audio.scrape();
      }
      audio.maybeBird(dt);
      syncLog();
    }
    renderer.render(state);
    updateHud();
    if (state.status !== 'running' && !summarized) {
      summarized = true;
      showSummary();
    }
    requestAnimationFrame(loop);
  }

  document.getElementById('btn-new-seed').addEventListener('click', function () {
    var value = document.getElementById('seed-input').value.trim() || DEFAULT_SEED;
    audio.ensure();
    summarized = false;
    lastEventType = null;
    newGame(value);
  });

  document.getElementById('btn-verify').addEventListener('click', function () {
    var first = state.world.layoutHash;
    var probe = Game.createGame(state.seed);
    var same = probe.world.layoutHash === first;
    pushLog(same ? 'ok' : 'error', same
      ? '重开校验通过：同 seed 新局布局哈希一致（' + first + '）'
      : '布局校验失败：哈希不一致');
    pulse('btn-verify');
  });

  newGame(DEFAULT_SEED);
  requestAnimationFrame(loop);
})();
