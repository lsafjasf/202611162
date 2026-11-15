import { createScenario, WORLD } from "./scenario.js";

export const STEP_SECONDS = 1 / 60;
export const FERRY_RADIUS = 22;
export const CABLE_RANGE = 285;

const EMPTY_INPUT = Object.freeze({
  thrust: false,
  reverse: false,
  left: false,
  right: false,
  reel: false,
  pay: false,
});

export function angleDelta(a, b) {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class IceFerryGame {
  constructor(seed = 20261116) {
    this.events = [];
    this.input = { ...EMPTY_INPUT };
    this.checkpoint = null;
    this.lastCompletedSummary = null;
    this.reset(seed);
  }

  reset(seed = this.seed) {
    this.seed = String(seed).trim() || "20261116";
    this.scenario = createScenario(this.seed);
    this.initialScenarioHash = this.scenario.hash;
    const mission = this.scenario.mission;
    this.state = {
      status: "running",
      paused: false,
      demoFailure: false,
      elapsed: 0,
      steps: 0,
      side: "west",
      nextDock: "east",
      roundTrips: 0,
      dockings: 0,
      delivered: 0,
      ferry: {
        x: WORLD.docks.west.x,
        y: WORLD.docks.west.y,
        heading: 0,
        vx: 0,
        vy: 0,
        throttle: 0,
        cargoCrew: mission.crewPerTrip,
        cargoEquipment: mission.equipmentTons,
        iceLoad: 0,
        hull: mission.hull,
        atDock: true,
      },
      resources: {
        fuel: mission.fuel,
        hull: mission.hull,
        cable: mission.cable,
      },
      cable: {
        attached: false,
        anchorId: null,
        candidateId: null,
        length: 0,
        targetLength: 0,
        tension: 0,
        action: "待命",
      },
      path: [{ x: WORLD.docks.west.x, y: WORLD.docks.west.y, t: 0 }],
      pathTimer: 0,
      incidents: [],
      failureReason: null,
      failureAt: null,
      completedAt: null,
      summary: null,
      checkpointLabel: "出发港",
      checkpointAt: 0,
      iceFloes: this.scenario.floes.map((floe) => ({
        ...clone(floe),
        x: floe.x,
        y: floe.y,
        rotation: floe.rotation,
        hitCooldown: 0,
      })),
      anchors: this.scenario.anchors.map((anchor) => ({ ...anchor })),
      drainFeedback: [],
    };
    this.input = { ...EMPTY_INPUT };
    this.events = [];
    this.saveCheckpoint("出发港");
    this.emit("seed", `固定种子 ${this.seed} · 布局 ${this.scenario.hash}`, "info");
    return this.state;
  }

  get mission() {
    return this.scenario.mission;
  }

  get loadTons() {
    const ferry = this.state.ferry;
    return ferry.cargoEquipment + ferry.cargoCrew * this.mission.crewTons + ferry.iceLoad;
  }

  get overloaded() {
    return this.loadTons > this.mission.capacityTons;
  }

  get maneuverFactor() {
    if (!this.overloaded) return 1;
    const ratio = (this.loadTons - this.mission.capacityTons) / this.mission.capacityTons;
    return clamp(1 - ratio * 1.15, 0.48, 1);
  }

  get speed() {
    return Math.hypot(this.state.ferry.vx, this.state.ferry.vy);
  }

  emit(type, text, severity = "info", extra = {}) {
    const event = { type, text, severity, at: this.state.elapsed, ...extra };
    this.events.push(event);
    return event;
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  recordIncident(type, reason, detail, at = this.state.elapsed) {
    const incident = { type, reason, detail, at: Number(at.toFixed(2)) };
    this.state.incidents.push(incident);
    return incident;
  }

  setInputs(partial) {
    Object.assign(this.input, partial);
  }

  clearInputs() {
    this.input = { ...EMPTY_INPUT };
  }

  togglePause(force) {
    if (this.state.status !== "running") return this.state.paused;
    this.state.paused = typeof force === "boolean" ? force : !this.state.paused;
    this.emit(
      "pause",
      this.state.paused ? "航行已暂停，物理状态已冻结" : "继续航行",
      this.state.paused ? "warn" : "info",
    );
    return this.state.paused;
  }

  restart(seed = this.seed) {
    this.reset(seed);
    this.emit("restart", `已用种子 ${this.seed} 重开新局`, "good");
    return this.state;
  }

  findCableCandidate() {
    const ferry = this.state.ferry;
    let best = null;
    let bestDistance = Infinity;
    for (const anchor of this.state.anchors) {
      const distance = Math.hypot(anchor.x - ferry.x, anchor.y - ferry.y);
      if (distance <= CABLE_RANGE && distance < bestDistance) {
        best = anchor;
        bestDistance = distance;
      }
    }
    this.state.cable.candidateId = best?.id || null;
    return best ? { ...best, distance: bestDistance } : null;
  }

  toggleCable() {
    if (this.state.status !== "running" || this.state.paused) return false;
    if (this.state.cable.attached) {
      const anchor = this.state.anchors.find((item) => item.id === this.state.cable.anchorId);
      this.state.cable.attached = false;
      this.state.cable.anchorId = null;
      this.state.cable.tension = 0;
      this.state.cable.action = "已解缆";
      this.emit("cable-release", `已解开${anchor?.label || "冰锚"}缆绳`, "warn");
      return true;
    }
    const candidate = this.findCableCandidate();
    if (!candidate) {
      this.state.cable.action = "附近无冰锚";
      this.emit("cable-miss", "缆绳未找到目标，请靠近黄标冰锚", "warn");
      return false;
    }
    this.state.cable.attached = true;
    this.state.cable.anchorId = candidate.id;
    this.state.cable.length = clamp(candidate.distance, 38, 310);
    this.state.cable.targetLength = this.state.cable.length;
    this.state.cable.tension = 0;
    this.state.cable.action = `系上 ${candidate.label}`;
    this.emit("cable-attach", `缆绳已系上${candidate.label}（${candidate.distance.toFixed(0)} m）`, "good");
    return true;
  }

  step(input = this.input) {
    const state = this.state;
    if (state.status !== "running" || state.paused) return false;
    const dt = STEP_SECONDS;
    const ferry = state.ferry;
    state.elapsed = Math.round((state.elapsed + dt) * 1000) / 1000;
    state.steps += 1;

    const thrustInput = input.thrust ? 1 : input.reverse ? -1 : 0;
    if (thrustInput > 0) ferry.throttle += 1.85 * dt;
    if (thrustInput < 0) ferry.throttle -= 2.35 * dt;
    if (!thrustInput) {
      const decay = 0.85 * dt;
      if (Math.abs(ferry.throttle) <= decay) ferry.throttle = 0;
      else ferry.throttle -= Math.sign(ferry.throttle) * decay;
    }
    ferry.throttle = clamp(ferry.throttle, -0.38, 1);

    if (ferry.atDock && Math.abs(ferry.throttle) > 0.035) {
      ferry.atDock = false;
      this.emit("depart", `${state.side === "west" ? "西岸" : "东岸"}离泊`, "info");
    }

    if (state.cable.attached) {
      if (input.reel) {
        state.cable.length = clamp(state.cable.length - 54 * dt, 34, 330);
        state.cable.action = "收缆中";
      } else if (input.pay) {
        state.cable.length = clamp(state.cable.length + 62 * dt, 34, 330);
        state.cable.action = "放缆中";
      } else if (state.cable.tension < 0.06) {
        state.cable.action = "缆绳已系";
      }
    } else if (input.reel || input.pay) {
      state.cable.action = "请先按 C 系缆";
    } else {
      state.cable.action = this.findCableCandidate() ? "可系缆" : "待命";
    }

    this.updateFerryPhysics(dt, input);
    this.updateCable(dt, input);
    this.updateIceFloes(dt);
    this.handleDockAndShore(dt);
    this.handleIceCollisions(dt);
    this.updatePath(dt);
    state.shake = Math.max(0, (state.shake || 0) - dt * 1.9);
    return true;
  }

  advance(seconds, input = this.input) {
    let remaining = Math.max(0, seconds);
    let steps = 0;
    while (remaining > 1e-7 && steps < 600) {
      if (!this.step(input)) break;
      remaining -= STEP_SECONDS;
      steps += 1;
    }
    return steps;
  }

  updateFerryPhysics(dt, input) {
    const ferry = this.state.ferry;
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const loadedPenalty = this.maneuverFactor;
    const speedRatio = clamp(this.speed / 85, 0, 1);
    const steerRate = (1.34 + speedRatio * 0.68) * loadedPenalty;
    ferry.heading += steer * steerRate * dt * (0.72 + Math.min(speedRatio, 0.5) * 0.56);
    while (ferry.heading > Math.PI) ferry.heading -= Math.PI * 2;
    while (ferry.heading < -Math.PI) ferry.heading += Math.PI * 2;

    const fuelAvailable = this.state.resources.fuel > 0;
    const engine = fuelAvailable ? ferry.throttle : 0;
    const acceleration = engine * 132 * loadedPenalty;
    ferry.vx += Math.cos(ferry.heading) * acceleration * dt;
    ferry.vy += Math.sin(ferry.heading) * acceleration * dt;

    const current = 2.6 + Math.sin(this.state.elapsed * 0.24 + ferry.x * 0.007) * 1.4;
    ferry.vy += current * dt;
    ferry.vx += Math.sin(this.state.elapsed * 0.17 + ferry.y * 0.01) * 1.2 * dt;

    const drag = Math.exp(-1.42 * dt);
    ferry.vx *= drag;
    ferry.vy *= drag;
    const speed = this.speed;
    if (speed > 96) {
      ferry.vx = (ferry.vx / speed) * 96;
      ferry.vy = (ferry.vy / speed) * 96;
    }

    if (fuelAvailable) {
      this.state.resources.fuel = Math.max(
        0,
        this.state.resources.fuel - Math.abs(ferry.throttle) * 0.31 * dt,
      );
    } else {
      ferry.throttle *= 0.98;
    }
    ferry.x += ferry.vx * dt;
    ferry.y += ferry.vy * dt;
  }

  updateCable(dt, input) {
    const cable = this.state.cable;
    const ferry = this.state.ferry;
    if (!cable.attached) {
      cable.tension = 0;
      return;
    }
    const anchor = this.state.anchors.find((item) => item.id === cable.anchorId);
    if (!anchor) {
      cable.attached = false;
      cable.anchorId = null;
      return;
    }
    const dx = ferry.x - anchor.x;
    const dy = ferry.y - anchor.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > 345) {
      cable.attached = false;
      cable.anchorId = null;
      cable.tension = 0;
      cable.action = "超出缆长";
      this.recordIncident("cable", "缆绳超距脱钩", `${anchor.label} 距离超出安全缆长`);
      this.emit("cable-break", "缆绳超出安全长度，已自动脱钩", "warn");
      return;
    }

    const stretch = Math.max(0, distance - cable.length);
    const pull = Math.min(stretch * 3.25, 74);
    if (pull > 0) {
      ferry.vx -= (dx / distance) * pull * dt;
      ferry.vy -= (dy / distance) * pull * dt;
    }
    cable.tension = clamp((stretch / 65) + (input.reel ? 0.15 : 0), 0, 1);
    const strainRate = cable.tension > 0.5 ? (cable.tension - 0.42) * 0.42 : 0;
    if (strainRate > 0) {
      this.state.resources.cable = Math.max(0, this.state.resources.cable - strainRate * dt);
    }
    if (this.state.resources.cable <= 0) {
      cable.attached = false;
      cable.anchorId = null;
      cable.tension = 0;
      cable.action = "缆索断裂";
      this.recordIncident("cable", "缆索断裂", "持续高张力耗尽缆索耐久");
      this.emit("cable-break", "缆索断裂，机动控制受限", "danger");
    }
  }

  updateIceFloes(dt) {
    const water = WORLD.water;
    for (const floe of this.state.iceFloes) {
      floe.x += floe.vx * dt;
      floe.y += floe.vy * dt;
      floe.rotation += floe.spin * dt;
      floe.hitCooldown = Math.max(0, floe.hitCooldown - dt);
      if (floe.y > water.bottom + floe.radius * 0.8) {
        floe.y = water.top - floe.radius * 0.8;
        floe.x = clamp(floe.x + 23, water.left + floe.radius, water.right - floe.radius);
      }
      if (floe.y < water.top - floe.radius) {
        floe.y = water.bottom + floe.radius - 2;
      }
      if (floe.x < water.left + floe.radius * 0.5) {
        floe.x = water.left + floe.radius * 0.5;
        floe.vx = Math.abs(floe.vx) * 0.65;
      }
      if (floe.x > water.right - floe.radius * 0.5) {
        floe.x = water.right - floe.radius * 0.5;
        floe.vx = -Math.abs(floe.vx) * 0.65;
      }
    }
  }

  handleDockAndShore(dt) {
    const state = this.state;
    const ferry = state.ferry;
    if (ferry.atDock) return;

    const inDockBand = ferry.y > 252 && ferry.y < 468;
    const inEastZone = ferry.x > 943 && ferry.x < 1042 && inDockBand;
    const inWestZone = ferry.x < 257 && ferry.x > 158 && inDockBand;
    const requestedZone = state.nextDock === "east" ? inEastZone : inWestZone;

    if (requestedZone) {
      const desiredHeading = state.nextDock === "east" ? 0 : Math.PI;
      const landingAngle = Math.abs(angleDelta(ferry.heading, desiredHeading));
      const speed = this.speed;
      if (speed > 64) {
        this.fail(
          "冲岸搁浅",
          `靠岸速度 ${speed.toFixed(1)} m/s 超过 64 m/s 上限，船底触冰搁浅。`,
          "grounding",
        );
        return;
      }
      if (landingAngle > 1.05) {
        const degrees = Math.round((landingAngle * 180) / Math.PI);
        this.fail(
          "舷侧损伤",
          `靠岸角度 ${degrees}° 超过 60° 安全上限，舷侧撞击码头护舷。`,
          "landing-angle",
        );
        return;
      }
      if (landingAngle > 0.43 || speed > 42) {
        const degrees = Math.round((landingAngle * 180) / Math.PI);
        const damage = clamp(5 + degrees * 0.18 + speed * 0.08, 5, 13);
        this.recordIncident(
          "hard-landing",
          "偏角靠岸",
          `${degrees}° / ${speed.toFixed(0)} m/s，舷侧擦碰 -${damage.toFixed(0)} 船体`,
        );
        this.emit("hard-landing", `偏角靠岸：${degrees}°，舷侧受损`, "danger");
        if (this.applyHullDamage(damage, "偏角靠岸导致舷侧破损")) return;
      }
      this.dockAt(state.nextDock);
      return;
    }

    const hitShore = ferry.x < 172 || ferry.x > 1028 || ferry.y < 93 || ferry.y > 638;
    if (hitShore) {
      const where = ferry.x < 172 ? "西岸" : ferry.x > 1028 ? "东岸" : ferry.y < 93 ? "上游冰坝" : "下游碎冰区";
      this.fail("脱离航道搁浅", `船体撞上${where}，未对准维修坞导引区。`, "grounding");
    }
  }

  dockAt(side) {
    const state = this.state;
    const ferry = state.ferry;
    const dock = WORLD.docks[side];
    ferry.x = dock.x;
    ferry.y = dock.y;
    ferry.heading = side === "east" ? Math.PI : 0;
    ferry.vx = 0;
    ferry.vy = 0;
    ferry.throttle = 0;
    ferry.atDock = true;
    state.side = side;
    state.dockings += 1;

    if (state.cable.attached) {
      state.cable.attached = false;
      state.cable.anchorId = null;
      state.cable.tension = 0;
      state.cable.action = "靠泊自动解缆";
    }

    if (side === "east") {
      state.delivered += ferry.cargoCrew;
      this.emit("crew-delivered", `维修队 ${ferry.cargoCrew} 人已送达东岸（${state.delivered}/6）`, "good");
      ferry.cargoCrew = 0;
      state.nextDock = "west";
      this.emit("dock", `安全靠泊东岸抢修坞 · 第 ${state.dockings}/6 次`, "good");
    } else {
      state.roundTrips += 1;
      if (state.roundTrips < this.mission.rounds) {
        ferry.cargoCrew = this.mission.crewPerTrip;
        this.emit(
          "crew-board",
          `第 ${state.roundTrips + 1} 批维修队登船（${this.mission.crewPerTrip} 人）`,
          "info",
        );
      }
      state.nextDock = "east";
      this.emit(
        "round",
        `完成第 ${state.roundTrips}/${this.mission.rounds} 次往返 · 靠岸 ${state.dockings}/6`,
        "good",
      );
    }

    state.pathTimer = 0;
    state.path.push({
      x: Number(ferry.x.toFixed(2)),
      y: Number(ferry.y.toFixed(2)),
      t: Number(state.elapsed.toFixed(2)),
    });
    if (state.roundTrips >= this.mission.rounds) {
      this.completeRun();
      return;
    }
    this.saveCheckpoint(`${dock.label} / ${this.formatClock()}`);
    this.emit("checkpoint", `检查点已更新：${dock.label}`, "good");
  }

  handleIceCollisions(dt) {
    const state = this.state;
    const ferry = state.ferry;
    if (ferry.atDock) return;
    for (const floe of state.iceFloes) {
      const dx = ferry.x - floe.x;
      const dy = ferry.y - floe.y;
      const distance = Math.hypot(dx, dy) || 1;
      const minDistance = floe.radius * 0.84 + FERRY_RADIUS;
      if (distance >= minDistance) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      ferry.x += nx * overlap * 0.72;
      ferry.y += ny * overlap * 0.72;
      floe.x -= nx * overlap * 0.28;
      floe.y -= ny * overlap * 0.28;
      const relativeSpeed = Math.abs((ferry.vx - floe.vx) * nx + (ferry.vy - floe.vy) * ny);
      ferry.vx += nx * relativeSpeed * 0.24;
      ferry.vy += ny * relativeSpeed * 0.24;
      floe.vx -= nx * relativeSpeed * 0.09;
      floe.vy -= ny * relativeSpeed * 0.09;
      if (floe.hitCooldown > 0 || relativeSpeed < 5) continue;
      floe.hitCooldown = 0.72;
      const damage = clamp(1.4 + relativeSpeed * 0.075, 1.4, 8.5);
      ferry.iceLoad = clamp(ferry.iceLoad + 0.2 + relativeSpeed * 0.009, 0, 4);
      this.recordIncident(
        "collision",
        "浮冰撞击",
        `${floe.id} 撞击船体，相对速度 ${relativeSpeed.toFixed(1)} m/s`,
      );
      this.emit(
        "collision",
        `浮冰撞击 ${floe.id}：船体 -${damage.toFixed(0)}，积冰 +${(0.2 + relativeSpeed * 0.009).toFixed(1)} t`,
        "danger",
      );
      this.updateShake(0.2 + relativeSpeed * 0.008);
      if (this.applyHullDamage(damage, `与 ${floe.id} 碰撞导致船体破损`)) return;
    }
  }

  applyHullDamage(amount, reason) {
    const state = this.state;
    state.resources.hull = Math.max(0, state.resources.hull - amount);
    state.ferry.hull = state.resources.hull;
    if (state.resources.hull <= 0) {
      this.fail("船体破损", `${reason}；船体耐久归零，必须返回检查点。`, "hull");
      return true;
    }
    return false;
  }

  updateShake(amount) {
    this.state.shake = clamp((this.state.shake || 0) + amount, 0, 1);
  }

  updatePath(dt) {
    const state = this.state;
    const ferry = state.ferry;
    state.pathTimer = (state.pathTimer || 0) + dt;
    if (state.pathTimer < 0.32 || ferry.atDock) return;
    state.pathTimer = 0;
    const last = state.path[state.path.length - 1];
    if (!last || Math.hypot(ferry.x - last.x, ferry.y - last.y) > 2.4) {
      state.path.push({
        x: Number(ferry.x.toFixed(2)),
        y: Number(ferry.y.toFixed(2)),
        t: Number(state.elapsed.toFixed(2)),
      });
    }
  }

  formatClock(seconds = this.state.elapsed) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
  }

  saveCheckpoint(label) {
    const state = this.state;
    state.checkpointLabel = label;
    state.checkpointAt = Number(state.elapsed.toFixed(2));
    this.checkpoint = {
      label,
      at: state.checkpointAt,
      state: clone(state),
    };
  }

  recoverCheckpoint() {
    if (!this.checkpoint) return false;
    const restored = clone(this.checkpoint.state);
    restored.status = "running";
    restored.paused = false;
    restored.demoFailure = false;
    restored.failureReason = null;
    restored.failureAt = null;
    restored.completedAt = null;
    restored.summary = null;
    restored.shake = 0;
    this.state = restored;
    this.input = { ...EMPTY_INPUT };
    this.events = [];
    this.emit(
      "recover",
      `已从检查点恢复：${this.checkpoint.label}（${this.formatClock(restored.elapsed)}）`,
      "good",
    );
    return true;
  }

  fail(reason, detail, type = "failure") {
    const state = this.state;
    if (state.status !== "running") return false;
    state.status = "failed";
    state.failureReason = reason;
    state.failureAt = Number(state.elapsed.toFixed(2));
    state.paused = false;
    this.recordIncident(type, reason, detail);
    state.failureSummary = this.buildSummary("failed");
    this.emit("failure", `${reason}：${detail}`, "danger", { reason });
    return true;
  }

  startFailureDemo() {
    const preservedCheckpoint = this.checkpoint;
    this.reset(this.seed);
    this.checkpoint = preservedCheckpoint;
    const state = this.state;
    state.demoFailure = true;
    state.ferry.x = 958;
    state.ferry.y = 426;
    state.ferry.heading = -1.24;
    state.ferry.vx = 38;
    state.ferry.vy = -5;
    state.ferry.throttle = 0.62;
    state.ferry.atDock = false;
    state.cable.action = "失准进港演示";
    if (preservedCheckpoint) {
      state.checkpointLabel = preservedCheckpoint.label;
      state.checkpointAt = preservedCheckpoint.at;
    }
    this.emit("demo", "失败场景：东岸高速偏角进港，将在下一物理步触发搁浅", "warn");
    return state;
  }

  completeRun() {
    const state = this.state;
    state.status = "won";
    state.paused = false;
    state.completedAt = Number(state.elapsed.toFixed(2));
    state.summary = this.buildSummary("won");
    this.lastCompletedSummary = state.summary;
    this.emit(
      "win",
      `任务完成：${state.roundTrips}/3 次往返，${state.delivered}/6 人送达，用时 ${this.formatClock()}`,
      "good",
    );
  }

  buildSummary(outcome = this.state.status) {
    const state = this.state;
    const path = state.path;
    const step = Math.max(1, Math.ceil(path.length / 130));
    const compactPath = path.filter((_, index) => index % step === 0);
    if (path.length && compactPath[compactPath.length - 1] !== path[path.length - 1]) {
      compactPath.push(path[path.length - 1]);
    }
    let pathLength = 0;
    for (let i = 1; i < path.length; i += 1) {
      pathLength += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    return {
      version: 1,
      seed: this.seed,
      layoutHash: this.scenario.hash,
      outcome,
      objectiveMet:
        state.roundTrips >= this.mission.rounds &&
        state.dockings >= this.mission.targetDockings &&
        state.delivered >= this.mission.targetCrew,
      targets: {
        rounds: this.mission.rounds,
        dockings: this.mission.targetDockings,
        crew: this.mission.targetCrew,
      },
      achieved: {
        rounds: state.roundTrips,
        dockings: state.dockings,
        crew: state.delivered,
      },
      remainingResources: {
        fuel: Number(state.resources.fuel.toFixed(2)),
        hull: Number(state.resources.hull.toFixed(2)),
        cable: Number(state.resources.cable.toFixed(2)),
        iceLoad: Number(state.ferry.iceLoad.toFixed(2)),
      },
      finalElapsedSeconds: Number(state.elapsed.toFixed(2)),
      finalElapsedLabel: this.formatClock(state.elapsed),
      path: compactPath,
      pathSamples: path.length,
      pathLength: Number(pathLength.toFixed(1)),
      checkpoint: state.checkpointLabel,
      failureReasons: state.incidents.map((incident) => ({
        type: incident.type,
        reason: incident.reason,
        detail: incident.detail,
        at: incident.at,
      })),
      finalFailureReason: state.failureReason,
    };
  }
}
