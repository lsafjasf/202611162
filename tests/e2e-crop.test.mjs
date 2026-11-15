import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPage, freshProject } from './helpers.mjs';
import { ASPECTS } from '../src/model.js';

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

test('在源画布拖动裁剪框后仍满足安全区与画幅比例', async () => {
  await freshProject(page);
  const canvas = page.locator('#sourceCanvas');
  await canvas.scrollIntoViewIfNeeded();
  const start = await canvas.boundingBox();
  const before = await page.evaluate(() => ({ ...window.__workbench.activeClip().crop }));
  const centerX = start.x + (before.x + before.w / 2) / 960 * start.width;
  const centerY = start.y + (before.y + before.h / 2) / 540 * start.height;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 40, centerY + 20, { steps: 6 });
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    const { checkConstraints } = await import('/src/crop.js');
    const scene = window.__workbench.activeScene();
    const clip = window.__workbench.activeClip();
    return {
      crop: clip.crop,
      valid: checkConstraints(scene, clip).valid,
      ratio: clip.crop.w / clip.crop.h,
    };
  });
  assert.equal(result.valid, true);
  assert.ok(Math.abs(result.ratio - ASPECTS.landscape.ratio) < 0.01);
});

test('切换到竖屏片段后输出画布变为 9:16', async () => {
  await freshProject(page);
  await page.locator('#clipTabs button').nth(2).click();
  const size = await page.evaluate(() => {
    const c = document.querySelector('#outputCanvas');
    return { width: c.width, height: c.height };
  });
  assert.deepEqual(size, { width: 270, height: 480 });
  const valid = await page.evaluate(async () => {
    const { checkConstraints } = await import('/src/crop.js');
    const scene = window.__workbench.activeScene();
    return checkConstraints(scene, window.__workbench.activeClip()).valid;
  });
  assert.equal(valid, true);
});

test('入出点变化后裁剪约束自动重算并保持合法', async () => {
  await freshProject(page);
  await page.evaluate(() => {
    const scene = window.__workbench.activeScene();
    const clip = scene.clips[0];
    clip.inPoint = 0.1;
    clip.outPoint = 5.9;
  });
  const allValid = await page.evaluate(async () => {
    const { checkConstraints, ensureValidCrop } = await import('/src/crop.js');
    const scene = window.__workbench.activeScene();
    for (const clip of scene.clips) clip.crop = ensureValidCrop(scene, clip, clip.aspect);
    return scene.clips.map((clip) => checkConstraints(scene, clip).valid);
  });
  assert.equal(allValid.every(Boolean), true);
});
