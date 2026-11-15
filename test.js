// test.js — 默认 / 极值 / 异常三组测试 + 一致性校验（对象数量、几何位置、导出图片）
'use strict';
const crypto = require('crypto');
const S = require('./iso-scene.js');
const R = require('./soft-render.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n== ' + t + ' =='); }
function sha(x) { return crypto.createHash('sha256').update(x).digest('hex'); }

const W = 900, H = 600;

// 结构摘要：对象数量 + 全部几何位置
function structureSummary(scene) {
  const pick = (o, keys) => keys.map(k => +o[k].toFixed(6));
  return {
    counts: {
      buildings: scene.buildings.length, trees: scene.trees.length,
      lamps: scene.lamps.length, pedestrians: scene.pedestrians.length,
    },
    buildings: scene.buildings.map(b => [b.id, ...pick(b, ['x', 'y', 'w', 'd', 'h'])]),
    trees: scene.trees.map(t => [t.id, ...pick(t, ['x', 'y', 'r', 'h'])]),
    lamps: scene.lamps.map(l => [l.id, ...pick(l, ['x', 'y', 'h'])]),
    pedestrians: scene.pedestrians.map(p => [p.id, ...pick(p, ['startX', 'y', 'speed'])]),
  };
}

function renderPngHash(params, viewOpts, time) {
  const scene = S.generateScene(params);
  const view = Object.assign(S.defaultView(W, H), viewOpts || {});
  const cmds = S.buildDrawCommands(scene, view, null, time);
  const png = R.encodePng(R.rasterize(cmds, W, H), W, H);
  return { hash: sha(png), cmds, scene };
}

// ---------- 第 1 组：默认设置 ----------
section('默认设置：重算前后对象数量 / 几何位置 / 导出图片一致');
{
  const p = S.defaultParams();
  const s1 = S.generateScene(p);
  const s2 = S.generateScene(p);
  ok(JSON.stringify(structureSummary(s1).counts) === JSON.stringify({ buildings: 8, trees: 10, lamps: 4, pedestrians: 6 }), '默认对象数量正确');
  ok(JSON.stringify(structureSummary(s1)) === JSON.stringify(structureSummary(s2)), '重算后几何位置完全一致');
  const r1 = renderPngHash(p, null, 3.0);
  const r2 = renderPngHash(p, null, 3.0);
  ok(r1.hash === r2.hash, '重算后导出 PNG 哈希一致 (' + r1.hash.slice(0, 12) + '…)');
  const sorted = r1.cmds.polys.every((c, i, a) => i === 0 ||
    (a[i - 1].depth < c.depth) ||
    (a[i - 1].depth === c.depth && a[i - 1].sub < c.sub) ||
    (a[i - 1].depth === c.depth && a[i - 1].sub === c.sub && a[i - 1].id <= c.id));
  ok(sorted, '绘制指令按 (depth, sub, id) 稳定排序（遮挡顺序确定）');
  ok(r1.cmds.labels.length === s1.buildings.length, '每栋建筑都有标注');
}

// ---------- 修改单栋高度的隔离性 ----------
section('修改一栋建筑高度不影响其他对象位置');
{
  const p0 = S.defaultParams();
  const s0 = S.generateScene(p0);
  const heights = s0.buildings.map(() => null);
  heights[2] = 25;
  const p1 = Object.assign({}, p0, { heights });
  const s1 = S.generateScene(p1);
  ok(s1.buildings[2].h === 25, '目标建筑高度已修改');
  const same = (a, b, keys) => keys.every(k => a[k] === b[k]);
  ok(s0.buildings.every((b, i) => i === 2 || same(b, s1.buildings[i], ['x', 'y', 'w', 'd', 'h'])), '其他建筑位置/尺寸/高度不变');
  ok(JSON.stringify(s0.trees) === JSON.stringify(s1.trees), '树木位置不变');
  ok(JSON.stringify(s0.lamps) === JSON.stringify(s1.lamps), '路灯位置不变');
  ok(JSON.stringify(s0.pedestrians) === JSON.stringify(s1.pedestrians), '行人参数不变');
}

// ---------- 第 2 组：极值设置 ----------
section('极值设置：最小/最大规模与极端视图');
{
  const pMin = { seed: 1, buildingCount: 1, treeCount: 0, lampCount: 0, pedestrianCount: 0, streetLength: 10, streetWidth: 4 };
  const sMin = S.generateScene(pMin);
  const cMin = structureSummary(sMin).counts;
  ok(cMin.buildings === 1 && cMin.trees === 0 && cMin.lamps === 0 && cMin.pedestrians === 0, '最小规模对象数量正确');
  const rMin = renderPngHash(pMin, { zoom: 4 }, 0);
  ok(rMin.cmds.polys.length > 0, '最小规模 + 最小缩放仍可渲染');

  const pMax = { seed: 4294967295, buildingCount: 24, treeCount: 40, lampCount: 12, pedestrianCount: 30, streetLength: 120, streetWidth: 20 };
  const sMax = S.generateScene(pMax);
  const cMax = structureSummary(sMax).counts;
  ok(cMax.buildings === 24 && cMax.lamps === 12 && cMax.pedestrians === 30, '最大规模对象数量正确');
  ok(cMax.trees === 40, '最大规模树木全部放置（40）');
  const rMax = renderPngHash(pMax, { zoom: 40, rot: Math.PI * 1.75 }, 100);
  ok(rMax.cmds.polys.length > 0, '最大规模 + 极端旋转/缩放仍可渲染');
  const rMax2 = renderPngHash(pMax, { zoom: 40, rot: Math.PI * 1.75 }, 100);
  ok(rMax.hash === rMax2.hash, '极值设置重算后导出 PNG 哈希一致');
}

