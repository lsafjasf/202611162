import { expect } from '@playwright/test';

// Render one cue via the page's own served audio module and return numeric
// signal analysis. Playback and export call the same scheduleCue() routine,
// so these measurements prove the synthesized audio itself changes.
export async function renderCueViaPage(page, cue, params, duration = 2.4) {
  return page.evaluate(async ({ cue, params, duration }) => {
    const module = await import('/src/audio.js');
    const sampleRate = 48000;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const merger = new ChannelMergerNode(offline, { numberOfInputs: 2 });
    merger.connect(offline.destination);
    module.scheduleCue(offline, merger, cue, params);
    const buffer = await offline.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const peak = (data) => data.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const firstEnergy = (data) => {
      for (let i = 0; i < data.length; i += 1) {
        if (Math.abs(data[i]) > 0.02) return i / sampleRate;
      }
      return -1;
    };
    const useLeft = peak(left) >= peak(right);
    const dominant = buffer.getChannelData(useLeft ? 0 : 1);
    const startIdx = Math.floor((cue.start + 0.02) * sampleRate);
    const frame = dominant.slice(startIdx, startIdx + Math.floor(sampleRate * 0.4));
    // Zero-crossing pitch estimate — reliable for the square-wave oscillator.
    let crossings = 0;
    let prev = frame[0];
    for (let i = 1; i < frame.length; i += 1) {
      if (prev <= 0 && frame[i] > 0) crossings += 1;
      prev = frame[i];
    }
    const pitch = crossings / (frame.length / sampleRate);
    return {
      sampleRate,
      duration: buffer.duration,
      peakL: peak(left),
      peakR: peak(right),
      firstL: firstEnergy(left),
      firstR: firstEnergy(right),
      pitch,
    };
  }, { cue, params, duration });
}

export async function gotoStudio(page) {
  await page.goto('/');
  await expect(page.locator('#timeline')).toBeVisible();
  await page.evaluate(() => window.app.engine.ensureContext());
}
