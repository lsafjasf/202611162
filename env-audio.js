/*
 * env-audio.js — Web Audio 设备反馈音（无外部资源，全部合成）
 */
(function (global) {
  'use strict';

  class AudioFX {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }

    ensure() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    setMuted(m) { this.muted = m; }

    tone(freq, dur, type, gain, when) {
      if (this.muted) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + (when || 0);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    // 操作反馈
    sampler() { this.tone(520, 0.12, 'triangle', 0.1); }
    calibrate() { this.tone(660, 0.1, 'sine', 0.1); this.tone(880, 0.14, 'sine', 0.08, 0.09); }
    investigate() { this.tone(340, 0.18, 'sawtooth', 0.07); }
    recordOk() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.1, i * 0.1)); }
    reject() { this.tone(220, 0.22, 'square', 0.08); this.tone(160, 0.25, 'square', 0.07, 0.12); }
    success() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.11, i * 0.13)); }
    fail() { [330, 262, 196, 131].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.09, i * 0.16)); }

    // 设备尖峰：短促刺耳警报
    fault() {
      this.tone(1180, 0.09, 'square', 0.09);
      this.tone(1180, 0.09, 'square', 0.09, 0.14);
    }

    // 临界环境：双音循环由 UI 按状态节流触发
    critical() { this.tone(740, 0.12, 'sine', 0.08); this.tone(740, 0.12, 'sine', 0.08, 0.2); }

    // 策略生效
    recoveryA() { [440, 554, 659].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.09, i * 0.12)); }
    recoveryB() { this.tone(300, 0.3, 'triangle', 0.1); this.tone(420, 0.25, 'triangle', 0.08, 0.16); }
  }

  global.AudioFX = AudioFX;
  if (typeof module !== 'undefined' && module.exports) module.exports = { AudioFX };
})(typeof window !== 'undefined' ? window : globalThis);
