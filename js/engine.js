import { CONFIG, INPUTS } from './config.js';
import { generateWorld } from './world.js';

const C = CONFIG;

export function createGame(seed = C.seed) {
  const world = generateWorld(seed);
  const state = {
    seed,
    world,
    status: 'running', // running | paused | won | lost
    failReason: null,
    time: 0,
    steps: 0,
    boat: {
      x: C.boat.startX,
      y: C.boat.startY,
      vx: 0,
      vy: 0,
      angle: 0,
      fuel: C.boat.maxFuel,
      hull: C.boat.maxHull
    },
    throttle: 0, // -1 倒车 ~ 1 全速
    cableLength: C.cable.start,
    towed: [], // debris id 序列
    collected: { wood: 0, reed: 0, drum: 0 }, // 已在回收点卸货数量
    score: 0,
    hazardMissed: 0,
    grabCooldown: 0,
    grabFlash: 0,
    tension: 0, // 0~1 缆绳张力
    stalledTime: 0,
    lastCheckpoint: {
      x: C.boat.startX,
      y: C.boat.startY,
      index: -1
    },
    checkpoint: null, // 最近一次快照
    events: [],
    feedback: { key: null, t: 0 },
    recoverCount: 0,
    snapCount: 0,
    invuln: 0,
    path: []
  };
  takeCheckpoint(state, true);
  state.path.push({ x: state.boat.x, y: state.boat.y });
  return state;
}

// 水流场：主流 -x；桥墩附近漩涡叠加回旋与向心拉力。
export function flowAt(world, x, y) {
  let vx = -C.river.baseFlow;
  let vy = 0;
  for (const eddy of world.eddies) {
    const dx = x - eddy.x;
    const dy = y - eddy.y;
    const dist = Math.hypot(dx, dy);
    if (dist < C.eddy.radius && dist > 0.001) {
      const k = 1 - dist / C.eddy.radius;
      const nx = dx / dist;
      const ny = dy / dist;
      // 切向回旋 + 向心拉力
      vx += (-ny * C.eddy.spin * 90 - nx * C.eddy.pull) * k;
      vy += (nx * C.eddy.spin * 90 - ny * C.eddy.pull) * k;
    }
  }
  return { vx, vy };
}

export function towWeight(state) {
  return state.towed.reduce((sum, id) => {
    const d = state.world.debris.find((it) => it.id === id);
    return sum + (d ? C.debrisTypes[d.type].weight : 0);
  }, 0);
}

function takeCheckpoint(state, initial = false) {
  state.checkpoint = snapshot(state);
  if (!initial) state.snapCount++;
}

export function snapshot(state) {
  return JSON.parse(
    JSON.stringify({
      boat: state.boat,
      throttle: state.throttle,
      cableLength: state.cableLength,
      towed: state.towed,
      collected: state.collected,
      score: state.score,
      hazardMissed: state.hazardMissed,
      tension: state.tension,
      stalledTime: state.stalledTime,
      lastCheckpoint: state.lastCheckpoint,
      time: state.time,
      steps: state.steps,
      debris: state.world.debris.map((d) => ({
        id: d.id,
        x: d.x,
        y: d.y,
        vx: d.vx,
        vy: d.vy,
        state: d.state,
        towIndex: d.towIndex,
        passedBy: d.passedBy
      })),
      checkpoints: state.world.checkpoints.map((c) => c.passed)
    })
  );
}

