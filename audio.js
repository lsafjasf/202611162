/* Web Audio 合成:水下环境底噪、气泡、水泵/冷水机设备声、操作音效 */
(function (global) {
  'use strict';

  class AudioSys {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this._bubbleTimer = 0;
    }

    ensure() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(ctx.destination);
      // 水下底噪:循环噪声 → 低通 + 缓慢 LFO
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02; // 布朗化
        data[i] = last * 3;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      this.noiseFilter = ctx.createBiquadFilter();
      this.noiseFilter.type = 'lowpass';
      this.noiseFilter.frequency.value = 320;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0.12;
      noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
      noise.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 120;
      lfo.connect(lfoGain).connect(this.noiseFilter.frequency);
      lfo.start();
      // 水泵嗡鸣(流速高时)
      this.pump = ctx.createOscillator();
      this.pump.type = 'sawtooth';
      this.pump.frequency.value = 52;
      this.pumpGain = ctx.createGain();
      this.pumpGain.gain.value = 0;
      this.pump.connect(this.pumpGain).connect(this.master);
      this.pump.start();
      // 冷水机低频哼声
      this.chiller = ctx.createOscillator();
      this.chiller.type = 'square';
      this.chiller.frequency.value = 88;
      this.chillerGain = ctx.createGain();
      this.chillerGain.gain.value = 0;
      this.chiller.connect(this.chillerGain).connect(this.master);
      this.chiller.start();
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.6;
    }

    /* 每帧根据环境更新持续声 */
    update(env, dtReal) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this.pumpGain.gain.setTargetAtTime(env.flow > 0.7 ? (env.flow - 0.7) * 0.12 : 0, t, 0.2);
      this.chillerGain.gain.setTargetAtTime(env.chillerOn ? 0.02 : 0, t, 0.3);
      this._bubbleTimer -= dtReal;
      if (this._bubbleTimer <= 0) {
        this._bubbleTimer = 0.4 + Math.random() * 1.6;
        this.bubble();
      }
    }

    bubble() {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const f0 = 500 + Math.random() * 500;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.8, t + 0.15);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.2);
    }

    _blip(freq, dur, type, vol) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.05);
    }

    clean() {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const len = ctx.sampleRate * 0.35;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.25;
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
    }

    transplant() { this._blip(660, 0.12); setTimeout(() => this._blip(880, 0.15), 120); }
    ok() { this._blip(520, 0.1); }
    fail() { this._blip(140, 0.3, 'square', 0.08); }
    alarm() { this._blip(980, 0.15, 'triangle', 0.07); setTimeout(() => this._blip(980, 0.15, 'triangle', 0.07), 200); }
  }

  global.AudioSys = AudioSys;
})(window);
