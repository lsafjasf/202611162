(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ZiplineSim = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORLD_WIDTH = 1200;
  const WORLD_HEIGHT = 720;
  const PLATFORM = { x: 1045, y: 258, width: 148, height: 26 };
  const SAFE_SPEED = 11.5;
  const STALL_SPEED = 0.28;
  const BRAKE_PADS_START = 3;
  const RESCUE_CORDS_START = 2;

  const TOOL_POOL = [
    { name: "索具扳手", color: "#f6c453", glyph: "扳" },
    { name: "备用滑轮", color: "#5eead4", glyph: "轮" },
    { name: "应急信标", color: "#ff8fab", glyph: "讯" },
    { name: "锚固夹钳", color: "#93c5fd", glyph: "钳" },
    { name: "绝缘胶带", color: "#fdba74", glyph: "带" },
    { name: "测距仪", color: "#c4b5fd", glyph: "测" },
  ];

  const ROUTE_PRESETS = [
    {
      id: "north",
      label: "北脊入口",
      short: "北脊",
      accent: "#f6c453",
      start: { x: 92, y: 166 },
      character: "高差大，风势偏顺",
    },
    {
      id: "canopy",
      label: "树冠中庭",
      short: "中庭",
      accent: "#5eead4",
      start: { x: 148, y: 226 },
      character: "线路平缓，雨幕密集",
    },
    {
      id: "south",
      label: "南侧断枝",
      short: "南侧",
      accent: "#ff8fab",
      start: { x: 74, y: 326 },
      character: "侧风强，障碍最多",
    },
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function round(value, places) {
    const factor = Math.pow(10, places || 0);
    return Math.round(value * factor) / factor;
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function next() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(items, rng) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1));
      const current = result[index];
      result[index] = result[swap];
      result[swap] = current;
    }
    return result;
  }

  function routePoint(route, t) {
    const safeT = clamp(t, 0, 1);
    return {
      x: lerp(route.start.x, PLATFORM.x, safeT),
      y:
        lerp(route.start.y, PLATFORM.y, safeT) +
        route.sag * 4 * safeT * (1 - safeT),
    };
  }

  function buildRoute(preset, rng) {
    const route = {
      id: preset.id,
      label: preset.label,
      short: preset.short,
      accent: preset.accent,
      character: preset.character,
      start: {
        x: preset.start.x + Math.round((rng() - 0.5) * 18),
        y: preset.start.y + Math.round((rng() - 0.5) * 24),
      },
      rain: round(0.2 + rng() * 0.56, 2),
      wind: round((rng() - 0.42) * 21, 1),
      sag: Math.round(34 + rng() * 72),
      pull: round(2.2 + rng() * 0.9, 2),
      lengthM: round(36 + rng() * 8, 1),
      obstacles: [],
    };

    const obstacleCount = 2 + Math.floor(rng() * 2);
    for (let index = 0; index < obstacleCount; index += 1) {
      const type = rng() > 0.44 ? "gust" : "branch";
      route.obstacles.push({
        id: route.id + "-obstacle-" + index,
        routeId: route.id,
        type: type,
        t: round(0.18 + rng() * 0.61, 2),
        strength: round(0.55 + rng() * 1.45, 2),
        width: round(0.025 + rng() * 0.035, 3),
      });
    }
    route.obstacles.sort((left, right) => left.t - right.t);
    return route;
  }

  function buildCanopy(rng) {
    const trees = [];
    for (let index = 0; index < 30; index += 1) {
      let x = 36 + rng() * 1030;
      if (x > 920 && x < 1130) {
        x -= 190;
      }
      trees.push({
        x: Math.round(x),
        y: Math.round(126 + rng() * 500),
        radius: Math.round(34 + rng() * 58),
        tone: Math.floor(rng() * 4),
        lean: round((rng() - 0.5) * 12, 1),
      });
    }
    return trees;
  }

  function createWorld(seedInput) {
    const normalizedSeed = String(seedInput == null ? "CANOPY-653" : seedInput)
      .trim()
      .toUpperCase() || "CANOPY-653";
    const numericSeed = hashString(normalizedSeed);
    const rng = mulberry32(numericSeed);
    const tasks = shuffled(TOOL_POOL, rng)
      .slice(0, 3)
      .map(function makeTask(tool, index) {
        return {
          id: "tool-" + (index + 1),
          name: tool.name,
          color: tool.color,
          glyph: tool.glyph,
        };
      });
    const routes = ROUTE_PRESETS.map(function makeRoute(preset) {
      return buildRoute(preset, rng);
    });
    const obstacles = routes.flatMap(function flatten(route) {
      return route.obstacles.map(function position(obstacle) {
        const point = routePoint(route, obstacle.t);
        return Object.assign({}, obstacle, {
          x: Math.round(point.x),
          y: Math.round(point.y),
        });
      });
    });
    const world = {
      version: 1,
      seed: normalizedSeed,
      numericSeed: numericSeed,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      platform: Object.assign({}, PLATFORM),
      tasks: tasks,
      routes: routes,
      obstacles: obstacles,
      trees: buildCanopy(rng),
    };
    world.fingerprint = worldFingerprint(world);
    return world;
  }

  function layoutPayload(world) {
    return {
      seed: world.seed,
      platform: world.platform,
      tasks: world.tasks.map(function task(item) {
        return { name: item.name, color: item.color, glyph: item.glyph };
      }),
      routes: world.routes.map(function route(item) {
        return {
          id: item.id,
          start: item.start,
          rain: item.rain,
          wind: item.wind,
          sag: item.sag,
          pull: item.pull,
          lengthM: item.lengthM,
        };
      }),
      obstacles: world.obstacles.map(function obstacle(item) {
        return {
          id: item.id,
          routeId: item.routeId,
          type: item.type,
          t: item.t,
          strength: item.strength,
          x: item.x,
          y: item.y,
        };
      }),
      trees: world.trees,
    };
  }

  function worldFingerprint(world) {
    return hashString(JSON.stringify(layoutPayload(world))).toString(16).padStart(8, "0");
  }

  function compareWorlds(previous, next) {
    const previousLayout = previous ? layoutPayload(previous) : null;
    const nextLayout = layoutPayload(next);
    return {
      sameLayout: previousLayout
        ? JSON.stringify(previousLayout) === JSON.stringify(nextLayout)
        : false,
      previousFingerprint: previous ? worldFingerprint(previous) : null,
      nextFingerprint: worldFingerprint(next),
      sameSeed: Boolean(previous && previous.seed === next.seed),
      routeCount: next.routes.length,
      obstacleCount: next.obstacles.length,
      taskCount: next.tasks.length,
    };
  }

  function checkpointView(run) {
    return {
      toolsRemaining: run.toolsRemaining,
      brakePads: run.brakePads,
      rescueKits: run.rescueKits,
      deliveredTaskIds: run.deliveredTaskIds.slice(),
      deliveries: run.deliveries.map(function copyDelivery(item) {
        return Object.assign({}, item);
      }),
      elapsedSec: run.elapsedSec,
    };
  }

  function createRun(world) {
    const run = {
      seed: world.seed,
      worldFingerprint: world.fingerprint,
      toolsRemaining: world.tasks.length,
      brakePads: BRAKE_PADS_START,
      rescueKits: RESCUE_CORDS_START,
      deliveredTaskIds: [],
      deliveries: [],
      elapsedSec: 0,
      attempts: 0,
      crashes: 0,
      strands: 0,
      recoveries: 0,
      rescueUses: 0,
      failureReasons: [],
      recoveryLog: [],
      lastFailure: null,
      checkpoint: null,
      status: "ready",
    };
    run.checkpoint = checkpointView(run);
    return run;
  }

  function snapshotRun(run) {
    run.checkpoint = checkpointView(run);
    return run.checkpoint;
  }

  function restoreCheckpoint(world, run, options) {
    if (!run.checkpoint) {
      return null;
    }
    const settings = options || {};
    const snapshot = JSON.parse(JSON.stringify(run.checkpoint));
    run.toolsRemaining = snapshot.toolsRemaining;
    run.brakePads = snapshot.brakePads;
    run.rescueKits = snapshot.rescueKits;
    run.deliveredTaskIds = snapshot.deliveredTaskIds;
    run.deliveries = snapshot.deliveries;
    run.elapsedSec = snapshot.elapsedSec;
    run.recoveries += 1;

    let rescueSpent = false;
    if (settings.kind === "stranded" && run.rescueKits > 0) {
      run.rescueKits -= 1;
      run.rescueUses += 1;
      rescueSpent = true;
    }
    run.status = run.toolsRemaining === 0 ? "complete" : "ready";
    run.lastFailure = null;
    snapshotRun(run);
    const entry = {
      kind: settings.kind || "crash",
      reason: settings.reason || "回到最近检查点",
      rescueSpent: rescueSpent,
      at: round(run.elapsedSec, 1),
    };
    run.recoveryLog.push(entry);
    return entry;
  }

  function beginRide(world, run, routeId, weightKg) {
    const route = world.routes.find(function findRoute(item) {
      return item.id === routeId;
    });
    const task = world.tasks.find(function findTask(item) {
      return run.deliveredTaskIds.indexOf(item.id) === -1;
    });
    if (!route || !task) {
      return null;
    }
    const weight = clamp(Number(weightKg) || 12, 6, 18);
    return {
      attempt: run.attempts + 1,
      routeId: route.id,
      routeLabel: route.label,
      routeAccent: route.accent,
      taskId: task.id,
      taskName: task.name,
      taskColor: task.color,
      weightKg: weight,
      progress: 0,
      speed: 2.8,
      distanceM: route.lengthM,
      elapsed: 0,
      braking: false,
      padUsed: false,
      brakeStartProgress: null,
      maxSpeed: 2.8,
      minMovingSpeed: 2.8,
      sagOffset: (weight - 12) * 2.4,
      triggeredObstacles: {},
      events: [],
      lastOutcome: null,
      state: "riding",
    };
  }

  function hazardLabel(type) {
    return type === "gust" ? "横风阵" : "低垂断枝";
  }

  function stepRide(world, ride, input, deltaSeconds) {
    if (!ride || ride.state !== "riding") {
      return ride ? ride.events : [];
    }
    const route = world.routes.find(function findRoute(item) {
      return item.id === ride.routeId;
    });
    if (!route) {
      ride.state = "crashed";
      ride.lastOutcome = {
        kind: "crash",
        reason: "滑索入口数据丢失",
        speed: ride.speed,
      };
      return ride.events;
    }

    const dt = clamp(Number(deltaSeconds) || 1 / 120, 0.001, 0.05);
    const braking = Boolean(input && input.braking);
    ride.events = [];
    ride.braking = braking;
    if (braking && !ride.padUsed) {
      ride.padUsed = true;
      ride.brakeStartProgress = ride.progress;
      ride.events.push({
        type: "brake-start",
        progress: ride.progress,
        speed: ride.speed,
      });
    }

    const weightRatio = ride.weightKg / 12;
    const rainFrictionLoss = route.rain * 0.34;
    let acceleration =
      1.05 +
      route.pull * 0.72 * (0.65 + weightRatio * 0.48) +
      route.rain * 0.95 +
      route.sag / 120 +
      route.wind * 0.03;
    if (braking) {
      const brakePower = (7.8 - ride.weightKg * 0.09) * (1 - rainFrictionLoss);
      acceleration -= brakePower;
    }

    ride.speed = clamp(ride.speed + acceleration * dt, 0, 28);
    const previousProgress = ride.progress;
    ride.progress = clamp(
      ride.progress + (ride.speed * dt) / ride.distanceM,
      0,
      1,
    );

    route.obstacles.forEach(function checkObstacle(obstacle) {
      const crossed =
        previousProgress < obstacle.t && ride.progress >= obstacle.t;
      if (!crossed || ride.triggeredObstacles[obstacle.id]) {
        return;
      }
      ride.triggeredObstacles[obstacle.id] = true;
      if (obstacle.type === "gust") {
        ride.speed = clamp(ride.speed + obstacle.strength, 0, 28);
      } else {
        ride.speed = clamp(ride.speed - obstacle.strength * 0.48, 0, 28);
      }
      ride.events.push({
        type: "hazard",
        hazardType: obstacle.type,
        label: hazardLabel(obstacle.type),
        progress: obstacle.t,
        strength: obstacle.strength,
        speed: ride.speed,
      });
    });

    ride.elapsed = round(ride.elapsed + dt, 4);
    ride.maxSpeed = Math.max(ride.maxSpeed, ride.speed);
    ride.minMovingSpeed = Math.min(ride.minMovingSpeed, ride.speed);

    if (ride.progress >= 1) {
      ride.progress = 1;
      if (ride.speed > SAFE_SPEED) {
        ride.state = "crashed";
        ride.lastOutcome = {
          kind: "crash",
          reason:
            "到站速度 " +
            ride.speed.toFixed(1) +
            " m/s，超过平台安全阈值 " +
            SAFE_SPEED.toFixed(1) +
            " m/s",
          speed: round(ride.speed, 2),
          progress: 1,
          threshold: SAFE_SPEED,
        };
      } else {
        ride.state = "arrived";
        ride.lastOutcome = {
          kind: "arrived",
          reason:
            "安全到站，速度 " +
            ride.speed.toFixed(1) +
            " m/s",
          speed: round(ride.speed, 2),
          progress: 1,
          threshold: SAFE_SPEED,
        };
      }
      ride.events.push({ type: "outcome", outcome: ride.lastOutcome });
      return ride.events;
    }

    if (ride.speed <= STALL_SPEED) {
      ride.speed = 0;
      ride.state = "stranded";
      ride.lastOutcome = {
        kind: "stranded",
        reason:
          "吊包停在线中 " +
          Math.round(ride.progress * 100) +
          "%，需要回收至检查点",
        speed: 0,
        progress: round(ride.progress, 3),
      };
      ride.events.push({ type: "outcome", outcome: ride.lastOutcome });
    }
    return ride.events;
  }

  function settleRide(world, run, ride) {
    if (!ride || !ride.lastOutcome) {
      return null;
    }
    run.attempts += 1;
    if (ride.lastOutcome.kind === "arrived") {
      if (ride.padUsed) {
        run.brakePads = Math.max(0, run.brakePads - 1);
      }
      if (run.deliveredTaskIds.indexOf(ride.taskId) === -1) {
        run.deliveredTaskIds.push(ride.taskId);
        run.deliveries.push({
          taskId: ride.taskId,
          taskName: ride.taskName,
          routeId: ride.routeId,
          routeLabel: ride.routeLabel,
          weightKg: ride.weightKg,
          arrivalSpeed: round(ride.speed, 2),
          elapsedSec: round(ride.elapsed, 2),
          brakeStartProgress:
            ride.brakeStartProgress == null
              ? null
              : round(ride.brakeStartProgress, 3),
          padUsed: ride.padUsed,
        });
      }
      run.toolsRemaining = Math.max(
        0,
        world.tasks.length - run.deliveredTaskIds.length,
      );
      run.status = run.toolsRemaining === 0 ? "complete" : "ready";
      snapshotRun(run);
      return {
        kind: "delivered",
        complete: run.status === "complete",
        outcome: ride.lastOutcome,
      };
    }

    if (ride.lastOutcome.kind === "stranded") {
      run.strands += 1;
    } else {
      run.crashes += 1;
    }
    run.lastFailure = {
      kind: ride.lastOutcome.kind,
      reason: ride.lastOutcome.reason,
      taskName: ride.taskName,
      routeLabel: ride.routeLabel,
      speed: ride.lastOutcome.speed,
      progress: ride.lastOutcome.progress,
      at: round(run.elapsedSec, 1),
    };
    run.failureReasons.push(run.lastFailure.reason);
    return {
      kind: ride.lastOutcome.kind,
      complete: false,
      outcome: ride.lastOutcome,
    };
  }

  function simulateRide(world, options) {
    const settings = options || {};
    const temporaryRun = createRun(world);
    const routeId = settings.routeId || world.routes[0].id;
    const ride = beginRide(
      world,
      temporaryRun,
      routeId,
      settings.weightKg == null ? 12 : settings.weightKg,
    );
    const brakeFrom =
      settings.brakeFrom == null ? Number.POSITIVE_INFINITY : settings.brakeFrom;
    const brakeTo =
      settings.brakeTo == null ? Number.POSITIVE_INFINITY : settings.brakeTo;
    let iterations = 0;
    while (ride.state === "riding" && iterations < 12000) {
      stepRide(
        world,
        ride,
        { braking: ride.progress >= brakeFrom && ride.progress <= brakeTo },
        1 / 120,
      );
      iterations += 1;
    }
    return ride;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = (safe % 60).toFixed(1).padStart(4, "0");
    return String(minutes).padStart(2, "0") + ":" + remainder;
  }

  function createStateSummary(world, run, options) {
    const settings = options || {};
    const status =
      settings.status ||
      (run.toolsRemaining === 0 ? "complete" : "incomplete");
    const finalTimeSec =
      settings.finalTimeSec == null ? run.elapsedSec : settings.finalTimeSec;
    const delivered = run.deliveries.length;
    const targetCount = world.tasks.length;
    const checks = {
      targetCountMatches:
        status === "complete"
          ? delivered === targetCount && run.toolsRemaining === 0
          : delivered + run.toolsRemaining === targetCount,
      resourcesRecorded:
        Number.isFinite(run.brakePads) &&
        Number.isFinite(run.rescueKits) &&
        run.brakePads >= 0 &&
        run.rescueKits >= 0,
      finalTimeRecorded: Number.isFinite(finalTimeSec) && finalTimeSec >= 0,
      layoutFingerprintStable: world.fingerprint === worldFingerprint(world),
    };
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      seed: world.seed,
      layoutFingerprint: world.fingerprint,
      status: status,
      targetCount: targetCount,
      deliveredCount: delivered,
      toolsRemaining: run.toolsRemaining,
      remainingResources: {
        brakePads: run.brakePads,
        rescueCords: run.rescueKits,
      },
      finalTimeSec: round(finalTimeSec, 1),
      finalTime: formatTime(finalTimeSec),
      path: run.deliveries.map(function copyPath(entry) {
        return Object.assign({}, entry);
      }),
      failures: run.failureReasons.slice(),
      failureSummary:
        run.failureReasons.length === 0
          ? "无碰撞或搁浅"
          : run.failureReasons.join("；"),
      recoverySummary: {
        recoveries: run.recoveries,
        rescueUses: run.rescueUses,
        log: run.recoveryLog.map(function copyRecovery(item) {
          return Object.assign({}, item);
        }),
      },
      checks: checks,
      verified: Object.keys(checks).every(function allPassed(key) {
        return checks[key];
      }),
    };
  }

  function validateSummary(summary, world) {
    const failures = [];
    if (!summary) {
      return { valid: false, failures: ["摘要缺失"] };
    }
    const targetMatches =
      summary.status === "complete"
        ? summary.deliveredCount === summary.targetCount &&
          summary.toolsRemaining === 0
        : summary.deliveredCount + summary.toolsRemaining === summary.targetCount;
    const resourcesRecorded =
      summary.remainingResources &&
      Number.isFinite(summary.remainingResources.brakePads) &&
      Number.isFinite(summary.remainingResources.rescueCords) &&
      summary.remainingResources.brakePads >= 0 &&
      summary.remainingResources.rescueCords >= 0;
    if (!targetMatches || !summary.checks.targetCountMatches) {
      failures.push("目标数量与已交付/剩余工具不一致");
    }
    if (!resourcesRecorded || !summary.checks.resourcesRecorded) {
      failures.push("剩余资源缺失或为负数");
    }
    if (
      !Number.isFinite(summary.finalTimeSec) ||
      summary.finalTimeSec < 0 ||
      !summary.checks.finalTimeRecorded
    ) {
      failures.push("最终用时未正确记录");
    }
    if (
      !summary.checks.layoutFingerprintStable ||
      typeof summary.layoutFingerprint !== "string"
    ) {
      failures.push("布局指纹无法从 seed 复算");
    }
    if (world && summary && summary.layoutFingerprint !== worldFingerprint(world)) {
      failures.push("摘要布局与当前 seed 不匹配");
    }
    return { valid: failures.length === 0, failures: failures };
  }

  return {
    WORLD_WIDTH: WORLD_WIDTH,
    WORLD_HEIGHT: WORLD_HEIGHT,
    PLATFORM: PLATFORM,
    SAFE_SPEED: SAFE_SPEED,
    STALL_SPEED: STALL_SPEED,
    BRAKE_PADS_START: BRAKE_PADS_START,
    RESCUE_CORDS_START: RESCUE_CORDS_START,
    TOOL_POOL: TOOL_POOL,
    ROUTE_PRESETS: ROUTE_PRESETS,
    clamp: clamp,
    round: round,
    hashString: hashString,
    mulberry32: mulberry32,
    routePoint: routePoint,
    createWorld: createWorld,
    worldFingerprint: worldFingerprint,
    compareWorlds: compareWorlds,
    createRun: createRun,
    snapshotRun: snapshotRun,
    restoreCheckpoint: restoreCheckpoint,
    beginRide: beginRide,
    stepRide: stepRide,
    settleRide: settleRide,
    simulateRide: simulateRide,
    formatTime: formatTime,
    createStateSummary: createStateSummary,
    validateSummary: validateSummary,
  };
});
