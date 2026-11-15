import { AMBIENT, CONTROL_LIMITS, PROFILE, targetAt } from "./simulation.js";

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

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function label(ctx, text, x, y, color = "#8e907e", size = 10, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${size}px "EchoSans", "Kiln CJK", "SFMono-Regular", "Cascadia Code", monospace`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function mixColor(a, b, amount) {
  const p = Math.max(0, Math.min(1, amount));
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
  const aa = parse(a);
  const bb = parse(b);
  return `rgb(${aa.map((value, index) => Math.round(value + (bb[index] - value) * p)).join(",")})`;
}

function drawGrid(ctx, width, height, alpha = 0.06) {
  ctx.save();
  ctx.strokeStyle = `rgba(213, 214, 188, ${alpha})`;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) line(ctx, x, 0, x, height);
  for (let y = 0; y <= height; y += 40) line(ctx, 0, y, width, y);
  ctx.restore();
}

function drawKilnShell(ctx, heat) {
  const x = 166;
  const y = 110;
  const width = 800;
  const height = 460;

  ctx.save();
  ctx.shadowColor = `rgba(229, 101, 46, ${0.05 + heat * 0.18})`;
  ctx.shadowBlur = 36;
  ctx.fillStyle = "#29271f";
  ctx.beginPath();
  ctx.moveTo(x, y + 135);
  ctx.bezierCurveTo(x + 10, y + 24, x + 160, y - 8, x + width / 2, y - 8);
  ctx.bezierCurveTo(x + width - 160, y - 8, x + width - 10, y + 24, x + width, y + 135);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#49473a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  const brick = 66;
  for (let row = 0; row < 8; row += 1) {
    const by = y - 10 + row * 58;
    for (let col = -1; col < 14; col += 1) {
      const bx = x + col * brick + (row % 2 ? 31 : 0);
      ctx.strokeStyle = "rgba(127, 118, 92, 0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, brick, 54);
      ctx.fillStyle = `rgba(255, 238, 204, ${0.007 + ((row + col) % 4) * 0.004})`;
      ctx.fillRect(bx + 2, by + 2, brick - 4, 50);
    }
  }
  ctx.restore();

  const innerX = x + 72;
  const innerY = y + 55;
  const innerW = width - 148;
  const innerH = 344;
  ctx.save();
  ctx.fillStyle = "#0b0c09";
  ctx.beginPath();
  ctx.moveTo(innerX, innerY + 105);
  ctx.bezierCurveTo(innerX + 15, innerY + 10, innerX + 135, innerY - 7, innerX + innerW / 2, innerY - 7);
  ctx.bezierCurveTo(innerX + innerW - 135, innerY - 7, innerX + innerW - 15, innerY + 10, innerX + innerW, innerY + 105);
  ctx.lineTo(innerX + innerW, innerY + innerH);
  ctx.lineTo(innerX, innerY + innerH);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(244, 130, 69, ${0.12 + heat * 0.45})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  const glow = ctx.createRadialGradient(
    innerX + innerW * 0.54,
    innerY + innerH * 0.82,
    20,
    innerX + innerW * 0.5,
    innerY + innerH * 0.5,
    innerW * 0.7
  );
  glow.addColorStop(0, `rgba(255, 124, 49, ${0.08 + heat * 0.32})`);
  glow.addColorStop(0.45, `rgba(193, 70, 25, ${0.04 + heat * 0.17})`);
  glow.addColorStop(1, "rgba(52, 20, 10, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(innerX, innerY - 10, innerW, innerH + 20);

  ctx.fillStyle = `rgba(255, 219, 172, ${0.012 + heat * 0.035})`;
  ctx.beginPath();
  ctx.ellipse(innerX + innerW * 0.5, innerY + innerH * 0.83, 230, 46, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(239, 223, 184, 0.2)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  line(ctx, x + 60, y + height + 30, x + width - 60, y + height + 30);
  line(ctx, x + 60, y + height + 24, x + 60, y + height + 36);
  line(ctx, x + width - 60, y + height + 24, x + width - 60, y + height + 36);
  ctx.setLineDash([]);
  label(ctx, "2 460 mm", x + width / 2, y + height + 26, "#605f53", 8, "center");
  ctx.restore();

  return { x, y, width, height, innerX, innerY, innerW, innerH };
}

function drawShelf(ctx, x, y, width) {
  ctx.save();
  ctx.fillStyle = "#373429";
  ctx.fillRect(x, y, width, 9);
  ctx.fillStyle = "#5c5543";
  ctx.fillRect(x + 5, y, width - 10, 2);
  ctx.fillStyle = "#191a14";
  ctx.fillRect(x + 14, y + 9, 12, 42);
  ctx.fillRect(x + width - 26, y + 9, 12, 42);
  ctx.restore();
}

function drawVessel(ctx, piece, x, baseY, scale, time, glowing) {
  const width = (piece.id === "moon-vase" ? 58 : piece.id === "stoneware-jar" ? 60 : 48) * scale;
  const height = (piece.id === "moon-vase" ? 98 : piece.id === "stoneware-jar" ? 68 : 56) * scale;
  const broken = piece.status === "cracked";
  const discolored = piece.status === "discolored";
  const bodyColor = discolored ? "#7a675c" : mixColor("#775440", "#e38a4f", glowing * 0.44);
  const edgeColor = discolored ? "#b6a79c" : mixColor("#b77b53", "#ffd49a", glowing * 0.5);

  ctx.save();
  ctx.translate(x, baseY);
  if (glowing > 0.25) {
    ctx.shadowColor = `rgba(255, 131, 60, ${0.18 + glowing * 0.48})`;
    ctx.shadowBlur = 14 + glowing * 22;
  }
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (piece.id === "stoneware-jar") {
    ctx.moveTo(-width * 0.32, 0);
    ctx.bezierCurveTo(-width * 0.6, -height * 0.15, -width * 0.54, -height * 0.82, -width * 0.34, -height);
    ctx.lineTo(width * 0.34, -height);
    ctx.bezierCurveTo(width * 0.54, -height * 0.82, width * 0.6, -height * 0.15, width * 0.32, 0);
    ctx.closePath();
  } else if (piece.id === "moon-vase") {
    ctx.moveTo(-width * 0.28, 0);
    ctx.bezierCurveTo(-width * 0.68, -height * 0.2, -width * 0.48, -height * 0.56, -width * 0.16, -height * 0.73);
    ctx.lineTo(-width * 0.1, -height);
    ctx.lineTo(width * 0.1, -height);
    ctx.lineTo(width * 0.16, -height * 0.73);
    ctx.bezierCurveTo(width * 0.48, -height * 0.56, width * 0.68, -height * 0.2, width * 0.28, 0);
    ctx.closePath();
  } else {
    ctx.moveTo(-width * 0.33, 0);
    ctx.bezierCurveTo(-width * 0.52, -height * 0.3, -width * 0.62, -height * 0.88, -width * 0.48, -height);
    ctx.lineTo(width * 0.48, -height);
    ctx.bezierCurveTo(width * 0.62, -height * 0.88, width * 0.52, -height * 0.3, width * 0.33, 0);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  const shine = ctx.createLinearGradient(-width * 0.4, 0, width * 0.35, 0);
  shine.addColorStop(0, "rgba(255,255,255,0.02)");
  shine.addColorStop(0.42, `rgba(255,236,207,${0.08 + glowing * 0.14})`);
  shine.addColorStop(0.58, "rgba(0,0,0,0.05)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fill();

  if (broken) {
    ctx.strokeStyle = "#2a1913";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-5, -height * 0.24);
    ctx.lineTo(5, -height * 0.5);
    ctx.lineTo(-3, -height * 0.58);
    ctx.lineTo(9, -height * 0.86);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(4, -height * 0.5);
    ctx.lineTo(18, -height * 0.42);
    ctx.stroke();
  }

  if (piece.status === "discolored") {
    ctx.fillStyle = "rgba(100, 116, 104, 0.26)";
    ctx.beginPath();
    ctx.ellipse(width * 0.05, -height * 0.48, width * 0.45, height * 0.32, 0.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();

  const statusText = {
    safe: "稳定",
    cracked: "开裂",
    discolored: "色差",
    underfired: "欠火",
    overfired: "过火",
    uncooled: "缓冷不足"
  }[piece.status] || piece.status;
  const statusColor = piece.status === "safe" ? "#a9c979" : "#ed6d5b";
  ctx.save();
  ctx.globalAlpha = 0.9;
  label(ctx, piece.name, x, baseY + 24, "#d5ccb9", 9, "center");
  label(ctx, `${Math.round(piece.temp)}°C · ${statusText}`, x, baseY + 37, statusColor, 8, "center");
  ctx.restore();
}

function drawFlames(ctx, geometry, state, time) {
  const { innerX, innerY, innerW, innerH } = geometry;
  const gas = state.equipment.burner.on ? state.controls.gas / 100 : 0;
  if (gas <= 0.01) return;
  const baseX = innerX + innerW * 0.28;
  const baseY = innerY + innerH - 22;
  const count = Math.round(5 + gas * 11);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < count; i += 1) {
    const offset = (i - count / 2) * (11 + gas * 8);
    const sway = Math.sin(time * 0.003 + i * 1.71) * (5 + gas * 6);
    const flicker = 0.72 + Math.sin(time * 0.005 + i * 2.4) * 0.2;
    const height = (30 + gas * 86) * flicker * (0.78 + Math.random() * 0.22);
    const width = 14 + gas * 16;
    const x = baseX + offset;
    const gradient = ctx.createLinearGradient(x, baseY, x + sway, baseY - height);
    gradient.addColorStop(0, "rgba(255, 212, 122, 0.82)");
    gradient.addColorStop(0.35, "rgba(242, 101, 40, 0.82)");
    gradient.addColorStop(1, "rgba(192, 45, 19, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x - width * 0.48, baseY);
    ctx.bezierCurveTo(
      x - width * 0.62,
      baseY - height * 0.4,
      x + sway - width * 0.16,
      baseY - height * 0.7,
      x + sway,
      baseY - height
    );
    ctx.bezierCurveTo(
      x + sway + width * 0.2,
      baseY - height * 0.54,
      x + width * 0.52,
      baseY - height * 0.32,
      x + width * 0.48,
      baseY
    );
    ctx.closePath();
    ctx.fill();
  }
  const burnerGlow = ctx.createRadialGradient(baseX, baseY, 2, baseX, baseY, 150 + gas * 120);
  burnerGlow.addColorStop(0, `rgba(255, 231, 173, ${0.35 + gas * 0.4})`);
  burnerGlow.addColorStop(0.32, `rgba(244, 95, 33, ${0.16 + gas * 0.24})`);
  burnerGlow.addColorStop(1, "rgba(151, 36, 14, 0)");
  ctx.fillStyle = burnerGlow;
  ctx.fillRect(innerX, innerY + innerH - 310, innerW, 310);
  ctx.restore();
}

function drawArrow(ctx, x, y, angle, length, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.3;
  line(ctx, 0, 0, length, 0);
  ctx.beginPath();
  ctx.moveTo(length, 0);
  ctx.lineTo(length - 6, -4);
  ctx.lineTo(length - 6, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAirflow(ctx, geometry, state, time) {
  const { innerX, innerY, innerW, innerH } = geometry;
  const vent = state.equipment.blower.on ? state.controls.vent / 100 : 0;
  const door = state.equipment.door.open / 100;
  if (vent > 0.01) {
    const offset = (time * 0.04 * (0.4 + vent)) % 32;
    ctx.save();
    ctx.globalAlpha = 0.25 + vent * 0.55;
    for (let i = 0; i < 4; i += 1) {
      const x = 105 + offset + i * 31;
      drawArrow(ctx, x, 510 - i * 4, 0, 28, "#8eb7b1");
    }
    for (let i = 0; i < 3; i += 1) {
      const x = innerX + 38 + offset * 0.7 + i * 44;
      drawArrow(ctx, x, innerY + innerH - 42, -0.08, 22, "rgba(142,183,177,0.8)");
    }
    ctx.restore();
  }
  if (door > 0.01) {
    ctx.save();
    ctx.globalAlpha = 0.28 + door * 0.35;
    const offset = (time * 0.025) % 58;
    for (let i = 0; i < 4; i += 1) {
      drawArrow(
        ctx,
        innerX + innerW - 30 - offset - i * 42,
        innerY + 175 + i * 19,
        Math.PI,
        32,
        "#8eb7b1"
      );
    }
    ctx.restore();
  }
}

function drawDoor(ctx, geometry, state, time) {
  const { x, width, y, height, innerY, innerH } = geometry;
  const doorY = innerY + innerH * 0.42;
  const open = state.equipment.door.open / 100;
  const hingeX = x + width - 63;
  const hingeY = doorY;
  ctx.save();
  ctx.translate(hingeX, hingeY);
  ctx.rotate(-open * 1.1);
  ctx.fillStyle = "#3b372c";
  ctx.strokeStyle = "#766c54";
  ctx.lineWidth = 2;
  roundedRect(ctx, 0, -80, 22, 160, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 240, 206, 0.08)";
  ctx.fillRect(5, -64, 4, 128);
  ctx.fillStyle = open > 0.1 ? "#e7b85c" : "#aaa58f";
  ctx.beginPath();
  ctx.arc(15, 0, 4, 0, TAU);
  ctx.fill();
  ctx.restore();

  const glow = ctx.createRadialGradient(hingeX, hingeY, 2, hingeX, hingeY, 95);
  glow.addColorStop(0, `rgba(255, 141, 55, ${0.05 + open * 0.28})`);
  glow.addColorStop(1, "rgba(255, 110, 35, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hingeX, hingeY, 95, 0, TAU);
  ctx.fill();

  label(ctx, `窑门 ${Math.round(state.equipment.door.open)}%`, x + width + 18, doorY - 8, "#9d9b8d", 8);
  label(ctx, "DOOR / ACTUATOR", x + width + 18, doorY + 6, "#625f50", 7);
}

function drawBurnerHardware(ctx, geometry, state, time) {
  const { x, y, height } = geometry;
  const gas = state.equipment.burner.on ? state.controls.gas : 0;
  const blower = state.equipment.blower.on ? state.controls.vent : 0;
  ctx.save();
  ctx.fillStyle = "#24251e";
  ctx.strokeStyle = "#4b4a3c";
  ctx.lineWidth = 1;
  roundedRect(ctx, 44, 438, 108, 74, 6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(92, 475, 24, 0, TAU);
  ctx.strokeStyle = blower > 0 ? "#8eb7b1" : "#4b4a3c";
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    const angle = time * 0.0028 * (0.4 + blower / 100) + i * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(92, 475);
    ctx.lineTo(92 + Math.cos(angle) * 19, 475 + Math.sin(angle) * 19);
    ctx.stroke();
  }
  label(ctx, "BLOWER", 53, 500, "#777966", 7);
  label(ctx, `${Math.round(blower)}%`, 142, 500, "#8eb7b1", 7, "right");
  ctx.strokeStyle = "#5a5645";
  line(ctx, 152, 475, 238, 475);
  line(ctx, 238, 475, 238, 489);
  label(ctx, "AIR", 180, 466, "#676858", 7, "center");

  ctx.fillStyle = "#282820";
  ctx.strokeStyle = "#5a5645";
  roundedRect(ctx, 28, 532, 142, 40, 5);
  ctx.fill();
  ctx.stroke();
  label(ctx, "GAS TRAIN", 39, 557, "#777966", 7);
  label(ctx, `${Math.round(gas)}%`, 157, 557, gas > CONTROL_LIMITS.gas ? "#ed6d5b" : "#e7b85c", 8, "right");

  ctx.strokeStyle = "#6b654f";
  line(ctx, 99, 532, 99, 512);
  line(ctx, 99, 512, 235, 512);
  ctx.strokeStyle = gas > 0 ? "rgba(240,125,69,0.8)" : "#4b4a3c";
  ctx.setLineDash([5, 5]);
  line(ctx, 235, 512, 274, 512);
  ctx.setLineDash([]);
  label(ctx, gas > 0 ? "燃烧中" : "已切断", 282, 540, gas > 0 ? "#f0a06e" : "#70705f", 7);
  ctx.restore();
}

function drawTemperatureScale(ctx, geometry, temperature) {
  const { x, y } = geometry;
  ctx.save();
  ctx.strokeStyle = "rgba(206, 198, 172, 0.16)";
  ctx.lineWidth = 1;
  line(ctx, x - 27, y + 25, x - 27, y + 450);
  for (let i = 0; i <= 6; i += 1) {
    const yy = y + 450 - i * 70;
    line(ctx, x - 32, yy, x - 22, yy);
    label(ctx, String(i * 200), x - 37, yy + 3, "#5f5e51", 7, "right");
  }
  const normalized = Math.max(0, Math.min(1, temperature / 1200));
  const levelY = y + 450 - normalized * 420;
  ctx.fillStyle = "#f07d45";
  ctx.beginPath();
  ctx.moveTo(x - 27, levelY);
  ctx.lineTo(x - 18, levelY - 4);
  ctx.lineTo(x - 18, levelY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSmoke(ctx, geometry, state, time) {
  if (!state.equipment.burner.on || state.controls.vent >= 28) return;
  const { innerX, innerY, innerW, innerH } = geometry;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 7; i += 1) {
    const phase = (time * 0.00008 + i * 0.14) % 1;
    const x = innerX + innerW * 0.26 + Math.sin(i * 2.3 + time * 0.001) * 55 + phase * 160;
    const y = innerY + innerH - 60 - phase * 240;
    const radius = 12 + phase * 34;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(91, 86, 76, ${0.13 * (1 - phase)})`);
    gradient.addColorStop(1, "rgba(38, 37, 32, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSensors(ctx, geometry, state) {
  const { x, y, width, innerX, innerY, innerW } = geometry;
  ctx.save();
  ctx.strokeStyle = "rgba(231, 184, 92, 0.58)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  line(ctx, innerX + innerW * 0.56, innerY + 15, innerX + innerW * 0.56, innerY + 70);
  line(ctx, innerX + innerW * 0.56, innerY + 15, innerX + innerW * 0.56 + 110, innerY + 15);
  line(ctx, innerX + innerW * 0.56 + 110, innerY + 15, innerX + innerW * 0.56 + 110, 95);
  ctx.setLineDash([]);
  ctx.fillStyle = "#e7b85c";
  ctx.beginPath();
  ctx.arc(innerX + innerW * 0.56, innerY + 70, 3, 0, TAU);
  ctx.fill();
  label(ctx, "TC-01", innerX + innerW * 0.56 + 116, 92, "#9f8e62", 7);
  label(ctx, `${Math.round(state.chamberTemp)}°C`, innerX + innerW * 0.56 + 116, 104, "#e7b85c", 8);

  ctx.strokeStyle = "rgba(159, 150, 123, 0.4)";
  line(ctx, x + width - 120, y - 18, x + width - 120, y + 98);
  ctx.strokeStyle = "rgba(135, 125, 99, 0.28)";
  line(ctx, x + width - 120, y - 18, x + width - 88, y - 18);
  line(ctx, x + width - 88, y - 18, x + width - 88, y + 45);
  label(ctx, "排烟 FLUE", x + width - 81, y + 41, "#777361", 7);
  ctx.restore();
}

