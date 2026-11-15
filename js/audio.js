/* 声音模块：WebAudio 合成，无需音频文件。
   提供设备操作反馈（监测/诱捕/喷药）与警报（暴发/失败/成功）。 */
(function (global) {
  'use strict';

  function AudioHub() {
    this.ctx = null;
    this.muted = false;
  }
  AudioHub.prototype.ensure = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  };
  AudioHub.prototype.tone = function (freq, dur, type, gainVal, when) {
    if (this.muted) return;
    var ctx = this.ensure();
    if (!ctx) return;
    var t0 = ctx.currentTime + (when || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainVal || 0.12, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };
  AudioHub.prototype.noise = function (dur, gainVal) {
    if (this.muted) return;
    var ctx = this.ensure();
    if (!ctx) return;
    var buffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    var src = ctx.createBufferSource();
    var gain = ctx.createGain();
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    gain.gain.value = gainVal || 0.1;
    src.buffer = buffer;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  };

  AudioHub.prototype.survey = function () {
    this.tone(660, 0.12, 'triangle', 0.1);
    this.tone(880, 0.14, 'triangle', 0.08, 0.09);
  };
  AudioHub.prototype.trap = function () {
    this.tone(320, 0.16, 'square', 0.07);
  };
  AudioHub.prototype.spray = function (broad) {
    this.noise(broad ? 0.5 : 0.3, broad ? 0.14 : 0.09);
    this.tone(broad ? 180 : 240, 0.25, 'sawtooth', 0.05);
  };
  AudioHub.prototype.alarm = function () {
    this.tone(520, 0.18, 'square', 0.1);
    this.tone(392, 0.22, 'square', 0.1, 0.2);
  };
  AudioHub.prototype.fail = function () {
    this.tone(300, 0.3, 'sawtooth', 0.1);
    this.tone(180, 0.5, 'sawtooth', 0.1, 0.28);
  };
  AudioHub.prototype.win = function () {
    [523, 659, 784, 1047].forEach(function (f, i) {
      this.tone(f, 0.18, 'triangle', 0.1, i * 0.14);
    }, this);
  };
  AudioHub.prototype.toggleMute = function () {
    this.muted = !this.muted;
    return this.muted;
  };

  global.AudioHub = AudioHub;
})(typeof window !== 'undefined' ? window : globalThis);
