import {
  DEFAULT_PARAMS,
  MAX_SECTION_OFFSET,
  createSection,
  createTerrain,
  digestString,
  sampleSectionAt,
  validateParams,
} from "./terrain-engine.js";
import {
  DEFAULT_CAMERA,
  CAMERA_LIMITS,
  createProfileSVG,
  createProjection,
  getProfileLayout,
  normalizeCamera,
  renderProfile,
  renderTerrain,
} from "./terrain-renderer.js";
import { createScreenshotDataURL } from "./screenshot.js";

const $ = (selector) => document.querySelector(selector);
const PRESET_KEY = "ridgeline.presets.v1";
const HISTORY_LIMIT = 32;

const dom = {
  terrainCanvas: $("#terrainCanvas"),
  profileCanvas: $("#profileCanvas"),
  terrainFrame: $(".terrain-frame"),
  profileFrame: $(".profile-frame"),
  peakElevation: $("#peakElevation"),
  meshCount: $("#meshCount"),
  sectionPeak: $("#sectionPeak"),
  sectionLength: $("#sectionLength"),
  sampleCount: $("#sampleCount"),
  profilePeakValue: $("#profilePeakValue"),
  profileAngleLabel: $("#profileAngleLabel"),
  sectionPathLabel: $("#sectionPathLabel"),
  linkedReadout: $("#linkedReadout"),
  linkedElevation: $("#linkedElevation"),
  interactionNote: $("#interactionNote"),
  yawReadout: $("#yawReadout"),
  pitchReadout: $("#pitchReadout"),
  zoomReadout: $("#zoomReadout"),
  topDigest: $("#topDigest"),
  footerDigest: $("#footerDigest"),
  integrityMesh: $("#integrityMesh"),
  integrityProfile: $("#integrityProfile"),
  integrityOrder: $("#integrityOrder"),
  integrityNote: $("#integrityNote"),
  seedInput: $("#seedInput"),
  ridgeInput: $("#ridgeInput"),
  ridgeValue: $("#ridgeValue"),
  angleInput: $("#angleInput"),
  angleValue: $("#angleValue"),
  offsetInput: $("#offsetInput"),
  offsetValue: $("#offsetValue"),
  compactOffset: $("#compactOffset"),
  compactOffsetValue: $("#compactOffsetValue"),
  resolutionInput: $("#resolutionInput"),
  undoButton: $("#undoButton"),
  pauseButton: $("#pauseButton"),
  pauseIcon: $("#pauseIcon"),
  resetViewButton: $("#resetViewButton"),
  randomSeedButton: $("#randomSeedButton"),
  exportButton: $("#exportButton"),
  screenshotButton: $("#screenshotButton"),
  saveButton: $("#saveButton"),
  libraryButton: $("#libraryButton"),
  presetCount: $("#presetCount"),
  errorBanner: $("#errorBanner"),
  errorMessage: $("#errorMessage"),
  dismissError: $("#dismissError"),
  statusMessage: $("#statusMessage"),
  toast: $("#toast"),
  presetDialog: $("#presetDialog"),
  presetName: $("#presetName"),
  confirmSave: $("#confirmSave"),
  cancelSave: $("#cancelSave"),
  dialogMeshDigest: $("#dialogMeshDigest"),
  dialogProfileDigest: $("#dialogProfileDigest"),
  libraryDialog: $("#libraryDialog"),
  closeLibrary: $("#closeLibrary"),
  presetList: $("#presetList"),
  libraryEmpty: $("#libraryEmpty"),
};

const state = {
  params: { ...DEFAULT_PARAMS },
  sectionSettings: { angle: 24, offset: 0 },
  camera: { ...DEFAULT_CAMERA },
  playing: true,
  animationTime: 0,
  lastFrameTime: performance.now(),
  hoverPoint: null,
  pinnedPoint: null,
  cursorFraction: null,
  history: [],
  redo: [],
  presets: [],
  buildCount: 0,
  renderRevision: 0,
  needsRender: true,
  lastRender: null,
  lastProfileRender: null,
  lastSvg: null,
  lastPresetLoad: null,
  errors: [],
  drag: null,
  lastHistorySignature: "",
  lastHistoryTime: 0,
};

