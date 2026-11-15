import { createRng, stableHash } from "./rng.js";

export const WORLD = Object.freeze({
  width: 1200,
  height: 720,
  water: Object.freeze({ left: 160, right: 1040, top: 74, bottom: 656 }),
  docks: Object.freeze({
    west: Object.freeze({ id: "west", x: 203, y: 360, shoreX: 160, label: "西岸维修坞" }),
    east: Object.freeze({ id: "east", x: 997, y: 360, shoreX: 1040, label: "东岸抢修坞" }),
  }),
});

const PROFILES = [
  {
    name: "白夜薄冰",
    briefing: "薄冰正随退潮南移，冰锚线仍可使用。",
    density: 18,
    drift: 10,
    hazard: "东风 3 级",
  },
  {
    name: "东风裂冰",
    briefing: "东风撕开冰排，浮冰会突然横切航道。",
    density: 21,
    drift: 13,
    hazard: "东风 5 级",
  },
  {
    name: "低压冰排",
    briefing: "低压槽逼近，冰排密集且碰撞后积冰更重。",
    density: 23,
    drift: 16,
    hazard: "低压槽",
  },
];

function makeFloe(rng, index, profile) {
  const radius = rng.range(22, 58);
  const points = [];
  const count = rng.int(9, 13);
  for (let i = 0; i < count; i += 1) {
    points.push({
      angle: (Math.PI * 2 * i) / count + rng.range(-0.07, 0.07),
      radius: radius * rng.range(0.78, 1.16),
    });
  }
  return {
    id: `floe-${String(index + 1).padStart(2, "0")}`,
    x: rng.range(232, 968),
    y: rng.range(88, 640),
    radius,
    vx: rng.range(-6.5, 3.5),
    vy: rng.range(profile.drift * 0.42, profile.drift),
    rotation: rng.range(0, Math.PI * 2),
    spin: rng.range(-0.16, 0.16),
    tone: rng.pick(["pale", "blue", "milky"]),
    points,
    hitCooldown: 0,
  };
}

function makeAnchors(rng) {
  const anchors = [];
  for (let i = 0; i < 6; i += 1) {
    const yLane = ["mid", "north", "south"][i % 3];
    const yBase = { mid: 360, north: 245, south: 480 }[yLane];
    anchors.push({
      id: `anchor-${i + 1}`,
      x: 310 + i * 124 + rng.range(-22, 22),
      y: yBase + rng.range(-22, 22),
      radius: rng.range(19, 25),
      rotation: rng.range(0, Math.PI),
      label: `冰锚 ${String(i + 1).padStart(2, "0")}`,
    });
  }
  return anchors;
}

export function createScenario(inputSeed = 20261116) {
  const seed = String(inputSeed).trim() || "20261116";
  const rng = createRng(`${seed}:scenario`);
  const profile = rng.pick(PROFILES);
  const mission = {
    id: `repair-run-${stableHash(`${seed}:mission`)}`,
    title: "送维修队过河",
    rounds: 3,
    crewPerTrip: 2,
    targetCrew: 6,
    targetDockings: 6,
    capacityTons: 4,
    equipmentTons: 1.2,
    crewTons: 0.8,
    fuel: 100,
    hull: 100,
    cable: 100,
    profile: profile.name,
    briefing: profile.briefing,
    hazard: profile.hazard,
  };

  const floes = [];
  const dockPoints = [WORLD.docks.west, WORLD.docks.east];
  while (floes.length < profile.density) {
    const candidate = makeFloe(rng, floes.length, profile);
    const blocksDock = dockPoints.some(
      (dock) => Math.hypot(candidate.x - dock.x, candidate.y - dock.y) < 105 + candidate.radius,
    );
    if (!blocksDock) floes.push(candidate);
  }

  const anchors = makeAnchors(rng);
  const layout = {
    seed,
    mission: {
      id: mission.id,
      rounds: mission.rounds,
      crewPerTrip: mission.crewPerTrip,
      targetCrew: mission.targetCrew,
      targetDockings: mission.targetDockings,
      capacityTons: mission.capacityTons,
      profile: mission.profile,
    },
    docks: {
      west: { x: WORLD.docks.west.x, y: WORLD.docks.west.y },
      east: { x: WORLD.docks.east.x, y: WORLD.docks.east.y },
    },
    floes: floes.map((floe) => ({
      id: floe.id,
      x: Number(floe.x.toFixed(4)),
      y: Number(floe.y.toFixed(4)),
      radius: Number(floe.radius.toFixed(4)),
      vx: Number(floe.vx.toFixed(4)),
      vy: Number(floe.vy.toFixed(4)),
      points: floe.points.map((point) => [
        Number(point.angle.toFixed(4)),
        Number(point.radius.toFixed(4)),
      ]),
    })),
    anchors: anchors.map((anchor) => ({
      id: anchor.id,
      x: Number(anchor.x.toFixed(4)),
      y: Number(anchor.y.toFixed(4)),
      radius: Number(anchor.radius.toFixed(4)),
    })),
  };

  return {
    seed,
    mission,
    floes,
    anchors,
    world: WORLD,
    layout,
    hash: stableHash(layout),
    stars: Array.from({ length: 46 }, () => ({
      x: rng.range(0, WORLD.width),
      y: rng.range(0, 160),
      size: rng.range(0.5, 1.6),
      alpha: rng.range(0.18, 0.72),
    })),
  };
}

export function verifyLayout(seed) {
  const first = createScenario(seed);
  const second = createScenario(seed);
  const same =
    first.hash === second.hash &&
    JSON.stringify(first.layout) === JSON.stringify(second.layout);
  return {
    same,
    hash: first.hash,
    missionId: first.mission.id,
    floeCount: first.floes.length,
    anchorCount: first.anchors.length,
  };
}
