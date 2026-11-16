import {
  NODE_DEFS,
  PipelineError,
  cloneNodes,
  createDefaultNodes,
  generateBasePixels,
  hashBytes,
  makeNode,
  nodeSignature,
  processPixelBuffer,
  validatePipeline,
} from "./pipeline.js";
import {
  SCENE_OBJECTS,
  drawComposition,
  getObjectGeometry,
  objectSummary,
} from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#previewCanvas"),
  objectList: $("#objectList"),
  objectCountBadge: $("#objectCountBadge"),
  nodeStack: $("#nodeStack"),
  nodeCountBadge: $("#nodeCountBadge"),
  nodePalette: $("#nodePalette"),
  addNodeButton: $("#addNodeButton"),
  undoButton: $("#undoButton"),
  screenshotButton: $("#screenshotButton"),
  exportButton: $("#exportButton"),
  resetViewButton: $("#resetViewButton"),
  recomputeButton: $("#recomputeButton"),
  pauseButton: $("#pauseButton"),
  pauseIcon: $("#pauseIcon"),
  pauseLabel: $("#pauseLabel"),
  zoomSlider: $("#zoomSlider"),
  zoomValue: $("#zoomValue"),
  rotationSlider: $("#rotationSlider"),
  rotationValue: $("#rotationValue"),
  resolutionSelect: $("#resolutionSelect"),
  canvasDimensions: $("#canvasDimensions"),
  frameCounter: $("#frameCounter"),
  timecode: $("#timecode"),
  previewScaleLabel: $("#previewScaleLabel"),
  metricObjects: $("#metricObjects"),
  metricAnnotations: $("#metricAnnotations"),
  metricOcclusion: $("#metricOcclusion"),
  metricDrift: $("#metricDrift"),
  geometryDigest: $("#geometryDigest"),
  pipelineSummary: $("#pipelineSummary"),
  pixelCountLabel: $("#pixelCountLabel"),
  previewHash: $("#previewHash"),
  exportHash: $("#exportHash"),
  matchBadge: $("#matchBadge"),
  renderIndicator: $("#renderIndicator"),
  renderStatus: $("#renderStatus"),
  lastRenderTime: $("#lastRenderTime"),
  progressPanel: $("#progressPanel"),
  progressStage: $("#progressStage"),
  progressValue: $("#progressValue"),
  progressBar: $("#progressBar"),
  progressDetail: $("#progressDetail"),
  errorPanel: $("#errorPanel"),
  errorTitle: $("#errorTitle"),
  errorMessage: $("#errorMessage"),
  dismissErrorButton: $("#dismissErrorButton"),
  presetSelect: $("#presetSelect"),
  presetNameInput: $("#presetNameInput"),
  savePresetButton: $("#savePresetButton"),
  deletePresetButton: $("#deletePresetButton"),
  presetHint: $("#presetHint"),
  presetSavedBadge: $("#presetSavedBadge"),
  toastRegion: $("#toastRegion"),
  canvasFrame: $("#canvasFrame"),
};

const context = elements.canvas.getContext("2d", { alpha: false });
const PRESET_STORAGE_KEY = "lumen.pixel-engine.presets.v1";
const HISTORY_LIMIT = 40;
const RESOLUTIONS = {
  "1024x768": { width: 1024, height: 768 },
  "1440x1080": { width: 1440, height: 1080 },
  "2048x1536": { width: 2048, height: 1536 },
};

