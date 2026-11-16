export const NODE_DEFS = {
  levels: {
    label: "Levels",
    subtitle: "LUMA RANGE",
    color: "#769cff",
    params: [
      { key: "black", label: "Black point", min: 0, max: 128, step: 1, defaultValue: 4, decimals: 0 },
      { key: "white", label: "White point", min: 128, max: 255, step: 1, defaultValue: 248, decimals: 0 },
      { key: "gamma", label: "Midtone", min: 0.2, max: 3, step: 0.01, defaultValue: 1.04, decimals: 2 },
    ],
  },
  blur: {
    label: "Blur",
    subtitle: "SEPARABLE BOX",
    color: "#64d9de",
    params: [
      { key: "radius", label: "Radius", min: 0, max: 24, step: 1, defaultValue: 2, decimals: 0 },
    ],
  },
  noise: {
    label: "Noise",
    subtitle: "HASH GRAIN",
    color: "#ff805f",
    params: [
      { key: "amount", label: "Amount", min: 0, max: 0.6, step: 0.005, defaultValue: 0.035, decimals: 3 },
      { key: "seed", label: "Seed", min: 1, max: 9999, step: 1, defaultValue: 117, decimals: 0 },
    ],
  },
  tone: {
    label: "Tone map",
    subtitle: "ACES / SAT",
    color: "#e9ff62",
    params: [
      { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.01, defaultValue: 0.18, decimals: 2 },
      { key: "contrast", label: "Contrast", min: 0.5, max: 2, step: 0.01, defaultValue: 1.08, decimals: 2 },
      { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01, defaultValue: 1.06, decimals: 2 },
    ],
  },
};

export class PipelineError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PipelineError";
    this.details = details;
  }
}

let nextNodeSerial = 1;

export function makeNode(type, overrides = {}) {
  const definition = NODE_DEFS[type];
  if (!definition) throw new PipelineError(`Unknown node type: ${type}`, { type });
  const params = {};
  for (const param of definition.params) {
    params[param.key] = param.defaultValue;
  }
  return {
    id: `${type}-${nextNodeSerial++}`,
    type,
    enabled: true,
    ...overrides,
    params: { ...params, ...(overrides.params || {}) },
  };
}

export function createDefaultNodes() {
  return [
    makeNode("levels", { id: "levels-1" }),
    makeNode("blur", { id: "blur-1" }),
    makeNode("noise", { id: "noise-1" }),
    makeNode("tone", { id: "tone-1" }),
  ];
}

export function cloneNodes(nodes) {
  return nodes.map((node) => ({
    ...node,
    params: { ...node.params },
  }));
}

export function validatePipeline(nodes) {
  if (!Array.isArray(nodes)) {
    throw new PipelineError("The node stack must be an array.", { field: "nodes" });
  }
  const errors = [];
  for (const [index, node] of nodes.entries()) {
    if (!node || typeof node !== "object") {
      errors.push(`Node ${index + 1} has an invalid format.`);
      continue;
    }
    const definition = NODE_DEFS[node.type];
    if (!definition) {
      errors.push(`Node ${index + 1} uses unknown type "${node.type}".`);
      continue;
    }
    if (typeof node.enabled !== "boolean") {
      errors.push(`${definition.label} enabled state must be a boolean.`);
    }
    if (!node.params || typeof node.params !== "object") {
      errors.push(`${definition.label} is missing its parameter object.`);
      continue;
    }
    for (const param of definition.params) {
      const value = node.params[param.key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push(`${definition.label} / ${param.label} must be a finite number.`);
        continue;
      }
      if (value < param.min || value > param.max) {
        errors.push(
          `${definition.label} / ${param.label} must be within ${param.min}–${param.max}; received ${value}.`,
        );
      }
      if (param.step >= 1 && !Number.isInteger(value)) {
        errors.push(`${definition.label} / ${param.label} must be an integer.`);
      }
    }
    if (
      node.type === "levels" &&
      Number.isFinite(node.params.black) &&
      Number.isFinite(node.params.white) &&
      node.params.black >= node.params.white
    ) {
      errors.push(`${definition.label} black point must be lower than white point.`);
    }
  }
  if (errors.length > 0) {
    throw new PipelineError(errors[0], { field: "pipeline", errors });
  }
  return true;
}

