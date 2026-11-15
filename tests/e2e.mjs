import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}/`;
const LEGACY = `WEBVTT

1
00:00:00.400 --> 00:00:02.800
旧字幕 01
保留导入顺序

2
00:00:03.400 --> 00:00:05.800
旧字幕 02
风从旧胶片里吹来

3
00:00:06.300 --> 00:00:08.900
旧字幕 03
节拍仍然准确
`;

function vttTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 3600)).padStart(2, "0")}:${String(
    Math.floor((totalSeconds % 3600) / 60),
  ).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}.${String(
    milliseconds % 1000,
  ).padStart(3, "0")}`;
}

function screenshotDifference(firstPath, secondPath) {
  const first = PNG.sync.read(readFileSync(firstPath));
  const second = PNG.sync.read(readFileSync(secondPath));
  assert.equal(first.width, second.width);
  assert.equal(first.height, second.height);
  let changed = 0;
  let maximum = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(first.data[i + channel] - second.data[i + channel]);
      if (difference) changed += 1;
      maximum = Math.max(maximum, difference);
    }
  }
  return { changed, maximum };
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function loadPage(page) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

function findChromiumExecutable() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(userInfo().homedir, ".cache", "ms-playwright"),
  ].filter(Boolean);
  for (const rootPath of roots) {
    if (!existsSync(rootPath)) continue;
    const revisions = readdirSync(rootPath)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const revision of revisions) {
      const executable = join(rootPath, revision, "chrome-linux64", "chrome");
      if (existsSync(executable)) return executable;
    }
  }
  return undefined;
}

