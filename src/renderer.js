import {
  cameraById,
  clamp,
  easeInOut,
  sampleAt,
  sceneById,
} from "./core.js";

const TAU = Math.PI * 2;

const normalize = (vector) => {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

const mix = (a, b, p) => a + (b - a) * p;

const mixPoint = (a, b, p) => ({
  x: mix(a.x, b.x, p),
  y: mix(a.y, b.y, p),
  z: mix(a.z, b.z, p),
});

const seeded = (seed) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

function hexToRgb(hex) {
  const raw = hex.replace("#", "");
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function rgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function interpolateCameraPose(camera, t) {
  const keys = [...camera.keyframes].sort((a, b) => a.t - b.t);
  if (!keys.length) {
    return {
      position: { x: 0, y: 2.5, z: 10 },
      target: { x: 0, y: 1, z: 0 },
      fov: 40,
    };
  }
  if (t <= keys[0].t) {
    return {
      position: { ...keys[0].position },
      target: { ...keys[0].target },
      fov: keys[0].fov,
    };
  }
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    return {
      position: { ...last.position },
      target: { ...last.target },
      fov: last.fov,
    };
  }
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index];
    const to = keys[index + 1];
    if (t >= from.t && t <= to.t) {
      const linear = (t - from.t) / (to.t - from.t);
      const p = easeInOut(clamp(linear, 0, 1));
      return {
        position: mixPoint(from.position, to.position, p),
        target: mixPoint(from.target, to.target, p),
        fov: mix(from.fov, to.fov, p),
      };
    }
  }
  return {
    position: { ...last.position },
    target: { ...last.target },
    fov: last.fov,
  };
}

export class StageRenderer {
  constructor() {
    this.layerA = this.makeLayer();
    this.layerB = this.makeLayer();
  }

  makeLayer() {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    return { canvas, ctx: canvas.getContext("2d", { alpha: false }) };
  }

  resizeLayer(layer, width, height) {
    if (layer.canvas.width !== width || layer.canvas.height !== height) {
      layer.canvas.width = width;
      layer.canvas.height = height;
    }
  }

  cameraBasis(pose, width, height) {
    const forward = normalize({
      x: pose.target.x - pose.position.x,
      y: pose.target.y - pose.position.y,
      z: pose.target.z - pose.position.z,
    });
    const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
    const up = normalize(cross(right, forward));
    const focal = height / 2 / Math.tan((pose.fov * Math.PI) / 360);
    return { pose, forward, right, up, focal, width, height, near: 0.08 };
  }

  projectPoint(point, basis) {
    const dx = point.x - basis.pose.position.x;
    const dy = point.y - basis.pose.position.y;
    const dz = point.z - basis.pose.position.z;
    const x = dot({ x: dx, y: dy, z: dz }, basis.right);
    const y = dot({ x: dx, y: dy, z: dz }, basis.up);
    const z = dot({ x: dx, y: dy, z: dz }, basis.forward);
    if (z <= basis.near) return { visible: false, x: 0, y: 0, z, scale: 0 };
    const scale = basis.focal / z;
    return {
      visible: true,
      x: basis.width / 2 + x * scale,
      y: basis.height / 2 - y * scale,
      z,
      scale,
    };
  }

