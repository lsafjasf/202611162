// 水下环境音:浊度越高声音越闷(低通截止下降),覆盖率越高气泡声越活跃
const SeaAudio = {
  ctx: null, on: false, noise: null, filter: null, gain: null, bubbleTimer: null,
  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    // 粉噪近似:循环噪声缓冲
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.98 * b + 0.02 * w;
      data[i] = b * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 500;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(ctx.destination);
    src.start();
    this.noise = src;
  },
  toggle() {
    this.init();
    this.on = !this.on;
    if (this.on && this.ctx.state === 'suspended') this.ctx.resume();
    this.gain.gain.linearRampToValueAtTime(
      this.on ? 0.25 : 0, this.ctx.currentTime + 0.5);
    return this.on;
  },
  // 每帧根据环境调整:浊度闷化、风暴增强、覆盖率驱动气泡
  update(sim) {
    if (!this.on || !this.ctx) return;
    const cutoff = 900 - sim.turb * 28;                 // 浊度↑ -> 更闷
    this.filter.frequency.setTargetAtTime(
      Math.max(120, cutoff), this.ctx.currentTime, 0.3);
    const weather = sim.sched.weather[Math.min(Math.floor(sim.day), TOTAL_DAYS - 1)];
    const vol = weather === 'storm' ? 0.4 : 0.22;
    this.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.5);
    // 气泡声:覆盖率越高越频繁
    if (!this.bubbleTimer) {
      this.bubbleTimer = setInterval(() => {
        if (!this.on) return;
        if (Math.random() < 0.15 + coverageOf(sim) * 0.6) this.bubble();
      }, 700);
    }
  },
  bubble() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    const f0 = 300 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.8, ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.2);
  },
};
