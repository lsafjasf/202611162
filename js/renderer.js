import {
  BUFFERS,
  CARTONS,
  PHASES,
  TAPE_PATHS,
  clone
} from "./data.js";
import { evaluateOrder } from "./engine.js";

const TAU = Math.PI * 2;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

export class LineRenderer {
  constructor(canvas, powerCanvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.powerCanvas = powerCanvas;
    this.powerCtx = powerCanvas.getContext("2d");
    this.engine = engine;
    this.previewOrder = null;
    this.previewRecipe = null;
    this.previewOffset = 0;
    this.width = 1000;
    this.height = 472;
    this.dpr = 1;
    this.lastFaultFlash = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = Math.round(rect.width);
    this.height = Math.round(rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const powerRect = this.powerCanvas.getBoundingClientRect();
    this.powerCanvas.width = Math.max(1, Math.round((powerRect.width || 110) * this.dpr));
    this.powerCanvas.height = Math.max(1, Math.round((powerRect.height || 18) * this.dpr));
  }

  setPreview(order, recipe, offset) {
    this.previewOrder = order;
    this.previewRecipe = recipe ? clone(recipe) : null;
    this.previewOffset = offset;
  }

  getSceneData() {
    const engine = this.engine;
    const runtime = engine.runtime;
    const currentIndex = runtime.currentOrderIndex;
    const displayOrder = currentIndex >= 0
      ? engine.getCurrentOrder()
      : this.previewOrder;
    const recipe = currentIndex >= 0
      ? runtime.recipeSnapshot?.[displayOrder?.id]
      : this.previewRecipe;
    const offset = currentIndex >= 0 ? runtime.offsetSnapshot : this.previewOffset;
    const evaluation = displayOrder && recipe
      ? evaluateOrder(displayOrder, recipe, offset)
      : null;
    return {
      order: displayOrder,
      recipe,
      offset,
      evaluation,
      phase: PHASES[runtime.phaseIndex],
      phaseIndex: runtime.phaseIndex,
      phaseProgress: PHASES[runtime.phaseIndex]
        ? clamp(runtime.phaseElapsed / PHASES[runtime.phaseIndex].duration)
        : 0,
      status: engine.status,
      runtime
    };
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const scene = this.getSceneData();
    this.drawBackground(ctx, scene);
    this.drawConveyor(ctx, scene);
    this.drawBackgroundProps(ctx, scene);
    this.drawScanner(ctx, scene);
    this.drawRobot(ctx, scene);
    this.drawSealer(ctx, scene);
    this.drawBox(ctx, scene);
    this.drawForeground(ctx, scene);
    this.drawPowerGraph();
  }

  drawBackground(ctx, scene) {
    const { width: w, height: h } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#0a2119");
    gradient.addColorStop(0.55, "#113228");
    gradient.addColorStop(1, "#081b16");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.48, h * 0.17, 4, w * 0.48, h * 0.1, w * 0.34);
    glow.addColorStop(0, "rgba(137, 198, 139, 0.2)");
    glow.addColorStop(0.35, "rgba(40, 100, 75, 0.08)");
    glow.addColorStop(1, "rgba(4, 20, 15, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.65);

    ctx.strokeStyle = "rgba(195, 229, 196, 0.055)";
    ctx.lineWidth = 1;
    const grid = 44;
    for (let x = -grid; x < w + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.08);
      ctx.lineTo(x + w * 0.16, h * 0.76);
      ctx.stroke();
    }
    for (let y = h * 0.1; y < h * 0.76; y += grid * 0.65) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + 4);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(5, 20, 16, 0.31)";
    ctx.fillRect(0, h * 0.073, w, 2);
    ctx.fillStyle = "rgba(214, 235, 205, 0.05)";
    ctx.fillRect(0, h * 0.073 + 2, w, 1);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#d7ff57";
    ctx.font = `800 ${Math.round(h * 0.4)}px "Manrope", sans-serif`;
    ctx.fillText("07", w * 0.03, h * 0.56);
    ctx.restore();

    ctx.save();
    ctx.translate(w * 0.91, h * 0.31);
    ctx.strokeStyle = "rgba(200, 231, 190, 0.09)";
    ctx.lineWidth = 10;
    ctx.strokeRect(-48, -60, 96, 120);
    ctx.lineWidth = 2;
    ctx.strokeRect(-33, -46, 66, 92);
    ctx.restore();

