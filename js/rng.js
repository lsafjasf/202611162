// 确定性随机:mulberry32,同 seed 产生同序列
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 预生成整个模拟期的确定性序列,重开同 seed 时完全一致
function buildSchedule(seed, totalDays) {
  const rand = mulberry32(seed);
  const weather = [];   // 每天天气: sunny / cloudy / storm
  const ships = [];     // 船只事件: {day, t(天内时刻), lane(0近1中2远), anchor(是否抛锚)}
  for (let d = 0; d < totalDays; d++) {
    const r = rand();
    weather.push(r < 0.5 ? 'sunny' : (r < 0.82 ? 'cloudy' : 'storm'));
    const n = 1 + Math.floor(rand() * 3); // 每天 1-3 艘
    for (let i = 0; i < n; i++) {
      ships.push({
        day: d,
        t: 0.1 + rand() * 0.8,
        lane: Math.floor(rand() * 3),
        anchor: rand() < 0.3,
        dir: rand() < 0.5 ? 1 : -1,
        speed: 0.6 + rand() * 0.5,
      });
    }
  }
  // 目标个体(重点修复斑块)位置也由 seed 决定
  const targets = [];
  for (let i = 0; i < 3; i++) {
    targets.push({ gx: 2 + Math.floor(rand() * 8), gy: 2 + Math.floor(rand() * 4) });
  }
  return { weather, ships, targets };
}
