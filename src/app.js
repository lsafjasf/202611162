import {
  DEFAULT_SETTINGS,
  LIMITS,
  MATERIALS,
  MATERIAL_ORDER,
  SCENARIOS,
  clone,
  fnv1a,
  normalizeSettings
} from "./model.js";
import { SceneRenderer } from "./renderer.js";

const SAVE_KEY = "lumen-material-lab.state.v1";
const canvas = document.querySelector("#scene-canvas");
const renderer = new SceneRenderer(canvas);

let settings = normalizeSettings(SCENARIOS.default, DEFAULT_SETTINGS).settings;
let orbitAngle = 0;
let paused = false;
let dirty = true;
let lastFrameTime = null;
let lastDelta = 0;
let rendererFrame = 0;
let savedState = false;
let undoStack = [];
let redoStack = [];
let sliderSnapshot = null;
let activeDrag = null;
let wheelSnapshot = null;
let wheelTimer = 0;
let alertTimer = 0;
let lastCapture = null;
let auditRunning = false;
let lastGeometry = null;

const dom = {
  saveState: document.querySelector("#save-state"),
  livePill: document.querySelector("#live-pill"),
  liveLabel: document.querySelector("#live-label"),
  undo: document.querySelector("#undo-button"),
  redo: document.querySelector("#redo-button"),
  save: document.querySelector("#save-button"),
  load: document.querySelector("#load-button"),
  capture: document.querySelector("#capture-button"),
  pause: document.querySelector("#pause-button"),
  pauseLabel: document.querySelector("#pause-label"),
  pausedStamp: document.querySelector("#paused-stamp"),
  alert: document.querySelector("#scene-alert"),
  alertTitle: document.querySelector("#alert-title"),
  alertMessage: document.querySelector("#alert-message"),
  alertClose: document.querySelector("#alert-close"),
  metricObjects: document.querySelector("#metric-objects"),
  metricGeometry: document.querySelector("#metric-geometry"),
  metricFrame: document.querySelector("#metric-frame"),
  roughness: document.querySelector("#roughness-input"),
  roughnessOutput: document.querySelector("#roughness-output"),
  roughnessName: document.querySelector("#roughness-name"),
  autoOrbit: document.querySelector("#auto-orbit"),
  resetCamera: document.querySelector("#reset-camera"),
  cameraOutput: document.querySelector("#camera-output"),
  toastStack: document.querySelector("#toast-stack"),
  auditStatus: document.querySelector("#audit-status"),
  auditResults: document.querySelector("#audit-results"),
  auditRun: document.querySelector("#run-audit")
};

function captureSnapshot() {
  return {
    settings: clone(settings),
    orbitAngle,
    paused
  };
}