let terrain = createTerrain(state.params);
let section = createSection(terrain, state.sectionSettings);
state.buildCount += 1;

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatElevation(value) {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

function formatCoordinate(value) {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return rounded.toFixed(2);
}

function nowSignature(label) {
  return `${label}:${Math.round(performance.now() / 650)}`;
}

function captureSnapshot(label = "编辑") {
  return {
    label,
    params: deepClone(state.params),
    sectionSettings: deepClone(state.sectionSettings),
    camera: deepClone(state.camera),
    pinnedPoint: state.pinnedPoint ? deepClone(state.pinnedPoint) : null,
  };
}

function pushHistory(label, options = {}) {
  const signature = options.coalesce ? nowSignature(label) : "";
  const now = performance.now();
  if (
    options.coalesce &&
    signature === state.lastHistorySignature &&
    now - state.lastHistoryTime < 620
  ) {
    state.lastHistoryTime = now;
    return false;
  }
  state.history.push(captureSnapshot(label));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.redo.length = 0;
  state.lastHistorySignature = signature;
  state.lastHistoryTime = now;
  updateHistoryButtons();
  return true;
}

function updateHistoryButtons() {
  dom.undoButton.disabled = state.history.length === 0;
}

function getCurrentDigests() {
  return {
    geometry: terrain.geometryDigest,
    profile: section.profileDigest,
    renderOrder: state.lastRender?.renderOrderDigest ?? "",
    structural: getStructuralDigest(),
    svg: state.lastSvg?.structuralDigest ?? "",
  };
}

function getStructuralDigest() {
  return digestString(
    [
      terrain.geometryDigest,
      section.profileDigest,
      state.lastRender?.renderOrderDigest ?? "pending",
      state.camera.yaw.toFixed(3),
      state.camera.pitch.toFixed(3),
      state.camera.zoom.toFixed(3),
      state.camera.panX.toFixed(4),
      state.camera.panY.toFixed(4),
    ].join("|"),
  );
}

function getCanvasMetrics(canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function getEffectivePoint() {
  return state.hoverPoint ?? state.pinnedPoint;
}

function computeCursorFraction(point) {
  if (!point) return null;
  const { start, direction, length } = section.line;
  const dx = point.x - start.x;
  const dz = point.z - start.z;
  const along = dx * direction.x + dz * direction.z;
  return Math.max(0, Math.min(1, along / Math.max(1e-6, length)));
}

function makePointFromFraction(fraction) {
  const sample = sampleSectionAt(section, fraction);
  return {
    x: sample.x,
    z: sample.z,
    y: sample.y,
    elevation: sample.elevation,
  };
}

function ensureCursorForPoint(point) {
  state.cursorFraction = computeCursorFraction(point);
}

function renderNow() {
  const terrainMetrics = getCanvasMetrics(dom.terrainCanvas);
  const profileMetrics = getCanvasMetrics(dom.profileCanvas);
  const point = getEffectivePoint();
  const terrainRender = renderTerrain(dom.terrainCanvas, {
    terrain,
    section,
    camera: state.camera,
    highlight: point,
    time: state.animationTime,
    width: terrainMetrics.width,
    height: terrainMetrics.height,
  });
  const profileRender = renderProfile(dom.profileCanvas, {
    terrain,
    section,
    cursorFraction: state.cursorFraction,
    time: state.animationTime,
    width: profileMetrics.width,
    height: profileMetrics.height,
  });
  state.lastRender = terrainRender;
  state.lastProfileRender = profileRender;
  state.needsRender = false;
  state.renderRevision += 1;
  state.lastSvg = createProfileSVG(terrain, section, {
    cursorFraction: state.cursorFraction,
  });
  updateInterface();
  return { terrainRender, profileRender };
}

function setStatus(message, active = false) {
  dom.statusMessage.textContent = message;
  dom.statusMessage.classList.toggle("is-active", active);
}

let toastTimer = 0;
function showToast(message, duration = 2300) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), duration);
}

function clearError() {
  state.errors = [];
  dom.errorBanner.hidden = true;
  dom.seedInput.classList.remove("is-invalid");
  dom.ridgeInput.classList.remove("is-invalid");
  dom.resolutionInput.classList.remove("is-invalid");
}

function showError(message, field = null) {
  state.errors = [message];
  dom.errorMessage.textContent = message;
  dom.errorBanner.hidden = false;
  dom.seedInput.classList.remove("is-invalid");
  dom.ridgeInput.classList.remove("is-invalid");
  dom.resolutionInput.classList.remove("is-invalid");
  if (field) field.classList.add("is-invalid");
  setStatus(`未应用 · ${message}`, true);
}

function validateSectionSettings(input) {
  const angle = Number(input.angle);
  const offset = Number(input.offset);
  if (!Number.isFinite(angle) || angle < 0 || angle > 180) {
    throw new Error("剖面方向必须在 0°–180° 之间");
  }
  if (!Number.isFinite(offset) || offset < -MAX_SECTION_OFFSET || offset > MAX_SECTION_OFFSET) {
    throw new Error(`剖线偏移必须在 ±${MAX_SECTION_OFFSET.toFixed(2)} 之间`);
  }
  return { angle, offset };
}

function rebuildTerrain(nextParams, options = {}) {
  const normalized = validateParams(nextParams);
  if (options.history !== false) {
    pushHistory(options.label || "参数变更", { coalesce: options.coalesce });
  }
  terrain = createTerrain(normalized);
  state.params = { ...normalized };
  section = createSection(terrain, state.sectionSettings);
  state.buildCount += 1;
  if (state.pinnedPoint) ensureCursorForPoint(state.pinnedPoint);
  if (state.hoverPoint) ensureCursorForPoint(state.hoverPoint);
  clearError();
  syncControlsFromState();
  state.needsRender = true;
  renderNow();
  setStatus(`几何已重建 · ${terrain.counts.triangles.toLocaleString("en-US")} 个三角面`, true);
  return {
    ok: true,
    params: deepClone(state.params),
    counts: deepClone(terrain.counts),
    stats: deepClone(terrain.stats),
    digests: getCurrentDigests(),
  };
}

function applyParameterPatch(patch, options = {}) {
  const nextParams = { ...state.params, ...patch };
  try {
    validateParams(nextParams);
  } catch (error) {
    const field =
      String(patch.seed) !== "undefined"
        ? dom.seedInput
        : String(patch.ridgeHeight) !== "undefined"
          ? dom.ridgeInput
          : dom.resolutionInput;
    showError(error.message, field);
    dom.ridgeValue.textContent = `${Number(state.params.ridgeHeight).toFixed(2)}×`;
    return { ok: false, errors: error.validationErrors || [error.message] };
  }
  return rebuildTerrain(nextParams, options);
}

