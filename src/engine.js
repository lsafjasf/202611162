import { scheduleCue, TIMELINE_DURATION } from './audio.js';
import { inspectBuffer, encodeWav } from './wav.js';

// Build one shared graph: cue nodes -> merger -> splitter -> per-channel
// analysers -> destination, plus a mix analyser for pitch reading.
function buildGraph(ctx) {
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const analyserL = new AnalyserNode(ctx, { fftSize: 1024 });
  const analyserR = new AnalyserNode(ctx, { fftSize: 1024 });
  const mix = new GainNode(ctx, { gain: 0.5 });
  const analyserMix = new AnalyserNode(ctx, { fftSize: 2048 });
  merger.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  splitter.connect(mix, 0);
  splitter.connect(mix, 1);
  mix.connect(analyserMix);
  mix.connect(ctx.destination);
  return { merger, analyserL, analyserR, analyserMix };
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.graph = null;
    this.active = [];
    this.playing = false;
    this.paused = false;
    this.startCtxTime = 0;
    this.offset = 0;
    this.duration = TIMELINE_DURATION;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.graph = buildGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get position() {
    if (!this.ctx) return 0;
    if (this.playing && !this.paused) {
      return Math.min(this.duration, this.offset + this.ctx.currentTime - this.startCtxTime);
    }
    return this.offset;
  }

  // cues: [{id, start}], paramsById: Map id -> params
  async play(cues, paramsById, from = 0) {
    await this.ensureContext();
    this.stopNodes();
    this.offset = Math.max(0, Math.min(this.duration, from));
    this.startCtxTime = this.ctx.currentTime + 0.05;
    for (const cue of cues) {
      const nodes = scheduleCue(this.ctx, this.graph.merger, cue, paramsById.get(cue.id), -this.offset);
      this.active.push(...nodes);
    }
    this.playing = true;
    this.paused = false;
  }

  async pause() {
    if (!this.ctx || !this.playing || this.paused) return;
    this.offset = this.position;
    await this.ctx.suspend();
    this.paused = true;
  }

  async resume() {
    if (!this.ctx || !this.paused) return;
    await this.ctx.resume();
    this.startCtxTime = this.ctx.currentTime;
    this.paused = false;
  }

  stopNodes() {
    for (const node of this.active) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    this.active = [];
  }

  stop() {
    if (!this.ctx) return;
    this.stopNodes();
    this.playing = false;
    this.paused = false;
    this.offset = 0;
  }

  readMeters() {
    if (!this.graph) return { peakL: 0, peakR: 0, frequency: 0 };
    const bufL = new Float32Array(this.graph.analyserL.fftSize);
    const bufR = new Float32Array(this.graph.analyserR.fftSize);
    this.graph.analyserL.getFloatTimeDomainData(bufL);
    this.graph.analyserR.getFloatTimeDomainData(bufR);
    let peakL = 0;
    let peakR = 0;
    for (let i = 0; i < bufL.length; i += 1) {
      peakL = Math.max(peakL, Math.abs(bufL[i]));
      peakR = Math.max(peakR, Math.abs(bufR[i]));
    }
    return { peakL, peakR, frequency: this.readDominantFrequency() };
  }

  readDominantFrequency() {
    const analyser = this.graph.analyserMix;
    const freq = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(freq);
    let bestBin = -1;
    let bestValue = -Infinity;
    for (let i = 1; i < freq.length; i += 1) {
      if (freq[i] > bestValue) {
        bestValue = freq[i];
        bestBin = i;
      }
    }
    if (bestBin < 0 || bestValue < -90) return 0;
    return (bestBin * this.ctx.sampleRate) / analyser.fftSize;
  }

  // Offline render of the full timeline, then pre-export checks.
  async renderOffline(cues, paramsById, duration = TIMELINE_DURATION) {
    // Fixed sample rate keeps repeated exports byte-identical regardless of
    // the live AudioContext hardware configuration.
    const sampleRate = 48000;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const merger = new ChannelMergerNode(offline, { numberOfInputs: 2 });
    merger.connect(offline.destination);
    for (const cue of cues) {
      scheduleCue(offline, merger, cue, paramsById.get(cue.id));
    }
    const rendered = await offline.startRendering();
    const report = inspectBuffer(rendered);
    return { buffer: rendered, report, blob: encodeWav(rendered) };
  }
}
