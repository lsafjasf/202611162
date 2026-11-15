import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOMINAL_PARAMS,
  PROCESS,
  ProductionEngine,
  findSafetyIssues,
} from '../js/engine.js';
import { runVerificationSuite } from '../js/scenarios.js';

function advanceUntil(engine, predicate, maxSeconds = 45) {
  let elapsed = 0;
  while (elapsed < maxSeconds && !predicate()) {
    engine.tick(0.05);
    elapsed += 0.05;
  }
  return elapsed;
}

test('正常生产：三卷均达到目标线径并封存完整摘要', () => {
  const engine = new ProductionEngine({ sequence: 11 });
  engine.startBatch({ id: 'T-NORMAL', label: '正常测试' });
  advanceUntil(engine, () => engine.state === 'complete');

  const record = engine.lastCompleted;
  assert.ok(record);
  assert.equal(record.result, 'success');
  assert.equal(record.good, 3);
  assert.equal(record.scrap, 0);
  assert.equal(record.anomaly, null);
  assert.match(record.shutdownReason, /无停机/);
  assert.ok(record.peakPower > 0);
  assert.ok(record.logs.some((entry) => entry.action === '启动'));
  assert.ok(record.logs.some((entry) => entry.action === '停止'));
});

test('设备故障：准确定位收卷电机触发值，恢复后无累计残留', () => {
  const engine = new ProductionEngine({ sequence: 12 });
  engine.startBatch({ id: 'T-FAULT', label: '设备故障测试' });
  advanceUntil(engine, () => engine.batch.simElapsed >= 1.2);
  const injection = engine.injectFault('takeup');
  assert.equal(injection.ok, true);
  assert.equal(engine.state, 'failed');
  assert.equal(engine.lastFailure.device, '收卷电机');
  assert.equal(engine.lastFailure.code, 'motorCurrent');
  assert.equal(engine.lastFailure.value, 18.7);
  assert.equal(engine.lastFailure.limit, '9.5 A');
  assert.equal(engine.batch.totalScrap, 1);
  assert.ok(engine.batch.peakPower >= 10.8);

  assert.equal(engine.checkRecoveryReady().ready, true);
  const recovery = engine.recover();
  assert.equal(recovery.ok, true);
  assert.equal(recovery.duration, PROCESS.recoveryDuration);
  advanceUntil(engine, () => engine.state !== 'recovering');
  assert.equal(engine.lastRecoveryCheck.passed, true);
  assert.deepEqual(engine.lastRecoveryCheck.residual, {
    tensionLoad: 0,
    thermalLoad: 0,
    diameterError: 0,
    faultFlags: 0,
  });
  advanceUntil(engine, () => engine.state === 'complete');
  assert.equal(engine.lastCompleted.good, 2);
  assert.equal(engine.lastCompleted.scrap, 1);
  assert.equal(engine.lastCompleted.recoveryCheck.passed, true);
});

test('参数越限：先拦截并定位触发值，修正参数后才允许恢复', () => {
  const engine = new ProductionEngine({ sequence: 13 });
  engine.setParams({ speed: 88, lube: 20, dies: [1.69, 1.17, 0.845] });
  assert.ok(findSafetyIssues(engine.params).length > 0);
  engine.startBatch({ id: 'T-LIMIT', label: '参数越限测试' });
  advanceUntil(engine, () => engine.state === 'failed', 4);

  assert.equal(engine.state, 'failed');
  assert.equal(engine.lastFailure.code, 'tension');
  assert.equal(engine.lastFailure.device, '收卷电机');
  assert.ok(engine.lastFailure.value > PROCESS.tensionLimit);
  const blocked = engine.recover();
  assert.equal(blocked.ok, false);
  assert.ok(blocked.issues.some((issue) => issue.code === 'diameter'));

  engine.setParams(NOMINAL_PARAMS);
  assert.equal(engine.checkRecoveryReady().ready, true);
  assert.equal(engine.recover().ok, true);
  advanceUntil(engine, () => engine.state !== 'recovering');
  assert.equal(engine.lastRecoveryCheck.passed, true);
  assert.equal(engine.lastRecoveryCheck.residual.tensionLoad, 0);
  assert.equal(engine.lastRecoveryCheck.residual.thermalLoad, 0);
  assert.equal(engine.lastRecoveryCheck.residual.diameterError, 0);
  assert.equal(engine.lastRecoveryCheck.residual.faultFlags, 0);
});

