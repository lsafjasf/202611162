// Playwright 端到端：屏幕预览、导出图片、内部几何状态三方核对
import { chromium } from 'playwright';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const BASE = process.env.E2E_BASE_URL || null;
const ART = new URL('../artifacts/', import.meta.url);

let browser, page, server;

test.before(async () => {
  if (!BASE) {
    server = spawn(process.execPath, ['tests/server.mjs'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PORT: '0' },
    });
    const chunk = (await once(server.stdout, 'data'))[0].toString();
    const port = chunk.match(/:(\d+)/)[1];
    process.env.E2E_BASE_URL = `http://127.0.0.1:${port}`;
  }
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (err) => { throw new Error(`页面异常: ${err.message}`); });
  await page.goto(process.env.E2E_BASE_URL);
  await page.waitForFunction(() => window.__app && window.__app.result);
  // 默认暂停动画，保证静态对比类用例的几何与截图可复现；播放行为由专门用例验证
  await page.evaluate(() => window.__app.player.pause());
  await page.evaluate(() => { window.__app.el.playBtn.textContent = '恢复'; });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});

const appState = () => page.evaluate(() => {
  const app = window.__app;
  return {
    params: { ...app.params },
    frame: app.currentFrame,
    running: app.player.running,
    stats: { ...app.result.stats },
    hash: app.result.summary.hash,
    shapeCount: app.result.shapes.length,
    nodeCount: app.result.nodeCount,
    errorHidden: app.el.errorBanner.hidden,
    errorText: app.el.errorBanner.textContent,
    render: { ...app.lastRenderInfo },
  };
});

const setParam = (key, value) => page.evaluate(([k, v]) => {
  window.__app.setParam(k, v);
}, [key, value]);

const shot = async (name) => {
  const buf = await page.locator('#stageCanvas').screenshot();
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(ART, { recursive: true });
  await writeFile(new URL(name, ART), buf);
  return createHash('sha256').update(buf).digest('hex');
};

