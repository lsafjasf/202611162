import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = await findFreePort();
const URL = `http://127.0.0.1:${PORT}/`;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function startServer() {
  const vite = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  return spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("Vite server did not start");
}

function parseWav(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WAVE");
  const channels = data.readUInt16LE(22);
  const sampleRate = data.readUInt32LE(24);
  const bits = data.readUInt16LE(34);
  const dataSize = data.readUInt32LE(40);
  const frames = dataSize / (channels * (bits / 8));
  const peaks = Array(channels).fill(0);
  let peak = 0;
  for (let offset = 44; offset + channels * 2 <= data.length; offset += channels * 2) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.abs(data.readInt16LE(offset + channel * 2) / 32768);
      peaks[channel] = Math.max(peaks[channel], sample);
      peak = Math.max(peak, sample);
    }
  }
  return { channels, sampleRate, bits, frames, duration: frames / sampleRate, peak, peaks };
}

async function sampleMetrics(page, durationMs = 600) {
  return page.evaluate(async (ms) => {
    let maxL = -Infinity;
    let maxR = -Infinity;
    let maxPeak = -Infinity;
    let maxFrequency = 0;
    let signal = false;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 24));
      const metrics = window.__grain16.engine.readMetrics();
      maxL = Math.max(maxL, metrics.left);
      maxR = Math.max(maxR, metrics.right);
      maxPeak = Math.max(maxPeak, metrics.peak);
      maxFrequency = Math.max(maxFrequency, metrics.frequency);
      signal ||= metrics.hasSignal;
    }
    return { maxL, maxR, maxPeak, maxFrequency, signal };
  }, durationMs);
}

async function setRange(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const input = document.querySelector(selector);
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { selector, value });
}