const state = {
  nodes: createDefaultNodes(),
  zoom: 100,
  rotation: 0,
  width: 1024,
  height: 768,
  seed: 8421,
  selectedObjectId: "glass-plane",
  paused: false,
  animation: {
    frame: 0,
    elapsedMs: 0,
    lastNow: null,
    droppedFrames: 0,
  },
  baseCache: null,
  currentPixels: null,
  lastGoodPixels: null,
  previewHash: "········",
  exportHash: "PENDING",
  exportMatch: false,
  processing: false,
  error: null,
  lastRenderedSignature: "",
  lastRenderMs: 0,
  generation: 0,
  abortController: null,
  history: [],
  presets: [],
  activePresetId: "",
  renderTimer: null,
  sliderHistoryOpen: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatValue(value, decimals = 0) {
  return Number(value).toFixed(decimals);
}

function updateRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${Math.max(0, Math.min(100, percent))}%`);
}

function toast(message, type = "info", duration = 2400) {
  elements.toastRegion.replaceChildren();
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  window.setTimeout(() => {
    node.classList.add("out");
    window.setTimeout(() => node.remove(), 200);
  }, duration);
}

function setRenderStatus(label, processing = false) {
  elements.renderStatus.textContent = label;
  elements.renderIndicator.classList.toggle("processing", processing);
}

function showProgress(stage, detail = "", progress = 0) {
  elements.progressPanel.hidden = false;
  elements.progressStage.textContent = stage;
  elements.progressDetail.textContent = detail;
  elements.progressValue.textContent = `${Math.round(progress * 100)}%`;
  elements.progressBar.style.width = `${Math.round(progress * 100)}%`;
}

function updateProgress(progress, stage, detail) {
  const bounded = Math.max(0, Math.min(1, progress));
  showProgress(stage || "PROCESSING PIXELS", detail, bounded);
}

function hideProgress() {
  elements.progressPanel.hidden = true;
}

function showError(error, nodeId = null) {
  state.error = {
    message: error.message || "Unknown processing error",
    name: error.name || "PipelineError",
    nodeId,
  };
  elements.errorTitle.textContent =
    state.error.name === "PipelineError" ? "Invalid parameters" : "Render failed";
  elements.errorMessage.textContent = state.error.message;
  elements.errorPanel.hidden = false;
  elements.renderIndicator.classList.remove("processing");
  elements.renderStatus.textContent = "RENDER BLOCKED";
  elements.matchBadge.textContent = "CHECK INPUT";
  elements.matchBadge.style.color = "var(--danger)";
  elements.exportButton.disabled = false;
  const details = error.details?.errors;
  toast(
    details?.length > 1
      ? `${error.message} (${details.length - 1} more issue${details.length > 2 ? "s" : ""})`
      : error.message,
    "error",
    4200,
  );
}

function clearError() {
  state.error = null;
  elements.errorPanel.hidden = true;
  elements.matchBadge.style.color = "";
  elements.nodeStack.querySelectorAll(".is-invalid").forEach((node) => node.classList.remove("is-invalid"));
  elements.nodeStack.querySelectorAll(".node-error").forEach((node) => node.remove());
}

function refreshGeometry(options = {}) {
  const geometry = getObjectGeometry(
    state.width,
    state.height,
    state.zoom,
    state.rotation,
  );
  elements.objectCountBadge.textContent = geometry.objectCount;
  elements.metricObjects.textContent = geometry.objectCount;
  elements.metricAnnotations.textContent = geometry.annotationCount;
  elements.metricOcclusion.textContent = "STABLE";
  elements.metricDrift.textContent = `${geometry.maxDriftPx.toFixed(3)} px`;
  elements.geometryDigest.textContent = geometry.digest;
  elements.zoomValue.textContent = `${Math.round(state.zoom)}%`;
  elements.rotationValue.textContent = `${Math.round(state.rotation)}°`;
  elements.previewScaleLabel.textContent = `${Math.round(state.zoom)}%`;
  if (options.dom !== false) {
    elements.zoomSlider.value = String(state.zoom);
    elements.rotationSlider.value = String(state.rotation);
    updateRangeFill(elements.zoomSlider);
    updateRangeFill(elements.rotationSlider);
  }
  return geometry;
}

function drawCurrentFrame() {
  if (!state.currentPixels) return null;
  return drawComposition(context, state.currentPixels, {
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    rotation: state.rotation,
    time: state.animation.elapsedMs,
    selectedObjectId: state.selectedObjectId,
  });
}

function formatTime(milliseconds) {
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(milliseconds % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function updateAnimationReadout() {
  elements.frameCounter.textContent = `FRAME ${String(state.animation.frame).padStart(4, "0")}`;
  elements.timecode.textContent = formatTime(state.animation.elapsedMs);
}

function setPaused(paused, options = {}) {
  const next = Boolean(paused);
  if (next === state.paused && !options.force) return;
  state.paused = next;
  state.animation.lastNow = null;
  elements.pauseButton.setAttribute("aria-pressed", String(next));
  elements.pauseIcon.textContent = next ? "▶" : "Ⅱ";
  elements.pauseLabel.textContent = next ? "Resume motion" : "Pause motion";
  elements.matchBadge.textContent = next ? "FRAME HELD" : "DETERMINISTIC";
  if (state.paused) drawCurrentFrame();
}

function updatePipelineSummary() {
  elements.nodeCountBadge.textContent = state.nodes.length;
  if (state.nodes.length === 0) {
    elements.pipelineSummary.textContent = "IDENTITY / GENERATED BASE";
    return;
  }
  elements.pipelineSummary.textContent = state.nodes
    .map((node) => {
      const label = NODE_DEFS[node.type]?.label.toUpperCase() || node.type;
      return node.enabled ? label : `(${label})`;
    })
    .join(" → ");
}

function objectIcon(kind) {
  if (kind === "ring") {
    return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>';
  }
  if (kind === "reticle") {
    return '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor"/><path d="M8 1v4M8 11v4M1 8h4M11 8h4" stroke="currentColor"/></svg>';
  }
  if (kind === "polyline") {
    return '<svg viewBox="0 0 16 16"><path d="M1 11l3-4 3 2 3-5 5 2" fill="none" stroke="currentColor"/></svg>';
  }
  return '<svg viewBox="0 0 16 16"><path d="M2 5l10-2 2 7-10 3z" fill="none" stroke="currentColor"/></svg>';
}

function renderObjectList() {
  elements.objectList.innerHTML = SCENE_OBJECTS.map((object) => {
    const selected = object.id === state.selectedObjectId;
    return `
      <button class="object-row${selected ? " selected" : ""}" data-object-id="${escapeHtml(object.id)}" aria-pressed="${selected}">
        <span class="object-icon" style="color:${object.color}">${objectIcon(object.kind)}</span>
        <span class="object-copy">
          <strong>${escapeHtml(object.name)}</strong>
          <small>${escapeHtml(object.kind.toUpperCase())} · X ${object.annotation.anchor.x.toFixed(3)} Y ${object.annotation.anchor.y.toFixed(3)}</small>
        </span>
        <span class="object-state"><i style="background:${object.color}"></i>Z${object.z}</span>
      </button>`;
  }).join("");
}

function renderNodeStack() {
  elements.nodeStack.innerHTML = state.nodes
    .map((node, index) => {
      const definition = NODE_DEFS[node.type];
      const invalid = state.error?.nodeId === node.id;
      const params = definition.params
        .map((param) => {
          const value = node.params[param.key];
          const fill = ((value - param.min) / (param.max - param.min)) * 100;
          return `
            <div class="node-param">
              <div class="node-param-label">
                <label for="${node.id}-${param.key}">${param.label}</label>
                <input
                  class="node-value-input"
                  type="number"
                  value="${formatValue(value, param.decimals)}"
                  min="${param.min}"
                  max="${param.max}"
                  step="${param.step}"
                  data-node-id="${node.id}"
                  data-param="${param.key}"
                  aria-label="${definition.label} ${param.label}"
                />
              </div>
              <input
                id="${node.id}-${param.key}"
                class="range-input"
                type="range"
                min="${param.min}"
                max="${param.max}"
                step="${param.step}"
                value="${value}"
                style="--fill:${fill}%"
                data-node-id="${node.id}"
                data-param="${param.key}"
                data-role="range"
              />
            </div>`;
        })
        .join("");
      const meter = Array.from({ length: 18 }, (_, meterIndex) => {
        const factor = ((index + 1) * (meterIndex + 3)) % 9;
        return `<i style="height:${3 + factor}px"></i>`;
      }).join("");
      return `
        <article class="node-card${node.enabled ? "" : " is-bypassed"}${invalid ? " is-invalid" : ""}" data-node-id="${node.id}" data-type="${node.type}" draggable="true">
          <div class="node-top">
            <button class="node-grip" type="button" aria-label="Drag to reorder ${definition.label}" title="Drag to reorder"></button>
            <span class="node-number">${String(index + 1).padStart(2, "0")}</span>
            <span class="node-swatch" aria-hidden="true"></span>
            <span class="node-name">
              <strong>${definition.label}</strong>
              <small>${definition.subtitle}</small>
            </span>
            <button class="bypass-button" type="button" data-action="bypass" aria-pressed="${String(!node.enabled)}" title="Bypass this node">${node.enabled ? "ON" : "BYP"}</button>
            <span class="node-actions">
              <button class="node-action" type="button" data-action="up" ${index === 0 ? "disabled" : ""} title="Move up">↑</button>
              <button class="node-action" type="button" data-action="down" ${index === state.nodes.length - 1 ? "disabled" : ""} title="Move down">↓</button>
              <button class="node-action" type="button" data-action="remove" title="Remove node">×</button>
            </span>
          </div>
          <div class="node-body">
            <div class="node-io"><span>IN · RGB</span><span>PIXEL LOOP →</span></div>
            ${params}
            <div class="node-readout" aria-hidden="true">${meter}</div>
            ${invalid ? `<div class="node-error">${escapeHtml(state.error.message)}</div>` : ""}
          </div>
        </article>`;
    })
    .join("");
  updatePipelineSummary();
}

function readPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistPresets() {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.presets));
    return true;
  } catch (error) {
    toast(`Could not write local presets: ${error.message}`, "error", 3600);
    return false;
  }
}

function renderPresetSelect() {
  elements.presetSelect.innerHTML = [
    '<option value="">Choose a saved preset…</option>',
    ...state.presets.map(
      (preset) =>
        `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)} · ${preset.width}×${preset.height}</option>`,
    ),
  ].join("");
  elements.presetSelect.value = state.activePresetId;
  elements.deletePresetButton.disabled = !state.activePresetId;
  elements.presetHint.textContent =
    state.presets.length > 0
      ? `${state.presets.length} parameter set${state.presets.length === 1 ? "" : "s"} · canvas + view`
      : "Presets stay in this browser";
}

function makePresetId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `preset-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function serializeWorkspace() {
  return {
    nodes: cloneNodes(state.nodes),
    zoom: state.zoom,
    rotation: state.rotation,
    width: state.width,
    height: state.height,
    selectedObjectId: state.selectedObjectId,
  };
}

