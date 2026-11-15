/*
 * 线缆挤出机模拟核心（无 DOM 依赖，可在 Node / 浏览器中运行）
 * 固定时钟：tick = 100ms。所有长度单位 m，温度 °C，张力 N，功率 W。
 */
(function (global) {
  'use strict';

  var TICK_S = 0.1;

  var SPECS = {
    thin:   { name: '细线 1.0mm²', targetD: 1.2, segLen: 30, k: 18.0 },
    medium: { name: '中线 2.5mm²', targetD: 2.1, segLen: 24, k: 32.0 },
    thick:  { name: '粗线 6.0mm²', targetD: 3.4, segLen: 18, k: 52.0 }
  };
  var SPEC_ORDER = ['thin', 'medium', 'thick'];

  // 硬件硬限（越限即报警并钳制）
  var LIMITS = {
    screw:   { min: 0,  max: 100, unit: 'rpm' },
    temp:    { min: 20, max: 260, unit: '°C' },
    tension: { min: 0,  max: 40,  unit: 'N' }
  };

  // 工艺窗口（窗口外产生废品或触发工艺联锁）
  var PROCESS = {
    meltTemp: { low: 150, high: 210 },   // <150 表面粗糙；>210 过热降解
    tension:  { low: 8,   high: 28 },    // 窗口外收线缺陷
    diameterTol: 0.08,                   // 线径偏差 ±8%
    goodYield: 0.85                      // QC 合格良率门槛
  };

  var PURGE_SECONDS = 5;
  var RECOVERY_SECONDS = 10;   // 报警恢复后固定观察时长
  var PURGE_WASTE_M = 3;

  function round2(x) { return Math.round(x * 100) / 100; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function Simulation(clockFn) {
    this.clock = clockFn || nowMs;
    this.reset(true);
  }

  Simulation.prototype.reset = function (full) {
    this.t0 = this.clock();
    this.simTime = 0;                 // 模拟累计秒
    this.state = 'idle';              // idle | running | purging | alarm | finished
    this.recoveryLeft = 0;            // 恢复观察期剩余秒
    this.purgeLeft = 0;
    this.paused = false;
    this.segmentIndex = 0;            // 当前规格段 0..2
    this.segProduced = 0;             // 当前段已生产长度
    this.totalGood = 0;
    this.totalWaste = 0;
    this.peakPower = 0;
    this.currentPower = 0;
    this.meltTemp = 25;               // 熔体实际温度（热惯性）
    this.params = { screw: 45, tempSet: 180, tension: 18 };
    this.devices = {
      heater:  { running: false, fault: null },
      screw:   { running: false, fault: null },
      hauloff: { running: false, fault: null },
      winder:  { running: false, fault: null },
      die:     { running: false, fault: null }
    };
    this.alarm = null;               // {device, code, value, threshold, at, kind}
    this.lastDiameter = null;
    this.lastDefect = null;
    this.events = [];
    this.counters = { rough: 0, thin: 0, tension: 0, overheat: 0, purge: 0 };
    this.stopReason = null;
    this.qc = null;
    this.batchId = 'B' + String(this.t0 | 0);
    if (full) {
      this.archived = [];            // 已完成且冻结的批次
      this.snapshots = [];           // 参数快照
    }
    return this;
  };

  Simulation.prototype.spec = function () {
    return SPECS[SPEC_ORDER[Math.min(this.segmentIndex, 2)]];
  };

  Simulation.prototype.log = function (device, action, detail) {
    this.events.push({
      t: round2(this.simTime),
      wall: round2(this.clock() - this.t0),
      device: device,
      action: action,
      detail: detail || null
    });
  };

  Simulation.prototype.deviceEvents = function (device) {
    return this.events.filter(function (e) { return e.device === device; });
  };

  // 记录设备启停时刻（仅在状态翻转时落事件）
  Simulation.prototype.setDevice = function (name, running, detail) {
    var d = this.devices[name];
    if (!d || d.running === running) return;
    d.running = running;
    this.log(name, running ? 'start' : 'stop', detail);
  };

  Simulation.prototype.allRunning = function () {
    var d = this.devices;
    return d.heater.running && d.screw.running && d.hauloff.running &&
           d.winder.running && d.die.running;
  };

  Simulation.prototype.stopAll = function (detail) {
    ['heater', 'screw', 'hauloff', 'winder', 'die'].forEach(function (n) {
      this.setDevice(n, false, detail);
    }, this);
  };

  // 参数调节：越硬件硬限 -> 钳制并触发越限报警（kind=limit）
  Simulation.prototype.setParam = function (key, value) {
    var map = { screw: 'screw', tempSet: 'temp', tension: 'tension' };
    var lim = LIMITS[map[key]];
    if (!lim) return false;
    var v = Number(value);
    if (isNaN(v)) return false;
    if (v < lim.min || v > lim.max) {
      this.raiseAlarm({
        device: key === 'tempSet' ? 'heater' : (key === 'screw' ? 'screw' : 'winder'),
        code: 'PARAM_LIMIT',
        kind: 'limit',
        value: round2(v),
        threshold: lim.min + '..' + lim.max + lim.unit,
        message: '参数越限：' + key + '=' + v + lim.unit + '，允许范围 ' + lim.min + '..' + lim.max + lim.unit
      });
      v = clamp(v, lim.min, lim.max);
    }
    this.params[key] = v;
    this.log(key === 'tempSet' ? 'heater' : (key === 'screw' ? 'screw' : 'winder'),
      'adjust', key + '=' + v + lim.unit);
    return true;
  };

  Simulation.prototype.raiseAlarm = function (a) {
    if (this.alarm) return;
    a.at = round2(this.simTime);
    this.alarm = a;
    this.state = 'alarm';
    this.stopAll(a.code);
    this.log(a.device, 'alarm', a.code + ' value=' + a.value + ' threshold=' + a.threshold);
  };

  // 注入设备故障（测试/演示用）
  Simulation.prototype.injectFault = function (device, code, value, threshold) {
    if (!this.devices[device]) return false;
    this.devices[device].fault = code;
    this.raiseAlarm({
      device: device, code: code, kind: 'fault',
      value: value, threshold: threshold,
      message: '设备故障：' + device + ' 触发 ' + code + '（触发值 ' + value + ' / 阈值 ' + threshold + '）'
    });
    return true;
  };

  Simulation.prototype.power = function () {
    var p = this.params, d = this.devices, out = 0;
    var duty = clamp((p.tempSet - this.meltTemp) / 20, 0, 1);
    if (d.heater.running) out += d.heater.fault ? 300 : 300 + 3000 * duty;
    if (d.screw.running)   out += 400 + 8 * p.screw;
    if (d.die.running)     out += 150;
    if (d.hauloff.running) out += 300 + 400 * (this._lineSpeed || 0);
    if (d.winder.running)  out += 200 + 15 * p.tension;
    return round2(out);
  };

  Simulation.prototype.computeLine = function () {
    var sp = this.spec();
    var p = this.params;
    var lineSpeed = p.screw * sp.k / 1000 / (sp.targetD * sp.targetD);
    // 张力大 -> 拉细；熔体温度低 -> 模头胀粗
    var diameter = sp.targetD *
      (1 + (18 - p.tension) * 0.004) *
      (1 + (180 - this.meltTemp) * 0.0008);
    return { lineSpeed: lineSpeed, diameter: diameter };
  };

  Simulation.prototype.classifyDefect = function (diameter) {
    var sp = this.spec();
    if (this.meltTemp < PROCESS.meltTemp.low) {
      return { key: 'rough', reason: '表面粗糙（熔体温度过低）', device: 'heater' };
    }
    if (this.meltTemp > PROCESS.meltTemp.high) {
      return { key: 'overheat', reason: '过热降解（熔体温度过高）', device: 'heater' };
    }
    if (this.params.tension < PROCESS.tension.low || this.params.tension > PROCESS.tension.high) {
      return { key: 'tension', reason: '收线张力越窗', device: 'winder' };
    }
    var dev = Math.abs(diameter - sp.targetD) / sp.targetD;
    if (dev > PROCESS.diameterTol) {
      return { key: diameter < sp.targetD ? 'thin' : 'thick',
               reason: '线径偏差超限（牵引拉细/胀粗）', device: 'hauloff' };
    }
    return null;
  };

  Simulation.prototype.tick = function () {
    if (this.paused || this.state === 'idle' ||
        this.state === 'alarm' || this.state === 'finished') return this;
    this.simTime = round2(this.simTime + TICK_S);
    var p = this.params;

    // 热惯性：一阶趋近设定温度，环境散热；加热器故障时不加热
    var heatOK = !this.devices.heater.fault;
    var dT = (heatOK ? (p.tempSet - this.meltTemp) / 8 : 0) -
             (this.meltTemp - 25) / 40;
    this.meltTemp = round2(clamp(this.meltTemp + dT * TICK_S, 20, 300));

    if (this.state === 'purging') { this.tickPurge(); this.samplePower(); return this; }

    var line = this.computeLine();
    this._lineSpeed = line.lineSpeed;
    this.lastDiameter = round2(line.diameter);
    var produced = line.lineSpeed * TICK_S;
    this.segProduced = round2(this.segProduced + produced);

    var defect = this.classifyDefect(line.diameter);
    // 段末 tick 截断：只计入该段剩余长度，避免超调丢失产量
    var counted = Math.min(produced, Math.max(0, this.spec().segLen - this.segProduced + produced));
    if (defect) {
      this.totalWaste = round2(this.totalWaste + counted);
      this.counters[defect.key] = round2(this.counters[defect.key] + counted);
      this.lastDefect = defect.reason;
    } else {
      this.totalGood = round2(this.totalGood + counted);
      this.lastDefect = null;
    }

    if (this.recoveryLeft > 0) {
      this.recoveryLeft = round2(Math.max(0, this.recoveryLeft - TICK_S));
      if (this.recoveryLeft === 0) this.log('line', 'recovery_ok', '固定观察期结束，无状态残留');
    }

    if (this.segProduced >= this.spec().segLen) {
      this.segProduced = this.spec().segLen;
      this.completeSegment();
    }
    this.samplePower();
    return this;
  };

  Simulation.prototype.samplePower = function () {
    this.currentPower = this.power();
    if (this.currentPower > this.peakPower) this.peakPower = this.currentPower;
  };

  Simulation.prototype.tickPurge = function () {
    this.purgeLeft = round2(Math.max(0, this.purgeLeft - TICK_S));
    if (this.purgeLeft === 0) {
      this.stopAll('purge_done');
      this.state = 'idle';
      this.log('die', 'purge_done', '旧料清理完成');
    }
  };

  Simulation.prototype.start = function () {
    if (this.state === 'alarm' || this.state === 'finished') return false;
    if (this.state === 'purging') return false;
    if (this.allRunning()) return true;
    this.state = 'running';
    this.paused = false;
    ['heater', 'screw', 'die', 'hauloff', 'winder'].forEach(function (n) {
      this.setDevice(n, true, 'batch_start');
    }, this);
    this.log('line', 'batch_start', this.batchId);
    return true;
  };

  Simulation.prototype.pause = function (reason) {
    if (this.state !== 'running' && this.state !== 'purging') return false;
    this.paused = true;
    this.stopAll('pause:' + (reason || 'manual'));
    this.log('line', 'pause', reason || 'manual');
    return true;
  };

  Simulation.prototype.resume = function () {
    if (!this.paused) return false;
    if (this.state === 'purging') {
      this.paused = false;
      ['screw', 'die'].forEach(function (n) { this.setDevice(n, true, 'purge_resume'); }, this);
      return true;
    }
    this.paused = false;
    this.state = 'running';
    ['heater', 'screw', 'die', 'hauloff', 'winder'].forEach(function (n) {
      if (!this.devices[n].fault) this.setDevice(n, true, 'resume');
    }, this);
    this.log('line', 'resume', null);
    return true;
  };

  // 换规格清料：固定 5 秒，只跑螺杆+模头，产出固定清料废品
  Simulation.prototype.startPurge = function () {
    if (this.state !== 'idle' || this.segmentIndex >= SPEC_ORDER.length) return false;
    this.state = 'purging';
    this.paused = false;
    this.purgeLeft = PURGE_SECONDS;
    this.setDevice('screw', true, 'purge');
    this.setDevice('die', true, 'purge');
    this.totalWaste = round2(this.totalWaste + PURGE_WASTE_M);
    this.counters.purge = round2(this.counters.purge + PURGE_WASTE_M);
    this.log('die', 'purge_start', '清理旧料 ' + PURGE_WASTE_M + 'm 计废');
    return true;
  };

  Simulation.prototype.completeSegment = function () {
    var sp = this.spec();
    this.log('line', 'segment_done', sp.name + ' len=' + this.spec().segLen + 'm');
    this.stopAll('segment_done');
    this.state = 'idle';
    this.segProduced = 0;
    this.segmentIndex += 1;
    if (this.segmentIndex >= SPEC_ORDER.length) this.finishBatch('completed');
  };

  // 报警确认：清除故障标记，进入固定恢复观察期后可继续生产
  Simulation.prototype.acknowledgeAlarm = function () {
    if (this.state !== 'alarm' || !this.alarm) return false;
    var a = this.alarm;
    Object.keys(this.devices).forEach(function (n) { this.devices[n].fault = null; }, this);
    this.log(a.device, 'alarm_ack', a.code);
    this.alarm = null;
    this.recoveryLeft = RECOVERY_SECONDS;
    this.state = 'running';
    this.paused = false;
    ['heater', 'screw', 'die', 'hauloff', 'winder'].forEach(function (n) {
      this.setDevice(n, true, 'recovery');
    }, this);
    this.log('line', 'recovery_start', RECOVERY_SECONDS + 's 固定观察期');
    return true;
  };

  Simulation.prototype.finishBatch = function (reason) {
    if (this.state === 'finished') return false;
    this.stopAll('batch_end');
    this.state = 'finished';
    this.stopReason = reason;
    var total = this.totalGood + this.totalWaste;
    var yieldRate = total > 0 ? round2(this.totalGood / total) : 0;
    this.qc = {
      yieldRate: yieldRate,
      pass: yieldRate >= PROCESS.goodYield,
      good: this.totalGood,
      waste: this.totalWaste
    };
    var record = this.summary();
    Object.freeze(record);
    Object.freeze(record.events);
    Object.freeze(record.counters);
    Object.freeze(record.params);
    this.archived.push(record);
    this.log('line', 'batch_finish', reason + ' qc=' + (this.qc.pass ? 'PASS' : 'FAIL'));
    return record;
  };

  // 重置当前批次：未完成数据不归档，计数器清零（无错误累计）
  Simulation.prototype.resetBatch = function () {
    this.log('line', 'batch_reset', this.batchId);
    var archived = this.archived, snapshots = this.snapshots;
    this.reset(false);
    this.archived = archived;
    this.snapshots = snapshots;
    return true;
  };

  Simulation.prototype.summary = function () {
    return {
      batchId: this.batchId,
      state: this.state,
      params: JSON.parse(JSON.stringify(this.params)),
      good: this.totalGood,
      waste: this.totalWaste,
      yieldRate: (this.totalGood + this.totalWaste) > 0
        ? round2(this.totalGood / (this.totalGood + this.totalWaste)) : 0,
      peakPower: this.peakPower,
      stopReason: this.stopReason,
      qc: this.qc ? JSON.parse(JSON.stringify(this.qc)) : null,
      segmentIndex: this.segmentIndex,
      simTime: this.simTime,
      counters: JSON.parse(JSON.stringify(this.counters)),
      alarm: this.alarm ? JSON.parse(JSON.stringify(this.alarm)) : null,
      events: JSON.parse(JSON.stringify(this.events))
    };
  };

  // 快照只保存设备/参数状态，不含批次结果
  Simulation.prototype.saveSnapshot = function (label) {
    var snap = {
      id: 'S' + (this.snapshots.length + 1) + '-' + (this.t0 | 0),
      label: label || ('快照 ' + (this.snapshots.length + 1)),
      at: round2(this.simTime),
      params: JSON.parse(JSON.stringify(this.params)),
      segmentIndex: this.segmentIndex,
      meltTemp: this.meltTemp
    };
    Object.freeze(snap);
    Object.freeze(snap.params);
    this.snapshots.push(snap);
    this.log('line', 'snapshot', snap.label);
    return snap;
  };

  // 从快照重跑：另开新批次，原已完成批次保持冻结不变
  Simulation.prototype.rerunFromSnapshot = function (id, overrides) {
    var snap = this.snapshots.filter(function (s) { return s.id === id; })[0];
    if (!snap) return null;
    var archived = this.archived, snapshots = this.snapshots;
    this.reset(false);
    this.archived = archived;
    this.snapshots = snapshots;
    this.params = JSON.parse(JSON.stringify(snap.params));
    this.segmentIndex = snap.segmentIndex;
    this.meltTemp = snap.meltTemp;
    if (overrides) Object.keys(overrides).forEach(function (k) {
      this.setParam(k, overrides[k]);
    }, this);
    this.log('line', 'rerun', 'from ' + snap.id);
    return this.summary();
  };

  // 并排比较两个已完成批次（均为冻结数据）
  function compareBatches(a, b) {
    if (!a || !b) return null;
    var keys = ['good', 'waste', 'yieldRate', 'peakPower', 'simTime'];
    var diff = {};
    keys.forEach(function (k) {
      diff[k] = round2((b[k] || 0) - (a[k] || 0));
    });
    diff.qcPass = [a.qc ? a.qc.pass : null, b.qc ? b.qc.pass : null];
    diff.alarmCount = [
      a.events.filter(function (e) { return e.action === 'alarm'; }).length,
      b.events.filter(function (e) { return e.action === 'alarm'; }).length
    ];
    return { a: a, b: b, diff: diff };
  }

  global.CableSim = {
    Simulation: Simulation,
    compareBatches: compareBatches,
    SPECS: SPECS,
    SPEC_ORDER: SPEC_ORDER,
    LIMITS: LIMITS,
    PROCESS: PROCESS,
    PURGE_SECONDS: PURGE_SECONDS,
    RECOVERY_SECONDS: RECOVERY_SECONDS,
    TICK_S: TICK_S
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.CableSim;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
