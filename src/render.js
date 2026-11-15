import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  cargoTotal,
  mulberry32,
  shipDraft,
  tideLevel,
} from "./core.js";

const TAU = Math.PI * 2;

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

function ellipsePath(ctx, x, y, rx, ry, angle = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
}

function islandOutline(island, expansion = 0) {
  const random = mulberry32(island.seed);
  const points = [];
  const count = 34;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU;
    const wobble = 0.87
      + random() * 0.12
      + Math.sin(angle * 3 + island.beachAngle) * 0.035
      + Math.sin(angle * 7 - island.beachAngle) * 0.018;
    const radius = island.radius * wobble + expansion;
    points.push({
      x: island.x + Math.cos(angle) * radius,
      y: island.y + Math.sin(angle) * radius * 0.79,
    });
  }
  return points;
}

function traceSmooth(ctx, points) {
  const last = points[points.length - 1];
  const first = points[0];
  ctx.beginPath();
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  ctx.closePath();
}

function drawSea(ctx, state, time) {
  const gradient = ctx.createLinearGradient(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  gradient.addColorStop(0, "#0a3039");
  gradient.addColorStop(0.48, "#0a2b35");
  gradient.addColorStop(1, "#071e29");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  const shallowGlow = ctx.createRadialGradient(680, 390, 30, 680, 390, 440);
  shallowGlow.addColorStop(0, "rgba(72, 139, 132, 0.14)");
  shallowGlow.addColorStop(1, "rgba(72, 139, 132, 0)");
  ctx.fillStyle = shallowGlow;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#5aa49f";
  ctx.lineWidth = 1;
  const rows = 15;
  for (let row = 0; row < rows; row += 1) {
    const y = 45 + row * 51;
    ctx.beginPath();
    for (let x = -30; x <= WORLD_WIDTH + 30; x += 18) {
      const wave = Math.sin(x * 0.026 + time * 0.7 + row * 1.7) * 2.8
        + Math.sin(x * 0.009 - time * 0.38) * 3.5;
      if (x === -30) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.2;
  for (let index = 0; index < 24; index += 1) {
    const x = ((index * 193 + 71) % WORLD_WIDTH) + Math.sin(time * 0.12 + index) * 9;
    const y = ((index * 109 + 37) % WORLD_HEIGHT) + Math.cos(time * 0.15 + index * 1.4) * 6;
    ctx.fillStyle = index % 3 === 0 ? "#a5d7cb" : "#4a9993";
    ctx.beginPath();
    ctx.ellipse(x, y, 7 + (index % 5) * 3, 1.1, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawCompass(ctx, state) {
  ctx.save();
  ctx.translate(1090, 85);
  ctx.strokeStyle = "rgba(189, 227, 219, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, 22);
  ctx.moveTo(-22, 0);
  ctx.lineTo(22, 0);
  ctx.stroke();
  ctx.rotate(-0.06);
  ctx.fillStyle = "#f1c561";
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(5, 4);
  ctx.lineTo(0, 1);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(0.06);
  ctx.fillStyle = "rgba(214, 239, 233, 0.7)";
  ctx.font = "500 9px 'DM Mono', 'Noto SC', monospace";
  ctx.textAlign = "center";
  ctx.fillText("N", 0, -37);
  ctx.fillStyle = "rgba(160, 195, 191, 0.6)";
  ctx.font = "8px 'DM Mono', 'Noto SC', monospace";
  ctx.fillText(`${Math.round(tideLevel(state.elapsed) * 100)} cm`, 0, 43);
  ctx.restore();
}

function routePoints(state) {
  const points = [{ x: state.world.home.dock.x, y: state.world.home.dock.y }];
  for (const id of state.route) {
    const island = state.world.islands.find((item) => item.id === id);
    points.push({ x: island.dock.x, y: island.dock.y });
  }
  points.push({ x: state.world.home.dock.x, y: state.world.home.dock.y });
  return points;
}

function drawRoutes(ctx, state, time) {
  const planned = routePoints(state);
  ctx.save();
  ctx.setLineDash([4, 11]);
  ctx.lineDashOffset = -time * 14;
  ctx.strokeStyle = "rgba(245, 196, 91, 0.44)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  planned.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();

  ctx.save();
  planned.forEach((point, index) => {
    if (index === 0) return;
    const previous = planned[index - 1];
    const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(245, 196, 91, 0.55)";
    ctx.beginPath();
    ctx.moveTo(-8, -3);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-8, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();

  if (state.path.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(94, 226, 205, 0.13)";
    ctx.lineWidth = 9;
    ctx.beginPath();
    state.path.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.strokeStyle = "rgba(111, 236, 214, 0.7)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }
}

function drawShoals(ctx, state, time) {
  for (const shoal of state.world.shoals) {
    ctx.save();
    ctx.translate(shoal.x, shoal.y);
    ctx.rotate(shoal.angle);
    const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, shoal.rx);
    gradient.addColorStop(0, "rgba(173, 144, 83, 0.27)");
    gradient.addColorStop(0.58, "rgba(126, 115, 72, 0.19)");
    gradient.addColorStop(1, "rgba(66, 95, 87, 0.03)");
    ctx.fillStyle = gradient;
    ellipsePath(ctx, 0, 0, shoal.rx, shoal.ry);
    ctx.fill();
    ctx.strokeStyle = "rgba(210, 181, 111, 0.26)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ellipsePath(ctx, 0, 0, shoal.rx * 0.76, shoal.ry * 0.7);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.27;
    for (let row = -2; row <= 2; row += 1) {
      ctx.beginPath();
      ctx.ellipse(Math.sin(time * 0.35 + shoal.phase + row) * 7, row * 9, shoal.rx * 0.44, 2, 0, 0, TAU);
      ctx.strokeStyle = "#c7b373";
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(222, 201, 145, 0.44)";
    ctx.font = "500 8px 'Manrope', 'Noto SC', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("浅滩", shoal.x, shoal.y + 3);
    ctx.restore();
  }
}

function drawTideLines(ctx, state, time) {
  const level = tideLevel(state.elapsed);
  const drift = (2.4 - level) * 16;
  ctx.save();
  ctx.setLineDash([3, 8]);
  ctx.lineWidth = 1;
  for (const island of state.world.islands) {
    for (let ring = 0; ring < 2; ring += 1) {
      const points = islandOutline(island, 17 + drift + ring * 11);
      traceSmooth(ctx, points);
      ctx.strokeStyle = ring === 0
        ? `rgba(125, 216, 198, ${0.25 + Math.sin(time * 0.7 + island.beaconPhase) * 0.06})`
        : "rgba(125, 216, 198, 0.1)";
      ctx.stroke();
    }
    if (island.id === "north") {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(125, 216, 198, 0.45)";
      ctx.font = "500 8px 'Manrope', 'Noto SC', sans-serif";
      ctx.fillText("潮线", island.x + island.radius * 0.62, island.y + island.radius * 0.7);
    }
  }
  ctx.restore();
}

function drawDock(ctx, island, time) {
  const start = {
    x: island.x + Math.cos(island.dockAngle) * island.radius * 0.72,
    y: island.y + Math.sin(island.dockAngle) * island.radius * 0.58,
  };
  const end = island.dock;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const width = 19;
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(angle);
  ctx.fillStyle = "#5d5540";
  ctx.fillRect(0, -width / 2, length, width);
  ctx.fillStyle = "#75694d";
  for (let offset = 4; offset < length; offset += 10) {
    ctx.fillRect(offset, -width / 2 + 1, 6, width - 2);
  }
  ctx.strokeStyle = "rgba(25, 26, 20, 0.54)";
  ctx.lineWidth = 1;
  for (let offset = 6; offset < length; offset += 17) {
    ctx.beginPath();
    ctx.moveTo(offset, -width / 2);
    ctx.lineTo(offset, width / 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#2d3d38";
  ctx.fillRect(length - 8, -width / 2 - 6, 7, 8);
  ctx.fillRect(length - 8, width / 2 - 2, 7, 8);
  ctx.restore();

  const pulse = 0.6 + Math.sin(time * 2.4 + island.beaconPhase) * 0.3;
  ctx.save();
  ctx.translate(end.x, end.y);
  ctx.strokeStyle = `rgba(245, 196, 91, ${0.23 * pulse})`;
  ctx.lineWidth = 1.4;
  ellipsePath(ctx, 0, 0, 34, 20);
  ctx.stroke();
  ctx.fillStyle = "rgba(245, 196, 91, 0.72)";
  ctx.beginPath();
  ctx.arc(0, 0, 2.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawLighthouse(ctx, island, delivered, time) {
  const x = island.x - 23;
  const y = island.y - 27;
  const scale = island.id === "east" ? 1.05 : 0.94;
  const active = delivered;
  const angle = Math.atan2(island.dock.y - y, island.dock.x - x);
  ctx.save();
  if (active) {
    const beamLength = 175;
    const beam = ctx.createLinearGradient(x, y, x + Math.cos(angle) * beamLength, y + Math.sin(angle) * beamLength);
    beam.addColorStop(0, "rgba(247, 234, 174, 0.26)");
    beam.addColorStop(1, "rgba(247, 234, 174, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle - 0.12) * beamLength, y + Math.sin(angle - 0.12) * beamLength);
    ctx.lineTo(x + Math.cos(angle + 0.12) * beamLength, y + Math.sin(angle + 0.12) * beamLength);
    ctx.closePath();
    ctx.fill();
  }
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(2, 14, 18, 0.35)";
  ellipsePath(ctx, 10, 14, 23, 8, 0.16);
  ctx.fill();
  ctx.fillStyle = "#e6dfc7";
  ctx.beginPath();
  ctx.moveTo(-9, 13);
  ctx.lineTo(-5, -22);
  ctx.lineTo(5, -22);
  ctx.lineTo(9, 13);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#c25d43";
  ctx.beginPath();
  ctx.moveTo(-7, -5);
  ctx.lineTo(-5.8, -14);
  ctx.lineTo(5.8, -14);
  ctx.lineTo(7, -5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f0e8d2";
  ctx.fillRect(-7.5, -23, 15, 4);
  ctx.fillStyle = "rgba(19, 43, 45, 0.72)";
  ctx.fillRect(-4.2, -26, 8.4, 7);
  const lightPulse = active ? 0.8 + Math.sin(time * 2.7 + island.beaconPhase) * 0.2 : 0.35;
  ctx.fillStyle = active ? `rgba(247, 232, 143, ${lightPulse})` : "rgba(151, 107, 68, 0.6)";
  ctx.beginPath();
  ctx.arc(0, -23.8, 4.3, 0, TAU);
  ctx.fill();
  if (active) {
    ctx.shadowColor = "#ffeaa5";
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(0, -23.8, 2.6, 0, TAU);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#a85e43";
  ctx.beginPath();
  ctx.moveTo(-7, -25);
  ctx.lineTo(0, -33);
  ctx.lineTo(7, -25);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawIsland(ctx, state, island, time) {
  const delivered = state.delivered[island.id];
  const outline = islandOutline(island);
  const beach = islandOutline(island, 13);

  ctx.save();
  ctx.fillStyle = "rgba(0, 10, 13, 0.3)";
  traceSmooth(ctx, islandOutline(island, 24));
  ctx.fill();
  ctx.restore();

  const sand = ctx.createLinearGradient(island.x, island.y - island.radius, island.x, island.y + island.radius);
  sand.addColorStop(0, "#b7a574");
  sand.addColorStop(1, "#756e4f");
  ctx.fillStyle = sand;
  traceSmooth(ctx, beach);
  ctx.fill();

  const land = ctx.createRadialGradient(
    island.x - island.radius * 0.25,
    island.y - island.radius * 0.3,
    8,
    island.x,
    island.y,
    island.radius,
  );
  land.addColorStop(0, island.id === "north" ? "#496b52" : "#4e6d5b");
  land.addColorStop(0.64, island.id === "north" ? "#334f42" : "#3a564a");
  land.addColorStop(1, "#293f37");
  ctx.fillStyle = land;
  traceSmooth(ctx, outline);
  ctx.fill();

  ctx.save();
  traceSmooth(ctx, outline);
  ctx.clip();
  ctx.globalAlpha = 0.23;
  ctx.strokeStyle = "#9eb985";
  ctx.lineWidth = 1;
  for (let index = 0; index < 12; index += 1) {
    const offset = index * 17;
    ctx.beginPath();
    ctx.arc(island.x - 80 + offset, island.y + 18, 20 + (index % 3) * 8, Math.PI * 1.06, Math.PI * 1.83);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const random = mulberry32(island.seed + 17);
  for (let index = 0; index < 15; index += 1) {
    const angle = random() * TAU;
    const radius = Math.sqrt(random()) * island.radius * 0.62;
    const x = island.x + Math.cos(angle) * radius;
    const y = island.y + Math.sin(angle) * radius * 0.72;
    ctx.fillStyle = index % 4 === 0 ? "#667864" : index % 3 === 0 ? "#243d34" : "#4e6953";
    ctx.beginPath();
    if (index % 3 === 0) {
      ctx.arc(x, y, 3 + random() * 5, 0, TAU);
    } else {
      ctx.ellipse(x, y, 6 + random() * 10, 2 + random() * 4, random() * TAU, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();

  drawDock(ctx, island, time);
  drawLighthouse(ctx, island, delivered, time);

  ctx.save();
  ctx.translate(island.x, island.y + island.radius * 0.64);
  roundedRect(ctx, -35, 0, 70, 21, 5);
  ctx.fillStyle = "rgba(3, 22, 27, 0.7)";
  ctx.fill();
  ctx.strokeStyle = delivered ? "rgba(121, 215, 195, 0.38)" : "rgba(245, 196, 91, 0.26)";
  ctx.stroke();
  ctx.fillStyle = delivered ? "#9ce5d7" : "#e9d7aa";
  ctx.font = "600 9px 'Manrope', 'Noto SC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(delivered ? `${island.shortName} · 灯塔已亮` : `${island.shortName} · 等待补给`, 0, 14);
  ctx.restore();
}

function drawHomePort(ctx, state, time) {
  const home = state.world.home;
  ctx.save();
  const landGradient = ctx.createLinearGradient(0, 380, 240, 760);
  landGradient.addColorStop(0, "#3d554b");
  landGradient.addColorStop(1, "#263c37");
  ctx.fillStyle = landGradient;
  ctx.beginPath();
  ctx.moveTo(0, 410);
  ctx.bezierCurveTo(50, 430, 88, 492, 94, 552);
  ctx.bezierCurveTo(98, 606, 74, 674, 0, 700);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(182, 170, 118, 0.55)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(121, 215, 195, 0.2)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.moveTo(14, 393);
  ctx.bezierCurveTo(75, 418, 104, 486, 110, 552);
  ctx.bezierCurveTo(114, 614, 88, 688, 12, 718);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(116, 586);
  ctx.rotate(-0.02);
  ctx.fillStyle = "#554f3d";
  ctx.fillRect(0, -9, 147, 18);
  ctx.fillStyle = "#756c50";
  for (let x = 4; x < 144; x += 11) ctx.fillRect(x, -7, 7, 14);
  ctx.fillStyle = "#263d38";
  ctx.fillRect(136, -17, 11, 34);
  ctx.restore();

  ctx.save();
  ctx.translate(62, 514);
  ctx.fillStyle = "#354a43";
  ctx.fillRect(-31, -42, 74, 50);
  ctx.fillStyle = "#53675b";
  ctx.beginPath();
  ctx.moveTo(-39, -42);
  ctx.lineTo(7, -62);
  ctx.lineTo(52, -42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1d302e";
  ctx.fillRect(-14, -30, 27, 38);
  ctx.fillStyle = "#d5b25d";
  ctx.fillRect(26, -33, 11, 8);
  ctx.fillStyle = "#8fa88d";
  ctx.font = "600 8px 'Manrope', 'Noto SC', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("母港", 6, -68);
  ctx.restore();

  ctx.save();
  ctx.translate(163, 470);
  ctx.strokeStyle = "#8b8063";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -67);
  ctx.lineTo(39, -67);
  ctx.lineTo(39, -46);
  ctx.stroke();
  ctx.fillStyle = "#c99b45";
  ctx.fillRect(28, -46, 22, 18);
  ctx.fillStyle = "#38514a";
  ctx.font = "500 8px 'DM Mono', 'Noto SC', monospace";
  ctx.textAlign = "center";
  ctx.fillText("SUPPLY", 39, -56);
  ctx.restore();

  const pulse = 0.5 + Math.sin(time * 1.8) * 0.18;
  ctx.strokeStyle = `rgba(245, 196, 91, ${pulse})`;
  ctx.setLineDash([2, 6]);
  ellipsePath(ctx, home.dock.x, home.dock.y, 48, 31);
  ctx.stroke();
  ctx.restore();
}

function drawDriftwood(ctx, state, time) {
  for (const log of state.world.driftwood) {
    const bob = Math.sin(time * 0.85 + log.phase) * 2.2;
    ctx.save();
    ctx.translate(log.x, log.y + bob);
    ctx.rotate(log.angle + Math.sin(time * 0.2 + log.phase) * 0.035);
    ctx.fillStyle = "rgba(1, 12, 16, 0.26)";
    ellipsePath(ctx, 5, 7, log.length * 0.56, log.radius * 0.9);
    ctx.fill();
    ctx.strokeStyle = "rgba(94, 194, 181, 0.16)";
    ctx.lineWidth = 1;
    ellipsePath(ctx, 0, 0, log.length * 0.62, log.radius + 7);
    ctx.stroke();
    const wood = ctx.createLinearGradient(-log.length / 2, 0, log.length / 2, 0);
    wood.addColorStop(0, "#4a3828");
    wood.addColorStop(0.48, "#806044");
    wood.addColorStop(1, "#3e3126");
    ctx.fillStyle = wood;
    roundedRect(ctx, -log.length / 2, -log.radius * 0.6, log.length, log.radius * 1.2, log.radius * 0.55);
    ctx.fill();
    ctx.fillStyle = "#241c16";
    ctx.beginPath();
    ctx.arc(log.length / 2 - 2, 0, log.radius * 0.48, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#9b7752";
    ctx.beginPath();
    ctx.arc(log.length / 2 - 2, 0, log.radius * 0.3, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawWake(ctx, state, time) {
  const speed = Math.abs(state.ship.speed);
  if (speed < 1) return;
  const trailLength = Math.min(90, 22 + speed * 1.3);
  const intensity = Math.min(1, speed / 40);
  ctx.save();
  ctx.translate(state.ship.x, state.ship.y);
  ctx.rotate(state.ship.angle);
  ctx.strokeStyle = `rgba(173, 235, 222, ${0.1 + intensity * 0.2})`;
  ctx.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const offset = -20 - index * (trailLength / 5);
    const spread = 5 + index * 3.2;
    const wobble = Math.sin(time * 3.8 + index * 0.9) * 1.4;
    ctx.beginPath();
    ctx.moveTo(offset, -spread);
    ctx.quadraticCurveTo(offset - 12, -spread - 2 + wobble, offset - 20, -spread - 4);
    ctx.moveTo(offset, spread);
    ctx.quadraticCurveTo(offset - 12, spread + 2 - wobble, offset - 20, spread + 4);
    ctx.stroke();
  }
  if (state.ship.throttle > 0.12) {
    ctx.fillStyle = `rgba(198, 242, 232, ${0.08 + intensity * 0.08})`;
    for (let index = 0; index < 4; index += 1) {
      const px = -27 - index * 7 - ((time * 18) % 8);
      ctx.beginPath();
      ctx.arc(px, Math.sin(time * 4 + index) * 4, 2 + index * 0.5, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCargoBox(ctx, x, y, type, scale = 1) {
  const isFuel = type === "fuel";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = isFuel ? "#d9953f" : "#4ca994";
  roundedRect(ctx, -4, -3.5, 8, 7, 1.2);
  ctx.fill();
  ctx.strokeStyle = isFuel ? "#f4c06e" : "#81dcc8";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3.2, -2.5);
  ctx.lineTo(3.2, 2.5);
  ctx.moveTo(3.2, -2.5);
  ctx.lineTo(-3.2, 2.5);
  ctx.stroke();
  ctx.restore();
}

function drawShip(ctx, state, time) {
  drawWake(ctx, state, time);
  const ship = state.ship;
  const draft = shipDraft(state.cargo);
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  ctx.fillStyle = "rgba(0, 10, 13, 0.32)";
  ctx.beginPath();
  ctx.ellipse(2, 8, 28, 10, 0, 0, TAU);
  ctx.fill();

  const hull = ctx.createLinearGradient(-24, 0, 24, 0);
  hull.addColorStop(0, "#263d40");
  hull.addColorStop(0.56, "#d8d6c2");
  hull.addColorStop(1, "#eee8d3");
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-22, -10);
  ctx.lineTo(14, -10);
  ctx.quadraticCurveTo(29, -6, 31, 0);
  ctx.quadraticCurveTo(29, 6, 14, 10);
  ctx.lineTo(-22, 10);
  ctx.quadraticCurveTo(-26, 0, -22, -10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(10, 34, 36, 0.72)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#b84f3e";
  ctx.fillRect(-22, -10, 38, 3);

  ctx.fillStyle = "#334d4c";
  roundedRect(ctx, -15, -8, 22, 16, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(107, 215, 197, 0.13)";
  ctx.fillRect(-12, -7, 15, 5);
  ctx.strokeStyle = "#d5b65e";
  ctx.beginPath();
  ctx.moveTo(-4, -8);
  ctx.lineTo(-4, 8);
  ctx.stroke();

  const fuelPositions = [[7, -5.2], [14, -5.2]];
  const batteryPositions = [[7, 5.2], [14, 5.2]];
  for (let index = 0; index < state.cargo.fuel; index += 1) {
    drawCargoBox(ctx, fuelPositions[index][0], fuelPositions[index][1], "fuel");
  }
  for (let index = 0; index < state.cargo.battery; index += 1) {
    drawCargoBox(ctx, batteryPositions[index][0], batteryPositions[index][1], "battery");
  }

  ctx.fillStyle = "#d8d5be";
  ctx.beginPath();
  ctx.arc(-2, 0, 5.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#5d9e93";
  ctx.beginPath();
  ctx.arc(-2, 0, 3.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#e5ca76";
  ctx.fillRect(27, -2.1, 3, 4.2);

  ctx.strokeStyle = "rgba(255, 242, 193, 0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-18, -21);
  ctx.stroke();
  ctx.fillStyle = "#f4c95f";
  ctx.beginPath();
  ctx.arc(-18, -22, 2.2, 0, TAU);
  ctx.fill();
  ctx.shadowColor = "#f6d77d";
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.arc(-18, -22, 1.2, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (Math.abs(ship.throttle) > 0.04) {
    ctx.fillStyle = `rgba(135, 228, 210, ${Math.abs(ship.throttle) * 0.23})`;
    ctx.beginPath();
    ctx.arc(29, Math.sin(time * 4.2) * 1.6, 3.8, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  ctx.save();
  ctx.translate(ship.x, ship.y - 33);
  roundedRect(ctx, -30, -9, 60, 16, 5);
  ctx.fillStyle = "rgba(2, 20, 26, 0.74)";
  ctx.fill();
  ctx.fillStyle = "rgba(205, 235, 227, 0.82)";
  ctx.font = "500 8px 'DM Mono', 'Noto SC', monospace";
  ctx.textAlign = "center";
  ctx.fillText(`吃水 ${draft.toFixed(2)}m`, 0, 2.5);
  ctx.restore();
}

function drawClickEffects(ctx, view) {
  for (const effect of view.clickPulses || []) {
    const age = view.time - effect.start;
    if (age < 0 || age > effect.duration) continue;
    const progress = age / effect.duration;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = effect.tone === "warning" ? "#ef795f" : "#f5c45b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, 7 + progress * 26, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = effect.tone === "warning" ? "#ef795f" : "#f5c45b";
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, 2.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawTideWarning(ctx, state, time) {
  const remaining = state.world.mission.deadlineSeconds - state.elapsed;
  if (state.status === "ready" || remaining > 32) return;
  const intensity = Math.min(0.12, (32 - remaining) / 32 * 0.12);
  const glow = ctx.createRadialGradient(600, 380, 230, 600, 380, 690);
  glow.addColorStop(0, "rgba(209, 91, 65, 0)");
  glow.addColorStop(1, `rgba(209, 91, 65, ${intensity + Math.sin(time * 2.4) * 0.025})`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
}

export function drawScene(ctx, state, view = {}) {
  const time = view.time || 0;
  ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  drawSea(ctx, state, time);
  drawRoutes(ctx, state, time);
  drawShoals(ctx, state, time);
  drawTideLines(ctx, state, time);
  drawHomePort(ctx, state, time);
  for (const island of state.world.islands) {
    drawIsland(ctx, state, island, time);
  }
  drawDriftwood(ctx, state, time);
  drawShip(ctx, state, time);
  drawClickEffects(ctx, view);
  drawTideWarning(ctx, state, time);
  drawCompass(ctx, state);

  if (state.status === "paused") {
    ctx.fillStyle = "rgba(3, 18, 23, 0.16)";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
  if (state.status === "failed") {
    ctx.fillStyle = "rgba(119, 39, 30, 0.13)";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
}

export { roundedRect };
