import { createGame, step, towWeight } from '../js/engine.js';
import { CONFIG } from '../js/config.js';
import makeBot from './bot.mjs';

const state = createGame(CONFIG.seed);
const decide = makeBot();
const t0 = Date.now();
let n = 0;
while (state.status === 'running' && state.steps < CONFIG.maxSteps) {
  const { input, pressed } = decide(state);
  step(state, input, pressed);
  n++;
  if (state.events[0] && state.time - state.events[0].t < 0.02 && state.events[0].kind !== 'checkpoint') {
    console.log(`  [t=${state.time.toFixed(1)}] ${state.events[0].kind}: ${state.events[0].reason}`);
  }
  if (n % 600 === 0) {
    console.log(
      `t=${state.time.toFixed(1)} x=${state.boat.x.toFixed(0)} y=${state.boat.y.toFixed(0)}`,
      `ang=${state.boat.angle.toFixed(2)} tow=${state.towed.length} w=${towWeight(state)}`,
      `col=${JSON.stringify(state.collected)} miss=${state.hazardMissed} rec=${state.recoverCount}`
    );
  }
}
console.log('END', state.status, state.failReason, 'time', state.time, 'x', state.boat.x.toFixed(0), Date.now() - t0, 'ms');
