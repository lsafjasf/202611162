const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;

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

function seeded(index, salt = 0) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class LineCanvasRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.lastFrame = performance.now();
    this.rotation = 0;
    this.flowOffset = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(230, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  start() {
    const loop = (time) => {
      const delta = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000));
      this.lastFrame = time;
      this.frame(time / 1000, delta);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(time, delta) {
    const state = this.engine.state;
    const moving = state === 'running';
    const speed = moving ? this.engine.telemetry.motorSpeed || this.engine.params.speed : 0;
    this.rotation += delta * (0.45 + speed / 26);
    this.flowOffset += delta * (6 + (this.engine.telemetry.effectiveLube || this.engine.params.lube) / 8);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(ctx, time);
    const layout = this.layout();
    this.drawLubrication(ctx, layout, time);
    this.drawWire(ctx, layout, time);
    this.drawPayoff(ctx, layout, time);
    layout.dies.forEach((die, index) => this.drawDie(ctx, layout, die, index, time));
    this.drawTakeup(ctx, layout, time);
    this.drawReadouts(ctx, layout, time);
    if (this.engine.isFailed) this.drawFaultFx(ctx, layout, time);
    if (state === 'recovering') this.drawRecoveryScan(ctx, layout, time);
  }

  layout() {
    const w = this.width;
    const h = this.height;
    const centerY = h * 0.57;
    const left = Math.max(45, w * 0.062);
    const right = w - Math.max(48, w * 0.062);
    const firstDie = w * 0.29;
    const secondDie = w * 0.47;
    const thirdDie = w * 0.65;
    return {
      w,
      h,
      centerY,
      payoff: { x: left, y: centerY },
      takeup: { x: right, y: centerY - 2 },
      dies: [
        { x: firstDie, y: centerY, index: 0 },
        { x: secondDie, y: centerY, index: 1 },
        { x: thirdDie, y: centerY, index: 2 },
      ],
    };
  }

  drawBackground(ctx, time) {
    const { width: w, height: h } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#091516');
    bg.addColorStop(0.58, '#071011');
    bg.addColorStop(1, '#050c0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.53, 0, w * 0.5, h * 0.53, w * 0.45);
    glow.addColorStop(0, 'rgba(54, 116, 101, 0.09)');
    glow.addColorStop(0.55, 'rgba(35, 82, 76, 0.035)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(114, 154, 144, 0.055)';
    ctx.lineWidth = 1;
    const horizon = h * 0.71;
    for (let i = 0; i < 7; i += 1) {
      const y = horizon + i * i * 2.4 + i * 7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let x = -w; x < w * 2; x += 48) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + (x - w / 2) * 0.34, horizon);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(133, 232, 193, 0.09)';
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.2);
    ctx.lineTo(w * 0.96, h * 0.2);
    ctx.stroke();
    for (let x = w * 0.04; x < w * 0.96; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, h * 0.2);
      ctx.lineTo(x, h * 0.19);
      ctx.stroke();
    }
    if (this.width >= 620) {
      ctx.fillStyle = 'rgba(133, 232, 193, 0.21)';
      ctx.font = '7px "Bahnschrift", monospace';
      ctx.fillText('UTILITY / LUBRICATION RAIL', w * 0.04, h * 0.165);
    }

    const pulse = (Math.sin(time * 1.2) + 1) / 2;
    ctx.fillStyle = `rgba(133, 232, 193, ${0.08 + pulse * 0.04})`;
    ctx.fillRect(0, h - 2, w, 1);
  }

  wireThickness(index) {
    const params = this.engine.params;
    const telemetry = this.engine.telemetry;
    const nominal = [2.35, params.dies[0], params.dies[1], telemetry.diameter || params.dies[2]];
    return clamp((nominal[index] / 2.35) * 25, 3, 26);
  }

  wirePoints(layout) {
    return [
      { x: layout.payoff.x + 34, y: layout.centerY },
      { x: layout.dies[0].x - 22, y: layout.centerY },
      { x: layout.dies[0].x + 23, y: layout.centerY },
      { x: layout.dies[1].x - 22, y: layout.centerY },
      { x: layout.dies[1].x + 23, y: layout.centerY },
      { x: layout.dies[2].x - 22, y: layout.centerY },
      { x: layout.dies[2].x + 23, y: layout.centerY },
      { x: layout.takeup.x - 37, y: layout.centerY },
    ];
  }

  drawWireSegment(ctx, a, b, thickness, index, time, alpha = 1) {
    const running = this.engine.state === 'running';
    const tension = this.engine.telemetry.tension || 95;
    const vibration = running ? Math.sin(time * 7 + index * 2) * Math.max(0, tension - 105) * 0.025 : 0;
    const y = (a.y + b.y) / 2 + vibration;
    const gradient = ctx.createLinearGradient(a.x, y - thickness / 2, a.x, y + thickness / 2);
    gradient.addColorStop(0, `rgba(164, 183, 177, ${0.72 * alpha})`);
    gradient.addColorStop(0.28, `rgba(229, 239, 232, ${0.9 * alpha})`);
    gradient.addColorStop(0.57, `rgba(102, 119, 114, ${0.86 * alpha})`);
    gradient.addColorStop(1, `rgba(41, 53, 50, ${0.9 * alpha})`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(a.x + (b.x - a.x) * 0.38, y - 1.5, a.x + (b.x - a.x) * 0.72, y + 1.5, b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = `rgba(235, 250, 244, ${0.34 * alpha})`;
    ctx.lineWidth = Math.max(0.7, thickness * 0.12);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - thickness * 0.22);
    ctx.lineTo(b.x, b.y - thickness * 0.22);
    ctx.stroke();

    if (running) {
      const speed = this.engine.telemetry.motorSpeed || 48;
      const offset = (time * speed * 2.2 + index * 30) % 46;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = Math.max(0.8, thickness * 0.22);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * alpha})`;
      ctx.setLineDash([4, 42]);
      ctx.lineDashOffset = -offset;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawWire(ctx, layout, time) {
    const points = this.wirePoints(layout);
    const failed = this.engine.isFailed;
    const breakSegment = this.engine.lastFailure?.code === 'heat' || this.engine.lastFailure?.code === 'diameter' ? 6 : 6;
    let drawUntil = points.length - 1;
    let resumeAt = points.length;
    if (failed) {
      drawUntil = breakSegment;
      resumeAt = breakSegment + 1;
    }
    const thickness = [
      this.wireThickness(0),
      this.wireThickness(1),
      this.wireThickness(1),
      this.wireThickness(2),
      this.wireThickness(2),
      this.wireThickness(3),
      this.wireThickness(3),
      this.wireThickness(3),
    ];
    for (let i = 0; i < drawUntil; i += 1) {
      this.drawWireSegment(ctx, points[i], points[i + 1], thickness[i], i, time);
    }
    if (failed && resumeAt < points.length) {
      const a = points[resumeAt];
      const b = points[resumeAt + 1];
      if (b) this.drawWireSegment(ctx, { x: a.x + 9, y: a.y }, b, thickness[resumeAt], resumeAt, time, 0.5);
    }
  }

  drawPayoff(ctx, layout, time) {
    const { x, y } = layout.payoff;
    const compact = this.width < 620;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(8, 14, 15, 0.88)';
    roundedRect(ctx, -35, 33, 70, 20, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(132, 155, 148, 0.18)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(136, 159, 152, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 32);
    ctx.lineTo(-26, 52);
    ctx.moveTo(18, 32);
    ctx.lineTo(26, 52);
    ctx.stroke();

    const isIdle = this.engine.state === 'idle' || this.engine.state === 'complete';
    ctx.rotate(this.rotation * (isIdle ? 0.1 : 1));
    const wheel = ctx.createRadialGradient(-10, -12, 3, 0, 0, 34);
    wheel.addColorStop(0, '#85958f');
    wheel.addColorStop(0.5, '#485752');
    wheel.addColorStop(1, '#202c29');
    ctx.strokeStyle = wheel;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 29, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(195, 210, 202, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 6; i += 1) {
      const angle = i / 6 * TAU;
      ctx.strokeStyle = 'rgba(153, 171, 164, 0.23)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
      ctx.lineTo(Math.cos(angle) * 26, Math.sin(angle) * 26);
      ctx.stroke();
    }
    ctx.fillStyle = '#66766f';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (!compact) {
      ctx.fillStyle = 'rgba(139, 163, 155, 0.5)';
      ctx.font = '7px "Bahnschrift", monospace';
      ctx.fillText('PAY-OFF / 2.35 mm', x - 42, y + 75);
    }
  }

  drawDie(ctx, layout, die, index, time) {
    const params = this.engine.params;
    const temp = this.engine.telemetry.dieTemps[index] || 24;
    const running = this.engine.state === 'running';
    const hot = clamp((temp - 55) / 45, 0, 1);
    const compact = this.width < 620;
    const failedHere = this.engine.isFailed && (
      (this.engine.lastFailure?.code === 'heat' && index === 2)
      || (this.engine.lastFailure?.code === 'diameter' && index === 2)
    );

    ctx.save();
    if (hot > 0.02) {
      const heat = ctx.createRadialGradient(die.x, die.y, 4, die.x, die.y, 72 + hot * 28);
      heat.addColorStop(0, failedHere ? 'rgba(255, 85, 66, 0.34)' : `rgba(241, 151, 64, ${0.08 + hot * 0.2})`);
      heat.addColorStop(0.46, failedHere ? 'rgba(255, 70, 55, 0.14)' : `rgba(220, 102, 48, ${hot * 0.08})`);
      heat.addColorStop(1, 'rgba(220, 93, 40, 0)');
      ctx.fillStyle = heat;
      ctx.fillRect(die.x - 115, die.y - 115, 230, 230);
    }

    const baseY = die.y + 38;
    ctx.fillStyle = '#101a1b';
    roundedRect(ctx, die.x - 28, die.y - 32, 56, 77, 6);
    ctx.fill();
    ctx.strokeStyle = failedHere ? 'rgba(255, 102, 93, 0.72)' : 'rgba(136, 163, 155, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const metal = ctx.createLinearGradient(die.x - 23, 0, die.x + 23, 0);
    metal.addColorStop(0, '#34413e');
    metal.addColorStop(0.23, '#788781');
    metal.addColorStop(0.47, '#a7b4ae');
    metal.addColorStop(0.55, '#5a6964');
    metal.addColorStop(1, '#28332f');
    ctx.fillStyle = metal;
    roundedRect(ctx, die.x - 21, die.y - 20, 42, 42, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(231, 242, 236, 0.22)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(8, 13, 14, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(die.x, die.y, 12, 0, TAU);
    ctx.stroke();
    const aperture = ctx.createRadialGradient(die.x - 2, die.y - 3, 0, die.x, die.y, 9);
    aperture.addColorStop(0, '#020606');
    aperture.addColorStop(0.45, '#070d0d');
    aperture.addColorStop(0.8, failedHere ? '#a52a22' : '#40534d');
    aperture.addColorStop(1, '#aab8b2');
    ctx.fillStyle = aperture;
    ctx.beginPath();
    ctx.arc(die.x, die.y, 9, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = failedHere ? 'rgba(255, 102, 93, 0.86)' : `rgba(255, 176, 86, ${0.18 + hot * 0.65})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i += 1) {
      ctx.beginPath();
      ctx.arc(die.x, die.y, 17 + i * 4 + ((time * (running ? 6 : 1.2)) % 4), 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = '#1b2926';
    roundedRect(ctx, die.x - 3, baseY + 6, 6, 24, 2);
    ctx.fill();
    ctx.fillStyle = '#0b1313';
    roundedRect(ctx, die.x - 29, baseY + 27, 58, 7, 2);
    ctx.fill();

    ctx.fillStyle = temp > 90 ? '#ff8e79' : temp > 75 ? '#f1b35c' : 'rgba(150, 177, 168, 0.75)';
    ctx.font = `${compact ? 7 : 8}px "Bahnschrift", monospace`;
    ctx.fillText(`D${index + 1}`, die.x - 23, die.y - 45);
    ctx.textAlign = 'right';
    ctx.fillText(`${temp.toFixed(1)}°`, die.x + 25, die.y - (compact ? 49 : 58));
    ctx.textAlign = 'center';
    if (!compact) {
      ctx.fillStyle = 'rgba(214, 226, 220, 0.65)';
      ctx.font = '7px "Bahnschrift", monospace';
      ctx.fillText(params.dies[index].toFixed(3), die.x, baseY + 48);
      ctx.fillStyle = 'rgba(118, 142, 134, 0.55)';
      ctx.font = '6px "Bahnschrift", monospace';
      ctx.fillText(`PASS ${index + 1}`, die.x, baseY + 58);
    }
    ctx.restore();
  }

  drawLubrication(ctx, layout, time) {
    const running = this.engine.state === 'running' || this.engine.state === 'recovering';
    const lube = this.engine.telemetry.effectiveLube || this.engine.params.lube;
    const pumpFault = this.engine.equipment.lubePump.status === 'fault';
    const railY = layout.height * 0.2;
    const color = pumpFault ? 'rgba(255, 102, 93, 0.5)' : 'rgba(103, 220, 224, 0.48)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(layout.dies[0].x, railY);
    ctx.lineTo(layout.dies[2].x, railY);
    ctx.stroke();
    for (const die of layout.dies) {
      ctx.beginPath();
      ctx.moveTo(die.x, railY);
      ctx.lineTo(die.x, die.y - 47);
      ctx.stroke();
      ctx.fillStyle = pumpFault ? '#6f2d28' : '#324d4c';
      roundedRect(ctx, die.x - 5, die.y - 50, 10, 6, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(103, 220, 224, 0.5)';
      ctx.beginPath();
      ctx.arc(die.x, die.y - 43, 4.5, 0.2, Math.PI - 0.2);
      ctx.stroke();
      if (running) {
        for (let i = 0; i < 3; i += 1) {
          const seed = seeded(i + die.index * 4, 2.4);
          const fall = (this.flowOffset * (0.45 + lube / 120) + i * 10 + seed * 9) % 25;
          const dropY = die.y - 39 + fall;
          const opacity = (1 - fall / 25) * clamp(lube / 90, 0.15, 1);
          ctx.fillStyle = pumpFault ? `rgba(255, 124, 104, ${opacity * 0.65})` : `rgba(103, 197, 220, ${opacity * 0.7})`;
          ctx.beginPath();
          ctx.ellipse(die.x + (seed - 0.5) * 7, dropY, 1.2, 2.2, 0, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = pumpFault ? 'rgba(255, 102, 93, 0.78)' : 'rgba(103, 220, 224, 0.5)';
    ctx.font = '6px "Bahnschrift", monospace';
    ctx.fillText(pumpFault ? 'LUBE PRESSURE LOW' : 'LUBE FLOW', layout.dies[0].x - 38, railY - 7);
    ctx.restore();
  }

  drawTakeup(ctx, layout, time) {
    const { x, y } = layout.takeup;
    const running = this.engine.state === 'running';
    const progress = this.engine.telemetry.progress || 0;
    const failed = this.engine.isFailed;
    const compact = this.width < 620;
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = '#0c1516';
    roundedRect(ctx, -41, 41, 82, 15, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(136, 163, 155, 0.2)';
    ctx.stroke();
    ctx.strokeStyle = 'rgba(136, 159, 152, 0.38)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-19, 42);
    ctx.lineTo(-26, 57);
    ctx.moveTo(19, 42);
    ctx.lineTo(26, 57);
    ctx.stroke();

    ctx.rotate(this.rotation * (running ? 1 : 0.04));
    const reelGlow = failed ? 'rgba(255, 102, 93, 0.2)' : 'rgba(133, 232, 193, 0.1)';
    const wheel = ctx.createRadialGradient(-10, -12, 3, 0, 0, 37);
    wheel.addColorStop(0, '#8d9e97');
    wheel.addColorStop(0.38, '#41504b');
    wheel.addColorStop(1, '#17211f');
    ctx.strokeStyle = wheel;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = reelGlow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const angle = i / 8 * TAU;
      ctx.strokeStyle = 'rgba(163, 180, 173, 0.28)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
      ctx.lineTo(Math.cos(angle) * 28, Math.sin(angle) * 28);
      ctx.stroke();
    }
    ctx.fillStyle = '#697a74';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, TAU);
    ctx.fill();

    if (progress > 0.01) {
      ctx.strokeStyle = failed ? 'rgba(181, 94, 82, 0.8)' : 'rgba(200, 221, 211, 0.75)';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath();
        ctx.arc(0, 0, 20 + i * 2.1, -Math.PI / 2, -Math.PI / 2 + progress * TAU);
        ctx.stroke();
      }
    }
    ctx.restore();

    if (!compact) {
      const rpm = this.engine.telemetry.motorRpm || 0;
      ctx.fillStyle = failed ? 'rgba(255, 132, 116, 0.75)' : 'rgba(133, 232, 193, 0.55)';
      ctx.font = '7px "Bahnschrift", monospace';
      ctx.textAlign = 'right';
      ctx.fillText('TAKE-UP', x + 44, y + 75);
      ctx.textAlign = 'left';
      ctx.fillText(`${rpm} rpm`, x - 42, y + 83);
      ctx.textAlign = 'left';
    }
  }

  drawReadouts(ctx, layout, time) {
    const telemetry = this.engine.telemetry;
    const state = this.engine.state;
    const active = state === 'running' || state === 'recovering';
    const pulse = (Math.sin(time * 3) + 1) / 2;
    const compact = this.width < 620;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = active ? 'rgba(133, 232, 193, 0.7)' : 'rgba(120, 142, 135, 0.48)';
    ctx.font = '7px "Bahnschrift", monospace';
    ctx.fillText(active ? 'DRAWING ACTIVE' : state === 'failed' ? 'LINE INTERLOCK' : 'LINE STANDBY', 16, layout.h - 17);
    ctx.fillStyle = active ? `rgba(133, 232, 193, ${0.35 + pulse * 0.5})` : 'rgba(120, 142, 135, 0.3)';
    ctx.beginPath();
    ctx.arc(10, layout.h - 19, 2.5, 0, TAU);
    ctx.fill();
    if (compact) {
      ctx.restore();
      return;
    }

    const gaugeX = compact ? layout.w * 0.64 : layout.w * 0.72;
    const gaugeY = layout.h * 0.19;
    ctx.fillStyle = 'rgba(10, 20, 20, 0.72)';
    roundedRect(ctx, gaugeX, gaugeY, compact ? 120 : 148, 42, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(133, 232, 193, 0.12)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(127, 151, 143, 0.55)';
    ctx.font = '6px "Bahnschrift", monospace';
    ctx.fillText(compact ? 'FINAL GAUGE' : 'FINAL GAUGE / TARGET', gaugeX + 9, gaugeY + 12);
    const measured = telemetry.diameter || 0;
    const inTolerance = Math.abs(measured - 0.8) <= 0.012;
    ctx.fillStyle = measured && inTolerance ? '#c9f7e4' : measured ? '#ff9c88' : '#7f918b';
    ctx.font = '16px "Bahnschrift", monospace';
    ctx.fillText(measured ? measured.toFixed(3) : '---', gaugeX + 9, gaugeY + 31);
    ctx.fillStyle = 'rgba(127, 151, 143, 0.55)';
    ctx.font = '7px "Bahnschrift", monospace';
    ctx.fillText('mm', gaugeX + 55, gaugeY + 31);
    ctx.fillStyle = inTolerance ? 'rgba(133, 232, 193, 0.5)' : 'rgba(255, 144, 122, 0.65)';
    if (!compact) {
      ctx.fillText(inTolerance ? 'WITHIN WINDOW' : measured ? 'OUT OF RANGE' : 'WAITING', gaugeX + 75, gaugeY + 31);
    }

    if (state === 'running') {
      const progress = this.engine.batch?.currentAttempt?.progress || 0;
      const barX = layout.w * 0.33;
      const barY = layout.h - 21;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      roundedRect(ctx, barX, barY, 175, 3, 2);
      ctx.fill();
      const bar = ctx.createLinearGradient(barX, 0, barX + 175, 0);
      bar.addColorStop(0, 'rgba(133, 232, 193, 0.4)');
      bar.addColorStop(1, 'rgba(133, 232, 193, 0.9)');
      ctx.fillStyle = bar;
      roundedRect(ctx, barX, barY, 175 * progress, 3, 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(131, 158, 149, 0.56)';
      ctx.font = '6px "Bahnschrift", monospace';
      ctx.fillText(`COIL TRAVEL ${Math.round(progress * 100)}%`, barX, barY - 6);
    }
    ctx.restore();
  }

  drawFaultFx(ctx, layout, time) {
    const failure = this.engine.lastFailure;
    const center = failure?.code === 'motorCurrent' || failure?.code === 'tension'
      ? { x: layout.takeup.x - 30, y: layout.centerY }
      : { x: layout.dies[2].x + 35, y: layout.centerY };
    const pulse = (Math.sin(time * 8) + 1) / 2;
    ctx.save();
    const glow = ctx.createRadialGradient(center.x, center.y, 2, center.x, center.y, 66 + pulse * 18);
    glow.addColorStop(0, 'rgba(255, 116, 96, 0.46)');
    glow.addColorStop(0.3, 'rgba(255, 86, 70, 0.13)');
    glow.addColorStop(1, 'rgba(255, 70, 55, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(center.x - 100, center.y - 100, 200, 200);

    for (let i = 0; i < 18; i += 1) {
      const seed = seeded(i, 7.2);
      const progress = (time * (0.6 + seed * 1.3) + seed * 5) % 1;
      const angle = -Math.PI * 0.84 + seed * Math.PI * 0.68;
      const distance = 8 + progress * (28 + seed * 35);
      const x = center.x + Math.cos(angle) * distance;
      const y = center.y + Math.sin(angle) * distance + progress * progress * 28;
      ctx.fillStyle = `rgba(255, ${120 + Math.floor(seed * 80)}, 70, ${1 - progress})`;
      ctx.fillRect(x, y, 1.2, 1.2 + seed * 2);
    }
    ctx.strokeStyle = `rgba(255, 102, 93, ${0.45 + pulse * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 37 + pulse * 6, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawRecoveryScan(ctx, layout, time) {
    const scanX = ((time * 0.24) % 1) * layout.w;
    ctx.save();
    const sweep = ctx.createLinearGradient(scanX - 55, 0, scanX + 12, 0);
    sweep.addColorStop(0, 'rgba(103, 220, 224, 0)');
    sweep.addColorStop(0.75, 'rgba(103, 220, 224, 0.055)');
    sweep.addColorStop(1, 'rgba(103, 220, 224, 0.18)');
    ctx.fillStyle = sweep;
    ctx.fillRect(scanX - 55, 0, 67, layout.h);
    ctx.strokeStyle = 'rgba(103, 220, 224, 0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scanX, 0);
    ctx.lineTo(scanX, layout.h);
    ctx.stroke();
    ctx.fillStyle = 'rgba(103, 220, 224, 0.7)';
    ctx.font = '7px "Bahnschrift", monospace';
    ctx.fillText('SELF-CHECK', scanX + 4, 28);
    ctx.restore();
  }
}

