import {
  TRACK_DEFS,
  clamp,
} from "./model.js";
import {
  configureTrackBus,
  createDrumVoice,
  createTrackBus,
  probabilityPasses,
  velocityToken,
} from "./synth.js";

const LOOKAHEAD_SECONDS = 0.085;
const SCHEDULER_INTERVAL = 12;
const SILENCE_DB = -60;

function amplitudeToDb(value) {
  if (value <= 0) return -Infinity;
  return 20 * Math.log10(value);
}

function smoothDb(previous, next, rise = 0.55, fall = 0.22) {
  if (!Number.isFinite(next)) return Number.isFinite(previous) ? previous + (SILENCE_DB - previous) * fall : -Infinity;
  if (!Number.isFinite(previous)) return next;
  return next > previous ? previous + (next - previous) * rise : previous + (next - previous) * fall;
}

export class DrumMachine {
  constructor(patch, options = {}) {
    this.patch = patch;
    this.onTransport = options.onTransport ?? (() => {});
    this.onStep = options.onStep ?? (() => {});
    this.context = null;
    this.master = null;
    this.buses = {};
    this.mixAnalyser = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;
    this.playing = false;
    this.paused = false;
    this.pausedStep = 0;
    this.nextStep = 0;
    this.cycle = 0;
    this.nextStepTime = 0;
    this.timer = 0;
    this.queue = [];
    this.voices = new Set();
    this.meter = {
      frequency: 0,
      left: -Infinity,
      right: -Infinity,
      peak: -Infinity,
      peakHold: -Infinity,
      lastSignalAt: 0,
      lastFrameAt: 0,
    };
    this.freqHistory = new Array(48).fill(0);
    this.frequencyData = null;
    this.timeData = null;
    this.leftData = null;
    this.rightData = null;
    this.startPromise = null;
  }

  async ensureAudio() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      const context = new AudioContextClass({ latencyHint: "interactive" });
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = (this.patch.master / 100) ** 1.45;
      this.master.connect(context.destination);

      this.mixAnalyser = context.createAnalyser();
      this.mixAnalyser.fftSize = 2048;
      this.mixAnalyser.smoothingTimeConstant = 0.62;
      this.master.connect(this.mixAnalyser);

      const splitter = context.createChannelSplitter(2);
      this.leftAnalyser = context.createAnalyser();
      this.rightAnalyser = context.createAnalyser();
      this.leftAnalyser.fftSize = 1024;
      this.rightAnalyser.fftSize = 1024;
      this.leftAnalyser.smoothingTimeConstant = 0.3;
      this.rightAnalyser.smoothingTimeConstant = 0.3;
      this.master.connect(splitter);
      splitter.connect(this.leftAnalyser, 0);
      splitter.connect(this.rightAnalyser, 1);

      this.frequencyData = new Float32Array(this.mixAnalyser.frequencyBinCount);
      this.timeData = new Float32Array(this.mixAnalyser.fftSize);
      this.leftData = new Float32Array(this.leftAnalyser.fftSize);
      this.rightData = new Float32Array(this.rightAnalyser.fftSize);

