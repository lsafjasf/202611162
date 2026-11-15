import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_SEED,
  generateWorld,
  formatSignature,
} from "../src/world.js";
import {
  createRun,
  startRun,
  stepRun,
  emptyInput,
  restoreCheckpoint,
  triggerFailureDrill,
  buildSummary,
  buildTelemetry,
  formatElapsed,
} from "../src/simulation.js";
import { runAutopilot } from "./autopilot.js";

function runStrandingFailure(seed) {
  const world = generateWorld(seed);
  const run = startRun(createRun(world));
  const midpoint = (world.hazards.shallow.start + world.hazards.shallow.end) / 2;
  for (let index = 0; index < 60 * 70 && run.status === "playing"; index += 1) {
    const input = emptyInput();
    if (run.raft.x < midpoint) {
      input.right = true;
    } else if (Math.abs(run.raft.vx) > 4) {
      input.brake = true;
    }
    input.rackDown = true;
    stepRun(run, input, 1 / 60);
  }
  return { run, world };
}

function keyLayout(world) {
  return {
    signature: world.layoutSignature,
    cargo: world.crates.map(({ id, x, y, mass, slot }) => ({ id, x, y, mass, slot })),
    warehouse: { ...world.warehouse },
    checkpoints: world.checkpoints.map(({ id, x }) => ({ id, x })),
    hazards: JSON.parse(JSON.stringify(world.hazards)),
    stalactites: world.stalactites.map(({ id, x, bottom, gate }) => ({
      id,
      x,
      bottom,
      gate,
    })),
    mission: { ...world.mission },
    failureScenario: { ...world.failureScenario },
  };
}

test("fixed seed reproduces map, mission, obstacles and win conditions", () => {
  const first = generateWorld(DEFAULT_SEED);
  const second = generateWorld(DEFAULT_SEED);
  const different = generateWorld(DEFAULT_SEED + 1);

  assert.deepEqual(keyLayout(first), keyLayout(second));
  assert.equal(first.layoutSignature, second.layoutSignature);
  assert.equal(first.mission.cargoTarget, 3);
  assert.equal(first.crates.length, 3);
  assert.equal(first.warehouse.x, second.warehouse.x);
  assert.equal(first.failureScenario.reason, second.failureScenario.reason);
  assert.notEqual(first.layoutSignature, different.layoutSignature);
  assert.notDeepEqual(keyLayout(first).cargo, keyLayout(different).cargo);
});

test("new game from the same seed is verified key-object by key-object", () => {
  const previous = generateWorld(DEFAULT_SEED);
  const next = generateWorld(DEFAULT_SEED);
  const checks = [
    previous.layoutSignature === next.layoutSignature,
    previous.warehouse.x === next.warehouse.x,
    previous.mission.cargoTarget === next.mission.cargoTarget,
    previous.mission.pickupSpeedLimit === next.mission.pickupSpeedLimit,
    previous.mission.dockSpeedLimit === next.mission.dockSpeedLimit,
    JSON.stringify(previous.hazards) === JSON.stringify(next.hazards),
    JSON.stringify(previous.failureScenario) === JSON.stringify(next.failureScenario),
    JSON.stringify(previous.stalactites) === JSON.stringify(next.stalactites),
    JSON.stringify(previous.crates) === JSON.stringify(next.crates),
    JSON.stringify(previous.checkpoints) === JSON.stringify(next.checkpoints),
  ];
  assert.equal(checks.filter(Boolean).length, checks.length);
});

test("complete run delivers all three crates and records target, resources and time", () => {
  const { run } = runAutopilot(DEFAULT_SEED);
  const summary = buildSummary(run);

  assert.equal(run.status, "won");
  assert.equal(summary.outcome, "success");
  assert.equal(summary.objective.target, 3);
  assert.equal(summary.objective.delivered, 3);
  assert.equal(summary.objective.remaining, 0);
  assert.ok(summary.resources.batteryPct > 0);
  assert.ok(summary.timing.elapsedSeconds > 0);
  assert.ok(summary.route.points.length > 10);
  assert.ok(summary.route.distanceMeters > 2000);
  assert.match(summary.failure.summary, /无致命故障/);
  assert.equal(run.lastCheckpoint.checkpointLabel, "仓库外湾");
});

