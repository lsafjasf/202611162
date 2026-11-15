import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import {
  DEFAULT_VIEW,
  applyView,
  capturePng,
  compareImages,
  cropPng,
  cropMean,
  decodeDataUrl,
  getAudit,
  imageStats,
  openExhibit,
  settleFrames,
  sha256
} from "./helpers";

test("default scene exports, recomputes, and preserves geometry and pixels", async ({
  page
}) => {
  await openExhibit(page);
  const initial = await getAudit(page);
  expect(initial.state).toEqual(DEFAULT_VIEW);
  expect(initial.geometry.objectCount).toBe(6);
  expect(initial.geometry.vertexCount).toBeGreaterThan(200);
  expect(initial.geometry.triangleCount).toBeGreaterThan(400);
  expect(initial.render.drawnFaces).toBeGreaterThan(200);
  expect(initial.render.normalsOutward).toBe(true);
  expect(initial.render.depthOrderMonotonic).toBe(true);
  expect(initial.labels).toHaveLength(3);

  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportButton");
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const fileBuffer = await readFile(downloadPath as string);
  const exported = PNG.sync.read(fileBuffer);
  const fileStats = imageStats(exported);
  expect(fileStats.width).toBe(960);
  expect(fileStats.height).toBe(640);
  expect(fileStats.mean).toBeGreaterThan(8);
  expect(fileStats.deviation).toBeGreaterThan(12);
  expect(fileStats.colorBins).toBeGreaterThan(90);

  await expect
    .poll(async () => (await getAudit(page)).lastExport?.match)
    .toBe(true);
  const exportedAudit = await getAudit(page);
  expect(exportedAudit.lastExport?.pngSha256).toBe(sha256(fileBuffer));
  expect(exportedAudit.lastExport?.geometryDigest).toBe(initial.geometry.geometryDigest);
  expect(exportedAudit.lastExport?.state).toEqual(DEFAULT_VIEW);

  const beforeRecompute = await capturePng(page);
  const recomputed = await page.evaluate(() => window.__EXHIBIT__.recompute());
  expect(recomputed.before.objectCount).toBe(recomputed.after.objectCount);
  expect(recomputed.before.objectPositions).toEqual(recomputed.after.objectPositions);
  expect(recomputed.before.objectBounds).toEqual(recomputed.after.objectBounds);
  expect(recomputed.geometryStable).toBe(true);
  expect(recomputed.renderStable).toBe(true);

  const afterRecompute = await capturePng(page);
  expect(afterRecompute.pngSha256).toBe(beforeRecompute.pngSha256);
  expect(afterRecompute.pixelDigest).toBe(beforeRecompute.pixelDigest);
  expect(afterRecompute.match).toBe(true);
  const recomputedAudit = await getAudit(page);
  expect(recomputedAudit.geometry.geometryDigest).toBe(initial.geometry.geometryDigest);
  expect(recomputedAudit.render.drawOrderDigest).toBe(initial.render.drawOrderDigest);
});

