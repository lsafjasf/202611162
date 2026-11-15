import type { Vec3 } from "./types";

export const DEG_TO_RAD = Math.PI / 180;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, amount: number): Vec3 {
  return { x: v.x * amount, y: v.y * amount, z: v.z * amount };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v: Vec3): Vec3 {
  const magnitude = length(v);
  return magnitude > 1e-9 ? scale(v, 1 / magnitude) : vec3(0, 1, 0);
}

export function rotateView(v: Vec3, yawRadians: number, pitchRadians: number): Vec3 {
  const cy = Math.cos(yawRadians);
  const sy = Math.sin(yawRadians);
  const cp = Math.cos(pitchRadians);
  const sp = Math.sin(pitchRadians);
  const xYaw = v.x * cy - v.z * sy;
  const zYaw = v.x * sy + v.z * cy;
  return {
    x: xYaw,
    y: v.y * cp - zYaw * sp,
    z: v.y * sp + zYaw * cp
  };
}

export function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
