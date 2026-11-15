"use strict";

const fs = require("node:fs");
const path = require("node:path");
const sim = require("../src/simulation.js");

function walkRide(world, run, options) {
  const ride = sim.beginRide(world, run, options.routeId, options.weightKg);
  while (ride.state === "riding") {
    sim.stepRide(
      world,
      ride,
      { braking: ride.progress >= options.brakeFrom },
      1 / 120,
    );
    run.elapsedSec += 1 / 120;
  }
  return ride;
}

function completeRun(seed) {
  const world = sim.createWorld(seed);
  const run = sim.createRun(world);
  while (run.toolsRemaining > 0) {
    const ride = walkRide(world, run, {
      routeId: "north",
      weightKg: 12,
      brakeFrom: 0.34,
    });
    sim.settleRide(world, run, ride);
  }
  return { world: world, run: run };
}

const first = completeRun("CANOPY-653");
const second = completeRun("CANOPY-653");
const summary = sim.createStateSummary(first.world, first.run, {
  status: "complete",
  finalTimeSec: first.run.elapsedSec,
});
summary.validation = sim.validateSummary(summary, first.world);

const output = {
  verificationVersion: 1,
  seed: first.world.seed,
  layoutFingerprint: first.world.fingerprint,
  layoutRepeat: sim.compareWorlds(first.world, second.world),
  repeatability: {
    firstTimeSec: sim.round(first.run.elapsedSec, 1),
    secondTimeSec: sim.round(second.run.elapsedSec, 1),
    sameTime: sim.round(first.run.elapsedSec, 1) === sim.round(second.run.elapsedSec, 1),
    samePath:
      JSON.stringify(first.run.deliveries) === JSON.stringify(second.run.deliveries),
    sameOutcome:
      first.run.toolsRemaining === second.run.toolsRemaining &&
      first.run.crashes === second.run.crashes &&
      first.run.strands === second.run.strands,
  },
  stateSummary: summary,
};

const target = path.join(__dirname, "..", "artifacts", "verification-state-summary.json");
fs.writeFileSync(target, JSON.stringify(output, null, 2) + "\n");

console.log("Verification summary written to " + target);
console.log(
  "targets=" +
    summary.deliveredCount +
    "/" +
    summary.targetCount +
    " resources=" +
    JSON.stringify(summary.remainingResources) +
    " time=" +
    summary.finalTime +
    " verified=" +
    summary.verified,
);
