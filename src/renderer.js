import { tideAt } from "./model.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function seededDots(seed, count) {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: 80 + random() * 1160,
    y: 60 + random() * 620,
    length: 12 + random() * 35,
    phase: random() * TAU,
  }));
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawLabel(context, text, x, y, color, align = "center") {
  context.save();
  context.font = '700 10px "Harbor Sans", "Segoe UI", sans-serif';
  const width = context.measureText(text).width + 14;
  const left = align === "center" ? x - width / 2 : x;
  roundedRect(context, left, y - 10, width, 19, 6);
  context.fillStyle = "rgba(3, 19, 22, 0.82)";
  context.fill();
  context.strokeStyle = `${color}55`;
  context.stroke();
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, y);
  context.restore();
}

export class HarborRenderer {
  constructor(context, world) {
    this.context = context;
    this.world = world;
    this.dots = seededDots(world.seed, 54);
  }

  draw(state, renderTime) {
    const context = this.context;
    const world = this.world;
    const tide = tideAt(world, state.elapsed);
    context.clearRect(0, 0, world.width, world.height);
    this.drawWater(tide, renderTime);
    this.drawCurrents(tide, renderTime);
    this.drawShoreAndTide(tide, renderTime);
    this.drawShallows(tide, renderTime);
    this.drawPlannedRoute(state);
    this.drawObstacles(renderTime);
    this.drawDock(state);
    this.drawGroups(state, renderTime);
    this.drawPath(state);
    this.drawWake(state);
    this.drawBoat(state, renderTime);
    this.drawAtmosphere(tide, renderTime);
  }

