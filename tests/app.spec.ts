import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const api = (window as unknown as { __tessera?: { getSnapshot: () => unknown } })
      .__tessera;
    return Boolean(api);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const snapshot = (
      window as unknown as {
        __tessera: { getSnapshot: () => { previewDigest: string | null } };
      }
    ).__tessera.getSnapshot();
    return Boolean(snapshot.previewDigest);
  });
  await page.waitForTimeout(120);
}

async function setRange(page: import("@playwright/test").Page, label: string, value: string) {
  await page.getByRole("slider", { name: label, exact: true }).fill(value);
}

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

test("paused animation stays frozen and resumes from the same phase", async ({ page }) => {
  await ready(page);
  const canvas = page.getByTestId("viewport-canvas");
  await page.getByTestId("toggle-animation").click();
  await page.waitForTimeout(180);
  const pausedA = Number(await canvas.getAttribute("data-animation-time"));
  const frameA = Number(await canvas.getAttribute("data-frame"));
  await page.waitForTimeout(700);
  const pausedB = Number(await canvas.getAttribute("data-animation-time"));
  const frameB = Number(await canvas.getAttribute("data-frame"));
  expect(pausedB).toBe(pausedA);
  expect(frameB).toBe(frameA);
  expect(await canvas.getAttribute("data-paused")).toBe("true");

  await page.getByTestId("toggle-animation").click();
  await page.waitForTimeout(520);
  const resumed = Number(await canvas.getAttribute("data-animation-time"));
  expect(resumed).toBeGreaterThan(pausedB + 180);
  expect(resumed - pausedB).toBeLessThan(950);
  expect(await canvas.getAttribute("data-paused")).toBe("false");
});

test("saved preset reload keeps screenshot hash, geometry and export digest aligned", async ({
  page,
}) => {
  await ready(page);
  await page.getByTestId("kind-cloth").click();
  await setRange(page, "尺度", "27");
  await setRange(page, "方向", "-37");
  await setRange(page, "对比度", "1.44");
  await page.waitForTimeout(700);

  const presetName = `回载基准-${Date.now().toString().slice(-5)}`;
  await page.getByTestId("preset-name").fill(presetName);
  await page.getByTestId("save-preset").click();
  await expect(page.getByTestId("toast")).toContainText("已保存");

  const before = await page.evaluate(() =>
    (
      window as unknown as {
        __tessera: {
          getSnapshot: () => {
            params: unknown;
            geometry: { digest: string; count: number };
            previewDigest: string;
          };
        };
      }
    ).__tessera.getSnapshot(),
  );
  const beforeShot = await page.getByTestId("tile-preview").screenshot();
  const beforeHash = sha(beforeShot);

  await page.getByTestId("export-size-256").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  const download = await downloadPromise;
  await page.waitForFunction(() => {
    const snapshot = (
      window as unknown as {
        __tessera: { getSnapshot: () => { lastExport: unknown } };
      }
    ).__tessera.getSnapshot();
    return Boolean(snapshot.lastExport);
  });
  const exported = await page.evaluate(
    () =>
      (
        window as unknown as {
          __tessera: {
            getSnapshot: () => {
              lastExport: {
                geometryDigest: string;
                objectCount: number;
                similarity: number;
                size: number;
              };
            };
          };
        }
      ).__tessera.getSnapshot().lastExport,
  );
  expect(exported.size).toBe(256);
  expect(exported.geometryDigest).toBe(before.geometry.digest);
  expect(exported.objectCount).toBe(before.geometry.count);
  expect(exported.similarity).toBeGreaterThan(0.98);
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();

  await ready(page);
  await page.getByTestId(`load-preset-${presetName}`).click();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() =>
    (
      window as unknown as {
        __tessera: {
          getSnapshot: () => {
            params: unknown;
            geometry: { digest: string; count: number };
            previewDigest: string;
          };
        };
      }
    ).__tessera.getSnapshot(),
  );
  expect(after.params).toEqual(before.params);
  expect(after.geometry.digest).toBe(before.geometry.digest);
  expect(after.previewDigest).toBe(before.previewDigest);

  const afterShot = await page.getByTestId("tile-preview").screenshot();
  expect(sha(afterShot)).toBe(beforeHash);
});

test("invalid imported parameters show a clear error without blanking the canvas", async ({
  page,
}) => {
  await ready(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        params: {
          kind: "granite",
          palette: "void",
          scale: 9999,
          direction: "north",
          contrast: 99,
          relief: -3,
          grain: null,
          seed: 0,
        },
        strokes: "not-an-array",
      }),
    ),
  });
  await expect(page.getByTestId("error-banner")).toBeVisible();
  await expect(page.getByTestId("error-banner")).toContainText("参数");
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const snapshot = (
      window as unknown as {
        __tessera: {
          getSnapshot: () => {
            previewStats: { variance: number; max: number; min: number };
            errors: string[];
            previewDigest: string;
          };
        };
      }
    ).__tessera.getSnapshot();
    return snapshot;
  });
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.previewDigest).toBeTruthy();
  expect(result.previewStats.variance).toBeGreaterThan(0.0015);
  expect(result.previewStats.max).toBeGreaterThan(result.previewStats.min + 0.05);
});

