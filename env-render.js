/*
 * env-render.js — Canvas 渲染：街区、污染热力、风场粒子、监测点、采样点、污染源、指示生物
 * 渲染层只读引擎状态，自身不产生随机数（粒子由确定性风场驱动）。
 */
(function (global) {
  'use strict';
  const E = global.EnvEngine;

  const COLORS = {
    safe: [76, 175, 80],
    warn: [255, 193, 7],
    crit: [244, 67, 54]
  };

  function concColor(c) {
    const t = Math.min(1, c / E.T.CRIT);
    if (t < 0.55) {
      const k = t / 0.55;
      return mix(COLORS.safe, COLORS.warn, k);
    }
    return mix(COLORS.warn, COLORS.crit, (t - 0.55) / 0.45);
  }
  function mix(a, b, k) {
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ','
      + Math.round(a[1] + (b[1] - a[1]) * k) + ','
      + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cell = 26;
      this.particles = [];
      this._seedParticles();
    }

    _seedParticles() {
      // 确定性初始化粒子网格，位置由索引决定而非随机
      this.particles = [];
      for (let i = 0; i < 90; i++) {
        this.particles.push({
          x: (i * 37) % E.W,
          y: (i * 53) % E.H,
          life: (i * 13) % 40
        });
      }
    }

    toScreen(gx, gy) {
      return { x: gx * this.cell + this.cell / 2, y: gy * this.cell + this.cell / 2 };
    }
    toGrid(px, py) {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const cx = (px - rect.left) * scaleX;
      const cy = (py - rect.top) * scaleY;
      const x = Math.floor(cx / this.cell);
      const y = Math.floor(cy / this.cell);
      return { x, y };
    }

    draw(sim, hover) {
      const ctx = this.ctx;
      const cw = E.W * this.cell, ch = E.H * this.cell;
      ctx.clearRect(0, 0, cw, ch);
      this._drawGrid(sim);
      this._drawHeat(sim);
      this._drawWind(sim);
      this._drawSentinels(sim);
      this._drawSamplers(sim);
      this._drawSources(sim);
      this._drawStations(sim);
      if (hover) this._drawHover(sim, hover);
      this._drawSparklines(sim);
    }

    _drawGrid(sim) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= E.W; x++) {
        ctx.beginPath(); ctx.moveTo(x * this.cell, 0); ctx.lineTo(x * this.cell, E.H * this.cell); ctx.stroke();
      }
      for (let y = 0; y <= E.H; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * this.cell); ctx.lineTo(E.W * this.cell, y * this.cell); ctx.stroke();
      }
    }

    _drawHeat(sim) {
      const ctx = this.ctx;
      for (let y = 0; y < E.H; y++) {
        for (let x = 0; x < E.W; x++) {
          const c = sim.field[E.idx(x, y)];
          if (c < 0.5) continue;
          const alpha = Math.min(0.62, c / (E.T.CRIT * 1.6));
          ctx.fillStyle = concColor(c);
          ctx.globalAlpha = alpha;
          ctx.fillRect(x * this.cell, y * this.cell, this.cell, this.cell);
          ctx.globalAlpha = 1;
        }
      }
    }

    _drawWind(sim) {
      const ctx = this.ctx;
      for (const p of this.particles) {
        const w = sim.windAt(sim.tick);
        p.x += Math.cos(w.dir) * w.speed * 0.06;
        p.y += Math.sin(w.dir) * w.speed * 0.06;
        p.life++;
        if (p.x < 0 || p.x >= E.W || p.y < 0 || p.y >= E.H || p.life > 46) {
          p.x = (p.x + E.W) % E.W;
          p.y = (p.y + E.H) % E.H;
          p.life = 0;
        }
        const s = this.toScreen(p.x, p.y);
        ctx.strokeStyle = 'rgba(179,229,252,0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - Math.cos(w.dir) * 7, s.y - Math.sin(w.dir) * 7);
        ctx.stroke();
      }
    }

    _drawStations(sim) {
      const ctx = this.ctx;
      sim.world.stations.forEach((st, i) => {
        const s = this.toScreen(st.x, st.y);
        const sensor = sim.sensors[i];
        const c = sim.field[E.idx(st.x, st.y)];
        ctx.beginPath();
        ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = sensor.faultNow ? '#ff1744' : concColor(c);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.fillStyle = '#111';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(st.id, s.x, s.y + 4);
        if (sensor.blindUntil > sim.tick) {
          ctx.strokeStyle = '#9c27b0';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }

    _drawSamplers(sim) {
      const ctx = this.ctx;
      for (const p of sim.samplers) {
        const s = this.toScreen(p.x, p.y);
        ctx.fillStyle = '#4fc3f7';
        ctx.fillRect(s.x - 5, s.y - 5, 10, 10);
        ctx.strokeStyle = '#01579b';
        ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
      }
    }

    _drawSources(sim) {
      const ctx = this.ctx;
      for (const src of sim.sources) {
        if (!src.investigated) continue;
        const s = this.toScreen(src.x, src.y);
        ctx.fillStyle = src.mitigated ? '#8d6e63' : '#212121';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - 9);
        ctx.lineTo(s.x + 9, s.y + 7);
        ctx.lineTo(s.x - 9, s.y + 7);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(src.id, s.x, s.y + 4);
      }
    }

    _drawSentinels(sim) {
      const ctx = this.ctx;
      for (const b of sim.sentinels) {
        const s = this.toScreen(b.x, b.y);
        ctx.globalAlpha = 0.35 + 0.65 * (b.health / 100);
        ctx.fillStyle = b.health > 60 ? '#aed581' : (b.health > 30 ? '#ffb74d' : '#e57373');
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    _drawHover(sim, hover) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * this.cell, hover.y * this.cell, this.cell, this.cell);
    }

    _drawSparklines(sim) {
      const ctx = this.ctx;
      sim.world.stations.forEach((st, i) => {
        const sensor = sim.sensors[i];
        const hist = sensor.history.slice(-40);
        if (hist.length < 2) return;
        const baseX = st.x * this.cell, baseY = st.y * this.cell - 18;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(baseX - 4, baseY - 14, 52, 16);
        ctx.strokeStyle = sensor.faultNow ? '#ff5252' : '#80d8ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        hist.forEach((h, k) => {
          const x = baseX + (k / (hist.length - 1)) * 44;
          const y = baseY - (Math.min(60, h.value) / 60) * 12;
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }
  }

  E.Renderer = Renderer;
  E.concColor = concColor;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
