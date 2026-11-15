/* 沙暴滑翔机 —— 确定性核心 + 浏览器表现层。
 * 核心部分（RNG / 世界生成 / 物理步进）不依赖 DOM，可在 Node 中做确定性验证。 */
'use strict';

const SEED = 20261116;
const DT = 1 / 60;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 世界生成（全部由 seed 决定） ---------- */

const WORLD = {
  length: 9000,        // 赛道总长 (m)
  ceiling: 900,        // 最大高度 (m)
  ringCount: 9,        // 目标环数量
  ballastStart: 4,     // 初始压舱
  stormSpeed: 13,      // 尘幕推进速度 m/s
  stormStartX: -1400,  // 尘幕初始位置
};

function createWorld(seed) {
  const rng = mulberry32(seed);
  // 沙丘地形：若干正弦分量叠加，波长/振幅/相位均由 rng 决定
  const comps = [];
  for (let i = 0; i < 5; i++) {
    comps.push({
      amp: 12 + rng() * 46,
      wave: 220 + rng() * 640,
      phase: rng() * Math.PI * 2,
    });
  }
  const base = 40 + rng() * 30;
  const groundRaw = (x) => {
    let h = base;
    for (const c of comps) h += c.amp * (0.5 + 0.5 * Math.sin((x / c.wave) * Math.PI * 2 + c.phase));
    return h;
  };
  // 跑道与进近区域平整为基准高度（两侧 400m 余弦过渡）
  const runway = { x: WORLD.length - 520, w: 380, y: base };
  const flatStart = runway.x - 800;
  const flatEnd = runway.x + runway.w + 200;
  const groundAt = (x) => {
    if (x >= flatStart && x <= flatEnd) return base;
    if (x > flatStart - 400 && x < flatStart) {
      const t = (x - (flatStart - 400)) / 400;
      return groundRaw(x) * (1 - t) + base * t;
    }
    if (x > flatEnd && x < flatEnd + 400) {
      const t = (x - flatEnd) / 400;
      return base * (1 - t) + groundRaw(x) * t;
    }
    return groundRaw(x);
  };

  // 三层风带：各自风速、风向(+1 顺风 / -1 逆风)、垂直气流
  // 最低层固定为逆风，保证跑道进近可顶风着陆
  const windBands = [];
  for (let i = 0; i < 3; i++) {
    windBands.push({
      yMin: i * 300,
      yMax: (i + 1) * 300,
      speed: 6 + rng() * 10,
      dir: i === 0 ? -1 : (rng() < 0.5 ? -1 : 1),
      thermal: (rng() - 0.5) * 3,
    });
  }

  // 目标环：位置确定性分布，位于可巡航高度带内
  const rings = [];
  for (let i = 0; i < WORLD.ringCount; i++) {
    const x = 700 + (i + 0.5) * ((WORLD.length - 1600) / WORLD.ringCount) + (rng() - 0.5) * 300;
    const y = Math.max(groundAt(x) + 90, 360 + rng() * 280);
    rings.push({ x, y, r: 60, id: i });
  }

  // 障碍：岩柱（碰撞体），顶部高度限制在滑翔机可达剖面内
  const rocks = [];
  for (let i = 0; i < 6; i++) {
    const x = 1200 + rng() * (WORLD.length - 2600);
    let h = 60 + rng() * 110;
    const top = groundAt(x) + h;
    if (top > 200) h = Math.max(40, 200 - groundAt(x));
    rocks.push({ x, w: 26 + rng() * 30, h });
  }

  return { seed, comps, base, groundAt, windBands, rings, runway, rocks };
}

