function seededNoise(length, seed) {
  let value = seed >>> 0;
  const buffer = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    buffer[index] = (((value ^ (value >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  return buffer;
}

function noiseSource(context, seconds, seed) {
  const frameCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  buffer.copyToChannel(seededNoise(frameCount, seed), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

export class PolarAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
    this.started = false;
    this.nodes = null;
  }

  start() {
    if (this.started || !this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.001;
    master.connect(context.destination);

    const windSource = noiseSource(context, 3.7, 0x71c0);
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    const windGain = context.createGain();
    windGain.gain.value = 0.001;
    windSource.connect(windFilter).connect(windGain).connect(master);

    const snowSource = noiseSource(context, 2.3, 0x5a19);
    const snowFilter = context.createBiquadFilter();
    snowFilter.type = "highpass";
    snowFilter.frequency.value = 2800;
    const snowGain = context.createGain();
    snowGain.gain.value = 0.001;
    snowSource.connect(snowFilter).connect(snowGain).connect(master);

    const pumpOsc = context.createOscillator();
    pumpOsc.type = "sawtooth";
    pumpOsc.frequency.value = 47;
    const pumpFilter = context.createBiquadFilter();
    pumpFilter.type = "lowpass";
    pumpFilter.frequency.value = 160;
    const pumpGain = context.createGain();
    pumpGain.gain.value = 0.001;
    pumpOsc.connect(pumpFilter).connect(pumpGain).connect(master);

    const pumpPulse = context.createOscillator();
    pumpPulse.type = "sine";
    pumpPulse.frequency.value = 2.4;
    const pulseGain = context.createGain();
    pulseGain.gain.value = 0.001;
    pumpPulse.connect(pulseGain).connect(pumpGain);

    windSource.start();
    snowSource.start();
    pumpOsc.start();
    pumpPulse.start();
    this.context = context;
    this.nodes = { master, windGain, snowGain, pumpGain, windFilter };
    this.started = true;
    if (context.state === "suspended") context.resume();
    master.gain.setTargetAtTime(this.enabled ? 0.24 : 0.001, context.currentTime, 0.45);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.start();
    if (this.nodes) {
      this.nodes.master.gain.setTargetAtTime(enabled ? 0.24 : 0.001, this.context.currentTime, 0.3);
    }
  }

  update(weather, cooldown, paused) {
    if (!this.started || !this.context || !this.nodes) return;
    const now = this.context.currentTime;
    const wind = Math.min(1, weather.wind * 0.82 + weather.snow * 0.22);
    const pump = Math.min(1, cooldown / 1.1);
    this.nodes.windGain.gain.setTargetAtTime(paused ? wind * 0.035 : wind * 0.105, now, 0.45);
    this.nodes.snowGain.gain.setTargetAtTime(paused ? 0 : weather.snow * 0.032, now, 0.5);
    this.nodes.windFilter.frequency.setTargetAtTime(280 + weather.wind * 760, now, 0.8);
    this.nodes.pumpGain.gain.setTargetAtTime(pump * 0.038, now, 0.35);
  }
}
