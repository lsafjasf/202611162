import { angleDelta } from "../src/simulation.js";

export function driveToCompletion(game, maxSteps = 160000) {
  let steps = 0;
  while (steps < maxSteps && game.state.status === "running") {
    const ferry = game.state.ferry;
    const east = game.state.nextDock === "east";
    const dockX = east ? 997 : 203;
    const approachX = east ? 850 : 350;
    const distDock = Math.hypot(dockX - ferry.x, 360 - ferry.y);
    const distApproach = Math.hypot(approachX - ferry.x, 360 - ferry.y);
    let targetX;
    let targetY;
    let desiredSpeed;

    if (distDock < 145) {
      targetX = dockX;
      targetY = 360;
      desiredSpeed = 13;
    } else if (distApproach < 105) {
      targetX = approachX;
      targetY = 360;
      desiredSpeed = 18;
    } else {
      targetX = approachX;
      targetY = 360;
      desiredSpeed = 48;
    }

    const dx = targetX - ferry.x;
    const dy = targetY - ferry.y;
    const distance = Math.hypot(dx, dy) || 1;
    let dirX = dx / distance;
    let dirY = dy / distance;

    if (distDock > 210) {
      for (const floe of game.state.iceFloes) {
        const futureX = floe.x + floe.vx * 1.6;
        const futureY = floe.y + floe.vy * 1.6;
        const awayX = ferry.x - futureX;
        const awayY = ferry.y - futureY;
        const awayDistance = Math.hypot(awayX, awayY) || 1;
        const range = floe.radius + 72;
        if (awayDistance < range) {
          const weight = (1 - awayDistance / range) ** 1.7 * 3.2;
          dirX += (awayX / awayDistance) * weight;
          dirY += (awayY / awayDistance) * weight;
        }
      }
    }

    const wanted = Math.atan2(dirY, dirX);
    const diff = angleDelta(wanted, ferry.heading);
    const speed = game.speed;
    if (Math.abs(diff) > 0.55) desiredSpeed = Math.min(desiredSpeed, 15);
    game.step({
      left: diff < -0.018,
      right: diff > 0.018,
      thrust: speed < desiredSpeed,
      reverse: speed > desiredSpeed + 4,
      reel: false,
      pay: false,
    });
    steps += 1;
  }
  return steps;
}
