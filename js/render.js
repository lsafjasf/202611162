/* Canvas 渲染：泥滩、水纹、芦苇、水草、采样站、检查点与艇体。 */
(function (root) {
  'use strict';

  function Renderer(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.time = 0;
  }

  Renderer.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this.world.cols * this.world.tile;
    var h = this.world.rows * this.world.tile;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = '100%';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
  };

  Renderer.prototype.render = function (state) {
    this.time = state.time;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    this.drawTerrain(state);
    this.drawRoute(state);
    this.drawObjects(state);
    this.drawBoat(state);
    this.drawOverlays(state);
  };

  Renderer.prototype.drawTerrain = function (state) {
    var ctx = this.ctx;
    var t = this.world.tile;
    var MarshGame = root.MarshGame;
    for (var y = 0; y < this.world.rows; y++) {
      for (var x = 0; x < this.world.cols; x++) {
        var tile = this.world.tiles[y][x];
        var px = x * t;
        var py = y * t;
        if (tile.depth < 0) {
          ctx.fillStyle = '#5d4a32';
          ctx.fillRect(px, py, t, t);
          this.drawMudTexture(px, py, tile.decor);
        } else {
          var depth = MarshGame.effectiveDepth(tile, state.time);
          ctx.fillStyle = waterColor(depth, tile.tide, state.time);
          ctx.fillRect(px, py, t, t);
          this.drawRipple(px, py, tile.decor);
        }
      }
    }
  };

  function waterColor(depth, tide, time) {
    if (depth < 0.5) return '#7a8a5a';
    if (depth < 0.62) return '#4f7d6b';
    var base = tide ? [58, 104, 112] : [44, 92, 110];
    var shimmer = Math.sin(time * 1.6 + depth * 10) * 6;
    return 'rgb(' + (base[0] + shimmer) + ',' + (base[1] + shimmer) + ',' + (base[2] + shimmer) + ')';
  }

  Renderer.prototype.drawMudTexture = function (px, py, seed) {
    var ctx = this.ctx;
    ctx.fillStyle = 'rgba(40,28,16,0.35)';
    for (var i = 0; i < 3; i++) {
      var rx = px + ((seed * (i + 3)) % 26) + 3;
      var ry = py + ((seed * (i + 7)) % 26) + 3;
      ctx.fillRect(rx, ry, 3, 2);
    }
  };

  Renderer.prototype.drawRipple = function (px, py, seed) {
    var ctx = this.ctx;
    var phase = (this.time * 1.4 + seed * 0.3) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(220,240,240,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var cx = px + 8 + (seed % 14);
    var cy = py + 8 + ((seed * 3) % 14);
    ctx.arc(cx, cy, 4 + Math.sin(phase) * 1.5, 0.2, 2.6);
    ctx.stroke();
  };

  Renderer.prototype.drawRoute = function (state) {
    var ctx = this.ctx;
    var t = this.world.tile;
    if (state.path.length < 2) return;
    ctx.strokeStyle = 'rgba(255,226,122,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    state.path.forEach(function (p, i) {
      var x = p.x * t;
      var y = p.y * t;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  Renderer.prototype.drawObjects = function (state) {
    var t = this.world.tile;
    for (var y = 0; y < this.world.rows; y++) {
      for (var x = 0; x < this.world.cols; x++) {
        var tile = this.world.tiles[y][x];
        var px = x * t;
        var py = y * t;
        if (tile.reed) this.drawReed(px, py, tile.decor);
        if (tile.grass) this.drawGrass(px, py, tile.decor);
      }
    }
    this.drawDock();
    this.world.checkpoints.forEach(this.drawCheckpoint.bind(this, state));
    this.world.stations.forEach(this.drawStation.bind(this, state));
  };

  Renderer.prototype.drawReed = function (px, py, seed) {
    var ctx = this.ctx;
    var sway = Math.sin(this.time * 2 + seed) * 2;
    ctx.strokeStyle = '#6f7f3a';
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var bx = px + 6 + i * 6;
      ctx.beginPath();
      ctx.moveTo(bx, py + 30);
      ctx.quadraticCurveTo(bx + sway, py + 16, bx + sway * 1.4, py + 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#8a5a2f';
    ctx.fillRect(px + 8 + sway, py + 4, 3, 6);
  };

  Renderer.prototype.drawGrass = function (px, py, seed) {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(34,92,52,0.9)';
    ctx.lineWidth = 1.5;
    for (var i = 0; i < 5; i++) {
      var bx = px + 4 + i * 5;
      var bend = Math.sin(this.time * 2.4 + seed + i) * 3;
      ctx.beginPath();
      ctx.moveTo(bx, py + 28);
      ctx.quadraticCurveTo(bx + bend, py + 18, bx + bend * 1.6, py + 10);
      ctx.stroke();
    }
  };

  Renderer.prototype.drawDock = function () {
    var ctx = this.ctx;
    var t = this.world.tile;
    var d = this.world.dock;
    var px = d.x * t;
    var py = d.y * t;
    ctx.fillStyle = '#8a6a42';
    ctx.fillRect(px + 2, py + 2, t - 4, t - 4);
    ctx.strokeStyle = '#5e4626';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, t - 4, t - 4);
    ctx.fillStyle = '#f4ead2';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('码头', px + 4, py + 20);
  };

  Renderer.prototype.drawCheckpoint = function (state, cp) {
    var ctx = this.ctx;
    var t = this.world.tile;
    var reached = state.checkpoint && state.checkpoint.id >= cp.id;
    var px = cp.x * t + t / 2;
    var py = cp.y * t + t / 2;
    ctx.strokeStyle = reached ? '#57e389' : '#cfd8dc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = reached ? '#57e389' : '#cfd8dc';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('C' + cp.id, px, py + 3);
    ctx.textAlign = 'left';
  };

  Renderer.prototype.drawStation = function (state, st) {
    var ctx = this.ctx;
    var t = this.world.tile;
    var done = state.samples.indexOf(st.id) !== -1;
    var px = st.x * t + t / 2;
    var py = st.y * t + t / 2;
    ctx.fillStyle = done ? '#3a7d44' : '#d98c2b';
    ctx.beginPath();
    ctx.moveTo(px, py - 12);
    ctx.lineTo(px + 11, py + 8);
    ctx.lineTo(px - 11, py + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff7e6';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(st.id), px, py + 4);
    ctx.textAlign = 'left';
  };

  Renderer.prototype.drawBoat = function (state) {
    var ctx = this.ctx;
    var t = this.world.tile;
    var b = state.boat;
    var px = b.x * t;
    var py = b.y * t;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(b.angle);
    if (state.shield > 0) {
      ctx.strokeStyle = 'rgba(120,200,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 18 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = state.grounded ? '#b0533f' : '#e8eef2';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -8);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#34495e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#2e6e8e';
    ctx.fillRect(-4, -4, 7, 8);
    ctx.strokeStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(-14 - Math.abs(b.speed) * 1.5, 0);
    ctx.stroke();
    ctx.restore();

    if (state.sampling.active) {
      var pct = state.sampling.elapsed / root.MarshGame.SAMPLE_HOLD;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px - 16, py - 24, 32, 6);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(px - 15, py - 23, 30 * Math.min(1, pct), 4);
    }
  };

  Renderer.prototype.drawOverlays = function (state) {
    var ctx = this.ctx;
    if (state.grounded && state.status === 'running') {
      banner(ctx, this.viewW / 2, 34, '#e0654a', '搁浅/触底：转向离开或按 R 从检查点恢复');
    }
    if (state.entangled) {
      banner(ctx, this.viewW / 2, 64, '#d98c2b', '水草缠绕：按住空格清除（' +
        Math.round((state.clearProgress / 1.2) * 100) + '%）');
    }
    if (state.feedbackFlash) {
      var color = state.feedbackFlash.kind === 'error' ? '#e0654a'
        : state.feedbackFlash.kind === 'ok' ? '#57e389'
        : state.feedbackFlash.kind === 'warn' ? '#ffb347' : '#8ecae6';
      banner(ctx, this.viewW / 2, this.viewH - 28, color, state.feedbackFlash.message);
    }
    this.drawMiniMap(state);
  };

  function banner(ctx, x, y, color, text) {
    ctx.font = 'bold 14px sans-serif';
    var width = ctx.measureText(text).width + 24;
    ctx.fillStyle = 'rgba(12,20,24,0.72)';
    ctx.fillRect(x - width / 2, y - 14, width, 26);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width / 2, y - 14, width, 26);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4);
    ctx.textAlign = 'left';
  }

  Renderer.prototype.drawMiniMap = function (state) {
    var ctx = this.ctx;
    var scale = 2.2;
    var w = this.world.cols * scale;
    var h = this.world.rows * scale;
    var ox = this.viewW - w - 10;
    var oy = 10;
    ctx.fillStyle = 'rgba(12,20,24,0.6)';
    ctx.fillRect(ox - 4, oy - 4, w + 8, h + 8);
    for (var y = 0; y < this.world.rows; y++) {
      for (var x = 0; x < this.world.cols; x++) {
        var tile = this.world.tiles[y][x];
        ctx.fillStyle = tile.depth < 0 ? '#5d4a32' : tile.tide ? '#3a6870' : '#2c5c6e';
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(ox + state.boat.x * scale - 2, oy + state.boat.y * scale - 2, 4, 4);
  };

  root.MarshRenderer = Renderer;
})(typeof self !== 'undefined' ? self : this);
