export class LineAudio {
  constructor() {
    this.enabled = false;
    this.context = null;
    this.nodes = null;
  }

  async enable() {
    this.enabled = true;
    await this.ensure();
    if (this.context?.state === "suspended") await this.context.resume();
  }

  disable() {
    this.enabled = false;
    if (this.nodes && this.context) {
      this.nodes.master.gain.setTargetAtTime(0, this.context.currentTime, 0.03);
    }
  }

  async ensure() {
    if (this.context) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.context = new AudioCtor();
    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const makeOscillator = (type, frequency, gainValue) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start();
      return { oscillator, gain };
    };

    const arm = makeOscillator("sawtooth", 104, 0);
    const conveyor = makeOscillator("triangle", 46, 0);
    const sealer = makeOscillator("square", 64, 0);
    const sealerFilter = ctx.createBiquadFilter();
    sealerFilter.type = "lowpass";
    sealerFilter.frequency.value = 420;
    sealerFilter.Q.value = 3;
    sealer.gain.disconnect();
    sealer.gain.connect(sealerFilter);
    sealerFilter.connect(master);

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < noiseData.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      noiseData[index] = last * 3.2;
    }
    const noise = ctx.createBufferSource();
    const noiseGain = ctx.createGain();
    const noiseFilter = ctx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noiseGain.gain.value = 0;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 950;
    noiseFilter.Q.value = 0.75;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 13;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain);
    lfoGain.connect(arm.oscillator.frequency);
    lfo.start();

    this.nodes = {
      master,
      arm,
      conveyor,
      sealer,
      sealerFilter,
      noise,
      noiseGain,
      noiseFilter
    };
  }

  update(engine) {
    if (!this.enabled || !this.context || !this.nodes) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const smooth = 0.035;
    const armDevice = engine.devices.roboticArm;
    const sealerDevice = engine.devices.sealer;
    const conveyorDevice = engine.devices.conveyor;
    const armActive = armDevice.active && armDevice.health === "ok";
    const sealerActive = sealerDevice.active && sealerDevice.health === "ok";
    const conveyorActive = conveyorDevice.active && engine.status !== "paused";

    this.nodes.master.gain.setTargetAtTime(engine.status === "fault" ? 0.62 : 0.85, now, 0.04);
    this.nodes.arm.gain.gain.setTargetAtTime(armActive ? 0.027 : 0, now, smooth);
    this.nodes.conveyor.gain.gain.setTargetAtTime(conveyorActive ? 0.022 : 0, now, smooth);
    this.nodes.sealer.gain.gain.setTargetAtTime(sealerActive ? 0.026 : 0, now, 0.018);
    this.nodes.noiseGain.gain.setTargetAtTime(sealerActive ? 0.018 : 0, now, 0.022);

    const armFrequency = 98 + Math.abs(engine.animation.armAngle || 0) * 5.6;
    this.nodes.arm.oscillator.frequency.setTargetAtTime(armFrequency, now, 0.045);
    this.nodes.conveyor.oscillator.frequency.setTargetAtTime(
      conveyorActive ? 44 + Math.sin(engine.animation.clock * 4) * 2 : 38,
      now,
      0.08
    );
    const sealerFrequency = 58 + engine.animation.sealProgress * 15;
    this.nodes.sealer.oscillator.frequency.setTargetAtTime(sealerFrequency, now, 0.03);
    this.nodes.sealerFilter.frequency.setTargetAtTime(
      270 + engine.animation.sealProgress * 520,
      now,
      0.025
    );
    this.nodes.noiseFilter.frequency.setTargetAtTime(
      680 + engine.animation.sealProgress * 760,
      now,
      0.035
    );
  }

  cue(type) {
    if (!this.enabled || !this.context || !this.nodes) return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const settings = {
      scan: { type: "sine", from: 980, to: 1320, volume: 0.055, duration: 0.11 },
      fault: { type: "square", from: 150, to: 88, volume: 0.09, duration: 0.32 },
      recover: { type: "sine", from: 420, to: 720, volume: 0.05, duration: 0.2 },
      snapshot: { type: "triangle", from: 660, to: 990, volume: 0.04, duration: 0.14 },
      complete: { type: "sine", from: 520, to: 1040, volume: 0.045, duration: 0.22 }
    }[type];
    if (!settings) return;
    oscillator.type = settings.type;
    oscillator.frequency.setValueAtTime(settings.from, now);
    oscillator.frequency.exponentialRampToValueAtTime(settings.to, now + settings.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(settings.volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + settings.duration);
    oscillator.connect(gain);
    gain.connect(this.nodes.master);
    oscillator.start(now);
    oscillator.stop(now + settings.duration + 0.02);
  }
}
