(function (root) {
  "use strict";

  class RainforestAudio {
    constructor() {
      this.context = null;
      this.master = null;
      this.rainGain = null;
      this.windGain = null;
      this.pulleyOscillator = null;
      this.pulleyGain = null;
      this.brakeGain = null;
      this.muted = false;
      this.started = false;
    }

    ensure() {
      if (this.context) {
        if (this.context.state === "suspended") {
          this.context.resume();
        }
        return true;
      }
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) {
        return false;
      }
      const context = new AudioContext();
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.32;
      this.master.connect(context.destination);

      const rainSource = this.createNoiseSource("rain");
      const rainFilter = context.createBiquadFilter();
      rainFilter.type = "highpass";
      rainFilter.frequency.value = 1100;
      rainFilter.Q.value = 0.35;
      this.rainGain = context.createGain();
      this.rainGain.gain.value = 0;
      rainSource.connect(rainFilter);
      rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.master);
      rainSource.start();

      const windSource = this.createNoiseSource("wind");
      const windFilter = context.createBiquadFilter();
      windFilter.type = "lowpass";
      windFilter.frequency.value = 460;
      windFilter.Q.value = 0.6;
      this.windGain = context.createGain();
      this.windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      windSource.start();

      this.pulleyOscillator = context.createOscillator();
      this.pulleyOscillator.type = "sawtooth";
      this.pulleyOscillator.frequency.value = 72;
      const pulleyFilter = context.createBiquadFilter();
      pulleyFilter.type = "lowpass";
      pulleyFilter.frequency.value = 760;
      this.pulleyGain = context.createGain();
      this.pulleyGain.gain.value = 0;
      this.pulleyOscillator.connect(pulleyFilter);
      pulleyFilter.connect(this.pulleyGain);
      this.pulleyGain.connect(this.master);
      this.pulleyOscillator.start();

      const brakeSource = this.createNoiseSource("brake");
      const brakeFilter = context.createBiquadFilter();
      brakeFilter.type = "bandpass";
      brakeFilter.frequency.value = 2200;
      brakeFilter.Q.value = 1.6;
      this.brakeGain = context.createGain();
      this.brakeGain.gain.value = 0;
      brakeSource.connect(brakeFilter);
      brakeFilter.connect(this.brakeGain);
      this.brakeGain.connect(this.master);
      brakeSource.start();
      this.started = true;
      return true;
    }

    createNoiseSource(kind) {
      const context = this.context;
      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        if (kind === "wind") {
          last = last * 0.985 + white * 0.015;
          channel[index] = last * 5;
        } else {
          channel[index] = white;
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      return source;
    }

    setMuted(muted) {
      this.muted = Boolean(muted);
      if (this.master && this.context) {
        this.master.gain.setTargetAtTime(
          this.muted ? 0 : 0.32,
          this.context.currentTime,
          0.03,
        );
      }
    }

    setScene(scene) {
      if (!this.ensure() || !this.started) {
        return;
      }
      const now = this.context.currentTime;
      const rain = scene.rain == null ? 0.55 : scene.rain;
      const wind = scene.wind == null ? 8 : Math.abs(scene.wind);
      const speed = scene.speed || 0;
      this.rainGain.gain.setTargetAtTime(0.06 + rain * 0.11, now, 0.2);
      this.windGain.gain.setTargetAtTime(0.025 + wind * 0.0045, now, 0.25);
      this.pulleyOscillator.frequency.setTargetAtTime(
        62 + speed * 17,
        now,
        0.04,
      );
      this.pulleyGain.gain.setTargetAtTime(
        scene.riding ? 0.022 + Math.min(speed, 22) * 0.0028 : 0.006,
        now,
        0.05,
      );
      this.brakeGain.gain.setTargetAtTime(
        scene.braking ? 0.035 + speed * 0.002 : 0,
        now,
        0.025,
      );
    }

    tone(frequency, duration, gainValue, type) {
      if (!this.ensure()) {
        return;
      }
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(gainValue || 0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    select() {
      this.tone(540, 0.09, 0.03, "triangle");
    }

    launch() {
      this.tone(240, 0.12, 0.045, "triangle");
      setTimeout(() => this.tone(420, 0.18, 0.035, "sine"), 80);
    }

    hazard() {
      this.tone(150, 0.14, 0.06, "square");
    }

    success() {
      this.tone(523, 0.18, 0.05, "sine");
      setTimeout(() => this.tone(659, 0.2, 0.045, "sine"), 120);
      setTimeout(() => this.tone(784, 0.32, 0.04, "sine"), 250);
    }

    failure() {
      this.tone(132, 0.32, 0.07, "sawtooth");
      setTimeout(() => this.tone(96, 0.45, 0.055, "sawtooth"), 150);
    }
  }

  root.ZiplineAudio = RainforestAudio;
})(typeof globalThis !== "undefined" ? globalThis : this);
