import { createGame, step, buildSummary } from '../../js/engine.js';
import { CONFIG } from '../../js/config.js';
import makeBot from '../bot.mjs';
const state = createGame(CONFIG.seed);
const bot = makeBot();
while (state.status === 'running' && state.steps < CONFIG.maxSteps) {
  const { input, pressed } = bot(state);
  step(state, input, pressed);
}
const summary = buildSummary(state);
const store = new Map();
const localStorage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) };
localStorage.setItem('cleanup-boat-summary-v1', JSON.stringify(summary, null, 2));
const parsed = JSON.parse(localStorage.getItem('cleanup-boat-summary-v1'));
console.log('status:', parsed.status);
console.log('finalTime:', parsed.finalTimeSeconds, 'score:', parsed.resources.score);
console.log('quota:', JSON.stringify(parsed.targets.collected), 'met:', parsed.targets.quotaMet);
console.log('resources:', JSON.stringify(parsed.resources));
console.log('path points:', parsed.path.length, 'events:', parsed.events.length);
