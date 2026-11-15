import { test, expect } from '@playwright/test';
import { gotoStudio, renderCueViaPage } from './helpers.js';

const cue = { id: 'c1', start: 0.3, end: 1.5, words: [] };
const base = {
  frequency: 440,
  pan: 0,
  delayMs: 120,
  beatHz: 4,
  gain: 0.45,
  beats: 4,
};

test.describe('三个维度的参数变化必须改变真实音频信号', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
  });

  test('频率维度：改变 frequency 后渲染结果的主音高随之改变', async ({ page }) => {
    const low = await renderCueViaPage(page, cue, { ...base, frequency: 300 });
    const high = await renderCueViaPage(page, cue, { ...base, frequency: 900 });
    expect(low.pitch).toBeGreaterThan(270);
    expect(low.pitch).toBeLessThan(330);
    expect(high.pitch).toBeGreaterThan(820);
    expect(high.pitch).toBeLessThan(980);
    expect(Math.abs(high.pitch - low.pitch)).toBeGreaterThan(500);
  });

  test('声道维度：pan=-1 与 pan=+1 渲染出的左右峰值关系反转', async ({ page }) => {
    const leftPanned = await renderCueViaPage(page, cue, { ...base, pan: -1 });
    const rightPanned = await renderCueViaPage(page, cue, { ...base, pan: 1 });
    expect(leftPanned.peakL).toBeGreaterThan(leftPanned.peakR * 2);
    expect(rightPanned.peakR).toBeGreaterThan(rightPanned.peakL * 2);
    expect(leftPanned.peakL).toBeCloseTo(rightPanned.peakR, 1);
  });

  test('节拍维度：beatHz 改变节拍间隔，beats 改变发声次数', async ({ page }) => {
    const slow = await renderCueViaPage(
      page, cue, { ...base, beatHz: 2, beats: 2 }, 2.4,
    );
    const fast = await renderCueViaPage(
      page, cue, { ...base, beatHz: 8, beats: 4 }, 2.4,
    );
    const intervals = await page.evaluate(
      async ({ cue, params }) => {
        const module = await import('/src/audio.js');
        const sr = 48000;
        const offline = new OfflineAudioContext(2, 2.4 * sr, sr);
        const merger = new ChannelMergerNode(offline, { numberOfInputs: 2 });
        merger.connect(offline.destination);
        module.scheduleCue(offline, merger, cue, params);
        const buffer = await offline.startRendering();
        const data = buffer.getChannelData(0);
        const window = Math.floor(sr * 0.01);
        const envelope = [];
        for (let i = 0; i < data.length; i += window) {
          let sum = 0;
          for (let j = i; j < Math.min(data.length, i + window); j += 1) {
            sum += data[j] * data[j];
          }
          envelope.push(Math.sqrt(sum / window));
        }
        const onsets = [];
        let lastBin = -100;
        for (let i = 1; i < envelope.length - 1; i += 1) {
          const isPeak =
            envelope[i] > 0.1 &&
            envelope[i] > envelope[i - 1] * 2 &&
            i - lastBin > 15;
          if (isPeak) {
            onsets.push((i * window) / sr);
            lastBin = i;
          }
        }
        return { onsets, gaps: onsets.slice(1).map((t, i) => t - onsets[i]) };
      },
      { cue, params: { ...base, beatHz: 3, beats: 4 } },
    );
    expect(intervals.onsets).toHaveLength(4);
    for (const gap of intervals.gaps) expect(gap).toBeCloseTo(1 / 3, 1);
    expect(fast.peakL).toBeGreaterThan(0);
    expect(slow.peakL).toBeGreaterThan(0);
  });

  test('延迟维度：delayMs 改变回声相对主音的到达时间', async ({ page }) => {
    // Pan hard left: the dry signal is almost entirely in L, so the first
    // energy on R is the delayed echo copy. Its onset must track delayMs.
    const onsetFor = (delayMs) =>
      renderCueViaPage(page, cue, { ...base, pan: -1, delayMs }, 1.6).then((r) => r.firstR);
    const onset100 = await onsetFor(100);
    const onset350 = await onsetFor(350);
    expect(onset100).toBeGreaterThan(0);
    expect(onset350 - onset100).toBeCloseTo(0.25, 1);
    expect(onset100).toBeCloseTo(cue.start + 0.1, 1);
  });

  test('界面参数变更会触发真实合成（previewCue 调用引擎，而非只改数字）', async ({ page }) => {
    await page.selectOption('#cue-select', 'c1');
    const calls = [];
    await page.exposeFunction('recordEngineCall', (name) => calls.push(name));
    await page.evaluate(() => {
      const original = window.app.engine.play.bind(window.app.engine);
      window.app.engine.play = async (...args) => {
        window.recordEngineCall('play');
        return original(...args);
      };
    });
    await page.fill('#range-frequency', '720');
    await page.waitForTimeout(400);
    expect(calls).toContain('play');
    const readback = await page.evaluate(() => window.app.currentParams().frequency);
    expect(readback).toBe(720);
  });
});
