import { CONFIG } from './config.js';

export function pushEvent(state, text, kind = 'info') {
  state.events.unshift({ t: state.elapsed, text, kind });
  if (state.events.length > CONFIG.maxEvents) state.events.pop();
}

export function setCheckpoint(state) {
  state.checkpoint = {
    x: state.vehicle.x,
    y: state.vehicle.y,
    angle: state.vehicle.angle,
    elapsed: state.elapsed,
    fuel: state.fuel,
    polesCarried: state.polesCarried,
    targets: state.targets.map((t) => ({ ...t }))
  };
}
