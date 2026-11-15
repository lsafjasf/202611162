import test from "node:test";
import assert from "node:assert/strict";
import {
  GreenhouseSim,
  SCENARIOS,
  STEP_SECONDS,
  MINUTES_PER_SECOND,
} from "../js/sim.js";

function runToEnd(sim, limit = 200000) {
  let guard = 0;
  while (!sim.ended && guard < limit) {
    sim.advance(0.1, 1);
    guard += 1;
  }
  return sim;
}

function buildScenario(key) {
  const config = SCENARIOS[key];
  const sim = new GreenhouseSim(config.seed, { scenario: key });
  Object.entries(config.controls).forEach(([control, value]) => {
    sim.setControl(control, value, { record: true });
  });
  config.script.forEach((action) => {
    sim.actions.push({
      at: action.at,
      kind: action.kind,
      payload: { ...action.payload },
    });
  });
  sim.queueScript(config.script);
  return sim;
}

function eventSignature(sim) {
  return sim.events.map((event) => [
    event.at,
    event.kind,
    event.title,
    event.detail,
  ]);
}

function summary(sim) {
  const metrics = sim.metrics();
  return {
    seed: sim.seed,
    success: Boolean(sim.result?.success),
    at: metrics.clock,
    health: metrics.health,
    population: metrics.population,
    pollen: metrics.pollen,
    budget: metrics.budget,
    fruits: metrics.fruits,
    temperature: metrics.temperature,
    recoveries: sim.recoveries.length,
    hash: sim.sequenceHash(),
  };
}

test("steady baseline completes with three fruits and a healthy colony", () => {
  const sim = runToEnd(new GreenhouseSim(SCENARIOS.steady.seed));
  const metrics = sim.metrics();
  assert.equal(sim.result.success, true);
  assert.equal(metrics.fruits, 3);
  assert.ok(metrics.health >= 60);
  assert.ok(metrics.population >= 24);
  assert.equal(sim.thresholds.highHeat, undefined);
  console.log("STEADY", summary(sim));
});

test("critical heat crosses 31 C and recovery B restores the run", () => {
  const sim = runToEnd(buildScenario("critical"));
  assert.equal(sim.thresholds.highHeat, true);
  assert.ok(sim.events.some((event) => event.detail.includes("> 31°C")));
  assert.equal(sim.recoveries.length, 1);
  assert.equal(sim.recoveries[0].strategy, "ecology");
  assert.ok(sim.recoveries[0].after);
  assert.equal(sim.result.success, true);
  assert.equal(sim.metrics().fruits, 3);
  console.log("CRITICAL", summary(sim), sim.recoveries[0].after);
});

test("overdose failure reduces the colony and leaves pollination incomplete", () => {
  const sim = runToEnd(buildScenario("failure"));
  assert.equal(sim.result.success, false);
  assert.ok(sim.metrics().population < 24);
  const sprays = sim.events.filter(
    (event) => event.kind === "operation" && event.title.includes("超量喷药"),
  );
  assert.equal(sprays.length, 2);
  assert.ok(sim.metrics().fruits < 3);
  console.log("FAILURE", summary(sim));
});

test("both recovery strategies record trigger, cost and final ecological metrics", () => {
  const results = {};
  for (const strategy of ["boost", "ecology"]) {
    const sim = new GreenhouseSim("20261117", {
      controls: { releaseHour: 7, thermostat: 32, shade: 15, fan: 1 },
      script: [{ at: 610, kind: "recovery", payload: { strategy } }],
    });
    runToEnd(sim);
    assert.equal(sim.recoveries.length, 1);
    const recovery = sim.recoveries[0];
    assert.ok(recovery.trigger.includes("31°C"));
    assert.equal(recovery.cost, strategy === "boost" ? 52 : 18);
    assert.ok(recovery.after);
    results[strategy] = {
      cost: recovery.cost,
      trigger: recovery.trigger,
      after: recovery.after,
      final: summary(sim),
    };
  }
  assert.equal(results.boost.cost, 52);
  assert.equal(results.ecology.cost, 18);
  console.log("RECOVERY COMPARE", results);
});

test("same seed reproduces target, weather, resources and key events", () => {
  const first = runToEnd(new GreenhouseSim("seed-verify-77"));
  const second = runToEnd(new GreenhouseSim("seed-verify-77"));
  assert.deepEqual(first.trackedBee, second.trackedBee);
  assert.deepEqual(first.initialResources, second.initialResources);
  assert.deepEqual(
    first.weather.map((point) => [point.hour, point.outside, point.cloud, point.wind]),
    second.weather.map((point) => [point.hour, point.outside, point.cloud, point.wind]),
  );
  assert.deepEqual(eventSignature(first), eventSignature(second));
  assert.equal(first.sequenceHash(), second.sequenceHash());
  console.log("REPRODUCE", {
    target: first.trackedBee,
    resources: first.initialResources,
    weather: first.weather.map((point) => point.label),
    hash: first.sequenceHash(),
  });
});

test("fixed action sequence replays with identical event order", () => {
  const source = new GreenhouseSim("sequence-421");
  source.setControl("thermostat", 25, { record: true });
  source.setControl("shade", 38, { record: true });
  while (source.minutes < 8 * 60) source.advance(0.1, 1);
  source.perform("feed");
  while (source.minutes < 10 * 60) source.advance(0.1, 1);
  source.perform("spray", { dose: 1 });
  while (source.minutes < 11 * 60) source.advance(0.1, 1);
  source.perform("vent");
  runToEnd(source);

  const replay = new GreenhouseSim("sequence-421");
  replay.loadReplay("sequence-421", source.actions);
  runToEnd(replay);

  assert.deepEqual(eventSignature(source), eventSignature(replay));
  assert.equal(source.sequenceHash(), replay.sequenceHash());
  assert.equal(source.result.success, replay.result.success);
  console.log("REPLAY", {
    actions: source.actions.length,
    events: source.events.length,
    hash: source.sequenceHash(),
    result: replay.result.success,
  });
});

test("fixed simulation step is independent of render cadence", () => {
  const fast = new GreenhouseSim("cadence-9");
  const slow = new GreenhouseSim("cadence-9");
  for (let index = 0; index < 1200; index += 1) fast.advance(STEP_SECONDS, 1);
  for (let index = 0; index < 400; index += 1) {
    slow.advance(0.1, 1);
  }
  const minutesFromSteps = 1200 * STEP_SECONDS * MINUTES_PER_SECOND;
  assert.ok(Math.abs(fast.minutes - (360 + minutesFromSteps)) < 0.01);
  assert.ok(Math.abs(fast.minutes - slow.minutes) < 0.01);
  assert.equal(fast.temperature.toFixed(5), slow.temperature.toFixed(5));
});
