/* 核心模拟：固定步长推进，逻辑不依赖 DOM，可在 Node 下直接验证。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rng.js'), require('./world.js'));
  } else {
    root.MarshGame = factory(root.MarshRng, root.MarshWorld);
  }
})(typeof self !== 'undefined' ? self : this, function (RngMod, World) {
  'use strict';

  var STEP = 1 / 30;
  var LIMIT = 240;
  var DRAFT = 0.5;
  var TURN_SPEED = 2.6;
  var ACCEL = 5.2;
  var MAX_SPEED = 4.2;
  var DRAG = 1.35;
  var FUEL_MAX = 100;
  var RECOVER_COST = 10;
  var SAMPLE_HOLD = 2;
  var BOAT_RADIUS = 0.32;

  var TIDE_FULL = 0.16;
  var TIDE_LOW = -0.2;
  var TIDE_DROP_START = 45;
  var TIDE_DROP_END = 150;

  function tideOffset(time) {
    if (time <= TIDE_DROP_START) return TIDE_FULL;
    if (time >= TIDE_DROP_END) return TIDE_LOW;
    var k = (time - TIDE_DROP_START) / (TIDE_DROP_END - TIDE_DROP_START);
    return TIDE_FULL + (TIDE_LOW - TIDE_FULL) * k;
  }

  function effectiveDepth(tile, time) {
    if (tile.depth < 0) return tile.depth;
    if (tile.tide) return tile.depth + tideOffset(time);
    return tile.depth;
  }

  function createGame(seedText) {
    var world = World.generateWorld(seedText);
    var start = world.dock;
    var state = {
      seed: String(seedText),
      world: world,
      status: 'running',
      time: 0,
      boat: {
        x: start.x + 0.5,
        y: start.y + 0.5,
        angle: 0,
        speed: 0
      },
      fuel: FUEL_MAX,
      samples: [],
      collected: 0,
      entangled: false,
      grounded: false,
      sampling: { active: false, stationId: 0, elapsed: 0 },
      checkpoint: null,
      events: [],
      path: [{ x: start.x + 0.5, y: start.y + 0.5 }],
      distance: 0,
      recoveries: 0,
      failureReason: null,
      feedbackFlash: null,
      flashTimer: 0,
      input: { up: false, down: false, left: false, right: false, action: false }
    };
    saveCheckpoint(state, { id: 0, x: start.x, y: start.y });
    return state;
  }

  function saveCheckpoint(state, cp) {
    state.checkpoint = {
      id: cp.id,
      x: cp.x,
      y: cp.y,
      boatX: state.boat.x,
      boatY: state.boat.y,
      angle: state.boat.angle,
      fuel: state.fuel,
      collected: state.collected,
      samples: state.samples.slice(),
      time: state.time
    };
  }

  function emit(state, type, message) {
    state.events.push({ time: round3(state.time), type: type, message: message });
    if (state.events.length > 60) state.events.shift();
  }

  function flash(state, kind, message) {
    state.feedbackFlash = { kind: kind, message: message };
    state.flashTimer = 1.4;
  }

  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  function tileAt(world, x, y) {
    var tx = Math.floor(x);
    var ty = Math.floor(y);
    if (!World.inBounds(tx, ty)) return null;
    return world.tiles[ty][tx];
  }

  return {
    STEP: STEP,
    LIMIT: LIMIT,
    DRAFT: DRAFT,
    FUEL_MAX: FUEL_MAX,
    RECOVER_COST: RECOVER_COST,
    SAMPLE_HOLD: SAMPLE_HOLD,
    BOAT_RADIUS: BOAT_RADIUS,
    tideOffset: tideOffset,
    effectiveDepth: effectiveDepth,
    createGame: createGame,
    setInput: setInput,
    step: step,
    recover: recover,
    tickShield: tickShield,
    nearestStation: nearestStation,
    buildSummary: buildSummary
  };
  function tileAt(world, x, y) {
    var tx = Math.floor(x);
    var ty = Math.floor(y);
    if (!World.inBounds(tx, ty)) return null;
    return world.tiles[ty][tx];
  }

  function step(state) {
    if (state.status !== 'running') return state;
    state.time = round3(state.time + STEP);
    if (state.flashTimer > 0) {
      state.flashTimer = Math.max(0, state.flashTimer - STEP);
      if (state.flashTimer === 0) state.feedbackFlash = null;
    }

    var boat = state.boat;
    var input = state.input;

    if (input.left) boat.angle -= TURN_SPEED * STEP;
    if (input.right) boat.angle += TURN_SPEED * STEP;

    var throttle = 0;
    if (input.up) throttle += 1;
    if (input.down) throttle -= 1;

    var current = tileAt(state.world, boat.x, boat.y);
    var depth = current ? effectiveDepth(current, state.time) : World.DEPTH.LAND;
    var shielded = state.shield && state.shield > 0;
    tickShield(state);
    var ground = depth < DRAFT && !shielded;

    state.grounded = depth < DRAFT;
    if (ground) {
      boat.speed *= 0.4;
      if (state.flashTimer === 0) {
        flash(state, 'warn', current && current.depth < 0 ? '撞上泥滩，按 R 从检查点脱困' : '水浅搁浅，按 R 从检查点脱困');
      }
    } else {
      if (throttle !== 0 && state.fuel > 0) {
        var acc = ACCEL * throttle;
        if (current && current.reed) acc *= 0.45;
        boat.speed += acc * STEP;
        state.fuel = Math.max(0, state.fuel - (0.55 + Math.abs(throttle) * 0.9) * STEP);
      }
      boat.speed -= boat.speed * DRAG * STEP;
      if (current && current.reed) boat.speed *= 0.9;
      boat.speed = Math.max(-MAX_SPEED * 0.5, Math.min(MAX_SPEED, boat.speed));
    }

    var vx = Math.cos(boat.angle) * boat.speed * STEP;
    var vy = Math.sin(boat.angle) * boat.speed * STEP;
    var nx = boat.x + vx;
    var ny = boat.y + vy;
    var nextTile = tileAt(state.world, nx, ny);
    var nextDepth = nextTile ? effectiveDepth(nextTile, state.time) : World.DEPTH.LAND;

    if (nextDepth < DRAFT) {
      boat.speed = 0;
      if (state.flashTimer === 0) flash(state, 'warn', '前方触底，转向或按 R 脱困');
      state.grounded = true;
    } else {
      state.distance += Math.hypot(nx - boat.x, ny - boat.y);
      boat.x = nx;
      boat.y = ny;
      state.path.push({ x: round3(boat.x), y: round3(boat.y) });
      if (state.path.length > 4000) state.path.shift();
    }

    resolveEntanglement(state, current);
    resolveSampling(state, current);
    resolveCheckpoints(state);
    resolveDock(state);

    if (state.fuel <= 0 && Math.abs(boat.speed) < 0.05 && state.status === 'running') {
      fail(state, '燃料耗尽，螺旋桨停转，被困在沼泽中');
    }
    if (state.time >= LIMIT && state.status === 'running') {
      fail(state, '潮位过低且任务超时，来路完全变浅无法返航');
    }
    return state;
  }

  function resolveEntanglement(state, current) {
    if (!current) return;
    if (current.grass && !state.entangled && Math.abs(state.boat.speed) > 0.4) {
      state.entangled = true;
      state.boat.speed = 0;
      flash(state, 'warn', '水草缠住推进器，按住空格清除');
      emit(state, 'entangle', '推进器被水草缠住');
    }
    if (state.entangled) {
      if (state.input.action) {
        state.fuel = Math.max(0, state.fuel - 1.2 * STEP);
        state.clearProgress = (state.clearProgress || 0) + STEP;
        if (state.clearProgress >= 1.2) {
          state.entangled = false;
          state.clearProgress = 0;
          flash(state, 'ok', '水草已清除，恢复推进');
          emit(state, 'clear', '清除缠绕的水草');
        }
      } else {
        state.clearProgress = 0;
      }
    }
  }

  function resolveSampling(state, current) {
    var station = nearestStation(state, 1.3);
    if (state.entangled) {
      state.sampling.active = false;
      return;
    }
    if (station && state.samples.indexOf(station.id) === -1 && state.input.action && !state.entangled) {
      if (!state.sampling.active || state.sampling.stationId !== station.id) {
        state.sampling = { active: true, stationId: station.id, elapsed: 0 };
        flash(state, 'info', '正在采样站 ' + station.id + ' 采泥，保持按住空格');
      }
      state.sampling.elapsed += STEP;
      if (state.sampling.elapsed >= SAMPLE_HOLD) {
        state.samples.push(station.id);
        state.collected = state.samples.length;
        state.sampling = { active: false, stationId: 0, elapsed: 0 };
        flash(state, 'ok', '已采集泥样 ' + station.id + '（' + state.collected + '/3）');
        emit(state, 'sample', '采集泥样 ' + station.id);
      }
    } else if (state.sampling.active) {
      state.sampling.active = false;
      state.sampling.elapsed = 0;
    }
  }

  function nearestStation(state, radius) {
    var boat = state.boat;
    var found = null;
    state.world.stations.forEach(function (s) {
      var d = Math.hypot(boat.x - (s.x + 0.5), boat.y - (s.y + 0.5));
      if (d <= radius && (!found || d < found.d)) found = { id: s.id, x: s.x, y: s.y, d: d };
    });
    return found;
  }

  function resolveCheckpoints(state) {
    var boat = state.boat;
    state.world.checkpoints.forEach(function (cp) {
      var d = Math.hypot(boat.x - (cp.x + 0.5), boat.y - (cp.y + 0.5));
      if (d <= 0.9 && (!state.checkpoint || state.checkpoint.id < cp.id)) {
        saveCheckpoint(state, cp);
        flash(state, 'ok', '检查点 ' + cp.id + ' 已记录，搁浅后可在此恢复');
        emit(state, 'checkpoint', '到达检查点 ' + cp.id);
      }
    });
  }

  function resolveDock(state) {
    var dock = state.world.dock;
    var d = Math.hypot(state.boat.x - (dock.x + 0.5), state.boat.y - (dock.y + 0.5));
    if (d <= 0.9 && state.collected >= 3) {
      state.status = 'won';
      state.boat.speed = 0;
      flash(state, 'ok', '三个泥样全部带回，任务完成');
      emit(state, 'win', '返回码头，任务成功');
    }
  }

  function fail(state, reason) {
    state.status = 'failed';
    state.failureReason = reason;
    state.boat.speed = 0;
    flash(state, 'error', reason);
    emit(state, 'fail', reason);
  }
  function fail(state, reason) {
    state.status = 'failed';
    state.failureReason = reason;
    state.boat.speed = 0;
    flash(state, 'error', reason);
    emit(state, 'fail', reason);
  }

  function recover(state) {
    if (state.status !== 'running' || !state.checkpoint) return state;
    if (state.fuel < RECOVER_COST) {
      flash(state, 'error', '燃料不足以执行检查点恢复（需要 ' + RECOVER_COST + '）');
      emit(state, 'recover-blocked', '燃料不足，无法恢复');
      return state;
    }
    var cp = state.checkpoint;
    state.boat.x = cp.boatX;
    state.boat.y = cp.boatY;
    state.boat.angle = cp.angle;
    state.boat.speed = 0;
    state.fuel = Math.max(0, state.fuel - RECOVER_COST);
    state.entangled = false;
    state.clearProgress = 0;
    state.grounded = false;
    state.sampling = { active: false, stationId: 0, elapsed: 0 };
    state.recoveries += 1;
    state.shield = 2;
    flash(state, 'ok', '已从检查点 ' + cp.id + ' 恢复，扣除燃料 ' + RECOVER_COST);
    emit(state, 'recover', '从检查点 ' + cp.id + ' 恢复');
    return state;
  }

  function setInput(state, key, pressed) {
    if (Object.prototype.hasOwnProperty.call(state.input, key)) {
      state.input[key] = !!pressed;
    }
  }

  function tickShield(state) {
    if (state.shield && state.shield > 0) {
      state.shield = Math.max(0, state.shield - STEP);
    }
  }

  function buildSummary(state) {
    return {
      seed: state.seed,
      layoutHash: state.world.layoutHash,
      status: state.status,
      result: state.status === 'won' ? '成功' : state.status === 'failed' ? '失败' : '进行中',
      failureReason: state.failureReason,
      targetTotal: state.world.stations.length,
      samplesCollected: state.collected,
      samplesRemaining: state.world.stations.length - state.collected,
      sampleIds: state.samples.slice(),
      fuelMax: FUEL_MAX,
      fuelRemaining: round3(state.fuel),
      fuelUsed: round3(FUEL_MAX - state.fuel),
      elapsed: round3(state.time),
      timeLimit: LIMIT,
      distance: round3(state.distance),
      recoveries: state.recoveries,
      checkpointId: state.checkpoint ? state.checkpoint.id : null,
      pathPoints: state.path.length,
      path: state.path.slice(),
      events: state.events.slice()
    };
  }

});
