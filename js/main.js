/*
 * UI 主控：播放/暂停/重开、固定 seed 复现、操作面板、指标与日志、
 * 恢复策略对比，以及一条内置固定演示序列（稳态→临界→失败→恢复）。
 */
(function () {
  'use strict';
  var SIM = window.SIM, RENDER = window.RENDER.render, AMBIENT = window.AMBIENT;
  var DEFAULT_SEED = 'mudflat-2026';
  var state = { sim: null, running: false, speed: 4, lastStep: 0, frame: 0, script: null };

  /*
   * 固定演示序列：所有 tick 与站点参数写死，配合固定 seed 可完全复现。
   * 依次制造：稳态操作（远端环线）、临界操作（近滩+高频）、失败操作（近滩不巡查）、
   * 然后用紧急封育恢复。
   */
  var DEMO_SCRIPT = [
    { t: 50, s: 0, kind: 'route', value: 2, tag: '稳态操作' },
    { t: 50, s: 0, kind: 'patrol', value: 1, tag: '稳态操作' },
    { t: 124, s: 1, kind: 'route', value: 1, tag: '临界操作' },
    { t: 124, s: 1, kind: 'patrol', value: 2, tag: '临界操作' },
    { t: 220, s: 2, kind: 'route', value: 0, tag: '失败操作' },
    { t: 220, s: 2, kind: 'patrol', value: 0, tag: '失败操作' },
    { t: 250, s: 2, strategy: 'emergency', tag: '紧急恢复' }
  ];

  function $(id) { return document.getElementById(id); }

  function newSimulation(seed) {
    state.sim = SIM.createSimulation(seed);
    state.running = false;
    state.script = null;
    $('btnPause').textContent = '暂停';
    renderAll();
  }

  function runScript(script) {
    newSimulation($('seedInput').value.trim() || DEFAULT_SEED);
    state.script = script.map(function (a) { return Object.assign({}, a, { fired: false }); });
    state.running = true;
    AMBIENT.ensure();
  }

  function tickOnce() {
    var sim = state.sim;
    if (sim.over) { state.running = false; return; }
    if (state.script) {
      state.script.forEach(function (a) {
        if (!a.fired && sim.tick >= a.t) {
          a.fired = true;
          if (a.strategy) {
            SIM.applyStrategy(sim, a.s, a.strategy);
          } else {
            SIM.applyAction(sim, a.s, a.kind, a.value);
          }
        }
      });
    }
    SIM.step(sim);
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!state.sim) return;
    state.frame++;
    if (state.running && !state.sim.over) {
      var interval = 1000 / state.speed;
      if (ts - state.lastStep >= interval) {
        state.lastStep = ts;
        tickOnce();
        AMBIENT.update(state.sim);
      }
    }
    RENDER($('canvas'), state.sim, ts);
    if (state.frame % 6 === 0) {
      renderPanels();
      renderLog();
      renderEvals();
      renderStrategies();
      renderLastResult();
      renderControls();
    }
  }

  function fmtTime(tick) {
    var day = Math.floor(tick / 24) + 1, hour = tick % 24;
    return '第 ' + Math.min(day, 14) + ' 天 ' + String(hour).padStart(2, '0') + ':00';
  }

  function statusLabel(st) {
    return { steady: '稳态', critical: '临界', failed: '失败' }[st];
  }

  function renderAll() {
    renderPanels();
    renderControls();
    renderLog();
    renderEvals();
    renderStrategies();
    renderLastResult();
  }

  function renderLastResult() {
    var sim = state.sim;
    var box = $('lastResult'), body = $('lastResultBody');
    var done = sim.evalQueue.filter(function (e) { return e.done; });
    box.className = 'last-result';
    if (!done.length) {
      body.textContent = '尚无已完成判定的操作（操作发起 24 小时后在此显示稳态/临界/失败与前后对比）';
      return;
    }
    var e = done[done.length - 1];
    var b = e.before.sites[e.siteIndex], a = e.after.sites[e.siteIndex];
    box.classList.add('lr-' + e.outcome);
    body.innerHTML = '<b>[' + statusLabel(e.outcome) + ']</b> ' + e.label +
      '（' + fmtTime(e.startTick) + ' 发起，24h 窗口）｜评分 ' + b.score.toFixed(1) + '→' + a.score.toFixed(1) +
      '，水深 ' + b.depth.toFixed(1) + '→' + a.depth.toFixed(1) +
      '，食物 ' + b.food.toFixed(1) + '→' + a.food.toFixed(1) +
      '，干扰 ' + b.disturbance.toFixed(1) + '→' + a.disturbance.toFixed(1) +
      '，鸟群 ' + (b.birds || 0) + '→' + (a.birds || 0) +
      '。' + e.note;
  }

  function renderControls() {
    $('speedLabel').textContent = state.speed + 'x';
    $('btnPause').textContent = state.running ? '暂停' : '继续';
  }

  function renderLog() {
    var sim = state.sim;
    var rows = sim.log.slice(-40).reverse().map(function (l) {
      return '<tr class="log-' + l.kind + '"><td>' + fmtTime(l.tick) + '</td><td>' + l.text + '</td></tr>';
    });
    $('logBody').innerHTML = rows.join('') || '<tr><td colspan="2">暂无日志</td></tr>';
  }

  function delta(b, a, key) {
    var d = a[key] - b[key];
    var sign = d >= 0 ? '+' : '';
    return sign + d.toFixed(1);
  }

  function renderEvals() {
    var sim = state.sim;
    var rows = sim.evalQueue.filter(function (e) { return e.done; }).map(function (e) {
      var b = e.before.sites[e.siteIndex], a = e.after.sites[e.siteIndex];
      return '<tr class="eval-' + e.outcome + '"><td>' + fmtTime(e.startTick) + '</td><td>' +
        e.label + '</td><td>' + statusLabel(e.outcome) + '</td>' +
        '<td>' + b.score.toFixed(1) + ' → ' + a.score.toFixed(1) + '</td>' +
        '<td>' + b.depth.toFixed(1) + ' → ' + a.depth.toFixed(1) + '</td>' +
        '<td>' + b.food.toFixed(1) + ' → ' + a.food.toFixed(1) + '</td>' +
        '<td>' + b.disturbance.toFixed(1) + ' → ' + a.disturbance.toFixed(1) + '</td>' +
        '<td>' + (b.birds || 0) + ' → ' + (a.birds || 0) + '</td>' +
        '<td>24h</td></tr>';
    });
    $('evalBody').innerHTML = rows.join('') ||
      '<tr><td colspan="9">操作 24 小时后在此生成稳态/临界/失败判定与前后对比</td></tr>';
  }

  function renderStrategies() {
    var sim = state.sim;
    var rows = sim.strategyRecords.map(function (r) {
      var trig = r.trigger;
      var after = r.after ? r.after.sites[r.siteIndex] : null;
      return '<tr><td>' + r.id + '</td><td>' + r.site + '</td><td>' + r.typeName + '</td>' +
        '<td>' + fmtTime(r.tick) + '</td>' +
        '<td>水深' + trig.depth + ' / 食物' + trig.food + ' / 干扰' + trig.disturbance +
        ' / 评分' + trig.score + '</td>' +
        '<td>' + r.price + ' 元</td>' +
        '<td>' + (after ? (r.lostRevenue + ' 元') : '观察中') + '</td>' +
        '<td>' + (after ? (r.costTotal + ' 元') : '-') + '</td>' +
        '<td>' + (after ? statusLabel(r.outcome) + '，' + r.note : r.window + 'h 窗口观察中…') + '</td></tr>';
    });
    $('strategyBody').innerHTML = rows.join('') ||
      '<tr><td colspan="9">未执行恢复策略。临界站点可点击“紧急封育”或“弹性缓冲”。</td></tr>';
  }

  function bar(label, value, max, color) {
    var pct = Math.max(0, Math.min(100, value / max * 100));
    return '<div class="bar-row"><span class="bar-label">' + label + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
      '<span class="bar-val">' + value.toFixed(1) + '</span></div>';
  }

  function renderPanels() {
    var sim = state.sim;
    if (!sim) return;
    $('timeLabel').textContent = fmtTime(sim.tick) + '（' + sim.tick + '/336 小时）';
    $('weatherLabel').textContent = SIM.tickWeatherLabel(sim, Math.min(sim.tick, 335));
    $('budgetLabel').textContent = Math.round(sim.budget) + ' 元';
    $('checksumLabel').textContent = SIM.checksum(sim);
    $('seedLabel').textContent = sim.seed;
    var scoreAvg = sim.sites.reduce(function (a, s) { return a + s.scoreEma; }, 0) / 3;
    $('scoreLabel').textContent = scoreAvg.toFixed(1);
    var done = sim.sites.filter(function (s) { return s.record; }).length;
    $('recordLabel').textContent = done + '/3 次停留记录';

    var html = '';
    sim.sites.forEach(function (s, i) {
      var st = SIM.siteStatus(s);
      var stClass = 'st-' + st;
      html += '<div class="site-card ' + stClass + '">';
      html += '<header><b>' + s.name + '</b><span class="status-pill ' + stClass + '">' +
        statusLabel(st) + '</span></header>';
      html += bar('水深(cm)', s.depth, 90, '#3b7ea8');
      html += bar('觅食区', SIM.forageFraction(s.depth) * 100, 100, '#5d9c5d');
      html += bar('食物', s.food, 100, '#b58a3c');
      html += bar('干扰', s.disturbance, 100, s.disturbance >= SIM.C.FLUSH_AT ? '#c62828' : '#e08a2e');
      html += bar('栖息评分', s.scoreEma, 100, '#6a4c93');
      if (s.flock) {
        html += '<div class="flock-line">鸟群 ' + s.flock.count + '/' + s.flock.size +
          ' 只 · 能量 ' + s.flock.energy.toFixed(1) + ' · 惊飞 ' + s.flushCount + ' 次</div>';
      } else if (s.record) {
        html += '<div class="flock-line ' + (s.record.success ? 'ok' : 'no') + '">停留记录：' +
          (s.record.success ? '成功 ✓' : '失败 ✗') + '（能量 ' + s.record.energy +
          '，存活 ' + s.record.remaining + '/' + s.record.size + '）</div>';
      } else {
        html += '<div class="flock-line muted">鸟群尚未抵达（计划第 ' +
          (Math.floor(s.flockPlan.arrival / 24) + 1) + ' 天）</div>';
      }
      html += '<div class="ctrl-line" data-site="' + i + '">';
      [['gate', '水闸', ['保持', '排水', '蓄水']], ['route', '路线', ['近滩', '栈道', '远端']],
       ['patrol', '巡查', ['无', '常规', '高频']]].forEach(function (g) {
        html += '<label>' + g[1] + '<select data-kind="' + g[0] + '">';
        g[2].forEach(function (opt, vi) {
          html += '<option value="' + vi + '"' + (s[g[0]] === vi ? ' selected' : '') + '>' + opt + '</option>';
        });
        html += '</select></label>';
      });
      html += '<button class="btn-strat" data-strategy="emergency">紧急封育</button>';
      html += '<button class="btn-strat" data-strategy="buffer">弹性缓冲</button>';
      html += '</div></div>';
    });
    $('sitePanels').innerHTML = html;

    if (sim.over) {
      $('banner').className = 'banner ' + (sim.won ? 'win' : 'lose');
      $('banner').textContent = sim.won ?
        '迁徙季成功：3 次停留记录完成，最低栖息评分 ' + sim.summary.minScore :
        '迁徙季失败：成功记录 ' + sim.summary.successCount + '/3，最低评分 ' + sim.summary.minScore;
      $('banner').style.display = 'block';
    } else {
      $('banner').style.display = 'none';
    }
  }

  window.APP = { state: state, newSimulation: newSimulation, runScript: runScript,
    DEMO_SCRIPT: DEMO_SCRIPT, DEFAULT_SEED: DEFAULT_SEED,
    fmtTime: fmtTime, statusLabel: statusLabel, renderAll: renderAll,
    tickOnce: tickOnce, $: $ };

  document.addEventListener('DOMContentLoaded', function () {
    $('seedInput').value = DEFAULT_SEED;
    newSimulation(DEFAULT_SEED);
    requestAnimationFrame(loop);

    $('btnPause').addEventListener('click', function () {
      state.running = !state.running;
      if (state.running) AMBIENT.ensure();
      renderControls();
    });
    $('btnStep').addEventListener('click', function () {
      state.running = false;
      tickOnce();
      AMBIENT.ensure();
      AMBIENT.update(state.sim);
      renderAll();
    });
    $('btnRestart').addEventListener('click', function () {
      newSimulation($('seedInput').value.trim() || DEFAULT_SEED);
    });
    $('btnSpeed').addEventListener('click', function () {
      state.speed = state.speed >= 16 ? 1 : state.speed * 2;
      renderControls();
    });
    $('btnMute').addEventListener('click', function () {
      AMBIENT.ensure();
      var muted = AMBIENT.toggleMute();
      $('btnMute').textContent = muted ? '取消静音' : '静音';
    });
    $('btnDemo').addEventListener('click', function () {
      runScript(DEMO_SCRIPT);
      renderAll();
    });
    $('btnChecksum').addEventListener('click', function () {
      alert('当前状态 checksum：' + SIM.checksum(state.sim) +
        '\n同 seed 重开并运行到相同时刻后，该值应完全一致。');
    });

    $('sitePanels').addEventListener('change', function (ev) {
      var sel = ev.target.closest('select');
      if (!sel) return;
      var line = ev.target.closest('.ctrl-line');
      var siteIndex = +line.dataset.site;
      var kind = sel.dataset.kind;
      var res = SIM.applyAction(state.sim, siteIndex, kind, +sel.value);
      if (!res.ok) SIM.addLog(state.sim, '操作被拒绝：' + res.reason, 'warn');
      renderAll();
    });

    $('sitePanels').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.btn-strat');
      if (!btn) return;
      var siteIndex = +ev.target.closest('.ctrl-line').dataset.site;
      var res = SIM.applyStrategy(state.sim, siteIndex, btn.dataset.strategy);
      if (!res.ok) { SIM.addLog(state.sim, '恢复策略被拒绝：' + res.reason, 'warn'); }
      renderAll();
    });
  });
})();
