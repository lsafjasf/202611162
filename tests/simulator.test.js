import test from "node:test";
import assert from "node:assert/strict";
import {
  RECOVERY_WINDOW,
  PowderMixSimulator,
  deepFreeze,
} from "../src/simulator.js";

function runUntil(engine, predicate, limit = 5000) {
  for (let index = 0; index < limit; index += 1) {
    if (predicate(engine.state)) return engine.state;
    engine.step(0.1);
  }
  throw new Error(`Condition not reached; phase=${engine.state.phase}`);
}

function runToCompletion(params, batchNumber = 1) {
  const engine = new PowderMixSimulator({ batchNumber, params });
  const started = engine.start();
  assert.equal(started.ok, true);
  runUntil(engine, (state) => state.completed || state.failed);
  assert.equal(engine.state.failed, false);
  return engine;
}

test("正常生产：三批均达到均匀度要求并生成完整封存结果", () => {
  for (let batchNumber = 1; batchNumber <= 3; batchNumber += 1) {
    const engine = runToCompletion(
      { feedOrder: ["B", "A", "C"], rpm: 82, mixTime: 42, valve: 44 },
      batchNumber,
    );
    const result = engine.state.result;
    assert.ok(result, "batch result should exist");
    assert.ok(result.uniformity >= 85, `uniformity=${result.uniformity}`);
    assert.equal(result.accepted, true);
    assert.ok(result.goodKg > result.wasteKg);
    assert.ok(result.peakPower > 0);
    assert.equal(result.shutdownReason, "正常完成");

    for (const equipmentId of ["feeder", "motor", "fan", "valve"]) {
      const device = result.equipment[equipmentId];
      assert.ok(device.startCount >= 1, `${equipmentId} should start`);
      assert.ok(device.stopCount >= 1, `${equipmentId} should stop`);
      assert.notEqual(device.startedAt, null);
      assert.notEqual(device.stoppedAt, null);
    }
    assert.ok(result.events.some((event) => event.type === "start"));
    assert.ok(result.events.some((event) => event.type === "stop"));
  }
});

test("设备故障：指出主电机与 106.8°C 触发值，恢复窗无残留且错误不累计", () => {
  const engine = new PowderMixSimulator({
    params: { rpm: 82, mixTime: 42, valve: 44, fault: "motor_overheat" },
  });
  assert.equal(engine.start().ok, true);
  runUntil(engine, (state) => state.failed);
  const failure = engine.state.failure;
  assert.equal(failure.equipmentName, "主电机 M-01");
  assert.equal(failure.trigger, "绕组温度");
  assert.equal(failure.valueText, "106.8 °C");
  assert.equal(failure.thresholdText, "95 °C");
  assert.ok(engine.state.events.some((event) => event.type === "alarm" && event.deviceId === "motor"));

  const errorCountAtFailure = engine.state.errorCount;
  assert.equal(errorCountAtFailure, 1);
  const recovered = engine.recover();
  assert.equal(recovered.ok, true);
  assert.equal(engine.state.recovery.required, RECOVERY_WINDOW);
  const recoveryStart = engine.state.elapsed;
  runUntil(engine, (state) => Boolean(state.recoveryVerification));
  const verification = engine.state.recoveryVerification;
  assert.equal(verification.passed, true);
  assert.equal(verification.addedErrors, 0);
  assert.equal(verification.deviceFaults, 0);
  assert.equal(verification.latchedAlarms, 0);
  assert.equal(engine.state.errorCount, errorCountAtFailure);
  assert.ok(engine.state.elapsed - recoveryStart >= RECOVERY_WINDOW);

  runUntil(engine, (state) => state.completed);
  assert.equal(engine.state.result.accepted, true);
  assert.match(engine.state.result.shutdownReason, /恢复后完成 · 主电机 M-01已处理/);
  assert.ok(engine.state.result.incidents.some((incident) => incident.type === "recovery"));
});

test("四类设备故障均可恢复，固定窗结束前不提前放行", () => {
  const cases = [
    ["motor_overheat", "主电机 M-01", "106.8 °C"],
    ["fan_stall", "除尘风机 F-02", "31 m³/h"],
    ["valve_jam", "出料阀 V-04", "27 %"],
    ["inverter_comm", "变频器 VFD-01", "2800 ms"],
  ];
  for (const [fault, equipmentName, valueText] of cases) {
    const engine = new PowderMixSimulator({
      params: { rpm: 82, mixTime: 42, valve: 44, fault },
    });
    engine.start();
    runUntil(engine, (state) => state.failed);
    assert.equal(engine.state.failure.equipmentName, equipmentName);
    assert.equal(engine.state.failure.valueText, valueText);
    engine.recover();
    for (let step = 0; step < 79; step += 1) engine.step(0.1);
    assert.equal(engine.state.recoveryVerification, null, `${fault} ended before fixed window`);
    assert.equal(engine.state.recovery.active, true);
    for (let step = 0; step < 3; step += 1) engine.step(0.1);
    assert.equal(engine.state.recoveryVerification.passed, true, fault);
    assert.equal(engine.state.recoveryVerification.addedErrors, 0, fault);
  }
});

