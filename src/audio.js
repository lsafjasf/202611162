import { getAudioEvents } from "./project.js";

export class BeatAudioEngine {
  constructor(getProject) {
    this.getProject = getProject;
    this.context = null;
    this.master = null;
    this.nodes = new Set();
    this.usingAudioClock = false;
    this.session = 0;
  }

  async ensureReady() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("当前浏览器不支持 Web Audio API。");
      }
      this.context = new AudioContextClass();
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.usingAudioClock = this.context.state === "running";
    return this.context;
  }

  now() {
    if (this.context && this.context.state === "running") return this.context.currentTime;
    return performance.now() / 1000;
  }

  async startAt(position, duration) {
    const context = await this.ensureReady();
    this.stop();
    this.session += 1;
    const project = this.getProject();
    const master = context.createGain();
    master.gain.setValueAtTime(Math.max(0.02, Number(project.audio.master) || 0.18), context.currentTime);
    master.connect(context.destination);
    this.master = master;

    const events = getAudioEvents(project).filter(
      (event) => event.time >= position - 0.0005 && event.time < duration,
    );
    for (const event of events) {
      this.scheduleBeat(Math.max(0, event.time - position), event.accent, event.index);
    }
    return { startTime: context.currentTime };
  }

  scheduleBeat(offset, accent, index) {
    if (!this.context || !this.master) return;
    const context = this.context;
    const at = context.currentTime + Math.max(0.004, offset);

    const kick = context.createOscillator();
    const kickGain = context.createGain();
    kick.type = "sine";
    kick.frequency.setValueAtTime(accent ? 165 : 135, at);
    kick.frequency.exponentialRampToValueAtTime(48, at + 0.1);
    kickGain.gain.setValueAtTime(0.0001, at);
    kickGain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.58, at + 0.006);
    kickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    kick.connect(kickGain).connect(this.master);
    kick.start(at);
    kick.stop(at + 0.18);
    this.trackNode(kick, kickGain);

    const tick = context.createOscillator();
    const tickGain = context.createGain();
    tick.type = accent ? "triangle" : "sine";
    tick.frequency.setValueAtTime(accent ? 1040 : 760, at);
    tick.frequency.exponentialRampToValueAtTime(accent ? 620 : 520, at + 0.055);
    tickGain.gain.setValueAtTime(0.0001, at);
    tickGain.gain.exponentialRampToValueAtTime(accent ? 0.18 : 0.09, at + 0.004);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.075);
    tick.connect(tickGain).connect(this.master);
    tick.start(at);
    tick.stop(at + 0.09);
    this.trackNode(tick, tickGain);

    if (accent && index % 8 === 0) {
      const sub = context.createOscillator();
      const subGain = context.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(72, at);
      subGain.gain.setValueAtTime(0.0001, at);
      subGain.gain.exponentialRampToValueAtTime(0.32, at + 0.01);
      subGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      sub.connect(subGain).connect(this.master);
      sub.start(at);
      sub.stop(at + 0.38);
      this.trackNode(sub, subGain);
    }
  }

  trackNode(source, gain) {
    source.__cutlineSession = this.session;
    gain.__cutlineSession = this.session;
    this.nodes.add(source);
    this.nodes.add(gain);
    source.onended = () => {
      this.nodes.delete(source);
      this.nodes.delete(gain);
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // The audio graph may already be disconnected during a scene switch.
      }
    };
  }

  stop() {
    const context = this.context;
    for (const node of this.nodes) {
      try {
        if (typeof node.stop === "function" && context) node.stop(context.currentTime);
        node.disconnect();
      } catch {
        // Already stopped.
      }
    }
    this.nodes.clear();
    if (this.master) {
      try {
        this.master.disconnect();
      } catch {
        // Already disconnected.
      }
      this.master = null;
    }
  }

  async close() {
    this.stop();
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
