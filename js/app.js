(function () {
  "use strict";

  const Audio = window.PhaseAudio;
  const DSP = window.SignalDSP;
  const Wav = window.PhaseWav;
  const STORAGE_KEY = "phase-lab-snapshots-v1";
  const EXPORT_OVERLOAD_DB = -0.1;
  const CLIP_THRESHOLD = 0.999;
  const SILENCE_DB = -60;
  const engine = new Audio.AudioEngine();

  const $ = (id) => document.getElementById(id);
  const dom = {
    playButton: $("playButton"),
    playLabel: $("playLabel"),
    replayButton: $("replayButton"),
    resetButton: $("resetButton"),
    engineLamp: $("engineLamp"),
    engineStatus: $("engineStatus"),
    systemFormat: $("systemFormat"),
    timeReadout: $("timeReadout"),
    timelineFill: $("timelineFill"),
    syncStatus: $("syncStatus"),
    pitchValue: $("pitchValue"),
    pitchDetail: $("pitchDetail"),
    channelValue: $("channelValue"),
    channelDetail: $("channelDetail"),
    delayValue: $("delayValue"),
    delayDetail: $("delayDetail"),
    peakValue: $("peakValue"),
    peakDetail: $("peakDetail"),
    peakMeterFill: $("peakMeterFill"),
    durationValue: $("durationValue"),
    durationDetail: $("durationDetail"),
    convergenceValue: $("convergenceValue"),
    convergenceDetail: $("convergenceDetail"),
    spectrumCanvas: $("spectrumCanvas"),
    spectrumEmpty: $("spectrumEmpty"),
    waveformCanvas: $("waveformCanvas"),
    nodeCanvas: $("nodeCanvas"),
    playhead: $("playhead"),
    activeNodeCount: $("activeNodeCount"),
    preflightBadge: $("preflightBadge"),
    checkSilence: $("checkSilence"),
    checkClip: $("checkClip"),
    checkChannel: $("checkChannel"),
    checkOverload: $("checkOverload"),
    exportButton: $("exportButton"),
    exportHint: $("exportHint"),
    exportHistory: $("exportHistory"),
    selfTestButton: $("selfTestButton"),
    channelTest: $("channelTest"),
    bandTest: $("bandTest"),
    beatTest: $("beatTest"),
    snapshotName: $("snapshotName"),
    snapshotBadge: $("snapshotBadge"),
    saveSnapshotButton: $("saveSnapshotButton"),
    snapshotSelect: $("snapshotSelect"),
    loadSnapshotButton: $("loadSnapshotButton"),
    consistencyReadout: $("consistencyReadout"),
    toast: $("toast"),
  };

  let settings = { ...Audio.DEFAULTS };
  let analysis = null;
  let analysisTimer = 0;
  let analysisToken = 0;
  let editStartedAt = 0;
  let lastConvergenceMs = 0;
  let pendingSnapshotComparison = null;
  let snapshots = readSnapshots();
  let exportRecords = [];
  let toastTimer = 0;
  let nodeHover = "";

  const ranges = {
    balance: { key: "balance", scale: 0.01 },
    width: { key: "width", scale: 0.01 },
    beatAccent: { key: "beatAccent", scale: 0.01 },
    hpfFreq: { key: "hpfFreq" },
    hpfQ: { key: "hpfQ", scale: 0.01 },
    notchFreq: { key: "notchFreq" },
    notchQ: { key: "notchQ", scale: 0.1 },
    gateThreshold: { key: "gateThreshold" },
    gateAttack: { key: "gateAttack" },
    gateRelease: { key: "gateRelease" },
    gateLookahead: { key: "gateLookahead" },
    clipDrive: { key: "clipDrive" },
    clipMix: { key: "clipMix" },
    masterGain: { key: "masterGain" },
  };

  const switches = {
    bypassHpf: { key: "hpfEnabled", invert: true },
    bypassNotch: { key: "notchEnabled", invert: true },
    bypassGate: { key: "gateEnabled", invert: true },
    bypassClip: { key: "clipEnabled", invert: true },
  };

  const sourceKeys = new Set(["balance", "width", "beatAccent"]);

  function readSnapshots() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      void error;
      return [];
    }
  }

  function persistSnapshots() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots.slice(0, 12)));
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function formatFrequency(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
    return `${Math.round(value)} Hz`;
  }

  function formatDb(value, digits) {
    const precision = digits === undefined ? 1 : digits;
    return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(precision)} dB`;
  }

  function formatSigned(value, digits) {
    const precision = digits === undefined ? 1 : digits;
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(precision)}`;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
  }

  function noteName(frequency) {
    if (!frequency || frequency < 20) return "无稳定基频";
    const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function setOutput(id, text) {
    const element = $(id);
    if (element) element.textContent = text;
  }

  function updateControlLabels() {
    setOutput("balanceOut", `${settings.balance >= 0 ? "R" : "L"} ${Math.abs(settings.balance * 100).toFixed(0)}`);
    setOutput("widthOut", settings.width.toFixed(2));
    setOutput("beatAccentOut", `${Math.round(settings.beatAccent * 100)}%`);
    setOutput("hpfFreqOut", formatFrequency(settings.hpfFreq));
    setOutput("hpfQOut", settings.hpfQ.toFixed(2));
    setOutput("notchFreqOut", formatFrequency(settings.notchFreq));
    setOutput("notchQOut", settings.notchQ.toFixed(1));
    setOutput("gateThresholdOut", `${settings.gateThreshold < 0 ? "−" : ""}${Math.abs(settings.gateThreshold)} dB`);
    setOutput("gateAttackOut", `${settings.gateAttack.toFixed(1)} ms`);
    setOutput("gateReleaseOut", `${Math.round(settings.gateRelease)} ms`);
    setOutput("gateLookaheadOut", `${settings.gateLookahead.toFixed(1)} ms`);
    setOutput("clipDriveOut", `+${settings.clipDrive.toFixed(1)} dB`);
    setOutput("clipMixOut", `${Math.round(settings.clipMix)}%`);
    setOutput("masterGainOut", formatDb(settings.masterGain, 1));
  }

  function syncControlsFromSettings() {
    for (const [id, config] of Object.entries(ranges)) {
      const element = $(id);
      if (!element) continue;
      element.value = config.scale ? settings[config.key] / config.scale : settings[config.key];
    }
    for (const [id, config] of Object.entries(switches)) {
      const element = $(id);
      if (element) element.checked = config.invert ? !settings[config.key] : settings[config.key];
    }
    updateControlLabels();
    updateNodeCards();
  }

  function updateNodeCards() {
    const mapping = [
      ["hpf", "hpfEnabled"],
      ["notch", "notchEnabled"],
      ["gate", "gateEnabled"],
      ["clip", "clipEnabled"],
    ];
    let enabled = 0;
    for (const [node, key] of mapping) {
      const card = document.querySelector(`.node-card[data-node="${node}"]`);
      if (!card) continue;
      card.classList.toggle("is-bypassed", !settings[key]);
      if (settings[key]) enabled += 1;
    }
    dom.activeNodeCount.textContent = `${enabled} / 4 启用`;
    if (settings.gateEnabled) {
      dom.delayValue.textContent = `${settings.gateLookahead.toFixed(1)} ms`;
      dom.delayDetail.textContent = "门限预读 · 已计入音频";
    } else {
      dom.delayValue.textContent = "0.0 ms";
      dom.delayDetail.textContent = "门限已旁路";
    }
  }

  function setEngineState(state, text) {
    dom.engineStatus.textContent = text;
    dom.engineLamp.classList.toggle("is-on", state === "live" || state === "on");
    dom.engineLamp.classList.toggle("is-busy", state === "busy");
  }

  function showToast(message, isError) {
    clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.toggle("is-error", Boolean(isError));
    dom.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 3400);
  }

  function markConverging() {
    editStartedAt = performance.now();
    dom.syncStatus.textContent = "声音已更新 · 仪表正在收敛…";
    dom.convergenceValue.textContent = "…";
    dom.convergenceDetail.textContent = "短时间窗分析中";
    dom.exportButton.disabled = true;
    dom.exportHint.textContent = "参数变化中 · 等待声学分析收敛";
    setEngineState(engine.playing ? "live" : "busy", engine.playing ? "实时播放 · 参数更新中" : "离线声学分析");
  }

  let sourceRegenerationTimer = 0;

  function scheduleSourceRegeneration() {
    clearTimeout(sourceRegenerationTimer);
    sourceRegenerationTimer = window.setTimeout(() => {
      engine.setSettings(settings, true).catch((error) => {
        showToast(`实时素材更新失败：${error.message}`, true);
      });
    }, 36);
  }

  function onRangeInput(event) {
    const config = ranges[event.target.id];
    if (!config) return;
    settings[config.key] = Number(event.target.value) * (config.scale || 1);
    updateControlLabels();
    if (sourceKeys.has(config.key)) scheduleSourceRegeneration();
    else {
      engine.setSettings(settings, false).catch((error) => {
        showToast(`实时参数更新失败：${error.message}`, true);
      });
    }
    markConverging();
    scheduleAnalysis();
  }

  function onSwitchChange(event) {
    const config = switches[event.target.id];
    if (!config) return;
    const checked = event.target.checked;
    settings[config.key] = config.invert ? !checked : checked;
    updateNodeCards();
    engine.setSettings(settings, false).catch((error) => {
      showToast(`旁路切换失败：${error.message}`, true);
    });
    markConverging();
    scheduleAnalysis();
  }

  function scheduleAnalysis(delay) {
    clearTimeout(analysisTimer);
    const wait = delay === undefined ? 105 : delay;
    analysisTimer = window.setTimeout(runAnalysis, wait);
  }

  async function runAnalysis() {
    if (!Number.isFinite(editStartedAt)) editStartedAt = performance.now();
    const token = ++analysisToken;
    try {
      const result = await Audio.renderOffline(settings, { duration: 10 });
      if (token !== analysisToken) return;
      const source = DSP.analyzeBuffer(result.sourceBuffer);
      const processed = DSP.analyzeBuffer(result.buffer);
      const preflight = evaluatePreflight(processed);
      analysis = {
        source,
        processed,
        preflight,
        fallbackGate: result.fallbackGate,
        sourceData: [
          result.sourceBuffer.getChannelData(0),
          result.sourceBuffer.getChannelData(1) || result.sourceBuffer.getChannelData(0),
        ],
        processedData: [
          result.buffer.getChannelData(0),
          result.buffer.getChannelData(1) || result.buffer.getChannelData(0),
        ],
      };
      renderMetrics();
      renderPreflight();
      drawSpectrum();
      drawWaveform();
      drawNodeGraph();
      const elapsed = Math.max(1, Math.round(performance.now() - editStartedAt));
      lastConvergenceMs = elapsed;
      dom.convergenceValue.textContent = `${elapsed} ms`;
      dom.convergenceDetail.textContent = elapsed < 260 ? "短时间窗内收敛" : "已完成收敛";
      dom.syncStatus.textContent = `声学数据与仪表已收敛 · ${elapsed} ms`;
      setEngineState(engine.playing ? "live" : "on", engine.playing ? "实时播放" : "分析就绪");
      dom.spectrumEmpty.classList.add("is-hidden");
      if (pendingSnapshotComparison) completeSnapshotComparison(processed);
    } catch (error) {
      if (token !== analysisToken) return;
      dom.syncStatus.textContent = "声学分析失败";
      dom.convergenceValue.textContent = "错误";
      dom.convergenceDetail.textContent = error.message;
      setEngineState("busy", "分析失败 · 请检查浏览器");
      showToast(`音频分析失败：${error.message}`, true);
    }
  }

  function evaluatePreflight(processed) {
    const silence = processed.peak < DSP.dbToGain(SILENCE_DB);
    const clipped = processed.clippedSamples > 0 || processed.peak >= CLIP_THRESHOLD;
    const missingChannel =
      processed.channels < 2 || processed.leftRms < 1e-5 || processed.rightRms < 1e-5;
    const overload = processed.peakDb >= EXPORT_OVERLOAD_DB;
    return {
      silence,
      clipped,
      missingChannel,
      overload,
      valid: !silence && !clipped && !missingChannel && !overload,
    };
  }

  function renderMetrics() {
    if (!analysis) return;
    const { source, processed } = analysis;
    dom.pitchValue.textContent = processed.pitch ? `${processed.pitch.toFixed(1)} Hz` : "—";
    dom.pitchDetail.textContent = processed.pitch ? noteName(processed.pitch) : "无稳定基频";
    dom.channelValue.textContent = `L ${processed.leftRmsDb.toFixed(1)} / R ${processed.rightRmsDb.toFixed(1)}`;
    dom.channelDetail.textContent = `${processed.channels}CH RMS · ${processed.leftRms > processed.rightRms ? "左偏" : "右偏"}`;
    const delay = settings.gateEnabled ? settings.gateLookahead : 0;
    dom.delayValue.textContent = `${delay.toFixed(1)} ms`;
    dom.delayDetail.textContent = settings.gateEnabled ? "门限预读 · 已计入音频" : "门限已旁路";
    dom.peakValue.textContent = `${processed.peakDb.toFixed(1)} dBFS`;
    dom.peakDetail.textContent = `输入 ${source.peakDb.toFixed(1)} → 输出`;
    const meter = DSP.clamp((processed.peakDb + 60) / 60, 0, 1) * 100;
    dom.peakMeterFill.style.width = `${meter.toFixed(1)}%`;
    const peakCard = dom.peakValue.closest(".metric-card");
    if (peakCard) peakCard.classList.toggle("is-danger", processed.peakDb >= EXPORT_OVERLOAD_DB);
    dom.durationValue.textContent = `${processed.duration.toFixed(3)} s`;
    dom.durationDetail.textContent = `${processed.channels}ch / ${(processed.sampleRate / 1000).toFixed(0)} kHz / 24-bit`;
  }

  function setCheck(element, bad, pending, title) {
    element.classList.toggle("is-bad", Boolean(bad) && !pending);
    element.classList.toggle("is-pending", Boolean(pending));
    const icon = element.querySelector("i");
    if (icon) icon.textContent = pending ? "…" : bad ? "!" : "•";
    if (title) element.title = title;
  }

  function renderPreflight() {
    if (!analysis) {
      for (const element of [dom.checkSilence, dom.checkClip, dom.checkChannel, dom.checkOverload]) {
        setCheck(element, false, true, "等待声学分析");
      }
      dom.preflightBadge.textContent = "等待分析";
      dom.exportButton.disabled = true;
      dom.exportHint.textContent = "先完成一次有效声学分析";
      return;
    }
    const check = analysis.preflight;
    setCheck(dom.checkSilence, check.silence, false, check.silence ? "输出低于 −60 dBFS" : "输出包含可听信号");
    setCheck(dom.checkClip, check.clipped, false, check.clipped ? `检测到 ${analysis.processed.clippedSamples} 个削波样本` : "未检测到削波");
    setCheck(dom.checkChannel, check.missingChannel, false, check.missingChannel ? "至少一个声道无信号" : "左右声道均有效");
    setCheck(dom.checkOverload, check.overload, false, check.overload ? `${analysis.processed.peakDb.toFixed(2)} dBFS 超过导出上限` : "峰值低于过载阈值");
    const valid = check.valid;
    dom.preflightBadge.textContent = valid ? "PASS · 可导出" : "BLOCK · 阻止导出";
    dom.preflightBadge.style.color = valid ? "var(--green)" : "var(--red)";
    dom.preflightBadge.style.borderColor = valid ? "rgba(127,224,173,.25)" : "rgba(255,102,122,.28)";
    dom.exportButton.disabled = !valid;
    if (valid) {
      dom.exportHint.textContent = "检查通过 · 将离线渲染 10 秒并写入 24-bit WAV";
    } else if (check.overload) {
      dom.exportHint.textContent = "过载保护：降低输出增益或启用软削波后才能导出";
    } else if (check.silence) {
      dom.exportHint.textContent = "输出接近静音，请降低门限或恢复节点";
    } else if (check.missingChannel) {
      dom.exportHint.textContent = "检测到声道缺失，请检查声像与节点旁路";
    } else {
      dom.exportHint.textContent = "检测到削波，请降低增益或调整软削波";
    }
  }

  function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width: rect.width, height: rect.height };
  }

  function frequencyToX(frequency, left, right) {
    const normalized = Math.log10(Math.max(20, frequency) / 20) / Math.log10(1000);
    return left + DSP.clamp(normalized, 0, 1) * (right - left);
  }

  function dbToY(db, top, bottom) {
    return top + ((0 - DSP.clamp(db, -90, 0)) / 90) * (bottom - top);
  }

  function drawSpectrum() {
    const prepared = prepareCanvas(dom.spectrumCanvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    const left = 34;
    const right = width - 10;
    const top = 9;
    const bottom = height - 20;
    context.clearRect(0, 0, width, height);
    context.font = "8px SFMono-Regular, Consolas, monospace";
    context.textBaseline = "middle";

    for (let db = 0; db >= -90; db -= 15) {
      const y = dbToY(db, top, bottom);
      context.strokeStyle = db === 0 ? "rgba(160,190,205,.16)" : "rgba(160,190,205,.07)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y + 0.5);
      context.lineTo(right, y + 0.5);
      context.stroke();
      context.fillStyle = "rgba(126,146,160,.62)";
      context.fillText(`${db}`, 4, y);
    }

    const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const frequency of frequencyTicks) {
      const x = frequencyToX(frequency, left, right);
      context.strokeStyle = "rgba(160,190,205,.065)";
      context.beginPath();
      context.moveTo(x + 0.5, top);
      context.lineTo(x + 0.5, bottom);
      context.stroke();
      context.fillStyle = "rgba(126,146,160,.72)";
      const label = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
      context.textAlign = frequency === 20 ? "left" : frequency === 20000 ? "right" : "center";
      context.fillText(label, x, height - 8);
    }
    context.textAlign = "left";

    if (!analysis) return;

    const drawCurve = (spectrum, stroke, fill, dashed) => {
      const points = [];
      for (let x = Math.ceil(left); x <= right; x += 1) {
        const normalized = (x - left) / Math.max(1, right - left);
        const frequency = 20 * Math.pow(1000, normalized);
        const bin = Math.round((frequency / spectrum.sampleRate) * spectrum.fftSize);
        if (bin >= spectrum.magnitudes.length) continue;
        const magnitude = spectrum.magnitudes[bin];
        const db = DSP.gainToDb(magnitude);
        points.push([x, dbToY(db, top, bottom)]);
      }
      if (points.length < 2) return;
      context.save();
      context.beginPath();
      context.moveTo(points[0][0], bottom);
      for (const point of points) context.lineTo(point[0], point[1]);
      context.lineTo(points[points.length - 1][0], bottom);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point[0], point[1]);
        else context.lineTo(point[0], point[1]);
      });
      context.strokeStyle = stroke;
      context.lineWidth = dashed ? 1.15 : 1.45;
      context.setLineDash(dashed ? [4, 3] : []);
      context.shadowBlur = dashed ? 0 : 8;
      context.shadowColor = stroke;
      context.stroke();
      context.restore();
    };

    drawCurve(analysis.source.spectrum, "rgba(151,170,182,.72)", "rgba(151,170,182,.055)", true);
    drawCurve(analysis.processed.spectrum, "rgba(93,216,230,.92)", "rgba(93,216,230,.09)", false);
    context.textAlign = "right";
    context.fillStyle = "rgba(126,146,160,.62)";
    context.fillText("dBFS", width - 8, 9);
    context.textAlign = "left";
  }

  function drawWaveformChannel(data, top, laneHeight, color, lineWidth) {
    const prepared = prepareCanvas(dom.waveformCanvas);
    if (!prepared) return;
    const { context, width } = prepared;
    const left = 11;
    const right = width - 11;
    const columns = Math.max(1, Math.floor(right - left));
    const center = top + laneHeight / 2;
    const amplitude = laneHeight * 0.43;
    context.beginPath();
    for (let column = 0; column < columns; column += 1) {
      const start = Math.floor((column / columns) * data.length);
      const end = Math.max(start + 1, Math.floor(((column + 1) / columns) * data.length));
      let min = 1;
      let max = -1;
      for (let index = start; index < end; index += 1) {
        const sample = data[index];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      const x = left + column + 0.5;
      context.moveTo(x, center - max * amplitude);
      context.lineTo(x, center - min * amplitude);
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  }

  function drawWaveform() {
    const prepared = prepareCanvas(dom.waveformCanvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    context.clearRect(0, 0, width, height);
    const paddingTop = 7;
    const gap = 11;
    const laneHeight = (height - paddingTop * 2 - gap) / 2;
    const laneL = paddingTop;
    const laneR = paddingTop + laneHeight + gap;
    context.font = "8px SFMono-Regular, Consolas, monospace";
    context.textBaseline = "middle";

    for (const lane of [laneL, laneR]) {
      context.strokeStyle = "rgba(160,190,205,.08)";
      context.beginPath();
      context.moveTo(0, lane + laneHeight / 2 + 0.5);
      context.lineTo(width, lane + laneHeight / 2 + 0.5);
      context.stroke();
    }
    for (let second = 0; second <= 10; second += 1) {
      const x = 11 + (second / 10) * (width - 22);
      context.strokeStyle = "rgba(160,190,205,.055)";
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
      if (second % 2 === 0) {
        context.fillStyle = "rgba(126,146,160,.55)";
        context.fillText(`${second}s`, x + 3, height - 6);
      }
    }
    context.fillStyle = "rgba(126,146,160,.62)";
    context.fillText("L", 3, laneL + laneHeight / 2);
    context.fillText("R", 3, laneR + laneHeight / 2);

    if (!analysis) return;
    if (analysis.sourceData) {
      drawWaveformChannel(analysis.sourceData[0], laneL, laneHeight, "rgba(151,170,182,.22)", 0.8);
      drawWaveformChannel(analysis.sourceData[1], laneR, laneHeight, "rgba(151,170,182,.22)", 0.8);
    }
    drawWaveformChannel(analysis.processedData[0], laneL, laneHeight, "rgba(93,216,230,.92)", 1.05);
    drawWaveformChannel(analysis.processedData[1], laneR, laneHeight, "rgba(242,166,90,.9)", 1.05);
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

  let nodeHitboxes = [];

  function drawNodeGraph() {
    const prepared = prepareCanvas(dom.nodeCanvas);
    if (!prepared) return;
    const { context, width, height } = prepared;
    context.clearRect(0, 0, width, height);
    const nodes = [
      { id: "source", title: "合成源", sub: "STEREO", enabled: true },
      { id: "hpf", title: "高通", sub: settings.hpfEnabled ? formatFrequency(settings.hpfFreq) : "BYPASS", enabled: settings.hpfEnabled },
      { id: "notch", title: "陷波", sub: settings.notchEnabled ? formatFrequency(settings.notchFreq) : "BYPASS", enabled: settings.notchEnabled },
      { id: "gate", title: "门限", sub: settings.gateEnabled ? `${settings.gateThreshold} dB` : "BYPASS", enabled: settings.gateEnabled },
      { id: "clip", title: "软削波", sub: settings.clipEnabled ? `+${settings.clipDrive.toFixed(0)} dB` : "BYPASS", enabled: settings.clipEnabled },
      { id: "output", title: "WAV", sub: "24-BIT", enabled: true },
    ];
    const padding = width < 560 ? 6 : 14;
    const available = width - padding * 2;
    const nodeWidth = DSP.clamp(available * 0.115, 44, 82);
    const gap = (available - nodeWidth * nodes.length) / (nodes.length - 1);
    const nodeHeight = DSP.clamp(height * 0.43, 44, 57);
    const y = (height - nodeHeight) / 2;
    const centers = nodes.map((node, index) => padding + nodeWidth / 2 + index * (nodeWidth + gap));
    nodeHitboxes = [];
    context.font = "8px SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (let index = 0; index < nodes.length - 1; index += 1) {
      const node = nodes[index];
      const startX = centers[index] + nodeWidth / 2;
      const endX = centers[index + 1] - nodeWidth / 2;
      const active = node.enabled && nodes[index + 1].enabled;
      context.save();
      context.beginPath();
      context.moveTo(startX, height / 2);
      context.lineTo(endX, height / 2);
      context.strokeStyle = active ? "rgba(93,216,230,.42)" : "rgba(242,166,90,.38)";
      context.lineWidth = 1;
      context.setLineDash(active ? [] : [3, 3]);
      context.stroke();
      if (active) {
        const phase = engine.playing ? (performance.now() / 1400) % 1 : 0.42;
        const x = startX + (endX - startX) * phase;
        context.beginPath();
        context.arc(x, height / 2, 2.3, 0, Math.PI * 2);
        context.fillStyle = "rgba(93,216,230,.95)";
        context.shadowBlur = 9;
        context.shadowColor = "rgba(93,216,230,.8)";
        context.fill();
      }
      context.restore();
    }

    nodes.forEach((node, index) => {
      const x = centers[index] - nodeWidth / 2;
      const clickable = node.id !== "source" && node.id !== "output";
      const hovered = clickable && nodeHover === node.id;
      roundedRect(context, x, y, nodeWidth, nodeHeight, 7);
      context.fillStyle = hovered ? "rgba(29,49,57,.96)" : "rgba(14,21,27,.92)";
      context.fill();
      context.strokeStyle = node.enabled
        ? hovered ? "rgba(93,216,230,.75)" : "rgba(93,216,230,.28)"
        : "rgba(242,166,90,.42)";
      context.lineWidth = 1;
      context.setLineDash(node.enabled ? [] : [3, 2]);
      context.stroke();
      context.setLineDash([]);
      if (node.enabled) {
        context.fillStyle = "rgba(93,216,230,.8)";
        context.fillRect(x + 7, y + 7, 2, nodeHeight - 14);
      } else {
        context.fillStyle = "rgba(242,166,90,.72)";
        context.fillRect(x + 7, y + 7, 2, nodeHeight - 14);
      }
      context.fillStyle = node.enabled ? "#e3edf0" : "rgba(220,190,160,.72)";
      context.font = `${width < 560 ? 9 : 10}px "Phase Sans", "Segoe UI", sans-serif`;
      context.fillText(node.title, x + nodeWidth / 2 + 1, y + nodeHeight * 0.4);
      context.fillStyle = node.enabled ? "rgba(113,139,152,.8)" : "rgba(242,166,90,.68)";
      context.font = "7px SFMono-Regular, Consolas, monospace";
      context.fillText(node.sub, x + nodeWidth / 2 + 1, y + nodeHeight * 0.7);
      if (clickable) {
        nodeHitboxes.push({
          id: node.id,
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          bypassId: `bypass${node.id[0].toUpperCase()}${node.id.slice(1)}`,
        });
      }
    });
    context.textAlign = "left";
  }

  function nodeAtPoint(x, y) {
    return nodeHitboxes.find(
      (box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
    );
  }

  dom.nodeCanvas.addEventListener("pointermove", (event) => {
    const rect = dom.nodeCanvas.getBoundingClientRect();
    const hit = nodeAtPoint(event.clientX - rect.left, event.clientY - rect.top);
    const next = hit ? hit.id : "";
    if (next !== nodeHover) {
      nodeHover = next;
      dom.nodeCanvas.style.cursor = next ? "pointer" : "default";
      drawNodeGraph();
    }
  });

  dom.nodeCanvas.addEventListener("pointerleave", () => {
    nodeHover = "";
    dom.nodeCanvas.style.cursor = "default";
    drawNodeGraph();
  });

  dom.nodeCanvas.addEventListener("pointerdown", (event) => {
    const rect = dom.nodeCanvas.getBoundingClientRect();
    const hit = nodeAtPoint(event.clientX - rect.left, event.clientY - rect.top);
    if (!hit) return;
    const checkbox = $(hit.bypassId);
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  });

  function updateTransportDisplay(position) {
    const safe = DSP.clamp(position || 0, 0, Audio.SOURCE_DURATION);
    dom.timeReadout.textContent = `${formatTime(safe)} / ${formatTime(Audio.SOURCE_DURATION)}`;
    dom.timelineFill.style.width = `${(safe / Audio.SOURCE_DURATION) * 100}%`;
    dom.playhead.style.left = `${(safe / Audio.SOURCE_DURATION) * 100}%`;
    dom.playhead.classList.toggle("is-visible", engine.playing || safe > 0.001);
  }

  async function togglePlayback() {
    dom.playButton.disabled = true;
    try {
      if (engine.playing) {
        const position = engine.pause();
        dom.playLabel.textContent = "继续试听";
        dom.playButton.querySelector(".button-icon").textContent = ">";
        updateTransportDisplay(position);
        setEngineState("on", "预览已暂停");
      } else {
        setEngineState("busy", "正在启动 AudioContext…");
        await engine.play(engine.getPosition());
        dom.playLabel.textContent = "暂停";
        dom.playButton.querySelector(".button-icon").textContent = "||";
        dom.systemFormat.textContent = `${(engine.sampleRate / 1000).toFixed(0)} kHz · STEREO`;
        setEngineState("live", "实时播放 · Web Audio 合成");
        updateTransportDisplay(engine.getPosition());
      }
    } catch (error) {
      setEngineState("busy", "音频引擎启动失败");
      showToast(`无法启动音频：${error.message}`, true);
    } finally {
      dom.playButton.disabled = false;
    }
  }

  async function replay() {
    try {
      await engine.replay();
      dom.playLabel.textContent = "暂停";
      dom.playButton.querySelector(".button-icon").textContent = "||";
      setEngineState("live", "从 00:00 重播");
      updateTransportDisplay(0);
    } catch (error) {
      showToast(`重播失败：${error.message}`, true);
    }
  }

  function resetParameters() {
    engine.pause();
    settings = { ...Audio.DEFAULTS };
    syncControlsFromSettings();
    engine.setSettings(settings, true).catch((error) => {
      showToast(`参数重置失败：${error.message}`, true);
    });
    dom.playLabel.textContent = "开始试听";
    dom.playButton.querySelector(".button-icon").textContent = ">";
    updateTransportDisplay(0);
    pendingSnapshotComparison = null;
    dom.consistencyReadout.classList.remove("is-good", "is-bad");
    dom.consistencyReadout.querySelector("strong").textContent = "尚未比较";
    markConverging();
    scheduleAnalysis(0);
    showToast("已恢复默认参数与旁路状态");
  }

  function animationTick() {
    if (engine.playing) {
      const position = engine.getPosition();
      updateTransportDisplay(position);
      const peaks = engine.getLivePeaks();
      const liveDb = DSP.gainToDb(peaks.post);
      if (Number.isFinite(liveDb)) {
        dom.peakMeterFill.style.width = `${DSP.clamp((liveDb + 60) / 60, 0, 1) * 100}%`;
      }
      drawNodeGraph();
    }
    window.requestAnimationFrame(animationTick);
  }

  function renderSnapshotOptions(selectedId) {
    dom.snapshotSelect.replaceChildren();
    if (snapshots.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "暂无参数快照";
      dom.snapshotSelect.append(option);
      dom.snapshotSelect.disabled = true;
      dom.loadSnapshotButton.disabled = true;
      return;
    }
    dom.snapshotSelect.disabled = false;
    dom.loadSnapshotButton.disabled = false;
    for (const snapshot of snapshots) {
      const option = document.createElement("option");
      option.value = snapshot.id;
      option.textContent = `${snapshot.name} · ${new Date(snapshot.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
      option.selected = snapshot.id === selectedId;
      dom.snapshotSelect.append(option);
    }
  }

  function metricsSnapshot() {
    if (!analysis) return null;
    return {
      pitch: analysis.processed.pitch,
      delay: settings.gateEnabled ? settings.gateLookahead : 0,
      duration: analysis.processed.duration,
      peakDb: analysis.processed.peakDb,
      leftPeak: analysis.processed.leftPeak,
      rightPeak: analysis.processed.rightPeak,
      beatContrast: analysis.processed.beatContrast,
    };
  }

  function saveSnapshot() {
    const name = dom.snapshotName.value.trim() || `参数组 ${snapshots.length + 1}`;
    const snapshot = {
      id: `snap-${Date.now()}`,
      name: name.slice(0, 32),
      createdAt: new Date().toISOString(),
      settings: { ...settings },
      metrics: metricsSnapshot(),
    };
    snapshots.unshift(snapshot);
    snapshots = snapshots.slice(0, 12);
    persistSnapshots();
    renderSnapshotOptions(snapshot.id);
    dom.snapshotBadge.textContent = `${snapshots.length} SAVED`;
    showToast(`已保存「${snapshot.name}」${snapshot.metrics ? "及声学基准" : "，等待首次分析基准"}`);
  }

  function completeSnapshotComparison(processed) {
    const pending = pendingSnapshotComparison;
    pendingSnapshotComparison = null;
    const current = {
      pitch: processed.pitch,
      delay: settings.gateEnabled ? settings.gateLookahead : 0,
      duration: processed.duration,
    };
    if (!pending.metrics) {
      pending.snapshot.metrics = { ...current };
      persistSnapshots();
      dom.consistencyReadout.classList.remove("is-good", "is-bad");
      dom.consistencyReadout.querySelector("strong").textContent = "已建立本次声学基准";
      return;
    }
    const baseline = pending.metrics;
    const pitchDelta = Math.abs(current.pitch - (baseline.pitch || 0));
    const delayDelta = Math.abs(current.delay - (baseline.delay || 0));
    const durationDelta = Math.abs(current.duration - (baseline.duration || 0));
    const consistent = pitchDelta <= 0.5 && delayDelta <= 0.05 && durationDelta <= 0.0005;
    dom.consistencyReadout.classList.toggle("is-good", consistent);
    dom.consistencyReadout.classList.toggle("is-bad", !consistent);
    dom.consistencyReadout.querySelector("strong").textContent =
      `音高差 ${pitchDelta.toFixed(1)} Hz · 延迟差 ${delayDelta.toFixed(2)} ms · 时长差 ${durationDelta.toFixed(4)} s`;
    showToast(consistent ? "参数重载一致：音高、延迟与时长吻合" : "重载一致性异常，请检查参数", !consistent);
  }

  function loadSelectedSnapshot() {
    const snapshot = snapshots.find((item) => item.id === dom.snapshotSelect.value);
    if (!snapshot) return;
    engine.pause();
    settings = Audio.mergeSettings(Audio.DEFAULTS, snapshot.settings);
    syncControlsFromSettings();
    dom.snapshotName.value = snapshot.name;
    dom.consistencyReadout.classList.remove("is-good", "is-bad");
    dom.consistencyReadout.querySelector("strong").textContent = "正在重新渲染并比较…";
    pendingSnapshotComparison = {
      snapshot,
      metrics: snapshot.metrics ? { ...snapshot.metrics } : null,
    };
    engine.setSettings(settings, true).catch((error) => {
      showToast(`快照载入失败：${error.message}`, true);
    });
    dom.playLabel.textContent = "开始试听";
    dom.playButton.querySelector(".button-icon").textContent = ">";
    updateTransportDisplay(0);
    markConverging();
    scheduleAnalysis(0);
    showToast(`正在重新载入「${snapshot.name}」`);
  }

  function setTestResult(row, state, detail, label) {
    row.classList.remove("is-pass", "is-fail", "is-running");
    if (state) row.classList.add(`is-${state}`);
    row.querySelector(".test-detail").textContent = detail;
    row.querySelector("b").textContent = label;
  }

  async function runSelfTest() {
    dom.selfTestButton.disabled = true;
    dom.selfTestButton.textContent = "验证中…";
    const rows = [dom.channelTest, dom.bandTest, dom.beatTest];
    for (const row of rows) setTestResult(row, "running", "离线渲染中", "RUN");
    try {
      const channelBase = Audio.mergeSettings(settings, { balance: -0.85, width: 1 });
      const [channelLeft, channelRight] = await Promise.all([
        Audio.renderOffline(channelBase, { duration: 2, bypassChain: true }),
        Audio.renderOffline({ ...channelBase, balance: 0.85 }, { duration: 2, bypassChain: true }),
      ]);
      const analysisLeft = DSP.analyzeBuffer(channelLeft.buffer);
      const analysisRight = DSP.analyzeBuffer(channelRight.buffer);
      const biasLeft = analysisLeft.leftRmsDb - analysisLeft.rightRmsDb;
      const biasRight = analysisRight.leftRmsDb - analysisRight.rightRmsDb;
      const channelPass = biasLeft > 2 && biasRight < -2;
      setTestResult(
        dom.channelTest,
        channelPass ? "pass" : "fail",
        `L−R ${formatSigned(biasLeft)} → ${formatSigned(biasRight)} dB`,
        channelPass ? "PASS" : "FAIL"
      );

      const bandBase = Audio.mergeSettings(settings, {
        hpfEnabled: true,
        hpfFreq: 60,
        hpfQ: 0.7,
        notchEnabled: false,
        gateEnabled: false,
        clipEnabled: false,
        masterGain: 0,
      });
      const [bandLow, bandHigh] = await Promise.all([
        Audio.renderOffline(bandBase, { duration: 2 }),
        Audio.renderOffline({ ...bandBase, hpfFreq: 1800 }, { duration: 2 }),
      ]);
      const lowAnalysis = DSP.analyzeBuffer(bandLow.buffer);
      const highAnalysis = DSP.analyzeBuffer(bandHigh.buffer);
      const lowEnergy = DSP.bandEnergy(lowAnalysis.spectrum, 50, 300);
      const highEnergy = DSP.bandEnergy(highAnalysis.spectrum, 50, 300);
      const bandDeltaDb = 10 * Math.log10((highEnergy + 1e-15) / (lowEnergy + 1e-15));
      const bandPass = bandDeltaDb < -4;
      setTestResult(
        dom.bandTest,
        bandPass ? "pass" : "fail",
        `50–300 Hz ${formatSigned(bandDeltaDb)} dB`,
        bandPass ? "PASS" : "FAIL"
      );

      const beatBase = Audio.mergeSettings(settings, { beatAccent: 0 });
      const [beatLow, beatHigh] = await Promise.all([
        Audio.renderOffline(beatBase, { duration: 4, bypassChain: true }),
        Audio.renderOffline({ ...beatBase, beatAccent: 1 }, { duration: 4, bypassChain: true }),
      ]);
      const beatLowAnalysis = DSP.analyzeBuffer(beatLow.buffer);
      const beatHighAnalysis = DSP.analyzeBuffer(beatHigh.buffer);
      const beatLowContrast = beatLowAnalysis.beatContrast;
      const beatHighContrast = beatHighAnalysis.beatContrast;
      const beatPass = beatHighContrast > beatLowContrast * 1.08 && beatHighContrast - beatLowContrast > 0.04;
      setTestResult(
        dom.beatTest,
        beatPass ? "pass" : "fail",
        `2 Hz 包络 ${beatLowContrast.toFixed(2)}× → ${beatHighContrast.toFixed(2)}×`,
        beatPass ? "PASS" : "FAIL"
      );
      const passed = channelPass && bandPass && beatPass;
      showToast(passed ? "真实音频验证通过：三个维度均有可测量变化" : "有验证项未通过，请查看差异读数", !passed);
    } catch (error) {
      for (const row of rows) setTestResult(row, "fail", error.message, "ERR");
      showToast(`离线验证失败：${error.message}`, true);
    } finally {
      dom.selfTestButton.disabled = false;
      dom.selfTestButton.textContent = "重新验证";
    }
  }

  function exportFilename() {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    return `phase-lab-${stamp}.wav`;
  }

  function appendHistoryLine(text, className) {
    const line = document.createElement("span");
    line.textContent = text;
    if (className) line.className = className;
    dom.exportHistory.append(line);
    return line;
  }

  function renderExportHistory() {
    dom.exportHistory.replaceChildren();
    if (exportRecords.length === 0) {
      appendHistoryLine("尚无导出记录");
      appendHistoryLine("重复载入后会在此比较时长与关键峰值");
      return;
    }
    const latest = exportRecords[0];
    appendHistoryLine(
      `${latest.filename} · ${latest.duration.toFixed(3)} s · ${Wav.formatBytes(latest.bytes)}`
    );
    appendHistoryLine(
      `关键峰值 L ${DSP.gainToDb(latest.leftPeak).toFixed(2)} / R ${DSP.gainToDb(latest.rightPeak).toFixed(2)} dBFS`
    );
    const previewDurationDelta = Math.abs(latest.duration - latest.previewDuration);
    const previewPeakDeltaDb = Math.max(
      Math.abs(DSP.gainToDb(latest.leftPeak) - DSP.gainToDb(latest.previewLeftPeak)),
      Math.abs(DSP.gainToDb(latest.rightPeak) - DSP.gainToDb(latest.previewRightPeak))
    );
    const previewPitchDelta = Math.abs(latest.pitch - latest.previewPitch);
    const previewMatches =
      previewDurationDelta <= 1e-6 && previewPeakDeltaDb <= 0.001 && previewPitchDelta <= 0.5;
    appendHistoryLine(
      `与预览对比 · 时长差 ${previewDurationDelta.toFixed(6)} s · 峰值差 ${previewPeakDeltaDb.toFixed(3)} dB · 音高差 ${previewPitchDelta.toFixed(1)} Hz`,
      previewMatches ? "is-good" : "is-bad"
    );
    appendHistoryLine(previewMatches ? "导出与预览一致 · PASS" : "导出与预览不一致 · CHECK", previewMatches ? "is-good" : "is-bad");
    if (exportRecords.length >= 2) {
      const prior = exportRecords[1];
      const durationDelta = Math.abs(latest.duration - prior.duration);
      const peakDeltaDb = Math.max(
        Math.abs(DSP.gainToDb(latest.leftPeak) - DSP.gainToDb(prior.leftPeak)),
        Math.abs(DSP.gainToDb(latest.rightPeak) - DSP.gainToDb(prior.rightPeak))
      );
      const pitchDelta = Math.abs(latest.pitch - prior.pitch);
      const consistent = durationDelta <= 1e-6 && peakDeltaDb <= 0.001 && pitchDelta <= 0.5;
      appendHistoryLine(
        `对比上一文件 · 时长差 ${durationDelta.toFixed(6)} s · 峰值差 ${peakDeltaDb.toFixed(3)} dB · 音高差 ${pitchDelta.toFixed(1)} Hz`,
        consistent ? "is-good" : "is-bad"
      );
      appendHistoryLine(consistent ? "两次导出时长与关键峰值一致 · PASS" : "两次导出存在差异 · CHECK", consistent ? "is-good" : "is-bad");
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function performExport() {
    if (!analysis || !analysis.preflight.valid) {
      showToast("导出已被预检阻止", true);
      return null;
    }
    dom.exportButton.disabled = true;
    dom.exportButton.innerHTML = '<span aria-hidden="true">↓</span> 离线渲染中…';
    try {
      const result = await Audio.renderOffline(settings, { duration: 10 });
      const processed = DSP.analyzeBuffer(result.buffer);
      const preflight = evaluatePreflight(processed);
      if (!preflight.valid) {
        analysis = {
          ...analysis,
          processed,
          preflight,
          processedData: [
            result.buffer.getChannelData(0),
            result.buffer.getChannelData(1) || result.buffer.getChannelData(0),
          ],
        };
        renderMetrics();
        renderPreflight();
        drawWaveform();
        showToast("重新渲染后未通过预检，导出已阻止", true);
        return null;
      }
      const wav = Wav.encodeWav24(result.buffer);
      const filename = exportFilename();
      downloadBlob(new Blob([wav], { type: "audio/wav" }), filename);
      const record = {
        filename,
        bytes: wav.byteLength,
        duration: result.buffer.length / result.buffer.sampleRate,
        pitch: processed.pitch,
        previewDuration: analysis.processed.duration,
        previewPitch: analysis.processed.pitch,
        previewLeftPeak: analysis.processed.leftPeak,
        previewRightPeak: analysis.processed.rightPeak,
        delay: settings.gateEnabled ? settings.gateLookahead : 0,
        peakDb: processed.peakDb,
        leftPeak: processed.leftPeak,
        rightPeak: processed.rightPeak,
        createdAt: new Date().toISOString(),
      };
      exportRecords.unshift(record);
      exportRecords = exportRecords.slice(0, 8);
      renderExportHistory();
      showToast(`已导出 ${filename} · ${record.duration.toFixed(3)} 秒 · 24-bit WAV`);
      return record;
    } catch (error) {
      showToast(`导出失败：${error.message}`, true);
      return null;
    } finally {
      dom.exportButton.innerHTML = '<span aria-hidden="true">↓</span> 导出 WAV';
      if (analysis && analysis.preflight.valid) dom.exportButton.disabled = false;
    }
  }

  function bindEvents() {
    for (const id of Object.keys(ranges)) {
      const element = $(id);
      if (element) element.addEventListener("input", onRangeInput);
    }
    for (const id of Object.keys(switches)) {
      const element = $(id);
      if (element) element.addEventListener("change", onSwitchChange);
    }
    dom.playButton.addEventListener("click", togglePlayback);
    dom.replayButton.addEventListener("click", replay);
    dom.resetButton.addEventListener("click", resetParameters);
    dom.saveSnapshotButton.addEventListener("click", saveSnapshot);
    dom.loadSnapshotButton.addEventListener("click", loadSelectedSnapshot);
    dom.selfTestButton.addEventListener("click", runSelfTest);
    dom.exportButton.addEventListener("click", performExport);
    window.addEventListener("resize", () => {
      drawSpectrum();
      drawWaveform();
      drawNodeGraph();
    });
    const observer = new ResizeObserver(() => {
      drawSpectrum();
      drawWaveform();
      drawNodeGraph();
    });
    for (const element of [dom.spectrumCanvas, dom.waveformCanvas, dom.nodeCanvas]) {
      observer.observe(element.parentElement);
    }
    engine.onEnded = () => {
      dom.playLabel.textContent = "重新试听";
      dom.playButton.querySelector(".button-icon").textContent = ">";
      updateTransportDisplay(0);
      setEngineState("on", "播放完成 · 可重播");
    };
  }

  function initialize() {
    bindEvents();
    syncControlsFromSettings();
    renderSnapshotOptions(snapshots[0] ? snapshots[0].id : "");
    dom.snapshotBadge.textContent = snapshots.length ? `${snapshots.length} SAVED` : "LOCAL";
    renderPreflight();
    renderExportHistory();
    updateTransportDisplay(0);
    dom.syncStatus.textContent = "首次声学分析中 · 请稍候";
    setEngineState("busy", "正在生成 Web Audio 信号…");
    editStartedAt = performance.now();
    scheduleAnalysis(35);
    animationTick();
  }

  window.__phaseLab = {
    getSettings: () => ({ ...settings }),
    getAnalysis: () => analysis,
    runAnalysis,
    runSelfTest,
    performExport,
    engine,
  };

  initialize();
})();
