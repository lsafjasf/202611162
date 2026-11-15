import {
  FIXED_STEP,
  createRun,
  startRun,
  stepRun,
  emptyInput,
  buildTelemetry,
} from "../src/simulation.js";

function autopilotInput(run) {
  const input = emptyInput();
  const telemetry = buildTelemetry(run);
  const cargo = run.cargo.find((crate) => !crate.collected);

  if (cargo) {
    const distance = cargo.x - run.raft.x;
    const speed = Math.abs(run.raft.vx);
    if (Math.abs(distance) > 36) {
      if (speed > 72 && Math.abs(distance) < 120) {
        input.brake = true;
      } else if (distance > 0) {
        input.right = true;
      } else {
        input.left = true;
      }
      if (speed > 135) {
        input.brake = true;
      }
    } else if (speed > 16) {
      input.brake = true;
    }
  } else if (!telemetry.atDock) {
    if (telemetry.distanceToWarehouse > 85) {
      input.right = true;
    } else {
      input.brake = true;
    }
  } else {
    input.brake = true;
  }

  const inGate = run.raft.x > 1170 && run.raft.x < 1560;
  if ((inGate && run.raft.rack > 0.025) || telemetry.clearancePx < 38) {
    input.rackDown = true;
  } else if (!inGate && run.raft.x > 1560 && run.raft.rack < 0.35) {
    input.rackUp = true;
  }
  if (telemetry.centerOfMass > 6) {
    input.trimLeft = true;
  } else if (telemetry.centerOfMass < -6) {
    input.trimRight = true;
  }
  return input;
}

export function runAutopilot(seed, maxSeconds = 120) {
  const run = startRun(createRun(seed));
  const events = [];
  const steps = Math.round(maxSeconds / FIXED_STEP);
  for (let index = 0; index < steps && run.status === "playing"; index += 1) {
    events.push(...stepRun(run, autopilotInput(run), FIXED_STEP));
  }
  return { run, events };
}
