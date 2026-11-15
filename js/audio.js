/* Web Audio 程序化音效：无外部音频资源，全部由振荡器与噪声合成。 */
(function (root) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.propeller = null;
    this.enabled = true;
    this.birdTimer = 0;
  }

  AudioEngine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.startAmbience();
    this.startPropeller();
  };

  AudioEngine.prototype.startAmbience = function () {
    var ctx = this.ctx;
    var bufferSize = 2 * ctx.sampleRate;
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var last = 0;
    for (var i = 0; i < bufferSize; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    var gain = ctx.createGain();
    gain.gain.value = 0.12;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start();
    this.ambienceGain = gain;
  };

  AudioEngine.prototype.startPropeller = function () {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 9;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    var gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    this.propeller = { osc: osc, gain: gain };
  };

  AudioEngine.prototype.updatePropeller = function (speed, grounded) {
    if (!this.ctx || !this.propeller) return;
    var t = this.ctx.currentTime;
    var thrust = Math.min(1, Math.abs(speed) / 4);
    var targetGain = grounded ? 0.02 : 0.05 + thrust * 0.07;
    this.propeller.gain.gain.setTargetAtTime(targetGain, t, 0.12);
    this.propeller.osc.frequency.setTargetAtTime(45 + thrust * 60 + (grounded ? 20 : 0), t, 0.1);
  };

  AudioEngine.prototype.blip = function (freq, dur, type, vol) {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  };

  AudioEngine.prototype.scrape = function () {
    if (!this.ctx || !this.enabled) return;
    var ctx = this.ctx;
    var buffer = ctx.createBuffer(1, ctx.sampleRate * 0.35, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 240;
    var gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
  };

  AudioEngine.prototype.splash = function () {
    this.blip(180 + Math.random() * 60, 0.25, 'triangle', 0.18);
  };

  AudioEngine.prototype.bird = function () {
    if (!this.ctx || !this.enabled) return;
    var base = 900 + Math.random() * 700;
    this.blip(base, 0.09, 'sine', 0.12);
    var self = this;
    setTimeout(function () { self.blip(base * 1.25, 0.12, 'sine', 0.1); }, 130);
  };

  AudioEngine.prototype.maybeBird = function (dt) {
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.bird();
      this.birdTimer = 4 + Math.random() * 9;
    }
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  };

  root.MarshAudio = AudioEngine;
})(typeof self !== 'undefined' ? self : this);