function workspaceSignature() {
  return JSON.stringify(serializeWorkspace());
}

function pushHistory() {
  const signature = workspaceSignature();
  if (state.history.at(-1) === signature) return;
  state.history.push(signature);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  elements.undoButton.disabled = state.history.length === 0;
}

function restoreWorkspace(snapshot) {
  if (!snapshot) return;
  state.nodes = cloneNodes(snapshot.nodes);
  state.zoom = snapshot.zoom;
  state.rotation = snapshot.rotation;
  state.width = snapshot.width;
  state.height = snapshot.height;
  state.selectedObjectId = snapshot.selectedObjectId;
  elements.resolutionSelect.value = `${state.width}x${state.height}`;
  state.baseCache = null;
  renderNodeStack();
  renderObjectList();
  refreshGeometry();
}

async function undo() {
  const signature = state.history.pop();
  if (!signature) return false;
  const snapshot = JSON.parse(signature);
  restoreWorkspace(snapshot);
  elements.undoButton.disabled = state.history.length === 0;
  clearError();
  await renderPreview({ reason: "undo" });
  toast("Undid the last change", "success");
  return true;
}

function findInvalidNodeId() {
  for (const node of state.nodes) {
    try {
      validatePipeline([node]);
    } catch {
      return node.id;
    }
  }
  return null;
}