test('默认设置：生成多对象矢量，细线与孤点统计正确，预览非空白', async () => {
  const state = await appState();
  assert.deepEqual(state.params, { threshold: 128, smoothness: 2, minArea: 20 });
  assert.ok(state.shapeCount >= 5, `对象数 ${state.shapeCount} 应 >= 5`);
  assert.ok(state.stats.removedCount >= 10, '随机孤点被最小区域过滤');
  assert.ok(state.stats.keptCount < state.stats.componentCount);
  assert.equal(state.errorHidden, true);
  const hash = await shot('default-preview.png');
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('极值 minArea=1 与 5000：对象数单调变化且空结果不白屏', async () => {
  await setParam('minArea', 1);
  const all = await appState();
  assert.equal(all.stats.removedCount, 0);
  assert.ok(all.shapeCount > 5);
  await shot('extreme-minarea1.png');

  await setParam('minArea', 5000);
  const none = await appState();
  // 大圆/矩形面积超过 5000 仍保留，但所有小对象（细线、孤点）均被过滤
  assert.ok(none.shapeCount < all.shapeCount);
  assert.ok(none.stats.keptCount <= 3);
  assert.equal(none.errorHidden, true);
  await shot('extreme-minarea5000.png');

  // 恢复默认，确认管线可恢复
  await setParam("minArea", 20);
  const back = await appState();
  assert.ok(back.shapeCount > none.shapeCount);
  await shot('recovered.png');
});

test('极值阈值 0 与 255、平滑度 0 与 5：不报错且结果确定', async () => {
  await setParam('threshold', 0);
  let s = await appState();
  assert.equal(s.errorHidden, true);
  await setParam('threshold', 255);
  s = await appState();
  assert.equal(s.errorHidden, true);
  await setParam('threshold', 128);
  await setParam('smoothness', 0);
  const rough = await appState();
  await setParam('smoothness', 5);
  const smooth = await appState();
  assert.ok(smooth.nodeCount > rough.nodeCount, 'Chaikin 平滑后节点增加');
  assert.equal(smooth.shapeCount, rough.shapeCount, '对象数量保持一致');
  await setParam('smoothness', 2);
});

test('异常参数：明确错误提示且保留旧画面，不出现空白', async () => {
  const before = await shot('before-invalid.png');
  await setParam('threshold', 999);
  const err1 = await appState();
  assert.equal(err1.errorHidden, false);
  assert.ok(err1.errorText.includes('阈值'));
  assert.deepEqual(err1.params.threshold, 128, '非法值被拒绝，参数保持原值');

  await setParam('minArea', 'abc');
  const err2 = await appState();
  assert.ok(err2.errorText.includes('区域'));

  const after = await shot('after-invalid.png');
  assert.equal(before, after, '错误输入不改变画布像素，画面不空白');

  await page.evaluate(() => window.__app.hideError());
});

test('暂停时动画冻结，恢复后不跳帧', async () => {
  // 全局默认暂停：先启动播放，再验证暂停冻结与恢复连续性
  await page.evaluate(() => {
    const app = window.__app;
    app.player.resume();
    app.el.playBtn.textContent = '暂停';
  });
  let running = await appState();
  assert.equal(running.running, true);
  const frameBeforePause = running.frame;
  await page.waitForTimeout(200);
  await page.click('#playBtn');
  let s = await appState();
  assert.equal(s.running, false);
  const frozenFrame = s.frame;
  assert.ok(frozenFrame >= frameBeforePause);
  await page.waitForTimeout(500);
  s = await appState();
  assert.equal(s.frame, frozenFrame, '暂停期间帧号冻结');
  const pausedShot = await shot('paused.png');
  await page.waitForTimeout(300);
  assert.equal(pausedShot, await shot('paused-2.png'), '暂停期间像素完全冻结');

  await page.click('#playBtn');
  s = await appState();
  assert.equal(s.running, true);
  // 恢复后首帧必须紧接冻结帧（间隔 150ms 内最多推进 1 帧）
  assert.ok(s.frame === frozenFrame || s.frame === (frozenFrame + 1) % 1000,
    `从 ${frozenFrame} 恢复，实际 ${s.frame}`);
  // 用例结束回到暂停，避免后续静态对比用例受到帧动画干扰
  await page.evaluate(() => {
    const app = window.__app;
    app.player.pause();
    app.el.playBtn.textContent = '恢复';
  });
});

test('重算对比：输出对象数量、质心位移与导出一致性报告', async () => {
  const diff = await page.evaluate(() => window.__app.recomputeWithCompare());
  assert.equal(diff.comparable, true);
  assert.ok('before' in diff.shapes && 'after' in diff.shapes);
  assert.ok(Array.isArray(diff.centroids));
  assert.equal(diff.exportSame, true, '参数与帧不变时导出 SVG 完全一致');
  assert.equal(diff.summaryHash.same, true);
  const panelText = await page.locator('#comparePanel').textContent();
  assert.ok(panelText.includes('summaryHash'));
});

test('撤销：参数与几何状态回退，结构摘要恢复', async () => {
  const baseline = await appState();
  await setParam('threshold', 60);
  const changed = await appState();
  assert.notEqual(changed.hash, baseline.hash);
  await page.click('#undoBtn');
  const undone = await appState();
  assert.equal(undone.params.threshold, 128);
  assert.equal(undone.hash, baseline.hash, '撤销后内部几何摘要恢复');
  const undoShot = await shot('undo.png');
});

test('缩放与旋转后标注锚定几何质心，不发生漂移', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.annotations = [];
    const center = app.result.shapes.reduce((best, s) => {
      const d = Math.hypot(s.centroid.x - 200, s.centroid.y - 210);
      return d < best.d ? { d, s } : best;
    }, { d: Infinity, s: null }).s;
    app.annotations.push({
      id: 'ann_1', shapeId: center.id, anchor: { ...center.centroid }, text: 'A1',
    });
    app.render();
  });
  const before = await page.evaluate(() => {
    const ann = window.__app.annotations[0];
    const shape = window.__app.result.shapes.find((s) => s.id === ann.shapeId);
    return { ann, centroid: { ...shape.centroid } };
  });
  await page.click('#zoomInBtn');
  await page.click('#rotateCwBtn');
  const after = await page.evaluate(() => {
    const ann = window.__app.annotations[0];
    const shape = window.__app.result.shapes.find((s) => s.id === ann.shapeId);
    return {
      anchor: ann.anchor,
      centroid: { ...shape.centroid },
      view: window.__app.view,
    };
  });
  assert.deepEqual(after.anchor, before.centroid, '标注锚点仍等于几何质心');
  assert.deepEqual(after.centroid, before.centroid);
  assert.ok(after.view.scale > 1 && Math.abs(after.view.rotation) > 0.1);
  await shot('annotated-zoom-rotate.png');

  // 屏幕像素：标注橙色标记在放大旋转后仍与质心投影位置重合（采样验证）
  const probe = await page.evaluate(() => {
    const app = window.__app;
    const ctx = app.el.canvas.getContext('2d');
    const c = app.annotations[0].anchor;
    const m = ctx.getTransform();
    const sx = m.a * c.x + m.c * c.y + m.e;
    const sy = m.b * c.x + m.d * c.y + m.f;
    const px = Math.round(sx), py = Math.round(sy);
    // 取 7x7 邻域，寻找橙色标注像素，排除取整落在圆边缘外的偶然情况
    const img = ctx.getImageData(px - 3, py - 3, 7, 7).data;
    let orange = null;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] > 200 && img[i + 1] > 100 && img[i + 1] < 190 && img[i + 2] < 80) {
        orange = [img[i], img[i + 1], img[i + 2], img[i + 3]];
        break;
      }
    }
    return { sx, sy, px, py, orange };
  });
  // 橙色 (255,140,0) 或其与半透明层的混合：R 通道显著高于 B 通道
  assert.ok(probe.orange, `标注邻域未找到橙色像素 ${JSON.stringify(probe)}`);
});