function restoreSnapshot(snapshot) {
  settings = normalizeSettings(snapshot.settings, DEFAULT_SETTINGS).settings;
  orbitAngle = Number.isFinite(snapshot.orbitAngle) ? snapshot.orbitAngle : 0;
  paused = Boolean(snapshot.paused);
  lastFrameTime = null;
  lastDelta = 0;
  syncUI();
  markDirty();
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushUndo(snapshot) {
  if (!snapshot || snapshotsEqual(snapshot, captureSnapshot())) return;
  undoStack.push(snapshot);
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return false;
  redoStack.push(captureSnapshot());
  restoreSnapshot(snapshot);
  updateHistoryButtons();
  toast("已撤销上一步参数变更");
  return true;
}

function redo() {
  const snapshot = redoStack.pop();
  if (!snapshot) return false;
  undoStack.push(captureSnapshot());
  restoreSnapshot(snapshot);
  updateHistoryButtons();
  toast("已重做参数变更");
  return true;
}

function updateHistoryButtons() {
  dom.undo.disabled = undoStack.length === 0;
  dom.redo.disabled = redoStack.length === 0;
}

function mutate(patch, options = {}) {
  const { record = false, replace = false } = options;
  const before = record ? captureSnapshot() : null;
  const fallback = replace ? DEFAULT_SETTINGS : settings;
  const normalized = normalizeSettings(patch, fallback);
  const unchanged = snapshotsEqual(normalized.settings, settings);
  settings = normalized.settings;
  if (record && !unchanged) pushUndo(before);
  if (normalized.issues.length) showIssues(normalized.issues);
  syncUI();
  markDirty();
  return { settings, issues: normalized.issues, changed: !unchanged };
}

function markDirty() {
  dirty = true;
  savedState = false;
  updateSaveIndicator();
}

function updateSaveIndicator() {
  dom.saveState.textContent = savedState ? "参数已保存" : "未保存更改";
  dom.saveState.classList.toggle("saved", savedState);
}

function renderNow() {
  lastGeometry = renderer.render(settings, orbitAngle);
  dirty = false;
  dom.metricObjects.textContent = String(lastGeometry.objectCount).padStart(2, "0");
  dom.metricGeometry.textContent = renderer.getDigest();
  dom.metricFrame.textContent = `${renderer.lastRenderMs.toFixed(1)} MS`;
  document.querySelector(".metric:nth-child(3) strong").textContent =
    `PNG · ${canvas.width}×${canvas.height}`;
  rendererFrame += 1;
  return lastGeometry;
}

function loop(timestamp) {
  if (lastFrameTime === null) {
    lastFrameTime = timestamp;
    lastDelta = 0;
  } else {
    lastDelta = paused ? 0 : Math.min(0.05, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
  }

  if (!paused) {
    if (settings.autoOrbit) {
      orbitAngle = (orbitAngle + lastDelta * 3.2) % 360;
      dirty = true;
    }
  }

  if (dirty) renderNow();
  requestAnimationFrame(loop);
}

function setPaused(value, options = {}) {
  const next = Boolean(value);
  if (next === paused) {
    if (options.forceRender) {
      renderNow();
    }
    return paused;
  }
  paused = next;
  settings.paused = paused;
  lastFrameTime = null;
  lastDelta = 0;
  syncUI();
  markDirty();
  renderNow();
  return paused;
}

function resetCamera() {
  mutate(
    { camera: clone(DEFAULT_SETTINGS.camera), autoOrbit: true },
    { record: true }
  );
  orbitAngle = 0;
  lastFrameTime = null;
  toast("视角已重置");
}

function syncUI() {
  for (const card of document.querySelectorAll(".material-card")) {
    const active = card.dataset.material === settings.selected;
    card.classList.toggle("active", active);
    card.setAttribute("aria-selected", String(active));
  }
  for (const id of MATERIAL_ORDER) {
    const element = document.querySelector(`[data-r="${id}"]`);
    if (element) element.textContent = settings.roughness[id].toFixed(2);
  }
  dom.roughness.value = String(settings.roughness[settings.selected]);
  dom.roughnessOutput.textContent = settings.roughness[settings.selected].toFixed(2);
  dom.roughnessName.textContent = MATERIALS[settings.selected].name;

  for (const id of ["A", "B"]) {
    const light = settings.lights[id];
    const lower = id.toLowerCase();
    setRangeValue(`#light-${lower}-azimuth`, light.azimuth);
    setRangeValue(`#light-${lower}-elevation`, light.elevation);
    setRangeValue(`#light-${lower}-intensity`, light.intensity);
    setOutput(`#light-${lower}-azimuth-out`, `${Math.round(light.azimuth)}°`);
    setOutput(`#light-${lower}-elevation-out`, `${Math.round(light.elevation)}°`);
    setOutput(`#light-${lower}-intensity-out`, `${light.intensity.toFixed(2)}×`);
  }

  setRangeValue("#camera-yaw", settings.camera.yaw);
  setRangeValue("#camera-pitch", settings.camera.pitch);
  setRangeValue("#camera-zoom", settings.camera.zoom);
  setOutput("#camera-yaw-out", `${Math.round(settings.camera.yaw)}°`);
  setOutput("#camera-pitch-out", `${Math.round(settings.camera.pitch)}°`);
  setOutput("#camera-zoom-out", `${settings.camera.zoom.toFixed(2)}×`);
  dom.cameraOutput.textContent = `${Math.round(settings.camera.yaw)}° · ${settings.camera.zoom.toFixed(2)}×`;
  dom.autoOrbit.classList.toggle("active", settings.autoOrbit);
  dom.autoOrbit.setAttribute("aria-pressed", String(settings.autoOrbit));
  dom.autoOrbit.textContent = `自动环绕 ${settings.autoOrbit ? "ON" : "OFF"}`;

  dom.pause.classList.toggle("is-paused", paused);
  dom.pause.setAttribute("aria-pressed", String(paused));
  dom.pauseLabel.textContent = paused ? "继续" : "暂停";
  dom.pausedStamp.hidden = true;
  dom.livePill.classList.toggle("paused", paused);
  dom.liveLabel.textContent = paused ? "COMPOSITE FROZEN" : "LIVE COMPOSITE";
  document.body.dataset.paused = String(paused);
}

function setRangeValue(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.value = String(value);
}

function setOutput(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

const rangeBindings = [
  {
    selector: "#roughness-input",
    patch: (value) => ({ roughness: { [settings.selected]: value } })
  },
  {
    selector: "#light-a-azimuth",
    patch: (value) => ({ lights: { A: { azimuth: value } } })
  },
  {
    selector: "#light-a-elevation",
    patch: (value) => ({ lights: { A: { elevation: value } } })
  },
  {
    selector: "#light-a-intensity",
    patch: (value) => ({ lights: { A: { intensity: value } } })
  },
  {
    selector: "#light-b-azimuth",
    patch: (value) => ({ lights: { B: { azimuth: value } } })
  },
  {
    selector: "#light-b-elevation",
    patch: (value) => ({ lights: { B: { elevation: value } } })
  },
  {
    selector: "#light-b-intensity",
    patch: (value) => ({ lights: { B: { intensity: value } } })
  },
  {
    selector: "#camera-yaw",
    patch: (value) => ({ camera: { yaw: value } })
  },
  {
    selector: "#camera-pitch",
    patch: (value) => ({ camera: { pitch: value } })
  },
  {
    selector: "#camera-zoom",
    patch: (value) => ({ camera: { zoom: value } })
  }
];

for (const binding of rangeBindings) {
  const input = document.querySelector(binding.selector);
  if (!input) continue;
  input.addEventListener("focus", () => {
    if (!sliderSnapshot) sliderSnapshot = captureSnapshot();
  });
  input.addEventListener("pointerdown", () => {
    sliderSnapshot = captureSnapshot();
  });
  input.addEventListener("input", () => {
    mutate(binding.patch(Number.parseFloat(input.value)), { record: false });
  });
  input.addEventListener("change", () => {
    const snapshot = sliderSnapshot;
    sliderSnapshot = null;
    if (snapshot) pushUndo(snapshot);
  });
}

for (const card of document.querySelectorAll(".material-card")) {
  card.addEventListener("click", () => {
    mutate({ selected: card.dataset.material }, { record: true });
  });
}

dom.autoOrbit.addEventListener("click", () => {
  mutate({ autoOrbit: !settings.autoOrbit });
  lastFrameTime = null;
  toast(`自动环绕已${settings.autoOrbit ? "开启" : "关闭"}`);
});

dom.resetCamera.addEventListener("click", resetCamera);
dom.pause.addEventListener("click", () => {
  setPaused(!paused);
  toast(paused ? "画面已冻结，动画时间停止" : "动画已恢复，时间从暂停点继续");
});
dom.undo.addEventListener("click", undo);
dom.redo.addEventListener("click", redo);
dom.alertClose.addEventListener("click", hideIssues);
dom.save.addEventListener("click", () => saveParameters());
dom.load.addEventListener("click", () => loadParameters());
dom.capture.addEventListener("click", () => exportScreenshot());
document.querySelector("#mobile-undo").addEventListener("click", undo);
document.querySelector("#mobile-save").addEventListener("click", () => saveParameters());
document.querySelector("#mobile-load").addEventListener("click", () => loadParameters());

function bindCanvasInteraction() {
  canvas.addEventListener("pointerdown", (event) => {
    canvas.focus({ preventScroll: true });
    const point = canvasPoint(event);
    const lightId = renderer.hitTestLight(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    if (lightId) {
      const light = settings.lights[lightId];
      activeDrag = {
        type: "light",
        lightId,
        startX: point.x,
        startY: point.y,
        startAzimuth: light.azimuth,
        startElevation: light.elevation,
        snapshot: captureSnapshot()
      };
    } else {
      activeDrag = {
        type: "camera",
        startX: point.x,
        startY: point.y,
        startYaw: settings.camera.yaw,
        startPitch: settings.camera.pitch,
        snapshot: captureSnapshot()
      };
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    if (!activeDrag) {
      const hovered = renderer.hitTestLight(point.x, point.y);
      if (hovered !== renderer.hoveredLight) {
        renderer.hoveredLight = hovered;
        if (!paused) markDirty();
      }
      return;
    }

    const dx = point.x - activeDrag.startX;
    const dy = point.y - activeDrag.startY;
    if (activeDrag.type === "light") {
      mutate(
        {
          lights: {
            [activeDrag.lightId]: {
              azimuth: wrap360(activeDrag.startAzimuth + dx * 0.72),
              elevation: clamp(activeDrag.startElevation - dy * 0.32, LIMITS.elevation[0], LIMITS.elevation[1])
            }
          }
        },
        { record: false }
      );
    } else {
      mutate(
        {
          camera: {
            yaw: clamp(activeDrag.startYaw + dx * 0.3, LIMITS.yaw[0], LIMITS.yaw[1]),
            pitch: clamp(activeDrag.startPitch + dy * 0.22, LIMITS.pitch[0], LIMITS.pitch[1])
          }
        },
        { record: false }
      );
    }
  });

  const finishDrag = (event) => {
    if (!activeDrag) return;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!snapshotsEqual(activeDrag.snapshot, captureSnapshot())) {
      pushUndo(activeDrag.snapshot);
    }
    activeDrag = null;
    canvas.classList.remove("is-dragging");
  };

  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!activeDrag && renderer.hoveredLight) {
      renderer.hoveredLight = null;
      if (!paused) markDirty();
    }
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (!wheelSnapshot) wheelSnapshot = captureSnapshot();
      const direction = Math.sign(event.deltaY);
      const next = clamp(settings.camera.zoom - direction * 0.035, LIMITS.zoom[0], LIMITS.zoom[1]);
      mutate({ camera: { zoom: Number(next.toFixed(2)) } }, { record: false });
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        if (wheelSnapshot) pushUndo(wheelSnapshot);
        wheelSnapshot = null;
      }, 350);
    },
    { passive: false }
  );
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function wrap360(value) {
  return ((value % 360) + 360) % 360;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showIssues(issues, title = "参数已自动修正") {
  if (!issues || !issues.length) return;
  dom.alertTitle.textContent = `${title} · ${issues.length} 项`;
  dom.alertMessage.textContent = issues.slice(0, 4).join("；") + (issues.length > 4 ? `；另有 ${issues.length - 4} 项` : "");
  dom.alert.hidden = false;
  window.clearTimeout(alertTimer);
  alertTimer = window.setTimeout(hideIssues, 12_000);
}

function hideIssues() {
  window.clearTimeout(alertTimer);
  dom.alert.hidden = true;
}

function toast(message, options = {}) {
  const element = document.createElement("div");
  element.className = `toast${options.error ? " error" : ""}`;
  element.textContent = message;
  dom.toastStack.append(element);
  window.setTimeout(() => {
    element.style.opacity = "0";
    element.style.transform = "translateY(4px)";
    element.style.transition = "opacity 180ms ease, transform 180ms ease";
    window.setTimeout(() => element.remove(), 220);
  }, options.duration || 3600);
}

function createSavePayload() {
  renderNow();
  const dataUrl = canvas.toDataURL("image/png");
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    settings: clone(settings),
    orbitAngle,
    previewHash: renderer.getPixelHash(),
    geometryDigest: renderer.getDigest(),
    exportHash: fnv1a(dataUrl)
  };
}

