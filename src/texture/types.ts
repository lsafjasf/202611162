export type TextureKind = "stone" | "cloth";
export type PaletteId = "sand" | "slate" | "indigo" | "flax";
export type BrushMode = "lift" | "burn";

export interface TextureParams {
  version: 1;
  kind: TextureKind;
  scale: number;
  direction: number;
  contrast: number;
  relief: number;
  grain: number;
  seed: number;
  palette: PaletteId;
}

export interface BrushPoint {
  x: number;
  y: number;
}

export interface BrushStroke {
  id: string;
  mode: BrushMode;
  size: number;
  strength: number;
  points: BrushPoint[];
}

export interface TextureDocument {
  params: TextureParams;
  strokes: BrushStroke[];
}

export interface GeometryObject {
  id: number;
  role: "cell" | "warp" | "weft";
  x: number;
  y: number;
  localX?: number;
  localY?: number;
  size: number;
  angle: number;
  shade: number;
}

export interface GeometryState {
  kind: TextureKind;
  count: number;
  grid: number;
  angle: number;
  vector: [number, number];
  objects: GeometryObject[];
  digest: string;
}

export interface RenderStats {
  min: number;
  max: number;
  mean: number;
  variance: number;
  seamDelta: number;
  seamX: number;
  seamY: number;
}

export interface RenderResult {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  geometry: GeometryState;
  stats: RenderStats;
  digest: string;
  errors: string[];
  usedParams: TextureParams;
  durationMs: number;
}

export interface SavedPreset {
  id: string;
  name: string;
  savedAt: string;
  params: TextureParams;
  strokes: BrushStroke[];
  geometryDigest: string;
  previewDigest: string;
}

export const DEFAULT_PARAMS: TextureParams = {
  version: 1,
  kind: "stone",
  scale: 18,
  direction: 24,
  contrast: 1.18,
  relief: 0.66,
  grain: 0.42,
  seed: 7319,
  palette: "sand",
};

export const FACTORY_DOCUMENT: TextureDocument = {
  params: DEFAULT_PARAMS,
  strokes: [],
};
