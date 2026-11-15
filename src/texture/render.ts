import {
  buildGeometry,
  clothWaveVector,
  hashUnit,
  stoneShear,
  wrap01,
} from "./geometry";
import { hashBytes, hashNumbers } from "./hash";
import { validateParams } from "./validation";
import {
  DEFAULT_PARAMS,
  type BrushStroke,
  type GeometryState,
  type PaletteId,
  type RenderResult,
  type TextureParams,
} from "./types";

type RGB = readonly [number, number, number];

interface Palette {
  dark: RGB;
  mid: RGB;
  light: RGB;
  accent: RGB;
}

const PALETTES: Record<PaletteId, Palette> = {
  sand: {
    dark: [36, 34, 30],
    mid: [153, 140, 119],
    light: [235, 224, 198],
    accent: [170, 96, 57],
  },
  slate: {
    dark: [20, 27, 30],
    mid: [95, 109, 111],
    light: [214, 221, 215],
    accent: [85, 143, 153],
  },
  indigo: {
    dark: [10, 22, 34],
    mid: [57, 88, 107],
    light: [173, 201, 207],
    accent: [207, 139, 93],
  },
  flax: {
    dark: [42, 37, 29],
    mid: [163, 147, 111],
    light: [239, 228, 197],
    accent: [185, 108, 68],
  },
};

