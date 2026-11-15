import { SPECIES, mulberry32 } from "./sim.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const smooth = (value) => value * value * (3 - 2 * value);

function hexToRgb(hex) {
  if (hex.startsWith("rgb")) {
    const [r, g, b] = hex.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
    return { r, g, b };
  }
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixColor(a, b, amount) {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return `rgb(${Math.round(lerp(from.r, to.r, amount))}, ${Math.round(lerp(from.g, to.g, amount))}, ${Math.round(lerp(from.b, to.b, amount))})`;
}

export class SceneRenderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sim = sim;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.stars = [];
    this.hoverFish = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.buildStars();
  }

  setSim(sim) {
    this.sim = sim;
    this.buildStars();
  }

  buildStars() {
    const random = mulberry32(this.sim ? this.sim.fingerprint.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) : 42);
    this.stars = Array.from({ length: 85 }, () => ({
      x: random(),
      y: random() * 0.43,
      size: 0.4 + random() * 1.1,
      phase: random() * TAU,
      speed: 0.5 + random() * 1.2,
    }));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  geometry() {
    const w = this.width;
    const h = this.height;
    const startX = w * 0.19;
    const endX = w * 0.91;
    const pools = 5;
    const poolWidth = (endX - startX) / pools;
    const topSurface = h * 0.34;
    const lastSurface = h * 0.71;
    const step = (lastSurface - topSurface) / (pools - 1);
    return {
      w,
      h,
      startX,
      endX,
      pools,
      poolWidth,
      topSurface,
      lastSurface,
      step,
      floorGap: Math.min(h * 0.19, 76),
      upstreamX: w * 0.17,
      downstreamX: endX,
      fishUpstreamX: startX + poolWidth * 0.22,
      fishDownstreamX: endX - poolWidth * 0.35,
    };
  }

  surfaceAt(x, geo = this.geometry()) {
    if (x <= geo.startX) return geo.topSurface;
    if (x >= geo.endX) return geo.lastSurface + geo.step * 0.45;
    const raw = (x - geo.startX) / geo.poolWidth;
    const index = Math.min(geo.pools - 1, Math.floor(raw + 0.35));
    return geo.topSurface + index * geo.step;
  }

  draw() {
    if (!this.width || !this.height) this.resize();
    if (!this.width || !this.height) return;
    const ctx = this.ctx;
    const sim = this.sim;
    const geo = this.geometry();
    const cycle = sim.getCycle();
    const night = 1 - clamp(cycle.ambientLight / 0.82, 0, 1);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, geo.w, geo.h);

    this.drawSky(geo, cycle, night);
    this.drawLandscape(geo, cycle, night);
    this.drawLadder(geo, night);
    this.drawWater(geo, night);
    this.drawLamp(geo, night);
    this.drawGateAndVanes(geo, night);
    this.drawFish(geo, night);
    this.drawPredator(geo, night);
    this.drawWeather(geo, cycle);
    this.drawMeasurements(geo, cycle, night);
  }

  drawSky(geo, cycle, night) {
    const ctx = this.ctx;
    const hour = cycle.hour;
    const daylight = clamp(cycle.ambientLight / 0.92, 0, 1);
    const top = mixColor("#07131a", "#426461", daylight * 0.7);
    const bottom = mixColor("#0a1b20", "#9a9272", daylight * 0.58);
    const sky = ctx.createLinearGradient(0, 0, 0, geo.h * 0.62);
    sky.addColorStop(0, top);
    sky.addColorStop(0.68, mixColor(top, bottom, 0.72));
    sky.addColorStop(1, bottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, geo.w, geo.h * 0.66);

    if (night > 0.15) {
      for (const star of this.stars) {
        const alpha = night * (0.28 + 0.46 * (0.5 + 0.5 * Math.sin(this.sim.time * star.speed + star.phase)));
        ctx.fillStyle = `rgba(218, 233, 211, ${alpha})`;
        ctx.fillRect(star.x * geo.w, star.y * geo.h, star.size, star.size);
      }
    }

    const sunX = geo.w * (0.72 + Math.sin(((hour - 5.8) / 12.4) * Math.PI) * 0.18);
    const sunY = geo.h * (0.41 - Math.sin(((hour - 5.8) / 12.4) * Math.PI) * 0.27);
    const bodyVisible = hour > 5.5 && hour < 18.6;
    if (bodyVisible) {
      const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 48);
      glow.addColorStop(0, "rgba(244, 219, 143, 0.55)");
      glow.addColorStop(0.3, "rgba(230, 193, 118, 0.15)");
      glow.addColorStop(1, "rgba(230, 193, 118, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 48, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(248, 227, 166, 0.82)";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 6.5, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(214, 228, 212, 0.72)";
      ctx.beginPath();
      ctx.arc(geo.w * 0.78, geo.h * 0.14, 8, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(13, 27, 27, 0.82)";
      ctx.beginPath();
      ctx.arc(geo.w * 0.78 + 4, geo.h * 0.14 - 2, 7.4, 0, TAU);
      ctx.fill();
    }
  }

  drawLandscape(geo, cycle, night) {
    const ctx = this.ctx;
    const horizon = geo.h * 0.37;
    const ridges = [
      { y: 0.25, alpha: 0.32, color: "#1a312d", step: 0.1 },
      { y: 0.29, alpha: 0.55, color: "#132824", step: 0.075 },
      { y: 0.335, alpha: 0.78, color: "#0f211d", step: 0.055 },
    ];
    for (const [index, ridge] of ridges.entries()) {
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      const points = 14;
      for (let point = 0; point <= points; point += 1) {
        const x = (point / points) * geo.w;
        const peak =
          Math.sin(point * 1.73 + index * 2.1) * 0.5 +
          Math.sin(point * 0.53 + index) * 0.38 +
          Math.sin(point * 3.1) * 0.1;
        const y = geo.h * ridge.y - peak * geo.h * ridge.step;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(geo.w, horizon + 30);
      ctx.lineTo(0, horizon + 30);
      ctx.closePath();
      ctx.fillStyle = ridge.color;
      ctx.globalAlpha = ridge.alpha + night * 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = "#0b1a16";
    ctx.fillRect(0, horizon, geo.w, geo.h - horizon);
    const strata = ctx.createLinearGradient(0, horizon, 0, geo.h);
    strata.addColorStop(0, "rgba(31, 53, 42, 0.25)");
    strata.addColorStop(0.5, "rgba(16, 32, 26, 0.8)");
    strata.addColorStop(1, "rgba(6, 17, 13, 0.96)");
    ctx.fillStyle = strata;
    ctx.fillRect(0, horizon, geo.w, geo.h - horizon);

    ctx.strokeStyle = "rgba(144, 173, 150, 0.055)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 6; index += 1) {
      const y = horizon + 34 + index * 37;
      ctx.beginPath();
      for (let x = 0; x <= geo.w; x += 28) {
        const dy = Math.sin(x * 0.011 + index * 1.8) * (6 + index * 0.8);
        if (x === 0) ctx.moveTo(x, y + dy);
        else ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
  }

  drawLadder(geo, night) {
    const ctx = this.ctx;
    const { startX, endX, poolWidth, pools, floorGap, topSurface, step } = geo;

    ctx.fillStyle = "rgba(12, 25, 20, 0.9)";
    ctx.beginPath();
    ctx.moveTo(startX - 13, topSurface + 18);
    ctx.lineTo(endX + 20, topSurface + (pools - 1) * step + 18);
    ctx.lineTo(endX + 20, geo.h);
    ctx.lineTo(startX - 13, geo.h);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < pools; index += 1) {
      const x = startX + index * poolWidth;
      const surface = topSurface + index * step;
      const floor = surface + floorGap;
      const nextSurface = surface + step;

      ctx.fillStyle = index % 2 ? "rgba(35, 52, 44, 0.5)" : "rgba(29, 47, 39, 0.5)";
      ctx.fillRect(x, floor, poolWidth + 4, Math.max(0, nextSurface + floorGap - floor));

      ctx.strokeStyle = index === 0 ? "rgba(177, 206, 175, 0.22)" : "rgba(151, 180, 156, 0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, surface + 2);
      ctx.lineTo(x, floor + 2);
      ctx.lineTo(x + 11, floor + 8);
      ctx.lineTo(x + 11, surface + 2);
      ctx.stroke();

      ctx.fillStyle = "#213b31";
      ctx.beginPath();
      ctx.moveTo(x - 4, surface);
      ctx.lineTo(x + 12, surface);
      ctx.lineTo(x + 19, floor + 9);
      ctx.lineTo(x, floor + 9);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(202, 223, 199, 0.15)";
      ctx.beginPath();
      ctx.moveTo(x + 4, surface + 2);
      ctx.lineTo(x + 17, surface + 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(7, 17, 14, 0.42)";
      for (let groove = 0; groove < 3; groove += 1) {
        ctx.fillRect(x + 3 + groove * 4, floor - groove * 7, 1, 6 + groove * 4);
      }
    }

    const weirY = topSurface + (pools - 1) * step + floorGap;
    ctx.fillStyle = "#1b3027";
    ctx.beginPath();
    ctx.moveTo(endX + 13, weirY - 37);
    ctx.lineTo(endX + 31, weirY - 37);
    ctx.lineTo(endX + 34, geo.h);
    ctx.lineTo(endX + 11, geo.h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(151, 189, 167, 0.18)";
    ctx.beginPath();
    ctx.moveTo(endX + 22, weirY - 31);
    ctx.lineTo(endX + 22, geo.h);
    ctx.stroke();

    const labels = ["P1", "P2", "P3", "P4", "P5"];
    ctx.font = '7px "Noto Sans SC", monospace';
    ctx.fillStyle = "rgba(175, 204, 184, 0.37)";
    for (let index = 0; index < pools; index += 1) {
      const x = startX + index * poolWidth + 9;
      const y = topSurface + index * step + floorGap - 5;
      ctx.fillText(labels[index], x, y);
    }

    ctx.strokeStyle = `rgba(166, 199, 180, ${0.07 + night * 0.03})`;
    ctx.strokeRect(startX - 13, topSurface - 8, endX - startX + 46, geo.h - topSurface + 8);
  }

  drawWater(geo, night) {
    const ctx = this.ctx;
    const { startX, endX, poolWidth, pools, topSurface, step, floorGap } = geo;
    const sim = this.sim;
    const flowAlpha = clamp(0.27 + sim.environment.flow * 0.13, 0.28, 0.46);

    ctx.fillStyle = "rgba(16, 75, 77, 0.5)";
    ctx.beginPath();
    ctx.moveTo(0, geo.h * 0.31);
    ctx.lineTo(geo.upstreamX - 10, geo.h * 0.31);
    ctx.lineTo(geo.upstreamX - 10, geo.h * 0.82);
    ctx.lineTo(0, geo.h * 0.82);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < pools; index += 1) {
      const x = startX + index * poolWidth - 1;
      const surface = topSurface + index * step;
      const depthRatio = clamp(sim.environment.depth / 1.4, 0.2, 1);
      const waterDepth = floorGap * (0.45 + depthRatio * 0.48);
      const x2 = x + poolWidth + 3;
      const gradient = ctx.createLinearGradient(0, surface, 0, surface + waterDepth);
      gradient.addColorStop(0, `rgba(75, 183, 175, ${flowAlpha})`);
      gradient.addColorStop(0.32, `rgba(32, 122, 121, ${flowAlpha * 0.9})`);
      gradient.addColorStop(1, "rgba(9, 55, 55, 0.61)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(x, surface);
      ctx.quadraticCurveTo((x + x2) / 2, surface - 2.5, x2, surface + 1);
      ctx.lineTo(x2, surface + waterDepth);
      ctx.lineTo(x, surface + waterDepth);
      ctx.closePath();
      ctx.fill();

      const gloss = ctx.createLinearGradient(x, 0, x2, 0);
      gloss.addColorStop(0, "rgba(170, 230, 214, 0)");
      gloss.addColorStop(0.45, `rgba(190, 240, 222, ${0.12 + sim.environment.oxygen * 0.01})`);
      gloss.addColorStop(1, "rgba(170, 230, 214, 0)");
      ctx.fillStyle = gloss;
      ctx.fillRect(x, surface, poolWidth, 1);

      ctx.strokeStyle = `rgba(152, 220, 202, ${0.16 + sim.environment.flow * 0.035})`;
      ctx.lineWidth = 1;
      for (let line = 0; line < 3; line += 1) {
        const y = surface + 9 + line * 12 + Math.sin(sim.time * 0.45 + index + line) * 1.6;
        ctx.beginPath();
        ctx.moveTo(x + 9 + line * 8, y);
        ctx.bezierCurveTo(
          x + poolWidth * 0.33,
          y - 2.3,
          x + poolWidth * 0.66,
          y + 2.3,
          x2 - 7 - line * 4,
          y,
        );
        ctx.stroke();
      }

      const foamAlpha = clamp((sim.environment.flow - 0.3) * 0.45, 0.08, 0.55);
      if (index < pools - 1) {
        ctx.strokeStyle = `rgba(211, 239, 225, ${foamAlpha})`;
        ctx.lineWidth = 1.2;
        for (let foam = 0; foam < 4; foam += 1) {
          ctx.beginPath();
          ctx.moveTo(x2 - 2, surface + 2 + foam * 2);
          ctx.quadraticCurveTo(
            x2 + 5 + foam * 3,
            surface + 5 + Math.sin(sim.time * 2 + foam) * 3,
            x2 + 10 + foam * 4,
            surface + step + 2,
          );
          ctx.stroke();
        }
      }
    }

    this.drawFlowParticles(geo, night);
  }

  drawFlowParticles(geo, night) {
    const ctx = this.ctx;
    const sim = this.sim;
    const speed = 0.024 + sim.environment.flow * 0.042;
    const count = 66;
    const span = geo.endX - geo.startX;
    ctx.lineCap = "round";
    for (let index = 0; index < count; index += 1) {
      const seedA = (index * 0.61803398875) % 1;
      const seedB = (index * 0.41421356237) % 1;
      const phase = (seedA + sim.time * speed * (0.7 + seedB * 0.5) + index * 0.007) % 1;
      const x = geo.startX + phase * span;
      const surface = this.surfaceAt(x, geo);
      const depth = geo.floorGap * (0.26 + seedB * 0.54);
      const y = surface + 8 + depth;
      const alpha = (0.09 + seedB * 0.2) * (night > 0.5 ? 0.8 : 1);
      ctx.strokeStyle = `rgba(156, 231, 214, ${alpha})`;
      ctx.lineWidth = seedB > 0.7 ? 1.15 : 0.7;
      ctx.beginPath();
      ctx.moveTo(x - 5 - seedB * 9, y + Math.sin(sim.time * 1.2 + index) * 0.8);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  drawLamp(geo, night) {
    const ctx = this.ctx;
    const strength = clamp(this.sim.controls.lamp / 100, 0, 1);
    const lamps = [
      { x: geo.w * 0.255, y: geo.h * 0.19, targetX: geo.w * 0.34 },
      { x: geo.w * 0.63, y: geo.h * 0.2, targetX: geo.w * 0.7 },
    ];
    for (const [index, lamp] of lamps.entries()) {
      const surface = this.surfaceAt(lamp.targetX, geo);
      const beamAlpha = (0.08 + strength * 0.18) * (0.35 + night * 0.65);
      const beam = ctx.createLinearGradient(lamp.x, lamp.y, lamp.targetX, surface);
      beam.addColorStop(0, `rgba(255, 231, 165, ${beamAlpha + 0.035})`);
      beam.addColorStop(0.46, `rgba(255, 219, 144, ${beamAlpha * 0.74})`);
      beam.addColorStop(1, `rgba(255, 209, 122, ${beamAlpha * 0.22})`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(lamp.x - 2, lamp.y);
      ctx.lineTo(lamp.targetX - geo.w * (0.09 + strength * 0.08), surface + 18);
      ctx.lineTo(lamp.targetX + geo.w * (0.1 + strength * 0.08), surface + 18);
      ctx.lineTo(lamp.x + 2, lamp.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(161, 183, 164, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lamp.x, geo.h * 0.64);
      ctx.lineTo(lamp.x, lamp.y);
      ctx.lineTo(lamp.x + 9, lamp.y + 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 229, 154, ${0.55 + strength * 0.4})`;
      ctx.beginPath();
      ctx.arc(lamp.x + 9, lamp.y + 2, 2.3 + strength * 0.8, 0, TAU);
      ctx.fill();

      if (night > 0.2) {
        const glow = ctx.createRadialGradient(lamp.x + 9, lamp.y + 2, 0, lamp.x + 9, lamp.y + 2, 19);
        glow.addColorStop(0, `rgba(255, 231, 164, ${0.27 * strength})`);
        glow.addColorStop(1, "rgba(255, 231, 164, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(lamp.x - 20, lamp.y - 20, 50, 45);
      }

      ctx.font = '6px "Noto Sans SC", monospace';
      ctx.fillStyle = "rgba(191, 212, 195, 0.4)";
      ctx.fillText(`L${index + 1} ${Math.round(this.sim.controls.lamp)}%`, lamp.x - 2, lamp.y - 5);
    }
  }

  drawGateAndVanes(geo, night) {
    const ctx = this.ctx;
    const sim = this.sim;
    const gateOpen = sim.controls.gate / 100;
    const gateX = geo.upstreamX - 8;
    const gateTop = geo.h * 0.245;
    const gateBottom = geo.topSurface + 2;
    const opening = 7 + gateOpen * 31;

    ctx.fillStyle = "#263d32";
    ctx.beginPath();
    ctx.moveTo(gateX - 13, gateTop - 8);
    ctx.lineTo(gateX + 4, gateTop - 8);
    ctx.lineTo(gateX + 10, geo.h * 0.87);
    ctx.lineTo(gateX - 18, geo.h * 0.87);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(170, 199, 177, 0.21)";
    ctx.stroke();

    ctx.fillStyle = "#385446";
    ctx.fillRect(gateX - 5, gateBottom - opening - 21, 15, 20);
    ctx.fillStyle = "rgba(214, 238, 104, 0.68)";
    ctx.fillRect(gateX + 1, gateBottom - opening, 2, opening);
    ctx.strokeStyle = "rgba(201, 223, 207, 0.25)";
    for (let index = 0; index < 6; index += 1) {
      const y = gateTop + 13 + index * 19;
      ctx.beginPath();
      ctx.moveTo(gateX - 10, y);
      ctx.lineTo(gateX + 4, y);
      ctx.stroke();
    }
    ctx.font = '6px "Noto Sans SC", monospace';
    ctx.fillStyle = "rgba(214, 238, 104, 0.55)";
    ctx.fillText(`GATE ${sim.controls.gate}%`, gateX - 30, gateTop - 13);

    const angle = lerp(-0.22, 0.52, sim.controls.vane / 100);
    const baseX = geo.startX + geo.poolWidth * 0.53;
    const baseY = geo.topSurface + geo.floorGap * 0.64;
    for (let index = 0; index < 3; index += 1) {
      ctx.save();
      ctx.translate(baseX + index * 19, baseY);
      ctx.rotate(angle);
      ctx.fillStyle = `rgba(173, 198, 168, ${0.25 + index * 0.045})`;
      ctx.beginPath();
      ctx.roundRect(-3, -26, 6, 31, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(217, 233, 207, 0.24)";
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(230, 184, 92, 0.58)";
    ctx.font = '6px "Noto Sans SC", monospace';
    ctx.fillText("VANES", baseX - 4, baseY - 34);
  }

  fishPosition(fish, geo) {
    const u = clamp(fish.u, 0, 1);
    const x = geo.fishDownstreamX + (geo.fishUpstreamX - geo.fishDownstreamX) * u;
    const surface = this.surfaceAt(x, geo);
    const laneOffset = (fish.lane || 0) * 4 + Math.sin(this.sim.time * 0.9 + fish.index * 1.7) * 2.2;
    const depth = Math.min(geo.floorGap * 0.58, 17 + fish.index * 3.3);
    return {
      x,
      y: surface + 11 + depth + laneOffset,
      surface,
    };
  }

  drawFish(geo, night) {
    const ctx = this.ctx;
    const sim = this.sim;
    for (const fish of sim.fish) {
      const species = SPECIES[fish.species];
      const position = this.fishPosition(fish, geo);
      const direction = fish.state === "retreating" ? 1 : -1;
      const active = fish.state === "moving";
      const passed = fish.state === "passed";
      const trapped = fish.state === "trapped";
      const scale = (0.75 + fish.size * 0.31) * (passed ? 0.8 : 1);
      const alpha = passed ? 0.38 : 1;

      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.scale(direction * scale, scale);
      ctx.globalAlpha = alpha;

      if (active) {
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
        halo.addColorStop(0, rgba(species.color, 0.2));
        halo.addColorStop(1, rgba(species.color, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(-20, -18, 40, 36);
      }

      if (fish.species === "eel") {
        ctx.strokeStyle = species.color;
        ctx.lineWidth = 2.3;
        ctx.lineCap = "round";
        ctx.beginPath();
        const sway = Math.sin(sim.time * (active ? 5 : 2.2) + fish.index * 1.4) * 3;
        ctx.moveTo(10, 0);
        ctx.bezierCurveTo(4, sway, -2, -sway, -13, sway * 0.45);
        ctx.stroke();
        ctx.fillStyle = species.soft;
        ctx.beginPath();
        ctx.arc(10, 0, 1.3, 0, TAU);
        ctx.fill();
      } else {
        const bodyGradient = ctx.createLinearGradient(-10, -4, 7, 5);
        bodyGradient.addColorStop(0, species.color);
        bodyGradient.addColorStop(1, mixColor(species.color, "#1e403b", 0.38));
        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.ellipse(-1, 0, 10, 4.4, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(species.color, 0.75);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(14, -4.5);
        ctx.lineTo(13, 0);
        ctx.lineTo(14, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba(species.soft, 0.42);
        ctx.beginPath();
        ctx.moveTo(-4, -3.2);
        ctx.lineTo(-1, -7);
        ctx.lineTo(3, -3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#f4f1dc";
        ctx.beginPath();
        ctx.arc(-7.2, -0.9, 0.9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#142521";
        ctx.beginPath();
        ctx.arc(-7.4, -0.9, 0.42, 0, TAU);
        ctx.fill();
      }

      if (trapped) {
        ctx.strokeStyle = "rgba(255, 121, 111, 0.6)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, 15 + Math.sin(sim.time * 3) * 1.6, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      if (!passed && (fish.index === 0 || fish.u > 0.45)) {
        ctx.font = '5.8px "Noto Sans SC", monospace';
        ctx.textAlign = "center";
        ctx.fillStyle = rgba(species.soft, active ? 0.8 : 0.52);
        ctx.fillText(fish.id, position.x, position.y - 9 * scale);
        ctx.textAlign = "left";
      }
    }
  }

  drawPredator(geo, night) {
    if (!this.sim.predatorActive) return;
    const ctx = this.ctx;
    const x = geo.endX + 20;
    const y = this.surfaceAt(x, geo) + 23;
    const pulse = 0.5 + 0.5 * Math.sin(this.sim.time * 1.8);

    ctx.strokeStyle = `rgba(255, 121, 111, ${0.1 + pulse * 0.11})`;
    for (let ring = 1; ring <= 3; ring += 1) {
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(x - 29, y + 2, ring * 8 + pulse * 4, ring * 2.2, 0, 0, TAU);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(x - 27, y);
    ctx.fillStyle = "rgba(5, 13, 12, 0.91)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 6.8, -0.08, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(25, -6);
    ctx.lineTo(24, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 121, 111, 0.58)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(-13, -1.6, 1.2, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 121, 111, 0.8)";
    ctx.beginPath();
    ctx.arc(-13, -1.6, 0.65, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.font = '5.8px "Noto Sans SC", monospace';
    ctx.fillStyle = `rgba(255, 121, 111, ${0.48 + pulse * 0.3})`;
    ctx.fillText("PREDATOR / 下游滞留区", x - 71, y - 12);
  }

  drawWeather(geo, cycle) {
    const ctx = this.ctx;
    const weather = cycle.weather;
    if (weather.icon === "rain") {
      ctx.strokeStyle = "rgba(159, 207, 205, 0.19)";
      ctx.lineWidth = 0.7;
      for (let index = 0; index < 70; index += 1) {
        const seed = (index * 0.61803398875) % 1;
        const x = (seed * geo.w + this.sim.time * 35 * (0.6 + seed)) % geo.w;
        const y = ((index * 41 + this.sim.time * 130) % (geo.h * 0.7)) - 20;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 10);
        ctx.stroke();
      }
    } else if (weather.icon === "mist") {
      const mist = ctx.createLinearGradient(0, geo.h * 0.26, 0, geo.h * 0.72);
      mist.addColorStop(0, "rgba(175, 199, 188, 0)");
      mist.addColorStop(0.5, "rgba(175, 199, 188, 0.07)");
      mist.addColorStop(1, "rgba(175, 199, 188, 0)");
      ctx.fillStyle = mist;
      ctx.fillRect(0, geo.h * 0.2, geo.w, geo.h * 0.62);
    }

    ctx.strokeStyle = "rgba(199, 221, 209, 0.08)";
    for (let index = 0; index < 3; index += 1) {
      const x = geo.w * (0.08 + index * 0.38) + Math.sin(this.sim.time * 0.08 + index) * 16;
      const y = geo.h * (0.12 + (index % 2) * 0.045);
      ctx.beginPath();
      ctx.moveTo(x, y + 4);
      ctx.bezierCurveTo(x + 20, y - 5, x + 44, y + 3, x + 58, y);
      ctx.stroke();
    }
  }

  drawMeasurements(geo, cycle, night) {
    const ctx = this.ctx;
    const sim = this.sim;
    const upstreamY = geo.h * 0.31;
    const downstreamSurface = this.surfaceAt(geo.endX - 50, geo);
    const headPx = Math.abs(downstreamSurface - upstreamY);
    const markerX = geo.w * 0.12;

    ctx.strokeStyle = "rgba(214, 238, 104, 0.34)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(markerX, upstreamY);
    ctx.lineTo(markerX, downstreamSurface);
    ctx.stroke();
    ctx.fillStyle = "rgba(214, 238, 104, 0.54)";
    for (const y of [upstreamY, downstreamSurface]) {
      ctx.beginPath();
      ctx.moveTo(markerX - 3, y);
      ctx.lineTo(markerX + 3, y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(markerX - 7, (upstreamY + downstreamSurface) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '6px "Noto Sans SC", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(214, 238, 104, 0.62)";
    ctx.fillText(`ΔH ${sim.environment.head.toFixed(2)} m`, 0, 0);
    ctx.restore();
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(184, 212, 197, 0.42)";
    ctx.font = '6.5px "Noto Sans SC", monospace';
    ctx.fillText("UPSTREAM / 上游库区", 19, upstreamY - 10);
    ctx.fillText("TAILWATER / 尾水", geo.w * 0.75, downstreamSurface - 9);

    ctx.fillStyle = "rgba(214, 238, 104, 0.45)";
    ctx.fillText(
      `FLOW ${sim.environment.flow.toFixed(2)} m/s  ·  ${cycle.weatherLabel}  ·  ${cycle.timeLabel}`,
      geo.w * 0.38,
      geo.h * 0.075,
    );

    if (headPx < 120) {
      ctx.strokeStyle = "rgba(230, 184, 92, 0.26)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(geo.w * 0.23, geo.topSurface - 2);
      ctx.lineTo(geo.endX, geo.lastSurface - 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
