const TAU = Math.PI * 2;

export const DEFAULT_PARAMS = Object.freeze({
  frequency: 620,
  beam: -0.28,
  bpm: 84,
  gain: 0.72,
});

export const PARAM_LIMITS = Object.freeze({
  frequency: [280, 920],
  beam: [-1, 1],
  bpm: [48, 132],
  gain: [0.3, 1],
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeParams(source = {}) {
  return {
    frequency: clamp(Number(source.frequency) || DEFAULT_PARAMS.frequency, ...PARAM_LIMITS.frequency),
    beam: clamp(Number.isFinite(Number(source.beam)) ? Number(source.beam) : DEFAULT_PARAMS.beam, ...PARAM_LIMITS.beam),
    bpm: clamp(Number(source.bpm) || DEFAULT_PARAMS.bpm, ...PARAM_LIMITS.bpm),
    gain: clamp(Number.isFinite(Number(source.gain)) ? Number(source.gain) : DEFAULT_PARAMS.gain, ...PARAM_LIMITS.gain),
  };
}

export function targetDelay(distance) {
  return 0.12 + (clamp(distance, 0, 120) / 120) * 1.2;
}

export function delayMs(distance) {
  return Math.round(targetDelay(distance) * 1000);
}

export function channelMix(beam) {
  const pan = clamp(Number(beam) || 0, -1, 1);
  const left = Math.round(((1 - pan) / 2) * 100);
  return { left, right: 100 - left };
}

function makeNoiseBuffer(ctx, seconds = 0.35, seed = 0x51a7) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = ((state >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

function buildOutputGraph(ctx, params) {
  const input = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-13, 0);
  compressor.knee.setValueAtTime(10, 0);
  compressor.ratio.setValueAtTime(7, 0);
  compressor.attack.setValueAtTime(0.002, 0);
  compressor.release.setValueAtTime(0.22, 0);

  const master = ctx.createGain();
  master.gain.setValueAtTime(clamp(params.gain, 0.3, 1) * 0.72, 0);
  input.connect(compressor);
  compressor.connect(master);
  master.connect(ctx.destination);
  return { input, compressor, master };
}

function makePanner(ctx, input, pan, destination) {
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(clamp(pan, -1, 1), 0);
  input.connect(panner);
  panner.connect(destination);
  return panner;
}

function envelopeGain(ctx, time, peak, attack, decay, destination) {
  const gain = ctx.createGain();
  const safePeak = Math.max(0.0001, peak);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(safePeak, time + Math.max(0.001, attack));
  gain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(attack + 0.01, decay));
  gain.connect(destination);
  return gain;
}

function scheduleNoiseBurst(ctx, destination, time, options = {}) {
  const source = ctx.createBufferSource();
  source.buffer = makeNoiseBuffer(ctx, options.length || 0.2, options.seed || 0x51a7);
  const filter = ctx.createBiquadFilter();
  filter.type = options.filterType || "bandpass";
  filter.frequency.setValueAtTime(options.filterFrequency || 900, time);
  filter.Q.setValueAtTime(options.q || 0.8, time);
  const gain = envelopeGain(
    ctx,
    time,
    options.peak || 0.12,
    options.attack || 0.008,
    options.decay || 0.2,
    destination,
  );
  source.connect(filter);
  filter.connect(gain);
  source.start(time);
  source.stop(time + (options.length || 0.2) + 0.02);
  return source;
}

export function schedulePing(ctx, destination, time, params) {
  const pingBus = ctx.createGain();
  pingBus.gain.setValueAtTime(1, time);
  makePanner(ctx, pingBus, params.beam, destination);

  const main = ctx.createOscillator();
  main.type = "sine";
  main.frequency.setValueAtTime(params.frequency * 1.13, time);
  main.frequency.exponentialRampToValueAtTime(params.frequency, time + 0.055);
  const mainGain = envelopeGain(ctx, time, 0.34, 0.006, 0.27, pingBus);
  main.connect(mainGain);
  main.start(time);
  main.stop(time + 0.3);

  const sub = ctx.createOscillator();
  sub.type = "triangle";
  sub.frequency.setValueAtTime(params.frequency * 0.5, time);
  const subGain = envelopeGain(ctx, time, 0.055, 0.004, 0.16, pingBus);
  sub.connect(subGain);
  sub.start(time);
  sub.stop(time + 0.19);

  scheduleNoiseBurst(ctx, pingBus, time, {
    length: 0.055,
    peak: 0.055,
    filterType: "highpass",
    filterFrequency: 1500,
    attack: 0.002,
    decay: 0.06,
    seed: 0x9e3779b9,
  });
}

function scheduleRockEcho(ctx, destination, time, params, target) {
  const pan = clamp(params.beam * 0.16 + target.angle, -1, 1);
  const bus = ctx.createGain();
  makePanner(ctx, bus, pan, destination);
  const amplitude = clamp(0.62 * target.strength, 0.2, 0.82);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(params.frequency * 1.54, time);
  body.frequency.exponentialRampToValueAtTime(params.frequency * 1.31, time + 0.11);
  const bodyGain = envelopeGain(ctx, time, amplitude, 0.006, 0.17, bus);
  body.connect(bodyGain);
  body.start(time);
  body.stop(time + 0.2);

  const overtone = ctx.createOscillator();
  overtone.type = "triangle";
  overtone.frequency.setValueAtTime(params.frequency * 2.08, time);
  const overtoneGain = envelopeGain(ctx, time, amplitude * 0.17, 0.003, 0.09, bus);
  overtone.connect(overtoneGain);
  overtone.start(time);
  overtone.stop(time + 0.11);

  scheduleNoiseBurst(ctx, bus, time, {
    length: 0.075,
    peak: amplitude * 0.18,
    filterFrequency: params.frequency * 2.2,
    q: 0.7,
    attack: 0.002,
    decay: 0.08,
    seed: 0x243f6a88,
  });
}

function scheduleShoalEcho(ctx, destination, time, params, target) {
  const pan = clamp(params.beam * 0.16 + target.angle, -1, 1);
  const bus = ctx.createGain();
  makePanner(ctx, bus, pan, destination);
  const amplitude = clamp(0.28 * target.strength, 0.09, 0.34);

  [0, 0.036, 0.082].forEach((offset, index) => {
    const voice = ctx.createOscillator();
    voice.type = "sine";
    voice.frequency.setValueAtTime(params.frequency * (0.77 - index * 0.045), time + offset);
    const gain = envelopeGain(
      ctx,
      time + offset,
      amplitude * (1 - index * 0.24),
      0.014,
      0.24 + index * 0.055,
      bus,
    );
    voice.connect(gain);
    voice.start(time + offset);
    voice.stop(time + offset + 0.3);
  });

  scheduleNoiseBurst(ctx, bus, time, {
    length: 0.28,
    peak: amplitude * 0.5,
    filterType: "lowpass",
    filterFrequency: params.frequency * 0.55,
    q: 0.55,
    attack: 0.018,
    decay: 0.3,
    seed: 0x13198a2e,
  });
}

export function scheduleTargetEcho(ctx, destination, startTime, params, target) {
  const time = startTime + targetDelay(target.distance);
  if (target.type === "rock") {
    scheduleRockEcho(ctx, destination, time, params, target);
  } else {
    scheduleShoalEcho(ctx, destination, time, params, target);
  }
}

export function scheduleScan(ctx, destination, startTime, params, targets) {
  schedulePing(ctx, destination, startTime, params);
  for (const target of targets) {
    scheduleTargetEcho(ctx, destination, startTime, params, target);
  }
}

export function scheduleArchiveTrack(ctx, destination, params, targets, duration = 9.6) {
  const beat = 60 / params.bpm;
  const start = 0.28;
  let pulse = 0;
  for (let time = start; time < duration - 1.45; time += beat) {
    scheduleScan(ctx, destination, time, params, targets);
    pulse += 1;
  }
  return pulse;
}

export class SonarAudio {
  constructor() {
    this.ctx = null;
    this.graph = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.leftData = null;
    this.rightData = null;
    this.params = { ...DEFAULT_PARAMS };
    this.paused = false;
    this.lastScan = null;
    this.lastParamChange = 0;
  }

  get ready() {
    return Boolean(this.ctx);
  }

  get state() {
    if (!this.ctx) return "idle";
    return this.paused ? "paused" : this.ctx.state;
  }

  async ensureContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API");
      this.ctx = new AudioContextClass({ latencyHint: "interactive" });
      this.graph = buildOutputGraph(this.ctx, this.params);

      const meter = this.ctx.createAnalyser();
      meter.fftSize = 1024;
      meter.smoothingTimeConstant = 0.32;
      this.graph.master.connect(meter);
      const splitter = this.ctx.createChannelSplitter(2);
      meter.connect(splitter);

      this.leftAnalyser = this.ctx.createAnalyser();
      this.rightAnalyser = this.ctx.createAnalyser();
      this.leftAnalyser.fftSize = 512;
      this.rightAnalyser.fftSize = 512;
      splitter.connect(this.leftAnalyser, 0);
      splitter.connect(this.rightAnalyser, 1);
      this.leftData = new Float32Array(this.leftAnalyser.fftSize);
      this.rightData = new Float32Array(this.rightAnalyser.fftSize);
      this.meter = meter;
    }

    this.paused = false;
    if (this.ctx.state !== "running") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  async setParams(nextParams, options = {}) {
    this.params = normalizeParams({ ...this.params, ...nextParams });
    this.lastParamChange = performance.now();
    if (this.ctx && this.graph) {
      const now = this.ctx.currentTime;
      const ramp = Math.max(0.01, options.ramp ?? 0.06);
      this.graph.master.gain.cancelScheduledValues(now);
      this.graph.master.gain.setValueAtTime(this.graph.master.gain.value, now);
      this.graph.master.gain.linearRampToValueAtTime(this.params.gain * 0.72, now + ramp);
    }
    return this.params;
  }

  async preview() {
    if (this.paused) return false;
    const ctx = await this.ensureContext();
    const interval = 60 / this.params.bpm;
    for (let pulse = 0; pulse < 3; pulse += 1) {
      schedulePing(
        ctx,
        this.graph.input,
        ctx.currentTime + 0.012 + pulse * interval,
        this.params,
      );
    }
    return true;
  }

  async playScan(targets, options = {}) {
    if (this.paused) return null;
    const ctx = await this.ensureContext();
    const startTime = ctx.currentTime + 0.035;
    scheduleScan(ctx, this.graph.input, startTime, this.params, targets);
    this.lastScan = {
      targets: targets.map((target) => ({ ...target })),
      params: { ...this.params },
      playedAt: performance.now(),
      startTime,
      replay: Boolean(options.replay),
    };
    return {
      startTime,
      delays: targets.map((target) => delayMs(target.distance)),
    };
  }

  async replayLast() {
    if (!this.lastScan || this.paused) return null;
    const ctx = await this.ensureContext();
    const startTime = ctx.currentTime + 0.035;
    scheduleScan(ctx, this.graph.input, startTime, this.params, this.lastScan.targets);
    this.lastScan.playedAt = performance.now();
    this.lastScan.startTime = startTime;
    this.lastScan.replay = true;
    return { startTime, delays: this.lastScan.targets.map((target) => delayMs(target.distance)) };
  }

  async playFeedback(kind = "confirm") {
    if (this.paused) return false;
    const ctx = await this.ensureContext();
    const time = ctx.currentTime + 0.01;
    const frequencies = kind === "error"
      ? [230, 184]
      : kind === "complete"
        ? [620, 930]
        : [540, 720];
    const duration = kind === "complete" ? 0.42 : 0.18;
    frequencies.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      oscillator.type = kind === "error" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, time + index * 0.09);
      panner.pan.setValueAtTime(index === 0 ? -0.24 : 0.24, time);
      gain.gain.setValueAtTime(0.0001, time + index * 0.09);
      gain.gain.linearRampToValueAtTime(0.09, time + index * 0.09 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + index * 0.09 + duration);
      oscillator.connect(gain);
      gain.connect(panner);
      panner.connect(this.graph.input);
      oscillator.start(time + index * 0.09);
      oscillator.stop(time + index * 0.09 + duration + 0.03);
    });
    return true;
  }

  async pause() {
    if (!this.ctx || this.paused) return false;
    this.paused = true;
    await this.ctx.suspend();
    return true;
  }

  async resume() {
    if (!this.ctx) return this.ensureContext();
    if (!this.paused) return true;
    this.paused = false;
    await this.ctx.resume();
    return true;
  }

  async togglePause() {
    if (this.paused) {
      await this.resume();
      return false;
    }
    await this.pause();
    return true;
  }

  stopAll() {
    if (!this.ctx || !this.graph) return;
    this.graph.input.gain.cancelScheduledValues(this.ctx.currentTime);
    this.graph.input.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    setTimeout(() => {
      if (!this.graph) return;
      this.graph.input.gain.setValueAtTime(1, this.ctx.currentTime);
    }, 80);
  }

  readMeters() {
    if (!this.leftAnalyser || !this.rightAnalyser) {
      return { peak: 0, peakDb: -Infinity, leftRms: 0, rightRms: 0, leftPeak: 0, rightPeak: 0 };
    }
    this.leftAnalyser.getFloatTimeDomainData(this.leftData);
    this.rightAnalyser.getFloatTimeDomainData(this.rightData);
    let leftPeak = 0;
    let rightPeak = 0;
    let leftSum = 0;
    let rightSum = 0;
    for (let index = 0; index < this.leftData.length; index += 1) {
      const left = Math.abs(this.leftData[index]);
      const right = Math.abs(this.rightData[index]);
      leftPeak = Math.max(leftPeak, left);
      rightPeak = Math.max(rightPeak, right);
      leftSum += left * left;
      rightSum += right * right;
    }
    const peak = Math.max(leftPeak, rightPeak);
    return {
      peak,
      peakDb: peak > 0.00001 ? 20 * Math.log10(peak) : -Infinity,
      leftRms: Math.sqrt(leftSum / this.leftData.length),
      rightRms: Math.sqrt(rightSum / this.rightData.length),
      leftPeak,
      rightPeak,
    };
  }
}