function drawKilnAnnotations(ctx, geometry, state, time) {
  const { x, y, width } = geometry;
  ctx.save();
  label(ctx, "A", 120, 126, "#96917e", 9);
  label(ctx, "A", 1000, 126, "#96917e", 9);
  ctx.setLineDash([5, 9]);
  ctx.strokeStyle = "rgba(173, 167, 139, 0.23)";
  line(ctx, 127, 123, 994, 123);
  ctx.setLineDash([]);
  label(ctx, "外壳 230 mm", x + 18, y + 86, "#656354", 7);
  label(ctx, "轻质耐火砖", x + 16, y + 191, "#605f51", 7);
  label(ctx, "窑床", x + width - 46, y + 466, "#656354", 7, "right");

  const pulse = 0.55 + Math.sin(time * 0.004) * 0.2;
  ctx.fillStyle = `rgba(169, 201, 121, ${pulse})`;
  ctx.beginPath();
  ctx.arc(x + 54, y + 38, 3, 0, TAU);
  ctx.fill();
  label(ctx, "KILN ONLINE", x + 63, y + 41, "#8e9f74", 7);

  const phaseName = { heating: "升温", holding: "保温", cooling: "缓冷", complete: "完成" }[state.phase];
  label(ctx, `PHASE / ${phaseName}`, x + width - 18, y + 41, "#a89c7b", 8, "right");
  ctx.restore();
}

