import "./style.css";
import { ExhibitController, describeError } from "./exhibit";
import type { AuditSnapshot, CaptureResult } from "./exhibit";
import { normalizeAngle } from "./params";
import { clearPresets, listPresets } from "./presets";
import { projectWorldPoint } from "./renderer";
import type { ProjectedPoint, ViewParams } from "./types";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}.`);
  return element as T;
}

const canvas = byId<HTMLCanvasElement>("stage");
const controller = new ExhibitController(canvas);
const viewport = byId<HTMLDivElement>("viewport");
const errorBanner = byId<HTMLDivElement>("errorBanner");
const errorMessage = byId<HTMLSpanElement>("errorMessage");
const dismissError = byId<HTMLButtonElement>("dismissError");
const pauseButton = byId<HTMLButtonElement>("pauseButton");
const pauseLabel = byId<HTMLSpanElement>("pauseLabel");
const pauseIcon = byId<HTMLSpanElement>("pauseIcon");
const liveState = byId<HTMLSpanElement>("liveState");
const liveText = byId<HTMLSpanElement>("liveText");
const motionValue = byId<HTMLSpanElement>("motionValue");
const lightValue = byId<HTMLSpanElement>("lightValue");
const cameraReadout = byId<HTMLSpanElement>("cameraReadout");
const meshStatus = byId<HTMLSpanElement>("meshStatus");
const facetCount = byId<HTMLSpanElement>("facetCount");
const undoButton = byId<HTMLButtonElement>("undoButton");
const redoButton = byId<HTMLButtonElement>("redoButton");
const yawRange = byId<HTMLInputElement>("yawRange");
const pitchRange = byId<HTMLInputElement>("pitchRange");
const zoomRange = byId<HTMLInputElement>("zoomRange");
const yawOutput = byId<HTMLOutputElement>("yawOutput");
const pitchOutput = byId<HTMLOutputElement>("pitchOutput");
const zoomOutput = byId<HTMLOutputElement>("zoomOutput");
const presetName = byId<HTMLInputElement>("presetName");
const presetSelect = byId<HTMLSelectElement>("presetSelect");
const savedCount = byId<HTMLSpanElement>("savedCount");
const savePresetButton = byId<HTMLButtonElement>("savePreset");
const loadPresetButton = byId<HTMLButtonElement>("loadPreset");
const exportButton = byId<HTMLButtonElement>("exportButton");
const importButton = byId<HTMLButtonElement>("importButton");
const importDialog = byId<HTMLDialogElement>("importDialog");
const importForm = byId<HTMLFormElement>("importForm");
const importJson = byId<HTMLTextAreaElement>("importJson");
const importError = byId<HTMLParagraphElement>("importError");
const cancelImport = byId<HTMLButtonElement>("cancelImport");
const toast = byId<HTMLDivElement>("toast");
const materialButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-material]"));
const lightingButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-lighting]"));

let lastFrameTime = performance.now();
let toastTimer: number | undefined;
let wheelCommitTimer: number | undefined;
let lastExport: CaptureResult | null = null;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function signedDegrees(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}°`;
}

function formatAzimuth(value: number): string {
  return String(Math.round((value + 360) % 360)).padStart(3, "0");
}

