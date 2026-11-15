import test from "node:test";
import assert from "node:assert/strict";
import { PressSimulator } from "../src/simulator.js";

function advance(simulator, durationMs, stepMs = 20) {
  let elapsed = 0;
  while (elapsed < durationMs) {
    const step = Math.min(stepMs, durationMs - elapsed);
    simulator.update(step);
    elapsed += step;
  }
}

function advanceUntil(simulator, predicate, limitMs = 20000, stepMs = 20) {
  let elapsed = 0;
  while (!predicate() && elapsed < limitMs) {
    simulator.update(stepMs);
    elapsed += stepMs;
  }
  return elapsed;
}

test("正常生产：设备依次启动，连续十张合格后冻结归档", () => {
  const simulator = new PressSimulator();
  assert.equal(simulator.phase, "ready");
  assert.equal(simulator.start(), true);
  assert.equal(simulator.phase, "running");

  const starts = simulator.batch.events.filter((event) => event.action === "start");
  assert.equal(starts.length, 6);
  assert.deepEqual(starts.map((event) => event.device), [
    "feeder",
    "cylinder",
    "dryer",
    "tensionSensor",
    "cutter",
    "inkPump"
  ]);

  const elapsed = advanceUntil(simulator, () => simulator.phase === "complete");
  assert.ok(elapsed < 12000, `生产耗时异常：${elapsed}ms`);
  assert.equal(simulator.batch.goodCount, 10);
  assert.equal(simulator.batch.wasteCount, 0);
  assert.equal(simulator.batch.goodStreak, 10);
  assert.ok(simulator.batch.peakPower > 7);
  assert.equal(simulator.batch.stopReason.code, "ten-good");
  assert.match(simulator.batch.stopReason.text, /连续 10 张合格/);

  const events = simulator.batch.events;
  const stopEvents = events.filter((event) => event.action === "stop");
  assert.equal(stopEvents.length, 6);
  assert.ok(stopEvents.every((event) => event.reason === "批次完成"));
  assert.ok(events.every((event, index) => index === 0 || event.atMs >= events[index - 1].atMs));

  assert.equal(simulator.history.length, 1);
  const archived = simulator.history[0];
  assert.ok(Object.isFrozen(archived));
  assert.ok(Object.isFrozen(archived.sheets));
  assert.throws(() => {
    archived.goodCount = 999;
  }, TypeError);
  assert.equal(archived.goodCount, 10);
});

test("设备故障：指出滚筒与触发温度，恢复后审计无残留且计数不回退", () => {
  const simulator = new PressSimulator();
  simulator.start();
  advance(simulator, 1500);
  const goodBeforeFault = simulator.batch.goodCount;
  const sheetsBeforeFault = simulator.batch.sheets.length;

  assert.equal(simulator.injectFault("bearing"), true);
  assert.equal(simulator.phase, "faulted");
  assert.equal(simulator.fault.device, "cylinder");
  assert.equal(simulator.fault.triggerValue, "96.4 °C");
  assert.equal(simulator.devices.cylinder.on, false);
  assert.equal(simulator.devices.cylinder.faulted, true);
  assert.equal(simulator.batch.goodStreak, 0);
  const faultStop = simulator.batch.events.findLast(
    (event) => event.device === "cylinder" && event.action === "stop"
  );
  assert.match(faultStop.reason, /滚筒轴承卡滞/);
  assert.ok(simulator.batch.anomalies.some((item) => item.type === "fault" && item.triggerValue === "96.4 °C"));

  assert.equal(simulator.recoverFault(), true);
  assert.equal(simulator.phase, "running");
  const audit = simulator.batch.recoveryAudits[0];
  assert.equal(audit.finished, false);
  advance(simulator, 5100);

  assert.equal(audit.finished, true);
  assert.equal(audit.passed, true);
  assert.deepEqual(audit.errors, []);
  assert.equal(simulator.getInvariantReport().passed, true);
  assert.equal(simulator.getInvariantReport().activeFault, false);
  assert.equal(simulator.getInvariantReport().illegalInkSupply, false);
  assert.ok(simulator.batch.goodCount >= goodBeforeFault);
  assert.ok(simulator.batch.sheets.length >= sheetsBeforeFault);

  const completedDuringAudit = simulator.batch.sheets.length - audit.startSheets;
  const countedDuringAudit = simulator.batch.goodCount - audit.startGood
    + simulator.batch.wasteCount - audit.startWaste;
  assert.equal(countedDuringAudit, completedDuringAudit);
  assert.ok(simulator.batch.anomalies.some((item) => item.type === "recovery" && item.handled));
  assert.equal(simulator.fault, null);
});

