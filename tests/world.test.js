import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEED,
  createWorld,
  worldFingerprint,
  worldsMatch,
} from "../src/world.js";
import {
  buildRunSummary,
  createInitialState,
  dockReached,
  findObstacleHit,
  findShallowHit,
  isWithinDockDockSpeed,
  makeCheckpoint,
  restoreCheckpoint,
  tideAt,
} from "../src/model.js";

test("same seed reproduces map, mission and obstacles", () => {
  const first = createWorld(DEFAULT_SEED);
  const second = createWorld(DEFAULT_SEED);
  assert.equal(worldsMatch(first, second), true);
  assert.equal(worldFingerprint(first), worldFingerprint(second));
  assert.deepEqual(
    first.groups.map((group) => [group.id, group.x, group.y]),
    second.groups.map((group) => [group.id, group.x, group.y]),
  );
  assert.deepEqual(first.pontoons, second.pontoons);
  assert.deepEqual(first.nets, second.nets);
  assert.deepEqual(first.shallows, second.shallows);
});

test("another new run keeps the fixed layout but a different seed changes it", () => {
  const first = createWorld(DEFAULT_SEED);
  const anotherRun = createWorld(DEFAULT_SEED);
  const differentSeed = createWorld(DEFAULT_SEED + 1);
  assert.equal(worldsMatch(first, anotherRun), true);
  assert.equal(worldFingerprint(first), worldFingerprint(anotherRun));
  assert.equal(worldsMatch(first, differentSeed), false);
  assert.notEqual(worldFingerprint(first), worldFingerprint(differentSeed));
});

test("world always contains three ordered buoy groups", () => {
  const world = createWorld(DEFAULT_SEED);
  assert.equal(world.groups.length, 3);
  assert.deepEqual(
    world.groups.map((group) => group.label),
    ["01", "02", "03"],
  );
  assert.equal(world.mission.targetCount, 3);
  assert.ok(world.mission.timeLimit > 0);
  assert.ok(world.pontoons.length >= 2);
  assert.ok(world.nets.length >= 2);
});

test("checkpoint recovery rolls back position, target and resources", () => {
  const world = createWorld(DEFAULT_SEED);
  const state = createInitialState(world);
  state.mode = "playing";
  state.elapsed = 24;
  state.fuel = 72;
  state.loaded = 1;
  state.visited = [1];
  state.nextTarget = 2;
  state.boat.x = 480;
  state.boat.y = 260;
  const checkpoint = makeCheckpoint(state, "浮标 01");

  state.elapsed = 61;
  state.fuel = 31;
  state.hull = 64;
  state.boat.x = 900;
  state.boat.y = 610;
  state.incidents.push({
    kind: "grounding",
    detail: "船底进入退潮浅滩并搁浅",
    time: 61,
    x: 900,
    y: 610,
  });
  state.incident = state.incidents[0];
  state.mode = "incident";

  const restored = restoreCheckpoint(state, checkpoint);
  assert.equal(restored.mode, "playing");
  assert.equal(restored.elapsed, 24);
  assert.equal(restored.fuel, 72);
  assert.equal(restored.loaded, 1);
  assert.equal(restored.nextTarget, 2);
  assert.equal(restored.boat.x, 480);
  assert.equal(restored.boat.y, 260);
  assert.equal(restored.incidents.length, 1);
  assert.equal(restored.incident, null);
});