function layoutHash(world) {
  // 布局指纹：用于“另开新局布局相同”的核对
  let h = 2166136261 >>> 0;
  const mix = (n) => {
    const s = Math.round(n * 1000).toString(36);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  for (const c of world.comps) { mix(c.amp); mix(c.wave); mix(c.phase); }
  for (const b of world.windBands) { mix(b.speed); mix(b.dir); mix(b.thermal); }
  for (const r of world.rings) { mix(r.x); mix(r.y); }
  for (const r of world.rocks) { mix(r.x); mix(r.w); mix(r.h); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* ---------- 飞行状态与物理 ---------- */

function airDensity(y) {
  // 随高度指数衰减，地面约 1.22
  return 1.22 * Math.exp(-Math.max(0, y) / 8500);
}

function bandAt(world, y) {
  for (const b of world.windBands) if (y >= b.yMin && y < b.yMax) return b;
  return world.windBands[world.windBands.length - 1];
}

function createState(world) {
  return {
    t: 0,
    x: 120, y: 620,
    vx: 34, vy: 0,
    pitch: 0,             // 机体俯仰角 (rad, 上为正)
    wings: 1,             // 1=展开(高升力) 0=收拢(高速)
    ballast: WORLD.ballastStart,
    mass: 1.0,            // 相对质量，丢压舱会减小
    stalled: false,
    stormX: WORLD.stormStartX,
    ringsHit: 0,
    checkpoint: null,     // {x,y,vx,vy,ringId}
    status: 'flying',     // flying | landed | dead
    failReason: null,
    path: [{ x: 120, y: 620 }],
    events: [],           // 本帧事件（供表现层/测试消费）
  };
}

function snapshotCheckpoint(s, ringId) {
  return { x: s.x, y: s.y, vx: Math.max(28, s.vx), vy: 0, ringId };
}

function respawnAtCheckpoint(s) {
  const cp = s.checkpoint || { x: 120, y: 620, vx: 34, vy: 0, ringId: -1 };
  s.x = cp.x; s.y = cp.y; s.vx = cp.vx; s.vy = cp.vy;
  s.pitch = 0; s.stalled = false;
  s.status = 'flying'; s.failReason = null;
  s.stormX = Math.min(s.stormX, s.x - 900); // 给一次喘息窗口
  s.events.push({ type: 'respawn', x: s.x, y: s.y });
}

/* input: {pitch:-1..1, wingsToggle:bool, dropBallast:bool} */
function step(world, s, input, dt) {
  if (s.status !== 'flying') return s;
  s.events.length = 0;
  s.t += dt;

  if (input.wingsToggle) {
    s.wings = 1 - s.wings;
    s.events.push({ type: 'wings', value: s.wings });
  }
  if (input.dropBallast && s.ballast > 0) {
    s.ballast -= 1;
    s.mass *= 0.93; // 更轻：加速性更好，但惯性低
    s.events.push({ type: 'ballast', left: s.ballast });
  }

  // 俯仰指令 → 俯仰角（有响应速率，急拉会产生大迎角）
  const targetPitch = input.pitch * 0.55;
  const pitchRate = 2.6;
  const dPitch = Math.max(-pitchRate * dt, Math.min(pitchRate * dt, targetPitch - s.pitch));
  s.pitch += dPitch;

  const band = bandAt(world, s.y);
  const windX = band.speed * band.dir;
  const relVx = s.vx - windX;                 // 相对风速（水平）
  const relV = Math.hypot(relVx, s.vy - band.thermal);
  const rho = airDensity(s.y);

  // 迎角 ≈ 俯仰与相对气流方向之差
  const airflowAngle = Math.atan2(-(s.vy - band.thermal), Math.max(1, relVx));
  const aoa = s.pitch + airflowAngle;

  // 失速判定：大迎角 或 相对风速过低（质量越轻失速速度越低）
  const stallAoa = 0.6;
  const stallSpeed = 17 * Math.sqrt(s.mass);
  const wasStalled = s.stalled;
  s.stalled = Math.abs(aoa) > stallAoa || relV < stallSpeed;
  if (s.stalled && !wasStalled) s.events.push({ type: 'stall', on: true });
  if (!s.stalled && wasStalled) s.events.push({ type: 'stall', on: false });

  const wingArea = s.wings === 1 ? 1.0 : 0.55;
  const cl = s.stalled ? 0.25 : Math.min(1.6, 2.4 * aoa + 0.55) * wingArea;
  const cd = (s.stalled ? 0.9 : 0.045 + 0.9 * aoa * aoa) * (s.wings === 1 ? 1 : 0.7);
  const q = 0.5 * rho * relV * relV;
  const G = 9.8;
  const liftAcc = q * cl * 0.024 / s.mass;
  const dragAcc = q * cd * 0.02 / s.mass;

  // 动力学（简化二维）：重力沿航迹分量使下降增速 / 爬升减速
  const fpa = Math.atan2(s.vy, Math.max(4, s.vx));
  const ax = -Math.sign(relVx) * dragAcc - G * Math.sin(fpa);
  const ay = liftAcc * Math.cos(s.pitch) - G + band.thermal * 0.3;
  s.vx += ax * dt;
  s.vy += ay * dt;
  s.vx = Math.max(6, Math.min(90, s.vx));
  s.vy = Math.max(-60, Math.min(40, s.vy));
  s.x += s.vx * dt * 3;
  s.y += s.vy * dt * 3;
  s.y = Math.min(WORLD.ceiling, s.y);

  // 尘幕推进
  s.stormX += WORLD.stormSpeed * dt * 3;

  // 路径记录（抽稀）
  const last = s.path[s.path.length - 1];
  if (Math.hypot(s.x - last.x, s.y - last.y) > 25) s.path.push({ x: s.x, y: s.y });

  // 目标环判定 + 检查点
  for (const r of world.rings) {
    if (r.id <= (s.checkpoint ? s.checkpoint.ringId : -1)) continue;
    if (Math.hypot(s.x - r.x, s.y - r.y) < r.r) {
      s.ringsHit += 1;
      s.checkpoint = snapshotCheckpoint(s, r.id);
      s.events.push({ type: 'ring', id: r.id, hit: s.ringsHit });
    }
  }

  // 碰撞：地形 / 岩柱
  const ground = world.groundAt(s.x);
  const onRunway = s.x > world.runway.x && s.x < world.runway.x + world.runway.w;
  for (const rock of world.rocks) {
    if (Math.abs(s.x - rock.x) < rock.w && s.y < ground + rock.h && !onRunway) {
      s.status = 'dead'; s.failReason = '撞上岩柱';
      s.events.push({ type: 'crash', reason: s.failReason });
      return s;
    }
  }
  if (s.y <= ground) {
    if (onRunway && Math.abs(s.vy) < 9 && !s.stalled) {
      s.status = 'landed';
      s.events.push({ type: 'landed' });
    } else if (onRunway) {
      s.status = 'dead'; s.failReason = '重着陆：下降率过大或失速触地';
      s.events.push({ type: 'crash', reason: s.failReason });
    } else {
      s.status = 'dead';
      s.failReason = s.stalled ? '失速坠入沙丘' : '撞上沙丘';
      s.events.push({ type: 'crash', reason: s.failReason });
    }
    return s;
  }

  // 尘幕吞噬
  if (s.stormX >= s.x) {
    s.status = 'dead'; s.failReason = '被沙暴尘幕吞没';
    s.events.push({ type: 'crash', reason: s.failReason });
    return s;
  }

  // 飞出终点未着陆
  if (s.x > world.runway.x + world.runway.w + 300 && s.status === 'flying') {
    s.status = 'dead'; s.failReason = '飞越跑道未能降落';
    s.events.push({ type: 'crash', reason: s.failReason });
  }
  return s;
}

/* 能见度：尘幕越近越差（0..1） */
function visibility(s) {
  const d = s.x - s.stormX;
  return Math.max(0.08, Math.min(1, d / 2600));
}

/* 结算摘要 */
function buildSummary(world, s) {
  return {
    seed: world.seed,
    layout: layoutHash(world),
    targets: { hit: s.ringsHit, total: world.rings.length },
    ballastLeft: s.ballast,
    timeSec: Math.round(s.t * 100) / 100,
    result: s.status === 'landed' ? '成功降落' : '失败',
    failReason: s.failReason,
    pathPoints: s.path.length,
    path: s.path.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SEED, DT, WORLD, mulberry32, createWorld, layoutHash,
    createState, step, respawnAtCheckpoint, airDensity, bandAt,
    visibility, buildSummary,
  };
}

if (typeof window !== 'undefined') {
  window.Glider = {
    SEED, DT, WORLD, mulberry32, createWorld, layoutHash,
    createState, step, respawnAtCheckpoint, airDensity, bandAt,
    visibility, buildSummary,
  };
}
