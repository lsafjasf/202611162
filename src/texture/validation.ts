import { DEFAULT_PARAMS, type TextureParams } from "./types";

export interface ValidationResult {
  params: TextureParams;
  errors: string[];
  changed: boolean;
}

const KINDS = new Set(["stone", "cloth"]);
const PALETTES = new Set(["sand", "slate", "indigo", "flax"]);

function asFiniteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  fallback: number,
  errors: string[],
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label}必须是有限数字，已使用安全值 ${fallback}。`);
    return fallback;
  }
  if (value < min || value > max) {
    const clamped = Math.min(max, Math.max(min, value));
    errors.push(`${label}应在 ${min}–${max} 之间，已调整为 ${clamped}。`);
    return clamped;
  }
  return value;
}

export function validateParams(input: unknown): ValidationResult {
  const errors: string[] = [];
  const source =
    input && typeof input === "object" ? (input as Partial<TextureParams>) : {};

  if (!input || typeof input !== "object") {
    errors.push("参数体不是有效对象，已回退到默认纹理。");
  }

  const kind = KINDS.has(String(source.kind))
    ? (source.kind as TextureParams["kind"])
    : DEFAULT_PARAMS.kind;
  if (source.kind !== undefined && !KINDS.has(String(source.kind))) {
    errors.push(`不支持的纹理类型「${String(source.kind)}」，已回退为石纹。`);
  }

  const palette = PALETTES.has(String(source.palette))
    ? (source.palette as TextureParams["palette"])
    : DEFAULT_PARAMS.palette;
  if (source.palette !== undefined && !PALETTES.has(String(source.palette))) {
    errors.push(`未知色板「${String(source.palette)}」，已使用暖砂岩。`);
  }

  const params: TextureParams = {
    version: 1,
    kind,
    palette,
    scale: asFiniteNumber(source.scale, "尺度", 6, 48, DEFAULT_PARAMS.scale, errors),
    direction: asFiniteNumber(
      source.direction,
      "方向",
      -180,
      180,
      DEFAULT_PARAMS.direction,
      errors,
    ),
    contrast: asFiniteNumber(
      source.contrast,
      "对比度",
      0.5,
      2.5,
      DEFAULT_PARAMS.contrast,
      errors,
    ),
    relief: asFiniteNumber(source.relief, "浮雕", 0, 1, DEFAULT_PARAMS.relief, errors),
    grain: asFiniteNumber(source.grain, "颗粒", 0, 1, DEFAULT_PARAMS.grain, errors),
    seed: Math.round(
      asFiniteNumber(source.seed, "随机种子", 1, 99999, DEFAULT_PARAMS.seed, errors),
    ),
  };

  const changed = errors.length > 0;
  return { params, errors, changed };
}

export function paramsSignature(params: TextureParams): string {
  return [
    params.kind,
    params.scale.toFixed(3),
    params.direction.toFixed(3),
    params.contrast.toFixed(3),
    params.relief.toFixed(3),
    params.grain.toFixed(3),
    params.seed,
    params.palette,
  ].join("|");
}
