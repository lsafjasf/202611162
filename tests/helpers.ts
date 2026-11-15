import { expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import type { AuditSnapshot, CaptureResult } from "../src/exhibit";
import type { ViewParams } from "../src/types";

export type FullAudit = AuditSnapshot & { lastExport: CaptureResult | null };

export const DEFAULT_VIEW: ViewParams = {
  material: "bronze",
  lighting: "dawn",
  yaw: -36,
  pitch: 7,
  zoom: 1,
  autoRotate: false
};

export async function openExhibit(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__EXHIBIT__));
  await page.evaluate(() => window.__EXHIBIT__.clearPresets());
  await page.evaluate(() => window.__EXHIBIT__.setAutoRotate(false));
  await page.evaluate(
    (view) => window.__EXHIBIT__.applyParams(view),
    DEFAULT_VIEW
  );
  await settleFrames(page);
}

export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

export async function applyView(page: Page, patch: Partial<ViewParams>): Promise<ViewParams> {
  const state = await page.evaluate(
    (nextPatch) => window.__EXHIBIT__.applyParams(nextPatch),
    patch
  );
  await settleFrames(page);
  return state;
}

export async function getAudit(page: Page): Promise<FullAudit> {
  return page.evaluate(() => window.__EXHIBIT__.getAudit());
}

export async function capturePng(
  page: Page,
  includeDataUrl = true
): Promise<CaptureResult> {
  return page.evaluate(
    (withData) => window.__EXHIBIT__.capturePng(withData),
    includeDataUrl
  );
}

export function decodeDataUrl(dataUrl: string | undefined): PNG {
  if (!dataUrl) throw new Error("Expected PNG data URL.");
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return PNG.sync.read(Buffer.from(encoded, "base64"));
}

export interface ImageStats {
  width: number;
  height: number;
  mean: number;
  deviation: number;
  colorBins: number;
}

export function imageStats(png: PNG): ImageStats {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  const bins = new Set<number>();
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      const index = (y * png.width + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      sum += luminance;
      sumSquares += luminance * luminance;
      count += 1;
      bins.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
    }
  }
  const mean = sum / count;
  return {
    width: png.width,
    height: png.height,
    mean,
    deviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)),
    colorBins: bins.size
  };
}

export function cropMean(png: PNG, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * png.width + x) * 4;
      sum += png.data[index] * 0.2126 + png.data[index + 1] * 0.7152 + png.data[index + 2] * 0.0722;
      count += 1;
    }
  }
  return sum / count;
}

export function compareImages(first: PNG, second: PNG, tolerance = 2): void {
  expect(first.width).toBe(second.width);
  expect(first.height).toBe(second.height);
  let absoluteDifference = 0;
  let differingPixels = 0;
  const pixels = first.width * first.height;
  for (let index = 0; index < first.data.length; index += 4) {
    const difference =
      Math.abs(first.data[index] - second.data[index]) +
      Math.abs(first.data[index + 1] - second.data[index + 1]) +
      Math.abs(first.data[index + 2] - second.data[index + 2]);
    absoluteDifference += difference;
    if (difference > tolerance) differingPixels += 1;
  }
  expect(absoluteDifference / (pixels * 3)).toBeLessThan(1.25);
  expect(differingPixels / pixels).toBeLessThan(0.08);
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function cropPng(png: PNG, width: number, height: number): PNG {
  const result = new PNG({ width, height });
  PNG.bitblt(png, result, 0, 0, width, height, 0, 0);
  return result;
}
