import { makeRng } from './rng.js';
import { generateWorld } from './world.js';
import { CONFIG, STATUS } from './config.js';
import { handleCollisions, deployPole, calibrate, recover, buildSummary } from './actions.js';
import { pushEvent, setCheckpoint } from './helpers.js';

export { generateWorld, buildSummary };
export { pushEvent, setCheckpoint };

export function createGame(seed) {
  const world = generateWorld(seed);
  const rng = makeRng(seed, 'wind');
  const state = {
    seed,
    world,
    rng,
    status: STATUS.DRIVING,
    elapsed: 0,
    timeLeft: CONFIG.timeLimit,
    fuel: CONFIG.fuelMax,
    polesCarried: CONFIG.startPoles,
    targets: world.targets.map((t) => ({ ...t, polePlaced: false })),
    droppedPoles: [],
    vehicle: {
      x: world.camp.x,
      y: world.camp.y,
      angle: -0.6,
      speed: 0,
      steering: 0,
      terrain: 'gravel',
      grip: 1
    },
    wind: { angle: 0, strength: 0, targetAngle: 0, targetStrength: 0, timer: 0 },
    compass: { error: CONFIG.maxCompassError * 0.5, calibrating: false, progress: 0 },
    checkpoint: null,
    recoverCooldown: 0,
    path: [{ x: world.camp.x, y: world.camp.y, t: 0 }],
    ruts: [],
    pathTimer: 0,
    rutTimer: 0,
    events: [],
    flash: {},
    endReason: '',
    endSummary: null
  };
  setCheckpoint(state);
  pushEvent(state, '任务开始：在三个测点布置测量杆并返回营地。');
  return state;
}

function stepWind(state, dt) {
  if (CONFIG.noWind) {
    state.wind.angle = 0;
    state.wind.strength = 0;
    state.wind.targetAngle = 0;
    state.wind.targetStrength = 0;
    return;
  }
  const wind = state.wind;
  wind.timer -= dt;
  if (wind.timer <= 0) {
    wind.timer = CONFIG.windInterval;
    wind.targetAngle = state.rng() * Math.PI * 2;
    wind.targetStrength = state.rng();
  }
  const k = Math.min(1, dt * 1.6);
  wind.angle += (wind.targetAngle - wind.angle) * k;
  wind.strength += (wind.targetStrength - wind.strength) * k;
  state.compass.error = Math.min(
    CONFIG.maxCompassError,
    state.compass.error + wind.strength * CONFIG.windErrorGain * dt
  );
}

function stepVehicle(state, dt, input) {
  const v = state.vehicle;
  v.terrain = state.world.terrainAt(v.x, v.y);
  v.grip = gripFromTerrain(v.terrain);

  const steerTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const rate = CONFIG.steeringReturn * dt;
  if (steerTarget !== 0) v.steering += (steerTarget - v.steering) * Math.min(1, rate * 2.2);
  else v.steering += (0 - v.steering) * Math.min(1, rate);

  if (input.accelerate) v.speed += CONFIG.accel * v.grip * dt;
  if (input.brake) {
    v.speed -= (v.speed > 0 ? CONFIG.brake : CONFIG.reverseAccel) * v.grip * dt;
  }

  const drag = terrainDrag(v.terrain);
  v.speed -= v.speed * drag * dt;
  if (!input.accelerate && !input.brake && Math.abs(v.speed) < 2) v.speed = 0;
  v.speed = Math.max(-CONFIG.maxReverse, Math.min(CONFIG.maxSpeed, v.speed));

  if (Math.abs(v.speed) > 1) {
    v.angle += v.steering * CONFIG.turnRate * dt * Math.sign(v.speed) * (0.35 + 0.65 * v.grip);
  }

  const wx = Math.cos(state.wind.angle) * state.wind.strength * CONFIG.windAccel * dt;
  const wy = Math.sin(state.wind.angle) * state.wind.strength * CONFIG.windAccel * dt;
  v.x += Math.cos(v.angle) * v.speed * dt + wx;
  v.y += Math.sin(v.angle) * v.speed * dt + wy;
  v.x = Math.max(20, Math.min(state.world.width - 20, v.x));
  v.y = Math.max(20, Math.min(state.world.height - 20, v.y));
}

