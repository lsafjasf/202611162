import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, ASPECTS } from '../src/model.js';
import { sampleKeyframes, subjectBounds } from '../src/animation.js';
import { checkConstraints, ensureValidCrop, normalizeCrop, SAFE_RATIO } from '../src/crop.js';

function firstScene() {
  return createDefaultProject().scenes[0];
}

test('关键帧在两端与中点可重复采样', () => {
  const scene = firstScene();
  const orb = scene.subjects[0];
  assert.equal(sampleKeyframes(orb.keyframes, 0).x, 420);
  assert.equal(sampleKeyframes(orb.keyframes, 6).x, 540);
  const mid = sampleKeyframes(orb.keyframes, 2);
  assert.equal(mid.x, 470);
  const again = sampleKeyframes(orb.keyframes, 2);
  assert.deepEqual(mid, again);
});

test('默认裁剪框满足全片段安全区约束', () => {
  const scene = firstScene();
  for (const clip of scene.clips) {
    const check = checkConstraints(scene, clip);
    assert.equal(check.valid, true, `${clip.id} 应默认合法`);
  }
});

test('ensureValidCrop 会修复越界裁剪并保持宽高比', () => {
  const scene = firstScene();
  const clip = { ...scene.clips[0], crop: { x: 0, y: 0, w: 200, h: 112.5 } };
  const fixed = ensureValidCrop(scene, clip, clip.aspect);
  const ratio = ASPECTS[clip.aspect].ratio;
  assert.ok(Math.abs(fixed.w / fixed.h - ratio) < 1e-6);
  assert.equal(checkConstraints(scene, { ...clip, crop: fixed }).valid, true);
});

test('normalizeCrop 始终把裁剪框限制在源画面内', () => {
  const crop = normalizeCrop({ x: -50, y: -99, w: 4000, h: 3000 }, 'portrait');
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.w <= 960 + 1e-6);
  assert.ok(crop.y + crop.h <= 540 + 1e-6);
  assert.ok(Math.abs(crop.w / crop.h - ASPECTS.portrait.ratio) < 1e-6);
});

test('主体包围盒完全落在安全区内时约束成立', () => {
  const scene = firstScene();
  const clip = scene.clips[1];
  const box = subjectBounds(scene.subjects[0], (clip.inPoint + clip.outPoint) / 2);
  const marginX = clip.crop.w * SAFE_RATIO;
  const marginY = clip.crop.h * SAFE_RATIO;
  assert.ok(box.x >= clip.crop.x + marginX);
  assert.ok(box.y >= clip.crop.y + marginY);
  assert.ok(box.x + box.w <= clip.crop.x + clip.crop.w - marginX);
  assert.ok(box.y + box.h <= clip.crop.y + clip.crop.h - marginY);
});

test('入点小于出点且三个片段时长均为正值', () => {
  const scene = firstScene();
  for (const clip of scene.clips) {
    assert.ok(clip.outPoint > clip.inPoint);
    assert.ok(clip.outPoint - clip.inPoint >= 0.5);
  }
});
