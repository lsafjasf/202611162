import { test, expect } from '@playwright/test';
import { gotoStudio } from './helpers.js';

test.describe('仪表收敛、播放控制与 Canvas', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
  });

  test('播放后短时间窗内仪表读到非零峰值且频率接近参数值', async ({ page }) => {
    await page.selectOption('#cue-select', 'c1');
    await page.fill('#range-frequency', '600');
    await page.evaluate(() => {
      window.__meterSamples = [];
      window.__sampleMeters = setInterval(() => {
        const freqText = document.getElementById('meter-freq').textContent;
        window.__meterSamples.push({
          peakL: Number(document.getElementById('meter-l').textContent),
          peakR: Number(document.getElementById('meter-r').textContent),
          freq: freqText === '—' ? 0 : Number(freqText.split(' ')[0]),
        });
      }, 80);
    });
    await page.evaluate(() => window.app.replay());
    const converged = await page.waitForFunction(
      () => {
        const peakL = Number(document.getElementById('meter-l').textContent);
        const peakR = Number(document.getElementById('meter-r').textContent);
        const freqText = document.getElementById('meter-freq').textContent;
        const freq = freqText === '—' ? 0 : Number(freqText.split(' ')[0]);
        return peakL > 0.05 && peakR > 0.05 && freq > 450 && freq < 800;
      },
      null,
      { timeout: 4000, polling: 100 },
    );
    expect(await converged.jsonValue()).toBeTruthy();
    const samples = await page.evaluate(() => {
      clearInterval(window.__sampleMeters);
      return window.__meterSamples;
    });
    expect(samples.some((sample) => Math.abs(sample.freq - 600) < 40)).toBeTruthy();
    expect(samples.some((sample) => sample.peakL > 0.05 && sample.peakR > 0.05)).toBeTruthy();
    await expect(page.locator('#meter-delay')).toContainText('120');
    await expect(page.locator('#meter-pan')).toContainText('0.00');
  });

  test('暂停后冻结位置，继续后位置再次推进', async ({ page }) => {
    await page.evaluate(() => window.app.replay());
    await page.waitForTimeout(350);
    await page.click('#pause-btn');
    const frozen = await page.evaluate(() => window.app.engine.position);
    expect(frozen).toBeGreaterThan(0.2);
    await page.waitForTimeout(300);
    const still = await page.evaluate(() => window.app.engine.position);
    expect(still).toBeCloseTo(frozen, 2);
    await page.evaluate(() => window.app.engine.resume());
    await page.waitForTimeout(300);
    const moved = await page.evaluate(() => window.app.engine.position);
    expect(moved).toBeGreaterThan(still);
  });

  test('重播始终从零开始，停止回到初始态', async ({ page }) => {
    await page.evaluate(() => window.app.replay());
    await page.waitForTimeout(400);
    await page.evaluate(() => window.app.replay());
    await page.waitForTimeout(120);
    const pos = await page.evaluate(() => window.app.engine.position);
    expect(pos).toBeLessThan(0.3);
    await page.click('#play-btn');
    expect(await page.evaluate(() => window.app.engine.playing)).toBeFalsy();
  });

  test('参数重置恢复默认值并重新触发合成', async ({ page }) => {
    await page.selectOption('#cue-select', 'c2');
    await page.fill('#range-frequency', '999');
    await page.fill('#range-delayMs', '400');
    await page.click('#reset-params');
    const restored = await page.evaluate(() => window.app.currentParams());
    expect(restored.frequency).toBe(440);
    expect(restored.delayMs).toBe(120);
    await expect(page.locator('#value-frequency')).toContainText('440');
  });

  test('离线渲染后 Canvas 上绘制出波形像素', async ({ page }) => {
    const before = await page.evaluate(() => {
      const canvas = document.getElementById('timeline');
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        .some((v, i) => i % 4 === 3 && v > 0);
    });
    expect(before).toBeTruthy();
    await page.click('#render-wave-btn');
    await expect(page.locator('#event-log .log-ok').first()).toContainText('波形');
    const hasWavePixels = await page.evaluate(() => {
      const canvas = document.getElementById('timeline');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let blueish = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2] > 180 && data[i + 2] > data[i] + 40) blueish += 1;
      }
      return blueish;
    });
    expect(hasWavePixels).toBeGreaterThan(50);
  });

  test('拖拽提示音尝试重叠时被钳制在边界外，合法移动会保留', async ({ page }) => {
    const box = await page.locator('#timeline').boundingBox();
    const app = await page.evaluate(() => window.app);
    const c1Start = app.cues[0].start;
    const c2 = app.cues[1];
    const startPoint = await page.evaluate(() => {
      const cue = window.app.cues[1];
      const timeline = window.app.timeline;
      return {
        x: timeline.timeToX((cue.start + cue.end) / 2),
        y: timeline.laneY(1) + 20,
      };
    });
    const targetPoint = await page.evaluate(() => {
      const timeline = window.app.timeline;
      // Same lane, at cue 1's midpoint: cue 2's new start would sit inside
      // cue 1's [start,end] interval, which the validator must reject.
      return { x: timeline.timeToX(0.6), y: timeline.laneY(1) + 20 };
    });
    await page.mouse.move(box.x + startPoint.x, box.y + startPoint.y);
    await page.mouse.down();
    await page.mouse.move(box.x + targetPoint.x, box.y + targetPoint.y, { steps: 12 });
    await page.mouse.up();
    const after = await page.evaluate(() => window.app.cues[1].start);
    // The drag is clamped so cue 2 never crosses cue 1's out point.
    const c1End = await page.evaluate(() => window.app.cues[0].end);
    expect(after).toBeGreaterThanOrEqual(c1End - 0.05);
    expect(after).toBeLessThan(c2.start);
    await expect(page.locator('#validation .log-ok')).toBeVisible();
    expect(await page.evaluate(() => window.app.cues[0].start)).toBeCloseTo(c1Start, 6);

    // A legal move within free space is accepted and persisted.
    const legalTarget = await page.evaluate(() => {
      const timeline = window.app.timeline;
      return { x: timeline.timeToX(2.6), y: timeline.laneY(2) + 20 };
    });
    const c3Start = await page.evaluate(() => {
      const cue = window.app.cues[2];
      const timeline = window.app.timeline;
      window.__dragFrom = { x: timeline.timeToX((cue.start + cue.end) / 2), y: timeline.laneY(2) + 20 };
      return cue.start;
    });
    const dragFrom = await page.evaluate(() => window.__dragFrom);
    await page.mouse.move(box.x + dragFrom.x, box.y + dragFrom.y);
    await page.mouse.down();
    await page.mouse.move(box.x + legalTarget.x, box.y + legalTarget.y, { steps: 8 });
    await page.mouse.up();
    const movedCue = await page.evaluate(() => window.app.cues[2]);
    expect(movedCue.start).not.toBeCloseTo(c3Start, 3);
    await expect(page.locator('#validation .log-ok')).toBeVisible();
  });
});
