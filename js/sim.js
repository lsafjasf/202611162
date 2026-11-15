import { createRng, hashObject, smoothstep } from "./rng.js";

export const STEP_SECONDS = 1 / 30;
export const MINUTES_PER_SECOND = 6;
export const SIM_START = 6 * 60;
export const SIM_END = 18 * 60;
export const IDEAL_TEMP = { min: 19, max: 28 };
export const RECOVERY_THRESHOLDS = { health: 60, temperature: 31, population: 30 };

export const CROPS = [
  {
    id: "tomato",
    name: "番茄",
    latin: "Solanum lycopersicum",
    flowerCount: 8,
    pace: 0.96,
    flower: "#f4d97d",
    fruit: "#e46f43",
    leaf: "#5f8b4b",
  },
  {
    id: "strawberry",
    name: "草莓",
    latin: "Fragaria × ananassa",
    flowerCount: 10,
    pace: 1.04,
    flower: "#f3ecdb",
    fruit: "#d94a3f",
    leaf: "#4e8054",
  },
  {
    id: "pepper",
    name: "辣椒",
    latin: "Capsicum annuum",
    flowerCount: 9,
    pace: 0.84,
    flower: "#f7f0db",
    fruit: "#d4a63c",
    leaf: "#557f49",
  },
];

export const SCENARIOS = {
  steady: {
    seed: "20261116",
    controls: { releaseHour: 7, thermostat: 24, shade: 32, fan: 1 },
    script: [],
    label: "稳态基线",
  },
  critical: {
    seed: "20261117",
    controls: { releaseHour: 7, thermostat: 32, shade: 15, fan: 1 },
    script: [
      { at: 10 * 60 + 10, kind: "recovery", payload: { strategy: "ecology" } },
    ],
    label: "热临界",
  },
  failure: {
    seed: "20261118",
    controls: { releaseHour: 9.5, thermostat: 30, shade: 10, fan: 0 },
    script: [
      { at: 9 * 60 + 40, kind: "spray", payload: { dose: 2.6 } },
      { at: 11 * 60 + 10, kind: "spray", payload: { dose: 2.6 } },
    ],
    label: "药害失败",
  },
};

