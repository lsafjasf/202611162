/* 全局常量与状态管理：初始状态、检查点快照、失败原因、状态摘要 */
(function (global) {
  const C = {
    FIXED_DT: 1 / 60,
    WORLD_W: 900,
    ZONE_H: 1600,
    ZONES: 3,
    START_X: 450,
    START_Y: 120,
    TRUCK_L: 46,
    TRUCK_W: 24,
    MAX_SPEED: 340,
    REVERSE_SPEED: 130,
    ENGINE_ACCEL: 165,
    BRAKE_DECEL: 250,
    REVERSE_ACCEL: 110,
    DRAG: 0.55,
    TURN_RATE: 2.6,
    LAT_GRIP: 8,
    MAIL_BRAKE_FACTOR: 0.06,
    CHAIN_GRIP_BONUS: 0.35,
    DEEP_GRIP: 0.55,
    ICE_GRIP: 0.3,
    FUEL_MAX: 100,
    FUEL_IDLE: 0.18,
    FUEL_THROTTLE: 0.42,
    HEALTH_MAX: 100,
    HIT_DAMAGE: 18,
    HIT_BOUNCE: 0.42,
    RESCUE_FUEL_GIFT: 18,
    RESCUE_HEALTH_GIFT: 25,
    RESCUE_FUEL_COST: 6,
    STUCK_SPEED: 8,
    STUCK_SECONDS: 6,
    MAIL_REQUIRED: 9,
    CHECKPOINT_RADIUS: 70,
    MAIL_RADIUS: 30,
    CAMP_RADIUS: 110,
  };
  C.WORLD_H = C.ZONE_H * C.ZONES;

  function createInitialState(world) {
    return {
      x: C.START_X,
      y: C.START_Y,
      vx: 0,
      vy: 0,
      heading: Math.PI / 2,
      speed: 0,
      throttle: 0,
      brake: false,
      steering: 0,
      chains: false,
      fuel: C.FUEL_MAX,
      health: C.HEALTH_MAX,
      mail: 0,
      elapsed: 0,
      status: 'running',
      failReason: null,
      currentZone: 0,
      stuckTimer: 0,
      checkpoints: world.checkpoints.map((cp, i) => ({ ...cp, reached: i === 0 })),
      lastCheckpoint: 0,
      mails: world.mails.map((m) => ({ ...m, collected: false })),
      path: [{ x: C.START_X, y: C.START_Y }],
      ruts: [],
      chainToggledAt: -10,
      rescueCount: 0,
      finishedAt: null,
    };
  }

  function snapshotCheckpoint(state, cpIndex) {
    const cp = state.checkpoints[cpIndex];
    return {
      cpIndex,
      x: cp.x,
      y: cp.y + 40,
      vx: 0,
      vy: 0,
      heading: Math.PI / 2,
      speed: 0,
      fuel: state.fuel,
      health: state.health,
      mail: state.mail,
      elapsed: state.elapsed,
      mails: state.mails.map((m) => ({ ...m })),
      checkpoints: state.checkpoints.map((c) => ({ ...c })),
      path: state.path.map((p) => ({ ...p })),
      ruts: state.ruts.map((r) => ({ ...r })),
    };
  }

  function restoreCheckpoint(state, snap) {
    state.x = snap.x;
    state.y = snap.y;
    state.vx = snap.vx;
    state.vy = snap.vy;
    state.heading = snap.heading;
    state.speed = snap.speed;
    state.fuel = snap.fuel;
    state.health = snap.health;
    state.mail = snap.mail;
    state.elapsed = snap.elapsed;
    state.mails = snap.mails.map((m) => ({ ...m }));
    state.checkpoints = snap.checkpoints.map((c) => ({ ...c }));
    state.lastCheckpoint = snap.cpIndex;
    state.path = snap.path.map((p) => ({ ...p }));
    state.ruts = snap.ruts.map((r) => ({ ...r }));
    state.status = 'running';
    state.failReason = null;
    state.stuckTimer = 0;
    state.throttle = 0;
    state.brake = false;
    state.steering = 0;
  }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  function advanceStuck(state, wantsMove, surfKind, dt) {
    const lowGrip = surfKind === 'deep' || surfKind === 'ice';
    if (wantsMove && lowGrip && state.speed < C.STUCK_SPEED) {
      state.stuckTimer += dt;
      return state.stuckTimer >= C.STUCK_SECONDS;
    }
    if (state.speed >= C.STUCK_SPEED || !wantsMove || !lowGrip) state.stuckTimer = 0;
    return false;
  }

  function reachedCamp(state, world) {
    return state.mail >= C.MAIL_REQUIRED &&
      Math.hypot(state.x - world.camp.x, state.y - world.camp.y) <= C.CAMP_RADIUS;
  }

  function buildSummary(world, state, seed) {
    return {
      seed,
      status: state.status,
      failReason: state.failReason,
      targetsTotal: C.MAIL_REQUIRED,
      mailCollected: state.mail,
      mailRemaining: C.MAIL_REQUIRED - state.mail,
      checkpointsReached: state.checkpoints.filter((c) => c.reached).length,
      checkpointsTotal: state.checkpoints.length,
      fuelLeft: Math.round(state.fuel * 10) / 10,
      healthLeft: Math.round(state.health * 10) / 10,
      elapsedSeconds: Math.round(state.elapsed * 10) / 10,
      elapsedText: formatTime(state.elapsed),
      rescueCount: state.rescueCount,
      pathPoints: state.path.length,
      camp: { ...world.camp },
    };
  }

  const api = { C, createInitialState, snapshotCheckpoint, restoreCheckpoint, buildSummary, formatTime, advanceStuck, reachedCamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SnowState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
