import { formatTime, getAudioEvents, roundTime } from "./project.js";

const LABEL_WIDTH = 86;
const RIGHT_PAD = 18;
const RULER_HEIGHT = 24;
const SCENE_Y = 30;
const SCENE_HEIGHT = 16;
const AUDIO_Y = 54;
const AUDIO_HEIGHT = 44;
const SUBTITLE_TOP = 109;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

export class TimelineView {
  constructor({ canvas, cueLayer, playhead, scroller, getProject, callbacks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cueLayer = cueLayer;
    this.playhead = playhead;
    this.scroller = scroller;
    this.getProject = getProject;
    this.callbacks = callbacks;
    this.zoom = 1.4;
    this.cssWidth = 900;
    this.cssHeight = 240;
    this.selectedId = null;
    this.conflictIds = new Set();
    this.drag = null;
    this.scrub = null;
    this.cueElements = new Map();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(scroller);
    this.canvas.addEventListener("pointerdown", (event) => this.onCanvasPointerDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.cancelDrag();
    });
  }

  setZoom(zoom) {
    this.zoom = clamp(Number(zoom) || 1.4, 1, 3);
    this.resize();
  }

  setSelected(id) {
    this.selectedId = id;
    for (const [cueId, element] of this.cueElements) {
      element.classList.toggle("selected", cueId === id);
    }
  }

  setConflicts(ids) {
    this.conflictIds = new Set(ids);
    this.render();
  }

  timeToX(time) {
    const duration = Math.max(0.001, this.getProject().duration);
    return LABEL_WIDTH + (time / duration) * (this.cssWidth - LABEL_WIDTH - RIGHT_PAD);
  }

  xToTime(x) {
    const duration = Math.max(0.001, this.getProject().duration);
    return roundTime(
      clamp(
        ((x - LABEL_WIDTH) / Math.max(1, this.cssWidth - LABEL_WIDTH - RIGHT_PAD)) * duration,
        0,
        duration,
      ),
    );
  }

  resize() {
    const viewportWidth = this.scroller.clientWidth;
    this.cssWidth = Math.max(viewportWidth, Math.round(760 * this.zoom));
    this.cssHeight = Math.max(200, this.scroller.clientHeight);
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.canvas.width = Math.round(this.cssWidth * ratio);
    this.canvas.height = Math.round(this.cssHeight * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.cueLayer.style.width = `${this.cssWidth}px`;
    this.cueLayer.style.height = `${this.cssHeight}px`;
    this.scroller.querySelector(".timeline-content").style.width = `${this.cssWidth}px`;
    this.render();
  }

  render() {
    this.draw();
    this.renderCues();
    const time = Number(this.playhead.dataset.time || 0);
    this.updatePlayhead(time);
  }

  draw() {
    const project = this.getProject();
    const ctx = this.ctx;
    const width = this.cssWidth;
    const height = this.cssHeight;
    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#10151e");
    bg.addColorStop(1, "#0b0f15");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#0b0f15";
    ctx.fillRect(0, 0, LABEL_WIDTH, height);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(LABEL_WIDTH - 0.5, 0);
    ctx.lineTo(LABEL_WIDTH - 0.5, height);
    ctx.stroke();

    const tickStep = this.pickTickStep();
    this.drawGrid(tickStep);
    this.drawRuler(tickStep);
    this.drawLabels(project);
    this.drawScenes(project);
    this.drawWaveform(project);
    this.drawSubtitleRows(project);
  }

  pickTickStep() {
    const duration = this.getProject().duration;
    const pixelsPerSecond = (this.cssWidth - LABEL_WIDTH - RIGHT_PAD) / duration;
    const candidates = [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60];
    return candidates.find((step) => step * pixelsPerSecond >= 42) || 60;
  }

  drawGrid(step) {
    const duration = this.getProject().duration;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let time = 0; time <= duration + 0.0001; time += step) {
      const x = Math.round(this.timeToX(time)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_HEIGHT);
      ctx.lineTo(x, this.cssHeight);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRuler(step) {
    const duration = this.getProject().duration;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.018)";
    ctx.fillRect(LABEL_WIDTH, 0, this.cssWidth - LABEL_WIDTH, RULER_HEIGHT);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.moveTo(0, RULER_HEIGHT - 0.5);
    ctx.lineTo(this.cssWidth, RULER_HEIGHT - 0.5);
    ctx.stroke();
    ctx.font = '9px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    for (let time = 0; time <= duration + 0.0001; time += step) {
      const x = this.timeToX(time);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillRect(Math.round(x), RULER_HEIGHT - 5, 1, 4);
      ctx.fillStyle = "rgba(224,228,235,0.52)";
      ctx.fillText(formatTime(time).slice(0, -4), x, 12);
    }
    ctx.restore();
  }

