import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
let server = null;
let BASE_URL = process.env.BASE_URL;
if (!BASE_URL) {
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
  };
  server = http.createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
      const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const absolutePath = path.resolve(root, relativePath);
      if (!absolutePath.startsWith(root + path.sep)) throw new Error("Invalid path");
      const body = await fs.readFile(absolutePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(absolutePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  BASE_URL = `http://127.0.0.1:${server.address().port}/`;
}
const screenshotDir = path.resolve("artifacts/screenshots");
const downloadDir = path.resolve("artifacts/exports");
await fs.mkdir(screenshotDir, { recursive: true });
await fs.mkdir(downloadDir, { recursive: true });

function parseWav(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  assert.equal(buffer.toString("ascii", 36, 40), "data");
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);
  const frames = dataSize / (channels * (bitsPerSample / 8));
  const peaks = new Array(channels).fill(0);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = buffer.readInt16LE(offset) / 32768;
      peaks[channel] = Math.max(peaks[channel], Math.abs(sample));
      offset += 2;
    }
  }
  return {
    channels,
    sampleRate,
    bitsPerSample,
    duration: frames / sampleRate,
    peaks,
    peakDb: peaks.map((peak) => 20 * Math.log10(peak)),
  };
}

async function clickNode(page, id) {
  const rects = await page.evaluate(() => window.SignalTrace.getNodeRects());
  const rect = rects.find((item) => item.id === id);
  assert.ok(rect, `Canvas node ${id} should exist`);
  await page.mouse.click(rect.x, rect.y);
  await page.waitForTimeout(120);
}

async function waitReady(page) {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.SignalTrace?.getState);
  await page.evaluate(() => window.SignalTrace.ready);
  await page.waitForFunction(() => window.SignalTrace.getClips().length === 6);
}

