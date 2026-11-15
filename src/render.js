import {
  ceilingAt,
  floorAt,
  waterAt,
} from "./world.js";

const CARGO_OFFSETS = [-56, 0, 56];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

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

function pathSegment(ctx, x0, x1, valueAt, step = 18) {
  const points = [];
  for (let x = x0; x <= x1 + step; x += step) {
    points.push({ x, y: valueAt(Math.min(x1, x)) });
  }
  return points;
}

export class CaveRenderer {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.minimap = minimap;
    this.minimapCtx = minimap.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cameraX = null;
    this.scale = 1;
    this.shake = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.scale = Math.max(0.82, height / 690);
  }

  resetCamera(run) {
    this.cameraX = clamp(
      run.raft.x - (this.width / this.scale) * 0.36,
      0,
      Math.max(0, run.world.width - this.width / this.scale),
    );
  }

  impact(amount = 1) {
    this.shake = Math.min(9, this.shake + amount * 4);
  }

  render(run, options = {}) {
    const ctx = this.ctx;
    const viewWidth = this.width / this.scale;
    const targetCamera = clamp(
      run.raft.x - viewWidth * 0.37,
      0,
      Math.max(0, run.world.width - viewWidth + 60),
    );
    if (this.cameraX === null) {
      this.cameraX = targetCamera;
    }
    this.cameraX = lerp(this.cameraX, targetCamera, options.paused ? 1 : 0.075);
    this.shake *= 0.86;
    if (this.shake < 0.05) {
      this.shake = 0;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(ctx, run, viewWidth);

    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.cameraX + (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

    this.drawDistantCave(ctx, run, viewWidth);
    this.drawCaveWalls(ctx, run, viewWidth);
    this.drawWater(ctx, run, viewWidth);
    this.drawDistanceMarks(ctx, run, viewWidth);
    this.drawHazards(ctx, run, viewWidth);
    this.drawCheckpoints(ctx, run, viewWidth);
    this.drawWarehouse(ctx, run, viewWidth);
    this.drawPickups(ctx, run, viewWidth);
    this.drawStalactites(ctx, run, viewWidth);
    this.drawRaft(ctx, run);
    this.drawAtmosphere(ctx, run, viewWidth);
    ctx.restore();

    this.drawScreenVignette(ctx);
    this.drawMinimap(run);
  }

  drawBackdrop(ctx, run, viewWidth) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#031113");
    gradient.addColorStop(0.46, "#062023");
    gradient.addColorStop(1, "#010a0c");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.globalAlpha = 0.3;
    const shift = (this.cameraX || 0) * 0.08;
    for (let index = 0; index < 7; index += 1) {
      const x = ((index * 230 - shift) % (this.width + 300)) - 120;
      const glow = ctx.createRadialGradient(
        x,
        this.height * (0.3 + (index % 3) * 0.08),
        2,
        x,
        this.height * 0.4,
        180,
      );
      glow.addColorStop(0, "rgba(87, 181, 158, 0.13)");
      glow.addColorStop(1, "rgba(87, 181, 158, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 180, 0, 360, this.height);
    }
    ctx.restore();
  }

  drawDistantCave(ctx, run, viewWidth) {
    const x0 = this.cameraX - 120;
    const x1 = this.cameraX + viewWidth + 120;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#071a1c";
    ctx.beginPath();
    ctx.moveTo(x0, -60);
    for (let x = x0; x <= x1; x += 28) {
      const y =
        ceilingAt(run.world, x + this.cameraX * 0.18) +
        52 +
        Math.sin(x * 0.006) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, -60);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#071b1c";
    ctx.beginPath();
    ctx.moveTo(x0, run.world.height + 40);
    for (let x = x0; x <= x1; x += 28) {
      const y =
        floorAt(run.world, x + this.cameraX * 0.12) -
        35 -
        Math.sin(x * 0.0055 + 1) * 18;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, run.world.height + 40);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawCaveWalls(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    const ceiling = pathSegment(ctx, x0, x1, (x) => ceilingAt(run.world, x));
    const floor = pathSegment(ctx, x0, x1, (x) => floorAt(run.world, x));

    const topGradient = ctx.createLinearGradient(0, 80, 0, 350);
    topGradient.addColorStop(0, "#030d0e");
    topGradient.addColorStop(0.52, "#0b2222");
    topGradient.addColorStop(1, "#183c38");
    ctx.fillStyle = topGradient;
    ctx.beginPath();
    ctx.moveTo(x0, -80);
    for (const point of ceiling) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(x1, -80);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(145, 221, 190, 0.35)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ceiling.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(92, 172, 149, 0.1)";
    ctx.lineWidth = 20;
    ctx.beginPath();
    ceiling.forEach((point, index) => {
      const y = point.y - 25 - Math.sin(point.x * 0.018) * 5;
      if (index === 0) {
        ctx.moveTo(point.x, y);
      } else {
        ctx.lineTo(point.x, y);
      }
    });
    ctx.stroke();

    const bottomGradient = ctx.createLinearGradient(0, 470, 0, run.world.height);
    bottomGradient.addColorStop(0, "#12322f");
    bottomGradient.addColorStop(0.5, "#071b1b");
    bottomGradient.addColorStop(1, "#020a0b");
    ctx.fillStyle = bottomGradient;
    ctx.beginPath();
    ctx.moveTo(x0, run.world.height + 80);
    for (const point of floor) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(x1, run.world.height + 80);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(132, 205, 177, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    floor.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();

    this.drawWallDetails(ctx, run, x0, x1);
  }

  drawWallDetails(ctx, run, x0, x1) {
    ctx.save();
    ctx.lineWidth = 0.8;
    for (let index = 0; index < 34; index += 1) {
      const x = x0 + ((index * 97 + run.world.seed % 83) % Math.max(1, x1 - x0));
      const ceilingY = ceilingAt(run.world, x);
      const floorY = floorAt(run.world, x);
      ctx.strokeStyle =
        index % 3 === 0
          ? "rgba(117, 196, 168, 0.12)"
          : "rgba(3, 12, 13, 0.36)";
      ctx.beginPath();
      if (index % 2 === 0) {
        ctx.moveTo(x, ceilingY + 8);
        ctx.lineTo(x + 13, ceilingY + 26);
        ctx.lineTo(x + 7, ceilingY + 47);
      } else {
        ctx.moveTo(x, floorY - 8);
        ctx.lineTo(x - 16, floorY - 29);
        ctx.lineTo(x - 7, floorY - 45);
      }
      ctx.stroke();
    }

    for (let index = 0; index < 18; index += 1) {
      const x = x0 + ((index * 173 + 41) % Math.max(1, x1 - x0));
      const y = floorAt(run.world, x);
      ctx.fillStyle = index % 4 === 0 ? "#183c34" : "#0d2523";
      ctx.beginPath();
      ctx.ellipse(x, y + 6, 12 + (index % 3) * 3, 4 + (index % 2) * 2, -0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawWater(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    const surface = pathSegment(ctx, x0, x1, (x) => waterAt(run.world, x), 14);
    const gradient = ctx.createLinearGradient(0, 405, 0, 590);
    gradient.addColorStop(0, "rgba(17, 83, 79, 0.62)");
    gradient.addColorStop(0.45, "rgba(8, 54, 55, 0.66)");
    gradient.addColorStop(1, "rgba(2, 22, 25, 0.92)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x0, surface[0].y);
    for (const point of surface) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(x1, run.world.height);
    ctx.lineTo(x0, run.world.height);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = "rgba(160, 239, 207, 0.42)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    surface.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(124, 220, 190, 0.1)";
    ctx.lineWidth = 0.8;
    for (let line = 0; line < 8; line += 1) {
      const offset = 18 + line * 21;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 20) {
        const y =
          waterAt(run.world, x) +
          offset +
          Math.sin(x * 0.018 + run.time * 0.5 + line) * 2.5;
        if (x === x0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();

    this.drawCurrentFlow(ctx, run, x0, x1);
  }

  drawCurrentFlow(ctx, run, x0, x1) {
    for (const zone of run.world.currents) {
      if (zone.end < x0 || zone.start > x1) {
        continue;
      }
      const direction = Math.sign(zone.force) || 1;
      const strength = clamp(Math.abs(zone.force) / 34, 0.35, 1);
      ctx.save();
      ctx.globalAlpha = 0.22 + strength * 0.16;
      ctx.strokeStyle = zone.force < 0 ? "#ffc06a" : "#70dfd1";
      ctx.lineWidth = 1.15;
      const top = Math.min(zone.start, zone.end);
      const bottom = Math.max(zone.start, zone.end);
      for (let line = 0; line < 4; line += 1) {
        const y = 444 + line * 27;
        const shift = ((run.time * (20 + Math.abs(zone.force)) + line * 28) % 92) * direction;
        ctx.beginPath();
        for (let x = top - 40 + shift; x <= bottom + 40; x += 18) {
          const wave = Math.sin(x * 0.04 + run.time * 1.4 + line) * 2.2;
          if (x === top - 40 + shift) {
            ctx.moveTo(x, y + wave);
          } else {
            ctx.lineTo(x, y + wave);
          }
        }
        ctx.stroke();

        const arrowX = direction > 0 ? bottom - 20 : top + 20;
        ctx.beginPath();
        ctx.moveTo(arrowX - 5 * direction, y - 4);
        ctx.lineTo(arrowX, y);
        ctx.lineTo(arrowX - 5 * direction, y + 4);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawDistanceMarks(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    ctx.save();
    ctx.font = '8px ui-monospace, "Noto Sans SC Local", monospace';
    ctx.textAlign = "center";
    for (let x = 250; x < run.world.width; x += 500) {
      if (x < x0 || x > x1) {
        continue;
      }
      const y = floorAt(run.world, x) + 12;
      ctx.strokeStyle = "rgba(160, 217, 194, 0.17)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 1);
      ctx.stroke();
      ctx.fillStyle = "rgba(160, 217, 194, 0.28)";
      ctx.fillText(`${(x / 1000).toFixed(1)} km`, x, y + 12);
    }
    ctx.restore();
  }

  drawHazards(ctx, run, viewWidth) {
    const x0 = this.cameraX - 100;
    const x1 = this.cameraX + viewWidth + 100;
    const hazards = Object.values(run.world.hazards);
    for (const hazard of hazards) {
      if (hazard.end < x0 || hazard.start > x1) {
        continue;
      }
      const color = hazard.tone === "coral" || hazard.id === "ceiling-gate"
        ? "255, 118, 109"
        : "255, 192, 106";
      const center = (hazard.start + hazard.end) / 2;
      const y = waterAt(run.world, center);
      ctx.save();
      const gradient = ctx.createLinearGradient(hazard.start, 0, hazard.end, 0);
      gradient.addColorStop(0, `rgba(${color}, 0)`);
      gradient.addColorStop(0.3, `rgba(${color}, 0.055)`);
      gradient.addColorStop(0.7, `rgba(${color}, 0.055)`);
      gradient.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(hazard.start, y - 120, hazard.end - hazard.start, 190);
      ctx.strokeStyle = `rgba(${color}, 0.25)`;
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(hazard.start, y - 22);
      ctx.lineTo(hazard.start, y + 78);
      ctx.moveTo(hazard.end, y - 22);
      ctx.lineTo(hazard.end, y + 78);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '7px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${color}, 0.72)`;
      ctx.fillText(`▲ ${hazard.label}`, center, y + 91);
      ctx.restore();
    }
  }

  drawCheckpoints(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    for (const checkpoint of run.world.checkpoints) {
      if (checkpoint.x < x0 || checkpoint.x > x1) {
        continue;
      }
      const active = run.checkpointIds.includes(checkpoint.id);
      const floor = floorAt(run.world, checkpoint.x);
      ctx.save();
      ctx.globalAlpha = active ? 0.9 : 0.4;
      ctx.strokeStyle = active ? "rgba(183, 245, 212, 0.7)" : "rgba(183, 245, 212, 0.35)";
      ctx.fillStyle = "rgba(4, 23, 23, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(checkpoint.x, floor);
      ctx.lineTo(checkpoint.x, floor - 44);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(checkpoint.x, floor - 51);
      ctx.lineTo(checkpoint.x + 7, floor - 46);
      ctx.lineTo(checkpoint.x, floor - 41);
      ctx.lineTo(checkpoint.x - 7, floor - 46);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? "#b7f5d4" : "#76938a";
      ctx.beginPath();
      ctx.arc(checkpoint.x, floor - 46, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = active ? "rgba(183, 245, 212, 0.56)" : "rgba(145, 170, 164, 0.38)";
      ctx.fillText(checkpoint.label, checkpoint.x, floor + 14);
      ctx.restore();
    }
  }

  drawWarehouse(ctx, run, viewWidth) {
    const warehouse = run.world.warehouse;
    if (warehouse.x - 250 > this.cameraX + viewWidth + 100) {
      return;
    }
    if (warehouse.x + 300 < this.cameraX - 120) {
      return;
    }
    const x = warehouse.x;
    const y = warehouse.waterY;
    const floor = floorAt(run.world, x);
    ctx.save();

    const wallGradient = ctx.createLinearGradient(x - 170, 0, x + 150, 0);
    wallGradient.addColorStop(0, "#0b2323");
    wallGradient.addColorStop(0.6, "#183834");
    wallGradient.addColorStop(1, "#071918");
    ctx.fillStyle = wallGradient;
    ctx.beginPath();
    ctx.moveTo(x - 174, floor + 3);
    ctx.lineTo(x - 174, y - 143);
    ctx.quadraticCurveTo(x, y - 215, x + 170, y - 143);
    ctx.lineTo(x + 170, floor + 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(183, 245, 212, 0.25)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = "rgba(2, 11, 12, 0.75)";
    roundedRect(ctx, x + 2, y - 126, 112, 127, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 192, 106, 0.34)";
    ctx.stroke();

    const doorGlow = ctx.createLinearGradient(x, y - 120, x, floor);
    doorGlow.addColorStop(0, "rgba(255, 192, 106, 0.11)");
    doorGlow.addColorStop(1, "rgba(255, 192, 106, 0)");
    ctx.fillStyle = doorGlow;
    ctx.fillRect(x + 3, y - 125, 110, 126);

    ctx.strokeStyle = "rgba(255, 192, 106, 0.36)";
    ctx.lineWidth = 2;
    for (let line = 0; line < 4; line += 1) {
      ctx.beginPath();
      ctx.moveTo(x + 13, y - 105 + line * 25);
      ctx.lineTo(x + 103, y - 105 + line * 25);
      ctx.stroke();
    }

    for (let index = 0; index < 3; index += 1) {
      const bx = x - 140 + index * 31;
      const by = floor - 29 - (index % 2) * 14;
      ctx.fillStyle = "#2a251c";
      ctx.fillRect(bx, by, 25, 24);
      ctx.strokeStyle = "rgba(255, 192, 106, 0.35)";
      ctx.strokeRect(bx, by, 25, 24);
      ctx.beginPath();
      ctx.moveTo(bx + 3, by + 3);
      ctx.lineTo(bx + 22, by + 21);
      ctx.moveTo(bx + 22, by + 3);
      ctx.lineTo(bx + 3, by + 21);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(2, 15, 15, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x - 30, y - 161);
    ctx.lineTo(x + 10, y - 175);
    ctx.lineTo(x + 202, y - 175);
    ctx.lineTo(x + 202, y - 151);
    ctx.lineTo(x + 125, y - 151);
    ctx.lineTo(x + 82, y - 141);
    ctx.lineTo(x - 30, y - 141);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(183, 245, 212, 0.28)";
    ctx.stroke();
    ctx.font = '8px ui-monospace, "Noto Sans SC Local", monospace';
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 192, 106, 0.9)";
    ctx.fillText("K-07 / 地下仓库", x - 9, y - 153);
    ctx.fillStyle = "rgba(183, 245, 212, 0.46)";
    ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
    ctx.fillText("DOCK SLOW · 48 KNOTS MAX", x - 9, y - 142);

    const lampPulse = 0.7 + Math.sin(run.time * 2.4) * 0.15;
    ctx.fillStyle = `rgba(255, 192, 106, ${lampPulse})`;
    ctx.beginPath();
    ctx.arc(x + 121, y - 97, 3.2, 0, Math.PI * 2);
    ctx.fill();
    const lampGlow = ctx.createRadialGradient(x + 121, y - 97, 1, x + 121, y - 97, 48);
    lampGlow.addColorStop(0, "rgba(255, 192, 106, 0.21)");
    lampGlow.addColorStop(1, "rgba(255, 192, 106, 0)");
    ctx.fillStyle = lampGlow;
    ctx.fillRect(x + 70, y - 148, 100, 100);

    ctx.strokeStyle = "rgba(183, 245, 212, 0.18)";
    ctx.setLineDash([4, 7]);
    ctx.beginPath();
    ctx.moveTo(x - 70, y + 15);
    ctx.lineTo(x + 120, y + 15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawStalactites(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    for (const stalactite of run.world.stalactites) {
      if (stalactite.x < x0 || stalactite.x > x1) {
        continue;
      }
      const gradient = ctx.createLinearGradient(
        stalactite.x,
        stalactite.top,
        stalactite.x,
        stalactite.bottom,
      );
      gradient.addColorStop(0, "#173431");
      gradient.addColorStop(0.6, "#0d2423");
      gradient.addColorStop(1, "#182f2c");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(stalactite.x - stalactite.width / 2, stalactite.top - 3);
      ctx.quadraticCurveTo(
        stalactite.x - stalactite.width * 0.33,
        stalactite.top + (stalactite.bottom - stalactite.top) * 0.5,
        stalactite.x,
        stalactite.bottom,
      );
      ctx.quadraticCurveTo(
        stalactite.x + stalactite.width * 0.33,
        stalactite.top + (stalactite.bottom - stalactite.top) * 0.5,
        stalactite.x + stalactite.width / 2,
        stalactite.top - 3,
      );
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(154, 218, 192, 0.25)";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.strokeStyle = "rgba(212, 246, 227, 0.1)";
      ctx.beginPath();
      ctx.moveTo(stalactite.x - 1, stalactite.top + 8);
      ctx.quadraticCurveTo(
        stalactite.x - 4,
        stalactite.top + (stalactite.bottom - stalactite.top) * 0.55,
        stalactite.x,
        stalactite.bottom - 8,
      );
      ctx.stroke();

      if (stalactite.gate) {
        ctx.fillStyle = "rgba(255, 192, 106, 0.34)";
        ctx.beginPath();
        ctx.arc(stalactite.x, stalactite.bottom - 4, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawPickups(ctx, run, viewWidth) {
    const x0 = this.cameraX - 80;
    const x1 = this.cameraX + viewWidth + 80;
    for (const crate of run.cargo) {
      if (crate.collected || crate.x < x0 || crate.x > x1) {
        continue;
      }
      const bob = Math.sin(run.time * 1.7 + crate.x * 0.01) * 2.3;
      this.drawCrate(ctx, crate.x, crate.y + bob, 34, {
        floating: true,
        glow: crate.id === run.pickupCargoId,
      });
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = '7px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.fillStyle = "rgba(255, 192, 106, 0.84)";
      ctx.fillText(`物资 ${crate.index + 1} · ${crate.mass.toFixed(1)}t`, crate.x, crate.y - 32 + bob);
      ctx.strokeStyle = "rgba(255, 192, 106, 0.24)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.ellipse(crate.x, crate.y + 22, 29, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const cell of run.cells) {
      if (cell.collected || cell.x < x0 || cell.x > x1) {
        continue;
      }
      const bob = Math.sin(run.time * 1.3 + cell.x * 0.02) * 1.8;
      const x = cell.x;
      const y = cell.y + bob;
      ctx.save();
      const glow = ctx.createRadialGradient(x, y, 1, x, y, 35);
      glow.addColorStop(0, "rgba(112, 223, 209, 0.16)");
      glow.addColorStop(1, "rgba(112, 223, 209, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 35, y - 35, 70, 70);
      ctx.fillStyle = "#102b29";
      roundedRect(ctx, x - 9, y - 14, 18, 28, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(112, 223, 209, 0.65)";
      ctx.stroke();
      ctx.fillStyle = "#70dfd1";
      ctx.fillRect(x - 4, y - 9, 8, 3);
      ctx.fillRect(x - 4, y - 3, 8, 3);
      ctx.fillRect(x - 4, y + 3, 8, 3);
      ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(112, 223, 209, 0.72)";
      ctx.fillText("+18%", x, y + 27);
      ctx.restore();
    }
  }

  drawCrate(ctx, centerX, centerY, size, options = {}) {
    const half = size / 2;
    ctx.save();
    if (options.glow) {
      const glow = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, size * 1.8);
      glow.addColorStop(0, "rgba(255, 192, 106, 0.25)");
      glow.addColorStop(1, "rgba(255, 192, 106, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(centerX - size * 2, centerY - size * 2, size * 4, size * 4);
    }
    ctx.translate(centerX, centerY);
    if (options.floating) {
      ctx.rotate(Math.sin(centerX * 0.03) * 0.035);
    }
    ctx.fillStyle = options.floating ? "#2b281f" : "#302b21";
    ctx.fillRect(-half, -half, size, size);
    ctx.strokeStyle = "rgba(255, 192, 106, 0.68)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-half + 0.5, -half + 0.5, size - 1, size - 1);
    ctx.strokeStyle = "rgba(255, 192, 106, 0.3)";
    ctx.beginPath();
    ctx.moveTo(-half + 4, -half + 4);
    ctx.lineTo(half - 4, half - 4);
    ctx.moveTo(half - 4, -half + 4);
    ctx.lineTo(-half + 4, half - 4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 228, 183, 0.28)";
    ctx.strokeRect(-half + 5.5, -half + 5.5, size - 11, size - 11);
    ctx.fillStyle = "rgba(7, 16, 16, 0.9)";
    ctx.fillRect(-half + 8, -2, size - 16, 4);
    ctx.restore();
  }

  drawRaft(ctx, run) {
    const raft = run.raft;
    const waterY = waterAt(run.world, raft.x) - 5 + raft.bob;
    const engine = run.status === "playing" ? Math.abs(raft.vx) : 0;
    const x = raft.x;
    const y = waterY;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(raft.tilt + raft.heading * 0.22);

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000809";
    ctx.beginPath();
    ctx.ellipse(0, 14, 67, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const wake = 22 + engine * 0.25;
    ctx.strokeStyle = "rgba(185, 246, 218, 0.26)";
    ctx.lineWidth = 0.9;
    for (let line = 0; line < 4; line += 1) {
      const side = line % 2 === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(-46 - line * 5, side * (7 + line * 2));
      ctx.quadraticCurveTo(-wake - 18, side * (13 + line * 3), -wake - 36, side * (7 + line * 4));
      ctx.stroke();
    }

    const hull = ctx.createLinearGradient(0, -16, 0, 17);
    hull.addColorStop(0, "#356e65");
    hull.addColorStop(0.32, "#1d4b47");
    hull.addColorStop(1, "#0a2223");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(-55, -7);
    ctx.quadraticCurveTo(-48, -16, -26, -17);
    ctx.lineTo(42, -15);
    ctx.quadraticCurveTo(58, -11, 63, -1);
    ctx.lineTo(58, 12);
    ctx.quadraticCurveTo(40, 18, 23, 17);
    ctx.lineTo(-46, 16);
    ctx.quadraticCurveTo(-58, 11, -55, -7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(183, 245, 212, 0.42)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#0a1818";
    roundedRect(ctx, -42, 3, 86, 11, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(112, 223, 209, 0.18)";
    ctx.stroke();
    for (let index = 0; index < 6; index += 1) {
      ctx.fillStyle = index % 2 === 0 ? "#1d4540" : "#163834";
      ctx.fillRect(-36 + index * 13, 5, 9, 6);
    }

    ctx.fillStyle = "#102929";
    ctx.fillRect(-25, -24, 35, 11);
    ctx.strokeStyle = "rgba(183, 245, 212, 0.25)";
    ctx.strokeRect(-25, -24, 35, 11);
    ctx.fillStyle = "rgba(255, 192, 106, 0.78)";
    for (let index = 0; index < 3; index += 1) {
      ctx.fillRect(-18 + index * 8, -20, 3, 3);
    }

    const rackBase = -18;
    const cargoBottom = -31 - raft.rack * 78;
    ctx.strokeStyle = "rgba(183, 245, 212, 0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-44, rackBase);
    ctx.lineTo(-44, cargoBottom - 4);
    ctx.moveTo(44, rackBase);
    ctx.lineTo(44, cargoBottom - 4);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 192, 106, 0.35)";
    ctx.beginPath();
    ctx.moveTo(-46, cargoBottom - 2);
    ctx.lineTo(46, cargoBottom - 2);
    ctx.stroke();

    const cargo = run.cargo.filter((crate) => crate.collected);
    cargo.forEach((crate, index) => {
      const cargoX = CARGO_OFFSETS[crate.slot + 1];
      const cargoY = cargoBottom - 14;
      const tilt = Math.sin(run.time * 1.4 + index) * 0.012;
      ctx.save();
      ctx.translate(cargoX, cargoY);
      ctx.rotate(tilt);
      this.drawCrate(ctx, 0, 0, 28);
      ctx.fillStyle = "rgba(255, 192, 106, 0.7)";
      ctx.font = '5px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.textAlign = "center";
      ctx.fillText(String(crate.index + 1).padStart(2, "0"), 0, 2);
      ctx.restore();

      ctx.strokeStyle = "rgba(255, 192, 106, 0.24)";
      ctx.beginPath();
      ctx.moveTo(cargoX, cargoY + 14);
      ctx.lineTo(cargoX, cargoBottom - 1);
      ctx.stroke();
    });

    if (cargo.length === 0) {
      ctx.strokeStyle = "rgba(145, 170, 164, 0.32)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(-38, cargoBottom - 17, 24, 18);
      ctx.strokeRect(14, cargoBottom - 17, 24, 18);
      ctx.setLineDash([]);
      ctx.font = '5px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.fillStyle = "rgba(145, 170, 164, 0.48)";
      ctx.textAlign = "center";
      ctx.fillText("EMPTY", 0, cargoBottom + 4);
    }

    ctx.fillStyle = "#0a2121";
    roundedRect(ctx, 30, -25, 20, 25, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(183, 245, 212, 0.28)";
    ctx.stroke();
    ctx.fillStyle = "rgba(112, 223, 209, 0.7)";
    ctx.fillRect(35, -19, 10, 2);
    ctx.fillRect(35, -13, 7, 2);

    ctx.fillStyle = "#1d3e3a";
    ctx.beginPath();
    ctx.arc(-47, -2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 192, 106, 0.45)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 192, 106, 0.75)";
    ctx.beginPath();
    ctx.arc(-47, -2, 2, 0, Math.PI * 2);
    ctx.fill();

    const lampX = 58;
    const lampY = -19;
    const glow = ctx.createRadialGradient(lampX, lampY, 1, lampX, lampY, 26);
    glow.addColorStop(0, "rgba(255, 225, 164, 0.92)");
    glow.addColorStop(0.2, "rgba(255, 192, 106, 0.42)");
    glow.addColorStop(1, "rgba(255, 192, 106, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(lampX - 27, lampY - 27, 54, 54);
    ctx.fillStyle = "#ffdc9b";
    ctx.beginPath();
    ctx.arc(lampX, lampY, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const beam = ctx.createLinearGradient(lampX, lampY, lampX + 280, lampY + 82);
    beam.addColorStop(0, "rgba(255, 218, 150, 0.23)");
    beam.addColorStop(0.45, "rgba(255, 192, 106, 0.08)");
    beam.addColorStop(1, "rgba(255, 192, 106, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(lampX, lampY - 5);
    ctx.lineTo(lampX + 286, lampY - 98);
    ctx.lineTo(lampX + 286, lampY + 100);
    ctx.lineTo(lampX, lampY + 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (run.status === "failed") {
      ctx.strokeStyle = "rgba(255, 118, 109, 0.75)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-13, -57);
      ctx.lineTo(13, -31);
      ctx.moveTo(13, -57);
      ctx.lineTo(-13, -31);
      ctx.stroke();
    }

    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
    ctx.fillStyle = "rgba(183, 245, 212, 0.46)";
    ctx.fillText("D-07 / 电动货筏", x, y + 34);
    ctx.restore();
  }

  drawAtmosphere(ctx, run, viewWidth) {
    const x0 = this.cameraX - 40;
    const x1 = this.cameraX + viewWidth + 40;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < 24; index += 1) {
      const baseX = x0 + ((index * 181 + 47) % Math.max(1, x1 - x0));
      const drift = Math.sin(run.time * 0.25 + index) * 9;
      const x = baseX + drift;
      const y =
        waterAt(run.world, x) -
        44 -
        ((index * 47 + run.time * (3 + (index % 3))) % 115);
      const alpha = 0.06 + (index % 4) * 0.025;
      ctx.fillStyle = `rgba(255, 219, 157, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.7 + (index % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let index = 0; index < 11; index += 1) {
      if (run.raft.vx < 4) {
        break;
      }
      const x = run.raft.x - 58 - ((index * 17 + run.time * 31) % 86);
      const y = waterAt(run.world, x) + 5 + (index % 3) * 3;
      ctx.fillStyle = "rgba(131, 226, 199, 0.18)";
      ctx.beginPath();
      ctx.arc(x, y, 1 + (index % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (run.telemetry?.clearanceWarning) {
      const y = waterAt(run.world, run.raft.x) - 132;
      ctx.save();
      ctx.fillStyle = "rgba(255, 118, 109, 0.17)";
      ctx.strokeStyle = "rgba(255, 118, 109, 0.72)";
      ctx.beginPath();
      ctx.moveTo(run.raft.x, y - 9);
      ctx.lineTo(run.raft.x + 9, y + 6);
      ctx.lineTo(run.raft.x - 9, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff9b91";
      ctx.font = '7px ui-monospace, "Noto Sans SC Local", monospace';
      ctx.textAlign = "center";
      ctx.fillText("LOW", run.raft.x, y + 1);
      ctx.fillText("PRESS S", run.raft.x, y + 17);
      ctx.restore();
    }
  }

  drawScreenVignette(ctx) {
    ctx.save();
    const vignette = ctx.createRadialGradient(
      this.width * 0.47,
      this.height * 0.5,
      Math.min(this.width, this.height) * 0.24,
      this.width * 0.5,
      this.height * 0.5,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.16)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.56)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  drawMinimap(run) {
    const canvas = this.minimap;
    const ctx = this.minimapCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 74;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(0, 0, width, height);

    const inset = 9;
    const mapWidth = width - inset * 2;
    const mapX = (x) => inset + (x / run.world.width) * mapWidth;

    ctx.strokeStyle = "rgba(170, 234, 207, 0.12)";
    ctx.lineWidth = 1;
    for (let index = 1; index < 4; index += 1) {
      const x = inset + (index / 4) * mapWidth;
      ctx.beginPath();
      ctx.moveTo(x, 9);
      ctx.lineTo(x, height - 12);
      ctx.stroke();
    }

    for (const hazard of Object.values(run.world.hazards)) {
      ctx.fillStyle =
        hazard.tone === "coral" || hazard.id === "ceiling-gate"
          ? "rgba(255, 118, 109, 0.2)"
          : "rgba(255, 192, 106, 0.2)";
      ctx.fillRect(mapX(hazard.start), 47, mapX(hazard.end) - mapX(hazard.start), 5);
    }

    ctx.fillStyle = "rgba(183, 245, 212, 0.15)";
    ctx.fillRect(mapX(run.world.warehouse.x - 40), 14, 4, height - 28);

    for (const checkpoint of run.world.checkpoints) {
      ctx.fillStyle = run.checkpointIds.includes(checkpoint.id)
        ? "rgba(183, 245, 212, 0.75)"
        : "rgba(145, 170, 164, 0.3)";
      ctx.fillRect(mapX(checkpoint.x), 53, 1, 7);
    }

    for (const crate of run.cargo) {
      ctx.strokeStyle = crate.collected
        ? "rgba(255, 192, 106, 0.25)"
        : "rgba(255, 192, 106, 0.86)";
      ctx.fillStyle = crate.collected ? "rgba(255, 192, 106, 0.08)" : "rgba(255, 192, 106, 0.22)";
      ctx.beginPath();
      ctx.arc(mapX(crate.x), 36, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (run.path.length > 1) {
      ctx.strokeStyle = "rgba(183, 245, 212, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (const point of run.path) {
        const x = mapX(point.x);
        const y = 34 + clamp((point.y - 350) / 170, -1, 1) * 9;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    const raftX = mapX(run.raft.x);
    const raftY = 34 + clamp((run.raft.y - 350) / 170, -1, 1) * 9;
    ctx.fillStyle = "#d8ffea";
    ctx.shadowColor = "#b7f5d4";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(raftX + 4, raftY);
    ctx.lineTo(raftX - 4, raftY - 4);
    ctx.lineTo(raftX - 4, raftY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
    ctx.fillStyle = "rgba(145, 170, 164, 0.54)";
    ctx.textAlign = "left";
    ctx.fillText("A", inset, height - 4);
    ctx.textAlign = "right";
    ctx.fillText("K-07", width - inset, height - 4);
  }
}

function resizeMapCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || canvas.width || 400;
  const height = canvas.clientHeight || canvas.height || 126;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export function drawRouteSummary(canvas, summary) {
  const { ctx, width, height } = resizeMapCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const inset = 14;
  const mapWidth = width - inset * 2;
  const mapX = (x) => inset + (x / 3340) * mapWidth;
  const mapY = (y) => 28 + ((y - 300) / 240) * (height - 53);

  ctx.strokeStyle = "rgba(183, 245, 212, 0.1)";
  ctx.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const x = inset + (index / 4) * mapWidth;
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x, height - 12);
    ctx.stroke();
  }

  const hazards = Object.values(summary.world.hazards);
  for (const hazard of hazards) {
    ctx.fillStyle =
      hazard.tone === "coral" || hazard.id === "ceiling-gate"
        ? "rgba(255, 118, 109, 0.13)"
        : "rgba(255, 192, 106, 0.13)";
    ctx.fillRect(mapX(hazard.start), 12, mapX(hazard.end) - mapX(hazard.start), height - 24);
  }

  const points = summary.route.points;
  if (points.length > 1) {
    ctx.strokeStyle = "rgba(183, 245, 212, 0.72)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(mapX(point.x), mapY(point.y));
      } else {
        ctx.lineTo(mapX(point.x), mapY(point.y));
      }
    });
    ctx.stroke();
  }

  for (const crate of summary.route.cargoPoints) {
    ctx.strokeStyle = crate.collected
      ? "rgba(255, 192, 106, 0.38)"
      : "rgba(255, 192, 106, 0.82)";
    ctx.fillStyle = crate.collected
      ? "rgba(255, 192, 106, 0.1)"
      : "rgba(255, 192, 106, 0.25)";
    ctx.beginPath();
    ctx.arc(mapX(crate.x), height * 0.5, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(183, 245, 212, 0.16)";
  ctx.fillRect(mapX(summary.world.warehouse.x - 30), 13, 5, height - 26);
  ctx.fillStyle = "rgba(183, 245, 212, 0.68)";
  ctx.font = '6px ui-monospace, "Noto Sans SC Local", monospace';
  ctx.textAlign = "center";
  ctx.fillText("K-07", mapX(summary.world.warehouse.x), 10);

  const endX = mapX(summary.route.endX);
  const last = points[points.length - 1];
  const endY = last ? mapY(last.y) : height * 0.5;
  ctx.fillStyle = summary.outcome === "success" ? "#b7f5d4" : "#ff766d";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(endX, endY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = "rgba(145, 170, 164, 0.54)";
  ctx.textAlign = "left";
  ctx.fillText("START", inset, height - 3);
  ctx.textAlign = "right";
  ctx.fillText("END", width - inset, height - 3);
}
