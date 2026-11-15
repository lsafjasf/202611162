import { TIMELINE_DURATION } from './audio.js';

// Renders timeline grid, three cue lanes, draggable word ticks, the playhead
// and the synthesized stereo waveform. Everything is drawn on a 2D canvas.
export class TimelineCanvas {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.cues = [];
    this.waveform = null; // {left: Float32Array, right: Float32Array}
    this.duration = TIMELINE_DURATION;
    this.hover = null;
    this.drag = null;
    this.padLeft = 12;
    this.padRight = 12;
    this.laneHeight = 64;
    this.waveHeight = 96;
    this.headerHeight = 26;
    this.bindPointer();
  }

  setCues(cues) {
    this.cues = cues;
    this.draw(0);
  }

  setWaveform(waveform) {
    this.waveform = waveform;
    this.draw(0);
  }

  get width() {
    return this.canvas.width;
  }

  timeToX(time) {
    const usable = this.width - this.padLeft - this.padRight;
    return this.padLeft + (time / this.duration) * usable;
  }

  xToTime(x) {
    const usable = this.width - this.padLeft - this.padRight;
    return Math.max(0, Math.min(this.duration, ((x - this.padLeft) / usable) * this.duration));
  }

  laneY(index) {
    return this.headerHeight + index * (this.laneHeight + 8);
  }

  hitTest(x, y) {
    for (let i = 0; i < this.cues.length; i += 1) {
      const cue = this.cues[i];
      const top = this.laneY(i);
      const x0 = this.timeToX(cue.start);
      const x1 = this.timeToX(cue.end);
      if (y >= top && y <= top + this.laneHeight && x >= x0 && x <= x1) {
        if (Math.abs(x - x0) < 7) return { cueIndex: i, kind: 'resize-left' };
        if (Math.abs(x - x1) < 7) return { cueIndex: i, kind: 'resize-right' };
        for (let w = 0; w < cue.words.length; w += 1) {
          const wx = this.timeToX(cue.words[w].start);
          if (Math.abs(x - wx) < 7 && y > top + this.laneHeight - 26) {
            return { cueIndex: i, kind: 'word', wordIndex: w };
          }
        }
        return { cueIndex: i, kind: 'move' };
      }
    }
    return null;
  }

  bindPointer() {
    this.canvas.addEventListener('pointerdown', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = this.hitTest(x, y);
      if (hit) {
        this.drag = { ...hit, startX: x };
        this.canvas.setPointerCapture(event.pointerId);
      } else if (this.callbacks.onSeek) {
        this.callbacks.onSeek(this.xToTime(x));
      }
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (this.drag) {
        this.callbacks.onDrag(this.drag, this.xToTime(x));
      } else {
        this.hover = this.hitTest(x, y);
        this.canvas.style.cursor = this.hover ? 'grab' : 'default';
      }
    });
    const endDrag = (event) => {
      if (this.drag) {
        this.callbacks.onDragEnd(this.drag);
        this.drag = null;
        try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  draw(playhead) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#26304a';
    ctx.fillStyle = '#8fa3c8';
    ctx.font = '11px monospace';
    for (let t = 0; t <= this.duration; t += 1) {
      const x = this.timeToX(t);
      ctx.beginPath();
      ctx.moveTo(x, this.headerHeight - 6);
      ctx.lineTo(x, h - 8);
      ctx.stroke();
      ctx.fillText(`${t}s`, x + 3, this.headerHeight - 10);
    }

    this.cues.forEach((cue, index) => {
      const top = this.laneY(index);
      const x0 = this.timeToX(cue.start);
      const x1 = this.timeToX(cue.end);
      ctx.fillStyle = index === this.drag?.cueIndex ? '#2d4a7a' : '#1d3357';
      ctx.strokeStyle = '#5b8bd6';
      this.roundRect(x0, top, x1 - x0, this.laneHeight, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cfe0ff';
      ctx.font = '13px sans-serif';
      ctx.fillText(`${cue.id}  ${cue.start.toFixed(2)}–${cue.end.toFixed(2)}s`, x0 + 8, top + 18);
      cue.words.forEach((word, wordIndex) => {
        const wx = this.timeToX(word.start);
        ctx.strokeStyle = wordIndex === this.drag?.wordIndex && this.drag?.cueIndex === index ? '#ffd166' : '#7ee0c1';
        ctx.beginPath();
        ctx.moveTo(wx, top + this.laneHeight - 24);
        ctx.lineTo(wx, top + this.laneHeight - 4);
        ctx.stroke();
        ctx.fillStyle = '#d8fff3';
        ctx.font = '12px sans-serif';
        ctx.fillText(word.text, wx + 4, top + this.laneHeight - 9);
      });
      ctx.fillStyle = '#9fc0f2';
      ctx.fillRect(x0 - 3, top, 6, this.laneHeight);
      ctx.fillRect(x1 - 3, top, 6, this.laneHeight);
    });

    this.drawWaveform();

    const px = this.timeToX(playhead);
    ctx.strokeStyle = '#ff5d73';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, this.headerHeight - 6);
    ctx.lineTo(px, h - 8);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  drawWaveform() {
    if (!this.waveform) return;
    const ctx = this.ctx;
    const top = this.laneY(this.cues.length) + 12;
    const center = top + this.waveHeight / 2;
    const usable = this.width - this.padLeft - this.padRight;
    const { left, right } = this.waveform;
    ctx.fillStyle = '#141c2e';
    ctx.fillRect(this.padLeft, top, usable, this.waveHeight);
    ctx.strokeStyle = '#2c3b5c';
    ctx.beginPath();
    ctx.moveTo(this.padLeft, center);
    ctx.lineTo(this.padLeft + usable, center);
    ctx.stroke();
    const step = Math.max(1, Math.floor(left.length / usable));
    for (let x = 0; x < usable; x += 1) {
      const idx = Math.min(left.length - 1, x * step);
      const lv = left[idx] * (this.waveHeight / 2 - 4);
      const rv = right[idx] * (this.waveHeight / 2 - 4);
      ctx.strokeStyle = '#5b8bd6';
      ctx.beginPath();
      ctx.moveTo(this.padLeft + x, center - lv);
      ctx.lineTo(this.padLeft + x, center + lv);
      ctx.stroke();
      ctx.strokeStyle = '#e07aa8';
      ctx.beginPath();
      ctx.moveTo(this.padLeft + x, center - rv);
      ctx.lineTo(this.padLeft + x, center + rv);
      ctx.stroke();
    }
    ctx.fillStyle = '#8fa3c8';
    ctx.font = '11px monospace';
    ctx.fillText('L', this.padLeft, top - 4);
    ctx.fillText('R', this.padLeft + 16, top - 4);
  }

  roundRect(x, y, width, height, radius) {
    const ctx = this.ctx;
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
}
