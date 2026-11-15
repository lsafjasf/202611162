// Node 层单元测试：默认、极值、异常三组参数 + 细线/孤点/确定性
import test from 'node:test';
import assert from 'node:assert/strict';
import { toGrayscale, labelComponents, fnv1a } from '../src/geometry.mjs';
import { vectorize } from '../src/vectorize.mjs';
import { validateParams, DEFAULT_PARAMS } from '../src/params.mjs';

function makeGray(pixels, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    data[i * 4] = pixels[i];
    data[i * 4 + 1] = pixels[i];
    data[i * 4 + 2] = pixels[i];
    data[i * 4 + 3] = 255;
  }
  return toGrayscale({ data, width, height });
}

// 12x12 图：中间一条 1px 水平细线，外加两个孤点
function thinLineFixture() {
  const w = 30, h = 12;
  const px = new Array(w * h).fill(255);
  for (let x = 1; x <= 26; x += 1) px[6 * w + x] = 0;
  px[2 * w + 2] = 0;
  px[9 * w + 9] = 0;
  return makeGray(px, w, h);
}

test('默认参数：细线完整保留、孤点按最小区域过滤', () => {
  const fixture = thinLineFixture();
  const res = vectorize(fixture, DEFAULT_PARAMS);
  assert.ok(res.shapes.length >= 1, '至少生成一条轮廓');
  const lineShape = res.shapes.find((s) => s.bounds.maxX - s.bounds.minX > 5);
  assert.ok(lineShape, '细线轮廓存在');
  assert.ok(lineShape.bounds.minX <= 1.6 && lineShape.bounds.maxX >= 25.4,
    `细线未断裂，跨度=${lineShape.bounds.maxX - lineShape.bounds.minX}`);
  assert.equal(res.stats.removedCount, 2, '两个孤点被标记过滤');
  assert.equal(res.stats.keptCount, 1, '仅保留细线组件');
});

test('极值 minArea=1：孤点不再被过滤', () => {
  const fixture = thinLineFixture();
  const res = vectorize(fixture, { ...DEFAULT_PARAMS, minArea: 1 });
  assert.equal(res.stats.removedCount, 0);
  assert.equal(res.stats.keptCount, 3);
  assert.ok(res.shapes.length >= 3);
});

test('极值 minArea=5000：所有对象都被过滤，画面几何为空但不报错', () => {
  const fixture = thinLineFixture();
  const res = vectorize(fixture, { ...DEFAULT_PARAMS, minArea: 5000 });
  assert.equal(res.shapes.length, 0);
  assert.equal(res.stats.nodeCount, 0);
  assert.ok(res.svg.includes('<svg'));
});

test('极值阈值 0 与 255：行为确定且不产生异常', () => {
  const fixture = thinLineFixture();
  const t0 = vectorize(fixture, { threshold: 0, smoothness: 0, minArea: 1 });
  const t255 = vectorize(fixture, { threshold: 255, smoothness: 5, minArea: 1 });
  assert.equal(t0.stats.componentCount, 3, '阈值0仍能捕获纯黑像素');
  assert.equal(t255.stats.keptCount, 1, '阈值255下整图连通为单个组件');
  assert.equal(t255.stats.ringCount, 0, '整图暗化时等值线落在画布外，无内部环');
  // 极值参数下管线不抛异常且仍返回合法 SVG 与摘要
  assert.ok(t0.svg.includes('<svg') && t255.svg.includes('<svg'));
  assert.match(t0.summary.hash, /^[0-9a-f]{8}$/);
});

test('异常参数：validateParams 给出明确中文错误并回退默认值', () => {
  const cases = [
    { threshold: 999 }, { threshold: -1 }, { threshold: 'abc' },
    { smoothness: 8 }, { minArea: 0 }, { threshold: null },
  ];
  for (const partial of cases) {
    const check = validateParams({ ...DEFAULT_PARAMS, ...partial });
    assert.equal(check.ok, false, `应拒绝 ${JSON.stringify(partial)}`);
    assert.ok(check.errors[0].includes('阈值') || check.errors[0].includes('平滑') || check.errors[0].includes('区域'));
    assert.deepEqual(Object.keys(check.params).sort(), ['minArea', 'smoothness', 'threshold']);
  }
  assert.equal(validateParams(null).ok, false);
});

test('同参数重复计算结果完全一致（结构摘要与 SVG 稳定）', () => {
  const fixture = thinLineFixture();
  const a = vectorize(fixture, DEFAULT_PARAMS);
  const b = vectorize(fixture, DEFAULT_PARAMS);
  assert.equal(a.summary.hash, b.summary.hash);
  assert.equal(a.svg, b.svg);
  assert.deepEqual(a.shapes.map((s) => s.centroid), b.shapes.map((s) => s.centroid));
});

test('平滑度提升后节点数不增加，且轮廓仍然闭合', () => {
  const fixture = thinLineFixture();
  const rough = vectorize(fixture, { threshold: 128, smoothness: 0, minArea: 2 });
  const smooth = vectorize(fixture, { threshold: 128, smoothness: 5, minArea: 2 });
  assert.equal(smooth.shapes.length, rough.shapes.length, '平滑不改变对象数量');
  // Chaikin 切角会轻微收缩轮廓，质心偏移控制在线长 10% 以内
  assert.ok(smooth.shapes.every((shape, i) => {
    const dx = shape.centroid.x - rough.shapes[i].centroid.x;
    const dy = shape.centroid.y - rough.shapes[i].centroid.y;
    const span = rough.shapes[i].bounds.maxX - rough.shapes[i].bounds.minX;
    return Math.hypot(dx, dy) < Math.max(1.2, span * 0.1);
  }));
  for (const shape of smooth.shapes) {
    assert.ok(shape.d.endsWith('Z'), '路径闭合');
  }
});

test('连通域 4-邻域：对角像素视为分离组件', () => {
  const w = 4, h = 4;
  const px = new Array(w * h).fill(255);
  px[0] = 0;
  px[5] = 0;
  const fixture = makeGray(px, w, h);
  const labeled = labelComponents(fixture.gray, w, h, 128, 1);
  assert.equal(labeled.allCount, 2);
});

test('fnv1a 哈希为确定性 8 位十六进制', () => {
  assert.match(fnv1a('hello'), /^[0-9a-f]{8}$/);
  assert.equal(fnv1a('hello'), fnv1a('hello'));
  assert.notEqual(fnv1a('hello'), fnv1a('world'));
});

test('带孔形状合并为单条 evenodd 复合路径，孔洞镂空', () => {
  const w = 20, h = 20;
  const px = new Array(w * h).fill(255);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) px[y * w + x] = 0;
  for (let y = 8; y < 12; y += 1) for (let x = 8; x < 12; x += 1) px[y * w + x] = 255;
  const fixture = makeGray(px, w, h);
  const res = vectorize(fixture, { threshold: 128, smoothness: 1, minArea: 1 });
  assert.equal(res.shapes.length, 1, '外方与内孔属于同一对象');
  const shape = res.shapes[0];
  assert.equal(shape.ringCount, 2);
  assert.equal(shape.holes.length, 1);
  assert.ok(shape.d.includes(shape.holes[0]), '复合路径包含内环子路径');
  assert.equal((res.svg.match(/<path /g) || []).length, 1);
  assert.ok(res.svg.includes('fill-rule="evenodd"'));
});
