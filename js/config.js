// 全部调参集中在此；模拟只依赖这些常量与固定 seed，保证可重复。
export const CONFIG = {
  seed: 20260616,
  fixedDt: 1 / 60,
  maxSteps: 60 * 200, // 200 秒步数上限，给回退补救与人工操作留余量

  river: {
    startX: 0,
    length: 4600,
    halfWidth: 240,
    bankMargin: 46, // 船体可活动范围到河岸的安全余量
    baseFlow: 34 // 洪水主流速度（朝 -x 方向）
  },

  dock: { x: 4480, radius: 130 },

  boat: {
    startX: 90,
    startY: 0,
    radius: 22,
    maxSpeed: 115,
    reverseMax: 170,
    accel: 170,
    drag: 0.985,
    steer: 2.4,
    maxFuel: 140,
    fuelDrain: 0.85, // 每秒（油门工作时）
    idleFuelDrain: 0.1,
    maxHull: 100,
    idleStallSeconds: 8 // 燃料耗尽后静止多久判失败
  },

  // 三类漂浮物：普通/中等/危险；重量决定拖慢程度，危险物漏掉扣分
  debrisTypes: {
    wood: { label: '浮木', color: '#a9744f', weight: 1, score: 10, radius: 14 },
    reed: { label: '芦苇束', color: '#7fae5b', weight: 2, score: 15, radius: 15 },
    drum: { label: '危化桶', color: '#d9534f', weight: 4, score: 40, radius: 16, hazard: true }
  },
  debrisPlan: { wood: 5, reed: 5, drum: 4 },
  quota: { wood: 4, reed: 4, drum: 3 },
  missLimit: 3, // 漏掉的危险物达到该数即失败

  grab: { reach: 120, arc: 1.7, cooldown: 0.22 },
  cable: { min: 80, max: 260, step: 18, start: 160, capacity: 14 },

  piers: [
    { x: 900, y: -95, radius: 26 },
    { x: 900, y: 95, radius: 26 },
    { x: 2050, y: 0, radius: 30 },
    { x: 3200, y: -110, radius: 26 },
    { x: 3200, y: 110, radius: 26 }
  ],
  eddy: { radius: 130, spin: 1.6, pull: 34 },
  eddies: [
    { x: 900, y: 0 },
    { x: 2050, y: 0 },
    { x: 3200, y: 0 }
  ],

  checkpoints: [
    { x: 650, y: 0 },
    { x: 1500, y: 0 },
    { x: 2650, y: 0 },
    { x: 3750, y: 0 }
  ],

  collision: { pierDamage: 18, bankDamage: 10, snapDamage: 6 },
  startResources: { fuel: 100, hull: 100, score: 0 }
};

export const INPUTS = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  GRAB: 'grab',
  CABLE_UP: 'cableUp',
  CABLE_DOWN: 'cableDown'
});
