import { getAudioEventAt, getCueAt, getSceneAt, roundTime } from "./project.js";

const WIDTH = 960;
const HEIGHT = 540;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return [0, 0, 0];
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function mixColor(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (index) => Math.round(a[index] + (b[index] - a[index]) * amount);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function mixFrame(from, to, amount) {
  const output = {};
  for (const key of Object.keys(from)) {
    if (typeof from[key] === "number") {
      output[key] = from[key] + (to[key] - from[key]) * amount;
    } else if (typeof from[key] === "string" && from[key].startsWith("#")) {
      output[key] = mixColor(from[key], to[key], amount);
    } else {
      output[key] = from[key];
    }
  }
  return output;
}

export function resolveSceneFrame(scene, localTime) {
  const keys = scene.keyframes;
  if (!keys.length) return {};
  if (localTime <= keys[0].t) return { ...keys[0] };
  if (localTime >= keys[keys.length - 1].t) return { ...keys[keys.length - 1] };
  for (let index = 1; index < keys.length; index += 1) {
    const previous = keys[index - 1];
    const next = keys[index];
    if (localTime <= next.t) {
      const span = Math.max(0.0001, next.t - previous.t);
      const amount = smoothstep((localTime - previous.t) / span);
      return mixFrame(previous, next, amount);
    }
  }
  return { ...keys[keys.length - 1] };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function noise(seed, index) {
  const value = Math.sin(seed * 0.0001 + index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.scratchA = document.createElement("canvas");
    this.scratchB = document.createElement("canvas");
    this.scratchA.width = WIDTH;
    this.scratchA.height = HEIGHT;
    this.scratchB.width = WIDTH;
    this.scratchB.height = HEIGHT;
    this.lastRender = null;
  }

  render(project, time) {
    const safeTime = clamp(Number(time) || 0, 0, project.duration);
    const transition = this.getTransition(project, safeTime);
    this.ctx.save();
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (transition) {
      const amount = smoothstep((safeTime - transition.start) / Math.max(0.0001, transition.duration));
      const from = project.scenes.find((scene) => scene.id === transition.from);
      const to = project.scenes.find((scene) => scene.id === transition.to);
      if (from && to) {
        const a = this.scratchA.getContext("2d", { alpha: false });
        const b = this.scratchB.getContext("2d", { alpha: false });
        this.drawScene(a, from, safeTime);
        this.drawScene(b, to, safeTime);
        this.ctx.globalAlpha = 1;
        this.ctx.drawImage(this.scratchA, 0, 0);
        this.ctx.globalAlpha = amount;
        this.ctx.drawImage(this.scratchB, 0, 0);
      } else {
        this.drawCurrentScene(project, safeTime);
      }
    } else {
      this.drawCurrentScene(project, safeTime);
    }
    this.ctx.globalAlpha = 1;
    this.drawHud(project, safeTime);
    this.ctx.restore();
    this.lastRender = {
      time: roundTime(safeTime),
      scene: getSceneAt(project, safeTime)?.id || null,
      cue: getCueAt(project, safeTime)?.id || null,
      audioEvent: getAudioEventAt(project, safeTime)?.index ?? null,
      transition: transition ? transition.id : null,
      transitionProgress: transition
        ? roundTime((safeTime - transition.start) / transition.duration)
        : null,
    };
    return this.lastRender;
  }

  drawCurrentScene(project, time) {
    const scene = getSceneAt(project, time);
    if (scene) this.drawScene(this.ctx, scene, time);
  }

  drawScene(ctx, scene, time) {
    const localTime = time - scene.start;
    const frame = resolveSceneFrame(scene, localTime);
    const seed = hashString(scene.id);
    const horizon = HEIGHT * (0.62 + (frame.haze || 0) * 0.03);

    ctx.save();
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, frame.skyTop);
    sky.addColorStop(0.7, frame.skyBottom);
    sky.addColorStop(1, frame.horizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, horizon + 2);

    const ground = ctx.createLinearGradient(0, horizon, 0, HEIGHT);
    ground.addColorStop(0, frame.horizon);
    ground.addColorStop(0.14, frame.ground);
    ground.addColorStop(1, "#080b13");
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, WIDTH, HEIGHT - horizon);

    const sunX = WIDTH * frame.sunX;
    const sunY = HEIGHT * frame.sunY;
    const sunRadius = HEIGHT * frame.sunSize;
    const glowRadius = sunRadius * (3.8 + (frame.glow ? 0.4 : 0));
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, glowRadius);
    glow.addColorStop(0, this.withAlpha(frame.glow, 0.82));
    glow.addColorStop(0.18, this.withAlpha(frame.glow, 0.36));
    glow.addColorStop(1, this.withAlpha(frame.glow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - glowRadius, sunY - glowRadius, glowRadius * 2, glowRadius * 2);

    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.withAlpha(frame.horizon, 0.95);
    ctx.fill();

    this.drawHaze(ctx, frame, horizon, time);
    this.drawRidges(ctx, frame, horizon, seed, scene);
    this.drawCity(ctx, frame, horizon, seed, scene, time);
    this.drawWater(ctx, frame, horizon, seed, time);

    const vignette = ctx.createRadialGradient(
      WIDTH / 2,
      HEIGHT * 0.47,
      HEIGHT * 0.18,
      WIDTH / 2,
      HEIGHT * 0.47,
      WIDTH * 0.7,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  drawHaze(ctx, frame, horizon, time) {
    ctx.save();
    for (let index = 0; index < 5; index += 1) {
      const y = horizon - 24 - index * 13 + Math.sin(time * 0.23 + index) * 2;
      const width = WIDTH * (0.28 + frame.haze * 0.96);
      const x = WIDTH * 0.5 - width * 0.5 + Math.sin(index * 1.8 + frame.sunX * 4) * 80;
      const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
      gradient.addColorStop(0, this.withAlpha(frame.horizon, 0));
      gradient.addColorStop(
        0.5,
        this.withAlpha(frame.horizon, 0.035 + frame.haze * (0.02 + index * 0.004)),
      );
      gradient.addColorStop(1, this.withAlpha(frame.horizon, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, width, 2 + frame.haze * 4);
    }
    ctx.restore();
  }

  drawRidges(ctx, frame, horizon, seed, scene) {
    ctx.save();
    const base = horizon + 9;
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT);
      for (let x = 0; x <= WIDTH + 20; x += 20) {
        const wave =
          Math.sin(x * (0.008 + layer * 0.004) + seed * 0.0002 + layer) *
            (10 + layer * 9) +
          Math.sin(x * 0.021 + seed * 0.0004) * 4;
        ctx.lineTo(x, base - 10 + wave + layer * 11);
      }
      ctx.lineTo(WIDTH, HEIGHT);
      ctx.closePath();
      ctx.fillStyle = this.withAlpha(layer ? frame.ground : frame.skyTop, layer ? 0.55 : 0.25);
      ctx.fill();
    }

    if (scene.id.includes("night")) {
      ctx.strokeStyle = this.withAlpha(frame.horizon, 0.22);
      ctx.lineWidth = 1;
      for (let index = 0; index < 6; index += 1) {
        const y = horizon + 12 + index * 5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WIDTH, y + Math.sin(index + seed) * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawCity(ctx, frame, horizon, seed, scene, time) {
    ctx.save();
    const night = scene.id.includes("night");
    const blockWidth = 24 + Math.floor(noise(seed, 2) * 8);
    const drift = Math.sin(time * 0.12 + seed * 0.0001) * 3;
    for (let index = -1; index < Math.ceil(WIDTH / blockWidth) + 1; index += 1) {
      const random = noise(seed, index + 9);
      const buildingWidth = blockWidth * (0.52 + noise(seed, index + 40) * 0.65);
      const buildingHeight = 24 + random * 86 + (index % 5 === 0 ? 28 : 0);
      const x = index * blockWidth + drift;
      const y = horizon - buildingHeight + 8;
      ctx.fillStyle = night
        ? this.withAlpha("#080b17", 0.94)
        : this.withAlpha(frame.ground, 0.92);
      ctx.fillRect(x, y, buildingWidth, buildingHeight + 10);
      ctx.fillStyle = this.withAlpha(frame.horizon, night ? 0.09 : 0.08);
      ctx.fillRect(x, y, buildingWidth, 1);

      const rows = Math.floor(buildingHeight / 13);
      const columns = Math.max(1, Math.floor(buildingWidth / 9));
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const lit = noise(seed + index * 13, row * 11 + column + 5) > (night ? 0.45 : 0.72);
          if (!lit) continue;
          ctx.fillStyle = night
            ? this.withAlpha(index % 3 ? "#ffc36d" : "#7fe3ff", 0.42 + random * 0.28)
            : this.withAlpha(frame.glow, 0.18 + random * 0.14);
          ctx.fillRect(x + 4 + column * 9, y + 7 + row * 13, 2.4, 3.5);
        }
      }
    }
    ctx.restore();
  }

  drawWater(ctx, frame, horizon, seed, time) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon + 26, WIDTH, HEIGHT - horizon);
    ctx.clip();
    const wave = 0.6 + (Number(frame.wave) || 0) * 3;
    for (let index = 0; index < 18; index += 1) {
      const y = horizon + 30 + index * 8;
      ctx.beginPath();
      for (let x = -10; x <= WIDTH + 10; x += 9) {
        const offset =
          Math.sin(x * 0.024 + index * 0.8 + time * 0.55 + seed * 0.0001) *
          (1.5 + wave * (1 - index / 22));
        if (x === -10) ctx.moveTo(x, y + offset);
        else ctx.lineTo(x, y + offset);
      }
      ctx.strokeStyle = this.withAlpha(
        index % 4 === 0 ? frame.glow : frame.horizon,
        0.035 + (1 - index / 20) * 0.09,
      );
      ctx.lineWidth = index % 4 === 0 ? 1.4 : 0.7;
      ctx.stroke();
    }

    const reflection = ctx.createLinearGradient(0, horizon, 0, HEIGHT);
    reflection.addColorStop(0, this.withAlpha(frame.glow, 0.23));
    reflection.addColorStop(1, this.withAlpha(frame.glow, 0));
    ctx.fillStyle = reflection;
    const reflectionWidth = 90 + (Number(frame.sunSize) || 0) * 280;
    ctx.fillRect(WIDTH * frame.sunX - reflectionWidth / 2, horizon, reflectionWidth, HEIGHT - horizon);
    ctx.restore();
  }

  drawHud(project, time) {
    const scene = getSceneAt(project, time);
    const cue = getCueAt(project, time);
    const event = getAudioEventAt(project, time);
    this.ctx.save();
    this.ctx.fillStyle = "rgba(255,255,255,0.62)";
    this.ctx.font = '600 10px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
    this.ctx.letterSpacing = "1px";
    this.ctx.fillText((scene?.name || "SCENE").toUpperCase(), 24, 28);
    this.ctx.textAlign = "right";
    this.ctx.fillStyle = "rgba(255,255,255,0.36)";
    this.ctx.fillText(
      `${time.toFixed(2).padStart(5, "0")}s  ·  BEAT ${event ? String(event.index + 1).padStart(2, "0") : "--"}`,
      WIDTH - 24,
      28,
    );
    if (cue) {
      this.ctx.fillStyle = "rgba(255,180,84,0.8)";
      this.ctx.textAlign = "right";
      this.ctx.fillText("SUB ACTIVE", WIDTH - 24, HEIGHT - 22);
    }
    this.ctx.restore();
  }

  getTransition(project, time) {
    return project.transitions.find(
      (transition) => time >= transition.start && time < transition.start + transition.duration,
    );
  }

  withAlpha(color, alpha) {
    if (String(color).startsWith("#")) {
      const [red, green, blue] = hexToRgb(color);
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
    const match = String(color).match(/rgba?\(([^)]+)\)/);
    if (match) {
      const [red, green, blue] = match[1].split(",").map((part) => Number(part.trim()));
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
    return `rgba(255, 255, 255, ${alpha})`;
  }

  canvasHash() {
    const data = this.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 16) {
      hash ^= data[index] | (data[index + 1] << 8) | (data[index + 2] << 16);
      hash = Math.imul(hash, 16777619);
      hash ^= hash >>> 13;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  snapshot() {
    return this.canvas.toDataURL("image/png");
  }
}
