import { worldFingerprint } from "./world.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

export function tideAt(world, elapsed) {
  const phase = world.tide.startPhase + (elapsed / world.tide.period) * TAU;
  const level = 0.5 + 0.5 * Math.sin(phase);
  const flow = Math.cos(phase);
  const angle = world.tide.baseAngle + (flow >= 0 ? 0 : Math.PI);
  const strength = Math.round(world.tide.peakFlow * Math.pow(Math.abs(flow), 0.72));
  return {
    phase,
    level,
    flow,
    waveHeight: round(0.25 + level * 0.75, 3),
    current: {
      angle,
      strength,
      x: Math.cos(angle) * strength * 0.55,
      y: Math.sin(angle) * strength * 0.55,
    },
  };
}

export function createInitialState(world) {
  const boat = {
    x: world.start.x,
    y: world.start.y,
    angle: world.start.angle,
    vx: 0,
    vy: 0,
  };
  return {
    mode: "intro",
    elapsed: 0,
    boat,
    fuel: world.mission.startingFuel,
    hull: world.mission.startingHull,
    loaded: 0,
    nextTarget: 1,
    visited: [],
    path: [{ x: boat.x, y: boat.y }],
    wake: [],
    throttle: 0,
    steer: 0,
    incidents: [],
    checkpoints: [],
    checkpointLabel: "码头",
    totalFuelUsed: 0,
    totalHullLost: 0,
    lastInput: "待命",
    lastEvent: "等待启航",
  };
}

export function makeCheckpoint(state, label) {
  return {
    label,
    boat: { ...state.boat },
    elapsed: state.elapsed,
    fuel: state.fuel,
    hull: state.hull,
    loaded: state.loaded,
    nextTarget: state.nextTarget,
    visited: [...state.visited],
    path: state.path.map((point) => ({ ...point })),
    totalFuelUsed: state.totalFuelUsed,
    totalHullLost: state.totalHullLost,
    incidentCount: state.incidents.length,
  };
}

export function restoreCheckpoint(state, checkpoint) {
  return {
    ...state,
    mode: "playing",
    boat: { ...checkpoint.boat, vx: 0, vy: 0 },
    elapsed: checkpoint.elapsed,
    fuel: checkpoint.fuel,
    hull: checkpoint.hull,
    loaded: checkpoint.loaded,
    nextTarget: checkpoint.nextTarget,
    visited: [...checkpoint.visited],
    path: checkpoint.path.map((point) => ({ ...point })),
    wake: [],
    throttle: 0,
    steer: 0,
    totalFuelUsed: checkpoint.totalFuelUsed,
    totalHullLost: checkpoint.totalHullLost,
    incident: null,
    checkpointLabel: checkpoint.label,
    lastEvent: `已从「${checkpoint.label}」检查点恢复`,
  };
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function boatHitsObstacle(boat, obstacle, radius = 14) {
  return (
    pointSegmentDistance(
      boat.x,
      boat.y,
      obstacle.x1,
      obstacle.y1,
      obstacle.x2,
      obstacle.y2,
    ) <
    obstacle.width / 2 + radius
  );
}

export function findObstacleHit(world, boat) {
  return world.obstacles.find((obstacle) => boatHitsObstacle(boat, obstacle)) || null;
}

export function findShallowHit(world, state) {
  const tide = tideAt(world, state.elapsed);
  return (
    world.shallows.find((shallow) => {
      if (tide.level > shallow.groundAt) return false;
      const cos = Math.cos(-shallow.rotation);
      const sin = Math.sin(-shallow.rotation);
      const dx = state.boat.x - shallow.x;
      const dy = state.boat.y - shallow.y;
      const localX = dx * cos - dy * sin;
      const localY = dx * sin + dy * cos;
      return (localX * localX) / (shallow.rx ** 2) + (localY * localY) / (shallow.ry ** 2) < 0.78;
    }) || null
  );
}

export function groupReached(group, boat) {
  return Math.hypot(boat.x - group.x, boat.y - group.y) <= group.radius + 8;
}

export function dockReached(world, boat) {
  const dock = world.dock;
  return (
    boat.x > dock.x - 30 &&
    boat.x < dock.x + dock.width + 26 &&
    boat.y > dock.y - 30 &&
    boat.y < dock.y + dock.height + 32
  );
}

export function isWithinDockDockSpeed(boat) {
  return Math.hypot(boat.vx, boat.vy) < 78;
}

export function currentMotion(world, elapsed) {
  const tide = tideAt(world, elapsed);
  return tide.current;
}

export function buildRunSummary({ world, state, outcome, reason, endedAt, layoutCheck }) {
  const targetCount = world.mission.targetCount;
  const elapsed = round(state.elapsed, 2);
  const isSuccess = outcome === "success";
  const incidents = state.incidents.map((incident) => ({
    kind: incident.kind,
    detail: incident.detail,
    time: round(incident.time, 2),
    x: round(incident.x ?? state.boat.x, 1),
    y: round(incident.y ?? state.boat.y, 1),
  }));
  return {
    schemaVersion: 1,
    seed: world.seed,
    layoutFingerprint: worldFingerprint(world),
    savedAt: endedAt,
    outcome,
    success: isSuccess,
    objectives: {
      checked: state.loaded,
      targetCount,
      sequence: world.groups.map((group) => group.label),
      complete: state.loaded === targetCount,
      returnedToDock: isSuccess,
    },
    resources: {
      fuelRemaining: round(state.fuel, 1),
      hullRemaining: round(state.hull, 1),
      fuelUsed: round(state.totalFuelUsed, 1),
      hullLost: round(state.totalHullLost, 1),
    },
    timing: {
      finalTimeSeconds: elapsed,
      timeLimitSeconds: world.mission.timeLimit,
      remainingSeconds: round(Math.max(0, world.mission.timeLimit - elapsed), 2),
    },
    path: state.path.map((point) => ({ x: round(point.x, 1), y: round(point.y, 1) })),
    incidents,
    failure: isSuccess
      ? null
      : {
          reason: reason || "任务失败",
          detail: state.incident?.detail || state.lastEvent,
        },
    checkpoint: {
      label: state.checkpointLabel,
      count: state.checkpoints.length,
      recoverable: !isSuccess,
    },
    layoutValidation: layoutCheck || {
      compared: false,
      sameLayout: true,
      message: "首次生成，等待下一局比对",
    },
    loadPenalty: {
      active: state.loaded > 0,
      parts: state.loaded,
      speedMultiplier: round(1 - Math.min(0.34, state.loaded * 0.1), 2),
      steeringMultiplier: round(1 - Math.min(0.28, state.loaded * 0.08), 2),
    },
  };
}

export function summarizeIncidents(state) {
  if (!state.incidents.length) return "无碰撞或搁浅";
  const collision = state.incidents.filter((incident) => incident.kind === "collision").length;
  const grounding = state.incidents.filter((incident) => incident.kind === "grounding").length;
  return `碰撞 ${collision} 次 · 搁浅 ${grounding} 次（均可检查点恢复）`;
}

export function dockingFeedback(world, state) {
  if (state.loaded < world.mission.targetCount) {
    return `还需检查 ${world.mission.targetCount - state.loaded} 组浮标`;
  }
  if (!isWithinDockDockSpeed(state.boat)) {
    return "返航速度过快，请减速靠岸";
  }
  return "靠岸条件满足";
}
