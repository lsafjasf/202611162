import { test, expect } from '@playwright/test';
import { gotoStudio } from './helpers.js';

test.describe('字幕对齐、校验与 WebVTT 往返', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
  });

test('默认三条字幕通过校验并可在时间轴上看到', async ({ page }) => {
  await expect(page.locator('#validation .log-ok')).toBeVisible();
  const cues = await page.evaluate(() => window.app.cues);
  expect(cues).toHaveLength(3);
  expect(cues.every((cue) => cue.words.length === 2)).toBeTruthy();
});

test('字幕重叠时校验报错并阻止保存', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.app;
    app.cues[1] = { ...app.cues[1], start: app.cues[0].end - 0.2 };
    app.timeline.setCues(app.cues);
    app.renderValidation();
  });
  await expect(page.locator('#validation .log-error')).toContainText('overlap');
  const saved = await page.evaluate(() => window.app.saveSession());
  expect(saved).toBeFalsy();
  const logs = await page.locator('#event-log .log-error').allInnerTexts();
  expect(logs.join(' ')).toContain('保存被阻止');
});

test('词时间越出提示音入出点时校验失败', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.app;
    const cue = app.cues[0];
    cue.words[0] = { ...cue.words[0], start: cue.start - 0.3 };
    app.timeline.setCues(app.cues);
    app.renderValidation();
  });
  await expect(page.locator('#validation .log-error')).toContainText('escapes cue');
});

test('出点越过时间轴末尾时报越界错误', async ({ page }) => {
  await page.evaluate(() => {
    const app = window.app;
    const cue = app.cues[2];
    app.cues[2] = { ...cue, end: 7.5 };
    app.timeline.setCues(app.cues);
    app.renderValidation();
  });
  await expect(page.locator('#validation .log-error')).toContainText('bounds');
});

test('导出的 WebVTT 重新导入后完整恢复入点、出点与每个词的时间', async ({ page }) => {
  const before = await page.evaluate(() => window.app.cues);
  const vtt = await page.evaluate(() => {
    window.app.exportVttFile();
    return window.app.lastVtt;
  });
  expect(vtt.startsWith('WEBVTT')).toBeTruthy();

  const restored = await page.evaluate(async (text) => {
    const module = await import('/src/subtitles.js');
    return module.importVtt(text);
  }, vtt);
  expect(restored).toHaveLength(3);
  for (let i = 0; i < before.length; i += 1) {
    expect(restored[i].start).toBeCloseTo(before[i].start, 3);
    expect(restored[i].end).toBeCloseTo(before[i].end, 3);
    expect(restored[i].words).toHaveLength(before[i].words.length);
    for (let w = 0; w < before[i].words.length; w += 1) {
      expect(restored[i].words[w].text).toBe(before[i].words[w].text);
      expect(restored[i].words[w].start).toBeCloseTo(before[i].words[w].start, 3);
      expect(restored[i].words[w].end).toBeCloseTo(before[i].words[w].end, 3);
    }
  }
});

test('通过文件选择器导入 VTT 后界面状态恢复', async ({ page }) => {
  const vtt = await page.evaluate(() => {
    window.app.exportVttFile();
    return window.app.lastVtt;
  });
  await page.setInputFiles('#vtt-file', {
    name: 'subtitles.vtt',
    mimeType: 'text/vtt',
    buffer: Buffer.from(vtt),
  });
  await expect(page.locator('#event-log .log-ok').first()).toContainText('完整恢复');
  await expect(page.locator('#validation .log-ok')).toBeVisible();
});

test('缺少 NOTE 数据时仍可用内联时间戳恢复词起点', async ({ page }) => {
  const fallback = `WEBVTT

00:00:00.200 --> 00:00:01.600
<00:00.200>准备 <00:00.900>开始
`;
  const restored = await page.evaluate(async (text) => {
    const module = await import('/src/subtitles.js');
    return module.importVtt(text);
  }, fallback);
  expect(restored[0].words[0].start).toBeCloseTo(0.2, 3);
  expect(restored[0].words[0].end).toBeCloseTo(0.9, 3);
  expect(restored[0].words[1].end).toBeCloseTo(1.6, 3);
});
});
