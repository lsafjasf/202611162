/*
 * Web Audio 合成环境声：
 * - 滤波白噪声模拟风/水声，强度跟随天气与水深；
 * - 正弦+包络短促音模拟鸟鸣；
 * - 低频方波扫频作为惊飞警示音。
 * 不加载任何音频文件，用户首次点击页面后初始化 AudioContext。
 */
(function (root) {
  'use strict';

  function AmbientAudio() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.waterGain = null;
    this.birdTimer = null;
    this.muted = false;
  }

  AmbientAudio.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    var bufferSize = 2 * this.ctx.sampleRate;
    var buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    var noise = this.ctx.createBufferSource();
    noise.buffer = buffer; noise.loop = true;

    var windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass'; windFilter.frequency.value = 420;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0.05;
    noise.connect(windFilter); windFilter.connect(this.windGain); this.windGain.connect(this.master);

    var waterFilter = this.ctx.createBiquadFilter();
    waterFilter.type = 'bandpass'; waterFilter.frequency.value = 1400; waterFilter.Q.value = 0.6;
    this.waterGain = this.ctx.createGain(); this.waterGain.gain.value = 0.02;
    noise.connect(waterFilter); waterFilter.connect(this.waterGain); this.waterGain.connect(this.master);
    noise.start();

    var self = this;
    this.birdTimer = setInterval(function () { self.maybeChirp(); }, 2200);
  };

  AmbientAudio.prototype.maybeChirp = function () {
    if (!this.ctx || this.muted || Math.random() > 0.7) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    var base = 1800 + Math.random() * 1400;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.4, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.2);
  };

  AmbientAudio.prototype.flushAlarm = function () {
    if (!this.ctx || this.muted) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.45);
  };

  AmbientAudio.prototype.update = function (sim) {
    if (!this.ctx || this.muted) return;
    var t = Math.min(sim.tick, 335);
    var wind = sim.weather.wind[t] || 0;
    var rain = sim.weather.rain[t] || 0;
    var avgDepth = sim.sites.reduce(function (a, s) { return a + s.depth; }, 0) / 3 / 90;
    var t0 = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.03 + wind * 0.12 + rain * 0.08, t0, 0.4);
    this.waterGain.gain.setTargetAtTime(0.015 + avgDepth * 0.06, t0, 0.4);
    if (sim.sites.some(function (s) { return s.flock && s.flock.justFlushed; })) {
      this.flushAlarm();
    }
  };

  AmbientAudio.prototype.toggleMute = function () {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  };

  root.AMBIENT = new AmbientAudio();
})(typeof window !== 'undefined' ? window : globalThis);
