/* app.js — 界面控制器：固定步长驱动、操作分发、指标/记录/日志刷新、固定序列复现 */
(function () {
  'use strict';
  const E = window.EnvEngine;
  const $ = id => document.getElementById(id);

  let sim, renderer, audio;
  let paused = false;
  let timer = null;
  let intervalMs = 250;
  let hoverCell = null;
  let selectedStation = 'S1';
  let autoCtx = null;        // 非空时处于固定序列复现
  let lastFaultSig = '';
  let lastCritSig = '';

  function init(seed) {
    sim = new E.Simulation(seed);
    if (!renderer) renderer = new E.Renderer($('map'));
    if (!audio) audio = new window.AudioFX();
    autoCtx = null;
    paused = false;
    $('pauseBtn').textContent = '暂停';
    buildStationPicker();
    refresh();
    toast('已载入 seed=' + seed + ' 的任务，初始预算 ' + sim.initialBudget);
  }

  function buildStationPicker() {
    const box = $('stationPick');
    box.innerHTML = '';
    sim.world.stations.forEach(st => {
      const lab = document.createElement('label');
      lab.innerHTML = '<input type="radio" name="st" value="' + st.id + '" ' +
        (st.id === selectedStation ? 'checked' : '') + '> ' + st.id;
      lab.querySelector('input').addEventListener('change', e => { selectedStation = e.target.value; });
      box.appendChild(lab);
    });
  }

  function loop() {
    clearInterval(timer);
    timer = setInterval(tick, intervalMs);
  }

  function tick() {
    if (paused || sim.status !== 'running') { refresh(); return; }
    if (autoCtx) {
      const action = E.autopilotTick(sim, autoCtx);
      stepPhysicsAndReact(action);
    } else {
      sim.step();
      reactToState();
    }
    if (sim.status !== 'running') endSound();
    refresh();
  }

  function stepPhysicsAndReact(autoAction) {
    sim.step();
    if (autoAction) {
      // autopilot 已在 step 前执行动作，这里仅按最近动作播音
      soundFor(sim.lastAction, autoAction);
    }
    reactToState();
  }

  function reactToState() {
    // 故障尖峰音（按 站+tick 去重）
    const faultSig = sim.sensors.map((s, i) => s.faultNow ? i : '').join('');
    if (faultSig && faultSig !== lastFaultSig) audio.fault();
    lastFaultSig = faultSig;
    // 临界警报（任一站真实浓度超阈值，2 秒节流）
    const crit = sim.world.stations.some((st, i) =>
      sim.field[E.idx(st.x, st.y)] >= E.T.CRIT && !sim.sensors[i].faultNow);
    const sig = crit ? Math.floor(sim.tick / 5) : '';
    if (crit && sig !== lastCritSig) audio.critical();
    lastCritSig = sig;
  }

  function endSound() {
    if (sim.status === 'success') audio.success();
    else if (sim.status === 'failed') audio.fail();
  }

  function soundFor(action, autoText) {
    if (!action) return;
    if (autoText && autoText.indexOf('失败') >= 0) return audio.reject();
    switch (action.kind) {
      case 'sampler': audio.sampler(); break;
      case 'calibrate': audio.calibrate(); break;
      case 'investigate': action.ok ? audio.investigate() : audio.reject(); break;
      case 'record': action.ok ? audio.recordOk() : audio.reject(); break;
      case 'recovery': action.text.indexOf('A') >= 0 ? audio.recoveryA() : audio.recoveryB(); break;
      default: if (!action.ok) audio.reject();
    }
  }

  function dispatch(fn) {
    if (autoCtx) { toast('固定序列复现进行中，请先等待结束或重开'); return; }
    const result = fn();
    if (result) soundFor(result);
    refresh();
  }

  function refresh() {
    // 指标
    $('mTime').textContent = sim.time + 's（tick ' + sim.tick + '）';
    $('mBudget').textContent = sim.budget;
    $('mEco').textContent = sim.eco.toFixed(1);
    $('bBudget').style.width = Math.max(0, 100 * sim.budget / sim.initialBudget) + '%';
    const ecoColor = sim.eco > 70 ? 'var(--good)' : sim.eco > 40 ? 'var(--warn)' : 'var(--bad)';
    const ecoBar = $('bEco');
    ecoBar.style.width = sim.eco + '%'; ecoBar.style.background = ecoColor;
    const peak = Math.max(...sim.world.stations.map((st, i) => sim.field[E.idx(st.x, st.y)]));
    $('mPeak').textContent = peak.toFixed(1);
    $('mPeak').style.color = peak >= E.T.CRIT ? 'var(--bad)' : peak >= E.T.WARN ? 'var(--warn)' : 'var(--good)';

    // 站点表
    const rows = sim.world.stations.map((st, i) => {
      const s = sim.sensors[i];
      const trueC = sim.field[E.idx(st.x, st.y)];
      const state = s.faultNow ? '<span style="color:var(--bad)">故障尖峰</span>'
        : s.blindUntil > sim.tick ? '<span style="color:var(--purple)">致盲</span>'
        : trueC >= E.T.CRIT ? '<span style="color:var(--bad)">临界</span>'
        : trueC >= E.T.WARN ? '<span style="color:var(--warn)">预警</span>'
        : '<span style="color:var(--good)">稳态</span>';
      return '<tr><td>' + st.id + '</td><td>' + s.reading.toFixed(1) +
        '</td><td>' + trueC.toFixed(1) + '</td><td>' + state + '</td></tr>';
    }).join('');
    $('stationRows').innerHTML = rows;

    const w = sim.windAt(sim.tick);
    const deg = Math.round(w.dir * 180 / Math.PI);
    $('windHint').textContent = '风向 ' + deg + '°（风朝该方向吹，污染物沿风输送）· 风速 ' +
      w.speed.toFixed(2) + ' · 阈值：稳态≤' + E.T.SAFE + ' 预警' + E.T.WARN + ' 临界≥' + E.T.CRIT +
      ' 生态崩溃≤' + E.T.COLLAPSE;

    // 最近操作
    const la = sim.lastAction;
    const box = $('lastAction');
    box.className = la.ok === false ? 'bad' : (la.ok ? 'good' : '');
    box.innerHTML = '<b>[' + la.kind + ']</b> ' + la.text +
      '<br><span class="hint">tick ' + la.atTick + ' · 当前预算 ' + sim.budget + ' · 生态 ' + sim.eco.toFixed(1) + '</span>';

    // 记录表
    $('recordRows').innerHTML = sim.records.map(r =>
      '<tr><td>' + r.id + '</td><td><span class="tag ' + r.type + '">' +
      ({ steady: '稳态', critical: '临界', trace: '溯源' })[r.type] + '</span></td><td>' +
      r.stationId + '</td><td>' + r.concentration + '</td><td><span class="tag ' +
      (r.accepted ? 'ok' : 'no') + '">' + (r.accepted ? '通过' : '驳回') + '</span></td></tr>').join('')
      || '<tr><td colspan="5" class="hint">暂无记录</td></tr>';

    // 日志
    $('log').innerHTML = sim.log.map(e =>
      '<div class="ev">t' + e.tick + '（' + e.time + 's） <b>' + e.kind + '</b> ' + e.text + '</div>').join('');

    // 状态
    const pill = $('statusPill');
    pill.textContent = sim.status === 'running' ? '运行中' : sim.status === 'success' ? '成功' : '失败';
    pill.className = 'status-' + sim.status;

    // 策略对比
    renderCompare();
    renderer.draw(sim, hoverCell);
  }

  function renderCompare() {
    const box = $('compareBox');
    if (sim.recoveryApplied) {
      const r = sim.recoveryApplied;
      const b = r.before, a = r.after;
      box.innerHTML = '已执行策略 <b>' + r.kind + '</b>（花费 ' + r.cost + '）<br>' +
        '预算 ' + b.budget + ' → ' + a.budget + '；生态 ' + b.eco.toFixed(1) + ' → ' + a.eco.toFixed(1) +
        '<br>触发 tick ' + r.atTick + '（时间 ' + (r.atTick * E.TICK_DT) + 's）';
    } else {
      box.textContent = '溯源成功后可选择恢复策略；A 贵但持久，B 便宜但污染会反弹。';
    }
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---- 事件绑定 ----
  $('map').addEventListener('mousemove', e => { hoverCell = renderer.toGrid(e.clientX, e.clientY); refresh(); });
  $('map').addEventListener('mouseleave', () => { hoverCell = null; refresh(); });
  $('map').addEventListener('click', e => {
    const g = renderer.toGrid(e.clientX, e.clientY);
    hoverCell = g;
    toast('已选采样坐标 (' + g.x + ',' + g.y + ')，点击“部署采样点”确认');
    window._pendingCell = g;
  });

  $('newTaskBtn').addEventListener('click', () => init(parseInt($('seedInput').value, 10) || 1));
  $('pauseBtn').addEventListener('click', () => {
    paused = !paused;
    $('pauseBtn').textContent = paused ? '继续' : '暂停';
  });
  $('stepBtn').addEventListener('click', () => {
    paused = true; $('pauseBtn').textContent = '继续';
    if (autoCtx) E.autopilotTick(sim, autoCtx);
    sim.step(); reactToState(); refresh();
  });
  $('speedSel').addEventListener('change', e => { intervalMs = parseInt(e.target.value, 10); loop(); });
  $('muteBtn').addEventListener('click', e => {
    audio.setMuted(!audio.muted);
    e.target.textContent = audio.muted ? '声音 关' : '声音 开';
  });

  $('samplerBtn').addEventListener('click', () => dispatch(() => {
    const cell = window._pendingCell;
    if (!cell) return { ok: false, kind: 'sampler', atTick: sim.tick, text: '请先在地图上点击选择采样坐标' };
    return sim.placeSampler(cell.x, cell.y);
  }));
  $('calibBtn').addEventListener('click', () => dispatch(() => sim.calibrate(selectedStation)));
  $('investBtn').addEventListener('click', () => dispatch(() => sim.investigate(selectedStation)));
  $('steadyBtn').addEventListener('click', () => dispatch(() => sim.submitRecord('steady', selectedStation)));
  $('critBtn').addEventListener('click', () => dispatch(() => sim.submitRecord('critical', selectedStation)));
  $('traceBtn').addEventListener('click', () => dispatch(() => sim.submitRecord('trace', selectedStation)));
  $('stratABtn').addEventListener('click', () => dispatch(() => sim.applyRecovery('A')));
  $('stratBBtn').addEventListener('click', () => dispatch(() => sim.applyRecovery('B')));

  $('autoBtn').addEventListener('click', () => {
    const seed = parseInt($('seedInput').value, 10) || 1;
    init(seed);
    autoCtx = { phase: 'setup', recoveryKind: $('autoKind').value };
    paused = false;
    toast('固定序列复现开始：同 seed 下动作与事件顺序完全一致');
  });

  init(parseInt($('seedInput').value, 10) || 1);
  loop();
})();
