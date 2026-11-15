export type MaterialId = "bronze" | "resin";
export type LightingId = "dawn" | "gallery";

export interface ViewParams {
  material: MaterialId;
  lighting: LightingId;
  yaw: number;
  pitch: number;
  zoom: number;
  autoRotate: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Face {
  a: number;
  b: number;
  c: number;
  tone: number;
}

export type MeshKind = "relic" | "pedestal" | "halo" | "shard";

export interface Mesh {
  id: string;
  name: string;
  kind: MeshKind;
  vertices: Vec3[];
  faces: Face[];
  position: Vec3;
  alpha: number;
}

export interface Scene {
  meshes: Mesh[];
  seed: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export interface LabelLayout {
  id: string;
  text: string;
  subtext: string;
  anchor: ProjectedPoint;
  box: { x: number; y: number; width: number; height: number };
  leader: { x: number; y: number };
}

export interface RenderMetrics {
  drawnFaces: number;
  culledFaces: number;
  backfaceFaces: number;
  transparentFaces: number;
  normalsOutward: boolean;
  minOutwardDot: number;
  depthOrderMonotonic: boolean;
  drawOrderDigest: string;
  labels: LabelLayout[];
  objectCount: number;
}

export interface GeometrySummary {
  objectCount: number;
  vertexCount: number;
  triangleCount: number;
  geometryDigest: string;
  objectPositions: Record<string, [number, number, number]>;
  objectBounds: Record<
    string,
    {
      min: [number, number, number];
      max: [number, number, number];
      centroid: [number, number, number];
    }
  >;
}

export const DEFAULT_PARAMS: Readonly<ViewParams> = Object.freeze({
  material: "bronze",
  lighting: "dawn",
  yaw: -36,
  pitch: 7,
  zoom: 1,
  autoRotate: true
});

export const MATERIAL_IDS: readonly MaterialId[] = ["bronze", "resin"];
export const LIGHTING_IDS: readonly LightingId[] = ["dawn", "gallery"];
export const PARAM_KEYS: readonly (keyof ViewParams)[] = [
  "material",
  "lighting",
  "yaw",
  "pitch",
  "zoom",
  "autoRotate"
];
