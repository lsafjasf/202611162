export class MachineAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.master = null;
    this.motor = null;
    this.motorGain = null;
    this.motorFilter = null;
    this.hum = null;
    this.humGain = null;
    this.noise = null;
    this.noiseGain = null;
    this.noiseFilter = null;
    this.updatedAt = 0;
  }

  async init() {
    if (!this.enabled) return false;
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return true;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    this.context = new AudioContext();
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(context.destination);

    this.motor = context.createOscillator();
    this.motor.type = 'sawtooth';
    this.motor.frequency.value = 110;
    this.motorFilter = context.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 430;
    this.motorFilter.Q.value = 1.1;
    this.motorGain = context.createGain();
    this.motorGain.gain.value = 0;
    this.motor.connect(this.motorFilter).connect(this.motorGain).connect(this.master);
    this.motor.start();

    this.hum = context.createOscillator();
    this.hum.type = 'sine';
    this.hum.frequency.value = 52;
    this.humGain = context.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(this.humGain).connect(this.master);
    this.hum.start();

    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[i] = last;
    }
    this.noise = context.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.noiseFilter = context.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 780;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = context.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();
    if (context.state === 'suspended') await context.resume();
    return true;
  }

  async setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      await this.init();
      if (this.master) this.master.gain.setTargetAtTime(0.55, this.context.currentTime, 0.08);
    } else if (this.master) {
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.05);
    }
    return this.enabled;
  }

  update({ running, speed, friction, heat, failed, paused, recovering }) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    if (now - this.updatedAt < 0.08) return;
    this.updatedAt = now;
    const active = running || recovering;
    const normalizedSpeed = Math.max(0, speed) / 48;
    const motorFrequency = failed ? 42 : 62 + normalizedSpeed * 74;
    const motorLevel = failed ? 0.001 : paused ? 0.004 : active ? 0.028 + normalizedSpeed * 0.02 : 0.006;
    const humFrequency = 42 + normalizedSpeed * 18;
    const humLevel = failed ? 0.003 : paused ? 0.002 : active ? 0.018 + normalizedSpeed * 0.008 : 0.003;
    const frictionLevel = failed ? 0.001 : !active || paused ? 0 : Math.min(0.032, friction * 0.013);
    this.motor.frequency.setTargetAtTime(motorFrequency, now, 0.09);
    this.motorFilter.frequency.setTargetAtTime(320 + normalizedSpeed * 360 + heat * 2.4, now, 0.12);
    this.motorGain.gain.setTargetAtTime(motorLevel, now, 0.08);
    this.hum.frequency.setTargetAtTime(humFrequency, now, 0.12);
    this.humGain.gain.setTargetAtTime(humLevel, now, 0.08);
    this.noiseFilter.frequency.setTargetAtTime(480 + friction * 1050, now, 0.1);
    this.noiseGain.gain.setTargetAtTime(frictionLevel, now, 0.08);
  }
}

