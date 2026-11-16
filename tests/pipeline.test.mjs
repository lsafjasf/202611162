import test from "node:test";
import assert from "node:assert/strict";
import {
  PipelineError,
  cloneNodes,
  createDefaultNodes,
  generateBasePixels,
  hashBytes,
  makeNode,
  nodeSignature,
  processPixelBuffer,
  validatePipeline,
} from "../src/pipeline.js";
import { SCENE_OBJECTS, getObjectGeometry } from "../src/scene.js";

const width = 96;
const height = 72;
const base = generateBasePixels(width, height, 8421);

function pixelDifference(a, b) {
  let changed = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) changed += 1;
  }
  return changed;
}

test("default pipeline is deterministic and reports monotonic progress", async () => {
  const nodes = createDefaultNodes();
  const progress = [];
  const first = await processPixelBuffer(base, nodes, {
    width,
    height,
    onProgress: (value) => progress.push(value),
  });
  const second = await processPixelBuffer(base, cloneNodes(nodes), { width, height });
  assert.equal(hashBytes(first), hashBytes(second));
  assert.ok(progress.length >= nodes.length);
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index] >= progress[index - 1] - 1e-12);
  }
  assert.ok(progress.at(-1) >= 1);
  assert.notEqual(hashBytes(first), hashBytes(base));
});

test("node order changes actual pixels", async () => {
  const levels = makeNode("levels", {
    id: "levels-order",
    params: { black: 8, white: 246, gamma: 1.35 },
  });
  const noise = makeNode("noise", {
    id: "noise-order",
    params: { amount: 0.16, seed: 73 },
  });
  const tone = makeNode("tone", {
    id: "tone-order",
    params: { exposure: 0.35, contrast: 1.3, saturation: 0.7 },
  });
  const blur = makeNode("blur", { id: "blur-order", params: { radius: 3 } });

  const forward = await processPixelBuffer(base, [levels, blur, noise, tone], {
    width,
    height,
  });
  const reversed = await processPixelBuffer(base, [tone, noise, blur, levels], {
    width,
    height,
  });
  const noiseFirst = await processPixelBuffer(base, [blur, noise, tone, levels], {
    width,
    height,
  });

  assert.notEqual(hashBytes(forward), hashBytes(reversed));
  assert.notEqual(hashBytes(forward), hashBytes(noiseFirst));
  assert.ok(pixelDifference(forward, reversed) > width * height * 2);
  assert.notEqual(nodeSignature([levels, blur, noise, tone]), nodeSignature([tone, noise, blur, levels]));
});

test("bypass returns the generated base exactly when every node is bypassed", async () => {
  const nodes = createDefaultNodes().map((node) => ({ ...node, enabled: false }));
  const output = await processPixelBuffer(base, nodes, { width, height });
  assert.equal(hashBytes(output), hashBytes(base));
  assert.equal(pixelDifference(output, base), 0);

  const nodesOn = cloneNodes(nodes);
  nodesOn[1].enabled = true;
  const blurred = await processPixelBuffer(base, nodesOn, { width, height });
  assert.notEqual(hashBytes(blurred), hashBytes(base));
});

test("extreme but valid settings stay bounded and deterministic", async () => {
  const nodes = [
    makeNode("levels", { params: { black: 0, white: 255, gamma: 3 } }),
    makeNode("blur", { params: { radius: 12 } }),
    makeNode("noise", { params: { amount: 0.6, seed: 9999 } }),
    makeNode("tone", { params: { exposure: 2, contrast: 2, saturation: 0 } }),
  ];
  validatePipeline(nodes);
  const first = await processPixelBuffer(base, nodes, { width, height });
  const second = await processPixelBuffer(base, nodes, { width, height });
  assert.equal(hashBytes(first), hashBytes(second));
  assert.equal(first.length, base.length);
  for (let index = 0; index < first.length; index += 1) {
    assert.ok(first[index] >= 0 && first[index] <= 255);
  }
});

test("invalid settings produce explicit PipelineError messages", async () => {
  assert.throws(
    () => validatePipeline([makeNode("blur", { params: { radius: 25 } })]),
    (error) =>
      error instanceof PipelineError &&
      /Radius/.test(error.message) &&
      /0–24/.test(error.message),
  );
  assert.throws(
    () => validatePipeline([makeNode("tone", { params: { exposure: Number.NaN } })]),
    (error) => error instanceof PipelineError && /finite number/.test(error.message),
  );
  assert.throws(
    () =>
      validatePipeline([
        makeNode("levels", { params: { black: 128, white: 128, gamma: 1 } }),
      ]),
    (error) => error instanceof PipelineError && /black point/.test(error.message),
  );
  assert.throws(
    () => validatePipeline([{ id: "bad", type: "unknown", enabled: true, params: {} }]),
    (error) => error instanceof PipelineError && /Unknown|unknown type/.test(error.message),
  );
  await assert.rejects(
    processPixelBuffer(base, [makeNode("noise", { params: { amount: 0.9, seed: 1 } })], {
      width,
      height,
    }),
    (error) => error instanceof PipelineError && /Amount/.test(error.message),
  );
});

test("scene objects keep stable z-order and annotation anchors", () => {
  const baseline = getObjectGeometry(width, height, 100, 0);
  const transformed = getObjectGeometry(width, height, 147, 17);
  assert.equal(baseline.objectCount, SCENE_OBJECTS.length);
  assert.equal(baseline.annotationCount, SCENE_OBJECTS.length);
  assert.deepEqual(
    baseline.order,
    [...SCENE_OBJECTS].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id)).map((object) => object.id),
  );
  assert.deepEqual(transformed.order, baseline.order);
  assert.ok(baseline.maxDriftPx < 1e-9);
  assert.ok(transformed.maxDriftPx < 1e-9);

  for (const object of transformed.objects) {
    const definition = SCENE_OBJECTS.find((item) => item.id === object.id);
    const expectedX =
      ((definition.annotation.anchor.x * width - width / 2) * 1.47) * Math.cos((17 * Math.PI) / 180) -
      ((definition.annotation.anchor.y * height - height / 2) * 1.47) * Math.sin((17 * Math.PI) / 180) +
      width / 2;
    const expectedY =
      ((definition.annotation.anchor.x * width - width / 2) * 1.47) * Math.sin((17 * Math.PI) / 180) +
      ((definition.annotation.anchor.y * height - height / 2) * 1.47) * Math.cos((17 * Math.PI) / 180) +
      height / 2;
    assert.ok(Math.abs(object.annotation.anchor.x - expectedX) < 1e-9);
    assert.ok(Math.abs(object.annotation.anchor.y - expectedY) < 1e-9);
    assert.equal(object.opacity, definition.opacity);
    assert.equal(object.z, definition.z);
  }
});
