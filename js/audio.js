/* 解析式音效：全部由 Web Audio 振荡器与滤波噪声实时合成，无外部音频资源 */
(function (global) {
  function createAudioEngine() {
    let ctx = null;
    let master = null;
    let engineOsc = null;
    let engineOsc2 = null;
    let engineGain = null;
    let skidSource = null;
    let skidGain = null;
    let windSource = null;
    let windGain = null;
    let muted = false;

    function makeNoiseBuffer(ac) {
      const len = ac.sampleRate * 2;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);

      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 110;
      const eg2 = ctx.createGain();
      eg2.gain.value = 0.35;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 700;
      engineOsc.connect(engineGain);
      engineOsc2.connect(eg2);
      eg2.connect(engineGain);
      engineGain.connect(engineFilter);
      engineFilter.connect(master);
      engineOsc.start();
      engineOsc2.start();

      const noise = makeNoiseBuffer(ctx);
      skidSource = ctx.createBufferSource();
      skidSource.buffer = noise;
      skidSource.loop = true;
      const skidFilter = ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.value = 1800;
      skidGain = ctx.createGain();
      skidGain.gain.value = 0;
      skidSource.connect(skidFilter);
      skidFilter.connect(skidGain);
      skidGain.connect(master);
      skidSource.start();

      windSource = ctx.createBufferSource();
      windSource.buffer = noise;
      windSource.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 420;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSource.start();
    }

    function update(params) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const rpm = 55 + params.speedRatio * 150 + params.throttle * 45;
      engineOsc.frequency.setTargetAtTime(rpm, t, 0.05);
      engineOsc2.frequency.setTargetAtTime(rpm * 2.01, t, 0.05);
      engineGain.gain.setTargetAtTime(params.engineOn ? 0.1 + params.throttle * 0.08 : 0, t, 0.1);
      skidGain.gain.setTargetAtTime(params.skid, t, 0.08);
      windGain.gain.setTargetAtTime(0.04 + params.wind * 0.12, t, 0.2);
    }

    function thump(strength) {
      if (!ctx || muted) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(42, ctx.currentTime + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, 0.18 + strength * 0.004), ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    }

    function beep(freq, dur) {
      if (!ctx || muted) return;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.02);
    }

    function setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.55;
    }

    return { init, update, thump, beep, setMuted, get ready() { return !!ctx; } };
  }

  const api = { createAudioEngine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SnowAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
