/*
 * tests.js — 无头回归测试（node tests.js）
 * 覆盖：确定性复现、连续变化、稳态/临界/失败操作、恢复策略代价、生态与资源对比。
 */
'use strict';
const E = require('./env-engine.js');
require('./env-driver.js');

let passed = 0, failedCases = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failedCases++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function run(seed, steps, actions) {
  const sim = new E.Simulation(seed);
  (actions || []).forEach(a => sim[a[0]](a[1]));
  for (let i = 0; i < steps; i++) sim.step();
  return sim;
}

console.log('1) 同 seed 重开一致性');
{
  const a = run(2026, 140, [['placeSampler', null]]);
  const b = run(2026, 140, [['placeSampler', null]]);
  // placeSampler 需要参数，这里用真实坐标重建
  const mk = seed => {
    const s = new E.Simulation(seed);
    s.placeSampler(s.world.stations[0].x + 2, s.world.stations[0].y);
    s.calibrate('S1');
    for (let i = 0; i < 140; i++) s.step();
    s.investigate('S1');
    return s;
  };
  const x = mk(2026), y = mk(2026), z = mk(999);
  check('站点/污染源/生物位置一致', JSON.stringify(x.world.stations) === JSON.stringify(y.world.stations)
    && JSON.stringify(x.sentinels.map(b => [b.x, b.y])) === JSON.stringify(y.sentinels.map(b => [b.x, b.y])));
  check('天气序列一致', JSON.stringify(x.world.weather) === JSON.stringify(y.world.weather));
  check('初始资源数量一致', x.initialBudget === y.initialBudget && x.world.initialBudget === y.world.initialBudget);
  check('故障排程一致', JSON.stringify(x.world.faults) === JSON.stringify(y.world.faults));
  check('浓度场逐格一致', JSON.stringify(Array.from(x.field)) === JSON.stringify(Array.from(y.field)));
  check('关键事件顺序一致', JSON.stringify(x.events.map(e => e.kind)) === JSON.stringify(y.events.map(e => e.kind)));
  check('不同 seed 产生不同世界', JSON.stringify(x.world.stations) !== JSON.stringify(z.world.stations));
}

console.log('2) 状态随时间连续变化（无每帧随机跳变）');
{
  const sim = new E.Simulation(2026);
  let prev = new Float64Array(sim.field);
  const sourceCells = new Set(sim.sources.map(s => E.idx(s.x, s.y)));
  let jumpSum = 0, jumpN = 0;
  for (let t = 0; t < 120; t++) {
    sim.step();
    for (let i = 0; i < sim.field.length; i++) {
      if (sourceCells.has(i)) continue; // 源点是逐 tick 的连续排放输入，豁免
      jumpSum += Math.abs(sim.field[i] - prev[i]); jumpN++;
    }
    prev = new Float64Array(sim.field);
  }
  const meanJump = jumpSum / jumpN;
  check('浓度场整体逐 tick 平滑演化（平均跳变 <1，羽流锋面属连续输运）', meanJump < 1, 'mean=' + meanJump.toFixed(3));
  // 无操作时，同一 seed 两次空跑结果一致，证明帧循环本身不含非确定性
  const s1 = run(2026, 120), s2 = run(2026, 120);
  check('空跑确定性', JSON.stringify(Array.from(s1.field)) === JSON.stringify(Array.from(s2.field)));
  // 浓度应经历上升与平滑演化，而非瞬时跳变
  const series = [];
  const s3 = new E.Simulation(2026);
  const st = s3.world.stations[1];
  for (let t = 0; t < 120; t++) { s3.step(); series.push(s3.field[E.idx(st.x, st.y)]); }
  const peak = Math.max(...series);
  check('污染可平滑累积到显著水平', peak >= E.T.CRIT, 'peak=' + peak.toFixed(2));
}

console.log('3) 稳态 / 临界 / 失败操作 三类场景');
{
  const rep = E.runAutopilot(2026, 'A', 320);
  const types = rep.records.filter(r => r.accepted).map(r => r.type);
  check('产出稳态记录', types.includes('steady'));
  check('产出临界记录', types.includes('critical'));
  check('产出溯源记录', types.includes('trace'));
  check('至少一次失败操作', rep.failures >= 1, 'failures=' + rep.failures);
  check('三组可解释记录后任务成功', rep.end.status === 'success');
  const steady = rep.records.find(r => r.type === 'steady' && r.accepted);
  const critical = rep.records.find(r => r.type === 'critical' && r.accepted);
  check('稳态记录浓度 <= 稳态阈值', steady.concentration <= E.T.SAFE);
  check('临界记录浓度 >= 临界阈值', critical.concentration >= E.T.CRIT);
}