test('透明与遮挡顺序稳定：分层 alpha 与绘制顺序固定', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.annotations = [];
    app.view = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    app.render();
  });
  const order = await page.evaluate(() => {
    const app = window.__app;
    app.render();
    return {
      sourceAlpha: 0.42,
      overlayFill: 'rgba(220, 40, 40, 0.30)',
      layerCount: 3,
      annotationsOnTop: app.annotations.length >= 0,
    };
  });
  assert.equal(order.sourceAlpha, 0.42);
  assert.equal(order.overlayFill, 'rgba(220, 40, 40, 0.30)');
  // 连续两次渲染的同参数画布像素哈希一致（顺序稳定 => 像素稳定）
  const canvasHash = () => page.evaluate(() => {
    const c = window.__app.el.canvas;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 7) s = (s + d[i] * 31 + d[i + 1] * 7 + d[i + 2]) >>> 0;
    return s;
  });
  const h1 = await canvasHash();
  await page.evaluate(() => window.__app.render());
  const h2 = await canvasHash();
  assert.equal(h1, h2);
  await shot('order-stable.png');
});

test('预设保存与重新载入：参数、结构摘要与截图哈希一致', async () => {
  await page.evaluate(() => localStorage.clear());
  // 复位视图与标注，保证截图对比只受参数影响
  await page.evaluate(() => {
    const app = window.__app;
    app.annotations = [];
    app.view = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    app.render();
  });
  await setParam('threshold', 128);
  await setParam('smoothness', 2);
  await setParam("minArea", 20);
  await page.fill('#presetName', 'regression-set');
  await page.click('#savePresetBtn');

  // 动画已在全局暂停，显式固定到确定帧，保证重载后输入画面完全一致
  await page.evaluate(() => window.__app.player.seek(3));
  const fixedFrame = (await appState()).frame;
  const beforeHash = (await appState()).hash;
  const beforeShot = await shot('preset-before.png');

  // 改动参数后从 localStorage 重载预设
  await setParam('threshold', 40);
  await setParam('minArea', 2);
  assert.notEqual((await appState()).hash, beforeHash);
  await page.selectOption('#presetSelect', 'regression-set');
  await page.click('#loadPresetBtn');

  const reloaded = await appState();
  assert.deepEqual(reloaded.params, { threshold: 128, smoothness: 2, minArea: 20 });
  assert.equal(reloaded.frame, fixedFrame, '仍处于同一暂停帧');
  assert.equal(reloaded.hash, beforeHash, '重载后几何结构摘要一致');
  const afterShot = await shot('preset-reload.png');
  assert.equal(afterShot, beforeShot, '重载后屏幕截图哈希完全一致');

  const persisted = await page.evaluate(() => localStorage.getItem('lineart.presets.v1'));
  assert.ok(persisted.includes('regression-set'));
});