export const PALETTE_LABELS: Record<PaletteId, string> = {
  sand: "暖砂岩",
  slate: "冷板岩",
  indigo: "靛青布",
  flax: "亚麻布",
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

function colorFor(palette: Palette, luminance: number, accent: number): RGB {
  const lum = clamp(luminance, 0, 1);
  const base =
    lum < 0.5
      ? mixColor(palette.dark, palette.mid, lum * 2)
      : mixColor(palette.mid, palette.light, (lum - 0.5) * 2);
  if (accent <= 0.001) return base;
  const accentBase = mixColor(base, palette.accent, accent * 0.32);
  return accentBase;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function periodicNoise(
  x: number,
  y: number,
  cells: number,
  seed: number,
  salt: number,
): number {
  const px = wrap01(x) * cells;
  const py = wrap01(y) * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let tx = px - ix;
  let ty = py - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const x0 = positiveMod(ix, cells);
  const y0 = positiveMod(iy, cells);
  const x1 = positiveMod(ix + 1, cells);
  const y1 = positiveMod(iy + 1, cells);
  const a = hashUnit(seed, x0, y0, salt);
  const b = hashUnit(seed, x1, y0, salt);
  const c = hashUnit(seed, x0, y1, salt);
  const d = hashUnit(seed, x1, y1, salt);
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

function periodicFbm(
  x: number,
  y: number,
  baseCells: number,
  octaves: number,
  seed: number,
  salt: number,
): number {
  let value = 0;
  let amplitude = 0.58;
  let total = 0;
  let cells = baseCells;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += periodicNoise(x, y, cells, seed, salt + octave * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    cells *= 2;
  }
  return value / total;
}

function rasterizeBrush(
  strokes: BrushStroke[],
  width: number,
  height: number,
): Float32Array {
  const field = new Float32Array(width * height);
  for (const stroke of strokes) {
    const sign = stroke.mode === "burn" ? 1 : -1;
    const radius = clamp(stroke.size * 0.5, 1 / width, 0.3);
    const radiusX = radius * width;
    const radiusY = radius * height;
    const strength = clamp(stroke.strength, 0, 1) * 0.11;
    for (const point of stroke.points) {
      const centerX = wrap01(point.x) * width;
      const centerY = wrap01(point.y) * height;
      const minX = Math.floor(centerX - radiusX);
      const maxX = Math.ceil(centerX + radiusX);
      const minY = Math.floor(centerY - radiusY);
      const maxY = Math.ceil(centerY + radiusY);
      for (let py = minY; py <= maxY; py += 1) {
        const wy = positiveMod(py, height);
        const dy = (wy + 0.5) / height - wrap01(point.y);
        for (let px = minX; px <= maxX; px += 1) {
          const wx = positiveMod(px, width);
          const dx = (wx + 0.5) / width - wrap01(point.x);
          const distance = (dx * dx) / (radius * radius) + (dy * dy) / (radius * radius);
          if (distance >= 1) continue;
          const falloff = (1 - distance) * (1 - distance);
          field[wy * width + wx] += sign * falloff * strength;
        }
      }
    }
  }
  for (let i = 0; i < field.length; i += 1) {
    field[i] = clamp(field[i], -0.55, 0.55);
  }
  return field;
}

function measureSeams(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { seamX: number; seamY: number; seamDelta: number } {
  const channelDifference = (a: number, b: number) =>
    Math.abs(pixels[a] - pixels[b]) +
    Math.abs(pixels[a + 1] - pixels[b + 1]) +
    Math.abs(pixels[a + 2] - pixels[b + 2]);
  let vertical = 0;
  let horizontal = 0;
  let innerVertical = 0;
  let innerHorizontal = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    vertical += channelDifference(row * 4, (row + width - 1) * 4);
    innerVertical +=
      (channelDifference(row * 4, (row + 1) * 4) +
        channelDifference((row + width - 2) * 4, (row + width - 1) * 4)) /
      2;
  }
  for (let x = 0; x < width; x += 1) {
    horizontal += channelDifference(x * 4, ((height - 1) * width + x) * 4);
    innerHorizontal +=
      (channelDifference(x * 4, (width + x) * 4) +
        channelDifference(((height - 2) * width + x) * 4, ((height - 1) * width + x) * 4)) /
      2;
  }
  const seamX = vertical / (height * 3 * 255);
  const seamY = horizontal / (width * 3 * 255);
  const innerX = Math.max(0.0001, innerVertical / (height * 3 * 255));
  const innerY = Math.max(0.0001, innerHorizontal / (width * 3 * 255));
  return {
    seamX,
    seamY,
    seamDelta: Math.max(seamX / innerX, seamY / innerY),
  };
}

function measureStats(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): { min: number; max: number; mean: number; variance: number } {
  let min = 255;
  let max = 0;
  let sum = 0;
  let sumSquares = 0;
  const count = width * height;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const luminance =
      pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const mean = sum / count;
  return {
    min: min / 255,
    max: max / 255,
    mean: mean / 255,
    variance: Math.max(0, sumSquares / count - mean * mean) / (255 * 255),
  };
}

function renderStone(
  params: TextureParams,
  geometry: GeometryState,
  brush: Float32Array,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): void {
  const palette = PALETTES[params.palette];
  const grid = geometry.grid;
  const objects = geometry.objects;
  const edgeWidth = 0.0035 + params.grain * 0.017;
  const contrast = params.contrast;
  const shear = stoneShear(params.direction);
  const [waveX, waveY] = clothWaveVector(params);

  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const local = { x: wrap01(nx + shear * ny), y: ny };
      const cellX = Math.floor(local.x * grid);
      const cellY = Math.floor(local.y * grid);
      let first = 9;
      let second = 9;
      let nearestShade = 0.5;
      let nearestDx = 0;
      let nearestDy = 0;
      let nearestId = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const gy = positiveMod(cellY + oy, grid);
        for (let ox = -1; ox <= 1; ox += 1) {
          const gx = positiveMod(cellX + ox, grid);
          const object = objects[gy * grid + gx];
          if (!object) continue;
          let dx = local.x - (object.localX ?? 0);
          let dy = local.y - (object.localY ?? 0);
          dx -= Math.round(dx);
          dy -= Math.round(dy);
          const distance = dx * dx + dy * dy;
          if (distance < first) {
            second = first;
            first = distance;
            nearestShade = object.shade;
            nearestDx = dx;
            nearestDy = dy;
            nearestId = object.id;
          } else if (distance < second) {
            second = distance;
          }
        }
      }

      const f1 = Math.sqrt(first);
      const f2 = Math.sqrt(second);
      const crack = 1 - smoothstep(0, edgeWidth, f2 - f1);
      const grainA = periodicFbm(local.x, local.y, 12, 4, params.seed, 31);
      const grainB = periodicNoise(local.x, local.y, 72, params.seed, 41);
      const striation =
        Math.sin(Math.PI * 2 * (waveX * local.x + waveY * local.y)) * 0.5 + 0.5;
      const lightX = -0.55;
      const lightY = -0.75;
      const directionLength = Math.max(0.0001, f1);
      const reliefLight =
        ((nearestDx / directionLength) * lightX + (nearestDy / directionLength) * lightY) *
        params.relief;
      const vein = smoothstep(0.48, 0.54, grainA) * (1 - smoothstep(0.54, 0.64, grainA));
      const cellTone = 0.34 + nearestShade * 0.28;
      let luminance =
        0.47 +
        (cellTone - 0.5) * 0.5 +
        reliefLight * 0.13 +
        (grainA - 0.5) * params.grain * 0.22 +
        (grainB - 0.5) * params.grain * 0.09 -
        (striation - 0.5) * params.relief * 0.035 +
        crack * (0.19 + params.relief * 0.16) +
        vein * params.grain * 0.05;
      luminance = 0.5 + (luminance - 0.5) * contrast;
      const accent =
        (nearestId % 17 === 0 ? 0.1 : 0) +
        vein * 0.18 +
        crack * (nearestShade > 0.74 ? 0.2 : 0.04);
      const rgb = colorFor(palette, luminance, accent);
      const brushValue = brush[y * width + x];
      const brushLuminance = clamp(luminance + brushValue, 0, 1);
      const brushed = brushValue === 0 ? rgb : colorFor(palette, brushLuminance, accent * 0.8);
      const index = (y * width + x) * 4;
      pixels[index] = brushed[0];
      pixels[index + 1] = brushed[1];
      pixels[index + 2] = brushed[2];
      pixels[index + 3] = 255;
    }
  }
}