test('润滑泵失压：有效流量下降并触发 3# 模过热联锁', () => {
  const engine = new ProductionEngine({ sequence: 16 });
  engine.startBatch({ id: 'T-PUMP', label: '润滑泵故障测试' });
  engine.tick(0.5);
  assert.equal(engine.injectFault('pump').ok, true);
  advanceUntil(engine, () => engine.state === 'failed', 20);

  assert.equal(engine.state, 'failed');
  assert.equal(engine.lastFailure.code, 'heat');
  assert.equal(engine.lastFailure.device, '3# 拉丝模');
  assert.equal(engine.lastFailure.causeDevice, '1# 润滑泵');
  assert.ok(engine.lastFailure.value >= PROCESS.heatLimit);
  assert.ok(engine.telemetry.effectiveLube < NOMINAL_PARAMS.lube * 0.5);
  assert.equal(engine.batch.totalScrap, 1);
});

test('线径超差：成品模触发整卷报废，不依赖温度或张力', () => {
  const engine = new ProductionEngine({ sequence: 17 });
  engine.setParams({ speed: 48, lube: 72, dies: [1.72, 1.2, 0.816] });
  engine.startBatch({ id: 'T-DIAMETER', label: '线径超差测试' });
  advanceUntil(engine, () => engine.state === 'failed', 5);

  assert.equal(engine.state, 'failed');
  assert.equal(engine.lastFailure.code, 'diameter');
  assert.equal(engine.lastFailure.device, '3# 成品模');
  assert.ok(engine.lastFailure.value > 0.8 + PROCESS.diameterTolerance);
  assert.equal(engine.batch.totalScrap, 1);
});

test('暂停冻结工艺时钟，重置清理活动状态并封存中止记录', () => {
  const engine = new ProductionEngine({ sequence: 14 });
  engine.startBatch({ id: 'T-PAUSE', label: '暂停测试' });
  engine.tick(1);
  const clock = engine.batch.simElapsed;
  assert.equal(engine.pause(), true);
  engine.tick(2);
  assert.equal(engine.batch.simElapsed, clock);
  assert.equal(engine.resume(), true);
  engine.tick(1);
  assert.ok(engine.batch.simElapsed > clock);

  const result = engine.cancelCurrentBatch();
  assert.equal(result.ok, true);
  assert.equal(result.archived, true);
  assert.equal(engine.batch, null);
  assert.equal(engine.history[0].result, 'cancelled');
  assert.equal(engine.history[0].shutdownReason, '操作员重置当前批次');
  assert.equal(Object.isFrozen(engine.history[0]), true);
});

test('设备快照可重跑，历史批次深冻结且不可回写', () => {
  const engine = new ProductionEngine({ sequence: 15 });
  engine.startBatch({ id: 'T-SNAP-01', label: '快照基准' });
  advanceUntil(engine, () => engine.state === 'complete');
  const archived = engine.history[0];
  const snapshot = engine.saveSnapshot('基准快照');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(archived), true);
  assert.throws(() => {
    archived.good = 0;
  }, TypeError);

  engine.setParams({ speed: 62, lube: 58, dies: [1.73, 1.2, 0.803] });
  assert.notEqual(engine.params.speed, snapshot.params.speed);
  engine.restoreSnapshot(snapshot.id);
  assert.deepEqual(engine.params, snapshot.params);
  assert.equal(engine.history[0].good, 3);
  assert.equal(archived.peakPower > 0, true);
});

test('内置三种验证全部通过且至少一条异常处理记录', () => {
  const results = runVerificationSuite();
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((result) => result.pass), [true, true, true]);
  assert.ok(results.some((result) => result.record?.recoveryCheck?.passed));
  assert.ok(results.some((result) => result.record?.anomaly));
  assert.ok(results.every((result) => result.record?.locked));
});
