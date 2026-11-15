/* Node 测试：正常生产 / 设备故障 / 参数越限 三类场景 */
const assert = require('assert');
const { Simulation, SPECS, SPEC_ORDER, RECOVERY_SECONDS,
        compareBatches, PROCESS, TICK_S } = require('../src/simulation.js');

let passed = 0;
function test(name, fn) {
  const sim = new Simulation((function () { let t = 0; return function () { return t += 100; }; })());
  try { fn(sim); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.error('  FAIL  ' + name + '\n        ' + e.message); process.exitCode = 1; }
}
function run(sim, seconds) {
  for (let i = 0; i < Math.round(seconds / TICK_S); i++) sim.tick();
}
function runSegment(sim) {
  const seg = sim.spec();
  let guard = 0;
  while (sim.state === 'running' && guard++ < 20000) sim.tick();
  return seg;
}
function warmup(sim) { sim.meltTemp = 180; }

console.log('\n[场景1] 正常生产：三段线缆 + 末端 QC');

test('1.1 完成三段并通过 QC，良率 100%', (sim) => {
  sim.setParam('screw', 60);
  sim.setParam('tempSet', 180);
  sim.setParam('tension', 18);
  warmup(sim);
  for (let seg = 0; seg < SPEC_ORDER.length; seg++) {
    sim.startPurge();
    run(sim, 5);
    assert.strictEqual(sim.state, 'idle', '清料结束应回到 idle');
    sim.start();
    runSegment(sim);
  }
  assert.strictEqual(sim.state, 'finished');
  assert.strictEqual(sim.stopReason, 'completed');
  assert.strictEqual(sim.segmentIndex, 3);
  assert.ok(sim.totalGood > 60, '良品长度应 > 60m，实际 ' + sim.totalGood);
  assert.strictEqual(sim.totalWaste, 9, '仅 3 次清料各 3m 废品');
  assert.ok(sim.qc.pass, 'QC 应合格，良率 ' + sim.qc.yieldRate);
  assert.ok(sim.peakPower > 0);
});

test('1.2 每个关键设备都有启停时刻记录', (sim) => {
  sim.startPurge(); run(sim, 5);
  sim.start(); runSegment(sim);
  ['heater', 'screw', 'hauloff', 'winder', 'die'].forEach((dev) => {
    const ev = sim.deviceEvents(dev);
    assert.ok(ev.some((e) => e.action === 'start'), dev + ' 缺少 start 记录');
    assert.ok(ev.some((e) => e.action === 'stop'), dev + ' 缺少 stop 记录');
    assert.ok(typeof ev[0].t === 'number' && ev[0].wall >= 0);
  });
});

test('1.3 暂停检查后恢复，生产可继续', (sim) => {
  warmup(sim);
  sim.start();
  run(sim, 3);
  const madeBefore = sim.totalGood + sim.totalWaste;
  sim.pause('inspection');
  assert.strictEqual(sim.paused, true);
  assert.ok(!sim.allRunning(), '暂停后设备应全停');
  run(sim, 2);
  assert.strictEqual(sim.totalGood + sim.totalWaste, madeBefore, '暂停期间不得累计产量');
  sim.resume();
  assert.strictEqual(sim.paused, false);
  run(sim, 2);
  assert.ok(sim.totalGood + sim.totalWaste > madeBefore, '恢复后产量应继续增长');
});

test('1.4 工艺异常（低温粗糙/张力拉细）产生废品但不中断批次', (sim) => {
  sim.setParam('screw', 60);
  sim.setParam('tempSet', 60);   // 低温
  sim.setParam('tension', 35);   // 高张力拉细
  sim.startPurge(); run(sim, 5);
  sim.start();
  run(sim, 10);
  assert.strictEqual(sim.state, 'running', '工艺缺陷不应触发联锁停机');
  assert.ok(sim.counters.rough + sim.counters.thin + sim.counters.tension > 0,
            '应记录缺陷废品');
  assert.ok(sim.lastDefect, '应给出缺陷原因');
});

console.log('\n[场景2] 设备故障：报警画面要素 + 恢复观察期');

test('2.1 加热器故障报警指出具体设备与触发值', (sim) => {
  sim.setParam('tempSet', 180);
  sim.startPurge(); run(sim, 5);
  sim.start();
  run(sim, 2);
  sim.injectFault('heater', 'HEATER_BURNOUT', 0, '加热功率>0W');
  assert.strictEqual(sim.state, 'alarm');
  assert.strictEqual(sim.alarm.device, 'heater');
  assert.strictEqual(sim.alarm.kind, 'fault');
  assert.ok(sim.alarm.value === 0 && /0W/.test(sim.alarm.threshold));
  assert.ok(!sim.allRunning(), '报警时全部设备停机');
  run(sim, 3);
  assert.strictEqual(sim.simTime > 0 && sim.state, 'alarm', '报警状态保持，时间不应继续推进生产');
});

test('2.2 螺杆电机过流故障记录触发电流', (sim) => {
  sim.start();
  run(sim, 1);
  sim.injectFault('screw', 'MOTOR_OVERCURRENT', 128, '120A');
  assert.strictEqual(sim.alarm.device, 'screw');
  assert.strictEqual(sim.alarm.value, 128);
  assert.strictEqual(sim.alarm.threshold, '120A');
});

