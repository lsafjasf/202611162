import { clamp } from "./simulator.js";

export class MachineAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.motorGain = null;
    this.fanGain = null;
    this.motorOsc = null;
    this.fanFilter = null;
    this.muted = false;
    this.started = false;
  }

  ensure() {
    if (this.context) {
      if (this.context.state === "suspended") this.context.resume();
      return this.context;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.16;
    master.connect(context.destination);

    const motorOsc = context.createOscillator();
    const motorFilter = context.createBiquadFilter();
    const motorGain = context.createGain();
    motorOsc.type = "sawtooth";
    motorOsc.frequency.value = 48;
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 190;
    motorFilter.Q.value = 2.4;
    motorGain.gain.value = 0;
    motorOsc.connect(motorFilter).connect(motorGain).connect(master);
    motorOsc.start();

    const fanBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = fanBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.78 + white * 0.22;
      data[i] = last;
    }
    const fanNoise = context.createBufferSource();
    fanNoise.buffer = fanBuffer;
    fanNoise.loop = true;
    const fanFilter = context.createBiquadFilter();
    const fanGain = context.createGain();
    fanFilter.type = "bandpass";
    fanFilter.frequency.value = 720;
    fanFilter.Q.value = 0.7;
    fanGain.gain.value = 0;
    fanNoise.connect(fanFilter).connect(fanGain).connect(master);
    fanNoise.start();

    this.context = context;
    this.master = master;
    this.motorOsc = motorOsc;
    this.motorGain = motorGain;
    this.fanFilter = fanFilter;
    this.fanGain = fanGain;
    this.started = true;
    return context;
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.16, this.context.currentTime, 0.04);
  }

  update(state) {
    if (!this.context || !this.started) return;
    const now = this.context.currentTime;
    const motorRunning = state.equipment?.motor?.status === "running";
    const fanRunning = state.equipment?.fan?.status === "running";
    const paused = state.paused || state.failed;
    const rpm = state.params?.rpm || 0;
    const motorLevel = motorRunning && !paused ? clamp(0.045 + rpm / 1900, 0.05, 0.12) : 0;
    const fanLevel = fanRunning && !paused ? clamp(0.045 + state.entrainment / 900, 0.045, 0.12) : 0;
    const fanFrequency = 580 + (fanRunning ? 190 : 0) + (state.entrainment || 0) * 5;

    this.motorOsc.frequency.setTargetAtTime(28 + rpm * 0.56, now, 0.12);
    this.motorGain.gain.setTargetAtTime(motorLevel, now, 0.12);
    this.fanFilter.frequency.setTargetAtTime(fanFrequency, now, 0.18);
    this.fanGain.gain.setTargetAtTime(fanLevel, now, 0.1);
  }

  alarm() {
    const context = this.ensure();
    if (!context || this.muted) return;
    const now = context.currentTime;
    for (let index = 0; index < 2; index += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 690;
      gain.gain.setValueAtTime(0, now + index * 0.18);
      gain.gain.linearRampToValueAtTime(0.12, now + index * 0.18 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.18 + 0.13);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now + index * 0.18);
      oscillator.stop(now + index * 0.18 + 0.15);
    }
  }

  chime(good = true) {
    const context = this.ensure();
    if (!context || this.muted) return;
    const now = context.currentTime;
    const notes = good ? [440, 660] : [240, 190];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.11);
      gain.gain.linearRampToValueAtTime(0.08, now + index * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.11 + 0.3);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(now + index * 0.11);
      oscillator.stop(now + index * 0.11 + 0.32);
    });
  }
}
