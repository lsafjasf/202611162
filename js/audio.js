// 全部声音由 Web Audio 合成，无外部资源；Node 环境下自动降级为空实现。
export function createAudio() {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return { resume() {}, blip() {}, collision() {}, unload() {}, update() {}, setMuted() {} };
  }
  const ctx = new AudioContext();
  let muted = false;

  // 水流：持续白噪声经低通滤波，音量/亮度随航速与漩涡距离变化。
  const bufferSize = ctx.sampleRate * 2;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  const gain = ctx.createGain();
  gain.gain.value = 0.0;
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start();

  function tone(freq, dur, type = 'sine', vol = 0.15, slideTo = null) {
    if (muted) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), ctx.currentTime + dur);
    }
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  return {
    resume() {
      if (ctx.state === 'suspended') ctx.resume();
    },
    setMuted(value) {
      muted = value;
      gain.gain.value = muted ? 0 : gain.gain.value;
    },
    get muted() {
      return muted;
    },
    blip(kind) {
      if (kind === 'grab') tone(520, 0.12, 'square', 0.1, 760);
      else if (kind === 'miss') tone(220, 0.35, 'sawtooth', 0.12, 90);
      else if (kind === 'checkpoint') tone(660, 0.15, 'triangle', 0.12, 990);
      else if (kind === 'snap') tone(180, 0.3, 'sawtooth', 0.16, 60);
      else tone(340, 0.06, 'sine', 0.06);
    },
    collision() {
      tone(120, 0.4, 'sawtooth', 0.2, 45);
    },
    unload() {
      tone(440, 0.12, 'triangle', 0.12);
      setTimeout(() => tone(660, 0.16, 'triangle', 0.12), 110);
    },
    // speed：船速；eddy：是否处于漩涡；tension：缆绳张力
    update(speed, inEddy, tensionLevel) {
      if (muted) return;
      const target = Math.min(0.16, 0.03 + speed / 175 * 0.1) + (inEddy ? 0.08 : 0);
      gain.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
      filter.frequency.setTargetAtTime(
        380 + speed * 2.4 + (inEddy ? 700 : 0) + tensionLevel * 300,
        ctx.currentTime,
        0.25
      );
    }
  };
}
