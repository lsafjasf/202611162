import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, globSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.resolve(root, `.${requested}`);
      if (!file.startsWith(root)) throw new Error("Path outside workspace");
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
      response.end(content);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

const results = [];
async function test(name, callback) {
  const started = Date.now();
  try {
    await callback();
    results.push({ name, passed: true, duration: Date.now() - started });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, passed: false, duration: Date.now() - started, error: error.message });
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

await mkdir(artifacts, { recursive: true });
const server = await startServer();
const address = server.address();
const cachedChromium = globSync(path.join(userInfo().homedir, ".cache/ms-playwright/chromium-*/chrome-linux64/chrome"))
  .sort()
  .at(-1);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (cachedChromium && existsSync(cachedChromium) ? cachedChromium : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const browserErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});
page.on("pageerror", (error) => browserErrors.push(`Page error: ${error.message}`));

await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.documentElement.dataset.strataReady === "true");
await page.evaluate(() => window.Strata.settle());
await page.screenshot({ path: path.join(artifacts, "preview-default.png"), fullPage: true });

await test("default scene has finite geometry and non-overlapping labels", async () => {
  const summary = await page.evaluate(() => window.Strata.getScene());
  assert.equal(summary.error, null);
  assert.ok(summary.objectCount > 50, `expected a populated scene, got ${summary.objectCount}`);
  assert.equal(summary.labelOverlaps, 0);
  assert.ok(summary.series.every((series) => series.points.length > 0));
});

await test("Canvas preview and editable SVG expose the same geometry digest", async () => {
  const capture = await page.evaluate(() => window.Strata.capture());
  assert.ok(capture.coverage.nonBlank, "canvas preview should contain rendered pixels");
  assert.ok(capture.svgTextCount >= 10, "SVG should keep axis and annotation text editable");
  assert.ok(capture.svg.includes(capture.digest), "SVG metadata should contain the scene digest");
  assert.ok(!capture.svg.includes("<image"), "SVG must not be a raster wrapper");
  assert.equal(capture.objectCount, capture.geometry.length);
});

await test("default, extreme and invalid scenarios recalculate deterministically", async () => {
  for (const name of ["default", "extreme", "invalid"]) {
    await page.evaluate((scenario) => {
      window.Strata.applyScenario(scenario);
      window.Strata.settle();
    }, name);
    const before = await page.evaluate(() => window.Strata.capture());
    await page.evaluate(() => window.Strata.render());
    const after = await page.evaluate(() => window.Strata.capture());
    assert.equal(after.objectCount, before.objectCount, `${name}: object count changed`);
    assert.equal(after.digest, before.digest, `${name}: geometry digest changed`);
    assert.equal(after.previewHash, before.previewHash, `${name}: screenshot hash changed`);
    assert.equal(after.svgHash, before.svgHash, `${name}: SVG hash changed`);
    assert.equal(before.labelOverlaps, 0, `${name}: labels overlap`);
    if (name === "invalid") {
      assert.ok(before.error, "invalid scenario should expose a validation error");
      assert.ok(before.coverage.nonBlank, "invalid scenario should retain a visible fallback plot");
    } else {
      assert.equal(before.error, null);
    }
  }
});

await test("series toggle updates axis range and legend state together", async () => {
  await page.evaluate(() => {
    window.Strata.applyScenario("default");
    window.Strata.settle();
  });
  const before = await page.evaluate(() => ({
    domain: window.Strata.getScene().domain,
    range: document.querySelector("#axisRange").textContent
  }));
  await page.locator(".legend-item").nth(0).click();
  await page.evaluate(() => window.Strata.settle());
  const after = await page.evaluate(() => ({
    domain: window.Strata.getScene().domain,
    range: document.querySelector("#axisRange").textContent,
    legendOff: document.querySelectorAll(".legend-item.is-off").length,
    legendText: [...document.querySelectorAll(".legend-item")].map((element) => element.textContent.trim())
  }));
  assert.notDeepEqual(after.domain, before.domain);
  assert.notEqual(after.range, before.range);
  assert.equal(after.legendOff, 1);
  assert.ok(after.legendText.every(Boolean));
});

await test("line, bar and scatter all use the internal Canvas renderer", async () => {
  for (const type of ["bar", "scatter", "line"]) {
    await page.evaluate((nextType) => {
      window.Strata.setState({ type: nextType });
      window.Strata.settle();
    }, type);
    const geometry = await page.evaluate(() => window.Strata.getSceneGeometry());
    const expected = type === "bar" ? "bar" : type === "scatter" ? "scatter-point" : "line-segment";
    assert.ok(geometry.some((object) => object.type === expected), `${type}: expected ${expected} geometry`);
  }
});

await test("undo restores the prior chart type", async () => {
  await page.evaluate(() => {
    window.Strata.applyScenario("default");
    window.Strata.settle();
  });
  await page.locator('.type-switch [data-type="bar"]').click();
  await page.evaluate(() => window.Strata.settle());
  assert.equal(await page.evaluate(() => window.Strata.getState().type), "bar");
  await page.locator("#undoBtn").click();
  await page.evaluate(() => window.Strata.settle());
  assert.equal(await page.evaluate(() => window.Strata.getState().type), "line");
});

