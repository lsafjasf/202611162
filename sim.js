/* 冷冻干燥仓模拟核心 —— 纯逻辑，不依赖 DOM，可在 Node 中运行场景验证 */
(function (root) {
'use strict';

const BATCHES = [
  { name: '草莓片', moisture0: 0.90, units: 100, collapseTemp: -18, maxRamp: 0.8,
    prefreezeReq: -30, vacuumReq: 60, targetMoisture: 0.05, color: '#e05563' },
  { name: '牛肉粒', moisture0: 0.75, units: 100, collapseTemp: -15, maxRamp: 0.6,
    prefreezeReq: -35, vacuumReq: 50, targetMoisture: 0.05, color: '#a06a42' },
  { name: '咖啡液', moisture0: 0.60, units: 100, collapseTemp: -22, maxRamp: 0.5,
    prefreezeReq: -40, vacuumReq: 40, targetMoisture: 0.04, color: '#6b4a2f' },
];

const DEVICE_DEFS = {
  compressor: { label: '压缩机', power: 3.0 },
  pump:       { label: '真空泵', power: 2.2 },
  heater:     { label: '加热板', power: 4.0 },
  condenser:  { label: '冷凝器', power: 1.2 },
};

const RECOVERY_TIME = 60;      // 故障恢复后固定验证运行时长(s)
const REPAIR_TIME = 20;        // 维修耗时(s)
const DEFROST_TIME = 30;       // 化霜耗时(s)
const ATM = 101325;

function recommendedParams(b) {
  return {
    prefreeze: b.prefreezeReq - 10,
    vacuum: Math.max(10, b.vacuumReq - 20),
    ramp: +(b.maxRamp * 0.8).toFixed(1),
  };
}

function makeDevices() {
  const d = {};
  for (const k of Object.keys(DEVICE_DEFS)) {
    d[k] = { on: false, fault: false, starts: 0, stops: 0, lastStart: null, lastStop: null };
  }
  return d;
}

class Sim {
  constructor() {
    this.absT = 0;                 // 全局运行时间(s)，跨批次累计
    this.batchIndex = 0;
    this.params = BATCHES.map(recommendedParams);
    this.results = [];             // 已完成批次结果（冻结，不可修改）
    this.exceptions = [];          // 异常处理记录
    this.events = [];              // 设备启停/故障/维修事件（带时刻）
    this.paused = false;
    this.running = false;          // 当前批次是否在运行
    this.allDone = false;
    this._initBatchState();
  }

  get batch() { return BATCHES[this.batchIndex]; }

  _initBatchState() {
    const b = this.batch;
    this.bs = {
      t: 0, phase: 'prefreeze', phaseT: 0, holdT: 0,
      productTemp: 20, shelfTemp: 20, pressure: ATM,
      moisture: b.moisture0, frost: 0,
      collapsed: false, failed: false, done: false,
      peakPower: 0, power: 0,
      sublimRate: 0, defrostT: 0, defrostCount: 0,
      cycleOvertime: false, vacuumWarn: false,
      halted: false, failureInfo: null,
      repairT: 0, recovery: 0, recoveryOk: null,
      stopReason: '',
    };
    this.devices = makeDevices();
    this._log('系统', '批次开始', `${b.name} 入仓，初始含水率 ${(b.moisture0 * 100).toFixed(0)}%`);
  }

  _log(device, action, detail, cls) {
    this.events.push({ t: this.absT, batch: this.batchIndex, device, action, detail, cls: cls || '' });
  }

  _setDevice(key, on) {
    const d = this.devices[key];
    if (d.on === on) return;
    d.on = on;
    const label = DEVICE_DEFS[key].label;
    if (on) { d.starts++; d.lastStart = this.absT; this._log(label, '启动', `t=${this.absT.toFixed(0)}s`); }
    else { d.stops++; d.lastStop = this.absT; this._log(label, '停止', `t=${this.absT.toFixed(0)}s`); }
  }

  /* ---- 外部操作 ---- */
  setParams(i, p) {
    if (i < this.results.length) return false;   // 已完成批次不可修改
    this.params[i] = Object.assign({}, this.params[i], p);
    return true;
  }

  start() {
    if (this.allDone || this.running) return;
    this.running = true;
    this.paused = false;
  }

  pauseToggle() {
    if (!this.running) return;
    this.paused = !this.paused;
    this._log('系统', this.paused ? '暂停检查' : '继续运行', `t=${this.absT.toFixed(0)}s`);
  }

  resetCurrentBatch() {
    if (this.batchIndex < this.results.length) return false; // 已完成批次锁定
    this._log('系统', '重置当前批次', this.batch.name);
    this._initBatchState();
    this.running = false;
    this.paused = false;
    return true;
  }

  injectFault(deviceKey) {
    const d = this.devices[deviceKey];
    if (!d || d.fault || this.bs.halted || this.bs.done || this.bs.failed) return false;
    d.fault = true;
    this._setDevice(deviceKey, false);
    const label = DEVICE_DEFS[deviceKey].label;
    let value, threshold;
    if (deviceKey === 'pump') { value = this.bs.pressure; threshold = this.params[this.batchIndex].vacuum * 3; }
    else if (deviceKey === 'compressor') { value = this.bs.productTemp; threshold = this.batch.prefreezeReq; }
    else { value = this.bs.power; threshold = 8; }
    this.bs.halted = true;
    this.bs.failureInfo = {
      device: label, key: deviceKey,
      value: +value.toFixed(1), threshold: +threshold.toFixed(1),
      text: `${label}故障：触发值 ${value.toFixed(1)}（阈值 ${threshold.toFixed(1)}）`,
    };
    this._log(label, '故障', this.bs.failureInfo.text, 'fault');
    this.exceptions.push({
      batch: this.batchIndex, t: this.absT, type: '设备故障',
      device: label, trigger: this.bs.failureInfo.text, handled: false,
    });
    return true;
  }

  repair() {
    if (!this.bs.halted || this.bs.repairT > 0) return;
    this.bs.repairT = REPAIR_TIME;
    this._log('系统', '开始维修', this.bs.failureInfo.device);
  }

  startDefrost() {
    const bs = this.bs;
    if (bs.defrostT > 0 || bs.halted || bs.failed || bs.done) return;
    if (bs.phase !== 'primary' && bs.phase !== 'secondary') return;
    bs.defrostT = DEFROST_TIME;
    bs.defrostCount++;
    this._setDevice('heater', false);
    this._log('冷凝器', '化霜开始', `霜层 ${(bs.frost * 100).toFixed(0)}%`);
  }

  /* ---- 主循环 ---- */
  tick(dt) {
    if (!this.running || this.paused || this.allDone) return;
    const bs = this.bs;
    this.absT += dt;
    bs.t += dt;

    if (bs.halted) { this._tickHalted(dt); this._updatePower(); return; }
    if (bs.failed || bs.done) return;

    // 自由模式随机故障（场景验证使用独立实例，不受影响）
    if (this.randomFaults && (bs.phase === 'primary' || bs.phase === 'secondary')) {
      if (Math.random() < 0.0005 * dt) {
        this.injectFault(Math.random() < 0.6 ? 'pump' : 'compressor');
        return;
      }
    }

    if (bs.recovery > 0) {
      bs.recovery -= dt;
      if (bs.recovery <= 0) {
        bs.recovery = 0;
        bs.recoveryOk = true;
        this._log('系统', '恢复验证通过', `固定运行 ${RECOVERY_TIME}s，无状态残留`, 'ok');
        this.exceptions[this.exceptions.length - 1].handled = true;
      }
    }

    if (bs.defrostT > 0) {
      bs.defrostT -= dt;
      bs.frost = Math.max(0, bs.frost - dt / DEFROST_TIME);
      if (bs.defrostT <= 0) { bs.frost = 0; this._log('冷凝器', '化霜完成', '', 'ok'); }
      this._updatePower();
      return; // 化霜期间干燥暂停
    }

    switch (bs.phase) {
      case 'prefreeze': this._tickPrefreeze(dt); break;
      case 'primary':   this._tickPrimary(dt);   break;
      case 'secondary': this._tickSecondary(dt); break;
    }
    this._updatePower();
    bs.peakPower = Math.max(bs.peakPower, bs.power);
  }

  _tickHalted(dt) {
    const bs = this.bs;
    // 停机期间环境漂移：压力回升、温度回升
    bs.pressure = Math.min(ATM, bs.pressure + ATM * 0.002 * dt);
    bs.productTemp = Math.min(20, bs.productTemp + 0.05 * dt);
    if (bs.repairT > 0) {
      bs.repairT -= dt;
      if (bs.repairT <= 0) {
        const key = bs.failureInfo.key;
        this.devices[key].fault = false;
        bs.halted = false;
        bs.failureInfo = null;
        bs.recovery = RECOVERY_TIME;
        this._log(DEVICE_DEFS[key].label, '维修完成', `进入 ${RECOVERY_TIME}s 恢复验证`, 'ok');
      }
    }
  }

  _tickPrefreeze(dt) {
    const bs = this.bs, p = this.params[this.batchIndex], b = this.batch;
    this._setDevice('compressor', true);
    this._setDevice('condenser', true);
    const floor = Math.max(p.prefreeze, -55);
    bs.productTemp += (floor - bs.productTemp) * 0.01 * dt;
    bs.shelfTemp = bs.productTemp;
    bs.pressure = ATM;
    if (bs.productTemp <= p.prefreeze + 2) {
      bs.holdT += dt;
      if (bs.holdT >= 20) {
        if (p.prefreeze > b.prefreezeReq) {
          this._failBatch('预冻温度不足', '压缩机',
            `预冻设定 ${p.prefreeze}℃ 高于要求 ${b.prefreezeReq}℃`);
          return;
        }
        bs.phase = 'primary'; bs.phaseT = 0;
        this._log('系统', '进入一次干燥', `产品温度 ${bs.productTemp.toFixed(1)}℃`);
      }
    } else bs.holdT = 0;
  }

  _tickPrimary(dt) {
    const bs = this.bs, p = this.params[this.batchIndex], b = this.batch;
    this._setDevice('compressor', true);
    this._setDevice('condenser', true);
    this._setDevice('pump', true);
    this._setDevice('heater', true);

    // 真空：向目标压力收敛；冷凝器结霜严重时抽速下降
    const frostPenalty = bs.frost > 0.7 ? 1 + (bs.frost - 0.7) * 4 : 1;
    const pumpRate = 0.02 / frostPenalty;
    bs.pressure += (p.vacuum - bs.pressure) * pumpRate * dt;
    if (p.vacuum > b.vacuumReq && bs.phaseT > 30) bs.vacuumWarn = true; // 真空度设定不足

    // 加热：按斜率升温，上限 40℃
    bs.shelfTemp = Math.min(40, bs.shelfTemp + (p.ramp / 60) * dt);
    // 升华冷却使产品温度滞后于搁板；加热斜率超限时代偿能力下降
    const coolFactor = Math.min(1, b.maxRamp / p.ramp);
    const sublimCooling = Math.min(15, bs.sublimRate * 6000) * coolFactor;
    bs.productTemp += ((bs.shelfTemp - sublimCooling) - bs.productTemp) * 0.02 * dt;

    // 塌陷判定：加热斜率超限且产品温度超过塌陷温度
    if (p.ramp > b.maxRamp && bs.productTemp > b.collapseTemp) {
      bs.collapsed = true;
      this._failBatch('样品塌陷', '加热板',
        `产品温度 ${bs.productTemp.toFixed(1)}℃ 超过塌陷温度 ${b.collapseTemp}℃（加热斜率 ${p.ramp}℃/min）`);
      return;
    }

    // 升华速率：温差驱动 × 真空因子 × 霜层效率
    const vacuumFactor = Math.min(1, 60 / Math.max(bs.pressure, 1));
    const frostFactor = 1 - bs.frost * 0.6;
    const drive = Math.max(0, bs.shelfTemp - bs.productTemp + 20) / 50;
    bs.sublimRate = 0.0012 * drive * vacuumFactor * frostFactor;
    bs.moisture = Math.max(0, bs.moisture - bs.sublimRate * dt);
    bs.frost = Math.min(1, bs.frost + bs.sublimRate * 3 * dt);

    bs.phaseT += dt;
    if (bs.phaseT > 1800 && bs.moisture > 0.3) bs.cycleOvertime = true; // 真空不足导致周期延长
    if (bs.moisture <= 0.15) {
      bs.phase = 'secondary'; bs.phaseT = 0;
      this._log('系统', '进入二次干燥', `含水率 ${(bs.moisture * 100).toFixed(1)}%`);
    }
  }

  _tickSecondary(dt) {
    const bs = this.bs, p = this.params[this.batchIndex], b = this.batch;
    this._setDevice('compressor', true);
    this._setDevice('condenser', true);
    this._setDevice('pump', true);
    this._setDevice('heater', true);
    bs.shelfTemp = Math.min(45, bs.shelfTemp + 0.02 * dt);
    bs.productTemp += (bs.shelfTemp - bs.productTemp) * 0.02 * dt;
    bs.pressure += (p.vacuum * 0.7 - bs.pressure) * 0.02 * dt;
    bs.sublimRate = 0.0003 * (1 - bs.frost * 0.6);
    bs.moisture = Math.max(0, bs.moisture - bs.sublimRate * dt);
    bs.frost = Math.min(1, bs.frost + bs.sublimRate * 20 * dt);
    bs.phaseT += dt;
    if (bs.moisture <= b.targetMoisture) this._completeBatch();
  }

  _failBatch(reason, device, trigger) {
    const bs = this.bs, b = this.batch;
    bs.failed = true;
    bs.stopReason = reason;
    for (const k of Object.keys(this.devices)) this._setDevice(k, false);
    bs.failureInfo = { device, key: '', value: NaN, threshold: NaN, text: `${device}：${trigger}` };
    this._log('系统', '批次失败', `${reason} — ${trigger}`, 'fault');
    this.exceptions.push({
      batch: this.batchIndex, t: this.absT, type: '参数越限',
      device, trigger: `${reason}：${trigger}`, handled: true,
    });
    this._finalize(0);
  }

  _completeBatch() {
    const bs = this.bs;
    bs.done = true;
    bs.stopReason = '正常完成';
    for (const k of Object.keys(this.devices)) this._setDevice(k, false);
    let quality = 100;
    quality -= bs.defrostCount > 3 ? (bs.defrostCount - 3) * 5 : 0;
    quality -= bs.cycleOvertime ? 10 : 0;
    quality -= bs.vacuumWarn ? 8 : 0;
    quality -= this.exceptions.filter(e => e.batch === this.batchIndex).length * 3;
    quality = Math.max(40, quality);
    this._log('系统', '批次完成', `良品率 ${quality}%`, 'ok');
    this._finalize(quality);
  }

  _finalize(quality) {
    const bs = this.bs, b = this.batch;
    const good = Math.round(b.units * quality / 100);
    const result = Object.freeze({
      batch: this.batchIndex, name: b.name,
      good, waste: b.units - good,
      peakPower: +bs.peakPower.toFixed(2),
      stopReason: bs.stopReason,
      duration: +bs.t.toFixed(0),
      params: Object.freeze(Object.assign({}, this.params[this.batchIndex])),
    });
    this.results.push(result);
    this.running = false;
    if (this.results.length >= BATCHES.length) {
      this.allDone = true;
      const pass = this.results.every(r => r.stopReason === '正常完成');
      this._log('系统', pass ? '🎉 全部达标' : '部分批次未达标', '', pass ? 'ok' : 'fault');
    }
  }

  _updatePower() {
    const bs = this.bs;
    let w = 0;
    for (const k of Object.keys(this.devices)) {
      if (!this.devices[k].on) continue;
      w += DEVICE_DEFS[k].power;
    }
    if (bs.defrostT > 0) w += 3.5;
    if (bs.frost > 0.7) w *= 1 + (bs.frost - 0.7); // 霜层导致能耗上升
    bs.power = +w.toFixed(2);
    bs.peakPower = Math.max(bs.peakPower, bs.power);
  }

  nextBatch() {
    if (this.batchIndex >= this.results.length) return false; // 当前批次未完成
    if (this.allDone) return false;
    this.batchIndex++;
    this._initBatchState();
    return true;
  }

  /* ---- 快照 ---- */
  snapshot() {
    return JSON.parse(JSON.stringify({
      absT: this.absT, batchIndex: this.batchIndex,
      params: this.params, results: this.results,
      exceptions: this.exceptions, events: this.events,
      bs: this.bs, devices: this.devices,
      running: this.running, paused: this.paused, allDone: this.allDone,
    }));
  }

  restore(snap) {
    const s = JSON.parse(JSON.stringify(snap));
    this.absT = s.absT; this.batchIndex = s.batchIndex;
    this.params = s.params;
    this.results = s.results.map(r => Object.freeze(r));
    this.exceptions = s.exceptions; this.events = s.events;
    this.bs = s.bs; this.devices = s.devices;
    this.running = false; this.paused = false; this.allDone = s.allDone;
  }
}

const API = { Sim, BATCHES, DEVICE_DEFS, RECOVERY_TIME, recommendedParams };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.FDSim = API;
})(typeof window !== 'undefined' ? window : globalThis);
