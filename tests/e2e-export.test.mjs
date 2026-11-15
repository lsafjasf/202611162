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

test('导出三个 WebM：入点、出点与总时长在导出后保持一致', async () => {
  await freshProject(page);
  const expected = await page.evaluate(() => window.__workbench.activeScene().clips
    .map((clip) => ({
      id: clip.id,
      in: clip.inPoint,
      out: clip.outPoint,
      duration: Number((clip.outPoint - clip.inPoint).toFixed(3)),
    })));
  const results = await page.evaluate(async () => {
    const { exportClips } = await import('/src/exporter.js');
    const out = await exportClips(window.__workbench.activeScene());
    return out.map((r) => ({
      clipId: r.clipId,
      aspect: r.aspect,
      width: r.width,
      height: r.height,
      mimeType: r.mimeType,
      size: r.blob.size,
      expectedDuration: r.expectedDuration,
      measuredDuration: r.measuredDuration,
      durationDelta: r.durationDelta,
      events: r.firedEvents.length,
    }));
  });
  assert.equal(results.length, 3);
  for (const result of results) {
    const spec = expected.find((e) => e.id === result.clipId);
    assert.equal(result.expectedDuration, spec.duration);
    assert.ok(result.size > 5000, `${result.clipId} 应有实际 WebM 数据`);
    assert.match(result.mimeType, /webm/);
    assert.ok(result.durationDelta <= 0.35,
      `${result.clipId} 时长偏差 ${result.durationDelta}s 超限`);
    assert.ok(result.events > 0, `${result.clipId} 应包含音频事件`);
  }
  const dims = Object.fromEntries(results.map((r) => [r.aspect, [r.width, r.height]]));
  assert.deepEqual(dims.landscape, [480, 270]);
  assert.deepEqual(dims.square, [360, 360]);
  assert.deepEqual(dims.portrait, [270, 480]);
});

test('导出失败时保留原工程并恢复快照', async () => {
  await freshProject(page);
  const before = await projectState(page);
  await page.check('#faultToggle');
  let threw = false;
  try {
    await page.evaluate(async () => window.__workbench.doExport());
  } catch (error) {
    threw = true;
  }
  assert.equal(threw, true);
  await page.uncheck('#faultToggle');
  const after = await projectState(page);
  assert.deepEqual(after.scenes, before.scenes);
  const report = await page.locator('#exportReport').textContent();
  assert.match(report, /导出失败/);
  assert.match(report, /保留并恢复原工程/);
});

test('导出后入出点未被修改，工程仍可继续编辑', async () => {
  await freshProject(page);
  const before = await projectState(page);
  await page.evaluate(async () => {
    const { exportClips } = await import('/src/exporter.js');
    await exportClips(window.__workbench.activeScene());
  });
  const after = await projectState(page);
  for (let i = 0; i < before.scenes.length; i += 1) {
    for (let j = 0; j < before.scenes[i].clips.length; j += 1) {
      assert.equal(after.scenes[i].clips[j].inPoint, before.scenes[i].clips[j].inPoint);
      assert.equal(after.scenes[i].clips[j].outPoint, before.scenes[i].clips[j].outPoint);
    }
  }
});
