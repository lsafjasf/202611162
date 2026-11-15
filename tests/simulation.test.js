import test from "node:test";
import assert from "node:assert/strict";
import { IceFerryGame } from "../src/simulation.js";
import { createScenario, verifyLayout } from "../src/scenario.js";
import {
  loadLatestSummary,
  loadSummaryHistory,
  saveRunSummary,
} from "../src/summary-store.js";
import { driveToCompletion } from "./autopilot.js";

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, value);
  }
}

test("same fixed seed reproduces mission, map and obstacle positions", () => {
  const first = createScenario("20261116");
  const second = createScenario("20261116");
  const other = createScenario("20261117");
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.layout, second.layout);
  assert.deepEqual(first.mission, second.mission);
  assert.notEqual(first.hash, other.hash);
  assert.equal(first.mission.rounds, 3);
  assert.equal(first.mission.targetCrew, 6);
  assert.equal(first.mission.targetDockings, 6);

  const gameA = new IceFerryGame("20261116");
  const gameB = new IceFerryGame("20261116");
  assert.deepEqual(
    gameA.state.iceFloes.map(({ id, x, y, radius }) => ({ id, x, y, radius })),
    gameB.state.iceFloes.map(({ id, x, y, radius }) => ({ id, x, y, radius })),
  );
  assert.deepEqual(gameA.state.anchors, gameB.state.anchors);
  assert.equal(verifyLayout("20261116").same, true);
});

test("fixed-step inputs and collisions produce identical key positions", () => {
  const inputs = { thrust: true, right: true, reverse: false, left: false, reel: false, pay: false };
  const run = () => {
    const game = new IceFerryGame("20261116");
    for (let i = 0; i < 480; i += 1) {
      game.step(i % 180 < 130 ? inputs : { thrust: true, left: true });
    }
    return game;
  };
  const first = run();
  const second = run();
  assert.equal(first.state.ferry.x, second.state.ferry.x);
  assert.equal(first.state.ferry.y, second.state.ferry.y);
  assert.equal(first.state.ferry.heading, second.state.ferry.heading);
  assert.deepEqual(
    first.state.iceFloes.map((floe) => [floe.id, floe.x, floe.y, floe.rotation]),
    second.state.iceFloes.map((floe) => [floe.id, floe.x, floe.y, floe.rotation]),
  );
  assert.deepEqual(first.state.incidents, second.state.incidents);
  assert.ok(first.state.steps > 0);
  assert.ok(first.state.steps < 480);
});

test("a full run reaches all objectives and saves a verifiable summary", () => {
  const game = new IceFerryGame("20261116");
  const steps = driveToCompletion(game);
  const summary = game.state.summary;

  assert.equal(game.state.status, "won");
  assert.ok(steps > 5000);
  assert.equal(summary.objectiveMet, true);
  assert.deepEqual(summary.targets, { rounds: 3, dockings: 6, crew: 6 });
  assert.deepEqual(summary.achieved, { rounds: 3, dockings: 6, crew: 6 });
  assert.equal(summary.remainingResources.fuel, 74.91);
  assert.equal(summary.remainingResources.hull, 62.84);
  assert.equal(summary.remainingResources.cable, 100);
  assert.equal(summary.finalElapsedSeconds, 180.2);
  assert.equal(summary.finalElapsedLabel, "03:00.2");
  assert.ok(summary.path.length > 100);
  assert.ok(summary.pathLength > 5000);
  assert.ok(summary.failureReasons.some((item) => item.reason === "浮冰撞击"));

  const storage = new MemoryStorage();
  saveRunSummary(storage, summary, "2026-11-16T00:00:00.000Z");
  const saved = loadLatestSummary(storage);
  assert.equal(saved.seed, game.seed);
  assert.deepEqual(saved.targets, summary.targets);
  assert.deepEqual(saved.achieved, summary.achieved);
  assert.equal(saved.finalElapsedSeconds, 180.2);
  assert.equal(saved.remainingResources.fuel, 74.91);
  assert.equal(saved.remainingResources.hull, 62.84);
  assert.equal(loadSummaryHistory(storage).length, 1);
});

