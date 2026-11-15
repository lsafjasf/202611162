import { CONFIG as C } from './config.js';
import { towWeight } from './engine.js';

export function createRenderer(ctx, canvas) {
  return {
    draw(state, ui) {
      const cam = {
        x: state.boat.x - canvas.width * 0.32,
        y: state.boat.y - canvas.height / 2
      };
      drawWater(ctx, canvas, state, cam);
      drawBanks(ctx, canvas, state, cam);
      drawEddies(ctx, state, cam);
      drawCheckpoints(ctx, state, cam);
      drawDock(ctx, state, cam);
      drawPiers(ctx, state, cam);
      drawDebris(ctx, state, cam);
      drawTowLine(ctx, state, cam);
      drawBoat(ctx, state, cam);
      drawHud(ctx, canvas, state, ui);
      drawFeedback(ctx, canvas, state);
      if (state.status === 'paused') drawPause(ctx, canvas);
      if (state.status === 'won' || state.status === 'lost') {
        drawEndOverlay(ctx, canvas, state);
      }
    }
  };
}

function drawWater(ctx, w, state, cam) {
  ctx.fillStyle = '#2d6a8f';
  ctx.fillRect(0, 0, w.width, w.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1.5;
  const offset = (state.time * 28) % 46;
  for (const r of state.world.ripples) {
    const sx = r.x - cam.x;
    const sy = r.y - cam.y + C.river.halfWidth;
    if (sx < -40 || sx > w.width + 40) continue;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r.r + 2, r.r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = -offset; x < w.width; x += 46) {
    ctx.fillRect(x, 0, 2, w.height);
  }
}

function drawBanks(ctx, w, state, cam) {
  const top = -C.river.halfWidth - cam.y;
  const bottom = C.river.halfWidth - cam.y;
  ctx.fillStyle = '#6b5b3e';
  ctx.fillRect(0, 0, w.width, top);
  ctx.fillRect(0, bottom, w.width, w.height - bottom);
  ctx.fillStyle = '#8a7a52';
  ctx.fillRect(0, top - 8, w.width, 8);
  ctx.fillRect(0, bottom, w.width, 8);
}

function drawEddies(ctx, state, cam) {
  for (const e of state.world.eddies) {
    const sx = e.x - cam.x;
    const sy = e.y - cam.y + C.river.halfWidth;
    if (sx < -200 || sx > ctx.canvas.width + 200) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(state.time * C.eddy.spin);
    ctx.strokeStyle = 'rgba(220,240,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.25) {
        const rr = (C.eddy.radius * (a / (Math.PI * 2))) + i * 12;
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPiers(ctx, state, cam) {
  for (const p of state.world.piers) {
    const sx = p.x - cam.x;
    const sy = p.y - cam.y + C.river.halfWidth;
    ctx.fillStyle = '#5a5f66';
    ctx.beginPath();
    ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#33373c';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(sx - 7, sy - 7, p.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCheckpoints(ctx, state, cam) {
  state.world.checkpoints.forEach((cp, i) => {
    const sx = cp.x - cam.x;
    if (sx < -30 || sx > ctx.canvas.width + 30) return;
    const top = -C.river.halfWidth - cam.y;
    const bottom = C.river.halfWidth - cam.y;
    ctx.strokeStyle = cp.passed ? 'rgba(120,230,140,0.8)' : 'rgba(255,220,120,0.7)';
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, top);
    ctx.lineTo(sx, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cp.passed ? '#78e68c' : '#ffdc78';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(cp.passed ? `✓ CP${i + 1}` : `CP${i + 1}`, sx - 14, top + 18);
  });
}

function drawDock(ctx, state, cam) {
  const dock = state.world.dock;
  const sx = dock.x - cam.x;
  const sy = 0 - cam.y + C.river.halfWidth;
  ctx.fillStyle = 'rgba(120,200,160,0.18)';
  ctx.beginPath();
  ctx.arc(sx, sy, dock.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#78e6a0';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#4a6b55';
  ctx.fillRect(sx - 18, sy - 60, 36, 120);
  ctx.fillStyle = '#e8f5e9';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('回收点', sx, sy - 72);
  ctx.textAlign = 'left';
}

function drawDebris(ctx, state, cam) {
  for (const d of state.world.debris) {
    if (d.state === 'unloaded' || d.state === 'missed') continue;
    const ty = C.debrisTypes[d.type];
    const sx = d.x - cam.x;
    const sy = d.y - cam.y + C.river.halfWidth;
    if (sx < -40 || sx > ctx.canvas.width + 40) continue;
    ctx.save();
    ctx.translate(sx, sy);
    if (d.type === 'wood') {
      ctx.rotate(Math.sin(state.time + d.phase) * 0.2);
      ctx.fillStyle = ty.color;
      ctx.fillRect(-16, -5, 32, 10);
    } else if (d.type === 'reed') {
      ctx.strokeStyle = ty.color;
      ctx.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 6, 8);
        ctx.quadraticCurveTo(i * 6 + 3, 0, i * 6, -12);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = ty.color;
      ctx.beginPath();
      ctx.arc(0, 0, ty.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('☣', 0, 5);
      ctx.textAlign = 'left';
      // 危险物脉冲提示
      ctx.strokeStyle = `rgba(255,80,80,${0.5 + 0.4 * Math.sin(state.time * 6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, ty.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTowLine(ctx, state, cam) {
  const b = state.boat;
  const sx = b.x - cam.x;
  const sy = b.y - cam.y + C.river.halfWidth;
  if (state.towed.length === 0) return;
  const last = state.world.debris.find((d) => d.id === state.towed[state.towed.length - 1]);
  if (!last) return;
  const ex = last.x - cam.x;
  const ey = last.y - cam.y + C.river.halfWidth;
  const overload = state.tension >= 1;
  ctx.strokeStyle = overload ? '#ff5a5a' : '#d9c08a';
  ctx.lineWidth = overload ? 3.5 : 2.5;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBoat(ctx, state, cam) {
  const b = state.boat;
  const sx = b.x - cam.x;
  const sy = b.y - cam.y + C.river.halfWidth;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(b.angle);
  // 船体
  ctx.fillStyle = '#e8e4d8';
  ctx.beginPath();
  ctx.moveTo(28, 0);
  ctx.lineTo(14, -14);
  ctx.lineTo(-22, -12);
  ctx.lineTo(-22, 12);
  ctx.lineTo(14, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5b6b7a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#3d5a72';
  ctx.fillRect(-8, -8, 14, 16);
  // 抓斗（船头扇形范围）
  const flash = state.grabFlash > 0;
  ctx.strokeStyle = flash ? 'rgba(255,220,90,0.85)' : 'rgba(255,255,255,0.35)';
  ctx.fillStyle = flash ? 'rgba(255,220,90,0.20)' : 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, C.grab.reach, -C.grab.arc / 2, C.grab.arc / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(20, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 船头方向小箭头 + 船体名
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.fillText('清漂船', sx - 22, sy - 26);
}

function bar(ctx, x, y, w, h, ratio, color, label, valueText) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 4, y - 16, w + 8, h + 24);
  ctx.fillStyle = '#dfe7ee';
  ctx.font = '12px sans-serif';
  ctx.fillText(`${label} ${valueText}`, x, y - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
}

function drawHud(ctx, canvas, state, ui) {
  const b = state.boat;
  bar(ctx, 16, 34, 170, 12, b.fuel / C.boat.maxFuel, '#5bc0eb', '燃料', `${b.fuel.toFixed(0)}/${C.boat.maxFuel}`);
  bar(ctx, 16, 78, 170, 12, Math.max(0, b.hull) / C.boat.maxHull, b.hull < 30 ? '#e05555' : '#7bd389', '船体', `${Math.max(0, b.hull).toFixed(0)}/${C.boat.maxHull}`);
  const weight = towWeight(state);
  bar(ctx, 16, 122, 170, 12, weight / C.cable.capacity, state.tension >= 1 ? '#e05555' : '#f2c14e', '缆绳负重', `${weight}/${C.cable.capacity}`);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`分数 ${state.score}`, 16, 168);
  ctx.fillText(`时间 ${state.time.toFixed(1)}s`, 16, 188);
  ctx.fillText(`缆长 ${state.cableLength.toFixed(0)}`, 16, 208);
  ctx.fillText(`漏危 ${state.hazardMissed}/${C.missLimit}`, 16, 228);

  const q = C.quota;
  const col = state.collected;
  ctx.fillText(
    `配额 木${col.wood}/${q.wood} 苇${col.reed}/${q.reed} 桶${col.drum}/${q.drum}`,
    16,
    248
  );
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#cfe3f0';
  ctx.fillText(`seed ${state.seed} · 检查点恢复 ${state.recoverCount} 次`, 16, 268);

  // 输入状态灯：每次输入都有可见反馈
  const lamps = [
    ['↑ 油门', ui.input.up],
    ['↓ 倒车', ui.input.down],
    ['← 左', ui.input.left],
    ['→ 右', ui.input.right],
    ['G 抓斗', ui.pressedGrab],
    ['W 放缆', ui.input.cableUp],
    ['S 收缆', ui.input.cableDown]
  ];
  lamps.forEach(([text, on], i) => {
    const x = canvas.width - 150;
    const y = 30 + i * 26;
    ctx.fillStyle = on ? '#f2c14e' : 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(x, y - 4, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(text, x + 12, y);
  });

  if (state.events[0] && state.time - state.events[0].t < 2.2) {
    const ev = state.events[0];
    ctx.fillStyle = ev.kind === 'miss' || ev.kind === 'snap' || ev.kind === 'collision'
      ? 'rgba(224,85,85,0.9)'
      : 'rgba(30,60,80,0.85)';
    ctx.fillRect(canvas.width / 2 - 220, 24, 440, 30);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ev.reason, canvas.width / 2, 44);
    ctx.textAlign = 'left';
  }
}

function drawFeedback(ctx, canvas, state) {
  if (state.feedback.t <= 0) return;
  const alpha = Math.min(1, state.feedback.t / 0.28);
  ctx.fillStyle = `rgba(242,193,78,${alpha})`;
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.feedback.key, canvas.width / 2, canvas.height - 60);
  ctx.textAlign = 'left';
}

function drawPause(ctx, canvas) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('已暂停', canvas.width / 2, canvas.height / 2);
  ctx.font = '16px sans-serif';
  ctx.fillText('按 P 继续 · R 重开（不刷新页面）', canvas.width / 2, canvas.height / 2 + 36);
  ctx.textAlign = 'left';
}

function drawEndOverlay(ctx, canvas, state) {
  const won = state.status === 'won';
  ctx.fillStyle = 'rgba(6,18,28,0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const x0 = canvas.width / 2 - 250;
  const y0 = 60;
  ctx.fillStyle = won ? '#7bd389' : '#e05555';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(won ? '任务完成' : '任务失败', x0, y0 + 10);

  ctx.fillStyle = '#dfe7ee';
  ctx.font = '14px sans-serif';
  const col = state.collected;
  const q = C.quota;
  const lines = [
    `最终用时：${state.time.toFixed(2)} 秒`,
    `目标数量：木 ${col.wood}/${q.wood} · 苇 ${col.reed}/${q.reed} · 桶 ${col.drum}/${q.drum}（漏危 ${state.hazardMissed}/${C.missLimit}）`,
    `剩余资源：燃料 ${state.boat.fuel.toFixed(1)} · 船体 ${Math.max(0, state.boat.hull).toFixed(1)} · 分数 ${state.score}`,
    `检查点恢复 ${state.recoverCount} 次 · 缆绳断裂 ${state.snapCount} 次`
  ];
  if (!won) lines.unshift(`失败原因：${state.failReason}`);
  lines.forEach((line, i) => ctx.fillText(line, x0, y0 + 48 + i * 24));

  // 路径小地图
  const mapX = x0;
  const mapY = y0 + 170;
  const mapW = 500;
  const mapH = 130;
  ctx.strokeStyle = '#7fa3bd';
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX, mapY, mapW, mapH);
  const scaleX = mapW / C.river.length;
  const scaleY = mapH / (C.river.halfWidth * 2);
  ctx.strokeStyle = 'rgba(242,193,78,0.9)';
  ctx.beginPath();
  state.path.forEach((p, i) => {
    const px = mapX + p.x * scaleX;
    const py = mapY + (p.y + C.river.halfWidth) * scaleY;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  for (const cp of state.world.checkpoints) {
    ctx.fillStyle = cp.passed ? '#7bd389' : '#666';
    ctx.fillRect(mapX + cp.x * scaleX - 2, mapY, 4, mapH);
  }
  ctx.fillStyle = '#78e6a0';
  ctx.fillRect(mapX + state.world.dock.x * scaleX - 3, mapY, 6, mapH);
  ctx.fillStyle = '#dfe7ee';
  ctx.font = '12px sans-serif';
  ctx.fillText('航行路径（绿=回收点，竖线=检查点）', mapX, mapY + mapH + 18);
  ctx.fillText('R 重开同一 seed · N 新开一局验证布局 · 摘要已写入 localStorage', mapX, mapY + mapH + 38);
}
