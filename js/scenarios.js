import { NOMINAL_PARAMS, ProductionEngine } from './engine.js';

const STEP = 0.05;

function advanceUntil(engine, predicate, maxSeconds = 45) {
  let elapsed = 0;
  while (elapsed < maxSeconds && !predicate()) {
    engine.tick(STEP);
    elapsed += STEP;
  }
  return elapsed;
}

function advanceSeconds(engine, seconds) {
  let elapsed = 0;
  while (elapsed + STEP <= seconds && ['running', 'recovering'].includes(engine.state)) {
    engine.tick(STEP);
    elapsed += STEP;
  }
  return elapsed;
}

function recoveryText(engine, check) {
  if (!check) return '本工况无需恢复自检';
  const residual = check.residual;
  if (!check.passed) return '恢复自检失败：仍检测到状态残留';
  return `8.0 s 自检通过 · 张力 ${residual.tensionLoad.toFixed(1)} / 热 ${residual.thermalLoad.toFixed(1)} / 线径 ${residual.diameterError.toFixed(4)}`;
}

function normalScenario() {
  const engine = new ProductionEngine({ sequence: 101 });
  engine.setParams(NOMINAL_PARAMS);
  engine.startBatch({ id: 'V-NORMAL-01', label: '验证 · 正常生产' });
  advanceUntil(engine, () => engine.state === 'complete', 35);
  const record = engine.lastCompleted;
  return {
    key: 'normal',
    title: '正常生产',
    pass: Boolean(record && record.good === 3 && record.scrap === 0 && record.result === 'success'),
    statusText: '3 / 3 合格',
    triggerText: record
      ? `无联锁触发 · 三卷均落入 ${(0.8 - 0.012).toFixed(3)}–${(0.8 + 0.012).toFixed(3)} mm`
      : '未产生完整批次',
    recoveryText: '无故障 · 无停机',
    good: record?.good ?? 0,
    scrap: record?.scrap ?? 0,
    peakPower: record?.peakPower ?? 0,
    duration: record?.durationSec ?? 0,
    engine,
    record,
  };
}

function equipmentScenario() {
  const engine = new ProductionEngine({ sequence: 201 });
  engine.setParams(NOMINAL_PARAMS);
  engine.startBatch({ id: 'V-FAULT-01', label: '验证 · 设备故障' });
  advanceSeconds(engine, 1.4);
  engine.injectFault('takeup');
  const failure = engine.lastFailure;
  const readiness = engine.checkRecoveryReady();
  let recoveryResult = null;
  if (readiness.ready) {
    recoveryResult = engine.recover();
    advanceUntil(engine, () => !['recovering', 'paused'].includes(engine.state), 10);
  }
  advanceUntil(engine, () => engine.state === 'complete', 35);
  const record = engine.lastCompleted;
  const check = record?.recoveryCheck || null;
  const residualClean = Boolean(
    check
    && check.passed
    && check.residual.tensionLoad === 0
    && check.residual.thermalLoad === 0
    && check.residual.diameterError === 0
    && check.residual.faultFlags === 0,
  );
  return {
    key: 'equipment',
    title: '设备故障',
    pass: Boolean(
      failure
      && failure.device.includes('收卷电机')
      && failure.displayValue.includes('18.7')
      && recoveryResult?.ok
      && residualClean
      && record?.good === 2
      && record?.scrap === 1,
    ),
    statusText: '联锁定位通过',
    triggerText: failure
      ? `${failure.device} · ${failure.label} ${failure.displayValue} / 限值 ${failure.limit}`
      : '未捕获设备故障',
    recoveryText: recoveryText(engine, check),
    good: record?.good ?? 0,
    scrap: record?.scrap ?? 0,
    peakPower: record?.peakPower ?? 0,
    duration: record?.durationSec ?? 0,
    engine,
    record,
    failure,
    residualClean,
  };
}

function parameterScenario() {
  const engine = new ProductionEngine({ sequence: 301 });
  engine.setParams({ speed: 88, lube: 20, dies: [1.69, 1.17, 0.845] });
  engine.startBatch({ id: 'V-LIMIT-01', label: '验证 · 参数越限' });
  advanceUntil(engine, () => engine.state === 'failed', 4);
  const failure = engine.lastFailure;
  const blocked = engine.checkRecoveryReady();
  let recoveryResult = null;
  if (!blocked.ready) {
    engine.setParams(NOMINAL_PARAMS);
    recoveryResult = engine.recover();
    advanceUntil(engine, () => engine.state !== 'recovering' && engine.state !== 'paused', 10);
  }
  advanceUntil(engine, () => engine.state === 'complete', 35);
  const record = engine.lastCompleted;
  const check = record?.recoveryCheck || null;
  const residualClean = Boolean(
    check
    && check.passed
    && check.residual.tensionLoad === 0
    && check.residual.thermalLoad === 0
    && check.residual.diameterError === 0
    && check.residual.faultFlags === 0,
  );
  return {
    key: 'parameter',
    title: '参数越限',
    pass: Boolean(
      failure
      && !blocked.ready
      && blocked.issues.length > 0
      && recoveryResult?.ok
      && residualClean
      && record?.good === 2
      && record?.scrap === 1,
    ),
    statusText: '越限拦截通过',
    triggerText: failure
      ? `${failure.device} · ${failure.label} ${failure.displayValue} / 限值 ${failure.limit}`
      : '未捕获参数越限',
    recoveryText: recoveryText(engine, check),
    good: record?.good ?? 0,
    scrap: record?.scrap ?? 0,
    peakPower: record?.peakPower ?? 0,
    duration: record?.durationSec ?? 0,
    engine,
    record,
    failure,
    blocked,
    residualClean,
  };
}

export function runVerificationSuite() {
  return [normalScenario(), equipmentScenario(), parameterScenario()];
}

export function createDemoArchive() {
  const [normal, equipment] = runVerificationSuite();
  const records = [];
  if (normal.record) {
    records.push({
      ...structuredClone(normal.record),
      id: 'B-261116-001',
      label: '早班 · 标准工艺',
      createdAt: '2026-11-16T00:41:00.000Z',
    });
  }
  if (equipment.record) {
    records.push({
      ...structuredClone(equipment.record),
      id: 'B-261116-002',
      label: '早班 · 收卷电机异常',
      createdAt: '2026-11-16T01:07:00.000Z',
    });
  }
  return records;
}
