/* 世界生成：所有地图、任务点、障碍均来自同一个固定 seed，结果可完全复现 */
(function (global) {
  const { makeRng, hashSeed } = (typeof require !== 'undefined' ? require('./rng.js') : globalThis.SnowRng);
  const { C } = (typeof require !== 'undefined' ? require('./state.js') : globalThis.SnowState);

  const WIND_GROUPS = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  const ZONE_STRENGTH = [78, 105, 88];
  const OBSTACLE_TYPES = ['rock', 'rock', 'tree', 'tree', 'tree', 'drift', 'drift', 'iceblock'];
  const OBSTACLE_R = { rock: 30, tree: 26, drift: 46, iceblock: 34 };

  function zoneAt(y) {
    return Math.max(0, Math.min(C.ZONES - 1, Math.floor(y / C.ZONE_H)));
  }

  function windFor(world, y) {
    return world.zones[zoneAt(y)].wind;
  }

  function shuffle(rng, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function farFromPoints(x, y, points, minDist) {
    return points.every((p) => Math.hypot(x - p.x, y - p.y) >= minDist);
  }

  function windName(angle) {
    const deg = (((angle + Math.PI) * 180) / Math.PI + 360) % 360;
    const names = ['西风', '西北风', '北风', '东北风', '东风', '东南风', '南风', '西南风'];
    return names[Math.round(deg / 45) % 8];
  }

  function generateWorld(seed) {
    const rng = makeRng(seed);
    const zones = [];
    const deepPatches = [];
    const icePatches = [];
    const obstacles = [];
    const mails = [];
    const checkpoints = [];
    const protectedPoints = [{ x: C.START_X, y: C.START_Y }];

    const dirs = shuffle(rng, [0, 1, 2]);
    for (let z = 0; z < C.ZONES; z++) {
      const y0 = z * C.ZONE_H;
      const angle = WIND_GROUPS[dirs[z]] + rng.range(-0.35, 0.35);
      const strength = ZONE_STRENGTH[z] + rng.range(-12, 12);
      zones.push({
        index: z,
        y0,
        y1: y0 + C.ZONE_H,
        snowDepth: 0.35 + rng.range(0, 0.5),
        wind: { x: Math.cos(angle), y: Math.sin(angle), strength, angle, name: windName(angle) },
      });

      for (let i = 0; i < 4; i++) {
        deepPatches.push({ x: rng.range(90, C.WORLD_W - 90), y: rng.range(y0 + 220, y0 + C.ZONE_H - 220), r: rng.range(90, 150), grip: C.DEEP_GRIP, zone: z });
      }
      for (let i = 0; i < 2; i++) {
        icePatches.push({ x: rng.range(90, C.WORLD_W - 90), y: rng.range(y0 + 220, y0 + C.ZONE_H - 220), r: rng.range(60, 100), grip: C.ICE_GRIP, zone: z });
      }
    }

    for (let z = 0; z < C.ZONES; z++) {
      const y0 = z * C.ZONE_H;
      const cp = { id: `cp${z}`, x: C.START_X, y: y0 + C.ZONE_H - 120, zone: z, reached: z === 0 };
      checkpoints.push(cp);
      protectedPoints.push(cp);
      const lanes = shuffle(rng, [200, 450, 700]);
      for (let i = 0; i < 3; i++) {
        const mail = { id: `mail_${z}_${i}`, x: lanes[i] + rng.range(-55, 55), y: y0 + 420 + i * 380 + rng.range(-40, 40), zone: z, collected: false };
        mails.push(mail);
        protectedPoints.push(mail);
      }
    }

    const camp = { x: C.START_X, y: C.WORLD_H - 110, r: C.CAMP_RADIUS };
    camp.huts = [
      { dx: -70, dy: 10, w: 54, h: 44 },
      { dx: 0, dy: -30, w: 60, h: 48 },
      { dx: 70, dy: 10, w: 54, h: 44 },
    ];
    protectedPoints.push(camp);

    let oid = 0;
    for (let z = 0; z < C.ZONES; z++) {
      const y0 = z * C.ZONE_H;
      for (let i = 0; i < 8; i++) {
        const type = OBSTACLE_TYPES[rng.int(0, OBSTACLE_TYPES.length - 1)];
        let x = 0;
        let y = 0;
        let tries = 0;
        do {
          x = rng.range(70, C.WORLD_W - 70);
          y = rng.range(y0 + 200, y0 + C.ZONE_H - 200);
          tries++;
        } while (tries < 40 && (Math.abs(x - C.START_X) < 110 || !farFromPoints(x, y, protectedPoints, 130)));
        if (tries >= 40) continue;
        obstacles.push({ id: `obs${oid++}`, x, y, r: OBSTACLE_R[type], type, zone: z });
      }
    }

    return { seed, width: C.WORLD_W, height: C.WORLD_H, zones, deepPatches, icePatches, obstacles, mails, checkpoints, camp };
  }

  function serializeLayout(world) {
    return JSON.stringify({
      seed: world.seed,
      zones: world.zones,
      deepPatches: world.deepPatches,
      icePatches: world.icePatches,
      obstacles: world.obstacles,
      mails: world.mails,
      checkpoints: world.checkpoints,
      camp: world.camp,
    });
  }

  function layoutHash(world) {
    return hashSeed(serializeLayout(world)) >>> 0;
  }

  const api = { generateWorld, layoutHash, serializeLayout, zoneAt, windFor, windName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SnowWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
