import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The static server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("static server did not start");
}

async function completeFast(page) {
  await page.evaluate(() => {
    for (let index = 0; index < 8; index += 1) {
      window.__PACKFLOW__.engine.tick(5000);
    }
  });
  await page.waitForTimeout(550);
}

const port = await freePort();
const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: process.cwd(),
  stdio: "ignore"
});
const browser = await chromium.launch({ headless: true });
let page;

try {
  await waitForServer(`http://127.0.0.1:${port}/`);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  assert.equal(await page.title(), "PACK/FLOW · 智能装箱产线");

  await page.locator('[data-scenario="normal"]').click();
  await completeFast(page);
  let state = await page.evaluate(() => ({
    status: window.__PACKFLOW__.engine.status,
    good: window.__PACKFLOW__.engine.runtime.good,
    report: document.querySelector("#report-dialog").open,
    validation: window.__PACKFLOW__.getValidationStates().normal.status
  }));
  assert.deepEqual(state, {
    status: "complete",
    good: 8,
    report: true,
    validation: "pass"
  });

  await page.locator('[data-close="report-dialog"]').last().click();
  await page.click("#snapshot-button");
  const frozen = await page.evaluate(() => {
    const result = window.__PACKFLOW__.engine.completedBatches[0];
    return Object.isFrozen(result) && Object.isFrozen(result.orders[0]);
  });
  assert.equal(frozen, true);

  await page.locator(".order-card").nth(1).click();
  await page.locator('.box-option[data-value="M"]').click();
  await page.click("#start-button");
  await completeFast(page);
  await page.locator('[data-close="report-dialog"]').last().click();
  assert.equal(await page.locator("#compare-button").isEnabled(), true);
  await page.click("#compare-button");
  assert.equal(await page.locator("#compare-dialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator(".compare-column").count(), 2);
  await page.locator('[data-close="compare-dialog"]').last().click();

  await page.click("#reset-button");
  await page.locator('[data-scenario="fault"]').click();
  await page.evaluate(() => {
    for (let index = 0; index < 40; index += 1) {
      if (window.__PACKFLOW__.engine.status !== "running") break;
      window.__PACKFLOW__.engine.tick(100);
    }
  });
  state = await page.evaluate(() => ({
    status: window.__PACKFLOW__.engine.status,
    equipment: window.__PACKFLOW__.engine.getOpenException()?.equipment,
    trigger: window.__PACKFLOW__.engine.getOpenException()?.trigger
  }));
  assert.equal(state.status, "fault");
  assert.equal(state.equipment, "SEAL-02");
  assert.match(state.trigger, /241\.8/);
  await page.click("#recover-button");
  await page.evaluate(() => {
    for (let index = 0; index < 32; index += 1) window.__PACKFLOW__.engine.tick(100);
  });
  state = await page.evaluate(() => window.__PACKFLOW__.engine.runtime.exceptions[0]);
  assert.equal(state.recovery.passed, true);
  assert.deepEqual(state.recovery.residuals, []);

  await page.click("#reset-button");
  await page.locator('[data-scenario="limit"]').click();
  state = await page.evaluate(() => ({
    status: window.__PACKFLOW__.engine.status,
    equipment: window.__PACKFLOW__.engine.getOpenException()?.equipment,
    trigger: window.__PACKFLOW__.engine.getOpenException()?.trigger
  }));
  assert.equal(state.status, "fault");
  assert.equal(state.equipment, "ARM-01");
  assert.equal(state.trigger, "30 mm / 上限 18 mm");
  assert.equal(await page.locator("#recover-button").isDisabled(), true);
  await page.locator("#offset-range").fill("0");
  assert.equal(await page.locator("#recover-button").isDisabled(), false);
  await page.click("#recover-button");
  await page.evaluate(() => {
    for (let index = 0; index < 32; index += 1) window.__PACKFLOW__.engine.tick(100);
  });
  state = await page.evaluate(() => window.__PACKFLOW__.getValidationStates().limit);
  assert.equal(state.status, "pass");
  await page.evaluate(() => {
    for (let index = 0; index < 8; index += 1) window.__PACKFLOW__.engine.tick(5000);
  });
  state = await page.evaluate(() => ({
    status: window.__PACKFLOW__.engine.status,
    good: window.__PACKFLOW__.engine.runtime.good,
    waste: window.__PACKFLOW__.engine.runtime.waste
  }));
  assert.deepEqual(state, { status: "complete", good: 8, waste: 0 });

  assert.deepEqual(errors, []);
  console.log("E2E passed: normal batch, immutable snapshot compare, equipment fault and limit recovery.");
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
