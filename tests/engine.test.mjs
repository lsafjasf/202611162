import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DEFAULTS, validateParams, tokenize, layout, createFallbackMeasurer,
  makeViewTransform, createAnimClock, serializeParams, deserializeParams,
  exportSVG, summarizeScene, sceneHash, LAYERS,
} from '../src/engine.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const run = (params, opts = {}) =>
  layout(params, createFallbackMeasurer(Number(params?.fontSize) || DEFAULTS.fontSize), opts);

// --- 三组设置：默认 / 极值 / 异常 -------------------------------------------
const CASES = {
  default: {},
  extreme: {
    text: '急弯Test测试ABC混排word-wrap不断裂',
    radius: 60, arcAngle: 300, fontSize: 40,
    letterSpacing: 2, baselineOffset: 10, minGapRatio: 0.15,
  },
  abnormal: {
    text: '', fontSize: -5, radius: 5, arcAngle: 999,
    letterSpacing: 'abc', baselineOffset: -5000, align: 'weird',
  },
};

test('三组设置：重算前后对象数量、几何位置、导出图片一致', () => {
  for (const [name, over] of Object.entries(CASES)) {
    const a = run(over);
    const b = run(over);
    // 对象数量
    assert.equal(a.drawList.length, b.drawList.length, `${name}: draw count`);
    assert.deepEqual(a.stats, b.stats, `${name}: stats`);
    // 几何位置
    assert.deepEqual(
      a.atoms.map((x) => [x.x, x.y, x.angle, x.width]),
      b.atoms.map((x) => [x.x, x.y, x.angle, x.width]),
      `${name}: geometry`,
    );
    // 导出图片（SVG 字符串哈希）
    if (a.ok) {
      assert.equal(sha256(exportSVG(a)), sha256(exportSVG(b)), `${name}: svg`);
    }
    // 结构摘要哈希
    assert.equal(sceneHash(a), sceneHash(b), `${name}: scene hash`);
  }
});

test('默认设置：排版有效且对象计数正确', () => {
  const s = run({});
  assert.equal(s.ok, true);
  assert.equal(s.errors.length, 0);
  const atomItems = s.drawList.filter((i) => i.type === 'atom');
  assert.equal(atomItems.length, s.stats.atomCount);
  assert.equal(s.stats.wordCount, 2); // "World" 与 "2026"
  assert.equal(s.stats.cjkCount, 2);  // "你" "好"
});

test('极值设置：急弯处字距不塌缩', () => {
  const s = run(CASES.extreme);
  assert.equal(s.ok, true, s.errors.join(';'));
  assert.ok(s.stats.collapseFixes > 0, '急弯应触发抗塌缩加宽');
  const p = s.params;
  const rBase = p.radius + p.baselineOffset;
  const rMin = rBase - s.params.fontSize * 0.2;
  const minGap = p.minGapRatio * p.fontSize;
  for (let i = 1; i < s.atoms.length; i += 1) {
    const gap = s.atoms[i].start - (s.atoms[i - 1].start + s.atoms[i - 1].width);
    const gapAtInner = (gap * rMin) / rBase;
    assert.ok(
      gapAtInner >= minGap - 1e-6,
      `atom ${i} 内缘间距 ${gapAtInner.toFixed(3)} < ${minGap}`,
    );
  }
});

test('中英文混排：英文单词不被断裂', () => {
  const s = run({ text: '中文hello-world混排test' });
  const words = s.atoms.filter((a) => a.kind === 'word').map((a) => a.text);
  assert.deepEqual(words, ['hello-world', 'test']);
  // 词内不含字距：词是单个原子，宽度即测量宽度
  const m = createFallbackMeasurer(DEFAULTS.fontSize);
  for (const a of s.atoms.filter((x) => x.kind === 'word')) {
    assert.equal(a.width, m.measure({ text: a.text }));
  }
});

test('tokenizer: 空格为独立原子，标点不并入单词', () => {
  const toks = tokenize('Hi, 世界 ok.');
  assert.deepEqual(toks.map((t) => t.text), ['Hi', ',', ' ', '世', '界', ' ', 'ok', '.']);
});

test('异常设置：给出明确错误而不是崩溃或空白', () => {
  const s = run(CASES.abnormal);
  const msgs = [...s.errors, ...s.warnings];
  assert.ok(msgs.length > 0, '异常参数必须产生明确提示');
  assert.ok(msgs.some((e) => e.includes('文字内容不能为空')));
  assert.ok(msgs.some((e) => e.includes('letterSpacing')));
  assert.ok(msgs.some((e) => e.includes('对齐')));
  // 引擎不抛异常，返回结构化结果（ok=false 时由应用层保留上一帧）
  assert.ok(Array.isArray(s.drawList));
  assert.ok(typeof s.ok === 'boolean');
});

test('可恢复的异常参数：夹取后正常排版不空白', () => {
  const s = run({ fontSize: 99999, radius: 1e9, arcAngle: -8, letterSpacing: NaN });
  assert.equal(s.ok, true);
  assert.ok(s.warnings.length >= 3, '每个越界参数都应有提示');
  assert.ok(s.drawList.length > 0);
  assert.equal(s.params.fontSize, 400);
  assert.equal(s.params.radius, 1e6);
});

