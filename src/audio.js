export class PressAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.started = false;
    this.nodes = {};
    this.lastFaultAt = 0;
  }

  async ensureStarted() {
    if (!this.context) this._createGraph();
    if (!this.context) return false;
    if (this.context.state === "suspended") await this.context.resume();
    this.started = true;
    return true;
  }

  _createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    const ctx = this.context;
    this.nodes.master = ctx.createGain();
    this.nodes.master.gain.value = this.enabled ? 0.72 : 0;
    this.nodes.master.connect(ctx.destination);

    this.nodes.motorGain = ctx.createGain();
    this.nodes.motorGain.gain.value = 0;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 170;
    const motorA = ctx.createOscillator();
    motorA.type = "sawtooth";
    motorA.frequency.value = 49;
    const motorB = ctx.createOscillator();
    motorB.type = "triangle";
    motorB.frequency.value = 73;
    motorA.connect(motorFilter);
    motorB.connect(motorFilter);
    motorFilter.connect(this.nodes.motorGain);
    this.nodes.motorGain.connect(this.nodes.master);
    motorA.start();
    motorB.start();

    this.nodes.inkGain = ctx.createGain();
    this.nodes.inkGain.gain.value = 0;
    const inkOsc = ctx.createOscillator();
    inkOsc.type = "sine";
    inkOsc.frequency.value = 188;
    const inkFilter = ctx.createBiquadFilter();
    inkFilter.type = "bandpass";
    inkFilter.frequency.value = 230;
    inkFilter.Q.value = 8;
    inkOsc.connect(inkFilter);
    inkFilter.connect(this.nodes.inkGain);
    this.nodes.inkGain.connect(this.nodes.master);
    inkOsc.start();

    this.nodes.noiseBuffer = this._makeNoise(2);
    this.nodes.dryerGain = ctx.createGain();
    this.nodes.dryerGain.gain.value = 0;
    const dryerSource = ctx.createBufferSource();
    dryerSource.buffer = this.nodes.noiseBuffer;
    dryerSource.loop = true;
    const dryerFilter = ctx.createBiquadFilter();
    dryerFilter.type = "bandpass";
    dryerFilter.frequency.value = 1150;
    dryerFilter.Q.value = 0.7;
    dryerSource.connect(dryerFilter);
    dryerFilter.connect(this.nodes.dryerGain);
    this.nodes.dryerGain.connect(this.nodes.master);
    dryerSource.start();

    this.nodes.ambientGain = ctx.createGain();
    this.nodes.ambientGain.gain.value = 0.022;
    const ambientSource = ctx.createBufferSource();
    ambientSource.buffer = this.nodes.noiseBuffer;
    ambientSource.loop = true;
    const ambientFilter = ctx.createBiquadFilter();
    ambientFilter.type = "lowpass";
    ambientFilter.frequency.value = 420;
    ambientSource.connect(ambientFilter);
    ambientFilter.connect(this.nodes.ambientGain);
    this.nodes.ambientGain.connect(this.nodes.master);
    ambientSource.start();
  }

  _makeNoise(seconds) {
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.88 + white * 0.12;
      channel[index] = last;
    }
    return buffer;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.context) return;
    this.nodes.master.gain.setTargetAtTime(enabled ? 0.72 : 0, this.context.currentTime, 0.02);
  }

  update(simulator) {
    if (!this.context || !this.started) return;
    const now = this.context.currentTime;
    const running = ["running", "rollChange"].includes(simulator.phase);
    const motorLevel = running && simulator.devices.cylinder.on
      ? 0.055 + simulator.params.pressure / 100 * 0.025
      : simulator.devices.cylinder.on ? 0.035 : 0;
    const inkLevel = simulator.devices.inkPump.on ? 0.013 : 0;
    const dryerLevel = simulator.devices.dryer.on
      ? 0.006 + simulator.params.dryer / 100 * 0.032
      : 0;
    this.nodes.motorGain.gain.setTargetAtTime(motorLevel, now, 0.08);
    this.nodes.inkGain.gain.setTargetAtTime(inkLevel, now, 0.06);
    this.nodes.dryerGain.gain.setTargetAtTime(dryerLevel, now, 0.1);
  }

  cut() {
    if (!this.context || !this.enabled) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.nodes.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1250;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.nodes.master);
    source.start(now);
    source.stop(now + 0.16);
  }

  rollChange() {
    if (!this.context || !this.enabled) return;
    this._tone(320, 0.07, 0.22, "triangle");
    window.setTimeout(() => this._tone(240, 0.08, 0.28, "triangle"), 160);
  }

  fault() {
    if (!this.context || !this.enabled) return;
    if (performance.now() - this.lastFaultAt < 600) return;
    this.lastFaultAt = performance.now();
    this._tone(740, 0.12, 0.2, "square");
    window.setTimeout(() => this._tone(560, 0.18, 0.2, "square"), 150);
  }

  _tone(frequency, duration, volume = 0.1, type = "sine") {
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.nodes.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
