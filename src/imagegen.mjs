// 程序化生成黑白线稿（画面全部由代码生成，不使用任何外部图片资源）

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// 生成一帧测试线稿：粗圆 + 矩形 + 1px 细线 + 小孔（遮挡）+ 孤点 + 噪点
export function renderPattern(canvas, frame = 0, seed = 42) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';

  const drift = Math.sin(frame / 8) * 4;

  // 粗圆（内含白色小孔，验证孔洞与 evenodd）
  ctx.beginPath();
  ctx.arc(90 + drift, 110, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(108 + drift, 96, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000000';

  // 矩形
  ctx.fillRect(240, 60, 120, 80);

  // 1px 细折线：贯穿画面，验证“细线不能断”
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 260);
  ctx.lineTo(120, 220 + drift);
  ctx.lineTo(210, 268);
  ctx.lineTo(330, 226);
  ctx.stroke();

  // 细圆环
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(300, 330, 34, 0, Math.PI * 2);
  ctx.stroke();

  // 确定性随机孤点（1px 与 2px），由最小区域参数过滤
  const rnd = mulberry32(seed);
  for (let i = 0; i < 24; i += 1) {
    const x = 12 + Math.floor(rnd() * (w - 24));
    const y = 300 + Math.floor(rnd() * (h - 312));
    dot(ctx, x, y, rnd() > 0.5 ? 1 : 1.2);
  }

  // 文字标注（也是矢量描摹对象）
  ctx.font = 'bold 26px monospace';
  ctx.fillText(`F${String(frame).padStart(3, '0')}`, 24, 44);

  return canvas;
}

export function grayFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// 可暂停的帧动画：暂停冻结当前帧，恢复后从冻结帧继续，绝不跳帧
export class FramePlayer {
  constructor(canvas, { intervalMs = 120, onFrame } = {}) {
    this.canvas = canvas;
    this.intervalMs = intervalMs;
    this.onFrame = onFrame;
    this.frame = 0;
    this.running = false;
    this.timer = null;
    this.lastTickAt = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.draw();
  }

  tick() {
    if (!this.running) return;
    this.frame = (this.frame + 1) % 1000;
    this.draw();
  }

  draw() {
    renderPattern(this.canvas, this.frame);
    if (this.onFrame) this.onFrame(this.frame);
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.pausedFrame = this.frame;
  }

  resume() {
    if (this.running) return;
    if (this.pausedFrame !== undefined && this.pausedFrame !== this.frame) {
      // 恢复时先回到暂停帧，避免任何跳帧
      this.frame = this.pausedFrame;
      this.draw();
    }
    this.start();
  }

  seek(frame) {
    this.frame = frame;
    this.pausedFrame = frame;
    this.draw();
  }

  stop() {
    this.pause();
  }
}
