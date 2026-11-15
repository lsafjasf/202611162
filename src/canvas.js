import { TRACK_DEFS, panLabel } from "./model.js";

const MONO = '"SFMono-Regular", "Roboto Mono", "Liberation Mono", "Noto Sans SC", monospace';
const SANS = '"Noto Sans SC", "Helvetica Neue", "Avenir Next", "Segoe UI", sans-serif';

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
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

function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class SequencerCanvas {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.geometry = null;
    this.hover = null;
    this.selected = { trackId: "kick", step: 0 };
    this.resizeObserver = new ResizeObserver(() => this.drawLast());
    this.resizeObserver.observe(canvas);
    this.lastState = null;
    this.canvas.tabIndex = 0;
    this.bindEvents();
  }

  bindEvents() {
    this.canvas.addEventListener("pointermove", (event) => {
      const hit = this.hitTest(event);
      this.hover = hit;
      this.canvas.style.cursor = hit ? "pointer" : "default";
      this.drawLast();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.drawLast();
    });
    this.canvas.addEventListener("click", (event) => {
      const hit = this.hitTest(event);
      if (!hit) return;
      if (hit.type === "mute") this.callbacks.onMute(hit.trackId);
      else if (hit.type === "label") this.callbacks.onSelectTrack(hit.trackId);
      else {
        this.selected = { trackId: hit.trackId, step: hit.step };
        this.callbacks.onStep(hit.trackId, hit.step, event.detail >= 2);
      }
      this.drawLast();
    });
    this.canvas.addEventListener("keydown", (event) => {
      if (!this.geometry) return;
      const trackIndex = TRACK_DEFS.findIndex((track) => track.id === this.selected.trackId);
      let nextTrack = trackIndex;
      let nextStep = this.selected.step;
      if (event.key === "ArrowLeft") nextStep = (nextStep + 15) % 16;
      else if (event.key === "ArrowRight") nextStep = (nextStep + 1) % 16;
      else if (event.key === "ArrowUp") nextTrack = (trackIndex + 3) % 4;
      else if (event.key === "ArrowDown") nextTrack = (trackIndex + 1) % 4;
      else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.callbacks.onStep(this.selected.trackId, this.selected.step, false);
        return;
      } else return;
      event.preventDefault();
      this.selected = { trackId: TRACK_DEFS[nextTrack].id, step: nextStep };
      this.callbacks.onSelectTrack(this.selected.trackId);
      this.drawLast();
    });
  }

  setSelected(trackId, step) {
    this.selected = { trackId, step };
    this.drawLast();
  }

  hitTest(event) {
    const geometry = this.geometry;
    if (!geometry) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const localY = y - geometry.top;
    if (localY < 0 || localY > geometry.rowsHeight) return null;
    const row = Math.min(3, Math.floor(localY / (geometry.rowHeight + geometry.rowGap)));
    const rowY = geometry.top + row * (geometry.rowHeight + geometry.rowGap);
    if (y > rowY + geometry.rowHeight) return null;
    const def = TRACK_DEFS[row];
    if (x < geometry.labelWidth) {
      if (x > 10 && x < 57 && y > rowY + geometry.rowHeight - 27 && y < rowY + geometry.rowHeight - 9) {
        return { type: "mute", trackId: def.id };
      }
      return { type: "label", trackId: def.id };
    }
    if (x < geometry.gridX || x > geometry.gridX + geometry.gridWidth) return null;
    const step = Math.max(0, Math.min(15, Math.floor((x - geometry.gridX) / (geometry.cellWidth + geometry.cellGap))));
    const cellX = geometry.gridX + step * (geometry.cellWidth + geometry.cellGap);
    if (x > cellX + geometry.cellWidth) return null;
    return { type: "step", trackId: def.id, step };
  }

  draw(state) {
    this.lastState = state;
    const { context, width, height } = fitCanvas(this.canvas);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#141310";
    context.fillRect(0, 0, width, height);

    const header = 34;
    const outerPad = 8;
    const labelWidth = Math.min(136, Math.max(95, width * 0.145));
    const gridX = labelWidth + 10;
    const rightPad = 14;
    const gridWidth = Math.max(160, width - gridX - rightPad);
    const rowGap = 7;
    const rowsHeight = height - header - outerPad;
    const rowHeight = (rowsHeight - rowGap * 3) / 4;
    const cellGap = Math.max(3, Math.min(5, width * 0.004));
    const cellWidth = (gridWidth - cellGap * 15) / 16;
    this.geometry = {
      width,
      height,
      top: header,
      labelWidth,
      gridX,
      gridWidth,
      rowHeight,
      rowGap,
      rowsHeight,
      cellWidth,
      cellGap,
    };

    this.drawHeader(context, state);
    TRACK_DEFS.forEach((def, index) => {
      const y = header + index * (rowHeight + rowGap);
      this.drawTrackRow(context, def, index, y, rowHeight, state);
    });
    this.drawPlayhead(context, state);
  }

  drawHeader(context, state) {
    const { gridX, cellWidth, cellGap, width } = this.geometry;
    const patch = state.patch;
    context.fillStyle = "rgba(255,255,255,0.28)";
    context.font = `7px ${MONO}`;
    context.textAlign = "left";
    context.fillText("VOICE / STEP", 11, 21);
    context.textAlign = "center";
    for (let step = 0; step < 16; step += 1) {
      const x = gridX + step * (cellWidth + cellGap) + cellWidth / 2;
      const strong = step % 4 === 0;
      context.fillStyle = strong ? "rgba(243,237,220,0.62)" : "rgba(243,237,220,0.24)";
      context.fillText(String(step + 1).padStart(2, "0"), x, 20);
      if (strong) {
        context.fillStyle = "rgba(216,255,82,0.18)";
        context.fillRect(gridX + step * (cellWidth + cellGap), 27, cellWidth, 1);
      }
    }
    context.textAlign = "right";
    context.fillStyle = "rgba(243,237,220,0.28)";
    context.fillText(`${patch.bpm} BPM · 4/4`, width - 14, 20);
  }

  drawTrackRow(context, def, index, y, rowHeight, state) {
    const { labelWidth, gridX, cellWidth, cellGap } = this.geometry;
    const track = state.patch.tracks[def.id];
    const isSelected = this.selected.trackId === def.id;
    roundedRect(context, 7, y, labelWidth - 2, rowHeight, 5);
    context.fillStyle = isSelected ? withAlpha(def.color, 0.075) : "rgba(255,255,255,0.024)";
    context.fill();
    context.strokeStyle = isSelected ? withAlpha(def.color, 0.35) : "rgba(255,255,255,0.05)";
    context.stroke();

    context.fillStyle = def.color;
    context.globalAlpha = track.mute ? 0.25 : 1;
    roundedRect(context, 7, y + 9, 2, rowHeight - 18, 1);
    context.fill();
    context.globalAlpha = 1;

    context.textAlign = "left";
    context.fillStyle = track.mute ? "rgba(243,237,220,0.3)" : "rgba(243,237,220,0.92)";
    context.font = `600 ${Math.max(9, Math.min(11, rowHeight * 0.13))}px ${MONO}`;
    context.fillText(def.name, 17, y + 22);
    context.fillStyle = "rgba(243,237,220,0.33)";
    context.font = `7px ${SANS}`;
    context.fillText(def.cn, 17, y + 36);

    const tune = def.id === "kick" ? `${track.tune} Hz` : (def.id === "hat" ? `${(track.tune / 1000).toFixed(1)} kHz` : `${track.tune} Hz`);
    context.fillStyle = "rgba(243,237,220,0.28)";
    context.font = `6px ${MONO}`;
    context.fillText(tune, 17, y + rowHeight - 27);
    context.fillText(panLabel(track.pan), 17, y + rowHeight - 18);

    const muteX = 16;
    const muteY = y + rowHeight - 38;
    roundedRect(context, muteX, muteY, 30, 14, 2);
    context.fillStyle = track.mute ? withAlpha(def.color, 0.18) : "rgba(255,255,255,0.035)";
    context.fill();
    context.strokeStyle = track.mute ? withAlpha(def.color, 0.5) : "rgba(255,255,255,0.08)";
    context.stroke();
    context.fillStyle = track.mute ? def.color : "rgba(243,237,220,0.33)";
    context.font = `6px ${MONO}`;
    context.textAlign = "center";
    context.fillText(track.mute ? "MUTED" : "MUTE", muteX + 15, muteY + 9);

    for (let step = 0; step < 16; step += 1) {
      const x = gridX + step * (cellWidth + cellGap);
      this.drawStepCell(context, def, track, step, x, y + 2, cellWidth, rowHeight - 4, state);
    }
  }

  drawStepCell(context, def, track, step, x, y, width, height, state) {
    const note = track.steps[step];
    const selected = this.selected.trackId === def.id && this.selected.step === step;
    const hovered = this.hover?.type === "step"
      && this.hover.trackId === def.id
      && this.hover.step === step;
    const group = Math.floor(step / 4) % 2 === 0;
    roundedRect(context, x, y, width, height, 3);
    context.fillStyle = group ? "rgba(255,255,255,0.042)" : "rgba(255,255,255,0.027)";
    context.fill();

    if (note.on) {
      const normalized = Math.max(0.12, Math.min(1, note.velocity / 127));
      const fillHeight = height * (0.3 + normalized * 0.64);
      context.save();
      roundedRect(context, x + 1, y + 1, width - 2, height - 2, 2.5);
      context.clip();
      const gradient = context.createLinearGradient(0, y + height, 0, y + height - fillHeight);
      gradient.addColorStop(0, withAlpha(def.color, track.mute ? 0.08 : 0.26));
      gradient.addColorStop(1, withAlpha(def.color, track.mute ? 0.14 : note.probability < 100 ? 0.5 : 0.68));
      context.fillStyle = gradient;
      context.fillRect(x + 1, y + height - fillHeight, width - 2, fillHeight);
      context.fillStyle = withAlpha(def.color, track.mute ? 0.2 : 0.92);
      context.fillRect(x + 1, y + height - fillHeight, width - 2, 1.5);
      if (note.probability < 100) {
        context.strokeStyle = withAlpha(def.color, 0.2);
        context.lineWidth = 1;
        context.beginPath();
        for (let stripe = -height; stripe < width; stripe += 7) {
          context.moveTo(x + stripe, y + height);
          context.lineTo(x + stripe + height, y);
        }
        context.stroke();
      }
      context.restore();
      context.fillStyle = "rgba(243,237,220,0.82)";
      context.font = `6px ${MONO}`;
      context.textAlign = "left";
      context.fillText(`P${note.probability}`, x + 4, y + 11);
      context.fillStyle = withAlpha(def.color, 0.9);
      context.textAlign = "right";
      context.fillText(String(note.velocity), x + width - 4, y + height - 5);
    } else {
      context.fillStyle = "rgba(243,237,220,0.13)";
      context.beginPath();
      context.arc(x + width / 2, y + height / 2, 1.1, 0, Math.PI * 2);
      context.fill();
    }

    if (hovered) {
      context.strokeStyle = "rgba(243,237,220,0.34)";
      context.lineWidth = 1;
      roundedRect(context, x + 0.5, y + 0.5, width - 1, height - 1, 3);
      context.stroke();
    }
    if (selected) {
      context.strokeStyle = "#f3eddc";
      context.lineWidth = 1.5;
      roundedRect(context, x + 0.75, y + 0.75, width - 1.5, height - 1.5, 3);
      context.stroke();
      context.fillStyle = "#f3eddc";
      context.fillRect(x + width - 8, y + 3, 4, 1);
    }
  }

  drawPlayhead(context, state) {
    if (state.visual.step < 0) return;
    const { gridX, cellWidth, cellGap, top, rowsHeight } = this.geometry;
    const x = gridX + state.visual.step * (cellWidth + cellGap);
    context.save();
    context.globalAlpha = 0.12 + state.visual.flash * 0.35;
    context.fillStyle = "#d8ff52";
    roundedRect(context, x - 1, top - 5, cellWidth + cellGap, rowsHeight + 6, 3);
    context.fill();
    context.globalAlpha = 0.65 + state.visual.flash * 0.35;
    context.fillStyle = "#d8ff52";
    context.fillRect(x + cellWidth / 2 - 1, 28, 2, rowsHeight + 3);
    context.restore();
  }

  drawLast() {
    if (this.lastState) this.draw(this.lastState);
  }
}

