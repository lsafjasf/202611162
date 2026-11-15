(function () {
  "use strict";

  const sim = window.ZiplineSim;
  const audio = new window.ZiplineAudio();
  const canvas = document.getElementById("gameCanvas");
  const renderer = new window.CanopyRenderer(canvas);
  const elements = {};
  const guidanceCache = new Map();
  const FIXED_STEP = 1 / 120;
  const SUMMARY_PREFIX = "canopyRelay.summary.";

  [
    "phaseLabel",
    "seedChip",
    "layoutChip",
    "pauseBtn",
    "pauseLabel",
    "restartBtn",
    "muteBtn",
    "muteIcon",
    "muteLabel",
    "hudTaskName",
    "hudTaskMeta",
    "hudTools",
    "hudPads",
    "hudCords",
    "speedValue",
    "speedState",
    "speedFill",
    "rideProgressFill",
    "rideProgressLabel",
    "brakeHud",
    "brakeFill",
    "brakeHint",
    "toastStack",
    "pauseOverlay",
    "resumeBtn",
    "pauseRestartBtn",
    "failureOverlay",
    "failureMark",
    "failureEyebrow",
    "failureTitle",
    "failureReason",
    "checkpointLabel",
    "recoveryCost",
    "recoverBtn",
    "failureRestartBtn",
    "eventFeed",
    "eventClock",
    "missionCount",
    "toolList",
    "missionNote",
    "routeList",
    "weightValue",
    "weightRange",
    "weightFeedback",
    "forecastRain",
    "forecastWind",
    "forecastSag",
    "forecastObstacles",
    "rainBar",
    "windBar",
    "sagBar",
    "hazardBar",
    "forecastAdvice",
    "launchBtn",
    "launchSubline",
    "padCount",
    "cordCount",
    "checkpointCount",
    "seedInput",
    "applySeedBtn",
    "sameSeedBtn",
    "verifyBtn",
    "helpBtn",
    "seedVerdict",
    "summaryModal",
    "summaryTitle",
    "summaryLead",
    "summaryTargets",
    "summaryResources",
    "summaryTime",
    "summaryPath",
    "summaryFailures",
    "summaryChecks",
    "summarySaveNote",
    "downloadSummaryBtn",
    "summaryNewRunBtn",
    "closeSummaryBtn",
    "helpModal",
    "closeHelpBtn",
    "speedHud",
  ].forEach(function (id) {
    elements[id] = document.getElementById(id);
  });
  elements.speedHud = document.querySelector(".speed-hud");

  const state = {
    world: null,
    run: null,
    selectedRouteId: null,
    weightKg: 12,
    ride: null,
    phase: "ready",
    paused: false,
    brakeHeld: false,
    renderTime: 0,
    lastFrame: performance.now(),
    accumulator: 0,
    verification: null,
    currentSummary: null,
    lastFailure: null,
    toastTimers: new Set(),
    summaryTimer: null,
  };

  function initialSeed() {
    const query = new URLSearchParams(window.location.search);
    return (query.get("seed") || "CANOPY-653").trim().toUpperCase();
  }

  function activateWorld(world, options) {
    const settings = options || {};
    const previous = settings.compareTo || null;
    state.world = world;
    state.run = sim.createRun(world);
    state.selectedRouteId = null;
    state.weightKg = settings.keepWeight ? state.weightKg : 12;
    state.ride = null;
    state.phase = "ready";
    state.paused = false;
    state.brakeHeld = false;
    state.accumulator = 0;
    state.lastFailure = null;
    state.currentSummary = null;
    state.verification = previous ? sim.compareWorlds(previous, world) : null;
    renderer.setWorld(world);
    elements.seedInput.value = world.seed;
    elements.summaryModal.hidden = true;
    elements.helpModal.hidden = true;
    elements.failureOverlay.hidden = true;
    elements.pauseOverlay.hidden = true;
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set("seed", world.seed);
      window.history.replaceState({}, "", url);
    }
    renderStatic();
    updateDynamicHud();
    renderVerification();
    showToast(
      settings.keepWeight
        ? "本局已按同一种子重开：" + world.seed
        : "已载入固定种子：" + world.seed,
      "good",
    );
    setEvent(
      previous
        ? "同种子新局已建立；正在核对入口、障碍与任务布局。"
        : "等待选择滑索入口与吊包重量。",
    );
  }

  function restartRun(announce) {
    state.run = sim.createRun(state.world);
    state.ride = null;
    state.phase = "ready";
    state.paused = false;
    state.brakeHeld = false;
    state.accumulator = 0;
    state.lastFailure = null;
    state.selectedRouteId = null;
    elements.pauseOverlay.hidden = true;
    elements.failureOverlay.hidden = true;
    renderStatic();
    updateDynamicHud();
    if (announce !== false) {
      showToast("本局已重开；地图与线路条件保持不变。", "good");
      setEvent("检查点、目标与资源已重置，seed 未改变。");
    }
  }

  function applySeedFromInput() {
    const seed = elements.seedInput.value.trim().toUpperCase();
    if (!seed) {
      showToast("种子不能为空。", "danger");
      return;
    }
    const changed = !state.world || seed !== state.world.seed;
    audio.select();
    activateWorld(sim.createWorld(seed), { keepWeight: false });
    if (changed) {
      elements.seedVerdict.className = "seed-verdict";
      elements.seedVerdict.textContent =
        "新 seed 已生成独立布局；用同种子新局可进行一致性核对。";
    }
  }

  function startSameSeedGame(options) {
    const settings = options || {};
    const previous = state.world;
    const next = sim.createWorld(previous.seed);
    audio.select();
    activateWorld(next, { compareTo: previous, keepWeight: settings.keepWeight });
    setEvent(
      "同种子新局：布局指纹 " +
        next.fingerprint +
        "，正在与上一局逐项比对。",
    );
  }

  function verifyLayout() {
    const regenerated = sim.createWorld(state.world.seed);
    state.verification = sim.compareWorlds(state.world, regenerated);
    renderVerification();
    audio.select();
    if (state.verification.sameLayout) {
      showToast(
        "独立复算通过：入口、障碍、任务与天气条件完全一致。",
        "good",
      );
    } else {
      showToast("布局校验失败，请检查 seed 实现。", "danger");
    }
  }

  function renderVerification() {
    const check = state.verification;
    if (!check) {
      elements.seedVerdict.className = "seed-verdict";
      elements.seedVerdict.textContent =
        "同种子新局会核对入口、障碍、任务与线路条件。";
      return;
    }
    const ok = check.sameLayout && check.sameSeed;
    elements.seedVerdict.className = "seed-verdict " + (ok ? "good" : "bad");
    elements.seedVerdict.textContent = ok
      ? "✓ 布局一致 · " +
        check.routeCount +
        " 入口 / " +
        check.obstacleCount +
        " 障碍 / " +
        check.taskCount +
        " 任务 · " +
        check.nextFingerprint
      : "✕ 布局不一致 · " +
        (check.previousFingerprint || "无") +
        " → " +
        check.nextFingerprint;
  }

  function selectedRoute() {
    if (!state.world || !state.selectedRouteId) {
      return null;
    }
    return (
      state.world.routes.find(function find(route) {
        return route.id === state.selectedRouteId;
      }) || null
    );
  }

  function currentTask() {
    if (!state.world) {
      return null;
    }
    return (
      state.world.tasks.find(function find(task) {
        return state.run.deliveredTaskIds.indexOf(task.id) === -1;
      }) || null
    );
  }

  function riskFor(route) {
    const score =
      route.rain * 4 +
      Math.abs(route.wind) * 0.12 +
      route.sag * 0.018 +
      route.obstacles.length * 0.32;
    if (score > 4.4) {
      return { label: "高风险", level: "high" };
    }
    if (score > 3.5) {
      return { label: "偏高", level: "mid" };
    }
    return { label: "可控", level: "low" };
  }

  function renderMission() {
    const delivered = state.run.deliveredTaskIds;
    const task = currentTask();
    elements.toolList.innerHTML = "";
    state.world.tasks.forEach(function render(taskItem) {
      const done = delivered.indexOf(taskItem.id) !== -1;
      const item = document.createElement("div");
      item.className =
        "tool-item" +
        (done ? " done" : "") +
        (!done && task && task.id === taskItem.id ? " current" : "");
      item.style.setProperty("--task-color", taskItem.color);
      item.innerHTML =
        '<span class="tool-glyph">' +
        taskItem.glyph +
        "</span><span>" +
        taskItem.name +
        "</span>";
      elements.toolList.appendChild(item);
    });
    elements.missionCount.textContent =
      state.run.toolsRemaining + " 件待送";
    elements.missionNote.textContent =
      state.run.toolsRemaining === 0
        ? "三件工具均已到站，运行摘要已生成。"
        : "每成功到站一件，自动写入检查点。";
    elements.hudTaskName.textContent = task ? task.name : "全部送达";
    elements.hudTaskMeta.textContent = task
      ? "目标 " +
        (state.world.tasks.length - state.run.toolsRemaining + 1) +
        " / " +
        state.world.tasks.length +
        " · 高塔平台"
      : "高塔平台 · 任务完成";
  }

  function renderRoutes() {
    elements.routeList.innerHTML = "";
    state.world.routes.forEach(function render(route, index) {
      const active = route.id === state.selectedRouteId;
      const risk = riskFor(route);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-option" + (active ? " selected" : "");
      button.style.setProperty("--route-accent", route.accent);
      button.dataset.routeId = route.id;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = state.phase !== "ready" || state.paused;
      button.innerHTML =
        '<span class="route-icon">0' +
        (index + 1) +
        '</span><span class="route-copy"><b>' +
        route.label +
        "</b><small>" +
        route.character +
        '</small></span><span class="route-weather"><b class="' +
        (risk.level === "high" ? "risk" : "") +
        '">' +
        risk.label +
        "</b><span>" +
        Math.round(route.rain * 100) +
        "% 雨</span><span>" +
        (route.wind > 0 ? "+" : "") +
        route.wind.toFixed(1) +
        " m/s</span></span>";
      button.addEventListener("click", function choose() {
        selectRoute(route.id);
      });
      elements.routeList.appendChild(button);
    });
  }

  function selectRoute(routeId) {
    if (state.phase !== "ready" || state.paused) {
      showToast("当前阶段不能切换入口。", "danger");
      return;
    }
    const route = state.world.routes.find(function find(item) {
      return item.id === routeId;
    });
    if (!route) {
      return;
    }
    state.selectedRouteId = routeId;
    audio.ensure();
    audio.select();
    renderRoutes();
    renderForecast();
    updateControls();
    showToast(
      "入口已锁定：" +
        route.label +
        " · 雨 " +
        Math.round(route.rain * 100) +
        "% · 风 " +
        (route.wind > 0 ? "+" : "") +
        route.wind.toFixed(1) +
        " m/s",
      "good",
    );
    setEvent(
      "已选择 " +
        route.label +
        "；下垂 " +
        route.sag +
        "，线路障碍 " +
        route.obstacles.length +
        " 处。",
    );
    updateDynamicHud();
  }

  function guidanceFor(route, weightKg) {
    const key = state.world.seed + ":" + route.id + ":" + weightKg;
    if (guidanceCache.has(key)) {
      return guidanceCache.get(key);
    }
    let minimum = null;
    let maximum = null;
    let best = null;
    for (let progress = 0.22; progress <= 0.82; progress += 0.02) {
      const ride = sim.simulateRide(state.world, {
        routeId: route.id,
        weightKg: weightKg,
        brakeFrom: Math.round(progress * 100) / 100,
        brakeTo: 1,
      });
      if (ride.state === "arrived") {
        const value = Math.round(progress * 100);
        minimum = minimum == null ? value : Math.min(minimum, value);
        maximum = maximum == null ? value : Math.max(maximum, value);
        if (!best || Math.abs(ride.speed - 9.2) < Math.abs(best.speed - 9.2)) {
          best = { progress: value, speed: ride.speed };
        }
      }
    }
    const guidance = { minimum: minimum, maximum: maximum, best: best };
    guidanceCache.set(key, guidance);
    return guidance;
  }

  function renderForecast() {
    const route = selectedRoute();
    if (!route) {
      elements.forecastRain.textContent = "--";
      elements.forecastWind.textContent = "--";
      elements.forecastSag.textContent = "--";
      elements.forecastObstacles.textContent = "--";
      elements.rainBar.style.width = "0";
      elements.windBar.style.width = "0";
      elements.sagBar.style.width = "0";
      elements.hazardBar.style.width = "0";
      elements.forecastAdvice.textContent = "选择入口后显示制动建议。";
      return;
    }
    const guidance = guidanceFor(route, state.weightKg);
    elements.forecastRain.textContent = Math.round(route.rain * 100) + "%";
    elements.forecastWind.textContent =
      (route.wind > 0 ? "+" : "") + route.wind.toFixed(1) + " m/s";
    elements.forecastSag.textContent = route.sag + " px";
    elements.forecastObstacles.textContent = route.obstacles.length + " 处";
    elements.rainBar.style.width = Math.round(route.rain * 100) + "%";
    elements.windBar.style.width =
      Math.min(100, Math.abs(route.wind) * 5) + "%";
    elements.sagBar.style.width = Math.min(100, route.sag) + "%";
    elements.hazardBar.style.width =
      Math.min(100, route.obstacles.length * 24) + "%";
    if (guidance.minimum != null) {
      elements.forecastAdvice.textContent =
        "安全制动窗口：到线 " +
        guidance.minimum +
        "%–" +
        guidance.maximum +
        "% 开始按住。参考点 " +
        guidance.best.progress +
        "%，预计到站 " +
        guidance.best.speed.toFixed(1) +
        " m/s。";
    } else {
      elements.forecastAdvice.textContent =
        "当前配重没有稳定制动窗口；调整吊包重量后再试。";
    }
  }

  function renderResources() {
    elements.hudTools.textContent =
      state.run.toolsRemaining + "/" + state.world.tasks.length;
    elements.hudPads.textContent = state.run.brakePads;
    elements.hudCords.textContent = state.run.rescueKits;
    elements.padCount.textContent =
      state.run.brakePads + " / " + sim.BRAKE_PADS_START;
    elements.cordCount.textContent =
      state.run.rescueKits + " / " + sim.RESCUE_CORDS_START;
    elements.checkpointCount.textContent =
      state.run.deliveries.length === 0
        ? "起点"
        : state.run.deliveries.length + " 件后";
  }

  function renderStatic() {
    elements.seedChip.textContent = state.world.seed;
    elements.layoutChip.textContent = state.world.fingerprint;
    elements.weightValue.textContent = state.weightKg;
    elements.weightRange.value = state.weightKg;
    renderMission();
    renderRoutes();
    renderForecast();
    renderResources();
    updateControls();
    updatePhaseLabel();
  }

  function updateControls() {
    const ready = state.phase === "ready" && !state.paused;
    const route = selectedRoute();
    elements.launchBtn.disabled = !ready || !route;
    if (state.phase === "riding") {
      elements.launchSubline.textContent = "滑行中 · 使用制动";
    } else if (state.phase === "complete") {
      elements.launchSubline.textContent = "全部工具已送达";
    } else if (state.phase === "failure") {
      elements.launchSubline.textContent = "等待检查点恢复";
    } else if (!route) {
      elements.launchSubline.textContent = "先选入口";
    } else {
      elements.launchSubline.textContent =
        route.short + " · " + state.weightKg + " kg · 按 SPACE 制动";
    }
    elements.weightRange.disabled = state.phase !== "ready" || state.paused;
    elements.seedInput.disabled = state.phase === "riding";
    elements.applySeedBtn.disabled = state.phase === "riding";
    elements.sameSeedBtn.disabled = state.phase === "riding";
  }

  function handleWeightInput() {
    if (state.phase !== "ready" || state.paused) {
      return;
    }
    state.weightKg = Number(elements.weightRange.value);
    elements.weightValue.textContent = state.weightKg;
    const route = selectedRoute();
    if (state.weightKg <= 9) {
      elements.weightFeedback.textContent =
        "轻载：更易被制动，但过早制动容易停在线中。";
    } else if (state.weightKg >= 15) {
      elements.weightFeedback.textContent =
        "重载：下垂与惯性增大，应更早开始制动。";
    } else {
      elements.weightFeedback.textContent =
        "标准载荷：重力与制动力平衡。";
    }
    renderForecast();
    renderRoutes();
    updateControls();
    if (route) {
      setEvent(
        "吊包调整为 " +
          state.weightKg +
          " kg；下垂补偿 " +
          ((state.weightKg - 12) * 2.5).toFixed(1) +
          " px，制动建议已刷新。",
      );
    }
  }

  function updatePhaseLabel() {
    const labels = {
      ready: state.paused ? "已暂停" : "待出发",
      riding: state.paused ? "已暂停" : "滑行中",
      failure: "异常",
      complete: "任务完成",
    };
    elements.phaseLabel.textContent = labels[state.phase] || "待出发";
    elements.pauseLabel.textContent = state.paused ? "继续" : "暂停";
  }

  function updateDynamicHud() {
    if (!state.run) {
      return;
    }
    const ride = state.ride;
    const speed = ride ? ride.speed : 0;
    const progress = ride ? ride.progress : 0;
    const danger = ride && speed > sim.SAFE_SPEED;
    const safe = ride && ride.state === "arrived";
    elements.speedValue.textContent = speed.toFixed(1);
    elements.speedFill.style.width =
      Math.min(100, (speed / 18) * 100).toFixed(1) + "%";
    elements.rideProgressFill.style.width =
      (progress * 100).toFixed(1) + "%";
    elements.rideProgressLabel.textContent =
      ride && progress >= 0.995
        ? "抵达平台 100%"
        : "入口 " + Math.round(progress * 100) + "%";
    elements.brakeFill.style.width =
      state.brakeHeld && state.phase === "riding" ? "100%" : "0%";
    elements.brakeHud.classList.toggle(
      "active",
      state.brakeHeld && state.phase === "riding",
    );
    elements.speedHud.classList.toggle("danger", Boolean(danger));
    elements.speedHud.classList.toggle("safe", Boolean(safe));
    if (ride) {
      elements.speedState.textContent = danger
        ? "超速!"
        : ride.braking
          ? "制动中"
          : ride.speed <= sim.STALL_SPEED
            ? "已停滞"
            : "滑行";
    } else {
      elements.speedState.textContent =
        state.phase === "complete"
          ? "完成"
          : state.phase === "failure"
            ? "异常"
            : "待出发";
    }
    const route = selectedRoute();
    elements.brakeHint.textContent = route
      ? "雨量 " +
        Math.round(route.rain * 100) +
        "% · 制动力约降 " +
        Math.round(route.rain * 34) +
        "%"
      : "雨量会削弱制动力";
    elements.eventClock.textContent = sim.formatTime(state.run.elapsedSec);
    elements.hudTools.textContent =
      state.run.toolsRemaining + "/" + state.world.tasks.length;
    elements.hudPads.textContent = state.run.brakePads;
    elements.hudCords.textContent = state.run.rescueKits;
    updatePhaseLabel();
  }

  function setEvent(message) {
    elements.eventFeed.textContent = message;
  }

  function showToast(message, tone) {
    const toast = document.createElement("div");
    toast.className = "toast" + (tone ? " " + tone : "");
    toast.textContent = message;
    elements.toastStack.appendChild(toast);
    while (elements.toastStack.children.length > 3) {
      elements.toastStack.removeChild(elements.toastStack.firstChild);
    }
    const timer = window.setTimeout(function remove() {
      toast.classList.add("leaving");
      state.toastTimers.delete(timer);
      window.setTimeout(function drop() {
        toast.remove();
      }, 200);
    }, 2600);
    state.toastTimers.add(timer);
  }

  function togglePause() {
    if (state.phase === "failure" || state.phase === "complete") {
      showToast("当前状态请使用面板中的恢复或重开操作。", "danger");
      return;
    }
    state.paused = !state.paused;
    state.brakeHeld = false;
    state.lastFrame = performance.now();
    state.accumulator = 0;
    elements.pauseOverlay.hidden = !state.paused;
    renderRoutes();
    updateControls();
    updatePhaseLabel();
    if (state.paused) {
      audio.setScene({
        rain: selectedRoute() ? selectedRoute().rain : 0.5,
        wind: selectedRoute() ? selectedRoute().wind : 5,
        speed: 0,
        braking: false,
        riding: false,
      });
      showToast("已暂停：滑行、计时与天气影响全部冻结。", "");
      setEvent("暂停中。按 ESC 或“继续”恢复当前滑行。");
    } else {
      showToast("继续运行。", "good");
      setEvent("已恢复滑行；制动键重新可用。");
    }
  }

  function launchRide() {
    if (
      state.phase !== "ready" ||
      state.paused ||
      !state.selectedRouteId ||
      !currentTask()
    ) {
      return;
    }
    audio.ensure();
    state.ride = sim.beginRide(
      state.world,
      state.run,
      state.selectedRouteId,
      state.weightKg,
    );
    if (!state.ride) {
      showToast("无法创建吊包，请重开本局。", "danger");
      return;
    }
    state.phase = "riding";
    state.accumulator = 0;
    state.lastFrame = performance.now();
    audio.launch();
    renderRoutes();
    updateControls();
    updateDynamicHud();
    showToast(
      "吊包离站：" +
        state.ride.taskName +
        " · " +
        state.ride.weightKg +
        " kg",
      "good",
    );
    setEvent(
      state.ride.routeLabel +
        " 已释放；到站速度必须不高于 " +
        sim.SAFE_SPEED.toFixed(1) +
        " m/s。",
    );
  }

  function handleRideEvents(events) {
    events.forEach(function handle(event) {
      if (event.type === "brake-start") {
        audio.select();
        showToast("制动垫咬合，开始消耗当前制动垫。", "");
        setEvent(
          "制动开始于 " +
            Math.round(event.progress * 100) +
            "%；当前速度 " +
            event.speed.toFixed(1) +
            " m/s。",
        );
      } else if (event.type === "hazard") {
        audio.hazard();
        const speedChange =
          event.hazardType === "gust" ? "+" + event.strength.toFixed(1) : "−" + (event.strength * 0.48).toFixed(1);
        showToast(
          "通过" + event.label + " · 速度 " + speedChange + " m/s",
          "danger",
        );
        setEvent(
          "障碍触发：" +
            event.label +
            "，到站速度变化 " +
            speedChange +
            " m/s。",
        );
      } else if (event.type === "outcome") {
        resolveRide();
      }
    });
  }

  function resolveRide() {
    if (!state.ride) {
      return;
    }
    const result = sim.settleRide(state.world, state.run, state.ride);
    if (!result) {
      return;
    }
    state.brakeHeld = false;
    if (result.kind === "delivered") {
      audio.success();
      renderMission();
      renderResources();
      if (result.complete) {
        state.phase = "complete";
        renderRoutes();
        updateControls();
        updateDynamicHud();
        showToast("三件工具全部送达，摘要已保存。", "good");
        setEvent("任务完成；正在生成本局路径、资源与失败恢复摘要。");
        window.clearTimeout(state.summaryTimer);
        state.summaryTimer = window.setTimeout(showSummary, 520);
      } else {
        state.phase = "ready";
        state.selectedRouteId = null;
        state.ride = null;
        renderStatic();
        updateDynamicHud();
        showToast(
          "安全到站：已交付，检查点更新为 " +
            state.run.deliveries.length +
            " 件。",
          "good",
        );
        setEvent(
          "到站速度 " +
            result.outcome.speed.toFixed(1) +
            " m/s；请选择下一件工具的入口。",
        );
      }
      return;
    }

    state.phase = "failure";
    state.lastFailure = Object.assign({}, state.run.lastFailure);
    renderRoutes();
    updateControls();
    updateDynamicHud();
    showFailure();
    audio.failure();
    showToast(
      result.kind === "stranded" ? "吊包搁浅，需要回收。" : "到站超速，平台受损。",
      "danger",
    );
    setEvent(
      state.lastFailure.reason +
        "；可从检查点恢复，无需刷新页面。",
    );
  }

  function showFailure() {
    const failure = state.lastFailure;
    if (!failure) {
      return;
    }
    const stranded = failure.kind === "stranded";
    elements.failureOverlay.hidden = false;
    elements.failureMark.textContent = stranded ? "∿" : "!";
    elements.failureEyebrow.textContent = stranded
      ? "吊包停在线中"
      : "吊包撞击平台";
    elements.failureTitle.textContent = stranded ? "滑索搁浅" : "到站超速";
    elements.failureReason.textContent = failure.reason;
    elements.checkpointLabel.textContent =
      state.run.deliveries.length === 0
        ? "任务起点"
        : state.run.deliveries.length + " 件交付后";
    if (stranded) {
      elements.recoveryCost.textContent =
        state.run.rescueKits > 0
          ? "回收索 ×1（余 " + state.run.rescueKits + "）"
          : "回收索耗尽 · 人工拖回";
      elements.recoverBtn.textContent =
        state.run.rescueKits > 0 ? "回收并回到检查点" : "人工拖回检查点";
    } else {
      elements.recoveryCost.textContent = "平台抢修 · 资源保留";
      elements.recoverBtn.textContent = "维修并从检查点恢复";
    }
  }

  function recoverFromCheckpoint() {
    const failure = state.lastFailure;
    if (!failure) {
      return;
    }
    const entry = sim.restoreCheckpoint(state.world, state.run, {
      kind: failure.kind,
      reason: failure.reason,
    });
    if (!entry) {
      showToast("没有可用检查点，请重开本局。", "danger");
      return;
    }
    state.lastFailure = null;
    state.ride = null;
    state.phase = "ready";
    state.paused = false;
    state.brakeHeld = false;
    state.selectedRouteId = null;
    state.accumulator = 0;
    elements.failureOverlay.hidden = true;
    renderStatic();
    updateDynamicHud();
    audio.select();
    showToast(
      (entry.rescueSpent ? "已消耗 1 根回收索；" : "") +
        "已恢复到最近检查点。",
      "good",
    );
    setEvent(
      "检查点恢复成功" +
        (entry.rescueSpent ? "（回收索 −1）" : "（平台抢修）") +
        "；工具 " +
        state.run.toolsRemaining +
        " 件待送，地图未重建。",
    );
  }

  function showSummary() {
    if (!state.run || state.run.toolsRemaining !== 0) {
      return;
    }
    const summary = sim.createStateSummary(state.world, state.run, {
      status: "complete",
      finalTimeSec: state.run.elapsedSec,
    });
    summary.validation = sim.validateSummary(summary, state.world);
    state.currentSummary = summary;
    let saved = false;
    try {
      window.localStorage.setItem(
        SUMMARY_PREFIX + state.world.seed,
        JSON.stringify(summary),
      );
      saved = true;
    } catch (error) {
      saved = false;
    }
    elements.summaryTitle.textContent = "三件工具全部送达";
    elements.summaryLead.textContent =
      "seed " +
      summary.seed +
      " · 布局指纹 " +
      summary.layoutFingerprint +
      " · 已核对目标、资源与最终用时。";
    elements.summaryTargets.textContent =
      summary.deliveredCount + " / " + summary.targetCount;
    elements.summaryResources.textContent =
      "制动垫 " +
      summary.remainingResources.brakePads +
      " · 回收索 " +
      summary.remainingResources.rescueCords;
    elements.summaryTime.textContent = summary.finalTime;
    elements.summaryPath.innerHTML = "";
    summary.path.forEach(function renderPath(pathEntry, index) {
      const item = document.createElement("li");
      item.innerHTML =
        '<span class="path-index">' +
        (index === 0 ? "" : "") +
        "</span>";
      const indexNode = item.querySelector(".path-index");
      indexNode.textContent = String(index + 1);
      const copy = document.createElement("div");
      const title = document.createElement("span");
      title.textContent = pathEntry.taskName + " · " + pathEntry.routeLabel;
      const detail = document.createElement("small");
      detail.textContent =
        pathEntry.weightKg +
        " kg · 制动起点 " +
        (pathEntry.brakeStartProgress == null
          ? "未使用"
          : Math.round(pathEntry.brakeStartProgress * 100) + "%");
      copy.appendChild(title);
      copy.appendChild(detail);
      const speed = document.createElement("b");
      const arrivalSpeed = Number(pathEntry.arrivalSpeed);
      if (!Number.isFinite(arrivalSpeed)) {
        console.error("Invalid path arrival speed", pathEntry, summary.path);
      }
      speed.textContent = (Number.isFinite(arrivalSpeed) ? arrivalSpeed : 0).toFixed(1) + " m/s";
      item.appendChild(copy);
      item.appendChild(speed);
      elements.summaryPath.appendChild(item);
    });
    elements.summaryFailures.textContent =
      summary.failures.length === 0
        ? "无碰撞或搁浅。检查点未被用于回滚。"
        : summary.failureSummary +
          "。恢复 " +
          summary.recoverySummary.recoveries +
          " 次，其中回收索使用 " +
          summary.recoverySummary.rescueUses +
          " 次。";
    elements.summaryChecks.innerHTML = "";
    const checkLabels = {
      targetCountMatches:
        "目标数量 " + summary.deliveredCount + "/" + summary.targetCount,
      resourcesRecorded:
        "剩余资源 制动垫 " +
        summary.remainingResources.brakePads +
        " / 回收索 " +
        summary.remainingResources.rescueCords,
      finalTimeRecorded: "最终用时 " + summary.finalTime,
      layoutFingerprintStable: "布局指纹可复算 " + summary.layoutFingerprint,
    };
    Object.keys(summary.checks).forEach(function check(key) {
      const row = document.createElement("div");
      row.className = "check-row" + (summary.checks[key] ? "" : " failed");
      const label = document.createElement("span");
      label.textContent = checkLabels[key] || key;
      const mark = document.createElement("b");
      mark.textContent = summary.checks[key] ? "通过" : "失败";
      row.appendChild(label);
      row.appendChild(mark);
      elements.summaryChecks.appendChild(row);
    });
    const validationRow = document.createElement("div");
    validationRow.className =
      "check-row" + (summary.validation.valid ? "" : " failed");
    const validationLabel = document.createElement("span");
    validationLabel.textContent = "摘要整体校验";
    const validationMark = document.createElement("b");
    validationMark.textContent = summary.validation.valid ? "通过" : "失败";
    validationRow.appendChild(validationLabel);
    validationRow.appendChild(validationMark);
    elements.summaryChecks.appendChild(validationRow);
    elements.summarySaveNote.textContent = saved
      ? "摘要已保存至 localStorage：" +
        SUMMARY_PREFIX +
        summary.seed +
        " · " +
        summary.savedAt
      : "浏览器拒绝 localStorage；仍可导出 JSON 摘要。";
    elements.summaryModal.hidden = false;
    updateDynamicHud();
  }

  function downloadSummary() {
    if (!state.currentSummary) {
      return;
    }
    const blob = new Blob([JSON.stringify(state.currentSummary, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      "canopy-relay-" +
      state.currentSummary.seed.replace(/[^A-Z0-9_-]/gi, "_") +
      "-summary.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function revoke() {
      URL.revokeObjectURL(url);
    }, 1000);
    showToast("状态摘要已导出为 JSON。", "good");
  }

  let audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) {
      return;
    }
    if (audio.ensure()) {
      audioUnlocked = true;
      const route = selectedRoute();
      audio.setScene({
        rain: route ? route.rain : 0.5,
        wind: route ? route.wind : 4,
        speed: state.ride ? state.ride.speed : 0,
        braking: false,
        riding: state.phase === "riding",
      });
    }
  }

  function setBrake(active, source) {
    if (state.phase !== "riding" || state.paused || !state.ride) {
      if (active && source === "key") {
        showToast("制动仅在滑行阶段可用。", "");
      }
      return;
    }
    const next = Boolean(active);
    if (next === state.brakeHeld) {
      return;
    }
    state.brakeHeld = next;
    unlockAudio();
    audio.setScene({
      rain: selectedRoute() ? selectedRoute().rain : 0.5,
      wind: selectedRoute() ? selectedRoute().wind : 4,
      speed: state.ride.speed,
      braking: next,
      riding: true,
    });
    if (!next) {
      setEvent("制动已释放；观察到站速度并决定是否再次按住。");
    }
    updateDynamicHud();
  }

  function frame(now) {
    const elapsed = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    if (!state.paused) {
      state.renderTime += elapsed;
      if (state.phase === "riding" && state.ride) {
        state.run.elapsedSec += elapsed;
        state.accumulator += elapsed;
        let steps = 0;
        while (
          state.accumulator >= FIXED_STEP &&
          state.phase === "riding" &&
          steps < 10
        ) {
          const events = sim.stepRide(
            state.world,
            state.ride,
            { braking: state.brakeHeld },
            FIXED_STEP,
          );
          state.accumulator -= FIXED_STEP;
          steps += 1;
          handleRideEvents(events);
        }
      }
    }
    renderer.draw({
      world: state.world,
      selectedRouteId: state.selectedRouteId,
      weightKg: state.weightKg,
      ride: state.ride,
      run: state.run,
      time: state.renderTime,
    });
    if (audioUnlocked) {
      const route = selectedRoute();
      audio.setScene({
        rain: route ? route.rain : 0.5,
        wind: route ? route.wind : 4,
        speed: state.ride ? state.ride.speed : 0,
        braking: state.brakeHeld && state.phase === "riding" && !state.paused,
        riding: state.phase === "riding" && !state.paused,
      });
    }
    updateDynamicHud();
    window.requestAnimationFrame(frame);
  }

  function bindEvents() {
    elements.routeList.addEventListener("click", unlockAudio);
    elements.launchBtn.addEventListener("click", function launch() {
      unlockAudio();
      launchRide();
    });
    elements.weightRange.addEventListener("input", function weight() {
      unlockAudio();
      handleWeightInput();
    });
    elements.weightRange.addEventListener("change", function weightChanged() {
      audio.select();
      showToast(
        "吊包重量已设为 " +
          state.weightKg +
          " kg；线路预判与制动窗口已更新。",
        "",
      );
    });
    elements.pauseBtn.addEventListener("click", function pause() {
      unlockAudio();
      togglePause();
    });
    elements.resumeBtn.addEventListener("click", togglePause);
    elements.pauseRestartBtn.addEventListener("click", function restart() {
      restartRun(true);
    });
    elements.restartBtn.addEventListener("click", function restart() {
      unlockAudio();
      restartRun(true);
    });
    elements.failureRestartBtn.addEventListener("click", function restart() {
      restartRun(true);
    });
    elements.recoverBtn.addEventListener("click", recoverFromCheckpoint);
    elements.muteBtn.addEventListener("click", function mute() {
      unlockAudio();
      if (!audio.context) {
        showToast("当前浏览器不支持 Web Audio。", "danger");
        return;
      }
      audio.setMuted(!audio.muted);
      elements.muteIcon.textContent = audio.muted ? "◌" : "◖";
      elements.muteLabel.textContent = audio.muted ? "声音关" : "声音开";
      showToast(audio.muted ? "声音已关闭。" : "声音已开启。", "");
    });
    elements.applySeedBtn.addEventListener("click", applySeedFromInput);
    elements.seedInput.addEventListener("keydown", function seedEnter(event) {
      if (event.key === "Enter") {
        applySeedFromInput();
      }
    });
    elements.sameSeedBtn.addEventListener("click", function sameSeed() {
      startSameSeedGame();
    });
    elements.verifyBtn.addEventListener("click", verifyLayout);
    elements.helpBtn.addEventListener("click", function help() {
      unlockAudio();
      elements.helpModal.hidden = false;
    });
    elements.closeHelpBtn.addEventListener("click", function close() {
      elements.helpModal.hidden = true;
    });
    elements.helpModal.addEventListener("click", function backdrop(event) {
      if (event.target === elements.helpModal) {
        elements.helpModal.hidden = true;
      }
    });
    elements.closeSummaryBtn.addEventListener("click", function close() {
      elements.summaryModal.hidden = true;
    });
    elements.downloadSummaryBtn.addEventListener("click", downloadSummary);
    elements.summaryNewRunBtn.addEventListener("click", function newRun() {
      startSameSeedGame();
      showToast("同种子新局已开始；固定布局保持完全一致。", "good");
    });

    const brakeHud = elements.brakeHud;
    brakeHud.addEventListener("pointerdown", function brakeDown(event) {
      event.preventDefault();
      unlockAudio();
      brakeHud.setPointerCapture && brakeHud.setPointerCapture(event.pointerId);
      setBrake(true, "pointer");
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (name) {
      window.addEventListener(name, function brakeUp() {
        setBrake(false, "pointer");
      });
    });

    window.addEventListener("keydown", function keyDown(event) {
      unlockAudio();
      const typing =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
      if (event.code === "Space" && !typing) {
        event.preventDefault();
        if (!event.repeat) {
          setBrake(true, "key");
        }
        return;
      }
      if (event.key === "Escape") {
        if (!elements.summaryModal.hidden) {
          elements.summaryModal.hidden = true;
          return;
        }
        if (!elements.helpModal.hidden) {
          elements.helpModal.hidden = true;
          return;
        }
        togglePause();
        return;
      }
      if (!typing && event.key.toLowerCase() === "r") {
        restartRun(true);
      }
    });
    window.addEventListener("keyup", function keyUp(event) {
      if (event.code === "Space") {
        event.preventDefault();
        setBrake(false, "key");
      }
    });
    window.addEventListener("blur", function releaseBrake() {
      state.brakeHeld = false;
      updateDynamicHud();
    });
    document.addEventListener("visibilitychange", function visibility() {
      if (document.hidden && state.phase === "riding" && !state.paused) {
        togglePause();
      }
    });
  }

  function boot() {
    const world = sim.createWorld(initialSeed());
    state.world = world;
    state.run = sim.createRun(world);
    renderer.setWorld(world);
    elements.seedInput.value = world.seed;
    bindEvents();
    renderStatic();
    updateDynamicHud();
    setEvent("等待选择滑索入口与吊包重量。");
    window.__canopyDebug = {
      state: state,
      createSummary: function () {
        return sim.createStateSummary(state.world, state.run, {
          status: state.run.toolsRemaining === 0 ? "complete" : "incomplete",
          finalTimeSec: state.run.elapsedSec,
        });
      },
    };
    window.requestAnimationFrame(function start(now) {
      state.lastFrame = now;
      frame(now);
    });
  }

  boot();
})();
