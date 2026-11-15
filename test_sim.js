/* Node 验证脚本:
 * 1) 同 seed 两次运行(含操作重放)状态与事件顺序完全一致
 * 2) 稳态场景:适宜条件下指标平稳
 * 3) 临界场景:白化超阈值 → 策略A 恢复,输出前后对比与代价
 * 4) 失败操作:资金不足清洁 / 对活珊瑚移栽,状态不变
 * 运行: node test_sim.js */
'use strict';
const CoralSim = require('./sim.js');

const DT = 1 / 48;
let failures = 0;
function check(name, cond) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name);
  if (!cond) failures++;
}
function fmt(m) {
  return 'day=' + m.day.toFixed(2) + ' 资金=' + m.funds + ' 幼枝=' + m.fragments +
    ' 存活=' + (m.survival * 100).toFixed(1) + '% 覆盖=' + (m.coverage * 100).toFixed(1) +
    '% 健康=' + m.avgHealth.toFixed(2) + ' 白化=' + m.avgBleach.toFixed(2) +
    ' 附着=' + m.avgFouling.toFixed(2) + ' 沉积=' + m.sediment.toFixed(2) +
    ' 水温=' + m.temp.toFixed(1);
}
function run(sim, days, script) {
  const steps = Math.round(days / DT);
  for (let i = 0; i < steps && !sim.finished; i++) {
    if (script) script(sim);
    sim.step(DT);
  }
}

console.log('[1] 同 seed 复现性');
const opsOf = (s) => {
  s.setShade(0.5); run(s, 2);
  s.setFlow(0.9); run(s, 1.5);
  s.setFlow(0.2); run(s, 2);
  s.clean(null); run(s, 1);
  s.setTemp(26); run(s, 2);
  s.runStrategy('A'); run(s, 3.5);
};
const s1 = new CoralSim('reef-42'); opsOf(s1);
const s2 = new CoralSim('reef-42'); opsOf(s2);
check('最终状态一致', JSON.stringify(s1.metrics()) === JSON.stringify(s2.metrics()));
check('事件日志一致(顺序+内容)', JSON.stringify(s1.log) === JSON.stringify(s2.log));
check('天气序列一致', JSON.stringify(s1.weather) === JSON.stringify(s2.weather));
const s3 = new CoralSim('reef-42');
const ops = s1.opLog.slice();
run(s3, 12, (sim) => {
  while (ops.length && ops[0].day <= sim.time + 1e-6) sim.applyOp(ops.shift());
});
check('opLog 重放后最终状态一致', JSON.stringify(s1.metrics()) === JSON.stringify(s3.metrics()));
check('opLog 重放后事件一致', JSON.stringify(s1.log) === JSON.stringify(s3.log));
const sOther = new CoralSim('reef-43');
check('不同 seed 天气不同', JSON.stringify(s1.weather) !== JSON.stringify(sOther.weather));

console.log('[2] 稳态场景(适宜条件 3 天)');
const st = new CoralSim('steady');
st.setFlow(0.5); st.setShade(0.3); st.setTemp(27);
const before2 = st.metrics();
run(st, 3);
const after2 = st.metrics();
console.log('  前: ' + fmt(before2));
console.log('  后: ' + fmt(after2));
check('存活率保持 100%', after2.survival === 1);
check('白化未恶化', after2.avgBleach <= before2.avgBleach + 0.05);
check('覆盖率增长', after2.coverage > before2.coverage);

