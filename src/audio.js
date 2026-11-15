// Web Audio：节拍（低频鼓点）+ 提示音（正弦短音），全部由同一时钟驱动。

export class AudioEngine {
  constructor(clock) {
    this.clock = clock;
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.running = false;
    this.scene = null;
    this.activeNodes = new Set();
    this.scheduled = new Set();
    this.firedLog = [];
    this.lookAhead = 0.25;
    this._offTick = null;
    this._offLoop = null;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.01);
    }
  }

  // 切换场景：停止所有正在发声的节点并清空调度表，杜绝上一场景音频延续。
  setScene(scene) {
    this.stopAllNodes();
    this.scheduled.clear();
    this.firedLog = [];
    this.scene = scene;
    if (this.running) this.pump(this.clock.currentTime);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduled.clear();
    this.stopAllNodes();
    this.pump(this.clock.currentTime);
    this._offTick = this.clock.onTick((t) => this.pump(t));
    this._offLoop = this.clock.onLoop(() => {
      this.scheduled.clear();
      this.pump(this.clock.currentTime);
    });
  }

  // seek 后取消未发声事件并按新位置重新调度；已发声事件保留在日志中。
  seek() {
    if (!this.running) return;
    for (const node of this.activeNodes) {
      try { node.stop(this.ctx.currentTime); } catch { /* 已停止 */ }
      try { node.disconnect(); } catch { /* 已断开 */ }
    }
    this.activeNodes.clear();
    this.scheduled.clear();
    this.pump(this.clock.currentTime);
  }

  stop() {
    this.running = false;
    this._offTick?.();
    this._offLoop?.();
    this._offTick = null;
    this._offLoop = null;
    this.stopAllNodes();
    this.scheduled.clear();
  }

  stopAllNodes() {
    if (!this.ctx) return;
    for (const node of this.activeNodes) {
      try { node.stop(this.ctx.currentTime); } catch { /* 已停止 */ }
      try { node.disconnect(); } catch { /* 已断开 */ }
    }
    this.activeNodes.clear();
  }

  pump(masterTime) {
    if (!this.running || !this.ctx || !this.scene) return;
    const audio = this.scene.audio;
    const horizon = Math.min(this.clock.duration, masterTime + this.lookAhead);
    const now = this.ctx.currentTime;
    const mapTime = (eventTime) => now + Math.max(0, eventTime - masterTime);
    for (const bt of audio.beats) {
      if (bt < masterTime - 0.03 || bt > horizon) continue;
      const key = `beat:${bt}`;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      const when = mapTime(bt);
      this.scheduleKick(when);
      this.recordFired(when, 'beat', bt);
    }
    for (const cue of audio.cues) {
      if (cue.t < masterTime - 0.03 || cue.t > horizon) continue;
      const key = `cue:${cue.name}:${cue.t}`;
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      const when = mapTime(cue.t);
      this.scheduleCue(when, cue.freq);
      this.recordFired(when, 'cue', cue.t, cue.name);
    }
  }

  recordFired(when, type, masterTime, name = '') {
    const entry = {
      type, name, masterTime: Number(masterTime.toFixed(4)),
      ctxTime: Number(when.toFixed(4)),
    };
    this.firedLog.push(entry);
    if (this.firedLog.length > 256) this.firedLog.shift();
  }

  scheduleKick(when) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, when);
    osc.frequency.exponentialRampToValueAtTime(48, when + 0.12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.55, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
    osc.connect(gain).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.18);
    this.track(osc);
  }

  scheduleCue(when, freq) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.35, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(when);
    osc.stop(when + 0.24);
    this.track(osc);
  }

  track(osc) {
    this.activeNodes.add(osc);
    osc.onended = () => this.activeNodes.delete(osc);
  }
}
