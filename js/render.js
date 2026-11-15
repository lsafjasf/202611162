/* Canvas 渲染：雪坡、车辙、风线、营房、卡车与小地图 */
(function (global) {
  const { C } = (typeof require !== 'undefined' ? require('./state.js') : globalThis.SnowState);

  function camera(canvas, state, world) {
    const x = Math.max(0, Math.min(world.width - canvas.width, state.x - canvas.width / 2));
    const y = Math.max(0, Math.min(world.height - canvas.height, state.y - canvas.height * 0.58));
    return { x, y };
  }

  function drawGround(ctx, canvas, cam, world) {
    ctx.fillStyle = '#dfe9f2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let z = 0; z < world.zones.length; z++) {
      const zone = world.zones[z];
      const sy = zone.y0 - cam.y;
      const ey = zone.y1 - cam.y;
      if (ey < 0 || sy > canvas.height) continue;
      const tint = z === 0 ? '#e3ecf5' : z === 1 ? '#d8e4ef' : '#e8eef4';
      ctx.fillStyle = tint;
      ctx.fillRect(0, sy, canvas.width, ey - sy);
      ctx.strokeStyle = 'rgba(120,150,180,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ey);
      ctx.lineTo(canvas.width, ey);
      ctx.stroke();
      ctx.fillStyle = 'rgba(70,100,130,0.55)';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`第${z + 1}开阔地 · 积雪${Math.round(zone.snowDepth * 100)}% · ${zone.wind.name}`, 14, sy + 26);
      drawSnowBands(ctx, canvas, cam, zone);
    }
  }

  function drawSnowBands(ctx, canvas, cam, zone) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const yy = zone.y0 + 180 + i * 290 - cam.y;
      if (yy < -20 || yy > canvas.height + 20) continue;
      ctx.beginPath();
      ctx.moveTo(30, yy);
      for (let x = 30; x <= canvas.width - 30; x += 80) {
        ctx.quadraticCurveTo(x + 40, yy + Math.sin(i + x * 0.01) * 14, x + 80, yy);
      }
      ctx.stroke();
    }
  }

  function drawPatches(ctx, cam, world) {
    for (const p of world.deepPatches) {
      const x = p.x - cam.x;
      const y = p.y - cam.y;
      ctx.fillStyle = 'rgba(150,175,200,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,140,170,0.4)';
      ctx.setLineDash([8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of world.icePatches) {
      const ix = p.x - cam.x;
      const iy = p.y - cam.y;
      ctx.fillStyle = 'rgba(170,215,235,0.65)';
      ctx.beginPath();
      ctx.arc(ix, iy, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,180,215,0.7)';
      ctx.stroke();
    }
  }

  function drawRuts(ctx, cam, state) {
    ctx.strokeStyle = 'rgba(90,110,130,0.28)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const rut of state.ruts) {
      const lx = rut.x - cam.x;
      const ly = rut.y - cam.y;
      const px = Math.cos(rut.heading + Math.PI / 2) * 9;
      const py = Math.sin(rut.heading + Math.PI / 2) * 9;
      ctx.beginPath();
      ctx.moveTo(lx - px, ly - py);
      ctx.lineTo(lx + px, ly + py);
      ctx.stroke();
    }
  }

  function drawWindLines(ctx, canvas, cam, particles, world) {
    ctx.strokeStyle = 'rgba(120,160,200,0.45)';
    ctx.lineWidth = 1.5;
    for (const p of particles) {
      const sx = p.x - cam.x;
      const sy = p.y - cam.y;
      if (sx < -40 || sx > canvas.width + 40 || sy < -40 || sy > canvas.height + 40) continue;
      const w = world.zones[p.zone].wind;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - w.x * p.len, sy - w.y * p.len);
      ctx.stroke();
    }
  }

  function drawObstacles(ctx, cam, world) {
    for (const o of world.obstacles) {
      const x = o.x - cam.x;
      const y = o.y - cam.y;
      if (o.type === 'tree') {
        ctx.fillStyle = '#5b7d57';
        ctx.beginPath();
        ctx.arc(x, y, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a6847';
        ctx.beginPath();
        ctx.arc(x - 6, y - 6, o.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.type === 'rock') {
        ctx.fillStyle = '#7d8794';
        ctx.beginPath();
        ctx.ellipse(x, y, o.r, o.r * 0.8, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5f6873';
        ctx.stroke();
      } else if (o.type === 'drift') {
        ctx.fillStyle = 'rgba(200,215,230,0.9)';
        ctx.beginPath();
        ctx.ellipse(x, y, o.r, o.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,170,195,0.6)';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#b9d6e8';
        ctx.fillRect(x - o.r * 0.7, y - o.r * 0.7, o.r * 1.4, o.r * 1.4);
        ctx.strokeStyle = '#7fa8c4';
        ctx.strokeRect(x - o.r * 0.7, y - o.r * 0.7, o.r * 1.4, o.r * 1.4);
      }
    }
  }

  function drawMails(ctx, cam, state) {
    for (const m of state.mails) {
      if (m.collected) continue;
      const x = m.x - cam.x;
      const y = m.y - cam.y;
      ctx.fillStyle = '#b5651d';
      ctx.fillRect(x - 11, y - 9, 22, 18);
      ctx.strokeStyle = '#7a4312';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 11, y - 9, 22, 18);
      ctx.beginPath();
      ctx.moveTo(x - 11, y - 3);
      ctx.lineTo(x + 11, y - 3);
      ctx.stroke();
    }
  }

  function drawCheckpoints(ctx, cam, state, time) {
    for (const cp of state.checkpoints) {
      const x = cp.x - cam.x;
      const y = cp.y - cam.y;
      ctx.strokeStyle = cp.reached ? 'rgba(60,170,90,0.8)' : 'rgba(220,160,40,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 26 + (cp.reached ? 0 : Math.sin(time * 4) * 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = cp.reached ? '#3caa5a' : '#dca028';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cp.reached ? '✓ 检查点' : '检查点', x, y + 5);
      ctx.textAlign = 'left';
    }
  }

  function drawCamp(ctx, cam, world, time) {
    const camp = world.camp;
    for (const hut of camp.huts) {
      const x = camp.x + hut.dx - cam.x;
      const y = camp.y + hut.dy - cam.y;
      ctx.fillStyle = '#8a5a3b';
      ctx.fillRect(x - hut.w / 2, y - hut.h / 2, hut.w, hut.h);
      ctx.fillStyle = '#5f3d28';
      ctx.beginPath();
      ctx.moveTo(x - hut.w / 2 - 6, y - hut.h / 2);
      ctx.lineTo(x, y - hut.h / 2 - 14);
      ctx.lineTo(x + hut.w / 2 + 6, y - hut.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f2d98c';
      ctx.fillRect(x - 6, y - 4, 12, 12);
    }
    ctx.strokeStyle = `rgba(220,60,60,${0.4 + Math.sin(time * 3) * 0.25})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(camp.x - cam.x, camp.y - cam.y, camp.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#a33';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('孤立营地（终点）', camp.x - cam.x, camp.y - camp.r - 12);
    ctx.textAlign = 'left';
  }

  function drawTruck(ctx, cam, state, flash) {
    const x = state.x - cam.x;
    const y = state.y - cam.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.heading + Math.PI / 2);
    if (flash > 0) {
      ctx.shadowColor = '#ff5b4d';
      ctx.shadowBlur = 22 * flash;
    }
    ctx.fillStyle = state.chains ? '#2f6fb5' : '#c1442f';
    ctx.fillRect(-C.TRUCK_W / 2, -C.TRUCK_L / 2, C.TRUCK_W, C.TRUCK_L);
    ctx.fillStyle = '#9fc6e8';
    ctx.fillRect(-C.TRUCK_W / 2 + 4, -C.TRUCK_L / 2 + 5, C.TRUCK_W - 8, 12);
    ctx.fillStyle = '#4a3326';
    ctx.fillRect(-C.TRUCK_W / 2 + 3, C.TRUCK_L / 2 - 14, C.TRUCK_W - 6, 9);
    if (state.chains) {
      ctx.strokeStyle = '#e8eef5';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(-C.TRUCK_W / 2 - 3, -C.TRUCK_L / 2 - 3, C.TRUCK_W + 6, C.TRUCK_L + 6);
      ctx.setLineDash([]);
    }
    if (state.brake) {
      ctx.fillStyle = '#ff4a3d';
      ctx.fillRect(-C.TRUCK_W / 2 + 2, C.TRUCK_L / 2 - 2, 5, 4);
      ctx.fillRect(C.TRUCK_W / 2 - 7, C.TRUCK_L / 2 - 2, 5, 4);
    }
    ctx.restore();
  }

  function drawMinimap(ctx, canvas, world, state) {
    const mw = 128;
    const mh = 220;
    const mx = canvas.width - mw - 14;
    const my = 14;
    ctx.fillStyle = 'rgba(20,35,50,0.62)';
    ctx.fillRect(mx, my, mw, mh);
    const sx = mw / world.width;
    const sy = mh / world.height;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (let z = 1; z < C.ZONES; z++) {
      ctx.moveTo(mx, my + z * C.ZONE_H * sy);
      ctx.lineTo(mx + mw, my + z * C.ZONE_H * sy);
    }
    ctx.stroke();
    ctx.strokeStyle = '#7fd0ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of state.path) {
      const px = mx + p.x * sx;
      const py = my + p.y * sy;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.fillStyle = '#d8a23a';
    for (const cp of state.checkpoints) {
      ctx.beginPath();
      ctx.arc(mx + cp.x * sx, my + cp.y * sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffd166';
    for (const m of state.mails) {
      if (m.collected) continue;
      ctx.fillRect(mx + m.x * sx - 1.5, my + m.y * sy - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ff5b4d';
    ctx.beginPath();
    ctx.arc(mx + state.x * sx, my + state.y * sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(ctx, canvas, world, state, particles, time, flash) {
    const cam = camera(canvas, state, world);
    drawGround(ctx, canvas, cam, world);
    drawPatches(ctx, cam, world);
    drawRuts(ctx, cam, state);
    drawWindLines(ctx, canvas, cam, particles, world);
    drawObstacles(ctx, cam, world);
    drawMails(ctx, cam, state);
    drawCheckpoints(ctx, cam, state, time);
    drawCamp(ctx, cam, world, time);
    drawTruck(ctx, cam, state, flash);
    drawMinimap(ctx, canvas, world, state);
  }

  global.SnowRender = { camera, render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
