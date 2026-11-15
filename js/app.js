(function () {
  "use strict";

  const { config, utils, AudioEngine, audio } = window.Echo;
  const {
    clamp,
    approach,
    getActiveSources,
    fieldAt,
    measureAt,
    resolveCollision,
    nearestHotspot,
    exportDuration,
    formatDb,
    formatSigned,
    balanceLabel,
    heatRgb
  } = utils;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const dom = {
    canvas: $("#fieldCanvas"),
    mapFrame: $("#mapFrame"),
    cursorTip: $("#cursorTip"),
    startOverlay: $("#startOverlay"),
    startButton: $("#startButton"),
    helpButton: $("#helpButton"),
    helpDialog: $("#helpDialog"),
    audioStatus: $("#audioStatus"),
    sessionClock: $("#sessionClock"),
    activeSources: $("#activeSources"),
    peakReadout: $("#peakReadout"),
    clipBadge: $("#clipBadge"),
    splMeter: $("#splMeter"),
    leftChannel: $("#leftChannel"),
    rightChannel: $("#rightChannel"),
    leftBar: $("#leftBar"),
    rightBar: $("#rightBar"),
    toneValue: $("#toneValue"),
    balanceValue: $("#balanceValue"),
    delayValue: $("#delayValue"),
    peakValue: $("#peakValue"),
    positionReadout: $("#positionReadout"),
    localPressure: $("#localPressure"),
    missionCount: $("#missionCount"),
    objectiveProgress: $("#objectiveProgress"),
    hotspotList: $("#hotspotList"),
    hotspotRows: $$(".hotspot-row"),
    sourceGrid: $("#sourceGrid"),
    gateTimeline: $("#gateTimeline"),
    nearestHint: $("#nearestHint"),
    measureButton: $("#measureButton"),
    pauseButton: $("#pauseButton"),
    replayButton: $("#replayButton"),
    resetButton: $("#resetButton"),
    lastExportLabel: $("#lastExportLabel"),
    lastExportMeta: $("#lastExportMeta"),
    presetButton: $("#presetButton"),
    presetDialog: $("#presetDialog"),
    presetSummary: $("#presetSummary"),
    savePresetButton: $("#savePresetButton"),
    loadPresetButton: $("#loadPresetButton"),
    exportButton: $("#exportButton"),
    exportDialog: $("#exportDialog"),
    checkList: $("#checkList"),
    exportPreview: $("#exportPreview"),
    consistencyCheck: $("#consistencyCheck"),
    rerunCheckButton: $("#rerunCheckButton"),
    confirmExportButton: $("#confirmExportButton"),
    toastStack: $("#toastStack")
  };

  const controls = {
    frequency: { input: $("#frequencyControl"), output: $("#frequencyOutput") },
    balance: { input: $("#balanceControl"), output: $("#balanceOutput") },
    delay: { input: $("#delayControl"), output: $("#delayOutput") },
    gain: { input: $("#gainControl"), output: $("#gainOutput") },
    tempo: { input: $("#tempoControl"), output: $("#tempoOutput") }
  };

  const PRESET_KEY = "echo-block-acoustic-preset-v1";
  const state = {
    started: false,
    paused: false,
    complete: false,
    elapsed: 0,
    lastFrame: performance.now(),
    lastTelemetryAt: 0,
    lastAcousticAt: 0,
    params: { ...config.DEFAULT_PARAMS },
    listener: { ...config.START },
    target: null,
    keys: new Set(),
    samples: [],
    measurementRings: [],
    found: [false, false, false],
    near: [false, false, false],
    sourceStates: new Array(config.SOURCES.length).fill(false),
    lastStatesKey: "",
    smoothedDb: 58,
    heldPeak: 58,
    heldPeakUntil: 0,
    leftLevel: -60,
    rightLevel: -60,
    lastClipToastAt: -10,
    lastOfflineToastAt: -10,
    engine: new AudioEngine(),
    pendingExport: null,
    lastExport: null,
    activePreset: null,
    presetLoaded: false,
    checking: false,
    view: { scale: 1, offsetX: 0, offsetY: 0, width: 1000, height: 640, dpr: 1 },
    heatCanvas: document.createElement("canvas"),
    lastHeatAt: 0,
    startWall: performance.now()
  };
  state.heatCanvas.width = 125;
  state.heatCanvas.height = 80;

  function setupStaticUi() {
    dom.splMeter.insertAdjacentHTML("afterbegin", '<span class="meter-track"><em></em></span>');
    config.SOURCES.forEach((source, index) => {
      const item = document.createElement("div");
      item.className = "source-item";
      item.dataset.source = index;
      item.innerHTML = `<i></i><b>${source.id} ${source.label}</b><span>OFF</span>`;
      dom.sourceGrid.appendChild(item);

      const gate = document.createElement("div");
      gate.className = "timeline-gate";
      gate.dataset.source = index;
      gate.innerHTML = `<b>${source.id}</b>`;
      dom.gateTimeline.appendChild(gate);
    });
    rebuildGateTimeline();
    syncControls();
    updatePresetSummary();
  }

  function rebuildGateTimeline() {
    const windowSeconds = 10;
    config.SOURCES.forEach((source, sourceIndex) => {
      const gate = dom.gateTimeline.querySelector(`[data-source="${sourceIndex}"]`);
      gate.querySelectorAll("span").forEach((span) => span.remove());
      for (let cycleStart = -source.period; cycleStart < windowSeconds + source.period; cycleStart += source.period) {
        const onStart = cycleStart + source.on - (source.offset % source.period);
        const start = Math.max(0, onStart);
        const end = Math.min(windowSeconds, onStart + source.on);
        if (end <= start) continue;
        const span = document.createElement("span");
        span.style.left = `${start / windowSeconds * 100}%`;
        span.style.width = `${(end - start) / windowSeconds * 100}%`;
        gate.appendChild(span);
      }
    });
  }

  function syncControls() {
    Object.entries(controls).forEach(([key, control]) => {
      control.input.value = state.params[key];
      updateControlVisual(key);
    });
  }

  function updateControlVisual(key) {
    const control = controls[key];
    const value = Number(control.input.value);
    const min = Number(control.input.min);
    const max = Number(control.input.max);
    control.input.style.setProperty("--fill", `${(value - min) / (max - min) * 100}%`);
    if (key === "frequency") control.output.textContent = `${value} Hz`;
    if (key === "balance") control.output.textContent = balanceLabel(value);
    if (key === "delay") control.output.textContent = `${value} ms`;
    if (key === "gain") control.output.textContent = `${value} dB`;
    if (key === "tempo") control.output.textContent = `${value} BPM`;
  }

  function readParamsFromControls() {
    Object.entries(controls).forEach(([key, control]) => {
      state.params[key] = Number(control.input.value);
    });
    return { ...state.params };
  }

  function updateParam(key) {
    updateControlVisual(key);
    const params = readParamsFromControls();
    state.presetLoaded = false;
    state.engine.applyParams(params, 0.2);
    dom.toneValue.textContent = `${Math.round(params.frequency)}`;
    dom.balanceValue.textContent = balanceLabel(params.balance);
    dom.delayValue.textContent = `${params.delay}`;
    if (key === "tempo") {
      rebuildGateTimeline();
    }
    if (key === "gain") {
      state.heldPeakUntil = 0;
    }
    if (state.started) {
      dom.audioStatus.classList.add("is-live");
      dom.audioStatus.querySelector("span").textContent = "参数收敛中";
    }
    window.clearTimeout(updateParam._timer);
    updateParam._timer = window.setTimeout(() => {
      if (state.started && !state.paused) dom.audioStatus.querySelector("span").textContent = "实时合成";
    }, 260);
  }

  async function startSession() {
    try {
      await state.engine.start(state.params);
      state.engine.onBeat = () => recordMeasurement();
      state.started = true;
      state.paused = false;
      state.startWall = performance.now() - state.elapsed * 1000;
      state.lastStatesKey = "";
      dom.startOverlay.classList.add("is-hidden");
      dom.audioStatus.classList.add("is-live");
      dom.audioStatus.querySelector("span").textContent = "实时合成";
      setPauseButton(false);
      toast("监听已启动。六源门控与测量节拍正在实时合成。");
    } catch (error) {
      toast(`无法启动音频：${error.message}`, "error");
    }
  }

  async function togglePause() {
    if (!state.started) {
      await startSession();
      return;
    }
    state.paused = !state.paused;
    await state.engine.setPaused(state.paused);
    setPauseButton(state.paused);
    dom.audioStatus.classList.toggle("is-live", !state.paused);
    dom.audioStatus.querySelector("span").textContent = state.paused ? "监听已暂停" : "实时合成";
  }

  function setPauseButton(paused) {
    dom.pauseButton.classList.toggle("is-paused", paused);
    dom.pauseButton.innerHTML = paused
      ? '<i class="play-symbol"></i><span>继续</span>'
      : '<i class="pause-symbol"></i><span>暂停</span>';
  }

  async function replaySession() {
    state.elapsed = 0;
    state.samples = [];
    state.measurementRings = [];
    state.found = [false, false, false];
    state.near = [false, false, false];
    state.complete = false;
    state.target = null;
    state.listener = { ...config.START };
    state.heldPeak = 58;
    state.heldPeakUntil = 0;
    state.startWall = performance.now();
    state.engine.restart();
    state.lastStatesKey = "";
    if (state.paused) {
      state.paused = false;
      await state.engine.setPaused(false);
      setPauseButton(false);
    }
    document.querySelector(".completion-banner")?.remove();
    updateHotspotUi();
    dom.missionCount.classList.remove("is-complete");
    dom.audioStatus.querySelector("span").textContent = state.started ? "实时合成" : "音频待机";
    toast("勘测轨迹已清空，声源周期从头重播。");
  }

  function resetParams() {
    state.params = { ...config.DEFAULT_PARAMS };
    state.presetLoaded = false;
    syncControls();
    state.engine.applyParams(state.params, 0.2);
    dom.toneValue.textContent = `${state.params.frequency}`;
    dom.balanceValue.textContent = balanceLabel(state.params.balance);
    dom.delayValue.textContent = `${state.params.delay}`;
    rebuildGateTimeline();
    toast("声场参数已重置为默认值。");
  }

  function recordMeasurement(manual = false) {
    if (!state.started || state.paused) {
      if (manual) toast("请先启动监听，再发射测量脉冲。", "warn");
      return null;
    }
    const sample = measureAt(state.listener.x, state.listener.y, state.elapsed, state.params);
    sample.id = `${Date.now()}-${state.samples.length}-${Math.round(sample.x)}`;
    sample.manual = manual;
    sample.wallTime = performance.now();
    state.samples.push(sample);
    if (state.samples.length > 160) state.samples.shift();
    state.measurementRings.push({
      x: sample.x,
      y: sample.y,
      startedAt: performance.now(),
      valid: sample.valid,
      clipped: sample.clipped
    });
    if (state.measurementRings.length > 12) state.measurementRings.shift();

    if (sample.valid) {
      let newlyFound = false;
      config.HOTSPOTS.forEach((hotspot, index) => {
        if (state.found[index]) return;
        const distance = Math.hypot(sample.x - hotspot.x, sample.y - hotspot.y);
        if (distance <= hotspot.detectRadius && sample.reflection > 0.09 && sample.db >= 64) {
          state.found[index] = true;
          newlyFound = true;
          toast(`热点锁定：${hotspot.name} / ${formatDb(sample.db)} dB SPL`);
        }
      });
      if (newlyFound) {
        updateHotspotUi();
        if (state.found.every(Boolean) && !state.complete) completeSurvey();
      }
    } else {
      const now = state.elapsed;
      if (sample.reason === "clipped" && now - state.lastClipToastAt > 4) {
        state.lastClipToastAt = now;
        toast("读数削波：设备增益过高，样本已作废。请降低增益。", "error");
      }
      if (sample.reason === "sources-off" && now - state.lastOfflineToastAt > 5) {
        state.lastOfflineToastAt = now;
        toast("当前六个声源均关闭，等待门控周期重新开启。", "warn");
      }
    }
    return sample;
  }

  function completeSurvey() {
    state.complete = true;
    dom.missionCount.classList.add("is-complete");
    const banner = document.createElement("div");
    banner.className = "completion-banner";
    banner.innerHTML = `
      <span>SURVEY COMPLETE</span>
      <b>三处反射热点全部锁定</b>
      <small>保存参数并导出 WAV，可复核声场一致性。</small>
      <button type="button">查看导出校验</button>`;
    banner.querySelector("button").addEventListener("click", openExportCheck);
    dom.mapFrame.appendChild(banner);
    toast("勘测完成：三处局部声压增强均已确认。");
  }

  function updateHotspotUi() {
    const foundCount = state.found.filter(Boolean).length;
    dom.missionCount.textContent = `${foundCount} / 3`;
    dom.objectiveProgress.style.width = `${foundCount / 3 * 100}%`;
    dom.hotspotRows.forEach((row, index) => {
      row.classList.toggle("is-found", state.found[index]);
      row.classList.toggle("is-near", !state.found[index] && state.near[index]);
      const stateLabel = row.querySelector(".hotspot-state");
      if (state.found[index]) stateLabel.textContent = "已锁定";
      else if (state.near[index]) stateLabel.textContent = "信号增强";
      else stateLabel.textContent = "未锁定";
    });
  }

  function updateMovement(dt) {
    let dx = 0;
    let dy = 0;
    if (state.keys.has("KeyW") || state.keys.has("ArrowUp")) dy -= 1;
    if (state.keys.has("KeyS") || state.keys.has("ArrowDown")) dy += 1;
    if (state.keys.has("KeyA") || state.keys.has("ArrowLeft")) dx -= 1;
    if (state.keys.has("KeyD") || state.keys.has("ArrowRight")) dx += 1;
    if (dx || dy) {
      state.target = null;
      const length = Math.hypot(dx, dy);
      const speed = 138;
      dx = dx / length * speed * dt;
      dy = dy / length * speed * dt;
      moveListener(state.listener.x + dx, state.listener.y + dy);
      return;
    }
    if (state.target) {
      const targetDx = state.target.x - state.listener.x;
      const targetDy = state.target.y - state.listener.y;
      const distance = Math.hypot(targetDx, targetDy);
      if (distance < 4) {
        state.target = null;
        return;
      }
      const speed = Math.min(distance, 152 * dt);
      moveListener(
        state.listener.x + targetDx / distance * speed,
        state.listener.y + targetDy / distance * speed
      );
    }
  }

  function moveListener(x, y) {
    const next = resolveCollision(x, y, 11);
    const moved = Math.abs(next.x - state.listener.x) + Math.abs(next.y - state.listener.y);
    state.listener.x = next.x;
    state.listener.y = next.y;
    if (moved > 0.2) state.engine.updateListener(state.listener);
  }

  function updateGameState(dt) {
    if (state.started && !state.paused) state.elapsed += dt;
    updateMovement(dt);
    const states = getActiveSources(state.elapsed);
    state.sourceStates = states;
    const statesKey = states.map(Number).join("");
    if (statesKey !== state.lastStatesKey) {
      state.lastStatesKey = statesKey;
      state.engine.setSourceStates(states);
      updateSourceUi();
    }

    config.HOTSPOTS.forEach((hotspot, index) => {
      const distance = Math.hypot(state.listener.x - hotspot.x, state.listener.y - hotspot.y);
      state.near[index] = !state.found[index] && distance < 104;
    });
    if (Math.floor(state.elapsed * 2) !== Math.floor((state.elapsed - dt) * 2)) updateHotspotUi();
    updateHint();
  }

  function updateSourceUi() {
    const activeCount = state.sourceStates.filter(Boolean).length;
    dom.activeSources.textContent = `${activeCount} / 6`;
    dom.sourceGrid.querySelectorAll(".source-item").forEach((item, index) => {
      const on = state.sourceStates[index];
      item.classList.toggle("is-on", on);
      item.querySelector("span").textContent = on ? "ON" : "OFF";
    });
  }

  function updateHint() {
    if (state.complete) {
      dom.nearestHint.textContent = "勘测完成。参数存档后可重载并再次导出一致性样本。";
      return;
    }
    const nearest = nearestHotspot(state.listener.x, state.listener.y);
    const index = config.HOTSPOTS.indexOf(nearest.hotspot);
    if (state.found[index]) {
      dom.nearestHint.textContent = `${nearest.hotspot.name} 已锁定。继续寻找其余反射增强区。`;
      return;
    }
    const distanceMeters = Math.round(nearest.distance * 0.82);
    const sourceNames = nearest.hotspot.sources.map((sourceIndex) => config.SOURCES[sourceIndex].id).join(" / ");
    const anyActive = nearest.hotspot.sources.some((sourceIndex) => state.sourceStates[sourceIndex]);
    dom.nearestHint.textContent = `最近反射信号：${nearest.hotspot.hint} · 约 ${distanceMeters} m。${anyActive ? `${sourceNames} 正在供声。` : `等待 ${sourceNames} 开启。`}`;
  }

  function updateReadouts(field, now) {
    const targetDb = field.db;
    state.smoothedDb = approach(state.smoothedDb, targetDb, 18, 1 / 60);
    if (targetDb >= state.heldPeak || now > state.heldPeakUntil) {
      state.heldPeak = targetDb >= state.heldPeak ? targetDb : Math.max(targetDb, state.heldPeak - 0.12);
      state.heldPeakUntil = targetDb >= state.heldPeak ? now + 1100 : state.heldPeakUntil;
    }
    const readoutDb = Math.round(state.smoothedDb * 10) / 10;
    dom.peakReadout.textContent = readoutDb.toFixed(1);
    dom.peakValue.textContent = readoutDb.toFixed(1);
    dom.localPressure.textContent = `${formatDb(field.db)} dB SPL`;
    const clipping = field.db >= config.CLIP_DB;
    dom.clipBadge.textContent = clipping ? "CLIP / 失真" : "CLEAN";
    dom.clipBadge.classList.toggle("is-clipping", clipping);
    const meterLevel = clamp((state.smoothedDb - 40) / 80, 0, 1);
    const meterFill = dom.splMeter.querySelector(".meter-track em");
    if (meterFill) meterFill.style.width = `${meterLevel * 100}%`;
    dom.positionReadout.textContent = `X ${Math.round(state.listener.x)} / Y ${Math.round(state.listener.y)}`;
  }

  function updateTelemetry(now) {
    if (now - state.lastTelemetryAt < 90) return;
    state.lastTelemetryAt = now;
    const telemetry = state.engine.getTelemetry();
    if (!telemetry) return;
    const leftNormalized = clamp((telemetry.leftDb + 62) / 62, 0, 1);
    const rightNormalized = clamp((telemetry.rightDb + 62) / 62, 0, 1);
    state.leftLevel = approach(state.leftLevel, leftNormalized * 100, 9, 0.09);
    state.rightLevel = approach(state.rightLevel, rightNormalized * 100, 9, 0.09);
    dom.leftChannel.textContent = `${telemetry.leftDb.toFixed(1)} dB`;
    dom.rightChannel.textContent = `${telemetry.rightDb.toFixed(1)} dB`;
    dom.leftBar.style.width = `${state.leftLevel}%`;
    dom.rightBar.style.width = `${state.rightLevel}%`;
    const actual = telemetry.actual;
    dom.toneValue.textContent = `${actual.pitch.toFixed(1)}`;
    dom.balanceValue.textContent = balanceLabel(actual.balance);
    dom.delayValue.textContent = `${actual.delayMs.toFixed(0)}`;
  }

  function resizeCanvas() {
    const rect = dom.mapFrame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (dom.canvas.width !== width || dom.canvas.height !== height) {
      dom.canvas.width = width;
      dom.canvas.height = height;
    }
    const scale = Math.min(rect.width / config.WORLD.width, rect.height / config.WORLD.height);
    state.view = {
      scale,
      offsetX: (rect.width - config.WORLD.width * scale) / 2,
      offsetY: (rect.height - config.WORLD.height * scale) / 2,
      width: rect.width,
      height: rect.height,
      dpr
    };
  }

  function buildHeatImage(time) {
    const heat = state.heatCanvas;
    const context = heat.getContext("2d");
    const image = context.createImageData(heat.width, heat.height);
    const data = image.data;
    for (let y = 0; y < heat.height; y += 1) {
      for (let x = 0; x < heat.width; x += 1) {
        const worldX = (x + 0.5) / heat.width * config.WORLD.width;
        const worldY = (y + 0.5) / heat.height * config.WORLD.height;
        const field = fieldAt(worldX, worldY, time, state.params);
        const normalized = clamp((field.db - 48) / 44, 0, 1);
        const rgb = heatRgb(normalized);
        const offset = (y * heat.width + x) * 4;
        data[offset] = rgb[0];
        data[offset + 1] = rgb[1];
        data[offset + 2] = rgb[2];
        data[offset + 3] = 18 + normalized * 157;
      }
    }
    context.putImageData(image, 0, 0);
    state.lastHeatAt = time;
  }

  function drawScene(now) {
    resizeCanvas();
    const context = dom.canvas.getContext("2d");
    const { dpr, scale, offsetX, offsetY, width, height } = state.view;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#050d11";
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);
    context.beginPath();
    context.rect(0, 0, config.WORLD.width, config.WORLD.height);
    context.clip();

    drawGround(context, now);
    drawRoadNetwork(context);
    if (now - state.lastHeatAt > 130) buildHeatImage(state.elapsed);
    context.globalAlpha = 0.68;
    context.imageSmoothingEnabled = true;
    context.drawImage(state.heatCanvas, 0, 0, config.WORLD.width, config.WORLD.height);
    context.globalAlpha = 1;
    drawBuildings(context);
    drawReflectionRings(context, now);
    drawSamples(context, now);
    drawSources(context, now);
    drawHotspots(context, now);
    drawListener(context, now);
    drawWorldFurniture(context);
    context.restore();
  }

  function drawGround(context, now) {
    const gradient = context.createRadialGradient(490, 315, 60, 490, 315, 680);
    gradient.addColorStop(0, "#10272b");
    gradient.addColorStop(0.66, "#0a1a1f");
    gradient.addColorStop(1, "#060f13");
    context.fillStyle = gradient;
    context.fillRect(0, 0, config.WORLD.width, config.WORLD.height);

    context.strokeStyle = "rgba(128, 182, 176, 0.055)";
    context.lineWidth = 0.7;
    for (let x = 0; x <= config.WORLD.width; x += 25) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, config.WORLD.height);
      context.stroke();
    }
    for (let y = 0; y <= config.WORLD.height; y += 25) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(config.WORLD.width, y);
      context.stroke();
    }

    const scanY = (now * 0.028) % config.WORLD.height;
    const scan = context.createLinearGradient(0, scanY - 34, 0, scanY + 34);
    scan.addColorStop(0, "rgba(143,255,213,0)");
    scan.addColorStop(0.5, "rgba(143,255,213,0.025)");
    scan.addColorStop(1, "rgba(143,255,213,0)");
    context.fillStyle = scan;
    context.fillRect(0, scanY - 34, config.WORLD.width, 68);
  }

  function drawRoadNetwork(context) {
    context.save();
    context.lineCap = "square";
    context.strokeStyle = "#0a171b";
    context.lineWidth = 108;
    context.beginPath();
    context.moveTo(0, 262);
    context.lineTo(1000, 262);
    context.moveTo(292, 0);
    context.lineTo(292, 640);
    context.moveTo(619, 0);
    context.lineTo(619, 640);
    context.moveTo(907, 0);
    context.lineTo(907, 640);
    context.moveTo(0, 570);
    context.lineTo(1000, 570);
    context.stroke();

    context.strokeStyle = "rgba(164, 203, 194, 0.08)";
    context.lineWidth = 1;
    context.stroke();
    context.strokeStyle = "rgba(164, 203, 194, 0.13)";
    context.lineWidth = 0.7;
    context.setLineDash([10, 15]);
    context.beginPath();
    context.moveTo(0, 262);
    context.lineTo(1000, 262);
    context.moveTo(292, 0);
    context.lineTo(292, 640);
    context.moveTo(619, 0);
    context.lineTo(619, 640);
    context.moveTo(907, 0);
    context.lineTo(907, 640);
    context.moveTo(0, 570);
    context.lineTo(1000, 570);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = "rgba(119, 163, 156, 0.36)";
    context.font = "600 6px monospace";
    context.letterSpacing = "1px";
    context.fillText("SERVICE ROAD / NORTH", 36, 238);
    context.fillText("REFLECTOR LANE", 602, 350);
    context.fillText("SOUTH ACCESS", 410, 596);
    context.restore();
  }

  function drawBuildings(context) {
    config.BUILDINGS.forEach((building, index) => {
      context.save();
      context.shadowColor = "rgba(0, 0, 0, 0.55)";
      context.shadowBlur = 20;
      context.shadowOffsetY = 10;
      const gradient = context.createLinearGradient(building.x, building.y, building.x + building.w, building.y + building.h);
      gradient.addColorStop(0, index % 2 ? "#11272c" : "#102329");
      gradient.addColorStop(1, index % 2 ? "#0a1a1f" : "#0b1c21");
      context.fillStyle = gradient;
      context.fillRect(building.x, building.y, building.w, building.h);
      context.restore();
      context.strokeStyle = "rgba(150, 210, 195, 0.18)";
      context.lineWidth = 1;
      context.strokeRect(building.x + 0.5, building.y + 0.5, building.w - 1, building.h - 1);
      context.strokeStyle = "rgba(150, 210, 195, 0.055)";
      context.strokeRect(building.x - 6, building.y - 6, building.w + 12, building.h + 12);

      const roofGradient = context.createLinearGradient(building.x, building.y, building.x, building.y + 28);
      roofGradient.addColorStop(0, "rgba(151, 214, 197, 0.11)");
      roofGradient.addColorStop(1, "rgba(151, 214, 197, 0)");
      context.fillStyle = roofGradient;
      context.fillRect(building.x, building.y, building.w, 28);

      context.strokeStyle = "rgba(134, 185, 174, 0.075)";
      context.lineWidth = 0.55;
      for (let y = building.y + 15; y < building.y + building.h - 10; y += 17) {
        context.beginPath();
        context.moveTo(building.x + 12, y);
        context.lineTo(building.x + building.w - 12, y);
        context.stroke();
      }

      const windowCount = Math.max(2, Math.floor(building.w / 42));
      for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
        const x = building.x + 18 + windowIndex * ((building.w - 36) / windowCount);
        context.fillStyle = (windowIndex + index) % 4 === 0
          ? "rgba(255, 189, 104, 0.42)"
          : "rgba(126, 220, 198, 0.16)";
        context.fillRect(x, building.y + building.h - 35, 11, 3);
      }

      context.fillStyle = "rgba(212, 232, 225, 0.62)";
      context.font = "600 9px monospace";
      context.fillText(`${building.id} / ${building.label}`, building.x + 14, building.y + 22);
      context.fillStyle = "rgba(141, 180, 171, 0.34)";
      context.font = "500 6px monospace";
      context.fillText(building.sub, building.x + 14, building.y + 33);
    });
  }

  function drawReflectionRings(context, now) {
    config.HOTSPOTS.forEach((hotspot, index) => {
      if (!state.found[index] && !state.near[index]) return;
      const sourceActive = hotspot.sources.some((sourceIndex) => state.sourceStates[sourceIndex]);
      const alpha = state.found[index] ? 0.68 : sourceActive ? 0.3 : 0.14;
      context.save();
      context.translate(hotspot.x, hotspot.y);
      context.strokeStyle = hotspot.tone;
      context.globalAlpha = alpha;
      context.lineWidth = 0.8;
      for (let ring = 0; ring < 3; ring += 1) {
        const pulse = (now * 0.00035 + ring / 3 + index * 0.17) % 1;
        context.beginPath();
        context.arc(0, 0, hotspot.radius * (0.62 + pulse * 0.7), -1.28, 1.28);
        context.stroke();
      }
      context.setLineDash([3, 7]);
      context.beginPath();
      context.arc(0, 0, hotspot.detectRadius, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      context.restore();
    });
  }

  function drawSamples(context, now) {
    context.save();
    state.samples.forEach((sample, index) => {
      const age = Math.min(1, (now - (sample.wallTime || now)) / 16000);
      const older = state.samples.length - index;
      const alpha = Math.max(0.08, 0.65 - older / 180 - age * 0.25);
      context.fillStyle = sample.valid ? `rgba(157, 255, 222, ${alpha})` : `rgba(255, 109, 89, ${alpha})`;
      context.beginPath();
      context.arc(sample.x, sample.y, sample.manual ? 3.1 : 2.1, 0, Math.PI * 2);
      context.fill();
      if (sample.manual) {
        context.strokeStyle = sample.valid ? "rgba(157, 255, 222, 0.32)" : "rgba(255, 109, 89, 0.32)";
        context.lineWidth = 0.7;
        context.beginPath();
        context.arc(sample.x, sample.y, 8, 0, Math.PI * 2);
        context.stroke();
      }
    });
    context.restore();
  }

  function drawSources(context, now) {
    config.SOURCES.forEach((source, index) => {
      const on = state.sourceStates[index];
      const phase = (state.elapsed + source.offset) % source.period;
      const level = on ? 1 : 0.22;
      const color = on ? (index === 3 ? "#ffbd68" : "#8fffd5") : "#58716d";
      context.save();
      context.translate(source.x, source.y);
      context.globalAlpha = level;
      context.strokeStyle = color;
      context.fillStyle = "rgba(5, 14, 17, 0.88)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(0, 0, 13, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      if (on) {
        for (let ring = 0; ring < 3; ring += 1) {
          const pulse = (phase * 0.45 + ring / 3) % 1;
          context.globalAlpha = (1 - pulse) * 0.26;
          context.beginPath();
          context.arc(0, 0, 18 + pulse * 48, 0, Math.PI * 2);
          context.stroke();
        }
        context.globalAlpha = 0.9;
        context.beginPath();
        context.arc(0, 0, 3.5, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        const listenerDx = state.listener.x - source.x;
        const listenerDy = state.listener.y - source.y;
        const distance = Math.hypot(listenerDx, listenerDy);
        context.globalAlpha = 0.1;
        context.setLineDash([2, 8]);
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(listenerDx, listenerDy);
        context.stroke();
        context.setLineDash([]);
        context.globalAlpha = 0.44;
        context.font = "500 6px monospace";
        context.fillText(`${Math.round(distance * 0.82)}m`, 18, 2);
      }
      context.globalAlpha = 0.9;
      context.fillStyle = on ? "#bce8da" : "#728481";
      context.font = "600 7px monospace";
      context.fillText(`${source.id}`, 17, 15);
      context.fillStyle = on ? color : "#576b68";
      context.font = "500 5.5px monospace";
      context.fillText(source.label, 17, 23);
      context.restore();
    });
  }

  function drawHotspots(context, now) {
    config.HOTSPOTS.forEach((hotspot, index) => {
      if (!state.found[index] && !state.near[index]) return;
      context.save();
      context.translate(hotspot.x, hotspot.y);
      const found = state.found[index];
      const phase = (now * 0.0012 + index * 0.2) % 1;
      context.globalAlpha = found ? 0.96 : 0.55 + Math.sin(phase * Math.PI * 2) * 0.18;
      context.strokeStyle = hotspot.tone;
      context.fillStyle = "rgba(5, 14, 17, 0.8)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(0, 0, 10, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.rotate(Math.PI / 4);
      context.strokeRect(-4, -4, 8, 8);
      context.rotate(-Math.PI / 4);
      context.fillStyle = hotspot.tone;
      context.font = "600 7px monospace";
      context.fillText(found ? "LOCK" : "REFL", -12, -20);
      if (!found) {
        context.globalAlpha = 0.55;
        context.font = "600 9px monospace";
        context.fillText("?", -2.5, 3.3);
      }
      context.restore();
    });
  }

  function drawListener(context, now) {
    const { x, y } = state.listener;
    context.save();
    context.translate(x, y);
    context.strokeStyle = "rgba(255, 189, 104, 0.48)";
    context.lineWidth = 0.8;
    context.setLineDash([2, 5]);
    context.beginPath();
    context.arc(0, 0, 43 + Math.sin(now * 0.002) * 2, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.strokeStyle = "#ffbd68";
    context.globalAlpha = 0.9;
    context.beginPath();
    context.arc(0, 0, 19, 0.25, 1.32);
    context.arc(0, 0, 19, 1.83, 2.9);
    context.arc(0, 0, 19, 3.4, 4.47);
    context.arc(0, 0, 19, 4.97, 6.04);
    context.stroke();
    context.beginPath();
    context.moveTo(-27, 0);
    context.lineTo(-12, 0);
    context.moveTo(27, 0);
    context.lineTo(12, 0);
    context.moveTo(0, -27);
    context.lineTo(0, -12);
    context.moveTo(0, 27);
    context.lineTo(0, 12);
    context.stroke();
    context.fillStyle = "#ffbd68";
    context.beginPath();
    context.arc(0, 0, 3.8, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.34;
    context.beginPath();
    context.arc(0, 0, 7.5, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "rgba(255, 206, 133, 0.9)";
    context.font = "600 6px monospace";
    context.fillText("LISTENER", 23, -7);
    context.fillStyle = "rgba(255, 189, 104, 0.52)";
    context.fillText(`${Math.round(x)}, ${Math.round(y)}`, 23, 2);
    context.restore();

    if (state.target) {
      context.save();
      context.strokeStyle = "rgba(255, 189, 104, 0.27)";
      context.setLineDash([3, 6]);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(state.target.x, state.target.y);
      context.stroke();
      context.setLineDash([]);
      context.strokeRect(state.target.x - 4, state.target.y - 4, 8, 8);
      context.restore();
    }

    state.measurementRings.forEach((ring) => {
      const age = (now - ring.startedAt) / 760;
      if (age < 0 || age > 1) return;
      context.save();
      context.globalAlpha = (1 - age) * 0.58;
      context.strokeStyle = ring.valid ? "#8fffd5" : "#ff6d59";
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(ring.x, ring.y, 12 + age * 78, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    });
  }

  function drawWorldFurniture(context) {
    context.save();
    context.strokeStyle = "rgba(143, 255, 213, 0.3)";
    context.lineWidth = 1;
    const tick = 9;
    for (let x = 20; x < 1000; x += 80) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, tick);
      context.stroke();
    }
    for (let y = 20; y < 640; y += 80) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(tick, y);
      context.stroke();
    }
    context.fillStyle = "rgba(146, 194, 184, 0.28)";
    context.font = "500 6px monospace";
    context.fillText("N", 985, 17);
    context.fillText("F-07", 16, 625);
    context.strokeStyle = "rgba(143, 255, 213, 0.12)";
    context.strokeRect(0.5, 0.5, 999, 639);
    context.restore();
  }

  function getActualFingerprint() {
    const actual = state.engine.getActualSettings();
    return {
      pitch: actual.pitch,
      balance: actual.balance,
      delayMs: actual.delayMs,
      gain: state.params.gain,
      tempo: state.params.tempo
    };
  }

  function savePreset() {
    const actual = getActualFingerprint();
    const preset = {
      version: 1,
      savedAt: new Date().toISOString(),
      params: { ...state.params },
      actual,
      exportDuration: exportDuration(state.params),
      export: state.lastExport ? {
        duration: state.lastExport.duration,
        peakLeft: state.lastExport.peakLeft,
        peakRight: state.lastExport.peakRight,
        peakLeftDb: state.lastExport.peakLeftDb,
        peakRightDb: state.lastExport.peakRightDb,
        peakDb: state.lastExport.peakDb,
        fileDuration: state.lastExport.fileDuration,
        filePeakLeft: state.lastExport.filePeakLeft,
        filePeakRight: state.lastExport.filePeakRight,
        keyPitch: state.lastExport.keyPitch,
        delayMs: state.lastExport.delayMs,
        filename: state.lastExport.filename
      } : null,
      completed: state.found.filter(Boolean).length
    };
    localStorage.setItem(PRESET_KEY, JSON.stringify(preset));
    state.activePreset = preset;
    state.presetLoaded = false;
    updatePresetSummary();
    toast(preset.export
      ? "参数与首次导出指纹已存档。重新载入后可进行二次导出对比。"
      : "参数已存档。若需比较文件，请先导出一份 WAV 再存档。");
  }

  function readStoredPreset() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function updatePresetSummary() {
    const preset = readStoredPreset();
    if (!preset) {
      dom.presetSummary.textContent = "尚未保存参数。导出一次 WAV 后保存，可建立二次导出一致性基线。";
      return;
    }
    const params = preset.params;
    const savedTime = new Date(preset.savedAt);
    const peakLeftDb = preset.export?.peakLeftDb ?? 20 * Math.log10(Math.max(1e-8, preset.export?.peakLeft || 1e-8));
    const peakRightDb = preset.export?.peakRightDb ?? 20 * Math.log10(Math.max(1e-8, preset.export?.peakRight || 1e-8));
    const exportLine = preset.export
      ? `导出基线  ${preset.export.duration.toFixed(4)} s · PEAK L ${peakLeftDb.toFixed(3)} dB / R ${peakRightDb.toFixed(3)} dB`
      : "导出基线  未记录（先导出再保存可比较文件）";
    dom.presetSummary.textContent =
      `存档时间  ${savedTime.toLocaleString("zh-CN", { hour12: false })}\n` +
      `参数      ${params.frequency} Hz · BAL ${balanceLabel(params.balance)} · ${params.delay} ms · ${params.gain} dB · ${params.tempo} BPM\n` +
      `实际节点  ${preset.actual.pitch.toFixed(2)} Hz · ${preset.actual.delayMs.toFixed(1)} ms\n` +
      exportLine;
  }

  function loadPreset() {
    const preset = readStoredPreset();
    if (!preset) {
      toast("没有可载入的参数存档。", "warn");
      return;
    }
    state.params = { ...preset.params };
    state.activePreset = preset;
    state.presetLoaded = true;
    syncControls();
    state.engine.applyParams(state.params, 0.2);
    dom.toneValue.textContent = `${state.params.frequency}`;
    dom.balanceValue.textContent = balanceLabel(state.params.balance);
    dom.delayValue.textContent = `${state.params.delay}`;
    rebuildGateTimeline();
    dom.presetDialog.close();
    if (state.started) {
      dom.audioStatus.classList.add("is-live");
      dom.audioStatus.querySelector("span").textContent = "参数收敛中";
      window.setTimeout(() => {
        if (state.started && !state.paused) dom.audioStatus.querySelector("span").textContent = "实时合成";
      }, 300);
    }
    toast("参数已重新载入，音频节点在 0.2 秒内收敛。可再次导出进行比较。");
  }

  function openExportCheck() {
    if (!dom.exportDialog.open) dom.exportDialog.showModal();
    runExportCheck();
  }

  async function runExportCheck() {
    if (state.checking) return state.pendingExport;
    state.checking = true;
    state.pendingExport = null;
    dom.confirmExportButton.disabled = true;
    dom.rerunCheckButton.disabled = true;
    dom.exportButton.disabled = true;
    setChecksWaiting();
    dom.consistencyCheck.className = "consistency-check";
    dom.consistencyCheck.textContent = "正在离线渲染 8 拍立体声信号并检查静音、削波与双声道完整性…";
    try {
      if (state.started) await new Promise((resolve) => window.setTimeout(resolve, 240));
      const result = await audio.renderExport({ ...state.params });
      state.pendingExport = result;
      updateCheckUi(result.report);
      if (!result.report.canExport) {
        toast("声学校验未通过，WAV 未生成。请根据失败项调整参数。", "error");
      }
      return result;
    } catch (error) {
      setChecksFailed(error.message);
      toast(`导出渲染失败：${error.message}`, "error");
      return null;
    } finally {
      state.checking = false;
      dom.rerunCheckButton.disabled = false;
      dom.exportButton.disabled = false;
    }
  }

  function setChecksWaiting() {
    dom.checkList.querySelectorAll("[data-check]").forEach((row) => {
      row.className = "";
      row.querySelector("b").textContent = "WAITING";
      row.removeAttribute("title");
    });
    dom.exportPreview.innerHTML = `
      <div><span>DURATION</span><b>--</b></div>
      <div><span>PEAK L</span><b>--</b></div>
      <div><span>PEAK R</span><b>--</b></div>
      <div><span>KEY TONE</span><b>--</b></div>`;
  }

  function setChecksFailed(message) {
    dom.checkList.querySelectorAll("[data-check]").forEach((row) => {
      row.className = "is-fail";
      row.querySelector("b").textContent = "ERROR";
      row.title = message;
    });
    dom.confirmExportButton.disabled = true;
  }

  function updateCheckUi(report) {
    Object.entries(report.checks).forEach(([key, check]) => {
      const row = dom.checkList.querySelector(`[data-check="${key}"]`);
      row.className = check.pass ? "is-pass" : "is-fail";
      row.querySelector("b").textContent = check.label.toUpperCase();
      row.title = check.detail;
    });
    dom.exportPreview.innerHTML = `
      <div><span>DURATION</span><b>${(report.fileDuration ?? report.duration).toFixed(4)} s</b></div>
      <div><span>PEAK L</span><b>${report.peakLeftDb.toFixed(2)} dB</b></div>
      <div><span>PEAK R</span><b>${report.peakRightDb.toFixed(2)} dB</b></div>
      <div><span>KEY TONE</span><b>${report.keyPitch.toFixed(1)} Hz</b></div>`;
    dom.confirmExportButton.disabled = !report.canExport;
    if (report.canExport) {
      dom.consistencyCheck.className = "consistency-check is-pass";
      dom.consistencyCheck.textContent = "三项声学校验通过。可生成 16-bit PCM 立体声 WAV。";
    }
    showConsistencyComparison(report);
  }

  function compareReports(baseline, current) {
    const pitchDiff = Math.abs(baseline.keyPitch - current.keyPitch);
    const delayDiff = Math.abs(baseline.delayMs - current.delayMs);
    const durationDiff = Math.abs(
      (baseline.fileDuration ?? baseline.duration) - (current.fileDuration ?? current.duration)
    );
    const peakDiff = Math.max(
      Math.abs((baseline.filePeakLeft ?? baseline.peakLeft) - (current.filePeakLeft ?? current.peakLeft)),
      Math.abs((baseline.filePeakRight ?? baseline.peakRight) - (current.filePeakRight ?? current.peakRight))
    );
    return {
      pitchDiff,
      delayDiff,
      durationDiff,
      peakDiff,
      pass: pitchDiff <= 0.01 && delayDiff <= 0.01 && durationDiff <= 0.001 && peakDiff <= 0.0001
    };
  }

  function showConsistencyComparison(report) {
    if (!state.presetLoaded || !state.activePreset) {
      dom.consistencyCheck.className = "consistency-check";
      dom.consistencyCheck.textContent = "首次导出：导出后保存参数，再重新载入并二次导出，系统会比较音高、延迟、时长和峰值。";
      return;
    }
    const baseline = state.activePreset.export;
    if (!baseline) {
      dom.consistencyCheck.className = "consistency-check is-fail";
      dom.consistencyCheck.textContent = "存档中没有可比较的首次导出文件。请先导出 WAV，再保存参数并重新载入。";
      return;
    }
    const comparison = compareReports(baseline, report);
    const actual = getActualFingerprint();
    const actualPitchDiff = Math.abs(state.activePreset.actual.pitch - actual.pitch);
    const actualDelayDiff = Math.abs(state.activePreset.actual.delayMs - actual.delayMs);
    comparison.actualPitchDiff = actualPitchDiff;
    comparison.actualDelayDiff = actualDelayDiff;
    comparison.pass = comparison.pass && actualPitchDiff <= 0.05 && actualDelayDiff <= 0.05;
    dom.consistencyCheck.className = `consistency-check ${comparison.pass ? "is-pass" : "is-fail"}`;
    dom.consistencyCheck.textContent =
      `${comparison.pass ? "一致性复核通过" : "一致性复核失败"} · ` +
      `导出音高差 ${comparison.pitchDiff.toFixed(3)} Hz · ` +
      `节点音高差 ${actualPitchDiff.toFixed(3)} Hz · ` +
      `延迟差 ${Math.max(comparison.delayDiff, actualDelayDiff).toFixed(3)} ms · ` +
      `时长差 ${comparison.durationDiff.toFixed(6)} s · ` +
      `关键峰值差 ${(comparison.peakDiff * 1000).toFixed(4)} mFS`;
    state.lastComparison = comparison;
  }

  function confirmExport(download = true) {
    if (!state.pendingExport || !state.pendingExport.report.canExport) return null;
    const baseline = state.activePreset?.export && state.presetLoaded ? state.activePreset.export : null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `echo-block-${timestamp}.wav`;
    if (download) audio.downloadWav(state.pendingExport.blob, filename);
    const report = state.pendingExport.report;
    state.lastExport = { ...report, filename, exportedAt: new Date().toISOString() };
    dom.lastExportLabel.textContent = filename;
    dom.lastExportMeta.textContent = `${(report.fileDuration ?? report.duration).toFixed(3)} s / PEAK L ${report.peakLeftDb.toFixed(2)} / R ${report.peakRightDb.toFixed(2)} dBFS`;
    if (baseline) {
      const comparison = compareReports(baseline, report);
      const actual = getActualFingerprint();
      comparison.actualPitchDiff = Math.abs(state.activePreset.actual.pitch - actual.pitch);
      comparison.actualDelayDiff = Math.abs(state.activePreset.actual.delayMs - actual.delayMs);
      comparison.pass = comparison.pass && comparison.actualPitchDiff <= 0.05 && comparison.actualDelayDiff <= 0.05;
      state.lastComparison = comparison;
      dom.consistencyCheck.className = `consistency-check ${comparison.pass ? "is-pass" : "is-fail"}`;
      dom.consistencyCheck.textContent += comparison.pass
        ? " · WAV 已生成，两次导出一致。"
        : " · WAV 已生成，但两次导出一致性失败。";
    }
    toast(`WAV 已生成：${filename}`);
    return state.lastExport;
  }

  function toast(message, type = "info") {
    const item = document.createElement("div");
    item.className = `toast${type === "error" ? " is-error" : type === "warn" ? " is-warn" : ""}`;
    item.textContent = message;
    dom.toastStack.appendChild(item);
    window.setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateY(6px)";
      window.setTimeout(() => item.remove(), 230);
    }, 3600);
  }

  function canvasToWorld(event) {
    const rect = dom.canvas.getBoundingClientRect();
    const view = state.view;
    return {
      x: (event.clientX - rect.left - view.offsetX) / view.scale,
      y: (event.clientY - rect.top - view.offsetY) / view.scale
    };
  }

  function bindEvents() {
    Object.entries(controls).forEach(([key, control]) => {
      control.input.addEventListener("input", () => updateParam(key));
    });
    dom.startButton.addEventListener("click", startSession);
    dom.pauseButton.addEventListener("click", togglePause);
    dom.replayButton.addEventListener("click", replaySession);
    dom.resetButton.addEventListener("click", resetParams);
    dom.measureButton.addEventListener("click", () => {
      if (!state.started) {
        toast("请先启动监听。", "warn");
        return;
      }
      state.engine.pulse();
      recordMeasurement(true);
    });
    dom.exportButton.addEventListener("click", openExportCheck);
    dom.rerunCheckButton.addEventListener("click", runExportCheck);
    dom.confirmExportButton.addEventListener("click", () => confirmExport(true));
    dom.presetButton.addEventListener("click", () => {
      updatePresetSummary();
      dom.presetDialog.showModal();
    });
    dom.savePresetButton.addEventListener("click", savePreset);
    dom.loadPresetButton.addEventListener("click", loadPreset);
    dom.helpButton.addEventListener("click", () => dom.helpDialog.showModal());

    dom.canvas.addEventListener("pointerdown", (event) => {
      if (!state.started || state.paused) {
        toast("启动监听后可移动测量点。", "warn");
        return;
      }
      const point = canvasToWorld(event);
      state.target = resolveCollision(point.x, point.y, 12);
    });
    dom.canvas.addEventListener("pointermove", (event) => {
      const point = canvasToWorld(event);
      const rect = dom.canvas.getBoundingClientRect();
      if (point.x < 0 || point.y < 0 || point.x > 1000 || point.y > 640) {
        dom.cursorTip.classList.remove("is-visible");
        return;
      }
      const field = fieldAt(point.x, point.y, state.elapsed, state.params);
      dom.cursorTip.textContent = `${Math.round(point.x)} / ${Math.round(point.y)} · ${formatDb(field.db)} dB`;
      dom.cursorTip.style.left = `${event.clientX - rect.left}px`;
      dom.cursorTip.style.top = `${event.clientY - rect.top}px`;
      dom.cursorTip.classList.add("is-visible");
    });
    dom.canvas.addEventListener("pointerleave", () => dom.cursorTip.classList.remove("is-visible"));

    window.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, button, textarea, select")) return;
      const movementCodes = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
      if (movementCodes.includes(event.code)) {
        event.preventDefault();
        state.keys.add(event.code);
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (state.started && !state.paused) {
          state.engine.pulse();
          recordMeasurement(true);
        }
      }
      if (event.code === "KeyP" && state.started) togglePause();
    });
    window.addEventListener("keyup", (event) => state.keys.delete(event.code));
    window.addEventListener("blur", () => state.keys.clear());
    window.addEventListener("resize", resizeCanvas);
  }

  function updateClock() {
    const totalTenths = Math.floor(state.elapsed * 10);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor(totalTenths / 10) % 60;
    const tenths = totalTenths % 10;
    dom.sessionClock.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    if (state.started && !state.paused) updateGameState(dt);
    const field = fieldAt(state.listener.x, state.listener.y, state.elapsed, state.params);
    if (state.started && !state.paused && now - state.lastAcousticAt > 80) {
      state.lastAcousticAt = now;
      state.engine.updateAcoustic(field);
    }
    updateReadouts(field, now);
    updateTelemetry(now);
    updateClock();
    drawScene(now);
    window.requestAnimationFrame(frame);
  }

  function initializeSourcePreview() {
    state.sourceStates = getActiveSources(state.elapsed);
    state.lastStatesKey = state.sourceStates.map(Number).join("");
    updateSourceUi();
  }

  function installDebugApi() {
    window.__ECHO_DEBUG__ = {
      config,
      getState() {
        return {
          started: state.started,
          paused: state.paused,
          complete: state.complete,
          elapsed: state.elapsed,
          params: { ...state.params },
          listener: { ...state.listener },
          found: [...state.found],
          samples: state.samples.map((sample) => ({
            x: sample.x,
            y: sample.y,
            db: sample.db,
            valid: sample.valid,
            reason: sample.reason
          })),
          activePreset: state.activePreset,
          presetLoaded: state.presetLoaded,
          lastExport: state.lastExport,
          lastComparison: state.lastComparison || null
        };
      },
      getTelemetry() {
        return state.engine.getTelemetry();
      },
      getActualSettings() {
        return state.engine.getActualSettings();
      },
      setParams(patch) {
        Object.entries(patch).forEach(([key, value]) => {
          if (controls[key] && Number.isFinite(Number(value))) {
            state.params[key] = Number(value);
          }
        });
        syncControls();
        state.engine.applyParams(state.params, 0.2);
        dom.toneValue.textContent = `${state.params.frequency}`;
        dom.balanceValue.textContent = balanceLabel(state.params.balance);
        dom.delayValue.textContent = `${state.params.delay}`;
        state.presetLoaded = false;
        rebuildGateTimeline();
        return { ...state.params };
      },
      setListener(x, y) {
        moveListener(x, y);
        return { ...state.listener };
      },
      measure() {
        state.engine.pulse();
        return recordMeasurement(true);
      },
      measureHotspot(index) {
        const hotspot = config.HOTSPOTS[index];
        if (!hotspot) return null;
        let bestTime = state.elapsed;
        for (let time = 0; time < 60; time += 0.04) {
          const anySource = hotspot.sources.some((sourceIndex) => utils.sourceIsOn(config.SOURCES[sourceIndex], time));
          if (!anySource) continue;
          const candidate = fieldAt(hotspot.x, hotspot.y, time, state.params);
          if (candidate.reflection > 0.18 && !candidate.clipped) {
            bestTime = time;
            break;
          }
        }
        state.elapsed = bestTime;
        moveListener(hotspot.x, hotspot.y);
        return recordMeasurement(true);
      },
      async start() {
        if (!state.started) await startSession();
        return state.started;
      },
      async pause(value) {
        if (value !== state.paused) await togglePause();
        return state.paused;
      },
      async wait(ms = 400) {
        await new Promise((resolve) => window.setTimeout(resolve, ms));
        return this.getTelemetry();
      },
      async checkExport() {
        const result = await runExportCheck();
        return result ? result.report : null;
      },
      confirmExport(download = false) {
        return confirmExport(download);
      },
      savePreset,
      loadPreset,
      readPreset: readStoredPreset,
      openExportCheck,
      async renderIsolated(params = state.params) {
        const result = await audio.renderExport({ ...params });
        return result.report;
      }
    };
  }

  setupStaticUi();
  bindEvents();
  initializeSourcePreview();
  installDebugApi();
  resizeCanvas();
  window.requestAnimationFrame(frame);
})();
