import { createRng } from "./rng.js";

export class GreenhouseAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.nodes = null;
  }

  async toggle() {
    if (!this.ctx) this.createGraph();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.enabled = !this.enabled;
    this.nodes.master.gain.setTargetAtTime(this.enabled ? 0.34 : 0, this.ctx.currentTime, 0.08);
    return this.enabled;
  }

  createGraph() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = "bandpass";
    buzzFilter.frequency.value = 245;
    buzzFilter.Q.value = 1.9;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0;
    buzzFilter.connect(buzzGain);
    buzzGain.connect(master);

    const buzzA = ctx.createOscillator();
    buzzA.type = "sawtooth";
    buzzA.frequency.value = 104;
    const buzzB = ctx.createOscillator();
    buzzB.type = "triangle";
    buzzB.frequency.value = 137;
    const buzzMix = ctx.createGain();
    buzzMix.gain.value = 0.17;
    buzzA.connect(buzzMix);
    buzzB.connect(buzzMix);
    buzzMix.connect(buzzFilter);

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 5.7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(buzzA.frequency);
    lfoGain.connect(buzzB.frequency);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    const rng = createRng("greenhouse-audio-fan");
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = rng.between(-1, 1);
      last = last * 0.86 + white * 0.14;
      data[index] = last;
    }
    const fanNoise = ctx.createBufferSource();
    fanNoise.buffer = noiseBuffer;
    fanNoise.loop = true;
    const fanFilter = ctx.createBiquadFilter();
    fanFilter.type = "lowpass";
    fanFilter.frequency.value = 560;
    fanFilter.Q.value = 0.7;
    const fanGain = ctx.createGain();
    fanGain.gain.value = 0;
    fanNoise.connect(fanFilter);
    fanFilter.connect(fanGain);
    fanGain.connect(master);

    const motor = ctx.createOscillator();
    motor.type = "sine";
    motor.frequency.value = 61;
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0;
    motor.connect(motorGain);
    motorGain.connect(master);

    buzzA.start();
    buzzB.start();
    lfo.start();
    fanNoise.start();
    motor.start();
    this.nodes = {
      master,
      buzzFilter,
      buzzGain,
      buzzA,
      buzzB,
      lfo,
      fanFilter,
      fanGain,
      motor,
      motorGain,
    };
  }

  update(sim) {
    if (!this.ctx || !this.nodes || !this.enabled) return;
    const now = this.ctx.currentTime;
    const active = sim.running ? Math.min(1, sim.activeBees / 38) : 0;
    const temperaturePitch = 0.92 + Math.min(0.2, Math.max(0, sim.temperature - 18) * 0.01);
    const toxicity = 1 - Math.min(0.35, sim.pesticideResidual * 0.2);
    this.nodes.buzzGain.gain.setTargetAtTime(active * 0.13 * toxicity, now, 0.35);
    this.nodes.buzzA.frequency.setTargetAtTime(101 * temperaturePitch, now, 0.5);
    this.nodes.buzzB.frequency.setTargetAtTime(137 * temperaturePitch, now, 0.5);
    this.nodes.buzzFilter.frequency.setTargetAtTime(210 + active * 100, now, 0.45);

    const vent = sim.ventMinutes > 0 ? 0.45 : 0;
    const fanLevel = Math.min(1, sim.controls.fan * 0.24 + vent);
    const running = sim.running ? 1 : 0;
    this.nodes.fanGain.gain.setTargetAtTime(fanLevel * 0.11 * running, now, 0.25);
    this.nodes.motorGain.gain.setTargetAtTime(fanLevel * 0.025 * running, now, 0.25);
    this.nodes.motor.frequency.setTargetAtTime(54 + sim.controls.fan * 7, now, 0.5);
    this.nodes.fanFilter.frequency.setTargetAtTime(420 + sim.controls.fan * 170, now, 0.25);
  }

  spray(dose = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const duration = 0.55 + dose * 0.12;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = createRng(`spray-${Math.round(ctx.currentTime * 1000)}`);
    for (let index = 0; index < data.length; index += 1) {
      const envelope = Math.sin((index / data.length) * Math.PI);
      data[index] = rng.between(-1, 1) * envelope;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1500;
    const gain = ctx.createGain();
    gain.gain.value = 0.1 + dose * 0.035;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.nodes.master);
    source.start();
  }

  complete(success) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = success ? [392, 523.25, 659.25] : [220, 174.61];
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, now + index * 0.18);
      gain.gain.linearRampToValueAtTime(0.08, now + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.18 + 0.6);
      oscillator.connect(gain);
      gain.connect(this.nodes.master);
      oscillator.start(now + index * 0.18);
      oscillator.stop(now + index * 0.18 + 0.65);
    });
  }
}
