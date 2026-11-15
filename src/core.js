export const DEFAULT_SEED = 20261116;
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 760;
export const LOW_TIDE_SECONDS = 120;
export const SHIP_RADIUS = 15;

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInEllipse(point, shoal) {
  const cos = Math.cos(-shoal.angle);
  const sin = Math.sin(-shoal.angle);
  const dx = point.x - shoal.x;
  const dy = point.y - shoal.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (localX * localX) / (shoal.rx * shoal.rx)
    + (localY * localY) / (shoal.ry * shoal.ry) <= 1;
}

function makeIsland(id, name, shortName, base, random) {
  const x = base.x + (random() - 0.5) * 44;
  const y = base.y + (random() - 0.5) * 34;
  const radius = base.radius + (random() - 0.5) * 15;
  const dockAngle = base.dockAngle + (random() - 0.5) * 0.22;
  const dockDistance = radius + 39 + random() * 8;
  const dock = {
    x: x + Math.cos(dockAngle) * dockDistance,
    y: y + Math.sin(dockAngle) * dockDistance,
  };
  return {
    id,
    name,
    shortName,
    x,
    y,
    radius,
    dock,
    dockAngle,
    beaconPhase: random() * TAU,
    beachAngle: random() * TAU,
    seed: Math.floor(random() * 1e9),
  };
}

function makeShoals(random) {
  const bases = [
    { x: 342, y: 452, rx: 118, ry: 39, angle: 0.16 },
    { x: 626, y: 265, rx: 91, ry: 33, angle: -0.18 },
    { x: 707, y: 565, rx: 128, ry: 43, angle: 0.24 },
    { x: 484, y: 604, rx: 92, ry: 31, angle: -0.34 },
    { x: 936, y: 226, rx: 64, ry: 29, angle: 0.58 },
  ];
  return bases.map((base, index) => ({
    id: `shoal-${index + 1}`,
    x: base.x + (random() - 0.5) * 32,
    y: base.y + (random() - 0.5) * 26,
    rx: base.rx + random() * 28,
    ry: base.ry + random() * 11,
    angle: base.angle + (random() - 0.5) * 0.28,
    maxDraft: 0.34 + random() * 0.08,
    depth: 0.55 + random() * 0.28,
    phase: random() * TAU,
  }));
}

function shoalContainsPoint(shoal, point, safety = 1) {
  const cos = Math.cos(-shoal.angle);
  const sin = Math.sin(-shoal.angle);
  const dx = point.x - shoal.x;
  const dy = point.y - shoal.y;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (localX * localX) / ((shoal.rx * safety) ** 2)
    + (localY * localY) / ((shoal.ry * safety) ** 2) <= 1;
}

function clearShoalApproaches(shoals, docks) {
  for (const shoal of shoals) {
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const blocked = docks.some((dock) => shoalContainsPoint(shoal, dock, 1.28));
      if (!blocked) break;
      const nearest = docks
        .map((dock) => ({
          dock,
          distance: Math.hypot(dock.x - shoal.x, dock.y - shoal.y),
        }))
        .sort((a, b) => a.distance - b.distance)[0].dock;
      const dx = shoal.x - nearest.x;
      const dy = shoal.y - nearest.y;
      const magnitude = Math.hypot(dx, dy) || 1;
      shoal.x += (dx / magnitude) * 14;
      shoal.y += (dy / magnitude) * 10;
    }
  }
}

function makeDriftwood(random, islands, home) {
  const logs = [];
  const blockZones = [
    home,
    ...islands.map((island) => island.dock),
    ...islands.map((island) => ({ x: island.x, y: island.y, radius: island.radius + 18 })),
  ];

  let attempts = 0;
  while (logs.length < 9 && attempts < 400) {
    attempts += 1;
    const candidate = {
      x: 230 + random() * 810,
      y: 120 + random() * 520,
      radius: 12 + random() * 11,
      angle: random() * TAU,
      phase: random() * TAU,
    };
    const dockClearance = Math.max(90, candidate.radius + 72);
    const blocked = blockZones.some((zone) => {
      const radius = zone.radius || 64;
      return Math.hypot(candidate.x - zone.x, candidate.y - zone.y) < radius + dockClearance;
    });
    if (!blocked) {
      logs.push({
        id: `log-${logs.length + 1}`,
        ...candidate,
        length: 32 + random() * 18,
      });
    }
  }
  return logs;
}

