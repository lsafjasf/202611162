export const SPECIES = {
  salmon: {
    key: "salmon",
    name: "鲑鱼",
    latin: "Oncorhynchus",
    code: "S",
    color: "#ff8b6b",
    soft: "#ffd0bb",
    flow: [1.0, 1.52],
    depth: [0.9, 1.28],
    light: [0.52, 1.12],
    headMax: 1.62,
    speed: 0.052,
  },
  carp: {
    key: "carp",
    name: "鲤鱼",
    latin: "Cyprinus",
    code: "C",
    color: "#e6b85c",
    soft: "#f3dfad",
    flow: [0.62, 1.0],
    depth: [0.66, 1.06],
    light: [0.26, 0.9],
    headMax: 1.38,
    speed: 0.059,
  },
  eel: {
    key: "eel",
    name: "鳗鲡",
    latin: "Anguilla",
    code: "E",
    color: "#66c7b6",
    soft: "#b6ebe2",
    flow: [0.3, 0.67],
    depth: [0.36, 0.79],
    light: [0.04, 0.46],
    headMax: 1.16,
    speed: 0.047,
  },
};

const WEATHER = [
  { key: "clear", label: "晴", icon: "sun", flow: 0.015, temp: 0.9, turbidity: -2, ambient: 0.06 },
  { key: "cloud", label: "多云", icon: "cloud", flow: -0.01, temp: 0.1, turbidity: 2, ambient: -0.03 },
  { key: "rain", label: "阵雨", icon: "rain", flow: 0.09, temp: -0.6, turbidity: 12, ambient: -0.08 },
  { key: "mist", label: "薄雾", icon: "mist", flow: -0.035, temp: -0.2, turbidity: 5, ambient: -0.02 },
  { key: "clear", label: "晴间云", icon: "sunCloud", flow: 0.005, temp: 0.5, turbidity: 0, ambient: 0.02 },
];

