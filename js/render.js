import { createRng } from "./rng.js";

const WIDTH = 1120;
const HEIGHT = 620;
const BEDS = [
  { x: 92, y: 415, width: 292, center: 238 },
  { x: 414, y: 415, width: 292, center: 560 },
  { x: 736, y: 415, width: 292, center: 882 },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (from, to, amount) => Math.round(from + (to - from) * amount);

export class GreenhouseRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.time = 0;
    this.initialized = false;
    this.pollenMotes = [];
    this.resetDust();
  }

  reset(sim) {
    const rng = createRng(`${sim.seed}:visual-bumblebees`);
    this.time = 0;
    this.initialized = true;
    this.beeSeed = sim.seed;
    this.trailClock = 0;
    this.bees = Array.from({ length: 34 }, (_, index) => {
      const crop = rng.int(0, 2);
      return {
        id: index === 0 ? sim.trackedBee.id : `B-${String(rng.int(55, 99))}`,
        crop,
        phase: rng.between(0, Math.PI * 2),
        frequency: rng.between(0.35, 0.72),
        vertical: rng.between(0.3, 0.58),
        size: rng.between(2.8, 4.5),
        drift: rng.between(55, 125),
        trail: [],
        x: 48,
        y: 426,
      };
    });
    this.bees[0].size = 5.1;
    this.bees[0].frequency = 0.46;
    this.bees[0].drift = 104;
  }

  resetDust() {
    const rng = createRng("greenhouse-ambient-dust");
    this.dust = Array.from({ length: 42 }, () => ({
      x: rng.between(30, WIDTH - 30),
      y: rng.between(130, 510),
      radius: rng.between(0.5, 1.8),
      phase: rng.between(0, Math.PI * 2),
      speed: rng.between(0.2, 0.75),
    }));
  }

  update(sim, realSeconds, speed) {
    if (!this.initialized || this.beeSeed !== sim.seed) this.reset(sim);
    if (!sim.running || sim.ended) return;
    this.time += realSeconds * speed;
    this.trailClock += realSeconds * speed;
    const active = Math.ceil(clamp(sim.activeBees, 0, this.bees.length));
    const shouldTrail = this.trailClock > 0.045;
    if (shouldTrail) this.trailClock = 0;
    this.bees.forEach((bee, index) => {
      bee.active = index < active;
      if (!bee.active) {
        bee.trail.length = 0;
        return;
      }
      const layout = this.flowerLayout(sim, bee.crop);
      const anchor = layout[(index * 3 + 1) % layout.length];
      const t = this.time + bee.phase;
      const x =
        anchor.x +
        Math.sin(t * bee.frequency) * bee.drift +
        Math.cos(t * 0.27 + bee.phase) * 22;
      const y =
        anchor.y -
        38 +
        Math.sin(t * bee.vertical + bee.phase) * 49 +
        Math.cos(t * 0.71) * 16;
      bee.x = x;
      bee.y = clamp(y, 174, 447);
      if (shouldTrail) {
        bee.trail.push({ x: bee.x, y: bee.y });
        if (bee.trail.length > (index === 0 ? 24 : 14)) bee.trail.shift();
      }
    });
  }

  flowerLayout(sim, cropIndex) {
    const crop = sim.crops[cropIndex];
    const bed = BEDS[cropIndex];
    return crop.flowers.map((_, index) => {
      const plant = Math.floor(index / 3);
      const slot = index % 3;
      return {
        x: bed.x + 64 + plant * 82 + (slot - 1) * 18,
        y: bed.y - 62 - (index % 2) * 25 + plant * 6,
        index,
      };
    });
  }

  draw(sim) {
    if (!this.initialized) this.reset(sim);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.drawBackground(sim);
    this.drawThermalZone(sim);
    this.drawGlassStructure(sim);
    this.drawWeather(sim);
    this.drawHaze(sim);
    this.drawBeds(sim);
    this.drawHive(sim);
    this.drawFan(sim);
    this.drawBees(sim);
    this.drawForeground(sim);
  }

  warmColor(value) {
    if (value < 19) return { r: 111, g: 171, b: 184, alpha: 0.1 };
    if (value <= 28) return { r: 158, g: 190, b: 107, alpha: 0.045 };
    return {
      r: mix(211, 238, clamp((value - 28) / 8, 0, 1)),
      g: mix(156, 101, clamp((value - 28) / 8, 0, 1)),
      b: 89,
      alpha: 0.06 + clamp((value - 28) / 24, 0, 0.1),
    };
  }

  drawBackground(sim) {
    const ctx = this.ctx;
    const light = clamp(sim.light / 900, 0, 1);
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, `rgb(${mix(13, 42, light)}, ${mix(26, 61, light)}, ${mix(24, 47, light)})`);
    sky.addColorStop(0.48, `rgb(${mix(18, 56, light)}, ${mix(39, 83, light)}, ${mix(30, 59, light)})`);
    sky.addColorStop(0.72, "#1b2c20");
    sky.addColorStop(1, "#17271b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const glow = ctx.createRadialGradient(900, 116, 10, 900, 116, 440);
    glow.addColorStop(0, `rgba(255, 219, 143, ${0.12 + light * 0.28})`);
    glow.addColorStop(0.45, `rgba(239, 193, 102, ${0.03 + light * 0.08})`);
    glow.addColorStop(1, "rgba(239, 193, 102, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.2 + light * 0.12;
    ctx.fillStyle = "#76a362";
    ctx.beginPath();
    ctx.moveTo(0, 355);
    ctx.bezierCurveTo(100, 320, 172, 366, 262, 338);
    ctx.bezierCurveTo(390, 300, 452, 355, 576, 326);
    ctx.bezierCurveTo(718, 294, 825, 350, 928, 318);
    ctx.bezierCurveTo(1010, 295, 1080, 322, WIDTH, 306);
    ctx.lineTo(WIDTH, 490);
    ctx.lineTo(0, 490);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const ground = ctx.createLinearGradient(0, 420, 0, HEIGHT);
    ground.addColorStop(0, "#283521");
    ground.addColorStop(0.52, "#1e2b1d");
    ground.addColorStop(1, "#152116");
    ctx.fillStyle = ground;
    ctx.fillRect(0, 468, WIDTH, HEIGHT - 468);

    ctx.save();
    ctx.strokeStyle = "rgba(224, 237, 209, 0.035)";
    ctx.lineWidth = 1;
    for (let x = -80; x < WIDTH + 100; x += 62) {
      ctx.beginPath();
      ctx.moveTo(x, HEIGHT);
      ctx.lineTo(x + 190, 470);
      ctx.stroke();
    }
    ctx.restore();

    const tint = this.warmColor(sim.temperature);
    ctx.fillStyle = `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${tint.alpha})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  drawThermalZone(sim) {
    const ctx = this.ctx;
    const x = 34;
    const y = 92;
    const width = 644;
    const height = 34;
    ctx.save();
    ctx.fillStyle = "rgba(7, 15, 10, 0.55)";
    this.roundRect(ctx, x, y, width, height, 8);
    ctx.fill();

    const gradient = ctx.createLinearGradient(x + 8, 0, x + width - 8, 0);
    gradient.addColorStop(0, "#659ba9");
    gradient.addColorStop(0.32, "#8caf73");
    gradient.addColorStop(0.58, "#b7ce82");
    gradient.addColorStop(0.78, "#e1b35e");
    gradient.addColorStop(1, "#d36f50");
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.78;
    this.roundRect(ctx, x + 8, y + 19, width - 16, 5, 3);
    ctx.fill();
    ctx.globalAlpha = 1;

    const marker = clamp((sim.temperature - 15) / 22, 0, 1);
    const markerX = x + 8 + marker * (width - 16);
    ctx.strokeStyle = "rgba(245, 237, 216, 0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(markerX, y + 13);
    ctx.lineTo(markerX, y + 29);
    ctx.stroke();
    ctx.fillStyle = "#fbf2df";
    ctx.beginPath();
    ctx.arc(markerX, y + 16, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(233, 240, 224, 0.62)";
    ctx.font = "9px 'Bee Sans SC', monospace";
    ctx.textAlign = "left";
    ctx.fillText("温区 / THERMAL GRADIENT", x + 10, y + 13);
    ctx.fillStyle = "rgba(233, 240, 224, 0.38)";
    ctx.font = "7px 'Bee Sans SC', monospace";
    ctx.fillText("15°", x + 9, y + 32);
    ctx.fillText("22°", x + width * 0.32, y + 32);
    ctx.fillText("28°", x + width * 0.58, y + 32);
    ctx.fillText("37°", x + width - 24, y + 32);
    ctx.restore();
  }

  drawGlassStructure(sim) {
    const ctx = this.ctx;
    ctx.save();

    const glass = ctx.createLinearGradient(0, 30, 0, 440);
    glass.addColorStop(0, "rgba(192, 221, 199, 0.035)");
    glass.addColorStop(0.6, "rgba(204, 228, 206, 0.014)");
    glass.addColorStop(1, "rgba(204, 228, 206, 0.002)");
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(0, 146);
    ctx.lineTo(190, 26);
    ctx.lineTo(930, 26);
    ctx.lineTo(WIDTH, 146);
    ctx.lineTo(WIDTH, 470);
    ctx.lineTo(0, 470);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(220, 235, 216, 0.13)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 146);
    ctx.lineTo(190, 26);
    ctx.lineTo(930, 26);
    ctx.lineTo(WIDTH, 146);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 470);
    ctx.lineTo(WIDTH, 470);
    ctx.stroke();

    ctx.strokeStyle = "rgba(220, 235, 216, 0.055)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x += 140) {
      ctx.beginPath();
      ctx.moveTo(x, 146 + (x < 190 ? (190 - x) * 0.63 : x > 930 ? (x - 930) * 0.63 : 0));
      ctx.lineTo(x, 470);
      ctx.stroke();
    }
    for (let y = 204; y < 470; y += 88) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(244, 238, 217, 0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, 466);
    ctx.lineTo(26, 120);
    ctx.moveTo(WIDTH - 26, 466);
    ctx.lineTo(WIDTH - 26, 120);
    ctx.stroke();

    ctx.globalAlpha = 0.11 + clamp(sim.solar, 0, 1) * 0.13;
    const reflection = ctx.createLinearGradient(0, 150, 420, 380);
    reflection.addColorStop(0, "rgba(255,255,255,0)");
    reflection.addColorStop(0.5, "rgba(240,247,227,0.8)");
    reflection.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.moveTo(124, 158);
    ctx.lineTo(185, 158);
    ctx.lineTo(70, 448);
    ctx.lineTo(18, 448);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawWeather(sim) {
    const ctx = this.ctx;
    const weather = sim.weatherAt(sim.minutes);
    const sunX = 870;
    const sunY = 160;
    const light = clamp(sim.solar, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.2 + light * 0.7;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 57);
    sunGlow.addColorStop(0, "rgba(255, 235, 176, 0.9)");
    sunGlow.addColorStop(0.12, "rgba(255, 219, 143, 0.6)");
    sunGlow.addColorStop(0.55, "rgba(255, 199, 103, 0.1)");
    sunGlow.addColorStop(1, "rgba(255, 199, 103, 0)");
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 57, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.72 + light * 0.2;
    ctx.fillStyle = "#f6d88f";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 8 + light * 3, 0, Math.PI * 2);
    ctx.fill();

    const cloudAlpha = clamp(0.22 + weather.cloud * 0.68, 0, 1);
    ctx.globalAlpha = cloudAlpha;
    ctx.fillStyle = "rgba(202, 218, 196, 0.3)";
    this.cloud(ctx, 758, 169, 1.08, 0.78);
    this.cloud(ctx, 1001, 221, 0.78, 0.55);
    ctx.restore();
  }

  cloud(ctx, x, y, scale, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.arc(x, y, 22 * scale, 0, Math.PI * 2);
    ctx.arc(x + 25 * scale, y - 10 * scale, 28 * scale, 0, Math.PI * 2);
    ctx.arc(x + 57 * scale, y, 20 * scale, 0, Math.PI * 2);
    ctx.rect(x - 2, y, 64 * scale, 20 * scale);
    ctx.fill();
    ctx.restore();
  }

  drawHaze(sim) {
    const ctx = this.ctx;
    ctx.save();
    for (const mote of this.dust) {
      const x = mote.x + Math.sin(this.time * mote.speed + mote.phase) * 13;
      const y = mote.y + Math.cos(this.time * mote.speed * 0.8 + mote.phase) * 9;
      ctx.fillStyle = `rgba(229, 239, 212, ${0.045 + mote.radius * 0.025})`;
      ctx.beginPath();
      ctx.arc(x, y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sim.temperature > 29) {
      const intensity = clamp((sim.temperature - 29) / 7, 0, 1);
      ctx.strokeStyle = `rgba(253, 193, 102, ${intensity * 0.11})`;
      ctx.lineWidth = 1;
      for (let index = 0; index < 8; index += 1) {
        const x = 112 + index * 127;
        ctx.beginPath();
        for (let y = 470; y > 175; y -= 32) {
          const wave = Math.sin(this.time * 0.9 + y * 0.055 + index) * 5 * intensity;
          if (y === 470) ctx.moveTo(x + wave, y);
          else ctx.lineTo(x + wave, y);
        }
        ctx.stroke();
      }
    }

    if (sim.pesticideResidual > 0.03) {
      const alpha = clamp(sim.pesticideResidual, 0, 1);
      for (let index = 0; index < 22; index += 1) {
        const phase = index * 1.73;
        const x = 120 + ((index * 47) % 880) + Math.sin(this.time * 0.3 + phase) * 18;
        const y = 442 - ((this.time * (11 + (index % 5) * 3) + index * 23) % 250);
        ctx.fillStyle = `rgba(198, 218, 142, ${alpha * 0.18})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + (index % 3) * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawBeds(sim) {
    sim.crops.forEach((crop, cropIndex) => {
      this.drawBed(sim, crop, cropIndex);
    });
  }

  drawBed(sim, crop, cropIndex) {
    const ctx = this.ctx;
    const bed = BEDS[cropIndex];
    const time = this.time;
    ctx.save();

    const shadow = ctx.createLinearGradient(0, bed.y, 0, HEIGHT);
    shadow.addColorStop(0, "rgba(3, 8, 4, 0.14)");
    shadow.addColorStop(1, "rgba(3, 8, 4, 0.34)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(bed.center, 502, 160, 28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#34452d";
    this.roundRect(ctx, bed.x, bed.y, bed.width, 74, 7);
    ctx.fill();
    ctx.fillStyle = "#24351f";
    this.roundRect(ctx, bed.x + 7, bed.y + 8, bed.width - 14, 51, 4);
    ctx.fill();

    const soil = ctx.createLinearGradient(0, bed.y + 12, 0, bed.y + 54);
    soil.addColorStop(0, "#4f4130");
    soil.addColorStop(1, "#30291e");
    ctx.fillStyle = soil;
    this.roundRect(ctx, bed.x + 11, bed.y + 12, bed.width - 22, 36, 3);
    ctx.fill();

    ctx.strokeStyle = "rgba(226, 214, 177, 0.16)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 3; index += 1) {
      const plantX = bed.x + 64 + index * 82;
      ctx.beginPath();
      ctx.moveTo(plantX - 15, bed.y - 4);
      ctx.quadraticCurveTo(plantX, bed.y + 34, plantX + 17, bed.y - 4);
      ctx.stroke();
    }

    const layout = this.flowerLayout(sim, cropIndex);
    const plantX = [bed.x + 64, bed.x + 146, bed.x + 228];
    plantX.forEach((x, plantIndex) => {
      this.drawPlant(sim, crop, x, bed.y + 34, plantIndex, cropIndex);
    });

    for (const position of layout) {
      const flower = crop.flowers[position.index];
      const visited = crop.pollination >= flower.threshold * 0.82;
      const fruit = crop.pollination >= 100 && crop.pollination >= flower.threshold;
      if (fruit) this.drawFruit(crop, position.x, position.y + 5, flower.id);
      else this.drawFlower(crop, position, flower, visited);
    }

    this.drawBedPlaque(sim, crop, bed, cropIndex);
    ctx.restore();
  }

  drawPlant(sim, crop, x, baseY, plantIndex, cropIndex) {
    const ctx = this.ctx;
    const sway = Math.sin(this.time * 0.72 + plantIndex * 1.7 + cropIndex) * 2.5;
    const top = BEDS[cropIndex].y - 85 - plantIndex * 3;
    ctx.strokeStyle = "#43653b";
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.bezierCurveTo(x - 5, baseY - 50, x + 8 + sway, top + 58, x + sway, top);
    ctx.stroke();

    ctx.fillStyle = crop.leaf;
    for (let index = 0; index < 3; index += 1) {
      const y = baseY - 20 - index * 22;
      const side = index % 2 === 0 ? -1 : 1;
      ctx.save();
      ctx.translate(x + side * 4, y);
      ctx.rotate(side * (0.42 + index * 0.05) + sway * 0.008);
      ctx.beginPath();
      ctx.ellipse(side * 14, 0, 18 - index * 2, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (cropIndex === 2) {
      ctx.strokeStyle = "rgba(99, 132, 75, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + sway, top + 18);
      ctx.lineTo(x + sway - 8, top + 3);
      ctx.stroke();
    }
  }

  drawFlower(crop, position, flower, visited) {
    const ctx = this.ctx;
    const sway = Math.sin(this.time * 0.9 + flower.phase) * 1.5;
    ctx.save();
    ctx.translate(position.x + sway, position.y);
    if (visited) {
      ctx.shadowBlur = 9;
      ctx.shadowColor = "rgba(241, 188, 99, 0.6)";
    }
    for (let petal = 0; petal < 5; petal += 1) {
      ctx.save();
      ctx.rotate((petal / 5) * Math.PI * 2 + flower.phase * 0.08);
      ctx.fillStyle = crop.flower;
      ctx.globalAlpha = visited ? 0.94 : 0.72;
      ctx.beginPath();
      ctx.ellipse(0, -5.4, 3.3, 6.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = visited ? "#d59638" : "#b9a45e";
    ctx.beginPath();
    ctx.arc(0, 0, 2.7, 0, Math.PI * 2);
    ctx.fill();
    if (visited) {
      ctx.strokeStyle = "rgba(255, 218, 143, 0.72)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFruit(crop, x, y, id) {
    const ctx = this.ctx;
    const sway = Math.sin(this.time * 0.7 + x * 0.03) * 1.1;
    ctx.save();
    ctx.translate(x + sway, y);
    ctx.shadowBlur = 8;
    ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
    if (crop.id === "tomato") {
      ctx.fillStyle = "#db5e3d";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 216, 166, 0.48)";
      ctx.beginPath();
      ctx.arc(-2, -2.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#4f7a48";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -11);
      ctx.moveTo(-3, -8);
      ctx.lineTo(3, -8);
      ctx.stroke();
    } else if (crop.id === "strawberry") {
      ctx.fillStyle = "#cf4a40";
      ctx.beginPath();
      ctx.moveTo(0, 9);
      ctx.bezierCurveTo(-10, 1, -8, -7, 0, -6);
      ctx.bezierCurveTo(8, -7, 10, 1, 0, 9);
      ctx.fill();
      ctx.fillStyle = "#f1d394";
      for (const [sx, sy] of [[-3, 1], [3, 0], [0, 4]]) {
        ctx.beginPath();
        ctx.arc(sx, sy, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#557b49";
      ctx.beginPath();
      ctx.ellipse(0, -7, 7, 2.3, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#d5a13a";
      ctx.beginPath();
      ctx.ellipse(0, 2, 4.4, 9.5, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 225, 154, 0.4)";
      ctx.beginPath();
      ctx.ellipse(-1.6, 0, 1.2, 5, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#527a48";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -11);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBedPlaque(sim, crop, bed, cropIndex) {
    const ctx = this.ctx;
    const x = bed.center;
    const y = 255 - (cropIndex % 2) * 8;
    const complete = crop.pollination >= 100;
    const status = complete ? "坐果完成" : crop.pollination > 20 ? "访花中" : "等待授粉";
    ctx.save();
    ctx.fillStyle = "rgba(12, 23, 16, 0.64)";
    this.roundRect(ctx, x - 76, y, 152, 39, 8);
    ctx.fill();
    ctx.strokeStyle = complete ? "rgba(241, 188, 99, 0.28)" : "rgba(226, 236, 216, 0.1)";
    ctx.lineWidth = 1;
    this.roundRect(ctx, x - 76, y, 152, 39, 8);
    ctx.stroke();

    ctx.fillStyle = "#e9efe3";
    ctx.font = "600 12px 'Bee Sans SC', sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(crop.name, x - 65, y + 15);
    ctx.fillStyle = complete ? "#f1bc63" : "rgba(157, 170, 157, 0.84)";
    ctx.font = "8px 'Bee Sans SC', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(crop.pollination)}%`, x + 65, y + 15);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(157, 170, 157, 0.66)";
    ctx.font = "7px 'Bee Sans SC', sans-serif";
    ctx.fillText(`${status} · ${crop.flowerCount} 朵`, x - 65, y + 29);

    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    this.roundRect(ctx, x - 65, y + 32, 130, 2, 1);
    ctx.fill();
    ctx.fillStyle = complete ? "#dba84f" : "#b9d98a";
    this.roundRect(ctx, x - 65, y + 32, 130 * (crop.pollination / 100), 2, 1);
    ctx.fill();
    ctx.restore();
  }

  drawHive(sim) {
    const ctx = this.ctx;
    const x = 10;
    const y = 347;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(53, 457, 54, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    const wood = ctx.createLinearGradient(x, y, x + 86, y + 105);
    wood.addColorStop(0, "#9a713e");
    wood.addColorStop(1, "#5a4027");
    ctx.fillStyle = wood;
    this.roundRect(ctx, x, y, 84, 105, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 223, 164, 0.17)";
    ctx.lineWidth = 1;
    for (let line = 1; line < 4; line += 1) {
      ctx.beginPath();
      ctx.moveTo(x + 7, y + line * 22);
      ctx.lineTo(x + 77, y + line * 22);
      ctx.stroke();
    }
    ctx.fillStyle = "#21170f";
    this.roundRect(ctx, x + 28, y + 78, 29, 9, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(241, 188, 99, 0.9)";
    ctx.font = "7px 'Bee Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText("HIVE 04", x + 42, y + 17);
    ctx.fillStyle = "rgba(242, 230, 205, 0.64)";
    ctx.fillText(`${sim.trackedBee.id}`, x + 42, y + 29);
    ctx.fillStyle = "rgba(230, 196, 133, 0.6)";
    ctx.font = "6px 'Bee Sans SC', monospace";
    ctx.fillText("TARGET", x + 42, y + 39);
    if (sim.activeBees > 0.2) {
      ctx.strokeStyle = "rgba(241, 188, 99, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 68, y + 88);
      ctx.bezierCurveTo(110, 400, 148, 390, 180, 360);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawFan(sim) {
    const ctx = this.ctx;
    const x = 1038;
    const y = 161;
    const speed = sim.controls.fan + (sim.ventMinutes > 0 ? 1.6 : 0);
    const rotation = this.time * (0.4 + speed * 1.1);
    ctx.save();
    ctx.strokeStyle = "rgba(213, 230, 207, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(213, 230, 207, 0.1)";
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    for (let blade = 0; blade < 4; blade += 1) {
      ctx.save();
      ctx.rotate((blade / 4) * Math.PI * 2);
      ctx.fillStyle = speed > 0 ? "rgba(178, 207, 184, 0.31)" : "rgba(178, 207, 184, 0.14)";
      ctx.beginPath();
      ctx.moveTo(4, -3);
      ctx.quadraticCurveTo(17, -13, 21, -3);
      ctx.quadraticCurveTo(16, 4, 4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "rgba(239, 226, 196, 0.62)";
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(228, 237, 219, 0.36)";
    ctx.font = "6px 'Bee Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText(`FAN ${sim.controls.fan}`, x, y + 42);
    ctx.restore();
  }

  drawBees(sim) {
    const ctx = this.ctx;
    const active = this.bees.filter((bee) => bee.active);
    ctx.save();
    for (const bee of active) {
      if (bee.trail.length < 2) continue;
      ctx.lineWidth = bee === this.bees[0] ? 1.4 : 0.9;
      for (let index = 1; index < bee.trail.length; index += 1) {
        const alpha = (index / bee.trail.length) * (bee === this.bees[0] ? 0.38 : 0.18);
        ctx.strokeStyle =
          bee === this.bees[0]
            ? `rgba(241, 188, 99, ${alpha})`
            : `rgba(200, 224, 166, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(bee.trail[index - 1].x, bee.trail[index - 1].y);
        ctx.lineTo(bee.trail[index].x, bee.trail[index].y);
        ctx.stroke();
      }
    }

    for (const bee of active) {
      this.drawBee(bee, bee === this.bees[0]);
    }
    if (this.bees[0].active) {
      const bee = this.bees[0];
      ctx.strokeStyle = "rgba(241, 188, 99, 0.56)";
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(bee.x, bee.y, 14 + Math.sin(this.time * 3.2) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(12, 22, 16, 0.76)";
      this.roundRect(ctx, bee.x + 17, bee.y - 17, 43, 13, 4);
      ctx.fill();
      ctx.fillStyle = "#f1bc63";
      ctx.font = "6px 'Bee Sans SC', monospace";
      ctx.textAlign = "left";
      ctx.fillText(sim.trackedBee.id, bee.x + 22, bee.y - 8);
    }
    ctx.restore();
  }

  drawBee(bee, target) {
    const ctx = this.ctx;
    const trail = bee.trail;
    const previous = trail.length > 1 ? trail[trail.length - 2] : bee;
    const angle = Math.atan2(bee.y - previous.y, bee.x - previous.x);
    const wing = 0.58 + Math.abs(Math.sin(this.time * 42 + bee.phase)) * 0.55;
    ctx.save();
    ctx.translate(bee.x, bee.y);
    ctx.rotate(Number.isFinite(angle) ? angle : 0);
    if (target) {
      ctx.shadowBlur = 11;
      ctx.shadowColor = "rgba(241, 188, 99, 0.6)";
    }
    ctx.fillStyle = "rgba(226, 240, 221, 0.46)";
    ctx.beginPath();
    ctx.ellipse(-0.8, -3.2, 3.2, 1.7 * wing, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-0.8, 3.2, 3.2, 1.7 * wing, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = target ? "#efb64d" : "#c9a45b";
    ctx.beginPath();
    ctx.ellipse(-1.4, 0, bee.size, bee.size * 0.63, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#352e1e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2.8, -bee.size * 0.55);
    ctx.lineTo(-2.4, bee.size * 0.55);
    ctx.moveTo(-0.6, -bee.size * 0.58);
    ctx.lineTo(-0.4, bee.size * 0.58);
    ctx.stroke();
    ctx.fillStyle = "#2b281c";
    ctx.beginPath();
    ctx.arc(bee.size * 0.75, 0, bee.size * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(30, 29, 20, 0.8)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(bee.size * 0.9, -1);
    ctx.quadraticCurveTo(bee.size * 1.2, -3.2, bee.size * 1.55, -3.8);
    ctx.moveTo(bee.size * 0.9, 0.7);
    ctx.quadraticCurveTo(bee.size * 1.2, 2.8, bee.size * 1.5, 3.5);
    ctx.stroke();
    ctx.restore();
  }

  drawForeground(sim) {
    const ctx = this.ctx;
    const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.46, 160, WIDTH / 2, HEIGHT * 0.5, 720);
    vignette.addColorStop(0, "rgba(2, 6, 3, 0)");
    vignette.addColorStop(1, "rgba(2, 6, 3, 0.46)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(225, 235, 213, 0.06)";
    ctx.fillRect(0, 469, WIDTH, 1);
    ctx.fillStyle = "rgba(9, 16, 11, 0.22)";
    ctx.fillRect(0, 576, WIDTH, 44);

    ctx.fillStyle = "rgba(219, 230, 207, 0.35)";
    ctx.font = "7px 'Bee Sans SC', monospace";
    ctx.textAlign = "left";
    ctx.fillText(`ACTIVE ${Math.round(sim.activeBees)} / ${Math.round(sim.population)}`, 34, 603);
    ctx.textAlign = "right";
    ctx.fillText(`HUM ${Math.round(sim.humidity)}% · ${Math.round(sim.light)} LUX`, WIDTH - 34, 603);
  }

  roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
