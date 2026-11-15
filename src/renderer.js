import {
  MATERIALS,
  buildGeometry,
  geometryDigest,
  lightWorldPosition
} from "./model.js";

const LIGHT_COLORS = {
  A: [1, 0.7, 0.39],
  B: [0.42, 0.8, 1]
};

const FONT_MONO = '"DM Mono", "Noto Sans SC", "SFMono-Regular", Consolas, monospace';
const FONT_SANS = '"Manrope", "Noto Sans SC", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_SERIF = '"Noto Serif SC", "Songti SC", Georgia, serif';

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.geometry = null;
    this.settings = null;
    this.lastRenderMs = 0;
    this.lastOrbitAngle = 0;
    this.hoveredLight = null;
    this.shadingDiagnostics = {};
  }

  resize(settings, orbitAngle) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(300, Math.round(rect.height));
    const ratio = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1));
    const changed =
      width !== this.width ||
      height !== this.height ||
      ratio !== this.pixelRatio ||
      this.canvas.width !== Math.round(width * ratio) ||
      this.canvas.height !== Math.round(height * ratio);

    if (changed) {
      this.width = width;
      this.height = height;
      this.pixelRatio = ratio;
      this.canvas.width = Math.round(width * ratio);
      this.canvas.height = Math.round(height * ratio);
    }
    this.settings = settings;
    this.lastOrbitAngle = orbitAngle;
    this.geometry = buildGeometry(settings, { width, height }, orbitAngle);
    return changed;
  }

  render(settings, orbitAngle = 0) {
    const started = performance.now();
    this.resize(settings, orbitAngle);
    const ctx = this.context;
    const width = this.width;
    const height = this.height;
    const ratio = this.pixelRatio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);

    this.drawBackground(ctx, width, height, settings);
    this.drawLightRays(ctx, settings);
    this.drawGlassBack(ctx, settings);
    this.drawFloorShadows(ctx, settings);
    this.drawPlatforms(ctx, settings);
    this.drawSpecimens(ctx, settings);
    this.drawGlassFront(ctx, settings);
    this.drawAnnotations(ctx, settings);
    this.drawLightHandles(ctx, settings);
    this.drawHud(ctx, settings);
    this.drawVignette(ctx, width, height);

    this.lastRenderMs = performance.now() - started;
    return this.geometry;
  }

  getGeometry() {
    return this.geometry;
  }

  getDigest() {
    return this.geometry ? geometryDigest(this.geometry) : "--------";
  }

  getPixelHash() {
    const ctx = this.context;
    const data = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    let hash = 0x811c9dc5;
    for (let index = 0; index < data.length; index += 4) {
      hash ^= data[index];
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[index + 1];
      hash = Math.imul(hash, 0x01000193);
      hash ^= data[index + 2];
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }

  drawBackground(ctx, width, height, settings) {
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, "#111511");
    base.addColorStop(0.5, "#0d110e");
    base.addColorStop(1, "#080a09");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);

    const warmGlow = ctx.createRadialGradient(
      width * 0.3,
      height * 0.22,
      0,
      width * 0.3,
      height * 0.22,
      width * 0.5
    );
    warmGlow.addColorStop(0, "rgba(171, 120, 69, 0.1)");
    warmGlow.addColorStop(0.5, "rgba(91, 73, 50, 0.025)");
    warmGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, width, height);

    const coolGlow = ctx.createRadialGradient(
      width * 0.76,
      height * 0.18,
      0,
      width * 0.76,
      height * 0.18,
      width * 0.45
    );
    coolGlow.addColorStop(0, "rgba(92, 157, 168, 0.08)");
    coolGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = coolGlow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(220, 229, 215, 0.034)";
    ctx.lineWidth = 1;
    const horizon = height * 0.61;
    for (let index = -6; index <= 6; index += 1) {
      const x = width * 0.5 + index * width * 0.12;
      ctx.beginPath();
      ctx.moveTo(width * 0.5 + index * width * 0.025, horizon);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let index = 1; index <= 5; index += 1) {
      const ratio = index / 5;
      const y = horizon + Math.pow(ratio, 2.35) * (height - horizon);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    this.drawTechnicalMarks(ctx, width, height);
    this.drawTitle(ctx, width, height, settings);
  }

  drawTechnicalMarks(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(220, 229, 215, 0.16)";
    ctx.lineWidth = 1;
    const inset = 15;
    const length = 12;
    for (const [x, y, sx, sy] of [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1]
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * length);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * length, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(220, 229, 215, 0.18)";
    for (let index = 0; index < 4; index += 1) {
      ctx.fillRect(inset + 22 + index * 5, height - inset - 2, 1, 1);
    }
    ctx.restore();
  }

  drawTitle(ctx, width, height, settings) {
    const compact = width < 680 || height < 540;
    const left = compact ? 24 : 32;
    const titleSize = compact ? 24 : 34;
    const top = compact ? 49 : 78;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(232, 228, 213, 0.48)";
    ctx.font = `400 8px ${FONT_MONO}`;
    ctx.letterSpacing = "2px";
    ctx.fillText("SCENE 01  /  OPTICAL SPECIMEN", left, top - 30);

    ctx.fillStyle = "#e9e4d7";
    ctx.font = `500 ${titleSize}px ${FONT_SERIF}`;
    ctx.letterSpacing = "0.01em";
    ctx.fillText("光与材质的", left, top + 6);
    ctx.fillStyle = "#c9a979";
    ctx.fillText("三体实验", left, top + 6 + titleSize * 1.12);

    ctx.letterSpacing = "0.8px";
    ctx.fillStyle = "rgba(232, 228, 213, 0.35)";
    ctx.font = `400 7px ${FONT_MONO}`;
    ctx.fillText("THREE-BODY MATERIAL STUDY", left + 2, top + titleSize * 2.24);

    if (!compact) {
      ctx.strokeStyle = "rgba(232, 228, 213, 0.18)";
      ctx.beginPath();
      ctx.moveTo(left, top + titleSize * 2.58);
      ctx.lineTo(left + 58, top + titleSize * 2.58);
      ctx.stroke();
    }

    if (!compact && width > 790) {
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(232, 228, 213, 0.38)";
      ctx.font = `400 8px ${FONT_MONO}`;
      ctx.letterSpacing = "1.1px";
      ctx.fillText("GLASS ENVELOPE · ACTIVE", width - 32, 45);
      ctx.fillStyle = "rgba(232, 228, 213, 0.22)";
      ctx.fillText("NO TEXTURES / PROCEDURAL LIGHT", width - 32, 60);
      const warm = settings.lights.A.intensity;
      const cool = settings.lights.B.intensity;
      ctx.fillStyle = "rgba(240, 181, 111, 0.72)";
      ctx.fillText(`L1 ${warm.toFixed(2)}×`, width - 130, 82);
      ctx.fillStyle = "rgba(121, 205, 227, 0.72)";
      ctx.fillText(`L2 ${cool.toFixed(2)}×`, width - 32, 82);
    }
    ctx.restore();
  }

  drawLightRays(ctx, settings) {
    const geometry = this.geometry;
    const center = geometry.dome;
    ctx.save();
    ctx.lineWidth = 1;
    for (const light of geometry.lights) {
      const color = light.id === "A" ? "240, 181, 111" : "121, 205, 227";
      ctx.strokeStyle = `rgba(${color}, ${0.045 + light.intensity * 0.018})`;
      ctx.setLineDash([1, 7]);
      ctx.beginPath();
      ctx.moveTo(light.screen.x, light.screen.y);
      ctx.bezierCurveTo(
        light.screen.x * 0.82 + center.centerX * 0.18,
        light.screen.y * 0.55 + center.centerY * 0.45,
        center.centerX * 0.62 + light.screen.x * 0.38,
        center.centerY - center.radiusY * 0.35,
        center.centerX,
        center.centerY - center.radiusY * 0.36
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawFloorShadows(ctx, settings) {
    const geometry = this.geometry;
    const floorCenter = this.projectWorld({ x: 0, y: -0.838, z: 0 }, geometry);
    const floorRadius = Math.max(120, geometry.dome.radiusX * 1.16);
    ctx.save();
    ctx.translate(floorCenter.x, floorCenter.y);
    ctx.scale(1, 0.19);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, floorRadius);
    pool.addColorStop(0, "rgba(229, 192, 139, 0.11)");
    pool.addColorStop(0.36, "rgba(179, 167, 133, 0.055)");
    pool.addColorStop(0.68, "rgba(96, 142, 139, 0.035)");
    pool.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, floorRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const projector = {
      project: (point) => {
        const materialScale = geometry.camera.focal / 6.55;
        const screen = this.projectWorld(point, geometry);
        screen.radius = materialScale;
        return screen;
      }
    };
    const ordered = [...geometry.spheres].sort((a, b) => b.center.depth - a.center.depth);

    for (const sphere of ordered) {
      const material = MATERIALS[sphere.id];
      const contact = this.projectWorld(
        { x: material.world.x, y: -0.839, z: material.world.z },
        geometry
      );
      ctx.save();
      ctx.translate(contact.x, contact.y + 2);
      ctx.scale(1, 0.22);
      const contactShadow = ctx.createRadialGradient(0, 0, 0, 0, 0, sphere.radius * 0.72);
      contactShadow.addColorStop(0, "rgba(0, 0, 0, 0.56)");
      contactShadow.addColorStop(0.62, "rgba(0, 0, 0, 0.24)");
      contactShadow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = contactShadow;
      ctx.beginPath();
      ctx.arc(0, 0, sphere.radius * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      for (const light of geometry.lights) {
        const lightWorld = lightWorldPosition(settings.lights[light.id]);
        const shadowX = material.world.x - (lightWorld.x - material.world.x) * 0.31;
        const shadowZ = material.world.z - (lightWorld.z - material.world.z) * 0.31;
        const projected = projector.project({ x: shadowX, y: -0.835, z: shadowZ });
        const spread = 0.82 + (1 - settings.lights[light.id].intensity / 3) * 0.24;
        const radiusX = sphere.radius * spread * (light.id === "A" ? 1.18 : 1.02);
        const radiusY = radiusX * 0.26;
        const strength = 0.24 + settings.lights[light.id].intensity * 0.12;

        ctx.save();
        ctx.translate(projected.x, projected.y);
        ctx.rotate(-0.04);
        ctx.scale(radiusX, radiusY);
        const gradient = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
        gradient.addColorStop(0, `rgba(0, 0, 0, ${Math.min(0.66, strength)})`);
        gradient.addColorStop(0.52, `rgba(0, 0, 0, ${Math.min(0.38, strength * 0.55)})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  projectWorld(point, geometry) {
    const width = geometry.viewport.width;
    const height = geometry.viewport.height;
    const yaw = (geometry.camera.yaw * Math.PI) / 180;
    const pitch = (geometry.camera.pitch * Math.PI) / 180;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const x = point.x * cosYaw + point.z * sinYaw;
    const z0 = -point.x * sinYaw + point.z * cosYaw;
    const y = point.y * cosPitch - z0 * sinPitch;
    const z = point.y * sinPitch + z0 * cosPitch;
    const depth = 6.55 + z;
    const scale = geometry.camera.focal / Math.max(0.2, depth);
    return {
      x: width * 0.5 + x * scale,
      y: height * 0.535 - (y - 0.04) * scale,
      depth,
      scale
    };
  }

  drawPlatforms(ctx, settings) {
    const geometry = this.geometry;
    const ordered = [...geometry.spheres].sort((a, b) => b.center.depth - a.center.depth);
    for (const sphere of ordered) {
      const material = MATERIALS[sphere.id];
      const base = this.projectWorld({ x: material.world.x, y: -0.845, z: material.world.z }, geometry);
      const radiusX = 0.82 * base.scale;
      const radiusY = radiusX * 0.22;
      const isSelected = settings.selected === sphere.id;
      const accent = material.accent;

      ctx.save();
      ctx.translate(base.x, base.y);
      const glow = ctx.createRadialGradient(0, 0, radiusX * 0.15, 0, 0, radiusX);
      glow.addColorStop(0, isSelected ? "rgba(235, 205, 158, 0.08)" : "rgba(205, 213, 197, 0.035)");
      glow.addColorStop(0.76, "rgba(210, 218, 203, 0.02)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.scale(1, radiusY / radiusX);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.scale(1, radiusY / radiusX);
      ctx.strokeStyle = isSelected ? hexToRgba(accent, 0.36) : "rgba(218, 223, 211, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = isSelected ? hexToRgba(accent, 0.15) : "rgba(218, 223, 211, 0.075)";
      ctx.beginPath();
      ctx.arc(0, 0, radiusX * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "rgba(226, 227, 214, 0.1)";
      ctx.beginPath();
      ctx.moveTo(base.x - radiusX * 0.82, base.y + radiusY * 0.5);
      ctx.lineTo(base.x - radiusX * 0.82, base.y + radiusY * 2.7);
      ctx.moveTo(base.x + radiusX * 0.82, base.y + radiusY * 0.5);
      ctx.lineTo(base.x + radiusX * 0.82, base.y + radiusY * 2.7);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSpecimens(ctx, settings) {
    const geometry = this.geometry;
    const ordered = [...geometry.spheres].sort((a, b) => b.center.depth - a.center.depth);
    for (const sphere of ordered) {
      const sprite = this.createSphereSprite(sphere, settings);
      const diameter = sphere.radius * 2;
      ctx.drawImage(sprite, sphere.center.x - sphere.radius, sphere.center.y - sphere.radius, diameter, diameter);
    }
  }

  createSphereSprite(sphere, settings) {
    const material = MATERIALS[sphere.id];
    const geometry = this.geometry;
    const diameter = Math.max(12, Math.ceil(sphere.radius * 2));
    const resolution = Math.max(24, Math.ceil(diameter * this.pixelRatio));
    const canvas = document.createElement("canvas");
    canvas.width = resolution;
    canvas.height = resolution;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.createImageData(resolution, resolution);
    const data = image.data;
    const lights = ["A", "B"].map((id) => {
      const world = lightWorldPosition(settings.lights[id]);
      const relative = {
        x: world.x - material.world.x,
        y: world.y - material.world.y,
        z: world.z - material.world.z
      };
      const viewed = this.toViewVector(relative, geometry);
      const direction = normalizeVector({ x: viewed.x, y: viewed.y, z: -viewed.z });
      return {
        id,
        direction,
        color: LIGHT_COLORS[id],
        intensity: settings.lights[id].intensity
      };
    });

    const roughness = settings.roughness[sphere.id];
    const shininess = 2.5 + 178 * Math.pow(1 - roughness, 2.15);
    const specularEnergy = material.specular * (0.45 + (1 - roughness) * 0.75);
    const isMetal = sphere.id === "metal";
    const isResin = sphere.id === "resin";
    const base = material.base;
    const radius = resolution * 0.5;
    const center = radius - 0.5;
    let maximumSpecular = 0;
    let maximumHalfDot = 0;

    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const offset = (y * resolution + x) * 4;
        const nx = (x - center) / radius;
        const ny = (center - y) / radius;
        const distanceSquared = nx * nx + ny * ny;
        if (distanceSquared > 1) {
          data[offset + 3] = 0;
          continue;
        }

        const nz = Math.sqrt(Math.max(0, 1 - distanceSquared));
        const edgeDistance = (1 - Math.sqrt(distanceSquared)) * radius;
        const alpha = Math.min(1, Math.max(0, edgeDistance + 0.5));
        const noise = deterministicNoise(x, y) * roughness * 0.018;
        const ambientY = ny * 0.5 + 0.5;
        let outR = base[0] * (0.082 + ambientY * 0.055);
        let outG = base[1] * (0.09 + ambientY * 0.058);
        let outB = base[2] * (0.1 + ambientY * 0.06);
        let glow = 0;

        for (const light of lights) {
          const dot = nx * light.direction.x + ny * light.direction.y + nz * light.direction.z;
          const wrap = Math.max(0, (dot + (isResin ? 0.18 : 0.035)) / (isResin ? 1.18 : 1.035));
          const diffuse = Math.pow(wrap, isResin ? 1.18 : 1);
          const half = normalizeVector({
            x: light.direction.x,
            y: light.direction.y,
            z: light.direction.z + 1
          });
          const halfDot = Math.max(0, nx * half.x + ny * half.y + nz * half.z);
          const specular = Math.pow(halfDot, shininess);
          maximumSpecular = Math.max(maximumSpecular, specular);
          maximumHalfDot = Math.max(maximumHalfDot, halfDot);
          const fresnel = Math.pow(1 - nz, 2.4);
          const energy = light.intensity * (isMetal ? 0.78 : 1);
          const diffuseEnergy = energy * (isMetal ? 0.55 : 0.92);
          const specEnergy = specularEnergy * energy;
          const specScale = isMetal ? 235 : 175;
          const surfaceTint = isMetal
            ? [0.56 + base[0] / 560, 0.58 + base[1] / 560, 0.6 + base[2] / 560]
            : [1, 1, 1];

          outR += light.color[0] * (base[0] * diffuse * diffuseEnergy + specular * specEnergy * specScale * surfaceTint[0]);
          outG += light.color[1] * (base[1] * diffuse * diffuseEnergy + specular * specEnergy * specScale * surfaceTint[1]);
          outB += light.color[2] * (base[2] * diffuse * diffuseEnergy + specular * specEnergy * specScale * surfaceTint[2]);
          outR += light.color[0] * fresnel * energy * (isMetal ? 24 : 8);
          outG += light.color[1] * fresnel * energy * (isMetal ? 24 : 8);
          outB += light.color[2] * fresnel * energy * (isMetal ? 24 : 8);
          glow += specular * energy;
        }

        if (isMetal) {
          const band = Math.pow(Math.max(0, 1 - Math.abs(ny + 0.1) * 2.6), 4) * 0.13;
          outR += base[0] * band;
          outG += base[1] * band;
          outB += base[2] * band;
        }
        if (isResin) {
          const core = Math.max(0, nz - 0.15) * 0.08;
          outR += 48 * core;
          outG += 18 * core;
          outB += 4 * core;
        }

        const jitter = 1 + noise - roughness * 0.006;
        data[offset] = toneMap(outR * jitter);
        data[offset + 1] = toneMap(outG * jitter);
        data[offset + 2] = toneMap(outB * jitter);
        data[offset + 3] = Math.round(alpha * 255);

        if (glow > 2.2 && alpha > 0.8) {
          data[offset] = Math.min(255, data[offset] + 3);
          data[offset + 1] = Math.min(255, data[offset + 1] + 3);
          data[offset + 2] = Math.min(255, data[offset + 2] + 3);
        }
      }
    }

    context.putImageData(image, 0, 0);
    this.shadingDiagnostics[sphere.id] = {
      roughness,
      shininess,
      maximumSpecular,
      maximumHalfDot
    };
    return canvas;
  }

  toViewVector(vector, geometry) {
    const yaw = (geometry.camera.yaw * Math.PI) / 180;
    const pitch = (geometry.camera.pitch * Math.PI) / 180;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const x = vector.x * cosYaw + vector.z * sinYaw;
    const z0 = -vector.x * sinYaw + vector.z * cosYaw;
    return {
      x,
      y: vector.y * cosPitch - z0 * sinPitch,
      z: vector.y * sinPitch + z0 * cosPitch
    };
  }

  traceDome(ctx) {
    const dome = this.geometry.dome;
    const { centerX: cx, centerY: cy, radiusX: rx, radiusY: ry } = dome;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy - ry * 0.64, cx - rx * 0.62, cy - ry, cx, cy - ry);
    ctx.bezierCurveTo(cx + rx * 0.62, cy - ry, cx + rx, cy - ry * 0.64, cx + rx, cy);
    ctx.closePath();
  }

  drawGlassBack(ctx, settings) {
    const dome = this.geometry.dome;
    const baseRy = dome.radiusX * 0.095;
    ctx.save();
    this.traceDome(ctx);
    const backTint = ctx.createLinearGradient(0, dome.centerY - dome.radiusY, 0, dome.centerY);
    backTint.addColorStop(0, "rgba(137, 178, 163, 0.036)");
    backTint.addColorStop(0.5, "rgba(111, 151, 142, 0.018)");
    backTint.addColorStop(1, "rgba(89, 122, 112, 0.012)");
    ctx.fillStyle = backTint;
    ctx.fill();
    ctx.strokeStyle = "rgba(173, 205, 190, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(dome.centerX, dome.centerY, dome.radiusX, baseRy, 0, Math.PI, Math.PI * 2);
    ctx.strokeStyle = "rgba(162, 199, 184, 0.17)";
    ctx.stroke();
    ctx.restore();
  }

  drawGlassFront(ctx, settings) {
    const dome = this.geometry.dome;
    const baseRy = dome.radiusX * 0.095;
    const width = this.width;
    const height = this.height;
    ctx.save();
    this.traceDome(ctx);
    ctx.clip();

    const glassWash = ctx.createLinearGradient(0, dome.centerY - dome.radiusY, 0, dome.centerY);
    glassWash.addColorStop(0, "rgba(208, 223, 212, 0.042)");
    glassWash.addColorStop(0.4, "rgba(124, 158, 145, 0.015)");
    glassWash.addColorStop(1, "rgba(123, 151, 138, 0.008)");
    ctx.fillStyle = glassWash;
    ctx.fillRect(
      dome.centerX - dome.radiusX,
      dome.centerY - dome.radiusY,
      dome.radiusX * 2,
      dome.radiusY + 4
    );

    for (const light of this.geometry.lights) {
      const color = light.id === "A" ? "240, 181, 111" : "121, 205, 227";
      const radius = dome.radiusX * 0.71;
      const tint = ctx.createRadialGradient(
        light.screen.x,
        light.screen.y,
        0,
        light.screen.x,
        light.screen.y,
        radius
      );
      const alpha = 0.028 + light.intensity * 0.015;
      tint.addColorStop(0, `rgba(${color}, ${alpha})`);
      tint.addColorStop(0.48, `rgba(${color}, ${alpha * 0.34})`);
      tint.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
    }

    const sheen = ctx.createLinearGradient(
      dome.centerX - dome.radiusX,
      dome.centerY - dome.radiusY,
      dome.centerX + dome.radiusX,
      dome.centerY
    );
    sheen.addColorStop(0, "rgba(255, 250, 230, 0)");
    sheen.addColorStop(0.25, "rgba(255, 250, 230, 0.055)");
    sheen.addColorStop(0.34, "rgba(255, 250, 230, 0.012)");
    sheen.addColorStop(0.72, "rgba(255, 250, 230, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    this.traceDome(ctx);
    ctx.strokeStyle = "rgba(198, 222, 210, 0.31)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(231, 236, 218, 0.1)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const highlight = ctx.createLinearGradient(
      dome.centerX - dome.radiusX * 0.72,
      dome.centerY - dome.radiusY * 0.82,
      dome.centerX - dome.radiusX * 0.22,
      dome.centerY - dome.radiusY * 0.48
    );
    highlight.addColorStop(0, "rgba(255, 250, 231, 0)");
    highlight.addColorStop(0.42, "rgba(255, 250, 231, 0.38)");
    highlight.addColorStop(1, "rgba(255, 250, 231, 0)");
    ctx.strokeStyle = highlight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dome.centerX - dome.radiusX * 0.82, dome.centerY - dome.radiusY * 0.12);
    ctx.bezierCurveTo(
      dome.centerX - dome.radiusX * 0.8,
      dome.centerY - dome.radiusY * 0.74,
      dome.centerX - dome.radiusX * 0.42,
      dome.centerY - dome.radiusY * 0.94,
      dome.centerX - dome.radiusX * 0.12,
      dome.centerY - dome.radiusY * 0.96
    );
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(dome.centerX, dome.centerY, dome.radiusX, baseRy, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(180, 211, 195, 0.29)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(dome.centerX, dome.centerY + 3, dome.radiusX * 0.96, baseRy * 0.9, 0, 0, Math.PI);
    ctx.strokeStyle = "rgba(180, 211, 195, 0.1)";
    ctx.stroke();
    ctx.restore();
  }

  drawAnnotations(ctx, settings) {
    const width = this.width;
    const height = this.height;
    const compact = width < 680;
    for (const sphere of this.geometry.spheres) {
      const material = MATERIALS[sphere.id];
      const selected = settings.selected === sphere.id;
      const boxWidth = compact ? 84 : sphere.id === "resin" ? 116 : 104;
      const boxHeight = compact ? 27 : 31;
      const centerX = Math.min(width - boxWidth / 2 - 24, Math.max(boxWidth / 2 + 24, sphere.label.x));
      const centerY = Math.min(height - 72, Math.max(170, sphere.label.y));
      const left = centerX - boxWidth / 2;
      const top = centerY - boxHeight - (compact ? 7 : 10);
      const accent = selected ? material.accent : "rgba(206, 209, 196, 0.48)";

      ctx.save();
      ctx.strokeStyle = selected ? hexToRgba(material.accent, 0.38) : "rgba(203, 208, 194, 0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sphere.center.x, sphere.center.y - sphere.radius - 3);
      ctx.lineTo(sphere.center.x, centerY + 1);
      ctx.stroke();

      ctx.fillStyle = "rgba(9, 12, 10, 0.82)";
      roundedRect(ctx, left, top, boxWidth, boxHeight, 4);
      ctx.fill();
      ctx.strokeStyle = selected ? hexToRgba(material.accent, 0.42) : "rgba(212, 216, 203, 0.14)";
      ctx.stroke();

      ctx.fillStyle = accent;
      roundedRect(ctx, left, top, 2, boxHeight, 1);
      ctx.fill();

      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `500 ${compact ? 6 : 7}px ${FONT_MONO}`;
      ctx.fillStyle = selected ? material.accent : "rgba(204, 208, 195, 0.45)";
      ctx.letterSpacing = "0.8px";
      ctx.fillText(`M–0${sphere.index + 1}`, left + (compact ? 7 : 9), top + (compact ? 8 : 9));
      ctx.font = `500 ${compact ? 8 : 9}px ${FONT_SANS}`;
      ctx.letterSpacing = "0px";
      ctx.fillStyle = selected ? "#e8e4d8" : "rgba(222, 224, 211, 0.62)";
      ctx.fillText(material.name, left + (compact ? 7 : 9), top + (compact ? 18 : 21));

      ctx.font = `400 ${compact ? 6 : 7}px ${FONT_MONO}`;
      ctx.textAlign = "right";
      ctx.fillStyle = selected ? "rgba(224, 214, 192, 0.64)" : "rgba(203, 208, 194, 0.34)";
      ctx.fillText(`R ${settings.roughness[sphere.id].toFixed(2)}`, left + boxWidth - 7, top + (compact ? 13 : 16));
      ctx.restore();
    }
  }

  drawLightHandles(ctx, settings) {
    for (const light of this.geometry.lights) {
      const x = Math.min(this.width - 28, Math.max(28, light.screen.x));
      const y = Math.min(this.height - 56, Math.max(142, light.screen.y));
      const color = light.id === "A" ? [240, 181, 111] : [121, 205, 227];
      const rgb = color.join(", ");
      const hovered = this.hoveredLight === light.id;
      const radius = hovered ? 16 : 13;
      ctx.save();

      const glow = ctx.createRadialGradient(x, y, 0, x, y, 42 + light.intensity * 8);
      glow.addColorStop(0, `rgba(${rgb}, ${0.2 + light.intensity * 0.045})`);
      glow.addColorStop(0.26, `rgba(${rgb}, 0.1)`);
      glow.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - 70, y - 70, 140, 140);

      ctx.strokeStyle = `rgba(${rgb}, ${hovered ? 0.9 : 0.58})`;
      ctx.lineWidth = hovered ? 1.5 : 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${rgb}, 0.21)`;
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(${rgb}, 0.96)`;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, 0.5)`;
      ctx.beginPath();
      ctx.moveTo(x - radius - 9, y);
      ctx.lineTo(x - radius - 3, y);
      ctx.moveTo(x + radius + 3, y);
      ctx.lineTo(x + radius + 9, y);
      ctx.stroke();

      ctx.font = `500 7px ${FONT_MONO}`;
      ctx.letterSpacing = "0.08em";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${rgb}, 0.9)`;
      ctx.fillText(`LIGHT ${light.id}`, x, y - radius - 13);
      ctx.font = `400 7px ${FONT_MONO}`;
      ctx.fillStyle = "rgba(222, 226, 211, 0.4)";
      ctx.fillText(`${Math.round(light.azimuth)}° / ${Math.round(light.elevation)}°`, x, y + radius + 16);
      ctx.restore();
    }
  }

  drawHud(ctx, settings) {
    const width = this.width;
    const height = this.height;
    const compact = width < 680;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font = `400 8px ${FONT_MONO}`;
    ctx.letterSpacing = "0.6px";

    if (!compact) {
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(220, 225, 211, 0.34)";
      ctx.fillText("拖动空白 · 旋转", 31, height - 37);
      ctx.fillStyle = "rgba(220, 225, 211, 0.19)";
      ctx.fillText("拖动光点 · 布光", 31, height - 23);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = settings.paused ? "rgba(240, 181, 111, 0.72)" : "rgba(185, 214, 168, 0.49)";
    ctx.fillText(
      settings.paused ? "COMPOSITE FROZEN" : "LIVE / ALPHA COMPOSITE",
      width - 29,
      height - 36
    );
    ctx.fillStyle = "rgba(220, 225, 211, 0.22)";
    ctx.fillText(
      `ZOOM ${settings.camera.zoom.toFixed(2)}×  ·  ${this.geometry.camera.yaw.toFixed(0)}°`,
      width - 29,
      height - 22
    );

    if (settings.paused) {
      ctx.fillStyle = "rgba(240, 181, 111, 0.16)";
      ctx.strokeStyle = "rgba(240, 181, 111, 0.35)";
      ctx.lineWidth = 1;
      roundedRect(ctx, width - 129, 112, 97, 21, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(240, 181, 111, 0.82)";
      ctx.textAlign = "center";
      ctx.font = `400 7px ${FONT_MONO}`;
      ctx.letterSpacing = "1.1px";
      ctx.fillText("FRAME FROZEN", width - 80.5, 123);
    }
    ctx.restore();
  }

  drawVignette(ctx, width, height) {
    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      Math.min(width, height) * 0.34,
      width * 0.5,
      height * 0.48,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.68, "rgba(0, 0, 0, 0.025)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.24)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  hitTestLight(x, y) {
    if (!this.geometry) return null;
    let nearest = null;
    let distance = 29;
    for (const light of this.geometry.lights) {
      const screenX = Math.min(this.width - 28, Math.max(28, light.screen.x));
      const screenY = Math.min(this.height - 56, Math.max(142, light.screen.y));
      const next = Math.hypot(x - screenX, y - screenY);
      if (next < distance) {
        nearest = light.id;
        distance = next;
      }
    }
    return nearest;
  }
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length
  };
}

function toneMap(value) {
  const channel = 255 * (1 - Math.exp(-Math.max(0, value) / 255));
  return Math.max(0, Math.min(255, Math.round(channel)));
}

function deterministicNoise(x, y) {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295 - 0.5;
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