console.log('[3] 临界场景(白化超阈值 → 策略A)');
const cr = new CoralSim('crisis');
cr.setShade(0); run(cr, 0.5);
let triggered = false, before3 = null;
run(cr, 11.5, (sim) => {
  if (sim.time < 6) sim.env.temp = 30.5;
  if (!triggered && sim.metrics().avgBleach >= CoralSim.CONFIG.bleachTrigger) {
    triggered = true;
    before3 = sim.metrics();
    console.log('  触发(策略A前): ' + fmt(before3));
    sim.runStrategy('A');
  }
  // 恢复期间保持清洁,否则附着物会阻碍白化恢复
  if (triggered && sim.metrics().avgFouling > 0.5 && sim.funds > 100) sim.clean(null);
});
const after3 = cr.metrics();
console.log('  结束: ' + fmt(after3));
check('白化曾超阈值 0.3', triggered);
const recA = cr.strategyRecords.find(r => r.name === 'A');
check('策略A 已记录', !!recA);
if (recA) {
  console.log('  策略A 记录: 触发[' + recA.trigger + '] 第' + recA.startDay + '→' + recA.endDay +
    '天 代价=' + recA.cost + ' 白化 ' + recA.before.avgBleach.toFixed(2) + '→' + recA.after.avgBleach.toFixed(2));
  check('策略A 降低白化', recA.after.avgBleach < recA.before.avgBleach);
}

console.log('[4] 临界场景(沉积积聚 → 策略B)');
const cb = new CoralSim('sediment');
cb.setFlow(0.1);
let trigB = false, before4 = null;
run(cb, 11.5, (sim) => {
  if (!trigB && sim.env.sediment >= CoralSim.CONFIG.sedimentTrigger) {
    trigB = true;
    before4 = sim.metrics();
    console.log('  触发(策略B前): ' + fmt(before4));
    sim.runStrategy('B');
  }
});
const after4 = cb.metrics();
console.log('  结束: ' + fmt(after4));
check('沉积曾超阈值 0.5', trigB);
const recB = cb.strategyRecords.find(r => r.name === 'B');
check('策略B 已记录', !!recB);
if (recB) {
  console.log('  策略B 记录: 触发[' + recB.trigger + '] 第' + recB.startDay + '→' + recB.endDay +
    '天 代价=' + recB.cost + ' 沉积 ' + recB.before.sediment.toFixed(2) + '→' + recB.after.sediment.toFixed(2));
  check('策略B 降低沉积', recB.after.sediment < recB.before.sediment);
}

console.log('[5] 失败操作(状态不变)');
const fl = new CoralSim('fail');
run(fl, 1);
fl.funds = 10;
const before5 = fl.metrics();
const r1 = fl.clean(null);
const r2 = fl.transplant(0);
const after5 = fl.metrics();
console.log('  清洁结果: ' + r1.msg);
console.log('  移栽结果: ' + r2.msg);
check('清洁被拒绝', !r1.ok);
check('移栽被拒绝', !r2.ok);
check('资源未变化', before5.funds === after5.funds && before5.fragments === after5.fragments);
check('生物状态未变化', before5.survival === after5.survival && before5.coverage === after5.coverage);

console.log('[6] 完整 12 天模拟');
const full = new CoralSim('full-run');
full.setFlow(0.5); full.setShade(0.3);
run(full, 12.1, (sim) => {
  const m = sim.metrics();
  if (!sim.activeStrategy) {
    if (m.avgBleach >= CoralSim.CONFIG.bleachTrigger) sim.runStrategy('A');
    else if (m.sediment >= CoralSim.CONFIG.sedimentTrigger ||
             m.avgFouling >= CoralSim.CONFIG.foulingTrigger) sim.runStrategy('B');
  }
  const dead = sim.corals.find(c => !c.alive);
  if (dead && sim.funds > 200) sim.transplant(dead.id);
});
check('模拟正常结束', full.finished);
console.log('  结果: ' + fmt(full.metrics()) + (full.success ? ' [成功]' : ' [未达标]'));
console.log('  策略记录: ' + JSON.stringify(full.strategyRecords.map(r => ({
  策略: r.name, 代价: r.cost, 天: r.startDay + '→' + r.endDay,
}))));

console.log(failures === 0 ? '\n全部通过 ✔' : '\n失败 ' + failures + ' 项 ✘');
process.exit(failures === 0 ? 0 : 1);