async function getBasePixels(token) {
  const key = `${state.width}x${state.height}:${state.seed}`;
  if (state.baseCache?.key === key) return state.baseCache.pixels;
  showProgress("GENERATING CANVAS", "Drawing procedural sky, terrain and dither", 0.03);
  await new Promise((resolve) => setTimeout(resolve, 24));
  if (token !== state.generation) {
    const error = new Error("Render cancelled");
    error.name = "AbortError";
    throw error;
  }
  const pixels = generateBasePixels(state.width, state.height, state.seed);
  state.baseCache = { key, pixels };
  updateProgress(0.18, "GENERATING CANVAS", `${state.width} × ${state.height} base generated`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return pixels;
}

function canvasDigest(canvas) {
  const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  return hashBytes(data);
}

async function renderPreview(options = {}) {
  if (state.renderTimer) {
    clearTimeout(state.renderTimer);
    state.renderTimer = null;
  }
  state.abortController?.abort();
  state.abortController = new AbortController();
  const token = ++state.generation;
  state.processing = true;
  if (!options.silent) setRenderStatus("PROCESSING PIXELS", true);
  elements.exportButton.disabled = false;
  const startedAt = performance.now();

  try {
    validatePipeline(state.nodes);
    showProgress("PREPARING PIPELINE", "Validating node values and pixel buffer", 0.01);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const base = await getBasePixels(token);
    const pixels = await processPixelBuffer(base, state.nodes, {
      width: state.width,
      height: state.height,
      signal: state.abortController.signal,
      onProgress(progress, stage, detail) {
        if (token !== state.generation) return;
        updateProgress(0.18 + progress * 0.82, stage, detail);
      },
    });
    if (token !== state.generation) return false;

    state.currentPixels = pixels;
    state.lastGoodPixels = new Uint8ClampedArray(pixels);
    state.lastRenderedSignature = nodeSignature(state.nodes);
    drawCurrentFrame();
    state.previewHash = canvasDigest(elements.canvas);
    state.exportMatch = state.exportHash === state.previewHash;
    elements.previewHash.textContent = state.previewHash;
    elements.exportHash.textContent = state.exportMatch ? state.exportHash : "STALE";
    elements.matchBadge.textContent = state.exportMatch ? "PIXEL MATCH" : "READY TO EXPORT";
    elements.matchBadge.style.color = "";
    state.lastRenderMs = performance.now() - startedAt;
    elements.lastRenderTime.textContent = `${state.lastRenderMs.toFixed(1)} ms`;
    clearError();
    hideProgress();
    refreshGeometry();
    updateAnimationReadout();
    setRenderStatus("RENDER READY", false);
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    hideProgress();
    const nodeId = findInvalidNodeId();
    showError(error, nodeId);
    renderNodeStack();
    if (!state.currentPixels) {
      const fallback =
        state.baseCache?.pixels ||
        generateBasePixels(state.width, state.height, state.seed);
      state.baseCache = {
        key: `${state.width}x${state.height}:${state.seed}`,
        pixels: fallback,
      };
      state.currentPixels = fallback;
    }
    drawCurrentFrame();
    refreshGeometry();
    elements.lastRenderTime.textContent = `${(performance.now() - startedAt).toFixed(1)} ms`;
    return false;
  } finally {
    if (token === state.generation) {
      state.processing = false;
      elements.exportButton.disabled = false;
    }
  }
}

function requestPreview(delay = 80) {
  if (state.renderTimer) clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    renderPreview();
  }, delay);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function exportPng(options = {}) {
  if (state.processing) {
    await new Promise((resolve) => window.setTimeout(resolve, 160));
    if (state.processing) {
      toast("The pixel pipeline is still processing. Try again shortly.", "info");
      return null;
    }
  }
  if (
    state.lastRenderedSignature !== nodeSignature(state.nodes) ||
    !state.currentPixels
  ) {
    const rendered = await renderPreview({ reason: "export-refresh" });
    if (!rendered) return null;
  }
  try {
    validatePipeline(state.nodes);
  } catch (error) {
    showError(error, findInvalidNodeId());
    return null;
  }
  if (!state.currentPixels) {
    await renderPreview({ reason: "export" });
    if (!state.currentPixels) return null;
  }

  setPaused(true, { force: true });
  elements.exportButton.disabled = true;
  showProgress("ENCODING PNG", "Freezing the preview frame and compositing annotations", 0.22);
  setRenderStatus("ENCODING PNG", true);
  await new Promise((resolve) => setTimeout(resolve, 28));

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = state.width;
  exportCanvas.height = state.height;
  const exportContext = exportCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const exportGeometry = drawComposition(exportContext, state.currentPixels, {
    width: state.width,
    height: state.height,
    zoom: state.zoom,
    rotation: state.rotation,
    time: state.animation.elapsedMs,
    selectedObjectId: state.selectedObjectId,
  });
  updateProgress(0.76, "ENCODING PNG", "Comparing preview and export pixel digests");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const exportDigest = canvasDigest(exportCanvas);
  const previewDigest = canvasDigest(elements.canvas);
  const dataUrl = exportCanvas.toDataURL("image/png");
  state.previewHash = previewDigest;
  state.exportHash = exportDigest;
  state.exportMatch = previewDigest === exportDigest;
  elements.previewHash.textContent = previewDigest;
  elements.exportHash.textContent = exportDigest;
  elements.matchBadge.textContent = state.exportMatch ? "PIXEL MATCH" : "HASH MISMATCH";
  elements.matchBadge.style.color = state.exportMatch ? "var(--accent)" : "var(--danger)";
  updateProgress(1, "ENCODING PNG", `${state.width} × ${state.height} · ${(dataUrl.length / 1024).toFixed(1)} KB`);
  await new Promise((resolve) => setTimeout(resolve, 90));
  hideProgress();
  elements.exportButton.disabled = false;
  setRenderStatus("EXPORT READY", false);
  if (options.download !== false) {
    downloadDataUrl(dataUrl, `lumen-solar-${state.width}x${state.height}-${exportDigest}.png`);
  }
  toast(
    state.exportMatch
      ? `Export matches the preview · ${exportDigest}`
      : "Export digest differs from preview. Recalculate and retry.",
    state.exportMatch ? "success" : "error",
    3600,
  );
  return {
    dataUrl,
    digest: exportDigest,
    previewDigest,
    match: state.exportMatch,
    width: state.width,
    height: state.height,
    geometry: exportGeometry,
    byteLength: Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75),
  };
}