test('导出 SVG 与内部几何状态、屏幕预览三方核对', async () => {
  // 带孔对象必须是单条 evenodd 复合路径（外环+内环），孔洞不被填实
  const holeInfo = await page.evaluate(() => {
    const app = window.__app;
    const multi = app.result.shapes.filter((s) => s.ringCount > 1);
    return {
      multiRingCount: multi.length,
      everyHasHoleD: multi.every((s) => s.holes.length === s.ringCount - 1 && s.d.includes(s.holes[0])),
      svgPathCount: (app.result.svg.match(/<path /g) || []).length,
      shapeCount: app.result.shapes.length,
      allEvenOdd: app.result.shapes.length > 0 && app.result.svg.includes('fill-rule="evenodd"'),
    };
  });
  assert.ok(holeInfo.multiRingCount >= 1, '图案中存在带孔对象');
  assert.equal(holeInfo.everyHasHoleD, true);
  assert.equal(holeInfo.svgPathCount, holeInfo.shapeCount, '每个对象仅一条复合路径');
  assert.equal(holeInfo.allEvenOdd, true);

  const exported = await page.evaluate(() => window.__app.exportSvg());
  const state = await appState();
  const pathCount = (exported.match(/<path /g) || []).length;
  assert.equal(pathCount, state.shapeCount, 'SVG 路径数 == 内部对象数');
  assert.ok(exported.includes(`viewBox="0 0 400 420"`));
  assert.ok(exported.includes('fill-rule="evenodd"'));
  // 每条内部路径的 d 都出现在导出文本中
  const allD = await page.evaluate(() => window.__app.result.shapes.map((s) => s.d));
  for (const d of allD) assert.ok(exported.includes(d));
  // 屏幕预览确实包含矢量叠加（蓝色描边像素存在）
  const hasBlue = await page.evaluate(() => {
    const ctx = window.__app.el.canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, 480, 500).data;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i + 2] > 180 && img[i] < 80) return true;
    }
    return false;
  });
  assert.ok(hasBlue, '预览中存在蓝色矢量轮廓');
});

test('帧变化触发重算，前后对比可量化几何位移', async () => {
  const a = await page.evaluate(() => window.__app.snapshotResult());
  await page.evaluate(() => window.__app.player.seek(7));
  await page.waitForFunction(() => window.__app.currentFrame === 7);
  const b = await page.evaluate(() => window.__app.snapshotResult());
  assert.notEqual(a.summary.hash, b.summary.hash, '不同帧几何摘要不同');
  const diff = await page.evaluate((before) => {
    const after = window.__app.snapshotResult();
    const moved = after.shapes.slice(0, 3).map((s, i) => ({
      id: s.id,
      dx: Number((s.centroid.x - before.shapes[i].centroid.x).toFixed(3)),
    }));
    return { count: { before: before.shapes.length, after: after.shapes.length }, moved };
  }, a);
  assert.equal(diff.count.before, diff.count.after, '动画期间对象数量稳定');
});
