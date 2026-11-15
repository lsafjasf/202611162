(function () {
  "use strict";

  const DSP = window.SignalDSP;
  const SAMPLE_RATE = 48000;
  const SOURCE_DURATION = 10;

  const DEFAULTS = Object.freeze({
    balance: 0.12,
    width: 1,
    beatAccent: 0.62,
    hpfEnabled: true,
    hpfFreq: 90,
    hpfQ: 0.8,
    notchEnabled: true,
    notchFreq: 1000,
    notchQ: 7,
    gateEnabled: true,
    gateThreshold: -38,
    gateAttack: 4,
    gateRelease: 110,
    gateLookahead: 8,
    clipEnabled: true,
    clipDrive: 8,
    clipMix: 100,
    masterGain: -6,
  });

  const gateWorkletCode = `
    class PhaseGateProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: "threshold", defaultValue: -38, minValue: -100, maxValue: 0, automationRate: "k-rate" },
          { name: "attack", defaultValue: 4, minValue: 0.1, maxValue: 200, automationRate: "k-rate" },
          { name: "release", defaultValue: 110, minValue: 1, maxValue: 2000, automationRate: "k-rate" }
        ];
      }
      constructor() {
        super();
        this.envelope = 0;
      }
      process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0) return true;
        const frames = output[0].length;
        const threshold = Math.pow(10, parameters.threshold[0] / 20);
        const attackCoefficient = 1 - Math.exp(-1 / (sampleRate * parameters.attack[0] / 1000));
        const releaseCoefficient = 1 - Math.exp(-1 / (sampleRate * parameters.release[0] / 1000));
        for (let frame = 0; frame < frames; frame += 1) {
          let detector = 0;
          for (let channel = 0; channel < input.length; channel += 1) {
            detector = Math.max(detector, Math.abs(input[channel][frame] || 0));
          }
          const target = detector > threshold ? 1 : 0;
          const coefficient = target > this.envelope ? attackCoefficient : releaseCoefficient;
          this.envelope += (target - this.envelope) * coefficient;
          for (let channel = 0; channel < output.length; channel += 1) {
            output[channel][frame] = (input[channel] ? input[channel][frame] : 0) * this.envelope;
          }
        }
        return true;
      }
    }
    registerProcessor("phase-gate", PhaseGateProcessor);
  `;

  let gateModuleUrl = "";
  const workletSupport = new WeakMap();

  function getGateModuleUrl() {
    if (!gateModuleUrl) {
      gateModuleUrl = URL.createObjectURL(
        new Blob([gateWorkletCode], { type: "application/javascript" })
      );
    }
    return gateModuleUrl;
  }

  async function prepareGateWorklet(context) {
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") return false;
    if (!workletSupport.has(context)) {
      workletSupport.set(
        context,
        context.audioWorklet.addModule(getGateModuleUrl()).then(() => true).catch(() => false)
      );
    }
    return workletSupport.get(context);
  }

  function midiToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function createSourceBuffer(context, settings, requestedDuration) {
    const duration = Math.max(0.5, requestedDuration || SOURCE_DURATION);
    const sampleRate = context.sampleRate;
    const length = Math.ceil(duration * sampleRate);
    const buffer = context.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const randomLeft = DSP.mulberry32(0x31a7c0de);
    const randomRight = DSP.mulberry32(0x7e2f19a3);
    const randomEvent = DSP.mulberry32(0x4c8b1932);
    const melody = [69, 76, 72, 81, 76, 72, 69, 76, 74, 81, 77, 72, 69, 76, 72, 81];
    const chord = [45, 52, 57];
    const balanceAngle = ((DSP.clamp(settings.balance, -1, 1) + 1) * Math.PI) / 4;
    const balanceLeft = Math.cos(balanceAngle) * Math.SQRT2;
    const balanceRight = Math.sin(balanceAngle) * Math.SQRT2;
    const width = DSP.clamp(settings.width, 0, 1.5);
    const accent = DSP.clamp(settings.beatAccent, 0, 1);
    const crinkleSeed = new Float32Array(256);
    for (let index = 0; index < crinkleSeed.length; index += 1) {
      crinkleSeed[index] = randomEvent() * 2 - 1;
    }

    let crackleLeft = 0;
    let crackleRight = 0;
    let crackleLeftDecay = 0.92;
    let crackleRightDecay = 0.92;

    for (let index = 0; index < length; index += 1) {
      const time = index / sampleRate;
      const beatPhase = time % 0.5;
      const beatIndex = Math.floor(time / 0.5);
      const barPhase = time % 2;
      const kickEnvelope = Math.exp(-beatPhase * 19);
      const hatPhase = (time + 0.25) % 0.25;
      const hatEnvelope = Math.exp(-hatPhase * 58);
      const melodyNote = melody[Math.floor(time / 0.5) % melody.length];
      const melodyFrequency = midiToFrequency(melodyNote);
      const notePhase = time % 0.5;
      const noteEnvelope = Math.exp(-notePhase * 5.2) * Math.min(1, notePhase * 900);
      const kickFrequency = 48 + 74 * Math.exp(-beatPhase * 27);
      const kick = Math.sin(2 * Math.PI * kickFrequency * time) * kickEnvelope;
      const kickGain = 0.045 + accent * 0.32;
      const hatNoise = (randomLeft() * 2 - 1) * 0.72 + (randomRight() * 2 - 1) * 0.28;
      const hat = hatNoise * hatEnvelope * (0.015 + accent * 0.095);
      const melodyWave =
        Math.sin(2 * Math.PI * melodyFrequency * time) * 0.72 +
        Math.sin(2 * Math.PI * melodyFrequency * 2 * time + 0.2) * 0.19 +
        Math.sin(2 * Math.PI * melodyFrequency * 3 * time + 0.5) * 0.07;
      const melodyGain = noteEnvelope * (0.075 + accent * 0.095);
      const drone =
        Math.sin(2 * Math.PI * 220 * time) * 0.052 +
        Math.sin(2 * Math.PI * 440 * time + 0.33) * 0.014;
      const chordRoot = midiToFrequency(chord[barPhase < 1 ? 0 : 1]);
      const chordWave =
        Math.sin(2 * Math.PI * chordRoot * time) * 0.026 +
        Math.sin(2 * Math.PI * chordRoot * 1.5 * time + 0.9) * 0.019 +
        Math.sin(2 * Math.PI * chordRoot * 2 * time + 1.7) * 0.01;
      const sideWave =
        Math.sin(2 * Math.PI * (melodyFrequency * 1.0035) * time + 0.5) * 0.018 +
        Math.sin(2 * Math.PI * (melodyFrequency * 0.498) * time + 1.2) * 0.012;
      const stereoLift = width * (barPhase < 1 ? 1 : -1) * 0.012;

      if (randomLeft() < 0.000038) {
        crackleLeft = (randomLeft() > 0.5 ? 1 : -1) * (0.2 + randomLeft() * 0.48);
        crackleLeftDecay = 0.73 + randomLeft() * 0.22;
      }
      if (randomRight() < 0.000041) {
        crackleRight = (randomRight() > 0.5 ? 1 : -1) * (0.2 + randomRight() * 0.5);
        crackleRightDecay = 0.72 + randomRight() * 0.23;
      }
      crackleLeft *= crackleLeftDecay;
      crackleRight *= crackleRightDecay;

      const noiseLeft = (randomLeft() * 2 - 1) * 0.0032;
      const noiseRight = (randomRight() * 2 - 1) * 0.0032;
      const hum = Math.sin(2 * Math.PI * 50 * time) * 0.0045;
      const clickSection =
        (time > 3.82 && time < 4.72) || (time > 7.05 && time < 7.52);
      const clipBoost = clickSection ? 2.75 : 1;
      const transientClick =
        (time > 4.18 && time < 4.22) || (time > 7.21 && time < 7.24)
          ? Math.sin(2 * Math.PI * 1730 * time) * 0.48
          : 0;

      let rawLeft =
        (drone + chordWave + melodyWave * melodyGain + kick * kickGain + hat + noiseLeft + hum) *
          balanceLeft +
        (sideWave + stereoLift) * balanceLeft +
        crackleLeft * 0.68;
      let rawRight =
        (drone + chordWave + melodyWave * melodyGain + kick * kickGain + hat + noiseRight + hum) *
          balanceRight -
        (sideWave + stereoLift) * balanceRight +
        crackleRight * 0.68;
      rawLeft = rawLeft * clipBoost + transientClick;
      rawRight = rawRight * clipBoost + transientClick * 0.93;
      left[index] = DSP.clamp(rawLeft, -1, 1);
      right[index] = DSP.clamp(rawRight, -1, 1);
    }

    return buffer;
  }

  function smooth(param, value, context, duration) {
    const now = context.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, duration || 0.012);
  }

  function createFilterStage(context, type, frequency, q) {
    const input = context.createGain();
    const output = context.createGain();
    const wet = context.createGain();
    const dry = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    input.connect(filter);
    filter.connect(wet);
    wet.connect(output);
    input.connect(dry);
    dry.connect(output);
    return { kind: "filter", input, output, wet, dry, filter };
  }

  function setFilterStage(stage, enabled, frequency, q, context) {
    smooth(stage.filter.frequency, frequency, context);
    smooth(stage.filter.Q, q, context);
    smooth(stage.wet.gain, enabled ? 1 : 0, context);
    smooth(stage.dry.gain, enabled ? 0 : 1, context);
  }

  function createGateStage(context, gateReady) {
    const input = context.createGain();
    const output = context.createGain();
    const wet = context.createGain();
    const dry = context.createGain();
    const delay = context.createDelay(0.05);
    let processor;
    let fallback = false;
    if (gateReady) {
      processor = new AudioWorkletNode(context, "phase-gate", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      });
    } else {
      fallback = true;
      processor = context.createDynamicsCompressor();
      processor.threshold.value = -38;
      processor.knee.value = 7;
      processor.ratio.value = 20;
      processor.attack.value = 0.004;
      processor.release.value = 0.11;
    }
    input.connect(processor);
    processor.connect(delay);
    delay.connect(wet);
    wet.connect(output);
    input.connect(dry);
    dry.connect(output);
    return { kind: "gate", input, output, wet, dry, processor, delay, fallback };
  }

  function createClipCurve(driveDb) {
    const length = 4096;
    const curve = new Float32Array(length);
    const drive = 1 + Math.max(0, driveDb) / 10;
    for (let index = 0; index < length; index += 1) {
      const x = (index / (length - 1)) * 2 - 1;
      curve[index] = Math.tanh(drive * x * 1.35) / Math.tanh(drive * 1.35);
    }
    return curve;
  }

  function createClipStage(context) {
    const input = context.createGain();
    const output = context.createGain();
    const wet = context.createGain();
    const dry = context.createGain();
    const drive = context.createGain();
    const shaper = context.createWaveShaper();
    shaper.oversample = "4x";
    shaper.curve = createClipCurve(8);
    input.connect(drive);
    drive.connect(shaper);
    shaper.connect(wet);
    wet.connect(output);
    input.connect(dry);
    dry.connect(output);
    return { kind: "clip", input, output, wet, dry, drive, shaper };
  }

  function setGateStage(stage, settings, context) {
    const enabled = settings.gateEnabled;
    if (!stage.fallback && stage.processor.parameters) {
      smooth(stage.processor.parameters.get("threshold"), settings.gateThreshold, context);
      smooth(stage.processor.parameters.get("attack"), settings.gateAttack, context);
      smooth(stage.processor.parameters.get("release"), settings.gateRelease, context);
    } else {
      smooth(stage.processor.threshold, settings.gateThreshold, context);
      smooth(stage.processor.attack, settings.gateAttack / 1000, context);
      smooth(stage.processor.release, settings.gateRelease / 1000, context);
    }
    smooth(stage.delay.delayTime, enabled ? settings.gateLookahead / 1000 : 0, context);
    smooth(stage.wet.gain, enabled ? 1 : 0, context);
    smooth(stage.dry.gain, enabled ? 0 : 1, context);
  }

  function setClipStage(stage, settings, context) {
    const mix = DSP.clamp(settings.clipMix / 100, 0, 1);
    smooth(stage.drive.gain, DSP.dbToGain(settings.clipDrive * 0.46), context);
    stage.shaper.curve = createClipCurve(settings.clipDrive);
    smooth(stage.wet.gain, settings.clipEnabled ? mix : 0, context);
    smooth(stage.dry.gain, settings.clipEnabled ? 1 - mix : 1, context);
  }

  function createProcessingChain(context, settings, gateReady) {
    const input = context.createGain();
    const output = context.createGain();
    const hpf = createFilterStage(context, "highpass", settings.hpfFreq, settings.hpfQ);
    const notch = createFilterStage(context, "notch", settings.notchFreq, settings.notchQ);
    const gate = createGateStage(context, gateReady);
    const clip = createClipStage(context);
    input.connect(hpf.input);
    hpf.output.connect(notch.input);
    notch.output.connect(gate.input);
    gate.output.connect(clip.input);
    clip.output.connect(output);

    const stages = { hpf, notch, gate, clip };
    const chain = { input, output, stages };
    configureProcessingChain(chain, settings, context, true);
    return chain;
  }

  function configureProcessingChain(chain, settings, context, immediate) {
    if (immediate) {
      const setImmediate = (param, value) => {
        param.cancelScheduledValues(0);
        param.value = value;
      };
      setImmediate(chain.stages.hpf.filter.frequency, settings.hpfFreq);
      setImmediate(chain.stages.hpf.filter.Q, settings.hpfQ);
      setImmediate(chain.stages.hpf.wet.gain, settings.hpfEnabled ? 1 : 0);
      setImmediate(chain.stages.hpf.dry.gain, settings.hpfEnabled ? 0 : 1);
      setImmediate(chain.stages.notch.filter.frequency, settings.notchFreq);
      setImmediate(chain.stages.notch.filter.Q, settings.notchQ);
      setImmediate(chain.stages.notch.wet.gain, settings.notchEnabled ? 1 : 0);
      setImmediate(chain.stages.notch.dry.gain, settings.notchEnabled ? 0 : 1);
      setImmediate(chain.stages.gate.delay.delayTime, settings.gateEnabled ? settings.gateLookahead / 1000 : 0);
      setImmediate(chain.stages.gate.wet.gain, settings.gateEnabled ? 1 : 0);
      setImmediate(chain.stages.gate.dry.gain, settings.gateEnabled ? 0 : 1);
      const gateStage = chain.stages.gate;
      if (!gateStage.fallback && gateStage.processor.parameters) {
        setImmediate(gateStage.processor.parameters.get("threshold"), settings.gateThreshold);
        setImmediate(gateStage.processor.parameters.get("attack"), settings.gateAttack);
        setImmediate(gateStage.processor.parameters.get("release"), settings.gateRelease);
      } else {
        setImmediate(gateStage.processor.threshold, settings.gateThreshold);
        setImmediate(gateStage.processor.attack, settings.gateAttack / 1000);
        setImmediate(gateStage.processor.release, settings.gateRelease / 1000);
      }
      const clipStage = chain.stages.clip;
      const clipMix = settings.clipMix / 100;
      setImmediate(clipStage.drive.gain, DSP.dbToGain(settings.clipDrive * 0.46));
      clipStage.shaper.curve = createClipCurve(settings.clipDrive);
      setImmediate(clipStage.wet.gain, settings.clipEnabled ? clipMix : 0);
      setImmediate(clipStage.dry.gain, settings.clipEnabled ? 1 - clipMix : 1);
      return;
    }
    setFilterStage(chain.stages.hpf, settings.hpfEnabled, settings.hpfFreq, settings.hpfQ, context);
    setFilterStage(chain.stages.notch, settings.notchEnabled, settings.notchFreq, settings.notchQ, context);
    setGateStage(chain.stages.gate, settings, context);
    setClipStage(chain.stages.clip, settings, context);
  }

  class AudioEngine {
    constructor() {
      this.context = null;
      this.settings = { ...DEFAULTS };
      this.sourceBuffer = null;
      this.sourceNode = null;
      this.sourceGain = null;
      this.preAnalyser = null;
      this.postAnalyser = null;
      this.master = null;
      this.chain = null;
      this.playing = false;
      this.offset = 0;
      this.startedAt = 0;
      this.playToken = 0;
      this.onEnded = null;
      this.fallbackGate = false;
    }

    get sampleRate() {
      return this.context ? this.context.sampleRate : SAMPLE_RATE;
    }

    async ensureContext() {
      if (this.context) {
        if (this.context.state === "suspended") await this.context.resume();
        return this.context;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio");
      try {
        this.context = new AudioContextClass({ latencyHint: "interactive", sampleRate: SAMPLE_RATE });
      } catch (error) {
        this.context = new AudioContextClass({ latencyHint: "interactive" });
        void error;
      }
      const gateReady = await prepareGateWorklet(this.context);
      this.fallbackGate = !gateReady;
      this.sourceGain = this.context.createGain();
      this.chain = createProcessingChain(this.context, this.settings, gateReady);
      this.master = this.context.createGain();
      this.master.gain.value = DSP.dbToGain(this.settings.masterGain);
      this.preAnalyser = this.context.createAnalyser();
      this.preAnalyser.fftSize = 4096;
      this.preAnalyser.smoothingTimeConstant = 0.72;
      this.postAnalyser = this.context.createAnalyser();
      this.postAnalyser.fftSize = 4096;
      this.postAnalyser.smoothingTimeConstant = 0.72;
      this.sourceGain.connect(this.preAnalyser);
      this.sourceGain.connect(this.chain.input);
      this.chain.output.connect(this.master);
      this.master.connect(this.postAnalyser);
      this.master.connect(this.context.destination);
      this.sourceBuffer = createSourceBuffer(this.context, this.settings);
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }

    async setSettings(settings, regenerateSource) {
      const next = { ...this.settings, ...settings };
      this.settings = next;
      if (!this.context) return;
      configureProcessingChain(this.chain, next, this.context, false);
      smooth(this.master.gain, DSP.dbToGain(next.masterGain), this.context);
      if (regenerateSource) {
        const position = this.getPosition();
        this.sourceBuffer = createSourceBuffer(this.context, next);
        if (this.playing) {
          this.stopSourceOnly();
          this.startSource(position);
        }
      }
    }

    async play(offset) {
      const context = await this.ensureContext();
      if (this.playing) return;
      const position = Number.isFinite(offset) ? offset : this.offset;
      this.startSource(position >= SOURCE_DURATION - 0.01 ? 0 : position);
      if (context.state === "suspended") await context.resume();
    }

    startSource(offset) {
      const token = ++this.playToken;
      const source = this.context.createBufferSource();
      source.buffer = this.sourceBuffer;
      source.connect(this.sourceGain);
      const startOffset = DSP.clamp(offset, 0, Math.max(0, this.sourceBuffer.duration - 0.01));
      source.start(this.context.currentTime + 0.006, startOffset);
      this.sourceNode = source;
      this.offset = startOffset;
      this.startedAt = this.context.currentTime + 0.006;
      this.playing = true;
      source.onended = () => {
        if (token !== this.playToken) return;
        this.playing = false;
        this.offset = 0;
        this.sourceNode = null;
        if (typeof this.onEnded === "function") this.onEnded();
      };
    }

    stopSourceOnly() {
      this.playToken += 1;
      if (this.sourceNode) {
        try {
          this.sourceNode.onended = null;
          this.sourceNode.stop();
        } catch (error) {
          void error;
        }
        this.sourceNode.disconnect();
      }
      this.sourceNode = null;
      this.playing = false;
    }

    pause() {
      if (!this.playing) return this.offset;
      this.offset = this.getPosition();
      this.stopSourceOnly();
      return this.offset;
    }

    replay() {
      this.pause();
      this.offset = 0;
      return this.play(0);
    }

    getPosition() {
      if (!this.context) return this.offset;
      if (!this.playing) return this.offset;
      const elapsed = this.context.currentTime - this.startedAt;
      return DSP.clamp(this.offset + Math.max(0, elapsed), 0, SOURCE_DURATION);
    }

    getLivePeaks() {
      if (!this.context || !this.postAnalyser) return { pre: 0, post: 0 };
      const measure = (analyser) => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return DSP.channelPeak(data);
      };
      return { post: measure(this.postAnalyser), pre: measure(this.preAnalyser) };
    }
  }

  async function renderOffline(settings, options) {
    const config = {
      duration: SOURCE_DURATION,
      bypassChain: false,
      sampleRate: SAMPLE_RATE,
      ...options,
    };
    const length = Math.ceil(config.duration * config.sampleRate);
    const context = new OfflineAudioContext(2, length, config.sampleRate);
    const gateReady = config.bypassChain ? false : await prepareGateWorklet(context);
    const sourceBuffer = createSourceBuffer(context, settings, config.duration);
    const source = context.createBufferSource();
    source.buffer = sourceBuffer;
    if (config.bypassChain) {
      source.connect(context.destination);
    } else {
      const sourceGain = context.createGain();
      const chain = createProcessingChain(context, settings, gateReady);
      const master = context.createGain();
      master.gain.value = DSP.dbToGain(settings.masterGain);
      source.connect(sourceGain);
      sourceGain.connect(chain.input);
      chain.output.connect(master);
      master.connect(context.destination);
    }
    source.start(0);
    const rendered = await context.startRendering();
    return {
      buffer: rendered,
      sourceBuffer,
      fallbackGate: !config.bypassChain && !gateReady,
    };
  }

  function mergeSettings(base, overrides) {
    return { ...DEFAULTS, ...base, ...overrides };
  }

  window.PhaseAudio = {
    DEFAULTS,
    SAMPLE_RATE,
    SOURCE_DURATION,
    AudioEngine,
    createSourceBuffer,
    createProcessingChain,
    configureProcessingChain,
    createClipCurve,
    renderOffline,
    mergeSettings,
    prepareGateWorklet,
  };
})();