function applySectionSettings(nextSettings, options = {}) {
  let normalized;
  try {
    normalized = validateSectionSettings({ ...state.sectionSettings, ...nextSettings });
  } catch (error) {
    showError(error.message);
    return { ok: false, errors: [error.message] };
  }
  if (options.history !== false) {
    pushHistory(options.label || "剖面变更", { coalesce: options.coalesce });
  }
  state.sectionSettings = normalized;
  section = createSection(terrain, normalized);
  if (state.pinnedPoint) ensureCursorForPoint(state.pinnedPoint);
  if (state.hoverPoint) ensureCursorForPoint(state.hoverPoint);
  clearError();
  syncControlsFromState();
  state.needsRender = true;
  renderNow();
  setStatus(`剖面已更新 · ${Math.round(normalized.angle)}° / ${normalized.offset.toFixed(2)}`, true);
  return {
    ok: true,
    section: {
      angle: section.angle,
      offset: section.offset,
      samples: section.samples.length,
      lengthMeters: section.lengthMeters,
      profileDigest: section.profileDigest,
    },
    camera: deepClone(state.camera),
    digests: getCurrentDigests(),
  };
}

function restoreSnapshot(snapshot, options = {}) {
  if (!snapshot) return { ok: false, errors: ["快照不存在"] };
  if (options.history !== false) pushHistory(options.label || "载入快照");
  try {
    const params = validateParams(snapshot.params);
    const sectionSettings = validateSectionSettings(snapshot.sectionSettings);
    terrain = createTerrain(params);
    state.params = params;
    state.sectionSettings = sectionSettings;
    section = createSection(terrain, sectionSettings);
    state.camera = normalizeCamera(snapshot.camera);
    state.pinnedPoint = snapshot.pinnedPoint ? deepClone(snapshot.pinnedPoint) : null;
    state.hoverPoint = null;
    state.cursorFraction = state.pinnedPoint ? computeCursorFraction(state.pinnedPoint) : null;
    state.buildCount += 1;
    clearError();
    syncControlsFromState();
    state.needsRender = true;
    renderNow();
    return {
      ok: true,
      counts: deepClone(terrain.counts),
      stats: deepClone(terrain.stats),
      digests: getCurrentDigests(),
    };
  } catch (error) {
    showError(`快照无效：${error.message}`);
    return { ok: false, errors: error.validationErrors || [error.message] };
  }
}

function undo() {
  if (!state.history.length) return { ok: false, reason: "empty" };
  const snapshot = state.history.pop();
  state.redo.push(captureSnapshot(snapshot.label));
  const result = restoreSnapshot(snapshot, { history: false });
  updateHistoryButtons();
  if (result.ok) {
    setStatus(`已撤销 · ${snapshot.label}`, true);
    showToast(`已撤销「${snapshot.label}」`);
  }
  return result;
}

function redo() {
  if (!state.redo.length) return { ok: false, reason: "empty" };
  const snapshot = state.redo.pop();
  state.history.push(captureSnapshot(snapshot.label));
  const result = restoreSnapshot(snapshot, { history: false });
  updateHistoryButtons();
  return result;
}

function syncControlsFromState() {
  dom.seedInput.value = String(state.params.seed);
  dom.ridgeInput.value = String(state.params.ridgeHeight);
  dom.ridgeValue.textContent = `${Number(state.params.ridgeHeight).toFixed(2)}×`;
  dom.angleInput.value = String(state.sectionSettings.angle);
  dom.angleValue.textContent = `${Math.round(state.sectionSettings.angle)}°`;
  dom.offsetInput.value = String(state.sectionSettings.offset);
  dom.offsetValue.textContent = Number(state.sectionSettings.offset).toFixed(2);
  dom.compactOffset.value = String(state.sectionSettings.offset);
  dom.compactOffsetValue.textContent = Number(state.sectionSettings.offset).toFixed(2);
  dom.resolutionInput.value = String(state.params.resolution);
  updateDirectionTabs();
}

