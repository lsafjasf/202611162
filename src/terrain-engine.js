export const DEFAULT_PARAMS = Object.freeze({
  seed: 688,
  ridgeHeight: 1,
  resolution: 48,
});

export const SECTION_SAMPLE_COUNT = 181;
export const HEIGHT_SCALE_METERS = 1000;
export const MAX_SECTION_OFFSET = 0.78;

const GRID_LIMIT = 1;
const EPSILON = 1e-9;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function validateParams(input) {
  const params = { ...DEFAULT_PARAMS, ...input };
  const errors = [];
  const seed = Number(params.seed);
  const ridgeHeight = Number(params.ridgeHeight);
  const resolution = Number(params.resolution);

  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    errors.push("种子必须是 0–2147483647 之间的整数");
  }
  if (!Number.isFinite(ridgeHeight) || ridgeHeight < 0.1 || ridgeHeight > 2.4) {
    errors.push("山脊高度必须在 0.10–2.40 之间");
  }
  if (!Number.isInteger(resolution) || resolution < 24 || resolution > 72) {
    errors.push("网格分辨率必须是 24–72 之间的整数");
  }
  if (errors.length) {
    const error = new Error(errors.join("；"));
    error.validationErrors = errors;
    throw error;
  }
  return { seed, ridgeHeight, resolution };
}

function integerHash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function createValueNoise(seed) {
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = integerHash(ix, iy, seed);
    const b = integerHash(ix + 1, iy, seed);
    const c = integerHash(ix, iy + 1, seed);
    const d = integerHash(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  };
}

function fbm(noise, x, y, octaves = 5, gain = 0.5, lacunarity = 2.03) {
  let value = 0;
  let amplitude = 1;
  let total = 0;
  let px = x;
  let py = y;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += noise(px, py) * amplitude;
    total += amplitude;
    amplitude *= gain;
    px = px * lacunarity + 17.17;
    py = py * lacunarity - 9.11;
  }
  return value / total;
}

function ridgedFbm(noise, x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.62;
  let total = 0;
  let px = x;
  let py = y;
  for (let octave = 0; octave < octaves; octave += 1) {
    const sample = 1 - Math.abs(noise(px, py) * 2 - 1);
    value += sample * sample * amplitude;
    total += amplitude;
    amplitude *= 0.47;
    px = px * 2.11 - 6.7;
    py = py * 2.11 + 13.3;
  }
  return value / total;
}

export function createHeightField(paramsInput) {
  const params = validateParams(paramsInput);
  const { seed, ridgeHeight, resolution } = params;
  const noise = createValueNoise(seed);
  const warpNoise = createValueNoise((seed ^ 0x9e3779b9) >>> 0);
  const ridgeNoise = createValueNoise((seed + 0x85ebca6b) >>> 0);

  function analyticHeight(x, z) {
    const wx = x + (warpNoise(x * 1.7 + 11.2, z * 1.7 - 4.8) - 0.5) * 0.42;
    const wz = z + (warpNoise(x * 1.7 - 7.4, z * 1.7 + 9.3) - 0.5) * 0.42;
    const broad = fbm(noise, wx * 1.8 - 3.1, wz * 1.8 + 7.7, 5);
    const ridge = ridgedFbm(ridgeNoise, wx * 2.55 + 5.8, wz * 2.55 - 1.4, 4);
    const ridgeMask = smoothstep(0.32, 0.76, ridge);
    const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
    const edgeFade = 1 - smoothstep(0.72, 1.03, edgeDistance);
    const relief = 0.08 + Math.pow(broad, 1.4) * 0.42 + Math.pow(ridgeMask, 1.1) * ridgeHeight * 0.9;
    return clamp(relief * (0.34 + edgeFade * 0.66), 0.015, 3.5);
  }

  const points = [];
  const step = (GRID_LIMIT * 2) / resolution;
  for (let iz = 0; iz <= resolution; iz += 1) {
    for (let ix = 0; ix <= resolution; ix += 1) {
      const x = -GRID_LIMIT + ix * step;
      const z = -GRID_LIMIT + iz * step;
      points.push({
        id: iz * (resolution + 1) + ix,
        ix,
        iz,
        x,
        z,
        y: analyticHeight(x, z),
      });
    }
  }
  return { params, points, step, analyticHeight };
}

export function sampleGrid(field, x, z) {
  const { params, points } = field;
  const stride = params.resolution + 1;
  const gx = clamp((x + GRID_LIMIT) / field.step, 0, params.resolution - EPSILON);
  const gz = clamp((z + GRID_LIMIT) / field.step, 0, params.resolution - EPSILON);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const p00 = points[iz * stride + ix];
  const p10 = points[iz * stride + ix + 1];
  const p01 = points[(iz + 1) * stride + ix];
  const p11 = points[(iz + 1) * stride + ix + 1];
  return lerp(lerp(p00.y, p10.y, fx), lerp(p01.y, p11.y, fx), fz);
}

