function noiseBuffer(context, seconds = 2.5) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = 0.93 * last + 0.07 * white;
    data[i] = last * 3.6;
  }
  return buffer;
}

export class KilnAudio {
  constructor() {
    this.context = null;
    this.muted = false;
    this.running = false;
    this.burnerGain = null;
    this.fanGain = null;
    this.doorGain = null;
    this.crackleTimer = null;
  }

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    const context = new AudioContext();
    this.context = context;
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    this.master = master;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.3;
    compressor.connect(master);

    const fireBus = context.createGain();
    fireBus.gain.value = 0.5;
    const fireFilter = context.createBiquadFilter();
    fireFilter.type = "lowpass";
    fireFilter.frequency.value = 310;
    fireFilter.Q.value = 0.8;
    fireBus.connect(fireFilter).connect(compressor);
    this.burnerGain = context.createGain();
    this.burnerGain.gain.value = 0;
    this.burnerGain.connect(fireBus);

    const rumble = context.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = 58;
    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.58;
    rumble.connect(rumbleGain).connect(this.burnerGain);
    rumble.start();

    const throat = context.createOscillator();
    throat.type = "sawtooth";
    throat.frequency.value = 91;
    const throatGain = context.createGain();
    throatGain.gain.value = 0.11;
    const throatFilter = context.createBiquadFilter();
    throatFilter.type = "lowpass";
    throatFilter.frequency.value = 220;
    throat.connect(throatFilter).connect(throatGain).connect(this.burnerGain);
    throat.start();
    this.rumble = rumble;
    this.throat = throat;

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context);
    noise.loop = true;
    const fanFilter = context.createBiquadFilter();
    fanFilter.type = "bandpass";
    fanFilter.frequency.value = 720;
    fanFilter.Q.value = 0.72;
    this.fanGain = context.createGain();
    this.fanGain.gain.value = 0;
    noise.connect(fanFilter).connect(this.fanGain).connect(compressor);
    noise.start();

    const doorNoise = context.createBufferSource();
    doorNoise.buffer = noiseBuffer(context, 3.5);
    doorNoise.loop = true;
    const doorFilter = context.createBiquadFilter();
    doorFilter.type = "highpass";
    doorFilter.frequency.value = 1150;
    this.doorGain = context.createGain();
    this.doorGain.gain.value = 0;
    doorNoise.connect(doorFilter).connect(this.doorGain).connect(compressor);
    doorNoise.start();
    return true;
  }

  async setMuted(muted) {
    this.muted = muted;
    if (!muted) await this.ensure();
    if (!this.context) return;
    const target = muted ? 0 : 0.38;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.linearRampToValueAtTime(target, this.context.currentTime + 0.22);
  }

  async start() {
    this.running = true;
    if (!this.muted) await this.setMuted(false);
  }

  stop() {
    this.running = false;
  }

  update({ gas = 0, vent = 0, door = 0, powered = false }) {
    if (!this.context) return;
    const now = this.context.currentTime;
    const ramp = 0.18;
    const active = this.running && powered && !this.muted;
    const gasAmount = active ? Math.pow(Math.max(0, Math.min(100, gas)) / 100, 1.1) : 0;
    const ventAmount = active ? Math.max(0, Math.min(100, vent)) / 100 : 0;
    const doorAmount = active ? Math.max(0, Math.min(100, door)) / 100 : 0;
    this.burnerGain.gain.setTargetAtTime(active ? 0.08 + gasAmount * 0.42 : 0, now, ramp);
    this.fanGain.gain.setTargetAtTime(ventAmount * 0.26, now, ramp);
    this.doorGain.gain.setTargetAtTime(doorAmount * 0.12, now, ramp);
    this.rumble.frequency.setTargetAtTime(44 + gasAmount * 42, now, 0.25);
    this.throat.frequency.setTargetAtTime(78 + gasAmount * 66, now, 0.25);
  }

  dispose() {
    if (this.crackleTimer) clearInterval(this.crackleTimer);
    this.context?.close();
    this.context = null;
  }
}
