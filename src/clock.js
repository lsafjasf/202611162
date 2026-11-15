import { clamp, roundTime } from "./core.js";

export class PlaybackClock {
  constructor(project, audio) {
    this.project = project;
    this.audio = audio;
    this.playing = false;
    this.time = project.inPoint;
    this.anchorTimeline = project.inPoint;
    this.anchorContext = 0;
    this.anchorPerformance = 0;
    this.usingAudio = false;
    this.restarting = false;
  }

  setProject(project) {
    this.project = project;
    this.time = clamp(this.time, project.inPoint, project.outPoint);
  }

  nowRaw() {
    if (!this.playing) return this.time;
    let value;
    if (this.usingAudio && this.audio.context) {
      const elapsed = this.audio.currentTime - this.anchorContext;
      if (elapsed < 0) return this.anchorTimeline;
      value = this.anchorTimeline + elapsed;
    } else {
      value = this.time + (performance.now() - this.anchorPerformance) / 1000;
    }
    return clamp(value, this.project.inPoint, this.project.outPoint + 10);
  }

  now() {
    return roundTime(clamp(this.nowRaw(), this.project.inPoint, this.project.outPoint), this.project.fps);
  }

  async play() {
    if (this.playing) return;
    if (this.time >= this.project.outPoint - 1 / this.project.fps) {
      this.time = this.project.inPoint;
    }
    this.playing = true;
    try {
      const start = await this.audio.startAt(this.project, this.time);
      this.usingAudio = true;
      this.anchorTimeline = this.time;
      this.anchorContext = start.contextStart;
    } catch (error) {
      console.warn("Audio clock unavailable, using performance clock.", error);
      this.usingAudio = false;
      this.anchorPerformance = performance.now();
    }
  }

  pause() {
    if (!this.playing) return this.time;
    this.time = this.now();
    this.playing = false;
    this.audio.stop("pause");
    return this.time;
  }

  async seek(seconds) {
    const target = roundTime(
      clamp(seconds, this.project.inPoint, this.project.outPoint),
      this.project.fps,
    );
    this.time = target;
    if (!this.playing) return target;
    try {
      const start = await this.audio.startAt(this.project, target);
      this.usingAudio = true;
      this.anchorTimeline = target;
      this.anchorContext = start.contextStart;
    } catch (error) {
      console.warn("Unable to restart audio after seek.", error);
      this.usingAudio = false;
      this.anchorPerformance = performance.now();
    }
    return target;
  }

  async restartAudioAtCurrent() {
    if (!this.playing) return this.now();
    const target = this.now();
    await this.seek(target);
    return target;
  }

  async loopToStart() {
    if (this.restarting) return;
    this.restarting = true;
    try {
      await this.seek(this.project.inPoint);
    } finally {
      this.restarting = false;
    }
  }
}