async function submitCurrent(page) {
  await page.locator("#submitButton").click();
  await page.waitForTimeout(120);
  return page.evaluate(() => window.SignalTrace.getState().game);
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await page.waitForTimeout(120);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await waitReady(page);
  await page.screenshot({ path: path.join(screenshotDir, "initial.png"), fullPage: true });

  const catalog = await page.evaluate(() => window.SignalTrace.getClips());
  const key = await page.evaluate(() => window.SignalTrace.getPairingKey());
  assert.equal(catalog.length, 6);
  assert.equal(Object.keys(key).length, 3);

  const sourceIds = catalog.filter((clip) => clip.role === "source").map((clip) => clip.id);
  const variantIds = catalog.filter((clip) => clip.role === "variant").map((clip) => clip.id);
  const correctPairs = sourceIds.map((id) => [id, key[id]]);

  await clickNode(page, sourceIds[0]);
  let playingState = await page.evaluate(() => window.SignalTrace.getState());
  assert.equal(playingState.game.playing, sourceIds[0], "Canvas click should start real-time playback");
  await page.locator("#pauseButton").click();
  await page.waitForTimeout(250);
  let pausedState = await page.evaluate(() => window.SignalTrace.getState());
  assert.equal(pausedState.engine.paused, true);
  assert.equal(pausedState.engine.state, "suspended");
  await page.locator("#pauseButton").click();
  await page.waitForTimeout(250);
  pausedState = await page.evaluate(() => window.SignalTrace.getState());
  assert.equal(pausedState.engine.paused, false);
  await page.locator("#replayButton").click();
  await page.waitForTimeout(250);
  await page.locator("#clearButton").click();

  for (let index = 0; index < sourceIds.length; index += 1) {
    await clickNode(page, sourceIds[index]);
    await clickNode(page, variantIds[(index + 1) % variantIds.length]);
  }
  let game = await submitCurrent(page);
  assert.equal(game.strikes, 1, "First wrong submission should consume one strike");
  assert.equal(game.completed, false);
  assert.equal(Object.keys(game.results).length, 3, "Similarity should reveal after submission");
  game = await submitCurrent(page);
  assert.equal(game.strikes, 0);
  assert.equal(game.failed, true, "Second wrong submission should fail the attempt");
  await page.screenshot({ path: path.join(screenshotDir, "failed-after-two.png"), fullPage: true });

  await waitReady(page);
  for (const [sourceId, variantId] of correctPairs) {
    await clickNode(page, sourceId);
    await clickNode(page, variantId);
  }
  game = await submitCurrent(page);
  assert.equal(game.completed, true, "Correct pairing should complete the game");
  assert.equal(game.strikes, 2);
  assert.ok(Object.values(game.results).every((result) => result.correct));
  await page.screenshot({ path: path.join(screenshotDir, "correct-match.png"), fullPage: true });

  await page.locator("#labPlayButton").click();
  await page.waitForTimeout(900);
  await setRange(page, "#pitchControl", 440);
  await page.waitForTimeout(850);
  const highPitchState = await page.evaluate(() => window.SignalTrace.getState());
  const pitchProbe = await page.evaluate(() => window.SignalTrace.probeParameters(1.6));
  assert.ok(Math.abs(highPitchState.lab.metrics.pitch - 440) < 12, "Live pitch meter should follow synthesized pitch");
  assert.ok(Math.abs(pitchProbe.pitch - 440) < 6, "Rendered waveform pitch should change");
  await page.waitForFunction(
    () => document.querySelector("#labState b").textContent === "已收敛",
    null,
    { timeout: 1800 },
  );

  await setRange(page, "#panControl", -82);
  await page.waitForTimeout(850);
  const leftPan = await page.evaluate(() => window.SignalTrace.probeParameters(1.4));
  await setRange(page, "#panControl", 82);
  await page.waitForTimeout(850);
  const rightPan = await page.evaluate(() => window.SignalTrace.probeParameters(1.4));
  assert.ok(leftPan.peakL > leftPan.peakR + 3, "Left pan should produce stronger left channel audio");
  assert.ok(rightPan.peakR > rightPan.peakL + 3, "Right pan should produce stronger right channel audio");

  await page.locator('[data-band="low"]').click();
  await page.waitForTimeout(500);
  const lowBand = await page.evaluate(() => window.SignalTrace.probeParameters(1.4));
  await page.locator('[data-band="high"]').click();
  await page.waitForTimeout(500);
  const highBand = await page.evaluate(() => window.SignalTrace.probeParameters(1.4));
  assert.ok(highBand.centroid > lowBand.centroid * 1.45, "Filter band must alter the rendered spectral centroid");

  await setRange(page, "#tempoControl", 70);
  await page.waitForTimeout(2200);
  const slowTempo = await page.evaluate(() => window.SignalTrace.getState().lab.metrics.tempo);
  await setRange(page, "#tempoControl", 168);
  await page.waitForTimeout(2200);
  const fastTempo = await page.evaluate(() => window.SignalTrace.getState().lab.metrics.tempo);
  assert.ok(fastTempo > slowTempo + 60, "Tempo must change actual pulse timing");

  await setRange(page, "#delayControl", 70);
  await page.waitForTimeout(1400);
  const shortDelay = await page.evaluate(() => window.SignalTrace.getState().lab.metrics.delay);
  await setRange(page, "#delayControl", 360);
  await page.waitForTimeout(1800);
  const longDelay = await page.evaluate(() => window.SignalTrace.getState().lab.metrics.delay);
  assert.ok(longDelay > shortDelay + 120, "Delay node change must be visible in the echo meter");

  await setRange(page, "#pitchControl", 330);
  await setRange(page, "#panControl", -24);
  await page.locator('[data-band="mid"]').click();
  await setRange(page, "#tempoControl", 126);
  await setRange(page, "#delayControl", 210);
  await setRange(page, "#peakControl", -8.5);
  await page.waitForTimeout(600);
  await page.locator("#saveButton").click();

  const firstDownloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator("#exportButton").click();
  const firstDownload = await firstDownloadPromise;
  const firstPath = path.join(downloadDir, "signal-trace-A.wav");
  await firstDownload.saveAs(firstPath);
  const firstWav = parseWav(await fs.readFile(firstPath));
  assert.equal(firstWav.channels, 2);
  assert.ok(Math.abs(firstWav.duration - 5) < 0.01);
  assert.ok(firstWav.peaks.every((peak) => peak > 0.005), "Both channels must contain audio");
  const firstRender = await page.evaluate(() => window.SignalTrace.getState().lastRender);
  assert.equal(firstRender.checks.silence, false);
  assert.equal(firstRender.checks.clipping, false);
  assert.equal(firstRender.checks.channels, true);

  await page.locator("#reloadButton").click();
  await page.waitForTimeout(700);
  const reloaded = await page.evaluate(() => window.SignalTrace.getState().lab.params);
  assert.equal(reloaded.pitch, 330);
  assert.equal(Math.round(reloaded.delay * 1000), 210);

  const secondDownloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator("#exportButton").click();
  const secondDownload = await secondDownloadPromise;
  const secondPath = path.join(downloadDir, "signal-trace-B.wav");
  await secondDownload.saveAs(secondPath);
  const secondWav = parseWav(await fs.readFile(secondPath));
  assert.ok(Math.abs(firstWav.duration - secondWav.duration) < 0.001);
  assert.ok(Math.abs(firstWav.peakDb[0] - secondWav.peakDb[0]) < 0.2);
  assert.ok(Math.abs(firstWav.peakDb[1] - secondWav.peakDb[1]) < 0.2);
  const comparisons = await page.evaluate(() =>
    ["#compareDuration", "#comparePeak", "#comparePitch", "#compareDelay"].map((selector) => ({
      selector,
      result: document.querySelector(selector).querySelector("em").textContent,
    })),
  );
  assert.ok(comparisons.every((item) => item.result === "一致"), "All A/B comparison rows should pass");
  await page.screenshot({ path: path.join(screenshotDir, "verified.png"), fullPage: true });

  assert.deepEqual(consoleErrors, []);
  const report = {
    game: { wrongTwice: true, correctOnce: true },
    dimensions: {
      pitchHz: pitchProbe.pitch,
      leftPanDb: [leftPan.peakL, leftPan.peakR],
      rightPanDb: [rightPan.peakL, rightPan.peakR],
      centroidLowHigh: [lowBand.centroid, highBand.centroid],
      tempo: [slowTempo, fastTempo],
      delayMs: [shortDelay, longDelay],
    },
    export: {
      first: { duration: firstWav.duration, peaks: firstWav.peakDb },
      second: { duration: secondWav.duration, peaks: secondWav.peakDb },
      comparisons,
    },
  };
  await fs.writeFile(
    path.resolve("artifacts/verification.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