function renderUI(): void {
  const state = controller.state;
  materialButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.material === state.material));
  });
  lightingButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lighting === state.lighting));
  });

  pauseLabel.textContent = state.autoRotate ? "PAUSE TURNTABLE" : "RESUME TURNTABLE";
  motionValue.textContent = state.autoRotate ? "RUNNING" : "FROZEN";
  pauseIcon.classList.toggle("pause-icon--play", !state.autoRotate);
  liveState.classList.toggle("live-state--paused", !state.autoRotate);
  liveText.textContent = state.autoRotate ? "TURNTABLE LIVE" : "VIEW PAUSED";
  lightValue.textContent = state.lighting.toUpperCase();
  cameraReadout.textContent = `AZ ${formatAzimuth(state.yaw)}° / EL ${signedDegrees(state.pitch)}`;
  meshStatus.textContent = `STABLE / ${controller.geometrySummary.objectCount} OBJ`;
  facetCount.textContent = "80";

  yawRange.value = String(Math.round(state.yaw));
  pitchRange.value = String(Math.round(state.pitch));
  zoomRange.value = state.zoom.toFixed(2);
  yawOutput.textContent = signedDegrees(state.yaw);
  pitchOutput.textContent = signedDegrees(state.pitch);
  zoomOutput.textContent = `${state.zoom.toFixed(2)}×`;

  undoButton.disabled = !controller.canUndo;
  redoButton.disabled = !controller.canRedo;
}

function showToast(message: string, isError = false): void {
  toast.textContent = message;
  toast.classList.toggle("toast--error", isError);
  toast.classList.add("toast--visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("toast--visible"), 3_400);
}

function showError(error: unknown): string {
  const message = describeError(error);
  errorMessage.textContent = message;
  errorBanner.hidden = false;
  viewport.classList.add("viewport--error");
  showToast(message, true);
  console.warn("[relic] rejected parameters:", message);
  return message;
}

function clearError(): void {
  errorBanner.hidden = true;
  viewport.classList.remove("viewport--error");
}

type ApplyResult =
  | { ok: true; state: ViewParams }
  | { ok: false; error: string; state: ViewParams };

function applySafely(patch: unknown, record = true): ApplyResult {
  try {
    const state = controller.apply(patch, record);
    lastFrameTime = performance.now();
    renderUI();
    clearError();
    return { ok: true, state };
  } catch (error) {
    return { ok: false, error: showError(error), state: controller.state };
  }
}

function undo(): boolean {
  const state = controller.undo();
  if (!state) return false;
  lastFrameTime = performance.now();
  renderUI();
  showToast("Undid the last parameter change.");
  return true;
}

function redo(): boolean {
  const state = controller.redo();
  if (!state) return false;
  lastFrameTime = performance.now();
  renderUI();
  showToast("Restored the next parameter change.");
  return true;
}

function refreshPresets(): void {
  const presets = listPresets();
  const selected = presetSelect.value;
  presetSelect.replaceChildren(
    new Option(presets.length === 0 ? "No saved studies" : "Select a saved study", ""),
    ...presets.map((preset) => new Option(preset.name, preset.name))
  );
  if (presets.some((preset) => preset.name === selected)) presetSelect.value = selected;
  savedCount.textContent = `${presets.length} SAVED`;
}

function animate(now: number): void {
  const elapsed = now - lastFrameTime;
  lastFrameTime = now;
  if (controller.state.autoRotate && controller.advance(elapsed)) renderUI();
  requestAnimationFrame(animate);
}

renderUI();
refreshPresets();
requestAnimationFrame(animate);

function pauseForManualControl(): void {
  if (controller.state.autoRotate) applySafely({ autoRotate: false });
}

pauseButton.addEventListener("click", () => {
  const enabled = !controller.state.autoRotate;
  const result = applySafely({ autoRotate: enabled });
  if (result.ok) {
    showToast(enabled ? "Turntable resumed from the current frame." : "Turntable paused at the current frame.");
  }
});

materialButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applySafely({ material: button.dataset.material });
  });
});

lightingButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applySafely({ lighting: button.dataset.lighting });
  });
});

type RangeKey = "yaw" | "pitch" | "zoom";

function bindRange(input: HTMLInputElement, key: RangeKey): void {
  input.addEventListener("pointerdown", pauseForManualControl);
  input.addEventListener("keydown", pauseForManualControl);
  input.addEventListener("input", () => {
    applySafely({ [key]: Number(input.value) }, false);
  });
  input.addEventListener("change", () => {
    controller.commitState();
    renderUI();
  });
}