// 碰撞/搁浅后从内存检查点恢复，不刷新页面。
export function restoreCheckpoint(state, reason) {
  const snap = state.checkpoint;
  if (!snap) return;
  const currentTime = state.time;
  const currentSteps = state.steps;
  const currentHull = state.boat.hull;
  // 计算碰撞法线，恢复时沿远离障碍的方向横向偏移，避免复活后立刻再次撞击。
  let pushY = 0;
  const b0 = state.boat;
  for (const pier of state.world.piers) {
    const d = Math.hypot(b0.x - pier.x, b0.y - pier.y);
    if (d < pier.radius + C.boat.radius * 3) {
      pushY = b0.y >= pier.y ? 1 : -1;
      break;
    }
  }
  if (pushY === 0 && Math.abs(b0.y) > C.river.halfWidth - C.boat.bankMargin - 2) {
    pushY = b0.y > 0 ? -1 : 1;
  }
  state.boat = { ...snap.boat };
  state.throttle = snap.throttle;
  state.cableLength = snap.cableLength;
  state.towed = [...snap.towed];
  state.collected = { ...snap.collected };
  state.score = snap.score;
  state.hazardMissed = snap.hazardMissed;
  state.tension = 0;
  state.stalledTime = 0;
  // 时间与步数不回滚：恢复只重置空间状态，避免在检查点附近陷入时间循环。
  state.time = currentTime;
  state.steps = currentSteps;
  state.boat.hull = currentHull;
  state.invuln = 2.5; // 2.5 秒无敌，给玩家/机器人脱离障碍的窗口
  // 恢复后给一个向前的脱离速度，防止停在桥墩边缘立即再次碰撞。
  state.boat.vx = Math.max(state.boat.vx, 60);
  state.boat.vy = pushY * 90;
  state.boat.y += pushY * 60;
  // 若附近存在桥墩群，把恢复点夹到相邻桥墩的安全缝隙中线。
  const nearPiers = state.world.piers.filter((p) => Math.abs(p.x - state.boat.x) < 260);
  if (nearPiers.length >= 2) {
    const sorted = [...nearPiers].sort((a, z) => a.y - z.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapCenter = (sorted[i].y + sorted[i + 1].y) / 2;
      const gapHalf = Math.abs(sorted[i + 1].y - sorted[i].y) / 2 - sorted[i].radius - C.boat.radius - 10;
      if (gapHalf > 12) {
        state.boat.y = Math.max(-C.river.halfWidth + 60, Math.min(C.river.halfWidth - 60, gapCenter));
        state.boat.vy = 0;
        break;
      }
    }
  }
  state.recoverCount++;
  state.events.unshift({ kind: 'recover', reason, t: state.time });
  const byId = new Map(snap.debris.map((d) => [d.id, d]));
  for (const d of state.world.debris) {
    const s = byId.get(d.id);
    if (s) Object.assign(d, s);
  }
  state.world.checkpoints.forEach((c, i) => {
    c.passed = snap.checkpoints[i];
  });
  state.path.push({ x: state.boat.x, y: state.boat.y, recover: true });
}

function flash(state, key) {
  state.feedback = { key, t: 0.28 };
}

function handleHoldInputs(state, input, dt) {
  const b = state.boat;
  if (input[INPUTS.UP]) {
    state.throttle = Math.min(1, state.throttle + 0.7 * dt);
    flash(state, '油门加大');
  } else if (input[INPUTS.DOWN]) {
    state.throttle = Math.max(-1, state.throttle - 1.2 * dt);
    flash(state, '油门减小/倒车');
  }
  const speed = Math.hypot(b.vx, b.vy);
  const steerPower = C.boat.steer * (0.35 + Math.min(1, speed / 90));
  if (input[INPUTS.LEFT]) {
    b.angle -= steerPower * dt;
    flash(state, '左转');
  }
  if (input[INPUTS.RIGHT]) {
    b.angle += steerPower * dt;
    flash(state, '右转');
  }
  if (input[INPUTS.CABLE_UP]) {
    state.cableLength = Math.min(C.cable.max, state.cableLength + 70 * dt);
    flash(state, '放缆');
  }
  if (input[INPUTS.CABLE_DOWN]) {
    state.cableLength = Math.max(C.cable.min, state.cableLength - 70 * dt);
    flash(state, '收缆');
  }
}

