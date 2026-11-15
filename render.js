/* Canvas 渲染:水层、光照、珊瑚、沉积与水流粒子(纯视觉,粒子可用随机) */
(function (global) {
  'use strict';

  function lerpColor(c1, c2, t) {
    const a = c1, b = c2;
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  const HEALTHY = [255, 126, 95];
  const BLEACHED = [238, 238, 230];
  const FOUL = [96, 128, 64];
  const DEAD = [110, 110, 118];

  function coralColor(c) {
    if (!c.alive) return lerpColor(DEAD, DEAD, 0);
    let col = HEALTHY.slice();
    // 白化:健康色 → 灰白
    col = col.map((v, i) => v + (BLEACHED[i] - v) * c.bleach);
    // 附着物:混入藻绿
    col = col.map((v, i) => v + (FOUL[i] - v) * c.fouling * 0.6);
    // 健康差:整体变暗
    const dim = 0.45 + 0.55 * c.health;
    return 'rgb(' + col.map(v => Math.round(v * dim)).join(',') + ')';
  }

  function drawBranch(ctx, x, y, angle, len, depth, rngSeed) {
    if (depth <= 0 || len < 2) return;
    const x2 = x + Math.cos(angle) * len;
    const y2 = y + Math.sin(angle) * len;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const spread = 0.5 + (rngSeed % 7) * 0.04;
    drawBranch(ctx, x2, y2, angle - spread, len * 0.72, depth - 1, rngSeed * 1.7 + 1);
    drawBranch(ctx, x2, y2, angle + spread * 0.9, len * 0.72, depth - 1, rngSeed * 2.3 + 2);
    if (depth > 2) drawBranch(ctx, x2, y2, angle + 0.1, len * 0.6, depth - 2, rngSeed * 3.1 + 3);
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.bubbles = [];
      this.streaks = [];
      for (let i = 0; i < 40; i++) {
        this.bubbles.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.5, v: 0.02 + Math.random() * 0.05 });
        this.streaks.push({ x: Math.random(), y: 0.3 + Math.random() * 0.6, l: 0.02 + Math.random() * 0.05 });
      }
    }

    draw(sim, selectedId, dtReal) {
      const ctx = this.ctx;
      const W = this.canvas.width, H = this.canvas.height;
      const env = sim.env;
      const light = env.light;
      // 水体分层:光照越弱越深
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      const top = 30 + light * 60;
      grad.addColorStop(0, 'rgb(20,' + Math.round(90 + top) + ',' + Math.round(150 + top) + ')');
      grad.addColorStop(0.6, 'rgb(10,60,110)');
      grad.addColorStop(1, 'rgb(6,32,66)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      // 光束
      ctx.save();
      ctx.globalAlpha = 0.05 + light * 0.16;
      ctx.fillStyle = '#cfeeff';
      for (let i = 0; i < 5; i++) {
        const bx = W * (0.1 + i * 0.2) + Math.sin(sim.time * 2 + i) * 12;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx + 50, 0);
        ctx.lineTo(bx + 130, H * 0.85);
        ctx.lineTo(bx - 40, H * 0.85);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      // 遮光网
      if (env.shade > 0.02) {
        ctx.save();
        ctx.globalAlpha = env.shade * 0.55;
        ctx.strokeStyle = '#123';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 9) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H * 0.1); ctx.stroke(); }
        ctx.fillStyle = '#0a1a2a';
        ctx.fillRect(0, 0, W, H * 0.1);
        ctx.restore();
      }
      // 水流粒子
      ctx.save();
      ctx.globalAlpha = 0.25 + env.flow * 0.4;
      ctx.strokeStyle = '#bfe8ff';
      ctx.lineWidth = 1;
      for (const s of this.streaks) {
        s.x += env.flow * dtReal * 0.35;
        if (s.x > 1.1) { s.x = -0.1; s.y = 0.3 + Math.random() * 0.6; }
        ctx.beginPath();
        ctx.moveTo(s.x * W, s.y * H);
        ctx.lineTo((s.x + s.l * (0.4 + env.flow)) * W, s.y * H);
        ctx.stroke();
      }
      ctx.restore();
      // 气泡
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#dff4ff';
      for (const b of this.bubbles) {
        b.y -= b.v * dtReal;
        if (b.y < -0.05) { b.y = 1.05; b.x = Math.random(); }
        ctx.beginPath();
        ctx.arc(b.x * W, b.y * H, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      // 海底 + 沉积物
      ctx.fillStyle = '#3a3428';
      ctx.fillRect(0, H * 0.92, W, H * 0.08);
      if (env.sediment > 0.05) {
        ctx.save();
        ctx.globalAlpha = env.sediment * 0.5;
        ctx.fillStyle = '#8a7a52';
        ctx.fillRect(0, H * (0.92 - env.sediment * 0.25), W, H * (0.08 + env.sediment * 0.25));
        ctx.restore();
      }
      // 苗圃框架
      ctx.strokeStyle = '#c9b98a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.72); ctx.lineTo(W, H * 0.72);
      ctx.moveTo(0, H * 0.9); ctx.lineTo(W, H * 0.9);
      ctx.stroke();
      // 珊瑚
      for (const c of sim.corals) {
        const cx = c.x * W, cy = c.y * H;
        ctx.strokeStyle = coralColor(c);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        if (c.alive) {
          drawBranch(ctx, cx, cy, -Math.PI / 2, 14 + c.size * 46, 4, c.id * 3.7 + 1);
        } else {
          ctx.globalAlpha = 0.7;
          drawBranch(ctx, cx, cy, -Math.PI / 2, 12, 2, c.id * 3.7 + 1);
          ctx.globalAlpha = 1;
        }
        if (c.id === selectedId) {
          ctx.save();
          ctx.strokeStyle = '#ffe27a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy - 20, 26, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // 夜间暗化
      const darkness = Math.max(0, 0.45 - light * 0.45);
      if (darkness > 0.01) {
        ctx.fillStyle = 'rgba(2,8,24,' + darkness + ')';
        ctx.fillRect(0, 0, W, H);
      }
    }

    /* 画布坐标 → 珊瑚 id(点击选择) */
    pickCoral(sim, mx, my) {
      const W = this.canvas.width, H = this.canvas.height;
      let best = null, bestD = 40;
      for (const c of sim.corals) {
        const dx = c.x * W - mx, dy = c.y * H - my;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = c.id; }
      }
      return best;
    }
  }

  global.Renderer = Renderer;
})(window);
