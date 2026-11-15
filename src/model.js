export const TRACK_DEFS = [
  {
    id: "kick",
    name: "KICK",
    cn: "底鼓",
    color: "#ff6b46",
    tune: { min: 34, max: 92, step: 1, default: 52, unit: "Hz" },
    decay: { min: 120, max: 900, step: 5, default: 420, unit: "ms" },
    defaultPan: 0,
    defaultLevel: 92,
  },
  {
    id: "snare",
    name: "SNARE",
    cn: "军鼓",
    color: "#ffc34d",
    tune: { min: 120, max: 360, step: 2, default: 186, unit: "Hz" },
    decay: { min: 60, max: 520, step: 5, default: 205, unit: "ms" },
    defaultPan: 4,
    defaultLevel: 76,
  },
  {
    id: "hat",
    name: "HI-HAT",
    cn: "踩镲",
    color: "#86e8c2",
    tune: { min: 3200, max: 12000, step: 50, default: 7200, unit: "Hz" },
    decay: { min: 18, max: 240, step: 1, default: 62, unit: "ms" },
    defaultPan: 22,
    defaultLevel: 52,
  },
  {
    id: "clap",
    name: "CLAP",
    cn: "拍手",
    color: "#bca2ff",
    tune: { min: 450, max: 2600, step: 10, default: 1180, unit: "Hz" },
    decay: { min: 80, max: 520, step: 5, default: 235, unit: "ms" },
    defaultPan: -18,
    defaultLevel: 58,
  },
];

export const STEP_COUNT = 16;
export const PATCH_VERSION = 2;
export const STORAGE_KEY = "grain16.patches.v2";
export const LAST_PATCH_KEY = "grain16.lastPatch.v2";

const DEFAULT_NOTES = {
  kick: [
    [0, 122, 100],
    [3, 61, 48],
    [6, 105, 100],
    [8, 118, 100],
    [11, 64, 34],
    [14, 96, 100],
  ],
  snare: [
    [4, 123, 100],
    [7, 38, 22],
    [12, 120, 100],
    [15, 52, 38],
  ],
  hat: [
    [0, 76, 100],
    [1, 34, 58],
    [2, 49, 84],
    [3, 31, 42],
    [4, 82, 100],
    [5, 37, 65],
    [6, 51, 90],
    [7, 34, 46],
    [8, 73, 100],
    [9, 35, 62],
    [10, 48, 82],
    [11, 30, 40],
    [12, 85, 100],
    [13, 38, 70],
    [14, 53, 92],
    [15, 36, 50],
  ],
  clap: [
    [4, 72, 86],
    [7, 36, 18],
    [12, 80, 100],
    [15, 42, 28],
  ],
};

function makeSteps(notes) {
  const map = new Map(notes.map(([index, velocity, probability]) => [
    index,
    { on: true, velocity, probability },
  ]));
  return Array.from({ length: STEP_COUNT }, (_, index) =>
    map.get(index) ?? { on: false, velocity: 90, probability: 100 },
  );
}

export function createDefaultPatch() {
  const tracks = {};
  for (const def of TRACK_DEFS) {
    tracks[def.id] = {
      tune: def.tune.default,
      decay: def.decay.default,
      pan: def.defaultPan,
      level: def.defaultLevel,
      mute: false,
      steps: makeSteps(DEFAULT_NOTES[def.id]),
    };
  }
  return normalizePatch({
    version: PATCH_VERSION,
    name: "NIGHT SHIFT",
    bpm: 112,
    master: 80,
    seed: 0x51f15e,
    tracks,
  });
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));
}

function sanitizeStep(raw) {
  return {
    on: Boolean(raw?.on),
    velocity: Math.round(clamp(raw?.velocity ?? 90, 1, 127)),
    probability: Math.round(clamp(raw?.probability ?? 100, 0, 100)),
  };
}

export function normalizePatch(raw) {
  const fallback = createDefaultPatchWithoutNormalize();
  const patch = raw && typeof raw === "object" ? raw : fallback;
  const tracks = {};
  for (const def of TRACK_DEFS) {
    const source = patch.tracks?.[def.id] ?? {};
    const incomingSteps = Array.isArray(source.steps) ? source.steps : [];
    tracks[def.id] = {
      tune: Math.round(clamp(source.tune ?? def.tune.default, def.tune.min, def.tune.max)),
      decay: Math.round(clamp(source.decay ?? def.decay.default, def.decay.min, def.decay.max)),
      pan: Math.round(clamp(source.pan ?? def.defaultPan, -100, 100)),
      level: Math.round(clamp(source.level ?? def.defaultLevel, 0, 120)),
      mute: Boolean(source.mute),
      steps: Array.from({ length: STEP_COUNT }, (_, index) =>
        sanitizeStep(incomingSteps[index]),
      ),
    };
  }
  return {
    version: PATCH_VERSION,
    name: String(patch.name || "UNTITLED").slice(0, 28).toUpperCase(),
    bpm: Math.round(clamp(patch.bpm ?? 112, 40, 220)),
    master: Math.round(clamp(patch.master ?? 80, 0, 100)),
    seed: Number.isFinite(Number(patch.seed)) ? Number(patch.seed) >>> 0 : 0x51f15e,
    tracks,
  };
}

function createDefaultPatchWithoutNormalize() {
  const tracks = {};
  for (const def of TRACK_DEFS) {
    tracks[def.id] = {
      tune: def.tune.default,
      decay: def.decay.default,
      pan: def.defaultPan,
      level: def.defaultLevel,
      mute: false,
      steps: makeSteps(DEFAULT_NOTES[def.id]),
    };
  }
  return {
    version: PATCH_VERSION,
    name: "NIGHT SHIFT",
    bpm: 112,
    master: 80,
    seed: 0x51f15e,
    tracks,
  };
}

export function clonePatch(patch) {
  return JSON.parse(JSON.stringify(patch));
}

export function trackDefinition(id) {
  return TRACK_DEFS.find((track) => track.id === id) ?? TRACK_DEFS[0];
}

export function seededRandom(seed, trackIndex, step, cycle, voice) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  value ^= Math.imul(trackIndex + 1, 0x85ebca6b);
  value ^= Math.imul(step + 11, 0xc2b2ae35);
  value ^= Math.imul(cycle + 1, 0x27d4eb2f);
  value ^= Math.imul(voice + 3, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  value = Math.imul(value, 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}

export function noiseSample(seed, index) {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return ((value >>> 0) / 2147483648) - 1;
}

export function panLabel(value) {
  if (Math.abs(value) < 2) return "CENTER";
  return `${value < 0 ? "L" : "R"} ${Math.abs(value)}`;
}
