// 应用主控：画布叠加、视图变换、标注锚定、撤销、重算对比、截图、导出
import { toGrayscale } from './geometry.mjs';
import { vectorize } from './vectorize.mjs';
import { FramePlayer, grayFromCanvas } from './imagegen.mjs';
import {
  DEFAULT_PARAMS, PARAM_SCHEMA, validateParams,
  listPresets, savePreset, loadPreset, deletePreset,
} from './params.mjs';

const W = 400;
const H = 420;

export class App {
  constructor(elements) {
    this.el = elements;
    this.sourceCanvas = document.createElement('canvas');
    this.sourceCanvas.width = W;
    this.sourceCanvas.height = H;
    this.params = { ...DEFAULT_PARAMS };
    this.result = null;
    this.undoStack = [];
    this.view = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    this.annotations = [];
    this.player = new FramePlayer(this.sourceCanvas, {
      intervalMs: 150,
      onFrame: (frame) => this.onSourceFrame(frame),
    });
    this.lastRenderInfo = null;
    this.bindUI();
    this.refreshControls();
    this.player.start();
  }

  bindUI() {
    for (const key of Object.keys(PARAM_SCHEMA)) {
      const slider = this.el[`${key}Range`];
      const number = this.el[`${key}Number`];
      slider.addEventListener('input', () => this.setParam(key, slider.value, { skipSlider: true }));
      number.addEventListener('change', () => this.setParam(key, number.value, { skipNumber: true }));
    }
    this.el.recomputeBtn.addEventListener('click', () => this.recomputeWithCompare());
    this.el.undoBtn.addEventListener('click', () => this.undo());
    this.el.playBtn.addEventListener('click', () => this.togglePlay());
    this.el.exportBtn.addEventListener('click', () => this.exportSvg());
    this.el.shotBtn.addEventListener('click', () => this.takeScreenshot());
    this.el.zoomInBtn.addEventListener('click', () => this.zoomBy(1.2));
    this.el.zoomOutBtn.addEventListener('click', () => this.zoomBy(1 / 1.2));
    this.el.rotateCwBtn.addEventListener('click', () => this.rotateBy(Math.PI / 12));
    this.el.rotateCcwBtn.addEventListener('click', () => this.rotateBy(-Math.PI / 12));
    this.el.resetViewBtn.addEventListener('click', () => this.resetView());
    this.el.savePresetBtn.addEventListener('click', () => this.saveCurrentPreset());
    this.el.loadPresetBtn.addEventListener('click', () => this.loadSelectedPreset());
    this.el.deletePresetBtn.addEventListener('click', () => this.removeSelectedPreset());
    this.el.addAnnotationBtn.addEventListener('click', () => this.addAnnotation());
  }

  setParam(key, raw, opts = {}) {
    const candidate = { ...this.params, [key]: raw === '' ? raw : Number(raw) };
    const check = validateParams(candidate);
    if (!check.ok) {
      this.showError(check.errors.join('；'));
      this.refreshControls();
      return;
    }
    this.hideError();
    this.pushUndo();
    this.params = check.params;
    this.refreshControls(opts);
    this.runVectorize();
  }

  refreshControls(skip = {}) {
    for (const key of Object.keys(PARAM_SCHEMA)) {
      if (!skip.skipSlider) this.el[`${key}Range`].value = this.params[key];
      if (!skip.skipNumber) this.el[`${key}Number`].value = this.params[key];
    }
    this.el.undoBtn.disabled = this.undoStack.length === 0;
  }

  pushUndo() {
    this.undoStack.push({
      params: { ...this.params },
      result: this.snapshotResult(),
      view: { ...this.view },
    });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.refreshControls();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.params = { ...entry.params };
    this.view = { ...entry.view };
    this.result = entry.result;
    this.refreshControls();
    this.hideError();
    this.render();
    this.flashStatus(`已撤销：阈值=${this.params.threshold} 平滑=${this.params.smoothness} 最小区域=${this.params.minArea}`);
  }