function updateDirectionTabs() {
  const rounded = Math.round(state.sectionSettings.angle);
  for (const tab of document.querySelectorAll(".direction-tab")) {
    const active = Number(tab.dataset.angle) === rounded;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
}

function updateInterface() {
  const peak = terrain.stats.peak;
  dom.peakElevation.textContent = formatElevation(peak.elevation);
  dom.meshCount.textContent = `${terrain.params.resolution + 1}² / ${terrain.counts.triangles.toLocaleString("en-US")}`;
  dom.sectionPeak.textContent = formatElevation(section.maxSample.elevation);
  dom.sectionLength.textContent = `${(section.lengthMeters / 1000).toFixed(2)} km`;
  dom.sampleCount.textContent = `${section.samples.length}`;
  dom.profilePeakValue.textContent = formatElevation(section.maxSample.elevation);
  dom.profileAngleLabel.textContent = `AZ ${String(Math.round(section.angle)).padStart(3, "0")}° / ${section.offset.toFixed(2)}`;
  dom.sectionPathLabel.textContent = `A ${formatCoordinate(section.line.start.x)}, ${formatCoordinate(section.line.start.z)} → B ${formatCoordinate(section.line.end.x)}, ${formatCoordinate(section.line.end.z)}`;

  dom.yawReadout.textContent = `${Math.round(state.camera.yaw)}°`;
  dom.pitchReadout.textContent = `${Math.round(state.camera.pitch)}°`;
  dom.zoomReadout.textContent = `${state.camera.zoom.toFixed(2)}×`;

  const digests = getCurrentDigests();
  dom.topDigest.textContent = `MESH ${digests.geometry} · PROFILE ${digests.profile}`;
  dom.footerDigest.textContent = digests.structural;
  dom.integrityMesh.textContent = `${digests.geometry} / ${terrain.counts.cells.toLocaleString("en-US")} cells`;
  dom.integrityProfile.textContent = `${digests.profile} / ${section.samples.length} pts`;
  dom.integrityOrder.textContent = `${digests.renderOrder} / ${state.lastRender?.objectCounts.renderItems ?? 0}`;
  if (state.lastRender) {
    dom.integrityNote.textContent = `${state.lastRender.drawCalls} 绘制项 · 基准层 → 地形层 → 标注层`;
  }
  dom.dialogMeshDigest.textContent = digests.geometry;
  dom.dialogProfileDigest.textContent = digests.profile;

  const point = getEffectivePoint();
  if (point) {
    const pinned = !state.hoverPoint && state.pinnedPoint;
    dom.linkedReadout.classList.add("is-live");
    const title = dom.linkedReadout.querySelector("strong");
    title.textContent = pinned
      ? `已固定 · X ${formatCoordinate(point.x)} / Z ${formatCoordinate(point.z)}`
      : `同步悬停 · X ${formatCoordinate(point.x)} / Z ${formatCoordinate(point.z)}`;
    dom.linkedElevation.textContent = formatElevation(point.elevation ?? point.y * 1000);
    dom.interactionNote.innerHTML = `<i></i><span>${pinned ? "高亮已固定，再次点击地形更新" : "3D 与剖面光标实时联动"}</span>`;
  } else {
    dom.linkedReadout.classList.remove("is-live");
    dom.linkedReadout.querySelector("strong").textContent = "悬停任一视图以联动高亮";
    dom.linkedElevation.textContent = "—";
    dom.interactionNote.innerHTML = "<i></i><span>将悬停点同步到剖面</span>";
  }

  dom.pauseIcon.textContent = state.playing ? "Ⅱ" : "▶";
  dom.pauseIcon.classList.toggle("is-paused", !state.playing);
  dom.pauseButton.title = state.playing ? "暂停动画" : "继续动画";
  dom.pauseButton.setAttribute("aria-label", state.playing ? "暂停动画" : "继续动画");
  dom.presetCount.textContent = String(state.presets.length);
  updateHistoryButtons();
  updateDirectionTabs();
}

function setSectionAngle(angle, options = {}) {
  return applySectionSettings({ angle }, options);
}

function resetView(options = {}) {
  if (options.history !== false) pushHistory("重置视角");
  state.camera = { ...DEFAULT_CAMERA };
  state.needsRender = true;
  renderNow();
  setStatus("视角已重置 · 剖面方向保持不变", true);
  return { ok: true, camera: deepClone(state.camera) };
}

function setCamera(nextCamera, options = {}) {
  if (options.history !== false) pushHistory(options.label || "视角变更", { coalesce: true });
  state.camera = normalizeCamera({ ...state.camera, ...nextCamera });
  state.needsRender = true;
  renderNow();
  return { ok: true, camera: deepClone(state.camera) };
}

function togglePause(force) {
  state.playing = typeof force === "boolean" ? force : !state.playing;
  state.lastFrameTime = performance.now();
  state.needsRender = true;
  renderNow();
  setStatus(state.playing ? "动画继续 · 时基已无缝续接" : "动画已冻结 · 几何与标注保持不变", true);
  showToast(state.playing ? "动画继续" : "动画已暂停");
  return { playing: state.playing, time: state.animationTime };
}

function togglePinAt(point) {
  if (!point) return;
  if (
    state.pinnedPoint &&
    Math.hypot(state.pinnedPoint.x - point.x, state.pinnedPoint.z - point.z) < 0.018
  ) {
    state.pinnedPoint = null;
    state.hoverPoint = null;
    state.cursorFraction = null;
    setStatus("已取消固定高亮");
  } else {
    state.pinnedPoint = {
      x: point.x,
      y: point.y,
      z: point.z,
      elevation: point.elevation ?? point.y * 1000,
    };
    ensureCursorForPoint(state.pinnedPoint);
    setStatus("高亮已固定 · 3D 与剖面同步", true);
  }
  state.needsRender = true;
  renderNow();
}

function pointerPosition(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function pickTerrainPoint(event) {
  const pointer = pointerPosition(event, dom.terrainCanvas);
  const projection = createProjection(state.camera, pointer.width, pointer.height, terrain.stats.peak.y);
  let best = null;
  let bestDistance = 34 * 34;
  for (const point of terrain.points) {
    const projected = projection.project(point);
    const dx = projected.x - pointer.x;
    const dy = projected.y - pointer.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        x: point.x,
        z: point.z,
        y: point.y,
        elevation: point.y * 1000,
        gridIndex: point.id,
      };
    }
  }
  return best;
}

function setHoverPoint(point) {
  state.hoverPoint = point;
  if (point) {
    state.cursorFraction = computeCursorFraction(point);
  } else {
    state.cursorFraction = state.pinnedPoint ? computeCursorFraction(state.pinnedPoint) : null;
  }
  state.needsRender = true;
  renderNow();
}

