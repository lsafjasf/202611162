"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../src/simulation.js");

function walkRide(world, run, options) {
  const settings = options || {};
  const ride = sim.beginRide(
    world,
    run,
    settings.routeId || "north",
    settings.weightKg == null ? 12 : settings.weightKg,
  );
  let iterations = 0;
  while (ride.state === "riding" && iterations < 12000) {
    const braking =
      ride.progress >= (settings.brakeFrom == null ? Infinity : settings.brakeFrom) &&
      ride.progress <= (settings.brakeTo == null ? Infinity : settings.brakeTo);
    sim.stepRide(world, ride, { braking: braking }, 1 / 120);
    run.elapsedSec += 1 / 120;
    iterations += 1;
  }
  return ride;
}

function completeRun(seed) {
  const world = sim.createWorld(seed);
  const run = sim.createRun(world);
  for (let index = 0; index < world.tasks.length; index += 1) {
    const ride = walkRide(world, run, {
      routeId: "north",
      weightKg: 12,
      brakeFrom: 0.34,
      brakeTo: 1,
    });
    const result = sim.settleRide(world, run, ride);
    assert.equal(result.kind, "delivered");
  }
  return { world: world, run: run };
}

test("same seed reproduces layout, obstacle positions, tasks and physics", function () {
  const first = sim.createWorld("CANOPY-653");
  const second = sim.createWorld("CANOPY-653");
  const comparison = sim.compareWorlds(first, second);

  assert.equal(comparison.sameSeed, true);
  assert.equal(comparison.sameLayout, true);
  assert.equal(comparison.previousFingerprint, comparison.nextFingerprint);
  assert.deepEqual(first.tasks, second.tasks);
  assert.deepEqual(first.obstacles, second.obstacles);
  assert.deepEqual(
    first.routes.map(function key(route) {
      return [route.id, route.start, route.rain, route.wind, route.sag, route.pull];
    }),
    second.routes.map(function key(route) {
      return [route.id, route.start, route.rain, route.wind, route.sag, route.pull];
    }),
  );
  assert.equal(first.obstacles.length >= 6, true);
});

test("a different seed changes map and conditions", function () {
  const first = sim.createWorld("CANOPY-653");
  const second = sim.createWorld("RAIN-42");
  const comparison = sim.compareWorlds(first, second);
  assert.equal(comparison.sameSeed, false);
  assert.equal(comparison.sameLayout, false);
  assert.notEqual(comparison.previousFingerprint, comparison.nextFingerprint);
});

test("fixed brake plan produces exactly repeatable win outcome and time", function () {
  const first = completeRun("CANOPY-653");
  const second = completeRun("CANOPY-653");
  const firstSummary = sim.createStateSummary(first.world, first.run, {
    status: "complete",
    finalTimeSec: first.run.elapsedSec,
  });
  const secondSummary = sim.createStateSummary(second.world, second.run, {
    status: "complete",
    finalTimeSec: second.run.elapsedSec,
  });

  assert.equal(first.run.toolsRemaining, 0);
  assert.equal(first.run.deliveries.length, 3);
  assert.equal(
    firstSummary.finalTimeSec,
    secondSummary.finalTimeSec,
  );
  assert.deepEqual(firstSummary.path, secondSummary.path);
  assert.deepEqual(firstSummary.checks, secondSummary.checks);
  assert.equal(firstSummary.verified, true);
  assert.deepEqual(sim.validateSummary(firstSummary, first.world), {
    valid: true,
    failures: [],
  });
  assert.equal(firstSummary.targetCount, 3);
  assert.equal(firstSummary.toolsRemaining, 0);
  assert.equal(firstSummary.remainingResources.rescueCords, 2);
  assert.equal(firstSummary.remainingResources.brakePads, 0);
});

