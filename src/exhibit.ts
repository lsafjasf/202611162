import { buildScene, summarizeGeometry } from "./geometry";
import { normalizeAngle, ParameterError, ParameterHistory, cloneParams, defaultParams, validateParams } from "./params";
import { listPresets, loadPreset, savePreset } from "./presets";
import { CANVAS_HEIGHT, CANVAS_WIDTH, canvasDigest, renderScene } from "./renderer";
import type { GeometrySummary, LabelLayout, RenderMetrics, Scene, ViewParams } from "./types";
import { paramsEqual } from "./params";

export interface AuditSnapshot {
  state: ViewParams;
  geometry: GeometrySummary;
  render: RenderMetrics;
  previewDigest: string;
  labels: LabelLayout[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface CaptureResult {
  width: number;
  height: number;
  pixelDigest: string;
  previewDigest: string;
  pngSha256: string;
  match: boolean;
  state: ViewParams;
  geometryDigest: string;
  labels: LabelLayout[];
  drawOrderDigest: string;
  capturedAt: string;
  dataUrl?: string;
}

export interface RecomputeResult {
  before: GeometrySummary;
  after: GeometrySummary;
  geometryStable: boolean;
  renderStable: boolean;
  beforePreviewDigest: string;
  afterPreviewDigest: string;
  objectCount: number;
  objectPositions: Record<string, [number, number, number]>;
}

export class ExhibitController {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private scene: Scene;
  private geometry: GeometrySummary;
  private params: ViewParams;
  private readonly history: ParameterHistory;
  private renderMetrics: RenderMetrics;
  private previewDigestCache: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D is unavailable in this browser.");
    this.canvas = canvas;
    this.context = context;
    this.params = defaultParams();
    this.scene = buildScene();
    this.geometry = summarizeGeometry(this.scene);
    this.history = new ParameterHistory(this.params);
    this.renderMetrics = renderScene(this.context, this.scene, this.params);
  }

  get state(): ViewParams {
    return cloneParams(this.params);
  }

  get metrics(): RenderMetrics {
    return this.renderMetrics;
  }

  get geometrySummary(): GeometrySummary {
    return this.geometry;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  render(): RenderMetrics {
    this.renderMetrics = renderScene(this.context, this.scene, this.params);
    this.previewDigestCache = null;
    return this.renderMetrics;
  }

  apply(patch: unknown, record = true): ViewParams {
    const next = validateParams(patch, this.params);
    const previous = this.params;
    if (paramsEqual(previous, next)) return this.params;
    this.params = next;
    this.render();
    if (record) this.history.commit(this.params);
    return this.state;
  }

  commitState(): void {
    this.history.commit(this.params);
  }

  setAutoRotate(enabled: boolean, record = true): ViewParams {
    return this.apply({ autoRotate: enabled }, record);
  }

  advance(deltaMs: number): boolean {
    if (!this.params.autoRotate || !Number.isFinite(deltaMs) || deltaMs <= 0) return false;
    const bounded = Math.min(100, deltaMs);
    this.params = {
      ...this.params,
      yaw: normalizeAngle(this.params.yaw + bounded * 0.01)
    };
    this.render();
    return true;
  }

  undo(): ViewParams | null {
    const next = this.history.undo();
    if (!next) return null;
    this.params = next;
    this.render();
    return this.state;
  }

  redo(): ViewParams | null {
    const next = this.history.redo();
    if (!next) return null;
    this.params = next;
    this.render();
    return this.state;
  }

  getPreviewDigest(): string {
    if (this.previewDigestCache === null) {
      this.previewDigestCache = canvasDigest(this.canvas);
    }
    return this.previewDigestCache;
  }

  getAudit(): AuditSnapshot {
    return {
      state: this.state,
      geometry: structuredClone(this.geometry),
      render: structuredClone(this.renderMetrics),
      previewDigest: this.getPreviewDigest(),
      labels: structuredClone(this.renderMetrics.labels),
      canUndo: this.canUndo,
      canRedo: this.canRedo
    };
  }

  async capture(includeDataUrl = false): Promise<CaptureResult> {
    this.render();
    const capturedState = this.state;
    const capturedGeometryDigest = this.geometry.geometryDigest;
    const capturedLabels = structuredClone(this.renderMetrics.labels);
    const capturedDrawOrder = this.renderMetrics.drawOrderDigest;
    const previewDigest = this.getPreviewDigest();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_WIDTH;
    exportCanvas.height = CANVAS_HEIGHT;
    const exportContext = exportCanvas.getContext("2d", { willReadFrequently: true });
    if (!exportContext) throw new Error("Could not create the export canvas.");
    renderScene(exportContext, this.scene, this.params);
    const pixelDigest = canvasDigest(exportCanvas);
    const blob = await canvasToBlob(exportCanvas);
    const pngSha256 = await sha256(blob);
    return {
      width: exportCanvas.width,
      height: exportCanvas.height,
      pixelDigest,
      previewDigest,
      pngSha256,
      match: pixelDigest === previewDigest,
      state: capturedState,
      geometryDigest: capturedGeometryDigest,
      labels: capturedLabels,
      drawOrderDigest: capturedDrawOrder,
      capturedAt: new Date().toISOString(),
      ...(includeDataUrl ? { dataUrl: exportCanvas.toDataURL("image/png") } : {})
    };
  }

  async download(): Promise<CaptureResult> {
    const result = await this.capture(true);
    if (!result.dataUrl) throw new Error("Could not prepare PNG download.");
    const blob = await (await fetch(result.dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `polyhedral-relic-${this.params.material}-${Math.round(this.params.yaw)}deg.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    return result;
  }

  recompute(): RecomputeResult {
    const before = structuredClone(this.geometry);
    const beforePreviewDigest = this.getPreviewDigest();
    this.scene = buildScene();
    this.geometry = summarizeGeometry(this.scene);
    this.render();
    const afterPreviewDigest = this.getPreviewDigest();
    return {
      before,
      after: structuredClone(this.geometry),
      geometryStable: before.geometryDigest === this.geometry.geometryDigest,
      renderStable: beforePreviewDigest === afterPreviewDigest,
      beforePreviewDigest,
      afterPreviewDigest,
      objectCount: this.geometry.objectCount,
      objectPositions: structuredClone(this.geometry.objectPositions)
    };
  }

  saveCurrentPreset(name: string): { name: string; count: number } {
    const preset = savePreset(name, this.params, this.geometry.geometryDigest);
    return { name: preset.name, count: listPresets().length };
  }

  loadNamedPreset(name: string): ViewParams {
    const preset = loadPreset(name);
    if (preset.geometryDigest !== this.geometry.geometryDigest) {
      throw new Error(
        `Preset "${name}" belongs to geometry ${preset.geometryDigest}, but the current scene is ${this.geometry.geometryDigest}.`
      );
    }
    this.params = preset.params;
    this.render();
    this.history.commit(this.params);
    return this.state;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG encoding failed."));
    }, "image/png");
  });
}

async function sha256(blob: Blob): Promise<string> {
  if (!crypto.subtle) throw new Error("SHA-256 is unavailable in this browser context.");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function describeError(error: unknown): string {
  if (error instanceof ParameterError) return error.issues.join(" ");
  if (error instanceof Error) return error.message;
  return String(error);
}