test("run summary records target count, remaining resources and final time", () => {
  const world = createWorld(DEFAULT_SEED);
  const state = createInitialState(world);
  state.mode = "complete";
  state.elapsed = 87.35;
  state.loaded = 3;
  state.visited = [1, 2, 3];
  state.nextTarget = 4;
  state.fuel = 46.2;
  state.hull = 85;
  state.totalFuelUsed = 53.8;
  state.totalHullLost = 15;
  state.path = [
    { x: 292, y: 372 },
    { x: 790, y: 142 },
    { x: 1060, y: 482 },
    { x: 512, y: 596 },
    { x: 260, y: 376 },
  ];
  state.checkpoints = [{ label: "码头" }, { label: "浮标 01" }];
  const summary = buildRunSummary({
    world,
    state,
    outcome: "success",
    reason: null,
    endedAt: "2026-11-16T00:00:00.000Z",
    layoutCheck: { compared: true, sameLayout: true, message: "布局指纹一致" },
  });

  assert.equal(summary.objectives.checked, 3);
  assert.equal(summary.objectives.targetCount, 3);
  assert.equal(summary.objectives.complete, true);
  assert.equal(summary.objectives.returnedToDock, true);
  assert.equal(summary.resources.fuelRemaining, 46.2);
  assert.equal(summary.resources.hullRemaining, 85);
  assert.equal(summary.timing.finalTimeSeconds, 87.35);
  assert.equal(summary.path.length, 5);
  assert.equal(summary.failure, null);
  assert.equal(summary.layoutValidation.sameLayout, true);
  assert.equal(summary.loadPenalty.active, true);
  assert.equal(summary.seed, DEFAULT_SEED);
});

test("failure summary contains a concrete reason and incident location", () => {
  const world = createWorld(DEFAULT_SEED);
  const state = createInitialState(world);
  state.mode = "failed";
  state.elapsed = 150;
  state.fuel = 18;
  state.loaded = 2;
  state.incidents = [
    {
      kind: "collision",
      detail: "船体与渔网发生碰撞",
      time: 54.2,
      x: 610,
      y: 470,
    },
  ];
  const summary = buildRunSummary({
    world,
    state,
    outcome: "failure",
    reason: "潮窗关闭：未能在 150 秒内完成检查并返航",
    endedAt: "2026-11-16T00:00:00.000Z",
  });
  assert.equal(summary.success, false);
  assert.match(summary.failure.reason, /潮窗关闭/);
  assert.equal(summary.objectives.checked, 2);
  assert.equal(summary.timing.finalTimeSeconds, 150);
  assert.deepEqual(
    { kind: summary.incidents[0].kind, x: summary.incidents[0].x, y: summary.incidents[0].y },
    { kind: "collision", x: 610, y: 470 },
  );
});

test("generated pontoons and nets are solid collision obstacles", () => {
  const world = createWorld(DEFAULT_SEED);
  const pontoon = world.pontoons[0];
  const net = world.nets[0];
  const pontoonBoat = {
    x: (pontoon.x1 + pontoon.x2) / 2,
    y: (pontoon.y1 + pontoon.y2) / 2,
  };
  const netBoat = {
    x: (net.x1 + net.x2) / 2,
    y: (net.y1 + net.y2) / 2,
  };
  assert.equal(findObstacleHit(world, pontoonBoat)?.kind, "pontoon");
  assert.equal(findObstacleHit(world, netBoat)?.kind, "net");
});

test("fixed seed also fixes tide, grounding and docking conditions", () => {
  const first = createWorld(DEFAULT_SEED);
  const second = createWorld(DEFAULT_SEED);
  assert.deepEqual(tideAt(first, 60), tideAt(second, 60));
  assert.deepEqual(first.dock, second.dock);
  assert.deepEqual(first.mission, second.mission);

  const state = createInitialState(first);
  const shallow = first.shallows[0];
  state.elapsed = 60;
  state.boat.x = shallow.x;
  state.boat.y = shallow.y;
  assert.equal(findShallowHit(first, state)?.id, shallow.id);

  state.boat.x = first.dock.x + first.dock.width + 10;
  state.boat.y = first.dock.y + first.dock.height / 2;
  state.boat.vx = 20;
  state.boat.vy = 0;
  assert.equal(dockReached(first, state.boat), true);
  assert.equal(isWithinDockDockSpeed(state.boat), true);
});