function setupTerrainInteraction() {
  dom.terrainCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const pointer = pointerPosition(event, dom.terrainCanvas);
    dom.terrainCanvas.setPointerCapture(event.pointerId);
    state.drag = {
      pointerId: event.pointerId,
      mode: event.button === 1 || event.button === 2 || event.shiftKey ? "pan" : "rotate",
      startX: event.clientX,
      startY: event.clientY,
      origin: deepClone(state.camera),
      moved: false,
      width: pointer.width,
      height: pointer.height,
      historyPushed: false,
    };
  });

  dom.terrainCanvas.addEventListener("pointermove", (event) => {
    if (state.drag?.pointerId === event.pointerId) {
      const dx = event.clientX - state.drag.startX;
      const dy = event.clientY - state.drag.startY;
      if (!state.drag.moved && Math.hypot(dx, dy) < 3) return;
      if (!state.drag.moved) {
        state.drag.moved = true;
        pushHistory(state.drag.mode === "rotate" ? "旋转视角" : "平移视角", { coalesce: true });
        state.drag.historyPushed = true;
      }
      if (state.drag.mode === "rotate") {
        state.camera = normalizeCamera({
          ...state.drag.origin,
          yaw: state.drag.origin.yaw + dx * 0.34,
          pitch: state.drag.origin.pitch - dy * 0.28,
        });
      } else {
        state.camera = normalizeCamera({
          ...state.drag.origin,
          panX: state.drag.origin.panX + dx / Math.max(1, state.drag.width),
          panY: state.drag.origin.panY + dy / Math.max(1, state.drag.height),
        });
      }
      state.needsRender = true;
      renderNow();
      return;
    }
    if (event.pointerType === "touch") return;
    setHoverPoint(pickTerrainPoint(event));
  });

  const finishPointer = (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const drag = state.drag;
    state.drag = null;
    if (dom.terrainCanvas.hasPointerCapture(event.pointerId)) {
      dom.terrainCanvas.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved && drag.mode === "rotate" && event.button === 0) {
      const point = pickTerrainPoint(event);
      if (point) togglePinAt(point);
    } else if (drag.moved) {
      setStatus(
        drag.mode === "rotate"
          ? `视角 YAW ${Math.round(state.camera.yaw)}° / EL ${Math.round(state.camera.pitch)}°`
          : "视角已平移 · 标注保持锚定",
        true,
      );
    }
  };
  dom.terrainCanvas.addEventListener("pointerup", finishPointer);
  dom.terrainCanvas.addEventListener("pointercancel", finishPointer);
  dom.terrainCanvas.addEventListener("pointerleave", () => {
    if (!state.drag && state.hoverPoint) setHoverPoint(null);
  });
  dom.terrainCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
  dom.terrainCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const oldZoom = state.camera.zoom;
      const nextZoom = Math.max(
        CAMERA_LIMITS.minZoom,
        Math.min(CAMERA_LIMITS.maxZoom, oldZoom * Math.exp(-event.deltaY * 0.00125)),
      );
      if (Math.abs(nextZoom - oldZoom) < 1e-5) return;
      pushHistory("缩放视角", { coalesce: true });
      const pointer = pointerPosition(event, dom.terrainCanvas);
      const oldOriginX = pointer.width / 2 + state.camera.panX * pointer.width;
      const oldOriginY = pointer.height * 0.52 + state.camera.panY * pointer.height;
      const scaleFactor = nextZoom / oldZoom;
      const nextOriginX = pointer.x - (pointer.x - oldOriginX) * scaleFactor;
      const nextOriginY = pointer.y - (pointer.y - oldOriginY) * scaleFactor;
      state.camera = normalizeCamera({
        ...state.camera,
        zoom: nextZoom,
        panX: (nextOriginX - pointer.width / 2) / pointer.width,
        panY: (nextOriginY - pointer.height * 0.52) / pointer.height,
      });
      state.needsRender = true;
      renderNow();
      setStatus(`缩放 ${state.camera.zoom.toFixed(2)}× · 标注锚点已重投影`, true);
    },
    { passive: false },
  );
  dom.terrainCanvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    resetView();
  });
}

function setupProfileInteraction() {
  dom.profileCanvas.addEventListener("pointermove", (event) => {
    const plot = state.lastProfileRender?.plot;
    if (!plot) return;
    const pointer = pointerPosition(event, dom.profileCanvas);
    if (
      pointer.x < plot.left - 4 ||
      pointer.x > plot.right + 4 ||
      pointer.y < plot.top - 8 ||
      pointer.y > plot.bottom + 8
    ) {
      if (state.hoverPoint) setHoverPoint(null);
      return;
    }
    const fraction = Math.max(0, Math.min(1, (pointer.x - plot.left) / plot.width));
    state.cursorFraction = fraction;
    state.hoverPoint = makePointFromFraction(fraction);
    state.needsRender = true;
    renderNow();
  });
  dom.profileCanvas.addEventListener("pointerleave", () => {
    if (state.hoverPoint) setHoverPoint(null);
  });
  dom.profileCanvas.addEventListener("click", () => {
    if (state.hoverPoint) togglePinAt(state.hoverPoint);
  });
}