test('致命几何错误：半径/基线导致文字带穿心时 ok=false 且有明确提示', () => {
  const s = run({ radius: 30, baselineOffset: -60, fontSize: 48 });
  assert.equal(s.ok, false);
  assert.ok(s.errors.some((e) => e.includes('基线半径') || e.includes('圆心')));
  assert.equal(s.drawList.length, 0);
});

test('超出安全区域时产生警告并标记越界原子', () => {
  const s = run({ radius: 200, arcAngle: 200, fontSize: 120, safeMargin: 200 });
  assert.ok(s.warnings.some((w) => w.includes('超出安全区域')));
  assert.ok(s.stats.outOfSafeArea > 0);
  assert.ok(s.atoms.some((a) => a.outside));
});

test('遮挡/透明顺序稳定：重算后图层 z 与 alpha 序列一致', () => {
  const a = run({});
  const b = run({ animSpeed: 30 }, { time: 2.5 });
  const seqA = a.drawList.map((i) => [i.layer, i.z, i.alpha]);
  const seqB = b.drawList.map((i) => [i.layer, i.z, i.alpha]);
  assert.deepEqual(seqA, seqB);
  // z 单调不减
  const zs = a.drawList.map((i) => i.z);
  assert.deepEqual(zs, [...zs].sort((x, y) => x - y));
  // 图层表本身固定
  assert.deepEqual(LAYERS.map((l) => l.name), [
    'background', 'grid', 'safeArea', 'curveGuide', 'text', 'annotation', 'overlay',
  ]);
});

test('缩放/旋转后标注不漂移：标注点严格等于视图变换映射', () => {
  const base = { zoom: 2.3, rotation: 47, panX: 15, panY: -30 };
  const s = run(base);
  const t = makeViewTransform(s.params);
  for (const ann of s.annotations) {
    for (const [x, y] of ann.points) {
      const mapped = t.apply(x, y);
      const expect = {
        x: s.params.width / 2 + s.params.panX
          + s.params.zoom * ((x - s.params.width / 2) * Math.cos(t.rotation)
                           - (y - s.params.height / 2) * Math.sin(t.rotation)),
        y: s.params.height / 2 + s.params.panY
          + s.params.zoom * ((x - s.params.width / 2) * Math.sin(t.rotation)
                           + (y - s.params.height / 2) * Math.cos(t.rotation)),
      };
      assert.ok(Math.abs(mapped.x - expect.x) < 1e-9);
      assert.ok(Math.abs(mapped.y - expect.y) < 1e-9);
    }
  }
  // 同一世界点在变换前后映射差 = 0（标注与文字共用同一变换）
  const anchor = s.annotations.find((a) => a.id.startsWith('anchor-'));
  const atom = s.atoms.find((a) => `anchor-${a.id}` === anchor.id);
  assert.deepEqual(anchor.points[0], [Math.round(atom.x * 1000) / 1000,
                                    Math.round(atom.y * 1000) / 1000]);
});

test('动画暂停必须冻结，恢复后相位连续不跳帧', () => {
  const clock = createAnimClock();
  clock.resume(1000);
  assert.equal(clock.now(2000), 1000);
  clock.pause(2000);
  assert.equal(clock.now(5000), 1000, '暂停期间时间冻结');
  assert.equal(clock.now(9999), 1000);
  clock.resume(5000);
  assert.equal(clock.now(5100), 1100, '恢复后从冻结值继续，无跳帧');
  // 暂停前后同一时刻的场景完全一致
  const p = { animSpeed: 25 };
  const frozenA = run(p, { time: 1.0 });
  const frozenB = run(p, { time: 1.0 });
  assert.equal(sceneHash(frozenA), sceneHash(frozenB));
});

test('参数保存/载入：序列化往返后结构摘要一致', () => {
  const original = {
    text: '存档Test往返123', fontSize: 64, letterSpacing: 9,
    baselineOffset: -15, radius: 300, arcAngle: 150, align: 'end',
    zoom: 1.5, rotation: 30, animSpeed: 0,
  };
  const a = run(original);
  const json = serializeParams(a.params);
  const { params: restored, errors } = deserializeParams(json);
  assert.deepEqual(errors, []);
  const b = run(restored);
  assert.equal(summarizeScene(a), summarizeScene(b));
  assert.equal(sceneHash(a), sceneHash(b));
  assert.equal(sha256(exportSVG(a)), sha256(exportSVG(b)));
});

test('损坏存档：反序列化给出明确错误', () => {
  assert.ok(deserializeParams('not json').errors[0].includes('解析失败'));
  assert.ok(deserializeParams('{"version":99}').errors[0].includes('params'));
  assert.ok(
    deserializeParams('{"version":1,"params":{}}').errors.length === 0,
  );
});

test('SVG 导出保留文字路径', () => {
  const s = run({});
  const svg = exportSVG(s);
  assert.match(svg, /<path id="textCurve" d="M [\d.]+ [\d.]+ A /);
  assert.match(svg, /<textPath href="#textCurve"/);
  assert.ok(svg.includes('你好 World 2026'), '原始文本保留在 textPath 中');
  assert.ok(svg.includes('id="exact-placement"'), '包含精确逐字定位备份');
});

test('validateParams: 越界值被夹取并报告', () => {
  const { params, errors } = validateParams({ fontSize: 99999, radius: -3 });
  assert.equal(params.fontSize, 400);
  assert.equal(params.radius, 20);
  assert.equal(errors.length, 2);
});
