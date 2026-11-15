(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (gain) => (gain <= 0.000001 ? -120 : 20 * Math.log10(gain));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const PAIR_DEFS = [
    {
      id: "harbor",
      base: 196,
      wave: "sawtooth",
      notes: [0, 4, 7, 4],
      source: { filter: "lowpass", cutoff: 2800, q: 0.72, delay: 0.045, pan: -0.32, feedback: 0.12 },
      variant: { filter: "highpass", cutoff: 620, q: 0.9, delay: 0.19, pan: 0.32, feedback: 0.24 },
    },
    {
      id: "tide",
      base: 261.63,
      wave: "triangle",
      notes: [0, 7, 12, 7],
      source: { filter: "lowpass", cutoff: 5200, q: 0.55, delay: 0.075, pan: 0.18, feedback: 0.16 },
      variant: { filter: "bandpass", cutoff: 1450, q: 1.2, delay: 0.26, pan: -0.22, feedback: 0.3 },
    },
    {
      id: "quartz",
      base: 146.83,
      wave: "square",
      notes: [0, 3, 7, 10],
      source: { filter: "lowpass", cutoff: 2200, q: 0.8, delay: 0.11, pan: 0.04, feedback: 0.18 },
      variant: { filter: "highpass", cutoff: 430, q: 1.05, delay: 0.33, pan: 0.18, feedback: 0.28 },
    },
  ];

  const DEFAULT_PARAMS = Object.freeze({
    pitch: 220,
    pan: 0,
    band: "mid",
    tempo: 112,
    delay: 0.14,
    peak: -9,
  });

  const state = {
    ctx: null,
    master: null,
    gameBus: null,
    labBus: null,
    gameAnalyser: null,
    paused: false,
    audioReady: false,
    activeTransport: null,
    clips: [],
    clipAnalysis: new Map(),
    game: {
      connections: new Map(),
      selected: null,
      strikes: 2,
      attempts: 0,
      completed: false,
      failed: false,
      resultByPair: new Map(),
      connectionResults: new Map(),
      playing: null,
      playToken: 0,
      voice: null,
      activeStartedAt: 0,
      activeDuration: 0,
      endTimer: null,
      pauseRemaining: 0,
    },
    lab: {
      params: { ...DEFAULT_PARAMS },
      active: false,
      nodes: null,
      nextPulseAt: 0,
      scheduler: null,
      metrics: {
        pitch: 0,
        peak: -120,
        left: -120,
        right: -120,
        centroid: 0,
        tempo: 0,
        delay: 0,
      },
      peakHistory: [],
      lastPulseDetected: 0,
      pulseIntervals: [],
      settlingUntil: 0,
      convergedAt: 0,
      snapshot: null,
    },
    exportBaseline: null,
    lastRender: null,
    canvas: {
      nodes: [],
      hover: null,
      dpr: 1,
      width: 0,
      height: 0,
      raf: 0,
      spectrumPhase: 0,
    },
  };

  function toast(message, type = "") {
    const element = $("#toast");
    element.textContent = message;
    element.className = `toast show ${type}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      element.className = "toast";
    }, 3200);
  }

  function buildClips() {
    const sources = [
      { pairIndex: 0, role: "source", code: "S-01" },
      { pairIndex: 1, role: "source", code: "S-02" },
      { pairIndex: 2, role: "source", code: "S-03" },
    ];
    const variants = [
      { pairIndex: 1, role: "variant", code: "V-01" },
      { pairIndex: 2, role: "variant", code: "V-02" },
      { pairIndex: 0, role: "variant", code: "V-03" },
    ];

    const makeClip = (entry, side, index) => {
      const pair = PAIR_DEFS[entry.pairIndex];
      const processing = entry.role === "source" ? pair.source : pair.variant;
      return {
        id: `${side}-${index + 1}`,
        pairId: pair.id,
        pairIndex: entry.pairIndex,
        role: entry.role,
        side,
        code: entry.code,
        index,
        base: pair.base,
        wave: pair.wave,
        notes: pair.notes,
        processing,
        profile: [],
      };
    };

    state.clips = [
      ...sources.map((entry, index) => makeClip(entry, "left", index)),
      ...variants.map((entry, index) => makeClip(entry, "right", index)),
    ];
  }

  function initAudioGraph() {
    if (state.ctx) return state.ctx;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API");

    const ctx = new AudioContextClass({ latencyHint: "interactive" });
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    const gameBus = ctx.createGain();
    const labBus = ctx.createGain();
    const gameAnalyser = ctx.createAnalyser();

    master.gain.value = 0.9;
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    gameBus.gain.value = 0.88;
    labBus.gain.value = 0.9;
    gameAnalyser.fftSize = 2048;
    gameAnalyser.smoothingTimeConstant = 0.72;

    gameBus.connect(gameAnalyser);
    gameAnalyser.connect(master);
    labBus.connect(master);
    master.connect(compressor);
    compressor.connect(ctx.destination);

    state.ctx = ctx;
    state.master = master;
    state.gameBus = gameBus;
    state.labBus = labBus;
    state.gameAnalyser = gameAnalyser;
    return ctx;
  }

  async function ensureAudio() {
    const ctx = initAudioGraph();
    if (ctx.state === "suspended" && !state.paused) {
      await ctx.resume();
    }
    if (!state.audioReady) {
      state.audioReady = true;
      $("#engineDot").classList.add("ready");
      $("#engineLabel").textContent = "实时合成在线";
    }
    return ctx;
  }

  function createClipGraph(ctx, clip, destination, startAt = 0) {
    const noteLength = 0.5;
    const noteCount = clip.notes.length;
    const total = noteLength * noteCount + 1.25;
    const output = ctx.createGain();
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    const delay = ctx.createDelay(0.8);
    const feedback = ctx.createGain();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const nodes = [osc, filter, envelope, delay, feedback, wet, dry, panner, output];

    osc.type = clip.wave;
    filter.type = clip.processing.filter;
    filter.frequency.value = clip.processing.cutoff;
    filter.Q.value = clip.processing.q;
    delay.delayTime.value = clip.processing.delay;
    feedback.gain.value = clip.processing.feedback;
    wet.gain.value = clip.processing.delay > 0.015 ? 0.32 : 0.001;
    dry.gain.value = 0.78;
    panner.pan.value = clip.processing.pan;
    output.gain.value = 0.16;
    envelope.gain.value = 0.0001;

    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(dry);
    dry.connect(panner);
    envelope.connect(delay);
    delay.connect(wet);
    wet.connect(panner);
    delay.connect(feedback);
    feedback.connect(delay);
    panner.connect(output);
    output.connect(destination);

    clip.notes.forEach((semitones, index) => {
      const noteAt = startAt + index * noteLength;
      const frequency = clip.base * Math.pow(2, semitones / 12);
      osc.frequency.setValueAtTime(frequency, noteAt);
      envelope.gain.setValueAtTime(0.0001, noteAt);
      envelope.gain.exponentialRampToValueAtTime(0.54, noteAt + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, noteAt + noteLength * 0.93);
    });

    osc.start(startAt);
    osc.stop(startAt + total);

    return {
      nodes,
      nodesToStop: [osc],
      duration: total,
      stop(when = 0) {
        try {
          osc.stop(Math.max(when, ctx.currentTime + 0.01));
        } catch {
          // Already stopped.
        }
        nodes.forEach((node) => {
          try {
            node.disconnect();
          } catch {
            // Already disconnected.
          }
        });
      },
    };
  }

  function renderClipOffline(clip, sampleRate = 48000) {
    const duration = clip.notes.length * 0.5 + 1.25;
    const frames = Math.ceil(duration * sampleRate);
    const offline = new OfflineAudioContext(2, frames, sampleRate);
    createClipGraph(offline, clip, offline.destination, 0.02);
    return offline.startRendering();
  }

  function fftMagnitude(samples) {
    const n = samples.length;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const windowValue = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      real[i] = samples[i] * windowValue;
    }

    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }

    for (let length = 2; length <= n; length <<= 1) {
      const angle = (-2 * Math.PI) / length;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);
      for (let i = 0; i < n; i += length) {
        let curReal = 1;
        let curImag = 0;
        for (let j = 0; j < length / 2; j += 1) {
          const evenIndex = i + j;
          const oddIndex = evenIndex + length / 2;
          const oddReal = real[oddIndex] * curReal - imag[oddIndex] * curImag;
          const oddImag = real[oddIndex] * curImag + imag[oddIndex] * curReal;
          const evenReal = real[evenIndex];
          const evenImag = imag[evenIndex];
          real[evenIndex] = evenReal + oddReal;
          imag[evenIndex] = evenImag + oddImag;
          real[oddIndex] = evenReal - oddReal;
          imag[oddIndex] = evenImag - oddImag;
          const nextReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = nextReal;
        }
      }
    }

    const magnitudes = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) {
      magnitudes[i] = Math.hypot(real[i], imag[i]);
    }
    return magnitudes;
  }

  function spectrumProfile(buffer, binCount = 58) {
    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const offset = Math.min(Math.floor(data.length * 0.15), Math.max(0, data.length - 4096));
    const slice = new Float32Array(4096);
    const available = Math.min(4096, data.length - offset);
    for (let i = 0; i < available; i += 1) slice[i] = data[offset + i];

    const magnitudes = fftMagnitude(slice);
    const values = [];
    const minFrequency = 45;
    const maxFrequency = Math.min(9000, sampleRate / 2);
    for (let i = 0; i < binCount; i += 1) {
      const low = minFrequency * Math.pow(maxFrequency / minFrequency, i / binCount);
      const high = minFrequency * Math.pow(maxFrequency / minFrequency, (i + 1) / binCount);
      const lowBin = Math.max(1, Math.floor((low / (sampleRate / 2)) * magnitudes.length));
      const highBin = Math.max(lowBin + 1, Math.ceil((high / (sampleRate / 2)) * magnitudes.length));
      let peak = 0;
      for (let bin = lowBin; bin < highBin && bin < magnitudes.length; bin += 1) {
        peak = Math.max(peak, magnitudes[bin]);
      }
      values.push(peak);
    }

    const maxValue = Math.max(...values, 0.000001);
    return values.map((value) => Math.pow(value / maxValue, 0.54));
  }

  function estimateFundamental(buffer, sampleRate) {
    const data = buffer;
    const minLag = Math.floor(sampleRate / 1000);
    const maxLag = Math.min(Math.floor(sampleRate / 70), Math.floor(data.length / 2));
    let bestLag = 0;
    let bestScore = 0;
    const correlations = new Float32Array(maxLag + 1);

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = 0; i < data.length - lag; i += 2) {
        sum += data[i] * data[i + lag];
      }
      correlations[lag] = sum / (data.length - lag);
      if (correlations[lag] > bestScore) {
        bestScore = correlations[lag];
        bestLag = lag;
      }
    }

    if (!bestLag || bestScore < 0.00001) return 0;
    for (let lag = minLag + 1; lag < maxLag; lag += 1) {
      if (
        correlations[lag] > correlations[lag - 1] &&
        correlations[lag] >= correlations[lag + 1] &&
        correlations[lag] > bestScore * 0.82
      ) {
        bestLag = lag;
        break;
      }
    }
    return sampleRate / bestLag;
  }

  function cosineSimilarity(a, b) {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (!magA || !magB) return 0;
    return dot / Math.sqrt(magA * magB);
  }

  function pairSimilarity(clipA, clipB) {
    const analysisA = state.clipAnalysis.get(clipA.id);
    const analysisB = state.clipAnalysis.get(clipB.id);
    if (!analysisA || !analysisB) return 0;
    const pitchDistance = Math.abs(Math.log2(analysisA.pitch / analysisB.pitch));
    const pitchScore = Math.exp(-pitchDistance * 15);
    const spectralScore = cosineSimilarity(analysisA.profile, analysisB.profile);
    if (pitchScore > 0.8) {
      return Math.round(clamp(76 + spectralScore * 20 + (pitchScore - 0.8) * 12, 76, 97));
    }
    return Math.round(clamp(8 + pitchScore * 33 + spectralScore * 22, 8, 62));
  }

  async function prepareClipAnalysis() {
    for (const clip of state.clips) {
      const buffer = await renderClipOffline(clip);
      const profile = spectrumProfile(buffer);
      const segment = buffer.getChannelData(0).slice(1000, 1000 + 8192);
      const pitch = estimateFundamental(segment, buffer.sampleRate) || clip.base;
      clip.profile = profile;
      state.clipAnalysis.set(clip.id, { profile, pitch, buffer });
    }
    renderPairCanvas();
  }

  function stopGameVoice(event = "manual") {
    const game = state.game;
    clearTimeout(game.endTimer);
    game.endTimer = null;
    game.playToken += 1;
    if (game.voice) {
      game.voice.stop();
      game.voice = null;
    }
    if (event !== "switch") game.playing = null;
    if (state.activeTransport === "game") state.activeTransport = null;
  }

  async function playClip(clipId, { toggle = true } = {}) {
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip || state.game.completed || state.game.failed) {
      if (!clip) return;
    }
    const ctx = await ensureAudio();
    if (!clip.profile.length) {
      await sleep(80);
    }

    if (toggle && state.game.playing === clipId) {
      stopGameVoice();
      playLabIfNeeded(false);
      state.game.playing = null;
      renderPairCanvas();
      return;
    }

    if (state.lab.active) stopLab(false);
    clearTimeout(state.game.endTimer);
    stopGameVoice("switch");
    const token = state.game.playToken;
    const startAt = ctx.currentTime + 0.035;
    const voice = createClipGraph(ctx, clip, state.gameBus, startAt);
    state.game.voice = voice;
    state.game.playing = clipId;
    state.game.activeStartedAt = startAt;
    state.game.activeDuration = voice.duration;
    state.activeTransport = "game";
    $("#canvasHint").textContent = `正在播放 ${clip.code} · 再次点击可停止`;
    renderPairCanvas();

    const expectedToken = token;
    state.game.endTimer = setTimeout(() => {
      if (state.game.playToken === expectedToken && state.game.playing === clipId) {
        state.game.playing = null;
        state.activeTransport = null;
        $("#canvasHint").textContent = "选择另一个声纹进行对比";
        renderPairCanvas();
      }
    }, voice.duration * 1000 + 60);
  }

  function connectClips(leftId, rightId) {
    const game = state.game;
    if (game.completed || game.failed) return;
    for (const [left, right] of game.connections.entries()) {
      if (right === rightId) game.connections.delete(left);
    }
    game.connections.set(leftId, rightId);
    game.connectionResults.clear();
    updateGameUI();
    renderPairCanvas();
  }

  function disconnectAtClip(clipId) {
    const game = state.game;
    if (game.connections.has(clipId)) game.connections.delete(clipId);
    for (const [left, right] of game.connections.entries()) {
      if (right === clipId) game.connections.delete(left);
    }
    game.connectionResults.clear();
    updateGameUI();
    renderPairCanvas();
  }

  function updateGameUI() {
    const game = state.game;
    const count = game.connections.size;
    $("#connectionCount").textContent = String(count);
    $("#progressFill").style.width = `${(count / 3) * 100}%`;
    $("#strikeText").textContent = `${game.strikes} / 2`;
    $("#strikeText").previousElementSibling.querySelectorAll("i").forEach((strike, index) => {
      strike.classList.toggle("active", index < game.strikes);
    });

    const submitButton = $("#submitButton");
    submitButton.disabled = count !== 3 || game.completed || game.failed;

    if (game.completed) {
      $("#matchStatus").textContent = "配对完成";
      $("#submitHint").textContent = "同源组已全部确认";
    } else if (game.failed) {
      $("#matchStatus").textContent = "实验终止";
      $("#submitHint").textContent = "两次提交错误，配对已锁定";
    } else if (game.attempts > 0) {
      $("#matchStatus").textContent = "待修正";
      $("#submitHint").textContent = `已揭示相似度 · 剩余 ${game.strikes} 次提交机会`;
    } else if (count === 3) {
      $("#matchStatus").textContent = "可提交";
      $("#submitHint").textContent = "三组连线已完成，提交后才会揭示相似度";
    } else {
      $("#matchStatus").textContent = "待配对";
      $("#submitHint").textContent = "完成三组连线后可提交";
    }
  }

  function submitMatches() {
    const game = state.game;
    if (game.connections.size !== 3 || game.completed || game.failed) return;

    game.attempts += 1;
    game.connectionResults.clear();
    let correctCount = 0;

    for (const [leftId, rightId] of game.connections.entries()) {
      const leftClip = state.clips.find((clip) => clip.id === leftId);
      const rightClip = state.clips.find((clip) => clip.id === rightId);
      const isCorrect = leftClip.pairId === rightClip.pairId;
      const score = pairSimilarity(leftClip, rightClip);
      if (isCorrect) correctCount += 1;
      game.connectionResults.set(leftId, { score, correct: isCorrect });
      game.resultByPair.set(leftClip.pairId, score);
    }

    if (correctCount === 3) {
      game.completed = true;
      state.activeTransport = null;
      document.body.classList.add("game-won");
      toast("三组同源声纹全部匹配。相似度已揭示。", "success");
    } else {
      game.strikes -= 1;
      if (game.strikes <= 0) {
        game.failed = true;
        document.body.classList.add("game-failed");
        toast("第二次提交错误，实验终止。正确配对已锁定隐藏。", "error");
      } else {
        toast(`仅 ${correctCount} 组匹配。相似度已揭示，可修正后再次提交。`, "error");
      }
    }
    updateGameUI();
    renderPairCanvas();
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function canvasNodeLayout() {
    const canvas = $("#pairCanvas");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const compact = width < 580;
    const side = compact ? 10 : 28;
    const centerGap = compact ? 15 : Math.max(80, width * 0.16);
    const nodeWidth = (width - side * 2 - centerGap) / 2;
    const nodeHeight = compact ? 106 : 114;
    const top = compact ? 67 : 77;
    const bottom = compact ? 28 : 43;
    const gapY = Math.max(12, (height - top - bottom - nodeHeight * 3) / 2);
    const left = state.clips.filter((clip) => clip.side === "left");
    const right = state.clips.filter((clip) => clip.side === "right");
    const nodes = [];

    left.forEach((clip, index) => {
      nodes.push({
        clip,
        x: side,
        y: top + index * (nodeHeight + gapY),
        w: nodeWidth,
        h: nodeHeight,
      });
    });
    right.forEach((clip, index) => {
      nodes.push({
        clip,
        x: width - side - nodeWidth,
        y: top + index * (nodeHeight + gapY),
        w: nodeWidth,
        h: nodeHeight,
      });
    });
    return nodes;
  }

  function roundedSpectrum(context, clip, x, y, width, height, active) {
    const profile = clip.profile.length ? clip.profile : new Array(58).fill(0.05);
    const count = Math.max(16, Math.floor(width / 5.2));
    let liveData = null;
    if (active && state.gameAnalyser) {
      liveData = new Uint8Array(state.gameAnalyser.frequencyBinCount);
      state.gameAnalyser.getByteFrequencyData(liveData);
    }

    context.save();
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor((i / count) * profile.length);
      const end = Math.max(start + 1, Math.floor(((i + 1) / count) * profile.length));
      let value = 0;
      for (let j = start; j < end; j += 1) value = Math.max(value, profile[j]);
      if (liveData) {
        const sampleRate = state.ctx ? state.ctx.sampleRate : 48000;
        const fLow = 45 * Math.pow(9000 / 45, i / count);
        const fHigh = 45 * Math.pow(9000 / 45, (i + 1) / count);
        const binLow = Math.max(1, Math.floor((fLow / (sampleRate / 2)) * liveData.length));
        const binHigh = Math.max(binLow + 1, Math.ceil((fHigh / (sampleRate / 2)) * liveData.length));
        let live = 0;
        for (let bin = binLow; bin < binHigh && bin < liveData.length; bin += 1) {
          live = Math.max(live, liveData[bin] / 255);
        }
        value = Math.max(value * 0.24, live * 0.95);
      }
      const phase = Math.sin(state.canvas.spectrumPhase * 0.8 + clip.index * 1.7 + i * 0.4) * 0.025;
      const barHeight = clamp(value + phase, 0.025, 1) * height;
      const barWidth = Math.max(1.2, width / count - 2.1);
      const barX = x + (i / count) * width;
      const alpha = active ? 0.48 + value * 0.5 : 0.26 + value * 0.48;
      context.fillStyle = clip.side === "left"
        ? `rgba(124, 201, 255, ${alpha})`
        : `rgba(255, 198, 109, ${alpha})`;
      roundedRect(context, barX, y + height - barHeight, barWidth, barHeight, barWidth / 2);
      context.fill();
    }
    context.restore();
  }

  function drawNode(context, node) {
    const { clip, x, y, w, h } = node;
    const selected = state.game.selected === clip.id;
    const connected = state.game.connections.has(clip.id) ||
      [...state.game.connections.values()].includes(clip.id);
    const active = state.game.playing === clip.id;
    const hover = state.canvas.hover === clip.id;
    const accent = clip.side === "left" ? "124, 201, 255" : "255, 198, 109";

    context.save();
    if (active || selected) {
      context.shadowColor = clip.side === "left" ? "rgba(124,201,255,.4)" : "rgba(255,198,109,.34)";
      context.shadowBlur = 22;
    }
    roundedRect(context, x, y, w, h, 12);
    context.fillStyle = hover ? "#122225" : "#0d1a1c";
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = selected || active ? 1.4 : 1;
    context.strokeStyle = selected || active
      ? `rgba(${accent}, .9)`
      : connected
        ? `rgba(${accent}, .38)`
        : "rgba(175, 215, 202, .13)";
    context.stroke();

    context.font = '600 9px ui-monospace, "SFMono-Regular", Consolas, monospace';
    context.fillStyle = `rgba(${accent}, .92)`;
    context.fillText(clip.code, x + 13, y + 20);

    context.font = '600 8px ui-monospace, "SFMono-Regular", Consolas, monospace';
    context.fillStyle = "rgba(131, 151, 145, .7)";
    const roleLabel = clip.side === "left" ? "SOURCE / 源" : "FILTERED / 变体";
    const labelWidth = context.measureText(roleLabel).width;
    context.fillText(roleLabel, x + w - labelWidth - 13, y + 20);

    roundedSpectrum(context, clip, x + 13, y + 29, w - 26, Math.min(37, h * 0.35), active);

    context.strokeStyle = `rgba(${accent}, .2)`;
    context.beginPath();
    context.moveTo(x + 13, y + h - 30);
    context.lineTo(x + w - 13, y + h - 30);
    context.stroke();

    context.font = '9px "Signal Sans", "PingFang SC", "Noto Sans SC", sans-serif';
    context.fillStyle = active ? "rgba(233, 244, 239, .9)" : "rgba(131, 151, 145, .7)";
    const stateText = active ? "● 正在发声" : connected ? "已连线" : "点击试听";
    context.fillText(stateText, x + 13, y + h - 12);

    if (active) {
      for (let i = 0; i < 3; i += 1) {
        const barHeight = 3 + Math.abs(Math.sin(state.canvas.spectrumPhase * 5 + i)) * 8;
        context.fillStyle = `rgba(${accent}, .7)`;
        roundedRect(context, x + w - 29 + i * 5, y + h - 13 - barHeight, 2, barHeight, 1);
        context.fill();
      }
    }

    if (selected) {
      const radius = 6;
      const pulse = 0.5 + Math.sin(state.canvas.spectrumPhase * 3) * 0.5;
      context.beginPath();
      context.arc(x + w - 13, y + h - 12, radius + pulse * 2, 0, Math.PI * 2);
      context.strokeStyle = `rgba(${accent}, ${0.5 - pulse * 0.3})`;
      context.stroke();
    }
    context.restore();
  }

  function drawConnection(context, leftNode, rightNode, scoreResult) {
    const startX = leftNode.x + leftNode.w;
    const startY = leftNode.y + leftNode.h / 2;
    const endX = rightNode.x;
    const endY = rightNode.y + rightNode.h / 2;
    const curve = Math.max(24, (endX - startX) * 0.48);
    const color = scoreResult
      ? scoreResult.correct
        ? "131, 243, 195"
        : "255, 125, 108"
      : "131, 243, 195";

    context.save();
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(startX + curve, startY, endX - curve, endY, endX, endY);
    context.strokeStyle = `rgba(${color}, ${scoreResult ? 0.72 : 0.38})`;
    context.lineWidth = scoreResult ? 1.35 : 1;
    if (!scoreResult) context.setLineDash([4, 5]);
    context.stroke();
    context.setLineDash([]);

    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2;
    context.beginPath();
    context.arc(midX, midY, 2.5, 0, Math.PI * 2);
    context.fillStyle = `rgb(${color})`;
    context.fill();

    if (scoreResult) {
      const text = `${scoreResult.score}%`;
      context.font = '600 9px ui-monospace, "SFMono-Regular", Consolas, monospace';
      const width = context.measureText(text).width + 14;
      roundedRect(context, midX - width / 2, midY - 20, width, 16, 8);
      context.fillStyle = `rgba(${color}, .13)`;
      context.fill();
      context.strokeStyle = `rgba(${color}, .45)`;
      context.stroke();
      context.fillStyle = `rgb(${color})`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, midX, midY - 11.5);
    }
    context.restore();
  }

  function renderPairCanvas() {
    const canvas = $("#pairCanvas");
    if (!canvas || !canvas.clientWidth) return;
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    state.canvas.dpr = dpr;
    state.canvas.width = width;
    state.canvas.height = height;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const nodes = canvasNodeLayout();
    state.canvas.nodes = nodes;
    const nodeById = new Map(nodes.map((node) => [node.clip.id, node]));
    const compact = width < 580;

    context.font = '600 8px ui-monospace, "SFMono-Regular", Consolas, monospace';
    context.fillStyle = "rgba(83, 100, 95, .85)";
    context.fillText("SOURCE SEQUENCE", compact ? 12 : 29, 31);
    const rightLabel = "FILTERED VARIANTS";
    const rightLabelWidth = context.measureText(rightLabel).width;
    context.fillText(rightLabel, width - rightLabelWidth - (compact ? 12 : 29), 31);

    context.strokeStyle = "rgba(175, 215, 202, .07)";
    context.setLineDash([2, 6]);
    context.beginPath();
    context.moveTo(width / 2, 46);
    context.lineTo(width / 2, height - 28);
    context.stroke();
    context.setLineDash([]);

    if (!compact) {
      context.font = '600 8px ui-monospace, "SFMono-Regular", Consolas, monospace';
      context.fillStyle = "rgba(131, 243, 195, .48)";
      context.textAlign = "center";
      context.fillText("SPECTRAL SIGNATURE / 频谱指纹", width / 2, 31);
      context.textAlign = "left";
    }

    for (const [leftId, rightId] of state.game.connections.entries()) {
      const leftNode = nodeById.get(leftId);
      const rightNode = nodeById.get(rightId);
      if (leftNode && rightNode) {
        drawConnection(
          context,
          leftNode,
          rightNode,
          state.game.connectionResults.get(leftId) || null,
        );
      }
    }

    nodes.forEach((node) => drawNode(context, node));
  }

  function startCanvasAnimation() {
    cancelAnimationFrame(state.canvas.raf);
    let lastFrame = 0;
    const frame = (time) => {
      state.canvas.spectrumPhase += state.paused ? 0 : 0.018;
      if (time - lastFrame > 33) {
        renderPairCanvas();
        lastFrame = time;
      }
      state.canvas.raf = requestAnimationFrame(frame);
    };
    state.canvas.raf = requestAnimationFrame(frame);
  }

  function clipAtPoint(clientX, clientY) {
    const canvas = $("#pairCanvas");
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return state.canvas.nodes.find(
      (node) => x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h,
    ) || null;
  }

  function bindCanvasInteractions() {
    const canvas = $("#pairCanvas");
    canvas.addEventListener("pointermove", (event) => {
      const node = clipAtPoint(event.clientX, event.clientY);
      const id = node ? node.clip.id : null;
      if (id !== state.canvas.hover) {
        state.canvas.hover = id;
        canvas.style.cursor = id ? "pointer" : "default";
      }
    });
    canvas.addEventListener("pointerleave", () => {
      state.canvas.hover = null;
    });
    canvas.addEventListener("pointerup", (event) => {
      const node = clipAtPoint(event.clientX, event.clientY);
      if (!node) return;
      const clip = node.clip;
      const game = state.game;
      playClip(clip.id);
      if (game.completed || game.failed) return;

      if (clip.side === "left") {
        if (game.selected === clip.id) {
          game.selected = null;
          $("#canvasHint").textContent = "已取消选择";
        } else {
          game.selected = clip.id;
          $("#canvasHint").textContent = `已选 ${clip.code} · 点击右侧变体建立连线`;
        }
      } else if (game.selected) {
        const leftClip = state.clips.find((item) => item.id === game.selected);
        connectClips(game.selected, clip.id);
        game.selected = null;
        $("#canvasHint").textContent = `已连接 ${game.connections.size} / 3 · 继续试听对比`;
        if (leftClip) toast(`已连接 ${leftClip.code} 与 ${clip.code}`);
      } else {
        const linkedLeft = [...game.connections.entries()].find(([, right]) => right === clip.id);
        $("#canvasHint").textContent = linkedLeft
          ? "该变体已连线 · 点击左侧源片段可重新连接"
          : "先选左侧源片段，再点此变体建立连线";
      }
      renderPairCanvas();
    });
  }

  function filterSettings(params) {
    if (params.band === "low") {
      return { type: "lowpass", frequency: 520, q: 0.75, compensation: 1.05 };
    }
    if (params.band === "high") {
      return { type: "highpass", frequency: 1550, q: 0.78, compensation: 1.45 };
    }
    return {
      type: "bandpass",
      frequency: clamp(params.pitch * 2.05, 460, 1900),
      q: 1.05,
      compensation: 2.25,
    };
  }

  function createLabGraph(ctx, destination, params) {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    const dry = ctx.createGain();
    const delay = ctx.createDelay(0.65);
    const wet = ctx.createGain();
    const feedback = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const output = ctx.createGain();
    const filterInfo = filterSettings(params);

    osc.type = "sawtooth";
    osc.frequency.value = params.pitch;
    filter.type = filterInfo.type;
    filter.frequency.value = filterInfo.frequency;
    filter.Q.value = filterInfo.q;
    envelope.gain.value = 0.0001;
    dry.gain.value = 0.8;
    delay.delayTime.value = params.delay;
    wet.gain.value = 0.42;
    feedback.gain.value = 0.26;
    panner.pan.value = params.pan;
    output.gain.value = clamp(dbToGain(params.peak) * filterInfo.compensation, 0.001, 1.9);

    osc.connect(filter);
    filter.connect(envelope);
    envelope.connect(dry);
    dry.connect(panner);
    envelope.connect(delay);
    delay.connect(wet);
    wet.connect(panner);
    delay.connect(feedback);
    feedback.connect(delay);
    panner.connect(output);
    output.connect(destination);

    const nodes = [osc, filter, envelope, dry, delay, wet, feedback, panner, output];
    return { osc, filter, envelope, dry, delay, wet, feedback, panner, output, nodes, filterInfo };
  }

  function labPulseTime() {
    return state.ctx.currentTime + 0.012;
  }

  function scheduleLabPulse(when = labPulseTime()) {
    const nodes = state.lab.nodes;
    if (!nodes || !state.lab.active) return;
    const at = Math.max(when, state.ctx.currentTime + 0.005);
    nodes.envelope.gain.cancelScheduledValues(at);
    nodes.envelope.gain.setValueAtTime(0.0001, at);
    nodes.envelope.gain.exponentialRampToValueAtTime(0.5, at + 0.009);
    nodes.envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
    state.lab.lastScheduledPulseAt = at;
  }

  function labSchedulerTick() {
    if (!state.lab.active || state.paused || !state.ctx || state.ctx.state !== "running") return;
    const now = state.ctx.currentTime;
    const interval = 60 / state.lab.params.tempo;
    if (state.lab.nextPulseAt < now + 0.06) {
      const fallback = now + 0.02;
      scheduleLabPulse(Math.max(state.lab.nextPulseAt, fallback));
      state.lab.nextPulseAt = Math.max(state.lab.nextPulseAt, fallback) + interval;
    }
  }

  function buildLabAnalysers() {
    const ctx = state.ctx;
    const nodes = state.lab.nodes;
    const mono = ctx.createAnalyser();
    const frequency = ctx.createAnalyser();
    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    const dryProbe = ctx.createAnalyser();
    const wetProbe = ctx.createAnalyser();
    mono.fftSize = 4096;
    mono.smoothingTimeConstant = 0.3;
    frequency.fftSize = 2048;
    frequency.smoothingTimeConstant = 0.7;
    left.fftSize = 2048;
    right.fftSize = 2048;
    dryProbe.fftSize = 512;
    wetProbe.fftSize = 512;
    mono.minDecibels = -100;
    frequency.minDecibels = -100;

    nodes.output.connect(mono);
    nodes.output.connect(frequency);
    nodes.output.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    nodes.envelope.connect(dryProbe);
    nodes.wet.connect(wetProbe);

    state.lab.analysers = { mono, frequency, left, right, dryProbe, wetProbe, splitter };
    state.lab.probeHistory = [];
    state.lab.pulseIntervals = [];
    state.lab.lastPulseDetected = 0;
    state.lab.dryBuffer = new Float32Array(dryProbe.fftSize);
    state.lab.wetBuffer = new Float32Array(wetProbe.fftSize);
    state.lab.onsetProbe = {
      activeSince: 0,
      previousDry: 0,
      previousWet: 0,
      waitingForWet: false,
      wetArmed: true,
      detected: 0,
    };
    state.lab.tempoProbe = { previousDry: 0, lastOnset: 0 };
    state.lab.fineProbeHistory = [];
    clearInterval(state.lab.probeSampler);
    state.lab.probeSampler = setInterval(sampleDelayOnsets, 16);
  }

  function sampleDelayOnsets() {
    const lab = state.lab;
    if (!lab.active || state.paused || !lab.analysers) return;
    const dryData = lab.dryBuffer;
    const wetData = lab.wetBuffer;
    lab.analysers.dryProbe.getFloatTimeDomainData(dryData);
    lab.analysers.wetProbe.getFloatTimeDomainData(wetData);
    let drySquares = 0;
    let wetSquares = 0;
    for (let i = 0; i < dryData.length; i += 1) {
      drySquares += dryData[i] * dryData[i];
      wetSquares += wetData[i] * wetData[i];
    }
    const dryRms = Math.sqrt(drySquares / dryData.length);
    const wetRms = Math.sqrt(wetSquares / wetData.length);
    const now = performance.now();
    const probe = lab.onsetProbe;
    lab.fineProbeHistory.push({ time: now, dry: dryRms, wet: wetRms });
    lab.fineProbeHistory = lab.fineProbeHistory.filter((entry) => now - entry.time < 1750);
    const tempoProbe = lab.tempoProbe;
    if (dryRms > 0.012 && probe.previousDry <= 0.009) {
      if (tempoProbe.lastOnset) {
        const interval = now - tempoProbe.lastOnset;
        if (interval >= 250 && interval <= 1800) {
          lab.pulseIntervals.push(interval);
          lab.pulseIntervals = lab.pulseIntervals.slice(-4);
          const sorted = [...lab.pulseIntervals].sort((a, b) => a - b);
          lab.metrics.tempo = 60000 / sorted[Math.floor(sorted.length / 2)];
        }
      }
      tempoProbe.lastOnset = now;
    }
    probe.previousDry = dryRms;
    probe.previousWet = wetRms;
  }

  function estimateFineProbeDelay(targetMs) {
    const lab = state.lab;
    const history = lab.fineProbeHistory;
    if (!history || history.length < 35 || targetMs < 20) return 0;
    const meanDry = history.reduce((sum, entry) => sum + entry.dry, 0) / history.length;
    const meanWet = history.reduce((sum, entry) => sum + entry.wet, 0) / history.length;
    let bestLag = 0;
    let bestCorrelation = 0;
    const minimumLag = Math.max(20, targetMs - 95);
    const maximumLag = Math.min(570, targetMs + 95);

    for (let lag = minimumLag; lag <= maximumLag; lag += 4) {
      let covariance = 0;
      let varianceDry = 0;
      let varianceWet = 0;
      let wetIndex = 0;
      let count = 0;
      for (let index = 0; index < history.length - 1; index += 1) {
        const targetTime = history[index].time + lag;
        while (wetIndex < history.length - 2 && history[wetIndex + 1].time < targetTime) {
          wetIndex += 1;
        }
        const first = history[wetIndex];
        const second = history[wetIndex + 1];
        if (!second || targetTime < first.time || targetTime > second.time + 20) continue;
        const span = Math.max(1, second.time - first.time);
        const fraction = clamp((targetTime - first.time) / span, 0, 1);
        const wet = lerp(first.wet, second.wet, fraction);
        const dryValue = history[index].dry - meanDry;
        const wetValue = wet - meanWet;
        covariance += dryValue * wetValue;
        varianceDry += dryValue * dryValue;
        varianceWet += wetValue * wetValue;
        count += 1;
      }
      if (count < 25 || varianceDry < 0.000001 || varianceWet < 0.000001) continue;
      const correlation = covariance / Math.sqrt(varianceDry * varianceWet);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }
    return bestCorrelation > 0.12 ? bestLag : 0;
  }

  async function startLab({ quiet = false } = {}) {
    const ctx = await ensureAudio();
    if (state.game.playing) stopGameVoice();
    if (state.lab.active && state.lab.nodes) {
      scheduleLabPulse();
      if (!quiet) toast("校准音已重播");
      return;
    }

    const nodes = createLabGraph(ctx, state.labBus, state.lab.params);
    state.lab.nodes = nodes;
    state.lab.active = true;
    state.activeTransport = "lab";
    state.lab.nextPulseAt = ctx.currentTime + 0.04;
    state.lab.lastScheduledPulseAt = 0;
    buildLabAnalysers();
    nodes.osc.start();
    clearInterval(state.lab.scheduler);
    state.lab.scheduler = setInterval(labSchedulerTick, 28);
    labSchedulerTick();
    $("#labPlayButton").innerHTML = "<span>■</span> 停止监听";
    $("#engineLabel").textContent = "校准音实时合成";
    markSettling();
    if (!quiet) toast("校准音已启动 · 调整参数可立即听到变化");
  }

  function stopLab(showToast = true) {
    const lab = state.lab;
    if (!lab.active && !lab.nodes) return;
    lab.active = false;
    clearInterval(lab.scheduler);
    clearInterval(lab.probeSampler);
    lab.scheduler = null;
    lab.probeSampler = null;
    if (lab.nodes) {
      try {
        lab.nodes.osc.stop();
      } catch {
        // Already stopped.
      }
      lab.nodes.nodes.forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      });
    }
    if (lab.analysers) {
      Object.values(lab.analysers).forEach((node) => {
        try {
          node.disconnect();
        } catch {
          // Already disconnected.
        }
      });
    }
    lab.nodes = null;
    lab.analysers = null;
    lab.probeHistory = [];
    lab.onsetProbe = null;
    if (state.activeTransport === "lab") state.activeTransport = null;
    $("#labPlayButton").innerHTML = "<span>◉</span> 监听校准音";
    if (state.audioReady) $("#engineLabel").textContent = "实时合成在线";
    if (!state.game.playing) showTargetMeters();
    if (showToast) toast("校准音已停止");
  }

  function playLabIfNeeded(showToast = true) {
    if (state.lab.active) {
      scheduleLabPulse();
      if (showToast) toast("校准脉冲已重播");
    } else {
      startLab({ quiet: !showToast });
    }
  }

  function applyLabParams({ settle = true } = {}) {
    const lab = state.lab;
    const params = lab.params;
    if (lab.nodes && state.ctx) {
      const now = state.ctx.currentTime;
      const filterInfo = filterSettings(params);
      lab.nodes.osc.frequency.setTargetAtTime(params.pitch, now, 0.035);
      lab.nodes.panner.pan.setTargetAtTime(params.pan, now, 0.04);
      lab.nodes.delay.delayTime.setTargetAtTime(params.delay, now, 0.045);
      lab.nodes.filter.type = filterInfo.type;
      lab.nodes.filter.frequency.setTargetAtTime(filterInfo.frequency, now, 0.04);
      lab.nodes.filter.Q.setTargetAtTime(filterInfo.q, now, 0.04);
      lab.nodes.output.gain.setTargetAtTime(
        clamp(dbToGain(params.peak) * filterInfo.compensation, 0.001, 1.9),
        now,
        0.045,
      );
      lab.nextPulseAt = Math.min(
        Math.max(now + 0.04, lab.nextPulseAt),
        now + 0.2,
      );
    }
    updateControlVisuals();
    if (settle) markSettling();
  }

  function updateControlVisuals() {
    const params = state.lab.params;
    $("#pitchValue").textContent = `${Math.round(params.pitch)} Hz`;
    const panPercent = Math.round(Math.abs(params.pan) * 100);
    const panPrefix = Math.abs(params.pan) < 0.005 ? "C" : params.pan < 0 ? "L" : "R";
    $("#panValue").textContent = `${panPrefix} · ${panPercent}%`;
    $("#bandValue").textContent = { low: "低频", mid: "中频", high: "高频" }[params.band];
    $("#tempoValue").textContent = `${Math.round(params.tempo)} BPM`;
    $("#delayValue").textContent = `${Math.round(params.delay * 1000)} ms`;
    $("#peakValue").textContent = `${params.peak < 0 ? "−" : ""}${Math.abs(params.peak).toFixed(1).replace(".0", "")} dB`;

    $("#pitchControl").value = params.pitch;
    $("#panControl").value = Math.round(params.pan * 100);
    $("#tempoControl").value = params.tempo;
    $("#delayControl").value = Math.round(params.delay * 1000);
    $("#peakControl").value = params.peak;
    document.querySelectorAll("#bandControl button").forEach((button) => {
      button.classList.toggle("active", button.dataset.band === params.band);
    });
    document.querySelectorAll('input[type="range"]').forEach((input) => {
      const min = Number(input.min);
      const max = Number(input.max);
      const percent = ((Number(input.value) - min) / (max - min)) * 100;
      input.style.setProperty("--value", `${percent}%`);
    });
  }

  function showTargetMeters() {
    const params = state.lab.params;
    $("#meterPitch").innerHTML = `${params.pitch.toFixed(1)} <small>Hz</small>`;
    $("#meterDelay").innerHTML = `${Math.round(params.delay * 1000)} <small>ms</small>`;
    $("#meterPeak").innerHTML = `${params.peak.toFixed(1)} <small>dBFS</small>`;
    $("#meterLeft").textContent = "—";
    $("#meterRight").textContent = "—";
    $("#meterTempo").textContent = `${Math.round(params.tempo)} BPM`;
    $("#meterCentroid").textContent = "— Hz";
    $("#labState").classList.remove("settling");
    $("#labState b").textContent = "待监听";
    $("#labState small").textContent = "按监听启动";
  }

  function markSettling() {
    const lab = state.lab;
    lab.settlingUntil = performance.now() + 360;
    lab.settlingStartedAt = performance.now();
    lab.convergedAt = 0;
    $("#labState").classList.add("settling");
    $("#labState b").textContent = "指标收敛中";
    $("#labState small").textContent = "短时间窗 360 ms";
  }

  function detectFundamental(data, sampleRate) {
    const reduced = new Float32Array(Math.floor(data.length / 2));
    for (let i = 0; i < reduced.length; i += 1) {
      reduced[i] = (data[i * 2] + data[i * 2 + 1]) * 0.5;
    }
    return estimateFundamental(reduced, sampleRate / 2);
  }

  function drawLabSpectrum(frequencyData) {
    const canvas = $("#labSpectrum");
    if (!canvas.clientWidth) return;
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    context.strokeStyle = "rgba(175, 215, 202, .07)";
    context.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const bars = Math.floor(width / 6);
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, "rgba(60, 162, 126, .2)");
    gradient.addColorStop(1, "rgba(131, 243, 195, .85)");
    context.fillStyle = gradient;
    const live = frequencyData && state.lab.active;
    for (let i = 0; i < bars; i += 1) {
      let value;
      if (live) {
        const start = Math.floor(Math.pow(i / bars, 1.7) * frequencyData.length);
        const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.7) * frequencyData.length));
        let peak = 0;
        for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, frequencyData[bin]);
        value = Math.pow(peak / 255, 0.82);
      } else {
        const frequency = 50 * Math.pow(180, i / bars);
        const distance = Math.abs(Math.log2(frequency / state.lab.params.pitch));
        value = 0.025 + Math.max(0, 1 - distance) * 0.18;
      }
      const barHeight = Math.max(1, value * (height - 14));
      context.fillRect(i * 6, height - barHeight, 3.4, barHeight);
    }

    context.fillStyle = "rgba(83, 100, 95, .72)";
    context.font = '8px ui-monospace, "SFMono-Regular", Consolas, monospace';
    context.fillText("100", 4, height - 3);
    context.fillText("1k", width * 0.45, height - 3);
    context.fillText("10k", width - 22, height - 3);
  }

  function updateLabMetrics() {
    const lab = state.lab;
    if (!lab.active || !lab.analysers || state.paused) return;
    const analysers = lab.analysers;
    const monoData = new Float32Array(analysers.mono.fftSize);
    const leftData = new Float32Array(analysers.left.fftSize);
    const rightData = new Float32Array(analysers.right.fftSize);
    const frequencyData = new Uint8Array(analysers.frequency.frequencyBinCount);
    analysers.mono.getFloatTimeDomainData(monoData);
    analysers.left.getFloatTimeDomainData(leftData);
    analysers.right.getFloatTimeDomainData(rightData);
    analysers.frequency.getByteFrequencyData(frequencyData);

    let peak = 0;
    for (let i = 0; i < monoData.length; i += 1) {
      peak = Math.max(peak, Math.abs(monoData[i]));
    }
    const rms = (data) => {
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
      return Math.sqrt(sum / data.length);
    };
    const leftRms = rms(leftData);
    const rightRms = rms(rightData);
    const fundamental = detectFundamental(monoData, state.ctx.sampleRate);
    const peakDb = gainToDb(peak);

    let weightedFrequency = 0;
    let weightSum = 0;
    for (let i = 2; i < frequencyData.length; i += 1) {
      const weight = Math.max(0, frequencyData[i] - 25);
      weightedFrequency += weight * (i * state.ctx.sampleRate) / analysers.frequency.fftSize;
      weightSum += weight;
    }

    const metrics = lab.metrics;
    if (fundamental > 70 && fundamental < 1100) {
      metrics.pitch = metrics.pitch ? lerp(metrics.pitch, fundamental, 0.52) : fundamental;
    }
    const leftDb = gainToDb(leftRms);
    const rightDb = gainToDb(rightRms);
    if (peakDb > metrics.peak || metrics.peak <= -119) {
      metrics.peak = peakDb;
      lab.peakHoldUntil = performance.now() + 320;
    } else if (performance.now() > (lab.peakHoldUntil || 0)) {
      metrics.peak = Math.max(peakDb, metrics.peak - 1.8);
    }
    if (leftDb > metrics.left || metrics.left <= -119) metrics.left = leftDb;
    else if (performance.now() > (lab.peakHoldUntil || 0)) {
      metrics.left = Math.max(leftDb, metrics.left - 1.8);
    }
    if (rightDb > metrics.right || metrics.right <= -119) metrics.right = rightDb;
    else if (performance.now() > (lab.peakHoldUntil || 0)) {
      metrics.right = Math.max(rightDb, metrics.right - 1.8);
    }
    metrics.centroid = weightSum ? weightedFrequency / weightSum : 0;

    const now = performance.now();
    const dryData = lab.dryBuffer;
    const wetData = lab.wetBuffer;
    analysers.dryProbe.getFloatTimeDomainData(dryData);
    analysers.wetProbe.getFloatTimeDomainData(wetData);
    const dryRms = rms(dryData);
    const wetRms = rms(wetData);
    lab.probeHistory.push({ time: now, dry: dryRms, wet: wetRms });
    lab.probeHistory = lab.probeHistory.filter((entry) => now - entry.time < 1900);
    if (lab.params.delay < 0.02) {
      metrics.delay = 0;
    } else {
      const measuredDelay = estimateFineProbeDelay(lab.params.delay * 1000);
      if (measuredDelay) {
        metrics.delay = metrics.delay
          ? lerp(metrics.delay, measuredDelay, 0.35)
          : measuredDelay;
      }
    }

    $("#meterPitch").innerHTML = `${(metrics.pitch || lab.params.pitch).toFixed(1)} <small>Hz</small>`;
    $("#meterLeft").textContent = metrics.left <= -110 ? "−∞" : metrics.left.toFixed(1);
    $("#meterRight").textContent = metrics.right <= -110 ? "−∞" : metrics.right.toFixed(1);
    $("#meterDelay").innerHTML = `${Math.round((metrics.delay || lab.params.delay * 1000) / 5) * 5} <small>ms</small>`;
    $("#meterPeak").innerHTML = `${metrics.peak.toFixed(1)} <small>dBFS</small>`;
    $("#meterCentroid").textContent = `${Math.round(metrics.centroid)} Hz`;
    $("#meterTempo").textContent = `${Math.round(metrics.tempo || lab.params.tempo)} BPM`;
    $("#pitchNeedle").style.width = `${clamp((metrics.pitch - 110) / 770, 0, 1) * 100}%`;
    $("#delayNeedle").style.width = `${clamp(metrics.delay / 500, 0, 1) * 100}%`;
    $("#peakNeedle").style.width = `${clamp((metrics.peak + 60) / 60, 0, 1) * 100}%`;
    const leftLevel = clamp((metrics.left + 60) / 60, 0, 1);
    const rightLevel = clamp((metrics.right + 60) / 60, 0, 1);
    $("#leftBar").style.width = `${leftLevel * 50}%`;
    $("#rightBar").style.width = `${rightLevel * 50}%`;
    $("#leftBar").style.opacity = String(0.28 + leftLevel * 0.72);
    $("#rightBar").style.opacity = String(0.28 + rightLevel * 0.72);
    drawLabSpectrum(frequencyData);

    if (now >= lab.settlingUntil) {
      const pitchError = Math.abs(metrics.pitch - lab.params.pitch) / lab.params.pitch;
      const delayError = Math.abs(metrics.delay - lab.params.delay * 1000);
      const validSignal = metrics.pitch > 0 && metrics.peak > -60;
      const stable = validSignal &&
        pitchError < 0.06 &&
        (lab.params.delay < 0.02 || (metrics.delay > 0 && delayError < 80));
      if (stable && lab.convergedAt === 0) {
        lab.convergedAt = now;
        $("#labState").classList.remove("settling");
        $("#labState b").textContent = "已收敛";
        $("#labState small").textContent =
          `${Math.max(120, Math.round(now - (lab.settlingStartedAt || now - 360)))} ms 观测窗`;
      }
    }
  }

  const STORAGE_KEYS = {
    snapshot: "signal-trace.snapshot.v1",
    baseline: "signal-trace.export-baseline.v1",
  };
  const EXPORT_DURATION = 5;
  const EXPORT_SAMPLE_RATE = 48000;

  function paramsHash(params) {
    return [
      Math.round(params.pitch * 10),
      Math.round(params.pan * 1000),
      params.band,
      Math.round(params.tempo),
      Math.round(params.delay * 1000),
      Math.round(params.peak * 10),
    ].join(":");
  }

  function scheduleEnvelopePulse(offline, envelope, when) {
    const at = Math.max(0.01, when);
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.5, at + 0.009);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
  }

  async function renderLabSnapshot(params, duration = EXPORT_DURATION) {
    const frames = Math.round(duration * EXPORT_SAMPLE_RATE);
    const offline = new OfflineAudioContext(2, frames, EXPORT_SAMPLE_RATE);
    const master = offline.createGain();
    const compressor = offline.createDynamicsCompressor();
    master.gain.value = 0.9;
    compressor.threshold.value = -10;
    compressor.knee.value = 8;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    master.connect(compressor);
    compressor.connect(offline.destination);

    const nodes = createLabGraph(offline, master, params);
    const interval = 60 / params.tempo;
    for (let time = 0.08; time < duration - 0.2; time += interval) {
      scheduleEnvelopePulse(offline, nodes.envelope, time);
    }
    nodes.osc.start(0);
    nodes.osc.stop(duration);
    return offline.startRendering();
  }

  function channelStats(data) {
    let peak = 0;
    let sumSquares = 0;
    let validSamples = 0;
    for (let i = 0; i < data.length; i += 1) {
      const absolute = Math.abs(data[i]);
      peak = Math.max(peak, absolute);
      if (Number.isFinite(data[i])) {
        sumSquares += data[i] * data[i];
        validSamples += 1;
      }
    }
    return {
      peak,
      rms: validSamples ? Math.sqrt(sumSquares / validSamples) : 0,
    };
  }

  function measureRenderedPitch(buffer) {
    const data = buffer.getChannelData(0);
    const windowStart = Math.min(data.length - 1, Math.floor(buffer.sampleRate * 0.13));
    const length = Math.min(8192, data.length - windowStart);
    const segment = data.slice(windowStart, windowStart + length);
    return estimateFundamental(segment, buffer.sampleRate);
  }

  function inspectRender(buffer, params) {
    const left = channelStats(buffer.getChannelData(0));
    const right = channelStats(buffer.getChannelData(1));
    const globalPeak = Math.max(left.peak, right.peak);
    const globalRms = Math.sqrt((left.rms * left.rms + right.rms * right.rms) / 2);
    const pitch = measureRenderedPitch(buffer) || params.pitch;
    const silence = globalPeak < 0.004 || globalRms < 0.00012;
    const clipping = globalPeak >= 0.998;
    const missingThreshold = Math.max(globalPeak * 0.035, 0.0008);
    const leftMissing = left.peak < missingThreshold;
    const rightMissing = right.peak < missingThreshold;
    return {
      duration: buffer.duration,
      peak: gainToDb(globalPeak),
      peakL: gainToDb(left.peak),
      peakR: gainToDb(right.peak),
      rms: gainToDb(globalRms),
      pitch,
      delayMs: Math.round(params.delay * 1000),
      checks: {
        silence,
        clipping,
        channels: !leftMissing && !rightMissing,
        leftMissing,
        rightMissing,
      },
      passed: !silence && !clipping && !leftMissing && !rightMissing,
    };
  }

  function setCheckItem(selector, passed, passText, failText) {
    const element = $(selector);
    element.classList.toggle("pass", passed);
    element.classList.toggle("fail", !passed);
    element.querySelector("i").textContent = passed ? "●" : "×";
    element.querySelector("b").textContent = passed ? passText : failText;
  }

  function updatePreflightUI(metrics) {
    setCheckItem("#checkSilence", !metrics.checks.silence, "通过 · 非静音", "失败 · 信号静音");
    setCheckItem(
      "#checkClipping",
      !metrics.checks.clipping,
      `通过 · ${metrics.peak.toFixed(1)} dBFS`,
      "失败 · 检测到削波",
    );
    let channelText = "通过 · L / R 完整";
    if (!metrics.checks.channels) {
      channelText = metrics.checks.leftMissing ? "失败 · 左声道缺失" : "失败 · 右声道缺失";
    }
    setCheckItem("#checkChannels", metrics.checks.channels, channelText, channelText);
  }

  function setComparisonRow(selector, aValue, bValue, passed, pendingLabel = "待测") {
    const row = $(selector);
    const cells = row.querySelectorAll("b");
    const result = row.querySelector("em");
    cells[0].textContent = aValue ?? "—";
    cells[1].textContent = bValue ?? "—";
    result.textContent = bValue == null ? pendingLabel : passed ? "一致" : "超出容差";
    result.classList.toggle("pass", bValue != null && passed);
    result.classList.toggle("fail", bValue != null && !passed);
  }

  function renderComparison(first, second) {
    if (!first) return;
    setComparisonRow(
      "#compareDuration",
      `${first.duration.toFixed(3)} s`,
      second ? `${second.duration.toFixed(3)} s` : null,
      second ? Math.abs(first.duration - second.duration) <= 0.01 : false,
      "等待 B 样本",
    );
    setComparisonRow(
      "#comparePeak",
      `${first.peakL.toFixed(1)} / ${first.peakR.toFixed(1)} dBFS`,
      second ? `${second.peakL.toFixed(1)} / ${second.peakR.toFixed(1)} dBFS` : null,
      second
        ? Math.abs(first.peakL - second.peakL) <= 0.35 &&
          Math.abs(first.peakR - second.peakR) <= 0.35
        : false,
      "等待 B 样本",
    );
    setComparisonRow(
      "#comparePitch",
      `${first.pitch.toFixed(1)} Hz`,
      second ? `${second.pitch.toFixed(1)} Hz` : null,
      second ? Math.abs(first.pitch - second.pitch) <= 3 : false,
      "等待 B 样本",
    );
    setComparisonRow(
      "#compareDelay",
      `${first.delayMs} ms`,
      second ? `${second.delayMs} ms` : null,
      second ? Math.abs(first.delayMs - second.delayMs) <= 5 : false,
      "等待 B 样本",
    );
  }

  function readStoredSnapshot() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.snapshot);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  function readStoredBaseline() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.baseline);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  }

  function savePreset() {
    const params = { ...state.lab.params };
    const snapshot = {
      params,
      hash: paramsHash(params),
      savedAt: new Date().toISOString(),
      measuredPitch: state.lab.metrics.pitch || params.pitch,
      measuredDelay: state.lab.metrics.delay || params.delay * 1000,
    };
    state.lab.snapshot = snapshot;
    localStorage.setItem(STORAGE_KEYS.snapshot, JSON.stringify(snapshot));
    $("#snapshotStatus").textContent = "已保存";
    toast("参数快照已保存到本机", "success");
  }

  function reloadPreset({ verify = false } = {}) {
    const snapshot = readStoredSnapshot();
    if (!snapshot || !snapshot.params) {
      toast("还没有可载入的参数快照，请先保存参数", "error");
      return false;
    }
    state.lab.snapshot = snapshot;
    state.lab.params = { ...DEFAULT_PARAMS, ...snapshot.params };
    applyLabParams({ settle: true });
    $("#snapshotStatus").textContent = "已重新载入";
    setComparisonRow(
      "#comparePitch",
      `${snapshot.measuredPitch.toFixed(1)} Hz`,
      `${state.lab.params.pitch.toFixed(1)} Hz`,
      Math.abs(snapshot.measuredPitch - state.lab.params.pitch) <= 3,
    );
    setComparisonRow(
      "#compareDelay",
      `${Math.round(snapshot.measuredDelay)} ms`,
      `${Math.round(state.lab.params.delay * 1000)} ms`,
      Math.abs(snapshot.measuredDelay - state.lab.params.delay * 1000) <= 5,
    );
    toast("参数快照已重新载入，关键音高与延迟已比对", "success");
    if (verify) runExport({ download: false, verification: true });
    return true;
  }

  function encodeWav(buffer) {
    const channels = Math.min(2, buffer.numberOfChannels);
    const frames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const left = buffer.getChannelData(0);
    const right = channels > 1 ? buffer.getChannelData(1) : left;
    let offset = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      const leftSample = clamp(left[frame], -1, 1);
      const rightSample = clamp(right[frame], -1, 1);
      view.setInt16(offset, leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7fff, true);
      offset += 2;
      if (channels > 1) {
        view.setInt16(offset, rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function runExport({ download = true, verification = false } = {}) {
    const button = $("#exportButton");
    const originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = "离线渲染中 <span>···</span>";
    $("#exportNote").textContent = "正在以 OfflineAudioContext 渲染固定时长双声道样本…";

    try {
      const params = { ...state.lab.params };
      const buffer = await renderLabSnapshot(params, EXPORT_DURATION);
      const metrics = inspectRender(buffer, params);
      metrics.paramsHash = paramsHash(params);
      metrics.createdAt = new Date().toISOString();
      state.lastRender = { buffer, metrics, params };
      updatePreflightUI(metrics);

      if (!metrics.passed) {
        const reasons = [];
        if (metrics.checks.silence) reasons.push("静音");
        if (metrics.checks.clipping) reasons.push("削波");
        if (!metrics.checks.channels) reasons.push("声道缺失");
        $("#exportNote").textContent = `预检未通过：${reasons.join("、")}。文件未导出。`;
        toast(`导出被拦截：${reasons.join("、")}`, "error");
        renderComparison(state.exportBaseline, null);
        return { metrics, exported: false };
      }

      const baseline = state.exportBaseline;
      const sameParameters = baseline && baseline.paramsHash === metrics.paramsHash;
      if (!baseline || !sameParameters) {
        state.exportBaseline = {
          duration: metrics.duration,
          peak: metrics.peak,
          peakL: metrics.peakL,
          peakR: metrics.peakR,
          pitch: metrics.pitch,
          delayMs: metrics.delayMs,
          paramsHash: metrics.paramsHash,
          createdAt: metrics.createdAt,
        };
        localStorage.setItem(STORAGE_KEYS.baseline, JSON.stringify(state.exportBaseline));
        renderComparison(state.exportBaseline, null);
        $("#exportNote").textContent =
          "A 样本已建立：静音、削波与双声道检查通过。重新载入同一组参数后再导出，会自动生成 B 样本。";
      } else {
        renderComparison(baseline, metrics);
        const allMatched =
          Math.abs(baseline.duration - metrics.duration) <= 0.01 &&
          Math.abs(baseline.peakL - metrics.peakL) <= 0.35 &&
          Math.abs(baseline.peakR - metrics.peakR) <= 0.35 &&
          Math.abs(baseline.pitch - metrics.pitch) <= 3 &&
          Math.abs(baseline.delayMs - metrics.delayMs) <= 5;
        $("#exportNote").textContent = allMatched
          ? "A / B 样本一致：导出时长与关键峰值在容差内，重新载入未改变声学结果。"
          : "A / B 样本存在超差项，请检查参数快照与导出设置。";
        toast(
          allMatched ? "A / B 导出一致性验证通过" : "A / B 样本存在超差项",
          allMatched ? "success" : "error",
        );
      }

      if (download) {
        const blob = encodeWav(buffer);
        const suffix = state.exportBaseline && !sameParameters ? "A" : sameParameters ? "B" : "A";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        downloadBlob(blob, `signal-trace-${suffix}-${stamp}.wav`);
        $("#exportNote").textContent += ` 已生成 ${(blob.size / 1024).toFixed(0)} KB · 16-bit PCM WAV。`;
      } else if (verification) {
        $("#exportNote").textContent += " 本次为复验渲染，未下载文件。";
      }
      return { metrics, exported: true };
    } catch (error) {
      console.error(error);
      $("#exportNote").textContent = `渲染失败：${error.message}`;
      toast(`渲染失败：${error.message}`, "error");
      return { metrics: null, exported: false };
    } finally {
      button.disabled = false;
      button.innerHTML = originalLabel;
    }
  }

  function updatePauseButton() {
    $("#pauseText").textContent = state.paused ? "继续" : "暂停";
    $("#pauseIcon").textContent = state.paused ? "▶" : "Ⅱ";
    $("#pauseButton").classList.toggle("active", state.paused);
  }

  async function togglePause() {
    const ctx = await ensureAudio();
    if (!state.paused) {
      const game = state.game;
      if (game.voice && game.playing) {
        game.pauseRemaining = Math.max(
          0.05,
          game.activeDuration - (ctx.currentTime - game.activeStartedAt),
        );
        clearTimeout(game.endTimer);
        game.endTimer = null;
      }
      state.paused = true;
      await ctx.suspend();
      $("#engineLabel").textContent = "音频已暂停";
    } else {
      state.paused = false;
      await ctx.resume();
      if (state.lab.active) {
        state.lab.nextPulseAt = ctx.currentTime + 0.04;
      }
      if (state.game.playing && state.game.pauseRemaining > 0) {
        const token = state.game.playToken;
        const clipId = state.game.playing;
        state.game.endTimer = setTimeout(() => {
          if (state.game.playToken === token && state.game.playing === clipId) {
            state.game.playing = null;
            $("#canvasHint").textContent = "选择另一个声纹进行对比";
            renderPairCanvas();
          }
        }, state.game.pauseRemaining * 1000 + 40);
      }
      $("#engineLabel").textContent = state.lab.active ? "校准音实时合成" : "实时合成在线";
    }
    updatePauseButton();
    toast(state.paused ? "所有声音已暂停" : "声音已继续");
  }

  function replayActive() {
    if (state.paused) {
      togglePause();
      return;
    }
    if (state.game.playing) {
      playClip(state.game.playing, { toggle: false });
      return;
    }
    if (state.lab.active) {
      playLabIfNeeded(true);
      return;
    }
    if (state.game.selected) {
      playClip(state.game.selected, { toggle: false });
      return;
    }
    toast("先选择一个声纹或启动校准音");
  }

  function resetLabParameters() {
    state.lab.params = { ...DEFAULT_PARAMS };
    state.lab.metrics.peak = -120;
    state.lab.pulseIntervals = [];
    if (state.lab.tempoProbe) state.lab.tempoProbe.lastOnset = 0;
    applyLabParams({ settle: true });
    if (!state.lab.active) showTargetMeters();
    toast("校准参数已恢复默认值");
  }

  function bindControls() {
    document.querySelectorAll('input[type="range"]').forEach((input) => {
      input.addEventListener("input", () => {
        const parameter = input.dataset.param;
        let value = Number(input.value);
        if (parameter === "pan") value /= 100;
        if (parameter === "delay") value /= 1000;
        state.lab.params[parameter] = value;
        if (parameter === "tempo") {
          state.lab.pulseIntervals = [];
          if (state.lab.tempoProbe) state.lab.tempoProbe.lastOnset = 0;
        }
        applyLabParams();
      });
    });

    document.querySelectorAll("#bandControl button").forEach((button) => {
      button.addEventListener("click", () => {
        state.lab.params.band = button.dataset.band;
        state.lab.pulseIntervals = [];
        applyLabParams();
      });
    });

    $("#pauseButton").addEventListener("click", () => togglePause());
    $("#replayButton").addEventListener("click", replayActive);
    $("#resetButton").addEventListener("click", resetLabParameters);
    $("#saveButton").addEventListener("click", savePreset);
    $("#reloadButton").addEventListener("click", () => reloadPreset());
    $("#labPlayButton").addEventListener("click", () => {
      if (state.lab.active) stopLab(true);
      else startLab();
    });
    $("#clearButton").addEventListener("click", () => {
      if (state.game.completed || state.game.failed) {
        toast("本局已结束，无法修改配对");
        return;
      }
      state.game.connections.clear();
      state.game.connectionResults.clear();
      state.game.selected = null;
      updateGameUI();
      renderPairCanvas();
      toast("连线已清空");
    });
    $("#submitButton").addEventListener("click", submitMatches);
    $("#exportButton").addEventListener("click", () => runExport({ download: true }));
    $("#verifyButton").addEventListener("click", () => {
      if (reloadPreset({ verify: true })) {
        $("#diagnosticsTitle").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        togglePause();
      }
    });
  }

  function spectralCentroidOfBuffer(buffer) {
    const data = buffer.getChannelData(0);
    const start = Math.min(Math.max(0, Math.floor(data.length * 0.08)), data.length - 8192);
    const segment = data.slice(start, start + 8192);
    const magnitudes = fftMagnitude(segment);
    let weighted = 0;
    let total = 0;
    for (let i = 2; i < magnitudes.length; i += 1) {
      const frequency = (i * buffer.sampleRate) / 8192;
      weighted += frequency * magnitudes[i];
      total += magnitudes[i];
    }
    return total ? weighted / total : 0;
  }

  async function probeParameters(duration = 1.6) {
    const params = { ...state.lab.params };
    const buffer = await renderLabSnapshot(params, duration);
    const metrics = inspectRender(buffer, params);
    return {
      params,
      hash: paramsHash(params),
      duration: buffer.duration,
      pitch: metrics.pitch,
      peak: metrics.peak,
      peakL: metrics.peakL,
      peakR: metrics.peakR,
      centroid: spectralCentroidOfBuffer(buffer),
      delayMs: metrics.delayMs,
      checks: metrics.checks,
    };
  }

  async function initialize() {
    if (document.fonts?.ready) await document.fonts.ready;
    buildClips();
    bindControls();
    bindCanvasInteractions();
    updateControlVisuals();
    updateGameUI();
    showTargetMeters();
    updatePauseButton();
    state.lab.snapshot = readStoredSnapshot();
    state.exportBaseline = readStoredBaseline();
    if (state.lab.snapshot) $("#snapshotStatus").textContent = "已保存";
    if (state.exportBaseline) {
      renderComparison(state.exportBaseline, null);
      $("#exportNote").textContent = "检测到 A 样本。重新载入同一组参数并再次导出，将生成 B 样本对比。";
    }
    const resizeObserver = new ResizeObserver(() => renderPairCanvas());
    resizeObserver.observe($("#pairCanvasWrap"));
    await prepareClipAnalysis();
    startCanvasAnimation();
    const metricsTimer = setInterval(updateLabMetrics, 55);
    window.addEventListener("beforeunload", () => clearInterval(metricsTimer));
  }

  const ready = initialize().catch((error) => {
    console.error(error);
    toast(`初始化失败：${error.message}`, "error");
  });

  window.SignalTrace = {
    ready,
    playClip: (id) => playClip(id, { toggle: false }),
    submitMatches,
    startLab,
    stopLab: () => stopLab(false),
    pause: togglePause,
    replay: replayActive,
    resetParameters: resetLabParameters,
    setLabParameter(name, value) {
      if (!(name in state.lab.params)) return false;
      if (name === "band") state.lab.params.band = value;
      else state.lab.params[name] = Number(value);
      if (name === "tempo") {
        state.lab.pulseIntervals = [];
        if (state.lab.tempoProbe) state.lab.tempoProbe.lastOnset = 0;
      }
      applyLabParams();
      return true;
    },
    savePreset,
    reloadPreset,
    runExport,
    probeParameters,
    getClips: () => state.clips.map((clip) => ({
      id: clip.id,
      code: clip.code,
      role: clip.role,
      pairId: clip.pairId,
    })),
    getPairingKey: () => {
      const sources = state.clips.filter((clip) => clip.side === "left");
      const variants = state.clips.filter((clip) => clip.side === "right");
      return Object.fromEntries(
        sources.map((source) => [
          source.id,
          variants.find((variant) => variant.pairId === source.pairId)?.id,
        ]),
      );
    },
    getNodeRects() {
      const canvas = $("#pairCanvas");
      const rect = canvas.getBoundingClientRect();
      return state.canvas.nodes.map((node) => ({
        id: node.clip.id,
        side: node.clip.side,
        x: rect.left + node.x + node.w / 2,
        y: rect.top + node.y + node.h / 2,
      }));
    },
    getState: () => ({
      game: {
        connections: Object.fromEntries(state.game.connections),
        playing: state.game.playing,
        selected: state.game.selected,
        strikes: state.game.strikes,
        attempts: state.game.attempts,
        completed: state.game.completed,
        failed: state.game.failed,
        results: Object.fromEntries(state.game.connectionResults),
      },
      lab: {
        params: { ...state.lab.params },
        active: state.lab.active,
        paused: state.paused,
        metrics: { ...state.lab.metrics },
        convergedAt: state.lab.convergedAt,
      },
      engine: {
        state: state.ctx?.state || "uninitialized",
        paused: state.paused,
      },
      snapshot: state.lab.snapshot,
      baseline: state.exportBaseline,
      lastRender: state.lastRender?.metrics || null,
    }),
  };
})();
