export const TOTAL_DAYS = 90;

export const THRESHOLDS = Object.freeze({
  pipeWarning: 16,
  pipeSafe: 18,
  stationSafeMin: -8,
  stationSafeMax: -1.5,
  thawWarning: 2.25,
  drainageWarning: 0.35,
  ecologyWarning: 55,
});

export const COSTS = Object.freeze({
  probe: { power: 4, crew: 2, probes: 1, label: "温度探针" },
  cooling: { power: 24, crew: 1.5, probes: 0, label: "地基冷却" },
  drainage: { power: 9, crew: 2.5, probes: 0, label: "排水清淤" },
});

export const BENCHMARK_SEQUENCE = Object.freeze([
  { day: 3, kind: "probe", hotspot: 0 },
  { day: 11, kind: "drainage" },
  { day: 25, kind: "cooling" },
  { day: 35, kind: "probe", hotspot: 1 },
  { day: 42, kind: "drainage" },
  { day: 52, kind: "cooling" },
  { day: 60, kind: "drainage" },
  { day: 69, kind: "cooling" },
  { day: 77, kind: "probe", hotspot: 2 },
]);

const SENTINELS = [
  { id: "S-07", species: "雪鸮", tag: "ARV" },
  { id: "S-12", species: "北极狐", tag: "VUL" },
  { id: "S-21", species: "雪鸮", tag: "ARV" },
  { id: "S-33", species: "旅鼠", tag: "LEM" },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const round = (value, digits = 1) => Number(value.toFixed(digits));

function hash32(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

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

function bump(day, start, width = 5) {
  const position = (day - start) / width;
  if (position <= 0 || position >= 1) return 0;
  return 0.5 - 0.5 * Math.cos(position * Math.PI * 2);
}

function fingerprint(mission) {
  const core = [
    mission.seed,
    mission.initialResources.power,
    mission.initialResources.crew,
    mission.initialResources.probes,
    mission.sentinel.id,
    mission.hotspots.map((hotspot) => `${hotspot.x.toFixed(4)}:${hotspot.depth.toFixed(4)}`).join(","),
    mission.weather.filter((_, index) => index % 9 === 0).map((entry) => entry.temp.toFixed(2)).join(","),
    mission.keyEvents.map((event) => `${event.day}:${event.type}`).join(","),
  ].join("|");
  return `FP-${hash32(core).toString(16).toUpperCase().padStart(8, "0").slice(0, 8)}`;
}

export function createMission(seedInput = 677) {
  const seed = String(seedInput).trim() || "677";
  const rng = mulberry32(hash32(`polar:${seed}`));
  const warmStarts = [24 + Math.floor(rng() * 8), 54 + Math.floor(rng() * 9)].sort((a, b) => a - b);
  const stormStarts = [34 + Math.floor(rng() * 7), 67 + Math.floor(rng() * 8)].sort((a, b) => a - b);

  const weather = Array.from({ length: TOTAL_DAYS + 1 }, (_, day) => {
    const seasonal = -16 + 11.5 * Math.sin(((day - 20) / 70) * Math.PI);
    const front = warmStarts.reduce((sum, start) => sum + bump(day, start, 6) * 3.4, 0);
    const snowFront = stormStarts.reduce((sum, start) => sum + bump(day, start, 5) * 0.42, 0);
    return {
      temp: seasonal + (rng() * 2 - 1) * 1.7 + front,
      wind: clamp(0.28 + rng() * 0.48 + snowFront * 0.7, 0.15, 1),
      snow: clamp(0.12 + rng() * 0.38 + snowFront, 0.04, 0.98),
      solar: clamp(0.34 + rng() * 0.5 + front * 0.06, 0.1, 1),
    };
  });

  const sentinelBase = SENTINELS[Math.floor(rng() * SENTINELS.length)];
  const sentinelNumber = 1 + Math.floor(rng() * 79);
  const hotspots = Array.from({ length: 4 }, (_, index) => ({
    id: String.fromCharCode(65 + index),
    x: round(0.31 + rng() * 0.57, 3),
    depth: round(0.3 + rng() * 0.38, 3),
  })).sort((a, b) => a.x - b.x);

  const keyEvents = [
    { day: warmStarts[0], type: "warm", label: "首轮暖锋", severity: "watch" },
    { day: stormStarts[0], type: "storm", label: "白毛风过境", severity: "watch" },
    { day: warmStarts[1], type: "warm", label: "持续消融窗口", severity: "critical" },
    { day: stormStarts[1], type: "storm", label: "晚季风雪", severity: "watch" },
  ].sort((a, b) => a.day - b.day || a.type.localeCompare(b.type));

  const mission = {
    seed,
    siteCode: `ARC-${String(600 + Math.floor(rng() * 399))}`,
    latitude: round(76.2 + rng() * 4.2, 2),
    longitude: round(12.5 + rng() * 22, 2),
    pipeLoad: 54 + Math.floor(rng() * 18),
    initialResources: {
      power: 180 + Math.floor(rng() * 5) * 10,
      crew: 30 + Math.floor(rng() * 5) * 2,
      probes: 3,
    },
    sentinel: {
      ...sentinelBase,
      id: `${sentinelBase.tag}-${String(sentinelNumber).padStart(2, "0")}`,
    },
    hotspots,
    weather,
    keyEvents,
  };
  mission.fingerprint = fingerprint(mission);
  return mission;
}

export function weatherAt(mission, day) {
  const bounded = clamp(day, 0, TOTAL_DAYS);
  const index = Math.min(TOTAL_DAYS - 1, Math.floor(bounded));
  const fraction = bounded - index;
  const blend = smooth(fraction);
  const first = mission.weather[index];
  const second = mission.weather[index + 1];
  const hour = fraction * 24;
  const daylight = Math.max(0, Math.sin(((hour - 5.5) / 24) * Math.PI * 2));
  const temperature = lerp(first.temp, second.temp, blend)
    + Math.sin(((hour - 8) / 24) * Math.PI * 2) * (0.9 + daylight * 1.35);
  const wind = lerp(first.wind, second.wind, blend) * (0.86 + 0.14 * Math.sin(day * 2.1));
  const snow = lerp(first.snow, second.snow, blend);
  const solar = lerp(first.solar, second.solar, blend) * daylight;
  return { temperature, wind, snow, solar, hour, daylight };
}

export function weatherLabel(weather) {
  if (weather.snow > 0.7 && weather.wind > 0.6) return "白毛风";
  if (weather.wind > 0.78) return "强侧风";
  if (weather.temperature > -7) return "消融窗口";
  if (weather.snow > 0.4) return "间歇飘雪";
  return "晴冷";
}

export function createSimulation(seed = 677) {
  const mission = createMission(seed);
  const state = {
    mission,
    day: 0,
    weather: weatherAt(mission, 0),
    thawDepth: 1.38,
    foundationTemp: -5.9,
    stationTemp: -5.2,
    pipeDisplacement: 2.1,
    heatFlux: 18.2,
    drainage: 0.82,
    cooldown: 0,
    ecology: 93,
    sentinelStress: 14,
    resources: { ...mission.initialResources },
    probes: [],
    probeCoverage: 0,
    operationCount: 0,
    sequenceIndex: 0,
    firedEvents: [],
    alertFlags: {},
    logs: [{
      id: "boot",
      day: 0,
      kind: "system",
      title: "监测阵列上线",
      detail: `${mission.siteCode} · 初始电力 ${mission.initialResources.power} kWh`,
    }],
    lastOp: null,
    ended: false,
    outcome: null,
  };
  return state;
}

export function snapshot(state) {
  return {
    day: round(state.day, 2),
    resources: { ...state.resources },
    ecology: round(state.ecology, 1),
    sentinelStress: round(state.sentinelStress, 1),
    metrics: {
      stationTemp: round(state.stationTemp, 2),
      pipeDisplacement: round(state.pipeDisplacement, 2),
      thawDepth: round(state.thawDepth, 2),
      heatFlux: round(state.heatFlux, 1),
      drainage: round(state.drainage * 100, 0),
      ecology: round(state.ecology, 1),
      probeCoverage: round(state.probeCoverage * 100, 0),
    },
  };
}

export function statusFor(state) {
  const pipeCritical = state.pipeDisplacement > THRESHOLDS.pipeSafe;
  const stationCritical = state.stationTemp > THRESHOLDS.stationSafeMax
    || state.stationTemp < THRESHOLDS.stationSafeMin;
  const warning = state.pipeDisplacement >= THRESHOLDS.pipeWarning
    || state.stationTemp > THRESHOLDS.stationSafeMax + 0.35
    || state.thawDepth > THRESHOLDS.thawWarning
    || state.drainage < THRESHOLDS.drainageWarning
    || state.ecology < THRESHOLDS.ecologyWarning;
  if (pipeCritical || stationCritical) return "critical";
  if (warning) return "warning";
  return "steady";
}

export function ecologyMetrics(state) {
  return {
    ecology: round(state.ecology, 1),
    vegetation: round(clamp(state.ecology * 0.97 - state.sentinelStress * 0.08, 0, 100), 1),
    lichen: round(clamp(100 - state.sentinelStress * 0.74 - state.thawDepth * 3.8, 0, 100), 1),
    sentinelHealth: round(clamp(100 - state.sentinelStress, 0, 100), 1),
  };
}

function addLog(state, entry) {
  state.logs.unshift({
    id: `${state.day.toFixed(2)}-${state.logs.length}-${entry.kind}`,
    day: round(state.day, 2),
    ...entry,
  });
  state.logs = state.logs.slice(0, 30);
}

function fireKeyEvents(state) {
  for (const event of state.mission.keyEvents) {
    if (state.day >= event.day && !state.firedEvents.includes(event.label)) {
      state.firedEvents.push(event.label);
      addLog(state, {
        kind: event.severity === "critical" ? "alert" : "weather",
        title: event.label,
        detail: event.type === "warm"
          ? "气温抬升，活动层热流增强"
          : "风雪负荷上升，沟渠加速淤积",
      });
    }
  }
}

function checkThresholds(state) {
  const checks = [
    { key: "pipe", active: state.pipeDisplacement >= THRESHOLDS.pipeWarning, title: "管线位移进入警戒区" },
    { key: "station", active: state.stationTemp > THRESHOLDS.stationSafeMax + 0.35, title: "地基温度接近上限" },
    { key: "thaw", active: state.thawDepth > THRESHOLDS.thawWarning, title: "融深超过警戒线" },
    { key: "drainage", active: state.drainage < THRESHOLDS.drainageWarning, title: "排水能力不足" },
    { key: "ecology", active: state.ecology < THRESHOLDS.ecologyWarning, title: "生态完整性降至低位" },
  ];
  for (const check of checks) {
    if (check.active && !state.alertFlags[check.key]) {
      state.alertFlags[check.key] = true;
      addLog(state, {
        kind: "alert",
        title: check.title,
        detail: "阈值已触发，建议检查冷却与排水",
      });
    } else if (!check.active && state.alertFlags[check.key]) {
      state.alertFlags[check.key] = false;
    }
  }
}

function integrate(state, dt) {
  const weather = weatherAt(state.mission, state.day);
  state.weather = weather;
  const mission = state.mission;
  const loadHeat = (mission.pipeLoad - 55) * 0.012;
  const warmDrive = Math.max(0, weather.temperature + 12);
  const solarDrive = weather.solar * (1 - weather.snow * 0.38);
  const cooldownDrive = state.cooldown * (1 + state.probeCoverage * 0.12);
  const thawTarget = clamp(
    1.25 + warmDrive * 0.11 + solarDrive * 0.19 + loadHeat
      + (1 - state.drainage) * 0.29 - cooldownDrive * 0.62,
    0.92,
    3.75,
  );
  const foundationTarget = clamp(
    -9.4 + Math.max(0, weather.temperature + 20) * 0.18 + solarDrive * 0.16 + state.thawDepth * 1.55
      + loadHeat * 1.8 - cooldownDrive * 2.45 - state.drainage * 0.18,
    -9.2,
    0.8,
  );
  const heatTarget = clamp(
    16.5 + mission.pipeLoad * 0.085 + warmDrive * 0.54 + solarDrive * 1.1 + (1 - state.drainage) * 9
      + (state.thawDepth - 1.2) * 2.4 - state.cooldown * 7.5,
    8,
    48,
  );

  const thawRate = 1 - Math.exp(-dt / 1.9);
  const foundationRate = 1 - Math.exp(-dt / 2.5);
  const heatRate = 1 - Math.exp(-dt / 0.8);
  state.thawDepth += (thawTarget - state.thawDepth) * thawRate;
  state.foundationTemp += (foundationTarget - state.foundationTemp) * foundationRate;
  state.stationTemp += ((state.foundationTemp + 0.58) - state.stationTemp) * (1 - Math.exp(-dt / 0.55));
  state.heatFlux += (heatTarget - state.heatFlux) * heatRate;
  state.cooldown = Math.max(0, state.cooldown - 0.068 * dt);
  state.drainage = clamp(state.drainage - (0.0048 + weather.snow * 0.0095) * dt, 0.06, 1);

  const exposure = Math.max(0, state.thawDepth - 1.52);
  const loadFactor = 0.11 + mission.pipeLoad * 0.00215;
  const settlementRate = exposure * (loadFactor + (1 - state.drainage) * 0.13)
    * (0.82 + state.heatFlux / 110) * 1.45;
  state.pipeDisplacement = clamp(state.pipeDisplacement + settlementRate * dt, 0, 60);

  const recharge = (0.34 + weather.solar * 0.9) * dt;
  state.resources.power = Math.min(mission.initialResources.power * 1.28, state.resources.power + recharge);
  if (state.cooldown > 0.08) {
    state.resources.power = Math.max(0, state.resources.power - state.cooldown * 0.2 * dt);
  }

  const stressTarget = clamp(
    10 + Math.max(0, state.thawDepth - 1.9) * 23 + (1 - state.drainage) * 28
      + Math.max(0, state.stationTemp + 2) * 17 + Math.max(0, state.pipeDisplacement - 13) * 0.9,
    4,
    94,
  );
  state.sentinelStress += (stressTarget - state.sentinelStress) * (1 - Math.exp(-dt / 3.4));
  const ecoTarget = clamp(
    96 - Math.max(0, state.thawDepth - 1.7) * 11 - (1 - state.drainage) * 20
      - Math.max(0, state.pipeDisplacement - 12) * 1.25 - state.sentinelStress * 0.11,
    24,
    98,
  );
  state.ecology += (ecoTarget - state.ecology) * (1 - Math.exp(-dt / 4.8));
}

function finishIfNeeded(state) {
  if (state.day < TOTAL_DAYS - 1e-7 || state.ended) return;
  state.day = TOTAL_DAYS;
  state.ended = true;
  const safePipe = state.pipeDisplacement <= THRESHOLDS.pipeSafe;
  const safeStation = state.stationTemp <= THRESHOLDS.stationSafeMax
    && state.stationTemp >= THRESHOLDS.stationSafeMin;
  state.outcome = safePipe && safeStation ? "success" : "failure";
  addLog(state, {
    kind: state.outcome === "success" ? "success" : "fail",
    title: state.outcome === "success" ? "九十天守护完成" : "任务未达标",
    detail: `位移 ${state.pipeDisplacement.toFixed(1)} mm · 地温 ${state.stationTemp.toFixed(1)}°C`,
  });
}

export function advance(state, days) {
  if (state.ended || days <= 0) return state;
  const bounded = Math.min(days, TOTAL_DAYS - state.day);
  const steps = Math.max(1, Math.ceil(bounded / 0.025));
  const dt = bounded / steps;
  for (let index = 0; index < steps && !state.ended; index += 1) {
    state.day = Math.min(TOTAL_DAYS, state.day + dt);
    integrate(state, dt);
    fireKeyEvents(state);
    checkThresholds(state);
    finishIfNeeded(state);
  }
  return state;
}

function insufficient(state, kind, before) {
  const cost = COSTS[kind];
  const missing = [];
  if (state.resources.power < cost.power) missing.push(`电力 ${round(cost.power - state.resources.power, 1)} kWh`);
  if (state.resources.crew < cost.crew) missing.push(`工时 ${round(cost.crew - state.resources.crew, 1)} h`);
  if (cost.probes && state.resources.probes < cost.probes) missing.push(`探针 ${cost.probes - state.resources.probes} 支`);
  const after = snapshot(state);
  state.lastOp = {
    ok: false,
    kind,
    title: `${COSTS[kind].label}未执行`,
    reason: `资源不足：${missing.join("、")}`,
    before,
    after,
    trigger: "所需资源低于操作阈值",
  };
  addLog(state, {
    kind: "fail",
    title: state.lastOp.title,
    detail: state.lastOp.reason,
  });
  return state.lastOp;
}

function resolveProbe(state, point) {
  const pools = state.mission.hotspots;
  let closest = pools[0];
  let distance = Infinity;
  for (const hotspot of pools) {
    const current = Math.hypot(hotspot.x - point.x, hotspot.depth - point.depth);
    if (current < distance) {
      closest = hotspot;
      distance = current;
    }
  }
  const onTarget = distance < 0.2;
  const gain = onTarget ? 0.22 : 0.09;
  return {
    closest,
    distance,
    onTarget,
    gain,
    probe: {
      id: `P${state.probes.length + 1}`,
      x: clamp(point.x, 0.22, 0.9),
      depth: clamp(point.depth, 0.24, 0.9),
      hotspot: closest.id,
      onTarget,
      distance: round(distance, 2),
    },
  };
}

export function performAction(state, kind, payload = {}) {
  if (state.ended) {
    return { ok: false, title: "模拟已结束", reason: "请重开后继续操作" };
  }
  const cost = COSTS[kind];
  if (!cost) return { ok: false, title: "未知操作", reason: "没有匹配的干预项" };
  const before = snapshot(state);
  if (state.resources.power < cost.power || state.resources.crew < cost.crew
    || (cost.probes && state.resources.probes < cost.probes)) {
    return insufficient(state, kind, before);
  }

  state.resources.power = round(state.resources.power - cost.power, 2);
  state.resources.crew = round(state.resources.crew - cost.crew, 2);
  state.operationCount += 1;
  let title = cost.label;
  let detail = "";
  let trigger = "";

  if (kind === "probe") {
    state.resources.probes -= 1;
    const point = payload.point || { x: 0.5, depth: 0.5 };
    const resolved = resolveProbe(state, point);
    state.probes.push(resolved.probe);
    state.probeCoverage = clamp(state.probeCoverage + resolved.gain, 0, 0.92);
    title = resolved.onTarget ? `探针 ${resolved.probe.id} 命中 ${resolved.closest.id} 点` : `探针 ${resolved.probe.id} 已布设`;
    detail = resolved.onTarget
      ? `热异常读数已接入 · 覆盖 ${Math.round(state.probeCoverage * 100)}%`
      : `偏离推荐点 ${Math.round(resolved.distance * 100)}%，覆盖 ${Math.round(state.probeCoverage * 100)}%`;
    trigger = resolved.onTarget ? "距推荐点 < 20%" : "自由布点";
  } else if (kind === "cooling") {
    const previous = state.cooldown;
    state.cooldown = Math.min(1.35, state.cooldown + 0.62);
    title = "地基冷却泵启动";
    detail = `冷媒回路强化 · 冷却指数 ${Math.round(previous * 100)} → ${Math.round(state.cooldown * 100)}`;
    trigger = "地基温度接近 -1.5°C 或主动降温";
  } else if (kind === "drainage") {
    const previous = state.drainage;
    state.drainage = Math.min(1, state.drainage + 0.64);
    title = "排水沟完成清淤";
    detail = `排水能力 ${Math.round(previous * 100)}% → ${Math.round(state.drainage * 100)}%`;
    trigger = "排水能力 < 35% 时优先维护";
  }

  addLog(state, { kind: "operation", title, detail });
  const after = snapshot(state);
  state.lastOp = {
    ok: true,
    kind,
    title,
    detail,
    trigger,
    before,
    after,
    cost,
    elapsed: round(cost.crew / 8, 2),
    powerDelta: round(after.resources.power - before.resources.power, 1),
    crewDelta: round(after.resources.crew - before.resources.crew, 1),
    ecoDelta: round(after.ecology - before.ecology, 1),
  };
  return state.lastOp;
}

export function advanceBenchmark(state, days) {
  let remaining = days;
  while (remaining > 0 && !state.ended) {
    const next = BENCHMARK_SEQUENCE[state.sequenceIndex];
    if (next && state.day < next.day && next.day <= state.day + remaining) {
      const travel = next.day - state.day;
      advance(state, travel);
      const hotspot = next.kind === "probe" ? state.mission.hotspots[next.hotspot] : null;
      performAction(state, next.kind, hotspot ? { point: hotspot } : {});
      state.sequenceIndex += 1;
      remaining = Math.max(0, remaining - travel);
    } else {
      advance(state, remaining);
      remaining = 0;
    }
  }
  return state;
}

export function advanceUntil(state, predicate, maxDays = TOTAL_DAYS) {
  const stop = Math.min(TOTAL_DAYS, state.day + maxDays);
  while (state.day < stop && !state.ended) {
    advance(state, 0.1);
    if (predicate(state)) return true;
  }
  return false;
}

function compareRecord(label, before, after, trigger, operation = null) {
  return {
    label,
    before,
    after,
    trigger,
    operation,
    elapsed: round(after.day - before.day, 2),
    powerUsed: round(before.resources.power - after.resources.power, 1),
    crewUsed: round(before.resources.crew - after.resources.crew, 1),
    ecologyDelta: round(after.ecology - before.ecology, 1),
    finalEcology: ecologyMetricsFromSnapshot(after),
  };
}

function ecologyMetricsFromSnapshot(entry) {
  const stress = entry.sentinelStress;
  return {
    ecology: entry.ecology,
    vegetation: round(clamp(entry.ecology * 0.97 - stress * 0.08, 0, 100), 1),
    lichen: round(clamp(100 - stress * 0.74 - entry.metrics.thawDepth * 3.8, 0, 100), 1),
    sentinelHealth: round(clamp(100 - stress, 0, 100), 1),
  };
}

function runStrategy(start, actions, finalAdvance) {
  const state = structuredClone(start);
  const before = snapshot(state);
  const records = [];
  for (const action of actions) {
    if (action.advance) advance(state, action.advance);
    if (action.kind) records.push(performAction(state, action.kind, action.payload || {}));
  }
  advance(state, finalAdvance);
  const after = snapshot(state);
  return {
    before,
    after,
    records,
    elapsed: round(after.day - before.day, 1),
    powerUsed: round(Math.max(0, before.resources.power - after.resources.power), 1),
    crewUsed: round(Math.max(0, before.resources.crew - after.resources.crew), 1),
    finalEcology: ecologyMetricsFromSnapshot(after),
    finalStatus: statusFor(state),
    metrics: after.metrics,
  };
}

export function runValidationSuite(seed = 677) {
  const steadyState = createSimulation(seed);
  advance(steadyState, 8);
  const steadyBefore = snapshot(steadyState);
  const steadyOperation = performAction(steadyState, "probe", {
    point: steadyState.mission.hotspots[0],
  });
  advance(steadyState, 6);
  const steadyAfter = snapshot(steadyState);

  const criticalState = createSimulation(seed);
  advanceUntil(criticalState, (state) => state.day > 5 && statusFor(state) !== "steady", 84);
  const criticalBefore = snapshot(criticalState);
  const criticalTrigger = [
    criticalState.pipeDisplacement >= THRESHOLDS.pipeWarning
      ? `管线位移 ${criticalState.pipeDisplacement.toFixed(1)} mm ≥ ${THRESHOLDS.pipeWarning} mm`
      : "",
    criticalState.thawDepth >= THRESHOLDS.thawWarning
      ? `活动层融深 ${criticalState.thawDepth.toFixed(2)} m ≥ ${THRESHOLDS.thawWarning} m`
      : "",
    criticalState.stationTemp >= THRESHOLDS.stationSafeMax
      ? `站点地温 ${criticalState.stationTemp.toFixed(1)}°C ≥ ${THRESHOLDS.stationSafeMax}°C`
      : "",
    criticalState.drainage <= THRESHOLDS.drainageWarning
      ? `排水效能 ${Math.round(criticalState.drainage * 100)}% ≤ ${THRESHOLDS.drainageWarning * 100}%`
      : "",
    criticalState.ecology <= THRESHOLDS.ecologyWarning
      ? `生态完整性 ${criticalState.ecology.toFixed(1)} ≤ ${THRESHOLDS.ecologyWarning}`
      : "",
  ].filter(Boolean)[0] || "现场判定进入临界：多个指标同步逼近阈值";
  const criticalOperation = performAction(criticalState, "cooling");
  advance(criticalState, 6);
  const criticalAfter = snapshot(criticalState);
  const crisisStart = structuredClone(criticalState);

  const failedState = createSimulation(seed);
  failedState.resources.power = 3;
  advance(failedState, 4);
  const failedBefore = snapshot(failedState);
  const failureOperation = performAction(failedState, "cooling");
  advance(failedState, 0.25);
  const failedAfter = snapshot(failedState);

  const rapid = runStrategy(crisisStart, [
    { kind: "cooling" },
    { kind: "drainage" },
    { advance: 4, kind: "drainage" },
    { advance: 4, kind: "cooling" },
  ], 4);
  const staged = runStrategy(crisisStart, [
    { kind: "drainage" },
    { advance: 4, kind: "cooling" },
  ], 10);

  return {
    steady: compareRecord(
      "稳态",
      steadyBefore,
      steadyAfter,
      `地温 ${steadyAfter.metrics.stationTemp}°C ∈ [${THRESHOLDS.stationSafeMin}, ${THRESHOLDS.stationSafeMax}]°C`,
      steadyOperation,
    ),
    critical: compareRecord("临界状态", criticalBefore, criticalAfter, criticalTrigger, criticalOperation),
    failure: compareRecord(
      "失败操作",
      failedBefore,
      failedAfter,
      failureOperation.reason || "资源不足",
      failureOperation,
    ),
    strategies: {
      rapid: { label: "快速导冷 + 连续清沟", ...rapid },
      staged: { label: "夜间冷却 + 分次排水", ...staged },
    },
    thresholds: { ...THRESHOLDS },
  };
}
