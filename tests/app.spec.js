import { test, expect } from "@playwright/test";

test("统一时钟、保存恢复、帧校验与失败保护", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.studio));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.studio));

  const initial = await page.evaluate(() => window.studio.getState());
  expect(initial.cutCount).toBe(5);
  expect(initial.keyframeCount).toBe(9);
  expect(initial.subtitleCount).toBe(5);

  await page.locator("#playPause").click();
  await page.waitForFunction(() => window.studio.getState().time > 0.35);
  const beforeSceneSwitch = await page.evaluate(() => window.studio.getState());
  await page.locator(".scene-tab").nth(1).click();
  await page.waitForFunction(
    (generation) => window.studio.getState().audioGeneration > generation,
    beforeSceneSwitch.audioGeneration,
  );
  const afterSceneSwitch = await page.evaluate(() => window.studio.getState());
  expect(afterSceneSwitch.sceneId).toBe("ember");
  expect(afterSceneSwitch.audioLastStart.sceneId).toBe("ember");
  expect(afterSceneSwitch.audioGeneration).toBeGreaterThan(beforeSceneSwitch.audioGeneration);
  await page.locator("#playPause").click();

  const compare = await page.evaluate(() => window.studio.compareAt(5.05));
  expect(compare.passed).toBe(true);
  expect(compare.hashA).toBe(compare.hashB);
  expect(compare.eventA).toEqual(compare.eventB);
  await page.locator("#closeCompare").click();

  await page.evaluate(() => window.studio.seekTo(5.05));
  await page.locator('[data-camera="C"]').click();
  await page.locator("#addKeyframe").click();
  await page.locator(".scene-tab").nth(1).click();
  await page.evaluate(() => {
    const slider = document.querySelector("#audioStart");
    slider.value = "0.6";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    window.studio.saveNow();
  });

  const edited = await page.evaluate(() => window.studio.getState());
  expect(edited.cutCount).toBe(6);
  expect(edited.keyframeCount).toBe(10);
  expect(edited.sceneId).toBe("ember");
  expect(edited.audioStart).toBe(0.6);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.studio));
  const restored = await page.evaluate(() => ({
    state: window.studio.getState(),
    project: window.studio.getProject(),
  }));
  expect(restored.project.cuts.length).toBe(6);
  expect(
    restored.project.cameras.reduce((sum, camera) => sum + camera.keyframes.length, 0),
  ).toBe(10);
  expect(restored.project.subtitles.length).toBe(5);
  expect(restored.project.audio.start).toBe(0.6);
  expect(restored.project.activeScene).toBe("ember");
  expect(restored.project.cuts[1].transition.type).not.toBe("none");

  const shotExport = await page.evaluate(() =>
    window.studio.runExport({ video: false, shots: true }),
  );
  expect(shotExport.ok).toBe(true);
  expect(shotExport.manifest.range.duration).toBe(16.5);
  expect(shotExport.manifest.range.frameCount).toBe(495);
  expect(shotExport.manifest.integrity.projectUnchanged).toBe(true);

  const preservation = await page.evaluate(async () => {
    const before = await window.studio.projectFingerprint();
    window.studio.simulateExportFailure();
    let failure;
    try {
      await window.studio.runExport({ video: false, shots: true });
    } catch (error) {
      failure = { message: error.message, unchanged: error.projectUnchanged };
    }
    const after = await window.studio.projectFingerprint();
    return { before, after, failure };
  });
  expect(preservation.failure.unchanged).toBe(true);
  expect(preservation.before).toBe(preservation.after);
});