export function drawKiln(canvas, state, time = performance.now()) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const background = ctx.createRadialGradient(width * 0.52, height * 0.56, 40, width * 0.52, height * 0.56, width * 0.75);
  background.addColorStop(0, "#11130e");
  background.addColorStop(1, "#090b08");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  const heat = Math.max(0, Math.min(1, (state.chamberTemp - AMBIENT) / (PROFILE.chamberPeak - AMBIENT)));
  const geometry = drawKilnShell(ctx, heat);
  const { innerX, innerY, innerW, innerH } = geometry;

  ctx.save();
  roundedRect(ctx, innerX, innerY + 50, innerW, innerH - 50, 42);
  ctx.clip();
  drawFlames(ctx, geometry, state, time);
  drawSmoke(ctx, geometry, state, time);
  drawAirflow(ctx, geometry, state, time);
  ctx.restore();

  drawTemperatureScale(ctx, geometry, state.chamberTemp);
  drawSensors(ctx, geometry, state);
  drawBurnerHardware(ctx, geometry, state, time);
  drawDoor(ctx, geometry, state, time);

  const topShelf = innerY + 217;
  const lowerShelf = innerY + 323;
  drawShelf(ctx, innerX + 28, topShelf, innerW - 120);
  drawShelf(ctx, innerX + 68, lowerShelf, innerW - 105);

  const glow = Math.max(0, Math.min(1, (state.chamberTemp - 250) / 900));
  drawVessel(ctx, state.pieces[0], innerX + 164, topShelf - 4, 0.94, time, glow);
  drawVessel(ctx, state.pieces[1], innerX + 328, topShelf - 4, 0.84, time, glow);
  drawVessel(ctx, state.pieces[2], innerX + 445, lowerShelf - 4, 0.86, time, glow);
  drawKilnAnnotations(ctx, geometry, state, time);

  ctx.save();
  ctx.fillStyle = "rgba(8, 9, 6, 0.78)";
  roundedRect(ctx, width - 200, height - 50, 184, 35, 5);
  ctx.fill();
  label(ctx, "热像增益", width - 188, height - 28, "#6f705f", 7);
  label(ctx, `${Math.round(heat * 100)}%`, width - 27, height - 28, "#d8a869", 9, "right");
  ctx.restore();
}