test("参数越限：128 rpm 触发主电机上限联锁，恢复自动限幅并完成验证", () => {
  const engine = new PowderMixSimulator({
    params: { rpm: 128, mixTime: 42, valve: 44 },
  });
  const response = engine.start();
  assert.equal(response.ok, false);
  assert.equal(engine.state.failure.kind, "limit");
  assert.equal(engine.state.failure.equipmentName, "主电机 M-01");
  assert.equal(engine.state.failure.trigger, "滚筒转速");
  assert.equal(engine.state.failure.valueText, "128 rpm");
  assert.equal(engine.state.failure.thresholdText, "20–110 rpm");
  assert.equal(engine.state.failed, true);

  engine.recover();
  assert.equal(engine.state.params.rpm, 105);
  runUntil(engine, (state) => Boolean(state.recoveryVerification));
  assert.equal(engine.state.recoveryVerification.passed, true);
  assert.equal(engine.state.recoveryVerification.addedErrors, 0);
  assert.ok(["feeding", "mixing"].includes(engine.state.phase));
  assert.ok(engine.state.equipment.feeder.startCount >= 1);
});

test("低转速导致分层，高转速导致团聚，快速出料产生夹带", () => {
  const stratified = runToCompletion({ rpm: 38, mixTime: 42, valve: 44 });
  assert.ok(stratified.state.stratification > 5);
  assert.ok(stratified.state.result.uniformity < 85);
  assert.equal(stratified.state.result.accepted, false);

  const agglomerated = runToCompletion({ rpm: 108, mixTime: 42, valve: 44 });
  assert.ok(agglomerated.state.agglomeration > 1);

  const entrained = runToCompletion({ rpm: 82, mixTime: 18, valve: 84 });
  assert.ok(entrained.state.entrainment > 0);
  assert.ok(entrained.state.result.wasteKg > 1);
});

test("暂停冻结时间，重置只清当前批次状态并保留参数", () => {
  const engine = new PowderMixSimulator({ params: { rpm: 82, mixTime: 42, valve: 44 } });
  engine.start();
  runUntil(engine, (state) => state.elapsed >= 2);
  engine.togglePause();
  const frozenAt = engine.state.elapsed;
  for (let index = 0; index < 30; index += 1) engine.step(0.1);
  assert.equal(engine.state.elapsed, frozenAt);
  assert.equal(engine.state.paused, true);
  engine.togglePause();
  engine.step(0.1);
  assert.ok(engine.state.elapsed > frozenAt);

  const params = { ...engine.state.params };
  engine.reset(params);
  assert.equal(engine.state.elapsed, 0);
  assert.equal(engine.state.failed, false);
  assert.equal(engine.state.errorCount, 0);
  assert.deepEqual(engine.state.params.feedOrder, params.feedOrder);
});

test("完成结果和快照只读，设备快照保留启停状态与异常记录", () => {
  const engine = new PowderMixSimulator({
    params: { rpm: 82, mixTime: 42, valve: 44, fault: "motor_overheat" },
  });
  engine.start();
  runUntil(engine, (state) => state.failed);
  engine.recover();
  runUntil(engine, (state) => state.completed);
  assert.equal(Object.isFrozen(engine.state.result), true);
  assert.equal(Object.isFrozen(engine.state.result.incidents), true);
  assert.throws(() => {
    engine.state.result.uniformity = 1;
  }, TypeError);

  const snapshot = engine.captureSnapshot({
    name: "测试快照",
    baseResult: engine.state.result,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.ok(snapshot.equipment.motor.startCount >= 1);
  assert.ok(snapshot.incidents.length >= 1);
  assert.equal(snapshot.baseResult.id, engine.state.result.id);
  assert.throws(() => {
    snapshot.params.rpm = 10;
  }, TypeError);
});

test("深冻结可保护持久化恢复后的已完成批次", () => {
  const source = deepFreeze({
    id: "B-900",
    accepted: true,
    nested: { value: 92.4 },
  });
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.nested), true);
  assert.throws(() => {
    source.nested.value = 0;
  }, TypeError);
});