export const DEFAULT_CONTROLS = Object.freeze({ gate: 58, vane: 62, lamp: 32 });
export const RECOVERY_PLANS = Object.freeze({
  gentle: {
    id: "gentle",
    name: "生态缓释",
    tag: "低扰动",
    duration: 18,
    cost: { water: 8, power: 3, stress: 3 },
    description: "小幅增流并抬升导流板，以更少机械冲击缓慢恢复落差。",
  },
  flush: {
    id: "flush",
    name: "脉冲增流",
    tag: "快速",
    duration: 8,
    cost: { water: 20, power: 1, stress: 10 },
    description: "短时增流冲开下游滞留区，快速驱离捕食者但扰动鱼群。",
  },
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const invLerp = (a, b, value) => clamp((value - a) / (b - a), 0, 1);
const smoothstep = (a, b, value) => {
  const t = invLerp(a, b, value);
  return t * t * (3 - 2 * t);
};
const round = (value, digits = 2) => Number(value.toFixed(digits));

export function hashSeed(seed) {
  const text = String(seed || "fishway");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWeather(seed) {
  const random = mulberry32(hashSeed(`${seed}:weather`));
  return Array.from({ length: 12 }, (_, index) => {
    const weather = WEATHER[Math.floor(random() * WEATHER.length)];
    return {
      ...weather,
      id: `W${String(index + 1).padStart(2, "0")}`,
      start: index * 34,
      duration: 34,
      temperature: round(16.4 + weather.temp + random() * 1.8, 1),
      flow: round(weather.flow + (random() - 0.5) * 0.035, 3),
      turbidity: round(weather.turbidity + random() * 4, 1),
    };
  });
}

function createFish(speciesKey, index, random) {
  const species = SPECIES[speciesKey];
  return {
    id: `${species.code}-${String(index + 1).padStart(2, "0")}`,
    species: speciesKey,
    index,
    u: 0.018 + index * 0.013 + random() * 0.008,
    lane: (random() - 0.5) * 0.7,
    size: 0.82 + random() * 0.28,
    speed: species.speed * (0.92 + random() * 0.16),
    stress: round(8 + random() * 10, 1),
    energy: round(96 + random() * 4, 1),
    state: "waiting",
    stateAge: 0,
    progress: 0,
    passedAt: null,
    lastKnownState: "waiting",
  };
}

function buildScenario(seed) {
  const normalizedSeed = String(seed || "FISHWAY-2026").trim().toUpperCase();
  const random = mulberry32(hashSeed(`${normalizedSeed}:targets`));
  const weather = buildWeather(normalizedSeed);
  const fish = [];
  for (const key of Object.keys(SPECIES)) {
    for (let index = 0; index < 3; index += 1) {
      fish.push(createFish(key, index, random));
    }
  }
  const initial = {
    power: 100,
    water: 100,
    targetCount: fish.length,
    weatherId: weather[0].id,
  };
  const fingerprint = `${normalizedSeed}|${fish.map((item) => `${item.id}:${item.stress}:${item.energy}`).join(",")}|${weather.map((item) => item.id + item.key).join(",")}|${initial.power}/${initial.water}`;
  return { normalizedSeed, weather, fish, initial, fingerprint };
}

function environmentTargets(controls, weather) {
  const gate = controls.gate;
  const vane = controls.vane;
  return {
    flow: clamp(0.26 + gate * 0.012 + vane * 0.0015 + weather.flow, 0.16, 1.78),
    depth: clamp(0.32 + gate * 0.006 + vane * 0.004 + weather.flow * 0.17, 0.28, 1.42),
    head: clamp(2.15 - gate * 0.009 - vane * 0.011 + weather.flow * 0.7, 0.32, 2.55),
    turbidity: clamp(10 + vane * 0.15 + weather.turbidity, 2, 52),
  };
}

function cycleHour(time) {
  return (7.5 + (time * 24) / 180) % 24;
}

function ambientLight(time) {
  const hour = cycleHour(time);
  if (hour < 5.8 || hour > 18.2) return 0.06;
  return 0.08 + Math.sin(((hour - 5.8) / 12.4) * Math.PI) * 0.91;
}

function weatherAt(sequence, time) {
  const index = Math.floor(time / 34) % sequence.length;
  const next = sequence[(index + 1) % sequence.length];
  const current = sequence[index];
  const local = time % 34;
  const blend = smoothstep(0, 5, local);
  const source = local < 5 ? sequence[(index - 1 + sequence.length) % sequence.length] : current;
  const target = local < 5 ? current : next;
  const mix = local < 5 ? smoothstep(0, 5, local) : smoothstep(29, 34, local);
  return {
    id: current.id,
    label: current.label,
    icon: current.icon,
    flow: lerp(source.flow, target.flow, mix),
    temperature: lerp(source.temperature, target.temperature, mix),
    turbidity: lerp(source.turbidity, target.turbidity, mix),
    ambient: lerp(source.ambient, target.ambient, mix),
    current,
    next,
    blend,
  };
}

function bandScore(value, min, max, softness) {
  if (value >= min && value <= max) return 1;
  const distance = value < min ? min - value : value - max;
  return clamp(1 - distance / softness, 0, 1);
}

export function fishSuitability(fish, environment) {
  const species = SPECIES[fish.species];
  const flow = bandScore(environment.flow, species.flow[0], species.flow[1], 0.24);
  const depth = bandScore(environment.depth, species.depth[0], species.depth[1], 0.2);
  const light = bandScore(environment.light, species.light[0], species.light[1], 0.18);
  const head = bandScore(environment.head, 0.25, species.headMax, 0.22);
  const score = flow * 0.38 + depth * 0.23 + light * 0.19 + head * 0.2;
  return {
    total: score,
    flow,
    depth,
    light,
    head,
    limiting: [
      ["流速", flow],
      ["水深", depth],
      ["光照", light],
      ["落差", head],
    ].sort((a, b) => a[1] - b[1])[0][0],
  };
}

function currentBiological(sim) {
  const moving = sim.fish.filter((fish) => fish.state === "moving").length;
  const holding = sim.fish.filter((fish) => fish.state === "holding").length;
  const retreating = sim.fish.filter((fish) => fish.state === "retreating").length;
  const trapped = sim.fish.filter((fish) => fish.state === "trapped").length;
  const passed = sim.fish.filter((fish) => fish.state === "passed").length;
  const stress = sim.fish.reduce((sum, fish) => sum + fish.stress, 0) / sim.fish.length;
  return {
    moving,
    holding,
    retreating,
    trapped,
    passed,
    averageStress: round(stress, 1),
    label: trapped
      ? "受困"
      : retreating
        ? "折返"
        : moving
          ? "上溯"
          : passed === sim.fish.length
            ? "完成"
            : holding
              ? "滞留"
              : "等待",
  };
}

function calcEcoScore(sim) {
  const averageSuitability =
    sim.fish.reduce((sum, fish) => sum + fishSuitability(fish, sim.environment).total, 0) / sim.fish.length;
  const stressPenalty = (sim.bio.averageStress / 100) * 28;
  const predatorPenalty = sim.environment.predatorRisk * 24;
  const oxygenBonus = (sim.environment.oxygen - 6) * 2;
  return Math.round(clamp(averageSuitability * 79 + oxygenBonus - stressPenalty - predatorPenalty + 8, 0, 100));
}

export class FishwaySim {
  constructor(seed = "FISHWAY-2026") {
    this.reset(seed);
  }

  reset(seed = this.seed) {
    const scenario = buildScenario(seed);
    this.seed = scenario.normalizedSeed;
    this.scenario = scenario;
    this.weatherSequence = scenario.weather;
    this.time = 0;
    this.controls = { ...DEFAULT_CONTROLS };
    this.controlBaseline = { ...DEFAULT_CONTROLS };
    this.resources = {
      power: scenario.initial.power,
      water: scenario.initial.water,
    };
    this.fish = scenario.fish.map((item) => ({ ...item }));
    this.events = [];
    this.history = [];
    this.operations = [];
    this.recoveryReports = [];
    this.pendingOperation = null;
    this.pendingRecovery = null;
    this.activeRecoveryKind = null;
    this.operationSerial = 0;
    this.predatorActive = false;
    this.predatorRisk = 0;
    this.lowFlowTimer = 0;
    this.highHeadTimer = 0;
    this.success = false;
    this.successAt = null;
    this.groupPassTimes = {};
    this.lastSample = -1;

    const weather = weatherAt(this.weatherSequence, 0);
    const targets = environmentTargets(this.controls, weather);
    this.environment = {
      flow: targets.flow,
      depth: targets.depth,
      head: targets.head,
      turbidity: targets.turbidity,
      light: clamp(ambientLight(0) + this.controls.lamp * 0.0085, 0.06, 1.15),
      temperature: weather.temperature,
      oxygen: 7.9,
      predatorRisk: 0,
    };
    this.bio = currentBiological(this);
    this.ecoScore = calcEcoScore(this);
    this.fingerprint = hashSeed(scenario.fingerprint).toString(16).toUpperCase().padStart(8, "0");
    this.emit("system", "系统", "初始鱼群与天气序列已装载", "info");
    this.sampleHistory(true);
    return this.snapshot();
  }

  emit(type, id, message, severity = "info") {
    const last = this.events[this.events.length - 1];
    const code = `${type}:${id}:${message}`;
    if (last && last.code === code && this.time - last.at < 2) return;
    this.events.push({
      at: round(this.time, 1),
      type,
      id,
      message,
      severity,
      code,
    });
    if (this.events.length > 160) this.events.shift();
  }

  sampleHistory(force = false) {
    if (!force && this.time - this.lastSample < 1) return;
    this.lastSample = this.time;
    this.history.push({
      t: round(this.time, 1),
      flow: round(this.environment.flow, 3),
      depth: round(this.environment.depth, 3),
      head: round(this.environment.head, 3),
      light: round(this.environment.light, 3),
    });
    if (this.history.length > 180) this.history.shift();
  }

  getWeather() {
    return weatherAt(this.weatherSequence, this.time);
  }

  getCycle() {
    const hour = cycleHour(this.time);
    const isNight = hour < 6 || hour > 18.2;
    const weather = this.getWeather();
    const labels = {
      sun: "晴",
      cloud: "多云",
      rain: "阵雨",
      mist: "薄雾",
      sunCloud: "晴间云",
    };
    return {
      hour,
      timeLabel: `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`,
      day: 1 + Math.floor(this.time / 180),
      isNight,
      weather,
      weatherLabel: labels[weather.icon] || weather.label,
      ambientLight: ambientLight(this.time),
    };
  }

  capture() {
    const groupCounts = {};
    for (const key of Object.keys(SPECIES)) {
      const fish = this.fish.filter((item) => item.species === key);
      groupCounts[key] = {
        total: fish.length,
        passed: fish.filter((item) => item.state === "passed").length,
        moving: fish.filter((item) => item.state === "moving").length,
        retreating: fish.filter((item) => item.state === "retreating").length,
        completed: fish.every((item) => item.state === "passed"),
      };
    }
    return {
      t: round(this.time, 1),
      environment: { ...this.environment },
      resources: { ...this.resources },
      bio: { ...this.bio },
      ecoScore: this.ecoScore,
      groups: groupCounts,
      predatorActive: this.predatorActive,
    };
  }

  getGroups() {
    return Object.keys(SPECIES).map((key) => {
      const species = SPECIES[key];
      const fish = this.fish.filter((item) => item.species === key);
      return {
        ...species,
        fish,
        passed: fish.filter((item) => item.state === "passed").length,
        moving: fish.filter((item) => item.state === "moving").length,
        completed: fish.every((item) => item.state === "passed"),
        passedAt: this.groupPassTimes[key] || null,
      };
    });
  }

  updateEnvironment(dt) {
    const weather = this.getWeather();
    const targets = environmentTargets(this.controls, weather);
    const mix = (current, target, speed) => current + (target - current) * Math.min(1, speed * dt);
    this.environment.flow = mix(this.environment.flow, targets.flow, 0.62);
    this.environment.depth = mix(this.environment.depth, targets.depth, 0.5);
    this.environment.head = mix(this.environment.head, targets.head, 0.44);
    this.environment.turbidity = mix(this.environment.turbidity, targets.turbidity, 0.24);
    this.environment.temperature = mix(this.environment.temperature, weather.temperature, 0.18);

    const cycle = this.getCycle();
    const lightTarget = clamp(cycle.ambientLight + this.controls.lamp * 0.0085 + weather.ambient, 0.06, 1.15);
    this.environment.light = mix(this.environment.light, lightTarget, 0.72);
    const oxygenTarget =
      7.05 + this.environment.flow * 0.72 + (19 - this.environment.temperature) * 0.09 -
      this.environment.turbidity * 0.009;
    this.environment.oxygen = mix(this.environment.oxygen, clamp(oxygenTarget, 4.2, 10.2), 0.2);

    const riskTarget = clamp(
      Math.max(0, 0.47 - this.environment.flow) * 2.6 +
        Math.max(0, 0.34 - this.environment.light) * 0.7 +
        this.environment.turbidity * 0.0025,
      0,
      1,
    );
    this.predatorRisk += (riskTarget - this.predatorRisk) * Math.min(1, 0.35 * dt);
    this.environment.predatorRisk = this.predatorRisk;
    const wasActive = this.predatorActive;
    this.predatorActive = this.predatorRisk > 0.5 && this.lowFlowTimer > 2.5;
    if (this.predatorActive && !wasActive) {
      this.emit("predator", "PREDATOR", "低流速区出现捕食者徘徊", "warning");
    } else if (!this.predatorActive && wasActive) {
      this.emit("predator", "PREDATOR", "增流后捕食者离开滞留区", "recovery");
    }

    if (this.environment.flow < 0.38) this.lowFlowTimer += dt;
    else this.lowFlowTimer = 0;
    if (this.environment.head > 1.78) this.highHeadTimer += dt;
    else this.highHeadTimer = 0;

    const powerUse =
      0.035 + this.controls.lamp * 0.0009 + this.controls.vane * 0.00012 + (cycle.isNight ? 0.016 : 0);
    const waterUse = 0.009 + this.controls.gate * 0.00055 + this.environment.flow * 0.005;
    this.resources.power = clamp(this.resources.power - powerUse * dt, 0, 100);
    this.resources.water = clamp(this.resources.water - waterUse * dt, 0, 100);
  }

  setFishState(fish, state) {
    if (fish.state === state) return;
    fish.state = state;
    fish.stateAge = 0;
    const species = SPECIES[fish.species];
    if (state === "moving" && fish.lastKnownState !== "moving") {
      this.emit("fish", fish.id, `${species.name} ${fish.id} 开始上溯`, "ok");
    } else if (state === "retreating") {
      this.emit("fish", fish.id, `${species.name} ${fish.id} 因环境失配折返`, "danger");
    } else if (state === "trapped") {
      this.emit("fish", fish.id, `${species.name} ${fish.id} 滞留下游受捕食者威胁`, "danger");
    } else if (state === "holding" && fish.lastKnownState === "moving") {
      this.emit("fish", fish.id, `${species.name} ${fish.id} 停止推进，等待窗口`, "warning");
    }
    fish.lastKnownState = state;
  }

  updateFish(dt) {
    for (const fish of this.fish) {
      if (fish.state === "passed") continue;
      const species = SPECIES[fish.species];
      const suitability = fishSuitability(fish, this.environment);
      fish.stateAge += dt;
      const stressTarget =
        7 +
        (1 - suitability.total) * 58 +
        this.environment.predatorRisk * 18 +
        Math.max(0, this.environment.head - species.headMax) * 16;
      fish.stress += (stressTarget - fish.stress) * Math.min(1, 0.42 * dt);

      if (fish.state === "trapped") {
        fish.stress += 4.5 * dt;
        if (this.environment.flow > 0.43 || this.predatorRisk < 0.3) {
          this.setFishState(fish, "waiting");
          this.emit("fish", fish.id, `${species.name} ${fish.id} 脱离滞留区`, "recovery");
        }
        fish.stress = clamp(fish.stress, 0, 100);
        continue;
      }

      const headFailure = this.environment.head > species.headMax + 0.12;
      const flowFailure = this.environment.flow > species.flow[1] * 1.36;
      const fit =
        suitability.total >= 0.67 &&
        suitability.flow > 0.5 &&
        suitability.depth > 0.5 &&
        suitability.head > 0.45;

      if (fit) {
        if (fish.state !== "moving") this.setFishState(fish, "moving");
        fish.u += fish.speed * (0.64 + suitability.total * 0.68) * dt;
        fish.energy = clamp(fish.energy - 0.075 * dt, 0, 100);
        fish.progress = round(fish.u * 100, 1);
        if (fish.u >= 0.955) {
          fish.u = 1;
          fish.state = "passed";
          fish.passedAt = round(this.time, 1);
          fish.stress = clamp(fish.stress - 5, 0, 100);
          this.emit("fish", fish.id, `${species.name} ${fish.id} 完成过鱼记录`, "success");
          const group = this.fish.filter((item) => item.species === fish.species);
          if (group.every((item) => item.state === "passed") && !this.groupPassTimes[fish.species]) {
            this.groupPassTimes[fish.species] = round(this.time, 1);
            this.emit("group", species.code, `${species.name}组 3/3 全部通过`, "success");
          }
        }
      } else if (headFailure || flowFailure || fish.stress > 82) {
        if (fish.state !== "retreating") this.setFishState(fish, "retreating");
        fish.u = Math.max(0.012, fish.u - fish.speed * 1.55 * dt);
        fish.energy = clamp(fish.energy - 0.16 * dt, 0, 100);
        if (fish.u <= 0.015 && fish.stateAge > 2) this.setFishState(fish, "waiting");
      } else {
        if (fish.state === "moving" || fish.state === "retreating") this.setFishState(fish, "holding");
        else if (fish.state === "waiting" && this.time > 5) this.setFishState(fish, "holding");
      }

      if (
        this.predatorActive &&
        fish.u < 0.34 &&
        this.lowFlowTimer > 7 &&
        this.predatorRisk > 0.62
      ) {
        this.setFishState(fish, "trapped");
      } else if (!this.predatorActive && fish.energy > 22 && fish.state !== "moving") {
        fish.energy = clamp(fish.energy + 0.03 * dt, 0, 100);
      }
      fish.stress = clamp(fish.stress, 0, 100);
    }

    this.bio = currentBiological(this);
    this.ecoScore = calcEcoScore(this);
    const completed = Object.keys(SPECIES).filter((key) =>
      this.fish.filter((fish) => fish.species === key).every((fish) => fish.state === "passed"),
    );
    if (completed.length === 3 && !this.success) {
      this.success = true;
      this.successAt = round(this.time, 1);
      this.emit("system", "MISSION", "三组过鱼记录全部完成", "success");
    }
  }

  step(dt = 0.1) {
    if (this.success) {
      this.time += dt;
      this.sampleHistory();
      return;
    }
    this.time += dt;
    this.updateEnvironment(dt);
    this.updateFish(dt);
    this.sampleHistory();
    if (this.pendingOperation && this.time >= this.pendingOperation.dueAt) {
      this.finalizeOperation();
    }
    if (this.pendingRecovery && this.time >= this.pendingRecovery.dueAt) {
      this.finalizeRecovery();
    }
  }

  applyControls(nextControls, meta = {}) {
    if (this.pendingOperation) this.finalizeOperation();
    const beforeControls = { ...this.controls };
    const before = this.capture();
    const cursor = this.events.length;
    this.controls = {
      gate: Math.round(clamp(nextControls.gate ?? this.controls.gate, 0, 100)),
      vane: Math.round(clamp(nextControls.vane ?? this.controls.vane, 0, 100)),
      lamp: Math.round(clamp(nextControls.lamp ?? this.controls.lamp, 0, 100)),
    };
    this.operationSerial += 1;
    const operation = {
      id: `OP-${String(this.operationSerial).padStart(2, "0")}`,
      label: meta.label || "鱼道参数调节",
      type: "adjustment",
      status: "observing",
      at: round(this.time, 1),
      dueAt: round(this.time + 4.4, 1),
      beforeControls,
      afterControls: { ...this.controls },
      before,
      after: null,
      outcome: null,
      reason: "正在 4.4 秒窗口内观察鱼群响应",
      eventCursor: cursor,
      strategy: meta.strategy || null,
    };
    this.operations.push(operation);
    this.pendingOperation = operation;
    this.emit(
      "control",
      operation.id,
      `闸门 ${this.controls.gate}% · 导流板 ${this.controls.vane}% · 照明 ${this.controls.lamp}%`,
      "info",
    );
    return operation;
  }

  finalizeOperation() {
    const operation = this.pendingOperation;
    if (!operation) return null;
    const after = this.capture();
    const newEvents = this.events.slice(operation.eventCursor);
    const retreated = newEvents.some((event) => event.type === "fish" && event.message.includes("折返"));
    const trapped = newEvents.some((event) => event.type === "fish" && event.message.includes("受困"));
    const predator = newEvents.some((event) => event.type === "predator");
    const stressRise = after.bio.averageStress - operation.before.bio.averageStress;
    const ecoDrop = operation.before.ecoScore - after.ecoScore;
    const forecast = this.forecast(this.controls);
    const severeHead =
      after.environment.head > 1.72 ||
      forecast.environment.head > 1.78 ||
      after.environment.predatorRisk > 0.57 ||
      forecast.environment.predatorRisk > 0.62 ||
      trapped ||
      after.bio.averageStress > 66;
    const critical =
      retreated ||
      predator ||
      stressRise > 5 ||
      ecoDrop > 8 ||
      after.environment.flow < 0.4 ||
      after.bio.holding > 0;

    let outcome = "stable";
    let reason = "环境保持在目标鱼群耐受带内，推进稳定";
    if (severeHead) {
      outcome = "failure";
      reason = trapped
        ? "低流速滞留触发捕食风险，鱼群受困"
        : after.environment.head > 1.72 || forecast.environment.head > 1.78
          ? "有效落差超过恢复阈值，鱼群折返"
          : "生态得分快速下降，本操作判定失败";
    } else if (critical) {
      outcome = "critical";
      reason = retreated
        ? "阈值边缘触发折返，需微调导流板"
        : after.bio.holding > 0
          ? "部分鱼群滞留，环境处于临界带"
          : "流速或光照接近耐受边界，需继续观察";
    }

    operation.status = "complete";
    operation.after = after;
    operation.outcome = outcome;
    operation.reason = reason;
    operation.completedAt = round(this.time, 1);
    operation.delta = {
      time: round(this.time - operation.at, 1),
      power: round(after.resources.power - operation.before.resources.power, 1),
      water: round(after.resources.water - operation.before.resources.water, 1),
      stress: round(stressRise, 1),
      eco: after.ecoScore - operation.before.ecoScore,
      passed: after.bio.passed - operation.before.bio.passed,
    };
    operation.experiment = outcome;
    this.pendingOperation = null;
    const labels = { stable: "稳态", critical: "临界", failure: "失败" };
    this.emit("operation", operation.id, `操作判定：${labels[outcome]} · ${reason}`, outcome === "failure" ? "danger" : outcome);
    return operation;
  }

  getTrigger() {
    const flowTriggered = this.environment.flow < 0.38;
    const headTriggered = this.environment.head > 1.78;
    const predatorTriggered = this.predatorRisk > 0.52 || this.predatorActive;
    const stressTriggered = this.bio.averageStress > 58;
    const active = flowTriggered || headTriggered || predatorTriggered || stressTriggered;
    let label = "手动预防";
    let detail = "当前未越过自动触发线";
    if (headTriggered) {
      label = "落差超限";
      detail = `有效落差 ${this.environment.head.toFixed(2)} m > 1.78 m`;
    } else if (predatorTriggered) {
      label = "捕食风险";
      detail = `捕食风险 ${(this.predatorRisk * 100).toFixed(0)}% > 52%`;
    } else if (flowTriggered) {
      label = "低流速";
      detail = `流速 ${this.environment.flow.toFixed(2)} m/s < 0.38 m/s · 持续 ${this.lowFlowTimer.toFixed(1)} s`;
    } else if (stressTriggered) {
      label = "应激超限";
      detail = `平均应激 ${this.bio.averageStress.toFixed(1)} > 58`;
    }
    return { active, label, detail, flowTriggered, headTriggered, predatorTriggered, stressTriggered };
  }

  forecast(controls) {
    const weather = this.getWeather();
    const targets = environmentTargets(controls, weather);
    const cycle = this.getCycle();
    const light = clamp(cycle.ambientLight + controls.lamp * 0.0085 + weather.ambient, 0.06, 1.15);
    const oxygen =
      7.05 + targets.flow * 0.72 + (19 - weather.temperature) * 0.09 - targets.turbidity * 0.009;
    const risk = clamp(
      Math.max(0, 0.47 - targets.flow) * 2.6 +
        Math.max(0, 0.34 - light) * 0.7 +
        targets.turbidity * 0.0025,
      0,
      1,
    );
    const pseudo = {
      fish: this.fish,
      environment: {
        ...this.environment,
        ...targets,
        light,
        oxygen,
        predatorRisk: risk,
      },
      bio: this.bio,
    };
    return {
      environment: pseudo.environment,
      ecoScore: calcEcoScore(pseudo),
    };
  }

  recoveryPreview(kind) {
    const plan = RECOVERY_PLANS[kind];
    if (!plan) return null;
    const gateDelta = kind === "gentle" ? 6 : 20;
    const vaneDelta = kind === "gentle" ? 18 : 4;
    const lampDelta = kind === "gentle" ? 0 : -4;
    const controls = {
      gate: Math.round(clamp(this.controls.gate + gateDelta, 0, 100)),
      vane: Math.round(clamp(this.controls.vane + vaneDelta, 0, 100)),
      lamp: Math.round(clamp(this.controls.lamp + lampDelta, 0, 100)),
    };
    const forecast = this.forecast(controls);
    return {
      ...plan,
      controls,
      trigger: this.getTrigger(),
      currentEco: this.ecoScore,
      forecastEco: forecast.ecoScore,
      available: this.resources.water >= plan.cost.water && this.resources.power >= plan.cost.power,
    };
  }

  startRecovery(kind) {
    const preview = this.recoveryPreview(kind);
    if (!preview || !preview.available) return null;
    if (this.pendingRecovery) this.finalizeRecovery();
    if (this.pendingOperation) this.finalizeOperation();
    const before = this.capture();
    const trigger = this.getTrigger();
    this.resources.water = clamp(this.resources.water - preview.cost.water, 0, 100);
    this.resources.power = clamp(this.resources.power - preview.cost.power, 0, 100);
    this.controls = { ...preview.controls };
    for (const fish of this.fish) {
      fish.stress = clamp(fish.stress + preview.cost.stress, 0, 100);
    }
    const report = {
      id: `R-${String(this.recoveryReports.length + 1).padStart(2, "0")}`,
      kind,
      name: preview.name,
      status: "running",
      at: round(this.time, 1),
      dueAt: round(this.time + preview.duration, 1),
      duration: preview.duration,
      trigger,
      cost: { ...preview.cost },
      before,
      after: null,
      forecastEco: preview.forecastEco,
      outcome: null,
    };
    this.recoveryReports.push(report);
    this.pendingRecovery = report;
    this.activeRecoveryKind = kind;
    this.emit("recovery", report.id, `${preview.name}启动 · ${trigger.label} · 水量 -${preview.cost.water}%`, "info");
    return report;
  }

  finalizeRecovery() {
    const report = this.pendingRecovery;
    if (!report) return null;
    const after = this.capture();
    report.status = "complete";
    report.completedAt = round(this.time, 1);
    report.after = after;
    report.finalEco = after.ecoScore;
    report.ecoDelta = after.ecoScore - report.before.ecoScore;
    report.final = {
      flow: round(after.environment.flow, 2),
      head: round(after.environment.head, 2),
      light: round(after.environment.light, 2),
      predatorRisk: round(after.environment.predatorRisk, 2),
      oxygen: round(after.environment.oxygen, 2),
      averageStress: after.bio.averageStress,
      ecoScore: after.ecoScore,
    };
    report.outcome = report.ecoDelta >= 0 ? "improved" : "degraded";
    this.pendingRecovery = null;
    this.activeRecoveryKind = null;
    const sign = report.ecoDelta >= 0 ? "+" : "";
    this.emit(
      "recovery",
      report.id,
      `${report.name}完成 · 生态 ${report.before.ecoScore} → ${after.ecoScore} (${sign}${report.ecoDelta})`,
      report.ecoDelta >= 0 ? "recovery" : "warning",
    );
    return report;
  }

  getEventTrace() {
    return this.events
      .filter((event) => ["fish", "predator", "group", "operation", "recovery"].includes(event.type))
      .map((event) => ({
        at: event.at,
        key: `${event.type}|${event.id}|${event.message}`,
        message: event.message,
      }));
  }

  getEventSignature() {
    return hashSeed(this.getEventTrace().map((item) => item.key).join(">")).toString(16).toUpperCase().padStart(8, "0");
  }

  snapshot() {
    return {
      seed: this.seed,
      fingerprint: this.fingerprint,
      time: round(this.time, 2),
      cycle: this.getCycle(),
      controls: { ...this.controls },
      resources: { ...this.resources },
      environment: { ...this.environment },
      bio: { ...this.bio },
      ecoScore: this.ecoScore,
      groups: this.getGroups().map(({ fish, ...group }) => group),
      predatorActive: this.predatorActive,
      pendingOperation: this.pendingOperation,
      lastOperation: this.operations[this.operations.length - 1] || null,
      activeRecovery: this.pendingRecovery,
      success: this.success,
      successAt: this.successAt,
      trigger: this.getTrigger(),
      eventSignature: this.getEventSignature(),
    };
  }
}
