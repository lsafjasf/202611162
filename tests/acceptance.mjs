import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function assert(condition, message, detail) {
  if (!condition) {
    throw new Error(`${message}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const filePath = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
    if (!filePath.startsWith(root)) throw new Error("invalid path");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
let browser;

try {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream"
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__ECHO_DEBUG__);
  await page.click("#startButton");
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(800));

  let telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry());
  assert(telemetry.contextState === "running", "AudioContext is not running", telemetry.contextState);
  assert(telemetry.leftDb > -70 && telemetry.rightDb > -70, "No live audio on analysers", telemetry);
  assert(Math.max(...telemetry.sourceGains) > 0.01, "Gated source voices are not connected", telemetry.sourceGains);

  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ frequency: 120 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(450));
  const lowPitch = telemetry.actual.pitch;
  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ frequency: 260 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(450));
  const highPitch = telemetry.actual.pitch;
  assert(Math.abs(lowPitch - 120) < 0.8 && Math.abs(highPitch - 260) < 0.8, "Oscillator pitch did not settle", { lowPitch, highPitch });

  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ balance: -85 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(450));
  const leftEnergy = { left: telemetry.leftDb, right: telemetry.rightDb };
  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ balance: 85 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(450));
  const rightEnergy = { left: telemetry.leftDb, right: telemetry.rightDb };
  assert(leftEnergy.left > leftEnergy.right, "Left pan did not raise left channel", leftEnergy);
  assert(rightEnergy.right > rightEnergy.left, "Right pan did not raise right channel", rightEnergy);

  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ delay: 30 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(400));
  const shortDelay = telemetry.actual.delayMs;
  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ delay: 220 }));
  telemetry = await page.evaluate(() => window.__ECHO_DEBUG__.wait(400));
  const longDelay = telemetry.actual.delayMs;
  assert(Math.abs(shortDelay - 30) < 0.8 && Math.abs(longDelay - 220) < 0.8, "DelayNode did not settle", { shortDelay, longDelay });

  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ tempo: 60 }));
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(250));
  let before = await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry().pulseCount);
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(2200));
  let after = await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry().pulseCount);
  const slowPulses = after - before;
  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({ tempo: 120 }));
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(250));
  before = await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry().pulseCount);
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(2200));
  after = await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry().pulseCount);
  const fastPulses = after - before;
  assert(fastPulses > slowPulses, "Tempo did not change pulse schedule", { slowPulses, fastPulses });

  await page.evaluate(() => window.__ECHO_DEBUG__.setParams({
    frequency: 174, balance: 0, delay: 90, gain: 24, tempo: 72
  }));
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(350));
  for (let index = 0; index < 3; index += 1) {
    const sample = await page.evaluate((i) => window.__ECHO_DEBUG__.measureHotspot(i), index);
    assert(sample?.valid, `Hotspot ${index + 1} sample was invalid`, sample);
  }
  const completed = await page.evaluate(() => window.__ECHO_DEBUG__.getState());
  assert(completed.complete && completed.found.every(Boolean), "Survey did not complete", completed.found);

  const first = await page.evaluate(() => window.__ECHO_DEBUG__.checkExport());
  assert(first?.canExport, "First preflight failed", first?.checks);
  await page.evaluate(() => window.__ECHO_DEBUG__.confirmExport(false));
  await page.evaluate(() => window.__ECHO_DEBUG__.savePreset());
  await page.evaluate(() => window.__ECHO_DEBUG__.loadPreset());
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(450));
  const second = await page.evaluate(() => window.__ECHO_DEBUG__.checkExport());
  assert(second?.canExport, "Second preflight failed", second?.checks);
  const finalState = await page.evaluate(() => {
    window.__ECHO_DEBUG__.confirmExport(false);
    return window.__ECHO_DEBUG__.getState();
  });
  assert(finalState.lastComparison?.pass, "Reload comparison failed", finalState.lastComparison);
  assert(Math.abs(first.wav.duration - second.wav.duration) < 1e-9, "Exported WAV durations differ");
  assert(Math.abs(first.wav.peakLeft - second.wav.peakLeft) < 0.00001, "Exported left peaks differ");
  assert(Math.abs(first.wav.peakRight - second.wav.peakRight) < 0.00001, "Exported right peaks differ");

  const silent = await page.evaluate(() => window.__ECHO_DEBUG__.renderIsolated({
    frequency: 174, balance: 0, delay: 90, gain: 0, tempo: 72
  }));
  const missing = await page.evaluate(() => window.__ECHO_DEBUG__.renderIsolated({
    frequency: 174, balance: -100, delay: 90, gain: 24, tempo: 72
  }));
  const clipped = await page.evaluate(() => window.__ECHO_DEBUG__.renderIsolated({
    frequency: 174, balance: 0, delay: 90, gain: 48, tempo: 72
  }));
  assert(!silent.checks.silence.pass, "Silence guard failed");
  assert(!missing.checks.channels.pass, "Missing-channel guard failed");
  assert(!clipped.checks.clipping.pass, "Clipping guard failed");

  await page.click("#pauseButton");
  assert(await page.evaluate(() => window.__ECHO_DEBUG__.getState().paused), "Pause did not suspend session");
  assert((await page.evaluate(() => window.__ECHO_DEBUG__.getTelemetry().contextState)) === "suspended", "AudioContext did not suspend");
  await page.click("#pauseButton");
  assert(!(await page.evaluate(() => window.__ECHO_DEBUG__.getState().paused)), "Resume failed");
  await page.click("#replayButton");
  await page.evaluate(() => window.__ECHO_DEBUG__.wait(120));
  const replayed = await page.evaluate(() => window.__ECHO_DEBUG__.getState());
  assert(!replayed.complete && replayed.found.every((found) => !found), "Replay did not reset survey", replayed);
  await page.click("#resetButton");
  const resetParams = await page.evaluate(() => window.__ECHO_DEBUG__.getState().params);
  assert(resetParams.frequency === 174 && resetParams.delay === 90, "Parameter reset failed", resetParams);
  assert(errors.length === 0, "Browser emitted errors", errors);

  console.log("PASS");
  console.log(JSON.stringify({
    liveAudio: true,
    pitch: { low: lowPitch, high: highPitch },
    stereo: { leftEnergy, rightEnergy },
    delay: { short: shortDelay, long: longDelay },
    tempoPulses: { slow: slowPulses, fast: fastPulses },
    hotspots: completed.found,
    exports: {
      duration: first.wav.duration,
      peakLeft: first.wav.peakLeft,
      peakRight: first.wav.peakRight,
      comparison: finalState.lastComparison
    },
    guards: {
      silence: silent.checks.silence,
      clipping: clipped.checks.clipping,
      channels: missing.checks.channels
    }
  }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
