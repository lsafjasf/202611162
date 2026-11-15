import test from "node:test";
import assert from "node:assert/strict";
import { ORDERS, recommendedRecipe } from "../js/data.js";
import { PackingEngine, evaluateOrder } from "../js/engine.js";

function run(engine, milliseconds, step = 100) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    engine.tick(step);
  }
}

test("normal batch produces eight good cartons and immutable device history", () => {
  const engine = new PackingEngine();
  const started = engine.startBatch({ scenario: "normal" });
  assert.equal(started.ok, true);
  run(engine, 26_000);

  assert.equal(engine.status, "complete");
  assert.equal(engine.runtime.good, 8);
  assert.equal(engine.runtime.waste, 0);
  assert.equal(engine.completedBatches.length, 1);
  assert.ok(engine.runtime.deviceLogs.length >= 40);
  assert.ok(
    engine.runtime.deviceLogs.every(
      (entry) => entry.startLabel && entry.stopLabel && entry.duration >= 0
    )
  );

  const result = engine.completedBatches[0];
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.orders), true);
  assert.throws(() => {
    result.good = 0;
  });
});

test("sealer fault identifies SEAL-02 and clears after fixed recovery observation", () => {
  const engine = new PackingEngine();
  engine.startBatch({ scenario: "fault" });

  run(engine, 2_200);
  const fault = engine.getOpenException();
  assert.equal(engine.status, "fault");
  assert.equal(fault.equipment, "SEAL-02");
  assert.equal(fault.triggerValue, 241.8);
  assert.match(fault.trigger, /241\.8/);
  assert.equal(engine.devices.sealer.health, "fault");

  const recovery = engine.recoverFault();
  assert.equal(recovery.ok, true);
  run(engine, 3_100);

  const resolved = engine.runtime.exceptions[0];
  assert.equal(engine.status, "running");
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.recovery.passed, true);
  assert.deepEqual(resolved.recovery.residuals, []);
  assert.equal(engine.devices.sealer.health, "ok");

  run(engine, 24_000);
  assert.equal(engine.status, "complete");
  assert.equal(engine.runtime.good, 8);
  assert.equal(engine.runtime.exceptions.length, 1);
});

test("offset over limit blocks ARM-01 and requires a corrected value before reset", () => {
  const engine = new PackingEngine();
  engine.setOffset(30);
  const started = engine.startBatch({ scenario: "limit" });

  assert.equal(started.ok, false);
  assert.equal(engine.status, "fault");
  assert.equal(engine.getOpenException().equipment, "ARM-01");
  assert.equal(engine.getOpenException().triggerValue, 30);
  assert.equal(engine.recoverFault().ok, false);
  assert.equal(engine.devices.roboticArm.active, false);

  engine.setOffset(8);
  assert.equal(engine.recoverFault().ok, true);
  run(engine, 3_100);
  assert.equal(engine.runtime.exceptions[0].recovery.passed, true);
  assert.equal(engine.runtime.offsetSnapshot, 8);
  run(engine, 24_000);
  assert.equal(engine.status, "complete");
  assert.equal(engine.runtime.good, 8);
  assert.equal(engine.runtime.waste, 0);
});

test("pause closes active device intervals and resume opens new intervals", () => {
  const engine = new PackingEngine();
  engine.startBatch();
  run(engine, 800);
  const beforePause = engine.runtime.deviceLogs.length;
  assert.equal(engine.pause().ok, true);
  assert.equal(engine.status, "paused");
  assert.ok(engine.runtime.deviceLogs.some((entry) => entry.stopReason === "operator-pause"));

  run(engine, 1_000);
  assert.equal(engine.status, "paused");
  assert.equal(engine.resume().ok, true);
  assert.equal(engine.status, "running");
  assert.ok(engine.runtime.deviceLogs.length > beforePause);
});

test("recipe checks distinguish crush, oversize and offset bulge", () => {
  const order = ORDERS[1];
  const recommended = recommendedRecipe(order);
  const good = evaluateOrder(order, recommended, 0);
  assert.equal(good.good, true);

  const tooSmall = evaluateOrder(order, { ...recommended, boxSize: "S", buffer: "honey" }, 0);
  assert.equal(tooSmall.good, false);
  assert.ok(tooSmall.issues.some((issue) => issue.code === "CRUSH"));

  const tooLarge = evaluateOrder(order, { ...recommended, boxSize: "L" }, 0);
  assert.equal(tooLarge.good, false);
  assert.ok(tooLarge.issues.some((issue) => issue.code === "OVERSIZE"));

  const bulged = evaluateOrder(order, recommended, 14);
  assert.equal(bulged.good, false);
  assert.ok(bulged.issues.some((issue) => issue.code === "BULGE"));
});

test("snapshot comparison keeps two separate frozen results", () => {
  const engine = new PackingEngine();
  engine.startBatch();
  run(engine, 26_000);
  const snapshot = engine.saveSnapshot();
  assert.equal(snapshot.batchId, "B001");

  engine.setRecipe("ORD-2402", {
    boxSize: "M",
    buffer: "foam",
    tapePath: "H"
  });
  engine.startBatch({ fresh: true });
  run(engine, 26_000);

  assert.equal(engine.completedBatches.length, 2);
  const comparison = engine.getComparison(snapshot.id);
  assert.equal(comparison.base.id, "B001");
  assert.equal(comparison.current.id, "B002");
  assert.equal(comparison.current.waste, 1);
  assert.equal(Object.isFrozen(comparison.base), true);
  assert.equal(comparison.base.waste, 0);
});