test("invalid parameters are explicit, atomic, and never blank the frame", async ({ page }) => {
  await openExhibit(page);
  const before = await getAudit(page);
  const beforeCapture = await capturePng(page);

  const failed = await page.evaluate(() =>
    window.__EXHIBIT__.tryApplyParams({
      material: "ice",
      lighting: "laser",
      yaw: Number.NaN,
      pitch: 140,
      zoom: 99,
      mystery: true
    })
  );
  expect(failed.ok).toBe(false);
  if (!failed.ok) {
    expect(failed.error).toContain("Unknown parameter");
    expect(failed.error).toContain("material must be one of");
    expect(failed.error).toContain("lighting must be one of");
    expect(failed.error).toContain("yaw must be a finite number");
    expect(failed.error).toContain("pitch must be between");
    expect(failed.error).toContain("zoom must be between");
  }
  await expect(page.locator("#errorBanner")).toBeVisible();
  await expect(page.locator("#errorMessage")).toContainText("zoom must be between");

  const after = await getAudit(page);
  expect(after.state).toEqual(before.state);
  expect(after.geometry.geometryDigest).toBe(before.geometry.geometryDigest);
  expect(after.previewDigest).toBe(before.previewDigest);
  const afterCapture = await capturePng(page);
  expect(afterCapture.pngSha256).toBe(beforeCapture.pngSha256);
  expect(afterCapture.match).toBe(true);
  expect(imageStats(decodeDataUrl(afterCapture.dataUrl)).deviation).toBeGreaterThan(12);

  const beforeImport = (await getAudit(page)).previewDigest;
  await page.click("#importButton");
  await expect(page.locator("#importDialog")).toBeVisible();
  await page.locator("#importJson").fill('{"zoom": 4, "material": "stone"}');
  await page.click("#applyImport");
  await expect(page.locator("#importError")).toBeVisible();
  await expect(page.locator("#importError")).toContainText("zoom must be between");
  await expect(page.locator("#importError")).toContainText("material must be one of");
  await expect(page.locator("#importDialog")).toBeVisible();
  expect((await getAudit(page)).previewDigest).toBe(beforeImport);
  await page.click("#cancelImport");
});

test("extreme rear view keeps outward normals, labels anchored, and image populated", async ({
  page
}) => {
  await openExhibit(page);
  const baseline = await getAudit(page);
  const extremeState = {
    material: "resin" as const,
    lighting: "gallery" as const,
    yaw: 180,
    pitch: -70,
    zoom: 2.2,
    autoRotate: false
  };
  const applied = await applyView(page, extremeState);
  expect(applied).toEqual(extremeState);
  const extreme = await getAudit(page);
  expect(extreme.geometry.objectCount).toBe(6);
  expect(extreme.render.normalsOutward).toBe(true);
  expect(extreme.render.depthOrderMonotonic).toBe(true);
  expect(extreme.render.transparentFaces).toBeGreaterThan(0);
  expect(extreme.render.backfaceFaces).toBeGreaterThan(0);

  const extremeCapture = await capturePng(page);
  expect(extremeCapture.match).toBe(true);
  const extremeImage = decodeDataUrl(extremeCapture.dataUrl);
  expect(imageStats(extremeImage).deviation).toBeGreaterThan(10);
  expect(imageStats(extremeImage).colorBins).toBeGreaterThan(75);
  expect(extremeImage.width).toBe(960);
  expect(extremeImage.height).toBe(640);

  const anchorMap: Record<string, [number, number, number]> = {
    relic: [0.67, 1.72, 0.33],
    normals: [-1.13, -0.24, 0.72],
    plinth: [0.82, -1.71, 0.54]
  };
  for (const label of extreme.labels) {
    const projected = await page.evaluate(
      (anchor) => window.__EXHIBIT__.projectPoint(anchor),
      anchorMap[label.id]
    );
    expect(projected.visible).toBe(true);
    expect(label.anchor.x).toBeCloseTo(projected.x, 8);
    expect(label.anchor.y).toBeCloseTo(projected.y, 8);
    const leaderOnEdge =
      Math.abs(label.leader.x - label.box.x) < 1e-8 ||
      Math.abs(label.leader.x - (label.box.x + label.box.width)) < 1e-8;
    expect(leaderOnEdge).toBe(true);
  }
  expect(extreme.labels[0].anchor.x).not.toBeCloseTo(baseline.labels[0].anchor.x, 1);

  await applyView(page, { ...extremeState, yaw: 0, pitch: 7, zoom: 1 });
  const frontCapture = await capturePng(page);
  const front = decodeDataUrl(frontCapture.dataUrl);
  await applyView(page, { ...extremeState, yaw: 180, pitch: 7, zoom: 1 });
  const rearAudit = await getAudit(page);
  const rearCapture = await capturePng(page);
  const rear = decodeDataUrl(rearCapture.dataUrl);
  const frontMean = cropMean(front, 350, 135, 610, 515);
  const rearMean = cropMean(rear, 350, 135, 610, 515);
  expect(frontMean).toBeGreaterThan(18);
  expect(rearMean).toBeGreaterThan(18);
  expect(rearMean / frontMean).toBeGreaterThan(0.42);
  expect(rearMean / frontMean).toBeLessThan(2.4);
  expect(rearAudit.render.backfaceFaces).toBeGreaterThan(0);
  expect(rearAudit.render.normalsOutward).toBe(true);

  const labelsAfterFront = (await getAudit(page)).labels;
  await applyView(page, { ...extremeState, yaw: 123, pitch: 22, zoom: 1.75 });
  const labelsAfterMove = (await getAudit(page)).labels;
  const changed = labelsAfterMove.some(
    (label, index) =>
      Math.hypot(
        label.anchor.x - labelsAfterFront[index].anchor.x,
        label.anchor.y - labelsAfterFront[index].anchor.y
      ) > 5
  );
  expect(changed).toBe(true);
  for (const label of labelsAfterMove) {
    const projected = await page.evaluate(
      (anchor) => window.__EXHIBIT__.projectPoint(anchor),
      anchorMap[label.id]
    );
    expect(label.anchor.x).toBeCloseTo(projected.x, 8);
    expect(label.anchor.y).toBeCloseTo(projected.y, 8);
  }
});