function saveParameters() {
  try {
    const payload = createSavePayload();
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    savedState = true;
    updateSaveIndicator();
    toast(`参数已保存 · ${payload.geometryDigest} / ${payload.previewHash}`);
    return payload;
  } catch (error) {
    savedState = false;
    updateSaveIndicator();
    showIssues([`保存失败：${error.message || "浏览器存储不可用"}`], "无法保存参数");
    toast("参数保存失败，画面仍可继续使用", { error: true });
    return null;
  }
}

function loadParameters() {
  let payload;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      toast("还没有已保存的参数，请先点击“保存参数”", { error: true });
      return { ok: false, reason: "empty" };
    }
    payload = JSON.parse(raw);
    if (!payload || !payload.settings) throw new Error("存档缺少 settings 字段");
  } catch (error) {
    showIssues([`存档无法解析：${error.message || "文件为空"}；当前画面保持不变`], "载入失败，已保护当前场景");
    toast("参数载入失败，未清空当前画面", { error: true });
    return { ok: false, reason: "invalid" };
  }

  const before = captureSnapshot();
  const parsed = normalizeSettings(payload.settings, DEFAULT_SETTINGS);
  settings = parsed.settings;
  paused = Boolean(settings.paused);
  settings.paused = paused;
  orbitAngle = Number.isFinite(Number(payload.orbitAngle)) ? Number(payload.orbitAngle) : 0;
  lastFrameTime = null;
  lastDelta = 0;
  if (parsed.issues.length) showIssues(parsed.issues, "载入参数时已修正");
  pushUndo(before);
  syncUI();
  markDirty();
  renderNow();
  const previewHash = renderer.getPixelHash();
  const exportHash = fnv1a(canvas.toDataURL("image/png"));
  const geometry = renderer.getDigest();
  const matches = {
    geometry: !payload.geometryDigest || payload.geometryDigest === geometry,
    preview: !payload.previewHash || payload.previewHash === previewHash,
    export: !payload.exportHash || payload.exportHash === exportHash
  };
  const allMatch = Object.values(matches).every(Boolean);
  savedState = allMatch;
  updateSaveIndicator();
  if (allMatch) {
    toast(`参数已载入 · 几何 / 预览 / PNG 哈希一致 ${previewHash}`);
  } else if (paused) {
    toast("参数已载入，但摘要与保存时不同；请检查视口尺寸", { error: true });
  } else {
    toast("参数已载入；当前为运行态，暂停后可复核截图哈希");
  }
  return {
    ok: true,
    issues: parsed.issues,
    matches,
    allMatch,
    payload,
    geometryDigest: geometry,
    previewHash,
    exportHash
  };
}