function takeScreenshot(options = {}) {
  const dataUrl = elements.canvas.toDataURL("image/png");
  const digest = canvasDigest(elements.canvas);
  if (options.download !== false) {
    downloadDataUrl(dataUrl, `lumen-frame-${digest}.png`);
    toast(`Current frame captured · ${digest}`, "success");
  }
  return {
    dataUrl,
    digest,
    width: state.width,
    height: state.height,
    paused: state.paused,
    timeMs: state.animation.elapsedMs,
    frame: state.animation.frame,
  };
}

function savePreset(name) {
  try {
    validatePipeline(state.nodes);
  } catch (error) {
    showError(error, findInvalidNodeId());
    return null;
  }
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    toast("Enter a preset name before saving", "error");
    return null;
  }
  setPaused(true, { force: true });
  drawCurrentFrame();
  const frameDigest = canvasDigest(elements.canvas);
  const existing = state.presets.find((preset) => preset.name === trimmed);
  const preset = {
    id: existing?.id || makePresetId(),
    name: trimmed,
    version: 1,
    nodes: cloneNodes(state.nodes),
    zoom: state.zoom,
    rotation: state.rotation,
    width: state.width,
    height: state.height,
    selectedObjectId: state.selectedObjectId,
    animationTime: state.animation.elapsedMs,
    paused: true,
    frameDigest,
    nodeSignature: nodeSignature(state.nodes),
    geometryDigest: refreshGeometry().digest,
    createdAt: new Date().toISOString(),
  };
  state.presets = [
    ...state.presets.filter((item) => item.id !== preset.id),
    preset,
  ].slice(-20);
  state.activePresetId = preset.id;
  if (!persistPresets()) return null;
  renderPresetSelect();
  elements.presetNameInput.value = trimmed;
  elements.presetSavedBadge.textContent = "SAVED";
  elements.presetSavedBadge.classList.add("flash");
  window.setTimeout(() => {
    elements.presetSavedBadge.textContent = "LOCAL";
    elements.presetSavedBadge.classList.remove("flash");
  }, 1800);
  toast(`Preset "${trimmed}" saved · ${frameDigest}`, "success", 3000);
  return { ...preset, frameDigestAfterLoad: frameDigest };
}

async function loadPreset(idOrName) {
  const preset =
    state.presets.find((item) => item.id === idOrName) ||
    state.presets.find((item) => item.name === idOrName);
  if (!preset) {
    toast(`Preset "${idOrName}" was not found`, "error");
    return null;
  }
  try {
    validatePipeline(preset.nodes);
  } catch (error) {
    showError(error, null);
    return null;
  }
  pushHistory();
  state.nodes = cloneNodes(preset.nodes);
  state.zoom = preset.zoom;
  state.rotation = preset.rotation;
  state.width = preset.width;
  state.height = preset.height;
  state.selectedObjectId = preset.selectedObjectId;
  state.animation.elapsedMs = preset.animationTime || 0;
  state.animation.frame = 0;
  state.animation.lastNow = null;
  state.paused = false;
  setPaused(Boolean(preset.paused), { force: true });
  state.activePresetId = preset.id;
  elements.resolutionSelect.value = `${state.width}x${state.height}`;
  state.baseCache = null;
  if (state.currentPixels) state.currentPixels = null;
  renderNodeStack();
  renderObjectList();
  renderPresetSelect();
  refreshGeometry();
  clearError();
  const rendered = await renderPreview({ reason: "preset" });
  const loadedDigest = rendered ? canvasDigest(elements.canvas) : null;
  const match = loadedDigest === preset.frameDigest;
  elements.previewHash.textContent = loadedDigest || "········";
  elements.matchBadge.textContent = match ? "PRESET MATCH" : "PRESET LOADED";
  elements.matchBadge.style.color = match ? "var(--accent)" : "";
  toast(
    match
      ? `Preset loaded; frame digest matches · ${loadedDigest}`
      : `Preset loaded · ${loadedDigest || "render failed"}`,
    match ? "success" : "info",
    3200,
  );
  return {
    preset,
    rendered,
    digest: loadedDigest,
    expectedDigest: preset.frameDigest,
    match,
    geometry: getObjectGeometry(state.width, state.height, state.zoom, state.rotation),
    state: getPublicState(),
  };
}

function deleteActivePreset() {
  if (!state.activePresetId) return false;
  const preset = state.presets.find((item) => item.id === state.activePresetId);
  state.presets = state.presets.filter((item) => item.id !== state.activePresetId);
  state.activePresetId = "";
  persistPresets();
  renderPresetSelect();
  toast(preset ? `Preset "${preset.name}" deleted` : "Preset deleted", "info");
  return true;
}

function resetView() {
  state.zoom = 100;
  state.rotation = 0;
  refreshGeometry();
  drawCurrentFrame();
  const digest = state.currentPixels ? canvasDigest(elements.canvas) : null;
  if (digest) {
    state.previewHash = digest;
    elements.previewHash.textContent = digest;
  }
}

