import { noiseSample, seededRandom, TRACK_DEFS } from "./model.js";

const TRACK_TRIM = {
  kick: 0.94,
  snare: 0.68,
  hat: 0.32,
  clap: 0.5,
};

const noiseCache = new WeakMap();

function getNoiseBuffer(context, seed) {
  let cached = noiseCache.get(context);
  if (cached?.seed === seed) return cached.buffer;
  const duration = 2;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = noiseSample(seed, index) * 0.72;
  }
  cached = { seed, buffer };
  noiseCache.set(context, cached);
  return buffer;
}

function attackDecayGain(gain, when, peak, attack, decay, floor = 0.0001) {
  const start = Math.max(0, when);
  gain.setValueAtTime(0.0001, start);
  gain.linearRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  gain.exponentialRampToValueAtTime(floor, start + Math.max(attack + 0.008, decay));
}

function makeNoiseSource(context, seed, startAt, duration, detune = 0) {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context, seed);
  source.loop = true;
  source.playbackRate.value = 1;
  if (detune) source.detune.value = detune;
  source.start(startAt);
  source.stop(startAt + duration);
  return source;
}

function connectKick(context, output, track, when, velocity, token) {
  const decay = track.decay / 1000;
  const level = velocity / 127;
  const voiceGain = context.createGain();
  voiceGain.connect(output);

  const body = context.createOscillator();
  body.type = "sine";
  const pitchStart = track.tune * 2.1;
  const pitchEnd = track.tune * 0.86;
  body.frequency.setValueAtTime(pitchStart, when);
  body.frequency.exponentialRampToValueAtTime(pitchEnd, when + Math.min(0.11, decay * 0.32));
  const bodyGain = context.createGain();
  attackDecayGain(bodyGain.gain, when, level * 0.98, 0.0025, decay);
  body.connect(bodyGain).connect(voiceGain);
  body.start(when);
  body.stop(when + decay + 0.06);

  const click = makeNoiseSource(context, token, when, 0.035);
  const clickFilter = context.createBiquadFilter();
  clickFilter.type = "bandpass";
  clickFilter.frequency.value = Math.min(5400, track.tune * 42);
  clickFilter.Q.value = 0.7;
  const clickGain = context.createGain();
  attackDecayGain(clickGain.gain, when, level * 0.12, 0.001, 0.026);
  click.connect(clickFilter).connect(clickGain).connect(voiceGain);

  return [body, click];
}

function connectSnare(context, output, track, when, velocity, token) {
  const decay = track.decay / 1000;
  const level = velocity / 127;
  const voiceGain = context.createGain();
  voiceGain.connect(output);

  const noise = makeNoiseSource(context, token, when, decay + 0.06);
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(Math.max(520, track.tune * 8.5), when);
  noiseFilter.Q.value = 0.82;
  const noiseHigh = context.createBiquadFilter();
  noiseHigh.type = "highpass";
  noiseHigh.frequency.value = 420;
  const noiseGain = context.createGain();
  attackDecayGain(noiseGain.gain, when, level * 0.82, 0.0015, decay);
  noise.connect(noiseFilter).connect(noiseHigh).connect(noiseGain).connect(voiceGain);

  const body = context.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(track.tune * 1.12, when);
  body.frequency.exponentialRampToValueAtTime(track.tune * 0.72, when + 0.065);
  const bodyGain = context.createGain();
  attackDecayGain(bodyGain.gain, when, level * 0.34, 0.001, Math.min(0.13, decay * 0.7));
  body.connect(bodyGain).connect(voiceGain);
  body.start(when);
  body.stop(when + Math.min(0.2, decay) + 0.04);

  return [noise, body];
}

function connectHat(context, output, track, when, velocity, token) {
  const decay = Math.max(0.018, track.decay / 1000);
  const level = velocity / 127;
  const voiceGain = context.createGain();
  voiceGain.connect(output);

  const noise = makeNoiseSource(context, token, when, decay + 0.035);
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(track.tune, when);
  highpass.Q.value = 0.6;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(Math.min(15500, track.tune * 1.28), when);
  band.Q.value = 1.1;
  const gain = context.createGain();
  attackDecayGain(gain.gain, when, level * 0.72, 0.0007, decay);
  noise.connect(highpass).connect(band).connect(gain).connect(voiceGain);

  const metal = context.createOscillator();
  metal.type = "square";
  metal.frequency.setValueAtTime(Math.max(360, track.tune / 5.4), when);
  const metalFilter = context.createBiquadFilter();
  metalFilter.type = "highpass";
  metalFilter.frequency.value = Math.max(5000, track.tune * 0.7);
  const metalGain = context.createGain();
  attackDecayGain(metalGain.gain, when, level * 0.075, 0.0007, decay * 0.72);
  metal.connect(metalFilter).connect(metalGain).connect(voiceGain);
  metal.start(when);
  metal.stop(when + decay + 0.025);

  return [noise, metal];
}

