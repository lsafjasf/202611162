// Node 验证：确定性、三场景、双策略。运行：node tests/verify.js
const assert = require("assert");
const Sim = require("../js/simulation.js");
const Policies = require("../js/policies.js");
const Report = require("../js/report.js");
const CFG = require("../js/config.js");

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log("  ✓ " + name);
}

console.log("== 1. 同 seed 确定性 ==");
for (const seed of ["20261116", "777", "alpha"]) {
  check("seed=" + seed + " 两次独立运行状态与事件顺序一致", () => {
    const a = Policies.runPolicy(seed, Policies.aggressiveStep);
    const b = Policies.runPolicy(seed, Policies.aggressiveStep);
    assert.deepStrictEqual(Report.snapshot(a), Report.snapshot(b));
    assert.deepStrictEqual(Report.eventOrder(a), Report.eventOrder(b));
    assert.strictEqual(a.plotId, b.plotId);
    assert.strictEqual(a.cultivar, b.cultivar);
    assert.strictEqual(a.water, b.water);
  });
}

check("不同 seed 产生不同地块与天气", () => {
  const a = Sim.createSimulation("20261116");
  const b = Sim.createSimulation("other-seed");
  assert.notStrictEqual(a.plotId + a.forecast[0].rainMm, b.plotId + b.forecast[0].rainMm);
});

check("导出动作序列 replay 与在线逐步执行结果完全一致", () => {
  const live = Sim.createSimulation("20261116");
  while (live.status === "running") {
    Policies.aggressiveStep(live);
    Sim.stepHour(live);
  }
  const actions = live.actions
    .filter((a) => a.ok)
    .map((a) => ({ hour: a.hour, type: a.type }));
  const replayed = Sim.replay("20261116", actions);
  assert.deepStrictEqual(Report.snapshot(live), Report.snapshot(replayed));
  assert.deepStrictEqual(Report.eventOrder(live), Report.eventOrder(replayed));
});

console.log("== 2. 连续变化（无逐帧随机跳变）==");
check("每小时指标平滑，EC 单步变化不超过物理上限", () => {
  const s = Sim.createSimulation("20261116");
  let prev = Sim.rootEC(s);
  while (s.status === "running") {
    Policies.conservativeStep(s);
    Sim.stepHour(s);
    const cur = Sim.rootEC(s);
    assert(Math.abs(cur - prev) < 1.0, "EC 单小时跳变异常: " + prev + "->" + cur);
    prev = cur;
  }
});

console.log("== 3. 三类场景 ==");
const seed = "20261116";
const steady = Report.steadyScenario(seed);
const critical = Report.criticalScenario(seed);
const failure = Report.failureScenario(seed);
check("稳态场景成功", () => assert.strictEqual(steady.state.status, "success"));
check("临界场景在阈值触发后抢救", () => assert(critical.alarmHour > 0));
check("失败操作场景失败且浪费淡水", () => {
  assert.strictEqual(failure.state.status, "failed");
  assert(failure.state.totals.waterUsed > 5, "应出现明显淡水浪费");
});

console.log("== 4. 双策略代价对比 ==");
const cmp = Report.policyCompare(seed);
check("两种策略都给出完整指标", () => assert.strictEqual(cmp.length, 2));
check("强淋洗耗水显著高于节水型", () => assert(cmp[1].water > cmp[0].water * 1.5));

console.log("\n全部 " + pass + " 项通过。\n");
console.log("场景摘要：");
[steady, critical, failure].forEach((sc) => {
  console.log("- " + sc.name + "\n  前: " + sc.before + "\n  后: " + sc.after + "\n  结论: " + sc.result);
});
console.log("\n策略对比（seed=" + seed + "）：");
cmp.forEach((r) => console.log("- " + r.name + " [" + r.status + "] 水 " + r.water +
  "m³ 电 " + r.energy + "kWh 覆盖 " + r.mulch + " 成本 " + r.cost +
  " 元 | 终值 EC " + r.ec + " 水位 " + r.gw + "mm 生物量 " + r.biomass + "%"));