function setupControls() {
  dom.seedInput.addEventListener("change", () => {
    applyParameterPatch({ seed: Number(dom.seedInput.value) });
  });
  dom.seedInput.addEventListener("input", () => {
    dom.seedInput.classList.remove("is-invalid");
    if (!dom.errorBanner.hidden) dom.errorBanner.hidden = true;
  });
  dom.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyParameterPatch({ seed: Number(dom.seedInput.value) });
      dom.seedInput.blur();
    }
  });

  dom.randomSeedButton.addEventListener("click", () => {
    const seed = Math.floor(Math.random() * 2147483647);
    const result = applyParameterPatch({ seed }, { label: "随机种子" });
    if (result.ok) showToast(`新种子 ${seed}`);
  });

  dom.ridgeInput.addEventListener("input", () => {
    dom.ridgeValue.textContent = `${Number(dom.ridgeInput.value).toFixed(2)}×`;
    applyParameterPatch(
      { ridgeHeight: Number(dom.ridgeInput.value) },
      { label: "山脊高度", coalesce: true },
    );
  });
  dom.ridgeInput.addEventListener("change", () => {
    setStatus(`山脊高度 ${Number(state.params.ridgeHeight).toFixed(2)}× · 双视图已同步`, true);
  });

  dom.resolutionInput.addEventListener("change", () => {
    applyParameterPatch(
      { resolution: Number(dom.resolutionInput.value) },
      { label: "网格精度" },
    );
  });

  const onAngleInput = () => {
    const result = applySectionSettings(
      { angle: Number(dom.angleInput.value) },
      { label: "剖面方向", coalesce: true },
    );
    if (result.ok) dom.angleValue.textContent = `${Math.round(state.sectionSettings.angle)}°`;
  };
  dom.angleInput.addEventListener("input", onAngleInput);

  const onOffsetInput = () => {
    const result = applySectionSettings(
      { offset: Number(dom.offsetInput.value) },
      { label: "剖线偏移", coalesce: true },
    );
    if (result.ok) dom.offsetValue.textContent = Number(state.sectionSettings.offset).toFixed(2);
  };
  dom.offsetInput.addEventListener("input", onOffsetInput);
  dom.compactOffset.addEventListener("input", () => {
    const result = applySectionSettings(
      { offset: Number(dom.compactOffset.value) },
      { label: "剖线偏移", coalesce: true },
    );
    if (result.ok) dom.compactOffsetValue.textContent = Number(state.sectionSettings.offset).toFixed(2);
  });

  for (const tab of document.querySelectorAll(".direction-tab")) {
    tab.addEventListener("click", () => {
      const cameraBefore = deepClone(state.camera);
      const result = setSectionAngle(Number(tab.dataset.angle), {
        label: `剖面方向 ${tab.textContent}`,
      });
      if (result.ok) {
        const preserved = JSON.stringify(cameraBefore) === JSON.stringify(state.camera);
        setStatus(
          `剖面方向 ${tab.textContent} · 相机${preserved ? "已保留" : "已更新"}`,
          true,
        );
      }
    });
  }

  dom.undoButton.addEventListener("click", undo);
  dom.pauseButton.addEventListener("click", () => togglePause());
  dom.resetViewButton.addEventListener("click", () => resetView());
  dom.dismissError.addEventListener("click", () => {
    dom.errorBanner.hidden = true;
    setStatus("错误提示已关闭 · 当前几何未受影响");
  });
  dom.exportButton.addEventListener("click", () => {
    const exported = exportSVG();
    downloadBlob(
      new Blob([exported.svg], { type: "image/svg+xml;charset=utf-8" }),
      `ridgeline-section-${state.params.seed}-${exported.structuralDigest}.svg`,
    );
    showToast(`SVG 已导出 · ${exported.points.length} 个剖面采样`);
    setStatus(`SVG 已导出 · ${exported.structuralDigest}`, true);
  });
  dom.screenshotButton.addEventListener("click", async () => {
    if (dom.screenshotButton.disabled) return;
    dom.screenshotButton.disabled = true;
    try {
      const dataURL = await captureScreenshot();
      downloadDataURL(
        dataURL,
        `ridgeline-${state.params.seed}-${getCurrentDigests().structural}.png`,
      );
      showToast("截图已生成 · 双视图与统计已合成");
      setStatus("截图已下载 · 包含屏幕预览、剖面和几何摘要", true);
    } catch (error) {
      showError(`截图失败：${error.message}`);
    } finally {
      dom.screenshotButton.disabled = false;
    }
  });

  dom.saveButton.addEventListener("click", openSaveDialog);
  dom.confirmSave.addEventListener("click", () => {
    const name = dom.presetName.value.trim() || defaultPresetName();
    const preset = savePreset(name);
    if (preset) {
      dom.presetDialog.close();
      renderPresetList();
      showToast(`参数已保存 · ${preset.name}`);
      setStatus(`快照已保存 · ${preset.geometryDigest} / ${preset.profileDigest}`, true);
    }
  });
  dom.cancelSave.addEventListener("click", () => dom.presetDialog.close());
  dom.libraryButton.addEventListener("click", () => {
    renderPresetList();
    dom.libraryDialog.showModal();
  });
  dom.closeLibrary.addEventListener("click", () => dom.libraryDialog.close());

  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName;
    const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (event.code === "Space" && !typing && !dom.presetDialog.open && !dom.libraryDialog.open) {
      event.preventDefault();
      togglePause();
    }
  });
}

function defaultPresetName() {
  return `Ridge ${state.params.seed} · ${Math.round(state.sectionSettings.angle)}°`;
}

function openSaveDialog() {
  dom.presetName.value = defaultPresetName();
  const digests = getCurrentDigests();
  dom.dialogMeshDigest.textContent = digests.geometry;
  dom.dialogProfileDigest.textContent = digests.profile;
  dom.presetDialog.showModal();
  window.setTimeout(() => {
    dom.presetName.focus();
    dom.presetName.select();
  }, 30);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function downloadDataURL(dataURL, filename) {
  const anchor = document.createElement("a");
  anchor.href = dataURL;
  anchor.download = filename;
  anchor.click();
}

function exportSVG() {
  const exported = createProfileSVG(terrain, section, {
    cursorFraction: state.cursorFraction,
  });
  state.lastSvg = exported;
  return exported;
}

async function captureScreenshot() {
  if (document.fonts?.ready) await document.fonts.ready;
  const exported = createScreenshotDataURL({
    terrain,
    section,
    camera: state.camera,
    time: state.animationTime,
    playing: state.playing,
    cursorFraction: state.cursorFraction,
    digests: getCurrentDigests(),
  });
  state.lastScreenshot = {
    ...exported,
    time: state.animationTime,
    revision: state.renderRevision,
    digests: getCurrentDigests(),
  };
  return exported.dataURL;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readPresetsFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((preset) => preset && preset.id && preset.snapshot);
  } catch {
    return [];
  }
}

function persistPresets() {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(state.presets));
    return true;
  } catch (error) {
    showError(`本机存储失败：${error.message}`);
    return false;
  }
}

function savePreset(name) {
  const snapshot = captureSnapshot(name);
  const digests = getCurrentDigests();
  const preset = {
    id: `ridge-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999).toString(36)}`,
    name: String(name).trim() || defaultPresetName(),
    savedAt: new Date().toISOString(),
    snapshot,
    snapshotDigest: digestString(JSON.stringify(snapshot)),
    geometryDigest: digests.geometry,
    profileDigest: digests.profile,
    renderOrderDigest: digests.renderOrder,
    structuralDigest: digests.structural,
    screenshotDigest: state.lastScreenshot?.pixelDigest ?? null,
    counts: deepClone(terrain.counts),
    peakElevation: terrain.stats.peak.elevation,
  };
  state.presets.push(preset);
  if (!persistPresets()) {
    state.presets.pop();
    return null;
  }
  updateInterface();
  return preset;
}