test("repeating the fixed run reproduces positions, result and final time", () => {
  const first = new IceFerryGame("20261116");
  const second = new IceFerryGame("20261116");
  driveToCompletion(first);
  driveToCompletion(second);
  assert.equal(first.state.status, second.state.status);
  assert.equal(first.state.elapsed, second.state.elapsed);
  assert.deepEqual(first.state.summary.achieved, second.state.summary.achieved);
  assert.deepEqual(first.state.summary, second.state.summary);
  assert.deepEqual(first.state.iceFloes, second.state.iceFloes);
});

test("pause freezes time and position until resumed", () => {
  const game = new IceFerryGame("20261116");
  for (let i = 0; i < 30; i += 1) game.step({ thrust: true });
  const elapsed = game.state.elapsed;
  const x = game.state.ferry.x;
  game.togglePause(true);
  for (let i = 0; i < 120; i += 1) game.step({ thrust: true });
  assert.equal(game.state.elapsed, elapsed);
  assert.equal(game.state.ferry.x, x);
  game.togglePause(false);
  game.step({ thrust: true });
  assert.ok(game.state.elapsed > elapsed);
});

test("cable input visibly changes length, tension and durability", () => {
  const game = new IceFerryGame("20261116");
  assert.equal(game.toggleCable(), true);
  assert.equal(game.state.cable.attached, true);
  const initialLength = game.state.cable.length;
  for (let i = 0; i < 90; i += 1) game.step({ reel: true });
  assert.ok(game.state.cable.length < initialLength);
  assert.ok(game.state.cable.tension > 0);
  assert.ok(game.state.resources.cable < 100);
  assert.match(game.state.cable.action, /收缆|已系/);
});

test("overload reduces maneuver and acceleration", () => {
  const normal = new IceFerryGame("20261116");
  const heavy = new IceFerryGame("20261116");
  normal.state.iceFloes = [];
  heavy.state.iceFloes = [];
  normal.state.ferry.iceLoad = 0;
  heavy.state.ferry.iceLoad = 3.6;
  assert.equal(normal.overloaded, false);
  assert.equal(heavy.overloaded, true);
  assert.ok(heavy.maneuverFactor < normal.maneuverFactor);
  for (let i = 0; i < 60; i += 1) {
    normal.step({ thrust: true });
    heavy.step({ thrust: true });
  }
  assert.ok(normal.speed > heavy.speed);
});

test("grounding and fatal collision can recover from the in-memory checkpoint", () => {
  const grounding = new IceFerryGame("20261116");
  const startCheckpoint = grounding.checkpoint.state;
  grounding.state.ferry.x = 1035;
  grounding.state.ferry.y = 520;
  grounding.state.ferry.atDock = false;
  grounding.step();
  assert.equal(grounding.state.status, "failed");
  assert.match(grounding.state.failureReason, /搁浅/);
  assert.equal(grounding.recoverCheckpoint(), true);
  assert.equal(grounding.state.status, "running");
  assert.equal(grounding.state.ferry.x, startCheckpoint.ferry.x);
  assert.equal(grounding.state.ferry.y, startCheckpoint.ferry.y);

  const collision = new IceFerryGame("20261116");
  const floe = collision.state.iceFloes[0];
  collision.state.ferry.x = floe.x - 20;
  collision.state.ferry.y = floe.y;
  collision.state.ferry.vx = 80;
  collision.state.ferry.vy = 0;
  collision.state.ferry.atDock = false;
  collision.state.resources.hull = 1;
  collision.step();
  assert.equal(collision.state.status, "failed");
  assert.equal(collision.recoverCheckpoint(), true);
  assert.equal(collision.state.status, "running");
  assert.ok(collision.state.incidents.length < 10);
});

test("failure demo reports its cause and restores the prior checkpoint", () => {
  const game = new IceFerryGame("20261116");
  for (let i = 0; i < 60; i += 1) game.step({ thrust: true });
  const checkpointLabel = game.checkpoint.label;
  game.startFailureDemo();
  game.step();
  assert.equal(game.state.status, "failed");
  assert.equal(game.state.failureReason, "舷侧损伤");
  assert.match(game.state.failureSummary.finalFailureReason, /舷侧损伤/);
  assert.equal(game.recoverCheckpoint(), true);
  assert.equal(game.state.status, "running");
  assert.equal(game.state.checkpointLabel, checkpointLabel);
  assert.equal(game.state.failureReason, null);
});
