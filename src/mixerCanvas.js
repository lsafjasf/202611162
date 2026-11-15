import { clamp, STAGE_LABELS } from "./simulator.js";

const BASE_WIDTH = 760;
const BASE_HEIGHT = 480;

const PALETTE = {
  powderA: "#dbb06f",
  powderB: "#8db4a4",
  powderC: "#d16750",
  acid: "#c9f26a",
  mint: "#59d5ac",
  amber: "#f0b35a",
  red: "#f16c5c",
  muted: "#7e958b",
};

function mixColor(colors, weights) {
  const totals = [0, 0, 0];
  let weightSum = 0;
  colors.forEach((hex, index) => {
    const weight = weights[index] || 0;
    const value = Number.parseInt(hex.slice(1), 16);
    totals[0] += ((value >> 16) & 255) * weight;
    totals[1] += ((value >> 8) & 255) * weight;
    totals[2] += (value & 255) * weight;
    weightSum += weight;
  });
  const safe = Math.max(weightSum, 0.001);
  return `rgb(${totals.map((item) => Math.round(item / safe)).join(",")})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function statusColor(status) {
  if (status === "running") return PALETTE.acid;
  if (status === "fault") return PALETTE.red;
  return "#52665e";
}

export class MixerCanvas {
  constructor(canvas, powerCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.powerCanvas = powerCanvas;
    this.powerCtx = powerCanvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.powerHistory = [];
    this.lastPowerSample = -1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resizeObserver.observe(powerCanvas.parentElement);
    this.resize();
  }

  resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvasRect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, canvasRect.width);
    this.height = Math.max(1, canvasRect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const powerRect = this.powerCanvas.getBoundingClientRect();
    this.powerCanvas.width = Math.round(Math.max(1, powerRect.width) * ratio);
    this.powerCanvas.height = Math.round(Math.max(1, powerRect.height) * ratio);
    this.powerCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  render(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const scale = Math.min(this.width / BASE_WIDTH, this.height / BASE_HEIGHT);
    const offsetX = (this.width - BASE_WIDTH * scale) / 2;
    const offsetY = (this.height - BASE_HEIGHT * scale) / 2;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    this.drawBackdrop(ctx);
    this.drawDrum(ctx, state, 184, 83, 292, 338);
    this.drawFeeds(ctx, state, 184, 83, 292, 338);
    this.drawMotor(ctx, state, 98, 198);
    this.drawFan(ctx, state, 596, 124);
    this.drawValve(ctx, state, 330, 421);
    this.drawSampling(ctx, state, 184, 83, 292, 338);
    this.drawReadouts(ctx, state);
    ctx.restore();

    this.updatePower(state);
  }

  drawBackdrop(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(89, 213, 172, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 20; x < BASE_WIDTH; x += 38) {
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, BASE_HEIGHT - 20);
      ctx.stroke();
    }
    for (let y = 20; y < BASE_HEIGHT; y += 38) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(BASE_WIDTH - 20, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(141, 161, 152, 0.44)";
    ctx.font = "8px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "left";
    ctx.fillText("SECTION A–A / 1:24", 28, 30);
    ctx.textAlign = "right";
    ctx.fillText("STATIC BED SENSOR GRID", BASE_WIDTH - 28, 30);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "rgba(155, 189, 171, 0.12)";
    ctx.beginPath();
    ctx.moveTo(184, 452);
    ctx.lineTo(476, 452);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.fillStyle = "rgba(141, 161, 152, 0.35)";
    ctx.textAlign = "center";
    ctx.fillText("Ø 820 mm  /  V = 0.68 m³", 330, 464);
    ctx.restore();
  }

  drawDrum(ctx, state, x, y, width, height) {
    const active = state.phase === "mixing" || state.phase === "feeding";
    const running = state.equipment?.motor?.status === "running";
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    roundedRect(ctx, x, y, width, height, 42);
    ctx.fillStyle = "#14211d";
    ctx.fill();
    ctx.restore();

    roundedRect(ctx, x, y, width, height, 42);
    ctx.save();
    const shellGradient = ctx.createLinearGradient(x, y, x + width, y);
    shellGradient.addColorStop(0, "#3a4b43");
    shellGradient.addColorStop(0.08, "#1a2924");
    shellGradient.addColorStop(0.5, "#35483f");
    shellGradient.addColorStop(0.92, "#18241f");
    shellGradient.addColorStop(1, "#46594e");
    ctx.strokeStyle = shellGradient;
    ctx.lineWidth = 8;
    ctx.stroke();

    roundedRect(ctx, x + 8, y + 8, width - 16, height - 16, 34);
    ctx.fillStyle = "#09130f";
    ctx.fill();
    ctx.clip();

    this.drawDrumInterior(ctx, state, x + 8, y + 8, width - 16, height - 16, active, running);
    this.drawPowderBed(ctx, state, x + 8, y + 8, width - 16, height - 16);
    this.drawShaftAndBlades(ctx, state, x + width / 2, y + 50, height - 100);
    ctx.restore();

    this.drawDrumHardware(ctx, state, x, y, width, height);
  }

  phaseProgress(state) {
    if (!state.stageDuration) return 0;
    return clamp(state.stageElapsed / state.stageDuration, 0, 1);
  }

  powderFill(state) {
    const progress = this.phaseProgress(state);
    if (state.phase === "feeding") return 0.16 + progress * 0.43;
    if (state.phase === "mixing") return 0.6;
    if (state.phase === "discharging") return 0.6 * (1 - progress * 0.92);
    if (state.phase === "complete") return 0.07;
    if (state.phase === "interlock") return 0.34;
    return 0.34;
  }

  drawPowderBed(ctx, state, x, y, width, height) {
    const uniformity = clamp(state.uniformity || 0, 0, 100);
    const progress = this.phaseProgress(state);
    const fill = this.powderFill(state);
    const bedHeight = Math.max(8, height * fill);
    const bedTop = y + height - bedHeight;
    const mixedColor = mixColor(
      [PALETTE.powderA, PALETTE.powderB, PALETTE.powderC],
      [0.38, 0.4, 0.22],
    );

    const bedGradient = ctx.createLinearGradient(0, bedTop, 0, y + height);
    bedGradient.addColorStop(0, mixColor([PALETTE.powderA, PALETTE.powderB, PALETTE.powderC], [0.42, 0.31, 0.27]));
    bedGradient.addColorStop(0.48, mixedColor);
    bedGradient.addColorStop(1, "#6e624d");
    ctx.fillStyle = bedGradient;
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, bedTop + 4);
    for (let px = 0; px <= width; px += 12) {
      const wave = Math.sin(px * 0.042 + state.elapsed * 0.8) * (state.phase === "mixing" ? 2.3 : 0.8);
      ctx.lineTo(x + px, bedTop + wave);
    }
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
    ctx.fill();

    const layerOpacity = clamp(1 - uniformity / 78, 0, 0.92);
    if (layerOpacity > 0.015) {
      const layerOrder = state.params?.feedOrder || ["B", "A", "C"];
      const colors = {
        A: "rgba(219, 176, 111, 0.74)",
        B: "rgba(141, 180, 164, 0.68)",
        C: "rgba(209, 103, 80, 0.72)",
      };
      const bandHeight = bedHeight / 3;
      ctx.globalAlpha = layerOpacity;
      layerOrder.forEach((powder, index) => {
        const top = bedTop + bandHeight * index;
        ctx.fillStyle = colors[powder];
        ctx.beginPath();
        ctx.moveTo(x, top + bandHeight + 1);
        ctx.lineTo(x, top + 2);
        for (let px = 0; px <= width; px += 10) {
          const wave = Math.sin(px * 0.038 + index * 2.4) * (1.1 + (100 - uniformity) * 0.045);
          ctx.lineTo(x + px, top + wave);
        }
        ctx.lineTo(x + width, top + bandHeight + 1);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    this.drawParticles(ctx, state, x, bedTop, width, bedHeight, uniformity, progress);
    this.drawClumps(ctx, state, x, bedTop, width, bedHeight);
    this.drawBedSurface(ctx, state, x, bedTop, width);
  }

  drawParticles(ctx, state, x, bedTop, width, bedHeight, uniformity, progress) {
    const colors = [PALETTE.powderA, PALETTE.powderB, PALETTE.powderC];
    const count = 88;
    const rpm = state.params?.rpm || 0;
    const mixing = state.phase === "mixing" || state.phase === "discharging";
    const motion = mixing ? state.elapsed * (0.25 + rpm * 0.009) : state.elapsed * 0.06;
    ctx.save();
    for (let index = 0; index < count; index += 1) {
      const seedX = (Math.sin(index * 12.9898 + state.seed) * 43758.5453) % 1;
      const seedY = (Math.sin(index * 78.233 + state.seed * 0.3) * 12543.123) % 1;
      const sx = Math.abs(seedX);
      const sy = Math.abs(seedY);
      const dispersion = uniformity / 100;
      const clusterBand = (index % 3) / 3;
      const normalizedY = clusterBand * (1 - dispersion) + sy * dispersion;
      const driftX = Math.sin(motion + index * 1.73) * (2 + dispersion * 9);
      const driftY = Math.cos(motion * 0.82 + index * 0.97) * (1 + dispersion * 4);
      const px = x + 10 + sx * (width - 20) + driftX;
      const py = clamp(bedTop + bedHeight - 5 - normalizedY * (bedHeight - 13) + driftY, bedTop + 3, bedTop + bedHeight - 2);
      ctx.globalAlpha = 0.36 + ((index % 5) * 0.07);
      ctx.fillStyle = colors[index % 3];
      ctx.beginPath();
      ctx.arc(px, py, 0.8 + (index % 3) * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (state.agglomeration > 2) {
      ctx.save();
      ctx.strokeStyle = "rgba(240, 179, 90, 0.28)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(x + 8, bedTop + 4, width - 16, bedHeight - 8);
      ctx.restore();
    }
  }

  drawClumps(ctx, state, x, bedTop, width, bedHeight) {
    const clumpCount = clamp(Math.round(state.agglomeration / 3), 0, 14);
    if (!clumpCount) return;
    ctx.save();
    for (let index = 0; index < clumpCount; index += 1) {
      const px = x + 24 + ((index * 53 + state.seed * 7) % Math.max(1, width - 48));
      const py = bedTop + 14 + ((index * 37 + state.seed * 3) % Math.max(1, bedHeight - 32));
      const radius = 2.5 + (index % 3);
      ctx.fillStyle = "rgba(240, 179, 90, 0.24)";
      ctx.shadowColor = "rgba(240, 179, 90, 0.65)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9a6439";
      ctx.beginPath();
      ctx.arc(px - 0.7, py - 0.5, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBedSurface(ctx, state, x, bedTop, width) {
    const flowing = state.phase === "feeding";
    ctx.save();
    ctx.strokeStyle = flowing ? "rgba(201, 242, 106, 0.6)" : "rgba(239, 222, 182, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px <= width; px += 5) {
      const y = bedTop + Math.sin(px * 0.06 + state.elapsed * 2.2) * (flowing ? 2 : 0.8);
      if (px === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x + px, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawShaftAndBlades(ctx, state, centerX, top, height) {
    const running = state.equipment?.motor?.status === "running" && !state.paused;
    const rpm = state.params?.rpm || 0;
    const angle = running ? state.elapsed * (0.45 + rpm * 0.025) : 0;
    ctx.save();
    ctx.strokeStyle = "rgba(141, 161, 152, 0.2)";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let index = 0; index < 4; index += 1) {
      const offset = index * 58;
      ctx.beginPath();
      ctx.moveTo(centerX - 32, top + offset);
      ctx.bezierCurveTo(
        centerX - 90,
        top + offset + 20 + Math.sin(angle + index) * 8,
        centerX - 70,
        top + offset + 57,
        centerX - 18,
        top + offset + 53,
      );
      ctx.stroke();
    }
    const shaftGradient = ctx.createLinearGradient(centerX - 7, 0, centerX + 7, 0);
    shaftGradient.addColorStop(0, "#55665d");
    shaftGradient.addColorStop(0.5, "#c0c9bb");
    shaftGradient.addColorStop(1, "#34433c");
    ctx.strokeStyle = shaftGradient;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(centerX, top - 25);
    ctx.lineTo(centerX, top + height + 12);
    ctx.stroke();
    ctx.fillStyle = "rgba(201, 242, 106, 0.45)";
    ctx.beginPath();
    ctx.arc(centerX, top + 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawDrumHardware(ctx, state, x, y, width, height) {
    ctx.save();
    ctx.fillStyle = "#26372f";
    ctx.fillRect(x + width / 2 - 15, y - 18, 30, 28);
    ctx.strokeStyle = "rgba(201, 242, 106, 0.18)";
    ctx.strokeRect(x + width / 2 - 15, y - 18, 30, 28);
    ctx.fillStyle = "#1b2a24";
    ctx.fillRect(x + width / 2 - 22, y - 28, 44, 12);
    ctx.fillStyle = "rgba(201, 242, 106, 0.55)";
    ctx.fillRect(x + width / 2 - 2, y - 25, 4, 3);

    ctx.fillStyle = "rgba(141, 161, 152, 0.52)";
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "left";
    ctx.fillText("V-240", x - 6, y + 18);
    ctx.fillStyle = "rgba(201, 242, 106, 0.72)";
    ctx.fillText("INTERNAL", x - 6, y + 30);

    const fill = this.powderFill(state);
    ctx.strokeStyle = "rgba(141, 161, 152, 0.18)";
    ctx.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const markY = y + height - (height - 16) * (index / 5);
      ctx.beginPath();
      ctx.moveTo(x + width + 10, markY);
      ctx.lineTo(x + width + (index % 2 ? 19 : 24), markY);
      ctx.stroke();
    }
    const levelY = y + height - 8 - (height - 16) * fill;
    ctx.strokeStyle = "rgba(201, 242, 106, 0.4)";
    ctx.beginPath();
    ctx.moveTo(x + width + 9, levelY);
    ctx.lineTo(x + width + 27, levelY);
    ctx.stroke();
    ctx.fillStyle = "rgba(201, 242, 106, 0.6)";
    ctx.font = "6px Cascadia Mono, MixCJK, monospace";
    ctx.fillText(`${Math.round(fill * 100)}%`, x + width + 11, levelY - 4);

    ctx.fillStyle = "#1a2923";
    ctx.strokeStyle = "rgba(155, 189, 171, 0.2)";
    ctx.fillRect(x + 42, y + height + 2, 22, 23);
    ctx.strokeRect(x + 42, y + height + 2, 22, 23);
    ctx.fillRect(x + width - 64, y + height + 2, 22, 23);
    ctx.strokeRect(x + width - 64, y + height + 2, 22, 23);
    ctx.restore();
  }

  drawFeeds(ctx, state, drumX, drumY, drumWidth) {
    const order = state.params?.feedOrder || ["B", "A", "C"];
    const colors = { A: PALETTE.powderA, B: PALETTE.powderB, C: PALETTE.powderC };
    const centers = [drumX + 58, drumX + drumWidth / 2, drumX + drumWidth - 58];
    const portX = drumX + drumWidth / 2;
    const portY = drumY - 21;
    ctx.save();
    order.forEach((powder, index) => {
      const center = centers[index];
      const active = state.phase === "feeding" && state.feedIndex === index;
      const fed = state.phase !== "feeding" || state.feedIndex > index || state.phase === "idle";
      ctx.strokeStyle = "rgba(141, 161, 152, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(center, 52);
      ctx.lineTo(center, 66);
      ctx.quadraticCurveTo(center, 73, portX, portY);
      ctx.stroke();

      ctx.fillStyle = active ? "rgba(201, 242, 106, 0.09)" : "rgba(255, 255, 255, 0.025)";
      ctx.strokeStyle = active ? "rgba(201, 242, 106, 0.62)" : "rgba(141, 161, 152, 0.25)";
      ctx.beginPath();
      ctx.moveTo(center - 22, 17);
      ctx.lineTo(center + 22, 17);
      ctx.lineTo(center + 14, 51);
      ctx.lineTo(center - 14, 51);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "rgba(141, 161, 152, 0.18)";
      ctx.beginPath();
      ctx.moveTo(center - 19, 34);
      ctx.lineTo(center + 19, 34);
      ctx.stroke();
      ctx.fillStyle = colors[powder];
      ctx.globalAlpha = active ? 0.9 : 0.56;
      ctx.beginPath();
      ctx.moveTo(center - 17, 51);
      ctx.lineTo(center - 12, 38);
      ctx.lineTo(center + 12, 38);
      ctx.lineTo(center + 17, 51);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = active ? PALETTE.acid : "rgba(141, 161, 152, 0.68)";
      ctx.font = "7px Cascadia Mono, MixCJK, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${index + 1} / ${powder}`, center, 11);

      if (active) {
        ctx.strokeStyle = colors[powder];
        ctx.globalAlpha = 0.42 + Math.sin(state.elapsed * 7) * 0.12;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(center, 52);
        ctx.quadraticCurveTo(center, 72, portX, portY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fed && state.phase !== "feeding") {
        ctx.fillStyle = "rgba(89, 213, 172, 0.58)";
        ctx.font = "7px Cascadia Mono, MixCJK, monospace";
        ctx.fillText("✓", center + 27, 46);
      }
    });
    ctx.restore();
  }

  drawMotor(ctx, state, x, y) {
    const equipment = state.equipment?.motor;
    const running = equipment?.status === "running" && !state.paused;
    const fault = state.failure?.equipmentId === "motor" || state.failure?.equipmentId === "inverter";
    const color = fault ? PALETTE.red : statusColor(equipment?.status);
    const vibration = running ? Math.sin(state.elapsed * 15) * 0.8 : 0;
    ctx.save();
    ctx.translate(0, vibration);
    ctx.strokeStyle = "rgba(141, 161, 152, 0.35)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 77, y + 42);
    ctx.lineTo(x + 84, y + 42);
    ctx.stroke();

    roundedRect(ctx, x - 8, y, 86, 84, 9);
    const casing = ctx.createLinearGradient(x, y, x + 80, y + 84);
    casing.addColorStop(0, "#34483e");
    casing.addColorStop(0.5, "#17251f");
    casing.addColorStop(1, "#2d3e36");
    ctx.fillStyle = casing;
    ctx.fill();
    ctx.strokeStyle = fault ? "rgba(241, 108, 92, 0.7)" : "rgba(155, 189, 171, 0.26)";
    ctx.stroke();

    for (let rib = 0; rib < 4; rib += 1) {
      ctx.strokeStyle = "rgba(141, 161, 152, 0.11)";
      ctx.beginPath();
      ctx.moveTo(x + 10 + rib * 16, y + 10);
      ctx.lineTo(x + 10 + rib * 16, y + 73);
      ctx.stroke();
    }
    ctx.fillStyle = fault ? "rgba(241, 108, 92, 0.12)" : "rgba(201, 242, 106, 0.08)";
    ctx.fillRect(x - 2, y + 66, 74, 11);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = running || fault ? 9 : 0;
    ctx.beginPath();
    ctx.arc(x + 8, y + 71, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(220, 232, 223, 0.72)";
    ctx.font = "8px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "left";
    ctx.fillText("M-01", x + 16, y + 74);
    ctx.fillStyle = "rgba(141, 161, 152, 0.55)";
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.fillText("MAIN DRIVE", x + 2, y - 8);
    ctx.fillStyle = running ? PALETTE.acid : "rgba(141, 161, 152, 0.54)";
    ctx.font = "9px Cascadia Mono, MixCJK, monospace";
    ctx.fillText(`${running ? state.params.rpm : 0} rpm`, x + 2, y + 100);
    ctx.restore();
  }

  drawFan(ctx, state, x, y) {
    const equipment = state.equipment?.fan;
    const running = equipment?.status === "running" && !state.paused;
    const fault = state.failure?.equipmentId === "fan";
    const color = fault ? PALETTE.red : statusColor(equipment?.status);
    const bladeAngle = running ? state.elapsed * 8 : state.elapsed * 0.2;
    ctx.save();

    ctx.strokeStyle = "rgba(141, 161, 152, 0.2)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 38, y);
    ctx.lineTo(x - 8, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(20, 35, 29, 0.94)";
    ctx.strokeStyle = fault ? "rgba(241, 108, 92, 0.64)" : "rgba(155, 189, 171, 0.27)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bladeAngle);
    for (let blade = 0; blade < 5; blade += 1) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.fillStyle = running ? "rgba(141, 161, 152, 0.3)" : "rgba(141, 161, 152, 0.16)";
      ctx.beginPath();
      ctx.moveTo(4, -3);
      ctx.quadraticCurveTo(22, -11, 31, -2);
      ctx.quadraticCurveTo(22, 6, 5, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#16251f";
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    if (running) {
      ctx.strokeStyle = "rgba(89, 213, 172, 0.24)";
      ctx.lineWidth = 1;
      for (let line = 0; line < 3; line += 1) {
        ctx.beginPath();
        ctx.moveTo(x - 55 - line * 5, y - 13 + line * 13);
        ctx.bezierCurveTo(x - 80, y - 24 + line * 15, x - 92, y + 2 + line * 13, x - 118, y - 5 + line * 14);
        ctx.stroke();
      }
    }
    ctx.fillStyle = color;
    ctx.font = "8px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "center";
    ctx.fillText("F-02", x, y + 60);
    ctx.fillStyle = "rgba(141, 161, 152, 0.52)";
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.fillText(running ? `${Math.round(state.signals?.fanFlow || 0)} m³/h` : "OFF", x, y + 72);
    ctx.restore();
  }

  drawValve(ctx, state, x, y) {
    const equipment = state.equipment?.valve;
    const open = state.phase === "discharging" || equipment?.status === "running";
    const fault = state.failure?.equipmentId === "valve";
    const opening = open ? state.params.valve / 100 : 0;
    const progress = this.phaseProgress(state);
    ctx.save();

    ctx.strokeStyle = "rgba(141, 161, 152, 0.3)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x, y + 8);
    ctx.stroke();

    roundedRect(ctx, x - 30, y + 8, 60, 28, 5);
    ctx.fillStyle = "#1b2b24";
    ctx.strokeStyle = fault ? "rgba(241, 108, 92, 0.7)" : "rgba(155, 189, 171, 0.3)";
    ctx.fill();
    ctx.stroke();
    const gap = 5 + opening * 22;
    ctx.fillStyle = "#07100d";
    ctx.fillRect(x - gap / 2, y + 12, gap, 20);
    ctx.fillStyle = fault ? PALETTE.red : statusColor(equipment?.status);
    ctx.beginPath();
    ctx.arc(x - 23, y + 22, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(141, 161, 152, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 27, y + 8);
    ctx.lineTo(x + 40, y - 8);
    ctx.lineTo(x + 52, y - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(141, 161, 152, 0.6)";
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "left";
    ctx.fillText("V-04", x + 42, y + 21);
    ctx.fillStyle = open ? PALETTE.acid : "rgba(141, 161, 152, 0.46)";
    ctx.fillText(`${open ? state.params.valve : 0}%`, x + 42, y + 32);

    if (state.phase === "discharging" && progress < 0.94) {
      ctx.fillStyle = mixColor(
        [PALETTE.powderA, PALETTE.powderB, PALETTE.powderC],
        [0.38, 0.4, 0.22],
      );
      ctx.globalAlpha = 0.55;
      for (let dot = 0; dot < 10; dot += 1) {
        const px = x + Math.sin(dot * 2.4 + state.elapsed * 4) * gap * 0.42;
        const py = y + 37 + ((dot * 8 + state.elapsed * 38) % 30);
        ctx.beginPath();
        ctx.arc(px, py, 1.2 + (dot % 2) * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawSampling(ctx, state, x, y, width, height) {
    const positions = [0.17, 0.34, 0.51, 0.68, 0.85];
    ctx.save();
    ctx.font = "7px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "center";
    positions.forEach((position, index) => {
      const sample = state.samples?.[index];
      const markerX = x + width * position;
      const markerY = y + height * 0.58 + (index % 2) * 29 + Math.sin(index + state.elapsed) * 2;
      const good = sample?.value != null && sample.value >= 85;
      const color = sample?.value == null ? "rgba(141, 161, 152, 0.45)" : good ? PALETTE.acid : PALETTE.amber;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.76;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(markerX, markerY + 5);
      ctx.lineTo(markerX, markerY + 14);
      ctx.stroke();
      ctx.fillStyle = "rgba(5, 13, 10, 0.8)";
      roundedRect(ctx, markerX - 17, markerY + 14, 34, 14, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(155, 189, 171, 0.13)";
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(
        sample?.value == null ? `S${index + 1} --` : `S${index + 1} ${sample.value.toFixed(1)}`,
        markerX,
        markerY + 24,
      );
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  drawReadouts(ctx, state) {
    const recovery = state.recovery;
    ctx.save();
    const stage = state.failed ? "联锁停机" : STAGE_LABELS[state.phase] || "待开机";
    const active = state.running && !state.paused;
    const stageColor = state.failed ? PALETTE.red : active ? PALETTE.acid : "rgba(141, 161, 152, 0.55)";
    roundedRect(ctx, 492, 88, 134, 29, 5);
    ctx.fillStyle = "rgba(7, 17, 14, 0.78)";
    ctx.strokeStyle = "rgba(155, 189, 171, 0.16)";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stageColor;
    ctx.beginPath();
    ctx.arc(506, 102, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "9px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "left";
    ctx.fillText(stage, 516, 105);

    const warnings = [];
    if (state.params?.rpm < 55) warnings.push("低速分层风险");
    if (state.params?.rpm > 105) warnings.push("高速静电团聚");
    if (state.params?.valve > 65) warnings.push("快速出料夹带");
    warnings.forEach((warning, index) => {
      const badgeY = 131 + index * 23;
      roundedRect(ctx, 492, badgeY, 104, 18, 4);
      ctx.fillStyle = "rgba(240, 179, 90, 0.08)";
      ctx.strokeStyle = "rgba(240, 179, 90, 0.3)";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.amber;
      ctx.font = "7px Cascadia Mono, MixCJK, monospace";
      ctx.fillText(`△ ${warning}`, 500, badgeY + 12);
    });

    if (state.failure) {
      const badgeY = 131 + warnings.length * 23;
      roundedRect(ctx, 492, badgeY, 140, 27, 4);
      ctx.fillStyle = "rgba(241, 108, 92, 0.1)";
      ctx.strokeStyle = "rgba(241, 108, 92, 0.54)";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.red;
      ctx.font = "8px Cascadia Mono, MixCJK, monospace";
      ctx.fillText(`! ${state.failure.equipmentName}`, 500, badgeY + 11);
      ctx.font = "7px Cascadia Mono, MixCJK, monospace";
      ctx.fillText(`${state.failure.trigger} ${state.failure.valueText}`, 500, badgeY + 21);
    } else if (recovery?.active) {
      const badgeY = 131 + warnings.length * 23;
      const progress = clamp(recovery.elapsed / recovery.required, 0, 1);
      roundedRect(ctx, 492, badgeY, 142, 27, 4);
      ctx.fillStyle = "rgba(89, 213, 172, 0.07)";
      ctx.strokeStyle = "rgba(89, 213, 172, 0.32)";
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = PALETTE.mint;
      ctx.font = "8px Cascadia Mono, MixCJK, monospace";
      ctx.fillText(`恢复验证 ${recovery.elapsed.toFixed(1)} / ${recovery.required.toFixed(1)} s`, 500, badgeY + 11);
      ctx.fillStyle = "rgba(89, 213, 172, 0.18)";
      ctx.fillRect(500, badgeY + 17, 124, 2);
      ctx.fillStyle = PALETTE.mint;
      ctx.fillRect(500, badgeY + 17, 124 * progress, 2);
    }

    ctx.fillStyle = "rgba(141, 161, 152, 0.37)";
    ctx.font = "6px Cascadia Mono, MixCJK, monospace";
    ctx.textAlign = "right";
    ctx.fillText("PROCESS INTERLOCK ARMED", 724, 387);
    ctx.fillStyle = "rgba(89, 213, 172, 0.17)";
    ctx.fillRect(492, 394, 232, 1);
    ctx.restore();
  }

  updatePower(state) {
    if (state.batchNumber !== this.lastBatchNumber) {
      this.powerHistory = [];
      this.lastBatchNumber = state.batchNumber;
      this.lastPowerSample = -1;
    }
    if (state.elapsed >= this.lastPowerSample + 0.22 || this.lastPowerSample < 0) {
      this.powerHistory.push(Math.max(0, state.power || 0));
      if (this.powerHistory.length > 54) this.powerHistory.shift();
      this.lastPowerSample = state.elapsed;
    }
    this.drawPower();
  }

  drawPower() {
    const ctx = this.powerCtx;
    const rect = this.powerCanvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const max = Math.max(8, ...this.powerHistory, 1);
    ctx.strokeStyle = "rgba(155, 189, 171, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 1);
    ctx.lineTo(width, height - 1);
    ctx.stroke();
    if (this.powerHistory.length < 2) return;

    const points = this.powerHistory.map((value, index) => ({
      x: (index / Math.max(1, this.powerHistory.length - 1)) * width,
      y: height - 3 - (value / max) * (height - 7),
    }));
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, "rgba(201, 242, 106, 0.18)");
    fill.addColorStop(1, "rgba(201, 242, 106, 0)");
    ctx.beginPath();
    ctx.moveTo(0, height);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = PALETTE.acid;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const last = points[points.length - 1];
    ctx.fillStyle = PALETTE.acid;
    ctx.shadowColor = PALETTE.acid;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawDrumInterior(ctx, state, x, y, width, height, active, running) {
    const glow = ctx.createRadialGradient(x + width / 2, y + height * 0.58, 10, x + width / 2, y + height * 0.6, width * 0.65);
    glow.addColorStop(0, active ? "rgba(89, 213, 172, 0.065)" : "rgba(89, 213, 172, 0.025)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = "rgba(141, 161, 152, 0.11)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    for (let index = 1; index < 5; index += 1) {
      ctx.beginPath();
      ctx.moveTo(x + (width / 5) * index, y + 20);
      ctx.lineTo(x + (width / 5) * index, y + height - 20);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (running && state.phase === "mixing") {
      const angle = state.elapsed * state.params.rpm * 0.012;
      ctx.save();
      ctx.translate(x + width / 2, y + height / 2);
      ctx.rotate(angle);
      ctx.strokeStyle = "rgba(201, 242, 106, 0.055)";
      ctx.lineWidth = 12;
      for (let index = 0; index < 3; index += 1) {
        ctx.beginPath();
        ctx.arc(0, 0, 82 + index * 15, 0.1, 1.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
