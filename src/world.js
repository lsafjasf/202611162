export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;
export const DEFAULT_SEED = 20261116;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, min, max) {
  return min + (max - min) * random();
}

function jitter(random, x, y, amount = 18) {
  return {
    x: Math.round(x + between(random, -amount, amount)),
    y: Math.round(y + between(random, -amount, amount)),
  };
}

function makeBuoyGroup(random, id, anchor, color) {
  const center = jitter(random, anchor.x, anchor.y, 24);
  const phase = between(random, 0, Math.PI * 2);
  const buoys = [0, 1, 2].map((index) => {
    const angle = phase + (index * Math.PI * 2) / 3;
    return {
      x: Math.round(center.x + Math.cos(angle) * 30),
      y: Math.round(center.y + Math.sin(angle) * 24),
      angle: Math.round((angle * 1000)) / 1000,
    };
  });
  return {
    id,
    label: String(id).padStart(2, "0"),
    x: center.x,
    y: center.y,
    radius: 43,
    color,
    buoys,
  };
}

function makeObstacle(random, kind, anchor, size) {
  const start = jitter(random, anchor.x, anchor.y, 12);
  const end = jitter(random, anchor.x + size.x, anchor.y + size.y, 12);
  return {
    id: `${kind}-${anchor.x}-${anchor.y}`,
    kind,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    width: kind === "pontoon" ? 30 : 18,
  };
}

function makeShallow(random, id, anchor) {
  const center = jitter(random, anchor.x, anchor.y, 16);
  return {
    id,
    x: center.x,
    y: center.y,
    rx: Math.round(anchor.rx + between(random, -12, 12)),
    ry: Math.round(anchor.ry + between(random, -9, 9)),
    groundAt: anchor.groundAt,
    rotation: between(random, -0.35, 0.35),
  };
}

export function createWorld(seed = DEFAULT_SEED) {
  const random = mulberry32(seed);
  const groups = [
    makeBuoyGroup(random, 1, { x: 790, y: 142 }, "#58e0c1"),
    makeBuoyGroup(random, 2, { x: 1060, y: 482 }, "#ffc45d"),
    makeBuoyGroup(random, 3, { x: 512, y: 596 }, "#ff7d8f"),
  ];
  const pontoons = [
    makeObstacle(random, "pontoon", { x: 392, y: 262 }, { x: 210, y: 26 }),
    makeObstacle(random, "pontoon", { x: 842, y: 322 }, { x: 166, y: -22 }),
  ];
  const nets = [
    makeObstacle(random, "net", { x: 298, y: 464 }, { x: 220, y: -64 }),
    makeObstacle(random, "net", { x: 664, y: 404 }, { x: -134, y: 128 }),
    makeObstacle(random, "net", { x: 1012, y: 272 }, { x: 32, y: 126 }),
  ];
  const shallows = [
    makeShallow(random, "sandbar-a", {
      x: 688,
      y: 540,
      rx: 122,
      ry: 65,
      groundAt: 0.32,
    }),
    makeShallow(random, "sandbar-b", {
      x: 340,
      y: 142,
      rx: 95,
      ry: 57,
      groundAt: 0.22,
    }),
  ];

  return {
    version: 1,
    seed,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    start: { x: 292, y: 372, angle: -0.08 },
    dock: { x: 112, y: 350, width: 148, height: 52 },
    groups,
    obstacles: [...pontoons, ...nets],
    pontoons,
    nets,
    shallows,
    tide: {
      period: 108,
      startPhase: 0.42,
      baseAngle: -0.18,
      peakFlow: 34,
    },
    mission: {
      targetCount: groups.length,
      timeLimit: 150,
      startingFuel: 100,
      startingHull: 100,
    },
  };
}

export function roundWorld(world) {
  return {
    seed: world.seed,
    start: world.start,
    dock: world.dock,
    groups: world.groups,
    pontoons: world.pontoons,
    nets: world.nets,
    shallows: world.shallows,
    tide: world.tide,
    mission: world.mission,
  };
}

export function worldFingerprint(world) {
  const text = JSON.stringify(roundWorld(world));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function worldsMatch(first, second) {
  return JSON.stringify(roundWorld(first)) === JSON.stringify(roundWorld(second));
}

export function compileLayout(world) {
  return {
    width: world.width,
    height: world.height,
    dock: world.dock,
    start: world.start,
    groups: world.groups,
    pontos: world.pontoons,
    nets: world.nets,
    shallows: world.shallows,
    tide: world.tide,
    mission: world.mission,
  };
}