test("transparent faces use a stable depth order and reproducible export", async ({ page }) => {
  await openExhibit(page);
  await applyView(page, {
    material: "resin",
    lighting: "dawn",
    yaw: 38,
    pitch: 11,
    zoom: 1.12,
    autoRotate: false
  });
  const firstAudit = await getAudit(page);
  expect(firstAudit.render.transparentFaces).toBeGreaterThan(10);
  expect(firstAudit.render.depthOrderMonotonic).toBe(true);
  const firstCapture = await capturePng(page);
  const secondCapture = await capturePng(page);
  expect(secondCapture.pngSha256).toBe(firstCapture.pngSha256);
  expect(secondCapture.pixelDigest).toBe(firstCapture.pixelDigest);
  expect(secondCapture.match).toBe(true);

  const recomputed = await page.evaluate(() => window.__EXHIBIT__.recompute());
  expect(recomputed.geometryStable).toBe(true);
  const afterAudit = await getAudit(page);
  const afterCapture = await capturePng(page);
  expect(afterAudit.render.drawOrderDigest).toBe(firstAudit.render.drawOrderDigest);
  expect(afterAudit.render.depthOrderMonotonic).toBe(true);
  expect(afterCapture.pngSha256).toBe(firstCapture.pngSha256);

  const combinationHashes = new Set<string>();
  for (const material of ["bronze", "resin"] as const) {
    for (const lighting of ["dawn", "gallery"] as const) {
      const state = await applyView(page, { material, lighting });
      expect(state.material).toBe(material);
      expect(state.lighting).toBe(lighting);
      const result = await capturePng(page);
      expect(result.match).toBe(true);
      combinationHashes.add(result.pngSha256);
    }
  }
  expect(combinationHashes.size).toBe(4);
});