  snapshotResult() {
    return this.result ? JSON.parse(JSON.stringify({
      shapes: this.result.shapes, stats: this.result.stats, summary: this.result.summary, svg: this.result.svg,
    })) : null;
  }

  onSourceFrame(frame) {
    this.currentFrame = frame;
    this.runVectorize();
  }

  runVectorize() {
    const check = validateParams(this.params);
    if (!check.ok) {
      this.showError(check.errors.join('；'));
      return;
    }
    try {
      const imageData = grayFromCanvas(this.sourceCanvas);
      const grayLike = toGrayscale(imageData);
      this.result = vectorize(grayLike, check.params);
      this.render();
      this.updateStats();
    } catch (err) {
      this.showError(`重算失败: ${err.message}`);
    }
  }

  // 重算并比较重算前后的对象数量、几何位置与导出图片
  recomputeWithCompare() {
    const before = this.snapshotResult();
    const beforeFrame = this.currentFrame;
    this.runVectorize();
    const after = this.snapshotResult();
    const diff = compareResults(before, after);
    diff.frame = { before: beforeFrame, after: this.currentFrame };
    this.lastCompare = diff;
    this.el.comparePanel.textContent = JSON.stringify(diff, null, 2);
    return diff;
  }

  togglePlay() {
    if (this.player.running) {
      this.player.pause();
      this.el.playBtn.textContent = '恢复';
      this.flashStatus(`已暂停于帧 ${this.player.frame}，画面冻结`);
    } else {
      const frozen = this.player.frame;
      this.player.resume();
      this.el.playBtn.textContent = '暂停';
      this.flashStatus(`从帧 ${frozen} 恢复，未跳帧`);
    }
  }

  zoomBy(factor) {
    this.pushUndo();
    this.view.scale = Math.min(6, Math.max(0.25, this.view.scale * factor));
    this.render();
  }

  rotateBy(rad) {
    this.pushUndo();
    this.view.rotation += rad;
    this.render();
  }

  resetView() {
    this.pushUndo();
    this.view = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    this.render();
  }

  addAnnotation() {
    if (!this.result || !this.result.shapes.length) {
      this.showError('暂无可标注的几何对象');
      return;
    }
    const idx = this.annotations.length % this.result.shapes.length;
    const shape = this.result.shapes[idx];
    this.pushUndo();
    this.annotations.push({
      id: `ann_${this.annotations.length + 1}`,
      shapeId: shape.id,
      anchor: { ...shape.centroid },
      text: `A${this.annotations.length + 1}`,
    });
    this.render();
  }

  // 固定分层与透明度：底图 -> 半透明原图 -> 矢量叠加 -> 标注，顺序永不改变
  render() {
    const ctx = this.el.canvas.getContext('2d');
    const cw = this.el.canvas.width, ch = this.el.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    const cx = cw / 2 + this.view.tx, cy = ch / 2 + this.view.ty;
    ctx.translate(cx, cy);
    ctx.rotate(this.view.rotation);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.translate(-W / 2, -H / 2);

    ctx.globalAlpha = 0.42;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sourceCanvas, 0, 0);
    ctx.globalAlpha = 1;

