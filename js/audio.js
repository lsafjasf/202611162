(function () {
  "use strict";

  const M = window.RailModel;
  const clamp = M.clamp;

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function () {
      state += 0x6D2B79F5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoiseBuffer(ctx, seconds, seed) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const random = seededRandom(seed);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let previous = 0;
      for (let i = 0; i < length; i += 1) {
        const white = random() * 2 - 1;
        previous = previous * 0.72 + white * 0.28;
        data[i] = white * 0.62 + previous * 0.38;
      }
    }
    return buffer;
  }

  function setTarget(param, value, now, timeConstant) {
    if (!param || !Number.isFinite(value)) return;
    param.setTargetAtTime(value, now, timeConstant);
  }

  class RailAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.limiter = null;
      this.trackBus = null;
      this.panner = null;
      this.filter = null;
      this.engineGain = null;
      this.oscillators = {};
      this.analysers = {};
      this.noiseBuffer = null;
      this.params = M.normalizeParams(M.DEFAULTS);
      this.nextJointX = -M.WORLD_HALF;
      this.clickCount = 0;
      this.lastMetrics = null;
      this.metrics = {
        peak: 0,
        peakL: 0,
        peakR: 0,
        rmsL: 0,
        rmsR: 0,
        dominantHz: 0,
        centroidHz: 0,
        bands: { low: 0, mid: 0, high: 0 },
        balance: 0,
        clip: false
      };
    }

    async init() {
      if (this.ctx) return this.ctx;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.ctx = new AudioContextClass({ latencyHint: "interactive" });
      this.noiseBuffer = makeNoiseBuffer(this.ctx, 4, 0x5eeda11);
      this.buildGraph();
      return this.ctx;
    }

    buildGraph() {
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.76;
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 8;
      this.limiter.ratio.value = 10;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.18;
      this.master.connect(this.limiter);
      this.limiter.connect(ctx.destination);

      this.trackBus = ctx.createGain();
      this.trackBus.gain.value = 1;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.Q.value = 0.72;
      this.filter.frequency.value = 2400;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0.0001;
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = 0;
      this.trackBus.connect(this.filter);
      this.filter.connect(this.engineGain);
      this.engineGain.connect(this.panner);
      this.panner.connect(this.master);

      const sourceGain = ctx.createGain();
      sourceGain.gain.value = 0.55;
      sourceGain.connect(this.trackBus);

      const hum = ctx.createOscillator();
      hum.type = "sine";
      hum.frequency.value = 48;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.2;
      hum.connect(humGain).connect(sourceGain);
      hum.start();

      const motor = ctx.createOscillator();
      motor.type = "sawtooth";
      motor.frequency.value = 96;
      motor.detune.value = -4;
      const motorGain = ctx.createGain();
      motorGain.gain.value = 0.09;
      motor.connect(motorGain).connect(sourceGain);
      motor.start();

      const rumble = ctx.createOscillator();
      rumble.type = "triangle";
      rumble.frequency.value = 25;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.16;
      rumble.connect(rumbleGain).connect(sourceGain);
      rumble.start();

      const horn = ctx.createOscillator();
      horn.type = "triangle";
      horn.frequency.value = 329.63;
      horn.detune.value = 3;
      const hornGain = ctx.createGain();
      hornGain.gain.value = 0.45;
      horn.connect(hornGain).connect(sourceGain);
      horn.start();

      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const noiseBand = ctx.createBiquadFilter();
      noiseBand.type = "bandpass";
      noiseBand.frequency.value = 420;
      noiseBand.Q.value = 0.62;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.16;
      noise.connect(noiseBand).connect(noiseGain).connect(sourceGain);
      noise.start();

      this.oscillators = { hum, motor, rumble, horn, noiseBand };

      const ambient = ctx.createBufferSource();
      ambient.buffer = this.noiseBuffer;
      ambient.loop = true;
      const ambientHigh = ctx.createBiquadFilter();
      ambientHigh.type = "highpass";
      ambientHigh.frequency.value = 42;
      const ambientLow = ctx.createBiquadFilter();
      ambientLow.type = "lowpass";
      ambientLow.frequency.value = 760;
      const ambientGain = ctx.createGain();
      ambientGain.gain.value = 0.055;
      const ambientPan = ctx.createStereoPanner();
      ambientPan.pan.value = -0.13;
      ambient.connect(ambientHigh).connect(ambientLow).connect(ambientGain);
      ambientGain.connect(ambientPan).connect(this.master);
      ambient.start();

      this.clickBus = ctx.createGain();
      this.clickBus.gain.value = 0.9;
      this.clickBus.connect(this.master);

      this.buildAnalysers();
    }

    buildAnalysers() {
      const ctx = this.ctx;
      const splitter = ctx.createChannelSplitter(2);
      this.limiter.connect(splitter);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      left.fftSize = 2048;
      right.fftSize = 2048;
      left.smoothingTimeConstant = 0.58;
      right.smoothingTimeConstant = 0.58;
      splitter.connect(left, 0);
      splitter.connect(right, 1);

      const mix = ctx.createAnalyser();
      mix.fftSize = 4096;
      mix.smoothingTimeConstant = 0.66;
      mix.minDecibels = -92;
      mix.maxDecibels = -12;
      this.limiter.connect(mix);

      const click = ctx.createAnalyser();
      click.fftSize = 1024;
      click.smoothingTimeConstant = 0.2;
      this.clickBus.connect(click);

      this.analysers = {
        left,
        right,
        mix,
        click,
        leftData: new Float32Array(left.fftSize),
        rightData: new Float32Array(right.fftSize),
        mixDb: new Float32Array(mix.frequencyBinCount),
        mixWave: new Float32Array(mix.fftSize)
      };
    }

    get state() {
      return this.ctx ? this.ctx.state : "idle";
    }

    get latencyMs() {
      if (!this.ctx) return 0;
      const base = Number(this.ctx.baseLatency) || 0;
      const schedulingQuantum = (128 * 2) / this.ctx.sampleRate;
      return (base + schedulingQuantum) * 1000;
    }

    async resume() {
      await this.init();
      if (this.ctx.state !== "running") await this.ctx.resume();
      return this.ctx.state;
    }

    async pause() {
      if (this.ctx && this.ctx.state === "running") await this.ctx.suspend();
    }

    setParams(params) {
      this.params = M.normalizeParams(params);
    }

    resetBeats(startX) {
      const start = startX === undefined ? -M.WORLD_HALF : startX;
      const index = Math.ceil((start + M.WORLD_HALF) / M.JOINT_SPACING);
      this.nextJointX = -M.WORLD_HALF + index * M.JOINT_SPACING;
      this.clickCount = 0;
    }

    update(scene) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const a = scene || M.acousticsAt(this.params, -M.WORLD_HALF);
      setTarget(this.oscillators.hum.frequency, a.engineHz, now, 0.055);
      setTarget(this.oscillators.motor.frequency, a.motorHz, now, 0.055);
      setTarget(this.oscillators.rumble.frequency, a.rumbleHz, now, 0.075);
      setTarget(this.oscillators.horn.frequency, a.hornHz, now, 0.05);
      setTarget(this.oscillators.noiseBand.frequency, clamp(a.filterHz * 0.27, 90, 1100), now, 0.08);
      setTarget(this.filter.frequency, clamp(a.filterHz, 240, 4800), now, 0.09);
      setTarget(this.panner.pan, a.active ? a.pan : 0, now, 0.045);
      const targetGain = a.active ? clamp(a.distanceGain * 0.93, 0.0001, 0.95) : 0.0001;
      setTarget(this.engineGain.gain, targetGain, now, 0.075);
      if (this.ctx.state === "running" && a.active) this.scheduleBeats(a.trainX, now);
    }

    scheduleBeats(trainX, now) {
      const speedMps = this.params.speedKmh / 3.6;
      const horizon = 0.16;
      let guard = 0;
      while (
        this.nextJointX <= trainX + speedMps * horizon &&
        this.nextJointX <= M.WORLD_HALF &&
        guard < 6
      ) {
        const delay = Math.max(0, (this.nextJointX - trainX) / speedMps);
        const joint = M.acousticsAt(this.params, this.nextJointX);
        this.scheduleClick(now + delay, joint, this.clickCount);
        this.nextJointX += M.JOINT_SPACING;
        this.clickCount += 1;
        guard += 1;
      }
    }

    scheduleClick(time, a, index) {
      const ctx = this.ctx;
      const pan = clamp(a.pan * (0.82 + this.params.gauge * 0.1), -1, 1);
      const level = clamp(a.clickGain * 0.55, 0.02, 0.5);
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, time);
      panner.connect(this.clickBus);

      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1450 + (index % 3) * 210;
      band.Q.value = 0.85;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(level, time + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.085);
      noise.connect(band).connect(envelope).connect(panner);
      noise.start(time, (index * 0.037) % 3.5, 0.12);
      noise.stop(time + 0.13);

      const clack = ctx.createOscillator();
      clack.type = "square";
      clack.frequency.setValueAtTime(88 + (index % 2) * 11, time);
      const clackGain = ctx.createGain();
      clackGain.gain.setValueAtTime(0.0001, time);
      clackGain.gain.exponentialRampToValueAtTime(level * 0.42, time + 0.003);
      clackGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      clack.connect(clackGain).connect(panner);
      clack.start(time);
      clack.stop(time + 0.065);
    }

    readMetrics() {
      if (!this.ctx || this.ctx.state !== "running") return this.lastMetrics || this.metrics;
      const data = this.analysers;
      data.left.getFloatTimeDomainData(data.leftData);
      data.right.getFloatTimeDomainData(data.rightData);
      data.mix.getFloatFrequencyData(data.mixDb);

      let peakL = 0;
      let peakR = 0;
      let sumL = 0;
      let sumR = 0;
      for (let i = 0; i < data.leftData.length; i += 1) {
        const l = data.leftData[i];
        const r = data.rightData[i];
        peakL = Math.max(peakL, Math.abs(l));
        peakR = Math.max(peakR, Math.abs(r));
        sumL += l * l;
        sumR += r * r;
      }
      const rmsL = Math.sqrt(sumL / data.leftData.length);
      const rmsR = Math.sqrt(sumR / data.rightData.length);
      const balance = (rmsR - rmsL) / Math.max(rmsL + rmsR, 1e-7);

      const bins = data.mixDb;
      const binHz = this.ctx.sampleRate / data.mix.fftSize;
      const minBin = Math.max(1, Math.floor(35 / binHz));
      const maxBin = Math.min(bins.length - 2, Math.floor(1800 / binHz));
      let maxDb = -Infinity;
      let maxBinIndex = minBin;
      let weighted = 0;
      let weight = 0;
      const bands = { low: 0, mid: 0, high: 0 };
      const bandCounts = { low: 0, mid: 0, high: 0 };

      for (let i = minBin; i <= maxBin; i += 1) {
        const db = bins[i];
        const magnitude = Math.pow(10, db / 20);
        const hz = i * binHz;
        weighted += hz * magnitude;
        weight += magnitude;
        if (db > maxDb) {
          maxDb = db;
          maxBinIndex = i;
        }
        let key = "high";
        if (hz < 180) key = "low";
        else if (hz < 1400) key = "mid";
        bands[key] += magnitude;
        bandCounts[key] += 1;
      }

      const leftDb = bins[maxBinIndex - 1] || maxDb;
      const rightDb = bins[maxBinIndex + 1] || maxDb;
      const denominator = leftDb - 2 * maxDb + rightDb;
      const offset = denominator !== 0 ? 0.5 * (leftDb - rightDb) / denominator : 0;
      const dominantHz = (maxBinIndex + clamp(offset, -0.5, 0.5)) * binHz;
      const normalizeBand = (sum, count) => clamp((Math.log10((sum / Math.max(count, 1)) + 1e-8) + 4) / 4, 0, 1);

      const metrics = {
        peak: Math.max(peakL, peakR),
        peakL,
        peakR,
        rmsL,
        rmsR,
        dominantHz,
        centroidHz: weight > 0 ? weighted / weight : 0,
        bands: {
          low: normalizeBand(bands.low, bandCounts.low),
          mid: normalizeBand(bands.mid, bandCounts.mid),
          high: normalizeBand(bands.high, bandCounts.high)
        },
        balance,
        clip: peakL >= 0.989 || peakR >= 0.989
      };
      this.lastMetrics = metrics;
      this.metrics = metrics;
      return metrics;
    }

    getFrequencyData() {
      if (!this.ctx) return new Float32Array(0);
      const bins = new Uint8Array(this.analysers.mix.frequencyBinCount);
      this.analysers.mix.getByteFrequencyData(bins);
      return bins;
    }
  }

  window.RailAudio = RailAudio;
  window.RailDsp = { seededRandom, makeNoiseBuffer };
})();
