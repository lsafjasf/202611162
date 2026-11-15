import { CONFIG } from '../src/config.js';
import { stepGame } from '../src/engine.js';

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function makeBot() {
  const memory = { lastX: 0, lastY: 0, timer: 0, escape: 0, reverse: 0, cooldown: 0, hold: 0, dir: 1 };
  return {
    choose(state, target) {
      const v = state.vehicle;
      const input = { accelerate: false, brake: false, left: false, right: false };
      if (!target) return input;

      memory.timer += 1 / 30;
      memory.cooldown = Math.max(0, memory.cooldown - 1 / 30);
      if (memory.timer >= 2) {
        const moved = Math.hypot(v.x - memory.lastX, v.y - memory.lastY);
        if (moved < 26 && memory.cooldown === 0) {
          memory.escape = 3.2;
          memory.reverse = 1.2;
          memory.cooldown = 9;
          memory.hold = 3;
          memory.dir = memory.dir === 1 ? -1 : 1;
        }
        memory.timer = 0;
        memory.lastX = v.x;
        memory.lastY = v.y;
      }
      if (memory.escape > 0) {
        memory.escape -= 1 / 30;
        if (memory.reverse > 0) {
          memory.reverse -= 1 / 30;
          input.brake = true;
        } else if (Math.abs(v.speed) > 70) {
          input.brake = true;
        } else {
          input.accelerate = true;
        }
        input[memory.dir === 1 ? 'left' : 'right'] = true;
        return input;
      }
      if (memory.hold > 0) {
        memory.hold -= 1 / 30;
        if (Math.abs(v.speed) > 90) input.brake = true;
        else input.accelerate = true;
        return input;
      }

      let fx = target.x - v.x;
      let fy = target.y - v.y;
      const fl = Math.hypot(fx, fy) || 1;
      fx /= fl;
      fy /= fl;
      for (const rock of state.world.rocks) {
        const dx = v.x - rock.x;
        const dy = v.y - rock.y;
        const dist = Math.hypot(dx, dy) || 1;
        const influence = rock.radius + 170;
        if (dist < influence) {
          const push = ((influence - dist) / influence) * 2.4;
          fx += (dx / dist) * push;
          fy += (dy / dist) * push;
        }
      }
      const desired = Math.atan2(fy, fx);
      const diff = normAngle(desired - v.angle);
      if (diff > 0.08) input.right = true;
      if (diff < -0.08) input.left = true;

      const dist = Math.hypot(target.x - v.x, target.y - v.y);
      const slowZone = target.radius ? 120 : 140;
      if (Math.abs(diff) > 1.4) input.brake = true;
      else if (dist < slowZone && Math.abs(v.speed) > 55) input.brake = true;
      else input.accelerate = true;
      return input;
    }

  };
}

export function nextObjective(state) {
  const pending = state.targets.find((t) => !t.polePlaced);
  if (pending) return pending;
  return { ...state.world.camp, radius: state.world.camp.radius };
}

export function runUntil(state, predicate, maxSeconds, bot = makeBot()) {
  const dt = 1 / 30;
  let ticks = 0;
  const maxTicks = Math.ceil(maxSeconds / dt);
  while (ticks < maxTicks) {
    const target = nextObjective(state);
    const input = bot.choose(state, target);
    if (state.targets.some((t) => !t.polePlaced)) {
      const nearTarget = state.targets.find((t) => !t.polePlaced
        && Math.hypot(state.vehicle.x - t.x, state.vehicle.y - t.y) <= CONFIG.targetRange);
      if (nearTarget) input.deploy = true;
    }
    stepGame(state, dt, input);
    ticks += 1;
    if (predicate(state)) return { done: true, ticks };
  }
  return { done: false, ticks };
}
