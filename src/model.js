export const MATERIALS = {
  ceramic: {
    id: "ceramic",
    name: "釉面瓷",
    latin: "PORCELAIN",
    base: [216, 200, 172],
    roughness: 0.34,
    specular: 0.9,
    world: { x: -1.3, y: -0.12, z: 0.02 },
    radius: 0.66,
    accent: "#f0c88e"
  },
  metal: {
    id: "metal",
    name: "拉丝钛",
    latin: "TITANIUM",
    base: [126, 145, 151],
    roughness: 0.12,
    specular: 1.72,
    world: { x: 0, y: -0.05, z: -0.08 },
    radius: 0.7,
    accent: "#b7d1d7"
  },
  resin: {
    id: "resin",
    name: "琥珀树脂",
    latin: "AMBER RESIN",
    base: [193, 112, 65],
    roughness: 0.56,
    specular: 0.7,
    world: { x: 1.3, y: -0.17, z: 0.04 },
    radius: 0.64,
    accent: "#dea06c"
  }
};

export const MATERIAL_ORDER = ["ceramic", "metal", "resin"];

export const LIMITS = {
  roughness: [0, 1],
  azimuth: [0, 360],
  elevation: [-5, 80],
  intensity: [0.1, 3],
  yaw: [-180, 180],
  pitch: [-12, 30],
  zoom: [0.75, 1.4]
};

export const DEFAULT_SETTINGS = {
  selected: "ceramic",
  roughness: {
    ceramic: 0.34,
    metal: 0.12,
    resin: 0.56
  },
  lights: {
    A: { azimuth: 308, elevation: 39, intensity: 1.65 },
    B: { azimuth: 52, elevation: 31, intensity: 1.25 }
  },
  camera: { yaw: 0, pitch: 3, zoom: 1 },
  autoOrbit: true,
  paused: false
};

export const SCENARIOS = {
  default: structuredClone(DEFAULT_SETTINGS),
  extreme: {
    selected: "metal",
    roughness: { ceramic: 0.97, metal: 0.01, resin: 0.93 },
    lights: {
      A: { azimuth: 352, elevation: 68, intensity: 2.8 },
      B: { azimuth: 184, elevation: 5, intensity: 0.18 }
    },
    camera: { yaw: 73, pitch: 23, zoom: 1.32 },
    autoOrbit: false,
    paused: true
  },
  anomaly: {
    selected: "unknown-material",
    roughness: { ceramic: 2.4, metal: -0.8, resin: "不是数字" },
    lights: {
      A: { azimuth: 999, elevation: -80, intensity: -2 },
      B: { azimuth: "NaN", elevation: 92, intensity: 9 }
    },
    camera: { yaw: 540, pitch: -90, zoom: 99 },
    autoOrbit: true,
    paused: true
  }
};

export const LAYER_ORDER = [
  "background",
  "light-rays",
  "glass-back",
  "shadows",
  "platforms",
  "specimens",
  "glass-front",
  "annotations",
  "light-handles"
];

export function clone(value) {
  return structuredClone(value);
}

export function mergeSettings(base, patch) {
  const merged = clone(base);
  if (!patch || typeof patch !== "object") return merged;
  for (const key of ["selected", "autoOrbit", "paused"]) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  for (const key of ["roughness", "lights", "camera"]) {
    if (!patch[key] || typeof patch[key] !== "object") continue;
    for (const [childKey, value] of Object.entries(patch[key])) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        merged[key][childKey] = { ...(merged[key][childKey] || {}), ...value };
      } else {
        merged[key][childKey] = value;
      }
    }
  }
  return merged;
}

function numeric(value, fallback, min, max, label, issues) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    issues.push(`${label} 不是有效数字，已恢复为 ${fallback}`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    const clamped = Math.min(max, Math.max(min, parsed));
    issues.push(`${label} ${formatNumber(parsed)} 超出 ${formatNumber(min)}–${formatNumber(max)}，已修正为 ${formatNumber(clamped)}`);
    return clamped;
  }
  return parsed;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function normalizeSettings(input, fallback = DEFAULT_SETTINGS) {
  const issues = [];
  const merged = mergeSettings(fallback, input);
  const selected = MATERIALS[merged.selected] ? merged.selected : "ceramic";
  if (selected !== merged.selected) {
    issues.push(`未知材质「${String(merged.selected)}」，已切换到釉面瓷`);
  }

  const roughness = {};
  for (const id of MATERIAL_ORDER) {
    roughness[id] = numeric(
      merged.roughness?.[id],
      DEFAULT_SETTINGS.roughness[id],
      LIMITS.roughness[0],
      LIMITS.roughness[1],
      `${MATERIALS[id].name}粗糙度`,
      issues
    );
  }

  const lights = {};
  for (const id of ["A", "B"]) {
    const source = merged.lights?.[id] || {};
    const defaults = DEFAULT_SETTINGS.lights[id];
    lights[id] = {
      azimuth: numeric(source.azimuth, defaults.azimuth, LIMITS.azimuth[0], LIMITS.azimuth[1], `灯光 ${id} 方位`, issues),
      elevation: numeric(source.elevation, defaults.elevation, LIMITS.elevation[0], LIMITS.elevation[1], `灯光 ${id} 高度`, issues),
      intensity: numeric(source.intensity, defaults.intensity, LIMITS.intensity[0], LIMITS.intensity[1], `灯光 ${id} 强度`, issues)
    };
  }

  const camera = {
    yaw: numeric(merged.camera?.yaw, DEFAULT_SETTINGS.camera.yaw, LIMITS.yaw[0], LIMITS.yaw[1], "相机环绕", issues),
    pitch: numeric(merged.camera?.pitch, DEFAULT_SETTINGS.camera.pitch, LIMITS.pitch[0], LIMITS.pitch[1], "相机俯仰", issues),
    zoom: numeric(merged.camera?.zoom, DEFAULT_SETTINGS.camera.zoom, LIMITS.zoom[0], LIMITS.zoom[1], "相机缩放", issues)
  };

  return {
    settings: {
      selected,
      roughness,
      lights,
      camera,
      autoOrbit: Boolean(merged.autoOrbit),
      paused: Boolean(merged.paused)
    },
    issues
  };
}

