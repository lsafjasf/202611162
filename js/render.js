// Canvas 渲染:海草、固定桩+浮标、船只与轨迹、浊度雾
function render(sim, ctx, W, H, timeMs) {
  ctx.clearRect(0, 0, W, H);
  const t = timeMs / 1000;

  // 光照水色:光照越高越亮
  const glow = Math.max(0, Math.min(1, sim.light / 90));
  ctx.fillStyle = `rgba(${20 + glow * 40}, ${90 + glow * 60}, ${120 + glow * 60}, 0.25)`;
  ctx.fillRect(0, 0, W, H);

  // 沙床
  const sandY = H * 0.82;
  ctx.fillStyle = '#8a7a52';
  ctx.beginPath();
  ctx.moveTo(0, sandY);
  for (let x = 0; x <= W; x += 20) {
    ctx.lineTo(x, sandY + Math.sin(x * 0.05 + t * 0.3) * 3);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();

  // 航线虚线
  const laneYs = [0.25, 0.5, 0.75].map(f => f * sandY);
  ctx.setLineDash([6, 8]);
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = i === sim.lanePolicy ? 'rgba(255,220,120,0.7)' : 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(0, laneYs[i]); ctx.lineTo(W, laneYs[i]); ctx.stroke();
  }
  ctx.setLineDash([]);

  // 海草斑块
  const cw = W / GRID_X, ch = (H - sandY + 40) / GRID_Y;
  for (let gy = 0; gy < GRID_Y; gy++) {
    for (let gx = 0; gx < GRID_X; gx++) {
      const d = sim.grid[gy * GRID_X + gx];
      if (d <= 0.02) continue;
      const bx = gx * cw + cw / 2, by = sandY + 6;
      const blades = Math.round(d * 9);
      const hMax = 14 + d * 46;
      for (let b = 0; b < blades; b++) {
        const off = (b - blades / 2) * 4;
        const sway = Math.sin(t * 1.2 + gx * 0.7 + b) * 4 * sim.flow;
        const h = hMax * (0.7 + 0.3 * Math.sin(b * 2.1 + gx));
        ctx.strokeStyle = `rgba(${40 + d * 30}, ${140 + d * 80}, ${60 + d * 40}, 0.9)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx + off, by);
        ctx.quadraticCurveTo(bx + off + sway, by - h * 0.6, bx + off + sway * 1.6, by - h);
        ctx.stroke();
      }
    }
  }

  // 目标个体标记(重点修复斑块)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  for (const tg of sim.sched.targets) {
    ctx.strokeRect(tg.gx * cw + 2, sandY - 50, cw - 4, 52);
  }

  // 固定桩 + 浮标
  for (const s of sim.stakes) {
    const x = s.gx * cw + cw / 2;
    ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, sandY + 4); ctx.lineTo(x, sandY - 34); ctx.stroke();
    const fy = sandY - 44 - Math.sin(t * 2 + s.gx) * 3;
    ctx.strokeStyle = 'rgba(200,200,200,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, sandY - 34); ctx.lineTo(x, fy); ctx.stroke();
    ctx.fillStyle = '#e05a4e';
    ctx.beginPath(); ctx.arc(x, fy - 6, 6, 0, Math.PI * 2); ctx.fill();
  }

  // 船只与轨迹
  for (const sh of sim.ships) {
    const y = laneYs[sh.effLane];
    const x = sh.x * W;
    // 轨迹(航迹线)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - sh.dir * 60, y);
    ctx.lineTo(x, y);
    ctx.stroke();
    // 船体
    ctx.fillStyle = sh.anchor ? '#d98a4a' : '#b8c4cc';
    ctx.beginPath();
    ctx.moveTo(x - 14 * sh.dir, y - 4);
    ctx.lineTo(x + 14 * sh.dir, y - 4);
    ctx.lineTo(x + 9 * sh.dir, y + 5);
    ctx.lineTo(x - 9 * sh.dir, y + 5);
    ctx.fill();
    if (sh.anchor) { // 锚链
      ctx.strokeStyle = '#888';
      ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x + 6, sandY); ctx.stroke();
    }
  }

  // 围网封育可视化
  if (sim.day < sim.enclosureUntil) {
    ctx.strokeStyle = 'rgba(94,196,111,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(6, sandY - 70, W - 12, 74);
    ctx.setLineDash([]);
  }

  // 浊度雾:越浊越黄越不透明
  const murk = Math.min(0.65, sim.turb / 45);
  ctx.fillStyle = `rgba(150, 130, 70, ${murk})`;
  ctx.fillRect(0, 0, W, H);

  // 结束遮罩
  if (sim.over) {
    ctx.fillStyle = 'rgba(0,20,30,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = sim.success ? '#7fe08a' : '#ef7d6f';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sim.success ? '修复成功 ✔' : '未达标 ✘', W / 2, H / 2 - 10);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#d8eef4';
    ctx.fillText(`覆盖率 ${(coverageOf(sim) * 100).toFixed(0)}% / 目标60% · 浊度 ${sim.turb.toFixed(1)} / 目标≤15`, W / 2, H / 2 + 22);
    ctx.textAlign = 'left';
  }
}