bindRange(yawRange, "yaw");
bindRange(pitchRange, "pitch");
bindRange(zoomRange, "zoom");

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

let dragState: DragState | null = null;

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pauseForManualControl();
  dragState = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    yaw: controller.state.yaw,
    pitch: controller.state.pitch
  };
  canvas.setPointerCapture(event.pointerId);
  viewport.classList.add("viewport--dragging");
  canvas.focus({ preventScroll: true });
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - dragState.x;
  const deltaY = event.clientY - dragState.y;
  applySafely(
    {
      yaw: normalizeAngle(dragState.yaw + deltaX * 0.42),
      pitch: clamp(dragState.pitch - deltaY * 0.3, -70, 70)
    },
    false
  );
});

function endDrag(event: PointerEvent): void {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  controller.commitState();
  dragState = null;
  viewport.classList.remove("viewport--dragging");
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  renderUI();
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    pauseForManualControl();
    const factor = event.deltaY > 0 ? 0.94 : 1.06;
    const nextZoom = clamp(controller.state.zoom * factor, 0.55, 2.2);
    applySafely({ zoom: nextZoom }, false);
    window.clearTimeout(wheelCommitTimer);
    wheelCommitTimer = window.setTimeout(() => {
      controller.commitState();
      renderUI();
    }, 260);
  },
  { passive: false }
);

canvas.addEventListener("keydown", (event) => {
  const state = controller.state;
  let patch: Record<string, number> | null = null;
  if (event.key === "ArrowLeft") patch = { yaw: normalizeAngle(state.yaw - 2) };
  if (event.key === "ArrowRight") patch = { yaw: normalizeAngle(state.yaw + 2) };
  if (event.key === "ArrowUp") patch = { pitch: clamp(state.pitch + 2, -70, 70) };
  if (event.key === "ArrowDown") patch = { pitch: clamp(state.pitch - 2, -70, 70) };
  if (event.key === "+" || event.key === "=") patch = { zoom: clamp(state.zoom * 1.05, 0.55, 2.2) };
  if (event.key === "-" || event.key === "_") patch = { zoom: clamp(state.zoom / 1.05, 0.55, 2.2) };
  if (!patch) return;
  event.preventDefault();
  pauseForManualControl();
  applySafely(patch);
});

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
dismissError.addEventListener("click", clearError);

savePresetButton.addEventListener("click", () => {
  try {
    const result = controller.saveCurrentPreset(presetName.value);
    refreshPresets();
    presetSelect.value = result.name;
    showToast(`Saved "${result.name}" with geometry ${controller.geometrySummary.geometryDigest}.`);
  } catch (error) {
    showError(error);
  }
});

loadPresetButton.addEventListener("click", () => {
  const name = presetSelect.value;
  if (!name) {
    showError(new Error("Choose a saved study before loading."));
    return;
  }
  try {
    controller.loadNamedPreset(name);
    lastFrameTime = performance.now();
    renderUI();
    clearError();
    showToast(`Loaded "${name}" and verified its geometry digest.`);
  } catch (error) {
    showError(error);
  }
});

importButton.addEventListener("click", () => {
  importError.hidden = true;
  importError.textContent = "";
  if (!importDialog.open) importDialog.showModal();
});

cancelImport.addEventListener("click", () => importDialog.close());

importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  let parsed: unknown;
  try {
    parsed = JSON.parse(importJson.value);
  } catch (error) {
    const message = showError(new Error(`Invalid JSON: ${describeError(error)}`));
    importError.textContent = message;
    importError.hidden = false;
    return;
  }
  const result = applySafely(parsed);
  if (!result.ok) {
    importError.textContent = result.error;
    importError.hidden = false;
    return;
  }
  importError.hidden = true;
  importDialog.close();
  showToast("Imported view parameters without rebuilding the mesh.");
});

