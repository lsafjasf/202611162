export class HarborAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.waveGain = null;
    this.waveFilter = null;
    this.muted = false;
    this.ready = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);

      this.engine = this.context.createOscillator();
      this.engine.type = "sawtooth";
      this.engine.frequency.value = 54;
      this.engineFilter = this.context.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 210;
      this.engineGain = this.context.createGain();
      this.engineGain.gain.value = 0;
      this.engine.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engine.start();

      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.94 + white * 0.06;
        data[index] = last * 3.4;
      }
      const noise = this.context.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      this.waveFilter = this.context.createBiquadFilter();
      this.waveFilter.type = "bandpass";
      this.waveFilter.frequency.value = 700;
      this.waveFilter.Q.value = 0.45;
      this.waveGain = this.context.createGain();
      this.waveGain.gain.value = 0.012;
      noise.connect(this.waveFilter);
      this.waveFilter.connect(this.waveGain);
      this.waveGain.connect(this.master);
      noise.start();
      this.ready = true;
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    return true;
  }

  update({ throttle, speed, waveHeight, active }) {
    if (!this.ready || !this.context) return;
    const now = this.context.currentTime;
    const engineLevel =
      active && !this.muted ? 0.013 + Math.abs(throttle) * 0.04 + Math.min(speed / 160, 1) * 0.012 : 0;
    this.engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);
    this.engine.frequency.setTargetAtTime(47 + Math.abs(throttle) * 30 + speed * 0.3, now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(190 + speed * 2.6, now, 0.14);

    const waveSize = 0.25 + waveHeight * 0.75;
    const waveLevel = this.muted ? 0 : 0.006 + waveSize * 0.018;
    this.waveGain.gain.setTargetAtTime(waveLevel, now, 0.16);
    this.waveFilter.frequency.setTargetAtTime(460 + waveSize * 680, now, 0.2);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.context.currentTime, 0.04);
    }
  }

  impact(strength = 0.45) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(92, now);
    oscillator.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    gain.gain.setValueAtTime(Math.min(0.18, strength * 0.18), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.28);
  }

  chime(success = true) {
    if (!this.ready || this.muted) return;
    const now = this.context.currentTime;
    const frequencies = success ? [392, 523, 659] : [220, 174];
    frequencies.forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.07, now + index * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.09 + 0.45);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now + index * 0.09);
      oscillator.stop(now + index * 0.09 + 0.48);
    });
  }
}
