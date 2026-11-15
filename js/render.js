/* Canvas 渲染：林班网格 + 虫害热区 + 设备 + 无人机飞行轨迹。
   只读取模拟状态，渲染层不产生随机数。 */
(function (global) {
  'use strict';

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t))];
  }
  function rgb(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] +
      (a === undefined ? '' : ',' + a) + ')';
  }

  var GREEN = [58, 122, 69];
  var AMBER = [214, 164, 58];
  var RED = [200, 62, 52];

  function pestColor(pest) {
    var t = Math.min(1, pest / 100);
    if (t <= 0.5) return mix(GREEN, AMBER, t * 2);
    return mix(AMBER, RED, (t - 0.5) * 2);
  }

  function Renderer(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.cell = 56;
    this.pad = 26;
    this.hover = null;
  }
  Renderer.prototype.resize = function () {
    var dpr = global.devicePixelRatio || 1;
    var cols = PEST_SIM.CFG.COLS, rows = PEST_SIM.CFG.ROWS;
    var cssW = this.pad * 2 + cols * this.cell;
    var cssH = this.pad * 2 + rows * this.cell + 30;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Renderer.prototype.cellAt = function (px, py) {
    var x = Math.floor((px - this.pad) / this.cell);
    var y = Math.floor((py - this.pad) / this.cell);
    if (!PEST_SIM.inBounds(x, y)) return null;
    return { x: x, y: y };
  };

  Renderer.prototype.draw = function (interp) {
    var ctx = this.ctx, sim = this.sim, cfg = PEST_SIM.CFG;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    var self = this;
    sim.cells.forEach(function (c) {
      self.drawCell(c, interp);
    });
    this.drawWind();
    this.drawDrones(interp);
  };

  Renderer.prototype.drawCell = function (c) {
    var ctx = this.ctx;
    var x0 = this.pad + c.x * this.cell;
    var y0 = this.pad + c.y * this.cell;
    var size = this.cell - 2;
    var base = pestColor(c.pest);

    ctx.fillStyle = rgb(base);
    ctx.fillRect(x0, y0, size, size);

    /* 未监测的林班叠加斜纹，提示“监测遗漏”风险。 */
    var gap = this.sim.time - c.lastSurvey;
    if (gap > PEST_SIM.CFG.OUTBREAK_SURVEY_GAP) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, size, size);
      ctx.clip();
      ctx.strokeStyle = 'rgba(20,20,20,0.28)';
      ctx.lineWidth = 2;
      for (var s = -size; s < size * 2; s += 9) {
        ctx.beginPath();
        ctx.moveTo(x0 + s, y0);
        ctx.lineTo(x0 + s + size, y0 + size);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 农药残留：紫色半透明覆盖。 */
    if (c.residue > 0.04) {
      ctx.fillStyle = 'rgba(120,70,180,' + Math.min(0.5, c.residue * 0.5) + ')';
      ctx.fillRect(x0, y0, size, size);
    }

    /* 热区脉冲描边。 */
    if (c.pest >= PEST_SIM.CFG.HOTSPOT_PEST) {
      var pulse = 0.55 + 0.35 * Math.sin(this.sim.time * 6 + c.x + c.y);
      ctx.strokeStyle = 'rgba(255,40,30,' + pulse + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 1.5, y0 + 1.5, size - 3, size - 3);
    }

    /* 益虫密度：左下角绿色小条。 */
    var bh = Math.round((size - 8) * c.benefit / 100);
    ctx.fillStyle = 'rgba(18,70,30,0.85)';
    ctx.fillRect(x0 + 4, y0 + size - 4 - bh, 5, bh);

    /* 诱捕器：黄色菱形。 */
    if (c.traps > 0) {
      var cx = x0 + size - 12, cy = y0 + 12;
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx + 6, cy);
      ctx.lineTo(cx, cy + 6);
      ctx.lineTo(cx - 6, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(c.traps), cx, cy + 3.5);
    }

    /* 观测值与坐标。 */
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(c.x + ',' + c.y, x0 + 4, y0 + 13);
    if (c.lastSurvey >= 0) {
      ctx.font = '10px sans-serif';
      ctx.fillText('观' + c.observed.toFixed(0), x0 + 4, y0 + size - 6);
    }
  };

  Renderer.prototype.drawWind = function () {
    var ctx = this.ctx, cfg = PEST_SIM.CFG;
    var wind = PEST_SIM.windAt(this.sim, this.sim.day);
    var dir = PEST_SIM.DIRS.filter(function (g) {
      return g.name === wind.dir;
    })[0];
    var y = this.pad + cfg.ROWS * this.cell + 18;
    var x = this.pad;
    ctx.fillStyle = '#234';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('风向 ' + wind.dir + '（风速 ' + wind.speed.toFixed(2) + '）',
      x, y);
    var len = 26 * wind.speed;
    var sx = x + 150, sy = y - 4;
    ctx.strokeStyle = '#1a6fb0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dir.dx * len, sy + dir.dy * len);
    ctx.stroke();
    ctx.fillStyle = '#1a6fb0';
    ctx.beginPath();
    ctx.arc(sx + dir.dx * len, sy + dir.dy * len, 3.5, 0, Math.PI * 2);
    ctx.fill();
  };

  Renderer.prototype.drawDrones = function () {
    var ctx = this.ctx;
    var self = this;
    this.sim.drones.forEach(function (d) {
      var t = (self.sim.time - d.start) / d.duration;
      if (t < 0 || t > 1) return;
      var fx = d.x0 + (d.x1 - d.x0) * t;
      var fy = d.y0 + (d.y1 - d.y0) * t;
      var px = self.pad + fx * self.cell + self.cell / 2 - 1;
      var py = self.pad + fy * self.cell + self.cell / 2 - 1;
      var color = d.kind === 'survey' ? '#2b7de9'
        : d.kind === 'trap' ? '#d18f00'
        : d.kind === 'spray-broad' ? '#8a2be2' : '#c0392b';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(self.pad + d.x0 * self.cell + self.cell / 2,
        self.pad + d.y0 * self.cell + self.cell / 2);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✈', px, py + 3);
    });
  };

  global.PestRenderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
