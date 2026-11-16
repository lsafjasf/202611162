(function () {
  "use strict";

  const M = window.RailModel;
  const clamp = M.clamp;

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  class RailVisualizer {
    constructor(canvas, audio) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.audio = audio;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.scene = M.acousticsAt(M.DEFAULTS, -M.WORLD_HALF);
      this.params = M.normalizeParams(M.DEFAULTS);
      this.running = false;
      this.paused = false;
      this.started = false;
      this.passPulse = 0;
      this.clickPulse = 0;
      this.visualClock = 0;
      this.lastTime = performance.now();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.draw(performance.now());
    }

    setState(state) {
      this.scene = state.scene;
      this.params = state.params;
      this.running = state.running;
      this.paused = state.paused;
      this.started = state.started;
    }

    pulsePass() {
      this.passPulse = 1;
    }

    pulseClick() {
      this.clickPulse = 1;
    }

    worldToX(x) {
      const normalized = clamp(x / M.WORLD_HALF, -1, 1);
      const mapped = Math.sign(normalized) * Math.pow(Math.abs(normalized), 0.79);
      return this.width * 0.5 + mapped * this.width * 0.475;
    }

    draw(now) {
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      if (this.running && !this.paused) {
        this.visualClock += dt;
        this.passPulse = Math.max(0, this.passPulse - dt * 0.75);
        this.clickPulse = Math.max(0, this.clickPulse - dt * 3.8);
      }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const spectrumHeight = clamp(h * 0.22, 52, 96);
      const trackY = h * 0.57;
      this.drawBackground(ctx, w, h, trackY);
      this.drawRails(ctx, w, h, trackY);
      this.drawListener(ctx, w, h, trackY);
      if (this.scene.active) this.drawTrain(ctx, w, h, trackY);
      this.drawSpectrum(ctx, w, h, spectrumHeight);
      this.drawFrame(ctx, w, h);
    }

    drawBackground(ctx, w, h, trackY) {
      const background = ctx.createLinearGradient(0, 0, 0, h);
      background.addColorStop(0, "#071117");
      background.addColorStop(0.48, "#071016");
      background.addColorStop(1, "#04090d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(
        this.worldToX(this.params.listener), trackY, 0,
        this.worldToX(this.params.listener), trackY, w * 0.35
      );
      glow.addColorStop(0, "rgba(62, 171, 151, 0.10)");
      glow.addColorStop(0.45, "rgba(24, 79, 82, 0.045)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(125, 169, 176, 0.055)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i += 1) {
        const y = (h * 0.62) * (i / 8);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = 1; i < 12; i += 1) {
        const x = w * (i / 12);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, trackY);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(110, 243, 206, 0.28)";
      ctx.font = "7px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "left";
      ctx.fillText("−55 m", 12, trackY + 34);
      ctx.textAlign = "center";
      ctx.fillText("0", w / 2, trackY + 34);
      ctx.textAlign = "right";
      ctx.fillText("+55 m", w - 12, trackY + 34);
    }

    drawRails(ctx, w, h, trackY) {
      const gaugePx = 7 + this.params.gauge * 9;
      const railTop = trackY - gaugePx * 0.5;
      const railBottom = trackY + gaugePx * 0.5;
      ctx.save();
      for (let x = -M.WORLD_HALF; x <= M.WORLD_HALF; x += 3.5) {
        const sx = this.worldToX(x);
        const major = Math.abs(Math.round(x / 3.5) % 4) < 0.1;
        ctx.strokeStyle = major ? "rgba(125, 159, 164, 0.2)" : "rgba(125, 159, 164, 0.08)";
        ctx.lineWidth = major ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(sx, railTop - (major ? 3 : 1));
        ctx.lineTo(sx, railBottom + (major ? 3 : 1));
        ctx.stroke();
      }
      const drawRail = (y, color, width) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      drawRail(railTop, "rgba(153, 188, 193, 0.56)", 1.5);
      drawRail(railBottom, "rgba(153, 188, 193, 0.7)", 1.7);
      ctx.setLineDash([5, 9]);
      ctx.strokeStyle = "rgba(110, 243, 206, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, trackY);
      ctx.lineTo(w, trackY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(110, 243, 206, 0.28)";
      ctx.font = "7px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "left";
      ctx.fillText(`GAUGE ${this.params.gauge.toFixed(3)} m`, 12, railTop - 10);
      ctx.restore();
    }

    drawListener(ctx, w, h, trackY) {
      const x = this.worldToX(this.params.listener);
      const metrics = this.audio && this.audio.lastMetrics ? this.audio.lastMetrics : null;
      const level = metrics ? clamp(metrics.peak * 2.2, 0, 1) : 0;
      const pulse = 1 - this.passPulse;
      ctx.save();
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = "rgba(110, 243, 206, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x, h - 18);
      ctx.stroke();
      ctx.setLineDash([]);

      if (this.started) {
        for (let i = 0; i < 3; i += 1) {
          const phase = (this.visualClock * 0.5 + i / 3) % 1;
          ctx.strokeStyle = `rgba(110, 243, 206, ${(1 - phase) * 0.18 * (0.35 + level)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, trackY, 13 + phase * 42, -0.7, 0.7);
          ctx.arc(x, trackY, 13 + phase * 42, Math.PI - 0.7, Math.PI + 0.7);
          ctx.stroke();
        }
      }

      if (this.passPulse > 0) {
        ctx.strokeStyle = `rgba(255, 182, 117, ${this.passPulse * 0.85})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, trackY, 16 + (1 - pulse) * 55, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.translate(x, trackY);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#071116";
      ctx.strokeStyle = this.passPulse > 0.15 ? "#ffb675" : "#6ef3ce";
      ctx.lineWidth = 1.4;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 12 + level * 8;
      ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.shadowBlur = 0;
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "#a7c9c7";
      ctx.font = "7px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "center";
      ctx.fillText("LISTENER", 0, 33);
      ctx.fillStyle = "#6ef3ce";
      ctx.fillText(M.formatSigned(this.params.listener, 1) + " m", 0, 44);

      if (this.passPulse > 0.05) {
        ctx.fillStyle = `rgba(255, 182, 117, ${Math.min(1, this.passPulse * 1.4)})`;
        ctx.font = "8px " + getComputedStyle(document.body).getPropertyValue("--mono");
        ctx.fillText("L → R / PAN FLIP", 0, -43);
      }
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "rgba(110, 243, 206, 0.42)";
      ctx.font = "8px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "left";
      ctx.fillText("L", 13, trackY + 4);
      ctx.textAlign = "right";
      ctx.fillText("R", w - 13, trackY + 4);
      ctx.restore();
    }

    drawTrain(ctx, w, h, trackY) {
      const trainX = this.scene.trainX;
      const speedGlow = clamp(this.params.speedKmh / 140, 0, 1);
      const proximity = 1 - clamp(this.scene.distance / 58, 0, 1);
      ctx.save();

      for (let car = 3; car >= 0; car -= 1) {
        const worldX = trainX - car * 8.7;
        if (worldX < -M.WORLD_HALF - 10 || worldX > M.WORLD_HALF + 10) continue;
        const sx = this.worldToX(worldX);
        const carDistance = Math.hypot(worldX - this.params.listener, 0.65 + this.params.gauge * 2.2);
        const near = 1 - clamp(carDistance / 60, 0, 1);
        const scale = 0.56 + near * 0.7;
        const bodyWidth = (car === 0 ? 66 : 57) * scale;
        const bodyHeight = 31 * scale;
        const y = trackY - 18 - bodyHeight * 0.55;
        const alpha = 0.4 + near * 0.6;

        ctx.globalAlpha = alpha;
        if (car > 0) {
          ctx.strokeStyle = "rgba(154, 182, 184, 0.26)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx + bodyWidth * 0.55, y + bodyHeight * 0.55);
          ctx.lineTo(sx + bodyWidth * 0.55 + 7 * scale, y + bodyHeight * 0.55);
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
        ctx.beginPath();
        ctx.ellipse(sx, trackY + 2, bodyWidth * 0.48, 4 * scale, 0, 0, Math.PI * 2);
        ctx.fill();

        const bodyGradient = ctx.createLinearGradient(0, y, 0, y + bodyHeight);
        bodyGradient.addColorStop(0, car === 0 ? "#d4e7e3" : "#b9cbc8");
        bodyGradient.addColorStop(0.13, "#7f9999");
        bodyGradient.addColorStop(0.52, "#273c40");
        bodyGradient.addColorStop(1, "#101d21");
        roundedRect(ctx, sx - bodyWidth * 0.5, y, bodyWidth, bodyHeight, 4 * scale);
        ctx.fillStyle = bodyGradient;
        ctx.fill();
        ctx.strokeStyle = car === 0 ? "rgba(110, 243, 206, 0.64)" : "rgba(181, 205, 204, 0.3)";
        ctx.lineWidth = 0.9;
        ctx.stroke();

        const windowY = y + bodyHeight * 0.29;
        const windowH = bodyHeight * 0.27;
        const windowW = bodyWidth * 0.15;
        const count = car === 0 ? 4 : 5;
        for (let i = 0; i < count; i += 1) {
          const wx = sx - bodyWidth * 0.36 + i * bodyWidth * 0.16;
          roundedRect(ctx, wx, windowY, windowW, windowH, 1);
          ctx.fillStyle = i === 1 && car === 0 ? "#ffca8d" : "rgba(122, 233, 214, 0.55)";
          ctx.fill();
        }

        ctx.fillStyle = "rgba(4, 11, 14, 0.7)";
        ctx.fillRect(sx - bodyWidth * 0.42, y + bodyHeight * 0.66, bodyWidth * 0.84, 1.2);
        for (let wheel = 0; wheel < 2; wheel += 1) {
          const wx = sx - bodyWidth * 0.3 + wheel * bodyWidth * 0.6;
          ctx.fillStyle = "#05090c";
          ctx.strokeStyle = "rgba(159, 191, 191, 0.42)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(wx, trackY - 3, 3.6 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        if (car === 0) {
          ctx.fillStyle = "rgba(110, 243, 206, 0.88)";
          ctx.shadowColor = "#6ef3ce";
          ctx.shadowBlur = 9;
          ctx.beginPath();
          ctx.arc(sx + bodyWidth * 0.46, y + bodyHeight * 0.37, 1.8 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(7, 15, 18, 0.9)";
          ctx.font = `${Math.max(4, 5.2 * scale)}px ${getComputedStyle(document.body).getPropertyValue("--mono")}`;
          ctx.textAlign = "center";
          ctx.fillText("DPLR·09", sx - bodyWidth * 0.02, y + bodyHeight * 0.58);
        }
      }

      const frontX = this.worldToX(trainX);
      const near = 1 - clamp(this.scene.distance / 58, 0, 1);
      const beamDirection = this.scene.dx < 0 ? 1 : -1;
      const beamLength = 38 + speedGlow * 48;
      const beam = ctx.createLinearGradient(frontX, 0, frontX + beamLength * beamDirection, 0);
      beam.addColorStop(0, `rgba(255, 193, 124, ${0.09 + near * 0.08})`);
      beam.addColorStop(1, "rgba(255, 193, 124, 0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(frontX, trackY - 36);
      ctx.lineTo(frontX + beamLength * beamDirection, trackY - 23);
      ctx.lineTo(frontX + beamLength * beamDirection, trackY + 3);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.38 + proximity * 0.35;
      ctx.fillStyle = "#a6bebc";
      ctx.font = "7px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "center";
      ctx.fillText(
        `${this.params.speedKmh.toFixed(0)} km/h · ×${this.scene.doppler.toFixed(3)}`,
        frontX,
        trackY - 63
      );
      ctx.restore();
    }

    drawSpectrum(ctx, w, h, spectrumHeight) {
      const top = h - spectrumHeight;
      const base = h - 17;
      const bins = this.started && this.audio ? this.audio.getFrequencyData() : null;
      ctx.save();
      const panel = ctx.createLinearGradient(0, top, 0, h);
      panel.addColorStop(0, "rgba(4, 10, 14, 0)");
      panel.addColorStop(0.34, "rgba(4, 10, 14, 0.54)");
      panel.addColorStop(1, "rgba(4, 10, 14, 0.92)");
      ctx.fillStyle = panel;
      ctx.fillRect(0, top, w, spectrumHeight);
      ctx.strokeStyle = "rgba(134, 172, 177, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, top + 9);
      ctx.lineTo(w - 12, top + 9);
      ctx.stroke();

      const bars = Math.max(42, Math.min(96, Math.floor(w / 9)));
      const gap = 2;
      const barWidth = Math.max(1.5, (w - 32 - gap * (bars - 1)) / bars);
      const sampleRate = this.audio && this.audio.ctx ? this.audio.ctx.sampleRate : 44100;
      const fftSize = this.audio && this.audio.analysers.mix ? this.audio.analysers.mix.fftSize : 4096;
      const points = [];
      for (let i = 0; i < bars; i += 1) {
        const frequency = 35 * Math.pow(12500 / 35, i / (bars - 1));
        let value = 0;
        if (bins && bins.length) {
          const binIndex = clamp(Math.floor(frequency / sampleRate * fftSize), 1, bins.length - 1);
          const mirrored = clamp(bins[binIndex] / 205, 0, 1);
          const lift = Math.pow(mirrored, 1.45);
          value = 2 + lift * (spectrumHeight - 35);
        } else {
          value = 3 + (Math.sin(i * 0.37) * 0.5 + 0.5) * 3;
        }
        const x = 16 + i * (barWidth + gap);
        const y = base - value;
        points.push({ x, y, frequency });
        const gradient = ctx.createLinearGradient(0, base, 0, top + 15);
        gradient.addColorStop(0, "rgba(110, 243, 206, 0.22)");
        gradient.addColorStop(0.55, "rgba(110, 243, 206, 0.6)");
        gradient.addColorStop(1, i > bars * 0.7 ? "rgba(255, 182, 117, 0.86)" : "rgba(170, 255, 228, 0.9)");
        ctx.fillStyle = gradient;
        ctx.globalAlpha = this.clickPulse > 0 ? 0.76 + this.clickPulse * 0.24 : 1;
        ctx.fillRect(x, y, barWidth, base - y);
      }
      ctx.globalAlpha = 1;

      if (points.length) {
        ctx.strokeStyle = "rgba(206, 255, 244, 0.65)";
        ctx.lineWidth = 1;
        ctx.shadowColor = "#6ef3ce";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = "rgba(146, 181, 184, 0.46)";
      ctx.font = "6px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.textAlign = "left";
      ctx.fillText("35", 12, h - 6);
      ctx.textAlign = "center";
      ctx.fillText("250", w * 0.33, h - 6);
      ctx.fillText("1k", w * 0.56, h - 6);
      ctx.fillText("4k", w * 0.76, h - 6);
      ctx.textAlign = "right";
      ctx.fillText("12.5k Hz", w - 12, h - 6);

      ctx.textAlign = "right";
      ctx.fillStyle = this.paused ? "#ffb675" : "rgba(110, 243, 206, 0.72)";
      ctx.font = "7px " + getComputedStyle(document.body).getPropertyValue("--mono");
      ctx.fillText(this.paused ? "SPECTRUM FROZEN" : "REALTIME SPECTRUM / FFT 4096", w - 13, top + 22);
      ctx.restore();
    }

    drawFrame(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = "rgba(110, 243, 206, 0.3)";
      ctx.lineWidth = 1;
      const length = 12;
      const pad = 7;
      [
        [pad, pad, 1, 1],
        [w - pad, pad, -1, 1],
        [pad, h - pad, 1, -1],
        [w - pad, h - pad, -1, -1]
      ].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + length * sx, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + length * sy);
        ctx.stroke();
      });
      ctx.fillStyle = "rgba(110, 243, 206, 0.22)";
      for (let i = 0; i < 9; i += 1) {
        ctx.fillRect(w / 2 - 20 + i * 5, h - 3, 2, 1);
      }
      ctx.restore();
    }
  }

  window.RailVisualizer = RailVisualizer;
})();