function updateBoat(state, dt) {
  const b = state.boat;
  const load = towWeight(state);
  const loadFactor = Math.max(0.35, 1 - load / 22); // 垃圾串过重拖慢船
  const flow = flowAt(state.world, b.x, b.y);

  let thrusting = false;
  if (b.fuel > 0 && Math.abs(state.throttle) > 0.02) {
    thrusting = true;
    const throttleScale = state.throttle < 0 ? 3.0 : 1; // 倒车回退需要足够动力逆流
    b.vx += Math.cos(b.angle) * state.throttle * C.boat.accel * loadFactor * throttleScale * dt;
    b.vy += Math.sin(b.angle) * state.throttle * C.boat.accel * loadFactor * throttleScale * dt;
  }
  b.vx += flow.vx * 0.25 * dt;
  b.vy += flow.vy * 0.3 * dt;

  // C.boat.drag 是每帧（1/60s）系数；倒车用更弱的阻力保证回退动力。
  const dragPerFrame = state.throttle < 0 ? 0.9995 : C.boat.drag;
  const drag = Math.pow(dragPerFrame, dt * 60);
  b.vx *= drag;
  b.vy *= drag;
  const sp = Math.hypot(b.vx, b.vy);
  const cap = (state.throttle < 0 ? C.boat.reverseMax : C.boat.maxSpeed) * loadFactor;
  if (sp > cap) {
    b.vx = (b.vx / sp) * cap;
    b.vy = (b.vy / sp) * cap;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.fuel = Math.max(
    0,
    b.fuel - (thrusting ? C.boat.fuelDrain : C.boat.idleFuelDrain) * dt
  );

  if (b.fuel <= 0 && sp < 10) state.stalledTime += dt;
  else state.stalledTime = Math.max(0, state.stalledTime - dt * 0.5);

  checkBankAndPiers(state);
}

function checkBankAndPiers(state) {
  if (state.invuln > 0) return;
  const b = state.boat;
  const endLimit = C.river.length - 30;
  if (b.x > endLimit) {
    b.x = endLimit;
    b.vx = Math.min(0, b.vx) - 40;
  }
  const minX = C.river.startX - 120;
  if (b.x < minX) {
    b.x = minX;
    b.vx = Math.max(-40, b.vx);
  }
  const limit = C.river.halfWidth - C.boat.bankMargin;
  if (Math.abs(b.y) > limit) {
    b.y = Math.sign(b.y) * limit;
    b.vx *= 0.4;
    b.vy *= -0.3;
    b.hull -= C.collision.bankDamage;
    state.events.unshift({ kind: 'collision', reason: '搁浅河岸', t: state.time });
    b.vy = -Math.sign(b.y) * 120;
    state.invuln = 1.8;
    restoreCheckpoint(state, '搁浅河岸');
    return;
  }
  for (const pier of state.world.piers) {
    const d = Math.hypot(b.x - pier.x, b.y - pier.y);
    if (d < pier.radius + C.boat.radius) {
      b.hull -= C.collision.pierDamage;
      state.events.unshift({ kind: 'collision', reason: '撞击桥墩', t: state.time });
      restoreCheckpoint(state, '撞击桥墩');
      // 复活后若仍紧邻桥墩，沿法线推到安全圈外。
      const dd = Math.hypot(b.x - pier.x, b.y - pier.y) || 1;
      const safe = pier.radius + C.boat.radius + 40;
      if (dd < safe) {
        const nx = (b.x - pier.x) / dd;
        const ny = (b.y - pier.y) / dd;
        b.x = pier.x + nx * safe;
        b.y = pier.y + ny * safe;
        b.vx = Math.abs(nx) * 120;
        b.vy = ny * 120;
      }
      return;
    }
  }
}

function checkCheckpoints(state) {
  const b = state.boat;
  for (const cp of state.world.checkpoints) {
    if (!cp.passed && b.x >= cp.x) {
      cp.passed = true;
      state.lastCheckpoint = { x: cp.x, y: cp.y, index: cp.id };
      takeCheckpoint(state);
      state.events.unshift({ kind: 'checkpoint', reason: `检查点 ${cp.id + 1}`, t: state.time });
    }
  }
}

function updateDebris(state, dt) {
  const b = state.boat;
  for (const d of state.world.debris) {
    if (d.state === 'floating') {
      if (!d.passedBy && b.x > d.x + 60) d.passedBy = true;
      const flow = flowAt(state.world, d.x, d.y);
      // 漂浮物几乎停留在生成位置，只做小幅摆动，船错过后可回退补救。
      d.vx = flow.vx * 0.02;
      d.vy = flow.vy * 0.35 + Math.sin(state.time * 1.6 + d.phase) * 6;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const ty = C.debrisTypes[d.type];
      // 漂出地图左缘即漏失；只有曾进入船附近视野又被甩开的才算“漏掉”，
      // 避免船速较高时把前方未处理目标误判为漏失。
      // 危险物只有漂出地图左缘才算“漏掉”；普通物同样在出界后移除。
      // 船冲过目标不会立即判漏，给玩家回退补救的机会。
      const outOfMap = d.x < C.river.startX - 60;
      // 船一路冲到终点仍未处理（甩开近整条河道）才按漏掉处理。
      const abandoned = d.passedBy && b.x - d.x > C.river.length * 0.9;
      if (outOfMap || abandoned) {
        if (ty.hazard) {
          d.state = 'missed';
          state.hazardMissed++;
          state.score = Math.max(0, state.score - 25);
          state.events.unshift({
            kind: 'miss',
            reason: `漏掉危险物：${ty.label}（-25 分）`,
            t: state.time
          });
        } else {
          d.state = 'missed';
        }
      }
    }
  }

  // 拖曳串：沿船尾按缆绳长度等距排列，垃圾越重串越长越沉。
  const n = state.towed.length;
  state.towed.forEach((id, i) => {
    const d = state.world.debris.find((it) => it.id === id);
    if (!d) return;
    const spacing = n > 0 ? state.cableLength / n : state.cableLength;
    const dist = spacing * (i + 1);
    d.x = b.x - Math.cos(b.angle) * dist;
    d.y = b.y - Math.sin(b.angle) * dist;
    d.towIndex = i;
  });

  const weight = towWeight(state);
  const lengthStrain = 1 - (state.cableLength - C.cable.min) / (C.cable.max - C.cable.min);
  state.tension = Math.min(
    1.4,
    (weight / C.cable.capacity) * (0.75 + 0.5 * lengthStrain)
  );
  if (weight > C.cable.capacity) {
    state.events.unshift({ kind: 'snap', reason: '缆绳过载断裂，拖曳垃圾全部脱落', t: state.time });
    state.snapCount++;
    for (const id of state.towed) {
      const d = state.world.debris.find((it) => it.id === id);
      if (d) {
        d.state = 'floating';
        d.towIndex = -1;
        d.x = b.x - 120;
      }
    }
    state.towed = [];
    state.boat.hull -= C.collision.snapDamage;
    state.tension = 0;
  }
}

function tryGrab(state) {
  if (state.grabCooldown > 0) return;
  state.grabCooldown = C.grab.cooldown;
  state.grabFlash = 0.3;
  const b = state.boat;
  let best = null;
  let bestDist = Infinity;
  for (const d of state.world.debris) {
    if (d.state !== 'floating') continue;
    const dx = d.x - b.x;
    const dy = d.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > C.grab.reach) continue;
    const ang = Math.atan2(dy, dx);
    let diff = Math.abs(ang - b.angle);
    diff = Math.min(diff, Math.PI * 2 - diff);
    if (diff > C.grab.arc / 2) continue;
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  if (best) {
    best.state = 'towed';
    state.towed.push(best.id);
    const ty = C.debrisTypes[best.type];
    state.events.unshift({ kind: 'grab', reason: `抓住${ty.label}（负重 ${ty.weight}）`, t: state.time });
    flash(state, `抓斗：${ty.label}`);
  } else {
    state.events.unshift({ kind: 'grab', reason: '抓斗空挥', t: state.time });
    flash(state, '抓斗空挥');
  }
}

function checkDock(state) {
  const b = state.boat;
  const dock = state.world.dock;
  if (Math.hypot(b.x - dock.x, b.y - dock.y) > dock.radius) return;
  if (state.towed.length === 0) return;
  for (const id of state.towed) {
    const d = state.world.debris.find((it) => it.id === id);
    if (!d) continue;
    const ty = C.debrisTypes[d.type];
    d.state = 'unloaded';
    d.towIndex = -1;
    state.collected[d.type]++;
    state.score += ty.score;
  }
  state.events.unshift({
    kind: 'unload',
    reason: `回收点卸货 ${state.towed.length} 件（+${state.towed.reduce((s, id) => {
      const d = state.world.debris.find((it) => it.id === id);
      return s + (d ? C.debrisTypes[d.type].score : 0);
    }, 0)} 分）`,
    t: state.time
  });
  state.towed = [];
  state.tension = 0;
}

function checkEndConditions(state) {
  const { wood, reed, drum } = state.collected;
  const quotaMet =
    wood >= C.quota.wood && reed >= C.quota.reed && drum >= C.quota.drum;
  if (quotaMet) {
    state.status = 'won';
    state.events.unshift({ kind: 'win', reason: '三类漂浮物配额全部完成', t: state.time });
    return;
  }
  if (state.hazardMissed >= C.missLimit) {
    state.status = 'lost';
    state.failReason = `漏掉 ${state.hazardMissed} 件危险漂浮物（危化桶），污染超标`;
    state.events.unshift({ kind: 'lose', reason: state.failReason, t: state.time });
    return;
  }
  if (state.boat.hull <= 0) {
    state.status = 'lost';
    state.failReason = '船体结构损坏至 0，清漂船失去作业能力';
    state.events.unshift({ kind: 'lose', reason: state.failReason, t: state.time });
    return;
  }
  if (state.stalledTime >= C.boat.idleStallSeconds) {
    state.status = 'lost';
    state.failReason = '燃料耗尽且船只被水流困在河面，无法抵达回收点';
    state.events.unshift({ kind: 'lose', reason: state.failReason, t: state.time });
    return;
  }
  if (state.steps >= C.maxSteps) {
    state.status = 'lost';
    state.failReason = '超过作业时限仍未完成配额';
    state.events.unshift({ kind: 'lose', reason: state.failReason, t: state.time });
  }
}

// 单步推进。input 为持续按住状态；pressed 为本步刚按下的离散动作。
export function step(state, input = {}, pressed = {}) {
  if (state.status !== 'running') return state;
  const dt = C.fixedDt;
  state.time += dt;
  state.steps++;
  if (state.invuln > 0) state.invuln -= dt;
  if (state.feedback.t > 0) state.feedback.t -= dt;
  if (state.grabCooldown > 0) state.grabCooldown -= dt;
  if (state.grabFlash > 0) state.grabFlash -= dt;

  handleHoldInputs(state, input, dt);
  if (pressed[INPUTS.GRAB]) tryGrab(state);

  updateBoat(state, dt);
  if (state.status === 'lost') return state; // 碰撞恢复后仍可能因船体归零失败
  checkCheckpoints(state);
  updateDebris(state, dt);
  checkDock(state);
  checkEndConditions(state);

  if (state.steps % 6 === 0) {
    state.path.push({ x: state.boat.x, y: state.boat.y });
  }
  return state;
}

export function stateSignature(state) {
  const b = state.boat;
  return [
    state.seed,
    state.status,
    b.x.toFixed(3),
    b.y.toFixed(3),
    b.angle.toFixed(4),
    b.fuel.toFixed(3),
    b.hull.toFixed(1),
    state.cableLength.toFixed(2),
    state.towed.join(','),
    state.collected.wood,
    state.collected.reed,
    state.collected.drum,
    state.hazardMissed,
    state.score,
    state.world.debris.map((d) => `${d.id}${d.state[0]}${d.x.toFixed(2)}`).join(',')
  ].join('|');
}

// 状态摘要：目标数量、剩余资源、最终用时、路径与失败原因都要能核对。
export function buildSummary(state) {
  const remainingFloating = state.world.debris
    .filter((d) => d.state === 'floating' || d.state === 'towed')
    .map((d) => ({ id: d.id, type: d.type, state: d.state, x: +d.x.toFixed(1), y: +d.y.toFixed(1) }));
  return {
    seed: state.seed,
    status: state.status,
    failReason: state.failReason,
    finalTimeSeconds: +state.time.toFixed(2),
    steps: state.steps,
    targets: {
      quota: { ...C.quota },
      collected: { ...state.collected },
      quotaMet:
        state.collected.wood >= C.quota.wood &&
        state.collected.reed >= C.quota.reed &&
        state.collected.drum >= C.quota.drum,
      hazardMissed: state.hazardMissed,
      missLimit: C.missLimit
    },
    resources: {
      fuelRemaining: +state.boat.fuel.toFixed(2),
      hullRemaining: +Math.max(0, state.boat.hull).toFixed(1),
      score: state.score,
      cableLength: +state.cableLength.toFixed(1),
      towedCount: state.towed.length,
      towWeight: towWeight(state)
    },
    recovery: {
      checkpointsPassed: state.world.checkpoints.filter((c) => c.passed).length,
      totalCheckpoints: state.world.checkpoints.length,
      recoverCount: state.recoverCount,
      cableSnapCount: state.snapCount,
      lastCheckpoint: state.lastCheckpoint
    },
    events: state.events.slice(0, 24).reverse(),
    path: state.path,
    remainingFloating
  };
}
