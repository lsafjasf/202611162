import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SEED,
  buildStateSummary,
  createGame,
  depart,
  dock,
  generateWorld,
  loadCargo,
  pointInEllipse,
  recoverFromCheckpoint,
  setRouteOrder,
  updateGame,
} from "../src/core.js";

function loadedVoyage(seed = DEFAULT_SEED) {
  const game = createGame(seed);
  loadCargo(game, "all");
  depart(game);
  return game;
}

function placeAtDock(game, id) {
  const island = game.world.islands.find((item) => item.id === id);
  game.ship.x = island.dock.x;
  game.ship.y = island.dock.y;
  game.ship.speed = 0;
}

function placeAtHome(game) {
  game.ship.x = game.world.home.dock.x;
  game.ship.y = game.world.home.dock.y;
  game.ship.speed = 0;
}

test("fixed seed generates identical map, tasks and obstacles", () => {
  const first = generateWorld(DEFAULT_SEED);
  const second = generateWorld(DEFAULT_SEED);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.islands, second.islands);
  assert.deepEqual(first.shoals, second.shoals);
  assert.deepEqual(first.driftwood, second.driftwood);
  assert.deepEqual(first.mission, second.mission);
  assert.equal(first.islands.length, 2);
  assert.equal(first.driftwood.length, 9);
  assert.ok(first.shoals.length >= 4);
});

test("different seeds produce a different layout", () => {
  assert.notEqual(generateWorld(DEFAULT_SEED).fingerprint, generateWorld(42).fingerprint);
});

test("generated shoals leave every dock approach navigable", () => {
  const world = generateWorld(DEFAULT_SEED);
  const docks = [world.home.dock, ...world.islands.map((island) => island.dock)];
  for (const shoal of world.shoals) {
    for (const dock of docks) {
      assert.equal(pointInEllipse(dock, shoal), false, `${dock.x},${dock.y} inside ${shoal.id}`);
    }
  }
});

test("new game compares against the previous layout fingerprint", () => {
  const first = createGame(DEFAULT_SEED);
  const second = createGame(DEFAULT_SEED, { previousFingerprint: first.world.fingerprint });
  assert.equal(second.layoutAudit.matched, true);
  assert.equal(second.world.fingerprint, first.world.fingerprint);
});

test("loading is segregated and preserves the resource balance", () => {
  const game = createGame(DEFAULT_SEED);
  loadCargo(game, "fuel");
  assert.deepEqual(game.cargo, { fuel: 1, battery: 0 });
  loadCargo(game, "battery");
  loadCargo(game, "all");
  assert.deepEqual(game.cargo, { fuel: 2, battery: 2 });
  assert.deepEqual(game.resources, { fuel: 0, battery: 0 });
  const summary = buildStateSummary(game);
  assert.equal(summary.resources.balance.ok, true);
  assert.equal(summary.resources.remaining.fuel, 2);
  assert.equal(summary.resources.remaining.battery, 2);
});

test("both lighthouses plus a home return produce a validated success summary", () => {
  const game = loadedVoyage();
  placeAtDock(game, "north");
  const firstDock = dock(game);
  assert.equal(firstDock.ok, true);
  assert.equal(game.delivered.north, true);
  assert.deepEqual(game.cargo, { fuel: 1, battery: 1 });
  placeAtDock(game, "east");
  const secondDock = dock(game);
  assert.equal(secondDock.ok, true);
  assert.equal(game.delivered.east, true);
  assert.equal(game.nextStop, null);
  placeAtHome(game);
  const finish = dock(game);
  assert.equal(finish.ok, true);
  assert.equal(game.status, "won");

  const summary = game.summary;
  assert.equal(summary.status, "success");
  assert.equal(summary.objective.expectedTargets, 2);
  assert.equal(summary.objective.completedTargets, 2);
  assert.deepEqual(summary.resources.remaining, { fuel: 0, battery: 0 });
  assert.equal(summary.validation.objectiveCountOk, true);
  assert.equal(summary.validation.resourceBalanceOk, true);
  assert.equal(summary.validation.timeRecorded, true);
  assert.equal(summary.validation.successRequiresReturn, true);
  assert.ok(summary.route.sailedPath.length >= 1);
});

test("docking at the wrong lighthouse does not count as progress", () => {
  const game = loadedVoyage();
  placeAtDock(game, "east");
  const result = dock(game);
  assert.equal(result.ok, false);
  assert.equal(game.delivered.east, false);
  assert.equal(game.nextStop, "north");
});

test("east-first route can also complete both objectives and return home", () => {
  const game = createGame(DEFAULT_SEED);
  setRouteOrder(game, "east-first");
  loadCargo(game, "all");
  depart(game);
  placeAtDock(game, "east");
  assert.equal(dock(game).ok, true);
  assert.equal(game.delivered.east, true);
  assert.equal(game.nextStop, "north");
  placeAtDock(game, "north");
  assert.equal(dock(game).ok, true);
  assert.equal(game.delivered.north, true);
  placeAtHome(game);
  assert.equal(dock(game).ok, true);
  assert.equal(game.status, "won");
  assert.deepEqual(game.summary.resources.remaining, { fuel: 0, battery: 0 });
});

test("driftwood collision records a failure and recovers from checkpoint", () => {
  const game = loadedVoyage();
  const checkpoint = JSON.parse(JSON.stringify(game.checkpoint));
  const log = game.world.driftwood[0];
  game.ship.x = log.x;
  game.ship.y = log.y;
  updateGame(game, 0.016, { throttle: 0, steering: 0 });
  assert.equal(game.status, "failed");
  assert.equal(game.failure.reason, "driftwood");
  assert.equal(game.summary.status, "failed");
  assert.match(game.failure.title, /漂木/);

  const result = recoverFromCheckpoint(game);
  assert.equal(result.ok, true);
  assert.equal(game.status, "sailing");
  assert.equal(game.recoveries, 1);
  assert.deepEqual(game.cargo, checkpoint.cargo);
  assert.deepEqual(game.delivered, checkpoint.delivered);
  assert.equal(game.elapsed, checkpoint.elapsed);
  assert.equal(game.failure, null);
});

test("low tide failure is recoverable without replacing game state", () => {
  const game = loadedVoyage();
  game.elapsed = 119.99;
  updateGame(game, 0.05, { throttle: 1, steering: 0 });
  assert.equal(game.status, "failed");
  assert.equal(game.failure.reason, "tide");
  recoverFromCheckpoint(game);
  assert.equal(game.status, "sailing");
  assert.ok(game.elapsed < 119.99);
});

test("island grounding is reported and recoverable from the last checkpoint", () => {
  const game = loadedVoyage();
  const island = game.world.islands[0];
  game.ship.x = island.x;
  game.ship.y = island.y;
  updateGame(game, 0.016, { throttle: 0, steering: 0 });
  assert.equal(game.status, "failed");
  assert.equal(game.failure.reason, "grounding");
  assert.match(game.failure.title, /搁浅/);
  assert.equal(game.summary.failureHistory.length, 1);
  recoverFromCheckpoint(game);
  assert.equal(game.status, "sailing");
  assert.equal(game.recoveries, 1);
  assert.equal(game.failure, null);
});
