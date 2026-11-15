import { writeFile } from "node:fs/promises";

const endpoint = process.env.CDP_URL || "http://127.0.0.1:9223";
const pages = await (await fetch(`${endpoint}/json/list`)).json();
const page = pages.find((entry) => entry.type === "page");
if (!page) throw new Error("No debuggable page found");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message));
    else resolve(payload.result);
    return;
  }
  if (payload.method === "Runtime.exceptionThrown") {
    errors.push(payload.params.exceptionDetails.text);
  }
  if (payload.method === "Log.entryAdded" && payload.params.entry.level === "error") {
    const detail = payload.params.entry;
    errors.push(detail.url ? `${detail.text} (${detail.url})` : detail.text);
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) throw new Error(`Check failed: ${name} ${detail}`);
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await wait(500);
await evaluate(`localStorage.removeItem('tideway-state-summary-v1'); localStorage.removeItem('tideway-layout-fingerprint-v1'); true`);
await send("Page.reload", { ignoreCache: true });
await wait(900);

const initial = await evaluate(`(() => {
  const s = window.__tideway.state;
  return {
    status: s.status,
    seed: s.seed,
    fingerprint: s.world.fingerprint,
    islands: s.world.islands.map(i => ({ id: i.id, x: i.x, y: i.y, dock: i.dock })),
    shoals: s.world.shoals.length,
    logs: s.world.driftwood.length,
    hasCanvas: Boolean(document.querySelector('#gameCanvas')),
    bodyStatus: document.body.dataset.gameStatus,
  };
})()`);
check("initial state is ready", initial.status === "ready", initial.status);
check("fixed seed is visible in state", initial.seed === 20261116);
check("map has two islands", initial.islands.length === 2);
check("map has generated obstacles", initial.shoals >= 4 && initial.logs === 9);
check("canvas is mounted", initial.hasCanvas);

await evaluate(`document.querySelector('#loadAllBtn').click()`);
await wait(250);
const loaded = await evaluate(`(() => {
  const s = window.__tideway.state;
  return {
    cargo: s.cargo,
    port: s.resources,
    cargoText: document.querySelector('#cargoReadout').textContent,
    toast: document.querySelector('#toast').textContent,
  };
})()`);
check("load-all fills the segregated holds", loaded.cargo.fuel === 2 && loaded.cargo.battery === 2);
check("port inventory is deducted", loaded.port.fuel === 0 && loaded.port.battery === 0);
check("loading has visible HUD feedback", loaded.cargoText.includes("4 / 4"), loaded.cargoText);
check("loading has visible toast feedback", loaded.toast.includes("装"), loaded.toast);

await evaluate(`document.querySelector('#castOffBtn').click()`);
await wait(250);
check("departure starts sailing", (await evaluate("window.__tideway.state.status")) === "sailing");
check("departure creates a checkpoint", await evaluate("Boolean(window.__tideway.state.checkpoint)"));

await send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
});
await wait(450);
const moving = await evaluate("window.__tideway.state.ship.speed");
await send("Input.dispatchKeyEvent", {
  type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
});
check("keyboard throttle visibly moves the ship", moving > 1, String(moving));

await send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80,
});
await wait(250);
const paused = await evaluate(`({
  status: window.__tideway.state.status,
  overlayVisible: !document.querySelector('#overlay').classList.contains('is-hidden')
})`);
check("pause freezes and displays an overlay", paused.status === "paused" && paused.overlayVisible);
await evaluate(`[...document.querySelectorAll('.overlay-actions button')].find(b => b.textContent.includes('继续航行')).click()`);
await wait(200);
check("resume returns to sailing", (await evaluate("window.__tideway.state.status")) === "sailing");

await evaluate(`document.querySelector('#failureBtn').click()`);
await wait(300);
const failed = await evaluate(`(() => {
  const s = window.__tideway.state;
  const saved = JSON.parse(localStorage.getItem('tideway-state-summary-v1'));
  return {
    status: s.status,
    reason: s.failure?.reason,
    overlay: !document.querySelector('#overlay').classList.contains('is-hidden'),
    savedStatus: saved?.status,
    savedReason: saved?.failure?.reason,
  };
})()`);
check("failure drill stops the voyage", failed.status === "failed" && failed.reason === "drill");
check("failure overlay explains the cause", failed.overlay);
check("failure summary is saved", failed.savedStatus === "failed" && failed.savedReason === "drill");

await evaluate(`[...document.querySelectorAll('.overlay-actions button')].find(b => b.textContent.includes('从检查点恢复')).click()`);
await wait(260);
const recovered = await evaluate(`(() => {
  const s = window.__tideway.state;
  return {
    status: s.status,
    recoveries: s.recoveries,
    cargo: s.cargo,
    overlayHidden: document.querySelector('#overlay').classList.contains('is-hidden'),
  };
})()`);
check("checkpoint recovery resumes without reload", recovered.status === "sailing" && recovered.overlayHidden);
check("recovery increments audit counter", recovered.recoveries === 1, String(recovered.recoveries));
check("recovery restores full deck cargo", recovered.cargo.fuel === 2 && recovered.cargo.battery === 2);

