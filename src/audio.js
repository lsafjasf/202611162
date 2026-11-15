import { clamp, mulberry32, tideLevel } from "./core.js";

export class SeaAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.waveSource = null;
    this.waveGain = null;
    this.waveFilter = null;
    this.muted = false;
    this.ready = false;
  }

  async init() {
    if (this.ready) {
      if (this.context?.state === "suspended") await this.context.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.65;
    this.master.connect(this.context.destination);

    this.engine = this.context.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 47;
    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 210;
    this.engineFilter.Q.value = 1.6;
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    this.engine.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engine.start();

    const sampleCount = this.context.sampleRate * 2;
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    const noiseRandom = mulberry32(0x5ea5eed);
    let last = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const white = noiseRandom() * 2 - 1;
      last = last * 0.975 + white * 0.025;
      channel[index] = last * 2.7;
    }
    this.waveSource = this.context.createBufferSource();
    this.waveSource.buffer = buffer;
    this.waveSource.loop = true;
    this.waveFilter = this.context.createBiquadFilter();
    this.waveFilter.type = "lowpass";
    this.waveFilter.frequency.value = 560;
    this.waveFilter.Q.value = 0.6;
    this.waveGain = this.context.createGain();
    this.waveGain.gain.value = 0.012;
    this.waveSource.connect(this.waveFilter);
    this.waveFilter.connect(this.waveGain);
    this.waveGain.connect(this.master);
    this.waveSource.start();

    this.ready = true;
    if (this.context.state === "suspended") await this.context.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.65, this.context.currentTime, 0.04);
    }
  }

  toggle() {
    this.setMuted(!this.muted);
    return !this.muted;
  }

  update(state) {
    if (!this.ready || !this.context) return;
    const now = this.context.currentTime;
    const speed = Math.abs(state.ship.speed);
    const throttle = Math.abs(state.ship.throttle);
    const sailing = state.status === "sailing";
    const engineLevel = sailing ? 0.008 + throttle * 0.025 + speed * 0.0002 : sailing ? 0.008 : 0;
    const frequency = 39 + speed * 1.35 + throttle * 21;
    this.engine.frequency.setTargetAtTime(frequency, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(180 + speed * 4.5 + throttle * 80, now, 0.1);
    this.engineGain.gain.setTargetAtTime(engineLevel, now, 0.12);

    const tide = tideLevel(state.elapsed);
    const seaState = clamp((2.4 - tide) / 1.8, 0, 1);
    const waveLevel = state.status === "paused" ? 0.004 : 0.009 + seaState * 0.016 + speed * 0.00008;
    this.waveGain.gain.setTargetAtTime(waveLevel, now, 0.22);
    this.waveFilter.frequency.setTargetAtTime(430 + seaState * 430 + speed * 2, now, 0.18);
  }

  tone(frequency = 660, duration = 0.08, type = "sine", volume = 0.045) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  cue(kind) {
    const cues = {
      tap: [440, 0.045, "triangle", 0.025],
      load: [620, 0.07, "triangle", 0.035],
      warning: [190, 0.17, "square", 0.03],
      success: [760, 0.12, "sine", 0.05],
      failure: [118, 0.3, "sawtooth", 0.045],
      dock: [520, 0.14, "sine", 0.04],
    };
    const [frequency, duration, type, volume] = cues[kind] || cues.tap;
    this.tone(frequency, duration, type, volume);
    if (kind === "success") {
      setTimeout(() => this.tone(1010, 0.18, "sine", 0.04), 100);
    }
  }
}