async function main() {
  const server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(base);

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: findChromiumExecutable(),
      args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });

    await loadPage(page);
    let state = await page.evaluate(() => window.cutline.getState());
    assert.equal(state.cueCount, 6);
    assert.equal(state.duration, 20);
    assert.equal(state.keyframes.flatMap((item) => item.values).length, 6);
    assert.equal(state.transitions.length, 1);
    assert.equal(state.audioStart, 0.25);
    console.log("PASS initial complete example");

    const pauseFrame = await page.evaluate(() => window.cutline.snapshotAt(7.25));
    await page.locator(".stage-frame").screenshot({ path: `${root}/artifacts/pause-frame.png` });
    const replay = await page.evaluate(() => window.cutline.playUntil(7.25));
    await page.locator(".stage-frame").screenshot({ path: `${root}/artifacts/replay-frame.png` });
    assert.equal(pauseFrame.hash, replay.frame.hash);
    assert.equal(pauseFrame.cue.id, replay.frame.cue.id);
    assert.equal(pauseFrame.cue.text, replay.frame.cue.text);
    assert.equal(pauseFrame.event.index, replay.frame.event.index);
    assert.equal(pauseFrame.time, 7.25);
    assert.deepEqual(
      screenshotDifference(
        `${root}/artifacts/pause-frame.png`,
        `${root}/artifacts/replay-frame.png`,
      ),
      { changed: 0, maximum: 0 },
    );
    console.log(`PASS pause/replay frame pixel match at 7.25s (beat ${pauseFrame.event.index + 1})`);
    const builtInVerification = await page.evaluate(() => window.cutline.runVerification());
    assert.equal(builtInVerification.ok, true);
    console.log("PASS built-in verification panel");

    await page.locator("#importSubtitlesInput").setInputFiles({
      name: "legacy.vtt",
      mimeType: "text/vtt",
      buffer: Buffer.from(LEGACY),
    });
    await page.waitForTimeout(120);
    let project = await page.evaluate(() => window.cutline.getProject());
    assert.deepEqual(
      project.subtitles.map((cue) => [cue.start, cue.end, cue.text]),
      [
        [0.4, 2.8, "旧字幕 01\n保留导入顺序"],
        [3.4, 5.8, "旧字幕 02\n风从旧胶片里吹来"],
        [6.3, 8.9, "旧字幕 03\n节拍仍然准确"],
      ],
    );
    assert.equal(await page.locator(".cue-block").count(), 3);
    console.log("PASS legacy subtitle import preserves source order");

    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    await page.evaluate(() => window.cutline.seek(12.9));
    await page.click("#addCueBtn");
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.cutline.getState());
    assert.equal(state.cueCount, 7);
    project = await page.evaluate(() => window.cutline.getProject());
    const added = project.subtitles.at(-1);
    assert.ok(Math.abs(added.start - 12.9) < 0.01);
    assert.ok(Math.abs(added.end - 13.6) < 0.01);

    await page.evaluate(() => window.cutline.seek(13.2));
    await page.click("#splitCueBtn");
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.cutline.getState());
    assert.equal(state.cueCount, 8);
    await page.fill("#cueText", "分割后的字幕\n第二行文本");
    await page.waitForTimeout(80);
    project = await page.evaluate(() => window.cutline.getProject());
    assert.equal(project.subtitles.at(-1).text, "分割后的字幕\n第二行文本");
    console.log("PASS add, split and multi-line text editing");

    const block = page.locator('.cue-block[data-cue-id="cue-1"]');
    const bounds = await block.boundingBox();
    const beforeDrag = project.subtitles[0];
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 24, bounds.y + bounds.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    await page.waitForTimeout(80);
    const afterDrag = (await page.evaluate(() => window.cutline.getProject())).subtitles[0];
    assert.ok(afterDrag.start > beforeDrag.start + 0.2);
    assert.ok(
      Math.abs(
        afterDrag.end - afterDrag.start - (beforeDrag.end - beforeDrag.start),
      ) < 0.01,
    );
    console.log("PASS subtitle block drag");

    await page.fill("#bpmInput", "90");
    await page.press("#bpmInput", "Tab");
    await page.fill("#audioStartInput", "0.37");
    await page.press("#audioStartInput", "Tab");
    await page.waitForTimeout(100);
    await page.click("#saveProjectBtn");
    await page.waitForTimeout(100);
    const saved = await page.evaluate(() => ({
      raw: localStorage.getItem("cutline.project.v1"),
      state: window.cutline.getState(),
    }));
    assert.ok(saved.raw);
    assert.equal(saved.state.validation.ok, true);
    assert.equal(saved.state.audioStart, 0.37);
    assert.equal(saved.state.cueCount, 8);
    const savedProject = JSON.parse(saved.raw);
    console.log("PASS valid project save");

    await page.evaluate(() => window.cutline.seek(5));
    await page.fill("#cueStart", "1.00");
    await page.press("#cueStart", "Tab");
    await page.waitForTimeout(80);
    assert.equal((await page.evaluate(() => window.cutline.getState())).validation.ok, false);
    await page.click("#saveProjectBtn");
    await page.waitForTimeout(80);
    const blocked = await page.evaluate(() => ({
      raw: localStorage.getItem("cutline.project.v1"),
      state: window.cutline.getState(),
      toast: document.querySelector("#toast").textContent,
    }));
    assert.ok(blocked.toast.includes("保存已阻止"));
    assert.equal(JSON.parse(blocked.raw).subtitles.find((cue) => cue.id === "cue-2").start, 3.8);
    assert.equal(blocked.state.validation.ok, false);
    console.log("PASS overlap blocks save and preserves the stored project");

    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    state = await page.evaluate(() => window.cutline.getState());
    project = await page.evaluate(() => window.cutline.getProject());
    assert.equal(state.cueCount, 8);
    assert.equal(state.audioStart, 0.37);
    assert.equal(state.keyframes.flatMap((item) => item.values).length, 6);
    assert.equal(state.transitions.length, 1);
    assert.equal(state.validation.ok, true);
    assert.equal(project.audio.bpm, 90);
    assert.equal(project.subtitles.find((cue) => cue.id === "cue-2").start, 3.8);
    assert.deepEqual(
      project.scenes.map((scene) => scene.keyframes),
      savedProject.scenes.map((scene) => scene.keyframes),
    );
    assert.deepEqual(project.transitions, savedProject.transitions);
    assert.deepEqual(
      project.subtitles.map((cue) => cue.id),
      savedProject.subtitles.map((cue) => cue.id),
    );
    console.log("PASS reload restores timeline, subtitles, transition, keyframes and audio start");

    const exportResult = await page.evaluate(() => window.cutline.exportVtt({ download: false }));
    assert.equal(exportResult.ok, true);
    assert.ok(exportResult.vtt.startsWith("WEBVTT"));
    const durationLine = exportResult.vtt.match(/^duration=(\d\d:\d\d:\d\d\.\d\d\d)$/m);
    assert.ok(durationLine);
    const durationParts = durationLine[1].split(":").map(Number);
    assert.equal(durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2], 20);
    const exportedTimes = [
      ...exportResult.vtt.matchAll(
        /(\d\d:\d\d:\d\d\.\d\d\d) --> (\d\d:\d\d:\d\d\.\d\d\d)/g,
      ),
    ].map((match) => [match[1], match[2]]);
    assert.deepEqual(
      exportedTimes,
      project.subtitles.map((cue) => [vttTime(cue.start), vttTime(cue.end)]),
    );
    const [vttDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#exportBtn"),
    ]);
    assert.ok(vttDownload.suggestedFilename().endsWith(".vtt"));
    const vttPath = `${root}/tests/exported.vtt`;
    await vttDownload.saveAs(vttPath);
    assert.ok(readFileSync(vttPath, "utf8").includes(`${exportedTimes[0][0]} --> ${exportedTimes[0][1]}`));
    unlinkSync(vttPath);
    console.log("PASS WebVTT export keeps every in/out point and total duration");

    const [projectDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#downloadProjectBtn"),
    ]);
    assert.ok(projectDownload.suggestedFilename().endsWith(".json"));
    const projectPath = `${root}/tests/downloaded-project.json`;
    await projectDownload.saveAs(projectPath);
    await page.locator("#importSubtitlesInput").setInputFiles({
      name: "legacy.vtt",
      mimeType: "text/vtt",
      buffer: Buffer.from(LEGACY),
    });
    await page.waitForTimeout(80);
    assert.equal((await page.evaluate(() => window.cutline.getState())).cueCount, 3);
    await page.locator("#openProjectInput").setInputFiles(projectPath);
    await page.waitForTimeout(150);
    const opened = await page.evaluate(() => window.cutline.getState());
    assert.equal(opened.cueCount, 8);
    assert.equal(opened.audioStart, 0.37);
    assert.equal(opened.keyframes.flatMap((item) => item.values).length, 6);
    assert.equal(opened.transitions.length, 1);
    unlinkSync(projectPath);
    console.log("PASS project JSON download and open restore");

    const keyframesBefore = JSON.stringify(opened.keyframes);
    await page.evaluate(() => window.cutline.pause());
    await page.click("#playBtn");
    await page.waitForTimeout(350);
    const playingBefore = await page.evaluate(() => window.cutline.getState());
    assert.equal(playingBefore.playing, true);
    assert.equal(playingBefore.frame.scene, "scene-dawn");
    await page.click('.scene-tab[data-scene-id="scene-night"]');
    await page.waitForTimeout(300);
    const switched = await page.evaluate(() => window.cutline.getState());
    assert.equal(switched.playing, true);
    assert.equal(switched.frame.scene, "scene-night");
    assert.ok(switched.audioSession > playingBefore.audioSession);
    assert.ok(
      switched.audioNodeSessions.every((session) => session === switched.audioSession),
    );
    await page.evaluate(() => window.cutline.pause());
    await page.waitForTimeout(40);
    const pausedAfterSwitch = await page.evaluate(() => window.cutline.getState());
    assert.equal(pausedAfterSwitch.audioNodes, 0);
    assert.equal(JSON.stringify(pausedAfterSwitch.keyframes), keyframesBefore);
    console.log("PASS scene switch replaces audio session and preserves keyframes");

    await page.evaluate(() => {
      window.cutline.setLoop(true);
      window.cutline.seek(19.75);
    });
    await page.click("#playBtn");
    await page.waitForTimeout(700);
    const loopState = await page.evaluate(() => window.cutline.getState());
    assert.equal(loopState.loop, true);
    assert.equal(loopState.playing, true);
    assert.ok(loopState.position < 1.2);
    assert.ok(
      loopState.audioNodeSessions.every((session) => session === loopState.audioSession),
    );
    await page.evaluate(() => {
      window.cutline.pause();
      window.cutline.setLoop(false);
    });
    console.log("PASS loop wraps the shared clock and reschedules audio");

    const failure = await page.evaluate(async () => {
      const before = {
        fingerprint: window.cutline.getState().projectFingerprint,
        storage: localStorage.getItem("cutline.project.v1"),
        project: window.cutline.serializeProject(),
      };
      const originalCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = () => {
        throw new Error("forced export failure");
      };
      let result;
      try {
        result = await window.cutline.exportVtt({ download: true });
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
      }
      return {
        result,
        before,
        after: {
          fingerprint: window.cutline.getState().projectFingerprint,
          storage: localStorage.getItem("cutline.project.v1"),
          project: window.cutline.serializeProject(),
        },
      };
    });
    assert.equal(failure.result.ok, false);
    assert.equal(failure.result.unchanged, true);
    assert.deepEqual(failure.after, failure.before);
    console.log("PASS forced export failure preserves project and saved copy");

    assert.deepEqual(errors, []);
    console.log("ALL END-TO-END CHECKS PASSED");
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error("E2E FAILED");
  console.error(error);
  process.exitCode = 1;
});
