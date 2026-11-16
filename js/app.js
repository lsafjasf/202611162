(function () {
  "use strict";

  const M = window.RailModel;
  const O = window.RailOffline;
  const clamp = M.clamp;
  const PRESET_KEY = "doppler-rail:preset:v1";
  const $ = (selector) => document.querySelector(selector);
  const refs = {
    speed: $("#speedInput"),
    gauge: $("#gaugeInput"),
    listener: $("#listenerInput"),
    speedValue: $("#speedValue"),
    gaugeValue: $("#gaugeValue"),
    listenerValue: $("#listenerValue"),
    playBtn: $("#playBtn"),
    playIcon: $("#playIcon"),
    playText: $("#playText"),
    replayBtn: $("#replayBtn"),
    resetBtn: $("#resetBtn"),
    startButton: $("#startButton"),
    startVeil: $("#startVeil"),
    pauseVeil: $("#pauseVeil"),
    engineLabel: $("#engineLabel"),
    sampleRateLabel: $("#sampleRateLabel"),
    clockLabel: $("#clockLabel"),
    timecode: $("#timecode"),
    timeProgress: $("#timeProgress"),
    phaseChip: $("#phaseChip"),
    passChip: $("#passChip"),
    doppler: $("#dopplerReadout"),
    distance: $("#distanceReadout"),
    pan: $("#panReadout"),
    freqValue: $("#freqValue"),
    bandBars: $("#bandBars"),
    stereoL: $("#stereoL"),
    stereoR: $("#stereoR"),
    stereoBalance: $("#stereoBalance"),
    balanceNeedle: $("#balanceNeedle"),
    stereoFoot: $("#stereoFoot"),
    latencyValue: $("#latencyValue"),
    contextFoot: $("#contextFoot"),
    convergence: $("#convergence"),
    convergenceText: $("#convergenceText"),
    peakValue: $("#peakValue"),
    peakFill: $("#peakFill"),
    peakFoot: $("#peakFoot"),
    presetState: $("#presetState"),
    saveBtn: $("#saveBtn"),
    loadBtn: $("#loadBtn"),
    exportBtn: $("#exportBtn"),
    verifyBtn: $("#verifyBtn"),
    probeBtn: $("#probeBtn"),
    exportChecks: $("#exportChecks"),
    exportReport: $("#exportReport"),
    footerState: $("#footerState"),
    canvasWrap: $("#canvasWrap")
  };

  const audio = new window.RailAudio();
  const visualizer = new window.RailVisualizer($("#sceneCanvas"), audio);
  const state = {
    params: M.normalizeParams(M.DEFAULTS),
    scene: M.acousticsAt(M.DEFAULTS, -M.WORLD_HALF),
    trainX: -M.WORLD_HALF,
    simTime: 0,
    running: false,
    paused: false,
    started: false,
    loopWait: 0,
    lastFrame: 0,
    lastClickCount: 0,
    lastDx: -M.WORLD_HALF,
    passTimer: 0,
    adjustmentAt: 0,
    adjustmentBaseline: null,
    adjustmentAxis: "",
    convergenceLocked: false,
    busy: false,
    savedPreset: null,
    lastExport: null,
    dragging: false
  };

  function readControls() {
    return M.normalizeParams({
      speedKmh: Number(refs.speed.value),
      gauge: Number(refs.gauge.value),
      listener: Number(refs.listener.value)
    });
  }

  function setControls(params) {
    const p = M.normalizeParams(params);
    refs.speed.value = p.speedKmh;
    refs.gauge.value = p.gauge;
    refs.listener.value = p.listener;
    renderControlLabels(p);
  }

  function renderControlLabels(params) {
    const p = M.normalizeParams(params);
    refs.speedValue.innerHTML = `${p.speedKmh.toFixed(0)} <small>km/h</small>`;
    refs.gaugeValue.innerHTML = `${p.gauge.toFixed(3)} <small>m</small>`;
    refs.listenerValue.innerHTML = `${M.formatSigned(p.listener, 1)} <small>m</small>`;
  }

  function markAdjustment(axis) {
    const metrics = audio.lastMetrics;
    state.adjustmentAt = performance.now();
    state.adjustmentAxis = axis;
    state.adjustmentBaseline = metrics ? {
      dominantHz: metrics.dominantHz,
      balance: metrics.balance,
      peak: metrics.peak
    } : null;
    state.convergenceLocked = false;
    refs.convergence.classList.remove("locked");
    refs.convergence.classList.add("settling");
    refs.convergenceText.textContent = "声音与仪表收敛中…";
  }

  function applyParams(params, axis) {
    state.params = M.normalizeParams(params);
    audio.setParams(state.params);
    state.scene = M.acousticsAt(state.params, state.trainX);
    renderControlLabels(state.params);
    markAdjustment(axis || "params");
  }

  function updateSceneReadouts() {
    const scene = state.scene;
    refs.doppler.textContent = `×${scene.doppler.toFixed(3)}`;
    refs.distance.textContent = `${scene.distance.toFixed(1)} m`;
    const pan = Math.round(Math.abs(scene.pan) * 100);
    refs.pan.textContent = pan < 2 ? "C" : `${scene.pan < 0 ? "L" : "R"} ${pan}`;
    refs.phaseChip.textContent = scene.phase;
    refs.phaseChip.className = `phase-chip ${scene.phase === "APPROACH" ? "approach" : scene.phase === "RECEDE" ? "recede" : ""}`;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, seconds);
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const millis = Math.floor((safe % 1) * 1000);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function dbLabel(value) {
    if (!Number.isFinite(value) || value < -80) return "−∞";
    return value.toFixed(1);
  }

  function updateTelemetry(metrics) {
    if (!metrics || !state.started) return;
    const frequency = Number(metrics.dominantHz) || 0;
    refs.freqValue.textContent = frequency > 20 ? frequency.toFixed(0) : "—";
    const bands = metrics.bands || { low: 0, mid: 0, high: 0 };
    Object.keys(bands).forEach((key) => {
      const bar = refs.bandBars.querySelector(`[data-band="${key}"]`);
      if (bar) bar.style.height = `${Math.max(4, bands[key] * 100).toFixed(1)}%`;
    });

    const leftDb = M.gainToDb(metrics.rmsL || 0);
    const rightDb = M.gainToDb(metrics.rmsR || 0);
    refs.stereoL.textContent = `L ${dbLabel(leftDb)}`;
    refs.stereoR.textContent = `R ${dbLabel(rightDb)}`;
    const balance = Number(metrics.balance) || 0;
    const direction = Math.abs(balance) < 0.025 ? "C" : balance < 0 ? `L ${Math.round(-balance * 100)}` : `R ${Math.round(balance * 100)}`;
    refs.stereoBalance.textContent = direction;
    refs.balanceNeedle.style.left = `${50 + balance * 50}%`;
    const sideDb = Math.abs(leftDb - rightDb);
    refs.stereoFoot.textContent = Number.isFinite(sideDb) ? `声道差 ${sideDb.toFixed(1)} dB · ${state.paused ? "已冻结" : "实时"}` : "等待音频输入";

    const latency = audio.latencyMs;
    refs.latencyValue.textContent = state.started && latency > 0 ? latency.toFixed(2) : "—";
    const ctxState = audio.state === "running" ? "running" : audio.state;
    refs.contextFoot.textContent = `AudioContext / ${ctxState}`;

    const peakDb = M.gainToDb(metrics.peak || 0);
    refs.peakValue.textContent = dbLabel(peakDb);
    const fill = clamp((peakDb + 48) / 48, 0, 1);
    refs.peakFill.style.width = `${(fill * 100).toFixed(1)}%`;
    refs.peakFoot.textContent = peakDb > -80 ? `安全余量 ${(-peakDb).toFixed(1)} dB` : "安全余量 —";
  }

  function updateConvergence(now) {
    if (!state.adjustmentAt) return;
    const elapsed = (now - state.adjustmentAt) / 1000;
    if (elapsed < 0.62) {
      refs.convergenceText.textContent = `声音与仪表收敛中 ${elapsed.toFixed(2)}s`;
      return;
    }
    if (state.convergenceLocked) return;
    state.convergenceLocked = true;
    refs.convergence.classList.remove("settling");
    refs.convergence.classList.add("locked");
    if (!state.running || state.paused) {
      refs.convergenceText.textContent = "参数已锁定 · 待播放验证";
      return;
    }
    refs.convergenceText.textContent = `声音与仪表已收敛 · ${Math.min(elapsed, 0.68).toFixed(2)}s`;
  }

  function setStatus(text) {
    refs.engineLabel.textContent = text;
    refs.footerState.textContent = text.toUpperCase();
  }

  function updateTransportUI() {
    const active = state.running && !state.paused;
    refs.playIcon.textContent = active ? "Ⅱ" : "▶";
    refs.playText.textContent = active ? "暂停" : state.paused ? "继续" : "播放";
    refs.startVeil.classList.toggle("is-hidden", state.started);
    refs.pauseVeil.classList.toggle("is-hidden", !state.paused);
    document.querySelector(".live-dot").classList.toggle("is-on", active);
    if (active) setStatus("LIVE / 声轨运行中");
    else if (state.paused) setStatus("PAUSED / 全部冻结");
    else if (state.started) setStatus("READY / 已就绪");
    else setStatus("音频待启动");
  }

  function restartSimulation() {
    state.trainX = -M.WORLD_HALF;
    state.simTime = 0;
    state.loopWait = 0;
    state.lastDx = -M.WORLD_HALF;
    state.lastClickCount = 0;
    state.passTimer = 0;
    state.scene = M.acousticsAt(state.params, state.trainX);
    refs.passChip.classList.remove("active");
    audio.resetBeats(state.trainX);
  }

  async function beginPlayback(restart) {
    try {
      await audio.resume();
      audio.setParams(state.params);
      const firstStart = !state.started;
      state.started = true;
      state.running = true;
      state.paused = false;
      if (restart || firstStart) restartSimulation();
      state.lastFrame = performance.now();
      refs.sampleRateLabel.textContent = `${(audio.ctx.sampleRate / 1000).toFixed(1)} kHz`;
      updateTransportUI();
      updateSceneReadouts();
    } catch (error) {
      refs.engineLabel.textContent = "音频启动失败";
      refs.exportReport.textContent = `AudioContext 启动失败：${error.message}`;
      refs.exportReport.className = "export-report error";
    }
  }

  async function pausePlayback() {
    state.paused = true;
    await audio.pause();
    state.lastFrame = 0;
    refs.contextFoot.textContent = `AudioContext / ${audio.state}`;
    updateTransportUI();
    updateConvergence(performance.now());
  }

  async function resumePlayback() {
    await audio.resume();
    state.started = true;
    state.running = true;
    state.paused = false;
    state.lastFrame = performance.now();
    updateTransportUI();
  }

  async function togglePlayback() {
    if (!state.started) {
      await beginPlayback(true);
    } else if (state.paused) {
      await resumePlayback();
    } else {
      await pausePlayback();
    }
  }

  async function replay() {
    restartSimulation();
    if (!state.started || state.paused) {
      await beginPlayback(true);
    } else {
      state.lastFrame = performance.now();
      audio.resetBeats(state.trainX);
    }
  }

  function triggerPass() {
    state.passTimer = 1;
    visualizer.pulsePass();
    refs.passChip.textContent = "PAN FLIP / L→R";
    refs.passChip.classList.add("active");
    window.clearTimeout(triggerPass.timer);
    triggerPass.timer = window.setTimeout(() => {
      refs.passChip.classList.remove("active");
      refs.passChip.textContent = "PAN FLIP STANDBY";
    }, 950);
  }

  function simulate(now) {
    if (!state.running || state.paused) return;
    if (!state.lastFrame) state.lastFrame = now;
    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    state.simTime += dt;

    if (state.trainX <= M.WORLD_HALF) {
      state.trainX += (state.params.speedKmh / 3.6) * dt;
      if (state.trainX > M.WORLD_HALF) state.trainX = M.WORLD_HALF;
      state.scene = M.acousticsAt(state.params, state.trainX);
      if (state.lastDx < 0 && state.scene.dx >= 0) triggerPass();
      state.lastDx = state.scene.dx;
      audio.setParams(state.params);
      audio.update(state.scene);
      if (audio.clickCount !== state.lastClickCount) {
        state.lastClickCount = audio.clickCount;
        visualizer.pulseClick();
      }
    } else {
      state.loopWait += dt;
      audio.update(M.acousticsAt(state.params, M.WORLD_HALF + 1));
      if (state.loopWait > 1.25) {
        restartSimulation();
        state.lastFrame = now;
      }
    }

    const metrics = audio.readMetrics();
    updateTelemetry(metrics);
    updateSceneReadouts();
    updateConvergence(now);
    refs.timecode.textContent = formatTime(state.simTime);
    refs.clockLabel.textContent = formatTime(state.simTime);
    refs.timeProgress.style.width = `${clamp(state.simTime / M.EXPORT_SECONDS, 0, 1) * 100}%`;
  }

  function animationLoop(now) {
    simulate(now);
    visualizer.setState({
      scene: state.scene,
      params: state.params,
      running: state.running,
      paused: state.paused,
      started: state.started
    });
    visualizer.draw(now);
    requestAnimationFrame(animationLoop);
  }

  function canvasWorldX(clientX) {
    const rect = refs.canvasWrap.getBoundingClientRect();
    const mapped = clamp((clientX - rect.left) / rect.width * 2 - 1, -1, 1);
    return Math.sign(mapped) * Math.pow(Math.abs(mapped), 1 / 0.79) * M.WORLD_HALF;
  }

  function setListenerFromPointer(clientX) {
    const worldX = clamp(canvasWorldX(clientX), -38, 38);
    refs.listener.value = Math.round(worldX * 2) / 2;
    applyParams(readControls(), "listener");
  }

  refs.startButton.addEventListener("click", () => beginPlayback(true));
  refs.playBtn.addEventListener("click", togglePlayback);
  refs.replayBtn.addEventListener("click", replay);
  refs.resetBtn.addEventListener("click", () => {
    setControls(M.DEFAULTS);
    applyParams(M.DEFAULTS, "reset");
    updateSceneReadouts();
  });

  refs.speed.addEventListener("input", () => applyParams(readControls(), "speed"));
  refs.gauge.addEventListener("input", () => applyParams(readControls(), "gauge"));
  refs.listener.addEventListener("input", () => applyParams(readControls(), "listener"));

  refs.canvasWrap.addEventListener("pointerdown", (event) => {
    if (!state.started || event.target.closest("button")) return;
    state.dragging = true;
    refs.canvasWrap.setPointerCapture?.(event.pointerId);
    setListenerFromPointer(event.clientX);
  });
  refs.canvasWrap.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    setListenerFromPointer(event.clientX);
  });
  ["pointerup", "pointercancel"].forEach((type) => {
    refs.canvasWrap.addEventListener(type, () => { state.dragging = false; });
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || event.metaKey || event.ctrlKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key.toLowerCase() === "r") {
      replay();
    } else if (event.key.toLowerCase() === "x") {
      exportCurrent();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.started && state.running && !state.paused) {
      pausePlayback();
    }
  });

  function presetTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "已保存"
      : `已保存 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function persistPreset(quiet) {
    const paramsHash = M.hashParams(state.params);
    const snapshot = {
      version: 1,
      params: { ...state.params },
      savedAt: new Date().toISOString(),
      latencyMs: audio.latencyMs,
      fingerprint: state.lastExport && state.lastExport.paramsHash === paramsHash
        ? state.lastExport.fingerprint
        : null
    };
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(snapshot));
    } catch (error) {
      if (!quiet) {
        refs.exportReport.textContent = `参数快照无法写入本地存储：${error.message}`;
        refs.exportReport.className = "export-report error";
      }
    }
    state.savedPreset = snapshot;
    refs.presetState.textContent = presetTimestamp(snapshot.savedAt);
    refs.loadBtn.disabled = false;
    return snapshot;
  }

  function loadPreset(quiet) {
    let snapshot = state.savedPreset;
    if (snapshot === null) {
      try {
        snapshot = JSON.parse(localStorage.getItem(PRESET_KEY) || "null");
      } catch (error) {
        snapshot = null;
      }
    }
    if (!snapshot || !snapshot.params) {
      if (!quiet) {
        refs.exportReport.textContent = "没有可载入的参数快照";
        refs.exportReport.className = "export-report error";
      }
      return null;
    }
    state.savedPreset = snapshot;
    setControls(snapshot.params);
    applyParams(snapshot.params, "load");
    state.scene = M.acousticsAt(state.params, state.trainX);
    updateSceneReadouts();
    refs.presetState.textContent = `已载入 ${presetTimestamp(snapshot.savedAt).replace("已保存 ", "")}`;
    refs.loadBtn.disabled = false;
    if (!quiet) {
      refs.exportReport.textContent = `参数已重新载入 · ${M.hashParams(state.params)}\n可再次导出并比较时长与关键峰值。`;
      refs.exportReport.className = "export-report ok";
    }
    return snapshot;
  }

  function setCheck(name, status) {
    const element = refs.exportChecks.querySelector(`[data-check="${name}"]`);
    if (!element) return;
    element.classList.remove("pass", "fail", "run");
    if (status) element.classList.add(status);
  }

  function setAllChecks(status) {
    ["silence", "clip", "channel", "duration"].forEach((name) => setCheck(name, status));
  }

  function setControlsBusy(busy) {
    state.busy = busy;
    [refs.exportBtn, refs.verifyBtn, refs.probeBtn, refs.saveBtn, refs.loadBtn].forEach((button) => {
      button.disabled = busy;
    });
  }

  function fingerprintFromAnalysis(analysis, params) {
    return {
      duration: analysis.duration,
      keyPitchHz: analysis.keyPitchHz,
      peakDb: analysis.peakDb,
      peakLDb: analysis.peakLDb,
      peakRDb: analysis.peakRDb,
      latencyMs: audio.latencyMs || (state.savedPreset && state.savedPreset.latencyMs) || 0,
      checks: analysis.checks,
      sampleRate: analysis.sampleRate,
      channels: analysis.channels,
      paramsHash: M.hashParams(params)
    };
  }

  function downloadWav(wav, suffix) {
    const p = state.params;
    const hash = M.hashParams(p).replace(/:/g, "-");
    const name = `doppler-rail_${hash}${suffix || ""}.wav`;
    const blob = new Blob([wav.buffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return name;
  }

  function renderExportReport(analysis, fileName) {
    const lines = [
      `PASS · ${analysis.duration.toFixed(3)}s / ${analysis.channels}ch / ${(analysis.sampleRate / 1000).toFixed(1)}kHz`,
      `峰值 ${analysis.peakDb.toFixed(2)} dBFS · L ${analysis.peakLDb.toFixed(1)} / R ${analysis.peakRDb.toFixed(1)} dB`,
      `关键音高 ${analysis.keyPitchHz.toFixed(1)} Hz · 声道 ${analysis.rmsLDb.toFixed(1)} / ${analysis.rmsRDb.toFixed(1)} dB`
    ];
    if (fileName) lines.push(`文件 ${fileName}`);
    refs.exportReport.textContent = lines.join("\n");
    refs.exportReport.className = "export-report ok";
  }

  async function renderCheckedExport(options) {
    const config = options || {};
    if (!audio.ctx) await audio.init();
    setAllChecks("run");
    refs.exportReport.textContent = "离线渲染中 · 正在检查静音 / 削波 / 声道 / 时长…";
    refs.exportReport.className = "export-report";
    const buffer = await O.renderScene(state.params, { duration: M.EXPORT_SECONDS });
    const analysis = O.analyzeBuffer(buffer, state.params);
    setCheck("silence", analysis.checks.silence ? "pass" : "fail");
    setCheck("clip", analysis.checks.clip ? "pass" : "fail");
    setCheck("channel", analysis.checks.channel ? "pass" : "fail");
    setCheck("duration", analysis.checks.duration ? "pass" : "fail");

    if (!Object.values(analysis.checks).every(Boolean)) {
      const failures = [];
      if (!analysis.checks.silence) failures.push("静音");
      if (!analysis.checks.clip) failures.push("削波");
      if (!analysis.checks.channel) failures.push("声道缺失/非立体声");
      if (!analysis.checks.duration) failures.push("时长偏差");
      refs.exportReport.textContent = `FAIL · 导出已阻止：${failures.join("、")}`;
      refs.exportReport.className = "export-report error";
      return { ok: false, buffer, analysis, fingerprint: fingerprintFromAnalysis(analysis, state.params) };
    }

    const wav = O.audioBufferToWav(buffer);
    let fileName = "";
    if (config.download) fileName = downloadWav(wav, config.suffix || "");
    const fingerprint = fingerprintFromAnalysis(analysis, state.params);
    renderExportReport(analysis, fileName);
    return { ok: true, buffer, wav, analysis, fingerprint };
  }

  async function exportCurrent() {
    if (state.busy) return;
    setControlsBusy(true);
    try {
      const result = await renderCheckedExport({ download: true });
      if (result.ok) {
        state.lastExport = {
          fingerprint: result.fingerprint,
          params: { ...state.params },
          paramsHash: M.hashParams(state.params),
          exportedAt: new Date().toISOString()
        };
        persistPreset(true);
      }
    } catch (error) {
      refs.exportReport.textContent = `导出失败：${error.message}`;
      refs.exportReport.className = "export-report error";
      setAllChecks("fail");
    } finally {
      setControlsBusy(false);
    }
  }

  async function verifyReloadConsistency() {
    if (state.busy) return;
    setControlsBusy(true);
    try {
      if (!state.savedPreset) persistPreset(true);
      const snapshot = loadPreset(true);
      if (!snapshot) throw new Error("没有可用的参数快照");
      const hash = M.hashParams(snapshot.params);
      let baseline = state.lastExport && state.lastExport.paramsHash === hash
        ? state.lastExport.fingerprint
        : null;
      if (!baseline) {
        const first = await renderCheckedExport({ download: false });
        if (!first.ok) return;
        baseline = first.fingerprint;
      }

      loadPreset(true);
      const second = await renderCheckedExport({ download: true, suffix: "_reload" });
      if (!second.ok) return;
      const comparison = O.compareFingerprints(baseline, second.fingerprint);
      const lines = [
        `${comparison.consistent ? "PASS" : "FAIL"} · 参数保存 → 重载 → 再次导出`,
        ...comparison.rows.map((row) => {
          const mark = row.pass ? "✓" : "✕";
          return `${mark} ${row.label}  ${row.first}  /  ${row.second}`;
        })
      ];
      refs.exportReport.textContent = lines.join("\n");
      refs.exportReport.className = `export-report ${comparison.consistent ? "ok" : "error"}`;
      state.lastExport = {
        fingerprint: second.fingerprint,
        params: { ...state.params },
        paramsHash: M.hashParams(state.params),
        exportedAt: new Date().toISOString(),
        comparison
      };
      persistPreset(true);
    } catch (error) {
      refs.exportReport.textContent = `一致性复验失败：${error.message}`;
      refs.exportReport.className = "export-report error";
      setAllChecks("fail");
    } finally {
      setControlsBusy(false);
    }
  }

  async function runAcousticProbes() {
    if (state.busy) return;
    setControlsBusy(true);
    refs.probeBtn.textContent = "运行中";
    const rows = {
      stereo: document.querySelector('[data-probe="stereo"]'),
      spectrum: document.querySelector('[data-probe="spectrum"]'),
      beat: document.querySelector('[data-probe="beat"]')
    };
    Object.values(rows).forEach((row) => {
      row.className = "probe-row run";
      row.querySelector("b").textContent = "渲染 PCM…";
    });
    try {
      const result = await O.runAcousticProbes(state.params);
      Object.keys(rows).forEach((key) => {
        const row = rows[key];
        const pass = result[key].pass;
        row.className = `probe-row ${pass ? "pass" : "fail"}`;
        row.querySelector("b").textContent = result[key].detail;
      });
    } catch (error) {
      Object.values(rows).forEach((row) => {
        row.className = "probe-row fail";
        row.querySelector("b").textContent = "校验失败";
      });
      refs.exportReport.textContent = `声学校验失败：${error.message}`;
      refs.exportReport.className = "export-report error";
    } finally {
      refs.probeBtn.textContent = "运行";
      setControlsBusy(false);
    }
  }

  refs.saveBtn.addEventListener("click", () => {
    const snapshot = persistPreset(false);
    refs.exportReport.textContent = `参数快照已保存 · ${M.hashParams(snapshot.params)}\n${presetTimestamp(snapshot.savedAt)}`;
    refs.exportReport.className = "export-report ok";
  });
  refs.loadBtn.addEventListener("click", () => loadPreset(false));
  refs.exportBtn.addEventListener("click", exportCurrent);
  refs.verifyBtn.addEventListener("click", verifyReloadConsistency);
  refs.probeBtn.addEventListener("click", runAcousticProbes);

  function restorePresetIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) || "null");
      if (!parsed || !parsed.params) return;
      state.savedPreset = parsed;
      refs.presetState.textContent = presetTimestamp(parsed.savedAt);
      refs.loadBtn.disabled = false;
    } catch (error) {
      state.savedPreset = null;
    }
  }

  setControls(state.params);
  restorePresetIndex();
  refs.loadBtn.disabled = !state.savedPreset;
  updateTransportUI();
  updateSceneReadouts();
  refs.sampleRateLabel.textContent = "44.1 kHz";
  refs.exportReport.textContent = "等待首次导出检查";
  requestAnimationFrame(animationLoop);
})();
