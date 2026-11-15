const TAU = Math.PI * 2;
const MAX_RANGE = 120;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export class SonarCanvasRenderer {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getState = options.getState;
    this.onPickDistance = options.onPickDistance;
    this.width = 1000;
    this.height = 560;
    this.dpr = 1;
    this.geometry = null;
    this.particles = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointer(event));
    this.resize();
    this.buildParticles();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const left = Math.max(54, this.width * 0.085);
    const right = this.width - Math.max(40, this.width * 0.055);
    const top = Math.max(86, this.height * 0.15);
    const bottom = this.height - Math.max(130, this.height * 0.22);
    this.geometry = {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      sourceX: left + 8,
      sourceY: bottom - 42,
      rulerY: bottom + 42,
    };
    this.buildParticles();
  }

  buildParticles() {
    let state = 0x91e10da5;
    this.particles = Array.from({ length: 48 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const x = (state >>> 0) / 0xffffffff;
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const y = (state >>> 0) / 0xffffffff;
      return {
        x,
        y,
        radius: 0.4 + x * 1.4,
        alpha: 0.08 + y * 0.2,
        speed: 0.002 + y * 0.006,
        phase: x * TAU,
      };
    });
  }

  distanceToX(distance) {
    const geometry = this.geometry;
    return geometry.left + (clamp(distance, 0, MAX_RANGE) / MAX_RANGE) * geometry.width;
  }

  xToDistance(x) {
    const geometry = this.geometry;
    return clamp(((x - geometry.left) / geometry.width) * MAX_RANGE, 0, MAX_RANGE);
  }

  handlePointer(event) {
    if (!this.geometry) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const { left, right, top, bottom, rulerY } = this.geometry;
    const insideGrid = x >= left && x <= right && y >= top - 10 && y <= bottom;
    const insideRuler = x >= left && x <= right && y >= rulerY - 32 && y <= rulerY + 18;
    if (!insideGrid && !insideRuler) return;
    const distance = Math.round(this.xToDistance(x));
    this.onPickDistance(clamp(distance, 1, MAX_RANGE));
  }

  draw(now) {
    if (!this.geometry) return;
    const ctx = this.ctx;
    const state = this.getState();
    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);

    this.drawWater(ctx, state, now);
    this.drawGrid(ctx, state);
    this.drawTerrain(ctx);
    this.drawObstacles(ctx, state, now);
    this.drawMarks(ctx, state);
    this.drawWaves(ctx, state, now);
    this.drawRuler(ctx, state);
    this.drawReadouts(ctx, state);
    if (state.paused) this.drawPaused(ctx);
  }

  drawWater(ctx, state, now) {
    const { width, height, geometry } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#061c22");
    gradient.addColorStop(0.45, "#071a1f");
    gradient.addColorStop(1, "#041216");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      geometry.sourceX,
      geometry.sourceY,
      0,
      geometry.sourceX,
      geometry.sourceY,
      width * 0.62,
    );
    glow.addColorStop(0, "rgba(63, 214, 195, 0.10)");
    glow.addColorStop(0.4, "rgba(35, 107, 109, 0.04)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    for (const particle of this.particles) {
      const drift = Math.sin(now * 0.0002 * particle.speed * 70 + particle.phase) * 9;
      const x = particle.x * width + drift;
      const y = particle.y * height;
      ctx.beginPath();
      ctx.arc(x, y, particle.radius, 0, TAU);
      ctx.fillStyle = `rgba(150, 224, 216, ${particle.alpha * 0.55})`;
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.1;
    for (let index = 0; index < 5; index += 1) {
      const offset = ((now * 0.008 + index * 83) % (height + 90)) - 45;
      ctx.strokeStyle = index % 2 ? "#365e5f" : "#244a4c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 26) {
        const y = offset + Math.sin(x * 0.012 + index) * 12;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    if (state.heat > 78) {
      const heatGlow = ctx.createRadialGradient(width * 0.5, height * 0.95, 10, width * 0.5, height * 0.95, width * 0.5);
      heatGlow.addColorStop(0, `rgba(255, 133, 72, ${((state.heat - 78) / 22) * 0.12})`);
      heatGlow.addColorStop(1, "rgba(255, 100, 50, 0)");
      ctx.fillStyle = heatGlow;
      ctx.fillRect(0, 0, width, height);
    }
  }

  drawGrid(ctx, state) {
    const { left, right, top, bottom, height } = this.geometry;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    for (let distance = 0; distance <= MAX_RANGE; distance += 5) {
      const x = this.distanceToX(distance);
      const major = distance % 20 === 0;
      ctx.strokeStyle = major ? "rgba(137, 226, 217, 0.16)" : "rgba(127, 191, 190, 0.055)";
      ctx.lineWidth = major ? 1 : 0.6;
      ctx.setLineDash(major ? [] : [2, 5]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    for (let depth = 0; depth <= 5; depth += 1) {
      const y = top + (depth / 5) * (bottom - top);
      ctx.strokeStyle = depth === 5 ? "rgba(143, 247, 230, 0.18)" : "rgba(127, 191, 190, 0.075)";
      ctx.lineWidth = 1;
      ctx.setLineDash(depth === 5 ? [] : [4, 6]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(112, 173, 173, 0.5)";
    ctx.font = "8px 'Noto Sans SC', ui-monospace, monospace";
    for (let depth = 0; depth < 5; depth += 1) {
      const y = top + (depth / 5) * (bottom - top) + 12;
      ctx.fillText(`${depth * 20} m`, left + 8, y);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(143, 247, 230, 0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();

    if (state.selectedDistance) {
      const x = this.distanceToX(state.selectedDistance);
      ctx.save();
      ctx.strokeStyle = rgba("#ffbd70", 0.75);
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom + 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 189, 112, 0.95)";
      ctx.font = "9px 'Noto Sans SC', ui-monospace, monospace";
      const label = `${state.selectedDistance} m`;
      const labelWidth = ctx.measureText(label).width + 12;
      ctx.fillRect(x - labelWidth / 2, top - 24, labelWidth, 16);
      ctx.fillStyle = "#1c1308";
      ctx.fillText(label, x - labelWidth / 2 + 6, top - 13);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(124, 180, 181, 0.32)";
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.fillText("RANGE / 声呐距离", left, top - 14);
    ctx.textAlign = "right";
    ctx.fillText(`DEPTH ${height > 520 ? "80" : "60"} m`, right, top - 14);
    ctx.restore();
  }

  drawTerrain(ctx) {
    const { left, right, bottom } = this.geometry;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right; x += 20) {
      const y = bottom - 8 - Math.sin(x * 0.021) * 5 - Math.cos(x * 0.009) * 4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(right, bottom + 40);
    ctx.lineTo(left, bottom + 40);
    ctx.closePath();
    const floor = ctx.createLinearGradient(0, bottom - 20, 0, bottom + 40);
    floor.addColorStop(0, "rgba(24, 60, 60, 0.9)");
    floor.addColorStop(1, "rgba(3, 16, 19, 0.95)");
    ctx.fillStyle = floor;
    ctx.fill();
    ctx.strokeStyle = "rgba(92, 157, 153, 0.2)";
    ctx.stroke();
    ctx.restore();
  }

  drawObstacles(ctx, state, now) {
    if (!state.hasScanned) return;
    const geometry = this.geometry;
    ctx.save();
    ctx.beginPath();
    ctx.rect(geometry.left, geometry.top, geometry.width, geometry.height);
    ctx.clip();

    state.targets.forEach((target, index) => {
      const delay = 0.12 + (target.distance / 120) * 1.2;
      const visible = state.scanElapsed >= delay || target.found || state.phase === "loaded";
      if (!visible) return;
      const x = this.distanceToX(target.distance);
      const lane = index === 0 ? 0.25 : index === 1 ? 0.5 : 0.73;
      const y = geometry.top + geometry.height * lane;
      const reveal = clamp((state.scanElapsed - delay) / 0.35, 0, 1);
      const recent = clamp(1 - (state.scanElapsed - delay) / 0.9, 0.25, 1);
      const pulse = 0.72 + Math.sin(now * 0.008 + index) * 0.12;

      ctx.save();
      ctx.globalAlpha = (0.32 + reveal * 0.5) * pulse;
      if (target.type === "rock") {
        this.drawRock(ctx, x, y, 34, recent, index);
      } else {
        this.drawShoal(ctx, x, y, 48, recent, index);
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = `rgba(143, 247, 230, ${0.08 * recent})`;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(geometry.sourceX, geometry.sourceY);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  drawRock(ctx, x, y, size, intensity, index) {
    const gradient = ctx.createLinearGradient(x - size, y, x + size, y);
    gradient.addColorStop(0, "rgba(21, 58, 60, 0.12)");
    gradient.addColorStop(0.55, `rgba(111, 218, 204, ${0.2 * intensity})`);
    gradient.addColorStop(1, "rgba(21, 58, 60, 0.12)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.7, y + 45);
    ctx.lineTo(x - size * 0.5, y - 8);
    ctx.lineTo(x - size * 0.36, y - 41);
    ctx.lineTo(x - size * 0.22, y - 20);
    ctx.lineTo(x - size * 0.09, y - 58);
    ctx.lineTo(x + size * 0.06, y - 27);
    ctx.lineTo(x + size * 0.2, y - 48);
    ctx.lineTo(x + size * 0.35, y - 3);
    ctx.lineTo(x + size * 0.58, y + 45);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(148, 255, 239, ${0.45 * intensity})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.strokeStyle = `rgba(195, 255, 245, ${0.62 * intensity})`;
    ctx.lineWidth = 1.4;
    for (let spike = 0; spike < 5; spike += 1) {
      const offset = (spike - 2) * size * 0.14;
      ctx.beginPath();
      ctx.moveTo(x + offset - 6, y);
      ctx.lineTo(x + offset, y + 22 + spike * 3);
      ctx.lineTo(x + offset + 7, y + 7);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(169, 240, 231, ${0.58 * intensity})`;
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.fillText("SHARP / 锐回波", x - 29, y - 68 - index * 2);
  }

  drawShoal(ctx, x, y, size, intensity, index) {
    ctx.fillStyle = `rgba(48, 103, 100, ${0.18 * intensity})`;
    ctx.beginPath();
    ctx.ellipse(x, y + 38, size, 22, 0, Math.PI, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(118, 206, 195, ${0.35 * intensity})`;
    ctx.lineWidth = 1;
    for (let ring = 0; ring < 4; ring += 1) {
      ctx.beginPath();
      ctx.ellipse(x, y + 37, size * (0.55 + ring * 0.18), 9 + ring * 5, 0, Math.PI, TAU);
      ctx.globalAlpha = 0.5 - ring * 0.08;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(165, 222, 210, ${0.45 * intensity})`;
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.fillText("BROAD / 宽回波", x - 27, y - 20 - index * 2);
  }

  drawMarks(ctx, state) {
    const { bottom } = this.geometry;
    state.targets.filter((target) => target.found).forEach((target, index) => {
      const x = this.distanceToX(target.distance);
      const y = bottom - 5;
      ctx.save();
      ctx.strokeStyle = "rgba(120, 243, 177, 0.85)";
      ctx.fillStyle = "rgba(120, 243, 177, 0.92)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y - 17);
      ctx.lineTo(x - 5, y - 27);
      ctx.lineTo(x + 5, y - 27);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - 17);
      ctx.lineTo(x, y + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 5, 11, 0, TAU);
      ctx.strokeStyle = "rgba(120, 243, 177, 0.24)";
      ctx.stroke();
      ctx.fillStyle = "rgba(198, 255, 221, 0.9)";
      ctx.font = "8px 'Noto Sans SC', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${index + 1}`, x, y - 31);
      ctx.restore();
    });
  }

  drawWaves(ctx, state, now) {
    if (!state.hasScanned && !state.scanElapsed) return;
    const { sourceX, sourceY, left, top, right, bottom } = this.geometry;
    const elapsed = state.scanElapsed;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();

    for (let ring = 0; ring < 5; ring += 1) {
      const radius = (elapsed * 260 + ring * 84) % 460;
      ctx.strokeStyle = `rgba(137, 247, 231, ${0.19 * (1 - radius / 460)})`;
      ctx.lineWidth = ring === 0 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.arc(sourceX, sourceY, radius, -Math.PI * 0.9, Math.PI * 0.9);
      ctx.stroke();
    }

    state.targets.forEach((target, index) => {
      const delay = 0.12 + (target.distance / 120) * 1.2;
      if (elapsed < delay) return;
      const echoAge = elapsed - delay;
      if (echoAge > 1.5 && !state.paused) return;
      const x = this.distanceToX(target.distance);
      const lane = index === 0 ? 0.25 : index === 1 ? 0.5 : 0.73;
      const y = top + (bottom - top) * lane;
      const ringRadius = 8 + echoAge * 64;
      ctx.strokeStyle = `rgba(143, 247, 230, ${clamp(0.5 - echoAge * 0.25, 0.05, 0.5)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, TAU);
      ctx.stroke();

      const echoAmplitude = 18 + target.strength * 23;
      const waveformWidth = target.type === "rock" ? 30 : 66;
      ctx.strokeStyle = target.type === "rock"
        ? `rgba(200, 255, 245, ${clamp(0.9 - echoAge * 0.4, 0.1, 0.9)})`
        : `rgba(129, 201, 192, ${clamp(0.5 - echoAge * 0.2, 0.05, 0.5)})`;
      ctx.lineWidth = target.type === "rock" ? 1.2 : 0.8;
      ctx.beginPath();
      for (let px = -waveformWidth; px <= waveformWidth; px += 1) {
        const envelope = Math.exp(-Math.abs(px) / (target.type === "rock" ? 7 : 22));
        let wave;
        if (target.type === "rock") {
          wave = Math.sin(px * 0.72 + now * 0.018) * envelope
            + (px % 9 === 0 ? Math.sin(px) * 0.3 : 0);
        } else {
          wave = Math.sin(px * 0.13 + now * 0.004) * envelope * 0.65
            + Math.sin(px * 0.29) * envelope * 0.2;
        }
        const pointY = y + wave * echoAmplitude;
        if (px === -waveformWidth) ctx.moveTo(x + px, pointY);
        else ctx.lineTo(x + px, pointY);
      }
      ctx.stroke();
    });

    if (elapsed < 2.6) {
      const sourcePulse = 7 + Math.sin(now * 0.025) * 2;
      ctx.fillStyle = "rgba(161, 255, 241, 0.85)";
      ctx.beginPath();
      ctx.arc(sourceX, sourceY, sourcePulse, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRuler(ctx, state) {
    const { left, right, rulerY } = this.geometry;
    ctx.save();
    ctx.strokeStyle = "rgba(143, 247, 230, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, rulerY);
    ctx.lineTo(right, rulerY);
    ctx.stroke();

    for (let distance = 0; distance <= MAX_RANGE; distance += 5) {
      const x = this.distanceToX(distance);
      const major = distance % 20 === 0;
      ctx.strokeStyle = major ? "rgba(163, 242, 231, 0.52)" : "rgba(126, 190, 189, 0.25)";
      ctx.beginPath();
      ctx.moveTo(x, rulerY);
      ctx.lineTo(x, rulerY + (major ? 8 : 4));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(139, 181, 181, 0.72)";
        ctx.font = "8px 'Noto Sans SC', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${distance}`, x, rulerY + 19);
      }
    }
    ctx.fillStyle = "rgba(111, 157, 158, 0.6)";
    ctx.font = "7px 'Noto Sans SC', ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("METERS / 距离", right, rulerY + 32);
    ctx.restore();
  }

  drawReadouts(ctx, state) {
    const { sourceX, sourceY, left, top } = this.geometry;
    ctx.save();
    ctx.fillStyle = "rgba(143, 247, 230, 0.75)";
    ctx.font = "8px 'Noto Sans SC', ui-monospace, monospace";
    ctx.fillText("TX-07", sourceX + 13, sourceY + 3);
    ctx.fillStyle = "rgba(116, 167, 167, 0.52)";
    ctx.fillText("TRANSDUCER", sourceX + 13, sourceY + 14);

    ctx.strokeStyle = "rgba(143, 247, 230, 0.4)";
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, 7, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(143, 247, 230, 0.75)";
    ctx.beginPath();
    ctx.arc(sourceX, sourceY, 2.2, 0, TAU);
    ctx.fill();

    const status = state.phase === "ended"
      ? "ARCHIVE READY"
      : state.hasScanned
        ? `SCAN ${String(state.scanCount).padStart(2, "0")} · ${state.charges} CHARGES`
        : "AWAITING PULSE";
    ctx.fillStyle = "rgba(125, 175, 175, 0.55)";
    ctx.textAlign = "left";
    ctx.fillText(status, left, top - 32);
    ctx.restore();
  }

  drawPaused(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(2, 12, 15, 0.5)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "rgba(255, 189, 112, 0.9)";
    ctx.font = "10px 'Noto Sans SC', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SONAR PAUSED / 声呐已暂停", this.width / 2, this.height / 2);
    ctx.restore();
  }
}