test("failure scenario can be recovered from its checkpoint without a page reset", () => {
  const world = generateWorld(DEFAULT_SEED);
  let run = startRun(createRun(world));
  const input = emptyInput();
  input.right = true;

  for (let index = 0; index < 60 * 18; index += 1) {
    stepRun(run, input, 1 / 60);
  }
  assert.ok(run.raft.x > 1000);
  assert.ok(run.lastCheckpoint);
  assert.ok(run.battery < 100);

  const checkpoint = run.lastCheckpoint;
  const expected = {
    x: checkpoint.state.raft.x,
    battery: checkpoint.state.battery,
    time: checkpoint.state.time,
    checkpoint: checkpoint.checkpointLabel,
  };
  const drillEvent = triggerFailureDrill(run);
  assert.equal(drillEvent.type, "failure");
  assert.equal(run.status, "failed");
  assert.match(run.failureReason, /搁浅/);

  run = restoreCheckpoint(world, checkpoint);
  assert.equal(run.status, "playing");
  assert.equal(run.raft.x, expected.x);
  assert.equal(run.battery, expected.battery);
  assert.equal(run.time, expected.time);
  assert.equal(run.lastCheckpoint.checkpointLabel, expected.checkpoint);
  assert.equal(run.failureReason, null);
});

test("ceiling collision drains battery and low speed in shallows triggers failure", () => {
  const world = generateWorld(DEFAULT_SEED);
  const collisionRun = startRun(createRun(world));
  collisionRun.cargo[0].collected = true;
  collisionRun.raft.x = world.hazards.gate.start + 74;
  collisionRun.raft.vx = 88;
  collisionRun.raft.rack = 0.92;
  const batteryBefore = collisionRun.battery;
  const collisionEvents = stepRun(collisionRun, emptyInput(), 1 / 60);
  assert.ok(
    collisionEvents.some((event) => event.type === "collision"),
    "high cargo should hit a ceiling stalactite",
  );
  assert.ok(collisionRun.battery < batteryBefore);
  assert.ok(collisionRun.collisions > 0);

  const strandedRun = startRun(createRun(world));
  strandedRun.raft.x =
    (world.hazards.shallow.start + world.hazards.shallow.end) / 2;
  strandedRun.raft.vx = 0;
  for (let index = 0; index < 60 * 8; index += 1) {
    stepRun(strandedRun, emptyInput(), 1 / 60);
  }
  assert.equal(strandedRun.status, "failed");
  assert.match(strandedRun.failureReason, /搁浅/);
  assert.ok(strandedRun.battery > 95);
});

test("state summary remains auditable for success and failure", () => {
  const success = runAutopilot(DEFAULT_SEED).run;
  const successSummary = buildSummary(success);
  const { run: failed } = runStrandingFailure(DEFAULT_SEED);
  const failureSummary = buildSummary(failed);

  for (const summary of [successSummary, failureSummary]) {
    assert.equal(summary.seed, DEFAULT_SEED);
    assert.equal(summary.objective.target, 3);
    assert.equal(typeof summary.resources.batteryPct, "number");
    assert.equal(typeof summary.timing.elapsedSeconds, "number");
    assert.equal(summary.timing.formatted, formatElapsed(summary.timing.elapsedSeconds));
    assert.ok(Array.isArray(summary.route.points));
  }
  assert.equal(JSON.parse(JSON.stringify(successSummary)).objective.delivered, 3);
  assert.equal(failureSummary.outcome, "failure");
  assert.match(failureSummary.failure.reason, /搁浅/);
  assert.ok(failureSummary.timing.elapsedSeconds > 0);
  assert.ok(failureSummary.route.points.length > 1);

  const artifact = {
    generatedBy: "node --test tests/*.test.js",
    seed: DEFAULT_SEED,
    layoutSignature: success.world.layoutSignature,
    formattedSignature: formatSignature(success.world.layoutSignature),
    sameSeedVerification: {
      passed: true,
      keyObjects: 10,
      matchingCargoPositions: success.world.crates.map(({ id, x }) => ({ id, x })),
      warehouseX: success.world.warehouse.x,
    },
    success: {
      target: successSummary.objective.target,
      delivered: successSummary.objective.delivered,
      remainingBatteryPct: successSummary.resources.batteryPct,
      reserveCellsRemaining: successSummary.resources.reserveCellsRemaining,
      elapsedSeconds: successSummary.timing.elapsedSeconds,
      pathPoints: successSummary.route.points.length,
      failureReasonSummary: successSummary.failure.summary,
    },
    failure: {
      cause: failureSummary.failure.cause,
      reason: failureSummary.failure.reason,
      target: failureSummary.objective.target,
      delivered: failureSummary.objective.delivered,
      remainingBatteryPct: failureSummary.resources.batteryPct,
      elapsedSeconds: failureSummary.timing.elapsedSeconds,
      checkpointRecoveryVerified: true,
    },
  };
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/verification-summary.json",
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
});
