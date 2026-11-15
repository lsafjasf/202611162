// Web Audio 程序化音效：泵机转速随开关变化，无外部音频文件，确定性（仅响应状态）。
(function (root) {
  "use strict";

  function PumpAudio() {
    var ctx = null, master, irrOsc, irrGain, drainOsc, drainGain, noiseBuf, noiseSrc, noiseGain;
    var irrLevel = 0, drainLevel = 0;

    function ensure() {
      if (ctx) return;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.08;
      master.connect(ctx.destination);

      irrOsc = ctx.createOscillator();
      irrOsc.type = "sawtooth"; irrOsc.frequency.value = 70;
      irrGain = ctx.createGain(); irrGain.gain.value = 0;
      irrOsc.connect(irrGain).connect(master); irrOsc.start();

      drainOsc = ctx.createOscillator();
      drainOsc.type = "square"; drainOsc.frequency.value = 48;
      drainGain = ctx.createGain(); drainGain.gain.value = 0;
      drainOsc.connect(drainGain).connect(master); drainOsc.start();

      var len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
      noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
      noiseSrc.connect(noiseGain).connect(master); noiseSrc.start();
    }

    function resume() { if (ctx && ctx.state === "suspended") ctx.resume(); }

    function setPumps(irrigOn, drainOn) {
      ensure(); resume();
      irrLevel = irrigOn ? 1 : 0;
      drainLevel = drainOn ? 1 : 0;
    }

    // 每帧平滑逼近目标，形成“转速爬升/回落”
    function update() {
      if (!ctx) return;
      var t = ctx.currentTime;
      irrGain.gain.setTargetAtTime(irrLevel * 0.5, t, 0.12);
      drainGain.gain.setTargetAtTime(drainLevel * 0.4, t, 0.12);
      noiseGain.gain.setTargetAtTime(Math.max(irrLevel, drainLevel) * 0.15, t, 0.2);
      irrOsc.frequency.setTargetAtTime(60 + irrLevel * 90, t, 0.1);
      drainOsc.frequency.setTargetAtTime(42 + drainLevel * 60, t, 0.1);
    }

    function blip(freq) {
      ensure(); resume();
      if (!ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      o.connect(g).connect(master);
      o.start(); o.stop(ctx.currentTime + 0.24);
    }

    return {
      setPumps: setPumps,
      update: update,
      click: function () { blip(520); },
      warn: function () { blip(200); },
      success: function () { blip(660); setTimeout(function () { blip(880); }, 140); }
    };
  }

  root.PumpAudio = PumpAudio;
})(typeof window !== "undefined" ? window : globalThis);
