import { clamp, sceneById } from "./core.js";

const SCENE_TUNING = {
  aurora: { root: 55, chord: [1, 1.5, 2.02, 3.01], cutoff: 720, noise: 0.045 },
  ember: { root: 49, chord: [1, 1.335, 1.98, 2.67], cutoff: 470, noise: 0.065 },
};

export class AmbientAudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.analyser = null;
    this.exportDestination = null;
    this.sources = [];
    this.sessionGain = null;
    this.muted = false;
    this.generation = 0;
    this.lastStart = null;
    this.failed = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.failed = true;
        throw new Error("当前浏览器不支持 Web Audio");
      }
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 15;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.24;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.82;
      this.exportDestination = this.context.createMediaStreamDestination();
      this.master.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.context.destination);
      this.compressor.connect(this.exportDestination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  get currentTime() {
    return this.context ? this.context.currentTime : performance.now() / 1000;
  }

  get mediaStream() {
    return this.exportDestination?.stream || null;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.context.currentTime, 0.02);
    }
  }

  makeNoiseBuffer(seconds = 2) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[index] = last * 2.2;
    }
    return buffer;
  }

  register(node, stopAt) {
    this.sources.push(node);
    try {
      node.stop(stopAt);
    } catch {
      // Some constant sources are stopped manually on teardown.
    }
    if (node.onended !== undefined) {
      const previous = node.onended;
      node.onended = (event) => {
        this.sources = this.sources.filter((source) => source !== node);
        if (previous) previous.call(node, event);
      };
    }
  }

  scheduleKick(contextStart, offset, downbeat, gain) {
    const at = contextStart + offset;
    const osc = this.context.createOscillator();
    const envelope = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(downbeat ? 125 : 190, at);
    osc.frequency.exponentialRampToValueAtTime(downbeat ? 43 : 95, at + (downbeat ? 0.2 : 0.055));
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(downbeat ? 0.34 * gain : 0.09 * gain, at + 0.007);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + (downbeat ? 0.28 : 0.09));
    osc.connect(envelope);
    envelope.connect(this.sessionGain);
    osc.start(at);
    osc.stop(at + (downbeat ? 0.3 : 0.11));
    this.sources.push(osc);
  }

  scheduleTick(contextStart, offset, gain) {
    const at = contextStart + offset;
    const osc = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const envelope = this.context.createGain();
    osc.type = "triangle";
    osc.frequency.value = 1380;
    filter.type = "highpass";
    filter.frequency.value = 900;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.028 * gain, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.055);
    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.sessionGain);
    osc.start(at);
    osc.stop(at + 0.07);
    this.sources.push(osc);
  }

  scheduleAmbience(contextStart, playDuration, tuning) {
    const fadeIn = 0.04;
    const fadeOut = Math.min(0.12, Math.max(0.02, playDuration * 0.1));
    const chord = tuning.chord;
    chord.forEach((ratio, index) => {
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      osc.type = index < 2 ? "sine" : "triangle";
      osc.frequency.value = tuning.root * ratio;
      osc.detune.value = index % 2 ? 4.5 : -3.5;
      filter.type = "lowpass";
      filter.frequency.value = tuning.cutoff + index * 55;
      filter.Q.value = 0.7;
      const level = index === 0 ? 0.07 : 0.025 / (index + 0.5);
      gain.gain.setValueAtTime(0.0001, contextStart);
      gain.gain.linearRampToValueAtTime(level, contextStart + fadeIn);
      gain.gain.setValueAtTime(level, contextStart + Math.max(fadeIn, playDuration - fadeOut));
      gain.gain.linearRampToValueAtTime(0.0001, contextStart + playDuration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sessionGain);
      osc.start(contextStart);
      osc.stop(contextStart + playDuration + 0.03);
      this.sources.push(osc);
    });

    const noise = this.context.createBufferSource();
    const noiseFilter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    noise.buffer = this.makeNoiseBuffer();
    noise.loop = true;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 720;
    noiseFilter.Q.value = 0.42;
    noiseGain.gain.setValueAtTime(0.0001, contextStart);
    noiseGain.gain.linearRampToValueAtTime(tuning.noise, contextStart + 0.18);
    noiseGain.gain.setValueAtTime(tuning.noise, contextStart + Math.max(0.18, playDuration - fadeOut));
    noiseGain.gain.linearRampToValueAtTime(0.0001, contextStart + playDuration);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.sessionGain);
    noise.start(contextStart);
    noise.stop(contextStart + playDuration + 0.03);
    this.sources.push(noise);

    const shimmer = this.context.createOscillator();
    const shimmerGain = this.context.createGain();
    shimmer.type = "sine";
    shimmer.frequency.value = tuning.root * 8.02;
    shimmerGain.gain.value = 0.004;
    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.sessionGain);
    shimmer.start(contextStart);
    shimmer.stop(contextStart + playDuration + 0.03);
    this.sources.push(shimmer);

  }

  async startAt(project, from, options = {}) {
    await this.ensure();
    this.stop("seek");
    const generation = ++this.generation;
    const contextStart = this.context.currentTime + (options.immediate ? 0.005 : 0.035);
    const fromTime = clamp(from, project.inPoint, project.outPoint);
    const playDuration = Math.max(0, project.outPoint - fromTime);
    if (playDuration < 0.01) return { contextStart, generation, duration: 0 };

    this.sessionGain = this.context.createGain();
    const gainValue = options.export ? 0.78 : 1;
    this.sessionGain.gain.value = gainValue;
    this.sessionGain.connect(this.master);

    const scene = sceneById(project, project.activeScene);
    const tuning = SCENE_TUNING[scene.id] || SCENE_TUNING.aurora;
    const ambienceDelay = Math.max(0, project.audio.start - fromTime);
    const ambienceDuration = Math.max(0, project.outPoint - Math.max(fromTime, project.audio.start));
    if (ambienceDuration > 0.01) {
      this.scheduleAmbience(contextStart + ambienceDelay, ambienceDuration, tuning);
    }

    const beatDuration = 60 / Math.max(1, project.audio.bpm);
    const firstBeat = Math.ceil((fromTime - project.audio.start - 1e-7) / beatDuration);
    const lastBeatTime = project.outPoint + 1e-7;
    for (
      let beat = Math.max(0, firstBeat);
      project.audio.start + beat * beatDuration <= lastBeatTime;
      beat += 1
    ) {
      const beatTime = project.audio.start + beat * beatDuration;
      if (beatTime < fromTime - 1e-7) continue;
      const offset = Math.max(0, beatTime - fromTime);
      const downbeat = beat % project.audio.beatsPerBar === 0;
      this.scheduleKick(contextStart, offset, downbeat, project.audio.gain);
      if (downbeat) {
        this.scheduleKick(contextStart, offset + beatDuration / 2, false, project.audio.gain * 0.5);
      }
      this.scheduleTick(contextStart, offset, project.audio.gain);
    }

    const stopAt = contextStart + playDuration + 0.08;
    setTimeout(() => {
      if (generation === this.generation) this.stop("range-end");
    }, Math.max(0, (stopAt - this.context.currentTime) * 1000));

    this.lastStart = {
      contextStart,
      from: fromTime,
      generation,
      sceneId: project.activeScene,
    };
    return this.lastStart;
  }

  stop(reason = "manual") {
    this.generation += 1;
    const nodes = this.sources;
    this.sources = [];
    nodes.forEach((node) => {
      try {
        node.stop(this.context?.currentTime || 0);
      } catch {
        // A node might already have reached its scheduled end.
      }
    });
    if (this.sessionGain && this.context) {
      const oldGain = this.sessionGain;
      oldGain.gain.cancelScheduledValues(this.context.currentTime);
      oldGain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.008);
      setTimeout(() => oldGain.disconnect(), 60);
    }
    this.sessionGain = null;
    return { reason, time: this.context?.currentTime || 0 };
  }

  meter() {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
    return clamp(peak * 1.8, 0, 1);
  }
}
