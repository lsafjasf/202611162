/* 纯物理模块：抓地力、风、载荷刹车、防滑链、碰撞。无 DOM，可直接在 Node 测试 */
(function (global) {
  const { C } = (typeof require !== 'undefined' ? require('./state.js') : globalThis.SnowState);
  const { zoneAt, windFor } = (typeof require !== 'undefined' ? require('./world.js') : globalThis.SnowWorld);

  function surfaceAt(world, state) {
    const zone = world.zones[zoneAt(state.y)];
    let grip = 1 - zone.snowDepth * 0.45;
    let kind = 'snow';
    let patchR = 0;
    for (const p of world.deepPatches) {
      const d = Math.hypot(state.x - p.x, state.y - p.y);
      if (d <= p.r && p.grip < grip) { grip = p.grip; kind = 'deep'; patchR = p.r; }
    }
    for (const p of world.icePatches) {
      const d = Math.hypot(state.x - p.x, state.y - p.y);
      if (d <= p.r && p.grip < grip) { grip = p.grip; kind = 'ice'; patchR = p.r; }
    }
    if (state.chains) grip = Math.min(1, grip + C.CHAIN_GRIP_BONUS);
    grip = Math.max(0.18, Math.min(1, grip));
    return { grip, kind, zone: zone.index, patchR };
  }

  function resolveCircleObstacles(state, world) {
    const hits = [];
    const radius = C.TRUCK_W * 0.55;
    for (const o of world.obstacles) {
      const dx = state.x - o.x;
      const dy = state.y - o.y;
      const minDist = radius + o.r;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist && dist > 0.0001) {
        const nx = dx / dist;
        const ny = dy / dist;
        state.x = o.x + nx * minDist;
        state.y = o.y + ny * minDist;
        const vn = state.vx * nx + state.vy * ny;
        if (vn < 0) {
          state.vx -= (1 + C.HIT_BOUNCE) * vn * nx;
          state.vy -= (1 + C.HIT_BOUNCE) * vn * ny;
          hits.push({ obstacle: o, impact: -vn });
        }
      }
    }
    return hits;
  }

  function stepTruck(state, input, world, dt) {
    const surf = surfaceAt(world, state);
    const grip = surf.grip;
    const fx = Math.cos(state.heading);
    const fy = Math.sin(state.heading);

    let vlon = state.vx * fx + state.vy * fy;
    let vlat = state.vx * -fy + state.vy * fx;

    if (input.throttle > 0) {
      if (vlon < -12) vlon += C.BRAKE_DECEL * dt;
      else vlon += C.ENGINE_ACCEL * input.throttle * grip * dt;
    } else if (input.brake) {
      if (vlon > 0) {
        const mailPenalty = 1 - C.MAIL_BRAKE_FACTOR * state.mail;
        vlon -= C.BRAKE_DECEL * grip * mailPenalty * dt;
        if (vlon < 0) vlon = 0;
      } else {
        vlon -= C.REVERSE_ACCEL * grip * dt;
      }
    }

    vlon -= vlon * C.DRAG * (1.15 - grip * 0.5) * dt;

    const wind = windFor(world, state.y);
    const windPush = wind.strength * (1.1 - grip * 0.6);
    const wlon = wind.x * fx + wind.y * fy;
    const wlat = wind.x * -fy + wind.y * fx;
    vlon += wlon * windPush * dt;
    vlat += wlat * windPush * dt;

    const steerGrip = 0.35 + 0.65 * grip;
    if (Math.abs(vlon) > 6) {
      const dir = vlon > 0 ? 1 : -1;
      state.heading += input.steer * C.TURN_RATE * steerGrip * dir * dt;
    }
    vlat -= vlat * C.LAT_GRIP * grip * dt;

    const maxSpeed = C.MAX_SPEED * (surf.kind === 'deep' ? 0.72 : 1);
    vlon = Math.max(-C.REVERSE_SPEED, Math.min(maxSpeed, vlon));

    const nfx = Math.cos(state.heading);
    const nfy = Math.sin(state.heading);
    state.vx = nfx * vlon + -nfy * vlat;
    state.vy = nfy * vlon + nfx * vlat;

    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.x = Math.max(30, Math.min(world.width - 30, state.x));
    if (state.x <= 30 || state.x >= world.width - 30) state.vx *= -0.3;
    state.y = Math.max(20, Math.min(world.height - 20, state.y));

    state.speed = Math.hypot(state.vx, state.vy);
    const hits = resolveCircleObstacles(state, world);
    state.speed = Math.hypot(state.vx, state.vy);
    return { surf, hits };
  }

  const api = { surfaceAt, stepTruck, resolveCircleObstacles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SnowPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