function nudgeNode(nodeId, direction) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.nodes.length) return false;
  pushHistory();
  const [node] = state.nodes.splice(index, 1);
  state.nodes.splice(target, 0, node);
  renderNodeStack();
  requestPreview(20);
  return true;
}

function reorderNode(nodeId, targetIndex) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  const target = Math.max(0, Math.min(state.nodes.length - 1, targetIndex));
  if (index < 0 || index === target) return false;
  pushHistory();
  const [node] = state.nodes.splice(index, 1);
  state.nodes.splice(target, 0, node);
  renderNodeStack();
  requestPreview(20);
  return true;
}

function updateNodeParam(nodeId, key, rawValue, options = {}) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new PipelineError(`Node not found: ${nodeId}`);
  const definition = NODE_DEFS[node.type];
  const parameter = definition.params.find((item) => item.key === key);
  if (!parameter) throw new PipelineError(`${definition.label} has no parameter "${key}"`);
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (options.history) pushHistory();
  node.params[key] = value;
  const card = elements.nodeStack.querySelector(`[data-node-id="${nodeId}"]`);
  if (card) {
    const range = card.querySelector(`input[type="range"][data-param="${key}"]`);
    const number = card.querySelector(`input[type="number"][data-param="${key}"]`);
    if (range && Number.isFinite(value)) {
      range.value = String(value);
      updateRangeFill(range);
    }
    if (number && Number.isFinite(value)) {
      number.value = formatValue(value, parameter.decimals);
    }
  }
  requestPreview(options.immediate ? 0 : 70);
}

async function updateNodeParams(nodeId, params, options = {}) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new PipelineError(`Node not found: ${nodeId}`);
  if (options.history !== false) pushHistory();
  Object.assign(node.params, params);
  renderNodeStack();
  const ok = await renderPreview({ reason: "api-params" });
  return { ok, state: getPublicState() };
}

function renderViewOnly() {
  refreshGeometry();
  drawCurrentFrame();
  if (state.currentPixels) {
    state.previewHash = canvasDigest(elements.canvas);
    elements.previewHash.textContent = state.previewHash;
  }
}

function setZoom(value, options = {}) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 60 || next > 180) {
    throw new PipelineError("Zoom must be between 60% and 180%.");
  }
  if (options.history) pushHistory();
  state.zoom = next;
  renderViewOnly();
}

function setRotation(value, options = {}) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < -30 || next > 30) {
    throw new PipelineError("Rotation must be between −30° and +30°.");
  }
  if (options.history) pushHistory();
  state.rotation = next;
  renderViewOnly();
}

async function changeResolution(value) {
  const dimensions = RESOLUTIONS[value];
  if (!dimensions) throw new PipelineError(`Unsupported output size: ${value}`);
  if (dimensions.width === state.width && dimensions.height === state.height) return true;
  pushHistory();
  state.width = dimensions.width;
  state.height = dimensions.height;
  elements.canvas.width = state.width;
  elements.canvas.height = state.height;
  state.baseCache = null;
  state.currentPixels = null;
  elements.resolutionSelect.value = value;
  refreshGeometry();
  return renderPreview({ reason: "resolution" });
}

async function addNode(type, options = {}) {
  if (!NODE_DEFS[type]) throw new PipelineError(`Unknown node type: ${type}`);
  if (options.history !== false) pushHistory();
  let node = makeNode(type);
  while (state.nodes.some((item) => item.id === node.id)) node = makeNode(type);
  state.nodes.push(node);
  renderNodeStack();
  elements.nodePalette.hidden = true;
  elements.addNodeButton.setAttribute("aria-expanded", "false");
  await renderPreview({ reason: "add-node" });
  const card = elements.nodeStack.querySelector(`[data-node-id="${node.id}"]`);
  card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return node;
}

async function removeNode(nodeId, options = {}) {
  const index = state.nodes.findIndex((node) => node.id === nodeId);
  if (index < 0) return false;
  if (options.history !== false) pushHistory();
  state.nodes.splice(index, 1);
  renderNodeStack();
  await renderPreview({ reason: "remove-node" });
  return true;
}

