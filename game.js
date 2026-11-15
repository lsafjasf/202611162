/* UI 主控:游戏循环、面板刷新、操作绑定、固定序列复现 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY_SECONDS = 8; // 1 倍速下每天 8 秒
  const CONFIG = CoralSim.CONFIG;

  let sim, renderer, audio;
  let paused = false;
  let speed = 1;
  let selectedId = null;
  let replayOps = null;   // 非空表示正在复现
  let lastLogCount = 0;
  let alarmCooldown = 0;

  function newGame(seed) {
    sim = new CoralSim(seed);
    selectedId = null;
    lastLogCount = 0;
    replayOps = null;
    $('finalOverlay').classList.add('hidden');
    $('seedInput').value = seed;
    syncSliders();
    setLastOp('新一局开始,种子「' + seed + '」', true);
    renderLog(true);
  }

  function setLastOp(msg, ok) {
    const el = $('lastOp');
    el.textContent = '最近操作: ' + msg;
    el.classList.toggle('fail', !ok);
  }

  function doOp(fn, sound) {
    if (replayOps) { setLastOp('复现模式中,手动操作已锁定', false); return; }
    if (sim.finished) return;
    audio.ensure();
    const res = fn();
    setLastOp(res.msg, res.ok);
    if (res.ok && sound) sound();
    if (!res.ok) audio.fail();
  }

  function syncSliders() {
    $('shadeSlider').value = Math.round(sim.env.shade * 100);
    $('flowSlider').value = Math.round(sim.env.flow * 100);
    $('tempSlider').value = sim.env.tempSet;
    updateSliderLabels();
  }

  function updateSliderLabels() {
    $('shadeVal').textContent = $('shadeSlider').value + '%';
    $('flowVal').textContent = $('flowSlider').value + '%';
    $('tempVal').textContent = Number($('tempSlider').value).toFixed(1) + '℃';
  }

  // ---------- 面板刷新 ----------
  function cls(v, warnAt, badAt, invert) {
    const w = invert ? v <= warnAt : v >= warnAt;
    const b = invert ? v <= badAt : v >= badAt;
    return b ? 'bad' : w ? 'warn' : 'good';
  }

  function refreshPanels() {
    const m = sim.metrics();
    const env = sim.env;
    const wName = CoralSim.WEATHER_NAME[sim.weatherNow()];
    $('dayLabel').textContent = '第 ' + Math.min(CONFIG.totalDays, Math.floor(sim.time) + 1) +
      ' 天 / 共 ' + CONFIG.totalDays + ' 天 · 天气: ' + wName;
    $('envMetrics').innerHTML = [
      ['水温', env.temp.toFixed(1) + '℃', cls(env.temp, 29, 30.5)],
      ['光照', (env.light * 100).toFixed(0) + '%', cls(env.light, 0.95, 1.1)],
      ['水流', (env.flow * 100).toFixed(0) + '%', env.flow > 0.8 ? 'bad' : env.flow < 0.35 ? 'warn' : 'good'],
      ['遮光', (env.shade * 100).toFixed(0) + '%', env.shade > 0.7 ? 'warn' : 'good'],
      ['沉积物', (env.sediment * 100).toFixed(0) + '%', cls(env.sediment, 0.5, 0.7)],
      ['冷水机', env.chillerOn ? '运行中→' + env.tempSet.toFixed(1) + '℃' : '关闭', env.chillerOn ? 'warn' : 'good'],
    ].map(([k, v, c]) => '<div>' + k + ': <b class="' + c + '">' + v + '</b></div>').join('');
    $('bioMetrics').innerHTML = [
      ['存活率', (m.survival * 100).toFixed(1) + '% (目标≥80%)', cls(m.survival, 0.85, 0.8, true)],
      ['覆盖率', (m.coverage * 100).toFixed(1) + '% (目标≥60%)', cls(m.coverage, 0.5, 0.4, true)],
      ['平均健康', m.avgHealth.toFixed(2), cls(m.avgHealth, 0.5, 0.3, true)],
      ['平均白化', m.avgBleach.toFixed(2), cls(m.avgBleach, 0.3, 0.6)],
      ['平均附着', m.avgFouling.toFixed(2), cls(m.avgFouling, 0.5, 0.7)],
      ['资金 / 幼枝', m.funds + ' / ' + m.fragments, m.funds < 80 ? 'warn' : 'good'],
    ].map(([k, v, c]) => '<div>' + k + ': <b class="' + c + '">' + v + '</b></div>').join('');
    renderStrategyTable();
    renderLog(false);
    if (sim.finished) showFinal();
  }

  function renderStrategyTable() {
    const box = $('strategyTable');
    const rows = sim.strategyRecords.map(r =>
      '<tr><td>' + r.name + '</td><td>' + r.trigger + '</td><td>第' + r.startDay + '→' + r.endDay +
      '天</td><td>' + r.cost + '</td><td>白化 ' + r.before.avgBleach.toFixed(2) + '→' + r.after.avgBleach.toFixed(2) +
      '<br>沉积 ' + r.before.sediment.toFixed(2) + '→' + r.after.sediment.toFixed(2) + '</td></tr>');
    const active = sim.activeStrategy
      ? '<tr><td>' + sim.activeStrategy.name + '(进行中)</td><td>' + sim.activeStrategy.trigger +
        '</td><td>第' + sim.activeStrategy.startDay.toFixed(1) + '天起</td><td>' +
        Math.round(sim.activeStrategy.cost) + '</td><td>—</td></tr>'
      : '';
    box.innerHTML = (rows.length || active)
      ? '<table><tr><th>策略</th><th>触发阈值</th><th>时段</th><th>代价</th><th>前后对比</th></tr>' +
        rows.join('') + active + '</table>'
      : '<span class="hint">尚未触发恢复策略</span>';
  }

  function renderLog(force) {
    if (!force && sim.log.length === lastLogCount) return;
    lastLogCount = sim.log.length;
    const box = $('logBox');
    box.innerHTML = sim.log.slice(-60).map(e =>
      '<div>第' + e.day.toFixed(1) + '天 · ' + e.msg + '</div>').join('');
    box.scrollTop = box.scrollHeight;
  }

  function showFinal() {
    const m = sim.metrics();
    $('finalTitle').textContent = sim.success ? '🎉 达标成功!' : '❌ 未达标';
    const stratCost = sim.strategyRecords.map(r =>
      '策略' + r.name + ': 代价 ' + r.cost + ' 资金(' + r.trigger + ')').join('<br>') || '未使用恢复策略';
    $('finalBody').innerHTML =
      '<p>存活率 <b>' + (m.survival * 100).toFixed(1) + '%</b>(目标≥80%)<br>' +
      '覆盖率 <b>' + (m.coverage * 100).toFixed(1) + '%</b>(目标≥60%)<br>' +
      '剩余资金 <b>' + m.funds + '</b> · 剩余幼枝 <b>' + m.fragments + '</b></p>' +
      '<p>' + stratCost + '</p>';
    $('finalOverlay').classList.remove('hidden');
  }

  // ---------- 主循环 ----------
  let lastTs = 0;
  function loop(ts) {
    const dtReal = Math.min(0.1, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    if (!paused && !sim.finished) {
      const dtDays = (dtReal / DAY_SECONDS) * speed;
      if (replayOps) {
        while (replayOps.length && replayOps[0].day <= sim.time + 1e-6) {
          sim.applyOp(replayOps.shift());
        }
        if (!replayOps.length) {
          replayOps = null;
          setLastOp('操作序列复现完成,已恢复手动控制', true);
        }
      }
      sim.step(dtDays);
      // 临界警报
      alarmCooldown -= dtReal;
      const m = sim.metrics();
      if (alarmCooldown <= 0 && (m.avgBleach > CONFIG.bleachTrigger || m.sediment > CONFIG.sedimentTrigger)) {
        alarmCooldown = 3;
        audio.alarm();
      }
    }
    renderer.draw(sim, selectedId, paused ? 0 : dtReal * speed);
    audio.update(sim.env, dtReal);
    refreshPanels();
    requestAnimationFrame(loop);
  }

  // ---------- 事件绑定 ----------
  function bind() {
    $('btnPause').onclick = () => {
      paused = !paused;
      $('btnPause').textContent = paused ? '▶ 继续' : '⏸ 暂停';
    };
    $('btnSpeed').onclick = () => {
      speed = speed >= 4 ? 1 : speed * 2;
      $('btnSpeed').textContent = speed + '×';
    };
    $('btnRestart').onclick = () => { audio.ensure(); newGame($('seedInput').value.trim() || 'reef-42'); };
    $('btnAgain').onclick = () => { newGame($('seedInput').value.trim() || 'reef-42'); };
    $('btnReplay').onclick = () => {
      if (!sim.opLog.length) { setLastOp('当前没有可复现的操作序列', false); return; }
      const ops = sim.opLog.slice();
      const seed = sim.seedStr;
      newGame(seed);
      replayOps = ops;
      setLastOp('正在复现 ' + ops.length + ' 步操作序列(种子「' + seed + '」)…', true);
    };
    $('btnMute').onclick = () => {
      audio.ensure();
      audio.setMuted(!audio.muted);
      $('btnMute').textContent = audio.muted ? '🔇' : '🔊';
    };
    $('shadeSlider').oninput = updateSliderLabels;
    $('shadeSlider').onchange = () => doOp(() => sim.setShade($('shadeSlider').value / 100), () => audio.ok());
    $('flowSlider').oninput = updateSliderLabels;
    $('flowSlider').onchange = () => doOp(() => sim.setFlow($('flowSlider').value / 100), () => audio.ok());
    $('tempSlider').oninput = updateSliderLabels;
    $('tempSlider').onchange = () => doOp(() => sim.setTemp(Number($('tempSlider').value)), () => audio.ok());
    $('btnChiller').onclick = () => doOp(() => {
      if (sim.env.chillerOn) return sim.chillerOff();
      return sim.setTemp(sim.env.tempSet);
    }, () => audio.ok());
    $('btnCleanAll').onclick = () => doOp(() => sim.clean(null), () => audio.clean());
    $('btnCleanOne').onclick = () => {
      if (selectedId == null) { setLastOp('请先点击画布选择一株珊瑚', false); return; }
      doOp(() => sim.clean(selectedId), () => audio.clean());
    };
    $('btnTransplant').onclick = () => {
      if (selectedId == null) { setLastOp('请先点击画布选择一株珊瑚', false); return; }
      doOp(() => sim.transplant(selectedId), () => audio.transplant());
    };
    $('btnStratA').onclick = () => doOp(() => sim.runStrategy('A'), () => audio.ok());
    $('btnStratB').onclick = () => doOp(() => sim.runStrategy('B'), () => audio.clean());
    $('reef').onclick = (e) => {
      const rect = e.target.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (e.target.width / rect.width);
      const my = (e.clientY - rect.top) * (e.target.height / rect.height);
      const id = renderer.pickCoral(sim, mx, my);
      if (id != null) {
        selectedId = id;
        const c = sim.corals.find(k => k.id === id);
        setLastOp('选中珊瑚 #' + id + (c.alive ?
          '(健康 ' + c.health.toFixed(2) + ' / 白化 ' + c.bleach.toFixed(2) + ' / 附着 ' + c.fouling.toFixed(2) + ')' :
          '(已死亡,可移栽)'), true);
      }
    };
  }

  // ---------- 启动 ----------
  audio = new AudioSys();
  renderer = new Renderer($('reef'));
  newGame('reef-42');
  bind();
  document.body.addEventListener('pointerdown', () => audio.ensure(), { once: true });
  requestAnimationFrame(loop);
})();
