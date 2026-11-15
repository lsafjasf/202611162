import { DEVICE_DEFS } from "./simulator.js";

const W = 1280;
const H = 640;
const WEB = { x: 62, y: 166, w: 1156, h: 340 };
const SHEET_WIDTH = 292;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function radZ(px, py) {
  return (Math.sin(px * 0.073) + Math.cos(py * 0.091)) * 0.5;
}

export class PressRenderer {
  constructor(canvas, simulator) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = simulator;
    this.lastTime = 0;
    this.machinePulse = 0;
    this.cutFlash = 0;
    this.paperGrain = this._makeGrain(canvas.width, canvas.height);
  }

  _makeGrain(width, height) {
    const grain = document.createElement("canvas");
    grain.width = width;
    grain.height = height;
    const ctx = grain.getContext("2d");
    const image = ctx.createImageData(width, height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = 110 + Math.random() * 60;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 14;
    }
    ctx.putImageData(image, 0, 0);
    return grain;
  }

  render(dtMs = 16) {
    const ctx = this.ctx;
    const sim = this.sim;
    this.machinePulse += dtMs * 0.001;
    this.cutFlash = Math.max(0, this.cutFlash - dtMs / 280);
    if (sim.sheetProgress > 0.93) this.cutFlash = 1;
    ctx.clearRect(0, 0, W, H);
    this._drawBackdrop(ctx);
    this._drawWeb(ctx);
    this._drawPrinting(ctx);
    this._drawRegistration(ctx);
    this._drawMachineInk(ctx);
    this._drawDryer(ctx);
    this._drawCutter(ctx);
    this._drawRollers(ctx);
    this._drawSensors(ctx);
    this._drawGrain(ctx);
    this._drawVignette(ctx);
  }

  _drawBackdrop(ctx) {
    const sim = this.sim;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "#0b1b18");
    gradient.addColorStop(0.5, "#07120f");
    gradient.addColorStop(1, "#030a08");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.strokeStyle = "rgba(116, 201, 181, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "#071310";
    ctx.fillRect(0, 0, W, 58);
    ctx.fillRect(0, H - 65, W, 65);
    ctx.strokeStyle = "rgba(143, 227, 205, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 58.5);
    ctx.lineTo(W, 58.5);
    ctx.moveTo(0, H - 65.5);
    ctx.lineTo(W, H - 65.5);
    ctx.stroke();

    ctx.fillStyle = "rgba(124, 167, 155, 0.48)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText("WEB GUIDE", 22, 33);
    ctx.fillText("2-COLOR REGISTER", 22, H - 27);
    ctx.textAlign = "right";
    ctx.fillText("SHAFT 02 / 620", W - 23, 33);
    ctx.fillText("AIR / INK / TENSION", W - 23, H - 27);
    ctx.textAlign = "left";

    for (let x = 20; x < W - 20; x += 12) {
      const isMajor = x % 60 === 0;
      ctx.fillStyle = isMajor ? "rgba(117, 242, 189, 0.38)" : "rgba(117, 242, 189, 0.14)";
      ctx.fillRect(x, 49, 1, isMajor ? 9 : 5);
      ctx.fillRect(x, H - 56, 1, isMajor ? 9 : 5);
    }

    ctx.strokeStyle = "rgba(117, 242, 189, 0.1)";
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(WEB.x, WEB.y - 15);
    ctx.lineTo(WEB.x + WEB.w, WEB.y - 15);
    ctx.moveTo(WEB.x, WEB.y + WEB.h + 15);
    ctx.lineTo(WEB.x + WEB.w, WEB.y + WEB.h + 15);
    ctx.stroke();
    ctx.setLineDash([]);

    if (["running", "rollChange"].includes(sim.phase)) {
      const sweep = ((this.machinePulse * 90) % (W - 80)) + 40;
      const shadow = ctx.createLinearGradient(sweep - 50, 0, sweep + 30, 0);
      shadow.addColorStop(0, "rgba(117, 242, 189, 0)");
      shadow.addColorStop(0.8, "rgba(117, 242, 189, 0.035)");
      shadow.addColorStop(1, "rgba(117, 242, 189, 0)");
      ctx.fillStyle = shadow;
      ctx.fillRect(sweep - 50, 58, 80, H - 123);
    }
  }

  _drawWeb(ctx) {
    const sim = this.sim;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.62)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 9;
    const paper = ctx.createLinearGradient(0, WEB.y, 0, WEB.y + WEB.h);
    paper.addColorStop(0, "#f0e5cc");
    paper.addColorStop(0.35, "#f5ecd7");
    paper.addColorStop(0.72, "#e8dcc1");
    paper.addColorStop(1, "#dacbac");
    ctx.fillStyle = paper;
    ctx.fillRect(WEB.x, WEB.y, WEB.w, WEB.h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(WEB.x, WEB.y, WEB.w, WEB.h);
    ctx.clip();
    const scroll = (sim.timeMs * 0.19) % SHEET_WIDTH;
    for (let x = WEB.x - SHEET_WIDTH + scroll; x < WEB.x + WEB.w + SHEET_WIDTH; x += SHEET_WIDTH) {
      ctx.strokeStyle = "rgba(75, 62, 44, 0.17)";
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(x, WEB.y);
      ctx.lineTo(x, WEB.y + WEB.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(85, 68, 42, 0.2)";
      ctx.font = "7px ui-monospace, monospace";
      ctx.fillText(`SHEET ${String(Math.floor((x - WEB.x + scroll) / SHEET_WIDTH) + 1).padStart(3, "0")}`, x + 9, WEB.y + WEB.h - 8);
    }

    this._drawPaperFiber(ctx, scroll);

    if (sim.transient.strike) {
      const bleed = ctx.createLinearGradient(0, WEB.y + WEB.h, 0, WEB.y + WEB.h + 35);
      bleed.addColorStop(0, "rgba(132, 19, 71, 0.55)");
      bleed.addColorStop(1, "rgba(132, 19, 71, 0)");
      ctx.fillStyle = bleed;
      ctx.fillRect(WEB.x, WEB.y + WEB.h - 1, WEB.w, 35);
      for (let x = WEB.x + 30; x < WEB.x + WEB.w; x += 63) {
        ctx.fillStyle = "rgba(159, 10, 72, 0.18)";
        ctx.beginPath();
        ctx.ellipse(x + ((x * 7) % 19), WEB.y + WEB.h - 3, 15, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(91, 121, 108, 0.38)";
    ctx.lineWidth = 1;
    ctx.strokeRect(WEB.x + 0.5, WEB.y + 0.5, WEB.w - 1, WEB.h - 1);
  }

  _drawPaperFiber(ctx, scroll) {
    ctx.save();
    ctx.strokeStyle = "rgba(105, 84, 52, 0.055)";
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 90; i += 1) {
      const x = WEB.x + ((i * 137 + scroll * 0.4) % WEB.w);
      const y = WEB.y + ((i * 61) % WEB.h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 5 + (i % 17), y + ((i % 3) - 1));
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPrinting(ctx) {
    const sim = this.sim;
    const scroll = (sim.timeMs * 0.19) % SHEET_WIDTH;
    const regPx = clamp(sim.transient.registration * 70, 0, 12);
    const ghostPx = clamp(sim.transient.ghost * 12, 0, 7);
    const inkAlpha = 0.52 + sim.params.ink / 100 * 0.4;
    const motifTop = WEB.y + 48;
    const motifHeight = WEB.h - 92;
    const motifWidth = SHEET_WIDTH - 42;

    ctx.save();
    ctx.beginPath();
    ctx.rect(WEB.x + 3, WEB.y + 3, WEB.w - 6, WEB.h - 6);
    ctx.clip();

    for (let start = WEB.x - SHEET_WIDTH + scroll; start < WEB.x + WEB.w; start += SHEET_WIDTH) {
      const left = start + 21;
      this._drawSheetMotif(
        ctx,
        left,
        motifTop,
        motifWidth,
        motifHeight,
        inkAlpha,
        regPx,
        ghostPx
      );
      this._drawColorBar(ctx, left + 4, WEB.y + WEB.h - 29, inkAlpha);
    }

    this._drawInkBuildUp(ctx, scroll, inkAlpha);
    ctx.restore();
  }

  _drawSheetMotif(ctx, x, y, width, height, inkAlpha, regPx, ghostPx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const cx = x + width * 0.5;
    const cy = y + height * 0.5;
    const wavePhase = (x + this.sim.timeMs * 0.05) * 0.021;

    for (let py = y; py <= y + height; py += 7) {
      for (let px = x; px <= x + width; px += 7) {
        const dx = (px - cx) / (width * 0.46);
        const dy = (py - cy) / (height * 0.46);
        const radial = Math.sqrt(dx * dx + dy * dy);
        const field = Math.sin(dx * 7.6 + wavePhase) * 0.5
          + Math.cos(dy * 8.4 - wavePhase * 0.6) * 0.5;
        const ring = Math.abs(Math.sin(radial * 11 - 1.25));
        if (field + ring * 0.65 < 0.31 || radial > 1.18) continue;
        const strength = clamp((field + ring) * 0.62, 0.2, 1);
        const radius = 1.05 + strength * 2.15;
        const cyanRegion = radZ(px, py, width, height) > 0.3;
        ctx.globalAlpha = inkAlpha * (0.44 + strength * 0.48);
        ctx.fillStyle = cyanRegion ? "#20c7c5" : "#ed3f8b";
        ctx.beginPath();
        ctx.arc(
          px + (cyanRegion ? -regPx * 0.6 : regPx * 0.6),
          py + regPx * 0.25,
          radius,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    if (ghostPx > 0.3) {
      ctx.globalAlpha = Math.min(0.32, 0.035 + ghostPx * 0.04);
      ctx.strokeStyle = "#b72167";
      ctx.lineWidth = 1.2;
      for (let index = 0; index < 28; index += 1) {
        const angle = index / 28 * Math.PI * 2;
        const radius = 32 + (index % 5) * 18;
        ctx.beginPath();
        ctx.arc(
          cx + ghostPx * 2.2,
          cy + ghostPx,
          radius + (index % 3) * 2,
          angle,
          angle + 0.23
        );
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#153e38";
    ctx.font = `900 ${Math.round(height * 0.54)}px "Arial Narrow", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("02", cx, cy + 4);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawColorBar(ctx, x, y, inkAlpha) {
    ctx.save();
    const barWidth = SHEET_WIDTH - 53;
    ctx.fillStyle = "rgba(42, 37, 29, 0.24)";
    ctx.fillRect(x, y, barWidth, 10);
    const colors = ["#25cfca", "#ee438e", "#25cfca", "#ee438e"];
    for (let index = 0; index < 8; index += 1) {
      ctx.globalAlpha = index % 2 === 0 ? inkAlpha * 0.7 : inkAlpha * 0.35;
      ctx.fillStyle = colors[index % colors.length];
      ctx.fillRect(x + index * (barWidth / 8), y, barWidth / 8 - 1, 10);
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#433d31";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText("C    M    C    M    REG", x, y - 7);
    ctx.restore();
  }

  _drawInkBuildUp(ctx, scroll, inkAlpha) {
    const buildup = this.sim.transient.buildup;
    if (buildup <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = clamp(buildup * 0.7, 0, 0.62);
    const stain = ctx.createLinearGradient(0, WEB.y, 0, WEB.y + 78);
    stain.addColorStop(0, "rgba(106, 8, 58, 0.62)");
    stain.addColorStop(1, "rgba(170, 28, 91, 0)");
    ctx.fillStyle = stain;
    ctx.fillRect(WEB.x, WEB.y, WEB.w, 78);
    for (let index = 0; index < 18; index += 1) {
      const x = WEB.x + ((scroll * 0.6 + index * 73) % WEB.w);
      const y = WEB.y + 13 + (index * 19 % 52);
      ctx.fillStyle = index % 2 ? "#a61961" : "#cb2d7c";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        16 + index % 7 * 3,
        4 + index % 4 * 1.5,
        Math.sin(index) * 0.15,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  _drawRegistration(ctx) {
    const sim = this.sim;
    const scroll = (sim.timeMs * 0.19) % SHEET_WIDTH;
    const offset = clamp(sim.transient.registration * 90, 0, 15);
    const marks = [];
    for (let x = WEB.x - SHEET_WIDTH + scroll; x < WEB.x + WEB.w + SHEET_WIDTH; x += SHEET_WIDTH) {
      marks.push(x + SHEET_WIDTH * 0.5);
    }
    for (const x of marks) {
      if (x < WEB.x + 10 || x > WEB.x + WEB.w - 10) continue;
      this._drawCrosshair(ctx, x, WEB.y + 24, offset, 0.9);
      this._drawCrosshair(ctx, x, WEB.y + WEB.h - 24, offset, 0.68);
    }

    const edgeOffset = clamp(offset * 0.8, 0, 10);
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = "#22aba8";
    ctx.beginPath();
    ctx.moveTo(WEB.x + 8, WEB.y + 55 - edgeOffset);
    ctx.lineTo(WEB.x + 8, WEB.y + 95 - edgeOffset);
    ctx.stroke();
    ctx.strokeStyle = "#d8317c";
    ctx.beginPath();
    ctx.moveTo(WEB.x + 15, WEB.y + 55 + edgeOffset);
    ctx.lineTo(WEB.x + 15, WEB.y + 95 + edgeOffset);
    ctx.stroke();
    ctx.restore();
  }

  _drawCrosshair(ctx, x, y, offset, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#25c7c5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x - offset * 0.35, y, 7.5, 0, Math.PI * 2);
    ctx.moveTo(x - offset * 0.35 - 12, y);
    ctx.lineTo(x - offset * 0.35 + 12, y);
    ctx.moveTo(x - offset * 0.35, y - 12);
    ctx.lineTo(x - offset * 0.35, y + 12);
    ctx.stroke();
    ctx.strokeStyle = "#e73c84";
    ctx.beginPath();
    ctx.arc(x + offset * 0.35, y, 7.5, 0, Math.PI * 2);
    ctx.moveTo(x + offset * 0.35 - 12, y);
    ctx.lineTo(x + offset * 0.35 + 12, y);
    ctx.moveTo(x + offset * 0.35, y - 12);
    ctx.lineTo(x + offset * 0.35, y + 12);
    ctx.stroke();
    ctx.restore();
  }

  _drawMachineInk(ctx) {
    const sim = this.sim;
    const pumping = sim.devices.inkPump.on;
    ctx.save();

    ctx.fillStyle = "#0b1c18";
    ctx.strokeStyle = "rgba(143, 227, 205, 0.2)";
    ctx.lineWidth = 1;
    ctx.fillRect(82, 74, 232, 68);
    ctx.strokeRect(82.5, 74.5, 231, 67);
    ctx.fillStyle = "rgba(125, 167, 155, 0.52)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("INK TRAIN / DUCT", 93, 88);

    const inkWell = ctx.createLinearGradient(95, 95, 285, 130);
    inkWell.addColorStop(0, "rgba(31, 199, 196, 0.28)");
    inkWell.addColorStop(0.5, "rgba(238, 67, 142, 0.38)");
    inkWell.addColorStop(1, "rgba(24, 111, 108, 0.25)");
    ctx.fillStyle = inkWell;
    ctx.fillRect(94, 96, 198, 28);

    for (let index = 0; index < 7; index += 1) {
      const x = 102 + index * 28;
      ctx.fillStyle = index % 2 ? "#f44991" : "#31d5d1";
      ctx.globalAlpha = pumping ? 0.74 : 0.22;
      ctx.beginPath();
      ctx.arc(x + Math.sin(this.machinePulse * 4 + index) * 2, 110, 6.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = pumping ? "rgba(238, 67, 142, 0.68)" : "rgba(108, 126, 119, 0.22)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -this.machinePulse * 24;
    ctx.beginPath();
    ctx.moveTo(312, 111);
    ctx.bezierCurveTo(360, 111, 355, 142, 404, 146);
    ctx.lineTo(452, 146);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = pumping ? "#75f2bd" : "#61756e";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText(pumping ? "PUMP ON" : "PUMP OFF", 256, 88);
    const ledX = 246;
    ctx.fillStyle = pumping ? "#75f2bd" : "#4e625b";
    ctx.beginPath();
    ctx.arc(ledX, 85, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(125, 167, 155, 0.44)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText(`INK ${sim.params.ink.toFixed(0)}%`, 94, 138);
    ctx.fillText(`P ${sim.params.pressure.toFixed(0)} N/mm`, 368, 133);
    ctx.restore();
  }

  _drawRollers(ctx) {
    const sim = this.sim;
    const pressure = sim.params.pressure;
    const rotating = sim.devices.cylinder.on;
    const angle = rotating ? this.machinePulse * 1.7 : 0.3;
    const faulted = sim.devices.cylinder.faulted;
    this._drawCylinder(ctx, 552, 143, 29, angle, faulted, pressure);
    this._drawCylinder(ctx, 552, 529, 29, angle + Math.PI / 3, faulted, pressure);

    ctx.save();
    ctx.strokeStyle = faulted ? "#ff665f" : "rgba(69, 229, 223, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(538, 160);
    ctx.lineTo(538, 510);
    ctx.moveTo(566, 160);
    ctx.lineTo(566, 510);
    ctx.stroke();
    ctx.setLineDash([3, 8]);
    ctx.strokeStyle = "rgba(69, 229, 223, 0.18)";
    ctx.beginPath();
    ctx.moveTo(552, 180);
    ctx.lineTo(552, 492);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = faulted ? "#ff827c" : "rgba(151, 201, 188, 0.65)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("IMPRESSION CYL 02", 452, 77);
    ctx.fillText("BLANKET", 451, 574);
    ctx.restore();
  }

  _drawCylinder(ctx, x, y, radius, angle, faulted, pressure) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#122722";
    ctx.strokeStyle = faulted ? "#ff665f" : "#3e8d7e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(143, 227, 205, 0.22)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 8, 0.1, 2.4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 79, 150, 0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius + 7, 0);
    ctx.lineTo(radius - 7, 0);
    ctx.stroke();
    ctx.fillStyle = faulted ? "#ff665f" : "#081611";
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(117, 242, 189, 0.45)";
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${pressure.toFixed(0)}`, x, y + radius + 12);
    ctx.fillText("N/mm", x, y + radius + 21);
    ctx.restore();
  }

  _drawDryer(ctx) {
    const sim = this.sim;
    const active = sim.devices.dryer.on;
    const intensity = sim.params.dryer / 100;
    ctx.save();
    ctx.fillStyle = "#0b1b18";
    ctx.strokeStyle = "rgba(143, 227, 205, 0.18)";
    ctx.fillRect(814, 72, 182, 66);
    ctx.strokeRect(814.5, 72.5, 181, 65);
    ctx.fillStyle = active ? "#ffbd61" : "#5c5d50";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("DRYER / AIR KNIFE", 825, 86);
    ctx.fillStyle = "rgba(151, 201, 188, 0.45)";
    ctx.fillText(`${sim.params.dryer.toFixed(0)} m/s`, 825, 128);

    for (let index = 0; index < 7; index += 1) {
      ctx.fillStyle = active ? `rgba(255, 189, 97, ${0.18 + intensity * 0.5})` : "rgba(95, 101, 88, 0.12)";
      ctx.fillRect(899 + index * 11, 96, 5, 25);
    }
    ctx.globalAlpha = active ? 0.36 + intensity * 0.3 : 0.08;
    ctx.strokeStyle = "#ffbd61";
    ctx.lineWidth = 1;
    for (let index = 0; index < 10; index += 1) {
      const x = 840 + index * 15;
      const sway = Math.sin(this.machinePulse * 3 + index) * 5;
      ctx.beginPath();
      ctx.moveTo(x, 144);
      ctx.quadraticCurveTo(x + sway, 152, x + sway * 0.7, 163);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawCutter(ctx) {
    const sim = this.sim;
    const x = 1114;
    const active = sim.devices.cutter.on;
    const flash = this.cutFlash;
    ctx.save();
    ctx.fillStyle = "#0b1b18";
    ctx.strokeStyle = "rgba(143, 227, 205, 0.18)";
    ctx.fillRect(1084, 72, 62, 64);
    ctx.strokeRect(1084.5, 72.5, 61, 63);
    ctx.fillStyle = active ? "#e7f3eb" : "#63756e";
    ctx.font = "8px ui-monospace, monospace";
    ctx.fillText("CUT", 1101, 86);
    ctx.fillStyle = "rgba(151, 201, 188, 0.42)";
    ctx.font = "6px ui-monospace, monospace";
    ctx.fillText("GUILLOTINE", 1088, 126);

    ctx.strokeStyle = "rgba(149, 213, 195, 0.26)";
    ctx.beginPath();
    ctx.moveTo(x - 22, 140);
    ctx.lineTo(x - 22, WEB.y + WEB.h + 21);
    ctx.moveTo(x + 22, 140);
    ctx.lineTo(x + 22, WEB.y + WEB.h + 21);
    ctx.stroke();

    const bladeY = flash > 0.02 ? WEB.y + WEB.h + 3 : WEB.y - 27;
    ctx.fillStyle = flash > 0.02 ? "#f3fff9" : "#789289";
    ctx.beginPath();
    ctx.moveTo(x - 20, bladeY);
    ctx.lineTo(x + 20, bladeY);
    ctx.lineTo(x + 14, bladeY + 17);
    ctx.lineTo(x - 14, bladeY + 17);
    ctx.closePath();
    ctx.fill();

    if (flash > 0.02) {
      ctx.globalAlpha = flash * 0.65;
      ctx.strokeStyle = "#75f2bd";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(WEB.x + 3, WEB.y + WEB.h - 1);
      ctx.lineTo(WEB.x + WEB.w, WEB.y + WEB.h - 1);
      ctx.stroke();
      ctx.fillStyle = "#f9fff9";
      for (let index = 0; index < 10; index += 1) {
        const sx = x - 30 + Math.random() * 60;
        const sy = WEB.y + WEB.h - Math.random() * 20;
        ctx.fillRect(sx, sy, 1.3, 1.3);
      }
    }
    ctx.restore();
  }

  _drawSensors(ctx) {
    const sim = this.sim;
    const tension = sim.params.tension;
    const active = sim.devices.tensionSensor.on;
    ctx.save();
    ctx.strokeStyle = active ? "rgba(69, 229, 223, 0.54)" : "rgba(98, 116, 109, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(1202, 110);
    ctx.lineTo(1202, 505);
    ctx.stroke();
    for (let y = 120; y < 500; y += 14) {
      ctx.beginPath();
      ctx.moveTo(1198, y);
      ctx.lineTo(1205, y);
      ctx.stroke();
    }
    const markerY = mix(160, 498, tension / 100);
    ctx.fillStyle = active ? "#45e5df" : "#61736c";
    ctx.beginPath();
    ctx.moveTo(1208, markerY - 5);
    ctx.lineTo(1217, markerY);
    ctx.lineTo(1208, markerY + 5);
    ctx.closePath();
    ctx.fill();
    ctx.font = "7px ui-monospace, monospace";
    ctx.fillText("TENSION", 1174, 96);
    ctx.fillText(`${tension.toFixed(0)} N`, 1177, 520);

    this._drawRegisterScope(ctx, 706, 79, 88, 44);
    ctx.restore();
  }

  _drawRegisterScope(ctx, x, y, width, height) {
    const sim = this.sim;
    const offset = clamp(sim.transient.registration * 65, 0, 10);
    ctx.save();
    ctx.fillStyle = "rgba(3, 12, 10, 0.7)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(143, 227, 205, 0.15)";
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.strokeStyle = "rgba(69, 229, 223, 0.18)";
    for (let gridX = 0; gridX < width; gridX += 12) {
      ctx.beginPath();
      ctx.moveTo(x + gridX, y);
      ctx.lineTo(x + gridX, y + height);
      ctx.stroke();
    }

    const wave = (color, shift) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let px = 0; px < width; px += 2) {
        const py = y + height * 0.5
          + Math.sin((px + sim.timeMs * 0.08) * 0.16) * 5
          + shift;
        if (px === 0) ctx.moveTo(x + px, py);
        else ctx.lineTo(x + px, py);
      }
      ctx.stroke();
    };
    wave("#32c9c8", -offset * 0.35);
    wave("#e83b85", offset * 0.35);
    ctx.fillStyle = "rgba(151, 201, 188, 0.45)";
    ctx.font = "6px ui-monospace, monospace";
    ctx.fillText("REGISTER SCOPE", x + 5, y + 8);
    ctx.restore();
  }

  _drawGrain(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.drawImage(this.paperGrain, 0, 0);
    ctx.restore();
  }

  _drawVignette(ctx) {
    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, W * 0.68);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 4, 3, 0.58)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }
}