export function generateWorld(seed = DEFAULT_SEED) {
  const normalizedSeed = Number(seed) >>> 0;
  const random = mulberry32(normalizedSeed);
  const home = {
    id: "home",
    name: "母港",
    x: 128,
    y: 616,
    radius: 102,
    dock: { x: 244, y: 573 },
  };
  const islands = [
    makeIsland("north", "北屿灯塔", "北屿", {
      x: 470, y: 192, radius: 122, dockAngle: 0.72,
    }, random),
    makeIsland("east", "东礁灯塔", "东礁", {
      x: 960, y: 368, radius: 132, dockAngle: 2.4,
    }, random),
  ];
  const shoals = makeShoals(random);
  clearShoalApproaches(shoals, [home.dock, ...islands.map((island) => island.dock)]);
  const driftwood = makeDriftwood(random, islands, home);
  const mission = {
    targets: islands.map((island, index) => ({
      id: island.id,
      name: island.name,
      shortName: island.shortName,
      demand: { fuel: 1, battery: 1 },
      orderHint: index + 1,
    })),
    cargo: { fuel: 2, battery: 2 },
    deadlineSeconds: LOW_TIDE_SECONDS,
    safeDraft: 0.62,
    description: "两座灯塔各需 1 燃料与 1 电池，补给后返回母港。",
  };
  const layout = { seed: normalizedSeed, home, islands, shoals, driftwood, mission };
  const fingerprint = hashString(JSON.stringify(layout));
  return { ...layout, fingerprint };
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function cargoTotal(cargo) {
  return cargo.fuel + cargo.battery;
}

export function shipDraft(cargo) {
  return 0.25 + cargoTotal(cargo) * 0.07;
}

export function tideLevel(elapsedSeconds) {
  return Math.max(0.6, 2.4 - (elapsedSeconds / LOW_TIDE_SECONDS) * 1.8);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function log(state, text, tone = "") {
  state.logs.unshift({
    at: state.elapsed,
    clock: formatClock(state.elapsed),
    text,
    tone,
  });
  state.logs = state.logs.slice(0, 18);
}

function message(state, text, tone = "info") {
  state.lastMessage = { text, tone, at: state.elapsed };
  log(state, text, tone === "warning" ? "is-alert" : tone === "success" ? "is-good" : "");
  return { ok: tone !== "warning", message: text, tone };
}

function snapshot(state) {
  return {
    status: state.status,
    resources: cloneData(state.resources),
    cargo: cloneData(state.cargo),
    delivered: cloneData(state.delivered),
    nextStop: state.nextStop,
    elapsed: state.elapsed,
    ship: cloneData(state.ship),
    path: cloneData(state.path),
    distance: state.distance,
    collisions: state.collisions,
  };
}

export function createGame(seed = DEFAULT_SEED, options = {}) {
  const world = generateWorld(seed);
  const firstIsland = world.islands[0];
  const state = {
    seed: world.seed,
    world,
    status: "ready",
    statusBeforePause: "ready",
    resources: { fuel: world.mission.cargo.fuel, battery: world.mission.cargo.battery },
    cargo: { fuel: 0, battery: 0 },
    delivered: {
      [world.islands[0].id]: false,
      [world.islands[1].id]: false,
    },
    route: [world.islands[0].id, world.islands[1].id],
    nextStop: firstIsland.id,
    elapsed: 0,
    distance: 0,
    collisions: 0,
    recoveries: 0,
    failureHistory: [],
    ship: {
      x: world.home.dock.x,
      y: world.home.dock.y,
      angle: -0.63,
      speed: 0,
      throttle: 0,
    },
    path: [{ x: world.home.dock.x, y: world.home.dock.y }],
    logs: [],
    lastMessage: null,
    failure: null,
    summary: null,
    checkpoint: null,
    layoutAudit: {
      previousFingerprint: options.previousFingerprint || null,
      currentFingerprint: world.fingerprint,
      matched: options.previousFingerprint
        ? options.previousFingerprint === world.fingerprint
        : null,
    },
    lastBoundaryNoticeAt: -10,
  };
  state.checkpoint = snapshot(state);
  log(state, `海图载入完成，固定种子 ${world.seed}`);
  log(state, "母港待命：先分舱装载，再解缆出发。");
  return state;
}

export function setRouteOrder(state, order) {
  if (state.status !== "ready") {
    return message(state, "出发后不可修改靠岸顺序；可重开调整航线。", "warning");
  }
  const route = order === "east-first"
    ? ["east", "north"]
    : ["north", "east"];
  state.route = route;
  state.nextStop = route[0];
  const firstName = state.world.islands.find((island) => island.id === route[0]).shortName;
  return message(state, `靠岸顺序已调整：先靠${firstName}。`, "success");
}

export function loadCargo(state, type = "all") {
  if (state.status !== "ready") {
    return message(state, "航行中不能装卸货；请先返回母港或重开。", "warning");
  }
  const types = type === "all" ? ["fuel", "battery"] : [type];
  let moved = 0;
  for (const item of types) {
    if (item !== "fuel" && item !== "battery") continue;
    const capacity = 2 - state.cargo[item];
    const available = Math.min(capacity, state.resources[item]);
    const amount = type === "all" ? available : Math.min(1, available);
    if (amount > 0) {
      state.cargo[item] += amount;
      state.resources[item] -= amount;
      moved += amount;
    }
  }
  state.checkpoint = snapshot(state);
  if (!moved) {
    const full = state.cargo.fuel === 2 && state.cargo.battery === 2;
    return message(state, full ? "两舱均已装满（燃料 2 / 电池 2）。" : "母港库存不足，无法继续装载。", "warning");
  }
  const label = type === "all" ? "全部分舱物资" : type === "fuel" ? "燃料" : "电池";
  return message(state, `已装 ${label}，当前载重 ${cargoTotal(state.cargo)} / 4。`, "success");
}

export function depart(state) {
  if (state.status !== "ready" && state.status !== "paused") {
    return message(state, "当前无法解缆。", "warning");
  }
  if (cargoTotal(state.cargo) < 4) {
    return message(state, "任务至少需要 2 燃料 + 2 电池，请先装齐四箱物资。", "warning");
  }
  state.status = "sailing";
  state.elapsed = 0;
  state.ship.speed = 0;
  state.ship.throttle = 0;
  state.path = [{ x: state.ship.x, y: state.ship.y }];
  state.checkpoint = snapshot(state);
  const first = state.world.islands.find((island) => island.id === state.nextStop);
  return message(state, `缆绳已解，落潮倒计时开始。第一站：${first.shortName}。`, "success");
}

export function islandDistance(state, island) {
  return Math.hypot(state.ship.x - island.dock.x, state.ship.y - island.dock.y);
}

export function homeDistance(state) {
  return Math.hypot(
    state.ship.x - state.world.home.dock.x,
    state.ship.y - state.world.home.dock.y,
  );
}

export function dockContext(state) {
  if (state.status === "ready") {
    return { type: "home", label: "母港·解缆", nearby: true, canAct: true };
  }
  if (state.status !== "sailing") {
    return { type: "none", label: "无法靠岸", nearby: false, canAct: false };
  }
  const allDelivered = Object.values(state.delivered).every(Boolean);
  if (homeDistance(state) < 72) {
    return {
      type: allDelivered ? "complete" : "home",
      label: allDelivered ? "确认返港" : "母港·任务未完成",
      nearby: true,
      canAct: allDelivered,
    };
  }
  const nearby = state.world.islands
    .map((island) => ({ island, distance: islandDistance(state, island) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearby.distance < 70) {
    const isNext = nearby.island.id === state.nextStop;
    return {
      type: isNext ? "island" : "wrong-island",
      island: nearby.island,
      label: isNext ? `靠岸 ${nearby.island.shortName}` : `${nearby.island.shortName}·顺序不符`,
      nearby: true,
      canAct: isNext,
    };
  }
  return { type: "none", label: "航行中", nearby: false, canAct: false };
}

function deliverAt(state, island) {
  const demand = state.world.mission.targets.find((target) => target.id === island.id).demand;
  if (state.cargo.fuel < demand.fuel || state.cargo.battery < demand.battery) {
    return message(state, `${island.shortName}卸货失败：甲板缺少所需燃料或电池。`, "warning");
  }
  state.cargo.fuel -= demand.fuel;
  state.cargo.battery -= demand.battery;
  state.delivered[island.id] = true;
  const nextIndex = state.route.indexOf(island.id) + 1;
  state.nextStop = state.route[nextIndex] || null;
  state.ship.speed = 0;
  state.ship.throttle = 0;
  state.checkpoint = snapshot(state);
  if (state.nextStop) {
    const nextIsland = state.world.islands.find((item) => item.id === state.nextStop);
    return message(state, `${island.shortName}补给完成。下一站：${nextIsland.shortName}。`, "success");
  }
  return message(state, `${island.shortName}补给完成。两塔均已完成，返航母港。`, "success");
}

function finishMission(state) {
  state.status = "won";
  state.ship.speed = 0;
  state.ship.throttle = 0;
  state.summary = buildStateSummary(state);
  return message(state, "双塔补给完成并安全返港。任务成功。", "success");
}

export function triggerFailure(state, reason = "driftwood", detail = "") {
  if (state.status === "won") {
    return message(state, "任务已完成，无需失败演练。", "warning");
  }
  const reasons = {
    driftwood: {
      title: "漂木撞击",
      text: detail || "船体撞上漂浮木，螺旋桨受困。可从最近检查点恢复。",
    },
    grounding: {
      title: "浅滩搁浅",
      text: detail || "吃水超过浅滩水深，船底触底。可从最近检查点恢复。",
    },
    tide: {
      title: "错过落潮窗口",
      text: detail || "潮位跌破安全下限，近岸航道关闭。可从最近检查点恢复。",
    },
    drill: {
      title: "失败演练 · 漂木碰撞",
      text: "这是主动触发的失败场景。检查点快照已保留，恢复不会刷新页面。",
    },
  };
  const selected = reasons[reason] || reasons.drill;
  if (state.status !== "failed") {
    state.statusBeforePause = state.status;
  }
  state.status = "failed";
  state.ship.speed = 0;
  state.ship.throttle = 0;
  state.failure = {
    reason,
    title: selected.title,
    detail: selected.text,
    at: state.elapsed,
    ship: cloneData(state.ship),
    checkpointAvailable: Boolean(state.checkpoint),
  };
  state.failureHistory.push({
    reason,
    title: selected.title,
    detail: selected.text,
    atSeconds: Math.round(state.elapsed * 10) / 10,
  });
  state.summary = buildStateSummary(state);
  message(state, `航行失败：${selected.title}。`, "warning");
  return { ok: false, message: selected.title, tone: "warning", failure: state.failure };
}

export function dock(state) {
  if (state.status === "ready") {
    return depart(state);
  }
  if (state.status !== "sailing") {
    return message(state, "当前状态不能靠岸。", "warning");
  }
  const context = dockContext(state);
  if (!context.nearby) {
    return message(state, "附近没有可用泊位，请靠近灯塔码头或母港。", "warning");
  }
  if (context.type === "complete") {
    return finishMission(state);
  }
  if (context.type === "home") {
    return message(state, "仍有灯塔未完成补给，暂不能结束任务。", "warning");
  }
  if (context.type === "wrong-island") {
    return message(state, `靠岸顺序不符，应先前往${state.world.islands.find((item) => item.id === state.nextStop).shortName}。`, "warning");
  }
  if (context.type === "island") {
    return deliverAt(state, context.island);
  }
  return message(state, "尚未进入泊位。", "warning");
}

export function recoverFromCheckpoint(state) {
  if (!state.checkpoint) {
    return message(state, "没有可用检查点。", "warning");
  }
  const checkpoint = cloneData(state.checkpoint);
  const recoveries = state.recoveries + 1;
  state.status = checkpoint.status === "ready" ? "ready" : "sailing";
  state.statusBeforePause = state.status;
  state.resources = checkpoint.resources;
  state.cargo = checkpoint.cargo;
  state.delivered = checkpoint.delivered;
  state.nextStop = checkpoint.nextStop;
  state.elapsed = checkpoint.elapsed;
  state.ship = checkpoint.ship;
  state.path = checkpoint.path;
  state.distance = checkpoint.distance;
  state.collisions = checkpoint.collisions;
  state.recoveries = recoveries;
  state.failure = null;
  state.summary = null;
  return message(state, `已从检查点恢复（第 ${recoveries} 次），未刷新页面。`, "success");
}

export function setPaused(state, paused) {
  if (state.status === "won" || state.status === "failed") {
    return message(state, "当前结算界面无法暂停。", "warning");
  }
  if (paused && state.status !== "paused") {
    state.statusBeforePause = state.status;
    state.status = "paused";
    return { ok: true, message: "航行已暂停。", tone: "info", paused: true };
  }
  if (!paused && state.status === "paused") {
    state.status = state.statusBeforePause || "ready";
    return { ok: true, message: "航行继续。", tone: "success", paused: false };
  }
  return { ok: true, message: paused ? "已经暂停。" : "当前无需继续。", tone: "info", paused: state.status === "paused" };
}

export function updateGame(state, deltaSeconds, input = {}) {
  if (state.status !== "sailing") return;
  const dt = clamp(deltaSeconds, 0, 0.05);
  state.elapsed += dt;
  if (state.elapsed >= LOW_TIDE_SECONDS) {
    state.elapsed = LOW_TIDE_SECONDS;
    triggerFailure(state, "tide");
    return;
  }

  const throttle = clamp(Number(input.throttle) || 0, -1, 1);
  const steering = clamp(Number(input.steering) || 0, -1, 1);
  const draft = shipDraft(state.cargo);
  const maxForward = 61 - draft * 18;
  const targetSpeed = throttle >= 0 ? throttle * maxForward : throttle * 24;
  const acceleration = throttle === 0 ? 36 : 27;
  state.ship.speed += clamp(targetSpeed - state.ship.speed, -acceleration * dt, acceleration * dt);
  state.ship.throttle += clamp(throttle - state.ship.throttle, -3.4 * dt, 3.4 * dt);
  if (Math.abs(state.ship.speed) < 0.1) state.ship.speed = 0;

  const steerAuthority = 0.28 + Math.min(1, Math.abs(state.ship.speed) / 32) * 0.72;
  const direction = state.ship.speed < -0.5 ? -1 : 1;
  state.ship.angle += steering * direction * steerAuthority * 1.45 * dt;

  const previousX = state.ship.x;
  const previousY = state.ship.y;
  state.ship.x += Math.cos(state.ship.angle) * state.ship.speed * dt + 0.65 * dt;
  state.ship.y += Math.sin(state.ship.angle) * state.ship.speed * dt;
  state.distance += Math.hypot(state.ship.x - previousX, state.ship.y - previousY);

  if (state.ship.x < 30 || state.ship.x > WORLD_WIDTH - 30
    || state.ship.y < 30 || state.ship.y > WORLD_HEIGHT - 30) {
    state.ship.x = clamp(state.ship.x, 30, WORLD_WIDTH - 30);
    state.ship.y = clamp(state.ship.y, 30, WORLD_HEIGHT - 30);
    state.ship.speed *= -0.15;
    if (state.elapsed - state.lastBoundaryNoticeAt > 2.2) {
      state.lastBoundaryNoticeAt = state.elapsed;
      message(state, "已到达海图边界，舵手自动回正。", "warning");
    }
  }

  const lastPoint = state.path[state.path.length - 1];
  if (!lastPoint || Math.hypot(state.ship.x - lastPoint.x, state.ship.y - lastPoint.y) > 8) {
    state.path.push({ x: state.ship.x, y: state.ship.y });
    if (state.path.length > 900) state.path.shift();
  }

  const islandHit = state.world.islands.find((island) => (
    Math.hypot(state.ship.x - island.x, state.ship.y - island.y)
      < island.radius + SHIP_RADIUS - 2
  ));
  if (islandHit) {
    state.collisions += 1;
    triggerFailure(state, "grounding", `船体撞上${islandHit.shortName}岸线，船底触礁。`);
    return;
  }

  const logHit = state.world.driftwood.find((item) => (
    Math.hypot(state.ship.x - item.x, state.ship.y - item.y) < item.radius + SHIP_RADIUS
  ));
  if (logHit) {
    state.collisions += 1;
    triggerFailure(state, "driftwood", "螺旋桨卷入漂木，动力系统停机。");
    return;
  }

  const shoalHit = state.world.shoals.find((shoal) => (
    pointInEllipse(state.ship, shoal) && draft > shoal.maxDraft
  ));
  if (shoalHit) {
    state.collisions += 1;
    triggerFailure(state, "grounding", `当前吃水 ${draft.toFixed(2)} m，超过浅滩可用水深。`);
  }
}

export function deliveredTotal(state, item) {
  return state.world.mission.targets.reduce((total, target) => (
    total + (state.delivered[target.id] ? target.demand[item] : 0)
  ), 0);
}

export function remainingTotal(state, item) {
  return state.resources[item] + state.cargo[item];
}

function samplePath(path, maximum = 32) {
  if (path.length <= maximum) return cloneData(path);
  const step = (path.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => {
    const point = path[Math.round(index * step)];
    return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
  });
}

export function buildStateSummary(state) {
  const targets = state.world.mission.targets;
  const completedTargets = targets.filter((target) => state.delivered[target.id]);
  const initial = state.world.mission.cargo;
  const delivered = {
    fuel: deliveredTotal(state, "fuel"),
    battery: deliveredTotal(state, "battery"),
  };
  const remaining = {
    fuel: remainingTotal(state, "fuel"),
    battery: remainingTotal(state, "battery"),
  };
  const objectiveCountOk = completedTargets.length === targets.length;
  const resourceBalance = {
    fuel: remaining.fuel + delivered.fuel === initial.fuel,
    battery: remaining.battery + delivered.battery === initial.battery,
    ok: remaining.fuel + delivered.fuel === initial.fuel
      && remaining.battery + delivered.battery === initial.battery,
  };
  const timeRecorded = Number.isFinite(state.elapsed) && state.elapsed >= 0;
  const status = state.status === "won" ? "success" : state.status === "failed" ? "failed" : "in-progress";
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    seed: state.seed,
    layoutFingerprint: state.world.fingerprint,
    status,
    statusLabel: status === "success" ? "补给成功" : status === "failed" ? "航行失败" : "航行中",
    objective: {
      expectedTargets: targets.length,
      completedTargets: completedTargets.length,
      multiple: targets.map((target) => ({
        id: target.id,
        name: target.shortName,
        demand: cloneData(target.demand),
        delivered: state.delivered[target.id],
      })),
    },
    resources: {
      initial: cloneData(initial),
      onDeck: cloneData(state.cargo),
      atPort: cloneData(state.resources),
      delivered,
      remaining,
      balance: resourceBalance,
    },
    timing: {
      elapsedSeconds: Math.round(state.elapsed * 10) / 10,
      elapsedClock: formatClock(state.elapsed),
      deadlineSeconds: LOW_TIDE_SECONDS,
      recoveries: state.recoveries,
      collisions: state.collisions,
    },
    route: {
      planned: [...state.route],
      sailedPath: samplePath(state.path),
      distanceUnits: Math.round(state.distance),
    },
    failure: state.failure ? {
      reason: state.failure.reason,
      title: state.failure.title,
      detail: state.failure.detail,
      atSeconds: Math.round(state.failure.at * 10) / 10,
    } : null,
    failureHistory: cloneData(state.failureHistory),
    layoutAudit: {
      ...state.layoutAudit,
      sameSeedLayoutVerified: state.layoutAudit.matched === true,
    },
    validation: {
      objectiveCountOk,
      resourceBalanceOk: resourceBalance.ok,
      timeRecorded,
      layoutDeterminismOk: state.layoutAudit.matched !== false,
      successRequiresReturn: status !== "success" || (
        objectiveCountOk && homeDistance(state) < 72
      ),
    },
  };
}