export function createTerrain(paramsInput) {
  const field = createHeightField(paramsInput);
  const { params, points } = field;
  const { resolution } = params;
  const stride = resolution + 1;
  const cells = [];

  let maxPoint = points[0];
  let minPoint = points[0];
  let sum = 0;
  for (const point of points) {
    if (point.y > maxPoint.y) maxPoint = point;
    if (point.y < minPoint.y) minPoint = point;
    sum += point.y;
  }

  for (let iz = 0; iz < resolution; iz += 1) {
    for (let ix = 0; ix < resolution; ix += 1) {
      const p00 = points[iz * stride + ix];
      const p10 = points[iz * stride + ix + 1];
      const p01 = points[(iz + 1) * stride + ix];
      const p11 = points[(iz + 1) * stride + ix + 1];
      const y = (p00.y + p10.y + p01.y + p11.y) / 4;
      const dx = ((p10.y + p11.y) - (p00.y + p01.y)) / (2 * field.step);
      const dz = ((p01.y + p11.y) - (p00.y + p10.y)) / (2 * field.step);
      cells.push({
        id: iz * resolution + ix,
        ix,
        iz,
        corners: [p00, p10, p11, p01],
        x: (p00.x + p11.x) / 2,
        z: (p00.z + p11.z) / 2,
        y,
        slope: Math.hypot(dx, dz),
      });
    }
  }

  const stats = {
    peak: {
      x: maxPoint.x,
      z: maxPoint.z,
      y: maxPoint.y,
      elevation: maxPoint.y * HEIGHT_SCALE_METERS,
      index: maxPoint.id,
    },
    minimum: {
      x: minPoint.x,
      z: minPoint.z,
      y: minPoint.y,
      elevation: minPoint.y * HEIGHT_SCALE_METERS,
      index: minPoint.id,
    },
    meanElevation: (sum / points.length) * HEIGHT_SCALE_METERS,
    relief: (maxPoint.y - minPoint.y) * HEIGHT_SCALE_METERS,
  };

  const geometryDigest = digestGeometry(params, points);
  return {
    params,
    field,
    points,
    cells,
    stats,
    counts: {
      points: points.length,
      cells: cells.length,
      triangles: cells.length * 2,
      profiles: 0,
    },
    geometryDigest,
  };
}

function clipSectionToSquare(angleDeg, offset) {
  const angle = (angleDeg * Math.PI) / 180;
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), z: Math.cos(angle) };
  const origin = { x: normal.x * offset, z: normal.z * offset };
  const candidates = [];

  if (Math.abs(direction.x) > EPSILON) {
    for (const x of [-GRID_LIMIT, GRID_LIMIT]) {
      const t = (x - origin.x) / direction.x;
      const z = origin.z + direction.z * t;
      if (z >= -GRID_LIMIT - EPSILON && z <= GRID_LIMIT + EPSILON) candidates.push(t);
    }
  }
  if (Math.abs(direction.z) > EPSILON) {
    for (const z of [-GRID_LIMIT, GRID_LIMIT]) {
      const t = (z - origin.z) / direction.z;
      const x = origin.x + direction.x * t;
      if (x >= -GRID_LIMIT - EPSILON && x <= GRID_LIMIT + EPSILON) candidates.push(t);
    }
  }
  const tMin = Math.min(...candidates);
  const tMax = Math.max(...candidates);
  return {
    angle,
    direction,
    normal,
    origin,
    start: {
      x: origin.x + direction.x * tMin,
      z: origin.z + direction.z * tMin,
    },
    end: {
      x: origin.x + direction.x * tMax,
      z: origin.z + direction.z * tMax,
    },
    length: tMax - tMin,
  };
}

export function createSection(terrain, settings = {}) {
  const angle = clamp(Number(settings.angle ?? 24), 0, 180);
  const offset = clamp(Number(settings.offset ?? 0), -MAX_SECTION_OFFSET, MAX_SECTION_OFFSET);
  if (!Number.isFinite(angle) || !Number.isFinite(offset)) {
    throw new Error("剖面角度与偏移必须是有效数字");
  }
  const line = clipSectionToSquare(angle, offset);
  const samples = [];
  let maxSample = null;
  for (let index = 0; index < SECTION_SAMPLE_COUNT; index += 1) {
    const t = index / (SECTION_SAMPLE_COUNT - 1);
    const x = lerp(line.start.x, line.end.x, t);
    const z = lerp(line.start.z, line.end.z, t);
    const y = sampleGrid(terrain.field, x, z);
    const sample = { id: index, t, x, z, y, elevation: y * HEIGHT_SCALE_METERS };
    if (!maxSample || sample.y > maxSample.y) maxSample = sample;
    samples.push(sample);
  }
  const profileDigest = digestProfile(angle, offset, samples);
  return {
    angle,
    offset,
    line,
    samples,
    maxSample,
    lengthMeters: line.length * 2000,
    counts: { samples: samples.length },
    profileDigest,
  };
}

export function sampleSectionAt(section, fraction) {
  const t = clamp(fraction, 0, 1);
  const index = t * (section.samples.length - 1);
  const low = Math.floor(index);
  const high = Math.min(section.samples.length - 1, low + (index > low ? 1 : 0));
  const mix = index - low;
  const a = section.samples[low];
  const b = section.samples[high];
  return {
    x: lerp(a.x, b.x, mix),
    z: lerp(a.z, b.z, mix),
    y: lerp(a.y, b.y, mix),
    elevation: lerp(a.elevation, b.elevation, mix),
    t,
  };
}

export function digestString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function digestGeometry(params, points) {
  const chunks = [params.seed, params.ridgeHeight, params.resolution, points.length];
  for (const point of points) {
    chunks.push(point.x.toFixed(5), point.z.toFixed(5), point.y.toFixed(6));
  }
  return digestString(chunks.join("|"));
}

function digestProfile(angle, offset, samples) {
  const chunks = [angle.toFixed(4), offset.toFixed(4), samples.length];
  for (const sample of samples) {
    chunks.push(sample.x.toFixed(5), sample.z.toFixed(5), sample.y.toFixed(6));
  }
  return digestString(chunks.join("|"));
}
