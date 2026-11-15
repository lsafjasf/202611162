import { ASPECTS, SOURCE_H, SOURCE_W } from './model.js';
import { subjectBounds } from './animation.js';

export const SAFE_RATIO = 0.08; // 安全区为裁剪框四边内缩 8%

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// 保持中心与宽高比，把尺寸收进源画面。
export function normalizeCrop(crop, aspect) {
  let { x, y, w, h } = crop;
  const ratio = ASPECTS[aspect].ratio;
  if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  w = clamp(w, 40, SOURCE_W);
  h = w / ratio;
  if (h > SOURCE_H) { h = SOURCE_H; w = h * ratio; }
  x = clamp(x, 0, SOURCE_W - w);
  y = clamp(y, 0, SOURCE_H - h);
  return { x, y, w, h };
}

function subjectsAtTime(scene, time) {
  return scene.subjects
    .filter((s) => s.safe !== false)
    .map((s) => subjectBounds(s, time));
}

function allSubjectsAtTime(scene, time) {
  return scene.subjects.map((s) => subjectBounds(s, time));
}

// 在 [inPoint, outPoint] 采样主体包围盒，取并集。
export function subjectUnion(scene, inPoint, outPoint, steps = 48) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const t = inPoint + ((outPoint - inPoint) * i) / steps;
    for (const box of allSubjectsAtTime(scene, t)) {
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// 标记 safe 的主体必须完整落在安全区内；其余主体不得出画面。
export function checkConstraints(scene, clip, steps = 48) {
  const { crop } = clip;
  const marginX = crop.w * SAFE_RATIO;
  const marginY = crop.h * SAFE_RATIO;
  const safe = {
    x: crop.x + marginX,
    y: crop.y + marginY,
    w: crop.w - marginX * 2,
    h: crop.h - marginY * 2,
  };
  const violations = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = clip.inPoint + ((clip.outPoint - clip.inPoint) * i) / steps;
    for (const box of subjectsAtTime(scene, t)) {
      const bad = box.x < safe.x || box.y < safe.y
        || box.x + box.w > safe.x + safe.w
        || box.y + box.h > safe.y + safe.h;
      if (bad) violations.push({ time: Number(t.toFixed(3)), subject: box.id });
    }
  }
  const frameViolations = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = clip.inPoint + ((clip.outPoint - clip.inPoint) * i) / steps;
    for (const box of allSubjectsAtTime(scene, t)) {
      const outOfFrame = box.x < crop.x || box.y < crop.y
        || box.x + box.w > crop.x + crop.w
        || box.y + box.h > crop.y + crop.h;
      if (outOfFrame) frameViolations.push({ time: Number(t.toFixed(3)), subject: box.id });
    }
  }
  const insideSource = crop.x >= 0 && crop.y >= 0
    && crop.x + crop.w <= SOURCE_W + 1e-6
    && crop.y + crop.h <= SOURCE_H + 1e-6;
  return {
    valid: violations.length === 0 && frameViolations.length === 0 && insideSource,
    insideSource,
    violations: violations.slice(0, 8),
    violationCount: violations.length,
    frameViolations: frameViolations.slice(0, 8),
    frameViolationCount: frameViolations.length,
  };
}

// 计算最小裁剪框：safe 主体留 8% 安全边距，其余主体保证不出画面。
export function minCropForSubjects(scene, clip, aspect) {
  const ratio = ASPECTS[aspect].ratio;
  const safeScene = { subjects: scene.subjects.filter((s) => s.safe !== false) };
  const safeUnion = subjectUnion(safeScene, clip.inPoint, clip.outPoint);
  const fullUnion = subjectUnion(scene, clip.inPoint, clip.outPoint);
  let w = 120;
  let h = w / ratio;
  const fits = (crop) => {
    const marginX = crop.w * SAFE_RATIO;
    const marginY = crop.h * SAFE_RATIO;
    const safeOk = safeUnion.x >= crop.x + marginX
      && safeUnion.y >= crop.y + marginY
      && safeUnion.x + safeUnion.w <= crop.x + crop.w - marginX
      && safeUnion.y + safeUnion.h <= crop.y + crop.h - marginY;
    const frameOk = fullUnion.x >= crop.x && fullUnion.y >= crop.y
      && fullUnion.x + fullUnion.w <= crop.x + crop.w
      && fullUnion.y + fullUnion.h <= crop.y + crop.h;
    return safeOk && frameOk;
  };
  for (let i = 0; i < 240; i += 1) {
    const cx = fullUnion.x + fullUnion.w / 2;
    const cy = fullUnion.y + fullUnion.h / 2;
    const crop = normalizeCrop({ x: cx - w / 2, y: cy - h / 2, w, h }, aspect);
    if (fits(crop)) return crop;
    w += 8;
    h = w / ratio;
    if (w > SOURCE_W || h > SOURCE_H) break;
  }
  const fallback = normalizeCrop({ x: 0, y: 0, w: SOURCE_H * ratio, h: SOURCE_H }, aspect);
  return fallback;
}

// 拖动/缩放时实时钳制：优先采用用户位置，不合法时放大到最小合法尺寸并钳制中心。
export function clampCrop(scene, clip, aspect, next) {
  const normalized = normalizeCrop(next, aspect);
  const probe = { ...clip, crop: normalized };
  if (checkConstraints(scene, probe).valid) return normalized;
  const fallback = minCropForSubjects(scene, clip, aspect);
  const candidate = normalizeCrop({ ...fallback, x: normalized.x, y: normalized.y }, aspect);
  const candidateClip = { ...clip, crop: candidate };
  if (checkConstraints(scene, candidateClip).valid) return candidate;
  return fallback;
}

export function ensureValidCrop(scene, clip, aspect) {
  const normalized = normalizeCrop(clip.crop, aspect);
  const probe = { ...clip, crop: normalized };
  if (checkConstraints(scene, probe).valid) return normalized;
  return minCropForSubjects(scene, clip, aspect);
}
