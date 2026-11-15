import test from "node:test";
import assert from "node:assert/strict";
import {
  createExportManifest,
  createShotList,
  durationOf,
  normalizeProject,
  sampleAt,
  shotSpans,
  validateProject,
} from "../src/core.js";
import { createDefaultProject } from "../src/defaults.js";
import { projectFingerprint } from "../src/exporter.js";

const project = () => normalizeProject(createDefaultProject());

test("入点、出点与导出帧数保持一致", () => {
  const value = project();
  const manifest = createExportManifest(value);
  assert.equal(durationOf(value), 16.5);
  assert.equal(manifest.range.frameCount, 495);
  assert.equal(manifest.range.timecodeIn, "00:00:00:00");
  assert.equal(manifest.range.timecodeOut, "00:00:16:15");
  assert.equal(manifest.verification.durationMatchesRange, true);
  assert.equal(manifest.verification.outMatchesFrameCount, true);
  assert.equal(validateProject(value).valid, true);
});

test("所有机位切换点落在同一音频节拍网格", () => {
  const value = project();
  const beat = 60 / value.audio.bpm;
  for (const cut of value.cuts) {
    const offset = (cut.t - value.audio.start) / beat;
    assert.ok(Math.abs(offset - Math.round(offset)) < 1e-6, `cut ${cut.id} is off beat`);
  }
});

test("镜头段首尾相接且总和等于节目时长", () => {
  const value = project();
  const spans = shotSpans(value);
  assert.equal(spans[0].start, value.inPoint);
  assert.equal(spans.at(-1).end, value.outPoint);
  assert.equal(
    spans.reduce((sum, shot) => sum + shot.duration, 0),
    durationOf(value),
  );
  for (let index = 1; index < spans.length; index += 1) {
    assert.equal(spans[index - 1].end, spans[index].start);
  }
});

test("转场结束时取景严格切换到下一机位", () => {
  const value = project();
  const start = sampleAt(value, 3.6);
  assert.equal(start.activeCamera, "B");
  assert.equal(start.outgoingCamera, "A");
  assert.equal(start.transition.active, true);
  assert.equal(start.transition.progress, 0);

  const end = sampleAt(value, 3.6 + 0.55);
  assert.equal(end.activeCamera, "B");
  assert.equal(end.outgoingCamera, null);
  assert.equal(end.transition.active, false);
  assert.equal(end.transition.progress, 1);
});

test("画面、字幕和节拍在同一时间点采样稳定", () => {
  const value = project();
  const first = sampleAt(value, 5.05);
  const second = sampleAt(value, 5.05);
  assert.deepEqual(first, second);
  assert.equal(first.activeCamera, "B");
  assert.equal(first.subtitle.id, "sub-02");
  assert.equal(first.audioEvent.type, "kick");
  assert.equal(first.audioEvent.beat, 8);
});

test("工程往返归一化后保留关键帧、字幕、转场和音频起点", () => {
  const value = project();
  value.cameras[0].keyframes.push({
    t: 5.4,
    position: { x: 1, y: 2, z: 9 },
    target: { x: 0, y: 1, z: 0 },
    fov: 36,
  });
  value.cuts[1].transition = { type: "wipe", duration: 0.7 };
  value.subtitles[0].text = "新的字幕文本";
  value.audio.start = 0.6;
  const restored = normalizeProject(JSON.parse(JSON.stringify(value)));
  assert.equal(restored.cameras[0].keyframes.length, 4);
  assert.deepEqual(restored.cuts[1].transition, { type: "wipe", duration: 0.7 });
  assert.equal(restored.subtitles[0].text, "新的字幕文本");
  assert.equal(restored.audio.start, 0.6);
  assert.equal(restored.cuts.length, 5);
});

test("镜头表保留机位、边界、转场和字幕", () => {
  const shots = createShotList(project());
  assert.equal(shots.length, 5);
  assert.equal(shots[1].camera, "B");
  assert.equal(shots[1].timecodeIn, "00:00:03:18");
  assert.equal(shots[1].transitionOut, "dissolve");
  assert.equal(shots[1].duration, 3.6);
  assert.match(shots[1].subtitle, /灯光/);
});

test("工程指纹能发现嵌套关键帧修改", async () => {
  const value = project();
  const before = await projectFingerprint(value);
  value.cameras[0].keyframes[1].fov = 33;
  const after = await projectFingerprint(value);
  assert.notEqual(before, after);
});
