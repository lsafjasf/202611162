// Browser-level tests: real canvas rendering, screenshot hashes, pause/resume,
// preset save/reload consistency. Run: node tests/browser.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer';
import { createServer } from '../scripts/serve.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok - ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { server, port } = await createServer();
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__app !== undefined');
  const app = (expr) => page.evaluate(expr);
  const canvasShot = async () => {
    const el = await page.$('#canvas');
    return sha256(await el.screenshot());
  };
  const snapshot = () => app(`(() => { const s = window.__app.getScene();
    return { hash: window.__app.sceneHash(), draw: s.stats.drawCount,
      atoms: s.stats.atomCount, canvas: window.__app.canvasHash() }; })()`);

  await app('window.__app.setParams({ animSpeed: 0 })');
  await app('window.__app.pause()');
  await sleep(150);

  // 默认设置：重算前后 对象数/几何/截图 一致
  const defBefore = await snapshot();
  const shotBefore = await canvasShot();
  await app('window.__app.setParams({})');
  await sleep(150);
  const defAfter = await snapshot();
  const shotAfter = await canvasShot();
  assert.deepEqual(defAfter, defBefore, 'recompute changed scene state');
  assert.equal(shotAfter, shotBefore, 'recompute changed screenshot');
  ok('default: recompute keeps object count, geometry, screenshot hash');

  // 极值设置：急弯抗塌缩 + 安全区警告
  await app(`window.__app.setParams({
    text: '急弯Test测试ABC混排word', radius: 60, arcAngle: 300,
    fontSize: 40, letterSpacing: 2, baselineOffset: 10, minGapRatio: 0.15 })`);
  await sleep(150);
  const extreme = await app(`(() => { const s = window.__app.getScene();
    return { ok: s.ok, fixes: s.stats.collapseFixes }; })()`);
  assert.equal(extreme.ok, true);
  assert.ok(extreme.fixes > 0, 'sharp bend must trigger anti-collapse');
  ok(`extreme: anti-collapse widened ${extreme.fixes} gaps on sharp bend`);

  await app(`window.__app.setParams({ radius: 200, arcAngle: 220,
    fontSize: 120, safeMargin: 160 })`);
  await sleep(150);
  const safeWarn = await app(`(() => {
    const s = window.__app.getScene();
    return { warn: s.warnings.some((w) => w.includes('超出安全区域')),
      out: s.stats.outOfSafeArea,
      bannerShown: !document.getElementById('warnings').hidden }; })()`);
  assert.equal(safeWarn.warn, true);
  assert.ok(safeWarn.out > 0);
  assert.equal(safeWarn.bannerShown, true, 'warning banner must be visible');
  ok('extreme: out-of-safe-area warning shown');

  // 异常设置：明确错误提示且画面不空白
  const goodHash = await app('window.__app.canvasHash()');
  await app(`window.__app.setParams({ radius: 30, baselineOffset: -60,
    fontSize: 48 })`);
  await sleep(150);
  const abnormal = await app(`(() => ({
    errors: window.__app.getErrors(),
    errBoxShown: !document.getElementById('errors').hidden,
    canvas: window.__app.canvasHash() }))()`);
  assert.ok(abnormal.errors.length > 0, 'must report explicit errors');
  assert.ok(
    abnormal.errors.some((e) => e.includes('基线半径') || e.includes('圆心')),
    `unexpected errors: ${abnormal.errors}`,
  );
  assert.equal(abnormal.errBoxShown, true, 'error panel must be visible');
  assert.equal(abnormal.canvas, goodHash, 'canvas must keep last good frame');
  ok('abnormal: explicit error message, canvas keeps last good frame');

  // 暂停冻结 / 恢复不跳帧
  await app(`window.__app.setParams({ radius: 420, baselineOffset: 0,
    fontSize: 48, arcAngle: 120, safeMargin: 48, animSpeed: 40 })`);
  await app('window.__app.pause()');
  await sleep(100);
  const frozen1 = await app('window.__app.canvasHash()');
  await sleep(300);
  const frozen2 = await app('window.__app.canvasHash()');
  assert.equal(frozen2, frozen1, 'paused canvas must be frozen');
  const t1 = await app('window.__app.clockTime()');
  await app('window.__app.resume()');
  const t2 = await app('window.__app.clockTime()');
  assert.ok(t2 - t1 < 250, `resume jumped ${t2 - t1}ms`);
  await sleep(200);
  const t3 = await app('window.__app.clockTime()');
  assert.ok(t3 > t2, 'clock must advance after resume');
  await app('window.__app.pause()');
  await app('window.__app.setParams({ animSpeed: 0 })');
  ok('pause freezes canvas; resume continues without frame jump');

  // 缩放/旋转后标注不漂移（世界坐标不变，仅视图变换变化）
  await sleep(150);
  const annBefore = await app(`JSON.stringify(
    window.__app.getScene().annotations)`);
  await app('window.__app.setParams({ zoom: 2.2, rotation: 35 })');
  await sleep(150);
  const annAfter = await app(`JSON.stringify(
    window.__app.getScene().annotations)`);
  assert.equal(annAfter, annBefore, 'annotations must not drift in world space');
  const viewA = await app('window.__app.canvasHash()');
  await app('window.__app.setParams({ zoom: 1, rotation: 0 })');
  await sleep(150);
  const viewB = await app('window.__app.canvasHash()');
  assert.notEqual(viewA, viewB, 'view transform must affect rendering');
  ok('zoom/rotate: annotations stable in world space, view transform applied');

  // 遮挡/透明顺序稳定
  const layerSeq = await app(`JSON.stringify(
    window.__app.getScene().drawList.map((i) => [i.layer, i.z, i.alpha]))`);
  await app('window.__app.setParams({ letterSpacing: 20 })');
  await sleep(150);
  const layerSeq2 = await app(`JSON.stringify(
    window.__app.getScene().drawList.map((i) => [i.layer, i.z, i.alpha]))`);
  assert.equal(layerSeq2, layerSeq, 'layer order/alpha must be stable');
  await app('window.__app.setParams({ letterSpacing: 4 })');
  ok('occlusion/transparency order stable across recompute');

  // 保存参数 → 重新载入页面 → 截图哈希与结构摘要一致
  await app(`window.__app.setParams({ text: '存档Test往返123',
    fontSize: 64, letterSpacing: 9, baselineOffset: -15, radius: 300,
    arcAngle: 150, align: 'end', animSpeed: 0, zoom: 1, rotation: 0 })`);
  await sleep(150);
  const savedSummary = await app('window.__app.summarize()');
  const savedShot = await canvasShot();
  const savedSvg = await app('window.__app.exportSVG()');
  await app(`window.__app.savePreset('回归方案')`);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__app !== undefined');
  await app('window.__app.pause()');
  const loadErrors = await app(`window.__app.loadPreset('回归方案')`);
  assert.deepEqual(loadErrors, []);
  await sleep(200);
  const reloadedSummary = await app('window.__app.summarize()');
  const reloadedShot = await canvasShot();
  const reloadedSvg = await app('window.__app.exportSVG()');
  assert.equal(reloadedSummary, savedSummary, 'structural summary must match');
  assert.equal(reloadedShot, savedShot, 'screenshot hash must match');
  assert.equal(sha256(reloadedSvg), sha256(savedSvg), 'SVG export must match');
  ok('preset save/reload: summary, screenshot hash, SVG all identical');

  // SVG 导出保留文字路径
  assert.ok(savedSvg.includes('<path id="textCurve"'), 'curve path kept');
  assert.ok(savedSvg.includes('<textPath href="#textCurve"'), 'textPath kept');
  assert.ok(savedSvg.includes('存档Test往返123'), 'original text kept');
  ok('SVG export preserves text path');

  // 撤销/重做真正改变场景（不只检查按钮响应）
  const beforeUndo = await app('window.__app.getParams().fontSize');
  await app('window.__app.setParams({ fontSize: 80 })');
  await sleep(400);
  await page.evaluate(() => {
    document.getElementById('in-fontSize').value = '90';
    document.getElementById('in-fontSize')
      .dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  await app('window.__app.undo()');
  await sleep(150);
  const afterUndo = await app('window.__app.getParams().fontSize');
  assert.notEqual(afterUndo, 90, 'undo must revert the change');
  await app('window.__app.redo()');
  await sleep(150);
  const afterRedo = await app('window.__app.getParams().fontSize');
  assert.equal(afterRedo, 90, 'redo must reapply the change');
  assert.notEqual(beforeUndo, afterRedo);
  ok('undo/redo revert and reapply parameter changes');

  console.log(`\nAll ${passed} browser tests passed.`);
} finally {
  await browser.close();
  server.close();
}
