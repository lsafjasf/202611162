/* demo.js — 命令行演示：node demo.js [seed] */
'use strict';
const E = require('./env-engine.js');
require('./env-driver.js');
require('./report.js');

const seed = parseInt(process.argv[2], 10) || 2026;
const report = E.strategyReport(seed);
E.printReport(report);

console.log('\n额外校验：两种策略各跑一次完整任务');
['A', 'B'].forEach(kind => {
  const r = E.runAutopilot(seed, kind, 320);
  console.log('策略 ' + kind + ' => 结束状态 ' + r.end.status +
    '，通过记录 ' + r.accepted + ' 组，失败操作 ' + r.failures +
    ' 次，预算 ' + r.start.budget + '→' + r.end.budget +
    '，生态 ' + r.start.eco.toFixed(1) + '→' + r.end.eco.toFixed(1) +
    '，耗时 ' + r.end.time + 's');
});
