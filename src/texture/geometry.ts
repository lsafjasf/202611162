import { hashNumbers } from "./hash";
import type { GeometryObject, GeometryState, TextureParams } from "./types";

export function wrap01(value: number): number {
  return value - Math.floor(value);
}

export function rotateAroundCenter(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - 0.5;
  const dy = y - 0.5;
  return {
    x: wrap01(0.5 + dx * cos - dy * sin),
    y: wrap01(0.5 + dx * sin + dy * cos),
  };
}

export function unrotateAroundCenter(x: number, y: number, degrees: number) {
  const radians = (-degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = x - 0.5;
  const dy = y - 0.5;
  return {
    x: wrap01(0.5 + dx * cos - dy * sin),
    y: wrap01(0.5 + dx * sin + dy * cos),
  };
}

export function hashUnit(seed: number, x: number, y: number, salt = 0): number {
  let h = seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77);
  h ^= Math.imul(salt + 17, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function clothWaveVector(params: TextureParams): [number, number] {
  const target = (params.direction * Math.PI) / 180;
  const frequency = Math.max(4, Math.round(params.scale * 1.15));
  let m = Math.round(Math.cos(target) * frequency);
  let n = Math.round(Math.sin(target) * frequency);
  if (m === 0 && n === 0) m = frequency;
  return [m, n];
}

export function stoneShear(direction: number): number {
  return Math.max(-8, Math.min(8, Math.round(direction / 22.5)));
}

function buildStoneGeometry(params: TextureParams): GeometryState {
  const grid = Math.max(6, Math.min(48, Math.round(params.scale)));
  const objects: GeometryObject[] = [];
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const jitterX = (hashUnit(params.seed, gx, gy, 1) - 0.5) * 0.58;
      const jitterY = (hashUnit(params.seed, gx, gy, 2) - 0.5) * 0.58;
      const localX = (gx + 0.5 + jitterX) / grid;
      const localY = (gy + 0.5 + jitterY) / grid;
      const shear = stoneShear(params.direction);
      objects.push({
        id: gy * grid + gx,
        role: "cell",
        x: wrap01(localX - shear * localY),
        y: localY,
        localX,
        localY,
        size: (0.72 + hashUnit(params.seed, gx, gy, 3) * 0.42) / grid,
        angle: params.direction,
        shade: hashUnit(params.seed, gx, gy, 4),
      });
    }
  }
  return finishGeometry("stone", grid, params.direction, [grid, 0], objects);
}

function buildClothGeometry(params: TextureParams): GeometryState {
  const [m, n] = clothWaveVector(params);
  const grid = Math.max(6, Math.min(48, Math.round(Math.hypot(m, n))));
  const realizedAngle = (Math.atan2(n, m) * 180) / Math.PI;
  const objects: GeometryObject[] = [];
  for (let lane = 0; lane < grid; lane += 1) {
    const offset = (lane + 0.5) / grid;
    const warp = rotateAroundCenter(offset, 0.36, realizedAngle);
    const weft = rotateAroundCenter(0.64, offset, realizedAngle);
    objects.push({
      id: lane,
      role: "warp",
      x: warp.x,
      y: warp.y,
      localX: offset,
      localY: 0.36,
      size: 1 / grid,
      angle: realizedAngle,
      shade: hashUnit(params.seed, lane, 0, 11),
    });
    objects.push({
      id: lane,
      role: "weft",
      x: weft.x,
      y: weft.y,
      localX: 0.64,
      localY: offset,
      size: 1 / grid,
      angle: realizedAngle + 90,
      shade: hashUnit(params.seed, lane, 0, 12),
    });
  }
  return finishGeometry("cloth", grid, realizedAngle, [m, n], objects);
}

function finishGeometry(
  kind: GeometryState["kind"],
  grid: number,
  angle: number,
  vector: [number, number],
  objects: GeometryObject[],
): GeometryState {
  const values: number[] = [];
  for (const object of objects) {
    values.push(
      object.id,
      object.role === "cell" ? 1 : object.role === "warp" ? 2 : 3,
      object.x,
      object.y,
      object.localX ?? 0,
      object.localY ?? 0,
      object.size,
      object.angle,
      object.shade,
    );
  }
  return {
    kind,
    count: objects.length,
    grid,
    angle,
    vector,
    objects,
    digest: hashNumbers(values),
  };
}

export function buildGeometry(params: TextureParams): GeometryState {
  return params.kind === "stone" ? buildStoneGeometry(params) : buildClothGeometry(params);
}

export function geometrySummary(geometry: GeometryState) {
  return {
    count: geometry.count,
    grid: geometry.grid,
    angle: Number(geometry.angle.toFixed(3)),
    vector: geometry.vector,
    digest: geometry.digest,
  };
}
