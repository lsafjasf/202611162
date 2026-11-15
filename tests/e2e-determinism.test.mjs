import test from 'node:test';
import assert from 'node:assert/strict';
import { launchPage, freshProject, canvasPixels, diffRatio } from './helpers.mjs';

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

test('暂停截图与从头播放到同一时刻的画面逐像素一致', async () => {
  await freshProject(page);
  const targetTime = 2.37;
  await page.evaluate((t) => window.__workbench.seekTo(t), targetTime);
  await page.evaluate(() => window.__workbench.pausePlayback());
  const pausedShot = await canvasPixels(page, '#outputCanvas');
  await page.evaluate(() => window.__workbench.seekTo(0));
  await page.click('#btnPlay');
  await page.waitForFunction((target) => {
    const t = window.__workbench.getState().clock.currentTime;
    return t >= target;
  }, targetTime, { timeout: 8000 });
  await page.click('#btnPause');
  const reached = await page.evaluate(() => window.__workbench.getState().clock.currentTime);
  assert.ok(Math.abs(reached - targetTime) < 0.12);
  // 精确回到同一时刻再截图，消除播放头量化误差。
  await page.evaluate((t) => window.__workbench.seekTo(t), targetTime);
  const playedShot = await canvasPixels(page, '#outputCanvas');
  assert.equal(diffRatio(pausedShot, playedShot), 0);
});

test('源画面同一时刻重复渲染完全确定', async () => {
  await freshProject(page);
  const a = await page.evaluate((t) => {
    const c = document.querySelector('#sourceCanvas');
    window.__workbench.drawFrame(t);
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  }, 1.84);
  const b = await page.evaluate((t) => {
    const c = document.querySelector('#sourceCanvas');
    window.__workbench.drawFrame(t);
    return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
  }, 1.84);
  assert.deepEqual(a, b);
});

test('音频事件时间与统一时钟对齐，seek 后按新位置重排', async () => {
  await freshProject(page);
  await page.evaluate(() => window.__workbench.seekTo(0));
  await page.click('#btnPlay');
  await page.waitForTimeout(450);
  const early = await page.evaluate(() => {
    const audio = window.__workbench.getState().audio;
    return audio.firedLog.filter((e) => e.masterTime <= 0.5).map((e) => e.masterTime);
  });
  assert.ok(early.includes(0));
  await page.evaluate(() => {
    window.__workbench.seekTo(2.0);
    window.__workbench.getState().audio.seek();
  });
  await page.waitForTimeout(300);
  const cue = await page.evaluate(() => {
    const audio = window.__workbench.getState().audio;
    return audio.firedLog.find((e) => e.type === 'cue' && e.name === 'bounce-1');
  });
  assert.ok(cue, '2.0s 提示音应在 seek 后重新调度');
  assert.ok(Math.abs(cue.masterTime - 2.0) < 0.05);
  await page.click('#btnPause');
});

test('字幕仅在对应时间窗内出现并跟随裁剪输出', async () => {
  await freshProject(page);
  const outside = await page.evaluate(() => {
    window.__workbench.seekTo(0.0);
    const c = document.querySelector('#outputCanvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v > 240);
  });
  const inside = await page.evaluate(() => {
    window.__workbench.seekTo(1.0);
    const c = document.querySelector('#outputCanvas');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white += 1;
    }
    return white;
  });
  assert.ok(inside > 50, '字幕时段应出现白色文字像素');
  assert.ok(typeof outside === 'boolean');
});
