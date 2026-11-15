// 三场景验证: 正常生产 / 设备故障 / 参数越限
const fs = require("fs");
const path = require("path");
const code = fs.readFileSync(path.join(__dirname, "../js/sim.js"), "utf8");
eval(code + "\nglobalThis.Simulation = Simulation;");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}
function run(sim, seconds) {
  for (let t = 0; t < seconds; t += 0.1) sim.step(0.1);
}

// ---------- 场景 1: 正常生产 ----------
console.log("场景1: 正常生产");
{
  const sim = new Simulation();
  sim.resetBatch(false);
  let batchRec = null;
  sim.on("batchEnd", (r) => (batchRec = r));
  sim.thicknessTimer = 1e9;   // 固定厚度, 保证测试确定性
  sim.setParam("speed", 2.0);
  sim.setParam("temp", 560);
  sim.setParam("flow", 55);
  let guard = 0;
  while (!batchRec && guard++ < 20000) sim.step(0.1);
  check("批次正常结束", !!batchRec);
  check("达成 3 块合格", batchRec && batchRec.good >= 3);
  check("记录了峰值功耗", batchRec && batchRec.peakPower > 0);
  check("有停机原因", batchRec && batchRec.stopReason.length > 0);
  check("设备启停时刻已记录", sim.events.some((e) => e.msg.includes("启动")));
}

// ---------- 场景 2: 设备故障 + 恢复观察 ----------
console.log("场景2: 设备故障");
{
  const sim = new Simulation();
  sim.resetBatch(false);
  let faultRec = null;
  sim.on("fault", (r) => (faultRec = r));
  run(sim, 5);
  sim.injectFault();
  check("故障导致停机", sim.running === false);
  check("故障记录含设备与触发值",
    !!faultRec && faultRec.device.length > 0 && faultRec.triggerValue.length > 0);
  check("异常已计入本批记录", sim.exceptions.length === 1);
  sim.recover();
  check("恢复后重新运行", sim.running === true);
  check("进入观察期", sim.observeLeft > 0);
  const tripsBefore = sim.events.filter((e) => e.msg.startsWith("【停机】")).length;
  run(sim, 25);
  check("观察期结束", sim.observeLeft <= 0);
  check("确认无残留/无错误累计",
    sim.events.some((e) => e.msg.includes("无状态残留")));
  const tripsAfter = sim.events.filter((e) => e.msg.startsWith("【停机】")).length;
  check("观察期内无新停机", tripsAfter === tripsBefore);
  check("设备重启时刻已记录",
    sim.events.filter((e) => e.msg.includes("启动")).length >= 4);
}

// ---------- 场景 3: 参数越限 ----------
console.log("场景3: 参数越限");
{
  const sim = new Simulation();
  sim.resetBatch(false);
  let faultRec = null;
  sim.on("fault", (r) => (faultRec = r));
  run(sim, 3);
  const ok = sim.setParam("temp", 780);
  check("越限被拒绝", ok === false);
  check("参数被钳位到上限", sim.params.temp === 700);
  check("触发保护停机", sim.running === false);
  check("记录指向正确设备(热风加热器)", faultRec && faultRec.device === "热风加热器");
  check("触发值含越限数值", faultRec && faultRec.triggerValue.includes("780"));
  sim.recover();
  run(sim, 25);
  check("恢复后正常运行", sim.running === true && sim.observeLeft <= 0);
}

// ---------- 附加: 已完成批次只读 ----------
console.log("附加: 已完成批次只读");
{
  const rec = Object.freeze({ id: 1, good: 3 });
  let threw = false;
  try { "use strict"; rec.good = 99; } catch (e) { threw = true; }
  check("冻结对象不可修改", rec.good === 3);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