function connectClap(context, output, track, when, velocity, token) {
  const decay = track.decay / 1000;
  const level = velocity / 127;
  const voiceGain = context.createGain();
  voiceGain.connect(output);

  const noise = makeNoiseSource(context, token, when, decay + 0.08);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(track.tune, when);
  filter.Q.value = 1.35;
  const high = context.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = Math.max(380, track.tune * 0.48);
  const burst = context.createGain();
  const peak = level * 0.8;
  burst.gain.setValueAtTime(0.0001, when);
  burst.gain.linearRampToValueAtTime(peak, when + 0.001);
  burst.gain.exponentialRampToValueAtTime(0.0001, when + 0.014);
  burst.gain.setValueAtTime(0.0001, when + 0.015);
  burst.gain.linearRampToValueAtTime(peak * 0.82, when + 0.016);
  burst.gain.exponentialRampToValueAtTime(0.0001, when + 0.029);
  burst.gain.setValueAtTime(0.0001, when + 0.03);
  burst.gain.linearRampToValueAtTime(peak * 0.94, when + 0.031);
  burst.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  burst.gain.setValueAtTime(0.0001, when + 0.046);
  burst.gain.linearRampToValueAtTime(peak * 0.45, when + 0.048);
  burst.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.08, decay));
  noise.connect(filter).connect(high).connect(burst).connect(voiceGain);

  return [noise];
}

const VOICE_BUILDERS = {
  kick: connectKick,
  snare: connectSnare,
  hat: connectHat,
  clap: connectClap,
};

export function createDrumVoice(context, output, trackId, track, when, velocity, token) {
  const builder = VOICE_BUILDERS[trackId];
  if (!builder) throw new Error(`Unknown drum voice: ${trackId}`);
  const sources = builder(context, output, track, when, velocity, token);
  const stopAt = when + track.decay / 1000 + 0.12;
  const voice = {
    trackId,
    startTime: when,
    stopAt,
    sources,
    stopped: false,
    stop(at = context.currentTime) {
      if (voice.stopped) return;
      voice.stopped = true;
      for (const source of sources) {
        try {
          source.stop(Math.max(at, context.currentTime));
        } catch {
          // A source may already have ended.
        }
      }
    },
  };
  for (const source of sources) {
    source.addEventListener?.("ended", () => {
      source.disconnect();
    }, { once: true });
  }
  return voice;
}

export function createTrackBus(context, destination) {
  const panner = context.createStereoPanner();
  const gain = context.createGain();
  panner.connect(gain).connect(destination);
  return { panner, gain };
}

export function configureTrackBus(bus, trackId, track) {
  const trim = TRACK_TRIM[trackId] ?? 0.5;
  const target = track.mute ? 0 : (track.level / 100) * trim;
  const now = bus.gain.context.currentTime;
  bus.gain.gain.cancelScheduledValues(now);
  bus.gain.gain.setTargetAtTime(target, now, 0.012);
  bus.panner.pan.cancelScheduledValues(now);
  bus.panner.pan.setTargetAtTime(track.pan / 100, now, 0.012);
}

export function createOfflineBuses(context, destination, patch) {
  const buses = {};
  for (const def of TRACK_DEFS) {
    const bus = createTrackBus(context, destination);
    const track = patch.tracks[def.id];
    bus.gain.gain.value = track.mute ? 0 : (track.level / 100) * (TRACK_TRIM[def.id] ?? 0.5);
    bus.panner.pan.value = track.pan / 100;
    buses[def.id] = bus;
  }
  return buses;
}

export function velocityToken(patchSeed, trackIndex, step, cycle) {
  return (patchSeed
    ^ Math.imul(trackIndex + 7, 0x45d9f3b)
    ^ Math.imul(step + 1, 0x27d4eb2f)
    ^ Math.imul(cycle + 3, 0x165667b1)) >>> 0;
}

export function probabilityPasses(patchSeed, trackIndex, step, cycle, probability) {
  return seededRandom(patchSeed, trackIndex, step, cycle, 1) * 100 < probability;
}