test("annotation anchors stay locked to world seams after zoom and rotation", async ({
  page,
}) => {
  await ready(page);
  const read = () =>
    page.evaluate(() => {
      const api = (
        window as unknown as {
          __tessera: {
            getSnapshot: () => {
              anchors: Array<{
                id: string;
                worldX: number;
                worldY: number;
                screenX: number;
                screenY: number;
              }>;
            };
          };
        }
      ).__tessera;
      return api.getSnapshot().anchors;
    });
  const before = await read();
  await setRange(page, "视图缩放", "1.55");
  await setRange(page, "视图旋转", "17");
  await page.waitForTimeout(100);
  const after = await read();
  const dimensions = await page.getByTestId("viewport-canvas").boundingBox();
  expect(dimensions).toBeTruthy();
  const width = dimensions!.width;
  const height = dimensions!.height;
  const tile = Math.max(120, Math.min(width, height) * 0.74) * 1.55;
  const radians = (17 * Math.PI) / 180;
  const centerX = width / 2;
  const centerY = height / 2;
  for (const anchor of after) {
    const source = before.find((item) => item.id === anchor.id)!;
    expect(anchor.worldX).toBe(source.worldX);
    expect(anchor.worldY).toBe(source.worldY);
    const dx = (anchor.worldX - 0.5) * tile;
    const dy = (anchor.worldY - 0.5) * tile;
    const expectedX = centerX + dx * Math.cos(radians) - dy * Math.sin(radians);
    const expectedY = centerY + dx * Math.sin(radians) + dy * Math.cos(radians);
    expect(Math.abs(anchor.screenX - expectedX)).toBeLessThan(0.01);
    expect(Math.abs(anchor.screenY - expectedY)).toBeLessThan(0.01);
  }
});

test("undo and redo restore both slider parameters and brush history", async ({ page }) => {
  await ready(page);
  const initialContrast = await page.evaluate(
    () =>
      (
        window as unknown as {
          __tessera: { getSnapshot: () => { params: { contrast: number } } };
        }
      ).__tessera.getSnapshot().params.contrast,
  );
  await setRange(page, "对比度", "2.05");
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __tessera: { getSnapshot: () => { params: { contrast: number } } };
          }
        ).__tessera.getSnapshot().params.contrast,
    ),
  ).toBeCloseTo(2.05, 2);
  await page.getByTestId("undo").click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __tessera: { getSnapshot: () => { params: { contrast: number } } };
          }
        ).__tessera.getSnapshot().params.contrast,
    ),
  ).toBeCloseTo(initialContrast, 2);
  await page.getByTestId("redo").click();
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __tessera: { getSnapshot: () => { params: { contrast: number } } };
          }
        ).__tessera.getSnapshot().params.contrast,
    ),
  ).toBeCloseTo(2.05, 2);

  const canvas = page.getByTestId("viewport-canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.56, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.59, box!.y + box!.height * 0.52, {
    steps: 5,
  });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const snapshot = (
      window as unknown as {
        __tessera: { getSnapshot: () => { strokes: number } };
      }
    ).__tessera.getSnapshot();
    return snapshot.strokes === 1;
  });
  await page.getByTestId("undo").click();
  await page.waitForFunction(() => {
    const snapshot = (
      window as unknown as {
        __tessera: { getSnapshot: () => { strokes: number } };
      }
    ).__tessera.getSnapshot();
    return snapshot.strokes === 0;
  });
});

test("the screenshot button downloads the visible preview and reports its SHA-256", async ({
  page,
}) => {
  await ready(page);
  await page.getByTestId("toggle-animation").click();
  await page.waitForTimeout(150);
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("capture-screenshot").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const digest = sha(await import("node:fs/promises").then((fs) => fs.readFile(path!)));
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __tessera: { getSnapshot: () => { lastScreenshotHash: string | null } };
            }
          ).__tessera.getSnapshot().lastScreenshotHash,
      ),
    )
    .toBe(digest);
});

test("the in-app self test covers default, extreme and invalid parameter groups", async ({
  page,
}) => {
  await ready(page);
  await page.getByTestId("open-selftest").click();
  await expect(page.getByText("纹理结构与导出一致性自检")).toBeVisible();
  await expect(page.locator(".test-verdict")).toContainText("全部通过", {
    timeout: 30_000,
  });
  await expect(page.getByText("默认 · 暖砂岩")).toBeVisible();
  await expect(page.getByText("极值 · 高对比石纹")).toBeVisible();
  await expect(page.getByText("极值 · 反向布纹")).toBeVisible();
  await expect(page.getByText("异常 · 非法参数")).toBeVisible();
});
