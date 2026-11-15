const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class CaveAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.motor = null;
    this.motorGain = null;
    this.echoDelay = null;
    this.echoFeedback = null;
    this.echoTimer = 0;
    this.enabled = true;
    this.ready = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return false;
      }
      this.context = new AudioContextClass();
      this.buildGraph();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.ready = true;
    return this.enabled;
  }

  buildGraph() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.72 : 0;
    this.master.connect(ctx.destination);

    const motorOsc = ctx.createOscillator();
    motorOsc.type = "sawtooth";
    motorOsc.frequency.value = 48;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 180;
    motorFilter.Q.value = 1.3;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0.018;
    motorOsc.connect(motorFilter);
    motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.master);
    motorOsc.start();
    this.motor = { osc: motorOsc, filter: motorFilter };

    const drone = ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 31;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.018;
    drone.connect(droneGain);
    droneGain.connect(this.master);
    drone.start();

    const waterBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = waterBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.94 + white * 0.06;
      data[index] = previous * 0.5;
    }
    const water = ctx.createBufferSource();
    water.buffer = waterBuffer;
    water.loop = true;
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = "lowpass";
    waterFilter.frequency.value = 420;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.022;
    water.connect(waterFilter);
    waterFilter.connect(waterGain);
    waterGain.connect(this.master);
    water.start();

    this.echoDelay = ctx.createDelay(0.8);
    this.echoDelay.delayTime.value = 0.28;
    this.echoFeedback = ctx.createGain();
    this.echoFeedback.gain.value = 0.2;
    const echoFilter = ctx.createBiquadFilter();
    echoFilter.type = "lowpass";
    echoFilter.frequency.value = 1500;
    this.echoDelay.connect(echoFilter);
    echoFilter.connect(this.echoFeedback);
    this.echoFeedback.connect(this.echoDelay);
    echoFilter.connect(this.master);
  }

  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      await this.ensure();
    }
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.enabled ? 0.72 : 0,
        this.context.currentTime,
        0.04,
      );
    }
    return this.enabled;
  }

  setMotion({ speed, thrust, battery, tilt, clearance, paused }) {
    if (!this.ready || !this.context) {
      return;
    }
    const now = this.context.currentTime;
    const motorLevel = this.enabled
      ? clamp(0.012 + Math.abs(thrust) * 0.031 + speed * 0.00009, 0.012, 0.065)
      : 0;
    const frequency =
      38 + Math.abs(speed) * 0.76 + Math.abs(tilt) * 74 + (100 - battery) * 0.18;
    this.motor.osc.frequency.setTargetAtTime(frequency, now, 0.09);
    this.motor.filter.frequency.setTargetAtTime(
      120 + Math.abs(speed) * 1.7 + Math.abs(thrust) * 90,
      now,
      0.1,
    );
    this.motorGain.gain.setTargetAtTime(paused ? 0 : motorLevel, now, 0.07);
    this.echoDelay.delayTime.setTargetAtTime(
      0.17 + clamp(1 - clearance / 330, 0, 1) * 0.17,
      now,
      0.25,
    );
    this.echoFeedback.gain.setTargetAtTime(
      0.14 + clamp(1 - clearance / 260, 0, 1) * 0.16,
      now,
      0.25,
    );
  }

  update(dt, telemetry, paused) {
    if (!this.ready || !this.context || !this.enabled || paused) {
      return;
    }
    this.echoTimer -= dt;
    if (this.echoTimer <= 0) {
      const clearance = telemetry?.clearancePx ?? 180;
      this.echoTimer = clamp(1.4 + clearance / 110, 1.5, 3.3);
      this.echo(clamp(1 - clearance / 290, 0.05, 0.9));
    }
  }

  echo(strength = 0.45) {
    if (!this.ready || !this.enabled) {
      return;
    }
    const ctx = this.context;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(760 + strength * 260, now);
    osc.frequency.exponentialRampToValueAtTime(410, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.015 + strength * 0.02, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.echoDelay);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  tone({ frequency, duration, type = "sine", volume = 0.04, slide = 1, delay = 0 }) {
    if (!this.ready || !this.enabled) {
      return;
    }
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, frequency * slide), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  collision(intensity = 1) {
    this.tone({
      frequency: 82,
      duration: 0.38,
      type: "triangle",
      volume: 0.055 * intensity,
      slide: 0.48,
    });
    this.tone({
      frequency: 176,
      duration: 0.2,
      type: "square",
      volume: 0.012,
      slide: 0.64,
      delay: 0.03,
    });
  }

  pickup() {
    [392, 523, 659].forEach((frequency, index) => {
      this.tone({
        frequency,
        duration: 0.32,
        type: "sine",
        volume: 0.036,
        slide: 1.05,
        delay: index * 0.095,
      });
    });
  }

  checkpoint() {
    this.tone({ frequency: 660, duration: 0.18, volume: 0.022 });
    this.tone({ frequency: 880, duration: 0.24, volume: 0.02, delay: 0.1 });
  }

  success() {
    [261.6, 329.6, 392, 523.3].forEach((frequency, index) => {
      this.tone({
        frequency,
        duration: 0.7,
        type: "triangle",
        volume: 0.033,
        slide: 1.01,
        delay: index * 0.12,
      });
    });
  }

  failure() {
    this.tone({
      frequency: 128,
      duration: 0.9,
      type: "sawtooth",
      volume: 0.03,
      slide: 0.35,
    });
  }
}
