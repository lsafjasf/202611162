// 无头验证:同 seed 复现一致性 + 三种状态触发 + 策略代价对比
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '../js/rng.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../js/sim.js'), 'utf8'));
function run(seed, script) {
  const sim = createSim(seed);
  const dt = 0.02;
  while (!sim.over) {
    updateSim(sim, dt);
    if (script) script(sim);
    if (sim.day > 40) break;
  }
  return sim;
}
// 1) 同 seed 两次运行:天气/船只/目标/初始资源/关键事件顺序一致
const a = run(42), b = run(42);
console.assert(JSON.stringify(a.sched.weather) === JSON.stringify(b.sched.weather), '天气序列不一致');
console.assert(JSON.stringify(a.sched.targets) === JSON.stringify(b.sched.targets), '目标个体不一致');
console.assert(JSON.stringify(a.sched.ships) === JSON.stringify(b.sched.ships), '船只序列不一致');
console.assert(a.funds === b.funds && coverageOf(a) === coverageOf(b), '同 seed 结果不一致');
console.log('同 seed 复现:PASS  最终覆盖', coverageOf(a).toFixed(3), '浊度', a.turb.toFixed(1));
// 2) 不同 seed 应不同
const c = run(7);
console.assert(JSON.stringify(a.sched.weather) !== JSON.stringify(c.sched.weather), '不同 seed 天气应不同');
console.log('异 seed 区分:PASS');
// 3) 打桩过密触发失败操作记录
const d = createSim(42);
for (let i = 0; i < 9; i++) { d.funds += 200; opStake(d); }
console.assert(d.failureRecord, '过密打桩未记录失败');
console.log('失败操作记录:PASS -', d.failureRecord.why);
// 4) 策略A/B 代价与效果
const e = createSim(42);
e.funds = 2000; e.seedlings = 100;
const covBefore = coverageOf(e);
opTransplant(e);
console.assert(coverageOf(e) > covBefore && e.funds === 1700, '策略A 效果/代价异常');
opEnclosure(e);
console.assert(e.enclosureUntil > e.day && e.funds === 1600, '策略B 代价异常');
console.log('策略A(-300资-20苗,立即+覆盖) / 策略B(-100资,5天封育):PASS');
// 5) 连续变化:浊度不应逐帧跳变(相邻步变化有界)
const f = createSim(42);
let maxJump = 0;
for (let i = 0; i < 5000; i++) {
  const t0 = f.turb;
  updateSim(f, 0.02);
  maxJump = Math.max(maxJump, Math.abs(f.turb - t0));
}
console.assert(maxJump < 2, '浊度跳变过大: ' + maxJump);
console.log('环境连续演化:PASS  最大单步浊度变化', maxJump.toFixed(3), 'NTU');
// 6) 合理策略脚本:应能在 30 天达标,且触发稳态/临界记录
const g = createSim(42);
let lastDay = -1;
while (!g.over) {
  const di = Math.floor(g.day);
  if (di !== lastDay) {           // 每天决策一次
    lastDay = di;
    if (g.stakes.length < 5 && g.funds > 200) opStake(g);
    if (g.sched.weather[Math.min(di, 29)] === 'storm' && g.lanePolicy !== 2) opLane(g);
    if (coverageOf(g) < 0.45 && g.funds >= 300 && g.seedlings >= 20) opTransplant(g);
    if (g.turb > 18 && g.funds >= 100 && g.day >= g.enclosureUntil) opEnclosure(g);
  }
  updateSim(g, 0.02);
  if (g.day > 40) break;
}
console.log('脚本玩家:覆盖', (coverageOf(g)*100).toFixed(0) + '%', '浊度', g.turb.toFixed(1),
  '成功?', g.success, '稳态?', !!g.steadyRecord, '临界?', !!g.criticalRecord);
console.assert(g.steadyRecord, '未触发稳态记录');
console.log('ALL TESTS DONE');