test("参数越限：墨量 96% 立即停机并锁定供墨泵与触发值", () => {
  const simulator = new PressSimulator();
  simulator.start();
  advance(simulator, 500);
  simulator.setParams({ ink: 96 });
  advance(simulator, 40);

  assert.equal(simulator.phase, "faulted");
  assert.equal(simulator.fault.source, "limit");
  assert.equal(simulator.fault.device, "inkPump");
  assert.equal(simulator.fault.numericValue, 96);
  assert.equal(simulator.fault.triggerValue, "96.0 %");
  assert.match(simulator.fault.threshold, /88/);
  assert.equal(simulator.devices.inkPump.on, false);
  assert.ok(simulator.batch.anomalies.some((item) => item.source === "limit" && item.triggerValue === "96.0 %"));

  assert.equal(simulator.recoverFault(), false);
  assert.equal(simulator.phase, "faulted");
  simulator.setParams({ ink: 50 });
  assert.equal(simulator.recoverFault(), true);
  advance(simulator, 5100);

  const latestAudit = simulator.batch.recoveryAudits.at(-1);
  assert.equal(latestAudit.passed, true);
  assert.deepEqual(latestAudit.errors, []);
  const beforeHold = {
    good: simulator.batch.goodCount,
    waste: simulator.batch.wasteCount,
    sheets: simulator.batch.sheets.length
  };
  advance(simulator, 1800);
  assert.equal(simulator.phase, "running");
  assert.equal(simulator.fault, null);
  assert.ok(simulator.batch.goodCount >= beforeHold.good);
  assert.ok(simulator.batch.wasteCount >= beforeHold.waste);
  assert.ok(simulator.batch.sheets.length >= beforeHold.sheets);
});

test("暂停、换卷与重置：供墨在换卷全程关闭，重置不污染已归档批次", () => {
  const simulator = new PressSimulator();
  simulator.start();
  advance(simulator, 420);
  assert.equal(simulator.pause(), true);
  assert.equal(simulator.phase, "paused");
  assert.ok(Object.values(simulator.devices).every((device) => device.on === false));
  assert.ok(simulator.batch.events.some(
    (event) => event.action === "stop" && event.reason === "暂停检查"
  ));

  assert.equal(simulator.resume(), true);
  assert.equal(simulator.changeRoll(), true);
  assert.equal(simulator.devices.inkPump.on, false);
  const interlockEvent = simulator.batch.events.findLast(
    (event) => event.device === "inkPump" && event.action === "stop"
  );
  assert.equal(interlockEvent.reason, "换纸卷 · 供墨联锁");

  let rollElapsed = 0;
  while (simulator.phase === "rollChange" && rollElapsed < 2200) {
    simulator.update(20);
    rollElapsed += 20;
    if (simulator.phase === "rollChange") {
      assert.equal(simulator.devices.inkPump.on, false);
    }
  }
  assert.equal(simulator.phase, "running");
  assert.equal(simulator.devices.inkPump.on, true);
  const inkRestart = simulator.batch.events.findLast(
    (event) => event.device === "inkPump" && event.action === "start"
  );
  assert.match(inkRestart.reason, /供墨恢复/);

  const oldId = simulator.batch.id;
  simulator.endBatch("换卷测试批次归档");
  assert.equal(simulator.history.length, 1);
  assert.equal(simulator.resetCurrentBatch(), oldId);
  assert.notEqual(simulator.batch.id, oldId);
  assert.equal(simulator.batch.goodCount, 0);
  assert.equal(simulator.batch.events.length, 0);
  assert.equal(simulator.history.length, 1);
  assert.ok(Object.isFrozen(simulator.history[0]));
});

test("快照重跑：参数副本可改，异常处理可追溯，历史归档不可修改", () => {
  const simulator = new PressSimulator();
  simulator.start();
  advance(simulator, 900);
  const snapshot = simulator.saveSnapshot("基线设备状态");
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.params.ink, 50);
  assert.equal(snapshot.devices.inkPump.on, true);

  simulator.injectFault("inkLoss");
  simulator.recoverFault();
  advance(simulator, 5100);
  const firstAudit = simulator.batch.recoveryAudits.at(-1);
  assert.equal(firstAudit.passed, true);
  simulator.endBatch("完成故障演练对照批次");
  const abnormalBatch = simulator.history.at(-1);
  assert.ok(abnormalBatch.anomalies.some((item) => item.type === "fault"));
  assert.ok(abnormalBatch.anomalies.some((item) => item.type === "recovery"));
  assert.ok(abnormalBatch.stopReason);

  simulator.prepareSnapshotRun(snapshot.id);
  assert.equal(simulator.phase, "ready");
  assert.equal(simulator.batch.snapshotOrigin, snapshot.id);
  assert.equal(simulator.params.ink, 50);
  simulator.setParams({ ink: 46, dryer: 64 });
  assert.equal(snapshot.params.ink, 50);
  assert.equal(simulator.start(), true);
  advanceUntil(simulator, () => simulator.phase === "complete");
  const comparisonBatch = simulator.history.at(-1);

  assert.equal(simulator.history.length, 2);
  assert.equal(comparisonBatch.status, "completed");
  assert.equal(comparisonBatch.goodCount, 10);
  assert.equal(comparisonBatch.paramsFinal.ink, 46);
  assert.ok(Object.isFrozen(abnormalBatch));
  assert.ok(Object.isFrozen(comparisonBatch));
  assert.equal(comparisonBatch.anomalies.length, 0);
  assert.ok(abnormalBatch.anomalies.length >= 2);
  assert.throws(() => {
    abnormalBatch.anomalies.push({ title: "篡改" });
  }, TypeError);
});