    if (this.result) {
      for (const shape of this.result.shapes) {
        const path = new Path2D(shape.d);
        ctx.fillStyle = 'rgba(220, 40, 40, 0.30)';
        ctx.fill(path);
        ctx.strokeStyle = 'rgba(0, 90, 220, 0.95)';
        ctx.lineWidth = 1 / this.view.scale;
        ctx.stroke(path);
      }
      // 标注：锚点跟随同一变换矩阵，文字反向旋转保证可读且不漂移
      for (const ann of this.annotations) {
        const ax = ann.anchor.x, ay = ann.anchor.y;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(-this.view.rotation);
        const r = Math.max(2.5, 4 / this.view.scale);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        ctx.font = `${Math.max(10, 13 / this.view.scale)}px monospace`;
        ctx.fillStyle = '#000000';
        ctx.fillText(ann.text, r + 2, -r - 1);
        ctx.restore();
      }
    }
    this.lastRenderInfo = {
      frame: this.currentFrame,
      view: { ...this.view },
      annotationCount: this.annotations.length,
      shapeCount: this.result ? this.result.shapes.length : 0,
    };
  }

  updateStats() {
    if (!this.result) return;
    const s = this.result.stats;
    this.el.statsPanel.textContent =
      `帧=${this.currentFrame} 组件=${s.componentCount} 保留=${s.keptCount} 过滤孤点=${s.removedCount} ` +
      `轮廓=${s.ringCount} 节点=${s.nodeCount} 结构摘要=${this.result.summary.hash}`;
  }

  showError(message) {
    this.el.errorBanner.textContent = `⚠ ${message}`;
    this.el.errorBanner.hidden = false;
    // 错误时保留上一帧画面，绝不白屏
  }

  hideError() {
    this.el.errorBanner.hidden = true;
    this.el.errorBanner.textContent = '';
  }

  flashStatus(text) {
    this.el.statusLine.textContent = text;
  }

  takeScreenshot() {
    const url = this.el.canvas.toDataURL('image/png');
    this.lastScreenshot = url;
    this.flashStatus('截图已生成（PNG dataURL）');
    return url;
  }

  exportSvg() {
    if (!this.result) {
      this.showError('暂无可导出的矢量结果');
      return null;
    }
    const blob = new Blob([this.result.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vectorized_t${this.params.threshold}_s${this.params.smoothness}_m${this.params.minArea}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.lastExport = this.result.svg;
    this.flashStatus(`已导出 SVG：${this.result.shapes.length} 个对象 / ${this.result.nodeCount} 节点`);
    return this.result.svg;
  }

  saveCurrentPreset() {
    const name = this.el.presetName.value.trim();
    if (!name) {
      this.showError('请输入预设名称');
      return;
    }
    try {
      savePreset(name, this.params);
      this.refreshPresetList();
      this.flashStatus(`预设「${name}」已保存`);
    } catch (err) {
      this.showError(err.message);
    }
  }

  loadSelectedPreset() {
    const name = this.el.presetSelect.value;
    if (!name) {
      this.showError('请选择要载入的预设');
      return;
    }
    try {
      const params = loadPreset(name);
      this.pushUndo();
      this.params = params;
      this.refreshControls();
      this.runVectorize();
      this.flashStatus(`预设「${name}」已载入`);
    } catch (err) {
      this.showError(err.message);
    }
  }

  removeSelectedPreset() {
    const name = this.el.presetSelect.value;
    if (!name) return;
    deletePreset(name);
    this.refreshPresetList();
  }

  refreshPresetList() {
    const presets = listPresets();
    this.el.presetSelect.innerHTML = '';
    for (const preset of presets) {
      const opt = document.createElement('option');
      opt.value = preset.name;
      opt.textContent = `${preset.name} (t${preset.params.threshold}/s${preset.params.smoothness}/m${preset.params.minArea})`;
      this.el.presetSelect.appendChild(opt);
    }
  }
}

function compareResults(before, after) {
  if (!before || !after) {
    return { comparable: false, reason: !before ? '首次计算，无重算前状态' : '重算后无结果' };
  }
  const moved = [];
  const count = Math.min(before.shapes.length, after.shapes.length);
  for (let i = 0; i < count; i += 1) {
    const a = before.shapes[i], b = after.shapes[i];
    const dx = b.centroid.x - a.centroid.x;
    const dy = b.centroid.y - a.centroid.y;
    moved.push({ id: b.id, dx: Number(dx.toFixed(3)), dy: Number(dy.toFixed(3)) });
  }
  return {
    comparable: true,
    shapes: { before: before.shapes.length, after: after.shapes.length, delta: after.shapes.length - before.shapes.length },
    nodes: { before: before.stats.nodeCount, after: after.stats.nodeCount, delta: after.stats.nodeCount - before.stats.nodeCount },
    summaryHash: { before: before.summary.hash, after: after.summary.hash, same: before.summary.hash === after.summary.hash },
    exportSame: before.svg === after.svg,
    centroids: moved.slice(0, 8),
  };
}

export { W as CANVAS_W, H as CANVAS_H };