export class MeterCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.lastMetrics = null;
    this.resizeObserver = new ResizeObserver(() => this.draw(this.lastMetrics));
    this.resizeObserver.observe(canvas);
  }

  draw(metrics) {
    if (!metrics) return;
    this.lastMetrics = metrics;
    const { context, width, height } = fitCanvas(this.canvas);
    context.clearRect(0, 0, width, height);
    const labelWidth = 22;
    const rightPad = 27;
    const rowHeight = 41;
    const top = 18;
    const barWidth = Math.max(80, width - labelWidth - rightPad);
    const segments = Math.max(24, Math.floor(barWidth / 8));
    const gap = 2;
    const segmentWidth = (barWidth - gap * (segments - 1)) / segments;
    const channels = [
      { label: "L", value: metrics.left, color: "#86e8c2" },
      { label: "R", value: metrics.right, color: "#d8ff52" },
    ];

    context.font = `7px ${MONO}`;
    context.textAlign = "left";
    context.fillStyle = "rgba(243,237,220,0.24)";
    for (const db of [-48, -36, -24, -12, -6, 0]) {
      const x = labelWidth + ((db + 60) / 60) * barWidth;
      context.fillRect(x, 9, 1, 4);
    }
    context.fillText("-60", labelWidth - 1, 8);
    context.textAlign = "right";
    context.fillText("0 dB", labelWidth + barWidth, 8);

    channels.forEach((channel, row) => {
      const y = top + row * rowHeight;
      const normalized = Math.max(0, Math.min(1, (channel.value + 60) / 60));
      const lit = Math.round(normalized * segments);
      context.fillStyle = "rgba(243,237,220,0.5)";
      context.font = `600 9px ${MONO}`;
      context.textAlign = "left";
      context.fillText(channel.label, 2, y + 14);
      for (let segment = 0; segment < segments; segment += 1) {
        const x = labelWidth + segment * (segmentWidth + gap);
        const ratio = segment / segments;
        roundedRect(context, x, y + 1, segmentWidth, 17, 1);
        if (segment < lit && Number.isFinite(channel.value)) {
          const color = ratio > 0.9 ? "#ff5d51" : ratio > 0.71 ? "#ffc34d" : channel.color;
          context.fillStyle = color;
          context.globalAlpha = 0.38 + (segment / segments) * 0.62;
          context.fill();
          context.globalAlpha = 1;
          context.shadowColor = color;
          context.shadowBlur = segment > segments - 4 ? 7 : 0;
          context.fill();
          context.shadowBlur = 0;
        } else {
          context.fillStyle = "rgba(243,237,220,0.055)";
          context.fill();
        }
      }
      context.textAlign = "right";
      context.fillStyle = "rgba(243,237,220,0.62)";
      context.font = `7px ${MONO}`;
      context.fillText(formatDb(channel.value), width - 1, y + 13);
      const balanceX = labelWidth + ((metrics.pan + 1) / 2) * barWidth;
      if (row === 1) {
        context.fillStyle = "rgba(216,255,82,0.8)";
        context.fillRect(balanceX, y - 2, 1, 23);
      }
    });

    context.fillStyle = "rgba(243,237,220,0.25)";
    context.font = `6px ${MONO}`;
    context.textAlign = "left";
    context.fillText("RMS", 2, top + 70);
    context.fillText(metrics.hasSignal ? "SIGNAL / STEREO" : "NO SIGNAL", labelWidth, top + 70);
    context.textAlign = "right";
    context.fillText(`PEAK ${formatDb(metrics.peak)}`, width - 1, top + 70);
  }
}

