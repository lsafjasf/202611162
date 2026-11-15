import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openLab(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__opticalLab?.ready === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__opticalLab.pause());
}

async function state(page, includePixels = true) {
  return page.evaluate((pixels) => window.__opticalLab.getState({ includePixels: pixels }), includePixels);
}

function projectPoint(point, geometry) {
  const width = geometry.viewport.width;
  const height = geometry.viewport.height;
  const yaw = (geometry.camera.yaw * Math.PI) / 180;
  const pitch = (geometry.camera.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const x = point.x * cosYaw + point.z * sinYaw;
  const z0 = -point.x * sinYaw + point.z * cosYaw;
  const y = point.y * cosPitch - z0 * sinPitch;
  const z = point.y * sinPitch + z0 * cosPitch;
  const depth = 6.55 + z;
  const scale = geometry.camera.focal / depth;
  return {
    x: width * 0.5 + x * scale,
    y: height * 0.535 - (y - 0.04) * scale
  };
}

test("default scene has stable geometry, labels and transparent layer order", async ({ page }) => {
  await openLab(page);
  const before = await state(page);
  expect(before.objectCount).toBe(6);
  expect(before.geometry.spheres).toHaveLength(3);
  expect(before.geometry.lights).toHaveLength(2);
  expect(before.geometry.domeCount).toBe(1);
  expect(before.geometry.layers).toEqual([
    "background",
    "light-rays",
    "glass-back",
    "shadows",
    "platforms",
    "specimens",
    "glass-front",
    "annotations",
    "light-handles"
  ]);
  expect(new Set(before.geometry.spheres.map((sphere) => sphere.depthRank))).toEqual(new Set([0, 1, 2]));
  expect(before.geometry.dome.radiusX).toBeGreaterThan(100);
  expect(before.geometry.dome.radiusY).toBeGreaterThan(100);
  expect(before.previewHash).toMatch(/^[0-9A-F]{8}$/);

  const fingerprint = await page.evaluate(() => window.__opticalLab.getFingerprint());
  expect(fingerprint.nonBlank).toBe(true);

  const recompute = await page.evaluate(() => window.__opticalLab.recompute());
  expect(recompute.stable).toBe(true);
  expect(recompute.before.objectCount).toBe(6);
  expect(recompute.after.objectCount).toBe(6);
  expect(recompute.after.positions).toEqual(recompute.before.positions);
  expect(recompute.after.geometryDigest).toBe(recompute.before.geometryDigest);
  expect(recompute.after.previewHash).toBe(recompute.before.previewHash);
  expect(recompute.after.exportHash).toBe(recompute.before.exportHash);
});

test("labels follow projection through zoom and rotation, dome keeps its scale", async ({ page }) => {
  await openLab(page);
  const base = await page.evaluate(() => {
    window.__opticalLab.applySettings({ camera: { yaw: 0, pitch: 23, zoom: 1.32 } });
    return window.__opticalLab.getGeometry();
  });
  const rotated = await page.evaluate(() => {
    window.__opticalLab.applySettings({ camera: { yaw: 73, pitch: 23, zoom: 1.32 } });
    return window.__opticalLab.getGeometry();
  });

  for (const sphere of rotated.spheres) {
    const projected = projectPoint(sphere.labelWorld, rotated);
    expect(Math.abs(projected.x - sphere.label.x)).toBeLessThan(0.2);
    expect(Math.abs(projected.y - sphere.label.y)).toBeLessThan(0.2);
    expect(sphere.label.x).toBeGreaterThan(0);
    expect(sphere.label.x).toBeLessThan(rotated.viewport.width);
  }

  const baseSphere = base.spheres.find((sphere) => sphere.id === "metal");
  const rotatedSphere = rotated.spheres.find((sphere) => sphere.id === "metal");
  expect(rotatedSphere.label.x).not.toBe(baseSphere.label.x);
  expect(rotatedSphere.label.y).not.toBe(baseSphere.label.y);
  expect(Math.abs(rotated.dome.radiusX / base.dome.radiusX - 1)).toBeLessThan(0.01);
  expect(Math.abs(rotated.dome.radiusY / base.dome.radiusY - 1)).toBeLessThan(0.01);
  expect(rotated.spheres.every((sphere) => sphere.label.y > 0)).toBe(true);
});

test("roughness changes highlight spread and light drag updates live shading", async ({ page }) => {
  await openLab(page);
  await page.evaluate(() => {
    window.__opticalLab.applyScenario("default");
    window.__opticalLab.pause();
  });
  const sharp = await page.evaluate(() => {
    const result = window.__opticalLab.applySettings({
      selected: "metal",
      roughness: { metal: 0.01 }
    });
    return {
      count: window.__opticalLab.measureHighlight("metal", 120),
      hash: result.previewHash
    };
  });
  const rough = await page.evaluate(() => {
    const result = window.__opticalLab.applySettings({
      roughness: { metal: 0.95 }
    });
    return {
      count: window.__opticalLab.measureHighlight("metal", 120),
      hash: result.previewHash
    };
  });
  expect(rough.count).toBeGreaterThan(sharp.count * 5);
  expect(rough.hash).not.toBe(sharp.hash);

  const beforeDrag = await state(page);
  const box = await page.locator("#scene-canvas").boundingBox();
  const light = beforeDrag.geometry.lights.find((item) => item.id === "A");
  const ratioX = box.width / beforeDrag.geometry.viewport.width;
  const ratioY = box.height / beforeDrag.geometry.viewport.height;
  await page.mouse.move(box.x + light.screen.x * ratioX, box.y + light.screen.y * ratioY);
  await page.mouse.down();
  await page.mouse.move(
    box.x + light.screen.x * ratioX + 70,
    box.y + light.screen.y * ratioY + 24,
    { steps: 5 }
  );
  await page.mouse.up();
  const afterDrag = await state(page);
  expect(afterDrag.settings.lights.A.azimuth).not.toBe(beforeDrag.settings.lights.A.azimuth);
  expect(afterDrag.previewHash).not.toBe(beforeDrag.previewHash);
});
