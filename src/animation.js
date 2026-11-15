// 程序生成的确定性动画。所有主体参数都来自可持久化的关键帧。

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function lerp(a, b, t) { return a + (b - a) * t; }

export function sampleKeyframes(keyframes, time) {
  if (!keyframes.length) return {};
  if (time <= keyframes[0].t) return { ...keyframes[0] };
  const last = keyframes[keyframes.length - 1];
  if (time >= last.t) return { ...last };
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t || 1;
      const k = easeInOut((time - a.t) / span);
      const out = { t: time };
      for (const key of Object.keys(a)) {
        if (key === 't') continue;
        out[key] = typeof a[key] === 'number' && typeof b[key] === 'number'
          ? lerp(a[key], b[key], k) : b[key];
      }
      return out;
    }
  }
  return { ...last };
}

// 主体在某时刻的包围盒（源画布 960×540 坐标系），供裁剪约束使用。
export function subjectBounds(subject, time) {
  const p = sampleKeyframes(subject.keyframes, time);
  const r = p.r ?? subject.radius ?? 60;
  return { id: subject.id, x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, cx: p.x, cy: p.y, r };
}

export function sceneSubjectBounds(scene, time) {
  return scene.subjects.map((s) => subjectBounds(s, time));
}

function drawBackground(ctx, w, h, time) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#101c33');
  g.addColorStop(1, '#1d3357');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let i = 0; i < 12; i += 1) {
    const x = (i * 97 + time * 18) % (w + 80) - 40;
    const y = (i * 53) % h;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += 80) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += 80) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
}

function drawSubject(ctx, subject, time) {
  const p = sampleKeyframes(subject.keyframes, time);
  const r = p.r ?? 60;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot ?? 0);
  if (subject.shape === 'square') {
    ctx.fillStyle = subject.color;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(-r * 0.35, -r * 0.12, r * 0.28, r * 0.24);
    ctx.fillRect(r * 0.08, -r * 0.12, r * 0.28, r * 0.24);
  } else {
    ctx.fillStyle = subject.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.15, r * 0.13, 0, Math.PI * 2);
    ctx.arc(r * 0.32, -r * 0.15, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath();
    ctx.arc(0, r * 0.12, r * 0.4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderScene(ctx, scene, time, w = 960, h = 540) {
  drawBackground(ctx, w, h, time);
  for (const subject of scene.subjects) drawSubject(ctx, subject, time);
  // 时间水印：同一时刻渲染结果逐像素确定，便于测试比对。
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(`t=${time.toFixed(3)}s`, 12, h - 12);
}
