// audio.js — all sound is synthesized at runtime with Web Audio nodes.
// No audio assets are loaded anywhere in this application.

export const TIMELINE_DURATION = 6; // seconds, fixed master length

export const DEFAULT_PARAMS = Object.freeze({
  frequency: 440, // Hz, main tone pitch
  pan: 0, // -1 left only .. 0 center .. +1 right only
  delayMs: 120, // delay of the echo copy, ms (0 disables echo)
  beatHz: 4, // beat rate, beats per second
  gain: 0.45, // linear output level
  beats: 3, // number of repeated beats per cue
});

export function makeParams(overrides = {}) {
  return { ...DEFAULT_PARAMS, ...overrides };
}

// Equal-power pan -> per-channel gains.
export function panGains(pan) {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = (p + 1) * (Math.PI / 4); // 0..PI/2
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

// Schedule every node of one cue onto an arbitrary BaseAudioContext.
// The same routine drives live playback and offline export, guaranteeing
// that what you hear is exactly what gets rendered to WAV.
export function scheduleCue(ctx, merger, cue, params, baseTime = 0) {
  const start = baseTime + cue.start;
  const beatPeriod = 1 / Math.max(0.1, params.beatHz);
  const { left, right } = panGains(params.pan);
  const oscillators = [];

  for (let i = 0; i < params.beats; i += 1) {
    const t = start + i * beatPeriod;
    const osc = new OscillatorNode(ctx, {
      type: 'square',
      frequency: params.frequency,
    });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(params.gain, t + 0.005);
    env.gain.setValueAtTime(params.gain, t + 0.06);
    env.gain.linearRampToValueAtTime(0.0001, t + 0.15);

    const dryL = new GainNode(ctx, { gain: left });
    const dryR = new GainNode(ctx, { gain: right });
    osc.connect(env);
    env.connect(dryL).connect(merger, 0);
    env.connect(dryR).connect(merger, 0, 1);

    // Delayed echo copy leaning to the opposite side; delayMs changes timing.
    if (params.delayMs > 0) {
      const delay = new DelayNode(ctx, { delayTime: params.delayMs / 1000 });
      const echoGain = new GainNode(ctx, { gain: 0.45 * params.gain });
      const echoL = new GainNode(ctx, { gain: right * 0.8 });
      const echoR = new GainNode(ctx, { gain: left * 0.8 });
      env.connect(delay).connect(echoGain);
      echoGain.connect(echoL).connect(merger, 0);
      echoGain.connect(echoR).connect(merger, 0, 1);
    }

    osc.start(t);
    osc.stop(t + 0.2);
    oscillators.push(osc);
  }
  return oscillators;
}
