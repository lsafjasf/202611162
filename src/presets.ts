import { cloneParams, defaultParams, validateParams } from "./params";
import type { ViewParams } from "./types";

const STORAGE_KEY = "polyhedral-relic.presets.v1";

export interface SavedPreset {
  name: string;
  params: ViewParams;
  geometryDigest: string;
  savedAt: string;
}

function readAll(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedPreset => {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Partial<SavedPreset>;
      return (
        typeof candidate.name === "string" &&
        typeof candidate.geometryDigest === "string" &&
        typeof candidate.savedAt === "string" &&
        typeof candidate.params === "object" &&
        candidate.params !== null
      );
    });
  } catch {
    return [];
  }
}

export function listPresets(): SavedPreset[] {
  return readAll().sort((first, second) => first.name.localeCompare(second.name));
}

export function savePreset(
  name: string,
  params: ViewParams,
  geometryDigest: string
): SavedPreset {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Preset name cannot be empty.");
  const preset: SavedPreset = {
    name: trimmed,
    params: cloneParams(params),
    geometryDigest,
    savedAt: new Date().toISOString()
  };
  const presets = readAll().filter((entry) => entry.name !== trimmed);
  presets.push(preset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return preset;
}

export function loadPreset(name: string): SavedPreset {
  const preset = readAll().find((entry) => entry.name === name);
  if (!preset) throw new Error(`Preset "${name}" was not found.`);
  const params = validateParams(preset.params, defaultParams());
  return { ...preset, params };
}

export function clearPresets(): void {
  localStorage.removeItem(STORAGE_KEY);
}
