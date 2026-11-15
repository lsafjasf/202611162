/* WebAudio 声音引擎：电机嗡鸣 + 挤出机低频脉动，随转速/张力/状态变化 */
(function () {
  'use strict';

  function SoundEngine() {
    this.ctx = null;
    this.muted = false;
    this.nodes = {};
  }

  SoundEngine.prototype.ensure = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    var ctx = this.ctx;
    var master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // 电机基频：螺杆转速 -> 60..160 Hz 锯齿波
    var motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 80;
    var motorGain = ctx.createGain();
    motorGain.gain.value = 0.18;
    motor.connect(motorGain).connect(master);
    motor.start();

    // 挤出机脉动：低频 LFO 调制增益
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 2.5;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain).connect(master.gain);
    lfo.start();

    // 收线轴高频谐波：随张力变化
    var winder = ctx.createOscillator();
    winder.type = 'triangle';
    winder.frequency.value = 320;
    var winderGain = ctx.createGain();
    winderGain.gain.value = 0.05;
    winder.connect(winderGain).connect(master);
    winder.start();

    this.nodes = {
      master: master, motor: motor, motorGain: motorGain,
      lfo: lfo, winder: winder, winderGain: winderGain
    };
  };

  SoundEngine.prototype.update = function (sim) {
    if (!this.ctx || !this.nodes.master) return;
    var n = this.nodes, ctx = this.ctx;
    var running = sim.state === 'running' && !sim.paused;
    var target = this.muted ? 0 : (running ? 0.9 : (sim.state === 'purging' ? 0.5 : 0));
    n.master.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
    var rpm = sim.params.screw;
    n.motor.frequency.setTargetAtTime(55 + rpm * 1.05, ctx.currentTime, 0.1);
    n.lfo.frequency.setTargetAtTime(1.5 + rpm / 30, ctx.currentTime, 0.2);
    n.winder.frequency.setTargetAtTime(240 + sim.params.tension * 9, ctx.currentTime, 0.2);
    n.winderGain.gain.setTargetAtTime(sim.devices.winder.running ? 0.05 : 0, ctx.currentTime, 0.2);
    if (sim.state === 'alarm') this.beep();
  };

  SoundEngine.prototype.beep = function () {
    if (!this.ctx || this._lastBeep && this.ctx.currentTime - this._lastBeep < 0.6) return;
    this._lastBeep = this.ctx.currentTime;
    var o = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.12, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.26);
  };

  SoundEngine.prototype.toggleMute = function () {
    this.muted = !this.muted;
    return this.muted;
  };

  window.CableSound = SoundEngine;
})();