      for (const def of TRACK_DEFS) {
        const bus = createTrackBus(context, this.master);
        configureTrackBus(bus, def.id, this.patch.tracks[def.id]);
        this.buses[def.id] = bus;
      }
      if (context.state === "suspended") await context.resume();
      this.onTransport(this.getTransportState());
      return context;
    })();
    try {
      return await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  setPatch(patch) {
    const oldBpm = this.patch?.bpm;
    this.patch = patch;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime((patch.master / 100) ** 1.45, this.context.currentTime, 0.015);
      for (const def of TRACK_DEFS) {
        configureTrackBus(this.buses[def.id], def.id, patch.tracks[def.id]);
      }
    }
    if (this.playing && oldBpm !== patch.bpm) this.reanchorTempo();
  }

  updateTrack(trackId) {
    if (!this.buses[trackId] || !this.context) return;
    configureTrackBus(this.buses[trackId], trackId, this.patch.tracks[trackId]);
  }

  updateMaster() {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(
      (this.patch.master / 100) ** 1.45,
      this.context.currentTime,
      0.015,
    );
  }

  get secondsPerStep() {
    return 60 / this.patch.bpm / 4;
  }

  getTransportState() {
    return {
      playing: this.playing,
      paused: this.paused,
      bpm: this.patch.bpm,
      step: this.getCurrentStepInfo()?.step ?? this.pausedStep ?? 0,
      contextState: this.context?.state ?? "idle",
      sampleRate: this.context?.sampleRate ?? 0,
      activeVoices: this.voices.size,
    };
  }

  async play() {
    const context = await this.ensureAudio();
    if (this.playing) return;
    const fromStep = this.paused ? this.pausedStep : 0;
    this.playing = true;
    this.paused = false;
    this.cycle = 0;
    this.nextStep = fromStep;
    this.nextStepTime = context.currentTime + 0.055;
    this.queue = [];
    this.onTransport(this.getTransportState());
    this.tickScheduler();
    this.timer = window.setInterval(() => this.tickScheduler(), SCHEDULER_INTERVAL);
  }

  async replay() {
    await this.ensureAudio();
    this.stopScheduledVoices();
    this.queue = [];
    if (this.playing) {
      this.nextStep = 0;
      this.cycle = 0;
      this.nextStepTime = this.context.currentTime + 0.035;
      this.tickScheduler();
    } else {
      this.paused = false;
      this.pausedStep = 0;
      await this.play();
    }
    this.onTransport(this.getTransportState());
  }

  pause() {
    if (!this.playing) return;
    const current = this.getCurrentStepInfo();
    this.pausedStep = current?.step ?? this.nextStep;
    this.playing = false;
    this.paused = true;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.stopScheduledVoices();
    this.queue = [];
    this.onTransport(this.getTransportState());
  }

  stop() {
    this.playing = false;
    this.paused = false;
    this.pausedStep = 0;
    this.nextStep = 0;
    this.cycle = 0;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.stopScheduledVoices();
    this.queue = [];
    this.onTransport(this.getTransportState());
  }

  stopScheduledVoices() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) voice.stop(now);
    this.voices.clear();
    this.queue = this.queue.filter((event) => event.time <= now + 0.002);
  }

  tickScheduler() {
    if (!this.playing || !this.context) return;
    const now = this.context.currentTime;
    let safety = 0;
    while (this.nextStepTime < now + LOOKAHEAD_SECONDS && safety < 32) {
      this.scheduleStep(this.nextStep, this.nextStepTime, this.cycle);
      this.nextStep = (this.nextStep + 1) % 16;
      if (this.nextStep === 0) this.cycle += 1;
      this.nextStepTime += this.secondsPerStep;
      safety += 1;
    }
  }

  scheduleStep(step, when, cycle) {
    this.lastStepDuration = this.secondsPerStep;
    this.queue.push({ step, cycle, time: when });
    if (this.queue.length > 48) this.queue.splice(0, this.queue.length - 48);
    for (let trackIndex = 0; trackIndex < TRACK_DEFS.length; trackIndex += 1) {
      const def = TRACK_DEFS[trackIndex];
      const track = this.patch.tracks[def.id];
      const note = track.steps[step];
      if (!note?.on || track.mute) continue;
      if (!probabilityPasses(this.patch.seed, trackIndex, step, cycle, note.probability)) continue;
      const token = velocityToken(this.patch.seed, trackIndex, step, cycle);
      this.spawnVoice(def.id, track, note.velocity, when, token);
    }
  }

  spawnVoice(trackId, track, velocity, when, token) {
    if (!this.context) return null;
    const voice = createDrumVoice(
      this.context,
      this.buses[trackId].panner,
      trackId,
      track,
      when,
      velocity,
      token,
    );
    this.voices.add(voice);
    const cleanupMs = Math.max(50, (voice.stopAt - this.context.currentTime) * 1000 + 180);
    window.setTimeout(() => this.voices.delete(voice), cleanupMs);
    return voice;
  }

  async audition(trackId, velocity = 112) {
    const context = await this.ensureAudio();
    const track = this.patch.tracks[trackId];
    if (!track) return;
    const when = context.currentTime + 0.018;
    const token = (this.patch.seed ^ Date.now()) >>> 0;
    this.spawnVoice(trackId, track, velocity, when, token);
  }

  reanchorTempo() {
    if (!this.playing || !this.context) return;
    const now = this.context.currentTime;
    const current = [...this.queue].reverse().find((event) => event.time <= now + 0.003);
    const upcoming = this.queue.find((event) => event.time > now + 0.003);
    window.clearInterval(this.timer);
    for (const voice of [...this.voices]) {
      if (voice.startTime > now + 0.003) {
        voice.stop(now);
        this.voices.delete(voice);
      }
    }
    this.queue = this.queue.filter((event) => event.time <= now + 0.003);
    if (current) {
      const stepAfterCurrent = (current.step + 1) % 16;
      this.nextStep = stepAfterCurrent;
      this.cycle = current.step === 15 ? current.cycle + 1 : current.cycle;
      const elapsed = Math.max(0, now - current.time);
      const probe = this.lastStepDuration ?? this.secondsPerStep;
      const remaining = Math.max(0.015, 1 - Math.min(1, elapsed / probe)) * this.secondsPerStep;
      this.nextStepTime = now + remaining;
    } else if (upcoming) {
      this.nextStep = upcoming.step;
      this.cycle = upcoming.cycle;
      this.nextStepTime = now + 0.025;
    } else {
      this.nextStepTime = now + 0.025;
    }
    this.tickScheduler();
    this.timer = window.setInterval(() => this.tickScheduler(), SCHEDULER_INTERVAL);
    this.onTransport(this.getTransportState());
  }

  getCurrentStepInfo(at = this.context?.currentTime ?? 0) {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].time <= at + 0.004) return this.queue[index];
    }
    return null;
  }

  getVisualState(at = this.context?.currentTime ?? 0) {
    if (!this.playing) return { step: this.paused ? this.pausedStep : -1, flash: 0 };
    const current = this.getCurrentStepInfo(at);
    if (!current) return { step: this.pausedStep, flash: 0 };
    const elapsed = Math.max(0, at - current.time);
    return {
      step: current.step,
      flash: Math.max(0, 1 - elapsed / Math.min(0.18, this.secondsPerStep)),
    };
  }

  readMetrics() {
    const now = this.context?.currentTime ?? 0;
    const idle = {
      frequency: this.meter.frequency,
      left: this.meter.left,
      right: this.meter.right,
      peak: this.meter.peak,
      peakHold: this.meter.peakHold,
      delayMs: this.getLatencyMs(),
      activeVoices: this.voices.size,
      sampleRate: this.context?.sampleRate ?? 0,
      state: this.context?.state ?? "idle",
      hasSignal: false,
    };
    if (!this.context) return idle;

    this.mixAnalyser.getFloatFrequencyData(this.frequencyData);
    this.mixAnalyser.getFloatTimeDomainData(this.timeData);
    this.leftAnalyser.getFloatTimeDomainData(this.leftData);
    this.rightAnalyser.getFloatTimeDomainData(this.rightData);

    let peakSample = 0;
    for (let index = 0; index < this.timeData.length; index += 1) {
      peakSample = Math.max(peakSample, Math.abs(this.timeData[index]));
    }
    const instantPeakDb = amplitudeToDb(peakSample);
    this.meter.peak = instantPeakDb;
    if (Number.isFinite(instantPeakDb)) {
      this.meter.peakHold = Math.max(
        Number.isFinite(this.meter.peakHold) ? this.meter.peakHold : -Infinity,
        instantPeakDb,
      );
    } else if (Number.isFinite(this.meter.peakHold)) {
      this.meter.peakHold -= 11;
      if (this.meter.peakHold < SILENCE_DB) this.meter.peakHold = -Infinity;
    }

    const leftStats = this.channelStats(this.leftData);
    const rightStats = this.channelStats(this.rightData);
    this.meter.left = smoothDb(this.meter.left, leftStats.db);
    this.meter.right = smoothDb(this.meter.right, rightStats.db);
    if (leftStats.peak > 0.0001 || rightStats.peak > 0.0001) this.meter.lastSignalAt = now;
    if (now - this.meter.lastSignalAt > 0.28) {
      this.meter.left = -Infinity;
      this.meter.right = -Infinity;
      this.meter.frequency = 0;
    }

    const frequency = this.findFundamental();
    if (frequency > 0) {
      this.meter.frequency = this.meter.frequency > 0
        ? this.meter.frequency + (frequency - this.meter.frequency) * 0.38
        : frequency;
    } else if (now - this.meter.lastSignalAt > 0.12) {
      this.meter.frequency = 0;
    }
    this.freqHistory.push(this.meter.frequency);
    this.freqHistory.shift();

    return {
      frequency: this.meter.frequency,
      left: this.meter.left,
      right: this.meter.right,
      peak: this.meter.peak,
      peakHold: this.meter.peakHold,
      delayMs: this.getLatencyMs(),
      activeVoices: this.voices.size,
      sampleRate: this.context.sampleRate,
      state: this.context.state,
      hasSignal: peakSample > 0.0001,
      pan: (rightStats.rms - leftStats.rms) / Math.max(0.000001, rightStats.rms + leftStats.rms),
    };
  }

  channelStats(data) {
    let square = 0;
    let peak = 0;
    for (let index = 0; index < data.length; index += 1) {
      const sample = data[index];
      square += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      rms: Math.sqrt(square / Math.max(1, data.length)),
      peak,
      db: amplitudeToDb(Math.sqrt(square / Math.max(1, data.length))),
    };
  }

  findFundamental() {
    if (!this.frequencyData?.length || !this.context) return 0;
    const binWidth = this.context.sampleRate / this.mixAnalyser.fftSize;
    const minBin = Math.max(1, Math.floor(32 / binWidth));
    const maxBin = Math.min(this.frequencyData.length - 2, Math.ceil(125 / binWidth));
    let bestBin = -1;
    let bestDb = -200;
    for (let bin = minBin; bin <= maxBin; bin += 1) {
      if (this.frequencyData[bin] > bestDb) {
        bestDb = this.frequencyData[bin];
        bestBin = bin;
      }
    }
    if (bestBin < 1 || bestDb < -82) return 0;
    const alpha = this.frequencyData[bestBin - 1];
    const beta = this.frequencyData[bestBin];
    const gamma = this.frequencyData[bestBin + 1];
    const offset = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma || 1);
    return Math.max(20, Math.min(320, (bestBin + offset) * binWidth));
  }

  getLatencyMs() {
    if (!this.context) return 0;
    return ((this.context.baseLatency || 0) + (this.context.outputLatency || 0)) * 1000;
  }

  getScheduleSnapshot() {
    return this.queue.map(({ step, cycle, time }) => ({ step, cycle, time }));
  }

  getFrequencyHistory() {
    return this.freqHistory.slice();
  }
}