export function createOfflineGraph(ctx, params) {
  return buildOutputGraph(ctx, params);
}

export async function renderPingProbe(params, beam, seconds = 0.9) {
  const ctx = new OfflineAudioContext(2, Math.floor(48000 * seconds), 48000);
  const graph = buildOutputGraph(ctx, params);
  schedulePing(ctx, graph.input, 0.08, { ...params, beam });
  const buffer = await ctx.startRendering();
  return buffer;
}

export async function renderBeatProbe(params, bpm, seconds = 2.5) {
  const ctx = new OfflineAudioContext(2, Math.floor(48000 * seconds), 48000);
  const graph = buildOutputGraph(ctx, params);
  const interval = 60 / bpm;
  for (let time = 0.12; time < seconds - 0.18; time += interval) {
    schedulePing(ctx, graph.input, time, params);
  }
  return ctx.startRendering();
}

export async function renderArchive(params, targets, duration = 9.6) {
  const sampleRate = 48000;
  const ctx = new OfflineAudioContext(2, Math.floor(duration * sampleRate), sampleRate);
  const graph = buildOutputGraph(ctx, params);
  const pulses = scheduleArchiveTrack(ctx, graph.input, params, targets, duration);
  const buffer = await ctx.startRendering();
  return { buffer, pulses, duration, sampleRate };
}
