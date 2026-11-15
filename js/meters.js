/* Canvas 包络绘制 + 实时仪表读数 */
"use strict";

const HISTORY_SECONDS = 12;
const envHistory = []; // {t, env, gain}，由控制回路写入

const meters = {
  ctx: null,
  analyserMix: null,
  analyserL: null,
  analyserR: null,
  freqData: null,
  timeData: null,

  init(audioCtx, masterNode) {
    this.ctx = audioCtx;
    this.analyserMix = audioCtx.createAnalyser();
    this.analyserMix.fftSize = 2048;
    masterNode.connect(this.analyserMix);

    const splitter = audioCtx.createChannelSplitter(2);
    masterNode.connect(splitter);
    this.analyserL = audioCtx.createAnalyser();
    this.analyserR = audioCtx.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 1024;
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);

    this.freqData = new Float32Array(this.analyserMix.frequencyBinCount);
    this.timeData = new Float32Array(this.analyserMix.fftSize);
    this.timeL = new Float32Array(this.analyserL.fftSize);
    this.timeR = new Float32Array(this.analyserR.fftSize);
  },

  rmsOf(analyser, buf) {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) {
      sum += buf[i] * buf[i];
      const a = Math.abs(buf[i]);
      if (a > peak) peak = a;
    }
    return { rms: Math.sqrt(sum / buf.length), peak };
  },

  dominantFreq() {
    this.analyserMix.getFloatFrequencyData(this.freqData);
    let best = -Infinity, bestBin = 0;
    for (let i = 2; i < this.freqData.length; i++) {
      if (this.freqData[i] > best) { best = this.freqData[i]; bestBin = i; }
    }
    const sr = this.ctx.sampleRate;
    return bestBin * sr / this.analyserMix.fftSize;
  },

  updateReadouts() {
    if (!this.analyserMix) return;
    const l = this.rmsOf(this.analyserL, this.timeL);
    const r = this.rmsOf(this.analyserR, this.timeR);
    const mix = this.rmsOf(this.analyserMix, this.timeData);
    document.getElementById("m-freq").textContent = `${this.dominantFreq().toFixed(1)} Hz`;
    document.getElementById("m-rmsL").textContent = l.rms.toFixed(4);
    document.getElementById("m-rmsR").textContent = r.rms.toFixed(4);
    document.getElementById("m-peak").textContent = mix.peak.toFixed(3);
    document.getElementById("m-delay").textContent = `${measureDuckDelay(params).toFixed(0)} ms`;
    const gainDb = 20 * Math.log10(Math.max(1e-6, envState.smooth));
    document.getElementById("m-gain").textContent = `${gainDb.toFixed(1)} dB`;
    return { l: l.rms, r: r.rms };
  },

  draw(levels) {
    const canvas = document.getElementById("scope");
    const g = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    g.fillStyle = "#0b0f16";
    g.fillRect(0, 0, W, H);

    // 网格
    g.strokeStyle = "#1c2635";
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(0, H * i / 4); g.lineTo(W, H * i / 4); g.stroke();
    }

    const now = envHistory.length ? envHistory[envHistory.length - 1].t : 0;
    const t0 = now - HISTORY_SECONDS;

    const drawLine = (getVal, color) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      let started = false;
      for (const pt of envHistory) {
        if (pt.t < t0) continue;
        const x = ((pt.t - t0) / HISTORY_SECONDS) * W;
        const y = H - 24 - getVal(pt) * (H - 40);
        if (!started) { g.moveTo(x, y); started = true; }
        else g.lineTo(x, y);
      }
      g.stroke();
    };

    drawLine(pt => pt.env, "#ff6b6b");   // 警报检测包络
    drawLine(pt => pt.gain, "#4d8dff");  // 音乐增益包络

    // 底部 L/R 电平条
    if (levels) {
      const bw = W / 2 - 30;
      g.fillStyle = "#22304a";
      g.fillRect(20, H - 16, bw, 5);
      g.fillRect(20, H - 9, bw, 5);
      g.fillStyle = "#7fd4a8";
      g.fillRect(20, H - 16, Math.min(1, levels.l * 2.5) * bw, 5);
      g.fillStyle = "#a8d47f";
      g.fillRect(20, H - 9, Math.min(1, levels.r * 2.5) * bw, 5);
      g.fillStyle = "#8fa0b8";
      g.font = "10px sans-serif";
      g.fillText("L", 8, H - 11);
      g.fillText("R", 8, H - 4);
    }
  }
};
