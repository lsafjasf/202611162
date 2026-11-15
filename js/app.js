/* 主控制器：固定步长积分 + 渲染插值，保证状态随时间连续变化。
   随机只发生在引擎内部的固定节点，帧循环不产生随机跳变。 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CFG = PEST_SIM.CFG;
  var STEPS_PER_DAY = 24 / CFG.STEP_H;
  var TOTAL_STEPS = Math.round(CFG.DAYS * STEPS_PER_DAY);

  function App() {
    this.seedInput = $('seed');
    this.canvas = $('map');
    this.audio = new AudioHub();
    this.scenarios = null;
    this.mode = 'manual';
    this.speed = 1;
    this.running = false;
    this.acc = 0;
    this.lastTs = 0;
    this.actionQueue = [];
    this.lastEventCount = 0;
    this.bind();
    this.restart();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  App.prototype.bind = function () {
    var self = this;
    $('btn-start').onclick = function () { self.running = !self.running;
      self.syncButtons(); };
    $('btn-restart').onclick = function () { self.restart(); };
    $('btn-mute').onclick = function () {
      var muted = self.audio.toggleMute();
      $('btn-mute').textContent = muted ? '🔇 静音' : '🔊 声音';
    };
    $('speed').onchange = function (e) {
      self.speed = parseInt(e.target.value, 10);
    };
    ['survey', 'trap', 'spray'].forEach(function (tool) {
      $('tool-' + tool).onclick = function () {
        self.selectTool(tool);
      };
    });
    $('spray-mode').onchange = function (e) {
      self.sprayMode = e.target.value;
    };
    this.sprayMode = 'target';
    this.canvas.onclick = function (e) { self.handleClick(e); };
    this.canvas.onmousemove = function (e) { self.handleHover(e); };

    ['steady', 'critical', 'failure'].forEach(function (name) {
      $('scn-' + name).onclick = function () { self.loadScenario(name); };
    });
    $('btn-compare').onclick = function () { self.showComparison(); };
    $('btn-recovery').onclick = function () { self.showRecovery(); };
  };

  App.prototype.selectTool = function (tool) {
    this.tool = tool;
    document.querySelectorAll('.tool-btn').forEach(function (b) {
      b.classList.toggle('active', b.id === 'tool-' + tool);
    });
  };

  App.prototype.restart = function () {
    var seed = this.seedInput.value.trim() || 'demo-seed-7';
    this.sim = PEST_SIM.createSim(seed);
    this.renderer = new PestRenderer(this.canvas, this.sim);
    this.renderer.resize();
    this.mode = 'manual';
    this.replayName = null;
    this.running = false;
    this.acc = 0;
    this.actionQueue = [];
    this.lastEventCount = 0;
    this.tool = 'survey';
    this.selectTool('survey');
    this.startSnapshot = PEST_SIM.snapshot(this.sim, '初始');
    this.lastResult = { msg: '等待首次操作…', ok: true };
    this.syncButtons();
    this.updateHud();
    this.renderer.draw(0);
  };

  App.prototype.loadScenario = function (name) {
    if (!this.scenarios) return;
    var scn = this.scenarios.scenarios[name];
    this.seedInput.value = this.scenarios.seed;
    this.restart();
    this.mode = 'replay';
    this.replayName = name;
    this.actionQueue = scn.actions.slice().sort(function (a, b) {
      return a.at - b.at;
    });
    this.running = true;
    this.syncButtons();
    this.flash('已载入「' + scn.label + '」固定序列，同 seed 自动复现');
  };

  App.prototype.handleClick = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var cell = this.renderer.cellAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!cell) return;
    if (this.mode === 'replay') {
      this.flash('自动复现中，手动操作已禁用；可重开后切换为人工模式');
      return;
    }
    var r;
    if (this.tool === 'survey') {
      r = PEST_SIM.survey(this.sim, cell.x, cell.y);
      if (r.ok) this.audio.survey();
    } else if (this.tool === 'trap') {
      r = PEST_SIM.placeTrap(this.sim, cell.x, cell.y);
      if (r.ok) this.audio.trap();
    } else {
      r = PEST_SIM.spray(this.sim, cell.x, cell.y, this.sprayMode);
      if (r.ok) this.audio.spray(this.sprayMode === 'broad');
    }
    this.lastResult = r.ok
      ? { msg: this.sim.log[0].msg, ok: true }
      : { msg: r.msg, ok: false };
    if (!r.ok) this.audio.alarm();
    PEST_SIM.pruneDrones(this.sim);
    this.updateHud();
    this.renderer.draw(0);
  };

  App.prototype.handleHover = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    this.renderer.hover = this.renderer.cellAt(
      e.clientX - rect.left, e.clientY - rect.top);
  };

  App.prototype.advance = function () {
    /* 重放模式：到点执行固定操作，顺序与时刻完全确定。 */
    while (this.actionQueue.length &&
      this.actionQueue[0].at <= this.sim.time + 1e-6) {
      var a = this.actionQueue.shift();
      if (a.type === 'survey') PEST_SIM.survey(this.sim, a.x, a.y);
      if (a.type === 'trap') PEST_SIM.placeTrap(this.sim, a.x, a.y);
      if (a.type === 'spray') PEST_SIM.spray(this.sim, a.x, a.y,
        a.mode || 'target');
    }
    PEST_SIM.step(this.sim);
    PEST_SIM.pruneDrones(this.sim);
    if (this.sim.events.length > this.lastEventCount) {
      this.audio.alarm();
      this.lastEventCount = this.sim.events.length;
    }
  };

  App.prototype.loop = function (ts) {
    if (!this.lastTs) this.lastTs = ts;
    var dt = Math.min(0.1, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (this.running && !this.sim.finished) {
      /* 1 个模拟天对应 1 个真实秒 × 速度倍率。 */
      this.acc += dt * this.speed;
      var stepDays = CFG.STEP_H / 24;
      var guard = 0;
      while (this.acc >= stepDays && guard++ < 8) {
        this.advance();
        this.acc -= stepDays;
      }
      if (this.sim.finished) this.onFinish();
      this.updateHud();
    }
    this.renderer.draw(this.acc / (CFG.STEP_H / 24));
    requestAnimationFrame(this.loop);
  };

  App.prototype.onFinish = function () {
    this.running = false;
    this.syncButtons();
    if (this.sim.result === 'success') this.audio.win();
    else this.audio.fail();
    this.flash('三周结束：' + this.resultText(this.sim.result));
  };

  App.prototype.resultText = function (r) {
    return r === 'success' ? '成功（感染受控且益虫达标）'
      : r === 'fail' ? '失败（感染失控或益虫崩溃）'
      : '临界（部分达标，需调整策略）';
  };

  App.prototype.syncButtons = function () {
    $('btn-start').textContent = this.running ? '⏸ 暂停' : '▶ 继续';
  };

  App.prototype.flash = function (msg) {
    $('flash').textContent = msg;
  };

  App.prototype.updateHud = function () {
    var sim = this.sim, m = PEST_SIM.metrics(sim);
    var wind = PEST_SIM.windAt(sim, sim.day);
    $('day').textContent = Math.min(CFG.DAYS, sim.time).toFixed(2);
    $('wind').textContent = wind.dir + ' / ' + wind.speed.toFixed(2);
    $('infected').textContent = (m.infectedRatio * 100).toFixed(1) + '%';
    $('pest').textContent = m.avgPest.toFixed(1);
    $('benefit').textContent = m.avgBenefit.toFixed(1);
    $('health').textContent = m.avgHealth.toFixed(1);
    $('hot').textContent = m.hotspots;
    $('r-sorties').textContent = sim.resources.sorties;
    $('r-traps').textContent = sim.resources.traps;
    $('r-spray').textContent = sim.resources.spray;
    $('r-budget').textContent = sim.resources.budget;
    var status = sim.finished ? this.resultText(sim.result)
      : this.running ? '运行中' : '已暂停';
    $('status').textContent = status;
    $('last-op').textContent = this.lastResult ? this.lastResult.msg : '—';
    $('last-op').className = this.lastResult && this.lastResult.ok === false
      ? 'bad' : 'good';
    var recent = sim.events.slice(-5).reverse().map(function (ev) {
      return '第' + ev.day.toFixed(1) + '天 (' + ev.x + ',' + ev.y +
        ') 暴发，密度 ' + ev.pest;
    });
    $('events').innerHTML = recent.length
      ? recent.map(function (t) { return '<li>' + t + '</li>'; }).join('')
      : '<li>暂无暴发事件</li>';
  };

  function row(snap) {
    return '<td>' + snap.label + '</td>' +
      '<td>' + snap.day.toFixed(2) + '</td>' +
      '<td>' + (snap.infectedRatio * 100).toFixed(1) + '%</td>' +
      '<td>' + snap.avgPest.toFixed(1) + '</td>' +
      '<td>' + snap.avgBenefit.toFixed(1) + '</td>' +
      '<td>' + snap.avgHealth.toFixed(1) + '</td>' +
      '<td>' + snap.budget + '</td>' +
      '<td>' + snap.traps + '/' + snap.spray + '</td>';
  }

  App.prototype.showComparison = function () {
    if (!this.scenarios) return;
    var html = Object.keys(this.scenarios.scenarios).map(function (name) {
      var s = this.scenarios.scenarios[name];
      return '<tr class="res-' + s.result + '">' +
        '<td rowspan="2"><b>' + s.label + '</b><br><small>' +
        this.resultText(s.result) + '</small></td>' + row(s.start) + '</tr>' +
        '<tr class="res-' + s.result + '">' + row(s.end) + '</tr>';
    }, this).join('');
    $('compare-body').innerHTML = html;
    this.flash('已生成三档前后对比（资源 / 生物 / 时间）');
  };

  App.prototype.showRecovery = function () {
    if (!this.scenarios) return;
    var rec = this.scenarios.recovery;
    var trig = rec.triggerSnapshot;
    var html = '<tr><td>触发点</td><td>' + rec.precision.threshold +
      '（第 ' + trig.day.toFixed(2) + ' 天）</td>' +
      '<td>—</td><td>' + (trig.infectedRatio * 100).toFixed(1) + '%</td>' +
      '<td>' + trig.avgBenefit.toFixed(1) + '</td>' +
      '<td>' + trig.avgHealth.toFixed(1) + '</td><td>' +
      this.resultText('marginal') + '</td></tr>';
    ['precision', 'broad'].forEach(function (k) {
      var r = rec[k];
      html += '<tr class="res-' + r.result + '"><td>' + r.label +
        '</td><td>' + r.threshold + '</td><td>' + r.extraSpend +
        '（喷药' + r.sprayUsed + ' / 诱捕' + r.trapsLaid + '）</td><td>' +
        (r.end.infectedRatio * 100).toFixed(1) + '%</td><td>' +
        r.end.avgBenefit.toFixed(1) + '</td><td>' +
        r.end.avgHealth.toFixed(1) + '</td><td>' +
        this.resultText(r.result) + '</td></tr>';
    }, this);
    $('recovery-body').innerHTML = html;
    this.flash('恢复策略对比已刷新：注意代价与最终生态指标差异');
  };

  App.prototype.initScenarios = function (data) {
    this.scenarios = data;
    this.showComparison();
    this.showRecovery();
  };

  window.PestApp = App;
  window.addEventListener('DOMContentLoaded', function () {
    var app = new App();
    if (typeof fetch !== 'function') {
      app.flash('当前环境不支持 fetch，请通过本地服务器打开页面');
      return;
    }
    fetch('data/scenarios.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { app.initScenarios(data); })
      .catch(function () {
        app.flash('场景数据加载失败，请先运行 node tools/build-scenarios.js');
      });
  });
})();
