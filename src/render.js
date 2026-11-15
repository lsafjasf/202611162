import { ASPECTS, SOURCE_H, SOURCE_W } from './model.js';
import { renderScene } from './animation.js';

function transitionAlpha(clip, localTime) {
  const duration = clip.outPoint - clip.inPoint;
  const { fadeIn, fadeOut } = clip.transition;
  let alpha = 1;
  if (localTime < fadeIn) alpha = localTime / fadeIn;
  if (localTime > duration - fadeOut) alpha = Math.min(alpha, (duration - localTime) / fadeOut);
  return Math.max(0, Math.min(1, alpha));
}

function drawSubtitles(ctx, clip, localTime, outW, outH) {
  const active = (clip._subtitles || []).filter((s) => localTime >= s.start && localTime <= s.end);
  if (!active.length) return;
  const fontSize = Math.max(14, Math.round(outH * 0.06));
  ctx.font = `600 ${fontSize}px system-ui, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = outH * 0.86;
  active.forEach((sub, idx) => {
    const text = sub.text;
    const width = ctx.measureText(text).width + fontSize;
    const x = outW / 2;
    const yy = y - idx * fontSize * 1.4;
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    roundRect(ctx, x - width / 2, yy - fontSize * 0.8, width, fontSize * 1.5, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, yy);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 将片段在 masterTime 的画面绘制到目标 ctx（输出分辨率由 aspect 决定）。
export function renderClipFrame(ctx, scene, clip, masterTime, outW, outH) {
  const localTime = masterTime - clip.inPoint;
  ctx.save();
  ctx.clearRect(0, 0, outW, outH);
  ctx.globalAlpha = transitionAlpha(clip, localTime);
  ctx.drawImage(
    scene._sourceCanvas,
    clip.crop.x, clip.crop.y, clip.crop.w, clip.crop.h,
    0, 0, outW, outH,
  );
  ctx.globalAlpha = 1;
  drawSubtitles(ctx, clip, localTime, outW, outH);
  ctx.restore();
}

// 源画面 + 三个裁剪框 + 安全区，用于主画布编辑视图。
export function renderSourceOverlay(ctx, project, scene, activeClipId, time) {
  renderScene(ctx, scene, time, SOURCE_W, SOURCE_H);
  for (const clip of scene.clips) {
    const active = clip.id === activeClipId;
    const { x, y, w, h } = clip.crop;
    ctx.save();
    ctx.fillStyle = active ? 'rgba(47,111,237,.14)' : 'rgba(255,255,255,.06)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#7fd0ff' : 'rgba(255,255,255,.55)';
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash(active ? [] : [8, 6]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const margin = { x: w * 0.08, y: h * 0.08 };
    ctx.strokeStyle = active ? 'rgba(127,208,255,.9)' : 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + margin.x, y + margin.y, w - margin.x * 2, h - margin.y * 2);
    ctx.fillStyle = active ? '#7fd0ff' : 'rgba(255,255,255,.7)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(ASPECTS[clip.aspect].label, x + 6, y + 16);
    ctx.restore();
  }
}