async function run() {
  const server = startServer();
  let browser;
  const downloads = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__grain16));
    assert.equal(await page.locator(".track-tab").count(), 4);
    assert.ok(await page.locator("#sequencerCanvas").boundingBox());
    assert.ok(await page.locator("#meterCanvas").boundingBox());
    console.log("✓ 页面、四音轨与 Canvas 初始化");

    await page.click("#playBtn");
    await page.waitForTimeout(700);
    const live = await sampleMetrics(page, 700);
    assert.equal(live.signal, true);
    assert.ok(live.maxPeak > -40, `Expected audible peak, got ${live.maxPeak}`);
    assert.ok(live.maxFrequency > 20);
    console.log(`✓ 实时合成有信号 · peak ${live.maxPeak.toFixed(1)} dBFS · ${live.maxFrequency.toFixed(1)} Hz`);

    await page.evaluate(() => {
      const pan = document.querySelector("#panInput");
      pan.value = "-100";
      pan.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const panned = await sampleMetrics(page, 900);
    assert.ok(panned.maxL > panned.maxR + 6, "Pan change did not change live channel energy");
    console.log(`✓ 声像参数改变实际声道能量 · L ${panned.maxL.toFixed(1)} / R ${panned.maxR.toFixed(1)} dB`);

    const timing = await page.evaluate(async () => {
      const seen = new Map();
      const collect = () => {
        for (const event of window.__grain16.engine.getScheduleSnapshot()) {
          seen.set(`${event.cycle}:${event.step}:${event.time.toFixed(4)}`, event);
        }
      };
      for (let index = 0; index < 25; index += 1) {
        collect();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const bpm = document.querySelector("#bpmInput");
      bpm.value = "150";
      bpm.dispatchEvent(new Event("change", { bubbles: true }));
      for (let index = 0; index < 35; index += 1) {
        collect();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return [...seen.values()].sort((a, b) => a.time - b.time);
    });
    assert.equal(new Set(timing.map((event) => `${event.cycle}:${event.step}`)).size, timing.length);
    const intervals = timing.slice(1).map((event, index) => (event.time - timing[index].time) * 1000);
    for (let index = 1; index < timing.length; index += 1) {
      if (intervals[index - 1] < 180) {
        assert.equal(timing[index].step, (timing[index - 1].step + 1) % 16);
      }
    }
    assert.ok(intervals.some((value) => Math.abs(value - 133.93) < 1), "Old tempo spacing missing");
    assert.ok(intervals.some((value) => Math.abs(value - 100) < 1), "New tempo spacing missing");
    assert.ok(intervals.every((value) => value > 95), "Tempo switch produced a doubled step");
    console.log("✓ 实时切速保持 AudioContext 时钟 · 133.93 ms → 100.00 ms 无缝重锚");

    await page.click("#playBtn");
    await page.waitForTimeout(80);
    const paused = await page.evaluate(() => window.__grain16.engine.getTransportState());
    assert.equal(paused.paused, true);
    assert.equal(paused.activeVoices, 0);
    await page.click("#replayBtn");
    await page.waitForTimeout(220);
    assert.equal(await page.evaluate(() => window.__grain16.engine.playing), true);
    await page.click("#stopBtn");
    await page.waitForTimeout(260);
    const stopped = await page.evaluate(() => {
      const metrics = window.__grain16.engine.readMetrics();
      return { peak: metrics.peak, voices: metrics.activeVoices, state: window.__grain16.engine.getTransportState() };
    });
    assert.equal(stopped.peak, -Infinity);
    assert.equal(stopped.voices, 0);
    assert.equal(stopped.state.playing, false);
    console.log("✓ 暂停 / 重播 / 停止 · 停止 260 ms 后无残留尾音");

    await setRange(page, "#tuneInput", 84);
    await setRange(page, "#velocityInput", 45);
    await setRange(page, "#probabilityInput", 25);
    await page.click("#resetBtn");
    const resetPatch = await page.evaluate(() => window.__grain16.getPatch());
    assert.equal(resetPatch.bpm, 112);
    assert.equal(resetPatch.tracks.kick.tune, 52);
    assert.equal(resetPatch.tracks.kick.steps[0].velocity, 122);
    assert.equal(resetPatch.tracks.kick.steps[0].probability, 100);
    console.log("✓ 参数重置恢复速度、音高、力度与概率");

    await page.fill("#patchName", "VERIFY LOOP");
    await page.click("#saveBtn");
    const downloadOne = page.waitForEvent("download");
    await page.click("#exportBtn");
    const first = await downloadOne;
    const fileA = path.join("/tmp", "grain16-verify-a.wav");
    await first.saveAs(fileA);
    downloads.push(fileA);
    await page.waitForTimeout(1650);
    assert.match(await page.locator("#preflight").innerText(), /PASS/);

    await page.click("#patchMenuBtn");
    await page.click("#loadBtn");
    await page.waitForTimeout(220);
    assert.equal(await page.inputValue("#patchName"), "VERIFY LOOP");
    const downloadTwo = page.waitForEvent("download");
    await page.click("#exportBtn");
    const second = await downloadTwo;
    const fileB = path.join("/tmp", "grain16-verify-b.wav");
    await second.saveAs(fileB);
    downloads.push(fileB);
    await page.waitForTimeout(1650);
    assert.match(await page.locator("#exportSignature").innerText(), /RELOAD MATCH/);

    const wavA = parseWav(fileA);
    const wavB = parseWav(fileB);
    assert.equal(wavA.channels, 2);
    assert.equal(wavA.sampleRate, 48000);
    assert.equal(wavA.bits, 16);
    assert.equal(wavA.frames, wavB.frames);
    assert.ok(Math.abs(wavA.duration - wavB.duration) < 0.000001);
    assert.ok(Math.abs(wavA.peak - wavB.peak) < 0.000001);
    assert.ok(wavA.peaks.every((peak) => peak > 0.001));
    console.log(
      `✓ 保存 / 重载 / 二次 WAV · ${wavA.duration.toFixed(3)} s · peak ${(20 * Math.log10(wavA.peak)).toFixed(2)} dBFS · 双声道`,
    );

    await page.click("#auditBtn");
    await page.waitForFunction(
      () => document.querySelector("#auditBadge")?.textContent.includes("PASS"),
      null,
      { timeout: 25000 },
    );
    const auditRows = await page.locator(".audit-row.is-pass").count();
    assert.equal(auditRows, 5);
    const auditText = await page.locator("#auditResults").innerText();
    assert.match(auditText, /实际击打间距/);
    assert.match(auditText, /L 偏置/);
    assert.match(auditText, /波形基频/);
    assert.match(auditText, /RELOAD \/ 重载一致性/);
    assert.match(auditText, /L\/R 完整/);
    console.log("✓ 声学审计 5/5 · 节拍、左右声道、基频、重载与预检均来自离线采样");

    const guards = await page.evaluate(() => {
      const makeBuffer = (kind) => {
        const buffer = new AudioBuffer({ length: 9600, numberOfChannels: 2, sampleRate: 48000 });
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        for (let index = 0; index < buffer.length; index += 1) {
          if (kind === "silent") {
            left[index] = 0;
            right[index] = 0;
          } else if (kind === "missing") {
            left[index] = Math.sin((index / 48000) * Math.PI * 2 * 80) * 0.4;
            right[index] = 0;
          } else {
            left[index] = Math.sin((index / 48000) * Math.PI * 2 * 80) * 1.2;
            right[index] = Math.cos((index / 48000) * Math.PI * 2 * 80) * 1.2;
          }
        }
        return buffer;
      };
      return {
        silent: window.__grain16.preflight(makeBuffer("silent")),
        missing: window.__grain16.preflight(makeBuffer("missing")),
        clipping: window.__grain16.preflight(makeBuffer("clipping")),
      };
    });
    assert.equal(guards.silent.silence.pass, false);
    assert.equal(guards.missing.channels.pass, false);
    assert.equal(guards.clipping.clipping.pass, false);
    console.log("✓ 导出前拦截器覆盖静音、削波和声道缺失");

    assert.deepEqual(errors, []);
    console.log("\nGRAIN/16 验证全部通过");
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    for (const file of downloads) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
}

run().catch((error) => {
  console.error("\n验证失败:", error);
  process.exitCode = 1;
});