test("pause freezes pixels and resuming does not apply paused elapsed time", async ({ page }) => {
  await openExhibit(page);
  await applyView(page, { ...DEFAULT_VIEW, yaw: 10, autoRotate: true });
  const started = await page.evaluate(() => window.__EXHIBIT__.getState());
  expect(started.autoRotate).toBe(true);
  await page.waitForTimeout(350);
  const moving = await page.evaluate(() => window.__EXHIBIT__.getState());
  expect(moving.yaw).not.toBe(started.yaw);

  await page.click("#pauseButton");
  await settleFrames(page);
  const paused = await getAudit(page);
  expect(paused.state.autoRotate).toBe(false);
  await expect(page.locator("#liveText")).toHaveText("VIEW PAUSED");
  const pausedCapture = await capturePng(page);
  const canvasScreenshot = PNG.sync.read(await page.locator("#stage").screenshot());
  const exportedImage = decodeDataUrl(pausedCapture.dataUrl);
  compareImages(cropPng(canvasScreenshot, 960, 640), exportedImage);

  await page.waitForTimeout(450);
  const stillPaused = await getAudit(page);
  expect(stillPaused.state.yaw).toBe(paused.state.yaw);
  expect(stillPaused.previewDigest).toBe(paused.previewDigest);
  const frozenCapture = await capturePng(page);
  expect(frozenCapture.pngSha256).toBe(pausedCapture.pngSha256);

  const resumedAt = stillPaused.state.yaw;
  await page.click("#pauseButton");
  await expect(page.locator("#liveText")).toHaveText("TURNTABLE LIVE");
  await page.waitForTimeout(420);
  const resumed = await page.evaluate(() => window.__EXHIBIT__.getState());
  const delta = ((resumed.yaw - resumedAt + 540) % 360) - 180;
  expect(delta).toBeGreaterThan(1.8);
  expect(delta).toBeLessThan(6.5);
  await page.click("#pauseButton");
});

test("saved preset reloads the same structure and PNG hash across a page reload", async ({
  page
}) => {
  await openExhibit(page);
  const savedView = {
    material: "resin" as const,
    lighting: "gallery" as const,
    yaw: 42,
    pitch: -13,
    zoom: 1.27,
    autoRotate: false
  };
  await applyView(page, savedView);
  const before = await getAudit(page);
  const beforeCapture = await capturePng(page);

  await page.fill("#presetName", "Hash Study");
  await page.click("#savePreset");
  await expect(page.locator("#savedCount")).toHaveText("1 SAVED");
  await expect(page.locator("#presetSelect")).toHaveValue("Hash Study");
  const saved = await page.evaluate(() => window.__EXHIBIT__.listPresets());
  expect(saved).toHaveLength(1);
  expect(saved[0].geometryDigest).toBe(before.geometry.geometryDigest);
  expect(saved[0].params).toEqual(savedView);

  await applyView(page, { material: "bronze", yaw: -111, zoom: 0.72 });
  await page.click("#loadPreset");
  await settleFrames(page);
  const loaded = await getAudit(page);
  expect(loaded.state).toEqual(savedView);
  expect(loaded.geometry.geometryDigest).toBe(before.geometry.geometryDigest);
  expect(loaded.render.drawOrderDigest).toBe(before.render.drawOrderDigest);
  const loadedCapture = await capturePng(page);
  expect(loadedCapture.pngSha256).toBe(beforeCapture.pngSha256);
  expect(loadedCapture.match).toBe(true);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__EXHIBIT__));
  await page.selectOption("#presetSelect", "Hash Study");
  await page.click("#loadPreset");
  await settleFrames(page);
  const reloaded = await getAudit(page);
  expect(reloaded.state).toEqual(savedView);
  expect(reloaded.geometry.geometryDigest).toBe(before.geometry.geometryDigest);
  expect(reloaded.render.drawOrderDigest).toBe(before.render.drawOrderDigest);
  const reloadedCapture = await capturePng(page);
  expect(reloadedCapture.pngSha256).toBe(beforeCapture.pngSha256);
  expect(reloadedCapture.previewDigest).toBe(reloadedCapture.pixelDigest);

  const beforeUndo = reloaded.state;
  const changed = await applyView(page, { ...savedView, yaw: 77 });
  expect(changed.yaw).toBe(77);
  await page.click("#undoButton");
  await settleFrames(page);
  expect((await getAudit(page)).state).toEqual(beforeUndo);
  await page.click("#redoButton");
  await settleFrames(page);
  expect((await getAudit(page)).state.yaw).toBe(77);
});
