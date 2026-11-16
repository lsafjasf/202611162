import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright";

const port = Number(process.env.PORT || 4192);
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const screenshotDir = new URL("../artifacts/screenshots/", import.meta.url).pathname.replace(/\/$/, "");
const reportPath = new URL("../artifacts/browser-verification.json", import.meta.url).pathname;
let server = null;

async function exists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const preferred = [
    process.env.CHROME_BIN,
    new URL("../node_modules/playwright/.local-browsers/chromium/chrome-linux/chrome", import.meta.url).pathname,
    "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/home/hj/.cache/ms-playwright/chromium-1169/chrome-linux/chrome",
    "/tmp/chrome-linux64/chrome",
  ].filter(Boolean);
  for (const candidate of preferred) {
    if (await exists(candidate)) return candidate;
  }
  try {
    const cacheRoot = "/home/hj/.cache/ms-playwright";
    const entries = await readdir(cacheRoot);
    for (const entry of entries.filter((name) => name.startsWith("chromium-")).reverse()) {
      for (const suffix of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = `${cacheRoot}/${entry}/${suffix}`;
        if (await exists(candidate)) return candidate;
      }
    }
  } catch {
    // Fall through to Playwright's own executable resolution.
  }
  return undefined;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local verification server did not start");
}

async function screenshot(page, name, fullPage = true) {
  const path = `${screenshotDir}/${name}`;
  await page.screenshot({ path, fullPage });
  return path;
}

async function pageState(page) {
  return page.evaluate(() => window.lumenStudio.getState());
}

async function canvasHash(page) {
  return page.evaluate(() => window.lumenStudio.getCanvasHash());
}

async function comparePreviewWithPng(page, dataUrl) {
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const exported = document.createElement("canvas");
    exported.width = image.naturalWidth;
    exported.height = image.naturalHeight;
    const exportContext = exported.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    exportContext.drawImage(image, 0, 0);
    const preview = document.getElementById("previewCanvas");
    const previewData = preview
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, preview.width, preview.height).data;
    const exportData = exportContext.getImageData(0, 0, exported.width, exported.height).data;
    if (previewData.length !== exportData.length) {
      return { widthMatch: false, byteDiff: previewData.length + exportData.length };
    }
    let byteDiff = 0;
    let hash = 2166136261;
    for (let index = 0; index < exportData.length; index += 1) {
      if (previewData[index] !== exportData[index]) byteDiff += 1;
      hash ^= exportData[index];
      hash = Math.imul(hash, 16777619);
    }
    return {
      widthMatch: exported.width === preview.width && exported.height === preview.height,
      width: exported.width,
      height: exported.height,
      byteDiff,
      pngPixelHash: (hash >>> 0).toString(16).padStart(8, "0"),
    };
  }, dataUrl);
}

function compactGeometry(state) {
  return {
    objectCount: state.geometry.objectCount,
    annotationCount: state.geometry.annotationCount,
    order: state.geometry.order,
    digest: state.geometry.digest,
    maxDriftPx: state.geometry.maxDriftPx,
    objects: state.geometry.objects.map((object) => ({
      id: object.id,
      z: object.z,
      opacity: object.opacity,
      center: object.center,
      anchor: object.anchor,
      anchorNormalized: object.anchorNormalized,
    })),
  };
}

async function startServer() {
  if (process.env.BASE_URL) return;
  server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
}

await mkdir(screenshotDir, { recursive: true });
await startServer();
await waitForServer();

