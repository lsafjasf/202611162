import test from "node:test";
import assert from "node:assert/strict";

import { FishwaySim, SPECIES } from "../src/sim.js";

const advance = (sim, seconds, dt = 0.1) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) sim.step(dt);
};

test("same seed restores target fish, weather and initial resources", () => {
  const first = new FishwaySim("RIVER-731");
  const second = new FishwaySim("RIVER-731");

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.resources.power, second.resources.power);
  assert.equal(first.resources.water, second.resources.water);
  assert.deepEqual(
    first.fish.map((fish) => [fish.id, fish.species, fish.u, fish.stress, fish.energy]),
    second.fish.map((fish) => [fish.id, fish.species, fish.u, fish.stress, fish.energy]),
  );
  assert.deepEqual(first.weatherSequence, second.weatherSequence);
});

test("environment changes continuously under a fixed control setting", () => {
  const sim = new FishwaySim("CONTINUITY-2");
  let previous = { ...sim.environment };
  let largestJump = 0;

  for (let index = 0; index < 1200; index += 1) {
    sim.step(0.1);
    for (const key of ["flow", "depth", "head", "light", "temperature"]) {
      largestJump = Math.max(largestJump, Math.abs(sim.environment[key] - previous[key]));
    }
    previous = { ...sim.environment };
  }

  assert.ok(largestJump < 0.06, `largest frame-to-frame jump was ${largestJump}`);
  assert.ok(sim.history.length > 100);
});

test("fixed control sequence reproduces operation and event order", () => {
  const run = () => {
    const sim = new FishwaySim("REPLAY-99");
    sim.applyControls({ gate: 72, vane: 62, lamp: 35 });
    advance(sim, 30);
    sim.applyControls({ gate: 52, vane: 58, lamp: 25 });
    advance(sim, 30);
    sim.applyControls({ gate: 22, vane: 76, lamp: 2 });
    advance(sim, 30);
    return {
      signature: sim.getEventSignature(),
      events: sim.getEventTrace().map((event) => event.key),
      outcomes: sim.operations.map((operation) => operation.outcome),
      fish: sim.fish.map((fish) => [fish.id, fish.state, fish.u]),
      resources: sim.resources,
    };
  };

  const first = run();
  const second = run();
  assert.deepEqual(first, second);
});

test("low gate produces a failed operation with resource and bio comparison", () => {
  const sim = new FishwaySim("FAIL-12");
  advance(sim, 8);
  sim.applyControls({ gate: 12, vane: 18, lamp: 10 });
  advance(sim, 5);
  const operation = sim.operations.at(-1);

  assert.equal(operation.status, "complete");
  assert.equal(operation.outcome, "failure");
  assert.ok(operation.after.environment.head > operation.before.environment.head);
  assert.ok(operation.after.resources.water < operation.before.resources.water);
  assert.ok(operation.after.bio.averageStress > operation.before.bio.averageStress);
  assert.equal(operation.delta.time, 4.5);
});

test("both recovery plans report cost, trigger and final ecology", () => {
  for (const kind of ["gentle", "flush"]) {
    const sim = new FishwaySim(`RECOVERY-${kind}`);
    advance(sim, 20);
    sim.applyControls({ gate: 10, vane: 16, lamp: 10 });
    advance(sim, 12);
    const preview = sim.recoveryPreview(kind);
    const report = sim.startRecovery(kind);

    assert.ok(preview.cost.water > 0);
    assert.equal(report.kind, kind);
    assert.ok(report.trigger.label.length > 0);
    advance(sim, preview.duration + 0.2);
    assert.equal(report.status, "complete");
    assert.ok(report.final.ecoScore >= 0);
    assert.ok(report.final.flow > 0);
    assert.ok(report.after.resources.water < report.before.resources.water);
  }
});

test("staged controls can complete all three target groups", () => {
  const sim = new FishwaySim("SUCCESS-42");
  sim.applyControls({ gate: 72, vane: 62, lamp: 35 });
  advance(sim, 30);
  sim.applyControls({ gate: 52, vane: 58, lamp: 25 });
  advance(sim, 30);
  sim.applyControls({ gate: 22, vane: 76, lamp: 2 });
  advance(sim, 30);

  assert.equal(sim.success, true);
  for (const key of Object.keys(SPECIES)) {
    assert.equal(sim.getGroups().find((group) => group.key === key).passed, 3);
  }
});
