export function createAudio() {
  let ctx = null;
  let windGain;
  let engineGain;
  let engineOsc;
  let muted = false;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter).connect(windGain).connect(ctx.destination);
    noise.start();

    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter).connect(engineGain).connect(ctx.destination);
    engineOsc.start();
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    update(state) {
      if (!ctx || muted) {
        if (windGain) windGain.gain.value = 0;
        if (engineGain) engineGain.gain.value = 0;
        return;
      }
      const windLevel = 0.015 + state.wind.strength * 0.09;
      windGain.gain.setTargetAtTime(windLevel, ctx.currentTime, 0.12);
      const speedRatio = Math.abs(state.vehicle.speed) / 215;
      engineGain.gain.setTargetAtTime(0.012 + speedRatio * 0.06, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(48 + speedRatio * 130, ctx.currentTime, 0.08);
    },
    beep(kind = 'info') {
      ensure();
      if (!ctx || muted) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const freq = kind === 'good' ? 660 : kind === 'fail' ? 180 : kind === 'warn' ? 320 : 440;
      osc.frequency.value = freq;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    get muted() {
      return muted;
    }
  };
}
