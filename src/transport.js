import { roundTime } from "./project.js";

export class Transport {
  constructor({ getProject, audio, onTick, onState, onLoop }) {
    this.getProject = getProject;
    this.audio = audio;
    this.onTick = onTick;
    this.onState = onState;
    this.onLoop = onLoop;
    this.position = 0;
    this.playing = false;
    this.loop = false;
    this.anchor = 0;
    this.rafId = 0;
    this.token = 0;
    this.audioError = null;
  }

  getPosition() {
    if (!this.playing) return this.position;
    return Math.min(this.getProject().duration, Math.max(0, this.audio.now() - this.anchor));
  }

  emitTick(position = this.getPosition()) {
    this.onTick?.(roundTime(position));
  }

  emitState() {
    this.onState?.({
      playing: this.playing,
      loop: this.loop,
      position: roundTime(this.getPosition()),
      duration: this.getProject().duration,
      clock: this.audio.usingAudioClock ? "AudioContext 主时钟" : "高精度主时钟",
      audioError: this.audioError,
    });
  }

  async play() {
    if (this.playing) return;
    const project = this.getProject();
    if (this.position >= project.duration - 0.0005) {
      this.position = 0;
      this.emitTick(0);
    }
    const token = ++this.token;
    this.audioError = null;
    let startTime;
    try {
      const result = await this.audio.startAt(this.position, project.duration);
      startTime = result.startTime;
    } catch (error) {
      this.audioError = error.message;
      startTime = this.audio.now();
    }
    if (token !== this.token) return;
    this.anchor = startTime - this.position;
    this.playing = true;
    this.emitState();
    this.scheduleFrame();
  }

  pause() {
    if (!this.playing) {
      this.audio.stop();
      return;
    }
    this.position = roundTime(this.getPosition());
    this.playing = false;
    this.token += 1;
    this.audio.stop();
    cancelAnimationFrame(this.rafId);
    this.emitTick(this.position);
    this.emitState();
  }

  stop() {
    this.token += 1;
    this.playing = false;
    this.audio.stop();
    cancelAnimationFrame(this.rafId);
    this.position = 0;
    this.emitTick(0);
    this.emitState();
  }

  async seek(seconds, { keepPlaying = this.playing } = {}) {
    const project = this.getProject();
    const target = roundTime(Math.min(project.duration, Math.max(0, Number(seconds) || 0)));
    this.position = target;
    this.emitTick(target);
    if (!keepPlaying) {
      if (this.playing) {
        this.playing = false;
        this.audio.stop();
        cancelAnimationFrame(this.rafId);
      }
      this.emitState();
      return;
    }

    const token = ++this.token;
    this.anchor = this.audio.now() - target;
    try {
      const result = await this.audio.startAt(target, project.duration);
      if (token !== this.token) return;
      this.anchor = result.startTime - target;
      this.playing = true;
      this.emitState();
      this.scheduleFrame();
    } catch (error) {
      this.audioError = error.message;
      this.anchor = this.audio.now() - target;
      this.playing = true;
      this.emitState();
      this.scheduleFrame();
    }
  }

  setLoop(enabled) {
    this.loop = Boolean(enabled);
    this.emitState();
  }

  async loopToStart() {
    const project = this.getProject();
    this.position = 0;
    this.anchor = this.audio.now();
    this.emitTick(0);
    this.emitState();
    this.onLoop?.();
    const token = ++this.token;
    try {
      const result = await this.audio.startAt(0, project.duration);
      if (token !== this.token) return;
      this.anchor = result.startTime;
    } catch (error) {
      this.audioError = error.message;
      this.anchor = this.audio.now();
    }
  }

  scheduleFrame() {
    cancelAnimationFrame(this.rafId);
    const frame = () => {
      if (!this.playing) return;
      const project = this.getProject();
      const position = this.getPosition();
      if (position >= project.duration - 0.0002) {
        if (this.loop) {
          this.loopToStart();
        } else {
          this.position = project.duration;
          this.playing = false;
          this.audio.stop();
          this.emitTick(project.duration);
          this.emitState();
          return;
        }
      } else {
        this.emitTick(position);
      }
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  destroy() {
    this.token += 1;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.audio.stop();
  }
}
