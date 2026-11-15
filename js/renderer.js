(function () {
  const COLORS = {
    bg: "#061018",
    panel: "#0a1924",
    grid: "rgba(108, 155, 174, 0.08)",
    line: "rgba(135, 177, 195, 0.19)",
    lineBright: "rgba(118, 213, 220, 0.43)",
    text: "#abc0cb",
    dim: "#536d7c",
    cyan: "#55d9df",
    cyanSoft: "rgba(85, 217, 223, 0.1)",
    amber: "#e9b65b",
    red: "#f16c68",
    green: "#74d7a0",
    cathode: "#d8894f",
    cathodeLight: "#f4b276",
    separator: "#bfd9d0",
    anode: "#4f8aa9",
    anodeLight: "#7bb6cf",
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function ease(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function roundRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function armMotion(progress, width, height) {
    const p = clamp(progress, 0, 1);
    const pickX = Math.max(92, width * 0.15);
    const stackX = Math.max(280, width * 0.48);
    const railY = Math.max(58, height * 0.16);
    const pickY = height * 0.54;
    const stackY = height * 0.605;
    let x;
    let y;
    let carrying = false;

    if (p < 0.21) {
      x = pickX;
      y = p < 0.1 ? lerp(railY + 36, pickY, ease(p / 0.1)) : lerp(pickY, railY + 36, ease((p - 0.1) / 0.11));
      carrying = p >= 0.11;
    } else if (p < 0.56) {
      const t = ease((p - 0.21) / 0.35);
      x = lerp(pickX, stackX, t);
      y = railY + 36 - Math.sin(t * Math.PI) * 3;
      carrying = true;
    } else if (p < 0.77) {
      x = stackX;
      const t = ease((p - 0.56) / 0.16);
      y = lerp(railY + 36, stackY, t);
      carrying = p < 0.72;
    } else if (p < 0.86) {
      x = stackX;
      y = stackY - (p - 0.77) * 95;
    } else {
      const t = ease((p - 0.86) / 0.14);
      x = lerp(stackX, pickX, t);
      y = railY + 36;
    }

    const velocity = p < 0.21
      ? (p < 0.1 ? 0.42 : 0.28)
      : p < 0.56
        ? 0.36 + Math.sin((p - 0.21) / 0.35 * Math.PI) * 0.64
        : p < 0.77
          ? 0.56
          : 0.44;
    return { x, y, railY, pickX, stackX, pickY, stackY, velocity, carrying, phase: p };
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.snapshot = null;
      this.time = 0;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.dpr = dpr;
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      if (this.snapshot) this.draw(this.snapshot, this.time);
    }

    draw(snapshot, time = performance.now()) {
      this.snapshot = snapshot;
      this.time = time;
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      this.drawBackground(ctx, w, h, snapshot);
      this.drawSupplies(ctx, w, h, snapshot);
      this.drawStack(ctx, w, h, snapshot);
      this.drawArm(ctx, w, h, snapshot);
      this.drawBuffer(ctx, w, h, snapshot);
      this.drawAlignment(ctx, w, h, snapshot);
      this.drawStateAccent(ctx, w, h, snapshot);
    }

    drawBackground(ctx, w, h, snapshot) {
      const gradient = ctx.createRadialGradient(w * 0.48, h * 0.48, 10, w * 0.48, h * 0.48, w * 0.78);
      gradient.addColorStop(0, "rgba(28, 79, 92, 0.16)");
      gradient.addColorStop(0.5, "rgba(9, 29, 41, 0.11)");
      gradient.addColorStop(1, "rgba(3, 9, 14, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      for (let x = 0.5; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0.5; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(117, 164, 181, 0.09)";
      ctx.beginPath();
      ctx.moveTo(w * 0.31, h * 0.1);
      ctx.lineTo(w * 0.31, h * 0.88);
      ctx.moveTo(w * 0.71, h * 0.1);
      ctx.lineTo(w * 0.71, h * 0.88);
      ctx.stroke();

      const floorY = h * 0.82;
      ctx.fillStyle = "rgba(5, 15, 22, 0.74)";
      ctx.fillRect(0, floorY, w, h - floorY);
      ctx.strokeStyle = "rgba(133, 174, 190, 0.12)";
      ctx.beginPath();
      ctx.moveTo(0, floorY + 0.5);
      ctx.lineTo(w, floorY + 0.5);
      ctx.stroke();

      for (let i = 0; i < 7; i += 1) {
        const x = w * 0.36 + i * 36;
        ctx.strokeStyle = i % 2 ? "rgba(233, 182, 91, 0.08)" : "rgba(85, 217, 223, 0.08)";
        ctx.beginPath();
        ctx.moveTo(x, floorY);
        ctx.lineTo(x - 26, h);
        ctx.stroke();
      }

      const status = snapshot.status;
      const accent = status === "fault" ? COLORS.red : status === "paused" ? COLORS.amber : status === "recovering" ? COLORS.green : COLORS.cyan;
      ctx.fillStyle = accent;
      ctx.globalAlpha = status === "fault" ? 0.1 + Math.sin(this.time / 160) * 0.035 : 0.06;
      ctx.fillRect(0, 0, w, 2);
      ctx.globalAlpha = 1;
    }

    drawSupplies(ctx, w, h, snapshot) {
      const pickX = Math.max(92, w * 0.15);
      const baseY = h * 0.69;
      const supplyW = Math.min(120, w * 0.15);
      const x = pickX - supplyW / 2;

      ctx.fillStyle = "rgba(9, 26, 38, 0.92)";
      roundRect(ctx, x - 9, baseY - 7, supplyW + 18, 56, 3);
      ctx.fill();
      ctx.strokeStyle = COLORS.line;
      ctx.stroke();

      ctx.fillStyle = "rgba(151, 183, 205, 0.06)";
      ctx.fillRect(x - 9, baseY + 40, supplyW + 18, 8);

      const cathodeCount = Math.max(1, 8 - Math.floor((snapshot.cycleIndex || 0) / 3));
      for (let i = 0; i < cathodeCount; i += 1) {
        ctx.fillStyle = i % 3 === 0 ? COLORS.cathodeLight : COLORS.cathode;
        ctx.globalAlpha = 0.76;
        ctx.fillRect(x + 7, baseY - 5 - i * 3, supplyW - 14, 2);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = COLORS.dim;
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.fillText("CATHODE MAG / A", x, baseY + 66);
      ctx.fillStyle = "rgba(85, 217, 223, 0.45)";
      ctx.fillText("PICK POSITION", x, baseY + 78);

      ctx.strokeStyle = "rgba(139, 180, 196, 0.23)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pickX, baseY - 39);
      ctx.lineTo(pickX, baseY + 34);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(85, 217, 223, 0.66)";
      ctx.fillRect(pickX - 12, baseY - 37, 24, 2);

      const status = snapshot.status;
      const led = status === "running" || status === "recovering" ? COLORS.green : status === "fault" ? COLORS.red : COLORS.dim;
      ctx.fillStyle = led;
      ctx.beginPath();
      ctx.arc(x + supplyW + 1, baseY - 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (status === "running" || status === "recovering") {
        ctx.globalAlpha = 0.18 + Math.sin(this.time / 420) * 0.08;
        ctx.beginPath();
        ctx.arc(x + supplyW + 1, baseY - 12, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    drawStack(ctx, w, h, snapshot) {
      const stackX = Math.max(280, w * 0.48);
      const baseY = h * 0.705;
      const stackW = Math.min(224, w * 0.27);
      const x = stackX - stackW / 2;
      const offsetScale = Math.min(30, stackW * 0.14);
      const groups = snapshot.groups || [];

      ctx.fillStyle = "rgba(6, 17, 26, 0.92)";
      roundRect(ctx, x - 20, baseY + 7, stackW + 40, 35, 4);
      ctx.fill();
      ctx.strokeStyle = COLORS.line;
      ctx.stroke();

      const platformGlow = ctx.createLinearGradient(x, 0, x + stackW, 0);
      platformGlow.addColorStop(0, "rgba(85, 217, 223, 0.03)");
      platformGlow.addColorStop(0.5, "rgba(85, 217, 223, 0.3)");
      platformGlow.addColorStop(1, "rgba(85, 217, 223, 0.03)");
      ctx.fillStyle = platformGlow;
      ctx.fillRect(x - 3, baseY + 4, stackW + 6, 2);

      ctx.fillStyle = COLORS.dim;
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.fillText("STACK TABLE / ST-03", x - 3, baseY + 59);
      ctx.fillStyle = "rgba(233, 182, 91, 0.75)";
      ctx.fillText("Z-AXIS LOCKED", x + stackW - 73, baseY + 59);

      const maxLayers = 10;
      const occupied = Math.min(maxLayers, groups.length);
      const startY = baseY - Math.max(22, occupied * 10.6);
      const layerHeight = 8.8;
      const layerWidth = stackW - 12;

      for (let i = 0; i < occupied; i += 1) {
        const group = groups[i] || { offset: 0 };
        const shift = clamp(group.offset || 0, -1, 1) * offsetScale;
        const y = startY + i * layerHeight;
        const isLatest = i === occupied - 1;
        const alpha = 0.72 + i * 0.018;

        ctx.save();
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = COLORS.cathode;
        roundRect(ctx, x + 3 + shift, y, layerWidth - 6, 2.25, 0.7);
        ctx.fill();
        ctx.fillStyle = COLORS.separator;
        ctx.globalAlpha = Math.min(1, alpha + 0.08);
        ctx.fillRect(x + 2 + shift, y + 2.5, layerWidth - 4, 1.65);
        ctx.fillStyle = COLORS.anode;
        ctx.globalAlpha = Math.min(1, alpha + 0.02);
        roundRect(ctx, x + 3.5 + shift, y + 4.45, layerWidth - 7, 2.35, 0.7);
        ctx.fill();

        if (group.good === false) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = COLORS.red;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 2 + shift, y - 0.5, layerWidth - 4, 7.4);
        }
        if (isLatest && snapshot.status === "running") {
          ctx.globalAlpha = 0.12 + Math.sin(this.time / 260) * 0.06;
          ctx.fillStyle = COLORS.cyan;
          ctx.fillRect(x + shift, y - 2, layerWidth, 11);
        }
        ctx.restore();
      }

      const displayOffsets = groups.slice(-3).map((g) => Number(g.offset) || 0);
      const averageOffset = displayOffsets.length
        ? displayOffsets.reduce((sum, value) => sum + value, 0) / displayOffsets.length
        : Number(snapshot.params && snapshot.params.offset) || 0;
      const physicalShift = clamp(averageOffset, -1, 1) * offsetScale;
      const markerY = baseY - Math.max(30, occupied * 10.6) - 13;
      ctx.fillStyle = "rgba(85, 217, 223, 0.06)";
      ctx.fillRect(x + physicalShift - 1, markerY, 2, markerY > 0 ? baseY - markerY : 0);
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath();
      ctx.moveTo(x + physicalShift, markerY + 7);
      ctx.lineTo(x + physicalShift - 3, markerY + 1);
      ctx.lineTo(x + physicalShift + 3, markerY + 1);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(151, 183, 205, 0.55)";
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${occupied.toString().padStart(2, "0")} GROUPS`, x + stackW + 17, baseY - 27);
      ctx.textAlign = "left";

      if (!occupied) {
        ctx.strokeStyle = "rgba(85, 217, 223, 0.2)";
        ctx.setLineDash([4, 5]);
        ctx.strokeRect(x + 7, baseY - 22, stackW - 14, 14);
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS.dim;
        ctx.fillText("WAITING FOR LAYER", x + 49, baseY - 12);
      }
    }

    drawArm(ctx, w, h, snapshot) {
      const p = snapshot.status === "running" || snapshot.status === "recovering" ? snapshot.progress : 0.01;
      const motion = armMotion(p, w, h);
      const railY = motion.railY;
      const stackX = motion.stackX;
      const headW = 42;

      ctx.strokeStyle = "rgba(144, 178, 192, 0.2)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(42, railY);
      ctx.lineTo(w - 43, railY);
      ctx.stroke();
      ctx.strokeStyle = "rgba(85, 217, 223, 0.24)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(42, railY + 2.5);
      ctx.lineTo(w - 43, railY + 2.5);
      ctx.stroke();

      for (let i = 0; i < 6; i += 1) {
        const x = 55 + i * ((w - 110) / 5);
        ctx.fillStyle = "rgba(112, 150, 166, 0.35)";
        ctx.fillRect(x, railY - 2, 2, 6);
      }

      const isActive = snapshot.status === "running" || snapshot.status === "recovering";
      const glow = ctx.createRadialGradient(motion.x, motion.y, 2, motion.x, motion.y, 32);
      glow.addColorStop(0, isActive ? "rgba(85, 217, 223, 0.16)" : "rgba(85, 217, 223, 0.03)");
      glow.addColorStop(1, "rgba(85, 217, 223, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(motion.x - 35, motion.y - 35, 70, 70);

      ctx.fillStyle = "#102631";
      roundRect(ctx, motion.x - 17, railY - 6, 34, 13, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(155, 198, 208, 0.38)";
      ctx.stroke();
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(motion.x - 5, railY - 2, 10, 2);

      ctx.strokeStyle = "rgba(163, 195, 205, 0.5)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(motion.x, railY + 6);
      ctx.lineTo(motion.x, motion.y - 10);
      ctx.stroke();
      ctx.strokeStyle = "rgba(85, 217, 223, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(motion.x - 2.5, railY + 8);
      ctx.lineTo(motion.x - 2.5, motion.y - 10);
      ctx.stroke();

      ctx.fillStyle = "#17313d";
      roundRect(ctx, motion.x - headW / 2, motion.y - 12, headW, 18, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(145, 196, 206, 0.48)";
      ctx.stroke();
      ctx.fillStyle = "rgba(85, 217, 223, 0.55)";
      ctx.fillRect(motion.x - headW / 2 + 4, motion.y - 8, headW - 8, 1.5);

      for (let i = 0; i < 4; i += 1) {
        const cupX = motion.x - 15 + i * 10;
        ctx.fillStyle = "rgba(188, 217, 223, 0.5)";
        ctx.beginPath();
        ctx.ellipse(cupX, motion.y + 7, 3.2, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      if (motion.carrying) {
        const y = motion.y + 11;
        ctx.globalAlpha = snapshot.status === "fault" ? 0.55 : 0.92;
        ctx.fillStyle = COLORS.cathode;
        roundRect(ctx, motion.x - 29, y, 58, 2.5, 1);
        ctx.fill();
        ctx.fillStyle = COLORS.separator;
        ctx.fillRect(motion.x - 28, y + 3, 56, 1.5);
        ctx.fillStyle = COLORS.anode;
        roundRect(ctx, motion.x - 27, y + 5, 54, 2.3, 1);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (snapshot.status === "fault") {
        ctx.strokeStyle = COLORS.red;
        ctx.globalAlpha = 0.55 + Math.sin(this.time / 170) * 0.25;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(motion.x, motion.y, 25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = COLORS.dim;
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.fillText("RB-01 / SERVO GANTRY", stackX + 44, railY - 14);

      const progressText = isActive ? `${(p * 100).toFixed(0).padStart(3, "0")}%` : "STBY";
      ctx.textAlign = "right";
      ctx.fillStyle = isActive ? COLORS.cyan : COLORS.dim;
      ctx.fillText(`MOVE ${progressText}`, motion.x - 26, railY - 14);
      ctx.textAlign = "left";
    }

    drawBuffer(ctx, w, h, snapshot) {
      const x = Math.min(w - 138, Math.max(w * 0.76, w - 168));
      const baseY = h * 0.705;
      const width = Math.min(124, w * 0.145);
      const height = Math.min(184, h * 0.43);
      const topY = baseY - height + 13;
      const load = clamp(Number(snapshot.bufferLoad) || 0, 0, 8);

      ctx.fillStyle = "rgba(7, 20, 30, 0.9)";
      roundRect(ctx, x, topY, width, height, 4);
      ctx.fill();
      ctx.strokeStyle = load >= 7 ? "rgba(241, 108, 104, 0.55)" : COLORS.line;
      ctx.stroke();
      ctx.fillStyle = "rgba(233, 182, 91, 0.055)";
      ctx.fillRect(x + 1, topY + 1, width - 2, 21);

      ctx.fillStyle = COLORS.dim;
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.fillText("BUFFER / BF-03", x + 9, topY + 13);
      ctx.textAlign = "right";
      ctx.fillStyle = load >= 7 ? COLORS.red : load >= 5 ? COLORS.amber : COLORS.cyan;
      ctx.fillText(`${load}/8`, x + width - 9, topY + 13);
      ctx.textAlign = "left";

      const slotTop = topY + 30;
      const slotGap = 4;
      const slotHeight = (height - 52) / 8;
      for (let i = 7; i >= 0; i -= 1) {
        const slotIndex = 7 - i;
        const sy = slotTop + slotIndex * (slotHeight + slotGap);
        const filled = i < load;
        ctx.fillStyle = filled ? "rgba(233, 182, 91, 0.13)" : "rgba(2, 9, 14, 0.46)";
        roundRect(ctx, x + 8, sy, width - 16, slotHeight, 1.5);
        ctx.fill();
        ctx.strokeStyle = filled ? "rgba(233, 182, 91, 0.33)" : "rgba(127, 163, 177, 0.09)";
        ctx.stroke();

        if (filled) {
          const layerY = sy + slotHeight / 2;
          ctx.fillStyle = COLORS.cathode;
          ctx.fillRect(x + 14, layerY - 2.2, width - 28, 1.5);
          ctx.fillStyle = COLORS.separator;
          ctx.fillRect(x + 14, layerY - 0.3, width - 28, 0.8);
          ctx.fillStyle = COLORS.anode;
          ctx.fillRect(x + 14, layerY + 1, width - 28, 1.5);
        }

        ctx.fillStyle = filled ? "rgba(233, 182, 91, 0.55)" : "rgba(151, 183, 205, 0.16)";
        ctx.font = "6px SFMono-Regular, Consolas, monospace";
        ctx.fillText(String(8 - i).padStart(2, "0"), x + 3, sy + slotHeight * 0.68);
      }

      ctx.strokeStyle = "rgba(151, 183, 205, 0.17)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x - 26, baseY - height * 0.55);
      ctx.lineTo(x, baseY - height * 0.55);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText("INFEED", x - 50, baseY - height * 0.55 + 2);

      const statusColor = snapshot.status === "running" ? COLORS.green : snapshot.status === "fault" ? COLORS.red : COLORS.dim;
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(x + width / 2, topY + height - 8, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.dim;
      ctx.font = "6px SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(load >= 7 ? "SATURATED" : "CLEAR", x + width / 2, topY + height + 10);
      ctx.textAlign = "left";
    }

    drawAlignment(ctx, w, h, snapshot) {
      const stackX = Math.max(280, w * 0.48);
      const baseY = h * 0.705;
      const offset = clamp(Number(snapshot.params && snapshot.params.offset) || 0, -1, 1);
      const offsetPx = offset * Math.min(38, w * 0.043);
      const topY = h * 0.26;
      const bottomY = baseY + 9;
      const danger = Math.abs(offset) > 0.45;
      const warning = Math.abs(offset) > 0.28;
      const color = danger ? COLORS.red : warning ? COLORS.amber : COLORS.cyan;

      ctx.strokeStyle = danger ? "rgba(241, 108, 104, 0.48)" : "rgba(85, 217, 223, 0.2)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(stackX, topY);
      ctx.lineTo(stackX, bottomY);
      ctx.moveTo(stackX - 68, topY + 55);
      ctx.lineTo(stackX + 68, topY + 55);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(stackX, topY + 55, 10, 0, Math.PI * 2);
      ctx.moveTo(stackX - 16, topY + 55);
      ctx.lineTo(stackX + 16, topY + 55);
      ctx.moveTo(stackX, topY + 39);
      ctx.lineTo(stackX, topY + 71);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.58;
      ctx.beginPath();
      ctx.moveTo(stackX + offsetPx, topY + 76);
      ctx.lineTo(stackX + offsetPx, bottomY - 28);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(stackX + offsetPx, topY + 88);
      ctx.lineTo(stackX + offsetPx - 3, topY + 82);
      ctx.lineTo(stackX + offsetPx + 3, topY + 82);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "rgba(6, 17, 26, 0.82)";
      roundRect(ctx, stackX - 40, topY + 11, 80, 16, 2);
      ctx.fill();
      ctx.strokeStyle = danger ? "rgba(241, 108, 104, 0.32)" : "rgba(85, 217, 223, 0.18)";
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "7px SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`CCD ΔX ${offset >= 0 ? "+" : ""}${offset.toFixed(2)}`, stackX, topY + 22);
      ctx.textAlign = "left";

      if (warning) {
        ctx.fillStyle = danger ? COLORS.red : COLORS.amber;
        ctx.font = "7px SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText(danger ? "SHORT-CIRCUIT RISK" : "ALIGNMENT WARNING", stackX, topY + 96);
        ctx.textAlign = "left";
      }
    }

    drawStateAccent(ctx, w, h, snapshot) {
      const status = snapshot.status;
      if (status === "fault") {
        ctx.fillStyle = "rgba(241, 108, 104, 0.035)";
        ctx.fillRect(0, 0, w, h);
        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, "rgba(241, 108, 104, 0)");
        gradient.addColorStop(0.5, "rgba(241, 108, 104, 0.1)");
        gradient.addColorStop(1, "rgba(241, 108, 104, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, h * 0.5 - 1, w, 2);

        ctx.fillStyle = "rgba(31, 13, 15, 0.9)";
        roundRect(ctx, w / 2 - 104, 31, 208, 27, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(241, 108, 104, 0.44)";
        ctx.stroke();
        ctx.fillStyle = COLORS.red;
        ctx.font = "8px SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("SAFETY INTERLOCK · MACHINE STOP", w / 2, 48);
        ctx.textAlign = "left";
      }

      if (status === "recovering") {
        const remaining = Number(snapshot.recoveryRemaining) || 0;
        const progress = clamp(1 - remaining / 8000, 0, 1);
        ctx.fillStyle = "rgba(6, 17, 26, 0.9)";
        roundRect(ctx, w / 2 - 110, 29, 220, 31, 3);
        ctx.fill();
        ctx.strokeStyle = "rgba(116, 215, 160, 0.4)";
        ctx.stroke();
        ctx.fillStyle = "rgba(116, 215, 160, 0.12)";
        ctx.fillRect(w / 2 - 108, 57, 216, 2);
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(w / 2 - 108, 57, 216 * progress, 2);
        ctx.font = "7px SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`RECOVERY VERIFY ${(remaining / 1000).toFixed(1)}s`, w / 2, 45);
        ctx.textAlign = "left";
      }

      if (status === "idle") {
        const scanY = (this.time / 18) % h;
        const gradient = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
        gradient.addColorStop(0, "rgba(85, 217, 223, 0)");
        gradient.addColorStop(0.5, "rgba(85, 217, 223, 0.025)");
        gradient.addColorStop(1, "rgba(85, 217, 223, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, scanY - 14, w, 28);
      }
    }
  }

  let instance = null;
  window.LaminaRenderer = {
    init(canvas) {
      instance = new Renderer(canvas);
      return instance;
    },
    draw(snapshot, time) {
      if (instance) instance.draw(snapshot, time);
    },
    resize() {
      if (instance) instance.resize();
    },
    armMotion,
  };
})();