export function lightWorldPosition(light) {
  const distance = 2.15;
  const azimuth = (light.azimuth * Math.PI) / 180;
  const elevation = (light.elevation * Math.PI) / 180;
  return {
    x: Math.sin(azimuth) * Math.cos(elevation) * distance,
    y: 0.2 + Math.sin(elevation) * distance,
    z: -Math.cos(azimuth) * Math.cos(elevation) * distance
  };
}

export function createProjector(settings, viewport, orbitAngle = 0) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const yaw = ((settings.camera.yaw + orbitAngle) * Math.PI) / 180;
  const pitch = (settings.camera.pitch * Math.PI) / 180;
  const focal = Math.min(width, height) * 1.24 * settings.camera.zoom;
  const cameraDistance = 6.55;
  const targetY = 0.04;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  function view(point) {
    const x = point.x * cosYaw + point.z * sinYaw;
    const z0 = -point.x * sinYaw + point.z * cosYaw;
    return {
      x,
      y: point.y * cosPitch - z0 * sinPitch,
      z: point.y * sinPitch + z0 * cosPitch
    };
  }

  function project(point) {
    const rotated = view(point);
    const depth = cameraDistance + rotated.z;
    const scale = focal / Math.max(0.2, depth);
    return {
      x: width * 0.5 + rotated.x * scale,
      y: height * 0.535 - (rotated.y - targetY) * scale,
      depth,
      scale
    };
  }

  return {
    width,
    height,
    focal,
    cameraDistance,
    yaw: (yaw * 180) / Math.PI,
    pitch: settings.camera.pitch,
    project,
    view
  };
}

export function buildGeometry(settings, viewport, orbitAngle = 0) {
  const projector = createProjector(settings, viewport, orbitAngle);
  const spheres = MATERIAL_ORDER.map((id, index) => {
    const material = MATERIALS[id];
    const center = projector.project(material.world);
    center.x = round(center.x);
    center.y = round(center.y);
    center.depth = round(center.depth);
    const radius = round((material.radius * projector.focal) / center.depth);
    const labelPoint = projector.project({
      x: material.world.x,
      y: material.world.y + material.radius + 0.16,
      z: material.world.z
    });
    return {
      id,
      index,
      material: material.name,
      roughness: round(settings.roughness[id]),
      world: { ...material.world },
      worldRadius: material.radius,
      labelWorld: {
        x: material.world.x,
        y: material.world.y + material.radius + 0.16,
        z: material.world.z
      },
      center,
      radius,
      label: { x: round(labelPoint.x), y: round(labelPoint.y) },
      depthRank: 0
    };
  });

  [...spheres].sort((a, b) => b.center.depth - a.center.depth).forEach((sphere, rank) => {
    sphere.depthRank = rank;
  });

  const lights = ["A", "B"].map((id) => {
    const light = settings.lights[id];
    const world = lightWorldPosition(light);
    const screen = projector.project(world);
    return {
      id,
      world: { x: round(world.x), y: round(world.y), z: round(world.z) },
      screen: { x: round(screen.x), y: round(screen.y), depth: round(screen.depth) },
      azimuth: round(light.azimuth),
      elevation: round(light.elevation),
      intensity: round(light.intensity)
    };
  });

  const yawRadians = (projector.yaw * Math.PI) / 180;
  const right = { x: Math.cos(yawRadians), z: Math.sin(yawRadians) };
  const domeBottom = projector.project({ x: 0, y: -0.83, z: 0 });
  const domeLeft = projector.project({
    x: -right.x * 2.35,
    y: -0.83,
    z: -right.z * 2.35
  });
  const domeRight = projector.project({
    x: right.x * 2.35,
    y: -0.83,
    z: right.z * 2.35
  });
  const domeTop = projector.project({ x: 0, y: 2.1, z: 0 });
  const dome = {
    centerX: round((domeLeft.x + domeRight.x) / 2),
    centerY: round(domeBottom.y),
    radiusX: round(Math.abs((domeRight.x - domeLeft.x) / 2)),
    radiusY: round(Math.abs(domeBottom.y - domeTop.y))
  };

  return {
    objectCount: 6,
    sphereCount: 3,
    lightCount: 2,
    domeCount: 1,
    layers: [...LAYER_ORDER],
    viewport: { width: projector.width, height: projector.height },
    camera: {
      yaw: round(projector.yaw),
      pitch: round(projector.pitch),
      zoom: round(settings.camera.zoom),
      focal: round(projector.focal)
    },
    spheres,
    lights,
    dome
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

export function fnv1a(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function geometryDigest(geometry) {
  return fnv1a(
    JSON.stringify({
      objectCount: geometry.objectCount,
      layers: geometry.layers,
      camera: geometry.camera,
      spheres: geometry.spheres,
      lights: geometry.lights,
      dome: geometry.dome
    })
  );
}