export function gripFromTerrain(type) {
  if (type === 'sand') return 0.72;
  if (type === 'silt') return 0.48;
  return 1;
}

function terrainDrag(type) {
  if (type === 'sand') return 0.85;
  if (type === 'silt') return 1.25;
  return 0.45;
}

const EMPTY_INPUT = { accelerate: false, brake: false, left: false, right: false };

export function stepGame(state, dt, rawInput = {}) {
  const input = { ...EMPTY_INPUT, ...rawInput };
  const deployPressed = !!input.deploy && !state.prevDeploy;
  const recoverPressed = !!input.recover && !state.prevRecover;
  state.prevDeploy = !!input.deploy;
  state.prevRecover = !!input.recover;
  for (const key of Object.keys(state.flash)) {
    state.flash[key] = Math.max(0, state.flash[key] - dt);
  }
  if (state.status === STATUS.PAUSED) return state;
  if (state.status === STATUS.WON || state.status === STATUS.FAILED) return state;

  state.elapsed += dt;
  state.timeLeft = Math.max(0, CONFIG.timeLimit - state.elapsed);
  state.recoverCooldown = Math.max(0, state.recoverCooldown - dt);

  if (recoverPressed) recover(state);

  if (state.status !== STATUS.STRANDED) {
    stepWind(state, dt);
    stepVehicle(state, dt, input);
    handleCollisions(state);

    const moving = Math.abs(state.vehicle.speed) > 4;
    state.fuel = Math.max(0, state.fuel - (moving ? CONFIG.fuelDriving : CONFIG.fuelIdle) * dt);

    state.pathTimer += dt;
    if (state.pathTimer >= CONFIG.pathInterval) {
      state.pathTimer = 0;
      state.path.push({ x: state.vehicle.x, y: state.vehicle.y, t: state.elapsed });
    }
    state.rutTimer += dt;
    if (state.rutTimer >= CONFIG.rutInterval && moving) {
      state.rutTimer = 0;
      const back = {
        x: state.vehicle.x - Math.cos(state.vehicle.angle) * 15,
        y: state.vehicle.y - Math.sin(state.vehicle.angle) * 15
      };
      state.ruts.push({ ...back, terrain: state.vehicle.terrain });
      if (state.ruts.length > CONFIG.maxRuts) state.ruts.shift();
    }

    if (deployPressed) deployPole(state);
    if (input.calibrate) calibrate(state, dt);
    else state.compass.calibrating = false;
  }

  checkWinAtEnd(state);
  if (state.status === STATUS.DRIVING && state.fuel <= 0) {
    state.status = STATUS.FAILED;
    state.endReason = '燃料耗尽，测绘车在高原上失去动力。';
    pushEvent(state, state.endReason, 'fail');
  }
  if (state.status === STATUS.DRIVING && state.timeLeft <= 0) {
    state.status = STATUS.FAILED;
    state.endReason = '任务超时，沙尘季窗口结束。';
    pushEvent(state, state.endReason, 'fail');
  }
  if (state.status === STATUS.FAILED || state.status === STATUS.WON) {
    state.endSummary = buildSummary(state);
  }
  return state;
}

function checkWinAtEnd(state) {
  if (state.status !== STATUS.DRIVING) return;
  const allPlaced = state.targets.every((t) => t.polePlaced);
  if (!allPlaced) return;
  const camp = state.world.camp;
  if (Math.hypot(state.vehicle.x - camp.x, state.vehicle.y - camp.y) > camp.radius) return;
  state.status = STATUS.WON;
  state.endReason = '三个测点全部完成，测绘车安全返回营地。';
  state.vehicle.speed = 0;
  pushEvent(state, state.endReason, 'good');
}

export function pauseGame(state) {
  if (state.status === STATUS.DRIVING) state.status = STATUS.PAUSED;
}

export function resumeGame(state) {
  if (state.status === STATUS.PAUSED) state.status = STATUS.DRIVING;
}

export function restartGame(state) {
  const fresh = createGame(state.seed);
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, fresh);
  return state;
}
