import {
  LAST_PATCH_KEY,
  PATCH_VERSION,
  STORAGE_KEY,
  clonePatch,
  normalizePatch,
} from "./model.js";

export function readPatchStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writePatchStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function savePatch(patch) {
  const normalized = normalizePatch(clonePatch(patch));
  const name = normalized.name.trim().toUpperCase() || "UNTITLED";
  const store = readPatchStore();
  store[name] = {
    ...normalized,
    name,
    version: PATCH_VERSION,
    savedAt: new Date().toISOString(),
  };
  writePatchStore(store);
  localStorage.setItem(LAST_PATCH_KEY, name);
  return { name, patch: normalizePatch(store[name]), savedAt: store[name].savedAt };
}

export function loadPatch(name) {
  const store = readPatchStore();
  if (!store[name]) return null;
  const patch = normalizePatch(clonePatch(store[name]));
  localStorage.setItem(LAST_PATCH_KEY, name);
  return patch;
}

export function removePatch(name) {
  const store = readPatchStore();
  if (!store[name]) return;
  delete store[name];
  writePatchStore(store);
}

export function listPatches() {
  return Object.entries(readPatchStore())
    .map(([name, patch]) => ({
      name,
      savedAt: patch.savedAt || "",
      bpm: Number(patch.bpm) || 112,
    }))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

export function lastPatchName() {
  return localStorage.getItem(LAST_PATCH_KEY) || "";
}

export function patchToJson(patch) {
  return JSON.stringify(normalizePatch(patch), null, 2);
}
