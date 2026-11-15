/* 包络跟随闪避器：确定性、可序列化状态，实时与离线共用同一算法 */
"use strict";

const ALARM_CYCLE = 6.0;   // 警报周期（秒）
const ALARM_ON = 2.4;      // 每周期的警报持续（秒）
const ATTACK_S = 0.03;     // 启动时间：快速但平滑，避免爆音
const SMOOTH_S = 0.06;     // 增益二次平滑，消除泵感

/* 警报门控：t 时刻警报是否响起（确定性函数，实时/离线一致） */
function alarmGateAt(t) {
  if (t < 0) return 0;
  const phase = t % ALARM_CYCLE;
  return phase < ALARM_ON ? 1 : 0;
}

/* 包络状态对象：暂停 / 重播共享同一份，避免状态跳变 */
const envState = { env: 0, smooth: 1 };

function envToGain(env, p) {
  // 阈值作为下限截断：包络低于阈值不闪避，超出部分线性映射到衰减深度
  const depth = Math.min(1, Math.max(0, env - p.threshold));
  return Math.pow(10, (-p.maxAttenDb * depth) / 20);
}

/* 推进一个控制步长，返回当前音乐增益（线性值） */
function duckStep(dt, t, p) {
  const gate = alarmGateAt(t);
  const tau = gate > envState.env ? ATTACK_S : p.releaseMs / 1000;
  const k = 1 - Math.exp(-dt / Math.max(1e-4, tau));
  envState.env += (gate - envState.env) * k;
  const target = envToGain(envState.env, p);
  const ks = 1 - Math.exp(-dt / SMOOTH_S);
  envState.smooth += (target - envState.smooth) * ks;
  return envState.smooth;
}

/* 预计算 [t0, t1) 的增益自动化点（10ms 步长），并推进共享包络状态 */
function computeAutomation(t0, t1, p, dt = 0.01) {
  const pts = [];
  for (let t = t0; t < t1 - 1e-9; t += dt) {
    const g = duckStep(dt, t, p);
    pts.push({ t, gain: g, env: envState.env });
  }
  return pts;
}

/* 把自动化点写入 AudioParam（实时与离线同一入口） */
function applyAutomation(audioParam, pts, ctxTimeBase) {
  if (!pts.length) return;
  audioParam.setValueAtTime(pts[0].gain, ctxTimeBase + pts[0].t);
  for (let i = 1; i < pts.length; i++) {
    audioParam.linearRampToValueAtTime(pts[i].gain, ctxTimeBase + pts[i].t);
  }
}

/* 测量闪避延迟：从警报开始到增益降至目标深度 50% 的时间 */
function measureDuckDelay(p) {
  const saved = { ...envState };
  envState.env = 0; envState.smooth = 1;
  const dt = 0.001;
  const minGain = Math.pow(10, -p.maxAttenDb / 20);
  const half = 1 - (1 - minGain) * 0.5;
  let delay = 0;
  for (let t = 0; t < 2; t += dt) {
    const g = duckStep(dt, t, p);
    if (g <= half) { delay = t; break; }
  }
  envState.env = saved.env; envState.smooth = saved.smooth;
  return delay * 1000;
}