function bindEvents() {
  elements.nodeStack.addEventListener("pointerdown", (event) => {
    if (event.target.matches('input[type="range"]')) {
      pushHistory();
      state.sliderHistoryOpen = true;
    }
  });
  elements.nodeStack.addEventListener("focusin", (event) => {
    if (event.target.matches('input[type="number"]')) pushHistory();
  });
  elements.nodeStack.addEventListener("keydown", (event) => {
    if (event.target.matches('input[type="range"]') && !state.sliderHistoryOpen) {
      pushHistory();
      state.sliderHistoryOpen = true;
    }
  });
  elements.nodeStack.addEventListener("pointerup", () => {
    state.sliderHistoryOpen = false;
  });
  elements.nodeStack.addEventListener("input", (event) => {
    const input = event.target;
    if (!input.matches("input[data-param]")) return;
    const nodeId = input.dataset.nodeId;
    const key = input.dataset.param;
    if (input.type === "range") updateRangeFill(input);
    updateNodeParam(nodeId, key, input.value);
  });
  elements.nodeStack.addEventListener("click", (event) => {
    const card = event.target.closest(".node-card");
    if (!card) return;
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const nodeId = card.dataset.nodeId;
    if (action === "bypass") {
      const node = state.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      pushHistory();
      node.enabled = !node.enabled;
      renderNodeStack();
      requestPreview(20);
    }
    if (action === "up") nudgeNode(nodeId, -1);
    if (action === "down") nudgeNode(nodeId, 1);
    if (action === "remove") removeNode(nodeId);
  });

  let draggedNodeId = null;
  elements.nodeStack.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".node-card");
    if (!card) return;
    draggedNodeId = card.dataset.nodeId;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedNodeId);
  });
  elements.nodeStack.addEventListener("dragover", (event) => {
    const card = event.target.closest(".node-card");
    if (!card || card.dataset.nodeId === draggedNodeId) return;
    event.preventDefault();
    elements.nodeStack.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
    card.classList.add("drag-over");
  });
  elements.nodeStack.addEventListener("drop", (event) => {
    const card = event.target.closest(".node-card");
    if (!card || !draggedNodeId) return;
    event.preventDefault();
    const targetIndex = state.nodes.findIndex((node) => node.id === card.dataset.nodeId);
    reorderNode(draggedNodeId, targetIndex);
  });
  elements.nodeStack.addEventListener("dragend", () => {
    elements.nodeStack.querySelectorAll(".dragging, .drag-over").forEach((item) => {
      item.classList.remove("dragging", "drag-over");
    });
    draggedNodeId = null;
  });

  elements.addNodeButton.addEventListener("click", () => {
    const willOpen = elements.nodePalette.hidden;
    elements.nodePalette.hidden = !willOpen;
    elements.addNodeButton.setAttribute("aria-expanded", String(willOpen));
  });
  elements.nodePalette.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-type]");
    if (button) addNode(button.dataset.addType);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".add-node-wrap")) {
      elements.nodePalette.hidden = true;
      elements.addNodeButton.setAttribute("aria-expanded", "false");
    }
  });

  elements.objectList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-object-id]");
    if (!button) return;
    state.selectedObjectId = button.dataset.objectId;
    renderObjectList();
    renderViewOnly();
  });

  elements.zoomSlider.addEventListener("pointerdown", () => pushHistory());
  elements.zoomSlider.addEventListener("input", () => {
    try {
      setZoom(elements.zoomSlider.value);
    } catch (error) {
      showError(error);
    }
  });
  elements.rotationSlider.addEventListener("pointerdown", () => pushHistory());
  elements.rotationSlider.addEventListener("input", () => {
    try {
      setRotation(elements.rotationSlider.value);
    } catch (error) {
      showError(error);
    }
  });
  elements.resolutionSelect.addEventListener("change", () => {
    changeResolution(elements.resolutionSelect.value).catch((error) => showError(error));
  });
  elements.pauseButton.addEventListener("click", () => setPaused(!state.paused));
  elements.resetViewButton.addEventListener("click", resetView);
  elements.recomputeButton.addEventListener("click", () => renderPreview({ reason: "manual" }));
  elements.screenshotButton.addEventListener("click", () => takeScreenshot());
  elements.exportButton.addEventListener("click", () => exportPng({ download: true }));
  elements.undoButton.addEventListener("click", () => undo());
  elements.dismissErrorButton.addEventListener("click", clearError);
  elements.savePresetButton.addEventListener("click", () => savePreset(elements.presetNameInput.value));
  elements.presetSelect.addEventListener("change", () => {
    if (elements.presetSelect.value) loadPreset(elements.presetSelect.value);
  });
  elements.deletePresetButton.addEventListener("click", deleteActivePreset);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      if (event.target.matches("input, textarea, select")) return;
      event.preventDefault();
      undo();
    }
    if (event.key === " " && event.target === document.body) {
      event.preventDefault();
      setPaused(!state.paused);
    }
  });
}

function animationLoop(now) {
  if (!state.paused && state.currentPixels) {
    if (state.animation.lastNow === null) {
      state.animation.lastNow = now;
    } else {
      const rawDelta = now - state.animation.lastNow;
      if (rawDelta > 34.5) state.animation.droppedFrames += 1;
      const delta = Math.max(0, Math.min(33.4, rawDelta));
      state.animation.elapsedMs += delta;
      state.animation.frame += 1;
      state.animation.lastNow = now;
    }
    drawCurrentFrame();
    updateAnimationReadout();
  } else {
    state.animation.lastNow = null;
  }
  requestAnimationFrame(animationLoop);
}

function getPublicState() {
  const geometry = getObjectGeometry(state.width, state.height, state.zoom, state.rotation);
  return {
    nodes: cloneNodes(state.nodes),
    nodeCount: state.nodes.length,
    nodeSignature: nodeSignature(state.nodes),
    zoom: state.zoom,
    rotation: state.rotation,
    width: state.width,
    height: state.height,
    seed: state.seed,
    selectedObjectId: state.selectedObjectId,
    paused: state.paused,
    processing: state.processing,
    animation: {
      frame: state.animation.frame,
      elapsedMs: state.animation.elapsedMs,
      droppedFrames: state.animation.droppedFrames,
      lastNow: state.animation.lastNow,
    },
    previewHash: state.previewHash,
    exportHash: state.exportHash,
    exportMatch: state.exportMatch,
    lastRenderMs: state.lastRenderMs,
    historyDepth: state.history.length,
    error: state.error ? { ...state.error } : null,
    geometry: {
      objectCount: geometry.objectCount,
      annotationCount: geometry.annotationCount,
      order: geometry.order,
      maxDriftPx: geometry.maxDriftPx,
      digest: geometry.digest,
      objects: geometry.objects,
    },
  };
}

