import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TOTAL_DAYS,
  advance,
  advanceBenchmark,
  createMission,
  createSimulation,
  ecologyMetrics,
  performAction,
  runValidationSuite,
  snapshot,
  weatherAt,
} from "../src/sim.js";

test("same seed reproduces mission, target, resources and weather", () => {
  const first = createMission("677");
  const second = createMission("677");
  assert.deepEqual(first.hotspots, second.hotspots);
  assert.deepEqual(first.keyEvents, second.keyEvents);
  assert.deepEqual(first.initialResources, second.initialResources);
  assert.deepEqual(first.weather, second.weather);
  assert.equal(first.sentinel.id, second.sentinel.id);
  assert.equal(first.fingerprint, second.fingerprint);

  const firstState = createSimulation("677");
  const secondState = createSimulation("677");
  advance(firstState, 37.5);
  advance(secondState, 37.5);
  assert.deepEqual(snapshot(firstState), snapshot(secondState));
  assert.deepEqual(firstState.firedEvents, secondState.firedEvents);
});

test("weather evolves continuously without frame-level randomness", () => {
  const mission = createMission("677");
  let previous = weatherAt(mission, 0);
  let maxTemperatureJump = 0;
  let maxWindJump = 0;
  for (let day = 0.001; day <= TOTAL_DAYS; day += 0.001) {
    const current = weatherAt(mission, day);
    maxTemperatureJump = Math.max(maxTemperatureJump, Math.abs(current.temperature - previous.temperature));
    maxWindJump = Math.max(maxWindJump, Math.abs(current.wind - previous.wind));
    previous = current;
  }
  assert.ok(maxTemperatureJump < 0.05, `temperature jumped ${maxTemperatureJump}`);
  assert.ok(maxWindJump < 0.004, `wind jumped ${maxWindJump}`);
  const source = readFileSync(new URL("../src/sim.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  const renderSource = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.doesNotMatch(renderSource, /Math\.random/);
});

test("idle run fails and the fixed benchmark sequence succeeds", () => {
  const idle = createSimulation("677");
  advance(idle, TOTAL_DAYS);
  assert.equal(idle.outcome, "failure");
  assert.ok(idle.pipeDisplacement > 18);

  const benchmark = createSimulation("677");
  advanceBenchmark(benchmark, TOTAL_DAYS);
  assert.equal(benchmark.outcome, "success");
  assert.ok(benchmark.pipeDisplacement <= 18);
  assert.ok(benchmark.stationTemp <= -1.5 && benchmark.stationTemp >= -8);
  assert.equal(benchmark.sequenceIndex, 9);
  assert.ok(benchmark.probes.length === 3);
});

test("validation records steady, critical and failed operations with before/after data", () => {
  const suite = runValidationSuite("677");
  for (const key of ["steady", "critical", "failure"]) {
    const record = suite[key];
    assert.ok(record.before.day >= 0);
    assert.ok(record.after.day > record.before.day);
    assert.equal(typeof record.before.resources.power, "number");
    assert.equal(typeof record.after.resources.power, "number");
    assert.equal(typeof record.before.ecology, "number");
    assert.equal(typeof record.after.ecology, "number");
    assert.ok(record.finalEcology.lichen >= 0);
    assert.ok(record.trigger.length > 0);
  }
  assert.equal(suite.failure.operation.ok, false);
  assert.match(suite.failure.operation.reason, /资源不足/);
});

test("two recovery strategies have distinct cost and final ecology", () => {
  const suite = runValidationSuite("677");
  const rapid = suite.strategies.rapid;
  const staged = suite.strategies.staged;
  assert.ok(rapid.powerUsed > staged.powerUsed);
  assert.ok(rapid.crewUsed > staged.crewUsed);
  assert.ok(rapid.elapsed < staged.elapsed);
  assert.notEqual(rapid.finalEcology.ecology, staged.finalEcology.ecology);
  for (const strategy of [rapid, staged]) {
    assert.equal(typeof strategy.finalEcology.vegetation, "number");
    assert.equal(typeof strategy.finalEcology.sentinelHealth, "number");
  }
});

test("operations compare resources before and after and enforce costs", () => {
  const state = createSimulation("677");
  advance(state, 6);
  const target = state.mission.hotspots[0];
  const probe = performAction(state, "probe", { point: target });
  assert.equal(probe.ok, true);
  assert.equal(probe.after.resources.probes, probe.before.resources.probes - 1);
  assert.ok(probe.after.resources.power < probe.before.resources.power);
  assert.ok(state.probeCoverage > 0);

  state.resources.power = 1;
  const failed = performAction(state, "cooling");
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /电力不足|资源不足/);
  assert.equal(state.lastOp, failed);
});

test("ecology metrics remain bounded through a complete idle run", () => {
  const state = createSimulation("677");
  advance(state, TOTAL_DAYS);
  const metrics = ecologyMetrics(state);
  for (const value of Object.values(metrics)) {
    assert.ok(value >= 0 && value <= 100);
  }
});