function deletePreset(id) {
  const index = state.presets.findIndex((preset) => preset.id === id);
  if (index < 0) return false;
  state.presets.splice(index, 1);
  persistPresets();
  updateInterface();
  renderPresetList();
  return true;
}

function loadPreset(idOrName) {
  const preset =
    state.presets.find((item) => item.id === idOrName) ||
    state.presets.find((item) => item.name === idOrName);
  if (!preset) return { ok: false, errors: ["未找到该快照"] };
  pushHistory(`载入 ${preset.name}`);
  const result = restoreSnapshot(preset.snapshot, { history: false });
  if (!result.ok) return result;
  state.lastPresetLoad = {
    presetId: preset.id,
    name: preset.name,
    savedSnapshotDigest: preset.snapshotDigest,
    currentSnapshotDigest: digestString(JSON.stringify(captureSnapshot(preset.name))),
    savedDigests: {
      geometry: preset.geometryDigest,
      profile: preset.profileDigest,
      renderOrder: preset.renderOrderDigest,
      structural: preset.structuralDigest,
    },
    currentDigests: getCurrentDigests(),
  };
  if (dom.libraryDialog.open) dom.libraryDialog.close();
  renderPresetList();
  setStatus(
    `快照已载入 · ${preset.geometryDigest} / ${preset.profileDigest} · 相机与剖面已恢复`,
    true,
  );
  showToast(`已载入「${preset.name}」`);
  return {
    ok: true,
    preset,
    ...state.lastPresetLoad,
  };
}

function renderPresetList() {
  dom.presetCount.textContent = String(state.presets.length);
  dom.libraryEmpty.hidden = state.presets.length > 0;
  if (!state.presets.length) {
    dom.presetList.innerHTML = "";
    return;
  }
  dom.presetList.innerHTML = state.presets
    .slice()
    .reverse()
    .map((preset) => {
      return `<div class="preset-item" data-id="${escapeHtml(preset.id)}">
        <div class="preset-copy">
          <strong>${escapeHtml(preset.name)}</strong>
          <span>SEED ${preset.snapshot.params.seed} · RIDGE ${Number(preset.snapshot.params.ridgeHeight).toFixed(2)} · ${Math.round(preset.snapshot.sectionSettings.angle)}° · ${preset.geometryDigest} / ${preset.profileDigest}</span>
        </div>
        <button class="preset-load" type="button" data-load="${escapeHtml(preset.id)}">载入</button>
        <button class="preset-delete" type="button" data-delete="${escapeHtml(preset.id)}" aria-label="删除快照">×</button>
      </div>`;
    })
    .join("");
  for (const button of dom.presetList.querySelectorAll("[data-load]")) {
    button.addEventListener("click", () => loadPreset(button.dataset.load));
  }
  for (const button of dom.presetList.querySelectorAll("[data-delete]")) {
    button.addEventListener("click", () => deletePreset(button.dataset.delete));
  }
}

function getGeometryState(includePositions = true) {
  return {
    params: deepClone(terrain.params),
    counts: deepClone(terrain.counts),
    stats: deepClone(terrain.stats),
    geometryDigest: terrain.geometryDigest,
    profileDigest: section.profileDigest,
    section: {
      angle: section.angle,
      offset: section.offset,
      lengthMeters: section.lengthMeters,
      samples: section.samples.length,
      line: deepClone(section.line),
      maxSample: deepClone(section.maxSample),
    },
    points: includePositions
      ? terrain.points.map((point) => ({
          id: point.id,
          ix: point.ix,
          iz: point.iz,
          x: point.x,
          y: point.y,
          z: point.z,
        }))
      : undefined,
    profilePoints: includePositions
      ? section.samples.map((sample) => ({
          id: sample.id,
          t: sample.t,
          x: sample.x,
          y: sample.y,
          z: sample.z,
          elevation: sample.elevation,
        }))
      : undefined,
  };
}

function getSceneSummary() {
  return {
    state: {
      params: deepClone(state.params),
      sectionSettings: deepClone(state.sectionSettings),
      camera: deepClone(state.camera),
      playing: state.playing,
      animationTime: state.animationTime,
      cursorFraction: state.cursorFraction,
      pinnedPoint: deepClone(state.pinnedPoint),
      historyLength: state.history.length,
      redoLength: state.redo.length,
    },
    geometry: {
      counts: deepClone(terrain.counts),
      stats: deepClone(terrain.stats),
      sectionCounts: deepClone(section.counts),
    },
    digests: getCurrentDigests(),
    render: state.lastRender
      ? {
          objectCounts: deepClone(state.lastRender.objectCounts),
          renderOrderDigest: state.lastRender.renderOrderDigest,
          drawCalls: state.lastRender.drawCalls,
          anchors: deepClone(state.lastRender.anchors),
          layerOrder: [
            "background",
            "base-grid",
            "terrain-shadow",
            "terrain-cells+contours",
            "section-trace",
            "section-endpoints",
            "peak-marker",
            "hover-marker",
            "peak-label",
            "compass",
          ],
        }
      : null,
    profileRender: state.lastProfileRender
      ? {
          plot: deepClone(state.lastProfileRender.plot),
          yMax: state.lastProfileRender.yMax,
          anchors: deepClone(state.lastProfileRender.anchors),
        }
      : null,
  };
}

function setupResize() {
  const rerender = () => {
    state.needsRender = true;
    renderNow();
  };
  const observer = new ResizeObserver(() => {
    state.needsRender = true;
    if (!state.playing) renderNow();
  });
  observer.observe(dom.terrainFrame);
  observer.observe(dom.profileFrame);
  window.addEventListener("orientationchange", rerender);
}