const api = {
  getState: getPublicState,
  getGeometry() {
    return getObjectGeometry(state.width, state.height, state.zoom, state.rotation);
  },
  getObjectSummary() {
    return objectSummary(state.width, state.height, state.zoom, state.rotation);
  },
  getNodes() {
    return cloneNodes(state.nodes);
  },
  getPresets() {
    return state.presets.map((preset) => ({ ...preset, nodes: cloneNodes(preset.nodes) }));
  },
  async render() {
    const ok = await renderPreview({ reason: "api" });
    return { ok, state: getPublicState() };
  },
  async recalculate() {
    const ok = await renderPreview({ reason: "api-recalculate" });
    return { ok, state: getPublicState() };
  },
  setNodeParam(nodeId, key, value) {
    updateNodeParam(nodeId, key, value, { history: true });
    return renderPreview({ reason: "api-param" }).then((ok) => ({
      ok,
      state: getPublicState(),
    }));
  },
  setNodeParams(nodeId, params) {
    return updateNodeParams(nodeId, params, { history: true });
  },
  setNodeEnabled(nodeId, enabled) {
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) throw new PipelineError(`Node not found: ${nodeId}`);
    pushHistory();
    node.enabled = Boolean(enabled);
    renderNodeStack();
    return renderPreview({ reason: "api-bypass" }).then((ok) => ({
      ok,
      state: getPublicState(),
    }));
  },
  reorderNode: (nodeId, targetIndex) => {
    const changed = reorderNode(nodeId, targetIndex);
    return renderPreview({ reason: "api-reorder" }).then((ok) => ({
      ok,
      changed,
      state: getPublicState(),
    }));
  },
  async addNode(type) {
    const node = await addNode(type, { history: true });
    return { ok: Boolean(node), node: { ...node, params: { ...node.params } }, state: getPublicState() };
  },
  async removeNode(nodeId) {
    const changed = await removeNode(nodeId, { history: true });
    return { ok: changed, state: getPublicState() };
  },
  setZoom: (value) => {
    setZoom(value, { history: true });
    return getPublicState();
  },
  setRotation: (value) => {
    setRotation(value, { history: true });
    return getPublicState();
  },
  async setResolution(value) {
    const ok = await changeResolution(value);
    return { ok, state: getPublicState() };
  },
  pause() {
    setPaused(true);
    return getPublicState();
  },
  resume() {
    setPaused(false);
    return getPublicState();
  },
  seek(timeMs) {
    setPaused(true);
    state.animation.elapsedMs = Math.max(0, Number(timeMs) || 0);
    state.animation.frame = Math.max(0, Math.floor(state.animation.elapsedMs / 16.67));
    drawCurrentFrame();
    updateAnimationReadout();
    const digest = state.currentPixels ? canvasDigest(elements.canvas) : null;
    if (digest) {
      state.previewHash = digest;
      elements.previewHash.textContent = digest;
    }
    return { digest, state: getPublicState() };
  },
  getCanvasHash() {
    return state.currentPixels ? canvasDigest(elements.canvas) : null;
  },
  getCanvasDataUrl() {
    return elements.canvas.toDataURL("image/png");
  },
  getPixelHash() {
    return state.currentPixels ? hashBytes(state.currentPixels) : null;
  },
  screenshot(options = {}) {
    return takeScreenshot({ download: false, ...options });
  },
  exportPng: (options = {}) => {
    return exportPng({ download: false, ...options });
  },
  savePreset: (name) => {
    return savePreset(name);
  },
  loadPreset: (idOrName) => {
    return loadPreset(idOrName);
  },
  deletePreset() {
    return deleteActivePreset();
  },
  undo: () => {
    return undo();
  },
  async reset() {
    pushHistory();
    state.nodes = createDefaultNodes();
    state.zoom = 100;
    state.rotation = 0;
    state.width = 1024;
    state.height = 768;
    state.selectedObjectId = "glass-plane";
    state.animation.elapsedMs = 0;
    state.animation.frame = 0;
    state.animation.droppedFrames = 0;
    state.animation.lastNow = null;
    state.paused = false;
    state.baseCache = null;
    state.currentPixels = null;
    state.exportHash = "PENDING";
    state.exportMatch = false;
    elements.canvas.width = 1024;
    elements.canvas.height = 768;
    elements.resolutionSelect.value = "1024x768";
    renderNodeStack();
    renderObjectList();
    refreshGeometry();
    clearError();
    const ok = await renderPreview({ reason: "reset" });
    return { ok, state: getPublicState() };
  },
  clearError,
  getElement(id) {
    return document.getElementById(id);
  },
};

async function initialize() {
  elements.canvas.width = state.width;
  elements.canvas.height = state.height;
  elements.resolutionSelect.value = `${state.width}x${state.height}`;
  elements.zoomSlider.value = String(state.zoom);
  elements.rotationSlider.value = String(state.rotation);
  updateRangeFill(elements.zoomSlider);
  updateRangeFill(elements.rotationSlider);
  state.presets = readPresets();
  renderNodeStack();
  renderObjectList();
  renderPresetSelect();
  refreshGeometry();
  updateAnimationReadout();
  updatePipelineSummary();
  bindEvents();
  const fontReady = document.fonts?.ready || Promise.resolve();
  await Promise.race([fontReady, new Promise((resolve) => setTimeout(resolve, 1200))]);
  requestAnimationFrame(animationLoop);
  await renderPreview({ reason: "initial" });
  window.lumenStudio = api;
  window.__LUMEN_READY__ = true;
  document.documentElement.dataset.ready = "true";
}

initialize().catch((error) => {
  console.error(error);
  showError(error);
  window.__LUMEN_READY__ = true;
  window.__LUMEN_ERROR__ = error.message;
});