  drawLabels(project) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 9px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textAlign = "left";
    ctx.fillText("场景", 12, SCENE_Y + 11);
    ctx.fillText("节拍", 12, AUDIO_Y + 22);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = '8px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
    ctx.fillText(`${project.audio.bpm} BPM`, 12, AUDIO_Y + 34);
    project.subtitles.forEach((cue, index) => {
      const y = this.rowTop(index);
      ctx.fillStyle = cue.id === this.selectedId ? "#ffcf91" : "rgba(255,255,255,0.36)";
      ctx.font = '9px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText(`S${String(index + 1).padStart(2, "0")}`, 12, y + 11);
    });
    ctx.restore();
  }

  drawScenes(project) {
    const ctx = this.ctx;
    const y = SCENE_Y;
    project.scenes.forEach((scene) => {
      const x = this.timeToX(scene.start) + 1;
      const endX = this.timeToX(scene.end) - 1;
      const gradient = ctx.createLinearGradient(x, 0, endX, 0);
      gradient.addColorStop(0, this.hexAlpha(scene.color, 0.22));
      gradient.addColorStop(1, this.hexAlpha(scene.color, 0.1));
      roundedRect(ctx, x, y, Math.max(2, endX - x), SCENE_HEIGHT, 4);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = this.hexAlpha(scene.color, 0.3);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 5, y, Math.max(0, endX - x - 10), SCENE_HEIGHT);
      ctx.clip();
      ctx.fillStyle = this.hexAlpha(scene.color, 0.8);
      ctx.font = '600 8px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText(scene.name, x + 6, y + 11);
      ctx.restore();
    });

    project.transitions.forEach((transition) => {
      const x = this.timeToX(transition.start);
      const endX = this.timeToX(transition.start + transition.duration);
      ctx.save();
      ctx.fillStyle = "rgba(111,201,255,0.09)";
      ctx.fillRect(x, y, endX - x, SCENE_HEIGHT);
      ctx.strokeStyle = "rgba(111,201,255,0.45)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, endX - x - 1, SCENE_HEIGHT - 1);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(155,220,255,0.8)";
      ctx.font = '7px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText("CROSSFADE", x + 5, y + 10);
      ctx.restore();
    });
  }

  drawWaveform(project) {
    const ctx = this.ctx;
    const x0 = LABEL_WIDTH;
    const x1 = this.cssWidth - RIGHT_PAD;
    const center = AUDIO_Y + AUDIO_HEIGHT / 2;
    const events = getAudioEvents(project);
    const interval = 60 / project.audio.bpm;
    const offset = project.audio.start;

    ctx.save();
    roundedRect(ctx, x0, AUDIO_Y, x1 - x0, AUDIO_HEIGHT, 5);
    ctx.fillStyle = "rgba(114,227,189,0.035)";
    ctx.fill();
    ctx.strokeStyle = "rgba(114,227,189,0.1)";
    ctx.stroke();

    ctx.strokeStyle = "rgba(114,227,189,0.12)";
    ctx.beginPath();
    ctx.moveTo(x0, center + 0.5);
    ctx.lineTo(x1, center + 0.5);
    ctx.stroke();

    ctx.beginPath();
    for (let x = x0; x <= x1; x += 2) {
      const time = this.xToTime(x);
      const local = time - offset;
      let amplitude = 0;
      if (local >= 0) {
        const beat = Math.floor(local / interval);
        const phase = local / interval - beat;
        const pulse = Math.exp(-phase * 7.5);
        const accent = beat % 4 === 0 ? 1 : 0.68;
        amplitude =
          pulse * accent * (AUDIO_HEIGHT * 0.38) +
          Math.sin(time * 91 + beat) * 0.8 * (1 - phase);
      }
      const top = center - Math.abs(amplitude);
      const bottom = center + Math.abs(amplitude);
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    ctx.strokeStyle = "rgba(114,227,189,0.68)";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const event of events) {
      const x = this.timeToX(event.time);
      ctx.fillStyle = event.accent ? "rgba(255,180,84,0.9)" : "rgba(114,227,189,0.57)";
      ctx.beginPath();
      ctx.arc(x, AUDIO_Y + 5, event.accent ? 1.8 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const startX = this.timeToX(offset);
    ctx.strokeStyle = "rgba(255,180,84,0.44)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(startX + 0.5, AUDIO_Y);
    ctx.lineTo(startX + 0.5, AUDIO_Y + AUDIO_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,200,124,0.8)";
    ctx.font = '7px "Noto Sans SC Variable", "Avenir Next", "Segoe UI", sans-serif';
    ctx.fillText("AUDIO IN", startX + 4, AUDIO_Y + AUDIO_HEIGHT - 4);
    ctx.restore();
  }

  drawSubtitleRows(project) {
    const ctx = this.ctx;
    ctx.save();
    project.subtitles.forEach((cue, index) => {
      const y = this.rowTop(index);
      roundedRect(ctx, LABEL_WIDTH, y, this.cssWidth - LABEL_WIDTH - RIGHT_PAD, this.rowHeight(), 3);
      ctx.fillStyle = "rgba(255,255,255,0.018)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.stroke();
    });
    ctx.restore();
  }

  rowTop(index) {
    return SUBTITLE_TOP + index * this.rowPitch();
  }

  rowPitch() {
    const count = Math.max(1, this.getProject().subtitles.length);
    const available = Math.max(40, this.cssHeight - SUBTITLE_TOP - 6);
    return Math.max(10, Math.min(19, available / count));
  }

  rowHeight() {
    return Math.max(8, this.rowPitch() - 2);
  }

  renderCues() {
    const project = this.getProject();
    const seen = new Set();
    project.subtitles.forEach((cue, index) => {
      seen.add(cue.id);
      let element = this.cueElements.get(cue.id);
      if (!element) {
        element = this.createCueElement(cue);
        this.cueElements.set(cue.id, element);
        this.cueLayer.appendChild(element);
      }
      const x = this.timeToX(Math.max(0, cue.start));
      const endX = this.timeToX(Math.min(project.duration, cue.end));
      element.style.left = `${x}px`;
      element.style.width = `${Math.max(20, endX - x)}px`;
      element.style.top = `${this.rowTop(index)}px`;
      element.style.height = `${this.rowHeight()}px`;
      element.dataset.index = String(index);
      element.classList.toggle("selected", cue.id === this.selectedId);
      element.classList.toggle("invalid", this.conflictIds.has(cue.id));
      const label = element.querySelector(".cue-label");
      const text = cue.text.replace(/\n/g, " / ") || "空字幕";
      label.textContent = `${index + 1}  ${text}`;
      element.title = `${formatTime(cue.start)} → ${formatTime(cue.end)}\n${cue.text}`;
    });
    for (const [id, element] of this.cueElements) {
      if (!seen.has(id)) {
        element.remove();
        this.cueElements.delete(id);
      }
    }
  }

  createCueElement(cue) {
    const element = document.createElement("div");
    element.className = "cue-block";
    element.dataset.cueId = cue.id;
    element.tabIndex = 0;
    element.innerHTML = '<span class="cue-handle start"></span><span class="cue-label"></span><span class="cue-handle end"></span>';
    element.addEventListener("pointerdown", (event) => this.onCuePointerDown(event, cue.id));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.callbacks.onSelect?.(cue.id);
      }
    });
    return element;
  }

  updatePlayhead(time) {
    this.playhead.dataset.time = String(time);
    this.playhead.style.left = `${this.timeToX(time)}px`;
  }

  onCanvasPointerDown(event) {
    if (event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    if (event.clientX - rect.left < LABEL_WIDTH) return;
    this.scrub = {
      pointerId: event.pointerId,
      wasPlaying: this.callbacks.onScrubStart?.() || false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.callbacks.onSeek?.(this.xToTime(event.clientX - rect.left));
    event.preventDefault();
  }

  onCuePointerDown(event, cueId) {
    if (event.button !== 0) return;
    const project = this.getProject();
    const cue = project.subtitles.find((item) => item.id === cueId);
    if (!cue) return;
    const handle = event.target.closest(".cue-handle");
    const mode = handle?.classList.contains("start")
      ? "start"
      : handle?.classList.contains("end")
        ? "end"
        : "move";
    const rect = this.canvas.getBoundingClientRect();
    this.drag = {
      cueId,
      mode,
      startX: event.clientX,
      original: { start: cue.start, end: cue.end },
      last: { start: cue.start, end: cue.end },
      pixelsPerSecond:
        (this.cssWidth - LABEL_WIDTH - RIGHT_PAD) / Math.max(0.001, project.duration),
    };
    this.callbacks.onSelect?.(cueId);
    this.cueElements.get(cueId)?.classList.add("dragging");
    this.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  onPointerMove(event) {
    if (this.scrub) {
      const rect = this.canvas.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, LABEL_WIDTH, this.cssWidth - RIGHT_PAD);
      this.callbacks.onSeek?.(this.xToTime(x));
      return;
    }
    if (!this.drag) return;
    const project = this.getProject();
    const delta = (event.clientX - this.drag.startX) / this.drag.pixelsPerSecond;
    const { start, end } = this.drag.original;
    let next;
    if (this.drag.mode === "move") {
      const shift = clamp(delta, -start, project.duration - end);
      next = { start: roundTime(start + shift), end: roundTime(end + shift) };
    } else if (this.drag.mode === "start") {
      next = {
        start: roundTime(clamp(start + delta, 0, end - 0.05)),
        end,
      };
    } else {
      next = {
        start,
        end: roundTime(clamp(end + delta, start + 0.05, project.duration)),
      };
    }
    this.drag.last = next;
    this.callbacks.onCueChange?.(this.drag.cueId, next, "drag");
  }

  onPointerUp() {
    if (this.scrub) {
      this.callbacks.onScrubEnd?.(this.scrub.wasPlaying);
      this.scrub = null;
    }
    if (this.drag) {
      this.cueElements.get(this.drag.cueId)?.classList.remove("dragging");
      this.callbacks.onCueCommit?.(this.drag.cueId, this.drag.original, this.drag.last);
      this.drag = null;
    }
  }

  cancelDrag() {
    if (!this.drag) return;
    this.callbacks.onCueChange?.(this.drag.cueId, this.drag.original, "cancel");
    this.cueElements.get(this.drag.cueId)?.classList.remove("dragging");
    this.drag = null;
  }

  hexAlpha(hex, alpha) {
    const value = String(hex || "#ffb454").replace("#", "");
    const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
    const number = Number.parseInt(full, 16);
    if (!Number.isFinite(number)) return `rgba(255,180,84,${alpha})`;
    return `rgba(${(number >> 16) & 255},${(number >> 8) & 255},${number & 255},${alpha})`;
  }
}