  drawWater(tide, time) {
    const context = this.context;
    const world = this.world;
    const gradient = context.createLinearGradient(0, 0, world.width, world.height);
    gradient.addColorStop(0, `hsl(190 52% ${12 + tide.level * 3}%)`);
    gradient.addColorStop(0.46, `hsl(188 55% ${14 + tide.level * 4}%)`);
    gradient.addColorStop(1, `hsl(196 58% ${8 + tide.level * 3}%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, world.width, world.height);

    context.save();
    context.globalAlpha = 0.14;
    for (let index = 0; index < 10; index += 1) {
      const y = 54 + index * 70 + Math.sin(time * 0.2 + index) * 5;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(320, y - 22, 760, y + 28, world.width, y - 5);
      context.lineWidth = 1;
      context.strokeStyle = index % 2 ? "#8ed8ca" : "#4aa4a2";
      context.stroke();
    }
    context.restore();

    context.save();
    for (const dot of this.dots) {
      const alpha = 0.08 + 0.06 * Math.sin(time * 0.7 + dot.phase);
      context.globalAlpha = Math.max(0.02, alpha);
      context.strokeStyle = "#b5e8df";
      context.lineWidth = 1;
      context.beginPath();
      const drift = Math.sin(time * 0.35 + dot.phase) * 8;
      context.moveTo(dot.x + drift, dot.y);
      context.quadraticCurveTo(
        dot.x + dot.length / 2,
        dot.y + Math.sin(time + dot.phase) * 3,
        dot.x + dot.length + drift,
        dot.y,
      );
      context.stroke();
    }
    context.restore();
  }

  drawCurrents(tide, time) {
    const context = this.context;
    context.save();
    context.translate(0, 0);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const x = 315 + column * 154 + Math.sin(time * 0.2 + row) * 5;
        const y = 102 + row * 142 + Math.cos(time * 0.17 + column) * 5;
        const angle = tide.current.angle;
        const length = 13 + tide.current.strength * 0.28;
        context.save();
        context.translate(x, y);
        context.rotate(angle);
        context.globalAlpha = 0.1 + tide.current.strength / 260;
        context.strokeStyle = "#b7e8df";
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(-length / 2, 0);
        context.lineTo(length / 2, 0);
        context.lineTo(length / 2 - 4, -3);
        context.moveTo(length / 2, 0);
        context.lineTo(length / 2 - 4, 3);
        context.stroke();
        context.restore();
      }
    }
    context.restore();
  }

  shoreX(y, tide) {
    return 42 + tide.level * 46 + Math.sin(y * 0.016 + 0.8) * 15 + Math.sin(y * 0.043) * 5;
  }

  drawShoreAndTide(tide, time) {
    const context = this.context;
    const world = this.world;
    context.save();
    context.beginPath();
    context.moveTo(0, 0);
    for (let y = 0; y <= world.height; y += 18) {
      context.lineTo(this.shoreX(y, tide), y);
    }
    context.lineTo(0, world.height);
    context.closePath();
    const shore = context.createLinearGradient(0, 0, 140, 0);
    shore.addColorStop(0, "#152c2b");
    shore.addColorStop(0.72, "#263a34");
    shore.addColorStop(1, "#675e46");
    context.fillStyle = shore;
    context.fill();

    context.beginPath();
    for (let y = 0; y <= world.height; y += 18) {
      const x = this.shoreX(y, tide);
      if (y === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.setLineDash([5, 8]);
    context.lineDashOffset = -time * 8;
    context.strokeStyle = "rgba(134, 228, 210, 0.54)";
    context.lineWidth = 1.4;
    context.stroke();
    context.setLineDash([]);

    context.globalAlpha = 0.16;
    context.strokeStyle = "#b8e8df";
    for (let index = 0; index < 5; index += 1) {
      context.beginPath();
      const offset = 12 + index * 9;
      for (let y = 0; y <= world.height; y += 22) {
        const x = this.shoreX(y, tide) - offset + Math.sin(time * 0.6 + y * 0.03 + index) * 2;
        if (y === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();

    this.drawTideGauge(tide);
  }

  drawTideGauge(tide) {
    const context = this.context;
    const x = 30;
    const y = 510;
    context.save();
    context.strokeStyle = "rgba(150, 216, 204, 0.22)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, y + 130);
    context.stroke();
    for (let tick = 0; tick <= 4; tick += 1) {
      context.beginPath();
      context.moveTo(x, y + tick * 32.5);
      context.lineTo(x + 7, y + tick * 32.5);
      context.stroke();
    }
    const markerY = y + (1 - tide.level) * 130;
    context.fillStyle = "#58e0c1";
    context.beginPath();
    context.moveTo(x - 3, markerY);
    context.lineTo(x - 10, markerY - 5);
    context.lineTo(x - 10, markerY + 5);
    context.closePath();
    context.fill();
    context.font = '700 8px "Harbor Sans", "Segoe UI", sans-serif';
    context.fillStyle = "rgba(209, 239, 232, 0.7)";
    context.fillText("潮线", x - 2, y - 8);
    context.restore();
  }

  drawShallows(tide, time) {
    const context = this.context;
    for (const shallow of this.world.shallows) {
      const exposed = tide.level <= shallow.groundAt;
      context.save();
      context.translate(shallow.x, shallow.y);
      context.rotate(shallow.rotation);
      context.beginPath();
      context.ellipse(0, 0, shallow.rx, shallow.ry, 0, 0, TAU);
      const sand = context.createRadialGradient(0, 0, 4, 0, 0, shallow.rx);
      sand.addColorStop(0, exposed ? "rgba(173, 151, 103, 0.92)" : "rgba(106, 133, 113, 0.22)");
      sand.addColorStop(0.72, exposed ? "rgba(123, 117, 84, 0.72)" : "rgba(74, 135, 128, 0.1)");
      sand.addColorStop(1, "rgba(75, 111, 97, 0)");
      context.fillStyle = sand;
      context.fill();
      context.setLineDash([5, 7]);
      context.lineDashOffset = -time * 4;
      context.strokeStyle = exposed ? "rgba(255, 213, 132, 0.52)" : "rgba(170, 226, 214, 0.15)";
      context.lineWidth = 1;
      context.stroke();
      context.setLineDash([]);

      if (exposed) {
        context.globalAlpha = 0.26;
        context.strokeStyle = "#5b543b";
        context.lineWidth = 1;
        for (let offset = -shallow.ry; offset < shallow.ry; offset += 11) {
          context.beginPath();
          context.moveTo(-shallow.rx, offset);
          context.lineTo(shallow.rx, offset + 15);
          context.stroke();
        }
      }
      context.restore();
      if (exposed) {
        drawLabel(context, "搁浅浅滩", shallow.x, shallow.y, "#ffd58a");
      }
    }
  }

  drawPlannedRoute(state) {
    const context = this.context;
    const world = this.world;
    const points = [
      { x: world.start.x, y: world.start.y },
      ...world.groups.map((group) => ({ x: group.x, y: group.y })),
      { x: world.dock.x + world.dock.width + 40, y: world.dock.y + 26 },
    ];
    context.save();
    context.setLineDash([5, 9]);
    context.lineDashOffset = -state.elapsed * 3;
    context.strokeStyle = "rgba(166, 227, 215, 0.19)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      context.quadraticCurveTo(
        (previous.x + point.x) / 2,
        (previous.y + point.y) / 2 - 28,
        point.x,
        point.y,
      );
    }
    context.stroke();
    context.restore();
  }

  drawObstacles(time) {
    const context = this.context;
    for (const pontoon of this.world.pontoons) {
      context.save();
      context.lineCap = "round";
      context.strokeStyle = "rgba(5, 15, 16, 0.5)";
      context.lineWidth = pontoon.width + 8;
      context.beginPath();
      context.moveTo(pontoon.x1, pontoon.y1);
      context.lineTo(pontoon.x2, pontoon.y2);
      context.stroke();
      context.strokeStyle = "#765d3c";
      context.lineWidth = pontoon.width;
      context.beginPath();
      context.moveTo(pontoon.x1, pontoon.y1);
      context.lineTo(pontoon.x2, pontoon.y2);
      context.stroke();
      context.strokeStyle = "rgba(255, 218, 157, 0.24)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(pontoon.x1, pontoon.y1 - 5);
      context.lineTo(pontoon.x2, pontoon.y2 - 5);
      context.stroke();
      const angle = Math.atan2(pontoon.y2 - pontoon.y1, pontoon.x2 - pontoon.x1);
      const length = Math.hypot(pontoon.x2 - pontoon.x1, pontoon.y2 - pontoon.y1);
      context.translate(pontoon.x1, pontoon.y1);
      context.rotate(angle);
      for (let distance = 14; distance < length; distance += 24) {
        context.strokeStyle = "rgba(39, 30, 18, 0.33)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(distance, -pontoon.width / 2);
        context.lineTo(distance, pontoon.width / 2);
        context.stroke();
      }
      context.restore();
      drawLabel(
        context,
        "浮桥",
        (pontoon.x1 + pontoon.x2) / 2,
        (pontoon.y1 + pontoon.y2) / 2,
        "#d6b980",
      );
    }

    for (const net of this.world.nets) {
      const angle = Math.atan2(net.y2 - net.y1, net.x2 - net.x1);
      const length = Math.hypot(net.x2 - net.x1, net.y2 - net.y1);
      context.save();
      context.translate(net.x1, net.y1);
      context.rotate(angle);
      context.strokeStyle = "rgba(193, 225, 211, 0.46)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(length, 0);
      context.stroke();
      for (let distance = 6; distance < length; distance += 16) {
        context.beginPath();
        context.moveTo(distance, -net.width / 2);
        context.lineTo(distance - 7, net.width / 2);
        context.moveTo(distance, -net.width / 2);
        context.lineTo(distance + 7, net.width / 2);
        context.strokeStyle = "rgba(185, 223, 211, 0.26)";
        context.stroke();
      }
      context.fillStyle = "#f0b95d";
      context.beginPath();
      context.arc(0, 0, 3, 0, TAU);
      context.arc(length, 0, 3, 0, TAU);
      context.fill();
      context.restore();
    }

    const shimmer = 0.28 + Math.sin(time * 1.7) * 0.06;
    context.save();
    context.globalAlpha = shimmer;
    for (const net of this.world.nets) {
      drawLabel(
        context,
        "渔网",
        (net.x1 + net.x2) / 2,
        (net.y1 + net.y2) / 2 - 14,
        "#dbece7",
      );
    }
    context.restore();
  }

  drawDock(state) {
    const context = this.context;
    const dock = this.world.dock;
    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.26)";
    roundedRect(context, dock.x + 5, dock.y + 8, dock.width, dock.height, 7);
    context.fill();
    context.fillStyle = "#745b3c";
    roundedRect(context, dock.x, dock.y, dock.width, dock.height, 7);
    context.fill();
    for (let plank = 0; plank < dock.width; plank += 18) {
      context.strokeStyle = "rgba(241, 208, 146, 0.14)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(dock.x + plank, dock.y + 3);
      context.lineTo(dock.x + plank, dock.y + dock.height - 3);
      context.stroke();
    }
    context.strokeStyle = "rgba(243, 218, 165, 0.32)";
    roundedRect(context, dock.x + 1, dock.y + 1, dock.width - 2, dock.height - 2, 7);
    context.stroke();
    for (let post = 0; post < 4; post += 1) {
      const x = dock.x + 16 + post * 38;
      context.fillStyle = "#2b3029";
      context.beginPath();
      context.arc(x, dock.y + 7, 4, 0, TAU);
      context.fill();
      context.strokeStyle = "rgba(238, 202, 136, 0.35)";
      context.stroke();
    }
    context.restore();

    if (state.loaded === this.world.mission.targetCount) {
      const pulse = 1 + Math.sin(state.elapsed * 3) * 0.04;
      const x = dock.x + dock.width - 10;
      const y = dock.y + dock.height / 2;
      context.save();
      context.strokeStyle = "rgba(255, 196, 93, 0.75)";
      context.lineWidth = 2;
      context.setLineDash([7, 7]);
      context.lineDashOffset = -state.elapsed * 14;
      context.beginPath();
      context.ellipse(x, y, 48 * pulse, 38 * pulse, 0, 0, TAU);
      context.stroke();
      context.restore();
      drawLabel(context, "返航卸货", x, y - 54, "#ffc45d");
    }
    drawLabel(context, "码头", dock.x + dock.width / 2, dock.y - 12, "#f0cf91");
  }

  drawGroups(state, time) {
    const context = this.context;
    const world = this.world;
    for (const group of world.groups) {
      const completed = state.visited.includes(group.id);
      const active = group.id === state.nextTarget && state.loaded < world.mission.targetCount;
      const pulse = 1 + Math.sin(time * 2.1 + group.id) * 0.045;
      context.save();
      context.translate(group.x, group.y);

      if (active) {
        const glow = context.createRadialGradient(0, 0, 4, 0, 0, group.radius * 1.35);
        glow.addColorStop(0, `${group.color}2e`);
        glow.addColorStop(1, `${group.color}00`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(0, 0, group.radius * 1.35, 0, TAU);
        context.fill();
      }

      context.strokeStyle = completed
        ? "rgba(88, 224, 193, 0.28)"
        : active
          ? `${group.color}b8`
          : "rgba(178, 207, 199, 0.16)";
      context.lineWidth = active ? 1.8 : 1;
      context.setLineDash(active ? [7, 6] : [3, 8]);
      context.lineDashOffset = -time * (active ? 14 : 4);
      context.beginPath();
      context.arc(0, 0, group.radius * pulse, 0, TAU);
      context.stroke();
      context.setLineDash([]);

      if (active) {
        context.strokeStyle = `${group.color}55`;
        context.beginPath();
        context.arc(0, 0, group.radius + 11 + Math.sin(time * 2.1) * 4, 0, TAU);
        context.stroke();
      }
      context.restore();

      for (const [index, buoy] of group.buoys.entries()) {
        const bob = Math.sin(time * 1.8 + buoy.angle + index) * 2.2;
        context.save();
        context.translate(buoy.x, buoy.y + bob);
        context.fillStyle = "rgba(1, 12, 14, 0.36)";
        context.beginPath();
        context.ellipse(3, 5, 7, 4, 0, 0, TAU);
        context.fill();
        context.fillStyle = completed ? "#6ad9c2" : group.color;
        context.beginPath();
        context.arc(0, 0, 5.2, 0, TAU);
        context.fill();
        context.strokeStyle = "rgba(255, 255, 255, 0.52)";
        context.lineWidth = 1;
        context.stroke();
        context.globalAlpha = 0.28;
        context.strokeStyle = group.color;
        context.beginPath();
        context.arc(0, 0, 8 + Math.sin(time * 2 + index) * 1.5, 0, TAU);
        context.stroke();
        context.restore();
      }

      const groupName = ["A-01", "B-02", "C-03"][group.id - 1] || group.label;
      const label = completed ? `${groupName} ✓ 已检` : active ? `${groupName} · 检查` : `${groupName} · 锁定`;
      drawLabel(
        context,
        label,
        group.x,
        group.y + group.radius + 15,
        completed ? "#75e7ca" : active ? group.color : "#839c96",
      );
    }
  }

  drawPath(state) {
    const context = this.context;
    if (state.path.length < 2) return;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "rgba(126, 235, 212, 0.18)";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(state.path[0].x, state.path[0].y);
    for (const point of state.path) context.lineTo(point.x, point.y);
    context.stroke();
    context.strokeStyle = "rgba(150, 244, 223, 0.72)";
    context.lineWidth = 1.8;
    context.setLineDash([2, 5]);
    context.lineDashOffset = -state.elapsed * 10;
    context.beginPath();
    context.moveTo(state.path[0].x, state.path[0].y);
    for (const point of state.path) context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
  }

  drawWake(state) {
    const context = this.context;
    context.save();
    for (const particle of state.wake) {
      const life = clamp(particle.life / particle.maxLife, 0, 1);
      context.globalAlpha = life * 0.34;
      context.strokeStyle = "#c8f0e8";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size * (1.5 - life * 0.5), 0, TAU);
      context.stroke();
    }
    context.restore();
  }

  drawBoat(state, time) {
    const context = this.context;
    const boat = state.boat;
    const speed = Math.hypot(boat.vx, boat.vy);
    context.save();
    context.translate(boat.x, boat.y);
    context.rotate(boat.angle);

    if (state.inputPulse > 0) {
      context.save();
      context.globalAlpha = Math.min(0.55, state.inputPulse * 0.55);
      context.strokeStyle = state.inputColor || "#58e0c1";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 27 + (1 - state.inputPulse) * 23, 0, TAU);
      context.stroke();
      context.restore();
    }

    if (speed > 6) {
      context.save();
      context.globalAlpha = 0.2 + Math.min(speed / 160, 0.3);
      context.fillStyle = "#c6f2e9";
      context.beginPath();
      context.moveTo(-17, -8);
      context.lineTo(-34 - speed * 0.055, 0);
      context.lineTo(-17, 8);
      context.closePath();
      context.fill();
      context.restore();
    }

    context.fillStyle = "rgba(1, 9, 11, 0.45)";
    context.beginPath();
    context.ellipse(2, 5, 22, 11, 0, 0, TAU);
    context.fill();
    context.fillStyle = "#e7e5d2";
    context.beginPath();
    context.moveTo(23, 0);
    context.quadraticCurveTo(11, -11, -13, -9);
    context.quadraticCurveTo(-22, -5, -20, 0);
    context.quadraticCurveTo(-22, 5, -13, 9);
    context.quadraticCurveTo(11, 11, 23, 0);
    context.fill();
    context.strokeStyle = "#183e40";
    context.lineWidth = 1.4;
    context.stroke();
    context.fillStyle = "#1d5e60";
    context.beginPath();
    context.moveTo(10, -6);
    context.lineTo(-8, -6);
    context.lineTo(-4, 6);
    context.lineTo(10, 6);
    context.closePath();
    context.fill();
    context.fillStyle = "#8cedd9";
    roundedRect(context, 1, -4, 6, 8, 2);
    context.fill();
    context.fillStyle = "#ffcf71";
    context.beginPath();
    context.arc(16, 0, 2.1, 0, TAU);
    context.fill();

    if (state.loaded > 0) {
      for (let index = 0; index < state.loaded; index += 1) {
        const x = -11 + index * 6;
        context.fillStyle = "#c88a45";
        roundedRect(context, x, -3, 5, 6, 1);
        context.fill();
        context.strokeStyle = "rgba(255, 216, 148, 0.65)";
        context.lineWidth = 0.8;
        context.stroke();
      }
    }

    if (Math.abs(boat.vx) + Math.abs(boat.vy) > 4 || state.throttle !== 0) {
      context.fillStyle = "rgba(255, 244, 202, 0.72)";
      context.beginPath();
      context.arc(-21, Math.sin(time * 7) * 1.4, 1.4, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  drawAtmosphere(tide, time) {
    const context = this.context;
    const height = this.world.height;
    const vignette = context.createRadialGradient(
      this.world.width / 2,
      height / 2,
      180,
      this.world.width / 2,
      height / 2,
      720,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, `rgba(0, 8, 10, ${0.24 + tide.waveHeight * 0.1})`);
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.world.width, height);

    context.save();
    context.globalAlpha = 0.08 + tide.waveHeight * 0.05;
    context.strokeStyle = "#d3fff6";
    context.lineWidth = 1;
    for (let index = 0; index < 7; index += 1) {
      const y = 130 + index * 84 + Math.sin(time * 0.6 + index) * 8;
      context.beginPath();
      context.moveTo(280 + index * 34, y);
      context.quadraticCurveTo(560, y - 5, 1020, y + 2);
      context.stroke();
    }
    context.restore();
  }
}

export function drawSummaryMap(canvas, world, state, summary) {
  const context = canvas.getContext("2d");
  const scale = canvas.width / world.width;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#0a3034");
  gradient.addColorStop(1, "#061a20");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(scale, scale);

  context.fillStyle = "rgba(47, 68, 58, 0.55)";
  context.fillRect(0, 0, 110, world.height);
  context.strokeStyle = "rgba(145, 220, 205, 0.28)";
  context.lineWidth = 5;
  for (const obstacle of world.pontoons) {
    context.beginPath();
    context.moveTo(obstacle.x1, obstacle.y1);
    context.lineTo(obstacle.x2, obstacle.y2);
    context.stroke();
  }
  context.strokeStyle = "rgba(187, 224, 210, 0.18)";
  context.lineWidth = 3;
  for (const net of world.nets) {
    context.beginPath();
    context.moveTo(net.x1, net.y1);
    context.lineTo(net.x2, net.y2);
    context.stroke();
  }

  context.setLineDash([4, 8]);
  context.strokeStyle = "rgba(161, 222, 210, 0.18)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(world.start.x, world.start.y);
  for (const group of world.groups) context.lineTo(group.x, group.y);
  context.lineTo(world.dock.x + world.dock.width, world.dock.y + world.dock.height / 2);
  context.stroke();
  context.setLineDash([]);

  for (const group of world.groups) {
    const completed = state.visited.includes(group.id);
    context.fillStyle = completed ? "#58e0c1" : "rgba(140, 173, 166, 0.65)";
    context.beginPath();
    context.arc(group.x, group.y, 22, 0, TAU);
    context.fill();
    context.fillStyle = "#05201e";
    context.font = '700 17px "Harbor Sans", "Segoe UI", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(group.label, group.x, group.y + 1);
  }

  const isSuccess = summary?.success;
  context.strokeStyle = isSuccess ? "#7af0d3" : "#ff8e96";
  context.lineWidth = 4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = isSuccess ? "rgba(88, 224, 193, 0.55)" : "rgba(255, 125, 143, 0.5)";
  context.shadowBlur = 14;
  if (state.path.length > 1) {
    context.beginPath();
    context.moveTo(state.path[0].x, state.path[0].y);
    for (const point of state.path) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.shadowBlur = 0;

  context.fillStyle = "#ffc45d";
  context.beginPath();
  context.arc(world.dock.x + world.dock.width, world.dock.y + world.dock.height / 2, 14, 0, TAU);
  context.fill();
  context.fillStyle = "#05201e";
  context.font = '700 13px "Harbor Sans", "Segoe UI", sans-serif';
  context.fillText("⌂", world.dock.x + world.dock.width, world.dock.y + world.dock.height / 2 + 1);

  for (const incident of state.incidents) {
    if (typeof incident.x !== "number") continue;
    context.strokeStyle = "#ff806f";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(incident.x - 6, incident.y - 6);
    context.lineTo(incident.x + 6, incident.y + 6);
    context.moveTo(incident.x + 6, incident.y - 6);
    context.lineTo(incident.x - 6, incident.y + 6);
    context.stroke();
  }
  context.restore();
}
