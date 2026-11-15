import { hashString, stableStringify } from "./hash";
import { renderTexture } from "./render";
import {
  DEFAULT_PARAMS,
  FACTORY_DOCUMENT,
  type BrushPoint,
  type BrushStroke,
  type SavedPreset,
  type TextureDocument,
  type TextureParams,
} from "./types";
import { validateParams } from "./validation";

export const CURRENT_KEY = "tessera.current.v1";
export const PRESETS_KEY = "tessera.presets.v1";

export interface DocumentParseResult {
  document: TextureDocument;
  errors: string[];
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseStroke(input: unknown, index: number, errors: string[]): BrushStroke | null {
  if (!input || typeof input !== "object") {
    errors.push(`第 ${index + 1} 条笔刷记录格式无效，已跳过。`);
    return null;
  }
  const candidate = input as Partial<BrushStroke>;
  if (!Array.isArray(candidate.points)) {
    errors.push(`第 ${index + 1} 条笔刷缺少轨迹点，已跳过。`);
    return null;
  }
  const points: BrushPoint[] = [];
  for (const point of candidate.points.slice(0, 2400)) {
    if (!point || typeof point !== "object") continue;
    const px = finiteOr((point as BrushPoint).x, Number.NaN);
    const py = finiteOr((point as BrushPoint).y, Number.NaN);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    points.push({ x: px - Math.floor(px), y: py - Math.floor(py) });
  }
  if (points.length === 0) {
    errors.push(`第 ${index + 1} 条笔刷没有有效坐标，已跳过。`);
    return null;
  }
  return {
    id: typeof candidate.id === "string" ? candidate.id.slice(0, 80) : `restored-${index}`,
    mode: candidate.mode === "lift" ? "lift" : "burn",
    size: clamp(finiteOr(candidate.size, 0.06), 0.005, 0.3),
    strength: clamp(finiteOr(candidate.strength, 0.35), 0.01, 1),
    points,
  };
}

export function parseDocument(input: unknown): DocumentParseResult {
  const errors: string[] = [];
  let source: unknown = input;
  if (typeof input === "string") {
    try {
      source = JSON.parse(input);
    } catch {
      errors.push("参数 JSON 无法解析，请检查括号、引号和逗号。");
      source = {};
    }
  }
  const object =
    source && typeof source === "object" ? (source as Record<string, unknown>) : {};
  const paramsSource = object.params ?? object;
  const validation = validateParams(paramsSource);
  errors.push(...validation.errors);
  const rawStrokes = Array.isArray(object.strokes) ? object.strokes : [];
  if (object.strokes !== undefined && !Array.isArray(object.strokes)) {
    errors.push("笔刷轨迹不是数组，已忽略笔刷层。");
  }
  const strokes = rawStrokes
    .slice(0, 160)
    .map((stroke, index) => parseStroke(stroke, index, errors))
    .filter((stroke): stroke is BrushStroke => stroke !== null);
  return {
    document: { params: validation.params, strokes },
    errors,
  };
}

export function serializeDocument(document: TextureDocument): string {
  return stableStringify(document);
}

export function documentHash(document: TextureDocument): string {
  return hashString(serializeDocument(document));
}

export function makePreset(
  name: string,
  document: TextureDocument,
  previewSize = 128,
): SavedPreset {
  const preview = renderTexture(document.params, document.strokes, previewSize);
  return {
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || "未命名参数",
    savedAt: new Date().toISOString(),
    params: document.params,
    strokes: document.strokes,
    geometryDigest: preview.geometry.digest,
    previewDigest: preview.digest,
  };
}

export function loadCurrentDocument(): DocumentParseResult {
  if (typeof localStorage === "undefined") {
    return { document: FACTORY_DOCUMENT, errors: [] };
  }
  const raw = localStorage.getItem(CURRENT_KEY);
  if (!raw) return { document: FACTORY_DOCUMENT, errors: [] };
  return parseDocument(raw);
}

export function saveCurrentDocument(document: TextureDocument): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    localStorage.setItem(CURRENT_KEY, serializeDocument(document));
    return [];
  } catch {
    return ["浏览器存储空间不足，本次工作区参数未能自动保存。"];
  }
}

export function loadPresets(): SavedPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedPreset =>
        Boolean(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        Boolean(item.params),
    );
  } catch {
    return [];
  }
}

export function persistPresets(presets: SavedPreset[]): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    return [];
  } catch {
    return ["预设保存失败：浏览器存储空间不足。"];
  }
}

export function createStarterPresets(): SavedPreset[] {
  const stone = makePreset("基准 · 暖砂岩", {
    params: DEFAULT_PARAMS,
    strokes: [],
  });
  const cloth = makePreset("基准 · 靛青布", {
    params: {
      ...DEFAULT_PARAMS,
      kind: "cloth",
      palette: "indigo",
      scale: 22,
      direction: 68,
      contrast: 1.32,
      relief: 0.48,
      grain: 0.58,
      seed: 8127,
    },
    strokes: [],
  });
  return [stone, cloth];
}
