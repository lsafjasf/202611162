(function () {
  "use strict";

  const { config, utils } = window.Echo;
  const { clamp, sourceIsOn, sourceFrequency, exportDuration } = utils;

  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  function rms(data) {
    if (!data.length) return 0;
    let sum = 0;
    for (let index = 0; index < data.length; index += 1) {
      sum += data[index] * data[index];
    }
    return Math.sqrt(sum / data.length);
  }

  function peak(data) {
    let value = 0;
    for (let index = 0; index < data.length; index += 1) {
      value = Math.max(value, Math.abs(data[index]));
    }
    return value;
  }

  function toDb(value) {
    return 20 * Math.log10(Math.max(value, 1e-8));
  }

  function mulberry32(seed) {
    return function () {
      let value = seed += 0x6d2b79f5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function createNoiseBuffer(context, seconds, seed, channels = 2) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(channels, length, context.sampleRate);
    const random = mulberry32(seed);
    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        const white = random() * 2 - 1;
        last = last * 0.94 + white * 0.06;
        data[index] = last * 1.9;
      }
    }
    return buffer;
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.running = false;
      this.paused = false;
      this.params = { ...config.DEFAULT_PARAMS };
      this.sourceVoices = [];
      this.sourceStates = new Array(config.SOURCES.length).fill(false);
      this.listener = { ...config.START };
      this.onBeat = null;
      this.pulseCount = 0;
      this.lastPulseAt = null;
      this.lastPulseTimes = [];
      this.nextBeatTime = 0;
      this.schedulerId = null;
      this.sourceStatesAt = new Array(config.SOURCES.length).fill(false);
      this.fftData = null;
      this.leftData = null;
      this.rightData = null;
    }

    async start(params = this.params) {
      if (this.context) {
        await this.resume();
        return;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.params = { ...params };
      this.buildLiveGraph();
      await this.context.resume();
      this.running = true;
      this.paused = false;
      this.startScheduler();
      this.applyParams(this.params, 0.08);
    }

    buildLiveGraph() {
      const context = this.context;
      this.bus = context.createGain();
      this.bus.gain.value = 0.48;
      this.master = context.createGain();
      this.master.gain.value = this.outputGain(this.params.gain);
      this.balance = context.createStereoPanner();
      this.balance.pan.value = this.params.balance / 100;
      this.limiter = context.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 5;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;

      this.bus.connect(this.master);
      this.master.connect(this.balance);
      this.balance.connect(this.limiter);
      this.limiter.connect(context.destination);

      this.splitter = context.createChannelSplitter(2);
      this.analyserLeft = context.createAnalyser();
      this.analyserRight = context.createAnalyser();
      this.analyserLeft.fftSize = 2048;
      this.analyserRight.fftSize = 2048;
      this.analyserLeft.smoothingTimeConstant = 0.25;
      this.analyserRight.smoothingTimeConstant = 0.25;
      this.balance.connect(this.splitter);
      this.splitter.connect(this.analyserLeft, 0);
      this.splitter.connect(this.analyserRight, 1);

      this.analyserMix = context.createAnalyser();
      this.analyserMix.fftSize = 4096;
      this.analyserMix.smoothingTimeConstant = 0.5;
      this.balance.connect(this.analyserMix);

      this.leftData = new Float32Array(this.analyserLeft.fftSize);
      this.rightData = new Float32Array(this.analyserRight.fftSize);
      this.fftData = new Uint8Array(this.analyserMix.frequencyBinCount);

      const noise = context.createBufferSource();
      noise.buffer = createNoiseBuffer(context, 3.1, 683);
      noise.loop = true;
      this.ambientFilter = context.createBiquadFilter();
      this.ambientFilter.type = "lowpass";
      this.ambientFilter.frequency.value = this.params.frequency * 3.4;
      this.ambientFilter.Q.value = 0.75;
      this.ambientGain = context.createGain();
      this.ambientGain.gain.value = 0.026;
      noise.connect(this.ambientFilter);
      this.ambientFilter.connect(this.ambientGain);
      this.ambientGain.connect(this.bus);
      noise.start();
      this.noise = noise;

      this.reflectionDelay = context.createDelay(1);
      this.reflectionDelay.delayTime.value = this.params.delay / 1000;
      this.reflectionGain = context.createGain();
      this.reflectionGain.gain.value = 0.13;
      this.reflectionPan = context.createStereoPanner();
      this.reflectionPan.pan.value = -this.params.balance / 150;
      this.reflectionDelay.connect(this.reflectionGain);
      this.reflectionGain.connect(this.reflectionPan);
      this.reflectionPan.connect(this.bus);
      this.bus.connect(this.reflectionDelay);

      this.createSourceVoices();
    }

    createSourceVoices() {
      config.SOURCES.forEach((source, index) => {
        const carrier = this.context.createOscillator();
        carrier.type = index % 2 === 0 ? "sine" : "triangle";
        carrier.frequency.value = sourceFrequency(source, this.params);
        const overtone = this.context.createOscillator();
        overtone.type = "sine";
        overtone.frequency.value = sourceFrequency(source, this.params) * 2.01;

        const overtoneGain = this.context.createGain();
        overtoneGain.gain.value = 0.11;
        const voiceGain = this.context.createGain();
        voiceGain.gain.value = 0;
        const panner = this.context.createStereoPanner();
        panner.pan.value = this.sourcePan(index);
        const echoSend = this.context.createGain();
        echoSend.gain.value = 0.025;

        carrier.connect(voiceGain);
        overtone.connect(overtoneGain);
        overtoneGain.connect(voiceGain);
        voiceGain.connect(panner);
        panner.connect(this.bus);
        panner.connect(echoSend);
        echoSend.connect(this.reflectionDelay);
        carrier.start();
        overtone.start();

        this.sourceVoices.push({
          source,
          carrier,
          overtone,
          voiceGain,
          panner,
          echoSend,
          level: 0,
          targetLevel: 0
        });
      });
    }

    sourcePan(index) {
      const source = config.SOURCES[index];
      const spatial = clamp((source.x - this.listener.x) / 430, -1, 1);
      const balance = this.params.balance / 100;
      return clamp(spatial * 0.76 + balance * 0.88, -1, 1);
    }

    outputGain(gainDb) {
      return clamp(Math.pow(gainDb / 24, 1.45) * 0.105, 0, 0.38);
    }

    applyParams(params, ramp = 0.2) {
      this.params = { ...params };
      if (!this.context) return;
      const now = this.context.currentTime;
      const glide = ramp || 0.001;
      this.master.gain.setTargetAtTime(this.outputGain(params.gain), now, glide / 3);
      this.balance.pan.setTargetAtTime(params.balance / 100, now, glide / 3);
      this.reflectionDelay.delayTime.setTargetAtTime(params.delay / 1000, now, glide / 3);
      this.reflectionPan.pan.setTargetAtTime(-params.balance / 150, now, glide / 3);
      this.ambientFilter.frequency.setTargetAtTime(params.frequency * 3.4, now, glide / 3);
      this.sourceVoices.forEach((voice, index) => {
        const frequency = sourceFrequency(voice.source, params);
        voice.carrier.frequency.setTargetAtTime(frequency, now, glide / 3);
        voice.overtone.frequency.setTargetAtTime(frequency * 2.01, now, glide / 3);
        voice.panner.pan.setTargetAtTime(this.sourcePan(index), now, glide / 3);
      });
      this.nextBeatTime = Math.min(this.nextBeatTime, now + 0.08);
    }

    updateListener(listener) {
      this.listener = { ...listener };
      if (!this.context) return;
      const now = this.context.currentTime;
      this.sourceVoices.forEach((voice, index) => {
        voice.panner.pan.setTargetAtTime(this.sourcePan(index), now, 0.08);
      });
    }

    setSourceStates(states) {
      this.sourceStates = [...states];
      if (!this.context) return;
      const now = this.context.currentTime;
      this.sourceVoices.forEach((voice, index) => {
        voice.targetLevel = states[index] ? 0.072 + index * 0.004 : 0;
        voice.voiceGain.gain.setTargetAtTime(voice.targetLevel, now, 0.035);
        voice.echoSend.gain.setTargetAtTime(states[index] ? 0.035 : 0, now, 0.05);
      });
    }

    updateAcoustic(field) {
      if (!this.context || !field.sourceLevels) return;
      const now = this.context.currentTime;
      this.sourceVoices.forEach((voice, index) => {
        const active = this.sourceStates[index];
        const sourceLevel = field.sourceLevels[index] || 0;
        voice.voiceGain.gain.setTargetAtTime(
          active ? clamp(0.024 + sourceLevel * 0.075, 0.018, 0.125) : 0.0001,
          now,
          0.08
        );
        voice.echoSend.gain.setTargetAtTime(
          active ? clamp(sourceLevel * 0.045, 0.008, 0.07) : 0.0001,
          now,
          0.09
        );
      });
    }

    startScheduler() {
      if (this.schedulerId) clearInterval(this.schedulerId);
      this.nextBeatTime = this.context.currentTime + 0.11;
      this.schedulerId = setInterval(() => this.scheduleAhead(), 25);
    }

    scheduleAhead() {
      if (!this.context || this.paused) return;
      const now = this.context.currentTime;
      while (this.nextBeatTime < now + 0.12) {
        const when = this.nextBeatTime;
        this.schedulePulse(when);
        const wait = Math.max(0, (when - now) * 1000);
        window.setTimeout(() => {
          if (!this.paused) {
            this.lastPulseAt = this.context.currentTime;
            this.pulseCount += 1;
            this.lastPulseTimes.push(this.context.currentTime);
            if (this.lastPulseTimes.length > 32) this.lastPulseTimes.shift();
            if (this.onBeat) this.onBeat(this.context.currentTime);
          }
        }, wait);
        this.nextBeatTime += 60 / this.params.tempo;
      }
    }

    schedulePulse(when) {
      const context = this.context;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const pan = context.createStereoPanner();
      const echoSend = context.createGain();
      const frequency = this.params.frequency * 2.2;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.74, when + 0.12);
      envelope.gain.setValueAtTime(0.0001, when);
      envelope.gain.exponentialRampToValueAtTime(0.2, when + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
      pan.pan.value = clamp((this.listener.x - 500) / 500 * 0.45 + this.params.balance / 120, -1, 1);
      echoSend.gain.value = 0.08;
      oscillator.connect(envelope);
      envelope.connect(pan);
      pan.connect(this.bus);
      pan.connect(echoSend);
      echoSend.connect(this.reflectionDelay);
      oscillator.start(when);
      oscillator.stop(when + 0.24);
    }

    pulse() {
      if (!this.context || this.paused) return false;
      this.schedulePulse(this.context.currentTime + 0.01);
      this.lastPulseAt = this.context.currentTime;
      this.pulseCount += 1;
      this.lastPulseTimes.push(this.context.currentTime);
      if (this.lastPulseTimes.length > 32) this.lastPulseTimes.shift();
      return true;
    }

    async setPaused(shouldPause) {
      if (!this.context) return false;
      this.paused = shouldPause;
      if (shouldPause) {
        await this.context.suspend();
      } else {
        await this.context.resume();
        this.nextBeatTime = this.context.currentTime + 0.08;
      }
      return this.paused;
    }

    restart() {
      this.pulseCount = 0;
      this.lastPulseAt = null;
      this.lastPulseTimes = [];
      if (this.context) this.nextBeatTime = this.context.currentTime + 0.11;
      this.setSourceStates(new Array(config.SOURCES.length).fill(false));
    }

    async resume() {
      if (!this.context) return;
      if (this.context.state === "suspended") await this.context.resume();
      this.paused = false;
    }

    getActualSettings() {
      if (!this.context || !this.sourceVoices.length) {
        return {
          pitch: this.params.frequency,
          balance: this.params.balance,
          delayMs: this.params.delay,
          gain: this.params.gain,
          tempo: this.params.tempo
        };
      }
      return {
        pitch: this.sourceVoices[3].carrier.frequency.value,
        balance: this.balance.pan.value * 100,
        delayMs: this.reflectionDelay.delayTime.value * 1000,
        gain: this.params.gain,
        tempo: this.params.tempo
      };
    }

    getTelemetry() {
      if (!this.context) return null;
      this.analyserLeft.getFloatTimeDomainData(this.leftData);
      this.analyserRight.getFloatTimeDomainData(this.rightData);
      this.analyserMix.getByteFrequencyData(this.fftData);
      const leftRms = rms(this.leftData);
      const rightRms = rms(this.rightData);
      const leftPeak = peak(this.leftData);
      const rightPeak = peak(this.rightData);
      let dominantBin = 0;
      let dominantValue = 0;
      const minBin = Math.floor(45 * this.analyserMix.fftSize / this.context.sampleRate);
      const maxBin = Math.min(this.fftData.length - 1, Math.floor(850 * this.analyserMix.fftSize / this.context.sampleRate));
      for (let bin = minBin; bin <= maxBin; bin += 1) {
        if (this.fftData[bin] > dominantValue) {
          dominantValue = this.fftData[bin];
          dominantBin = bin;
        }
      }
      const dominantHz = dominantValue > 10
        ? dominantBin * this.context.sampleRate / this.analyserMix.fftSize
        : this.params.frequency;
      return {
        contextState: this.context.state,
        paused: this.paused,
        leftDb: toDb(leftPeak),
        rightDb: toDb(rightPeak),
        leftRmsDb: toDb(leftRms),
        rightRmsDb: toDb(rightRms),
        peakDb: toDb(Math.max(leftPeak, rightPeak)),
        dominantHz,
        pulseCount: this.pulseCount,
        pulseInterval: 60 / this.params.tempo,
        lastPulseTimes: [...this.lastPulseTimes],
        sourceGains: this.sourceVoices.map((voice) => voice.voiceGain.gain.value),
        actual: this.getActualSettings()
      };
    }

    destroy() {
      if (this.schedulerId) clearInterval(this.schedulerId);
      if (this.context) this.context.close();
      this.context = null;
      this.running = false;
      this.paused = false;
    }
  }

  function offlineOutputGain(gainDb) {
    if (gainDb <= 0) return 0;
    return Math.pow(gainDb / 24, 1.45) * 1.25;
  }

  function applyGateAutomation(voiceGain, source, duration) {
    const step = 0.025;
    voiceGain.gain.setValueAtTime(sourceIsOn(source, 0) ? 0.068 : 0.0001, 0);
    for (let time = step; time < duration; time += step) {
      const value = sourceIsOn(source, time) ? 0.068 : 0.0001;
      voiceGain.gain.linearRampToValueAtTime(value, time);
    }
    voiceGain.gain.linearRampToValueAtTime(0.0001, duration);
  }

  async function renderExport(params) {
    const OfflineClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineClass) throw new Error("当前浏览器不支持离线音频渲染");
    const sampleRate = config.EXPORT_SAMPLE_RATE;
    const duration = exportDuration(params);
    const length = Math.ceil(duration * sampleRate);
    const context = new OfflineClass(2, length, sampleRate);
    const output = context.createGain();
    const balance = context.createStereoPanner();
    const masterLevel = offlineOutputGain(params.gain);
    output.gain.setValueAtTime(0.0001, 0);
    output.gain.linearRampToValueAtTime(masterLevel, 0.045);
    output.gain.setValueAtTime(masterLevel, Math.max(0.05, duration - 0.06));
    output.gain.linearRampToValueAtTime(0.0001, duration);
    balance.pan.value = params.balance / 100;
    output.connect(balance);
    balance.connect(context.destination);

    const bus = context.createGain();
    bus.gain.value = 0.82;
    bus.connect(output);

    const noise = context.createBufferSource();
    noise.buffer = createNoiseBuffer(context, Math.min(3.2, duration + 0.2), 683);
    noise.loop = true;
    const ambientFilter = context.createBiquadFilter();
    ambientFilter.type = "lowpass";
    ambientFilter.frequency.value = params.frequency * 3.3;
    const ambientGain = context.createGain();
    ambientGain.gain.value = 0.032;
    noise.connect(ambientFilter);
    ambientFilter.connect(ambientGain);
    ambientGain.connect(bus);
    noise.start(0);

    const sharedDelay = context.createDelay(1);
    sharedDelay.delayTime.value = params.delay / 1000;
    const echoGain = context.createGain();
    echoGain.gain.value = 0.14;
    sharedDelay.connect(echoGain);
    echoGain.connect(bus);

    config.SOURCES.forEach((source, index) => {
      const carrier = context.createOscillator();
      carrier.type = index % 2 === 0 ? "sine" : "triangle";
      carrier.frequency.value = sourceFrequency(source, params);
      const overtone = context.createOscillator();
      overtone.type = "sine";
      overtone.frequency.value = sourceFrequency(source, params) * 2.01;
      const overtoneGain = context.createGain();
      overtoneGain.gain.value = 0.12;
      const voiceGain = context.createGain();
      const panner = context.createStereoPanner();
      panner.pan.value = clamp((source.x - config.START.x) / 560, -0.82, 0.82);
      const echoSend = context.createGain();
      echoSend.gain.value = 0.08;
      applyGateAutomation(voiceGain, source, duration);
      carrier.connect(voiceGain);
      overtone.connect(overtoneGain);
      overtoneGain.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(bus);
      panner.connect(echoSend);
      echoSend.connect(sharedDelay);
      carrier.start(0);
      overtone.start(0);
      carrier.stop(duration);
      overtone.stop(duration);
    });

    const beatInterval = 60 / params.tempo;
    for (let beat = 0, time = 0.18; time < duration - 0.08; beat += 1, time += beatInterval) {
      const ping = context.createOscillator();
      const envelope = context.createGain();
      const panner = context.createStereoPanner();
      const echoSend = context.createGain();
      const pitch = params.frequency * 2.2;
      ping.type = "sine";
      ping.frequency.setValueAtTime(pitch, time);
      ping.frequency.exponentialRampToValueAtTime(pitch * 0.72, time + 0.12);
      envelope.gain.setValueAtTime(0.0001, time);
      envelope.gain.exponentialRampToValueAtTime(0.32, time + 0.007);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
      panner.pan.value = beat % 2 === 0 ? -0.42 : 0.42;
      echoSend.gain.value = 0.2;
      ping.connect(envelope);
      envelope.connect(panner);
      panner.connect(bus);
      panner.connect(echoSend);
      echoSend.connect(sharedDelay);
      ping.start(time);
      ping.stop(time + 0.22);
    }

    const rendered = await context.startRendering();
    const report = analyzeStereoBuffer(rendered, params);
    const wav = encodeWav(rendered);
    report.wav = inspectWav(wav);
    report.fileDuration = report.wav.duration;
    report.filePeakLeft = report.wav.peakLeft;
    report.filePeakRight = report.wav.peakRight;
    return {
      buffer: rendered,
      report,
      wav,
      blob: new Blob([wav], { type: "audio/wav" })
    };
  }

  function analyzeStereoBuffer(buffer, params) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let peakLeft = 0;
    let peakRight = 0;
    let sumLeft = 0;
    let sumRight = 0;
    let sumDiff = 0;
    let clippedSamples = 0;
    for (let index = 0; index < left.length; index += 1) {
      const l = left[index];
      const r = right[index];
      peakLeft = Math.max(peakLeft, Math.abs(l));
      peakRight = Math.max(peakRight, Math.abs(r));
      sumLeft += l * l;
      sumRight += r * r;
      sumDiff += (l - r) * (l - r);
      if (Math.abs(l) >= 0.999 || Math.abs(r) >= 0.999) clippedSamples += 1;
    }
    const rmsLeft = Math.sqrt(sumLeft / Math.max(1, left.length));
    const rmsRight = Math.sqrt(sumRight / Math.max(1, right.length));
    const diffRms = Math.sqrt(sumDiff / Math.max(1, left.length));
    const silent = Math.max(peakLeft, peakRight) < 0.0001 || Math.max(rmsLeft, rmsRight) < 0.0001;
    const missing = peakLeft < 0.0001 || peakRight < 0.0001;
    const clipping = clippedSamples > 0 || Math.max(peakLeft, peakRight) >= 0.999;
    const checks = {
      silence: {
        pass: !silent,
        label: silent ? "检测到静音" : "信号有效",
        detail: `RMS ${toDb(Math.max(rmsLeft, rmsRight)).toFixed(1)} dBFS`
      },
      clipping: {
        pass: !clipping,
        label: clipping ? `削波 ${clippedSamples} 样本` : "无削波",
        detail: `PEAK ${toDb(Math.max(peakLeft, peakRight)).toFixed(2)} dBFS`
      },
      channels: {
        pass: !missing,
        label: missing ? "单侧声道缺失" : "L / R 完整",
        detail: `L ${toDb(peakLeft).toFixed(1)} / R ${toDb(peakRight).toFixed(1)} dBFS`
      }
    };
    return {
      duration: buffer.duration,
      peak: Math.max(peakLeft, peakRight),
      peakLeft,
      peakRight,
      peakDb: toDb(Math.max(peakLeft, peakRight)),
      peakLeftDb: toDb(peakLeft),
      peakRightDb: toDb(peakRight),
      rmsLeft,
      rmsRight,
      diffRms,
      stereoSpread: diffRms / Math.max(1e-8, Math.max(rmsLeft, rmsRight)),
      clippedSamples,
      keyPitch: params.frequency,
      delayMs: params.delay,
      balance: params.balance,
      checks,
      canExport: Object.values(checks).every((check) => check.pass)
    };
  }

  function encodeWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const frameCount = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frameCount * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    let offset = 0;

    function writeString(value) {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
      offset += value.length;
    }

    writeString("RIFF");
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString("WAVE");
    writeString("fmt ");
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channels, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * blockAlign, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, bytesPerSample * 8, true);
    offset += 2;
    writeString("data");
    view.setUint32(offset, dataSize, true);
    offset += 4;

    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : left;
    for (let frame = 0; frame < frameCount; frame += 1) {
      view.setInt16(offset, toInt16(left[frame]), true);
      offset += 2;
      view.setInt16(offset, toInt16(right[frame]), true);
      offset += 2;
    }
    return arrayBuffer;
  }

  function toInt16(value) {
    const sample = clamp(value, -1, 1);
    return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  function inspectWav(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    const dataSize = view.getUint32(40, true);
    const bytesPerFrame = channels * bitsPerSample / 8;
    const frames = dataSize / bytesPerFrame;
    let peakLeft = 0;
    let peakRight = 0;
    if (bitsPerSample === 16) {
      for (let offset = 44, frame = 0; frame < frames; frame += 1, offset += bytesPerFrame) {
        peakLeft = Math.max(peakLeft, Math.abs(view.getInt16(offset, true)) / 32768);
        if (channels > 1) {
          peakRight = Math.max(peakRight, Math.abs(view.getInt16(offset + 2, true)) / 32768);
        }
      }
    }
    return {
      channels,
      sampleRate,
      bitsPerSample,
      frames,
      dataBytes: dataSize,
      duration: frames / sampleRate,
      peakLeft,
      peakRight
    };
  }

  function downloadWav(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  window.Echo.AudioEngine = AudioEngine;
  window.Echo.audio = {
    renderExport,
    analyzeStereoBuffer,
    encodeWav,
    inspectWav,
    downloadWav,
    createNoiseBuffer,
    offlineOutputGain
  };
})();
