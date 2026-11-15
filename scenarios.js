/* 场景验证：正常生产 / 设备故障 / 参数越限 —— Node 与浏览器共用 */
(function (root) {
'use strict';
const FD = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : root.FDSim;
const { Sim, BATCHES, RECOVERY_TIME, recommendedParams } = FD;
const DT = 0.5;

function stepUntil(sim, cond, maxSimT, policy) {
  const t0 = sim.absT;
  while (!cond()) {
    if (sim.absT - t0 > maxSimT) return false;
    if (policy) policy();
    sim.tick(DT);
  }
  return true;
}

function autoDefrost(sim) {
  if (sim.bs.frost > 0.7) sim.startDefrost();
}

function runBatch(sim, policy) {
  sim.start();
  return stepUntil(sim, () => sim.results.length > sim.batchIndex, 20000, policy);
}

/* 场景一：正常生产 —— 三批推荐参数全部达标 */
function scenarioNormal(log) {
  const sim = new Sim();
  for (let i = 0; i < BATCHES.length; i++) {
    sim.setParams(i, recommendedParams(BATCHES[i]));
    if (!runBatch(sim, () => autoDefrost(sim))) {
      log(`批次${i + 1} 运行超时`, false); return false;
    }
    const r = sim.results[i];
    log(`批次${i + 1}「${r.name}」${r.stopReason}：良品 ${r.good} 废品 ${r.waste} 峰值功耗 ${r.peakPower}kW 用时 ${r.duration}s`, r.stopReason === '正常完成');
    sim.nextBatch();
  }
  const pass = sim.allDone && sim.results.every(r => r.stopReason === '正常完成') && sim.exceptions.length === 0;
  log(pass ? '三批全部达标，无异常记录 ✔' : '存在未达标批次或异常 ✘', pass);
  return pass;
}

/* 场景二：设备故障 —— 真空泵故障→失败画面→维修→固定时长恢复验证→无状态残留 */
function scenarioFault(log) {
  const sim = new Sim();
  sim.setParams(0, recommendedParams(BATCHES[0]));
  sim.start();
  // 运行到一次干燥中段后注入真空泵故障
  if (!stepUntil(sim, () => sim.bs.phase === 'primary' && sim.bs.phaseT > 100, 5000, () => autoDefrost(sim))) {
    log('未能进入一次干燥阶段', false); return false;
  }
  sim.injectFault('pump');
  let ok = sim.bs.halted && sim.bs.failureInfo && sim.bs.failureInfo.device === '真空泵';
  const fi = sim.bs.failureInfo || {};
  log(`失败画面：设备=${fi.device} 触发值=${fi.text}`, ok);
  const excBefore = sim.exceptions.length;
  ok = ok && excBefore === 1 && sim.exceptions[0].type === '设备故障';
  log(`异常处理记录已生成（设备故障）`, ok);

  sim.repair();
  stepUntil(sim, () => !sim.bs.halted, 500);
  ok = sim.bs.recovery > 0;
  log(`维修完成，进入 ${RECOVERY_TIME}s 固定恢复验证`, ok);
  stepUntil(sim, () => sim.bs.recoveryOk === true, RECOVERY_TIME * 3, () => autoDefrost(sim));
  ok = sim.bs.recoveryOk === true;
  log(`恢复验证通过（固定运行 ${RECOVERY_TIME}s）`, ok);

  // 隐藏状态残留检查
  const noFaultFlags = Object.values(sim.devices).every(d => !d.fault);
  const excHandled = sim.exceptions[sim.exceptions.length - 1].handled === true;
  const logHasRepair = sim.events.some(e => e.action === '维修完成') && sim.events.some(e => e.action === '恢复验证通过');
  ok = noFaultFlags && excHandled && logHasRepair;
  log(`状态残留检查：故障标志清除=${noFaultFlags} 异常已闭环=${excHandled} 事件日志完整=${logHasRepair}`, ok);

  // 继续运行完成全部三批，确认无错误累计
  let allOk = ok;
  for (let i = 0; i < BATCHES.length; i++) {
    if (sim.results.length <= i) {
      sim.setParams(i, recommendedParams(BATCHES[i]));
      if (!runBatch(sim, () => autoDefrost(sim))) { log(`批次${i + 1} 故障恢复后运行超时`, false); return false; }
    }
    const r = sim.results[i];
    const good = r.stopReason === '正常完成';
    if (!good) allOk = false;
    log(`恢复后批次${i + 1}「${r.name}」${r.stopReason}：良品 ${r.good} 废品 ${r.waste} 峰值功耗 ${r.peakPower}kW`, good);
    sim.nextBatch();
  }
  const pass = allOk && sim.allDone && sim.exceptions.length === 1;
  log(pass ? '故障恢复后全部批次达标，无错误累计 ✔' : '恢复后仍有异常 ✘', pass);
  return pass;
}

/* 场景三：参数越限 —— 加热斜率超限致塌陷 / 预冻不足；并验证已完成批次不可修改 */
function scenarioLimit(log) {
  // 3a: 加热斜率越限 → 样品塌陷
  let sim = new Sim();
  sim.setParams(0, { prefreeze: -45, vacuum: 30, ramp: 2.0 });
  sim.start();
  stepUntil(sim, () => sim.results.length > 0, 20000, () => autoDefrost(sim));
  let r = sim.results[0];
  let ok = r && r.stopReason === '样品塌陷' && sim.bs.failureInfo && sim.bs.failureInfo.device === '加热板';
  log(`越限(斜率2.0℃/min)：失败画面设备=加热板 触发值=${sim.bs.failureInfo ? sim.bs.failureInfo.text : '无'}`, ok);
  ok = ok && sim.exceptions.some(e => e.type === '参数越限');
  log(`异常处理记录已生成（参数越限）`, ok);

  // 已完成批次数据不可修改
  const lockedParams = sim.setParams(0, { ramp: 0.5 }) === false;
  const lockedReset = sim.resetCurrentBatch() === false;
  const frozen = Object.isFrozen(sim.results[0]);
  ok = lockedParams && lockedReset && frozen;
  log(`已完成批次保护：参数修改拒绝=${lockedParams} 重置拒绝=${lockedReset} 结果冻结=${frozen}`, ok);

  // 3b: 预冻温度越限 → 预冻不足
  sim = new Sim();
  sim.setParams(0, { prefreeze: -20, vacuum: 30, ramp: 0.5 });
  sim.start();
  stepUntil(sim, () => sim.results.length > 0, 20000);
  r = sim.results[0];
  ok = r && r.stopReason === '预冻温度不足' && sim.bs.failureInfo.device === '压缩机';
  log(`越限(预冻-20℃)：失败画面设备=压缩机 触发值=${sim.bs.failureInfo.text}`, ok);

  // 3c: 真空度越限 → 周期延长（不失败但质量扣分）
  sim = new Sim();
  sim.setParams(0, { prefreeze: -45, vacuum: 180, ramp: 0.5 });
  sim.start();
  stepUntil(sim, () => sim.results.length > 0, 40000, () => autoDefrost(sim));
  r = sim.results[0];
  ok = r && sim.bs.cycleOvertime && r.good < 100;
  log(`越限(真空180Pa)：周期延长=${sim.bs.cycleOvertime} 良品=${r.good} 废品=${r.waste}（真空不足扣分）`, ok);
  return ok;
}

const SCENARIOS = { normal: scenarioNormal, fault: scenarioFault, limit: scenarioLimit };
const NAMES = { normal: '正常生产', fault: '设备故障', limit: '参数越限' };

function runScenario(name) {
  const lines = [];
  const log = (text, ok) => lines.push({ text, ok: ok !== false });
  let pass = false;
  try { pass = SCENARIOS[name](log); } catch (e) { log('运行异常: ' + e.message, false); }
  return { name: NAMES[name], pass, lines };
}

const API = { runScenario, SCENARIOS };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.FDScenarios = API;
})(typeof window !== 'undefined' ? window : globalThis);