test("no braking crashes and early braking strands at deterministic points", function () {
  const world = sim.createWorld("CANOPY-653");
  const run = sim.createRun(world);
  const crash = walkRide(world, run, {
    routeId: "north",
    weightKg: 12,
    brakeFrom: null,
  });
  const crashAgain = walkRide(world, run, {
    routeId: "north",
    weightKg: 12,
    brakeFrom: null,
  });
  const stranded = walkRide(world, run, {
    routeId: "north",
    weightKg: 6,
    brakeFrom: 0,
    brakeTo: 1,
  });

  assert.equal(crash.state, "crashed");
  assert.equal(crash.speed, crashAgain.speed);
  assert.equal(crash.elapsed, crashAgain.elapsed);
  assert.ok(crash.speed > sim.SAFE_SPEED);
  assert.equal(stranded.state, "stranded");
  assert.equal(stranded.speed, 0);
  assert.ok(stranded.progress > 0 && stranded.progress < 1);
});

test("crash recovery restores last successful checkpoint without rebuilding map", function () {
  const world = sim.createWorld("CANOPY-653");
  const run = sim.createRun(world);
  const fingerprint = sim.worldFingerprint(world);
  const delivered = walkRide(world, run, {
    routeId: "north",
    weightKg: 12,
    brakeFrom: 0.34,
  });
  sim.settleRide(world, run, delivered);
  assert.equal(run.toolsRemaining, 2);
  assert.equal(run.deliveries.length, 1);

  const crash = walkRide(world, run, {
    routeId: "north",
    weightKg: 12,
    brakeFrom: null,
  });
  const result = sim.settleRide(world, run, crash);
  assert.equal(result.kind, "crash");
  assert.equal(run.toolsRemaining, 2);

  const recovery = sim.restoreCheckpoint(world, run, {
    kind: "crash",
    reason: crash.lastOutcome.reason,
  });
  assert.equal(recovery.rescueSpent, false);
  assert.equal(run.toolsRemaining, 2);
  assert.equal(run.deliveries.length, 1);
  assert.equal(run.brakePads, 2);
  assert.equal(run.rescueKits, 2);
  assert.equal(run.recoveries, 1);
  assert.equal(sim.worldFingerprint(world), fingerprint);
});

test("stranded recovery consumes a rescue cord and retains prior deliveries", function () {
  const world = sim.createWorld("CANOPY-653");
  const run = sim.createRun(world);
  const delivered = walkRide(world, run, {
    routeId: "north",
    weightKg: 12,
    brakeFrom: 0.34,
  });
  sim.settleRide(world, run, delivered);
  const stranded = walkRide(world, run, {
    routeId: "north",
    weightKg: 6,
    brakeFrom: 0,
  });
  const result = sim.settleRide(world, run, stranded);
  assert.equal(result.kind, "stranded");

  const recovery = sim.restoreCheckpoint(world, run, {
    kind: "stranded",
    reason: stranded.lastOutcome.reason,
  });
  assert.equal(recovery.rescueSpent, true);
  assert.equal(run.toolsRemaining, 2);
  assert.equal(run.deliveries.length, 1);
  assert.equal(run.rescueKits, 1);
  assert.equal(run.rescueUses, 1);
  assert.equal(run.lastFailure, null);
  assert.equal(run.recoveryLog.length, 1);
});

test("completed summary verifies target count, resources and final time", function () {
  const completed = completeRun("CANOPY-653");
  const summary = sim.createStateSummary(completed.world, completed.run, {
    status: "complete",
    finalTimeSec: 14.75,
  });
  assert.equal(summary.targetCount, 3);
  assert.equal(summary.deliveredCount, 3);
  assert.equal(summary.toolsRemaining, 0);
  assert.deepEqual(summary.remainingResources, {
    brakePads: 0,
    rescueCords: 2,
  });
  assert.equal(summary.finalTime, "00:14.8");
  assert.equal(summary.checks.targetCountMatches, true);
  assert.equal(summary.checks.resourcesRecorded, true);
  assert.equal(summary.checks.finalTimeRecorded, true);
  assert.equal(summary.checks.layoutFingerprintStable, true);
  assert.equal(summary.verified, true);

  const corrupted = JSON.parse(JSON.stringify(summary));
  corrupted.checks.targetCountMatches = false;
  corrupted.remainingResources.rescueCords = -1;
  const validation = sim.validateSummary(corrupted, completed.world);
  assert.equal(validation.valid, false);
  assert.equal(validation.failures.length >= 2, true);
});
