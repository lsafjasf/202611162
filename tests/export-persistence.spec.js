import { test, expect } from '@playwright/test';
import { gotoStudio } from './helpers.js';

test.describe('导出前检查与保存/重载一致性', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
  });

  test('正常参数导出通过静音/削波/声道检查并生成 WAV 报告', async ({ page }) => {
    const result = await page.evaluate(() => window.app.exportWav());
    expect(result).not.toBeNull();
    expect(result.report.ok).toBeTruthy();
    expect(result.report.silent).toBeFalsy();
    expect(result.report.clipping).toBeFalsy();
    expect(result.report.missingChannel).toBeFalsy();
    expect(result.report.peakL).toBeGreaterThan(0.05);
    expect(result.report.peakR).toBeGreaterThan(0.05);
    const blobType = await page.evaluate(() => window.app.lastExport.blob.type);
    expect(blobType).toBe('audio/wav');
    expect(result.report.duration).toBeCloseTo(6, 2);
    await expect(page.locator('#export-checks .log-ok')).toBeVisible();
  });

  test('静音检查：增益过低导致静音时拒绝导出', async ({ page }) => {
    await page.evaluate(() => {
      for (const params of window.app.paramsById.values()) {
        params.gain = 0.005;
        params.delayMs = 0;
      }
    });
    const result = await page.evaluate(() => window.app.exportWav());
    expect(result).toBeNull();
    await expect(page.locator('#export-checks .log-error')).toContainText('静音');
  });

  test('削波检查：高增益叠加导致削波时拒绝导出', async ({ page }) => {
    await page.evaluate(() => {
      for (const params of window.app.paramsById.values()) {
        params.gain = 0.95;
        params.beats = 6;
        params.beatHz = 12;
        params.delayMs = 20;
      }
    });
    const result = await page.evaluate(() => window.app.exportWav());
    expect(result).toBeNull();
    await expect(page.locator('#export-checks .log-error')).toContainText('削波');
  });

  test('声道缺失检查：单声道信号被识别并拒绝导出', async ({ page }) => {
    const report = await page.evaluate(async () => {
      const sr = 48000;
      const offline = new OfflineAudioContext(2, sr, sr);
      const merger = new ChannelMergerNode(offline, { numberOfInputs: 2 });
      merger.connect(offline.destination);
      const osc = new OscillatorNode(offline, { frequency: 440 });
      const gain = new GainNode(offline, { gain: 0.4 });
      osc.connect(gain).connect(merger, 0); // left only, right stays silent
      osc.start(0);
      osc.stop(0.5);
      const buffer = await offline.startRendering();
      const { inspectBuffer } = await import('/src/wav.js');
      return inspectBuffer(buffer);
    });
    expect(report.missingChannel).toBeTruthy();
    expect(report.ok).toBeFalsy();
  });

  test('保存参数后重新载入，两次导出的时长与关键峰值一致', async ({ page }) => {
    await page.evaluate(() => {
      const app = window.app;
      app.paramsById.get('c1').frequency = 660;
      app.paramsById.get('c1').pan = -0.4;
      app.paramsById.get('c2').delayMs = 250;
      app.paramsById.get('c3').beatHz = 6;
    });
    const first = await page.evaluate(() => window.app.exportWav());
    expect(first).not.toBeNull();
    await page.evaluate(() => { window.__firstBlob = window.app.lastExport.blob; });
    const saved = await page.evaluate(() => window.app.saveSession());
    expect(saved).toBeTruthy();

    // Mutate after saving, then reload must restore the saved values.
    await page.evaluate(() => {
      window.app.paramsById.get('c1').frequency = 200;
      window.app.paramsById.get('c2').delayMs = 50;
    });
    const reloaded = await page.evaluate(() => window.app.reloadSession());
    expect(reloaded).toBeTruthy();
    const restored = await page.evaluate(() => ({
      frequency: window.app.paramsById.get('c1').frequency,
      pan: window.app.paramsById.get('c1').pan,
      delayMs: window.app.paramsById.get('c2').delayMs,
      beatHz: window.app.paramsById.get('c3').beatHz,
    }));
    expect(restored).toEqual({ frequency: 660, pan: -0.4, delayMs: 250, beatHz: 6 });

    const second = await page.evaluate(() => window.app.exportWav());
    expect(second.report.duration).toBeCloseTo(first.report.duration, 6);
    expect(second.report.peakL).toBeCloseTo(first.report.peakL, 5);
    expect(second.report.peakR).toBeCloseTo(first.report.peakR, 5);

    // WAV-level round-trip: identical length with at most a handful of
    // quantization-boundary byte differences from float->int16 rounding.
    const diffInfo = await page.evaluate(async () => {
      const [bufA, bufB] = await Promise.all([
        window.__firstBlob.arrayBuffer(),
        window.app.lastExport.blob.arrayBuffer(),
      ]);
      if (bufA.byteLength !== bufB.byteLength) return { equal: false, count: -1 };
      const viewA = new Uint8Array(bufA);
      const viewB = new Uint8Array(bufB);
      let count = 0;
      for (let i = 44; i < viewA.length; i += 1) {
        if (viewA[i] !== viewB[i]) count += 1;
      }
      return { equal: count <= 8, count };
    });
    expect(diffInfo.equal).toBeTruthy();
  });

  test('JSON 文件本身也可重新解析并恢复全部参数', async ({ page }) => {
    const text = await page.evaluate(() => {
      window.app.paramsById.get('c2').frequency = 523;
      return window.app.saveSession() && localStorage.getItem('cue-tone-studio/session/v1');
    });
    const parsed = await page.evaluate(async (json) => {
      const module = await import('/src/storage.js');
      return module.parseSession(json);
    }, text);
    expect(parsed.params.c2.frequency).toBe(523);
    expect(parsed.cues).toHaveLength(3);
  });
});
