import { describe, expect, it } from "vitest";
import {
  downsamplePixels,
  geometryPositionDigest,
  renderTexture,
  structureSimilarity,
} from "./render";
import { verifySaveReload } from "./selftest";
import { DEFAULT_PARAMS, type BrushStroke, type TextureParams } from "./types";
import { validateParams } from "./validation";

const extremeStone: TextureParams = {
  ...DEFAULT_PARAMS,
  scale: 48,
  direction: 179,
  contrast: 2.5,
  relief: 1,
  grain: 1,
  seed: 99999,
};

const extremeCloth: TextureParams = {
  ...DEFAULT_PARAMS,
  kind: "cloth",
  palette: "flax",
  scale: 48,
  direction: -179,
  contrast: 2.5,
  relief: 1,
  grain: 1,
  seed: 12347,
};

const invalidParams = {
  ...DEFAULT_PARAMS,
  kind: "granite",
  scale: Number.NaN,
  direction: "north",
  contrast: Number.POSITIVE_INFINITY,
  relief: -4,
  grain: Number.NaN,
  seed: 0,
  palette: "void",
};

const seamStroke: BrushStroke = {
  id: "test-seam-brush",
  mode: "burn",
  size: 0.065,
  strength: 0.5,
  points: [
    { x: 0.995, y: 0.48 },
    { x: 0.005, y: 0.5 },
  ],
};

describe("procedural tile renderer", () => {
  it("renders the default stone texture with four continuous edges", () => {
    const result = renderTexture(DEFAULT_PARAMS, [], 192);
    expect(result.errors).toEqual([]);
    expect(result.geometry.count).toBe(324);
    expect(result.stats.variance).toBeGreaterThan(0.002);
    expect(result.stats.max).toBeGreaterThan(result.stats.min + 0.12);
    expect(result.stats.seamDelta).toBeLessThan(1.6);
  });

  it("keeps object count, positions and pixels stable across recalculation", () => {
    for (const params of [DEFAULT_PARAMS, extremeStone, extremeCloth]) {
      const first = renderTexture(params, [seamStroke], 160);
      const second = renderTexture(params, [seamStroke], 160);
      expect(second.geometry.count).toBe(first.geometry.count);
      expect(second.geometry.digest).toBe(first.geometry.digest);
      expect(geometryPositionDigest(second.geometry)).toBe(
        geometryPositionDigest(first.geometry),
      );
      expect(second.digest).toBe(first.digest);
      let alphaStable = true;
      for (let index = 3; index < first.pixels.length; index += 4) {
        if (first.pixels[index] !== 255) alphaStable = false;
      }
      expect(alphaStable).toBe(true);
    }
  });

  it("renders extreme values as a visible texture rather than a blank frame", () => {
    for (const params of [extremeStone, extremeCloth]) {
      const result = renderTexture(params, [], 192);
      expect(result.errors).toEqual([]);
      expect(result.stats.variance).toBeGreaterThan(0.002);
      expect(result.stats.seamDelta).toBeLessThan(1.6);
      expect(result.geometry.count).toBeGreaterThan(16);
    }
  });

  it("reports invalid parameters and still produces a safe fallback image", () => {
    const validation = validateParams(invalidParams);
    expect(validation.errors.length).toBeGreaterThanOrEqual(4);
    expect(validation.params.scale).toBe(DEFAULT_PARAMS.scale);
    expect(validation.params.contrast).toBe(DEFAULT_PARAMS.contrast);

    const result = renderTexture(invalidParams, [], 160);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.usedParams.scale).toBe(DEFAULT_PARAMS.scale);
    expect(Number.isFinite(result.usedParams.direction)).toBe(true);
    expect(result.stats.variance).toBeGreaterThan(0.002);
    expect(result.stats.max).toBeGreaterThan(result.stats.min);
  });

  it("mirrors a brush stroke crossing the left and right seams", () => {
    const baseline = renderTexture(DEFAULT_PARAMS, [], 160);
    const brushed = renderTexture(DEFAULT_PARAMS, [seamStroke], 160);
    let leftEdits = 0;
    let rightEdits = 0;
    for (let y = 64; y < 96; y += 1) {
      const left = (y * 160) * 4;
      const right = (y * 160 + 159) * 4;
      leftEdits +=
        Math.abs(baseline.pixels[left] - brushed.pixels[left]) +
        Math.abs(baseline.pixels[left + 1] - brushed.pixels[left + 1]);
      rightEdits +=
        Math.abs(baseline.pixels[right] - brushed.pixels[right]) +
        Math.abs(baseline.pixels[right + 1] - brushed.pixels[right + 1]);
    }
    expect(baseline.digest).not.toBe(brushed.digest);
    expect(leftEdits).toBeGreaterThan(50);
    expect(rightEdits).toBeGreaterThan(50);
  });

  it("keeps structure when a 512px preview is compared with a 256px export", () => {
    for (const params of [DEFAULT_PARAMS, extremeStone, extremeCloth]) {
      const preview = renderTexture(params, [seamStroke], 512);
      const exported = renderTexture(params, [seamStroke], 256);
      const reduced = downsamplePixels(preview.pixels, 512, 512, 256, 256);
      expect(structureSimilarity(reduced, exported.pixels)).toBeGreaterThan(0.98);
    }
  });

  it("restores the same pixel, geometry and document digests from saved JSON", () => {
    const restored = verifySaveReload([seamStroke]);
    expect(restored.errors).toEqual([]);
    expect(restored.pass).toBe(true);
    expect(restored.restoredDigest).toBe(restored.originalDigest);
  });

  it("changes geometry positions after a direction recalculation but remains repeatable", () => {
    const low = renderTexture({ ...DEFAULT_PARAMS, direction: -90 }, [], 128);
    const high = renderTexture({ ...DEFAULT_PARAMS, direction: 90 }, [], 128);
    expect(geometryPositionDigest(low.geometry)).not.toBe(
      geometryPositionDigest(high.geometry),
    );
    expect(low.geometry.count).toBe(high.geometry.count);
    const lowAgain = renderTexture({ ...DEFAULT_PARAMS, direction: -90 }, [], 128);
    expect(lowAgain.digest).toBe(low.digest);
  });
});
