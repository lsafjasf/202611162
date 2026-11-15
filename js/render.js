// ===== Canvas 渲染: 温度色带 / 热风 / 冷却风 / 裂纹 =====
const Render = {
  canvas: null, ctx: null, t: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  },

  // 温度 -> 颜色 (蓝->红->白)
  tempColor(temp) {
    const c = Math.max(0, Math.min(1, (temp - 25) / 675));
    const r = Math.round(255 * Math.min(1, c * 2.2));
    const g = Math.round(200 * Math.max(0, c - 0.25) * 1.6);
    const b = Math.round(120 * Math.max(0, 0.5 - c) * 2);
    return `rgb(${r},${g},${b})`;
  },

  draw(sim, dt) {
    this.t += dt;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const margin = 40, lineW = W - margin * 2;
    const zoneW = lineW / 3;
    const beltY = 150, beltH = 46;
    const x2px = (x) => margin + (x / LINE_LEN) * lineW;

    // 三个退火区背景(按当前区温着色)
    const zoneNames = ["预热区", "退火保温区", "冷却区"];
    for (let z = 0; z < 3; z++) {
      ctx.fillStyle = this.tempColor(sim.zoneTemp[z]);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(margin + z * zoneW, 40, zoneW, 220);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#3d4f73";
      ctx.strokeRect(margin + z * zoneW, 40, zoneW, 220);
      ctx.fillStyle = "#9fb6d8";
      ctx.font = "13px sans-serif";
      ctx.fillText(`${zoneNames[z]} ${sim.zoneTemp[z].toFixed(0)}°C`, margin + z * zoneW + 8, 58);
    }

    // 热风(区1/2): 向下红色箭头动画; 冷却风(区3): 向上蓝色箭头
    const heaterOn = sim.devices.heater.on && !sim.devices.heater.fault;
    const fanOn = sim.devices.fan.on && !sim.devices.fan.fault;
    if (heaterOn) this.drawAir(ctx, margin, zoneW, 2, beltY, "#ff7a45", 1, sim.params.temp);
    if (fanOn) this.drawAir(ctx, margin + zoneW * 2, zoneW, 1, beltY + beltH, "#5ab0ff", -1, sim.params.flow);

    // 传送带
    ctx.fillStyle = "#232b3d";
    ctx.fillRect(margin, beltY + beltH, lineW, 8);
    const convOn = sim.devices.conveyor.on && !sim.devices.conveyor.fault;
    if (convOn) {  // 滚轮动画
      ctx.fillStyle = "#4a5b7d";
      for (let i = 0; i < 24; i++) {
        const rx = margin + ((i * 40 + this.t * sim.params.speed * 20) % lineW);
        ctx.beginPath(); ctx.arc(rx, beltY + beltH + 4, 3, 0, 7); ctx.fill();
      }
    }

    // 玻璃板: 表面/芯部温度色带
    for (const s of sim.sheets) {
      const sx = x2px(s.x), sw = 54;
      const grad = ctx.createLinearGradient(0, beltY, 0, beltY + beltH);
      grad.addColorStop(0, this.tempColor(s.tSurf));
      grad.addColorStop(1, this.tempColor(s.tCore));
      ctx.fillStyle = grad;
      ctx.fillRect(sx - sw, beltY, sw, beltH);
      ctx.strokeStyle = s.cracked ? "#ef6461" : "#8fa3c0";
      ctx.strokeRect(sx - sw, beltY, sw, beltH);
      if (s.cracked) this.drawCrack(ctx, sx - sw, beltY, sw, beltH);
      // 应力指示条
      ctx.fillStyle = s.stress > 0.8 ? "#ef6461" : s.stress > 0.5 ? "#f0c541" : "#6fdc8c";
      ctx.fillRect(sx - sw, beltY - 8, sw * Math.min(1, s.stress), 4);
      ctx.fillStyle = "#dde3ec";
      ctx.font = "10px sans-serif";
      ctx.fillText(`${s.thick}mm`, sx - sw + 2, beltY + beltH - 4);
    }

    // 底部信息
    ctx.fillStyle = "#9fb6d8";
    ctx.font = "13px sans-serif";
    ctx.fillText(`良品 ${sim.good}/${GOOD_TARGET}   废品 ${sim.bad}/${BAD_LIMIT}   来料厚度 ${sim.thickness}mm`, margin, 290);
  },

  drawAir(ctx, x0, zoneW, zones, y, color, dir, strength) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4 + 0.4 * Math.min(1, strength / 100);
    const n = Math.max(3, Math.round(strength / 12));
    for (let i = 0; i < n * zones; i++) {
      const ax = x0 + 20 + ((i * 53) % (zoneW * zones - 40));
      const phase = (this.t * 60 + i * 30) % 60;
      const ay = dir > 0 ? y - 70 + phase : y + 70 - phase;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax, ay + dir * 14);
      ctx.lineTo(ax - 4, ay + dir * 9);
      ctx.moveTo(ax, ay + dir * 14);
      ctx.lineTo(ax + 4, ay + dir * 9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  drawCrack(ctx, x, y, w, h) {
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    let cx = x + w * 0.3, cy = y;
    ctx.moveTo(cx, cy);
    while (cy < y + h) {
      cx += (Math.random() - 0.4) * 14;
      cy += 8 + Math.random() * 8;
      ctx.lineTo(cx, Math.min(cy, y + h));
    }
    ctx.moveTo(x + w * 0.6, y + h * 0.3);
    ctx.lineTo(x + w * 0.45, y + h * 0.55);
    ctx.lineTo(x + w * 0.7, y + h * 0.8);
    ctx.stroke();
  },
};