function renderCloth(
  params: TextureParams,
  geometry: GeometryState,
  brush: Float32Array,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): void {
  const palette = PALETTES[params.palette];
  const [m, n] = clothWaveVector(params);
  const tau = Math.PI * 2;
  const contrast = params.contrast;
  for (let y = 0; y < height; y += 1) {
    const ny = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const nx = (x + 0.5) / width;
      const warpPhase = tau * (m * nx + n * ny);
      const weftPhase = tau * (-n * nx + m * ny);
      const warp = 0.5 + 0.5 * Math.cos(warpPhase);
      const weft = 0.5 + 0.5 * Math.cos(weftPhase);
      const warpProfile = Math.pow(Math.max(0, warp), 0.2);
      const weftProfile = Math.pow(Math.max(0, weft), 0.2);
      const warpRidge = warp ** 14;
      const weftRidge = weft ** 14;
      const warpValley = 1 - smoothstep(0.02, 0.38, warp);
      const weftValley = 1 - smoothstep(0.02, 0.38, weft);
      const crossing = Math.sin(warpPhase) * Math.sin(weftPhase);
      const warpOnTop = crossing >= 0;
      const topProfile = warpOnTop ? warpProfile : weftProfile;
      const underProfile = warpOnTop ? weftProfile : warpProfile;
      const fibre = periodicNoise(nx, ny, 96, params.seed, 51);
      const slub = periodicFbm(nx, ny, 16, 4, params.seed, 61);
      const groove = Math.max(warpValley, weftValley);
      const occlusion = (1 - topProfile) * underProfile;
      let luminance =
        0.33 +
        topProfile * 0.23 +
        underProfile * 0.045 +
        (warpOnTop ? warpRidge : weftRidge) * 0.13 -
        groove * 0.16 -
        occlusion * 0.07 +
        (warpOnTop ? -0.018 : 0.012) +
        (fibre - 0.5) * params.grain * 0.17 +
        (slub - 0.5) * params.grain * 0.11;
      luminance = 0.5 + (luminance - 0.5) * contrast;
      const accent = slub * 0.1 + (fibre > 0.88 ? 0.12 : 0);
      const rgb = colorFor(palette, luminance, accent);
      const brushValue = brush[y * width + x];
      const brushed =
        brushValue === 0
          ? rgb
          : colorFor(palette, clamp(luminance + brushValue, 0, 1), accent * 0.8);
      const index = (y * width + x) * 4;
      pixels[index] = brushed[0];
      pixels[index + 1] = brushed[1];
      pixels[index + 2] = brushed[2];
      pixels[index + 3] = 255;
    }
  }
}

export function renderTexture(
  rawParams: unknown,
  strokes: BrushStroke[] = [],
  requestedSize = 512,
): RenderResult {
  const start = Date.now();
  const validation = validateParams(rawParams);
  const params = validation.changed ? validation.params : (rawParams as TextureParams);
  const safeParams: TextureParams = params ?? DEFAULT_PARAMS;
  const size = Math.round(clamp(requestedSize, 64, 2048));
  const internalSize = size < 512 ? size * 2 : size;
  const geometry = buildGeometry(safeParams);
  const brush = rasterizeBrush(strokes, internalSize, internalSize);
  const sourcePixels = new Uint8ClampedArray(internalSize * internalSize * 4);
  if (safeParams.kind === "stone") {
    renderStone(safeParams, geometry, brush, internalSize, internalSize, sourcePixels);
  } else {
    renderCloth(safeParams, geometry, brush, internalSize, internalSize, sourcePixels);
  }
  const pixels =
    internalSize === size
      ? sourcePixels
      : downsamplePixels(sourcePixels, internalSize, internalSize, size, size);
  const seams = measureSeams(pixels, size, size);
  const stats = { ...measureStats(pixels, size, size), ...seams };
  return {
    width: size,
    height: size,
    pixels,
    geometry,
    stats,
    digest: hashBytes(pixels),
    errors: validation.errors,
    usedParams: safeParams,
    durationMs: Date.now() - start,
  };
}

export function downsamplePixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * sourceWidth + sx) * 4;
          red += source[index];
          green += source[index + 1];
          blue += source[index + 2];
          alpha += source[index + 3];
          count += 1;
        }
      }
      const target = (y * targetWidth + x) * 4;
      output[target] = red / count;
      output[target + 1] = green / count;
      output[target + 2] = blue / count;
      output[target + 3] = alpha / count;
    }
  }
  return output;
}

export function structureSimilarity(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let absolute = 0;
  let meanA = 0;
  let meanB = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722;
    const lb = b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722;
    absolute += Math.abs(la - lb);
    meanA += la;
    meanB += lb;
    count += 1;
  }
  meanA /= count;
  meanB /= count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722 - meanA;
    const lb = b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722 - meanB;
    covariance += la * lb;
    varianceA += la * la;
    varianceB += lb * lb;
  }
  const correlation =
    varianceA === 0 || varianceB === 0 ? 0 : covariance / Math.sqrt(varianceA * varianceB);
  const mae = absolute / (count * 255);
  return clamp(correlation * 0.82 + (1 - mae) * 0.18, 0, 1);
}

export function geometryPositionDigest(geometry: GeometryState): string {
  const values: number[] = [];
  for (const object of geometry.objects) {
    values.push(object.id, object.x, object.y, object.size, object.angle);
  }
  return hashNumbers(values);
}
