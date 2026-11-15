import { CELL } from './world.js';
import { STATUS } from './config.js';

const TERRAIN_COLORS = {
  gravel: '#8d7a5c',
  sand: '#c9a76a',
  silt: '#d8c6a0'
};

export function createRenderer(ctx) {
  const camera = { x: 0, y: 0, shake: 0 };

  function render(state, view) {
    const { width, height } = view;
    camera.x += (state.vehicle.x - width / 2 - camera.x) * 0.12;
    camera.y += (state.vehicle.y - height / 2 - camera.y) * 0.12;
    camera.x = Math.max(0, Math.min(state.world.width - width, camera.x));
    camera.y = Math.max(0, Math.min(state.world.height - height, camera.y));
    if (state.flash.rock) camera.shake = 7;
    camera.shake *= 0.86;
    const sx = (Math.random() - 0.5) * camera.shake;
    const sy = (Math.random() - 0.5) * camera.shake;

    ctx.save();
    ctx.translate(-camera.x + sx, -camera.y + sy);
    drawTerrain(ctx, state, camera, view);
    drawRuts(ctx, state);
    drawCamp(ctx, state);
    drawLandmarks(ctx, state);
    drawTargets(ctx, state);
    drawRocks(ctx, state);
    drawDroppedPoles(ctx, state);
    drawPath(ctx, state);
    drawWindStreaks(ctx, state);
    drawVehicle(ctx, state);
    drawDust(ctx, state);
    ctx.restore();

    drawCompass(ctx, state, view);
  }

  return { render, camera };
}

function drawTerrain(ctx, state, camera, view) {
  const startCol = Math.max(0, Math.floor(camera.x / CELL) - 1);
  const endCol = Math.min(state.world.cols, Math.ceil((camera.x + view.width) / CELL) + 1);
  const startRow = Math.max(0, Math.floor(camera.y / CELL) - 1);
  const endRow = Math.min(state.world.rows, Math.ceil((camera.y + view.height) / CELL) + 1);
  for (let row = startRow; row < endRow; row += 1) {
    for (let col = startCol; col < endCol; col += 1) {
      const type = state.world.terrain[row * state.world.cols + col];
      ctx.fillStyle = TERRAIN_COLORS[type];
      ctx.fillRect(col * CELL, row * CELL, CELL + 1, CELL + 1);
    }
  }
  ctx.strokeStyle = 'rgba(70,55,38,0.10)';
  ctx.lineWidth = 1;
  for (let col = startCol; col <= endCol; col += 1) {
    ctx.beginPath();
    ctx.moveTo(col * CELL, startRow * CELL);
    ctx.lineTo(col * CELL, endRow * CELL);
    ctx.stroke();
  }
}

function drawTargets(ctx, state) {
  for (const target of state.targets) {
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fillStyle = target.polePlaced ? 'rgba(52,140,90,0.25)' : 'rgba(200,90,60,0.18)';
    ctx.fill();
    ctx.strokeStyle = target.polePlaced ? '#2e8b57' : '#c05a3c';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3d2a1c';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`测点 ${target.id}`, target.x, target.y - target.radius - 8);
    if (target.polePlaced) drawPole(ctx, target.x, target.y, '#2e8b57');
    else {
      ctx.strokeStyle = '#c05a3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(target.x - 10, target.y);
      ctx.lineTo(target.x + 10, target.y);
      ctx.moveTo(target.x, target.y - 10);
      ctx.lineTo(target.x, target.y + 10);
      ctx.stroke();
    }
  }
}