let lastPaint = 0;
function animationLoop(now) {
  const delta = Math.min(0.05, Math.max(0, (now - state.lastFrameTime) / 1000));
  state.lastFrameTime = now;
  if (state.playing) {
    state.animationTime += delta;
    if (now - lastPaint >= 32) {
      renderNow();
      lastPaint = now;
    }
  } else if (state.needsRender) {
    renderNow();
    lastPaint = now;
  }
  requestAnimationFrame(animationLoop);
}

function initialize() {
  state.presets = readPresetsFromStorage();
  syncControlsFromState();
  setupTerrainInteraction();
  setupProfileInteraction();
  setupControls();
  setupResize();
  renderPresetList();
  renderNow();
  requestAnimationFrame((now) => {
    state.lastFrameTime = now;
    lastPaint = now;
    requestAnimationFrame(animationLoop);
  });
}

window.TerrainLab = {
  getState: () => getSceneSummary(),
  setParams: (patch, options = {}) =>
    applyParameterPatch(patch, { history: options.history ?? false, label: options.label }),
  setSection: (settings, options = {}) =>
    applySectionSettings(settings, { history: options.history ?? false, label: options.label }),
  switchDirection: (angle) => setSectionAngle(angle, { history: false }),
  setCamera: (camera, options = {}) =>
    setCamera(camera, { history: options.history ?? false, label: options.label }),
  resetCamera: () => resetView({ history: false }),
  recompute: () => rebuildTerrain(state.params, { history: false, label: "强制重算" }),
  undo,
  redo,
  pause: () => togglePause(false),
  resume: () => togglePause(true),
  isPaused: () => !state.playing,
  getAnimationState: () => ({
    playing: state.playing,
    time: state.animationTime,
    renderRevision: state.renderRevision,
    needsRender: state.needsRender,
  }),
  getGeometry: (includePositions = true) => getGeometryState(includePositions),
  getDigests: () => getCurrentDigests(),
  getStats: () => deepClone(terrain.stats),
  getCounts: () => deepClone(terrain.counts),
  getCamera: () => deepClone(state.camera),
  getProjectedPoint: (point) => {
    const metrics = getCanvasMetrics(dom.terrainCanvas);
    const projection = createProjection(state.camera, metrics.width, metrics.height, terrain.stats.peak.y);
    return projection.project(point);
  },
  getRenderDiagnostics: () =>
    state.lastRender
      ? {
          objectCounts: deepClone(state.lastRender.objectCounts),
          renderOrderDigest: state.lastRender.renderOrderDigest,
          drawCalls: state.lastRender.drawCalls,
          anchors: deepClone(state.lastRender.anchors),
          camera: deepClone(state.lastRender.camera),
        }
      : null,
  getLabelAnchors: () =>
    state.lastRender
      ? {
          peak: deepClone(state.lastRender.anchors.peak),
          highlight: deepClone(state.lastRender.anchors.highlight),
        }
      : null,
  getUIState: () => ({
    peakText: dom.peakElevation.textContent,
    meshText: dom.meshCount.textContent,
    sectionPeakText: dom.sectionPeak.textContent,
    errorVisible: !dom.errorBanner.hidden,
    errorMessage: dom.errorMessage.textContent,
    linkedText: dom.linkedReadout.querySelector("strong").textContent,
    linkedElevation: dom.linkedElevation.textContent,
    status: dom.statusMessage.textContent,
    yaw: dom.yawReadout.textContent,
    zoom: dom.zoomReadout.textContent,
    previewSize: {
      terrain: [dom.terrainCanvas.width, dom.terrainCanvas.height],
      profile: [dom.profileCanvas.width, dom.profileCanvas.height],
    },
  }),
  getCanvasPreview: () => {
    const terrainURL = dom.terrainCanvas.toDataURL("image/png");
    const profileURL = dom.profileCanvas.toDataURL("image/png");
    return {
      terrainURL,
      profileURL,
      terrainDigest: digestString(terrainURL),
      profileDigest: digestString(profileURL),
    };
  },
  exportSVG: () => exportSVG(),
  exportSVGString: () => exportSVG().svg,
  captureScreenshot: async () => captureScreenshot(),
  getLastScreenshot: () => deepClone(state.lastScreenshot ?? null),
  savePreset: (name) => savePreset(name),
  loadPreset: (idOrName) => loadPreset(idOrName),
  getPresets: () => deepClone(state.presets),
  getLastPresetLoad: () => deepClone(state.lastPresetLoad ?? null),
  deletePreset: (id) => deletePreset(id),
  getPresetStorageKey: () => PRESET_KEY,
  getBuildCount: () => state.buildCount,
  getRenderRevision: () => state.renderRevision,
  clearError: () => clearError(),
  hoverFraction: (fraction) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    state.cursorFraction = clamped;
    state.hoverPoint = makePointFromFraction(clamped);
    state.needsRender = true;
    renderNow();
    return deepClone(state.hoverPoint);
  },
  pinFraction: (fraction) => {
    const clamped = Math.max(0, Math.min(1, fraction));
    const point = makePointFromFraction(clamped);
    if (state.hoverPoint) togglePinAt(state.hoverPoint);
    else {
      state.pinnedPoint = { ...point, elevation: point.y * 1000 };
      state.cursorFraction = clamped;
      state.needsRender = true;
      renderNow();
    }
    return deepClone(state.pinnedPoint);
  },
  clearHighlight: () => {
    state.hoverPoint = null;
    state.pinnedPoint = null;
    state.cursorFraction = null;
    state.needsRender = true;
    renderNow();
  },
};

initialize();
