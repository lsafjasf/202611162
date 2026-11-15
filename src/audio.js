export class WaterAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.flow = 1;
    this.paused = false;
    this.noise = null;
    this.filter = null;
    this.gain = null;
    this.oscillators = [];
  }

  async enable() {
    if (!this.context) this.build();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.gain.gain.setTargetAtTime(0.05 + this.flow * 0.035, this.context.currentTime, 0.35);
    return true;
  }

  disable() {
    this.enabled = false;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.12);
    }
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    await this.enable();
    return true;
  }

  build() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    const ctx = this.context;
    const seconds = 3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 9137;
    for (let index = 0; index < data.length; index += 1) {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      data[index] = noise * 0.34;
    }

    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 380;
    this.filter.Q.value = 0.8;

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 75;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.018;
    const rumble = ctx.createOscillator();
    rumble.type = "sine";
    rumble.frequency.value = 54;
    rumble.connect(rumbleGain).connect(ctx.destination);
    rumble.start();
    this.oscillators.push({ node: rumble, gain: rumbleGain, base: 54 });

    const currentGain = ctx.createGain();
    currentGain.gain.value = 0.007;
    const current = ctx.createOscillator();
    current.type = "triangle";
    current.frequency.value = 118;
    current.connect(currentGain).connect(ctx.destination);
    current.start();
    this.oscillators.push({ node: current, gain: currentGain, base: 118 });

    this.noise.connect(highpass).connect(this.filter).connect(this.gain).connect(ctx.destination);
    this.noise.start();
  }

  update(flow, paused) {
    this.flow = flow;
    this.paused = paused;
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const activity = paused ? 0.2 : 1;
    const cutoff = 210 + flow * 780;
    this.filter.frequency.setTargetAtTime(cutoff, now, 0.4);
    this.gain.gain.setTargetAtTime((0.018 + flow * 0.041) * activity, now, 0.35);
    for (const oscillator of this.oscillators) {
      oscillator.node.frequency.setTargetAtTime(oscillator.base + flow * 16, now, 0.5);
      oscillator.gain.gain.setTargetAtTime((oscillator.base > 100 ? 0.006 : 0.013) * activity, now, 0.4);
    }
  }
}
