import { AudioEngine } from './engine.js';
import { TimelineCanvas } from './canvas.js';
import { makeParams, DEFAULT_PARAMS, TIMELINE_DURATION } from './audio.js';
import {
  defaultCues,
  validateCues,
  moveCue,
  resizeCue,
  moveWord,
  exportVtt,
  importVtt,
} from './subtitles.js';
import {
  serializeSession,
  parseSession,
  saveLocal,
  loadLocal,
  clearLocal,
  downloadBlob,
} from './storage.js';

const PARAM_FIELDS = [
  { key: 'frequency', label: '频率 Hz', min: 80, max: 1600, step: 1, unit: 'Hz' },
  { key: 'pan', label: '声道 L/R', min: -1, max: 1, step: 0.01, unit: '' },
  { key: 'delayMs', label: '延迟 ms', min: 0, max: 600, step: 5, unit: 'ms' },
  { key: 'beatHz', label: '节拍 b/s', min: 1, max: 12, step: 0.5, unit: '/s' },
  { key: 'gain', label: '增益', min: 0.02, max: 0.95, step: 0.01, unit: '' },
  { key: 'beats', label: '提示音数', min: 1, max: 6, step: 1, unit: '' },
];

class StudioApp {
  constructor() {
    this.engine = new AudioEngine();
    this.cues = defaultCues();
    this.paramsById = new Map(this.cues.map((cue) => [cue.id, makeParams()]));
    this.selectedCue = this.cues[0].id;
    this.dirty = false;
    this.rafId = 0;
    this.lastExport = null;
  }

