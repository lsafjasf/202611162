import { CONFIG } from './config.js';
import { makeRng } from './rng.js';

// 地图、任务目标与障碍全部来自同一个 rng（同一个 seed）。
export function generateWorld(seed = CONFIG.seed) {
  const rng = makeRng(seed);
  const debris = [];
  let id = 0;

  for (const [type, count] of Object.entries(CONFIG.debrisPlan)) {
    for (let i = 0; i < count; i++) {
      const x = rng.range(360, CONFIG.river.length - 520);
      const y = rng.range(
        -CONFIG.river.halfWidth + 70,
        CONFIG.river.halfWidth - 70
      );
      debris.push({
        id: `d${id++}`,
        type,
        x,
        y,
        vx: 0,
        vy: 0,
        phase: rng.range(0, Math.PI * 2),
        state: 'floating', // floating | towed | unloaded | missed
        towIndex: -1,
        passedBy: false
      });
    }
  }

  // 装饰性水纹也由同一 rng 决定，但不参与碰撞与胜负，仅用于渲染。
  const ripples = Array.from({ length: 26 }, () => ({
    x: rng.range(0, CONFIG.river.length),
    y: rng.range(-CONFIG.river.halfWidth, CONFIG.river.halfWidth),
    r: rng.range(6, 18),
    phase: rng.range(0, Math.PI * 2)
  }));

  return {
    seed,
    debris,
    ripples,
    piers: CONFIG.piers.map((p) => ({ ...p })),
    eddies: CONFIG.eddies.map((e) => ({ ...e })),
    checkpoints: CONFIG.checkpoints.map((c, i) => ({ ...c, id: i, passed: false })),
    dock: { ...CONFIG.dock }
  };
}

// 布局指纹：同 seed 新开一局必须得到相同结果。
export function layoutSignature(world) {
  const parts = world.debris.map(
    (d) => `${d.id}:${d.type}:${d.x.toFixed(2)}:${d.y.toFixed(2)}`
  );
  const pierParts = world.piers.map((p) => `p:${p.x}:${p.y}`);
  const eddyParts = world.eddies.map((e) => `e:${e.x}:${e.y}`);
  return [...parts, ...pierParts, ...eddyParts].join('|');
}