async function exportScreenshot(options = {}) {
  renderNow();
  const dataUrl = canvas.toDataURL("image/png");
  const exportHash = fnv1a(dataUrl);
  const pixelHash = renderer.getPixelHash();
  const result = {
    dataUrl,
    hash: exportHash,
    pixelHash,
    geometryDigest: renderer.getDigest(),
    width: canvas.width,
    height: canvas.height,
    filename: `lumen-specimen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
  };
  lastCapture = result;
  if (options.download !== false) {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Canvas 无法生成 PNG");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
      toast(`截图已导出 · ${canvas.width} × ${canvas.height} · ${pixelHash}`);
    } catch (error) {
      showIssues([`截图导出失败：${error.message}`], "导出失败");
      toast("截图导出失败", { error: true });
    }
  }
  return result;
}

function geometryPositions(geometry) {
  return {
    spheres: geometry.spheres.map((sphere) => ({
      id: sphere.id,
      center: sphere.center,
      radius: sphere.radius,
      label: sphere.label
    })),
    lights: geometry.lights.map((light) => ({ id: light.id, screen: light.screen })),
    dome: geometry.dome
  };
}

function canvasHasVariation() {
  const context = canvas.getContext("2d");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const colors = new Set();
  const stride = Math.max(4, Math.floor(data.length / 2400 / 4) * 4);
  for (let index = 0; index < data.length; index += stride) {
    colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
    if (colors.size > 18) return true;
  }
  return false;
}

function scenarioFingerprint() {
  renderNow();
  const dataUrl = canvas.toDataURL("image/png");
  return {
    geometry: clone(lastGeometry),
    positions: geometryPositions(lastGeometry),
    geometryDigest: renderer.getDigest(),
    pixelHash: renderer.getPixelHash(),
    exportHash: fnv1a(dataUrl),
    exportBytes: dataUrl.length,
    nonBlank: canvasHasVariation()
  };
}

function runAudit() {
  if (auditRunning) return null;
  auditRunning = true;
  dom.auditRun.disabled = true;
  dom.auditStatus.textContent = "运行中";
  dom.auditStatus.className = "audit-status";
  const original = captureSnapshot();
  const results = [];

  try {
    for (const name of ["default", "extreme", "anomaly"]) {
      const parsed = normalizeSettings(SCENARIOS[name], DEFAULT_SETTINGS);
      settings = { ...clone(parsed.settings), paused: true, autoOrbit: false };
      paused = true;
      orbitAngle = 0;
      lastFrameTime = null;
      lastDelta = 0;
      syncUI();
      const before = scenarioFingerprint();
      const after = scenarioFingerprint();
      const beforeCounts = {
        total: before.geometry.objectCount,
        spheres: before.geometry.spheres.length,
        lights: before.geometry.lights.length,
        layers: before.geometry.layers.length
      };
      const afterCounts = {
        total: after.geometry.objectCount,
        spheres: after.geometry.spheres.length,
        lights: after.geometry.lights.length,
        layers: after.geometry.layers.length
      };
      results.push({
        scenario: name,
        issues: parsed.issues,
        issueCount: parsed.issues.length,
        objectCounts: afterCounts,
        countsStable: JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
        geometryStable: JSON.stringify(before.positions) === JSON.stringify(after.positions),
        digestStable: before.geometryDigest === after.geometryDigest,
        previewStable: before.pixelHash === after.pixelHash,
        exportStable: before.exportHash === after.exportHash,
        nonBlank: before.nonBlank && after.nonBlank,
        geometryDigest: before.geometryDigest,
        previewHash: before.pixelHash,
        exportHash: before.exportHash,
        exportBytes: before.exportBytes
      });
    }

    const previewHashes = new Set(results.map((result) => result.previewHash));
    const allStable = results.every(
      (result) =>
        result.countsStable &&
        result.geometryStable &&
        result.digestStable &&
        result.previewStable &&
        result.exportStable &&
        result.nonBlank
    );
    const distinct = previewHashes.size === 3;
    const passed = allStable && distinct;
    renderAuditResults(results, passed, distinct);
    dom.auditStatus.textContent = passed ? "通过" : "需检查";
    dom.auditStatus.className = `audit-status ${passed ? "pass" : "fail"}`;
    toast(passed ? "三组重算校验通过：对象 / 几何 / 导出均稳定" : "校验发现差异，请查看诊断面板");
    return { passed, allStable, distinct, results };
  } finally {
    settings = clone(original.settings);
    orbitAngle = original.orbitAngle;
    paused = original.paused;
    settings.paused = paused;
    lastFrameTime = null;
    lastDelta = 0;
    syncUI();
    renderNow();
    auditRunning = false;
    dom.auditRun.disabled = false;
  }
}

function renderAuditResults(results, passed, distinct) {
  const rows = results
    .map((result) => {
      const stable =
        result.countsStable &&
        result.geometryStable &&
        result.digestStable &&
        result.previewStable &&
        result.exportStable &&
        result.nonBlank;
      const label = result.scenario === "default" ? "默认" : result.scenario === "extreme" ? "极值" : "异常";
      const warnings = result.issueCount ? ` · 修正${result.issueCount}` : "";
      return `<div class="audit-line${stable ? "" : " fail"}"><span>${label} · ${result.objectCounts.total} 对象${warnings}</span><span>${stable ? "稳定" : "差异"} ${result.previewHash.slice(0, 4)}</span></div>`;
    })
    .join("");
  dom.auditResults.innerHTML = `${rows}
    <div class="audit-line${distinct ? "" : " fail"}"><span>三组画面差异</span><span>${distinct ? "已确认" : "重复"}</span></div>
    <div class="audit-line${passed ? "" : " fail"}"><span>数量 / 几何 / PNG 哈希</span><span>${passed ? "全部一致" : "需复核"}</span></div>`;
}

function resizeScene() {
  markDirty();
  renderNow();
}

function init() {
  bindCanvasInteraction();
  syncUI();
  updateHistoryButtons();
  updateSaveIndicator();
  renderNow();
  const observer = new ResizeObserver(() => resizeScene());
  observer.observe(canvas);
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      dirty = true;
      renderNow();
    });
  }
  requestAnimationFrame(loop);
}

for (const button of document.querySelectorAll("[data-scenario]")) {
  button.addEventListener("click", () => {
    const name = button.dataset.scenario;
    mutate(SCENARIOS[name], { record: true, replace: true });
    orbitAngle = 0;
    lastFrameTime = null;
    for (const item of document.querySelectorAll("[data-scenario]")) {
      item.classList.toggle("active", item === button);
    }
    renderNow();
  });
}

window.__opticalLab = {
  ready: true,
  getState({ includePixels = false } = {}) {
    if (!lastGeometry) renderNow();
    return {
      settings: clone(settings),
      paused,
      orbitAngle,
      lastDelta,
      objectCount: lastGeometry.objectCount,
      geometry: clone(lastGeometry),
      geometryDigest: renderer.getDigest(),
      previewHash: renderer.getPixelHash(),
      exportHash: includePixels ? fnv1a(canvas.toDataURL("image/png")) : null,
      canvas: { width: canvas.width, height: canvas.height },
      renderMs: renderer.lastRenderMs,
      shading: clone(renderer.shadingDiagnostics),
      issuesVisible: !dom.alert.hidden,
      saved: savedState
    };
  },
  getGeometry() {
    if (!lastGeometry) renderNow();
    return clone(lastGeometry);
  },
  getFingerprint() {
    return scenarioFingerprint();
  },
  getPreviewDataURL() {
    renderNow();
    return canvas.toDataURL("image/png");
  },
  getPreviewHash() {
    return renderer.getPixelHash();
  },
  getExportHash() {
    return fnv1a(canvas.toDataURL("image/png"));
  },
  applySettings(patch, options = {}) {
    const result = mutate(patch, {
      record: Boolean(options.record),
      replace: Boolean(options.replace)
    });
    if (options.resetOrbit) orbitAngle = 0;
    renderNow();
    return {
      settings: clone(result.settings),
      issues: result.issues,
      changed: result.changed,
      geometryDigest: renderer.getDigest(),
      previewHash: renderer.getPixelHash()
    };
  },
  applyScenario(name) {
    if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}`);
    mutate(SCENARIOS[name], { record: false, replace: true });
    orbitAngle = 0;
    lastFrameTime = null;
    renderNow();
    return this.getState();
  },
  pause() {
    return setPaused(true);
  },
  resume() {
    return setPaused(false);
  },
  setPaused(value) {
    return setPaused(value);
  },
  recompute() {
    const before = scenarioFingerprint();
    renderNow();
    const after = scenarioFingerprint();
    return {
      before: {
        objectCount: before.geometry.objectCount,
        positions: before.positions,
        geometryDigest: before.geometryDigest,
        previewHash: before.pixelHash,
        exportHash: before.exportHash
      },
      after: {
        objectCount: after.geometry.objectCount,
        positions: after.positions,
        geometryDigest: after.geometryDigest,
        previewHash: after.pixelHash,
        exportHash: after.exportHash
      },
      stable:
        JSON.stringify(before.positions) === JSON.stringify(after.positions) &&
        before.geometryDigest === after.geometryDigest &&
        before.pixelHash === after.pixelHash &&
        before.exportHash === after.exportHash
    };
  },
  capture() {
    return exportScreenshot({ download: false });
  },
  save() {
    return saveParameters();
  },
  load() {
    return loadParameters();
  },
  undo,
  redo,
  runAudit,
  getLastCapture() {
    return lastCapture;
  },
  measureHighlight(sphereId, threshold = 220) {
    if (!lastGeometry) renderNow();
    const sphere = lastGeometry.spheres.find((item) => item.id === sphereId);
    if (!sphere) return 0;
    const ratio = canvas.width / renderer.width;
    const centerX = Math.round(sphere.center.x * ratio);
    const centerY = Math.round(sphere.center.y * ratio);
    const pixelRadius = Math.round(sphere.radius * ratio);
    const x = Math.max(0, centerX - pixelRadius);
    const y = Math.max(0, centerY - pixelRadius);
    const width = Math.min(canvas.width - x, Math.ceil(sphere.radius * 2 * ratio));
    const height = Math.min(canvas.height - y, Math.ceil(sphere.radius * 2 * ratio));
    if (width <= 0 || height <= 0) return 0;
    const data = canvas.getContext("2d").getImageData(x, y, width, height).data;
    let count = 0;
    const radiusSquared = pixelRadius * pixelRadius;
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const dx = x + column - centerX;
        const dy = y + row - centerY;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const index = (row * width + column) * 4;
        if (data[index] >= threshold && data[index + 1] >= threshold && data[index + 2] >= threshold) {
          count += 1;
        }
      }
    }
    return count;
  },
  clearSaved() {
    localStorage.removeItem(SAVE_KEY);
    savedState = false;
    updateSaveIndicator();
  }
};

document.addEventListener("keydown", (event) => {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
  if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveParameters();
  }
  if (event.key === " " && event.target === document.body) {
    event.preventDefault();
    setPaused(!paused);
  }
});

window.addEventListener("resize", () => {
  window.clearTimeout(window.__lumenResizeTimer);
  window.__lumenResizeTimer = window.setTimeout(() => {
    markDirty();
  }, 40);
});

init();