  init() {
    this.canvasEl = document.getElementById('timeline');
    this.resizeCanvas();
    this.timeline = new TimelineCanvas(this.canvasEl, {
      onDrag: (hit, time) => this.handleDrag(hit, time),
      onDragEnd: () => this.handleDragEnd(),
      onSeek: (time) => this.seek(time),
    });
    this.buildParamPanel();
    this.bindTransport();
    this.bindFileButtons();
    this.bindCueSelector();
    this.timeline.setCues(this.cues);
    this.refreshParamPanel();
    this.refreshMeters();
    this.renderValidation();
    this.loop();
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.timeline.setCues(this.cues);
    });
  }

  resizeCanvas() {
    const width = this.canvasEl.parentElement.clientWidth - 24;
    const height = 3 * 72 + 8 + 120 + 40;
    this.canvasEl.width = width;
    this.canvasEl.height = height;
    this.canvasEl.style.width = `${width}px`;
    this.canvasEl.style.height = `${height}px`;
  }

  currentParams() {
    return this.paramsById.get(this.selectedCue);
  }

  currentCue() {
    return this.cues.find((cue) => cue.id === this.selectedCue);
  }

  buildParamPanel() {
    const panel = document.getElementById('param-fields');
    panel.innerHTML = PARAM_FIELDS.map((field) => `
      <label class="param-row" data-key="${field.key}">
        <span class="param-label">${field.label}</span>
        <input type="range" min="${field.min}" max="${field.max}" step="${field.step}"
               id="range-${field.key}" aria-label="${field.label}">
        <output id="value-${field.key}" class="param-value"></output>
      </label>`).join('');
    for (const field of PARAM_FIELDS) {
      document.getElementById(`range-${field.key}`).addEventListener('input', (event) => {
        const value = Number(event.target.value);
        this.currentParams()[field.key] = value;
        this.dirty = true;
        this.refreshParamPanel();
        this.previewCue();
      });
    }
    document.getElementById('reset-params').addEventListener('click', () => this.resetParams());
  }

  refreshParamPanel() {
    const params = this.currentParams();
    for (const field of PARAM_FIELDS) {
      const value = params[field.key];
      document.getElementById(`range-${field.key}`).value = value;
      document.getElementById(`value-${field.key}`).textContent =
        `${field.key === 'frequency' || field.key === 'delayMs' ? Math.round(value) : value}${field.unit}`;
    }
    document.getElementById('selected-cue-name').textContent = this.selectedCue;
  }

  resetParams() {
    this.paramsById.set(this.selectedCue, makeParams());
    this.dirty = true;
    this.refreshParamPanel();
    this.previewCue();
    this.log(`参数已重置: ${this.selectedCue}`);
  }

  bindCueSelector() {
    const select = document.getElementById('cue-select');
    select.innerHTML = this.cues
      .map((cue) => `<option value="${cue.id}">${cue.id} — ${cue.words.map((w) => w.text).join('')}</option>`)
      .join('');
    select.value = this.selectedCue;
    select.addEventListener('change', (event) => {
      this.selectedCue = event.target.value;
      this.refreshParamPanel();
    });
  }

  refreshMeters() {
    const meters = this.engine.readMeters();
    document.getElementById('meter-l').textContent = meters.peakL.toFixed(3);
    document.getElementById('meter-r').textContent = meters.peakR.toFixed(3);
    document.getElementById('meter-freq').textContent =
      meters.frequency > 0 ? `${meters.frequency.toFixed(1)} Hz` : '—';
    document.getElementById('meter-pan').textContent =
      this.currentParams().pan.toFixed(2);
    document.getElementById('meter-delay').textContent =
      `${Math.round(this.currentParams().delayMs)} ms`;
    return meters;
  }

  loop() {
    this.timeline.draw(this.engine.position);
    this.refreshMeters();
    if (this.engine.playing && this.engine.position >= TIMELINE_DURATION) {
      this.engine.stop();
      document.getElementById('play-btn').textContent = '播放';
    }
    this.rafId = requestAnimationFrame(() => this.loop());
  }

  log(message, kind = 'info') {
    const list = document.getElementById('event-log');
    const item = document.createElement('div');
    item.className = `log-item log-${kind}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    list.prepend(item);
  }

  bindTransport() {
    document.getElementById('play-btn').addEventListener('click', () => this.togglePlay());
    document.getElementById('pause-btn').addEventListener('click', async () => {
      await this.engine.pause();
      this.log('已暂停');
    });
    document.getElementById('replay-btn').addEventListener('click', () => this.replay());
  }

  async togglePlay() {
    if (this.engine.paused) {
      await this.engine.resume();
      this.log('继续播放');
      return;
    }
    if (this.engine.playing) {
      this.engine.stop();
      document.getElementById('play-btn').textContent = '播放';
      return;
    }
    await this.engine.play(this.cues, this.paramsById, this.engine.position);
    document.getElementById('play-btn').textContent = '停止';
    this.log('开始播放（Web Audio 实时合成）');
  }

  async replay() {
    await this.engine.play(this.cues, this.paramsById, 0);
    document.getElementById('play-btn').textContent = '停止';
    this.log('从头重播');
  }

  seek(time) {
    this.engine.offset = time;
    if (!this.engine.playing) this.timeline.draw(time);
  }

  // Re-synthesize just the selected cue so every parameter change is audible
  // immediately, not only reflected in the numeric readouts.
  previewCue() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(async () => {
      const cue = this.currentCue();
      await this.engine.ensureContext();
      await this.engine.play([cue], new Map([[cue.id, this.currentParams()]]), cue.start);
    }, 120);
  }

  handleDrag(hit, time) {
    const cue = this.cues[hit.cueIndex];
    const original = structuredClone(this.cues);
    if (hit.kind === 'move') {
      const length = cue.end - cue.start;
      const start = Math.max(0, Math.min(TIMELINE_DURATION - length, time));
      this.cues[hit.cueIndex] = moveCue(cue, start, start + length);
    } else if (hit.kind === 'resize-left') {
      const start = Math.min(time, cue.end - 0.1);
      this.cues[hit.cueIndex] = resizeCue(cue, start, cue.end);
    } else if (hit.kind === 'resize-right') {
      const end = Math.max(time, cue.start + 0.1);
      this.cues[hit.cueIndex] = resizeCue(cue, cue.start, end);
    } else if (hit.kind === 'word') {
      const word = cue.words[hit.wordIndex];
      const length = word.end - word.start;
      const start = Math.max(cue.start, Math.min(cue.end - length, time));
      this.cues[hit.cueIndex] = moveWord(cue, hit.wordIndex, start, start + length);
    }
    if (validateCues(this.cues).length > 0) {
      this.cues = original;
    }
    this.timeline.setCues(this.cues);
    this.renderValidation();
  }

  handleDragEnd() {
    this.dirty = true;
    this.log('时间轴已调整');
  }

  renderValidation() {
    const errors = validateCues(this.cues);
    const box = document.getElementById('validation');
    box.innerHTML = errors.length
      ? errors.map((error) => `<div class="log-error">${error}</div>`).join('')
      : '<div class="log-ok">校验通过：无重叠、无越界、词均在入出点内</div>';
    return errors;
  }

  bindFileButtons() {
    document.getElementById('save-btn').addEventListener('click', () => this.saveSession());
    document.getElementById('reload-btn').addEventListener('click', () => this.reloadSession());
    document.getElementById('vtt-btn').addEventListener('click', () => this.exportVttFile());
    document.getElementById('vtt-file').addEventListener('change', (event) => this.importVttFile(event));
    document.getElementById('wav-btn').addEventListener('click', () => this.exportWav());
    document.getElementById('render-wave-btn').addEventListener('click', () => this.renderWaveform());
  }

  saveSession() {
    const errors = this.renderValidation();
    if (errors.length) {
      this.log(`保存被阻止：${errors.length} 个校验错误`, 'error');
      return false;
    }
    const text = serializeSession(this.cues, this.paramsById);
    saveLocal(text);
    downloadBlob(new Blob([text], { type: 'application/json' }), 'cue-session.json');
    this.dirty = false;
    this.log('会话参数已保存（localStorage + JSON 文件）', 'ok');
    return true;
  }

  reloadSession() {
    const stored = loadLocal();
    if (!stored) {
      this.log('没有可载入的已保存参数', 'error');
      return false;
    }
    this.applySession(stored);
    this.log('已从保存的参数重新载入', 'ok');
    return true;
  }

  applySession(stored) {
    this.cues = stored.cues.map((cue) => ({
      ...cue,
      words: cue.words.map((word) => ({ ...word })),
    }));
    this.paramsById = new Map(
      Object.entries(stored.params).map(([id, params]) => [id, makeParams(params)]),
    );
    this.selectedCue = this.cues[0].id;
    document.getElementById('cue-select').value = this.selectedCue;
    this.timeline.setCues(this.cues);
    this.refreshParamPanel();
    this.renderValidation();
  }

  exportVttFile() {
    const errors = this.renderValidation();
    if (errors.length) {
      this.log('VTT 导出被阻止：存在校验错误', 'error');
      return;
    }
    const text = exportVtt(this.cues);
    downloadBlob(new Blob([text], { type: 'text/vtt' }), 'subtitles.vtt');
    this.lastVtt = text;
    this.log('WebVTT 已导出（内嵌词时间戳）', 'ok');
  }

  async importVttFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const restored = importVtt(text);
      const errors = validateCues(restored);
      if (errors.length) throw new Error(errors.join('; '));
      this.cues = restored;
      for (const cue of restored) {
        if (!this.paramsById.has(cue.id)) this.paramsById.set(cue.id, makeParams());
      }
      this.selectedCue = restored[0].id;
      this.bindCueSelector();
      this.timeline.setCues(this.cues);
      this.renderValidation();
      this.log('VTT 重新导入：字幕与词时间完整恢复', 'ok');
    } catch (error) {
      this.log(`VTT 导入失败：${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  }

  async renderWaveform() {
    const { buffer } = await this.engine.renderOffline(this.cues, this.paramsById);
    this.timeline.setWaveform({
      left: buffer.getChannelData(0),
      right: buffer.getChannelData(1),
    });
    this.log('波形已由离线 Web Audio 渲染并绘制到 Canvas', 'ok');
    return buffer;
  }

  async exportWav() {
    const errors = this.renderValidation();
    if (errors.length) {
      this.log('导出被阻止：字幕校验未通过', 'error');
      return null;
    }
    const { buffer, report, blob } = await this.engine.renderOffline(this.cues, this.paramsById);
    const checkBox = document.getElementById('export-checks');
    if (!report.ok) {
      checkBox.innerHTML = [
        report.silent ? '<div class="log-error">检查失败：静音</div>' : '',
        report.clipping ? `<div class="log-error">检查失败：削波 (L ${report.clipSamplesL} / R ${report.clipSamplesR} 样本)</div>` : '',
        report.missingChannel ? '<div class="log-error">检查失败：声道缺失</div>' : '',
      ].join('');
      this.log('导出中止：未通过静音/削波/声道检查', 'error');
      return null;
    }
    checkBox.innerHTML = `<div class="log-ok">检查通过：峰值 L ${report.peakL.toFixed(4)} / R ${report.peakR.toFixed(4)}，时长 ${report.duration.toFixed(3)}s</div>`;
    downloadBlob(blob, 'cues.wav');
    this.lastExport = { report, blob, buffer };
    this.log('WAV 已导出，三项导出前检查全部通过', 'ok');
    return { buffer, report, blob };
  }
}

const app = new StudioApp();
window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
