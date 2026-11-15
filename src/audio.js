export class FerryAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.lastAlarm = 0;
  }

  async ensure() {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return this.context;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.context.destination);

    this.engineOsc = this.context.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 42;
    this.engineFilter = this.context.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 180;
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    const length = this.context.sampleRate * 1.5;
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let state = 0x9e3779b9;
    for (let i = 0; i < data.length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = ((state >>> 0) / 4294967296) * 2 - 1;
    }
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(enabled ? 0.5 : 0, now, 0.04);
  }

  updateEngine(throttle, overloaded) {
    if (!this.context || !this.engineOsc) return;
    const now = this.context.currentTime;
    const active = this.enabled ? Math.abs(throttle) : 0;
    const frequency = 34 + active * 68 + (overloaded ? 13 : 0);
    this.engineOsc.frequency.setTargetAtTime(frequency, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(120 + active * 260, now, 0.1);
    const gain = active > 0.02 ? 0.035 + active * 0.075 : 0.006;
    this.engineGain.gain.setTargetAtTime(gain, now, 0.07);
  }

  noiseBurst(duration, frequency, gainValue) {
    if (!this.context || !this.noiseBuffer || !this.enabled) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration);
  }

  playIce(impact = 1) {
    this.noiseBurst(0.16 + impact * 0.17, 750 + impact * 780, 0.12 + impact * 0.15);
    this.tone(112 - impact * 22, 0.11, 0.08, "triangle", -55);
    this.tone(1680, 0.035, 0.045, "square", 0);
  }

  playDock() {
    this.tone(440, 0.12, 0.05, "sine", 0);
    this.tone(660, 0.2, 0.045, "sine", 0);
  }

  playCable() {
    this.tone(190, 0.14, 0.07, "sawtooth", -60);
    this.noiseBurst(0.12, 2400, 0.025);
  }

  playAlarm(force = false) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    if (!force && now - this.lastAlarm < 0.45) return;
    this.lastAlarm = now;
    this.tone(780, 0.12, 0.055, "square", 0);
    setTimeout(() => this.tone(585, 0.16, 0.05, "square", 0), 145);
  }

  playCheckpoint() {
    this.tone(330, 0.1, 0.045, "sine", 0);
    setTimeout(() => this.tone(495, 0.16, 0.045, "sine", 0), 90);
  }

  tone(frequency, duration, volume, type = "sine", slide = 0) {
    if (!this.context || !this.enabled) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(40, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