export function drawFrequencySpark(canvas, history) {
  const { context, width, height } = fitCanvas(canvas);
  context.clearRect(0, 0, width, height);
  if (!history.length) return;
  const min = 28;
  const max = 120;
  context.beginPath();
  history.forEach((value, index) => {
    const x = (index / (history.length - 1)) * width;
    const normalized = value > 0 ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
    const y = height - normalized * (height - 3) - 1;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "rgba(216,255,82,0.55)";
  context.lineWidth = 1;
  context.stroke();
}

export function drawWaveform(canvas, buffer) {
  if (!buffer) return;
  const { context, width, height } = fitCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : data;
  const columns = Math.max(80, Math.floor(width));
  const step = Math.max(1, Math.floor(data.length / columns));
  context.strokeStyle = "rgba(255,107,70,0.8)";
  context.lineWidth = 1;
  context.beginPath();
  for (let column = 0; column < columns; column += 1) {
    const offset = column * step;
    let peak = 0;
    for (let index = 0; index < step; index += 16) {
      const sample = ((data[offset + index] || 0) + (second[offset + index] || 0)) * 0.5;
      peak = Math.max(peak, Math.abs(sample));
    }
    const x = (column / columns) * width;
    const amplitude = Math.min(1, peak * 1.8) * (height / 2 - 2);
    context.moveTo(x, height / 2 - amplitude);
    context.lineTo(x, height / 2 + amplitude);
  }
  context.stroke();
  context.strokeStyle = "rgba(243,237,220,0.08)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
}

function formatDb(value) {
  if (!Number.isFinite(value)) return "−∞";
  return `${value.toFixed(1)}`;
}
