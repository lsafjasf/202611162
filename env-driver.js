/*
 * env-driver.js — 固定序列自动巡航（条件驱动，非硬编码时刻）
 * 同 seed 下每次自动巡航的动作与关键事件顺序完全一致，用于演示与回归测试。
 * 阶段：setup → forcedFail → steady → awaitCritical → critical → trace → recovery → recordTrace
 */
(function (global) {
  'use strict';
  const E = global.EnvEngine;

  function clampNear(v) { return Math.max(0, Math.min(E.W - 1, Math.round(v))); }

  // 在站点附近寻找未被占用且在街区内的采样位置
  function freeNear(sim, st) {
    for (const dx of [2, 3, 1, -2, -3, 0]) {
      for (const dy of [0, 1, -1, 2, -2]) {
        const x = clampNear(st.x + dx), y = clampNear(st.y + dy);
        if (!sim.samplers.some(p => p.x === x && p.y === y)) return { x, y };
      }
    }
    return { x: clampNear(st.x), y: clampNear(st.y) };
  }

  function hasEvidence(sim, st) {
    return sim.samplers.some(p => Math.hypot(p.x - st.x, p.y - st.y) <= 6);
  }

  function stationConc(sim, i) {
    const st = sim.world.stations[i];
    return sim.field[E.idx(st.x, st.y)];
  }

  // 选择当前真实超临界、非故障且（可选）带证据的站点索引
  function pickCritical(sim, requireEvidence) {
    let best = -1;
    sim.world.stations.forEach((st, i) => {
      const c = stationConc(sim, i);
      const sensor = sim.sensors[i];
      if (c < E.T.CRIT || sensor.faultNow) return;
      if (requireEvidence && !hasEvidence(sim, st)) return;
      if (best < 0 || c > stationConc(sim, best)) best = i;
    });
    return best;
  }

  function autopilotTick(sim, ctx) {
    if (sim.status !== 'running') return null;
    const phase = ctx.phase;
    let acted = null;

    if (phase === 'setup') {
      // 仅在 S1 放一个采样点；S2/S3 暂不布点，供后续演示失败操作
      const target = sim.world.stations[0];
      const spot = freeNear(sim, target);
      acted = sim.placeSampler(spot.x, spot.y).text;
      ctx.phase = 'forcedFail';
    } else if (phase === 'forcedFail') {
      // 必然失败的操作：在没有采样点证据的 S2 上直接溯源
      const r = sim.investigate('S2');
      acted = r.ok ? r.text : '[失败操作] ' + r.text;
      ctx.traceFailedOnce = !r.ok;
      ctx.phase = 'steady';
    } else if (phase === 'steady') {
      const cand = sim.world.stations.map((s, i) => ({
        s, i, c: stationConc(sim, i), sensor: sim.sensors[i]
      })).filter(o => o.c <= E.T.SAFE && !o.sensor.faultNow &&
        o.sensor.history.length >= 8 && hasEvidence(sim, o.s));
      if (cand.length) {
        const o = cand[0];
        const recent = o.sensor.history.slice(-8);
        const variation = Math.max(...recent.map(h => h.value)) - Math.min(...recent.map(h => h.value));
        if (variation <= 6) {
          const r = sim.submitRecord('steady', o.s.id);
          acted = r.text;
          if (r.ok) ctx.phase = 'awaitCritical';
        }
      }
    } else if (phase === 'awaitCritical') {
      if (pickCritical(sim, false) >= 0) ctx.phase = 'critical';
    } else if (phase === 'critical') {
      let ci = pickCritical(sim, false);
      if (ci < 0) return null; // 本拍无超阈站，等待下一波动
      const target = sim.world.stations[ci];
      if (!hasEvidence(sim, target) && sim.samplers.length < E.MAX_SAMPLERS) {
        const spot = freeNear(sim, target);
        acted = sim.placeSampler(spot.x, spot.y).text;
        return acted; // 补点后下一拍再提交
      }
      if (!hasEvidence(sim, target)) return null;
      const r = sim.submitRecord('critical', target.id);
      acted = r.text;
      if (r.ok) { ctx.critStation = target.id; ctx.phase = 'trace'; }
    } else if (phase === 'trace') {
      ctx.phase = 'traceDo';
    } else if (phase === 'traceDo') {
      // 在已带证据的临界站正式溯源（无证据时先补点）
      const ci = sim.world.stations.findIndex(s => s.id === (ctx.critStation || 'S1'));
      const target = sim.world.stations[ci < 0 ? 0 : ci];
      if (!hasEvidence(sim, target)) {
        const spot = freeNear(sim, target);
        acted = sim.placeSampler(spot.x, spot.y).text;
        return acted;
      }
      const r = sim.investigate(target.id);
      acted = r.text;
      if (r.ok) { ctx.tracedStation = target.id; ctx.phase = 'recovery'; }
      else {
        // 当前风向无可追溯源：等待污染再临，重试临界站选择
        ctx.phase = 'awaitCritical';
      }
    } else if (phase === 'recovery') {
      acted = sim.applyRecovery(ctx.recoveryKind || 'A').text;
      ctx.phase = 'recordTrace';
    } else if (phase === 'recordTrace') {
      acted = sim.submitRecord('trace', ctx.tracedStation).text;
      ctx.phase = 'done';
    }
    return acted;
  }

  function runAutopilot(seed, recoveryKind, maxTicks) {
    const sim = new E.Simulation(seed);
    const ctx = { phase: 'setup', recoveryKind: recoveryKind || 'A' };
    const trace = [];
    const startSnap = sim.snapshot();
    let guard = 0;
    while (sim.status === 'running' && sim.tick < (maxTicks || 400) && guard++ < 500) {
      const before = sim.snapshot();
      const action = autopilotTick(sim, ctx);
      sim.step();
      if (action) trace.push({ tick: sim.tick, time: sim.time, action, before, after: sim.snapshot() });
    }
    return {
      seed, recoveryKind: ctx.recoveryKind, sim, ctx, trace,
      start: startSnap, end: sim.snapshot(),
      records: sim.records, events: sim.events,
      recovery: sim.recoveryApplied,
      accepted: sim.records.filter(r => r.accepted).length,
      failures: sim.failures
    };
  }

  E.autopilotTick = autopilotTick;
  E.runAutopilot = runAutopilot;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