await test("pause freezes the animation clock and resume continues without a jump", async () => {
  await page.evaluate(() => {
    window.Strata.applyScenario("default");
    window.Strata.setState({ type: "scatter" }, { animate: true });
  });
  await page.waitForTimeout(140);
  await page.locator("#pauseBtn").click();
  const paused = await page.evaluate(() => window.Strata.animation());
  await page.waitForTimeout(220);
  const frozen = await page.evaluate(() => window.Strata.animation());
  assert.equal(frozen.clock, paused.clock);
  assert.equal(frozen.frame, paused.frame);
  await page.locator("#pauseBtn").click();
  await page.waitForTimeout(100);
  const resumed = await page.evaluate(() => window.Strata.animation());
  assert.ok(resumed.clock > frozen.clock);
  assert.ok(resumed.clock - frozen.clock < 170, `unexpected jump: ${resumed.clock - frozen.clock}ms`);
  assert.ok(resumed.frame > frozen.frame);
});

await test("invalid domain shows a clear message instead of a blank chart", async () => {
  await page.evaluate(() => {
    window.Strata.applyScenario("invalid");
    window.Strata.settle();
  });
  const visible = await page.locator("#chartError").isVisible();
  const message = await page.locator("#chartErrorText").textContent();
  const summary = await page.evaluate(() => window.Strata.getScene());
  assert.ok(visible);
  assert.match(message, /minimum must be lower/i);
  assert.equal(await page.locator("#domainMin").inputValue(), "180");
  assert.equal(await page.locator("#domainMax").inputValue(), "-120");
  assert.ok(summary.objectCount > 20);
  assert.ok(await page.evaluate(() => window.Strata.capture().then((capture) => capture.coverage.nonBlank)));
});

await test("full in-browser audit reports every check passing", async () => {
  const audit = await page.evaluate(() => window.Strata.runAudit());
  assert.ok(audit.passed, JSON.stringify(audit.tests.filter((entry) => !entry.passed)));
  assert.equal(audit.tests.length, 7);
  const status = await page.locator("#auditStatus").textContent();
  assert.equal(status, "7 / 7 pass");
});

await test("saving and reloading a view matches screenshot, geometry and SVG hashes", async () => {
  const verification = await page.evaluate(async () => {
    window.Strata.applyScenario("default");
    window.Strata.setState({ zoom: 1.04, rotation: -3, type: "scatter" });
    window.Strata.settle();
    const view = await window.Strata.saveView({ name: "E2E hash baseline" });
    window.Strata.applyScenario("invalid");
    window.Strata.settle();
    const reload = await window.Strata.loadView(view.id);
    return {
      hashMatch: reload.hashMatch,
      digestMatch: reload.digestMatch,
      svgMatch: reload.svgMatch,
      viewName: view.name
    };
  });
  assert.equal(verification.hashMatch, true);
  assert.equal(verification.digestMatch, true);
  assert.equal(verification.svgMatch, true);
  assert.equal(verification.viewName, "E2E hash baseline");
});

await test("snapshot and SVG downloads produce real files", async () => {
  await page.evaluate(() => {
    window.Strata.applyScenario("default");
    window.Strata.settle();
  });
  const pngDownload = page.waitForEvent("download");
  await page.locator("#captureBtn").click();
  const png = await pngDownload;
  assert.match(png.suggestedFilename(), /\.png$/);
  const pngPath = await png.path();
  assert.ok(pngPath);

  const svgDownload = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const svg = await svgDownload;
  assert.match(svg.suggestedFilename(), /\.svg$/);
  const downloadedSvg = await readFile(await svg.path(), "utf8");
  assert.ok(downloadedSvg.includes("<text"));
  assert.ok(!downloadedSvg.includes("<image"));
  await writeFile(path.join(artifacts, "export-sample.svg"), downloadedSvg);
});

await test("browser console has no errors and the final UI is fully rendered", async () => {
  assert.deepEqual(browserErrors, []);
  const layout = await page.evaluate(() => {
    const chart = document.querySelector(".chart-card").getBoundingClientRect();
    const audit = document.querySelector(".audit-card").getBoundingClientRect();
    return {
      chartVisible: chart.width > 400 && chart.height > 300,
      auditVisible: audit.bottom <= window.innerHeight,
      errorHidden: document.querySelector("#chartError").hidden,
      title: document.querySelector("h1").textContent
    };
  });
  assert.equal(layout.chartVisible, true);
  assert.equal(layout.auditVisible, true);
  assert.equal(layout.errorHidden, true);
  assert.equal(layout.title, "Signal overview.");
  await page.screenshot({ path: path.join(artifacts, "preview-verified.png"), fullPage: true });
});

await browser.close();
await new Promise((resolve) => server.close(resolve));

const passed = results.filter((entry) => entry.passed).length;
console.log(`\n${passed}/${results.length} browser checks passed.`);
if (passed !== results.length) process.exitCode = 1;