function drawPole(ctx, x, y, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y + 18);
  ctx.lineTo(x, y - 22);
  ctx.stroke();
  ctx.fillStyle = '#e8e2d2';
  ctx.fillRect(x - 9, y - 26, 18, 8);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - 30, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawRocks(ctx, state) {
  for (const rock of state.world.rocks) {
    ctx.fillStyle = '#5d5145';
    ctx.beginPath();
    ctx.ellipse(rock.x + 4, rock.y + 6, rock.radius, rock.radius * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a6a58';
    ctx.beginPath();
    ctx.ellipse(rock.x, rock.y, rock.radius, rock.radius * 0.72, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,32,24,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,215,190,0.35)';
    ctx.beginPath();
    ctx.arc(rock.x - rock.radius * 0.25, rock.y - rock.radius * 0.2, rock.radius * 0.45, 0.2, 2.4);
    ctx.stroke();
  }
}

function drawDroppedPoles(ctx, state) {
  for (const pole of state.droppedPoles) {
    ctx.save();
    ctx.translate(pole.x, pole.y);
    ctx.rotate(0.6);
    drawPole(ctx, 0, 0, '#b8862f');
    ctx.restore();
    ctx.fillStyle = '#8a6420';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('脱落设备（驶近回收）', pole.x, pole.y + 34);
  }
}

function drawPath(ctx, state) {
  if (state.path.length < 2) return;
  ctx.strokeStyle = 'rgba(35,90,150,0.55)';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.moveTo(state.path[0].x, state.path[0].y);
  for (const point of state.path) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWindStreaks(ctx, state) {
  const strength = state.wind.strength;
  if (strength < 0.12) return;
  const v = state.vehicle;
  ctx.strokeStyle = `rgba(235,225,205,${0.12 + strength * 0.35})`;
  ctx.lineWidth = 1.5;
  const count = Math.round(6 + strength * 16);
  for (let i = 0; i < count; i += 1) {
    const phase = (state.elapsed * 260 + i * 137) % 900;
    const ox = ((i * 173) % 700) - 350;
    const oy = ((i * 251) % 480) - 240;
    const x = v.x + ox + Math.cos(state.wind.angle) * (phase - 450);
    const y = v.y + oy + Math.sin(state.wind.angle) * (phase - 450);
    const len = 26 + strength * 46;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(state.wind.angle) * len, y - Math.sin(state.wind.angle) * len);
    ctx.stroke();
  }
}

function drawVehicle(ctx, state) {
  const v = state.vehicle;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  if (state.status === STATUS.STRANDED) ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#26465f';
  ctx.fillRect(-20, -12, 40, 24);
  ctx.fillStyle = '#3f6f93';
  ctx.fillRect(-4, -9, 16, 18);
  ctx.fillStyle = '#c9d8e2';
  ctx.fillRect(8, -7, 7, 14);
  ctx.fillStyle = '#151515';
  ctx.fillRect(-18, -15 + v.steering * 3, 9, 5);
  ctx.fillRect(-18, 10 + v.steering * 3, 9, 5);
  ctx.fillRect(10, -15, 7, 5);
  ctx.fillRect(10, 10, 7, 5);
  ctx.strokeStyle = '#e8e2d2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(28, 0);
  ctx.stroke();
  ctx.restore();

  const target = state.targets.find((t) => !t.polePlaced) || state.world.camp;
  const noisy = Math.atan2(target.y - v.y, target.x - v.x) + state.compass.error * Math.sin(state.elapsed * 3.7);
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.lineTo(v.x + Math.cos(noisy) * 44, v.y + Math.sin(noisy) * 44);
  ctx.stroke();
}

function drawDust(ctx, state) {
  const strength = state.wind.strength;
  const coverage = Math.min(0.42, strength * 0.34 + (state.vehicle.terrain === 'silt' ? 0.08 : 0));
  if (coverage < 0.04) return;
  const v = state.vehicle;
  const grad = ctx.createRadialGradient(v.x, v.y, 40, v.x, v.y, 420);
  grad.addColorStop(0, `rgba(214,196,158,0)`);
  grad.addColorStop(1, `rgba(214,196,158,${coverage})`);
  ctx.fillStyle = grad;
  ctx.fillRect(v.x - 460, v.y - 460, 920, 920);
}

function drawCompass(ctx, state, view) {
  const cx = view.width - 76;
  const cy = 86;
  const r = 42;
  ctx.save();
  ctx.fillStyle = 'rgba(20,26,32,0.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9d8e2';
  ctx.lineWidth = 2;
  ctx.stroke();
  const shown = -state.vehicle.angle + state.compass.error * Math.sin(state.elapsed * 3.7);
  ctx.translate(cx, cy);
  ctx.rotate(shown);
  ctx.fillStyle = '#e2604d';
  ctx.beginPath();
  ctx.moveTo(0, -r + 6);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 2);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c9d8e2';
  ctx.beginPath();
  ctx.moveTo(0, r - 6);
  ctx.lineTo(5, 0);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#e8e2d2';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('罗盘（C 校准）', cx, cy + r + 26);
  ctx.fillStyle = state.compass.error > 0.2 ? '#e2a04d' : '#8fd6a0';
  ctx.fillText(`误差 ${(state.compass.error * 100).toFixed(0)}%`, cx, cy + r + 42);
}

function drawRuts(ctx, state) {
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const rut of state.ruts) {
    ctx.strokeStyle = rut.terrain === 'silt' ? 'rgba(120,95,60,0.55)' : 'rgba(90,70,45,0.4)';
    ctx.beginPath();
    ctx.moveTo(rut.x - 6, rut.y);
    ctx.lineTo(rut.x + 6, rut.y + 2);
    ctx.stroke();
  }
}

function drawCamp(ctx, state) {
  const camp = state.world.camp;
  ctx.fillStyle = 'rgba(60,120,90,0.28)';
  ctx.beginPath();
  ctx.arc(camp.x, camp.y, camp.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2f6b4f';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#244c39';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('营地', camp.x, camp.y - camp.radius - 8);
  ctx.fillRect(camp.x - 14, camp.y - 14, 28, 28);
}

function drawLandmarks(ctx, state) {
  for (const mark of state.world.landmarks) {
    ctx.fillStyle = 'rgba(120,90,50,0.22)';
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, mark.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,75,35,0.5)';
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6e4b23';
    ctx.beginPath();
    ctx.moveTo(mark.x, mark.y - 34);
    ctx.lineTo(mark.x + 26, mark.y + 18);
    ctx.lineTo(mark.x - 26, mark.y + 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3115';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('校准地标', mark.x, mark.y + 38);
  }
}
