// iso-scene.js — 等距投影街道场景核心模块（浏览器 / Node 通用）
// 纯代码生成：种子随机场景、等距投影、绘制指令流、参数校验、动画时钟。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IsoScene = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 确定性随机数 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 参数 ----------
  const PARAM_LIMITS = {
    seed:           { min: 0,   max: 4294967295, integer: true,  label: 'seed' },
    buildingCount:  { min: 1,   max: 24,         integer: true,  label: 'buildingCount' },
    treeCount:      { min: 0,   max: 40,         integer: true,  label: 'treeCount' },
    lampCount:      { min: 0,   max: 12,         integer: true,  label: 'lampCount' },
    pedestrianCount:{ min: 0,   max: 30,         integer: true,  label: 'pedestrianCount' },
    streetLength:   { min: 10,  max: 120,        integer: false, label: 'streetLength' },
    streetWidth:    { min: 4,   max: 20,         integer: false, label: 'streetWidth' },
  };
  const HEIGHT_MIN = 2, HEIGHT_MAX = 30;

  function defaultParams() {
    return {
      seed: 20261116,
      buildingCount: 8,
      treeCount: 10,
      lampCount: 4,
      pedestrianCount: 6,
      streetLength: 48,
      streetWidth: 8,
      heights: null,
    };
  }

  function showVal(v) {
    if (typeof v === 'number' && !isFinite(v)) return String(v);
    return JSON.stringify(v);
  }

  // 校验并归一化参数。返回 { ok, errors: string[], value }
  function validateParams(raw) {
    const errors = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, errors: ['参数必须是一个对象'], value: null };
    }
    const value = defaultParams();
    for (const key of Object.keys(PARAM_LIMITS)) {
      let v = raw[key];
      if (v === undefined || v === null) { continue; }
      const lim = PARAM_LIMITS[key];
      if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) v = Number(v);
      if (typeof v !== 'number' || !isFinite(v)) {
        errors.push(`参数 ${lim.label} 必须是有限数字，收到: ${showVal(raw[key])}`);
        continue;
      }
      if (lim.integer && !Number.isInteger(v)) {
        errors.push(`参数 ${lim.label} 必须是整数，收到: ${v}`);
        continue;
      }
      if (v < lim.min || v > lim.max) {
        errors.push(`参数 ${lim.label} 超出范围 [${lim.min}, ${lim.max}]，收到: ${v}`);
        continue;
      }
      value[key] = v;
    }
    if (raw.heights !== undefined && raw.heights !== null) {
      if (!Array.isArray(raw.heights)) {
        errors.push('参数 heights 必须是数组或 null');
      } else {
        const hs = [];
        for (let i = 0; i < raw.heights.length; i++) {
          const h = raw.heights[i];
          if (h === null || h === undefined) { hs.push(null); continue; }
          if (typeof h !== 'number' || !isFinite(h) || h < HEIGHT_MIN || h > HEIGHT_MAX) {
            errors.push(`heights[${i}] 必须是 [${HEIGHT_MIN}, ${HEIGHT_MAX}] 内的数字或 null，收到: ${showVal(h)}`);
            continue;
          }
          hs.push(h);
        }
        value.heights = hs;
      }
    }
    return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : null };
  }

  // ---------- 场景生成（固定 seed 决定全部布局） ----------
  // 高度先生成再被 heights 覆盖，因此修改某栋高度不会改变其他对象位置。
  function generateScene(params) {
    const chk = validateParams(params);
    if (!chk.ok) {
      const err = new Error('参数无效: ' + chk.errors.join('; '));
      err.validationErrors = chk.errors;
      throw err;
    }
    const p = chk.value;
    const rng = mulberry32(p.seed);
    const halfL = p.streetLength / 2;
    const halfW = p.streetWidth / 2;
    const scene = { params: p, buildings: [], trees: [], lamps: [], pedestrians: [], grounds: [] };

    // 地面：草地背景 + 两侧人行道 + 车行道
    scene.grounds.push({ id: 'ground:grass', kind: 'ground', x: 0, y: 0, w: p.streetLength + 44, d: p.streetWidth + 36, color: '#7fae6b', z: 0 });
    scene.grounds.push({ id: 'ground:road', kind: 'ground', x: 0, y: 0, w: p.streetLength + 8, d: p.streetWidth, color: '#5b5f66', z: 0.01 });
    scene.grounds.push({ id: 'ground:walkN', kind: 'ground', x: 0, y: -(halfW + 1.5), w: p.streetLength + 8, d: 3, color: '#b8b2a6', z: 0.02 });
    scene.grounds.push({ id: 'ground:walkS', kind: 'ground', x: 0, y: (halfW + 1.5), w: p.streetLength + 8, d: 3, color: '#b8b2a6', z: 0.02 });

    // 建筑：沿街道两侧交替排布
    const palette = ['#d9a066', '#c97b63', '#8fa8c8', '#a8c8a0', '#c8a0b8', '#e0c878', '#9fb8c8', '#d08888'];
    const slot = (p.streetLength - 4) / Math.ceil(p.buildingCount / 2);
    for (let i = 0; i < p.buildingCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const w = 4 + rng() * 3;
      const d = 4 + rng() * 2;
      const h = HEIGHT_MIN + rng() * 10;
      const x = -halfL + 2 + slot * (row + 0.5) + (rng() - 0.5) * 1.2;
      const y = side * (halfW + 3 + d / 2 + rng() * 1.5);
      const color = palette[Math.floor(rng() * palette.length)];
      scene.buildings.push({ id: 'b' + i, kind: 'building', x, y, w, d, h, color });
    }
    // 高度覆盖（不消耗 rng，不影响其他对象）
    if (p.heights) {
      for (let i = 0; i < Math.min(p.heights.length, scene.buildings.length); i++) {
        if (p.heights[i] !== null && p.heights[i] !== undefined) scene.buildings[i].h = p.heights[i];
      }
    }

    // 树木：人行道边缘随机位置，避免与建筑重叠
    let placed = 0, guard = 0;
    while (placed < p.treeCount && guard < p.treeCount * 60 + 60) {
      guard++;
      const x = -halfL + rng() * p.streetLength;
      const side = rng() < 0.5 ? -1 : 1;
      const y = side * (halfW + 0.8 + rng() * 2.0);
      const r = 0.8 + rng() * 0.7;
      const th = 1.6 + rng() * 1.4;
      const hit = scene.buildings.some(b => Math.abs(b.x - x) < b.w / 2 + r + 0.4 && Math.abs(b.y - y) < b.d / 2 + r + 0.4);
      if (hit) continue;
      scene.trees.push({ id: 't' + placed, kind: 'tree', x, y, r, h: th });
      placed++;
    }

    // 路灯：沿街道两侧均匀交错
    for (let i = 0; i < p.lampCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = -halfL + (i + 0.5) * (p.streetLength / p.lampCount);
      const y = side * (halfW - 0.6);
      scene.lamps.push({ id: 'l' + i, kind: 'lamp', x, y, h: 3.2 });
    }

    // 行人：沿街道两侧行走
    for (let i = 0; i < p.pedestrianCount; i++) {
      const lane = rng() < 0.5 ? -1 : 1;
      const y = lane * (halfW - 1.6 - rng() * 0.8);
      const dir = rng() < 0.5 ? 1 : -1;
      const speed = (0.8 + rng() * 0.9) * dir;
      const startX = -halfL + rng() * p.streetLength;
      scene.pedestrians.push({ id: 'p' + i, kind: 'pedestrian', startX, y, speed, phase: rng() * Math.PI * 2 });
    }
    return scene;
  }

  // ---------- 视图与等距投影 ----------
  function defaultView(width, height) {
    return { rot: Math.PI / 4, zoom: 14, panX: 0, panY: 0, originX: width / 2, originY: height / 2 };
  }

  const COS30 = Math.sqrt(3) / 2;

  // 世界点 -> 屏幕点。先绕 z 轴旋转 rot，再做等距投影。
  function project(view, x, y, z) {
    const c = Math.cos(view.rot), s = Math.sin(view.rot);
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    return {
      sx: (rx - ry) * COS30 * view.zoom + view.originX + view.panX,
      sy: (rx + ry) * 0.5 * view.zoom - (z || 0) * view.zoom + view.originY + view.panY,
      depth: rx + ry,
    };
  }

  function projectPoly(view, pts) {
    return pts.map(function (pt) {
      const q = project(view, pt[0], pt[1], pt[2] || 0);
      return [q.sx, q.sy];
    });
  }

  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    return a / 2;
  }

  // 圆 -> 正 N 边形（世界坐标，z 固定）
  function circlePoly(cx, cy, z, r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
    return pts;
  }

  // 地面椭圆（用于阴影），沿世界方向 ang 拉伸
  function ellipsePoly(cx, cy, z, rx, ry, ang, n) {
    const pts = [];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      pts.push([cx + ex * ca - ey * sa, cy + ex * sa + ey * ca, z]);
    }
    return pts;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function defaultLayers() {
    return { ground: true, buildings: true, trees: true, lamps: true, pedestrians: true, shadows: true, labels: true };
  }

  // 竖直小柱体（灯杆、树干）的可见侧面
  function columnFaces(view, x, y, half, z0, z1, fill, depth, sub, id, out) {
    const corners = [
      [x - half, y - half], [x + half, y - half],
      [x + half, y + half], [x - half, y + half],
    ];
    for (let e = 0; e < 4; e++) {
      const a = corners[e], b = corners[(e + 1) % 4];
      const pts = projectPoly(view, [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]);
      if (signedArea(pts) <= 0) continue; // 背面剔除
      out.push({ kind: 'poly', pts, fill, alpha: 1, depth, sub, id });
    }
  }

  // 行人某时刻位置（世界坐标）
  function pedestrianPos(scene, ped, t) {
    const L = scene.params.streetLength;
    let x = ped.startX + ped.speed * t;
    x = ((x + L / 2) % L + L) % L - L / 2;
    return { x, y: ped.y };
  }

  // 阴影方向：背离最近路灯；无路灯时用全局光向
  function shadowDir(scene, px, py) {
    let best = null, bestD = Infinity;
    for (const lamp of scene.lamps) {
      const dx = px - lamp.x, dy = py - lamp.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = { dx, dy }; }
    }
    if (!best) best = { dx: 1, dy: 0.6 };
    const len = Math.hypot(best.dx, best.dy);
    if (len < 1e-6) return { x: 1, y: 0 };
    return { x: best.dx / len, y: best.dy / len };
  }

  // ---------- 绘制指令流 ----------
  // 返回 { polys: [...], labels: [...] }，polys 已按 (depth, sub, id) 稳定排序。
  function buildDrawCommands(scene, view, layers, time) {
    layers = Object.assign(defaultLayers(), layers || {});
    const polys = [], labels = [];
    const push = (cmd) => polys.push(cmd);

    if (layers.ground) {
      scene.grounds.forEach((g, i) => {
        const hw = g.w / 2, hd = g.d / 2;
        push({
          kind: 'poly',
          pts: projectPoly(view, [
            [g.x - hw, g.y - hd, g.z], [g.x + hw, g.y - hd, g.z],
            [g.x + hw, g.y + hd, g.z], [g.x - hw, g.y + hd, g.z],
          ]),
          fill: g.color, alpha: 1, depth: -1e15, sub: i, id: g.id,
        });
      });
    }

    if (layers.buildings) {
      for (const b of scene.buildings) {
        const depth = project(view, b.x, b.y, 0).depth;
        const hw = b.w / 2, hd = b.d / 2;
        const c = [[b.x - hw, b.y - hd], [b.x + hw, b.y - hd], [b.x + hw, b.y + hd], [b.x - hw, b.y + hd]];
        for (let e = 0; e < 4; e++) {
          const a = c[e], d2 = c[(e + 1) % 4];
          const pts = projectPoly(view, [[a[0], a[1], 0], [d2[0], d2[1], 0], [d2[0], d2[1], b.h], [a[0], a[1], b.h]]);
          if (signedArea(pts) <= 0) continue;
          push({ kind: 'poly', pts, fill: shade(b.color, e % 2 === 0 ? 0.82 : 0.68), alpha: 1, depth, sub: 0, id: b.id });
        }
        push({
          kind: 'poly',
          pts: projectPoly(view, [[c[0][0], c[0][1], b.h], [c[1][0], c[1][1], b.h], [c[2][0], c[2][1], b.h], [c[3][0], c[3][1], b.h]]),
          fill: shade(b.color, 1.08), alpha: 1, depth, sub: 1, id: b.id,
        });
        if (layers.labels) {
          const top = project(view, b.x, b.y, b.h);
          labels.push({ id: 'label:' + b.id, x: top.sx, y: top.sy - 6, text: b.id + ' h=' + b.h.toFixed(1) });
        }
      }
    }

    if (layers.trees) {
      for (const t of scene.trees) {
        const depth = project(view, t.x, t.y, 0).depth;
        columnFaces(view, t.x, t.y, 0.09, 0, t.h * 0.55, '#7a5230', depth, 0, t.id, polys);
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(t.x, t.y, t.h * 0.7, t.r, 12)), fill: '#4d8a3d', alpha: 0.92, depth, sub: 1, id: t.id });
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(t.x, t.y, t.h, t.r * 0.7, 12)), fill: '#5fa04a', alpha: 0.92, depth, sub: 2, id: t.id });
      }
    }

    if (layers.lamps) {
      for (const l of scene.lamps) {
        const depth = project(view, l.x, l.y, 0).depth;
        columnFaces(view, l.x, l.y, 0.06, 0, l.h, '#3c3f45', depth, 0, l.id, polys);
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(l.x, l.y, l.h, 0.22, 10)), fill: '#ffe9a0', alpha: 1, depth, sub: 1, id: l.id });
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(l.x, l.y, l.h, 1.1, 16)), fill: '#ffedb8', alpha: 0.18, depth, sub: 2, id: l.id });
      }
    }

    if (layers.pedestrians) {
      scene.pedestrians.forEach((ped, i) => {
        const pos = pedestrianPos(scene, ped, time);
        const depth = project(view, pos.x, pos.y, 0).depth;
        const hue = (i * 67) % 360;
        if (layers.shadows) {
          const dir = shadowDir(scene, pos.x, pos.y);
          const ang = Math.atan2(dir.y, dir.x);
          const cx = pos.x + dir.x * 0.9, cy = pos.y + dir.y * 0.9;
          push({ kind: 'poly', pts: projectPoly(view, ellipsePoly(cx, cy, 0.03, 0.85, 0.3, ang, 12)), fill: '#1a1a2a', alpha: 0.35, depth, sub: -1, id: ped.id + ':shadow' });
        }
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(pos.x, pos.y, 0.55, 0.26, 10)), fill: 'hsl(' + hue + ',55%,50%)', alpha: 1, depth, sub: 0, id: ped.id });
        push({ kind: 'poly', pts: projectPoly(view, circlePoly(pos.x, pos.y, 1.0, 0.17, 10)), fill: '#f2c89b', alpha: 1, depth, sub: 1, id: ped.id });
      });
    }

    polys.sort((a, b) => (a.depth - b.depth) || (a.sub - b.sub) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { polys, labels };
  }

  // ---------- 动画时钟（暂停冻结、恢复不跳帧） ----------
  function createClock() {
    return {
      time: 0, paused: false, lastTs: null,
      tick(ts) {
        if (this.lastTs === null) { this.lastTs = ts; return this.time; }
        const dt = Math.max(0, (ts - this.lastTs) / 1000);
        this.lastTs = ts;
        if (!this.paused) this.time += dt;
        return this.time;
      },
      pause() { this.paused = true; },
      resume() { this.paused = false; },
    };
  }

  // ---------- Canvas 2D 渲染（浏览器预览 / 导出共用） ----------
  function drawCommands(ctx, cmds, width, height, background) {
    ctx.fillStyle = background || '#26303b';
    ctx.fillRect(0, 0, width, height);
    for (const c of cmds.polys) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = c.fill;
      ctx.beginPath();
      ctx.moveTo(c.pts[0][0], c.pts[0][1]);
      for (let i = 1; i < c.pts.length; i++) ctx.lineTo(c.pts[i][0], c.pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (const l of cmds.labels) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = '#1c2733';
      ctx.fillText(l.text, l.x, l.y);
    }
  }

  return {
    PARAM_LIMITS, HEIGHT_MIN, HEIGHT_MAX,
    defaultParams, validateParams, generateScene,
    defaultView, defaultLayers, project, projectPoly, signedArea,
    pedestrianPos, shadowDir, buildDrawCommands, createClock, drawCommands,
  };
});