  drawPath(ctx, points, fill, stroke, width = 1) {
    if (points.length < 2 || points.some((point) => !point.visible)) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  ringPoints(center, radiusX, radiusZ, segments = 48, y = 0) {
    return Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * TAU;
      return {
        x: center.x + Math.cos(angle) * radiusX,
        y,
        z: center.z + Math.sin(angle) * radiusZ,
      };
    });
  }

  drawBackground(ctx, width, height, scene, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, scene.sky[0]);
    sky.addColorStop(0.48, scene.sky[1]);
    sky.addColorStop(1, scene.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.52,
      height * 0.48,
      0,
      width * 0.52,
      height * 0.48,
      width * 0.58,
    );
    glow.addColorStop(0, rgba(scene.colors[0], 0.14));
    glow.addColorStop(0.35, rgba(scene.colors[1], 0.055));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let index = 0; index < 6; index += 1) {
      const radius = width * (0.13 + index * 0.075);
      ctx.strokeStyle = rgba(scene.colors[index % scene.colors.length], 0.2);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.ellipse(
        width * 0.53,
        height * 0.62,
        radius,
        radius * 0.13,
        -0.08,
        0,
        TAU,
      );
      ctx.stroke();
    }
    ctx.restore();

    const horizon = ctx.createLinearGradient(0, height * 0.4, 0, height * 0.7);
    horizon.addColorStop(0, "rgba(0,0,0,0)");
    horizon.addColorStop(0.7, rgba(scene.colors[1], 0.11));
    horizon.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, height * 0.4, width, height * 0.3);

    const drift = Math.sin(time * 0.17) * width * 0.015;
    ctx.strokeStyle = rgba(scene.colors[2], 0.07);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.33 + drift);
    ctx.bezierCurveTo(
      width * 0.35,
      height * 0.25 - drift,
      width * 0.66,
      height * 0.41 + drift,
      width,
      height * 0.3,
    );
    ctx.stroke();
  }

  drawFloorGrid(ctx, basis, scene, time) {
    const pulse = (Math.sin(time * 1.15) + 1) / 2;
    for (let index = -7; index <= 7; index += 1) {
      const x = index * 0.7;
      const points = [
        this.projectPoint({ x, y: 0, z: -4 }, basis),
        this.projectPoint({ x, y: 0, z: 7.5 }, basis),
      ];
      this.drawPath(
        ctx,
        points,
        null,
        rgba(scene.colors[0], index === 0 ? 0.19 : 0.05 + pulse * 0.025),
        1,
      );
    }
    for (let z = -4; z <= 7; z += 0.7) {
      const points = [
        this.projectPoint({ x: -5.5, y: 0, z }, basis),
        this.projectPoint({ x: 5.5, y: 0, z }, basis),
      ];
      this.drawPath(ctx, points, null, rgba(scene.colors[1], 0.045), 1);
    }
  }

  drawBackdropPanels(ctx, basis, scene, time) {
    for (let index = -2; index <= 2; index += 1) {
      const x = index * 1.45;
      const shimmer = (Math.sin(time * 0.62 + index * 1.2) + 1) / 2;
      const polygon = [
        { x: x - 0.12, y: 0.1, z: -4.4 },
        { x: x - 0.12, y: 5.6, z: -4.4 },
        { x: x + 0.12, y: 5.6, z: -4.4 },
        { x: x + 0.12, y: 0.1, z: -4.4 },
      ].map((point) => this.projectPoint(point, basis));
      this.drawPath(
        ctx,
        polygon,
        rgba(scene.colors[Math.abs(index) % 3], 0.014 + shimmer * 0.025),
        rgba(scene.colors[0], 0.055),
        0.7,
      );
    }
  }

  drawStage(ctx, basis, scene, time) {
    const center = { x: 0, z: 0 };
    const platform = this.ringPoints(center, 3.15, 2.05, 64, 0);
    const projected = platform.map((point) => this.projectPoint(point, basis));
    const gradient = ctx.createLinearGradient(0, basis.height * 0.4, 0, basis.height);
    gradient.addColorStop(0, rgba(scene.colors[1], 0.16));
    gradient.addColorStop(0.55, rgba(scene.colors[1], 0.055));
    gradient.addColorStop(1, "rgba(4,5,8,0.78)");
    this.drawPath(ctx, projected, gradient, rgba(scene.colors[0], 0.35), 1.1);

    const halo = ctx.createRadialGradient(
      basis.width * 0.5,
      basis.height * 0.67,
      0,
      basis.width * 0.5,
      basis.height * 0.67,
      basis.width * 0.35,
    );
    halo.addColorStop(0, rgba(scene.colors[0], 0.12));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, basis.width, basis.height);

    for (let ring = 0; ring < 3; ring += 1) {
      const radius = 1.4 + ring * 0.62;
      const points = this.ringPoints(center, radius, radius * 0.65, 64, 0.025).map((point) =>
        this.projectPoint(point, basis),
      );
      const alpha = 0.28 - ring * 0.065;
      this.drawPath(ctx, points, null, rgba(scene.colors[ring % 3], alpha), 1);
    }

    const pulse = (Math.sin(time * TAU / 3.2) + 1) / 2;
    const pulseRing = this.ringPoints(center, 1.55 + pulse * 0.3, 1.0 + pulse * 0.2, 64, 0.03)
      .map((point) => this.projectPoint(point, basis));
    this.drawPath(ctx, pulseRing, null, rgba(scene.colors[2], 0.12 * (1 - pulse)), 0.8);
  }

  drawLightBeams(ctx, basis, scene, time) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const rigs = [
      { x: -2.3, color: scene.colors[0], phase: 0 },
      { x: 0, color: scene.colors[1], phase: 1.8 },
      { x: 2.3, color: scene.colors[2], phase: 3.4 },
    ];
    rigs.forEach((rig, index) => {
      const sway = Math.sin(time * 0.55 + rig.phase) * 0.32;
      const bottomX = rig.x * 0.45 + sway;
      const polygon = [
        { x: rig.x - 0.09, y: 5.55, z: -1.6 },
        { x: rig.x + 0.09, y: 5.55, z: -1.6 },
        { x: bottomX + 0.55, y: 0, z: 0.4 },
        { x: bottomX - 0.55, y: 0, z: 0.4 },
      ].map((point) => this.projectPoint(point, basis));
      const glow = ctx.createLinearGradient(
        basis.width * 0.5 + rig.x * 25,
        basis.height * 0.25,
        basis.width * 0.5 + bottomX * 25,
        basis.height * 0.7,
      );
      glow.addColorStop(0, rgba(rig.color, 0.15));
      glow.addColorStop(0.72, rgba(rig.color, 0.025));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      this.drawPath(ctx, polygon, glow, rgba(rig.color, 0.075), 0.6);
      const lamp = this.projectPoint({ x: rig.x, y: 5.58, z: -1.6 }, basis);
      if (lamp.visible) {
        ctx.fillStyle = rgba(rig.color, 0.78);
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, Math.max(1.2, 2.2 * lamp.scale / 80), 0, TAU);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  drawPerformer(ctx, basis, scene, time) {
    const performer = {
      x: Math.sin(time * 0.52) * 0.7 + Math.sin(time * 0.23 + 1.4) * 0.18,
      y: 1.18 + Math.sin(time * 1.65) * 0.1,
      z: Math.cos(time * 0.38) * 0.38,
    };
    const center = this.projectPoint(performer, basis);
    if (!center.visible) return;

    const auraRadius = Math.max(16, 145 * center.scale / 80);
    const aura = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, auraRadius);
    aura.addColorStop(0, rgba(scene.colors[0], 0.82));
    aura.addColorStop(0.08, rgba(scene.colors[0], 0.48));
    aura.addColorStop(0.3, rgba(scene.colors[1], 0.15));
    aura.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(center.x, center.y, auraRadius, 0, TAU);
    ctx.fill();
    ctx.restore();

    const orbRadius = Math.max(3.5, 34 * center.scale / 80);
    const orb = ctx.createRadialGradient(
      center.x - orbRadius * 0.28,
      center.y - orbRadius * 0.3,
      orbRadius * 0.05,
      center.x,
      center.y,
      orbRadius,
    );
    orb.addColorStop(0, "#ffffff");
    orb.addColorStop(0.2, rgba(scene.colors[0], 1));
    orb.addColorStop(0.64, rgba(scene.colors[1], 0.8));
    orb.addColorStop(1, rgba(scene.colors[2], 0.1));
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(center.x, center.y, orbRadius, 0, TAU);
    ctx.fill();

    for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
      const tilt = time * (0.34 + ringIndex * 0.12) + ringIndex * 2.1;
      const radius = 0.72 + ringIndex * 0.23;
      const points = Array.from({ length: 60 }, (_, index) => {
        const angle = (index / 60) * TAU;
        const rx = Math.cos(angle) * radius;
        const rz = Math.sin(angle) * radius;
        return {
          x: performer.x + rx * Math.cos(tilt) - rz * Math.sin(tilt) * 0.42,
          y: performer.y + Math.sin(angle + tilt) * radius * 0.22,
          z: performer.z + rx * Math.sin(tilt) + rz * Math.cos(tilt) * 0.42,
        };
      }).map((point) => this.projectPoint(point, basis));
      this.drawPath(
        ctx,
        points,
        null,
        rgba(scene.colors[(ringIndex + 1) % 3], 0.45 - ringIndex * 0.1),
        0.8,
      );
    }

    for (let index = 0; index < 9; index += 1) {
      const angle = time * (0.4 + index * 0.025) + (index / 9) * TAU;
      const radius = 1.4 + seeded(index) * 0.8;
      const point = this.projectPoint(
        {
          x: performer.x + Math.cos(angle) * radius,
          y: performer.y + Math.sin(angle * 1.7) * 0.5,
          z: performer.z + Math.sin(angle) * radius * 0.55,
        },
        basis,
      );
      if (!point.visible) continue;
      ctx.fillStyle = rgba(scene.colors[index % 3], 0.45);
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(0.7, 2.1 * point.scale / 80), 0, TAU);
      ctx.fill();
    }

    const reflection = this.projectPoint({ x: performer.x, y: 0.01, z: performer.z }, basis);
    if (reflection.visible) {
      const reflectionGlow = ctx.createRadialGradient(
        reflection.x,
        reflection.y,
        0,
        reflection.x,
        reflection.y,
        Math.max(12, 90 * reflection.scale / 80),
      );
      reflectionGlow.addColorStop(0, rgba(scene.colors[0], 0.2));
      reflectionGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = reflectionGlow;
      ctx.fillRect(0, 0, basis.width, basis.height);
    }
  }

  drawAtmosphere(ctx, basis, scene, time) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < 34; index += 1) {
      const x = (seeded(index * 3 + 1) - 0.5) * 12;
      const y = seeded(index * 5 + 7) * 5.8;
      const z = (seeded(index * 9 + 3) - 0.35) * 9;
      const driftX = Math.sin(time * 0.13 + index) * 0.12;
      const point = this.projectPoint({ x: x + driftX, y, z }, basis);
      if (!point.visible) continue;
      const alpha = 0.07 + seeded(index * 11) * 0.2;
      ctx.fillStyle = rgba(scene.colors[index % 3], alpha);
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(0.35, point.scale / 155), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawVignette(ctx, width, height, scene) {
    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      width * 0.18,
      width * 0.5,
      height * 0.5,
      width * 0.7,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const grade = ctx.createLinearGradient(0, 0, width, height);
    grade.addColorStop(0, rgba(scene.colors[0], 0.045));
    grade.addColorStop(0.5, "rgba(0,0,0,0)");
    grade.addColorStop(1, rgba(scene.colors[2], 0.055));
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, width, height);
  }

  renderScene(ctx, project, cameraId, t, width, height) {
    const camera = cameraById(project, cameraId);
    const scene = sceneById(project, project.activeScene);
    const pose = interpolateCameraPose(camera, t);
    const basis = this.cameraBasis(pose, width, height);
    ctx.save();
    this.drawBackground(ctx, width, height, scene, t);
    this.drawAtmosphere(ctx, basis, scene, t);
    this.drawBackdropPanels(ctx, basis, scene, t);
    this.drawLightBeams(ctx, basis, scene, t);
    this.drawFloorGrid(ctx, basis, scene, t);
    this.drawStage(ctx, basis, scene, t);
    this.drawPerformer(ctx, basis, scene, t);
    this.drawVignette(ctx, width, height, scene);
    this.drawFrameDetails(ctx, width, height, t);
    ctx.restore();
  }

  drawFrameDetails(ctx, width, height, time) {
    const frameNoise = Math.floor(time * 30);
    ctx.save();
    ctx.globalAlpha = 0.09;
    for (let index = 0; index < 18; index += 1) {
      const seed = seeded(index + frameNoise * 0.37);
      const x = seed * width;
      const y = seeded(index * 7 + frameNoise * 0.13) * height;
      ctx.fillStyle = index % 3 === 0 ? "#ffffff" : "#000000";
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  drawCameraMap(ctx, project, t, x, y, width, height) {
    const scene = sceneById(project, project.activeScene);
    const active = sampleAt(project, t).activeCamera;
    const scale = width / 220;
    ctx.save();
    ctx.fillStyle = "rgba(5, 8, 11, 0.58)";
    this.roundRect(ctx, x, y, width, height, 3 * scale);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 0.7;
    this.roundRect(ctx, x, y, width, height, 3 * scale);
    ctx.stroke();

    const padX = 14 * scale;
    const padTop = 18 * scale;
    const mapX = (worldX) => x + padX + ((worldX + 6) / 12) * (width - padX * 2);
    const mapY = (worldZ) => y + padTop + ((worldZ + 3) / 14) * (height - padTop - 9 * scale);
    const stage = { x: mapX(0), y: mapY(0) };
    ctx.strokeStyle = rgba(scene.colors[0], 0.3);
    ctx.fillStyle = rgba(scene.colors[0], 0.045);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(stage.x, stage.y, 31 * scale, 12 * scale, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = rgba(scene.colors[1], 0.16);
    ctx.beginPath();
    ctx.ellipse(stage.x, stage.y, 18 * scale, 7 * scale, 0, 0, TAU);
    ctx.stroke();

    project.cameras.forEach((camera) => {
      const pose = interpolateCameraPose(camera, t);
      const point = { x: mapX(pose.position.x), y: mapY(pose.position.z) };
      const isActive = camera.id === active;
      const target = { x: stage.x, y: stage.y };
      const angle = Math.atan2(target.y - point.y, target.x - point.x);
      ctx.strokeStyle = rgba(camera.color, isActive ? 0.48 : 0.13);
      ctx.lineWidth = isActive ? 1.1 : 0.55;
      ctx.setLineDash(isActive ? [] : [2 * scale, 3 * scale]);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const size = (isActive ? 5.5 : 4.2) * scale;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(angle);
      ctx.fillStyle = isActive ? camera.color : rgba(camera.color, 0.48);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.7, size * 0.62);
      ctx.lineTo(-size * 0.38, 0);
      ctx.lineTo(-size * 0.7, -size * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = isActive ? camera.color : rgba(camera.color, 0.58);
      ctx.font = `500 ${Math.round(8.2 * scale)}px "DM Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(camera.id, point.x, point.y + 11 * scale);
    });

    ctx.fillStyle = "rgba(255,255,255,0.46)";
    ctx.font = `500 ${Math.round(8 * scale)}px "DM Mono", monospace`;
    ctx.textAlign = "left";
    ctx.fillText("TOP VIEW · CAM POSITION", x + 7 * scale, y + 9 * scale);
    ctx.textAlign = "right";
    ctx.fillStyle = rgba(scene.colors[0], 0.75);
    ctx.fillText(`LIVE ${active}`, x + width - 7 * scale, y + 9 * scale);
    ctx.restore();
  }

  drawProgramOverlay(ctx, project, t, width, height, options = {}) {
    const scene = sceneById(project, project.activeScene);
    const sample = sampleAt(project, t);
    const scale = width / 1280;
    const subtitle = sample.subtitle;

    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = t < 0.58 ? 1 - clamp(t / 0.58, 0, 1) : 0;
    ctx.fillStyle = "#f1f4ed";
    ctx.font = `700 ${Math.round(33 * scale)}px Manrope, sans-serif`;
    ctx.letterSpacing = `${2 * scale}px`;
    ctx.fillText("NIGHT ORBIT", 58 * scale, 92 * scale);
    ctx.fillStyle = rgba(scene.colors[0], 0.85);
    ctx.font = `500 ${Math.round(9 * scale)}px "DM Mono", monospace`;
    ctx.fillText("A LIVE MULTICAM SESSION  /  2026", 60 * scale, 113 * scale);
    ctx.globalAlpha = 1;

    if (options.cameraMap !== false) {
      const mapScale = width / 1280;
      this.drawCameraMap(
        ctx,
        project,
        t,
        width - 238 * mapScale,
        52 * mapScale,
        220 * mapScale,
        132 * mapScale,
      );
    }

    if (subtitle) {
      ctx.globalAlpha = clamp((t - subtitle.start) / 0.12, 0, 1) *
        clamp((subtitle.end - t) / 0.12, 0, 1);
      ctx.textAlign = "center";
      ctx.font = `500 ${Math.round(20 * scale)}px Manrope, "Noto Sans SC", "PingFang SC", sans-serif`;
      const metrics = ctx.measureText(subtitle.text);
      const boxWidth = Math.min(width - 90 * scale, metrics.width + 42 * scale);
      const boxX = width / 2 - boxWidth / 2;
      const boxY = height - 82 * scale;
      ctx.fillStyle = "rgba(5, 6, 8, 0.62)";
      this.roundRect(ctx, boxX, boxY, boxWidth, 38 * scale, 3 * scale);
      ctx.fill();
      ctx.strokeStyle = rgba(scene.colors[0], 0.42);
      ctx.lineWidth = 0.8;
      this.roundRect(ctx, boxX, boxY, boxWidth, 38 * scale, 3 * scale);
      ctx.stroke();
      ctx.fillStyle = "#f4f5ef";
      ctx.fillText(subtitle.text, width / 2, boxY + 25 * scale);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  renderProgram(ctx, project, t, width, height, options = {}) {
    const sample = sampleAt(project, t);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    if (!sample.transition.active) {
      this.renderScene(ctx, project, sample.activeCamera, t, width, height);
      this.drawProgramOverlay(ctx, project, t, width, height, options);
      ctx.restore();
      return;
    }

    this.resizeLayer(this.layerA, width, height);
    this.resizeLayer(this.layerB, width, height);
    this.renderScene(
      this.layerA.ctx,
      project,
      sample.outgoingCamera,
      t,
      width,
      height,
    );
    this.renderScene(
      this.layerB.ctx,
      project,
      sample.activeCamera,
      t,
      width,
      height,
    );
    const progress = easeInOut(sample.transition.progress);
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, width, height);

    if (sample.transition.type === "dissolve") {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.layerA.canvas, 0, 0, width, height);
      ctx.globalAlpha = progress;
      ctx.drawImage(this.layerB.canvas, 0, 0, width, height);
    } else if (sample.transition.type === "whip") {
      const direction = sample.activeCamera.charCodeAt(0) % 2 === 0 ? 1 : -1;
      const travel = width * 0.34;
      ctx.globalAlpha = 1 - progress * 0.8;
      ctx.filter = `blur(${Math.round(progress * 5)}px)`;
      ctx.drawImage(
        this.layerA.canvas,
        -direction * travel * progress,
        0,
        width,
        height,
      );
      ctx.globalAlpha = progress;
      ctx.filter = `blur(${Math.round((1 - progress) * 6)}px)`;
      ctx.drawImage(
        this.layerB.canvas,
        direction * travel * (1 - progress),
        0,
        width,
        height,
      );
    } else if (sample.transition.type === "wipe") {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.layerA.canvas, 0, 0, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, width * progress, height);
      ctx.clip();
      ctx.drawImage(this.layerB.canvas, 0, 0, width, height);
      ctx.restore();
      const edge = width * progress;
      const streak = ctx.createLinearGradient(edge - 18, 0, edge + 18, 0);
      streak.addColorStop(0, "rgba(255,255,255,0)");
      streak.addColorStop(0.5, "rgba(255,255,255,0.22)");
      streak.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(edge - 18, 0, 36, height);
    } else {
      ctx.drawImage(this.layerB.canvas, 0, 0, width, height);
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    this.drawProgramOverlay(ctx, project, t, width, height, options);
    ctx.restore();
  }

  renderPreview(ctx, project, cameraId, t, width, height) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    this.renderScene(ctx, project, cameraId, t, width, height);
    ctx.restore();
  }

  renderComparison(ctx, project, t, width, height) {
    if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
      ctx.canvas.width = width;
      ctx.canvas.height = height;
    }
    this.renderProgram(ctx, project, t, width, height);
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
