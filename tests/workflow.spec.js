import { test, expect } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";

async function openLab(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__opticalLab?.ready === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}

test("pause freezes every pixel and resume continues without a time jump", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => {
    window.__opticalLab.applyScenario("default");
    window.__opticalLab.pause();
  });
  const frozen = await page.evaluate(() => window.__opticalLab.getState({ includePixels: true }));
  await page.waitForTimeout(420);
  const stillFrozen = await page.evaluate(() => window.__opticalLab.getState({ includePixels: true }));
  expect(stillFrozen.orbitAngle).toBe(frozen.orbitAngle);
  expect(stillFrozen.previewHash).toBe(frozen.previewHash);
  expect(stillFrozen.geometryDigest).toBe(frozen.geometryDigest);

  await page.evaluate(() => window.__opticalLab.resume());
  await page.waitForTimeout(260);
  const resumed = await page.evaluate(() => window.__opticalLab.getState({ includePixels: true }));
  expect(resumed.paused).toBe(false);
  expect(resumed.orbitAngle).not.toBe(stillFrozen.orbitAngle);
  expect(resumed.lastDelta).toBeLessThanOrEqual(0.051);
  const angleStep = Math.abs(resumed.orbitAngle - stillFrozen.orbitAngle);
  expect(angleStep).toBeLessThan(2.2);
  expect(resumed.previewHash).not.toBe(frozen.previewHash);
});

test("save, reload and load reproduce preview and PNG hashes", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => {
    window.__opticalLab.applyScenario("default");
    window.__opticalLab.pause();
    window.__opticalLab.applySettings({
      selected: "resin",
      roughness: { resin: 0.72 },
      lights: { A: { azimuth: 322, elevation: 34, intensity: 1.8 } },
      camera: { yaw: 24, pitch: 8, zoom: 1.18 },
      autoOrbit: false,
      paused: true
    });
  });
  await page.click("#save-button");
  const saved = await page.evaluate(() => {
    const payload = JSON.parse(localStorage.getItem("lumen-material-lab.state.v1"));
    return { payload, live: window.__opticalLab.getState({ includePixels: true }) };
  });
  expect(saved.payload.previewHash).toBe(saved.live.previewHash);
  expect(saved.payload.geometryDigest).toBe(saved.live.geometryDigest);
  expect(saved.payload.exportHash).toMatch(/^[0-9A-F]{8}$/);

  await page.reload();
  await page.waitForFunction(() => window.__opticalLab?.ready === true);
  await page.evaluate(() => document.fonts.ready);
  await page.click("#load-button");
  await page.waitForTimeout(140);
  const loaded = await page.evaluate(async () => ({
    state: window.__opticalLab.getState({ includePixels: true }),
    capture: await window.__opticalLab.capture()
  }));
  expect(loaded.state.settings.selected).toBe("resin");
  expect(loaded.state.settings.roughness.resin).toBeCloseTo(0.72, 2);
  expect(loaded.state.paused).toBe(true);
  expect(loaded.state.geometryDigest).toBe(saved.payload.geometryDigest);
  expect(loaded.state.previewHash).toBe(saved.payload.previewHash);
  expect(loaded.state.exportHash).toBe(saved.payload.exportHash);
  expect(loaded.capture.hash).toBe(saved.payload.exportHash);
  expect(loaded.capture.pixelHash).toBe(loaded.state.previewHash);
  expect(loaded.capture.geometryDigest).toBe(loaded.state.geometryDigest);
  expect(loaded.capture.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
});

test("three-scenario audit verifies counts, positions and exported PNGs", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => window.__opticalLab.pause());
  const audit = await page.evaluate(() => window.__opticalLab.runAudit());
  expect(audit.passed).toBe(true);
  expect(audit.distinct).toBe(true);
  expect(audit.results).toHaveLength(3);
  expect(audit.results.map((result) => result.scenario)).toEqual(["default", "extreme", "anomaly"]);
  for (const result of audit.results) {
    expect(result.objectCounts).toEqual({ total: 6, spheres: 3, lights: 2, layers: 9 });
    expect(result.countsStable).toBe(true);
    expect(result.geometryStable).toBe(true);
    expect(result.digestStable).toBe(true);
    expect(result.previewStable).toBe(true);
    expect(result.exportStable).toBe(true);
    expect(result.nonBlank).toBe(true);
    expect(result.previewHash).toMatch(/^[0-9A-F]{8}$/);
    expect(result.exportBytes).toBeGreaterThan(100_000);
  }
  expect(audit.results[2].issueCount).toBeGreaterThan(8);
  expect(new Set(audit.results.map((result) => result.previewHash)).size).toBe(3);
});

test("anomaly parameters show a readable correction and never blank the canvas", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => window.__opticalLab.pause());
  await page.locator("#audit-details summary").click();
  await page.locator('[data-scenario="anomaly"]').click();
  await expect(page.locator("#scene-alert")).toBeVisible();
  await expect(page.locator("#alert-title")).toContainText("参数已自动修正");
  await expect(page.locator("#alert-message")).toContainText("粗糙度");
  const result = await page.evaluate(() => ({
    state: window.__opticalLab.getState(),
    fingerprint: window.__opticalLab.getFingerprint()
  }));
  expect(result.state.objectCount).toBe(6);
  expect(result.state.settings.roughness.ceramic).toBe(1);
  expect(result.state.settings.lights.B.elevation).toBe(80);
  expect(result.fingerprint.nonBlank).toBe(true);
  expect(result.fingerprint.pixelHash).toMatch(/^[0-9A-F]{8}$/);
});

test("corrupt save reports an error and keeps the current composition", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => window.__opticalLab.pause());
  const before = await page.evaluate(() => window.__opticalLab.getState({ includePixels: true }));
  await page.evaluate(() => localStorage.setItem("lumen-material-lab.state.v1", "{broken-json"));
  await page.click("#load-button");
  await expect(page.locator("#scene-alert")).toBeVisible();
  await expect(page.locator("#alert-title")).toContainText("载入失败");
  const after = await page.evaluate(() => window.__opticalLab.getState({ includePixels: true }));
  expect(after.previewHash).toBe(before.previewHash);
  expect(after.objectCount).toBe(6);
});

test("undo restores parameters and screenshot button downloads a non-trivial PNG", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => {
    window.__opticalLab.applyScenario("default");
    window.__opticalLab.pause();
    window.__opticalLab.applySettings({ selected: "metal" }, { record: true });
  });
  await expect.poll(async () => (await page.evaluate(() => window.__opticalLab.getState().settings.selected))).toBe("metal");
  await page.click("#undo-button");
  expect(await page.evaluate(() => window.__opticalLab.getState().settings.selected)).toBe("ceramic");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#capture-button")
  ]);
  expect(download.suggestedFilename()).toMatch(/^lumen-specimen-.*\.png$/);
  const path = await download.path();
  const file = await readFile(path);
  const info = await stat(path);
  expect(file.subarray(1, 4).toString()).toBe("PNG");
  expect(info.size).toBeGreaterThan(20_000);
  const capture = await page.evaluate(() => window.__opticalLab.getLastCapture());
  expect(capture.width).toBeGreaterThan(1000);
  expect(capture.pixelHash).toMatch(/^[0-9A-F]{8}$/);
});