// ---------- 标注不漂移 ----------
section('缩放 / 旋转后标注锚点不漂移');
{
  const scene = S.generateScene(S.defaultParams());
  for (const viewOpts of [{ zoom: 6 }, { zoom: 30 }, { rot: 0.3 }, { rot: 2.1, zoom: 22 }]) {
    const view = Object.assign(S.defaultView(W, H), viewOpts);
    const cmds = S.buildDrawCommands(scene, view, null, 0);
    const driftOk = cmds.labels.every(l => {
      const b = scene.buildings.find(x => 'label:' + x.id === l.id);
      const top = S.project(view, b.x, b.y, b.h);
      return Math.abs(l.x - top.sx) < 1e-9 && Math.abs(l.y - (top.sy - 6)) < 1e-9;
    });
    ok(driftOk, `视图 ${JSON.stringify(viewOpts)} 下标注锚点与投影一致`);
  }
}

// ---------- 阴影方向一致 ----------
section('行人经过路灯时阴影方向一致（背离最近路灯）');
{
  const p = Object.assign(S.defaultParams(), { pedestrianCount: 8 });
  const scene = S.generateScene(p);
  let allOk = true;
  for (let t = 0; t < 40; t += 0.5) {
    for (const ped of scene.pedestrians) {
      const pos = S.pedestrianPos(scene, ped, t);
      const dir = S.shadowDir(scene, pos.x, pos.y);
      let best = null, bestD = Infinity;
      for (const lamp of scene.lamps) {
        const d = (pos.x - lamp.x) ** 2 + (pos.y - lamp.y) ** 2;
        if (d < bestD) { bestD = d; best = lamp; }
      }
      const dot = (pos.x - best.x) * dir.x + (pos.y - best.y) * dir.y;
      if (dot < -1e-9) { allOk = false; break; }
    }
  }
  ok(allOk, '阴影始终背离最近路灯（点积 >= 0）');
}

// ---------- 暂停 / 恢复 ----------
section('暂停冻结动画，恢复不跳帧');
{
  const clock = S.createClock();
  clock.tick(1000);
  clock.tick(1500);
  ok(Math.abs(clock.time - 0.5) < 1e-12, '正常运行 0.5s');
  clock.pause();
  clock.tick(2000);
  clock.tick(3000);
  ok(Math.abs(clock.time - 0.5) < 1e-12, '暂停期间时间冻结');
  clock.resume();
  clock.tick(3100);
  ok(Math.abs(clock.time - 0.6) < 1e-12, '恢复后只前进 0.1s，无跳帧');
}

// ---------- 第 3 组：异常设置 ----------
section('异常设置：明确错误提示而非空白画面');
{
  const cases = [
    [{ seed: NaN }, 'seed'],
    [{ seed: -1 }, 'seed'],
    [{ buildingCount: 0 }, 'buildingCount'],
    [{ buildingCount: 2.5 }, 'buildingCount'],
    [{ treeCount: 999 }, 'treeCount'],
    [{ streetWidth: 0 }, 'streetWidth'],
    [{ streetLength: 'abc' }, 'streetLength'],
    [{ heights: [null, 999] }, 'heights'],
    [{ heights: 'x' }, 'heights'],
    [null, '(非对象)'],
  ];
  for (const [raw, name] of cases) {
    const chk = S.validateParams(raw);
    ok(!chk.ok && chk.errors.length > 0 && chk.errors.every(e => typeof e === 'string' && e.length > 5),
      `非法 ${name} 给出明确错误: ${(chk.errors[0] || '').slice(0, 40)}…`);
  }
  let threw = false;
  try { S.generateScene({ buildingCount: -3 }); } catch (e) { threw = e.validationErrors && e.validationErrors.length > 0; }
  ok(threw, 'generateScene 对非法参数抛出带 validationErrors 的错误（界面可提示并保留上一帧）');
}

// ---------- 参数保存 / 重新载入一致性 ----------
section('保存参数并重新载入：截图哈希与结构摘要一致');
{
  const p = Object.assign(S.defaultParams(), { seed: 777, heights: [12, null, 20] });
  const saved = JSON.stringify({ params: p, view: { rot: 0.6, zoom: 18, panX: 10, panY: -5 } });
  const loaded = JSON.parse(saved); // 模拟保存 -> 重新载入
  const chk = S.validateParams(loaded.params);
  ok(chk.ok, '载入的参数通过校验');
  const s1 = S.generateScene(p);
  const s2 = S.generateScene(chk.value);
  ok(JSON.stringify(structureSummary(s1)) === JSON.stringify(structureSummary(s2)), '重新载入后结构摘要一致');
  const r1 = renderPngHash(p, loaded.view, 5.0);
  const r2 = renderPngHash(chk.value, loaded.view, 5.0);
  ok(r1.hash === r2.hash, '重新载入后导出 PNG 哈希一致 (' + r1.hash.slice(0, 12) + '…)');
}

// ---------- 图层隐藏 ----------
section('图层隐藏影响绘制指令但不影响几何状态');
{
  const scene = S.generateScene(S.defaultParams());
  const view = S.defaultView(W, H);
  const all = S.buildDrawCommands(scene, view, null, 1);
  const noB = S.buildDrawCommands(scene, view, { buildings: false }, 1);
  const noShadow = S.buildDrawCommands(scene, view, { shadows: false }, 1);
  ok(!noB.polys.some(c => /^b\d/.test(c.id)) && noB.labels.length === 0, '隐藏建筑层后无建筑指令与标注');
  ok(!noShadow.polys.some(c => c.id.endsWith(':shadow')), '隐藏阴影层后无阴影指令');
  ok(all.polys.length > noB.polys.length, '隐藏图层减少绘制指令');
  ok(all.polys.length !== noShadow.polys.length, '阴影层独立可切换');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
