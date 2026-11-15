(function () {
  class MachineAudio {
    constructor() {
      this.enabled = false;
      this.context = null;
      this.master = null;
      this.hum = null;
      this.harmonic = null;
      this.humGain = null;
      this.harmonicGain = null;
      this.filter = null;
      this.lastTick = 0;
    }

    ensure() {
      if (this.context) return;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      this.context = new AudioCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);

      this.filter = this.context.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 420;
      this.filter.Q.value = 0.7;
      this.filter.connect(this.master);

      this.humGain = this.context.createGain();
      this.humGain.gain.value = 0.03;
      this.humGain.connect(this.filter);
      this.hum = this.context.createOscillator();
      this.hum.type = "triangle";
      this.hum.frequency.value = 46;
      this.hum.connect(this.humGain);

      this.harmonicGain = this.context.createGain();
      this.harmonicGain.gain.value = 0.008;
      this.harmonicGain.connect(this.filter);
      this.harmonic = this.context.createOscillator();
      this.harmonic.type = "sawtooth";
      this.harmonic.frequency.value = 138;
      this.harmonic.connect(this.harmonicGain);

      this.hum.start();
      this.harmonic.start();
    }

    async toggle() {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this.ensure();
        if (this.context && this.context.state === "suspended") {
          await this.context.resume();
        }
        this.setLevel(0.04, 0.07);
      } else {
        this.setLevel(0, 0.025);
      }
      return this.enabled;
    }

    setLevel(target, seconds) {
      if (!this.context || !this.master) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.enabled ? target : 0, now, seconds);
    }

    setMotion(velocity, phase, active) {
      if (!this.enabled || !this.context || !this.hum) return;
      const now = this.context.currentTime;
      const speed = Math.min(1, Math.max(0, velocity));
      const movement = active ? speed : 0;
      const pulse = active ? Math.max(0, Math.sin(phase * Math.PI * 2)) * 0.25 : 0;
      const targetGain = active ? 0.045 + movement * 0.075 + pulse * 0.02 : 0.008;
      this.humGain.gain.setTargetAtTime(targetGain, now, 0.08);
      this.harmonicGain.gain.setTargetAtTime(active ? 0.007 + movement * 0.019 : 0.002, now, 0.08);
      this.hum.frequency.setTargetAtTime(43 + movement * 39 + Math.sin(phase * 8) * 2, now, 0.12);
      this.harmonic.frequency.setTargetAtTime(126 + movement * 108, now, 0.1);
      this.filter.frequency.setTargetAtTime(260 + movement * 580, now, 0.1);
      this.setLevel(active ? 0.36 + speed * 0.36 : 0.06, 0.12);
    }

    tick(kind = "place") {
      if (!this.enabled) return;
      this.ensure();
      if (!this.context) return;
      const now = performance.now();
      if (now - this.lastTick < 120) return;
      this.lastTick = now;
      const ctx = this.context;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = kind === "pick" ? "square" : "triangle";
      osc.frequency.setValueAtTime(kind === "pick" ? 96 : 72, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(kind === "pick" ? 54 : 38, ctx.currentTime + 0.09);
      filter.type = "bandpass";
      filter.frequency.value = kind === "pick" ? 260 : 180;
      filter.Q.value = 1.4;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    }

    faultAlarm() {
      if (!this.enabled) return;
      this.ensure();
      if (!this.context) return;
      const ctx = this.context;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(720, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start();
      osc.stop(ctx.currentTime + 0.34);
    }
  }

  window.LaminaAudio = new MachineAudio();
})();