    if (scene.status === "fault") {
      const redGlow = ctx.createRadialGradient(w * 0.5, h * 0.4, 20, w * 0.5, h * 0.4, w * 0.52);
      redGlow.addColorStop(0, "rgba(255, 63, 33, 0.04)");
      redGlow.addColorStop(1, "rgba(255, 47, 17, 0.21)");
      ctx.fillStyle = redGlow;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawConveyor(ctx, scene) {
    const { width: w, height: h } = this;
    const y = h * 0.775;
    const beltHeight = h * 0.07;

    ctx.fillStyle = "rgba(3, 15, 12, 0.54)";
    ctx.beginPath();
    ctx.moveTo(0, y + beltHeight + 3);
    ctx.lineTo(w, y + beltHeight + 3);
    ctx.lineTo(w, y + beltHeight + 26);
    ctx.lineTo(0, y + beltHeight + 26);
    ctx.closePath();
    ctx.fill();

    const beltGradient = ctx.createLinearGradient(0, y, 0, y + beltHeight);
    beltGradient.addColorStop(0, "#263d34");
    beltGradient.addColorStop(0.35, "#1a2e27");
    beltGradient.addColorStop(1, "#0c2019");
    ctx.fillStyle = beltGradient;
    roundedRect(ctx, 0, y, w, beltHeight, 7);
    ctx.fill();

    ctx.save();
    roundedRect(ctx, 0, y, w, beltHeight, 7);
    ctx.clip();
    const offset = scene.status === "paused" ? 0 : this.engine.animation.beltOffset;
    for (let x = -64 + offset; x < w + 64; x += 64) {
      ctx.fillStyle = "rgba(210, 232, 205, 0.045)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 21, y);
      ctx.lineTo(x + 9, y + beltHeight);
      ctx.lineTo(x - 12, y + beltHeight);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(211, 231, 202, 0.12)";
    ctx.lineWidth = 1;
    for (let x = 8; x < w; x += 41) {
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x - 2, y + beltHeight - 3);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "#d7ff57";
    ctx.fillRect(0, y, w, 2);
    ctx.fillStyle = "rgba(5, 19, 15, 0.65)";
    ctx.fillRect(0, y + beltHeight, w, 3);

    const rollerY = y + beltHeight + 6;
    for (let x = 16; x < w; x += 86) {
      ctx.fillStyle = "#0c1c17";
      ctx.beginPath();
      ctx.arc(x, rollerY, 5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(215, 232, 207, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(7, 22, 17, 0.92)";
    [w * 0.13, w * 0.53, w * 0.84].forEach((x) => {
      ctx.fillRect(x, y + beltHeight + 17, 9, h * 0.09);
      ctx.fillRect(x - 8, y + beltHeight + 17 + h * 0.09, 25, 4);
    });
  }

  drawBackgroundProps(ctx, scene) {
    const { width: w, height: h } = this;
    const beltY = h * 0.775;

    ctx.save();
    ctx.strokeStyle = "rgba(203, 229, 195, 0.13)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.035, h * 0.31);
    ctx.lineTo(w * 0.035, beltY - 8);
    ctx.moveTo(w * 0.95, h * 0.19);
    ctx.lineTo(w * 0.95, beltY - 8);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let y = h * 0.34; y < beltY - 10; y += 24) {
      ctx.beginPath();
      ctx.moveTo(w * 0.035, y);
      ctx.lineTo(w * 0.075, y);
      ctx.moveTo(w * 0.95, y);
      ctx.lineTo(w * 0.91, y);
      ctx.stroke();
    }
    ctx.restore();

    this.drawCartonStack(ctx, w * 0.13, beltY - 2, 0.72, 0);
    this.drawCartonStack(ctx, w * 0.9, beltY - 4, 0.84, 2);

    ctx.save();
    ctx.fillStyle = "rgba(9, 28, 22, 0.78)";
    roundedRect(ctx, w * 0.79, h * 0.21, w * 0.15, h * 0.2, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(197, 228, 188, 0.11)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(215, 255, 87, 0.35)";
    ctx.font = "500 7px 'DM Mono', monospace";
    ctx.fillText("OUTFEED / 07", w * 0.805, h * 0.24);
    ctx.fillStyle = "rgba(196, 227, 186, 0.045)";
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        ctx.fillRect(w * 0.805 + col * 14, h * 0.27 + row * 9, 9, 4);
      }
    }
    ctx.restore();

    ctx.save();
    const lampY = h * 0.105;
    [w * 0.29, w * 0.5, w * 0.68].forEach((x) => {
      ctx.fillStyle = "rgba(5, 18, 14, 0.8)";
      roundedRect(ctx, x - 38, lampY, 76, 5, 2);
      ctx.fill();
      const glow = ctx.createLinearGradient(0, lampY + 5, 0, lampY + 53);
      glow.addColorStop(0, "rgba(230, 255, 196, 0.12)");
      glow.addColorStop(1, "rgba(230, 255, 196, 0)");
      ctx.fillStyle = glow;
      polygon(ctx, [
        [x - 31, lampY + 5],
        [x + 31, lampY + 5],
        [x + 67, lampY + 55],
        [x - 67, lampY + 55]
      ]);
      ctx.fill();
      ctx.fillStyle = "rgba(237, 255, 211, 0.7)";
      ctx.fillRect(x - 24, lampY + 3, 48, 1);
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(213, 255, 87, 0.17)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.strokeRect(w * 0.34, beltY - 101, w * 0.27, 102);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(215, 255, 87, 0.3)";
    ctx.font = "500 7px 'DM Mono', monospace";
    ctx.fillText("PACK ZONE", w * 0.345, beltY - 91);
    ctx.restore();

    if (scene.status === "running" || scene.status === "recovering") {
      const count = 11;
      for (let i = 0; i < count; i += 1) {
        const time = this.engine.animation.clock * 0.35 + i * 0.67;
        const x = w * (0.35 + ((i * 0.071 + time * 0.003) % 0.3));
        const y = beltY - 20 - ((time * 13 + i * 9) % 70);
        ctx.fillStyle = `rgba(215, 255, 87, ${0.07 + (i % 3) * 0.02})`;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
    }
  }

  drawCartonStack(ctx, x, baseY, scale, seed) {
    for (let index = 0; index < 3; index += 1) {
      const width = 54 * scale;
      const height = 32 * scale;
      const y = baseY - (index + 1) * height + index * 1.5;
      ctx.save();
      ctx.globalAlpha = 0.42 - index * 0.06;
      ctx.fillStyle = index === seed ? "#816644" : "#8e754f";
      polygon(ctx, [
        [x - width / 2, y],
        [x + width / 2, y],
        [x + width / 2 - 8 * scale, y + height],
        [x - width / 2 - 8 * scale, y + height]
      ]);
      ctx.fill();
      ctx.fillStyle = "#9e8155";
      polygon(ctx, [
        [x - width / 2, y],
        [x + width / 2, y],
        [x + width / 2 + 10 * scale, y - 7 * scale],
        [x - width / 2 + 10 * scale, y - 7 * scale]
      ]);
      ctx.fill();
      ctx.strokeStyle = "rgba(233, 217, 177, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - width / 2 + 7, y + 10 * scale);
      ctx.lineTo(x + width / 2 - 4, y + 10 * scale);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawScanner(ctx, scene) {
    const { width: w, height: h } = this;
    const beltY = h * 0.775;
    const x = w * 0.29;
    const top = beltY - 107;
    const active = this.engine.devices.scanner.active;
    ctx.save();
    ctx.fillStyle = "#132a23";
    roundedRect(ctx, x - 28, top, 56, 21, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(203, 229, 194, 0.18)";
    ctx.stroke();
    ctx.fillStyle = active ? "#d7ff57" : "rgba(216, 235, 203, 0.23)";
    ctx.fillRect(x - 21, top + 6, 28, 2);
    ctx.fillRect(x - 21, top + 11, 40, 1);
    ctx.fillStyle = "rgba(6, 20, 15, 0.9)";
    ctx.fillRect(x - 23, top + 21, 5, 70);
    ctx.fillRect(x + 18, top + 21, 5, 70);
    ctx.fillStyle = "rgba(215, 255, 87, 0.3)";
    ctx.font = "500 6px 'DM Mono', monospace";
    ctx.fillText("SCN-01", x - 18, top - 7);

    if (active) {
      const beam = ctx.createLinearGradient(x, top + 21, x, beltY);
      beam.addColorStop(0, "rgba(215, 255, 87, 0.32)");
      beam.addColorStop(1, "rgba(215, 255, 87, 0)");
      ctx.fillStyle = beam;
      polygon(ctx, [
        [x - 4, top + 21],
        [x + 4, top + 21],
        [x + 44, beltY - 4],
        [x - 44, beltY - 4]
      ]);
      ctx.fill();
      const scanY = lerp(top + 23, beltY - 4, (scene.phase?.id === "scan" ? scene.phaseProgress : 0.6));
      ctx.strokeStyle = "rgba(215, 255, 87, 0.62)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 40, scanY);
      ctx.lineTo(x + 40, scanY);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRobot(ctx, scene) {
    const { width: w, height: h } = this;
    const beltY = h * 0.775;
    const baseX = w * 0.739;
    const baseY = beltY - 2;
    const active = this.engine.devices.roboticArm.active;
    const feeding = scene.phase?.id === "feed";
    const feed = feeding ? easeInOut(scene.phaseProgress) : 0;
    const idleWave = Math.sin(this.engine.animation.clock * 1.3) * 0.018;
    const baseAngle = -1.92 + feed * 0.13 + idleWave;
    const shoulder = [baseX, baseY - 92];
    const upperLength = h * 0.19;
    const foreLength = h * 0.17;
    const elbow = [
      shoulder[0] + Math.cos(baseAngle) * upperLength,
      shoulder[1] + Math.sin(baseAngle) * upperLength
    ];
    const foreAngle = baseAngle + 1.5 + (1 - feed) * 0.08;
    const wrist = [
      elbow[0] + Math.cos(foreAngle) * foreLength,
      elbow[1] + Math.sin(foreAngle) * foreLength
    ];

    ctx.save();
    ctx.fillStyle = "rgba(3, 14, 10, 0.45)";
    ctx.beginPath();
    ctx.ellipse(baseX + 12, baseY + 10, 76, 12, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#14251f";
    polygon(ctx, [
      [baseX - 50, baseY - 18],
      [baseX + 53, baseY - 18],
      [baseX + 38, baseY + 6],
      [baseX - 34, baseY + 6]
    ]);
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 232, 202, 0.2)";
    ctx.stroke();
    ctx.fillStyle = "#243b32";
    roundedRect(ctx, baseX - 27, baseY - 48, 54, 32, 7);
    ctx.fill();
    ctx.fillStyle = active ? "#d7ff57" : "#5d6b60";
    ctx.fillRect(baseX - 16, baseY - 39, 5, 3);
    ctx.fillRect(baseX - 6, baseY - 39, 5, 3);
    ctx.fillStyle = "rgba(213, 232, 204, 0.24)";
    ctx.font = "500 6px 'DM Mono', monospace";
    ctx.fillText("ARM-01", baseX - 19, baseY + 20);

    const armGradient = ctx.createLinearGradient(shoulder[0], shoulder[1], wrist[0], wrist[1]);
    armGradient.addColorStop(0, "#e8b153");
    armGradient.addColorStop(0.55, "#c98536");
    armGradient.addColorStop(1, "#f0be63");
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 21;
    ctx.beginPath();
    ctx.moveTo(shoulder[0] + 4, shoulder[1] + 5);
    ctx.lineTo(elbow[0] + 4, elbow[1] + 5);
    ctx.lineTo(wrist[0] + 4, wrist[1] + 5);
    ctx.stroke();
    ctx.strokeStyle = armGradient;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(shoulder[0], shoulder[1]);
    ctx.lineTo(elbow[0], elbow[1]);
    ctx.stroke();
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(elbow[0], elbow[1]);
    ctx.lineTo(wrist[0], wrist[1]);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 232, 182, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shoulder[0] - 2, shoulder[1] - 4);
    ctx.lineTo(elbow[0] - 2, elbow[1] - 4);
    ctx.stroke();

    [shoulder, elbow].forEach(([x, y], index) => {
      ctx.fillStyle = "#28362f";
      ctx.beginPath();
      ctx.arc(x, y, index === 0 ? 15 : 12, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#f0bc5e";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#d7ff57";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.fill();
    });

    ctx.beginPath();
    ctx.arc(wrist[0], wrist[1], 9, 0, TAU);
    ctx.fillStyle = "#26372f";
    ctx.fill();
    ctx.strokeStyle = "#eab059";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(235, 188, 101, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(wrist[0], wrist[1], 17, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();

    if (active) {
      ctx.strokeStyle = "rgba(215, 255, 87, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(baseX, shoulder[1], 26 + Math.sin(this.engine.animation.clock * 6) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSealer(ctx, scene) {
    const { width: w, height: h } = this;
    const beltY = h * 0.775;
    const left = w * 0.375;
    const right = w * 0.602;
    const beamY = h * 0.35;
    const active = this.engine.devices.sealer.active;
    const sealing = scene.phase?.id === "seal";
    const progress = sealing ? scene.phaseProgress : 0;
    const headX = lerp(left + 17, right - 17, progress);
    const headY = beamY + 44 + Math.sin(progress * Math.PI) * 23;

    ctx.save();
    ctx.strokeStyle = "rgba(6, 19, 15, 0.55)";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(left + 9, beamY + 24);
    ctx.lineTo(left + 9, beltY - 7);
    ctx.moveTo(right + 9, beamY + 24);
    ctx.lineTo(right + 9, beltY - 7);
    ctx.stroke();
    const steel = ctx.createLinearGradient(left, 0, right, 0);
    steel.addColorStop(0, "#4e5e55");
    steel.addColorStop(0.5, "#7c8a7e");
    steel.addColorStop(1, "#44554b");
    ctx.strokeStyle = steel;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(left, beamY + 24);
    ctx.lineTo(left, beltY - 7);
    ctx.moveTo(right, beamY + 24);
    ctx.lineTo(right, beltY - 7);
    ctx.stroke();
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(left - 8, beamY + 24);
    ctx.lineTo(right + 8, beamY + 24);
    ctx.stroke();
    ctx.fillStyle = "#202f28";
    roundedRect(ctx, left - 23, beltY - 17, 46, 18, 3);
    ctx.fill();
    roundedRect(ctx, right - 23, beltY - 17, 46, 18, 3);
    ctx.fill();

    ctx.fillStyle = "#283a31";
    roundedRect(ctx, headX - 21, headY - 24, 42, 43, 6);
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(215, 255, 87, 0.62)" : "rgba(218, 235, 210, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = active ? "#d7ff57" : "#5b695d";
    ctx.beginPath();
    ctx.arc(headX, headY - 14, 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f2a03e";
    ctx.fillRect(headX - 13, headY + 13, 26, 4);
    ctx.fillStyle = "#343f37";
    ctx.beginPath();
    ctx.arc(headX, headY + 30, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e7dfc7";
    ctx.beginPath();
    ctx.arc(headX, headY + 30, 4, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#34463b";
    roundedRect(ctx, right - 33, beamY - 25, 4, 28, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(right - 31, beamY - 33, 19, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(232, 239, 221, 0.22)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(right - 31, beamY - 33, 12, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(245, 173, 74, 0.6)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(right - 31, beamY - 33, 13, Math.PI * 0.2, Math.PI * 0.9);
    ctx.stroke();

    const cableStart = [right + 5, beamY + 25];
    ctx.strokeStyle = "rgba(9, 17, 13, 0.66)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cableStart[0], cableStart[1]);
    ctx.bezierCurveTo(right + 28, beamY + 60, right + 21, beamY + 100, right + 4, beamY + 111);
    ctx.stroke();

    ctx.fillStyle = "rgba(213, 232, 204, 0.28)";
    ctx.font = "500 6px 'DM Mono', monospace";
    ctx.fillText("SEAL-02 / THERMAL", left - 6, beamY + 6);

    if (active) {
      const glow = ctx.createRadialGradient(headX, headY + 16, 2, headX, headY + 16, 45);
      glow.addColorStop(0, "rgba(255, 166, 57, 0.3)");
      glow.addColorStop(1, "rgba(255, 166, 57, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(headX - 50, headY - 34, 100, 84);
      ctx.strokeStyle = "rgba(245, 176, 83, 0.24)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(headX, headY + 35);
      ctx.lineTo(headX, beltY - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawBox(ctx, scene) {
    const { width: w, height: h } = this;
    const beltY = h * 0.775 - 5;
    const evaluation = scene.evaluation;
    const carton = scene.recipe ? CARTONS[scene.recipe.boxSize] : null;
    const boxRank = carton ? { S: 0, M: 1, L: 2 }[carton.id] : 0;
    const boxWidth = 165 + boxRank * 28;
    const boxHeight = 104 + boxRank * 18;
    const depthX = 27 + boxRank * 5;
    const depthY = 16 + boxRank * 3;
    let centerX = w * 0.468;
    if (scene.phase?.id === "eject") {
      centerX += easeInOut(scene.phaseProgress) * w * 0.17;
    }
    const baseY = beltY;
    const leftX = centerX - boxWidth / 2;
    const rightX = centerX + boxWidth / 2;
    const topY = baseY - boxHeight;
    const sealed = scene.runtime.currentOrderIndex >= 0 &&
      (scene.phaseIndex > 3 || (scene.phaseIndex === 3 && scene.phaseProgress > 0.93));
    const openProgress = scene.phase?.id === "seal"
      ? easeInOut(scene.phaseProgress)
      : (sealed ? 1 : 0);
    const bulge = clamp(Math.abs(scene.offset) / 30, 0, 1) * Math.sign(scene.offset || 1) * 17;
    const offsetWarning = Math.abs(scene.offset) > 10;

    ctx.save();
    ctx.fillStyle = "rgba(2, 12, 8, 0.48)";
    ctx.beginPath();
    ctx.ellipse(centerX + 16, baseY + 8, boxWidth * 0.64, 14, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#9f7745";
    polygon(ctx, [
      [rightX, topY],
      [rightX + depthX, topY - depthY],
      [rightX + depthX, baseY - depthY],
      [rightX, baseY]
    ]);
    ctx.fill();
    ctx.strokeStyle = "rgba(52, 34, 18, 0.33)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const sideLight = ctx.createLinearGradient(rightX, topY, rightX + depthX, baseY);
    sideLight.addColorStop(0, "rgba(255, 224, 168, 0.12)");
    sideLight.addColorStop(1, "rgba(56, 37, 17, 0.18)");
    ctx.fillStyle = sideLight;
    ctx.fill();

    if (openProgress < 0.7) {
      ctx.fillStyle = "#4d3420";
      polygon(ctx, [
        [leftX + 4, topY + 2],
        [rightX - 4, topY + 2],
        [rightX + depthX - 5, topY - depthY + 2],
        [leftX + depthX + 5, topY - depthY + 2]
      ]);
      ctx.fill();
      ctx.fillStyle = "#1f1811";
      polygon(ctx, [
        [leftX + 8, topY + 3],
        [rightX - 8, topY + 3],
        [rightX + depthX - 9, topY - depthY + 5],
        [leftX + depthX + 9, topY - depthY + 5]
      ]);
      ctx.fill();
    }

    this.drawBuffer(ctx, scene, {
      leftX,
      rightX,
      topY,
      baseY,
      depthX,
      depthY,
      openProgress
    });
    this.drawProduct(ctx, scene, {
      centerX,
      topY,
      baseY,
      boxWidth,
      boxHeight,
      openProgress
    });

    const frontGradient = ctx.createLinearGradient(leftX, topY, rightX, baseY);
    frontGradient.addColorStop(0, "#d1a462");
    frontGradient.addColorStop(0.45, "#bd8c4d");
    frontGradient.addColorStop(1, "#9c6e39");
    ctx.fillStyle = frontGradient;
    roundedRect(ctx, leftX, topY, boxWidth, boxHeight, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(79, 48, 22, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 232, 187, 0.12)";
    ctx.fillRect(leftX + 7, topY + 5, 2, boxHeight - 10);
    ctx.strokeStyle = "rgba(89, 56, 27, 0.2)";
    ctx.beginPath();
    ctx.moveTo(leftX + 10, topY + boxHeight * 0.52);
    ctx.lineTo(rightX - 8, topY + boxHeight * 0.52);
    ctx.stroke();

    const labelX = leftX + 15;
    const labelY = topY + 23;
    ctx.fillStyle = "rgba(249, 240, 213, 0.82)";
    roundedRect(ctx, labelX, labelY, 56, 30, 2);
    ctx.fill();
    ctx.fillStyle = "rgba(40, 38, 29, 0.7)";
    ctx.font = "500 5px 'DM Mono', monospace";
    ctx.fillText("PACK / 07", labelX + 5, labelY + 8);
    ctx.fillRect(labelX + 5, labelY + 12, 29, 1);
    ctx.fillRect(labelX + 5, labelY + 15, 41, 1);
    ctx.fillStyle = scene.order?.accent || "#6e8778";
    ctx.fillRect(labelX + 5, labelY + 20, 4, 6);
    ctx.fillStyle = "rgba(40, 38, 29, 0.7)";
    ctx.font = "600 6px 'DM Mono', monospace";
    ctx.fillText(scene.order?.code || "NO-ORDER", labelX + 12, labelY + 25);

    this.drawBoxFlaps(ctx, {
      leftX,
      rightX,
      topY,
      depthX,
      depthY,
      openProgress,
      bulge: offsetWarning ? bulge : 0,
      sealed
    });
    if (sealed || openProgress > 0.72) {
      this.drawTape(ctx, scene, {
        leftX,
        rightX,
        topY,
        baseY,
        boxWidth,
        boxHeight,
        depthX,
        depthY,
        reveal: scene.phaseIndex === 3 ? easeInOut(clamp((scene.phaseProgress - 0.54) / 0.46)) : 1,
        bulge: offsetWarning ? bulge : 0
      });
    }

    if (evaluation && !evaluation.good && scene.runtime.currentOrderIndex >= 0) {
      this.drawQualityFlag(ctx, scene, { centerX, topY, boxWidth, boxHeight });
    }

    if (offsetWarning) {
      ctx.strokeStyle = "rgba(255, 106, 61, 0.7)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX - 4, topY - 2);
      ctx.lineTo(rightX + depthX + 5, topY - depthY - 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawBuffer(ctx, scene, geometry) {
    const { leftX, rightX, topY, depthX, depthY, openProgress } = geometry;
    if (!scene.recipe || openProgress > 0.72) return;
    const buffer = BUFFERS[scene.recipe.buffer];
    if (!buffer || buffer.id === "none") return;
    const bufferActive = scene.phase?.id === "buffer";
    const drop = bufferActive ? easeInOut(scene.phaseProgress) : 1;
    const color = buffer.id === "foam" ? "#ead5a8" : "#dcc083";
    const edge = buffer.id === "foam" ? "#bf9f63" : "#ad874a";
    const pieces = [
      [leftX + 6, topY - 1, 9, 27, -0.08],
      [rightX - 15, topY - 1, 9, 27, 0.08],
      [leftX + depthX + 8, topY - depthY + 4, 28, 7, -0.18]
    ];
    pieces.forEach(([x, y, width, height, rotation], index) => {
      const delayed = clamp(drop * 1.35 - index * 0.13);
      if (delayed <= 0) return;
      ctx.save();
      ctx.translate(x, y - (1 - delayed) * 36);
      ctx.rotate(rotation);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.7;
      ctx.strokeRect(0, 0, width, height);
      if (buffer.id === "honey") {
        ctx.strokeStyle = "rgba(125, 84, 33, 0.38)";
        ctx.lineWidth = 0.5;
        for (let offset = 2; offset < width; offset += 4) {
          ctx.beginPath();
          ctx.moveTo(offset, 0);
          ctx.lineTo(offset + 4, height);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(offset, height);
          ctx.lineTo(offset + 4, 0);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
        ctx.fillRect(1, 1, width - 2, 1);
      }
      ctx.restore();
    });
  }

  drawProduct(ctx, scene, geometry) {
    if (!scene.order || !scene.recipe) return;
    const { centerX, topY, baseY, boxWidth, boxHeight, openProgress } = geometry;
    const phaseId = scene.phase?.id;
    if (scene.runtime.currentOrderIndex < 0 && scene.status !== "idle") return;
    if (scene.status === "complete") return;
    const offsetShift = clamp(scene.offset / 30, -1, 1) * 15;
    let x = centerX + offsetShift;
    let y = topY - 22;
    let scale = 0.76;
    let alpha = 1;
    if (phaseId === "feed") {
      const t = easeInOut(scene.phaseProgress);
      x = lerp(this.width * 0.635, centerX + offsetShift, t);
      y = lerp(topY + 52, topY + 14, t);
      scale = lerp(0.74, 0.76, t);
      alpha = clamp(t * 3);
    } else if (phaseId === "scan") {
      if (scene.runtime.currentOrderIndex >= 0) {
        x = this.width * 0.635;
        y = topY + 52;
      }
      alpha = 1;
    } else if (phaseId === "seal" && openProgress > 0.35) {
      alpha = 1 - clamp((openProgress - 0.35) / 0.35);
    }
    if (alpha <= 0) return;
    const width = Math.min(boxWidth - 36, 104) * scale;
    const height = Math.min(boxHeight - 33, 66) * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(37, 28, 18, 0.27)";
    ctx.beginPath();
    ctx.ellipse(2, height * 0.38, width * 0.5, 7, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = scene.order.accent;
    roundedRect(ctx, -width / 2, -height / 2, width, height, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(23, 31, 27, 0.33)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.23)";
    ctx.beginPath();
    ctx.moveTo(-width / 2 + 5, -height / 2 + 2);
    ctx.lineTo(width / 2 - 7, -height / 2 + 2);
    ctx.lineTo(width / 2 - 13, -height / 2 + 9);
    ctx.lineTo(-width / 2 + 10, -height / 2 + 9);
    ctx.closePath();
    ctx.fill();

    this.drawProductDetail(ctx, scene.order, width, height);
    ctx.fillStyle = "rgba(15, 35, 28, 0.68)";
    ctx.font = "600 6px 'DM Mono', monospace";
    ctx.fillText(scene.order.code, -width / 2 + 7, height / 2 - 7);
    ctx.fillStyle = "rgba(249, 243, 224, 0.82)";
    ctx.font = "500 4.5px 'DM Mono', monospace";
    ctx.fillText("HANDLE WITH CARE", width * 0.04, height / 2 - 7);
    ctx.restore();

    if (phaseId === "buffer" && scene.phaseProgress > 0.2) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "rgba(215, 255, 87, 0.7)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(x, y, width * 0.55 + scene.phaseProgress * 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (phaseId === "feed" && scene.phaseProgress > 0.9 && y < baseY) {
      ctx.fillStyle = "rgba(215, 255, 87, 0.28)";
      ctx.fillRect(centerX - 2, topY + 4, 4, 1);
    }
  }

  drawProductDetail(ctx, order, width, height) {
    ctx.save();
    if (["gear", "motor", "pump"].includes(order.shape)) {
      const radius = Math.min(height * 0.27, 15);
      ctx.fillStyle = "rgba(25, 38, 33, 0.34)";
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * TAU;
        ctx.save();
        ctx.rotate(angle);
        ctx.fillRect(radius - 2, -2, 5, 4);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(224, 230, 213, 0.6)";
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.43, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(27, 41, 34, 0.7)";
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.18, 0, TAU);
      ctx.fill();
    } else if (["module", "drive"].includes(order.shape)) {
      ctx.fillStyle = "rgba(20, 51, 41, 0.31)";
      ctx.fillRect(-width * 0.31, -height * 0.14, width * 0.62, height * 0.32);
      ctx.strokeStyle = "rgba(229, 242, 220, 0.35)";
      ctx.lineWidth = 0.6;
      for (let row = 0; row < 3; row += 1) {
        ctx.beginPath();
        ctx.moveTo(-width * 0.24, -height * 0.08 + row * 5);
        ctx.lineTo(width * (0.05 + row * 0.05), -height * 0.08 + row * 5);
        ctx.stroke();
      }
      ctx.fillStyle = "#d7ff57";
      ctx.fillRect(width * 0.19, -height * 0.08, 4, 2);
    } else if (order.shape === "sensor") {
      ctx.fillStyle = "rgba(21, 43, 35, 0.38)";
      roundedRect(ctx, -width * 0.25, -height * 0.1, width * 0.15, height * 0.3, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-width * 0.17, -height * 0.1, height * 0.15, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = "#d7ff57";
      ctx.fillRect(width * 0.18, -height * 0.01, 3, 3);
    } else if (order.shape === "rail") {
      ctx.fillStyle = "rgba(20, 36, 30, 0.36)";
      ctx.fillRect(-width * 0.36, -height * 0.16, width * 0.72, 5);
      ctx.fillStyle = "rgba(238, 239, 224, 0.62)";
      for (let x = -width * 0.29; x < width * 0.3; x += 13) {
        ctx.fillRect(x, -height * 0.04, 4, 3);
      }
    } else {
      ctx.fillStyle = "rgba(19, 38, 31, 0.3)";
      ctx.fillRect(-width * 0.25, -height * 0.1, width * 0.5, height * 0.2);
      ctx.fillStyle = "rgba(238, 241, 224, 0.6)";
      ctx.fillRect(-width * 0.16, -height * 0.01, width * 0.32, 1);
    }
    ctx.restore();
  }

  drawBoxFlaps(ctx, geometry) {
    const { leftX, rightX, topY, depthX, depthY, openProgress, bulge, sealed } = geometry;
    const close = easeInOut(clamp(openProgress));
    const topBackY = topY - depthY;
    const topCx = (leftX + rightX) / 2 + depthX / 2 + bulge * close;
    const flapColor = "#c79a58";
    const flapEdge = "rgba(77, 46, 20, 0.38)";

    if (!sealed && close < 0.78) {
      ctx.save();
      ctx.translate(leftX + 4, topY);
      ctx.rotate(-0.17 * (1 - close));
      ctx.fillStyle = flapColor;
      polygon(ctx, [
        [0, 0],
        [(rightX - leftX) * 0.48, 0],
        [(rightX - leftX) * 0.43 + depthX * 0.6, -depthY * 0.35],
        [depthX * 0.5, -depthY * 0.74]
      ]);
      ctx.fill();
      ctx.strokeStyle = flapEdge;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(rightX - 4, topY);
      ctx.rotate(0.12 * (1 - close));
      ctx.fillStyle = "#b98a4b";
      polygon(ctx, [
        [0, 0],
        [-(rightX - leftX) * 0.44, 0],
        [-(rightX - leftX) * 0.38 + depthX * 0.62, -depthY * 0.4],
        [depthX * 0.5, -depthY * 0.8]
      ]);
      ctx.fill();
      ctx.strokeStyle = flapEdge;
      ctx.stroke();
      ctx.restore();
    }

    if (close > 0.55 || sealed) {
      const lift = (1 - close) * 12;
      ctx.fillStyle = "#cda05e";
      ctx.beginPath();
      if (bulge) {
        ctx.moveTo(leftX + 4, topY - lift);
        for (let x = leftX + 4; x <= rightX - 4; x += 8) {
          const wave = Math.sin((x - leftX) * 0.16) * 2.2;
          ctx.lineTo(x, topY - lift - wave);
        }
        ctx.lineTo(rightX + depthX - 4, topBackY - lift + 1);
        ctx.lineTo(leftX + depthX + 4, topBackY - lift + 1);
      } else {
        ctx.moveTo(leftX + 3, topY - lift);
        ctx.lineTo(rightX - 3, topY - lift);
        ctx.lineTo(rightX + depthX - 3, topBackY - lift);
        ctx.lineTo(leftX + depthX + 3, topBackY - lift);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = flapEdge;
      ctx.stroke();
      ctx.strokeStyle = "rgba(95, 61, 27, 0.24)";
      ctx.beginPath();
      ctx.moveTo(topCx - 34, topY - 2);
      ctx.lineTo(topCx - 15, topY - 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(74, 46, 21, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftX + 3, topY);
      ctx.lineTo(rightX + depthX, topBackY);
      ctx.stroke();
    }
  }

  drawTape(ctx, scene, geometry) {
    const { leftX, rightX, topY, baseY, boxWidth, boxHeight, depthX, depthY, reveal, bulge } = geometry;
    if (!scene.recipe) return;
    const path = TAPE_PATHS[scene.recipe.tapePath];
    if (!path) return;
    const amount = clamp(reveal);
    if (amount <= 0) return;
    const topBackY = topY - depthY;
    const topCx = (leftX + rightX) / 2 + depthX / 2 + bulge;
    const tapeFront = "#ed9d3c";
    const tapeLight = "rgba(255, 226, 160, 0.62)";
    const tapeEdge = "rgba(130, 80, 23, 0.4)";

    ctx.save();
    if (path.id === "H") {
      ctx.fillStyle = tapeFront;
      polygon(ctx, [
        [topCx - 5, topY + 1],
        [topCx + 4, topY + 1],
        [topCx + 4 + depthX * 0.76, topBackY + 1],
        [topCx - 5 + depthX * 0.76, topBackY + 1]
      ]);
      ctx.fill();
      ctx.strokeStyle = tapeEdge;
      ctx.stroke();
      const tapeHeight = (boxHeight - 2) * amount;
      ctx.fillStyle = tapeFront;
      ctx.fillRect(topCx - 6, topY, 12, tapeHeight);
      ctx.fillStyle = tapeLight;
      ctx.fillRect(topCx - 4, topY, 2, tapeHeight);
      ctx.strokeStyle = tapeEdge;
      ctx.strokeRect(topCx - 6, topY, 12, tapeHeight);
      for (let y = topY + 8; y < topY + tapeHeight; y += 12) {
        ctx.strokeStyle = "rgba(255, 238, 199, 0.25)";
        ctx.beginPath();
        ctx.moveTo(topCx - 5, y);
        ctx.lineTo(topCx + 5, y + 3);
        ctx.stroke();
      }
    } else if (path.id === "C") {
      [-1, 1].forEach((direction) => {
        const x = topCx + direction * (boxWidth / 2 - 12);
        const tapeHeight = (boxHeight - 2) * amount;
        ctx.fillStyle = tapeFront;
        ctx.fillRect(x - 5, topY, 10, tapeHeight);
        ctx.fillStyle = tapeLight;
        ctx.fillRect(x - 3, topY, 2, tapeHeight);
        ctx.strokeStyle = tapeEdge;
        ctx.strokeRect(x - 5, topY, 10, tapeHeight);
        polygon(ctx, [
          [x - 5, topY + 1],
          [x + 5, topY + 1],
          [x + 5 + depthX * 0.76, topBackY + 1],
          [x - 5 + depthX * 0.76, topBackY + 1]
        ]);
        ctx.fill();
      });
    } else {
      ctx.save();
      roundedRect(ctx, leftX, topY, boxWidth, boxHeight, 3);
      ctx.clip();
      const clippedHeight = boxHeight * amount;
      ctx.fillStyle = tapeFront;
      ctx.save();
      ctx.translate(topCx, topY + boxHeight * 0.48);
      ctx.rotate(0.69);
      ctx.fillRect(-6, -boxHeight * 0.8, 12, boxHeight * 1.6);
      ctx.fillStyle = tapeLight;
      ctx.fillRect(-3, -boxHeight * 0.8, 2, boxHeight * 1.6);
      ctx.fillStyle = tapeFront;
      ctx.restore();
      ctx.save();
      ctx.translate(topCx, topY + boxHeight * 0.48);
      ctx.rotate(-0.69);
      ctx.fillRect(-6, -boxHeight * 0.8, 12, boxHeight * 1.6);
      ctx.restore();
      ctx.fillStyle = "rgba(9, 29, 22, 0.36)";
      ctx.fillRect(leftX, topY + clippedHeight, boxWidth, boxHeight - clippedHeight);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = amount;
      ctx.strokeStyle = tapeFront;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(topCx - 25, topY);
      ctx.lineTo(topCx + 25 + depthX * 0.3, topBackY);
      ctx.moveTo(topCx + 25, topY);
      ctx.lineTo(topCx - 25 + depthX * 0.3, topBackY);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  drawQualityFlag(ctx, scene, geometry) {
    const { centerX, topY, boxWidth, boxHeight } = geometry;
    const issue = scene.evaluation.issues[0];
    if (!issue) return;
    const tagY = topY - 66;
    const width = 128;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 91, 66, 0.7)";
    ctx.lineWidth = 1.2;
    const corner = 13;
    [
      [centerX - boxWidth / 2 - 2, topY - 4, 1, 1],
      [centerX + boxWidth / 2 + 2, topY - 4, -1, 1],
      [centerX - boxWidth / 2 - 2, topY + boxHeight + 2, 1, -1],
      [centerX + boxWidth / 2 + 2, topY + boxHeight + 2, -1, -1]
    ].forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x + corner * dx, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + corner * dy);
      ctx.stroke();
    });
    ctx.fillStyle = "rgba(58, 14, 7, 0.9)";
    roundedRect(ctx, centerX - width / 2, tagY, width, 25, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 111, 81, 0.45)";
    ctx.stroke();
    ctx.fillStyle = "#ff816a";
    ctx.font = "500 6px 'DM Mono', monospace";
    ctx.fillText(issue.code, centerX - width / 2 + 8, tagY + 9);
    ctx.fillStyle = "rgba(255, 235, 228, 0.82)";
    ctx.font = "500 7px 'Noto Sans SC', sans-serif";
    ctx.fillText(issue.message.slice(0, 18), centerX - width / 2 + 8, tagY + 18);
    ctx.restore();
  }

  drawForeground(ctx, scene) {
    const { width: w, height: h } = this;
    const vignette = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.5, w * 0.7);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(2, 12, 8, 0.44)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    const floorGlow = ctx.createLinearGradient(0, h * 0.82, 0, h);
    floorGlow.addColorStop(0, "rgba(48, 101, 72, 0.08)");
    floorGlow.addColorStop(1, "rgba(3, 15, 11, 0.24)");
    ctx.fillStyle = floorGlow;
    ctx.fillRect(0, h * 0.82, w, h * 0.18);

    if (scene.phase?.id === "seal" && this.engine.devices.sealer.active) {
      const centerX = w * 0.47;
      const centerY = h * 0.5;
      for (let index = 0; index < 9; index += 1) {
        const angle = index * 1.91 + this.engine.animation.clock * 4;
        const radius = 20 + (index % 3) * 9;
        ctx.fillStyle = `rgba(255, 194, 89, ${0.2 + (index % 2) * 0.2})`;
        ctx.fillRect(
          centerX + Math.cos(angle) * radius,
          centerY + Math.sin(angle) * radius * 0.55,
          1.4,
          1.4
        );
      }
    }

    if (scene.status === "complete") {
      ctx.fillStyle = "rgba(215, 255, 87, 0.045)";
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = "rgba(215, 255, 87, 0.26)";
    ctx.font = "500 6px 'DM Mono', monospace";
    ctx.fillText("SIMULATION / SAFE ENVELOPE", 18, h - 13);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(215, 235, 207, 0.22)";
    ctx.fillText(`LIVE · ${new Date().toLocaleDateString("zh-CN")}`, w - 18, h - 13);
    ctx.textAlign = "left";
  }

  drawPowerGraph() {
    const ctx = this.powerCtx;
    if (!ctx) return;
    const dpr = this.dpr;
    const width = this.powerCanvas.width / dpr;
    const height = this.powerCanvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const data = this.engine.powerHistory.slice(-45);
    if (data.length < 2) return;
    const max = Math.max(8.4, ...data);
    ctx.strokeStyle = "rgba(199, 227, 190, 0.08)";
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const points = data.map((value, index) => [
      (index / (data.length - 1)) * width,
      height - (value / max) * (height - 3) - 1
    ]);
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, "rgba(215, 255, 87, 0.23)");
    fill.addColorStop(1, "rgba(215, 255, 87, 0)");
    ctx.beginPath();
    ctx.moveTo(0, height);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#d7ff57";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const last = points.at(-1);
    ctx.fillStyle = "#d7ff57";
    ctx.beginPath();
    ctx.arc(last[0], last[1], 1.6, 0, TAU);
    ctx.fill();
  }
}
