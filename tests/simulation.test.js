import test from "node:test";
import assert from "node:assert/strict";
import {
  createBatch,
  startBatch,
  setControls,
  advance,
  injectFault,
  repairAndVerify,
  createSnapshot,
  pauseBatch,
  resumeBatch,
  PROFILE,
  CONTROL_LIMITS
} from "../src/simulation.js";

function runManagedBatch(state, limit = 420) {
  for (let second = 0; second < limit && state.status === "running"; second += 1) {
    if (state.phase === "heating") {
      setControls(state, { gas: 76, vent: 46, door: 0 });
    } else if (state.phase === "holding") {
      setControls(state, {
        gas: state.chamberTemp < PROFILE.chamberPeak - 5 ? 52 : 42,
        vent: 46,
        door: 0
      });
    } else if (state.phase === "cooling") {
      setControls(state, { gas: 0, vent: 50, door: 34 });
    }
    advance(state, 1);
  }
  return state;
}

test("normal production completes with three good pieces and device timestamps", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  runManagedBatch(state);

  assert.equal(state.status, "completed");
  assert.equal(state.result.good, 3);
  assert.equal(state.result.waste, 0);
  assert.equal(state.result.alarmCount, 0);
  assert.match(state.result.shutdownReason, /三件良品/);
  assert.ok(state.result.peakPower > 0);
  assert.equal(state.result.controls.gas, 76);
  assert.equal(state.result.finalControls.gas, 0);
  assert.ok(state.logs.some((entry) => entry.device === "burner" && entry.action === "启动"));
  assert.ok(state.logs.some((entry) => entry.device === "burner" && entry.action === "停止"));
  assert.ok(state.logs.some((entry) => entry.device === "blower" && entry.action === "启动"));
  assert.ok(state.logs.some((entry) => entry.device === "door" && entry.action === "开启"));
  assert.ok(Object.isFrozen(state.result));
  assert.equal(setControls(state, { gas: 20 }), false);
  assert.equal(state.controls.gas, 0);
});

test("equipment fault pauses, names the device and passes a clean recovery audit", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  advance(state, 30);
  injectFault(state, "burner");

  assert.equal(state.status, "fault");
  assert.equal(state.failure.deviceName, "燃气比例阀");
  assert.match(state.failure.triggerValue, /0\.0%/);
  assert.equal(state.equipment.burner.health, "fault");
  assert.ok(state.logs.some((entry) => entry.type === "trip"));

  const totalsBefore = structuredClone(state.totals);
  const alarmsBefore = state.alarmCount;
  assert.equal(repairAndVerify(state), true);
  advance(state, 20);

  assert.equal(state.status, "running");
  assert.equal(state.recoveryAudit.passed, true);
  assert.equal(state.recoveryAudit.newAlarms, 0);
  assert.deepEqual(state.totals, totalsBefore);
  assert.equal(state.alarmCount, alarmsBefore);
  assert.deepEqual(state.timers, {
    gasLimit: 0,
    lowVent: 0,
    coldAir: 0,
    overTemp: 0,
    overRate: 0
  });

  runManagedBatch(state);
  assert.equal(state.status, "completed");
  assert.equal(state.result.good, 3);
  assert.ok(state.result.recoveryAudits.length >= 1);
  assert.match(state.result.shutdownReason, /异常恢复/);
});

test("parameter limit trips with value, rejects unsafe recovery, then audits cleanly", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  setControls(state, { vent: 12 });
  advance(state, 6);

  assert.equal(state.status, "fault");
  assert.equal(state.failure.deviceName, "助燃风机");
  assert.match(state.failure.triggerValue, new RegExp(`12% < ${CONTROL_LIMITS.minVent}%`));
  assert.ok(state.totals.lowVentSeconds >= 5);

  assert.equal(repairAndVerify(state), true);
  advance(state, 7);
  assert.equal(state.status, "fault");
  assert.equal(state.recovery.failed, true);
  assert.match(state.recovery.failedReason, /欠氧|风量/);

  setControls(state, { vent: 46 });
  const totalsBefore = structuredClone(state.totals);
  const alarmsBefore = state.alarmCount;
  assert.equal(repairAndVerify(state), true);
  advance(state, 20);

  assert.equal(state.status, "running");
  assert.equal(state.recoveryAudit.newAlarms, 0);
  assert.deepEqual(state.totals, totalsBefore);
  assert.equal(state.alarmCount, alarmsBefore);

  runManagedBatch(state);
  assert.equal(state.status, "completed");
  assert.ok(state.result.recoveryAudits.some((audit) => audit.passed === false));
  assert.ok(state.result.recoveryAudits.some((audit) => audit.passed === true));
});

test("snapshots are detached and completed batch data cannot be mutated by the controller", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  advance(state, 25);
  const snapshot = createSnapshot(state, "故障前设备状态");
  const snapshotGas = snapshot.controls.gas;

  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => {
    snapshot.controls.gas = 1;
  }, TypeError);
  assert.equal(snapshot.controls.gas, snapshotGas);

  state.controls.gas = 55;
  assert.equal(snapshot.controls.gas, snapshotGas);
  runManagedBatch(state);
  assert.equal(state.status, "completed");
  const resultBefore = JSON.stringify(state.result);
  assert.equal(setControls(state, { gas: 100, vent: 0, door: 50 }), false);
  assert.equal(JSON.stringify(state.result), resultBefore);
});

test("excessive heating rate cracks the thinnest body and names the burner trigger", () => {
  const state = createBatch({ controls: { gas: 88, vent: 46, door: 0 } });
  startBatch(state);
  advance(state, 6);

  assert.equal(state.status, "fault");
  assert.equal(state.failure.code, "THERMAL_SHOCK");
  assert.equal(state.failure.deviceName, "燃气比例阀");
  assert.match(state.failure.triggerValue, /°C\/s > 9\.3°C\/s/);
  assert.equal(state.pieces[0].status, "cracked");
});

test("early cold air during the hot stage causes discoloration and names the door", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  advance(state, 85);
  assert.ok(state.chamberTemp > 620);
  setControls(state, { door: 24 });
  advance(state, 4);

  assert.equal(state.status, "fault");
  assert.equal(state.failure.code, "EARLY_COLD_AIR");
  assert.equal(state.failure.deviceName, "窑门执行器");
  assert.match(state.failure.triggerValue, /24% > 8%/);
  assert.ok(state.pieces.every((piece) => piece.status === "discolored"));
});

test("pause freezes kiln time and resume continues from the same point", () => {
  const state = createBatch({ controls: { gas: 76, vent: 46, door: 0 } });
  startBatch(state);
  advance(state, 12);
  const pausedAt = state.elapsed;

  assert.equal(pauseBatch(state), true);
  advance(state, 20);
  assert.equal(state.elapsed, pausedAt);
  assert.equal(resumeBatch(state), true);
  advance(state, 5);
  assert.ok(state.elapsed > pausedAt);
});
