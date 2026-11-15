const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class FerryRenderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.particles = [];
    this.lastEventTime = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setGame(game) {
    this.game = game;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.dpr = dpr;
    this.scale = Math.min(rect.width / 1200, rect.height / 720);
    this.offsetX = (rect.width - 1200 * this.scale) / 2;
    this.offsetY = (rect.height - 720 * this.scale) / 2;
  }

  burst(x, y, color = "#b9fff7", count = 14, force = 1) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + Math.sin(i * 12.7) * 0.7;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * (18 + (i % 5) * 8) * force,
        vy: Math.sin(angle) * (18 + (i % 7) * 7) * force,
        life: 0.5 + (i % 4) * 0.13,
        maxLife: 0.9,
        size: 1.4 + (i % 4),
        color,
      });
    }
  }

  render(realTime = 0) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    const shake = this.game.state.shake || 0;
    if (shake > 0) {
      ctx.translate(Math.sin(realTime * 0.09) * shake * 6, Math.cos(realTime * 0.11) * shake * 3);
    }
    this.drawBackdrop(ctx);
    this.drawRiver(ctx);
    this.drawRoute(ctx);
    this.drawDocks(ctx);
    this.drawAnchors(ctx);
    this.drawIceFloes(ctx);
    this.drawPath(ctx);
    this.drawFerry(ctx, realTime);
    this.drawParticles(ctx, realTime);
    this.drawSceneLabels(ctx);
    ctx.restore();
  }

  drawBackdrop(ctx) {
    const time = this.game.state.elapsed;
    const gradient = ctx.createLinearGradient(0, 0, 1200, 720);
    gradient.addColorStop(0, "#071923");
    gradient.addColorStop(0.5, "#0b303a");
    gradient.addColorStop(1, "#06171f");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1200, 720);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let band = 0; band < 3; band += 1) {
      const ribbon = ctx.createLinearGradient(70, 40, 1100, 290);
      ribbon.addColorStop(0, "rgba(24, 146, 132, 0)");
      ribbon.addColorStop(0.32, `rgba(75, 223, 195, ${0.035 + band * 0.012})`);
      ribbon.addColorStop(0.65, `rgba(57, 125, 192, ${0.025 + band * 0.008})`);
      ribbon.addColorStop(1, "rgba(20, 90, 110, 0)");
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = 36 + band * 18;
      ctx.beginPath();
      for (let x = -40; x <= 1240; x += 35) {
        const y = 85 + band * 35 + Math.sin(x * 0.006 + time * 0.12 + band) * 34;
        if (x === -40) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    for (const star of this.game.scenario.stars) {
      const twinkle = 0.72 + Math.sin(time * 0.7 + star.x) * 0.28;
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = "#d7ffff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawRiver(ctx) {
    const time = this.game.state.elapsed;
    const water = ctx.createLinearGradient(160, 0, 1040, 0);
    water.addColorStop(0, "#0d3841");
    water.addColorStop(0.18, "#0b303b");
    water.addColorStop(0.5, "#092934");
    water.addColorStop(0.82, "#0b303b");
    water.addColorStop(1, "#0d3841");
    ctx.fillStyle = water;
    ctx.fillRect(160, 0, 880, 720);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#7be0d4";
    ctx.lineWidth = 1;
    for (let i = 0; i < 34; i += 1) {
      const x = 180 + ((i * 197 + 47) % 840);
      const y = ((i * 93 + time * (7 + (i % 4) * 3)) % 760) - 20;
      const length = 32 + (i % 5) * 15;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y + length * 0.45, x - 2, y + length);
      ctx.stroke();
    }
    ctx.restore();

    this.drawBank(ctx, "west");
    this.drawBank(ctx, "east");

    const fog = ctx.createLinearGradient(0, 560, 0, 720);
    fog.addColorStop(0, "rgba(134, 214, 210, 0)");
    fog.addColorStop(1, "rgba(155, 225, 218, 0.075)");
    ctx.fillStyle = fog;
    ctx.fillRect(160, 520, 880, 200);
  }

  drawBank(ctx, side) {
    const time = this.game.state.elapsed;
    const west = side === "west";
    const edge = west ? 160 : 1040;
    const sign = west ? -1 : 1;
    const bankGradient = ctx.createLinearGradient(west ? 0 : 1200, 0, edge, 0);
    bankGradient.addColorStop(0, "#b9cfd1");
    bankGradient.addColorStop(0.62, "#829da1");
    bankGradient.addColorStop(1, "#486b71");

    ctx.beginPath();
    ctx.moveTo(west ? 0 : 1200, 0);
    ctx.lineTo(edge, 0);
    for (let y = 0; y <= 720; y += 24) {
      const ripple = Math.sin(y * 0.026 + (west ? 0.7 : 2.2)) * 7 + Math.sin(y * 0.071) * 3;
      ctx.lineTo(edge + sign * ripple, y);
    }
    ctx.lineTo(west ? 0 : 1200, 720);
    ctx.closePath();
    ctx.fillStyle = bankGradient;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(228, 250, 249, 0.17)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i += 1) {
      const x = west ? 8 + i * 7 : 1192 - i * 7;
      const y = (i * 143 + time * 1.2) % 760 - 20;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 31, y + 21);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(183, 246, 242, 0.5)";
    ctx.shadowColor = "#8fe8df";
    ctx.shadowBlur = 9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y <= 720; y += 16) {
      const ripple = Math.sin(y * 0.026 + (west ? 0.7 : 2.2)) * 7 + Math.sin(y * 0.071) * 3;
      if (y === 0) ctx.moveTo(edge + sign * ripple, y);
      else ctx.lineTo(edge + sign * ripple, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (let i = 0; i < 15; i += 1) {
      const x = west ? 32 + ((i * 61) % 95) : 1070 + ((i * 47) % 94);
      const y = 18 + ((i * 113) % 660);
      ctx.fillStyle = i % 3 ? "rgba(228, 246, 244, 0.34)" : "rgba(61, 87, 91, 0.3)";
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + (i % 4) * 3, 2 + (i % 3) * 2, i * 0.7, 0, TAU);
      ctx.fill();
    }
  }

  drawRoute(ctx) {
    const state = this.game.state;
    ctx.save();
    ctx.setLineDash([12, 13]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(136, 228, 217, 0.17)";
    ctx.strokeRect(160, 252, 880, 216);
    ctx.beginPath();
    ctx.moveTo(250, 360);
    ctx.lineTo(950, 360);
    ctx.stroke();
    ctx.setLineDash([]);

    const targetX = state.nextDock === "east" ? 997 : 203;
    const pulse = 0.55 + Math.sin(state.elapsed * 2.4) * 0.2;
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#ffc56e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(targetX, 360, 36 + Math.sin(state.elapsed * 2.4) * 3, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.font = "10px 'Noto Sans SC', Consolas, monospace";
    ctx.fillStyle = "rgba(184, 235, 230, 0.53)";
    ctx.textAlign = "center";
    ctx.fillText("安全靠岸走廊 · 限速 42", 600, 270);
    ctx.restore();
  }

  drawDocks(ctx) {
    this.drawDock(ctx, "west");
    this.drawDock(ctx, "east");
  }

  drawDock(ctx, side) {
    const state = this.game.state;
    const dock = side === "west" ? { x: 203, y: 360 } : { x: 997, y: 360 };
    const active = state.nextDock === side;
    const west = side === "west";
    const bedX = west ? 158 : 1042;
    const endX = west ? 238 : 962;

    ctx.save();
    ctx.strokeStyle = "rgba(2, 16, 21, 0.42)";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(bedX, 360);
    ctx.lineTo(endX, 360);
    ctx.stroke();

    ctx.fillStyle = "#394d4f";
    ctx.strokeStyle = "rgba(175, 224, 219, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(Math.min(bedX, endX), 338, Math.abs(endX - bedX), 44);
    ctx.fill();
    ctx.stroke();

    for (let x = Math.min(bedX, endX) + 8; x < Math.max(bedX, endX); x += 17) {
      ctx.strokeStyle = "rgba(208, 233, 228, 0.15)";
      ctx.beginPath();
      ctx.moveTo(x, 340);
      ctx.lineTo(x, 380);
      ctx.stroke();
    }

    for (const y of [326, 394]) {
      ctx.fillStyle = "#232f31";
      ctx.beginPath();
      ctx.arc(west ? endX - 7 : endX + 7, y, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#d7a44d";
      ctx.beginPath();
      ctx.arc(west ? endX - 7 : endX + 7, y, 2.5, 0, TAU);
      ctx.fill();
    }

    if (active) {
      const glow = ctx.createRadialGradient(dock.x, dock.y, 2, dock.x, dock.y, 63);
      glow.addColorStop(0, "rgba(255, 196, 104, 0.13)");
      glow.addColorStop(1, "rgba(255, 196, 104, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(dock.x, dock.y, 62, 0, TAU);
      ctx.fill();
    }

    const lampX = west ? 151 : 1049;
    ctx.fillStyle = "#e9d49d";
    ctx.beginPath();
    ctx.arc(lampX, 319, 3.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 218, 137, 0.16)";
    ctx.beginPath();
    ctx.arc(lampX, 319, 19, 0, TAU);
    ctx.fill();

    ctx.font = "bold 10px 'Noto Sans SC', Georgia, serif";
    ctx.textAlign = west ? "left" : "right";
    ctx.fillStyle = active ? "#ffd593" : "rgba(207, 236, 232, 0.55)";
    ctx.fillText(west ? "西岸维修坞" : "东岸抢修坞", west ? 18 : 1182, 298);
    ctx.font = "8px 'Noto Sans SC', Consolas, monospace";
    ctx.fillStyle = "rgba(171, 211, 208, 0.55)";
    ctx.fillText(active ? "▶ 当前目的地" : "等待返航", west ? 18 : 1182, 311);
    ctx.restore();
  }

  drawAnchors(ctx) {
    const state = this.game.state;
    const candidateId = state.cable.candidateId;
    for (const anchor of state.anchors) {
      const attached = state.cable.attached && state.cable.anchorId === anchor.id;
      const candidate = candidateId === anchor.id;
      ctx.save();
      ctx.translate(anchor.x, anchor.y);
      ctx.rotate(anchor.rotation);
      ctx.fillStyle = "rgba(158, 230, 224, 0.16)";
      ctx.strokeStyle = "rgba(187, 250, 244, 0.48)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < 9; i += 1) {
        const angle = (i / 9) * TAU;
        const radius = anchor.radius * (0.84 + (i % 3) * 0.08);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-anchor.rotation);
      ctx.fillStyle = attached ? "#85f3a7" : candidate ? "#ffc96e" : "#d6ac5e";
      ctx.fillRect(-3, -14, 6, 24);
      ctx.fillStyle = "#f6e0a8";
      ctx.fillRect(-4, -18, 8, 5);
      ctx.strokeStyle = attached ? "rgba(133, 243, 167, 0.6)" : "rgba(255, 191, 105, 0.28)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, 30 + (attached ? 3 : 0), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "8px 'Noto Sans SC', Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = attached ? "#a9f0bd" : "rgba(245, 219, 166, 0.68)";
      ctx.fillText(anchor.label, 0, 34);
      ctx.restore();
    }
  }

  drawIceFloes(ctx) {
    const tones = {
      pale: ["#c8f3ec", "#75b9b5", "#466f76"],
      blue: ["#a5e7e7", "#4e9dab", "#365d6e"],
      milky: ["#d5eee4", "#86b9b1", "#587577"],
    };
    for (const floe of this.game.state.iceFloes) {
      const palette = tones[floe.tone] || tones.pale;
      ctx.save();
      ctx.translate(floe.x, floe.y);
      ctx.rotate(floe.rotation);

      ctx.fillStyle = "rgba(1, 13, 19, 0.36)";
      ctx.beginPath();
      ctx.ellipse(8, 10, floe.radius * 1.05, floe.radius * 0.78, 0.2, 0, TAU);
      ctx.fill();

      const gradient = ctx.createLinearGradient(
        -floe.radius * 0.7,
        -floe.radius * 0.7,
        floe.radius * 0.8,
        floe.radius * 0.6,
      );
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.48, palette[1]);
      gradient.addColorStop(1, palette[2]);
      ctx.fillStyle = gradient;
      ctx.strokeStyle = "rgba(224, 255, 250, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < floe.points.length; i += 1) {
        const point = floe.points[i];
        const x = Math.cos(point.angle) * point.radius;
        const y = Math.sin(point.angle) * point.radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.globalAlpha = 0.46;
      ctx.fillStyle = "#edfffb";
      ctx.beginPath();
      for (let i = 0; i < floe.points.length; i += 1) {
        const point = floe.points[i];
        const x = Math.cos(point.angle) * point.radius * 0.72;
        const y = Math.sin(point.angle) * point.radius * 0.72 - floe.radius * 0.17;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(20, 74, 82, 0.42)";
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 3; i += 1) {
        const angle = (i / 3) * TAU + Math.sin(floe.x + i) * 0.4;
        const start = floe.radius * (0.13 + i * 0.06);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
        ctx.lineTo(
          Math.cos(angle + 0.23) * floe.radius * 0.52,
          Math.sin(angle + 0.23) * floe.radius * 0.52,
        );
        ctx.lineTo(
          Math.cos(angle - 0.09) * floe.radius * 0.79,
          Math.sin(angle - 0.09) * floe.radius * 0.79,
        );
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawPath(ctx) {
    const state = this.game.state;
    if (state.path.length < 2) return;
    ctx.save();
    ctx.globalAlpha = state.status === "won" ? 0.82 : 0.34;
    ctx.strokeStyle = state.status === "won" ? "#c8ffe4" : "#7de3d6";
    ctx.lineWidth = state.status === "won" ? 2.6 : 1.3;
    ctx.setLineDash(state.status === "won" ? [] : [4, 6]);
    ctx.beginPath();
    state.path.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    if (state.status === "won") {
      const last = state.path[state.path.length - 1];
      ctx.fillStyle = "#c8ffe4";
      ctx.beginPath();
      ctx.arc(last.x, last.y, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCable(ctx) {
    const state = this.game.state;
    const ferry = state.ferry;
    const cable = state.cable;
    if (!cable.attached || !cable.anchorId) return;
    const anchor = state.anchors.find((item) => item.id === cable.anchorId);
    if (!anchor) return;
    const bowX = ferry.x + Math.cos(ferry.heading) * 21;
    const bowY = ferry.y + Math.sin(ferry.heading) * 21;
    const dx = bowX - anchor.x;
    const dy = bowY - anchor.y;
    const distance = Math.hypot(dx, dy);
    const excess = Math.max(0, distance - cable.length);
    const sag = clamp(24 - excess * 0.4, 3, 22);
    const mx = (anchor.x + bowX) / 2;
    const my = (anchor.y + bowY) / 2 + sag;

    ctx.save();
    ctx.strokeStyle = cable.tension > 0.64 ? "rgba(255, 172, 94, 0.96)" : "rgba(230, 210, 151, 0.8)";
    ctx.lineWidth = cable.tension > 0.64 ? 2.4 : 1.6;
    ctx.shadowColor = cable.tension > 0.64 ? "#ff9c52" : "#e6d397";
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.quadraticCurveTo(mx, my, bowX, bowY);
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (cable.tension > 0.12) {
      ctx.strokeStyle = "rgba(255, 206, 126, 0.25)";
      ctx.setLineDash([1, 7]);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFerry(ctx, realTime) {
    const state = this.game.state;
    const ferry = state.ferry;
    this.drawCable(ctx);
    const speed = this.game.speed;
    const throttle = ferry.throttle;

    ctx.save();
    if (speed > 4) {
      ctx.save();
      ctx.translate(ferry.x, ferry.y);
      ctx.rotate(ferry.heading);
      const wash = clamp(speed / 60, 0.16, 1);
      const wake = ctx.createLinearGradient(-24, 0, -85, 0);
      wake.addColorStop(0, `rgba(193, 255, 248, ${0.19 * wash})`);
      wake.addColorStop(1, "rgba(193, 255, 248, 0)");
      ctx.fillStyle = wake;
      ctx.beginPath();
      ctx.moveTo(-18, -9);
      ctx.lineTo(-92, -21);
      ctx.quadraticCurveTo(-72, 0, -92, 21);
      ctx.lineTo(-18, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.translate(ferry.x, ferry.y);
    ctx.rotate(ferry.heading);
    ctx.shadowColor = "rgba(0, 8, 12, 0.7)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 7;
    ctx.fillStyle = "#d27b36";
    ctx.beginPath();
    ctx.moveTo(29, 0);
    ctx.quadraticCurveTo(20, -12, 4, -13);
    ctx.lineTo(-22, -11);
    ctx.quadraticCurveTo(-30, -5, -30, 0);
    ctx.quadraticCurveTo(-30, 5, -22, 11);
    ctx.lineTo(4, 13);
    ctx.quadraticCurveTo(20, 12, 29, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = "#f3c880";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(29, 0);
    ctx.quadraticCurveTo(20, -12, 4, -13);
    ctx.lineTo(-22, -11);
    ctx.quadraticCurveTo(-30, -5, -30, 0);
    ctx.quadraticCurveTo(-30, 5, -22, 11);
    ctx.lineTo(4, 13);
    ctx.quadraticCurveTo(20, 12, 29, 0);
    ctx.stroke();

    ctx.fillStyle = "#17363c";
    ctx.strokeStyle = "rgba(158, 223, 217, 0.36)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-12, -9, 20, 18, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8cded5";
    ctx.fillRect(-8, -6, 7, 4);
    ctx.fillRect(1, -6, 4, 4);
    ctx.fillStyle = "rgba(255, 210, 135, 0.72)";
    ctx.fillRect(-8, 3, 13, 2);

    ctx.fillStyle = "#f1b55f";
    ctx.beginPath();
    ctx.arc(17, 0, 4.7, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 235, 173, 0.5)";
    ctx.beginPath();
    ctx.arc(17, 0, 9, 0, TAU);
    ctx.fill();

    if (state.ferry.cargoCrew > 0) {
      ctx.fillStyle = "#e4f3ec";
      for (let i = 0; i < state.ferry.cargoCrew; i += 1) {
        ctx.beginPath();
        ctx.arc(-18 + i * 5, -4, 2.1, 0, TAU);
        ctx.fill();
      }
    }

    if (Math.abs(throttle) > 0.06) {
      const engineGlow = ctx.createRadialGradient(-29, 0, 0, -29, 0, 13);
      engineGlow.addColorStop(0, throttle > 0 ? "rgba(255, 201, 111, 0.65)" : "rgba(115, 226, 255, 0.65)");
      engineGlow.addColorStop(1, "rgba(255, 201, 111, 0)");
      ctx.fillStyle = engineGlow;
      ctx.beginPath();
      ctx.arc(-29, 0, 13, 0, TAU);
      ctx.fill();
    }

    const steer =
      (this.game.input.right ? 1 : 0) - (this.game.input.left ? 1 : 0);
    ctx.fillStyle = "#ffd17d";
    ctx.fillRect(-28, -11 + steer * 2.2, 6, 3);
    ctx.fillRect(-28, 8 + steer * 2.2, 6, 3);

    if (state.resources.hull < 55) {
      ctx.strokeStyle = "rgba(89, 29, 24, 0.9)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(3, -11);
      ctx.lineTo(7, -2);
      ctx.lineTo(3, 5);
      ctx.stroke();
    }

    if (ferry.iceLoad > 0.8) {
      ctx.fillStyle = "rgba(195, 246, 241, 0.65)";
      for (let i = 0; i < Math.min(5, Math.ceil(ferry.iceLoad)); i += 1) {
        ctx.beginPath();
        ctx.arc(-6 + i * 7, i % 2 ? 10 : -10, 2.5 + (i % 2), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    if (this.game.overloaded) {
      ctx.save();
      ctx.translate(ferry.x, ferry.y - 31);
      const pulse = 0.65 + Math.sin(state.elapsed * 5) * 0.25;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = "#ff9b61";
      ctx.font = "bold 10px 'Noto Sans SC', Consolas, monospace";
      ctx.textAlign = "center";
      ctx.fillText("超载 · 机动下降", 0, 0);
      ctx.restore();
    }
  }

  drawParticles(ctx, realTime) {
    const active = this.game.state.status === "running" && !this.game.state.paused;
    const dt = this.lastRenderTime ? Math.min(0.05, (realTime - this.lastRenderTime) / 1000) : 0;
    this.lastRenderTime = realTime;
    ctx.save();
    this.particles = this.particles.filter((particle) => particle.life > 0);
    for (const particle of this.particles) {
      if (active) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.97;
        particle.vy *= 0.97;
        particle.life -= dt;
      }
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawSceneLabels(ctx) {
    const state = this.game.state;
    const ferry = state.ferry;
    ctx.save();
    ctx.textAlign = "center";
    if (ferry.atDock && state.status === "running") {
      const dockName = state.side === "east" ? "东岸" : "西岸";
      const phase = state.nextDock === "east" ? "下一目标：东岸抢修坞" : "下一目标：西岸维修坞";
      ctx.font = "bold 11px 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = "rgba(226, 252, 248, 0.9)";
      ctx.fillText(`${dockName}靠泊中 · ${phase}`, 600, 592);
      ctx.font = "9px 'Noto Sans SC', Consolas, monospace";
      ctx.fillStyle = "rgba(143, 196, 193, 0.72)";
      ctx.fillText("按 W 推进离泊  ·  C 系缆  ·  P 暂停", 600, 608);
    } else if (state.status === "failed") {
      ctx.font = "bold 12px 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
      ctx.fillStyle = "#ffad9e";
      ctx.fillText("航行中止 · 可从检查点恢复", 600, 592);
    }

    if (state.cable.attached) {
      const anchor = state.anchors.find((item) => item.id === state.cable.anchorId);
      if (anchor) {
        ctx.font = "8px 'Noto Sans SC', Consolas, monospace";
        ctx.fillStyle = state.cable.tension > 0.6 ? "#ffbd78" : "rgba(237, 219, 165, 0.8)";
        ctx.fillText(
          `缆长 ${Math.round(state.cable.length)} m · 张力 ${Math.round(state.cable.tension * 100)}%`,
          (ferry.x + anchor.x) / 2,
          (ferry.y + anchor.y) / 2 - 9,
        );
      }
    }
    ctx.restore();
  }
}
