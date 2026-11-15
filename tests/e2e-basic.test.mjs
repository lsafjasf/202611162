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

test('页面加载后渲染源画布、三片段与时间线', async () => {
  await freshProject(page);
  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector('#sourceCanvas');
    const ctx = c.getContext('2d');
    const px = ctx.getImageData(10, 10, 1, 1).data;
    return px[3] === 255;
  });
  assert.equal(canvasOk, true);
  const bars = await page.locator('.tl-clip').count();
  assert.equal(bars, 3);
  const tabs = await page.locator('#clipTabs button').count();
  assert.equal(tabs, 3);
});

test('三种画幅初始约束全部合法', async () => {
  await freshProject(page);
  const result = await page.evaluate(async () => {
    const { checkConstraints } = await import('/src/crop.js');
    const state = window.__workbench.getState();
    return state.project.scenes.map((scene) => scene.clips.map((clip) => ({
      id: `${scene.id}:${clip.id}`,
      valid: checkConstraints(scene, clip).valid,
    }))).flat();
  });
  assert.equal(result.every((r) => r.valid), true);
});

test('时间线拖动入点手柄后入点、出点与时长更新且约束仍合法', async () => {
  await freshProject(page);
  const before = await page.evaluate(() => {
    const clip = window.__workbench.activeScene().clips[0];
    return { in: clip.inPoint, out: clip.outPoint };
  });
  const handle = page.locator('.tl-clip.landscape .tl-handle.in');
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 8, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const clip = window.__workbench.activeScene().clips[0];
    return { in: clip.inPoint, out: clip.outPoint, duration: clip.outPoint - clip.inPoint };
  });
  assert.ok(after.in > before.in);
  assert.equal(after.out, before.out);
  assert.ok(after.duration > 0.5);
  const valid = await page.evaluate(async () => {
    const { checkConstraints } = await import('/src/crop.js');
    const scene = window.__workbench.activeScene();
    return scene.clips.map((clip) => checkConstraints(scene, clip).valid);
  });
  assert.equal(valid.every(Boolean), true);
});

test('播放、暂停、拖动播放头与循环共用同一时钟', async () => {
  await freshProject(page);
  await page.click('#btnPlay');
  await page.waitForTimeout(350);
  const running = await page.evaluate(() => window.__workbench.getState().clock.playing);
  assert.equal(running, true);
  await page.click('#btnPause');
  const pausedAt = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.ok(pausedAt > 0);
  await page.waitForTimeout(200);
  const stillAt = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.ok(Math.abs(stillAt - pausedAt) < 0.05);
  await page.evaluate(() => window.__workbench.seekTo(2.5));
  const seeked = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.ok(Math.abs(seeked - 2.5) < 0.001);
});

test('循环开启时播放到末尾会回到开头', async () => {
  await freshProject(page);
  await page.evaluate(() => {
    const wb = window.__workbench;
    wb.seekTo(5.85);
  });
  await page.click('#btnPlay');
  await page.waitForTimeout(450);
  const wrapped = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.ok(wrapped < 1, `应已循环，实际 ${wrapped}`);
  await page.click('#btnPause');
});

test('工程数据结构包含关键帧、字幕、转场和音频起始', async () => {
  await freshProject(page);
  const state = await projectState(page);
  const scene = state.scenes[0];
  assert.ok(scene.keyframes[0].keyframes.length >= 4);
  assert.ok(scene.subtitles.length >= 2);
  assert.equal(typeof scene.clips[0].transition.fadeIn, 'number');
  assert.equal(scene.audioStart, 0);
});