test('2.3 确认报警后固定观察 10s，无残留且无错误累计', (sim) => {
  warmup(sim);
  sim.start();
  run(sim, 2);
  const goodAtAlarm = sim.totalGood;
  sim.injectFault('winder', 'TAKEUP_JAM', 42, '40N');
  const tAlarm = sim.simTime;
  sim.acknowledgeAlarm();
  assert.strictEqual(sim.state, 'running');
  assert.strictEqual(sim.alarm, null);
  assert.strictEqual(sim.recoveryLeft, RECOVERY_SECONDS);
  assert.ok(Object.values(sim.devices).every((d) => d.fault === null),
            '故障标记必须清除');
  run(sim, RECOVERY_SECONDS);
  assert.strictEqual(sim.recoveryLeft, 0);
  const ok = sim.events.find((e) => e.action === 'recovery_ok');
  assert.ok(ok, '应记录观察期结束事件');
  assert.strictEqual(ok.t - tAlarm, RECOVERY_SECONDS);
  assert.strictEqual(sim.alarm, null, '观察期后无隐藏报警残留');
  assert.ok(sim.totalGood > goodAtAlarm, '恢复后继续产出，计数器未损坏');
  // 再运行一段固定时间，确认不会二次误报
  run(sim, 5);
  assert.strictEqual(sim.state, 'running');
  assert.strictEqual(sim.alarm, null);
});

test('2.4 重置当前批次清零且不归档，已完成批次不受影响', (sim) => {
  sim.start();
  run(sim, 3);
  sim.resetBatch();
  assert.strictEqual(sim.state, 'idle');
  assert.strictEqual(sim.totalGood, 0);
  assert.strictEqual(sim.totalWaste, 0);
  assert.strictEqual(sim.peakPower, 0);
  assert.strictEqual(sim.events.length, 0, '重置后事件日志清空，无错误累计');
  assert.strictEqual(sim.archived.length, 0, '未完成批次不得归档');
});

console.log('\n[场景3] 参数越限：钳制 + 越限报警 + 快照对比');

test('3.1 温度设定超过硬限触发越限报警并钳制', (sim) => {
  sim.setParam('tempSet', 300);
  assert.strictEqual(sim.state, 'alarm');
  assert.strictEqual(sim.alarm.kind, 'limit');
  assert.strictEqual(sim.alarm.device, 'heater');
  assert.strictEqual(sim.alarm.value, 300);
  assert.ok(/20\.\.260/.test(sim.alarm.threshold));
  assert.strictEqual(sim.params.tempSet, 260, '越限值应钳制到硬限');
});

test('3.2 螺杆转速/张力越限同样被拦截', (sim) => {
  sim.setParam('screw', 150);
  assert.strictEqual(sim.alarm.device, 'screw');
  assert.strictEqual(sim.params.screw, 100);
  sim.acknowledgeAlarm();
  run(sim, RECOVERY_SECONDS);
  sim.setParam('tension', 99);
  assert.strictEqual(sim.alarm.device, 'winder');
  assert.strictEqual(sim.params.tension, 40);
});

test('3.3 快照重跑：两次批次可并排比较，含一次异常记录', (sim) => {
  sim.setParam('screw', 60); sim.setParam('tempSet', 180); sim.setParam('tension', 18);
  warmup(sim);
  sim.saveSnapshot('基线参数');
  for (let seg = 0; seg < SPEC_ORDER.length; seg++) {
    sim.startPurge(); run(sim, 5);
    sim.start(); runSegment(sim);
  }
  const baseline = sim.archived[0];
  assert.ok(baseline.qc.pass);

  // 修改一组参数重跑（高温设定触发一次越限异常处理记录）
  sim.rerunFromSnapshot(sim.snapshots[0].id, { tempSet: 280 });
  assert.strictEqual(sim.alarm.kind, 'limit', '重跑应复现越限处理');
  sim.acknowledgeAlarm();
  run(sim, RECOVERY_SECONDS);
  for (let seg = 0; seg < SPEC_ORDER.length; seg++) {
    sim.startPurge(); run(sim, 5);
    sim.start(); runSegment(sim);
  }
  const rerun = sim.archived[1];
  assert.strictEqual(sim.archived.length, 2);

  const cmp = compareBatches(baseline, rerun);
  assert.ok(cmp && typeof cmp.diff.peakPower === 'number');
  assert.deepStrictEqual(cmp.diff.qcPass, [true, rerun.qc.pass]);
  assert.strictEqual(cmp.diff.alarmCount[0], 0);
  assert.ok(cmp.diff.alarmCount[1] >= 1, '第二次批次至少一条异常记录');
});

test('3.4 已完成批次数据不可修改（冻结）', (sim) => {
  warmup(sim);
  for (let seg = 0; seg < SPEC_ORDER.length; seg++) {
    sim.startPurge(); run(sim, 5);
    sim.start(); runSegment(sim);
  }
  assert.strictEqual(sim.archived.length, 1);
  const rec = sim.archived[0];
  assert.ok(Object.isFrozen(rec));
  const strictMutate = new Function('r', '"use strict"; r.good = 9999;');
  assert.throws(() => strictMutate(rec), TypeError);
  assert.throws(() => { 'use strict'; rec.events.push({}); }, TypeError);
  rec.good = 9999; rec.peakPower = -1;           // 非严格模式静默失败
  assert.notStrictEqual(rec.good, 9999);
  assert.ok(rec.peakPower >= 0);
});

console.log('\n结果：' + passed + ' 个测试通过\n');
