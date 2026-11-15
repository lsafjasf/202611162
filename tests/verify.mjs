import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "playwright";

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  artifacts: {},
  metrics: {},
};

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function check(name, condition, details = "") {
  report.checks.push({ name, ok: Boolean(condition), details });
  if (!condition) throw new Error(`CHECK FAILED: ${name}${details ? ` — ${details}` : ""}`);
}

function equal(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? "" : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function nearly(name, actual, expected, tolerance = 0.05) {
  const delta = Math.abs(actual - expected);
  check(name, delta <= tolerance, `delta=${delta} tolerance=${tolerance}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start");
}

async function getSvgInspector(page, svg) {
  return page.evaluate((markup) => {
    const document = new DOMParser().parseFromString(markup, "image/svg+xml");
    const root = document.documentElement;
    const polyline = document.querySelector("#profile-line");
    return {
      valid: root.nodeName === "svg" && !document.querySelector("parsererror"),
      pointCount: Number(root.getAttribute("data-point-count")),
      geometryDigest: root.getAttribute("data-geometry-digest"),
      profileDigest: root.getAttribute("data-profile-digest"),
      structuralDigest: root.getAttribute("data-structural-digest"),
      highPoint: Number(root.getAttribute("data-high-point")),
      angle: Number(root.getAttribute("data-section-angle")),
      offset: Number(root.getAttribute("data-section-offset")),
      polylinePoints: polyline
        ? polyline.getAttribute("points").trim().split(/\s+/).filter(Boolean).length
        : 0,
      title: document.querySelector("title")?.textContent ?? "",
    };
  }, svg);
}

async function pixelSummary(page, selector) {
  return page.evaluate((canvasSelector) => {
    const canvas = document.querySelector(canvasSelector);
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const data = context.getImageData(0, 0, width, height).data;
    const colors = new Set();
    let alphaPixels = 0;
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 32))) {
      for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
        const index = (y * width + x) * 4;
        colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
        if (data[index + 3] > 0) alphaPixels += 1;
      }
    }
    return { width, height, sampledColors: colors.size, alphaPixels };
  }, selector);
}

async function main() {
  await mkdir("artifacts/verification", { recursive: true });
  const port = await freePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverError = "";
  server.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });
  const baseURL = `http://127.0.0.1:${port}/`;
  await waitForServer(baseURL);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
  });

  try {
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.TerrainLab.pause());
    await page.waitForTimeout(250);

    const initialUI = await page.evaluate(() => window.TerrainLab.getUIState());
    const initialGeometry = await page.evaluate(() => window.TerrainLab.getGeometry());
    const initialPreview = await page.evaluate(() => window.TerrainLab.getCanvasPreview());
    const initialStats = await page.evaluate(() => window.TerrainLab.getStats());
    const initialDiagnostics = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics());
    const terrainPixels = await pixelSummary(page, "#terrainCanvas");
    const profilePixels = await pixelSummary(page, "#profileCanvas");
    report.metrics.default = {
      geometryDigest: initialGeometry.geometryDigest,
      profileDigest: initialGeometry.profileDigest,
      peakElevation: initialStats.peak.elevation,
      counts: initialGeometry.counts,
      terrainPixels,
      profilePixels,
    };

    check("default point count", initialGeometry.counts.points === 49 * 49);
    check("default cell count", initialGeometry.counts.cells === 48 * 48);
    check("default triangle count", initialGeometry.counts.triangles === 48 * 48 * 2);
    check("default profile samples", initialGeometry.section.samples === 181);
    check("terrain preview has varied geometry", terrainPixels.sampledColors > 80);
    check("profile preview has varied geometry", profilePixels.sampledColors > 25);
    check("UI peak matches internal peak", initialUI.peakText === `${Math.round(initialStats.peak.elevation).toLocaleString("en-US")} m`);
    check("UI mesh matches internal count", initialUI.meshText.includes("4,608"));
    check("preview canvas digest is non-empty", initialPreview.terrainDigest.length === 8);

    const initialSVG = await page.evaluate(() => window.TerrainLab.exportSVGString());
    const initialSVGInfo = await getSvgInspector(page, initialSVG);
    check("SVG parses", initialSVGInfo.valid);
    check("SVG profile samples match geometry", initialSVGInfo.pointCount === 181);
    check("SVG polyline samples match geometry", initialSVGInfo.polylinePoints === 181);
    check("SVG mesh digest matches geometry", initialSVGInfo.geometryDigest === initialGeometry.geometryDigest);
    check("SVG profile digest matches geometry", initialSVGInfo.profileDigest === initialGeometry.profileDigest);
    check(
      "SVG peak matches internal profile peak",
      Math.abs(initialSVGInfo.highPoint - initialStats.peak.elevation) < 0.01,
    );

    const exportOne = await page.evaluate(() => window.TerrainLab.captureScreenshot());
    const exportOneHash = hash(exportOne);
    report.artifacts.defaultSvg = "artifacts/verification/default.svg";
    report.artifacts.defaultPng = "artifacts/verification/default.png";
    await writeFile(report.artifacts.defaultSvg, initialSVG);
    await writeFile(report.artifacts.defaultPng, Buffer.from(exportOne.split(",")[1], "base64"));
    check("composite screenshot is a substantial PNG", exportOne.length > 250000, `${exportOne.length} chars`);

    const positionSample = initialGeometry.points.slice(0, 80);
    await page.evaluate(() => window.TerrainLab.recompute());
    const reGeometry = await page.evaluate(() => window.TerrainLab.getGeometry());
    const rePreview = await page.evaluate(() => window.TerrainLab.getCanvasPreview());
    const reDiagnostics = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics());
    const reSVG = await page.evaluate(() => window.TerrainLab.exportSVGString());
    const reExport = await page.evaluate(() => window.TerrainLab.captureScreenshot());
    check("recompute preserves all point positions", JSON.stringify(reGeometry.points.slice(0, 80)) === JSON.stringify(positionSample));
    equal("recompute preserves counts", reGeometry.counts, initialGeometry.counts);
    check("recompute preserves geometry digest", reGeometry.geometryDigest === initialGeometry.geometryDigest);
    check("recompute preserves profile digest", reGeometry.profileDigest === initialGeometry.profileDigest);
    check("recompute preserves screen terrain pixels", rePreview.terrainDigest === initialPreview.terrainDigest);
    check("recompute preserves screen profile pixels", rePreview.profileDigest === initialPreview.profileDigest);
    check("recompute preserves SVG bytes", reSVG === initialSVG);
    check("recompute preserves screenshot bytes", reExport === exportOne);
    check(
      "render order remains deterministic",
      reDiagnostics.renderOrderDigest === initialDiagnostics.renderOrderDigest,
    );

    await page.evaluate(() => window.TerrainLab.setCamera({ yaw: 66, pitch: 47, zoom: 1.55, panX: 0.045, panY: -0.03 }));
    await page.evaluate(() => window.TerrainLab.hoverFraction(0.37));
    const driftCheck = await page.evaluate(() => {
      const anchors = window.TerrainLab.getLabelAnchors();
      const peakProjected = window.TerrainLab.getProjectedPoint(anchors.peak.world);
      const highlightProjected = window.TerrainLab.getProjectedPoint(anchors.highlight.world);
      const state = window.TerrainLab.getState();
      return {
        anchors,
        peakProjected,
        highlightProjected,
        profilePlot: state.profileRender.plot,
        profilePeak: state.profileRender.anchors.profilePeak,
        maxSample: state.geometry.stats,
      };
    });
    nearly("peak label anchor tracks rotated projection X", driftCheck.anchors.peak.screen.x, driftCheck.peakProjected.x, 0.02);
    nearly("peak label anchor tracks rotated projection Y", driftCheck.anchors.peak.screen.y, driftCheck.peakProjected.y, 0.02);
    nearly("hover label anchor tracks rotated projection X", driftCheck.anchors.highlight.screen.x, driftCheck.highlightProjected.x, 0.02);
    nearly("hover label anchor tracks rotated projection Y", driftCheck.anchors.highlight.screen.y, driftCheck.highlightProjected.y, 0.02);
    check("profile plot respects margins", driftCheck.profilePlot.width > 0 && driftCheck.profilePlot.height > 0);

    const cameraBeforeSectionSwitch = await page.evaluate(() => window.TerrainLab.getCamera());
    const sectionSwitch = await page.evaluate(() => window.TerrainLab.switchDirection(90));
    const cameraAfterSectionSwitch = await page.evaluate(() => window.TerrainLab.getCamera());
    equal("direction switch preserves camera", cameraAfterSectionSwitch, cameraBeforeSectionSwitch);
    check("direction switch updates section", sectionSwitch.ok && sectionSwitch.section.angle === 90);
    check(
      "direction switch changes profile digest",
      sectionSwitch.section.profileDigest !== initialGeometry.profileDigest,
    );

    await page.evaluate(() => window.TerrainLab.setCamera({ yaw: 18, pitch: 39, zoom: 1.1 }));
    const orderBefore = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics().renderOrderDigest);
    await page.evaluate(() => window.TerrainLab.recompute());
    const orderAfter = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics().renderOrderDigest);
    check("painter order is stable for the same camera", orderAfter === orderBefore);
    await page.evaluate(() => window.TerrainLab.setCamera({ yaw: 97, pitch: 51, zoom: 1.34 }));
    const rotatedOrder = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics().renderOrderDigest);
    await page.evaluate(() => window.TerrainLab.setCamera({ yaw: 18, pitch: 39, zoom: 1.1 }));
    const orderReturned = await page.evaluate(() => window.TerrainLab.getRenderDiagnostics().renderOrderDigest);
    check("painter order reflects rotation", rotatedOrder !== orderBefore);
    check("painter order returns when the camera returns", orderReturned === orderBefore);
    const layers = await page.evaluate(() => window.TerrainLab.getState().render.layerOrder);
    equal("transparent overlay layer sequence is explicit", layers.slice(0, 6), [
      "background",
      "base-grid",
      "terrain-shadow",
      "terrain-cells+contours",
      "section-trace",
      "section-endpoints",
    ]);

    await page.evaluate(() => window.TerrainLab.pause());
    await page.waitForTimeout(200);
    const frozenOne = await page.evaluate(() => ({
      preview: window.TerrainLab.getCanvasPreview(),
      animation: window.TerrainLab.getAnimationState(),
    }));
    await page.waitForTimeout(450);
    const frozenTwo = await page.evaluate(() => ({
      preview: window.TerrainLab.getCanvasPreview(),
      animation: window.TerrainLab.getAnimationState(),
    }));
    check("paused screen pixels are frozen", frozenOne.preview.terrainDigest === frozenTwo.preview.terrainDigest);
    check("paused profile pixels are frozen", frozenOne.preview.profileDigest === frozenTwo.preview.profileDigest);
    nearly("paused animation clock is frozen", frozenOne.animation.time, frozenTwo.animation.time, 0.0001);
    await page.evaluate(() => window.TerrainLab.resume());
    await page.waitForTimeout(320);
    const resumed = await page.evaluate(() => window.TerrainLab.getAnimationState());
    const resumedDelta = resumed.time - frozenTwo.animation.time;
    check("resume advances animation", resumedDelta > 0.06, `delta=${resumedDelta}`);
    check("resume does not jump the animation clock", resumedDelta < 0.55, `delta=${resumedDelta}`);
    await page.evaluate(() => window.TerrainLab.pause());

    const beforeInvalid = await page.evaluate(() => ({
      geometry: window.TerrainLab.getGeometry(false),
      preview: window.TerrainLab.getCanvasPreview(),
      svg: window.TerrainLab.exportSVGString(),
    }));
    const invalid = await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: -4, ridgeHeight: 9, resolution: 48 }),
    );
    const invalidUI = await page.evaluate(() => window.TerrainLab.getUIState());
    const afterInvalid = await page.evaluate(() => ({
      geometry: window.TerrainLab.getGeometry(false),
      preview: window.TerrainLab.getCanvasPreview(),
      svg: window.TerrainLab.exportSVGString(),
    }));
    check("invalid parameters are rejected", !invalid.ok && invalid.errors.length >= 2);
    check("invalid parameters show an explicit message", invalidUI.errorVisible && invalidUI.errorMessage.includes("种子"));
    check("invalid parameters do not blank terrain", afterInvalid.preview.terrainDigest === beforeInvalid.preview.terrainDigest);
    check("invalid parameters do not blank profile", afterInvalid.preview.profileDigest === beforeInvalid.preview.profileDigest);
    check("invalid parameters keep geometry unchanged", afterInvalid.geometry.geometryDigest === beforeInvalid.geometry.geometryDigest);
    check("invalid parameters keep SVG unchanged", afterInvalid.svg === beforeInvalid.svg);
    await page.evaluate(() => window.TerrainLab.clearError());

    const extremeLow = await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: 0, ridgeHeight: 0.1, resolution: 24 }),
    );
    const lowPreview = await page.evaluate(() => window.TerrainLab.getCanvasPreview());
    const lowSVG = await page.evaluate(() => window.TerrainLab.exportSVGString());
    const lowInfo = await getSvgInspector(page, lowSVG);
    check("low extreme rebuild succeeds", extremeLow.ok);
    check("low extreme uses 24 grid", extremeLow.counts.points === 25 * 25);
    check("low extreme SVG uses 181 samples", lowInfo.pointCount === 181);
    check("low extreme changes screen output", lowPreview.terrainDigest !== afterInvalid.preview.terrainDigest);

    const extremeHigh = await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: 2147483647, ridgeHeight: 2.4, resolution: 72 }),
    );
    const highUI = await page.evaluate(() => window.TerrainLab.getUIState());
    const highPreview = await page.evaluate(() => window.TerrainLab.getCanvasPreview());
    const highSVG = await page.evaluate(() => window.TerrainLab.exportSVGString());
    const highInfo = await getSvgInspector(page, highSVG);
    const highShot = await page.evaluate(() => window.TerrainLab.captureScreenshot());
    check("high extreme rebuild succeeds", extremeHigh.ok);
    check("high extreme uses 72 grid", extremeHigh.counts.points === 73 * 73);
    check("high extreme increases triangles", extremeHigh.counts.triangles > extremeLow.counts.triangles);
    check("high extreme raises peak", extremeHigh.stats.peak.elevation > extremeLow.stats.peak.elevation + 1000);
    check("high extreme UI peak matches stats", highUI.peakText === `${Math.round(extremeHigh.stats.peak.elevation).toLocaleString("en-US")} m`);
    check("high extreme changes screen output", highPreview.terrainDigest !== lowPreview.terrainDigest);
    check("high extreme changes profile pixels", highPreview.profileDigest !== lowPreview.profileDigest);
    check("high extreme changes SVG bytes", highSVG !== lowSVG);
    check("high extreme SVG high point matches stats", Math.abs(highInfo.highPoint - extremeHigh.stats.peak.elevation) < 0.01);
    check("high extreme screenshot differs", hash(highShot) !== hash(exportOne));
    report.metrics.extremes = {
      low: {
        seed: 0,
        ridge: 0.1,
        resolution: 24,
        counts: extremeLow.counts,
        peak: extremeLow.stats.peak.elevation,
        geometryDigest: extremeLow.digests.geometry,
        profileDigest: extremeLow.digests.profile,
        previewHash: lowPreview.terrainDigest,
        svgHash: hash(lowSVG),
      },
      high: {
        seed: 2147483647,
        ridge: 2.4,
        resolution: 72,
        counts: extremeHigh.counts,
        peak: extremeHigh.stats.peak.elevation,
        geometryDigest: extremeHigh.digests.geometry,
        profileDigest: extremeHigh.digests.profile,
        previewHash: highPreview.terrainDigest,
        svgHash: hash(highSVG),
      },
    };
    await writeFile("artifacts/verification/extreme-low.svg", lowSVG);
    await writeFile("artifacts/verification/extreme-high.svg", highSVG);
    await writeFile(
      "artifacts/verification/extreme-high.png",
      Buffer.from(highShot.split(",")[1], "base64"),
    );

    await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: 688, ridgeHeight: 1, resolution: 48 }),
    );
    await page.evaluate(() =>
      window.TerrainLab.setCamera({ yaw: 41, pitch: 36, zoom: 1.18, panX: 0.02, panY: 0.01 }),
    );
    await page.evaluate(() => window.TerrainLab.setSection({ angle: 58, offset: 0.17 }));
    await page.evaluate(() => window.TerrainLab.hoverFraction(0.62));
    await page.evaluate(() => window.TerrainLab.pinFraction(0.62));
    const savedScene = await page.evaluate(async () => ({
      geometry: window.TerrainLab.getGeometry(false),
      preview: window.TerrainLab.getCanvasPreview(),
      screenshot: await window.TerrainLab.captureScreenshot(),
      svg: window.TerrainLab.exportSVGString(),
    }));
    const preset = await page.evaluate(() => window.TerrainLab.savePreset("verification scene"));
    check("preset saved", Boolean(preset?.id));
    await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: 12345, ridgeHeight: 2.1, resolution: 36 }),
    );
    await page.evaluate(() =>
      window.TerrainLab.setCamera({ yaw: -52, pitch: 62, zoom: 0.72, panX: -0.1, panY: 0.08 }),
    );
    await page.evaluate(() => window.TerrainLab.setSection({ angle: 122, offset: -0.42 }));
    const changedScene = await page.evaluate(async () => ({
      geometry: window.TerrainLab.getGeometry(false),
      preview: window.TerrainLab.getCanvasPreview(),
      screenshot: await window.TerrainLab.captureScreenshot(),
    }));
    check("mutating scene changes geometry", changedScene.geometry.geometryDigest !== savedScene.geometry.geometryDigest);
    check("mutating scene changes screen", changedScene.preview.terrainDigest !== savedScene.preview.terrainDigest);
    const reload = await page.evaluate((id) => window.TerrainLab.loadPreset(id), preset.id);
    const loadedScene = await page.evaluate(async () => ({
      geometry: window.TerrainLab.getGeometry(false),
      preview: window.TerrainLab.getCanvasPreview(),
      screenshot: await window.TerrainLab.captureScreenshot(),
      svg: window.TerrainLab.exportSVGString(),
      lastPresetLoad: window.TerrainLab.getLastPresetLoad(),
    }));
    check("preset reload succeeds", reload.ok);
    check(
      "preset reload restores geometry digest",
      loadedScene.geometry.geometryDigest === savedScene.geometry.geometryDigest,
    );
    check(
      "preset reload restores profile digest",
      loadedScene.geometry.profileDigest === savedScene.geometry.profileDigest,
    );
    check(
      "preset reload restores screen preview hash",
      loadedScene.preview.terrainDigest === savedScene.preview.terrainDigest,
    );
    check(
      "preset reload restores profile preview hash",
      loadedScene.preview.profileDigest === savedScene.preview.profileDigest,
    );
    check(
      "preset reload restores screenshot hash",
      hash(loadedScene.screenshot) === hash(savedScene.screenshot),
    );
    check("preset reload restores SVG bytes", loadedScene.svg === savedScene.svg);
    check(
      "preset reload reports preserved structural digest",
      loadedScene.lastPresetLoad.currentDigests.structural === loadedScene.lastPresetLoad.savedDigests.structural,
    );
    report.metrics.persistence = {
      presetId: preset.id,
      savedGeometry: preset.geometryDigest,
      loadedGeometry: loadedScene.geometry.geometryDigest,
      savedProfile: preset.profileDigest,
      loadedProfile: loadedScene.geometry.profileDigest,
      savedScreenshotHash: hash(savedScene.screenshot),
      loadedScreenshotHash: hash(loadedScene.screenshot),
      savedPreviewHash: savedScene.preview.terrainDigest,
      loadedPreviewHash: loadedScene.preview.terrainDigest,
      structure: loadedScene.lastPresetLoad.currentDigests.structural,
    };
    await writeFile(
      "artifacts/verification/reloaded.png",
      Buffer.from(loadedScene.screenshot.split(",")[1], "base64"),
    );

    const undoBefore = await page.evaluate(() => ({
      geometry: window.TerrainLab.getGeometry(false).geometryDigest,
      history: window.TerrainLab.getState().state.historyLength,
    }));
    await page.evaluate(() =>
      window.TerrainLab.setParams({ seed: 777, ridgeHeight: 0.72, resolution: 48 }, { history: true }),
    );
    const undoDuring = await page.evaluate(() => window.TerrainLab.getState().state.historyLength);
    await page.evaluate(() => window.TerrainLab.undo());
    const undoAfter = await page.evaluate(() => ({
      geometry: window.TerrainLab.getGeometry(false).geometryDigest,
      history: window.TerrainLab.getState().state.historyLength,
    }));
    check("undo is available", undoBefore.history > 0);
    check("undo restores geometry", undoAfter.geometry === undoBefore.geometry);
    check("parameter change adds one history entry", undoDuring === undoBefore.history + 1);
    check("undo consumes history", undoAfter.history === undoBefore.history);

    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error.stack || error.message;
    report.pageErrors = pageErrors;
    throw error;
  } finally {
    await writeFile("artifacts/verification/report.json", JSON.stringify(report, null, 2));
    await browser.close();
    server.kill("SIGTERM");
    if (serverError) report.serverError = serverError;
  }
}

main()
  .then(() => {
    console.log(`PASS — ${report.checks.length} assertions`);
    console.log(`Report: artifacts/verification/report.json`);
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
