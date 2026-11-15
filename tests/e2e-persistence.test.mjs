import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPage, freshProject, projectState } from './helpers.mjs';

let browser;
let page;

test.before(async () => {
  const launched = await launchPage();
  browser = launched.browser;
  page = launched.page;
});

test.after(async () => {
  await browser.close();
});

test('保存后重新打开，时间线、字幕、转场、音频起始全部恢复', async () => {
  await freshProject(page);
  const edited = await page.evaluate(() => {
    const scene = window.__workbench.activeScene();
    const clip = scene.clips[1];
    clip.inPoint = 1.75;
    clip.outPoint = 4.9;
    clip.transition.fadeIn = 0.42;
    scene.subtitles[0].text = '已修改字幕';
    window.__workbench.doSave();
    return {
      clip: { ...clip, crop: { ...clip.crop } },
      subtitle: scene.subtitles[0].text,
      keyframes: scene.subjects[0].keyframes.map((k) => ({ ...k })),
      audioStart: scene.audio.startAt,
    };
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__workbench));
  const reopened = await page.evaluate(() => {
    const scene = window.__workbench.activeScene();
    const clip = scene.clips[1];
    return {
      clip: { ...clip, crop: { ...clip.crop } },
      subtitle: scene.subtitles[0].text,
      keyframes: scene.subjects[0].keyframes.map((k) => ({ ...k })),
      audioStart: scene.audio.startAt,
    };
  });
  assert.deepEqual(reopened.clip.inPoint, edited.clip.inPoint);
  assert.deepEqual(reopened.clip.outPoint, edited.clip.outPoint);
  assert.deepEqual(reopened.clip.transition, edited.clip.transition);
  assert.deepEqual(reopened.clip.crop, edited.clip.crop);
  assert.equal(reopened.subtitle, edited.subtitle);
  assert.deepEqual(reopened.keyframes, edited.keyframes);
  assert.equal(reopened.audioStart, edited.audioStart);
});

test('切换场景后关键帧互不丢失，且激活场景被替换', async () => {
  await freshProject(page);
  const before = await projectState(page);
  await page.evaluate(() => window.__workbench.switchScene('scene-b'));
  const after = await projectState(page);
  assert.equal(after.activeSceneId, 'scene-b');
  const aBefore = before.scenes.find((s) => s.id === 'scene-a');
  const aAfter = after.scenes.find((s) => s.id === 'scene-a');
  assert.deepEqual(aAfter.keyframes, aBefore.keyframes);
  const b = after.scenes.find((s) => s.id === 'scene-b');
  assert.ok(b.keyframes[0].keyframes.length >= 3);
});

test('切场景会停止旧音频节点，新场景音频从零开始', async () => {
  await freshProject(page);
  await page.click('#btnPlay');
  await page.waitForTimeout(300);
  const beforeNodes = await page.evaluate(() => {
    const audio = window.__workbench.getState().audio;
    return { running: audio.running, nodes: audio.activeNodes.size };
  });
  assert.ok(beforeNodes.running);
  await page.evaluate(() => window.__workbench.switchScene('scene-b'));
  const afterSwitch = await page.evaluate(() => {
    const audio = window.__workbench.getState().audio;
    const clock = window.__workbench.getState().clock;
    return {
      running: audio.running,
      nodes: audio.activeNodes.size,
      currentTime: clock.currentTime,
      sceneId: audio.scene.id,
      log: audio.firedLog.length,
    };
  });
  assert.equal(afterSwitch.running, false);
  assert.equal(afterSwitch.nodes, 0);
  assert.equal(afterSwitch.currentTime, 0);
  assert.equal(afterSwitch.sceneId, 'scene-b');
});

test('重新载入工程不会把播放位置带入新场景', async () => {
  await freshProject(page);
  await page.evaluate(() => window.__workbench.seekTo(3.2));
  await page.evaluate(() => window.__workbench.switchScene('scene-b'));
  const time = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.equal(time, 0);
});