export function nodeSignature(nodes) {
  return nodes
    .map((node) => {
      const values = Object.keys(node.params)
        .sort()
        .map((key) => `${key}:${Number(node.params[key]).toFixed(4)}`)
        .join(",");
      return `${node.type}:${node.enabled ? 1 : 0}:${values}`;
    })
    .join("|");
}

export function hashBytes(bytes) {
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashText(text) {
  const bytes = new TextEncoder().encode(String(text));
  return hashBytes(bytes);
}

function hash2d(x, y, seed) {
  let value = (seed ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function clamp(value, min = 0, max = 255) {
  return value < min ? min : value > max ? max : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

export function generateBasePixels(width, height, seed = 8421) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8) {
    throw new PipelineError("Canvas dimensions must be integers of at least 8×8.");
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sx = 0.715;
  const sy = 0.295;
  const horizon = 0.535;

  for (let y = 0; y < height; y += 1) {
    const ny = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const index = (y * width + x) * 4;
      let r;
      let g;
      let b;

      if (ny <= horizon) {
        const t = ny / horizon;
        if (t < 0.64) {
          const u = t / 0.64;
          r = mix(5, 43, u);
          g = mix(11, 57, u);
          b = mix(24, 84, u);
        } else {
          const u = (t - 0.64) / 0.36;
          r = mix(43, 222, Math.pow(u, 1.7));
          g = mix(57, 119, Math.pow(u, 1.4));
          b = mix(84, 91, Math.pow(u, 1.15));
        }
        const cloudBand =
          Math.sin(nx * 9.5 + 1.7 + ny * 3.2) * 0.5 +
          Math.sin(nx * 23.0 - ny * 8.0 + 0.6) * 0.3 +
          Math.sin(nx * 4.1 + 2.9) * 0.2;
        const cloud = Math.max(0, cloudBand - 0.58) * (1 - smoothstep(0.38, 0.56, ny));
        r += cloud * 24;
        g += cloud * 20;
        b += cloud * 24;
      } else {
        const t = (ny - horizon) / (1 - horizon);
        r = mix(54, 8, Math.pow(t, 0.55));
        g = mix(40, 15, Math.pow(t, 0.55));
        b = mix(45, 23, Math.pow(t, 0.55));
      }

      const distance = Math.hypot((nx - sx) * 1.05, ny - sy);
      const glow = Math.exp(-distance * 9.8) * 0.88 + Math.exp(-distance * 25) * 0.38;
      r += glow * 255;
      g += glow * 158;
      b += glow * 72;
      const disc = 1 - smoothstep(0.064, 0.072, distance);
      r = mix(r, 255, disc);
      g = mix(g, 236, disc);
      b = mix(b, 176, disc);

      const starField = hash2d(x >> 1, y >> 1, seed + 17);
      if (ny < 0.42 && starField > 0.9965) {
        const strength = 0.28 + (starField - 0.9965) * 90;
        r += 205 * strength;
        g += 219 * strength;
        b += 236 * strength;
      }

      const farRidge =
        0.505 +
        Math.sin(nx * 8.8 + 1.9) * 0.027 +
        Math.sin(nx * 22.4 + 0.4) * 0.009;
      const midRidge =
        0.596 +
        Math.sin(nx * 6.1 + 3.2) * 0.046 +
        Math.sin(nx * 15.7 + 2.1) * 0.012;
      const nearRidge =
        0.705 +
        Math.sin(nx * 4.2 + 0.8) * 0.052 +
        Math.sin(nx * 12.8 + 4.5) * 0.017;

      if (ny > farRidge) {
        const depth = smoothstep(farRidge, farRidge + 0.07, ny);
        r = mix(r, 58 + depth * 25, 0.62);
        g = mix(g, 67 + depth * 25, 0.62);
        b = mix(b, 78 + depth * 27, 0.62);
      }
      if (ny > midRidge) {
        const depth = smoothstep(midRidge, midRidge + 0.1, ny);
        r = mix(r, 30 + depth * 17, 0.88);
        g = mix(g, 39 + depth * 18, 0.88);
        b = mix(b, 47 + depth * 20, 0.88);
      }
      if (ny > nearRidge) {
        const depth = smoothstep(nearRidge, nearRidge + 0.12, ny);
        r = mix(r, 7 + depth * 14, 0.96);
        g = mix(g, 14 + depth * 18, 0.96);
        b = mix(b, 21 + depth * 22, 0.96);
      }

      const reflection =
        Math.exp(-Math.abs(nx - sx) * 21) *
        Math.max(0, Math.sin((ny - 0.57) * 210 + nx * 8)) *
        Math.max(0, (ny - 0.57) / 0.43);
      r += reflection * 42;
      g += reflection * 23;
      b += reflection * 12;

      const grain = (hash2d(x, y, seed) - 0.5) * 5.2;
      r += grain;
      g += grain;
      b += grain;
      const vignette = 1 - Math.pow(Math.hypot(nx - 0.5, ny - 0.5) * 1.36, 2.2) * 0.37;
      r *= vignette;
      g *= vignette;
      b *= vignette;

      pixels[index] = clamp(r);
      pixels[index + 1] = clamp(g);
      pixels[index + 2] = clamp(b);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

function abortIfNeeded(signal) {
  if (signal?.aborted) {
    const error = new Error("Render cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function yieldControl() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runRows(data, width, height, worker, options) {
  const { start = 0, end = 1, label = "PROCESSING", detail = "", onProgress, signal } = options;
  const rowsPerChunk = Math.max(1, Math.floor(180000 / width));
  for (let y = 0; y < height; y += rowsPerChunk) {
    abortIfNeeded(signal);
    const chunkEnd = Math.min(height, y + rowsPerChunk);
    for (let row = y; row < chunkEnd; row += 1) {
      worker(row, data);
    }
    const fraction = chunkEnd / height;
    onProgress?.(start + (end - start) * fraction, label, detail);
    if (chunkEnd < height) await yieldControl();
  }
}

export async function applyLevels(data, width, height, params, options = {}) {
  const black = params.black / 255;
  const white = params.white / 255;
  const inverseGamma = 1 / params.gamma;
  const range = white - black;
  await runRows(
    data,
    width,
    height,
    (y, pixels) => {
      let index = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const r = Math.min(1, Math.max(0, (pixels[index] / 255 - black) / range));
        const g = Math.min(1, Math.max(0, (pixels[index + 1] / 255 - black) / range));
        const b = Math.min(1, Math.max(0, (pixels[index + 2] / 255 - black) / range));
        pixels[index] = Math.pow(r, inverseGamma) * 255;
        pixels[index + 1] = Math.pow(g, inverseGamma) * 255;
        pixels[index + 2] = Math.pow(b, inverseGamma) * 255;
        index += 4;
      }
    },
    { ...options, detail: "Mapping black, white and midtone" },
  );
}

export async function applyBlur(data, width, height, params, options = {}) {
  const radius = Math.round(params.radius);
  if (radius <= 0) {
    options.onProgress?.(options.end ?? 1, options.label, "Radius 0, blur skipped");
    return;
  }
  const source = new Uint8ClampedArray(data);
  const temporary = new Float32Array(source.length);
  const windowSize = radius * 2 + 1;
  const clampX = (x) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y) => (y < 0 ? 0 : y >= height ? height - 1 : y);
  const progressStart = options.start ?? 0;
  const progressEnd = options.end ?? 1;
  const midpoint = progressStart + (progressEnd - progressStart) * 0.52;

  await runRows(
    source,
    width,
    height,
    (y) => {
      const rowOffset = y * width * 4;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sample = rowOffset + clampX(offset) * 4;
        sumR += source[sample];
        sumG += source[sample + 1];
        sumB += source[sample + 2];
        sumA += source[sample + 3];
      }
      for (let x = 0; x < width; x += 1) {
        const index = rowOffset + x * 4;
        temporary[index] = sumR / windowSize;
        temporary[index + 1] = sumG / windowSize;
        temporary[index + 2] = sumB / windowSize;
        temporary[index + 3] = sumA / windowSize;
        const leaving = rowOffset + clampX(x - radius) * 4;
        const entering = rowOffset + clampX(x + radius + 1) * 4;
        sumR += source[entering] - source[leaving];
        sumG += source[entering + 1] - source[leaving + 1];
        sumB += source[entering + 2] - source[leaving + 2];
        sumA += source[entering + 3] - source[leaving + 3];
      }
    },
    {
      ...options,
      start: progressStart,
      end: midpoint,
      detail: `Horizontal sampling r=${radius}`,
    },
  );

  const columnChunk = Math.max(1, Math.floor(220000 / height));
  for (let startX = 0; startX < width; startX += columnChunk) {
    abortIfNeeded(options.signal);
    const endX = Math.min(width, startX + columnChunk);
    for (let x = startX; x < endX; x += 1) {
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sample = (clampY(offset) * width + x) * 4;
        sumR += temporary[sample];
        sumG += temporary[sample + 1];
        sumB += temporary[sample + 2];
        sumA += temporary[sample + 3];
      }
      for (let y = 0; y < height; y += 1) {
        const index = (y * width + x) * 4;
        data[index] = sumR / windowSize;
        data[index + 1] = sumG / windowSize;
        data[index + 2] = sumB / windowSize;
        data[index + 3] = sumA / windowSize;
        const leaving = (clampY(y - radius) * width + x) * 4;
        const entering = (clampY(y + radius + 1) * width + x) * 4;
        sumR += temporary[entering] - temporary[leaving];
        sumG += temporary[entering + 1] - temporary[leaving + 1];
        sumB += temporary[entering + 2] - temporary[leaving + 2];
        sumA += temporary[entering + 3] - temporary[leaving + 3];
      }
    }
    const fraction = endX / width;
    options.onProgress?.(
      midpoint + (progressEnd - midpoint) * fraction,
      options.label,
      `Vertical compose ${Math.round(fraction * 100)}%`,
    );
    if (endX < width) await yieldControl();
  }
}

export async function applyNoise(data, width, height, params, options = {}) {
  const amount = params.amount;
  const seed = Math.round(params.seed);
  await runRows(
    data,
    width,
    height,
    (y, pixels) => {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const mono = hash2d(x, y, seed) - 0.5;
        const chroma = hash2d(x, y, seed + 997) - 0.5;
        const soft = hash2d(x >> 1, y >> 1, seed + 311) - 0.5;
        const grain = (mono * 0.72 + soft * 0.28) * amount * 420;
        pixels[index] += grain + chroma * amount * 54;
        pixels[index + 1] += grain - chroma * amount * 26;
        pixels[index + 2] += grain + chroma * amount * 40;
      }
    },
    { ...options, detail: `Hashed grain seed=${seed}` },
  );
}

export async function applyToneMap(data, width, height, params, options = {}) {
  const exposure = Math.pow(2, params.exposure);
  const contrast = params.contrast;
  const saturation = params.saturation;
  const aces = (value) => {
    const x = value * exposure;
    return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  };
  await runRows(
    data,
    width,
    height,
    (y, pixels) => {
      let index = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        let r = aces(pixels[index] / 255);
        let g = aces(pixels[index + 1] / 255);
        let b = aces(pixels[index + 2] / 255);
        r = 0.5 + (r - 0.5) * contrast;
        g = 0.5 + (g - 0.5) * contrast;
        b = 0.5 + (b - 0.5) * contrast;
        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
        r = luminance + (r - luminance) * saturation;
        g = luminance + (g - luminance) * saturation;
        b = luminance + (b - luminance) * saturation;
        pixels[index] = r * 255;
        pixels[index + 1] = g * 255;
        pixels[index + 2] = b * 255;
        index += 4;
      }
    },
    { ...options, detail: "ACES tone curve and saturation" },
  );
}

const OPERATIONS = {
  levels: applyLevels,
  blur: applyBlur,
  noise: applyNoise,
  tone: applyToneMap,
};

export async function processPixelBuffer(source, nodes, options = {}) {
  validatePipeline(nodes);
  const output = new Uint8ClampedArray(source);
  const width = options.width;
  const height = options.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new PipelineError("Pixel processing requires valid width and height.");
  }
  if (output.length !== width * height * 4) {
    throw new PipelineError("Pixel buffer length does not match canvas dimensions.");
  }

  if (nodes.length === 0) {
    options.onProgress?.(1, "IDENTITY", "Empty stack, returning generated base");
    return output;
  }

  for (let index = 0; index < nodes.length; index += 1) {
    abortIfNeeded(options.signal);
    const node = nodes[index];
    const definition = NODE_DEFS[node.type];
    const start = index / nodes.length;
    const end = (index + 1) / nodes.length;
    const label = `${index + 1}/${nodes.length} · ${definition.label.toUpperCase()}`;
    if (!node.enabled) {
      options.onProgress?.(end, label, "Node bypassed");
      await yieldControl();
      continue;
    }
    await OPERATIONS[node.type](output, width, height, node.params, {
      start,
      end,
      label,
      onProgress: options.onProgress,
      signal: options.signal,
    });
  }
  return output;
}