await evaluate(`(() => {
  const s = window.__tideway.state;
  const log = s.world.driftwood[0];
  s.ship.x = log.x; s.ship.y = log.y; s.ship.speed = 0;
})()`);
await wait(350);
const collision = await evaluate(`(() => {
  const s = window.__tideway.state;
  return {
    status: s.status,
    reason: s.failure?.reason,
    title: s.failure?.title,
    overlay: !document.querySelector('#overlay').classList.contains('is-hidden'),
  };
})()`);
check("real driftwood collision stops the voyage", collision.status === "failed" && collision.reason === "driftwood", collision.title);
check("collision failure exposes checkpoint recovery", collision.overlay);
await evaluate(`[...document.querySelectorAll('.overlay-actions button')].find(b => b.textContent.includes('从检查点恢复')).click()`);
await wait(260);
const collisionRecovery = await evaluate(`({
  status: window.__tideway.state.status,
  recoveries: window.__tideway.state.recoveries,
  history: window.__tideway.state.failureHistory.map(item => item.reason)
})`);
check("collision recovery resumes from checkpoint", collisionRecovery.status === "sailing" && collisionRecovery.recoveries === 2);
check("failure history records drill and collision", collisionRecovery.history.includes("drill") && collisionRecovery.history.includes("driftwood"));

await evaluate(`(() => {
  const s = window.__tideway.state;
  const island = s.world.islands.find(i => i.id === s.nextStop);
  s.ship.x = island.dock.x; s.ship.y = island.dock.y; s.ship.speed = 0;
  document.querySelector('#castOffBtn').click();
})()`);
await wait(250);
const firstDelivery = await evaluate(`(() => {
  const s = window.__tideway.state;
  return { delivered: s.delivered, cargo: s.cargo, next: s.nextStop };
})()`);
check("first lighthouse delivery consumes one fuel and one battery", firstDelivery.cargo.fuel === 1 && firstDelivery.cargo.battery === 1);
check("first objective is recorded", Object.values(firstDelivery.delivered).filter(Boolean).length === 1);

await evaluate(`(() => {
  const s = window.__tideway.state;
  const island = s.world.islands.find(i => i.id === s.nextStop);
  s.ship.x = island.dock.x; s.ship.y = island.dock.y; s.ship.speed = 0;
  document.querySelector('#castOffBtn').click();
})()`);
await wait(250);
await evaluate(`(() => {
  const s = window.__tideway.state;
  s.ship.x = s.world.home.dock.x; s.ship.y = s.world.home.dock.y; s.ship.speed = 0;
  document.querySelector('#castOffBtn').click();
})()`);
await wait(650);
const won = await evaluate(`(() => {
  const s = window.__tideway.state;
  const saved = JSON.parse(localStorage.getItem('tideway-state-summary-v1'));
  return {
    status: s.status,
    overlay: !document.querySelector('#overlay').classList.contains('is-hidden'),
    title: document.querySelector('#overlayTitle').textContent,
    summary: saved,
    hasSvgRoute: Boolean(document.querySelector('#overlay .mini-route')),
    summaryText: document.querySelector('#overlayBody').textContent,
  };
})()`);
check("both deliveries and home return win the game", won.status === "won");
check("success overlay is shown", won.overlay && won.title.includes("补给完成"), won.title);
check("success overlay shows a route", won.hasSvgRoute);
check("summary stores both objectives", won.summary.objective.completedTargets === 2);
check("summary stores zero remaining resources", won.summary.resources.remaining.fuel === 0 && won.summary.resources.remaining.battery === 0);
check("summary records final time", won.summary.timing.elapsedSeconds >= 0);
check("summary records the prior failure reason", won.summary.failureHistory.some(item => item.reason === "drill"));
check("all summary validations pass", Object.values(won.summary.validation).every(Boolean));
const overlayLayout = await evaluate(`(() => {
  const card = document.querySelector('#overlayCard').getBoundingClientRect();
  const actions = document.querySelector('#overlayActions').getBoundingClientRect();
  const stage = document.querySelector('.stage-card').getBoundingClientRect();
  return {
    card: { left: card.left, top: card.top, bottom: card.bottom, height: card.height, width: card.width },
    actions: { top: actions.top, bottom: actions.bottom, height: actions.height },
    stage: { top: stage.top, bottom: stage.bottom, height: stage.height },
    viewport: { width: innerWidth, height: innerHeight },
  };
})()`);
check(
  "settlement actions remain inside the visible stage",
  overlayLayout.actions.bottom <= overlayLayout.viewport.height + 1
    && overlayLayout.actions.top >= 0
    && overlayLayout.card.bottom <= overlayLayout.viewport.height + 1,
  JSON.stringify(overlayLayout),
);

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await writeFile("/tmp/tideway-win.png", Buffer.from(shot.data, "base64"));
const cardShot = await send("Page.captureScreenshot", {
  format: "png",
  clip: {
    x: overlayLayout.card.left,
    y: overlayLayout.card.top,
    width: overlayLayout.card.width,
    height: overlayLayout.card.height,
    scale: 2,
  },
});
await writeFile("/tmp/tideway-card.png", Buffer.from(cardShot.data, "base64"));

await evaluate(`[...document.querySelectorAll('.overlay-actions button')].find(b => b.textContent.includes('重开同种子新局')).click()`);
await wait(300);
const restarted = await evaluate(`(() => {
  const s = window.__tideway.state;
  return {
    status: s.status,
    matched: s.layoutAudit.matched,
    fingerprint: s.world.fingerprint,
    auditText: document.querySelector('#layoutAudit').textContent,
    seed: s.seed,
  };
})()`);
check("restart creates a fresh ready state", restarted.status === "ready");
check("new game matches the previous layout", restarted.matched === true && restarted.fingerprint === initial.fingerprint);
check("layout audit is visible to the player", restarted.auditText.includes("布局一致"), restarted.auditText);

const externalCheck = await evaluate("window.__tideway.verifyLayout()");
check("two independent generations match", externalCheck.matched === true);
check("browser emitted no runtime errors", errors.length === 0, errors.join(" | "));

console.log(JSON.stringify({ checks, errors, fingerprint: initial.fingerprint }, null, 2));
socket.close();