export function drawTrend(canvas, state) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const left = 36;
  const right = width - 14;
  const top = 10;
  const bottom = height - 26;
  const plotW = right - left;
  const plotH = bottom - top;
  const maxY = 1200;
  const xAt = (t) => left + (t / PROFILE.coolEnd) * plotW;
  const yAt = (temp) => top + plotH - (temp / maxY) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(left, top, plotW, plotH);

  const phases = [
    { start: 0, end: PROFILE.heatEnd, name: "升温", color: "rgba(240,125,69,0.025)" },
    { start: PROFILE.heatEnd, end: PROFILE.holdEnd, name: "保温", color: "rgba(231,184,92,0.03)" },
    { start: PROFILE.holdEnd, end: PROFILE.coolEnd, name: "缓冷", color: "rgba(142,183,177,0.025)" }
  ];
  for (const phase of phases) {
    ctx.fillStyle = phase.color;
    ctx.fillRect(xAt(phase.start), top, xAt(phase.end) - xAt(phase.start), plotH);
    ctx.strokeStyle = "rgba(116,116,96,0.18)";
    line(ctx, xAt(phase.start), top, xAt(phase.start), bottom);
    label(ctx, phase.name, xAt(phase.start) + 8, top + 10, "#646555", 7);
  }

  ctx.strokeStyle = "rgba(181, 177, 148, 0.13)";
  ctx.lineWidth = 1;
  for (let value = 0; value <= maxY; value += 300) {
    const y = yAt(value);
    line(ctx, left, y, right, y);
    label(ctx, String(value), left - 6, y + 3, "#656657", 7, "right");
  }
  for (let t = 0; t <= PROFILE.coolEnd; t += 60) {
    label(ctx, `${t}s`, xAt(t), bottom + 13, "#5d5e4f", 7, "center");
  }

  ctx.save();
  ctx.beginPath();
  for (let t = 0; t <= PROFILE.coolEnd; t += 2) {
    const x = xAt(t);
    const y = yAt(targetAt(t) + 66);
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let t = PROFILE.coolEnd; t >= 0; t -= 2) {
    ctx.lineTo(xAt(t), yAt(Math.max(0, targetAt(t) - 66)));
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(231, 184, 92, 0.075)";
  ctx.fill();
  ctx.strokeStyle = "rgba(231, 184, 92, 0.38)";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  for (let t = 0; t <= PROFILE.coolEnd; t += 2) {
    const x = xAt(t);
    const y = yAt(targetAt(t));
    if (t === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(237,109,91,0.34)";
  ctx.setLineDash([3, 5]);
  line(ctx, left, yAt(CONTROL_LIMITS.chamber), right, yAt(CONTROL_LIMITS.chamber));
  ctx.setLineDash([]);
  label(ctx, "窑体上限 1150", right - 3, yAt(CONTROL_LIMITS.chamber) - 5, "#9c6258", 7, "right");

  const drawn = state.history;
  if (drawn.length > 0) {
    const pieceColors = ["#b9d8c7", "#d5a184", "#c9c5b2"];
    ctx.lineWidth = 1;
    drawn.forEach((sample, index) => {
      for (let p = 0; p < 3; p += 1) {
        const x = xAt(sample.t);
        const y = yAt(sample.pieces[p]);
        if (index === 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    });
    for (let p = 0; p < 3; p += 1) {
      ctx.beginPath();
      ctx.strokeStyle = `${pieceColors[p]}99`;
      drawn.forEach((sample, index) => {
        const x = xAt(sample.t);
        const y = yAt(sample.pieces[p]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = "#f2eadb";
    ctx.lineWidth = 1.6;
    drawn.forEach((sample, index) => {
      const x = xAt(sample.t);
      const y = yAt(sample.temp);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = drawn[drawn.length - 1];
    const px = xAt(last.t);
    const py = yAt(last.temp);
    const pointGlow = ctx.createRadialGradient(px, py, 0, px, py, 16);
    pointGlow.addColorStop(0, "rgba(242,234,219,0.55)");
    pointGlow.addColorStop(1, "rgba(242,234,219,0)");
    ctx.fillStyle = pointGlow;
    ctx.beginPath();
    ctx.arc(px, py, 16, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#f2eadb";
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, TAU);
    ctx.fill();
  }
}
