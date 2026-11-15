import { chromium } from 'playwright';

export const BASE = 'http://127.0.0.1:4523/index.html';

export async function launchPage() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read'],
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });
  await page.goto(BASE);
  await page.waitForFunction(() => Boolean(window.__workbench));
  return { browser, context, page };
}

export async function freshProject(page) {
  await page.evaluate(() => {
    localStorage.clear();
    window.__workbench.resetProject();
  });
}

export function projectState(page) {
  return page.evaluate(() => {
    const state = window.__workbench.getState();
    return {
      activeSceneId: state.project.activeSceneId,
      scenes: state.project.scenes.map((scene) => ({
        id: scene.id,
        clips: scene.clips.map((clip) => ({
          id: clip.id,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          crop: clip.crop,
          transition: clip.transition,
        })),
        subtitles: scene.subtitles,
        audioStart: scene.audio.startAt,
        keyframes: scene.subjects.map((s) => ({ id: s.id, keyframes: s.keyframes })),
      })),
    };
  });
}

export async function canvasPixels(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel);
    const ctx = canvas.getContext('2d');
    return {
      width: canvas.width,
      height: canvas.height,
      data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data),
    };
  }, selector);
}

export function diffRatio(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 4
      || Math.abs(a.data[i + 1] - b.data[i + 1]) > 4
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > 4) diff += 1;
  }
  return diff / (a.data.length / 4);
}