async function capturePng(download: boolean, includeDataUrl = false): Promise<CaptureResult> {
  const result = download
    ? await controller.download()
    : await controller.capture(includeDataUrl);
  lastExport = result;
  if (!result.match) {
    showError(
      new Error(
        `Preview digest ${result.previewDigest} does not match export digest ${result.pixelDigest}.`
      )
    );
  }
  renderUI();
  return result;
}

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  try {
    const result = await capturePng(true);
    if (result.match) {
      showToast(
        `PNG 960×640 · preview/export verified · ${result.pngSha256.slice(0, 12)}`
      );
    }
  } catch (error) {
    showError(error);
  } finally {
    exportButton.disabled = false;
  }
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement | null;
  const editing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable === true;
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key.toLowerCase() === "z" && !editing) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (commandKey && event.key.toLowerCase() === "y" && !editing) {
    event.preventDefault();
    redo();
    return;
  }
  if (event.code === "Space" && !editing && !importDialog.open) {
    event.preventDefault();
    const enabled = !controller.state.autoRotate;
    applySafely({ autoRotate: enabled });
  }
});

document.addEventListener("visibilitychange", () => {
  lastFrameTime = performance.now();
});

interface DebugApi {
  version: string;
  getState(): ViewParams;
  getGeometry(): AuditSnapshot["geometry"];
  getAudit(): AuditSnapshot & { lastExport: CaptureResult | null };
  applyParams(patch: unknown): ViewParams;
  tryApplyParams(patch: unknown): ApplyResult;
  setAutoRotate(enabled: boolean): ViewParams;
  advance(milliseconds: number): ViewParams;
  recompute(): ReturnType<ExhibitController["recompute"]>;
  capturePng(includeDataUrl?: boolean): Promise<CaptureResult>;
  downloadPng(): Promise<CaptureResult>;
  savePreset(name: string): { name: string; count: number };
  loadPreset(name: string): ViewParams;
  listPresets(): ReturnType<typeof listPresets>;
  undo(): ViewParams | null;
  redo(): ViewParams | null;
  getPreviewDataUrl(): string;
  projectPoint(point: [number, number, number]): ProjectedPoint;
  clearPresets(): void;
}

declare global {
  interface Window {
    __EXHIBIT__: DebugApi;
  }
}

window.__EXHIBIT__ = {
  version: "1.0.0",
  getState: () => controller.state,
  getGeometry: () => structuredClone(controller.geometrySummary),
  getAudit: () => {
    const audit = controller.getAudit();
    if (!lastExport) return { ...audit, lastExport: null };
    const { dataUrl: _dataUrl, ...compactExport } = lastExport;
    return { ...audit, lastExport: compactExport };
  },
  applyParams: (patch) => {
    const result = applySafely(patch);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  },
  tryApplyParams: (patch) => applySafely(patch),
  setAutoRotate: (enabled) => {
    const result = applySafely({ autoRotate: enabled });
    if (!result.ok) throw new Error(result.error);
    return result.state;
  },
  advance: (milliseconds) => {
    controller.advance(milliseconds);
    renderUI();
    return controller.state;
  },
  recompute: () => {
    const result = controller.recompute();
    renderUI();
    return result;
  },
  capturePng: (includeDataUrl = false) => capturePng(false, includeDataUrl),
  downloadPng: () => capturePng(true),
  savePreset: (name) => {
    const result = controller.saveCurrentPreset(name);
    refreshPresets();
    return result;
  },
  loadPreset: (name) => {
    try {
      const state = controller.loadNamedPreset(name);
      lastFrameTime = performance.now();
      renderUI();
      clearError();
      return state;
    } catch (error) {
      showError(error);
      throw error;
    }
  },
  listPresets: () => listPresets(),
  undo: () => (undo() ? controller.state : null),
  redo: () => (redo() ? controller.state : null),
  getPreviewDataUrl: () => canvas.toDataURL("image/png"),
  projectPoint: ([x, y, z]) => projectWorldPoint({ x, y, z }, controller.state),
  clearPresets: () => {
    clearPresets();
    refreshPresets();
  }
};
