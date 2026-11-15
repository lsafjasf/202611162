/* Canvas 渲染：挤出机流程、线缆、熔体温度、收线轴与设备状态灯 */
(function () {
  'use strict';
  var DEV_LABEL = {
    heater: '加热器', screw: '螺杆', die: '模头',
    hauloff: '牵引', winder: '收线轴'
  };

  function Renderer(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.phase = 0;
  }

  Renderer.prototype.deviceColor = function (dev, alarm) {
    if (alarm && alarm.device === dev) return '#e5484d';
    if (dev.fault) return '#e5484d';
    return dev.running ? '#30a46c' : '#8a8f98';
  };

  Renderer.prototype.draw = function (sim) {
    var ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.clearRect(0, 0, W, H);
    this.phase += sim.paused || sim.state === 'idle' ? 0 : 0.08;

    // 背景与传送带基线
    ctx.fillStyle = '#101315';
    ctx.fillRect(0, 0, W, H);
    var lineY = H * 0.52;
    ctx.strokeStyle = '#26292e';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, lineY + 26); ctx.lineTo(W, lineY + 26); ctx.stroke();

    this.drawHopper(ctx, 24, lineY);
    this.drawBarrel(ctx, 110, lineY, sim);
    this.drawDie(ctx, 330, lineY, sim);
    this.drawCable(ctx, 380, lineY, sim);
    this.drawHauloff(ctx, 620, lineY, sim);
    this.drawWinder(ctx, 740, lineY, sim);
    this.drawTempGauge(ctx, W - 150, 26, sim);
    this.drawDeviceLights(ctx, 12, H - 34, sim);
  };

  Renderer.prototype.drawHopper = function (ctx, x, y) {
    ctx.fillStyle = '#3d444d';
    ctx.beginPath();
    ctx.moveTo(x, y - 60); ctx.lineTo(x + 46, y - 60);
    ctx.lineTo(x + 34, y - 20); ctx.lineTo(x + 12, y - 20);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a626b';
    ctx.fillRect(x + 16, y - 20, 14, 22);
  };

  Renderer.prototype.drawBarrel = function (ctx, x, y, sim) {
    var heat = clamp01((sim.meltTemp - 25) / 200);
    var grad = ctx.createLinearGradient(x, y - 26, x, y + 26);
    grad.addColorStop(0, '#4a5158');
    grad.addColorStop(1, '#2c3137');
    ctx.fillStyle = grad;
    ctx.roundRect ? ctx.roundRect(x, y - 26, 220, 52, 8) : ctx.rect(x, y - 26, 220, 52);
    ctx.fill();
    // 加热段颜色随熔体温度由红变亮黄
    var hot = Math.round(120 + 120 * heat);
    ctx.fillStyle = 'rgba(' + hot + ',' + Math.round(60 + 90 * heat) + ',40,0.85)';
    for (var i = 0; i < 5; i++) {
      ctx.fillRect(x + 12 + i * 42, y - 20, 26, 40);
    }
    // 螺杆
    ctx.strokeStyle = sim.devices.screw.running ? '#c9d1d9' : '#6e7681';
    ctx.lineWidth = 3;
    ctx.beginPath();
    var spin = sim.devices.screw.running ? this.phase : 0;
    for (var sx = x + 16; sx < x + 210; sx += 12) {
      ctx.moveTo(sx, y - 12 + Math.sin(spin + sx * 0.1) * 4);
      ctx.lineTo(sx + 8, y + 12 + Math.sin(spin + sx * 0.1) * 4);
    }
    ctx.stroke();
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px sans-serif';
    ctx.fillText('螺杆 ' + sim.params.screw + ' rpm', x + 10, y - 34);
  };

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  Renderer.prototype.drawDie = function (ctx, x, y, sim) {
    ctx.fillStyle = sim.alarm && sim.alarm.device === 'die' ? '#e5484d' : '#525963';
    ctx.beginPath();
    ctx.moveTo(x, y - 34); ctx.lineTo(x + 44, y - 18);
    ctx.lineTo(x + 44, y + 18); ctx.lineTo(x, y + 34);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#101315';
    ctx.fillRect(x + 40, y - 7, 8, 14);
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px sans-serif';
    ctx.fillText('模头', x + 4, y - 42);
  };

  Renderer.prototype.drawCable = function (ctx, x0, y, sim) {
    var sp = sim.spec();
    var thick = 4 + sp.targetD * 2.2;
    var rough = sim.lastDefect && sim.lastDefect.indexOf('粗糙') >= 0;
    var running = sim.devices.die.running;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rough ? '#b47d3a' : '#2f81f7';
    ctx.lineWidth = thick;
    ctx.beginPath();
    for (var x = x0; x < 620; x += 6) {
      var wobble = running ? Math.sin((x * 0.25) + this.phase * 3) * (rough ? 2.4 : 0.8) : 0;
      if (x === x0) ctx.moveTo(x, y + wobble); else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d8a135';
    ctx.lineWidth = Math.max(1.4, thick * 0.32);
    ctx.beginPath();
    for (var cx = x0; cx < 620; cx += 6) {
      var cw = running ? Math.sin((cx * 0.25) + this.phase * 3) * (rough ? 2.4 : 0.8) : 0;
      if (cx === x0) ctx.moveTo(cx, y + cw); else ctx.lineTo(cx, y + cw);
    }
    ctx.stroke();
    if (sim.lastDiameter !== null) {
      ctx.fillStyle = sim.lastDefect ? '#f1a10b' : '#8ce99a';
      ctx.font = '12px sans-serif';
      ctx.fillText('线径 ' + sim.lastDiameter.toFixed(2) + ' mm（目标 ' +
        sp.targetD + '）', x0, y - 26);
    }
  };

  Renderer.prototype.drawHauloff = function (ctx, x, y, sim) {
    var on = sim.devices.hauloff.running;
    var a = on ? this.phase * 2 : 0;
    ctx.fillStyle = on ? '#3d6b4f' : '#4a5158';
    ctx.save();
    ctx.translate(x + 18, y - 2);
    ctx.rotate(a);
    ctx.fillRect(-16, -16, 32, 32);
    ctx.restore();
    ctx.save();
    ctx.translate(x + 18, y + 22);
    ctx.rotate(-a);
    ctx.fillRect(-16, -16, 32, 32);
    ctx.restore();
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px sans-serif';
    ctx.fillText('牵引', x - 4, y + 52);
  };

  Renderer.prototype.drawWinder = function (ctx, x, y, sim) {
    var on = sim.devices.winder.running;
    var cx = x + 28, cy = y + 6, R = 30;
    ctx.strokeStyle = on ? '#7048e8' : '#5a626b';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    var coils = 3 + Math.round((sim.segProduced / sim.spec().segLen) * 6);
    ctx.strokeStyle = '#d8a135';
    ctx.lineWidth = 2;
    for (var i = 1; i <= coils; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R - i * 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (on) {
      var a = this.phase * (1 + sim.params.tension / 14);
      ctx.strokeStyle = '#e7cd85';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '12px sans-serif';
    ctx.fillText('收线轴 ' + sim.params.tension + 'N', x - 8, y + 52);
  };

  Renderer.prototype.drawTempGauge = function (ctx, x, y, sim) {
    var h = 150, w = 22;
    ctx.strokeStyle = '#5a626b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    var heat = clamp01((sim.meltTemp - 25) / 235);
    var grad = ctx.createLinearGradient(0, y + h, 0, y);
    grad.addColorStop(0, '#2f81f7');
    grad.addColorStop(0.6, '#f1a10b');
    grad.addColorStop(1, '#e5484d');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 3, y + h - (h - 6) * heat, w - 6, (h - 6) * heat);
    var lo = y + h - ((150 - 25) / 235) * h;
    var hi = y + h - ((210 - 25) / 235) * h;
    ctx.strokeStyle = '#8ce99a';
    ctx.beginPath();
    ctx.moveTo(x - 5, lo); ctx.lineTo(x + w + 5, lo);
    ctx.moveTo(x - 5, hi); ctx.lineTo(x + w + 5, hi);
    ctx.stroke();
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '11px sans-serif';
    ctx.fillText(sim.meltTemp.toFixed(0) + '°C', x - 6, y - 6);
    ctx.fillText('设定 ' + sim.params.tempSet + '°C', x - 10, y + h + 16);
  };

  Renderer.prototype.drawDeviceLights = function (ctx, x, y, sim) {
    var names = ['heater', 'screw', 'die', 'hauloff', 'winder'];
    ctx.font = '12px sans-serif';
    names.forEach(function (n, i) {
      var px = x + i * 150;
      ctx.fillStyle = this.deviceColor(sim.devices[n], sim.alarm);
      ctx.beginPath();
      ctx.arc(px, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9d1d9';
      ctx.fillText(DEV_LABEL[n], px + 12, y + 4);
    }, this);
  };

  window.CableRenderer = Renderer;
})();
