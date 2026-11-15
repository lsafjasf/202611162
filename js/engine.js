export const PROCESS = Object.freeze({
  inputDiameter: 2.35,
  targetDiameter: 0.8,
  diameterTolerance: 0.012,
  tensionLimit: 155,
  heatLimit: 95,
  coilDuration: 8,
  recoveryDuration: 8,
  coilsPerBatch: 3,
});

export const PARAM_LIMITS = Object.freeze({
  speed: { min: 18, max: 92, step: 1 },
  lube: { min: 10, max: 100, step: 1 },
  dies: [
    { min: 1.64, max: 1.8, step: 0.005 },
    { min: 1.14, max: 1.26, step: 0.005 },
    { min: 0.76, max: 0.85, step: 0.001 },
  ],
});

export const NOMINAL_PARAMS = Object.freeze({
  speed: 48,
  lube: 72,
  dies: Object.freeze([1.72, 1.2, 0.8]),
});

export const EQUIPMENT_DEFS = Object.freeze([
  { id: 'payoff', name: '放线架', code: 'PAY-01' },
  { id: 'dieStack', name: '三道拉丝模组', code: 'DIE-01' },
  { id: 'lubePump', name: '润滑泵', code: 'LUB-01' },
  { id: 'takeup', name: '收卷电机', code: 'MOT-01' },
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 2) => Number(value.toFixed(digits));

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function cloneParams(params) {
  return { speed: params.speed, lube: params.lube, dies: [...params.dies] };
}

export function formatSimClock(seconds, tenths = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const tenth = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${tenths ? `.${tenth}` : ''}`;
}

export function getPrediction(params, equipmentHealthy = true) {
  const speed = params.speed;
  const effLube = equipmentHealthy ? params.lube : params.lube * 0.38;
  const dieDeviation = Math.abs(NOMINAL_PARAMS.dies[0] - params.dies[0])
    + Math.abs(NOMINAL_PARAMS.dies[1] - params.dies[1]);
  const reductionLoad = clamp((PROCESS.inputDiameter - params.dies[2]) / 1.55, 0, 1.4);
  const tension = 68
    + Math.pow(speed / 48, 1.8) * 24
    + Math.max(0, 80 - effLube) * 0.42
    + dieDeviation * 85;
  const heatTarget = 24
    + Math.pow(speed / 48, 1.72) * 18
    + 12
    + Math.max(0, 80 - effLube) * 0.85
    + reductionLoad * 5;
  const diameter = PROCESS.targetDiameter
    + (params.dies[2] - NOMINAL_PARAMS.dies[2])
    + (speed - 48) * 0.00022
    + (NOMINAL_PARAMS.dies[0] - params.dies[0]) * 0.02;
  const diameterError = Math.abs(diameter - PROCESS.targetDiameter);
  return {
    tension: round(tension, 1),
    heatTarget: round(heatTarget, 1),
    diameter: round(diameter, 3),
    diameterError: round(diameterError, 3),
    effLube: round(effLube, 1),
    friction: round(clamp((speed / 48) * (1.25 - effLube / 125), 0.08, 2.2), 2),
  };
}

export function findSafetyIssues(params) {
  const prediction = getPrediction(params, true);
  const issues = [];
  if (prediction.diameterError > PROCESS.diameterTolerance) {
    issues.push({
      code: 'diameter',
      label: '成品线径',
      value: `${prediction.diameter.toFixed(3)} mm`,
      limit: `${(PROCESS.targetDiameter - PROCESS.diameterTolerance).toFixed(3)}–${(PROCESS.targetDiameter + PROCESS.diameterTolerance).toFixed(3)} mm`,
    });
  }
  if (prediction.tension >= PROCESS.tensionLimit) {
    issues.push({
      code: 'tension',
      label: '预测张力',
      value: `${prediction.tension.toFixed(1)} N`,
      limit: `≤ ${PROCESS.tensionLimit} N`,
    });
  }
  if (prediction.heatTarget >= PROCESS.heatLimit) {
    issues.push({
      code: 'heat',
      label: '预测模温',
      value: `${prediction.heatTarget.toFixed(1)} °C`,
      limit: `≤ ${PROCESS.heatLimit} °C`,
    });
  }
  return issues;
}

export class ProductionEngine {
  constructor(options = {}) {
    this.params = cloneParams(options.params || NOMINAL_PARAMS);
    this.batch = null;
    this.history = [];
    this.snapshots = [];
    this.sequence = options.sequence || 8;
    this.snapshotSequence = options.snapshotSequence || 1;
    this.equipment = Object.fromEntries(EQUIPMENT_DEFS.map((definition) => [
      definition.id,
      { ...definition, status: 'idle', startedAt: null, stoppedAt: null, fault: null },
    ]));
    this.thermalState = 24;
    this.accumulators = { tensionLoad: 0, thermalLoad: 0, diameterError: 0 };
    this.breachTimers = { tension: 0, diameter: 0 };
    this.lastFailure = null;
    this.lastCompleted = null;
    this.lastRecoveryCheck = null;
    this.telemetry = this.#baseTelemetry();
  }

  #baseTelemetry() {
    return {
      tension: 0,
      heat: 24,
      dieTemps: [24, 24, 24],
      diameter: 0,
      diameterError: 0,
      power: 0,
      peakPower: 0,
      effectiveLube: 0,
      friction: 0,
      progress: 0,
      motorRpm: 0,
      motorSpeed: 0,
      fault: null,
      phase: 'idle',
    };
  }

  get state() {
    return this.batch?.state || 'idle';
  }

  get isActive() {
    return Boolean(this.batch && ['running', 'paused', 'failed', 'recovering'].includes(this.batch.state));
  }

  get isPaused() {
    return this.batch?.state === 'paused';
  }

  get isFailed() {
    return this.batch?.state === 'failed';
  }

  setParams(partial) {
    if (typeof partial.speed === 'number') {
      this.params.speed = clamp(partial.speed, PARAM_LIMITS.speed.min, PARAM_LIMITS.speed.max);
    }
    if (typeof partial.lube === 'number') {
      this.params.lube = clamp(partial.lube, PARAM_LIMITS.lube.min, PARAM_LIMITS.lube.max);
    }
    if (Array.isArray(partial.dies)) {
      this.params.dies = partial.dies.map((value, index) => clamp(
        Number(value),
        PARAM_LIMITS.dies[index].min,
        PARAM_LIMITS.dies[index].max,
      ));
    }
    if (this.batch && this.isActive) {
      this.batch.paramsTouched = true;
    }
    return cloneParams(this.params);
  }

  applyNominalParams() {
    return this.setParams(cloneParams(NOMINAL_PARAMS));
  }

  #batchId() {
    const now = new Date();
    const stamp = [
      String(now.getFullYear()).slice(-2),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(this.sequence).padStart(3, '0'),
    ].join('');
    this.sequence += 1;
    return `B-${stamp}`;
  }

  #setEquipmentRunning() {
    for (const item of Object.values(this.equipment)) {
      item.status = 'running';
      item.fault = null;
      item.startedAt = this.batch?.simElapsed || 0;
      item.stoppedAt = null;
    }
  }

  #stopEquipment(time, faultId = null) {
    for (const item of Object.values(this.equipment)) {
      if (item.status === 'fault') {
        item.stoppedAt = time;
        this.#log(item.name, '停止', '故障设备联锁', 'alarm');
        continue;
      }
      if (item.status !== 'running') continue;
      item.stoppedAt = time;
      item.status = item.id === faultId ? 'fault' : 'stopped';
      this.#log(item.name, '停止', item.id === faultId ? '故障联锁' : '随线停机', item.id === faultId ? 'alarm' : 'equipment');
    }
  }

  #log(device, action, detail, type = 'equipment') {
    if (!this.batch) return;
    this.batch.logs.push({
      at: round(this.batch.simElapsed, 1),
      clock: formatSimClock(this.batch.simElapsed),
      device,
      action,
      detail,
      type,
    });
    if (this.batch.logs.length > 160) this.batch.logs.shift();
  }

  startBatch(options = {}) {
    if (this.isActive) {
      throw new Error('当前批次仍在运行，请先完成、恢复或重置。');
    }
    const id = options.id || this.#batchId();
    const params = cloneParams(this.params);
    this.thermalState = 24;
    this.accumulators = { tensionLoad: 0, thermalLoad: 0, diameterError: 0 };
    this.breachTimers = { tension: 0, diameter: 0 };
    this.lastFailure = null;
    this.lastRecoveryCheck = null;
    this.telemetry = this.#baseTelemetry();
    this.batch = {
      id,
      createdAt: new Date().toISOString(),
      simElapsed: 0,
      state: 'running',
      nextAttemptIndex: 0,
      currentAttempt: null,
      attempts: [],
      totalGood: 0,
      totalScrap: 0,
      peakPower: 0,
      logs: [],
      failures: [],
      recoveryChecks: [],
      shutdownReason: null,
      startedFromSnapshotId: options.snapshotId || null,
      label: options.label || '手动生产批次',
      startParams: params,
      paramsTouched: false,
      pauseStartedAt: null,
      recoveryRemaining: 0,
    };
    this.#setEquipmentRunning();
    const startedAt = this.batch.simElapsed;
    for (const item of Object.values(this.equipment)) {
      this.#log(item.name, '启动', `${item.code} 进入运行`, 'equipment');
    }
    this.#log('批次系统', '开始', options.label || '手动生产批次', 'system');
    this.#beginAttempt();
    this.telemetry.phase = 'running';
    return {
      batchId: id,
      startedAt,
      equipment: Object.values(this.equipment).map((item) => ({ ...item })),
    };
  }

  #beginAttempt() {
    if (!this.batch || this.batch.nextAttemptIndex >= PROCESS.coilsPerBatch) {
      this.batch.currentAttempt = null;
      return;
    }
    const index = this.batch.nextAttemptIndex;
    this.batch.currentAttempt = {
      id: `C-${String(index + 1).padStart(2, '0')}`,
      index,
      status: 'active',
      startedAt: round(this.batch.simElapsed, 1),
      progress: 0,
      peakHeat: this.thermalState,
      peakTension: 0,
      diameterSamples: [],
    };
    this.#log(`线卷 ${index + 1}`, '上线', `${this.batch.currentAttempt.id} 开始拉丝`, 'equipment');
  }

  pause() {
    if (!this.batch || this.batch.state !== 'running' && this.batch.state !== 'recovering') return false;
    this.batch.state = 'paused';
    this.batch.pauseStartedAt = this.batch.simElapsed;
    this.#log('批次系统', '暂停', '检查模式 · 时序冻结', 'pause');
    return true;
  }

  resume() {
    if (!this.batch || this.batch.state !== 'paused') return false;
    this.batch.state = this.batch.recoveryRemaining > 0 ? 'recovering' : 'running';
    this.batch.pauseStartedAt = null;
    this.#log('批次系统', '继续', '恢复生产时钟', 'pause');
    return true;
  }

  #processTelemetry(dt) {
    const speed = this.batch ? this.params.speed : 0;
    const pumpFault = this.equipment.lubePump.status === 'fault';
    const takeupFault = this.equipment.takeup.status === 'fault';
    const pumpFactor = pumpFault ? 0.38 : 1;
    const motorFactor = takeupFault ? 0.84 : 1;
    const actualSpeed = speed * motorFactor;
    const effectiveLube = this.params.lube * pumpFactor;
    const prediction = getPrediction(
      { speed: actualSpeed, lube: this.params.lube, dies: this.params.dies },
      !pumpFault,
    );
    const dieDeviation = Math.abs(NOMINAL_PARAMS.dies[0] - this.params.dies[0])
      + Math.abs(NOMINAL_PARAMS.dies[1] - this.params.dies[1]);
    const reductionLoad = clamp((PROCESS.inputDiameter - this.params.dies[2]) / 1.55, 0, 1.4);
    const friction = clamp((actualSpeed / 48) * (1.25 - effectiveLube / 125) + dieDeviation * 0.25, 0.08, 2.2);
    const tension = 68
      + Math.pow(actualSpeed / 48, 1.8) * 24
      + Math.max(0, 80 - effectiveLube) * 0.42
      + dieDeviation * 85
      + (takeupFault ? 82 : 0);
    const heatTarget = 24
      + Math.pow(actualSpeed / 48, 1.72) * 18
      + 12
      + Math.max(0, 80 - effectiveLube) * 0.85
      + reductionLoad * 5
      + (pumpFault ? 12 : 0);
    const thermalAlpha = 1 - Math.exp(-Math.max(0, dt) / 9);
    this.thermalState += (heatTarget - this.thermalState) * thermalAlpha;
    const coilBias = [-0.0015, 0.0007, 0.0021][this.batch?.nextAttemptIndex || 0] || 0;
    const diameter = PROCESS.targetDiameter
      + (this.params.dies[2] - NOMINAL_PARAMS.dies[2])
      + (actualSpeed - 48) * 0.00022
      + (NOMINAL_PARAMS.dies[0] - this.params.dies[0]) * 0.02
      + coilBias;
    const diameterError = Math.abs(diameter - PROCESS.targetDiameter);
    const power = 1.6
      + Math.pow(actualSpeed / 48, 1.9) * 4.2
      + effectiveLube / 100 * 0.55
      + (pumpFault ? 0.7 : 0)
      + (takeupFault ? 3.5 : 0);
    const progress = this.batch?.currentAttempt?.progress || 0;
    this.telemetry = {
      tension: round(tension, 1),
      heat: round(this.thermalState, 1),
      dieTemps: [round(this.thermalState - 9, 1), round(this.thermalState - 4, 1), round(this.thermalState, 1)],
      diameter: round(diameter, 3),
      diameterError: round(diameterError, 3),
      power: round(power, 2),
      peakPower: round(this.batch?.peakPower || 0, 2),
      effectiveLube: round(effectiveLube, 1),
      friction: round(friction, 2),
      progress: round(progress, 4),
      motorRpm: Math.round(actualSpeed * 42),
      motorSpeed: round(actualSpeed, 1),
      fault: this.lastFailure?.code || null,
      phase: this.batch?.state || 'idle',
      predicted: prediction,
    };
    if (this.batch) {
      this.batch.peakPower = Math.max(this.batch.peakPower, power);
      this.telemetry.peakPower = round(this.batch.peakPower, 2);
    }
    this.accumulators.tensionLoad += Math.max(0, tension - 120) * dt;
    this.accumulators.thermalLoad += Math.max(0, this.thermalState - 80) * dt;
    this.accumulators.diameterError += Math.max(0, diameterError - PROCESS.diameterTolerance) * dt;
    if (this.batch?.currentAttempt) {
      this.batch.currentAttempt.peakHeat = Math.max(this.batch.currentAttempt.peakHeat, this.thermalState);
      this.batch.currentAttempt.peakTension = Math.max(this.batch.currentAttempt.peakTension, tension);
      this.batch.currentAttempt.diameterSamples.push(round(diameter, 3));
      if (this.batch.currentAttempt.diameterSamples.length > 40) this.batch.currentAttempt.diameterSamples.shift();
    }
  }

  tick(dt) {
    if (!this.batch || !['running', 'recovering'].includes(this.batch.state)) return false;
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.5));
    if (step === 0) return false;
    this.batch.simElapsed += step;

    if (this.batch.state === 'recovering') {
      this.#tickRecovery(step);
      return true;
    }

    this.#processTelemetry(step);
    if (this.batch.state !== 'running') return true;

    const attempt = this.batch.currentAttempt;
    if (!attempt) return true;
    attempt.progress = Math.min(1, attempt.progress + step * (0.58 + this.params.speed / 115) / PROCESS.coilDuration);

    if (this.telemetry.tension >= PROCESS.tensionLimit) {
      this.breachTimers.tension += step;
    } else {
      this.breachTimers.tension = 0;
    }
    if (this.telemetry.diameterError > PROCESS.diameterTolerance) {
      this.breachTimers.diameter += step;
    } else {
      this.breachTimers.diameter = 0;
    }

    if (this.telemetry.tension >= PROCESS.tensionLimit && this.breachTimers.tension >= 0.18) {
      this.#triggerFailure({
        device: '收卷电机',
        code: 'tension',
        label: '实时张力',
        value: this.telemetry.tension,
        unit: 'N',
        limit: PROCESS.tensionLimit,
        detail: '张力超过断线阈值，收卷动力与全线联锁切断，当前线卷整段报废。',
        causeDevice: this.equipment.lubePump.status === 'fault' ? '润滑泵' : null,
      });
      return true;
    }

    if (this.telemetry.heat >= PROCESS.heatLimit) {
      this.#triggerFailure({
        device: '3# 拉丝模',
        code: 'heat',
        label: '模孔温度',
        value: this.telemetry.heat,
        unit: '°C',
        limit: PROCESS.heatLimit,
        detail: this.equipment.lubePump.status === 'fault'
          ? `润滑泵失压，有效流量仅 ${this.telemetry.effectiveLube.toFixed(1)}%，油膜破裂导致第三道模具过热。`
          : '摩擦热超过模组耐温上限，模孔可能粘连并拉断线材。',
        causeDevice: this.equipment.lubePump.status === 'fault' ? '1# 润滑泵' : null,
      });
      return true;
    }

    if (this.telemetry.diameterError > PROCESS.diameterTolerance && this.breachTimers.diameter >= 0.35) {
      this.#triggerFailure({
        device: '3# 成品模',
        code: 'diameter',
        label: '成品线径',
        value: this.telemetry.diameter,
        unit: 'mm',
        limit: `${(PROCESS.targetDiameter - PROCESS.diameterTolerance).toFixed(3)}–${(PROCESS.targetDiameter + PROCESS.diameterTolerance).toFixed(3)}`,
        detail: `实测线径偏差 ${this.telemetry.diameterError.toFixed(3)} mm，超过整段报废窗口。`,
      });
      return true;
    }

    if (attempt.progress >= 1) {
      this.#completeAttempt();
    }
    return true;
  }

  #triggerFailure(failure) {
    if (!this.batch || this.batch.state !== 'running') return;
    const at = round(this.batch.simElapsed, 1);
    const record = {
      ...failure,
      at,
      clock: formatSimClock(at),
      value: round(failure.value, failure.unit === 'mm' ? 3 : 1),
      displayValue: `${round(failure.value, failure.unit === 'mm' ? 3 : 1)} ${failure.unit}`,
      attemptId: this.batch.currentAttempt?.id || `C-0${this.batch.nextAttemptIndex + 1}`,
    };
    this.lastFailure = record;
    this.batch.failures.push(record);
    this.batch.shutdownReason = `${record.device} · ${record.label} ${record.displayValue}（限值 ${record.limit}）`;
    this.batch.state = 'failed';

    const attempt = this.batch.currentAttempt;
    if (attempt) {
      this.batch.attempts.push({
        ...attempt,
        status: 'scrap',
        finishedAt: at,
        failure: record,
      });
      this.batch.totalScrap += 1;
      this.batch.currentAttempt = null;
      this.batch.nextAttemptIndex += 1;
    }
    this.#log(record.device, '故障停机', `${record.label} ${record.displayValue} > ${record.limit}`, 'alarm');
    if (record.causeDevice) this.#log(record.causeDevice, '根因告警', failure.detail, 'alarm');
    const faultEquipmentId = record.causeDevice?.includes('润滑泵')
      ? 'lubePump'
      : record.device.includes('收卷电机')
        ? 'takeup'
        : null;
    this.#stopEquipment(this.batch.simElapsed, faultEquipmentId);
    if (faultEquipmentId) {
      this.equipment[faultEquipmentId].status = 'fault';
      this.equipment[faultEquipmentId].fault = record.code;
    }
    this.#log('批次系统', '联锁', '全线停止 · 当前线卷报废', 'alarm');
    this.telemetry.phase = 'failed';
    this.telemetry.progress = 0;
  }

  #completeAttempt() {
    if (!this.batch?.currentAttempt) return;
    const at = round(this.batch.simElapsed, 1);
    this.batch.attempts.push({
      ...this.batch.currentAttempt,
      status: 'good',
      finishedAt: at,
    });
    this.batch.totalGood += 1;
    this.batch.nextAttemptIndex += 1;
    this.#log(
      `线卷 ${this.batch.attempts.length}`,
      '合格',
      `${this.batch.currentAttempt.id} 达到 0.800 ±0.012 mm`,
      'equipment',
    );
    this.batch.currentAttempt = null;
    if (this.batch.nextAttemptIndex < PROCESS.coilsPerBatch) {
      this.#beginAttempt();
    } else {
      this.#finalizeBatch();
    }
  }

  #recoveryResidual() {
    return {
      tensionLoad: round(this.accumulators.tensionLoad, 3),
      thermalLoad: round(this.accumulators.thermalLoad, 3),
      diameterError: round(this.accumulators.diameterError, 4),
      faultFlags: Object.values(this.equipment).filter((item) => item.status === 'fault').length,
    };
  }

  checkRecoveryReady() {
    if (!this.batch || this.batch.state !== 'failed') {
      return { ready: false, issues: [{ code: 'state', label: '批次状态', value: this.state, limit: 'failed' }] };
    }
    const issues = findSafetyIssues(this.params);
    return { ready: issues.length === 0, issues };
  }

  recover() {
    if (!this.batch || this.batch.state !== 'failed') {
      return { ok: false, issues: [{ code: 'state', label: '批次状态', value: this.state, limit: 'failed' }] };
    }
    const readiness = this.checkRecoveryReady();
    if (!readiness.ready) return { ok: false, issues: readiness.issues };

    this.batch.state = 'recovering';
    this.batch.recoveryRemaining = PROCESS.recoveryDuration;
    this.batch.recoveryStartedAt = this.batch.simElapsed;
    this.lastFailure = null;
    this.accumulators = { tensionLoad: 0, thermalLoad: 0, diameterError: 0 };
    this.breachTimers = { tension: 0, diameter: 0 };
    this.thermalState = 24;
    for (const item of Object.values(this.equipment)) {
      item.fault = null;
    }
    this.#setEquipmentRunning();
    for (const item of Object.values(this.equipment)) {
      this.#log(item.name, '恢复启动', `${item.code} 自检运行`, 'system');
    }
    this.#log('批次系统', '恢复自检', '清除故障标志与累计误差 · 固定运行 8.0 s', 'system');
    this.telemetry = this.#baseTelemetry();
    this.telemetry.phase = 'recovering';
    return { ok: true, duration: PROCESS.recoveryDuration };
  }

  #tickRecovery(step) {
    this.#processTelemetry(step);
    this.batch.recoveryRemaining = Math.max(0, this.batch.recoveryRemaining - step);
    this.telemetry.phase = 'recovering';
    this.telemetry.progress = 0;
    if (this.batch.recoveryRemaining <= 0) {
      this.#finishRecovery();
    }
  }

  #finishRecovery() {
    const residual = this.#recoveryResidual();
    const passed = residual.tensionLoad === 0
      && residual.thermalLoad === 0
      && residual.diameterError === 0
      && residual.faultFlags === 0;
    const check = {
      passed,
      duration: PROCESS.recoveryDuration,
      at: round(this.batch.simElapsed, 1),
      residual,
      note: passed ? '无隐藏状态残留或错误累计' : '检测到恢复后残留，禁止继续生产',
    };
    this.batch.recoveryChecks.push(check);
    this.lastRecoveryCheck = check;
    if (!passed) {
      const failure = {
        device: '恢复自检回路',
        causeDevice: null,
        code: 'recoveryResidual',
        label: '累计残留',
        value: residual.tensionLoad + residual.thermalLoad + residual.diameterError,
        unit: '',
        limit: '0',
        at: round(this.batch.simElapsed, 1),
        clock: formatSimClock(this.batch.simElapsed),
        displayValue: `张力 ${residual.tensionLoad} / 热 ${residual.thermalLoad} / 线径 ${residual.diameterError}`,
        detail: '恢复自检期间检测到未清零的工艺累计，联锁保持，请修正参数后重新自检。',
        attemptId: `C-0${this.batch.nextAttemptIndex + 1}`,
      };
      this.lastFailure = failure;
      this.batch.state = 'failed';
      this.batch.shutdownReason = '恢复自检失败 · 状态残留';
      this.#stopEquipment(this.batch.simElapsed);
      this.#log('批次系统', '自检失败', '恢复后仍有状态残留，联锁保持', 'alarm');
      return;
    }
    this.#log('批次系统', '自检通过', '8.0 s 内张力/热/线径累计均归零', 'system');
    this.batch.recoveryRemaining = 0;
    this.batch.state = 'running';
    if (this.batch.nextAttemptIndex >= PROCESS.coilsPerBatch) {
      this.#finalizeBatch();
    } else {
      this.#beginAttempt();
    }
  }

  #makeRecord(result) {
    const batch = this.batch;
    const failures = batch.failures.map((failure) => ({
      device: failure.device,
      causeDevice: failure.causeDevice || null,
      code: failure.code,
      label: failure.label,
      displayValue: failure.displayValue,
      limit: String(failure.limit),
      at: failure.at,
      clock: failure.clock,
      attemptId: failure.attemptId,
      detail: failure.detail,
    }));
    const recoveryChecks = batch.recoveryChecks.map((check) => ({
      ...check,
      residual: { ...check.residual },
    }));
    return {
      id: batch.id,
      createdAt: batch.createdAt,
      label: batch.label,
      startedFromSnapshotId: batch.startedFromSnapshotId,
      durationSec: round(batch.simElapsed, 1),
      result,
      good: batch.totalGood,
      scrap: batch.totalScrap,
      peakPower: round(batch.peakPower, 2),
      shutdownReason: batch.shutdownReason || '无停机 · 三卷全部合格',
      failures,
      anomaly: failures[0] || null,
      recoveryChecks,
      recoveryCheck: recoveryChecks[0] || null,
      attempts: batch.attempts.map((attempt) => ({
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        peakHeat: round(attempt.peakHeat, 1),
        peakTension: round(attempt.peakTension, 1),
        failureCode: attempt.failure?.code || null,
      })),
      logs: batch.logs.map((entry) => ({ ...entry })),
      startParams: cloneParams(batch.startParams),
      endParams: cloneParams(this.params),
      locked: true,
    };
  }

  #finalizeBatch() {
    if (!this.batch || this.batch.state === 'complete') return;
    const at = round(this.batch.simElapsed, 1);
    this.batch.state = 'complete';
    this.#stopEquipment(this.batch.simElapsed);
    const result = this.batch.totalGood === PROCESS.coilsPerBatch
      ? 'success'
      : this.batch.totalGood > 0
        ? 'partial'
        : 'failed';
    if (!this.batch.shutdownReason) {
      this.batch.shutdownReason = '无停机 · 三卷全部合格';
    }
    this.#log('批次系统', '结束', `良品 ${this.batch.totalGood} / 废品 ${this.batch.totalScrap}`, 'system');
    const record = deepFreeze(this.#makeRecord(result));
    this.batch.completedRecord = record;
    this.history.unshift(record);
    this.lastCompleted = record;
    this.telemetry.phase = 'complete';
    this.telemetry.progress = 0;
  }

  cancelCurrentBatch() {
    if (!this.batch) return { ok: false, reason: '没有活动批次' };
    if (this.batch.state === 'complete') {
      return { ok: false, reason: '批次已完成并封存，不能重置' };
    }
    const batch = this.batch;
    const at = round(batch.simElapsed, 1);
    const hadProduction = batch.simElapsed > 0.2 || batch.totalGood + batch.totalScrap > 0;
    batch.state = 'cancelled';
    this.#stopEquipment(batch.simElapsed);
    this.#log('批次系统', '操作员重置', '当前批次中止，已封存中止记录', 'pause');
    let record = null;
    if (hadProduction) {
      record = this.#makeRecord('cancelled');
      record.shutdownReason = '操作员重置当前批次';
      record = deepFreeze(record);
      this.history.unshift(record);
    }
    this.lastFailure = null;
    this.batch = null;
    this.thermalState = 24;
    this.accumulators = { tensionLoad: 0, thermalLoad: 0, diameterError: 0 };
    this.breachTimers = { tension: 0, diameter: 0 };
    this.telemetry = this.#baseTelemetry();
    for (const item of Object.values(this.equipment)) {
      item.status = 'idle';
      item.startedAt = null;
      item.stoppedAt = null;
      item.fault = null;
    }
    return { ok: true, archived: Boolean(record), record };
  }

  injectFault(type) {
    if (!this.batch || this.batch.state !== 'running') {
      return { ok: false, reason: '仅运行中的批次可注入设备故障' };
    }
    if (type === 'takeup') {
      const at = round(this.batch.simElapsed, 1);
      this.equipment.takeup.fault = 'bearing';
      this.batch.peakPower = Math.max(this.batch.peakPower, 10.8);
      this.telemetry.power = 10.8;
      this.telemetry.peakPower = round(this.batch.peakPower, 2);
      this.#log('收卷电机', '设备故障', `轴承卡滞 · 电流 18.7 A @ ${formatSimClock(at)}`, 'alarm');
      this.#triggerFailure({
        device: '收卷电机',
        causeDevice: '收卷电机',
        code: 'motorCurrent',
        label: '电机电流',
        value: 18.7,
        unit: 'A',
        limit: '9.5 A',
        detail: '轴承卡滞引发电流尖峰，变频器联锁切断收卷动力；当前线卷整段报废。',
      });
      return { ok: true, type, at };
    }
    if (type === 'pump') {
      this.equipment.lubePump.status = 'fault';
      this.equipment.lubePump.fault = 'pressure';
      this.#log('润滑泵', '设备故障', '出口压力 0.72 bar，低于 2.80 bar', 'alarm');
      return { ok: true, type, at: round(this.batch.simElapsed, 1) };
    }
    return { ok: false, reason: '未知故障类型' };
  }

  saveSnapshot(label) {
    this.snapshotSequence += 1;
    const snapshot = deepFreeze({
      id: `S-${String(this.snapshotSequence).padStart(2, '0')}`,
      label: label || `快照 ${this.snapshotSequence - 1}`,
      createdAt: new Date().toISOString(),
      batchId: this.batch?.id || this.lastCompleted?.id || null,
      simElapsed: this.batch?.simElapsed || 0,
      params: cloneParams(this.params),
      equipment: Object.values(this.equipment).map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        startedAt: item.startedAt,
        stoppedAt: item.stoppedAt,
      })),
      telemetry: {
        tension: this.telemetry.tension,
        heat: this.telemetry.heat,
        diameter: this.telemetry.diameter,
        power: this.telemetry.power,
      },
    });
    this.snapshots.unshift(snapshot);
    return snapshot;
  }

  restoreSnapshot(snapshotId) {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) return { ok: false, reason: '快照不存在' };
    this.setParams(cloneParams(snapshot.params));
    return { ok: true, snapshot };
  }

  seedSnapshot(snapshot) {
    const frozen = deepFreeze(structuredClone(snapshot));
    this.snapshots.push(frozen);
    return frozen;
  }

  seedHistory(records) {
    for (const record of records) {
      const frozen = deepFreeze(structuredClone(record));
      this.history.push(frozen);
    }
  }
}
