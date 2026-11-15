// Web Audio: 风机噪声随冷却风量变化, 玻璃振动嗡鸣随热应力变化
const AudioSys = {
  ctx: null,
  fanGain: null,
  fanFilter: null,
  vibOsc: null,
  vibGain: null,
  enabled: false,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    // 风机: 循环白噪声 + 低通滤波
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    this.fanFilter = this.ctx.createBiquadFilter();
    this.fanFilter.type = "lowpass";
    this.fanFilter.frequency.value = 400;
    this.fanGain = this.ctx.createGain();
    this.fanGain.gain.value = 0;
    src.connect(this.fanFilter).connect(this.fanGain).connect(this.ctx.destination);
    src.start();

    // 玻璃振动: 正弦嗡鸣, 频率/音量随应力
    this.vibOsc = this.ctx.createOscillator();
    this.vibOsc.type = "sine";
    this.vibOsc.frequency.value = 110;
    this.vibGain = this.ctx.createGain();
    this.vibGain.gain.value = 0;
    this.vibOsc.connect(this.vibGain).connect(this.ctx.destination);
    this.vibOsc.start();
  },

  toggle() {
    this.init();
    if (!this.ctx) return false;
    this.enabled = !this.enabled;
    if (this.enabled && this.ctx.state === "suspended") this.ctx.resume();
    if (!this.enabled) {
      this.fanGain.gain.value = 0;
      this.vibGain.gain.value = 0;
    }
    return this.enabled;
  },

  // flowPct: 0-100, stress: 0-1 (归一化热应力), running: 是否在运行
  update(flowPct, stress, running) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const fan = running ? (flowPct / 100) * 0.25 : 0;
    this.fanGain.gain.setTargetAtTime(fan, t, 0.1);
    this.fanFilter.frequency.setTargetAtTime(200 + flowPct * 8, t, 0.1);
    const vib = running ? Math.min(stress, 1) * 0.12 : 0;
    this.vibGain.gain.setTargetAtTime(vib, t, 0.15);
    this.vibOsc.frequency.setTargetAtTime(90 + stress * 160, t, 0.15);
  },
};