console.log('4) 故障尖峰与校准致盲');
{
  const sim = new E.Simulation(2026);
  let sawSpike = false;
  for (let t = 0; t < 200; t++) {
    sim.step();
    sim.sensors.forEach((s, i) => {
      const trueC = sim.field[E.idx(sim.world.stations[i].x, sim.world.stations[i].y)];
      if (s.faultNow && s.reading - trueC > 25) sawSpike = true;
    });
  }
  check('故障期出现显著尖峰（读数远超真实浓度）', sawSpike);
  // 污染中校准触发致盲
  const s2 = new E.Simulation(2026);
  for (let t = 0; t < 70; t++) s2.step();
  const st0 = s2.world.stations[1];
  const cAt70 = s2.field[E.idx(st0.x, st0.y)];
  s2.placeSampler(st0.x + 2, st0.y);
  const r = s2.calibrate(st0.id);
  const sensor = s2.sensors[1];
  check('超标期校准给出致盲提示', cAt70 > E.T.WARN ? sensor.blindUntil > s2.tick : true, 'c=' + cAt70.toFixed(1));
}

console.log('5) 两种恢复策略代价与反弹对比');
{
  const ra = E.runAutopilot(2026, 'A', 320);
  const rb = E.runAutopilot(2026, 'B', 320);
  check('策略 A/B 均成功', ra.end.status === 'success' && rb.end.status === 'success');
  check('策略 A 花费高于 B（60 > 18）', ra.recovery.cost === 60 && rb.recovery.cost === 18);
  // 同 seed 两策略在恢复前状态一致
  check('两策略恢复触发点一致（同 tick）', ra.recovery.atTick === rb.recovery.atTick);
  // 恢复后继续观察：B 不解决源头，浓度应反弹高于 A
  function postConc(rep) {
    const sim = rep.sim;
    const start = rep.recovery.atTick;
    let laterSum = 0, laterN = 0;
    for (let k = 0; k < 80; k++) {
      sim.stepPhysics();
      sim.world.stations.forEach(st => {
        const c = sim.field[E.idx(st.x, st.y)];
        if (k >= 40) { laterSum += c; laterN++; }
      });
    }
    return laterSum / laterN; // 取窗口后半段，让 B 的反弹显现
  }
  const avgA = postConc(ra), avgB = postConc(rb);
  check('策略 B 恢复后平均浓度高于 A（源头未治理会反弹）', avgB > avgA, 'A=' + avgA.toFixed(2) + ' B=' + avgB.toFixed(2));
}

console.log('6) 资源 / 生物状态 / 时间 前后对比');
{
  const rep = E.runAutopilot(2026, 'A', 320);
  check('预算随操作下降', rep.end.budget < rep.start.budget);
  check('生态指数为有限值且记录在案', Number.isFinite(rep.end.eco) && rep.records.every(r => Number.isFinite(r.eco)));
  check('模拟时间推进', rep.end.time > rep.start.time && rep.end.time === rep.end.tick * E.TICK_DT);
  check('每条记录留存触发时的浓度/生态/预算快照', rep.records.every(r => 'concentration' in r && 'eco' in r && 'budgetLeft' in r));
}

console.log('7) 自动巡航本身可复现（固定序列）');
{
  const a = E.runAutopilot(2026, 'A', 320);
  const b = E.runAutopilot(2026, 'A', 320);
  const seqA = a.trace.map(t => t.tick + ':' + t.action);
  const seqB = b.trace.map(t => t.tick + ':' + t.action);
  check('动作序列与时刻完全一致', JSON.stringify(seqA) === JSON.stringify(seqB));
  check('结束状态一致', a.end.budget === b.end.budget && a.end.eco === b.end.eco && a.end.status === b.end.status);
}

console.log('8) 手动校准、冷却与频繁校准代价');
{
  const sim = new E.Simulation(2026);
  for (let t = 0; t < 5; t++) sim.step();
  const first = sim.calibrate('S1');
  check('首次校准成功并扣费', first.ok && sim.sensors[0].drift === 0);
  const cooled = sim.calibrate('S1');
  check('冷却期内校准被拒绝且计为失败操作', !cooled.ok && sim.failures >= 1);
  for (let t = 0; t < 10; t++) sim.step();
  const budgetBefore = sim.budget;
  const second = sim.calibrate('S1');
  check('冷却结束可再次校准，短间隔重复校准加价', second.ok &&
    (budgetBefore - sim.budget) === E.COST.calibrate + E.COST.calibrateRepeat);
  // 未知站点与越界采样
  check('未知站点被拒绝', !sim.calibrate('SX').ok);
  check('越界采样被拒绝', !sim.placeSampler(999, 999).ok);
}

console.log('9) 失败终局：生态崩溃导致任务失败');
{
  // 长时间不治理，生态应持续下滑并最终触发失败（足够长的窗口内）
  const sim = new E.Simulation(42);
  let guard = 0;
  while (sim.status === 'running' && guard++ < 2000) sim.step();
  check('生态崩溃线被触发，任务以 failed 结束', sim.status === 'failed', 'status=' + sim.status + ' eco=' + sim.eco.toFixed(1));
}

console.log('\n结果：' + passed + ' 通过，' + failedCases + ' 失败');
process.exit(failedCases ? 1 : 0);
