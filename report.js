/*
 * report.js — 生成可解释的任务报告：阈值、资源/生物/时间前后对比、两种恢复策略代价
 * 可在 Node 与浏览器使用。
 */
(function (global) {
  'use strict';
  const E = global.EnvEngine;

  function strategyReport(seed) {
    const runA = E.runAutopilot(seed, 'A', 320);
    const runB = E.runAutopilot(seed, 'B', 320);

    function summarize(rep) {
      const r = rep.recovery;
      return {
        kind: r.kind,
        cost: r.cost,
        triggeredAtTick: r.atTick,
        triggeredAtTime: r.atTick * E.TICK_DT,
        budgetBefore: r.before.budget,
        budgetAfter: r.after.budget,
        ecoBefore: Number(r.before.eco.toFixed(2)),
        ecoAfter: Number(r.after.eco.toFixed(2)),
        finalEco: Number(rep.end.eco.toFixed(2)),
        finalBudget: rep.end.budget,
        endTime: rep.end.time,
        status: rep.end.status,
        acceptedRecords: rep.accepted,
        failures: rep.failures
      };
    }

    // 恢复后长窗口观察反弹（复用 stepPhysics，不受结束状态影响）
    function rebound(rep) {
      const sim = rep.sim;
      const start = rep.recovery.atTick;
      const buckets = [];
      for (let k = 0; k < 140; k++) {
        sim.stepPhysics();
        let sum = 0;
        sim.world.stations.forEach(st => { sum += sim.field[E.idx(st.x, st.y)]; });
        buckets.push(sum / sim.world.stations.length);
      }
      const avg = (a, b) => buckets.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
      return {
        earlyAvg: Number(avg(0, 40).toFixed(2)),
        midAvg: Number(avg(40, 80).toFixed(2)),
        lateAvg: Number(avg(80, 140).toFixed(2))
      };
    }

    const A = summarize(runA), B = summarize(runB);
    A.rebound = rebound(runA);
    B.rebound = rebound(runB);

    return {
      seed,
      thresholds: {
        steadyMax: E.T.SAFE, warn: E.T.WARN, criticalMin: E.T.CRIT, ecoCollapse: E.T.COLLAPSE,
        calibrateCooldownTicks: 10, calibrateBlindTicks: 4
      },
      initialBudget: runA.start.budget,
      strategyA: A,
      strategyB: B,
      comparison: {
        costDifference: B.cost - A.cost,
        note: 'A 源头减排成本高但浓度持续走低；B 应急冲洗成本低、即时见效，但源头仍在排放，窗口后半段浓度反弹。'
      },
      records: runA.records.map(r => ({
        id: r.id, type: r.type, station: r.stationId, accepted: r.accepted,
        concentration: r.concentration, eco: r.eco, tick: r.atTick, reason: r.reason || ''
      })),
      eventOrder: runA.events.filter(e =>
        ['source-on', 'fault', 'source-found', 'recovery', 'record-ok', 'fail-action', 'success'].includes(e.kind))
        .map(e => ({ tick: e.tick, kind: e.kind, text: e.text }))
    };
  }

  function printReport(rep) {
    const line = '='.repeat(64);
    console.log(line);
    console.log('环境监测任务报告  seed=' + rep.seed + '  初始预算=' + rep.initialBudget);
    console.log(line);
    console.log('触发阈值：稳态≤' + rep.thresholds.steadyMax + ' 预警=' + rep.thresholds.warn +
      ' 临界≥' + rep.thresholds.criticalMin + ' 生态崩溃≤' + rep.thresholds.ecoCollapse);
    console.log('-'.repeat(64));
    rep.records.forEach(r => {
      console.log(('记录 ' + r.id + ' [' + r.type + '] ' + (r.accepted ? '通过' : '驳回') +
        ' 站=' + r.station + ' 浓度=' + r.concentration + ' 生态=' + r.eco + ' tick=' + r.tick +
        (r.reason ? ' 原因=' + r.reason : '')));
    });
    console.log('-'.repeat(64));
    [rep.strategyA, rep.strategyB].forEach(s => {
      console.log('策略 ' + s.kind + ' 花费=' + s.cost + ' 触发=t' + s.triggeredAtTick +
        '(' + s.triggeredAtTime + 's)');
      console.log('  预算 ' + s.budgetBefore + '→' + s.budgetAfter +
        '  生态 ' + s.ecoBefore + '→' + s.ecoAfter + '  最终生态=' + s.finalEco +
        '  失败操作=' + s.failures);
      console.log('  恢复后浓度 早/中/晚窗均值=' + s.rebound.earlyAvg + ' / ' +
        s.rebound.midAvg + ' / ' + s.rebound.lateAvg);
    });
    console.log('-'.repeat(64));
    console.log('代价对比：B 比 A 省 ' + Math.abs(rep.comparison.costDifference) +
      ' 预算；' + rep.comparison.note);
    console.log('关键事件顺序：');
    rep.eventOrder.forEach(e => console.log('  t' + e.tick + ' ' + e.kind + ' — ' + e.text));
    console.log(line);
  }

  E.strategyReport = strategyReport;
  E.printReport = printReport;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
