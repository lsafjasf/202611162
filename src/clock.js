// 全应用唯一时钟：时间线、渲染与音频调度都以 currentTime 为准。
export class Clock {
  constructor({ duration, loop = true } = {}) {
    this.duration = duration;
    this.loop = loop;
    this.currentTime = 0;
    this.playing = false;
    this.rafId = 0;
    this.lastPerf = 0;
    this.tickListeners = new Set();
    this.loopListeners = new Set();
    this._boundFrame = (perf) => this._frame(perf);
  }

  onTick(fn) { this.tickListeners.add(fn); return () => this.tickListeners.delete(fn); }
  onLoop(fn) { this.loopListeners.add(fn); return () => this.loopListeners.delete(fn); }

  play() {
    if (this.playing) return;
    if (this.currentTime >= this.duration) this.currentTime = 0;
    this.playing = true;
    this.lastPerf = performance.now();
    this.rafId = requestAnimationFrame(this._boundFrame);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this._emitTick();
  }

  seek(time) {
    const next = Math.min(this.duration, Math.max(0, time));
    const wrapped = Math.abs(next - this.currentTime) > 1e-6;
    this.currentTime = next;
    if (wrapped) this._emitTick();
    if (this.playing) {
      this.lastPerf = performance.now();
    }
  }

  reset() {
    this.pause();
    this.seek(0);
  }

  _frame(perf) {
    if (!this.playing) return;
    const dt = Math.min(0.1, (perf - this.lastPerf) / 1000);
    this.lastPerf = perf;
    let next = this.currentTime + dt;
    if (next >= this.duration) {
      if (this.loop) {
        next = next % this.duration;
        this.currentTime = next;
        this.loopListeners.forEach((fn) => fn(next));
      } else {
        next = this.duration;
        this.currentTime = next;
        this._emitTick();
        this.pause();
        return;
      }
    } else {
      this.currentTime = next;
    }
    this._emitTick();
    if (this.playing) this.rafId = requestAnimationFrame(this._boundFrame);
  }

  _emitTick() {
    this.tickListeners.forEach((fn) => fn(this.currentTime));
  }
}