const WEATHER_LABELS = ["晴", "云隙光", "薄云", "多云"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

export function formatClock(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function temperatureFactor(temperature) {
  if (temperature < 12) return 0.02;
  if (temperature < 19) return lerp(0.08, 0.9, (temperature - 12) / 7);
  if (temperature <= IDEAL_TEMP.max) return 1;
  if (temperature < 34) return lerp(0.95, 0.12, (temperature - IDEAL_TEMP.max) / 6);
  return 0.03;
}

export class GreenhouseSim {
  constructor(seed = "20261116", options = {}) {
    this.reset(seed, options);
  }

  reset(seed, options = {}) {
    this.seed = String(seed).trim() || "20261116";
    this.controls = {
      releaseHour: 7,
      thermostat: 24,
      shade: 32,
      fan: 1,
      ...(options.controls || {}),
    };
    this.minutes = SIM_START;
    this.accumulator = 0;
    this.tickCount = 0;
    this.running = true;
    this.ended = false;
    this.result = null;
    this.scenario = options.scenario || null;
    this.actions = [];
    this.replayQueue = [];
    this.replayIndex = 0;
    this.replayMode = false;
    this.scriptQueue = [];
    this.events = [];
    this.recoveries = [];
    this.pendingEvaluations = [];
    this.thresholds = {};
    this.temperatureHistory = [];
    this.weather = this.buildWeather();

    const initRng = createRng(`${this.seed}:initial-resources`);
    const targetRng = createRng(`${this.seed}:target-individual`);
    this.initialResources = {
      budget: 112 + initRng.int(0, 16),
      pollen: 61 + initRng.int(0, 7),
      population: 39 + initRng.int(0, 5),
      health: 90 + initRng.int(0, 5),
    };
    this.budget = this.initialResources.budget;
    this.spent = 0;
    this.pollen = this.initialResources.pollen;
    this.population = this.initialResources.population;
    this.health = this.initialResources.health;
    this.trackedBee = {
      id: `B-${String(targetRng.int(10, 54)).padStart(2, "0")}`,
      role: "采集蜂",
    };

    this.temperature = this.controls.thermostat;
    this.humidity = 63;
    this.light = 240;
    this.solar = 0.22;
    this.outsideTemp = 19;
    this.wind = 1.4;
    this.cloud = 0.55;
    this.activity = 0;
    this.activeBees = 0;
    this.pesticideResidual = 0;
    this.pestPressure = 0.48;
    this.ventMinutes = 0;
    this.ecologyMinutes = 0;
    this.lastSprayDose = 0;
    this.lastPollenRate = 0;
    this.pollinationTotal = 0;
    this.lastOperation = {
      at: this.minutes,
      tone: "neutral",
      title: "实验初始化完成，温控系统正在稳定温室。",
      delta: "等待出巢",
      icon: "◎",
    };
    this.crops = CROPS.map((crop, cropIndex) => ({
      ...crop,
      index: cropIndex,
      pollination: 0,
      fruitAt: null,
      flowers: Array.from({ length: crop.flowerCount }, (_, flowerIndex) => ({
        id: `${crop.id}-${flowerIndex + 1}`,
        threshold: ((flowerIndex + 1) / crop.flowerCount) * 100,
        phase: targetRng.between(0, Math.PI * 2),
      })),
    }));

    const firstWeather = this.weather[0];
    this.addEvent({
      kind: "system",
      title: "实验序列建立",
      detail: `追踪蜂 #${this.trackedBee.id} · 初始 ¥${this.budget} / 花粉 ${this.pollen}% / ${this.population} 只`,
      severity: "neutral",
    });
    this.addEvent({
      kind: "weather",
      title: `天气序列载入 · ${firstWeather.label}`,
      detail: `${formatClock(this.minutes)} 起连续插值，外界 ${firstWeather.outside.toFixed(1)}°C`,
      severity: "neutral",
    });
    this.primeEnvironment();
    this.sampleTemperature();
    this.queueScript(options.script || []);
    return this;
  }

  buildWeather() {
    const rng = createRng(`${this.seed}:weather-sequence`);
    const points = [];
    for (let index = 0; index <= 15; index += 1) {
      const hour = 6 + index;
      const sunCurve = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      const cloud = clamp(rng.between(0.06, 0.8), 0.06, 0.8);
      const label =
        sunCurve > 0.68 && cloud < 0.3
          ? "晴热"
          : cloud < 0.24
            ? "晴"
            : cloud < 0.48
              ? WEATHER_LABELS[1]
              : cloud < 0.68
                ? WEATHER_LABELS[2]
                : WEATHER_LABELS[3];
      points.push({
        hour,
        outside: 18.2 + sunCurve * 8.6 + rng.between(-0.9, 0.9),
        cloud,
        wind: 0.7 + rng.between(0, 2.2),
        solar: sunCurve,
        label,
      });
    }
    return points;
  }

  primeEnvironment() {
    const weather = this.weatherAt(this.minutes);
    this.outsideTemp = weather.outside;
    this.cloud = weather.cloud;
    this.solar = weather.solar;
    this.wind = weather.wind;
    this.light = this.computeLight();
    this.temperature = this.equilibriumTemperature() - 0.35;
    this.updateActivity(0);
  }

  weatherAt(minutes) {
    const position = clamp((minutes - SIM_START) / 60, 0, this.weather.length - 1.001);
    const index = Math.floor(position);
    const fraction = smoothstep(position - index);
    const current = this.weather[index];
    const next = this.weather[Math.min(index + 1, this.weather.length - 1)];
    return {
      index,
      fraction,
      outside: lerp(current.outside, next.outside, fraction),
      cloud: lerp(current.cloud, next.cloud, fraction),
      wind: lerp(current.wind, next.wind, fraction),
      solar: lerp(current.solar, next.solar, fraction),
      label: fraction > 0.58 ? next.label : current.label,
      nextLabel: next.label,
      nextChange: Math.max(0, (index + 1) * 60 + SIM_START - minutes),
      sequence: [current.label, next.label, this.weather[Math.min(index + 2, 15)].label],
    };
  }

  computeLight() {
    const daylight = 0.08 + 0.92 * clamp(this.solar, 0, 1);
    return Math.round(daylight * (1 - this.controls.shade * 0.0082) * (1 - this.cloud * 0.35) * 980);
  }

  equilibriumTemperature() {
    const outletCooling = this.controls.fan * (0.9 + this.controls.fan * 0.5);
    const ventCooling = this.ventMinutes > 0 ? 2.2 : 0;
    const ecologyCooling = this.ecologyMinutes > 0 ? 0.8 : 0;
    return (
      this.controls.thermostat * 0.73 +
      this.outsideTemp * 0.18 +
      this.solar * (1 - this.controls.shade * 0.0085) * 7.1 -
      outletCooling -
      ventCooling -
      ecologyCooling
    );
  }

  updateActivity(dtMinutes) {
    const clock = this.minutes;
    const releaseStart = this.controls.releaseHour * 60;
    const releaseEnd = 17 * 60 + 30;
    const released = clock >= releaseStart && clock <= releaseEnd ? 1 : 0;
    const healthFactor = 0.48 + this.health / 190;
    const pollenFactor = 0.28 + (this.pollen / 100) * 0.72;
    const lightFactor = 0.12 + clamp(this.light / 700, 0, 1) * 0.88;
    const shadePenalty = 1 - this.controls.shade * 0.0035;
    const toxicityFactor = clamp(1 - this.pesticideResidual * 0.72, 0.06, 1);
    const temperature = temperatureFactor(this.temperature);
    const ecologicalBoost = this.ecologyMinutes > 0 ? 1.07 : 1;
    const target =
      this.population *
      released *
      healthFactor *
      pollenFactor *
      lightFactor *
      temperature *
      shadePenalty *
      toxicityFactor *
      ecologicalBoost;
    const response = dtMinutes > 0 ? 1 - Math.exp(-dtMinutes / 2.6) : 1;
    this.activeBees += (clamp(target, 0, this.population) - this.activeBees) * response;
    this.activity = clamp((this.activeBees / Math.max(1, this.population)) * 100, 0, 100);
  }

  advance(realSeconds, speed = 1) {
    if (!this.running || this.ended) return;
    this.accumulator += clamp(realSeconds, 0, 0.2) * speed;
    let steps = 0;
    while (this.accumulator + 1e-9 >= STEP_SECONDS && steps < 120 && !this.ended) {
      this.applyScheduledActions(this.minutes);
      this.step(STEP_SECONDS * MINUTES_PER_SECOND);
      this.accumulator -= STEP_SECONDS;
      steps += 1;
    }
  }

  step(dtMinutes) {
    this.minutes = Math.min(SIM_END, this.minutes + dtMinutes);
    this.tickCount += 1;
    const weather = this.weatherAt(this.minutes);
    this.outsideTemp = weather.outside;
    this.cloud = weather.cloud;
    this.solar = weather.solar;
    this.wind = weather.wind;
    this.light = this.computeLight();

    const previousTemp = this.temperature;
    const equilibrium = this.equilibriumTemperature();
    this.temperature += (equilibrium - this.temperature) * (1 - Math.exp(-dtMinutes / 34));
    const humidityTarget =
      67 - (this.temperature - 21) * 1.15 - this.solar * 4.5 + this.controls.fan * 2.1;
    this.humidity += (humidityTarget - this.humidity) * (1 - Math.exp(-dtMinutes / 42));

    this.ventMinutes = Math.max(0, this.ventMinutes - dtMinutes);
    this.ecologyMinutes = Math.max(0, this.ecologyMinutes - dtMinutes);
    this.pesticideResidual *= Math.exp(-dtMinutes / 118);
    if (this.pesticideResidual < 0.002) this.pesticideResidual = 0;
    this.pestPressure += (0.48 - this.pestPressure) * (1 - Math.exp(-dtMinutes / 220));
    this.updateActivity(dtMinutes);

    const pollenRate = this.activeBees * 0.00155;
    this.lastPollenRate = pollenRate;
    this.pollen = clamp(this.pollen - pollenRate * dtMinutes, 0, 100);

    this.updateCrops(dtMinutes);
    this.updateColony(dtMinutes);
    this.updateWeatherEvents(weather);
    this.updateThresholdEvents(previousTemp);
    this.updateRecoveryEvaluations();
    this.sampleTemperature();
    this.checkOutcome();
  }

  updateCrops(dtMinutes) {
    for (const crop of this.crops) {
      if (crop.pollination >= 100) continue;
      const healthEfficiency = 0.72 + this.health / 340;
      const gain =
        this.activeBees *
        crop.pace *
        healthEfficiency *
        0.0155 *
        (0.82 + this.light / 5000) *
        dtMinutes;
      const next = clamp(crop.pollination + gain, 0, 100);
      this.pollinationTotal += next - crop.pollination;
      crop.pollination = next;
      if (next >= 100 && crop.fruitAt === null) {
        crop.fruitAt = this.minutes;
        this.addEvent({
          kind: "fruit",
          title: `${crop.name}完成充分授粉并坐果`,
          detail: `累计授粉 100% · 用时 ${formatDuration(this.minutes - SIM_START)}`,
          severity: "success",
          metrics: this.metrics(),
        });
      }
    }
  }

  updateColony(dtMinutes) {
    const heatStress = Math.max(0, this.temperature - 29) / 7;
    const coldStress = Math.max(0, 18 - this.temperature) / 5;
    const pollenStress = this.pollen < 22 ? ((22 - this.pollen) / 22) * 0.55 : 0;
    const ecologyRecovery = this.ecologyMinutes > 0 ? 8 : 0;
    const healthTarget = clamp(
      94 -
        heatStress * 61 -
        coldStress * 44 -
        this.pesticideResidual * 46 -
        pollenStress * 22 -
        this.pestPressure * 4 +
        ecologyRecovery,
      3,
      98,
    );
    this.health += (healthTarget - this.health) * (1 - Math.exp(-dtMinutes / 72));
    if (this.temperature > 33.2) {
      this.health -= (this.temperature - 33.2) * 0.026 * dtMinutes;
    }
    if (this.pesticideResidual > 0.3) {
      this.health -= this.pesticideResidual * 0.018 * dtMinutes;
    }
    this.health = clamp(this.health, 0, 100);

    if (this.health < 40) {
      this.population -= (40 - this.health) * 0.0019 * dtMinutes;
    }
    this.population = clamp(this.population, 0, 80);
  }

  updateWeatherEvents(weather) {
    if (this.lastWeatherIndex === undefined) this.lastWeatherIndex = 0;
    if (weather.index > this.lastWeatherIndex && weather.index % 2 === 0) {
      this.lastWeatherIndex = weather.index;
      const point = this.weather[weather.index];
      this.addEvent({
        kind: "weather",
        title: `天气转变 · ${point.label}`,
        detail: `外界 ${point.outside.toFixed(1)}°C · 云量 ${Math.round(point.cloud * 100)}% · 风 ${point.wind.toFixed(1)} m/s`,
        severity: "neutral",
      });
    }
  }

  updateThresholdEvents(previousTemp) {
    const clock = this.minutes;
    const releaseStart = this.controls.releaseHour * 60;
    if (!this.thresholds.released && clock >= releaseStart) {
      this.thresholds.released = true;
      this.addEvent({
        kind: "milestone",
        title: "放蜂闸门开启",
        detail: `${this.controls.releaseHour.toFixed(1).replace(".0", "")}:00 · ${Math.round(this.activeBees)} 只工蜂开始出巢`,
        severity: "neutral",
        metrics: this.metrics(),
      });
    }
    if (!this.thresholds.highHeat && this.temperature > RECOVERY_THRESHOLDS.temperature) {
      this.thresholds.highHeat = true;
      this.addEvent({
        kind: "critical",
        title: "温室温度越过临界阈值",
        detail: `${this.temperature.toFixed(1)}°C > ${RECOVERY_THRESHOLDS.temperature}°C · 活跃度降至 ${Math.round(this.activity)}%`,
        severity: "danger",
        metrics: this.metrics(),
      });
    }
    if (!this.thresholds.lowHealth && this.health < RECOVERY_THRESHOLDS.health) {
      this.thresholds.lowHealth = true;
      this.addEvent({
        kind: "critical",
        title: "蜂群健康跌破恢复阈值",
        detail: `健康 ${this.health.toFixed(0)} < ${RECOVERY_THRESHOLDS.health} · 种群 ${this.population.toFixed(0)} 只`,
        severity: "danger",
        metrics: this.metrics(),
      });
    }
    if (!this.thresholds.lowPollen && this.pollen < 20) {
      this.thresholds.lowPollen = true;
      this.addEvent({
        kind: "critical",
        title: "可用花粉进入低位",
        detail: `库存 ${this.pollen.toFixed(0)}% · 采集活跃度受到抑制`,
        severity: "warning",
        metrics: this.metrics(),
      });
    }

    const needsRecovery =
      this.health < RECOVERY_THRESHOLDS.health ||
      this.temperature > RECOVERY_THRESHOLDS.temperature ||
      this.population < RECOVERY_THRESHOLDS.population;
    if (needsRecovery && !this.recoveryTriggered) {
      this.recoveryTriggered = true;
      this.triggerSnapshot = this.metrics();
      this.addEvent({
        kind: "recovery",
        title: "恢复协议进入可执行状态",
        detail: `触发：${this.recoveryTriggerText()} · 预算 ¥${this.budget} · 可比较 A / B 方案`,
        severity: "warning",
        metrics: this.triggerSnapshot,
      });
    }
    if (!needsRecovery && this.temperature < 29 && this.health > 65) {
      this.recoveryTriggered = false;
    }
  }

  recoveryTriggerText() {
    const reasons = [];
    if (this.health < RECOVERY_THRESHOLDS.health) {
      reasons.push(`健康 ${this.health.toFixed(0)} < ${RECOVERY_THRESHOLDS.health}`);
    }
    if (this.temperature > RECOVERY_THRESHOLDS.temperature) {
      reasons.push(`温度 ${this.temperature.toFixed(1)}°C > ${RECOVERY_THRESHOLDS.temperature}°C`);
    }
    if (this.population < RECOVERY_THRESHOLDS.population) {
      reasons.push(`工蜂 ${this.population.toFixed(0)} < ${RECOVERY_THRESHOLDS.population}`);
    }
    return reasons.join(" · ") || "指标接近临界";
  }

  setControl(key, value, options = {}) {
    const config = {
      releaseHour: [6, 13],
      thermostat: [18, 34],
      shade: [0, 85],
      fan: [0, 2],
    }[key];
    if (!config) throw new Error(`Unknown control: ${key}`);
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Invalid value for ${key}`);
    this.controls[key] = clamp(numeric, config[0], config[1]);
    if (options.record && !this.replayMode) {
      this.recordAction("control", { key, value: this.controls[key] });
    }
    return { ok: true, key, value: this.controls[key] };
  }

  recordAction(kind, payload) {
    this.actions.push({
      at: Number(this.minutes.toFixed(2)),
      kind,
      payload: { ...payload },
    });
  }

  perform(kind, payload = {}, options = {}) {
    if (this.ended) return { ok: false, message: "实验已经结束" };
    const record = options.record !== false;
    const result = this.applyActionCore({ kind, payload });
    if (record && result.ok && !this.replayMode) this.recordAction(kind, payload);
    return result;
  }

  applyActionCore(action) {
    switch (action.kind) {
      case "control":
        return this.setControl(action.payload.key, action.payload.value, { record: false });
      case "spray":
        return this.spray(action.payload.dose, { record: false });
      case "vent":
        return this.vent({ record: false });
      case "feed":
        return this.feed({ record: false });
      case "recovery":
        return this.useRecovery(action.payload.strategy, { record: false });
      default:
        return { ok: false, message: `未知操作 ${action.kind}` };
    }
  }

  spend(amount) {
    if (this.budget < amount) return false;
    this.budget -= amount;
    this.spent += amount;
    return true;
  }

  spray(rawDose, options = {}) {
    const dose = [1, 1.6, 2.6].includes(Number(rawDose)) ? Number(rawDose) : 1;
    const before = this.metrics();
    if (!this.spend(6)) {
      this.lastOperation = {
        at: this.minutes,
        tone: "danger",
        title: "喷药未执行：实验预算不足。",
        delta: "预算需 ¥6",
        icon: "×",
      };
      return { ok: false, message: "预算不足" };
    }
    const lossRate = dose === 1 ? 0.012 : dose === 1.6 ? 0.12 : 0.25;
    const healthLoss = dose === 1 ? 1.1 : dose === 1.6 ? 9 : 22;
    const populationLoss = Math.max(1, Math.round(this.population * lossRate));
    this.population = Math.max(0, this.population - populationLoss);
    this.health = clamp(this.health - healthLoss, 0, 100);
    this.pesticideResidual = clamp(
      this.pesticideResidual + (dose === 1 ? 0.07 : dose === 1.6 ? 0.42 : 1.02),
      0,
      1.35,
    );
    this.pestPressure = Math.max(0.08, this.pestPressure - (dose === 1 ? 0.3 : 0.44));
    this.lastSprayDose = dose;
    const danger = dose > 1;
    this.lastOperation = {
      at: this.minutes,
      tone: danger ? "danger" : "neutral",
      title: danger
        ? `${dose.toFixed(1)}× 超量喷药：蜂群急性中毒，毒性残留已扩散。`
        : "1.0× 规范喷药完成：病虫害压力下降，蜂群轻微受影响。",
      delta: `工蜂 −${populationLoss} · 健康 −${healthLoss} · 残留 ${Math.round(this.pesticideResidual * 100)}%`,
      icon: danger ? "!" : "◇",
    };
    this.addEvent({
      kind: "operation",
      title: danger ? `超量喷药 ${dose.toFixed(1)}×` : "规范喷药 1.0×",
      detail: `¥${before.budget}→¥${Math.round(this.budget)} · 工蜂 ${before.population}→${Math.round(this.population)} · 健康 ${before.health}→${Math.round(this.health)} · 毒性 ${Math.round(this.pesticideResidual * 100)}%`,
      severity: danger ? "danger" : "neutral",
      metrics: this.metrics(),
    });
    return { ok: true, before, after: this.metrics() };
  }

  vent(options = {}) {
    if (!this.spend(2)) return { ok: false, message: "预算不足" };
    this.ventMinutes = 15;
    this.lastOperation = {
      at: this.minutes,
      tone: "neutral",
      title: "通风阀开启 15 分钟，热空气正在排出。",
      delta: "热平衡 −2.2°C · 预算 ¥2",
      icon: "↗",
    };
    this.addEvent({
      kind: "operation",
      title: "通风 15 分钟",
      detail: `预算 ¥${Math.round(this.budget)} · 目标温降 2.2°C · 风机 ${this.controls.fan} 档`,
      severity: "neutral",
      metrics: this.metrics(),
    });
    return { ok: true };
  }

  feed(options = {}) {
    if (!this.spend(14)) return { ok: false, message: "预算不足" };
    const beforePollen = this.pollen;
    this.pollen = clamp(this.pollen + 18, 0, 100);
    this.lastOperation = {
      at: this.minutes,
      tone: "neutral",
      title: "补充花粉完成，采集蜂获得新的蛋白质来源。",
      delta: `花粉 ${beforePollen.toFixed(0)}% → ${this.pollen.toFixed(0)}% · 预算 −¥14`,
      icon: "+",
    };
    this.addEvent({
      kind: "operation",
      title: "补充花粉",
      detail: `花粉 ${beforePollen.toFixed(0)}%→${this.pollen.toFixed(0)}% · 预算 ¥${Math.round(this.budget)}`,
      severity: "neutral",
      metrics: this.metrics(),
    });
    return { ok: true };
  }

  useRecovery(strategy, options = {}) {
    if (!this.recoveryTriggered) {
      return { ok: false, message: "尚未达到恢复触发阈值" };
    }
    const before = this.metrics();
    if (strategy === "boost") {
      if (!this.spend(52)) return { ok: false, message: "预算不足 ¥52" };
      this.population = Math.min(80, this.population + 12);
      this.health = Math.min(100, this.health + 16);
      this.pollen = Math.max(0, this.pollen - 12);
      this.lastOperation = {
        at: this.minutes,
        tone: "neutral",
        title: "应急补蜂完成：外源工蜂已并入采集队列。",
        delta: "工蜂 +12 · 健康 +16 · 花粉 −12",
        icon: "A",
      };
    } else if (strategy === "ecology") {
      if (!this.spend(18)) return { ok: false, message: "预算不足 ¥18" };
      this.controls.shade = Math.min(85, this.controls.shade + 10);
      this.controls.thermostat = Math.max(18, this.controls.thermostat - 2);
      this.ecologyMinutes = 90;
      this.health = Math.min(100, this.health + 4);
      this.pollen = Math.min(100, this.pollen + 3);
      this.lastOperation = {
        at: this.minutes,
        tone: "neutral",
        title: "生态稳控启动：遮光上调，温控下移，90 分钟内缓慢修复。",
        delta: "预算 −¥18 · 遮光 +10% · 温控 −2°C",
        icon: "B",
      };
    } else {
      return { ok: false, message: "未知恢复策略" };
    }

    const recovery = {
      strategy,
      at: this.minutes,
      due: this.minutes + 90,
      cost: strategy === "boost" ? 52 : 18,
      trigger: this.recoveryTriggerText(),
      triggerMetrics: this.triggerSnapshot || before,
      before,
      after: null,
    };
    this.recoveries.push(recovery);
    this.pendingEvaluations.push(recovery);
    this.addEvent({
      kind: "recovery",
      title: strategy === "boost" ? "执行恢复策略 A · 应急补蜂" : "执行恢复策略 B · 生态稳控",
      detail: `触发 ${recovery.trigger} · 代价 ¥${recovery.cost} · 当前健康 ${before.health} / 工蜂 ${before.population} / 花粉 ${before.pollen}%`,
      severity: "success",
      metrics: this.metrics(),
    });
    return { ok: true, before, after: this.metrics(), recovery };
  }

  updateRecoveryEvaluations() {
    while (
      this.pendingEvaluations.length > 0 &&
      this.pendingEvaluations[0].due <= this.minutes
    ) {
      const recovery = this.pendingEvaluations.shift();
      recovery.after = this.metrics();
      this.addEvent({
        kind: "recovery",
        title: `${recovery.strategy === "boost" ? "A" : "B"} 方案 90 min 评估`,
        detail: `触发「${recovery.trigger}」 · 最终健康 ${recovery.after.health} / 工蜂 ${recovery.after.population} / 坐果 ${recovery.after.fruits}/3 · 代价 ¥${recovery.cost}`,
        severity: "success",
        metrics: recovery.after,
      });
    }
  }

  flushRecoveryEvaluations(reason) {
    while (this.pendingEvaluations.length > 0) {
      const recovery = this.pendingEvaluations.shift();
      recovery.after = this.metrics();
      recovery.closedBy = reason;
      this.addEvent({
        kind: "recovery",
        title: `${recovery.strategy === "boost" ? "A" : "B"} 方案结束评估`,
        detail: `${reason} · 触发「${recovery.trigger}」 · 健康 ${recovery.after.health} / 工蜂 ${recovery.after.population} / 坐果 ${recovery.after.fruits}/3`,
        severity: "success",
        metrics: recovery.after,
      });
    }
  }

  queueScript(script = []) {
    this.scriptQueue = script
      .map((action) => ({ ...action, payload: { ...(action.payload || {}) } }))
      .sort((a, b) => a.at - b.at);
    this.scriptIndex = 0;
    return this;
  }

  loadReplay(seed, actions, options = {}) {
    this.reset(seed, options);
    this.replayMode = true;
    this.replaySource = actions
      .map((action) => ({
        at: Number(action.at),
        kind: action.kind,
        payload: { ...(action.payload || {}) },
      }))
      .sort((a, b) => a.at - b.at);
    this.replayQueue = this.replaySource;
    this.replayIndex = 0;
    this.actions = [];
    return this;
  }

  applyScheduledActions(upTo) {
    while (
      this.scriptIndex < this.scriptQueue.length &&
      this.scriptQueue[this.scriptIndex].at <= upTo + 1e-6
    ) {
      const action = this.scriptQueue[this.scriptIndex];
      this.scriptIndex += 1;
      this.applyActionCore(action);
    }
    while (
      this.replayIndex < this.replayQueue.length &&
      this.replayQueue[this.replayIndex].at <= upTo + 1e-6
    ) {
      const action = this.replayQueue[this.replayIndex];
      this.replayIndex += 1;
      this.applyActionCore(action);
    }
  }

  sampleTemperature() {
    const last = this.temperatureHistory[this.temperatureHistory.length - 1];
    if (!last || this.minutes - last.at >= 6) {
      this.temperatureHistory.push({
        at: this.minutes,
        value: this.temperature,
      });
      if (this.temperatureHistory.length > 48) this.temperatureHistory.shift();
    }
  }

  metrics() {
    const fruits = this.crops.filter((crop) => crop.pollination >= 100).length;
    return {
      at: this.minutes,
      clock: formatClock(this.minutes),
      budget: Math.round(this.budget),
      spent: Math.round(this.spent),
      pollen: Math.round(this.pollen * 10) / 10,
      population: Math.round(this.population * 10) / 10,
      health: Math.round(this.health * 10) / 10,
      temperature: Math.round(this.temperature * 10) / 10,
      activity: Math.round(this.activity),
      activeBees: Math.round(this.activeBees * 10) / 10,
      fruits,
      pesticide: Math.round(this.pesticideResidual * 100),
      pestPressure: Math.round(this.pestPressure * 100),
    };
  }

  addEvent(event) {
    this.events.push({
      id: this.events.length + 1,
      at: Number(this.minutes.toFixed(1)),
      clock: formatClock(this.minutes),
      metrics: event.metrics || null,
      severity: event.severity || "neutral",
      ...event,
    });
    if (this.events.length > 90) this.events.shift();
  }

  checkOutcome() {
    const fruits = this.crops.filter((crop) => crop.pollination >= 100).length;
    const healthy = this.health >= 60 && this.population >= 24;
    if (fruits === 3 && healthy) {
      this.finish(true, "三块作物全部充分授粉并坐果，蜂群健康保持在阈值以上。");
      return;
    }
    if (this.population <= 0) {
      this.finish(false, "蜂群已经完全崩溃，剩余花朵无法完成授粉。");
      return;
    }
    if (this.minutes >= SIM_END) {
      let reason = "授粉窗口结束前仍有作物未完成充分授粉。";
      if (fruits === 3 && this.health < 60) {
        reason = "三块作物已经坐果，但蜂群健康低于 60，未达到成功标准。";
      } else if (this.population < 24) {
        reason = `蜂群衰退至 ${Math.round(this.population)} 只工蜂，剩余授粉量已无法完成。`;
      } else if (this.health < 60) {
        reason = `授粉窗口结束，蜂群健康仅 ${Math.round(this.health)}，未达到成功标准。`;
      }
      this.finish(false, reason);
    }
  }

  finish(success, reason) {
    if (this.ended) return;
    this.running = false;
    this.ended = true;
    this.flushRecoveryEvaluations(success ? "任务成功收束" : "任务失败收束");
    const finalMetrics = this.metrics();
    this.result = {
      success,
      reason,
      at: this.minutes,
      clock: formatClock(this.minutes),
      metrics: finalMetrics,
      seed: this.seed,
      scenario: this.scenario,
      recoveries: this.recoveries.map((recovery) => ({
        strategy: recovery.strategy,
        cost: recovery.cost,
        trigger: recovery.trigger,
        triggerMetrics: recovery.triggerMetrics,
        after: recovery.after,
      })),
    };
    this.lastOperation = {
      at: this.minutes,
      tone: success ? "neutral" : "danger",
      title: success ? "任务完成：三块作物坐果，蜂群保持健康。" : `实验失败：${reason}`,
      delta: `最终健康 ${Math.round(this.health)} · 坐果 ${finalMetrics.fruits}/3`,
      icon: success ? "✓" : "×",
    };
    this.addEvent({
      kind: success ? "success" : "failure",
      title: success ? "实验任务完成" : "实验任务失败",
      detail: reason,
      severity: success ? "success" : "danger",
      metrics: finalMetrics,
    });
  }

  sequenceHash() {
    const actionSource = this.actions.length ? this.actions : this.replaySource || [];
    return hashObject({
      seed: this.seed,
      target: this.trackedBee,
      resources: this.initialResources,
      weather: this.weather.map((point) => [
        point.hour,
        Math.round(point.outside * 100),
        Math.round(point.cloud * 100),
      ]),
      events: this.events.map((event) => [
        event.at,
        event.kind,
        event.title,
        event.detail,
      ]),
      actions: [...actionSource]
        .sort((a, b) => a.at - b.at)
        .map((action) => [action.at, action.kind, action.payload]),
    });
  }

  exportData() {
    return {
      seed: this.seed,
      trackedBee: this.trackedBee,
      initialResources: this.initialResources,
      controls: this.controls,
      metrics: this.metrics(),
      events: this.events,
      actions: this.actions,
      recoveries: this.recoveries,
      result: this.result,
      sequenceHash: this.sequenceHash(),
    };
  }
}
