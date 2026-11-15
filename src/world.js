import { makeRng, range, makeValueNoise, hashSeed } from './rng.js';

export const WORLD_W = 2400;
export const WORLD_H = 1800;
export const CELL = 40;

export const TERRAIN = {
  gravel: { grip: 1.0, drag: 0.55, label: '砾石', color: '#8d7a5c' },
  sand: { grip: 0.72, drag: 1.05, label: '沙地', color: '#c9a76a' },
  silt: { grip: 0.48, drag: 1.85, label: '粉土', color: '#d8c6a0' }
};

export const CAMP = { x: 240, y: WORLD_H - 240, radius: 78 };
export const TARGET_RADIUS = 58;

function farEnough(point, others, minDist) {
  return others.every((other) => {
    const dx = point.x - other.x;
    const dy = point.y - other.y;
    return Math.hypot(dx, dy) >= minDist;
  });
}

export function generateWorld(seed) {
  const noise = makeValueNoise(seed);
  const cols = Math.ceil(WORLD_W / CELL);
  const rows = Math.ceil(WORLD_H / CELL);
  const terrain = new Array(cols * rows);

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const n = noise(cx * 0.18, cy * 0.18) * 0.62 + noise(cx * 0.45, cy * 0.45) * 0.38;
      let type = 'gravel';
      if (n > 0.62) type = 'silt';
      else if (n > 0.46) type = 'sand';
      // 营地周围保证是砾石，避免开局即搁浅。
      const wx = cx * CELL + CELL / 2;
      const wy = cy * CELL + CELL / 2;
      if (Math.hypot(wx - CAMP.x, wy - CAMP.y) < 180) type = 'gravel';
      terrain[cy * cols + cx] = type;
    }
  }

  function terrainAt(x, y) {
    const cx = Math.max(0, Math.min(cols - 1, Math.floor(x / CELL)));
    const cy = Math.max(0, Math.min(rows - 1, Math.floor(y / CELL)));
    return terrain[cy * cols + cx];
  }

  const targetRng = makeRng(seed, 'targets');
  const targets = [];
  const anchors = [{ x: CAMP.x, y: CAMP.y }];
  let guard = 0;
  while (targets.length < 3 && guard < 400) {
    guard += 1;
    const candidate = {
      x: Math.round(range(targetRng, 420, WORLD_W - 220)),
      y: Math.round(range(targetRng, 200, WORLD_H - 220)),
      radius: TARGET_RADIUS
    };
    if (!farEnough(candidate, anchors, 620)) continue;
    targets.push({ ...candidate, id: targets.length + 1, polePlaced: false });
    anchors.push(candidate);
  }

  const rockRng = makeRng(seed, 'rocks');
  const rocks = [];
  const keepouts = [CAMP, ...targets];
  guard = 0;
  while (rocks.length < 14 && guard < 600) {
    guard += 1;
    const rock = {
      x: Math.round(range(rockRng, 120, WORLD_W - 120)),
      y: Math.round(range(rockRng, 120, WORLD_H - 120)),
      radius: Math.round(range(rockRng, 22, 46))
    };
    if (keepouts.some((k) => Math.hypot(rock.x - k.x, rock.y - k.y) < k.radius + 200)) continue;
    if (!farEnough(rock, rocks, 120)) continue;
    rocks.push(rock);
  }

  const landRng = makeRng(seed, 'landmarks');
  const landmarks = [];
  guard = 0;
  while (landmarks.length < 4 && guard < 400) {
    guard += 1;
    const mark = {
      x: Math.round(range(landRng, 300, WORLD_W - 200)),
      y: Math.round(range(landRng, 180, WORLD_H - 180)),
      radius: 150
    };
    if (!farEnough(mark, [...keepouts, ...rocks, ...landmarks], 260)) continue;
    landmarks.push(mark);
  }

  const fingerprint = makeFingerprint(seed, { terrain, cols, rows, targets, rocks, landmarks });

  return {
    seed,
    width: WORLD_W,
    height: WORLD_H,
    cols,
    rows,
    terrain,
    terrainAt,
    camp: { ...CAMP },
    targets,
    rocks,
    landmarks,
    fingerprint
  };
}

function makeFingerprint(seed, parts) {
  let h = hashSeed(`fp::${seed}`);
  function eat(num) {
    h = Math.imul(h ^ (Math.round(num * 1000) | 0), 0x01000193) >>> 0;
  }
  for (const cell of parts.terrain) eat(cell.charCodeAt(0));
  for (const list of [parts.targets, parts.rocks, parts.landmarks]) {
    for (const item of list) {
      eat(item.x);
      eat(item.y);
      eat(item.radius);
    }
  }
  return h.toString(16).padStart(8, '0');
}
