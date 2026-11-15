export const DEFAULT_SEED = 20261116;
export const WORLD_WIDTH = 3340;
export const WORLD_HEIGHT = 690;
export const START_X = 128;

const SAMPLE_STEP = 20;

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function formatSignature(signature) {
  return `${signature.slice(0, 4)}-${signature.slice(4)}`.toUpperCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function curveValue(points, x) {
  const position = clamp(x, 0, WORLD_WIDTH) / SAMPLE_STEP;
  const left = Math.floor(position);
  const right = Math.min(points.length - 1, left + 1);
  const mix = position - left;
  return points[left] + (points[right] - points[left]) * mix;
}

function buildControlCurve(random, base, spread, modifier) {
  const controls = [];
  const segments = 23;
  for (let index = 0; index <= segments; index += 1) {
    const x = (index / segments) * WORLD_WIDTH;
    let value = base + (random() - 0.5) * spread;
    if (modifier) {
      value += modifier(x);
    }
    controls.push(value);
  }

  const points = [];
  for (let x = 0; x <= WORLD_WIDTH; x += SAMPLE_STEP) {
    const position = x / WORLD_WIDTH * segments;
    const index = Math.min(segments - 1, Math.floor(position));
    const mix = smoothstep(position - index);
    points.push(controls[index] + (controls[index + 1] - controls[index]) * mix);
  }
  return points;
}

function gateBump(x, start, end, amount) {
  if (x < start || x > end) {
    return 0;
  }
  const middle = (start + end) / 2;
  const half = (end - start) / 2;
  return (1 - Math.abs(x - middle) / half) * amount;
}

function makeHazard(id, label, start, end, tone) {
  return { id, label, start, end, tone };
}

export function generateWorld(seed = DEFAULT_SEED) {
  const normalizedSeed = seed >>> 0;
  const random = mulberry32(normalizedSeed);

  const gate = {
    id: "ceiling-gate",
    label: "钟乳石隘口",
    start: 1190,
    end: 1490,
  };
  const shallow = makeHazard(
    "gravel-shallows",
    "碎石浅滩",
    1940,
    2072,
    "amber",
  );
  const whirlpool = makeHazard(
    "return-current",
    "回旋暗流",
    2460,
    2700,
    "coral",
  );

  const ceiling = buildControlCurve(
    random,
    142,
    72,
    (x) => gateBump(x, gate.start, gate.end, 104),
  );
  const floor = buildControlCurve(random, 594, 62, (x) => {
    return gateBump(x, shallow.start, shallow.end, -12);
  });
  const water = buildControlCurve(random, 412, 18, (x) => {
    return Math.sin(x * 0.0048) * 7;
  });

  const crateBases = [714, 1608, 2362];
  const cargoNames = ["潮汐样本", "测绘电芯", "密封补给"];
  const massProfile = [1.04, 2.32, 0.63];
  const heavySide = random() > 0.5 ? 1 : -1;
  const slotPattern = [0, -heavySide, heavySide];
  const crates = crateBases.map((base, index) => {
    const x = Math.round(base + (random() - 0.5) * 72);
    return {
      id: `cargo-${index + 1}`,
      name: cargoNames[index],
      index,
      x,
      y: Math.round(curveValue(water, x) + 12),
      mass: Number((massProfile[index] + (random() - 0.5) * 0.14).toFixed(3)),
      slot: slotPattern[index],
      pickupRadius: 39,
    };
  });

  const stalactites = [];
  const stalactiteCount = 23;
  for (let index = 0; index < stalactiteCount; index += 1) {
    let x = 260 + random() * (WORLD_WIDTH - 520);
    const inGate = x > gate.start + 30 && x < gate.end - 20;
    if (inGate && index % 2 === 0) {
      x = gate.start + 45 + random() * (gate.end - gate.start - 75);
    }
    const width = 9 + random() * 19 + (inGate ? 5 : 0);
    const baseY = curveValue(ceiling, x);
    const desiredBottom =
      baseY + 30 + random() * 86 + (inGate ? 55 + random() * 46 : 0);
    const bottom = Math.min(
      desiredBottom,
      curveValue(water, x) - 51 - random() * 14,
    );
    stalactites.push({
      id: `stalactite-${index + 1}`,
      x: Math.round(x),
      width: Math.round(width),
      top: Math.round(baseY - 2),
      bottom: Math.round(bottom),
      gate: inGate,
    });
  }
  const gateColumns = [1264, 1338, 1416];
  for (const [index, x] of gateColumns.entries()) {
    const baseY = curveValue(ceiling, x);
    const bottom = Math.min(
      baseY + 92 + random() * 24,
      curveValue(water, x) - 56 - random() * 10,
    );
    stalactites.push({
      id: `gate-stalactite-${index + 1}`,
      x,
      width: Math.round(17 + random() * 8),
      top: Math.round(baseY - 2),
      bottom: Math.round(bottom),
      gate: true,
    });
  }
  stalactites.sort((left, right) => left.x - right.x);

  const currentSpecs = [
    { start: 820, end: 1060, force: -24, phase: 0.2, label: "逆向水流" },
    { start: 1710, end: 1910, force: 28, phase: 1.4, label: "顺流推力" },
    { start: whirlpool.start, end: whirlpool.end, force: -34, phase: 2.7, label: "回旋暗流" },
    { start: 2830, end: 2960, force: 19, phase: 4.1, label: "尾流" },
  ];
  const currents = currentSpecs.map((zone, index) => ({
    id: `current-${index + 1}`,
    start: Math.round(zone.start + (random() - 0.5) * 34),
    end: Math.round(zone.end + (random() - 0.5) * 34),
    force: zone.force,
    phase: zone.phase,
    wave: 0.24 + random() * 0.2,
    label: zone.label,
  }));

  const pickups = [
    { id: "cell-1", type: "cell", x: 1088, y: 0, charge: 18, label: "备用电池" },
    { id: "cell-2", type: "cell", x: 2186, y: 0, charge: 18, label: "备用电池" },
  ].map((cell) => ({
    ...cell,
    x: Math.round(cell.x + (random() - 0.5) * 48),
    y: Math.round(curveValue(water, cell.x) + 20),
  }));

  const checkpointBases = [
    { x: 148, label: "入洞口" },
    { x: 1120, label: "隘口前哨" },
    { x: 1690, label: "浅滩前锚位" },
    { x: 2240, label: "回旋前锚位" },
    { x: 2840, label: "仓库外湾" },
  ];
  const checkpoints = checkpointBases.map((checkpoint, index) => ({
    id: `checkpoint-${index + 1}`,
    x: Math.round(checkpoint.x + (random() - 0.5) * 22),
    label: checkpoint.label,
    y: Math.round(curveValue(water, checkpoint.x)),
  }));

  const warehouse = {
    x: 3078,
    width: 214,
    y: Math.round(curveValue(floor, 3078)),
    waterY: Math.round(curveValue(water, 3078)),
    label: "地下仓库 · K-07",
    dockRadius: 70,
  };

  const hazards = {
    gate: {
      ...gate,
      yTop: Math.round(curveValue(ceiling, (gate.start + gate.end) / 2)),
      clearance: Math.round(
        curveValue(water, (gate.start + gate.end) / 2) -
          curveValue(ceiling, (gate.start + gate.end) / 2),
      ),
    },
    shallow,
    whirlpool,
  };

  const layoutSource = {
    seed: normalizedSeed,
    ceiling: ceiling.map(Math.round),
    floor: floor.map(Math.round),
    water: water.map(Math.round),
    stalactites,
    crates,
    currents,
    pickups,
    checkpoints,
    warehouse,
    hazards,
  };

  return {
    seed: normalizedSeed,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    step: SAMPLE_STEP,
    startX: START_X,
    ceiling,
    floor,
    water,
    stalactites,
    crates,
    currents,
    pickups,
    checkpoints,
    warehouse,
    hazards,
    mission: {
      cargoTarget: crates.length,
      title: "把三只物资箱送进地下仓库",
      warehouseX: warehouse.x,
      pickupSpeedLimit: 78,
      dockSpeedLimit: 48,
    },
    failureScenario: {
      id: "stranding-drill",
      hazardId: shallow.id,
      x: Math.round((shallow.start + shallow.end) / 2),
      reason:
        "搁浅：船体在碎石浅滩失去推力，被回旋水流压向碎石床；电池保护断开，航次中止。",
    },
    layoutSignature: hashString(JSON.stringify(layoutSource)),
  };
}

export function curveAt(points, x) {
  return curveValue(points, x);
}

export function ceilingAt(world, x) {
  return curveAt(world.ceiling, x);
}

export function floorAt(world, x) {
  return curveAt(world.floor, x);
}

export function waterAt(world, x) {
  return curveAt(world.water, x);
}

export function currentAt(world, x) {
  return (
    world.currents.find((zone) => x >= zone.start && x <= zone.end) || {
      id: "calm",
      label: "平流",
      force: 0,
      phase: 0,
      wave: 0,
      start: 0,
      end: world.width,
    }
  );
}

export function obstacleBottomAt(world, x) {
  let bottom = ceilingAt(world, x);
  for (const stalactite of world.stalactites) {
    const halfWidth = stalactite.width / 2 + 3;
    if (x >= stalactite.x - halfWidth && x <= stalactite.x + halfWidth) {
      bottom = Math.max(bottom, stalactite.bottom);
    }
  }
  return bottom;
}

export function hazardAt(world, x) {
  for (const hazard of Object.values(world.hazards)) {
    if (x >= hazard.start && x <= hazard.end) {
      return hazard;
    }
  }
  return null;
}

export function distanceToWarehouse(world, x) {
  return Math.max(0, world.warehouse.x - x);
}

export function formatDistance(world, x) {
  const meters = Math.max(0, world.warehouse.x - x);
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`;
}
