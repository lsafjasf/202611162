(function (root) {
  "use strict";

  class CanopyRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.world = null;
      this.dpr = 1;
      this.cssWidth = 1;
      this.cssHeight = 1;
      this.rain = [];
      this.motes = [];
      this.buildWeatherParticles();
    }

    setWorld(world) {
      this.world = world;
      this.buildWeatherParticles();
    }

    buildWeatherParticles() {
      const sim = root.ZiplineSim;
      if (!sim || !this.world) {
        this.rain = [];
        return;
      }
      const rng = sim.mulberry32
        ? sim.mulberry32(sim.hashString(this.world.seed + "-render"))
        : Math.random;
      this.rain = Array.from({ length: 150 }, function drop() {
        return {
          x: rng() * 1200,
          y: rng() * 720,
          length: 8 + rng() * 22,
          speed: 240 + rng() * 360,
          alpha: 0.08 + rng() * 0.24,
        };
      });
      this.motes = Array.from({ length: 32 }, function mote() {
        return {
          x: rng() * 1200,
          y: 170 + rng() * 500,
          size: 0.6 + rng() * 1.8,
          phase: rng() * Math.PI * 2,
        };
      });
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.dpr = dpr;
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
    }

    draw(state) {
      if (!this.world) {
        return;
      }
      this.resize();
      const ctx = this.ctx;
      const scaleX = this.canvas.width / 1200;
      const scaleY = this.canvas.height / 720;
      const time = state.time || 0;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.clearRect(0, 0, 1200, 720);

      this.drawSky(ctx, time);
      this.drawRidges(ctx);
      this.drawCanopy(ctx, time, false);
      this.drawRain(ctx, time, state, 0.7);
      this.drawTower(ctx, state);
      this.drawLines(ctx, state, time);
      this.drawObstacles(ctx, state, time);
      this.drawEntrances(ctx, state, time);
      this.drawRidePackage(ctx, state, time);
      this.drawForeground(ctx, time);
      this.drawWind(ctx, state, time);
      this.drawRain(ctx, time, state, 1);
      this.drawSceneLabels(ctx, state);
    }

    selectedRoute(state) {
      return (
        this.world.routes.find(function find(route) {
          return route.id === state.selectedRouteId;
        }) || null
      );
    }

    drawSky(ctx, time) {
      const sky = ctx.createLinearGradient(0, 0, 0, 720);
      sky.addColorStop(0, "#1b4f45");
      sky.addColorStop(0.38, "#123c34");
      sky.addColorStop(1, "#071913");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 1200, 720);

      const haze = ctx.createRadialGradient(790, 110, 20, 790, 110, 480);
      haze.addColorStop(0, "rgba(178, 225, 190, 0.24)");
      haze.addColorStop(0.4, "rgba(92, 159, 136, 0.07)");
      haze.addColorStop(1, "rgba(8, 25, 20, 0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, 1200, 720);

      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = "#cce9cd";
      ctx.lineWidth = 1;
      for (let index = 0; index < 4; index += 1) {
        const x = 670 + index * 48 + Math.sin(time * 0.12 + index) * 20;
        ctx.beginPath();
        ctx.moveTo(x, 60);
        ctx.bezierCurveTo(x - 20, 180, x + 50, 260, x + 10, 390);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawRidges(ctx) {
      const layers = [
        { y: 300, color: "rgba(24, 70, 59, 0.68)", offset: 0 },
        { y: 360, color: "rgba(15, 55, 46, 0.82)", offset: 42 },
        { y: 430, color: "rgba(8, 38, 31, 0.94)", offset: 76 },
      ];
      layers.forEach(function layer(index) {
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(0, 720);
        ctx.lineTo(0, layer.y + 70);
        for (let x = 0; x <= 1200; x += 60) {
          const y =
            layer.y +
            Math.sin((x + layer.offset) * 0.014) * 42 +
            Math.sin((x + layer.offset) * 0.035) * 14;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(1200, 720);
        ctx.closePath();
        ctx.fill();
      });
    }

    drawCanopy(ctx, time, foreground) {
      const trees = this.world.trees.filter(function split(tree) {
        return foreground ? tree.y > 430 : tree.y <= 430;
      });
      const self = this;
      trees.forEach(function tree(item, index) {
        const sway = Math.sin(time * 0.55 + index * 0.8) * 2.2 + item.lean;
        const x = item.x + sway;
        const y = item.y;
        if (!foreground) {
          ctx.strokeStyle = "rgba(5, 21, 17, 0.7)";
          ctx.lineWidth = Math.max(4, item.radius * 0.16);
          ctx.beginPath();
          ctx.moveTo(x, y + item.radius * 0.4);
          ctx.quadraticCurveTo(x - 8, y + 130, x - item.lean, 720);
          ctx.stroke();
        }
        const tones = ["#1e5a46", "#25674e", "#2c7355", "#174b3b"];
        const colors = foreground
          ? ["#0c2b22", "#10352a", "#0a261f", "#143b2e"]
          : tones;
        ctx.fillStyle = colors[item.tone % colors.length];
        const blobs = 5;
        for (let blob = 0; blob < blobs; blob += 1) {
          const angle = (blob / blobs) * Math.PI * 2;
          const blobX = x + Math.cos(angle) * item.radius * 0.46;
          const blobY = y + Math.sin(angle) * item.radius * 0.3;
          ctx.beginPath();
          ctx.ellipse(
            blobX,
            blobY,
            item.radius * 0.58,
            item.radius * 0.34,
            angle * 0.3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.fillStyle = foreground ? "rgba(37, 91, 67, 0.35)" : "rgba(102, 160, 114, 0.16)";
        ctx.beginPath();
        ctx.ellipse(
          x - item.radius * 0.22,
          y - item.radius * 0.16,
          item.radius * 0.4,
          item.radius * 0.19,
          -0.35,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
    }

    drawRain(ctx, time, state, layer) {
      const route = this.selectedRoute(state);
      const rain = route ? route.rain : 0.48;
      const wind = route ? route.wind : 4;
      const speed = state.ride ? state.ride.speed : 0;
      const count = layer === 1 ? Math.round(50 + rain * 70) : 25;
      ctx.save();
      ctx.lineCap = "round";
      for (let index = 0; index < count; index += 1) {
        const drop = this.rain[(index * (layer === 1 ? 2 : 1)) % this.rain.length];
        const y = (drop.y + time * drop.speed * rain) % 760 - 20;
        const x = (drop.x + time * wind * 5 + y * 0.08 + 1200) % 1200;
        ctx.strokeStyle = "rgba(184, 226, 212, " + drop.alpha * (layer === 1 ? 1 : 0.45) + ")";
        ctx.lineWidth = layer === 1 ? 1.1 : 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - wind * 0.35 - speed * 0.06, y + drop.length);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTower(ctx, state) {
      const platform = this.world.platform;
      const x = platform.x;
      const y = platform.y;
      const bottom = 720;
      ctx.save();

      ctx.fillStyle = "rgba(4, 17, 13, 0.35)";
      ctx.beginPath();
      ctx.ellipse(x + 22, 690, 125, 19, 0, 0, Math.PI * 2);
      ctx.fill();

      const towerGradient = ctx.createLinearGradient(x - 90, 0, x + 100, 0);
      towerGradient.addColorStop(0, "#183f36");
      towerGradient.addColorStop(0.5, "#2c6150");
      towerGradient.addColorStop(1, "#102e27");
      ctx.strokeStyle = towerGradient;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(x - 70, y + 10);
      ctx.lineTo(x - 100, bottom);
      ctx.moveTo(x + 78, y + 10);
      ctx.lineTo(x + 108, bottom);
      ctx.stroke();

      ctx.strokeStyle = "rgba(110, 167, 136, 0.42)";
      ctx.lineWidth = 3;
      for (let step = 0; step < 6; step += 1) {
        const a = y + 40 + step * 72;
        const b = a + 72;
        ctx.beginPath();
        ctx.moveTo(x - 72 - step * 5, a);
        ctx.lineTo(x + 80 + step * 5, b);
        ctx.moveTo(x + 80 + step * 5, a);
        ctx.lineTo(x - 72 - step * 5, b);
        ctx.stroke();
      }

      ctx.fillStyle = "#163b31";
      ctx.fillRect(x - 112, y - 4, 224, 14);
      ctx.fillStyle = "#3c7661";
      ctx.fillRect(x - 112, y - 10, 224, 8);
      ctx.fillStyle = "#f1c55c";
      ctx.fillRect(x - 112, y - 10, 224, 2);
      ctx.fillStyle = "rgba(246, 196, 83, 0.14)";
      ctx.fillRect(x - 96, y + 10, 192, 4);

      ctx.strokeStyle = "#7ba58d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 78, y - 10);
      ctx.lineTo(x - 78, y - 95);
      ctx.lineTo(x - 18, y - 106);
      ctx.lineTo(x + 42, y - 94);
      ctx.lineTo(x + 74, y - 10);
      ctx.stroke();

      ctx.fillStyle = "#f6c453";
      ctx.beginPath();
      ctx.arc(x - 18, y - 106, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.24;
      ctx.beginPath();
      ctx.arc(x - 18, y - 106, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(142, 227, 164, 0.2)";
      ctx.beginPath();
      ctx.ellipse(x - 24, y - 11, 43, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(142, 227, 164, 0.72)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const delivered = state.run ? state.run.deliveries.length : 0;
      for (let index = 0; index < delivered; index += 1) {
        const crateX = x + 12 + (index % 2) * 26;
        const crateY = y - 20 - Math.floor(index / 2) * 20;
        ctx.fillStyle = "#b9813f";
        ctx.fillRect(crateX, crateY, 21, 18);
        ctx.strokeStyle = "rgba(255, 225, 172, 0.55)";
        ctx.strokeRect(crateX + 0.5, crateY + 0.5, 20, 17);
        ctx.fillStyle = "rgba(77, 43, 17, 0.5)";
        ctx.fillRect(crateX + 9, crateY, 2, 18);
      }
      ctx.restore();
    }

    cableY(route, t, weightKg) {
      const point = root.ZiplineSim.routePoint(route, t);
      const sagBoost = weightKg == null ? 0 : (weightKg - 12) * 2.5;
      return point.y + sagBoost * 4 * t * (1 - t);
    }

    drawLines(ctx, state, time) {
      const selected = this.selectedRoute(state);
      const weight = state.weightKg || 12;
      this.world.routes.forEach(function drawRoute(route) {
        const active = selected && route.id === selected.id;
        ctx.save();
        ctx.lineCap = "round";
        ctx.strokeStyle = active ? "rgba(3, 13, 10, 0.8)" : "rgba(3, 13, 10, 0.42)";
        ctx.lineWidth = active ? 7 : 5;
        ctx.beginPath();
        for (let index = 0; index <= 70; index += 1) {
          const t = index / 70;
          const point = root.ZiplineSim.routePoint(route, t);
          const sagBoost = active ? (weight - 12) * 2.5 * 4 * t * (1 - t) : 0;
          if (index === 0) {
            ctx.moveTo(point.x, point.y + sagBoost);
          } else {
            ctx.lineTo(point.x, point.y + sagBoost);
          }
        }
        ctx.stroke();
        ctx.strokeStyle = active
          ? route.accent
          : "rgba(143, 182, 161, 0.28)";
        ctx.lineWidth = active ? 2 : 1;
        if (active) {
          ctx.shadowColor = route.accent;
          ctx.shadowBlur = 8;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (active) {
          for (let index = 0; index <= 70; index += 14) {
            const t = index / 70;
            const point = root.ZiplineSim.routePoint(route, t);
            const pulse = 0.35 + Math.sin(time * 2.2 + index) * 0.12;
            ctx.fillStyle = "rgba(218, 246, 227, " + pulse + ")";
            ctx.fillRect(point.x - 1, point.y - 2, 2, 4);
          }
        }
        ctx.restore();
      });
    }

    drawObstacles(ctx, state, time) {
      const route = this.selectedRoute(state);
      if (!route) {
        return;
      }
      const weight = state.weightKg || 12;
      route.obstacles.forEach(function obstacle(item, index) {
        const point = root.ZiplineSim.routePoint(route, item.t);
        const y = point.y + (weight - 12) * 2.5 * 4 * item.t * (1 - item.t);
        ctx.save();
        if (item.type === "gust") {
          ctx.strokeStyle = "rgba(169, 226, 222, 0.34)";
          ctx.lineWidth = 1.2;
          for (let line = 0; line < 4; line += 1) {
            const offset = ((time * 36 + index * 17 + line * 10) % 50) - 25;
            ctx.beginPath();
            ctx.moveTo(point.x - 35 + offset, y + 18 - line * 5);
            ctx.bezierCurveTo(
              point.x - 8 + offset,
              y + 8 - line * 5,
              point.x + 10 + offset,
              y + 30 - line * 5,
              point.x + 38 + offset,
              y + 15 - line * 5,
            );
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(169, 226, 222, 0.62)";
          ctx.font = '8px "SFMono-Regular", monospace';
          ctx.fillText("GUST", point.x + 8, y + 28);
        } else {
          ctx.strokeStyle = "#6f5734";
          ctx.lineWidth = 12;
          ctx.beginPath();
          ctx.moveTo(point.x - 74, y + 58);
          ctx.quadraticCurveTo(point.x - 48, y + 18, point.x + 2, y + 4);
          ctx.stroke();
          ctx.strokeStyle = "#3b2d1c";
          ctx.lineWidth = 6;
          ctx.stroke();
          ctx.fillStyle = "rgba(79, 111, 65, 0.72)";
          for (let leaf = 0; leaf < 5; leaf += 1) {
            ctx.beginPath();
            ctx.ellipse(
              point.x - 42 + leaf * 10,
              y + 2 + Math.sin(leaf) * 8,
              9,
              4,
              -0.6 + leaf * 0.2,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
          ctx.fillStyle = "rgba(255, 198, 117, 0.7)";
          ctx.font = '8px "SFMono-Regular", monospace';
          ctx.fillText("BRANCH", point.x - 34, y + 31);
        }
        ctx.restore();
      });
    }

    drawEntrances(ctx, state, time) {
      const selected = this.selectedRoute(state);
      this.world.routes.forEach(function entrance(route, index) {
        const active = selected && route.id === selected.id;
        const start = route.start;
        const pulse = active ? 0.55 + Math.sin(time * 3) * 0.16 : 0.22;
        ctx.save();
        ctx.strokeStyle = route.accent;
        ctx.globalAlpha = active ? 0.9 : 0.34;
        ctx.lineWidth = active ? 2 : 1;
        ctx.beginPath();
        ctx.arc(start.x, start.y, active ? 18 : 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = active ? route.accent : "rgba(10, 37, 30, 0.9)";
        ctx.beginPath();
        ctx.arc(start.x, start.y, active ? 11 : 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = active ? "#092119" : route.accent;
        ctx.font = "bold 9px 'SFMono-Regular', monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(index + 1), start.x, start.y + 3);

        ctx.globalAlpha = pulse + 0.28;
        ctx.fillStyle = route.accent;
        ctx.fillRect(start.x - 36, start.y - 34, 72, 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = active ? "#e9f8ee" : "rgba(204, 230, 214, 0.52)";
        ctx.font = "8px 'Canopy Sans', sans-serif";
        ctx.fillText(route.short, start.x, start.y - 40);
        ctx.restore();
      });
    }

    drawRidePackage(ctx, state, time) {
      const ride = state.ride;
      if (!ride) {
        return;
      }
      const route = this.world.routes.find(function find(item) {
        return item.id === ride.routeId;
      });
      if (!route) {
        return;
      }
      const point = root.ZiplineSim.routePoint(route, ride.progress);
      const sagBoost = (ride.weightKg - 12) * 2.5 * 4 * ride.progress * (1 - ride.progress);
      const x = point.x;
      const y = point.y + sagBoost;
      const speed = ride.speed;
      const sway = Math.sin(time * (4 + speed * 0.16)) * Math.min(8, speed * 0.35);
      const crateSize = 17 + (ride.weightKg - 6) * 0.75;
      const crateY = y + 27 + crateSize * 0.5;

      ctx.save();
      if (ride.braking) {
        ctx.strokeStyle = "rgba(246, 196, 83, 0.7)";
        ctx.lineWidth = 1.2;
        for (let spark = 0; spark < 7; spark += 1) {
          const angle = (spark / 7) * Math.PI * 2 + time * 3;
          const length = 8 + Math.sin(time * 17 + spark) * 8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
          ctx.stroke();
        }
      }
      if (speed > 11.5) {
        ctx.strokeStyle = "rgba(255, 139, 130, 0.34)";
        ctx.lineWidth = 1;
        for (let trail = 0; trail < 4; trail += 1) {
          const offset = trail * 7;
          ctx.beginPath();
          ctx.moveTo(x - 24 - offset, y + 8 + trail * 3);
          ctx.lineTo(x - 60 - offset * 1.6, y + 17 + trail * 4);
          ctx.stroke();
        }
      }

      ctx.strokeStyle = "rgba(231, 242, 226, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x + sway * 0.4, crateY - crateSize * 0.52);
      ctx.moveTo(x, y + 3);
      ctx.lineTo(x - sway * 0.3, crateY - crateSize * 0.48);
      ctx.stroke();
      ctx.fillStyle = "#c8bd9d";
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5a4f39";
      ctx.stroke();

      ctx.translate(x + sway * 0.35, crateY);
      ctx.rotate(sway * 0.006);
      ctx.fillStyle = "#a56e39";
      ctx.fillRect(-crateSize / 2, -crateSize / 2, crateSize, crateSize);
      ctx.strokeStyle = "rgba(255, 222, 168, 0.68)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-crateSize / 2 + 0.5, -crateSize / 2 + 0.5, crateSize - 1, crateSize - 1);
      ctx.fillStyle = "rgba(74, 42, 18, 0.48)";
      ctx.fillRect(-1.5, -crateSize / 2, 3, crateSize);
      ctx.fillStyle = ride.taskColor;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#10221a";
      ctx.font = "bold 6px 'Canopy Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ride.taskName.slice(0, 1), 0, 2);
      ctx.restore();
    }

    drawForeground(ctx, time) {
      this.drawCanopy(ctx, time, true);
      const gradient = ctx.createLinearGradient(0, 610, 0, 720);
      gradient.addColorStop(0, "rgba(5, 18, 14, 0)");
      gradient.addColorStop(1, "rgba(3, 13, 10, 0.72)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 580, 1200, 140);
    }

    drawWind(ctx, state, time) {
      const route = this.selectedRoute(state);
      if (!route) {
        return;
      }
      const strength = Math.abs(route.wind);
      const direction = Math.sign(route.wind) || 1;
      ctx.save();
      ctx.globalAlpha = 0.08 + Math.min(strength, 16) * 0.006;
      ctx.strokeStyle = route.wind > 0 ? "#a7f3d0" : "#bae6fd";
      ctx.lineWidth = 1;
      for (let index = 0; index < 12; index += 1) {
        const x = (time * strength * 9 + index * 111) % 1300 - 50;
        const y = 110 + ((index * 59) % 430);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(
          x + 28 * direction,
          y - 5,
          x + 55 * direction,
          y + 7,
          x + 85 * direction,
          y,
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    drawSceneLabels(ctx, state) {
      const route = this.selectedRoute(state);
      ctx.save();
      ctx.fillStyle = "rgba(225, 242, 229, 0.52)";
      ctx.font = '8px "SFMono-Regular", monospace';
      ctx.textAlign = "left";
      ctx.fillText("CANOPY LINE 07", 20, 700);
      ctx.textAlign = "right";
      ctx.fillText("TOWER / PLATFORM 11.5 MAX", 1180, 700);
      if (route) {
        ctx.fillStyle = route.accent;
        ctx.globalAlpha = 0.8;
        ctx.textAlign = "center";
        ctx.fillText(
          route.label + " · " + Math.round(route.rain * 100) + "% RAIN",
          610,
          696,
        );
      }
      ctx.restore();
    }
  }

  root.CanopyRenderer = CanopyRenderer;
})(typeof globalThis !== "undefined" ? globalThis : this);