const executablePath = await findChrome();
const launchOptions = {
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
};
if (executablePath) launchOptions.executablePath = executablePath;

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(message.text());
});

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  checks: {},
  groups: {},
  screenshots: [],
  runtimeErrors,
};

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__LUMEN_READY__ === true, null, {
    timeout: 20000,
  });
  await page.evaluate(() => window.lumenStudio.seek(1200));

  const defaultState = await pageState(page);
  assert.equal(defaultState.error, null);
  assert.equal(defaultState.width, 1024);
  assert.equal(defaultState.height, 768);
  assert.equal(defaultState.geometry.objectCount, 4);
  assert.equal(defaultState.geometry.annotationCount, 4);
  assert.equal(defaultState.nodes.length, 4);
  const defaultHash = await canvasHash(page);
  assert.equal(defaultHash, defaultState.previewHash);

  const defaultExport = await page.evaluate(() =>
    window.lumenStudio.exportPng({ download: false }),
  );
  assert.equal(defaultExport.match, true);
  assert.equal(defaultExport.digest, defaultHash);
  assert.equal(defaultExport.geometry.digest, defaultState.geometry.digest);
  const defaultPngCompare = await comparePreviewWithPng(page, defaultExport.dataUrl);
  assert.equal(defaultPngCompare.widthMatch, true);
  assert.equal(defaultPngCompare.byteDiff, 0);
  assert.equal(defaultPngCompare.pngPixelHash, defaultHash);
  report.screenshots.push(await screenshot(page, "default.png"));
  report.groups.default = {
    previewHash: defaultHash,
    exportHash: defaultExport.digest,
    pngPixelHash: defaultPngCompare.pngPixelHash,
    pngByteDiff: defaultPngCompare.byteDiff,
    nodeCount: defaultState.nodes.length,
    objectCount: defaultState.geometry.objectCount,
    annotationCount: defaultState.geometry.annotationCount,
    geometryDigest: defaultState.geometry.digest,
    geometry: compactGeometry(defaultState),
  };
  report.checks.defaultExportMatchesPreview = true;

  const beforeRecalc = {
    state: defaultState,
    hash: defaultHash,
    exportDigest: defaultExport.digest,
    geometry: compactGeometry(defaultState),
  };
  const recalc = await page.evaluate(() => window.lumenStudio.recalculate());
  assert.equal(recalc.ok, true);
  const recalcHash = await canvasHash(page);
  const recalcExport = await page.evaluate(() =>
    window.lumenStudio.exportPng({ download: false }),
  );
  assert.equal(recalcHash, beforeRecalc.hash);
  assert.equal(recalcExport.digest, beforeRecalc.exportDigest);
  assert.deepEqual(compactGeometry(recalc.state), beforeRecalc.geometry);
  report.groups.recalculation = {
    sameObjectCount: recalc.state.geometry.objectCount === beforeRecalc.state.geometry.objectCount,
    sameGeometry: recalc.state.geometry.digest === beforeRecalc.geometry.digest,
    sameGeometryPositions: JSON.stringify(compactGeometry(recalc.state)) === JSON.stringify(beforeRecalc.geometry),
    samePreviewHash: recalcHash === beforeRecalc.hash,
    sameExportHash: recalcExport.digest === beforeRecalc.exportDigest,
  };
  report.checks.recalculationPreservesGeometryAndPixels = true;

  const interactionBaseline = await page.evaluate(() => {
    const api = window.lumenStudio;
    const state = api.getState();
    return {
      hash: api.getCanvasHash(),
      signature: state.nodeSignature,
      nodeTypes: state.nodes.map((node) => node.type),
      nodeCount: state.nodes.length,
      geometryDigest: state.geometry.digest,
    };
  });
  const reordered = await page.evaluate(async () => {
    const api = window.lumenStudio;
    const state = api.getState();
    const tone = state.nodes.find((node) => node.type === "tone");
    const result = await api.reorderNode(tone.id, 1);
    return {
      result,
      hash: api.getCanvasHash(),
      nodeTypes: api.getState().nodes.map((node) => node.type),
      geometryDigest: api.getState().geometry.digest,
    };
  });
  assert.equal(reordered.result.changed, true);
  assert.deepEqual(reordered.nodeTypes, ["levels", "tone", "blur", "noise"]);
  assert.notEqual(reordered.hash, interactionBaseline.hash);
  assert.equal(reordered.geometryDigest, interactionBaseline.geometryDigest);
  await page.evaluate(() => window.lumenStudio.undo());
  const afterReorderUndo = await page.evaluate(() => {
    const api = window.lumenStudio;
    return {
      hash: api.getCanvasHash(),
      state: api.getState(),
    };
  });
  assert.equal(afterReorderUndo.hash, interactionBaseline.hash);
  assert.equal(afterReorderUndo.state.nodeSignature, interactionBaseline.signature);

  const bypassed = await page.evaluate(async () => {
    const api = window.lumenStudio;
    const blur = api.getState().nodes.find((node) => node.type === "blur");
    const result = await api.setNodeEnabled(blur.id, false);
    return { result, hash: api.getCanvasHash() };
  });
  assert.equal(bypassed.result.ok, true);
  assert.notEqual(bypassed.hash, interactionBaseline.hash);
  await page.evaluate(() => window.lumenStudio.undo());
  const afterBypassUndo = await page.evaluate(() => ({
    hash: window.lumenStudio.getCanvasHash(),
    state: window.lumenStudio.getState(),
  }));
  assert.equal(afterBypassUndo.hash, interactionBaseline.hash);
  assert.equal(afterBypassUndo.state.nodeCount, interactionBaseline.nodeCount);

  const added = await page.evaluate(() => window.lumenStudio.addNode("noise"));
  assert.equal(added.ok, true);
  assert.equal(added.state.nodeCount, interactionBaseline.nodeCount + 1);
  const addedHash = await canvasHash(page);
  assert.notEqual(addedHash, interactionBaseline.hash);
  await page.evaluate(() => window.lumenStudio.undo());
  const afterAddUndo = await page.evaluate(() => ({
    hash: window.lumenStudio.getCanvasHash(),
    state: window.lumenStudio.getState(),
  }));
  assert.equal(afterAddUndo.hash, interactionBaseline.hash);
  assert.equal(afterAddUndo.state.nodeCount, interactionBaseline.nodeCount);
  report.groups.interactions = {
    reorderChangedPixels: reordered.hash !== interactionBaseline.hash,
    reorderKeptGeometry: reordered.geometryDigest === interactionBaseline.geometryDigest,
    reorderUndoRestoredPixels: afterReorderUndo.hash === interactionBaseline.hash,
    bypassChangedPixels: bypassed.hash !== interactionBaseline.hash,
    bypassUndoRestoredPixels: afterBypassUndo.hash === interactionBaseline.hash,
    addNodeIncreasedCount: added.state.nodeCount === interactionBaseline.nodeCount + 1,
    addNodeChangedPixels: addedHash !== interactionBaseline.hash,
    addUndoRestoredPixels: afterAddUndo.hash === interactionBaseline.hash,
  };
  report.checks.reorderBypassAddAndUndoChangeRealPixels = true;

  const largePromise = page.evaluate(() =>
    window.lumenStudio.setResolution("1440x1080"),
  );
  await page.waitForTimeout(90);
  const progressVisible = await page.locator("#progressPanel").isVisible();
  const progressText = await page.locator("#progressValue").textContent();
  const largeResult = await largePromise;
  assert.equal(largeResult.ok, true);
  assert.equal(largeResult.state.width, 1440);
  assert.equal(largeResult.state.height, 1080);
  assert.equal(progressVisible, true);
  assert.match(progressText || "", /%$/);
  report.groups.largeImage = {
    visibleProgressPanel: progressVisible,
    progressText,
    width: largeResult.state.width,
    height: largeResult.state.height,
    pixelCount: largeResult.state.width * largeResult.state.height,
    renderMs: largeResult.state.lastRenderMs,
  };
  report.checks.largeImageShowsProgress = true;
  const backToDefault = await page.evaluate(() =>
    window.lumenStudio.setResolution("1024x768"),
  );
  assert.equal(backToDefault.ok, true);
  await page.evaluate(() => window.lumenStudio.seek(1200));

  const extremeInput = await page.evaluate(async () => {
    const api = window.lumenStudio;
    const state = api.getState();
    const byType = Object.fromEntries(state.nodes.map((node) => [node.type, node.id]));
    const results = [];
    results.push(
      await api.setNodeParams(byType.levels, { black: 0, white: 255, gamma: 3 }),
    );
    results.push(await api.setNodeParams(byType.blur, { radius: 12 }));
    results.push(
      await api.setNodeParams(byType.noise, { amount: 0.6, seed: 9999 }),
    );
    results.push(
      await api.setNodeParams(byType.tone, {
        exposure: 2,
        contrast: 2,
        saturation: 0,
      }),
    );
    return {
      ok: results.every((result) => result.ok),
      state: api.getState(),
      byType,
    };
  });
  assert.equal(extremeInput.ok, true);
  const extremeState = extremeInput.state;
  const extremeHash = await canvasHash(page);
  assert.notEqual(extremeHash, defaultHash);
  assert.equal(extremeState.geometry.objectCount, defaultState.geometry.objectCount);
  assert.equal(extremeState.geometry.digest, defaultState.geometry.digest);
  const extremeExport = await page.evaluate(() =>
    window.lumenStudio.exportPng({ download: false }),
  );
  assert.equal(extremeExport.match, true);
  assert.equal(extremeExport.digest, extremeHash);
  const extremeCompare = await comparePreviewWithPng(page, extremeExport.dataUrl);
  assert.equal(extremeCompare.byteDiff, 0);
  report.screenshots.push(await screenshot(page, "extreme.png"));
  report.groups.extreme = {
    paramsApplied: true,
    previewHash: extremeHash,
    baselinePreviewHash: defaultHash,
    exportHash: extremeExport.digest,
    pngByteDiff: extremeCompare.byteDiff,
    nodeCount: extremeState.nodes.length,
    objectCount: extremeState.geometry.objectCount,
    geometryDigest: extremeState.geometry.digest,
    geometryMatchesBaseline:
      JSON.stringify(compactGeometry(extremeState)) ===
      JSON.stringify(compactGeometry(defaultState)),
  };
  report.checks.extremeSettingsRenderDeterministically = true;

  const goodHash = extremeHash;
  const invalid = await page.evaluate(async () => {
    const api = window.lumenStudio;
    const state = api.getState();
    const blur = state.nodes.find((node) => node.type === "blur");
    const result = await api.setNodeParam(blur.id, "radius", 25);
    return {
      result,
      hash: api.getCanvasHash(),
      errorPanel: !document.getElementById("errorPanel").hidden,
      errorMessage: document.getElementById("errorMessage").textContent,
    };
  });
  assert.equal(invalid.result.ok, false);
  assert.match(invalid.result.state.error.message, /Radius/);
  assert.match(invalid.result.state.error.message, /0–24/);
  assert.equal(invalid.errorPanel, true);
  assert.match(invalid.errorMessage || "", /Radius/);
  assert.equal(invalid.hash, goodHash);
  const errorCanvasStats = await page.evaluate(() => {
    const canvas = document.getElementById("previewCanvas");
    const data = canvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    let minimum = 255;
    let maximum = 0;
    for (let index = 0; index < data.length; index += 401) {
      minimum = Math.min(minimum, data[index]);
      maximum = Math.max(maximum, data[index]);
      if (data[index] !== 0) colored += 1;
    }
    return { colored, minimum, maximum };
  });
  assert.ok(errorCanvasStats.colored > 0);
  assert.ok(errorCanvasStats.maximum - errorCanvasStats.minimum > 40);
  report.screenshots.push(await screenshot(page, "error.png"));
  report.groups.error = {
    accepted: invalid.result.ok,
    message: invalid.result.state.error.message,
    errorOverlayVisible: invalid.errorPanel,
    canvasPreservedHash: invalid.hash === goodHash,
    canvasHasContent: errorCanvasStats.colored > 0,
    canvasRange: [errorCanvasStats.minimum, errorCanvasStats.maximum],
  };
  report.checks.invalidParametersShowExplicitError = true;

  const recovered = await page.evaluate(async () => {
    const api = window.lumenStudio;
    const state = api.getState();
    const blur = state.nodes.find((node) => node.type === "blur");
    return api.setNodeParams(blur.id, { radius: 2 });
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.state.error, null);

  const frozenStart = await page.evaluate(() => {
    const api = window.lumenStudio;
    api.seek(2400);
    return { state: api.getState(), hash: api.getCanvasHash() };
  });
  await page.waitForTimeout(360);
  const frozenEnd = await page.evaluate(() => {
    const api = window.lumenStudio;
    return { state: api.getState(), hash: api.getCanvasHash() };
  });
  assert.equal(frozenEnd.state.paused, true);
  assert.equal(frozenEnd.state.animation.frame, frozenStart.state.animation.frame);
  assert.equal(frozenEnd.state.animation.elapsedMs, frozenStart.state.animation.elapsedMs);
  assert.equal(frozenEnd.hash, frozenStart.hash);

  const resumedStart = await page.evaluate(() => window.lumenStudio.resume());
  await page.waitForTimeout(280);
  const resumedEnd = await page.evaluate(() => window.lumenStudio.pause());
  const resumedElapsed = resumedEnd.animation.elapsedMs - resumedStart.animation.elapsedMs;
  assert.ok(resumedEnd.animation.frame > resumedStart.animation.frame);
  assert.ok(resumedElapsed > 100 && resumedElapsed < 620, `resume delta ${resumedElapsed}`);
  assert.equal(
    resumedEnd.animation.droppedFrames,
    resumedStart.animation.droppedFrames,
    "resume should not add dropped frames",
  );
  report.groups.animation = {
    pausedFrames: frozenStart.state.animation.frame,
    pausedElapsedBefore: frozenStart.state.animation.elapsedMs,
    pausedElapsedAfterWait: frozenEnd.state.animation.elapsedMs,
    pausedHashStable: frozenEnd.hash === frozenStart.hash,
    resumedFramesAdvanced:
      resumedEnd.animation.frame - resumedStart.animation.frame,
    resumedElapsedMs: Math.round(resumedElapsed),
    droppedFramesBefore: resumedStart.animation.droppedFrames,
    droppedFramesAfter: resumedEnd.animation.droppedFrames,
  };
  report.checks.pauseFreezesAndResumeDoesNotJump = true;

  await page.evaluate(() => window.lumenStudio.seek(3200));
  const preTransform = await pageState(page);
  const preTransformGeometry = compactGeometry(preTransform);
  const transformed = await page.evaluate(() => {
    const api = window.lumenStudio;
    api.setZoom(147);
    api.setRotation(17);
    return api.getState();
  });
  assert.ok(transformed.geometry.maxDriftPx < 0.001);
  assert.deepEqual(transformed.geometry.order, preTransform.geometry.order);
  assert.equal(transformed.geometry.objectCount, preTransform.geometry.objectCount);
  for (const [index, object] of transformed.geometry.objects.entries()) {
    const before = preTransform.geometry.objects[index];
    assert.equal(object.id, before.id);
    assert.equal(object.z, before.z);
    assert.equal(object.opacity, before.opacity);
    assert.ok(
      Math.hypot(
        object.anchorNormalized.x - before.anchorNormalized.x,
        object.anchorNormalized.y - before.anchorNormalized.y,
      ) < 1e-9,
    );
  }
  const transformedExport = await page.evaluate(() =>
    window.lumenStudio.exportPng({ download: false }),
  );
  assert.equal(transformedExport.match, true);
  assert.equal(transformedExport.geometry.digest, transformed.geometry.digest);
  const transformedCompare = await comparePreviewWithPng(
    page,
    transformedExport.dataUrl,
  );
  assert.equal(transformedCompare.byteDiff, 0);
  report.screenshots.push(await screenshot(page, "transformed.png"));
  report.groups.transform = {
    zoom: transformed.zoom,
    rotation: transformed.rotation,
    maxAnchorDriftPx: transformed.geometry.maxDriftPx,
    objectCount: transformed.geometry.objectCount,
    annotationCount: transformed.geometry.annotationCount,
    stableOrder: JSON.stringify(transformed.geometry.order) === JSON.stringify(preTransform.geometry.order),
    normalizedAnchorsStable: true,
    screenAnchorsChanged:
      JSON.stringify(transformed.geometry.objects.map((object) => object.anchor)) !==
      JSON.stringify(preTransform.geometry.objects.map((object) => object.anchor)),
    opacityStable: true,
    exportMatchesPreview: transformedExport.match,
    pngByteDiff: transformedCompare.byteDiff,
  };
  report.checks.annotationsStayAttachedAfterZoomAndRotation = true;
  report.checks.transparencyAndOcclusionOrderStable = true;

  const beforePreset = await page.evaluate(() => ({
    screenshot: window.lumenStudio.screenshot(),
    state: window.lumenStudio.getState(),
  }));
  const screenshotCompare = await comparePreviewWithPng(
    page,
    beforePreset.screenshot.dataUrl,
  );
  assert.equal(screenshotCompare.byteDiff, 0);
  assert.equal(screenshotCompare.pngPixelHash, beforePreset.screenshot.digest);
  assert.equal(
    beforePreset.screenshot.digest,
    beforePreset.state.previewHash,
  );
  const saved = await page.evaluate(() =>
    window.lumenStudio.savePreset("E2E Solar Grade"),
  );
  assert.ok(saved);
  assert.equal(saved.frameDigest, beforePreset.screenshot.digest);
  assert.equal(saved.geometryDigest, beforePreset.state.geometry.digest);
  report.groups.screenshot = {
    digest: beforePreset.screenshot.digest,
    canvasDigest: beforePreset.state.previewHash,
    pngPixelHash: screenshotCompare.pngPixelHash,
    pngByteDiff: screenshotCompare.byteDiff,
    width: beforePreset.screenshot.width,
    height: beforePreset.screenshot.height,
  };
  report.checks.screenshotMatchesCurrentCanvas = true;
  report.screenshots.push(await screenshot(page, "preset-before-reload.png"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__LUMEN_READY__ === true, null, {
    timeout: 20000,
  });
  const presetsAfterReload = await page.evaluate(() => window.lumenStudio.getPresets());
  assert.ok(presetsAfterReload.some((preset) => preset.name === "E2E Solar Grade"));
  const loaded = await page.evaluate(() =>
    window.lumenStudio.loadPreset("E2E Solar Grade"),
  );
  assert.ok(loaded);
  assert.equal(loaded.match, true);
  assert.equal(loaded.digest, saved.frameDigest);
  assert.equal(loaded.geometry.digest, saved.geometryDigest);
  assert.equal(loaded.state.animation.elapsedMs, saved.animationTime);
  assert.equal(loaded.state.paused, true);
  const loadedHash = await canvasHash(page);
  assert.equal(loadedHash, saved.frameDigest);
  const loadedExport = await page.evaluate(() =>
    window.lumenStudio.exportPng({ download: false }),
  );
  assert.equal(loadedExport.match, true);
  const loadedCompare = await comparePreviewWithPng(page, loadedExport.dataUrl);
  assert.equal(loadedCompare.byteDiff, 0);
  report.screenshots.push(await screenshot(page, "preset-after-reload.png"));
  report.groups.preset = {
    savedName: saved.name,
    savedFrameDigest: saved.frameDigest,
    loadedFrameDigest: loaded.digest,
    frameDigestMatches: saved.frameDigest === loaded.digest,
    savedGeometryDigest: saved.geometryDigest,
    loadedGeometryDigest: loaded.geometry.digest,
    geometryDigestMatches: saved.geometryDigest === loaded.geometry.digest,
    persistedAfterReload: true,
    nodeSignatureRestored: loaded.state.nodeSignature === saved.nodeSignature,
    animationTimeRestored: loaded.state.animation.elapsedMs === saved.animationTime,
    previewHash: loadedHash,
    exportHash: loadedExport.digest,
    pngByteDiff: loadedCompare.byteDiff,
  };
  report.checks.presetReloadMatchesScreenshotAndGeometry = true;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    canvasWidth: Math.round(
      document.getElementById("previewCanvas").getBoundingClientRect().width,
    ),
  }));
  assert.ok(
    mobileLayout.scrollWidth <= mobileLayout.viewportWidth + 1,
    "mobile layout should not overflow horizontally",
  );
  report.screenshots.push(await screenshot(page, "mobile.png"));
  report.groups.mobile = mobileLayout;
  report.checks.mobileNoHorizontalOverflow = true;

  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = {
    message: error.message,
    stack: error.stack,
  };
  throw error;
} finally {
  await page.screenshot({
    path: `${screenshotDir}/verification-final.png`,
    fullPage: true,
  }).catch(() => {});
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  server?.kill();
}

console.log(JSON.stringify(report, null, 2));
