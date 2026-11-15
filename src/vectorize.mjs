// Marching Squares 等值线追踪 + 向量化主管线
import { labelComponents, eraseRemoved, simplifyRing, smoothRing, fnv1a } from './geometry.mjs';

// 单元四个角位 -> 位掩码；边编号：0=上 1=右 2=下 3=左
const TABLE = {
  0: [], 15: [],
  1: [[3, 0]], 14: [[0, 3]],
  2: [[0, 1]], 13: [[1, 0]],
  3: [[3, 1]], 12: [[1, 3]],
  4: [[1, 2]], 11: [[2, 1]],
  6: [[0, 2]], 9: [[2, 0]],
  7: [[3, 2]], 8: [[2, 3]],
  // 鞍点：采用“左上+右下为暗”的一致性分解，避免相邻单元出现交叉
  5: [[3, 0], [1, 2]], 10: [[0, 1], [2, 3]],
};

function interpolate(g0, g1, threshold) {
  if (Math.abs(g1 - g0) < 1e-9) return 0.5;
  const t = (threshold - g0) / (g1 - g0);
  return Math.min(1, Math.max(0, t));
}

// 将边交点转为像素坐标；需要知道边方向，因此在构建段时直接存坐标
function materialize(grid, width, height, threshold) {
  const xy = new Map();
  const get = (key, kind, x, y, g0, g1) => {
    let q = xy.get(key);
    if (!q) {
      const t = interpolate(g0, g1, threshold);
      q = kind === 'h' ? [x + t, y] : [x, y + t];
      xy.set(key, q);
    }
    return q;
  };
  const segments = [];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const i00 = y * width + x;
      const g00 = grid[i00], g10 = grid[i00 + 1];
      const g01 = grid[i00 + width], g11 = grid[i00 + width + 1];
      let bits = 0;
      if (g00 <= threshold) bits |= 1;
      if (g10 <= threshold) bits |= 2;
      if (g11 <= threshold) bits |= 4;
      if (g01 <= threshold) bits |= 8;
      for (const [ea, eb] of TABLE[bits]) {
        const one = (e) => {
          if (e === 0) return get(`h_${x}_${y}`, 'h', x, y, g00, g10);
          if (e === 2) return get(`h_${x}_${y + 1}`, 'h', x, y + 1, g01, g11);
          if (e === 1) return get(`v_${x + 1}_${y}`, 'v', x + 1, y, g10, g11);
          return get(`v_${x}_${y}`, 'v', x, y, g00, g01);
        };
        segments.push([one(ea), one(eb)]);
      }
    }
  }
  return segments;
}

// 把线段拼接成闭合环
function assembleRings(segments) {
  const keyOf = (p) => `${Math.round(p[0] * 1e6)}_${Math.round(p[1] * 1e6)}`;
  const adj = new Map();
  for (const [a, b] of segments) {
    const ka = keyOf(a), kb = keyOf(b);
    if (!adj.has(ka)) adj.set(ka, { p: a, next: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, next: [] });
    adj.get(ka).next.push(kb);
    adj.get(kb).next.push(ka);
  }
  const visited = new Set();
  const rings = [];
  for (const [startKey] of adj) {
    if (visited.has(startKey)) continue;
    const ring = [];
    let prev = null;
    let cur = startKey;
    while (cur && !visited.has(cur)) {
      visited.add(cur);
      const node = adj.get(cur);
      ring.push(node.p);
      const options = node.next.filter((k) => k !== prev && !visited.has(k));
      prev = cur;
      cur = options[0] ?? node.next.find((k) => k !== prev) ?? null;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i += 1) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 被其他环包含的环视为孔洞，反转为逆时针，保证复合路径镂空正确
function orientHoles(rings) {
  for (let i = 0; i < rings.length; i += 1) {
    const inner = rings[i];
    const center = inner[0];
    for (let j = 0; j < rings.length; j += 1) {
      if (i === j || inner.length >= rings[j].length) continue;
      if (pointInRing(center, rings[j])) {
        rings[i] = inner.slice().reverse();
        break;
      }
    }
  }
}

function ringToPath(ring) {
  const d = ring.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('');
  return `${d}Z`;
}

// 主管线：输入灰度图与参数，输出可序列化的几何状态
export function vectorize(grayLike, params) {
  const { gray, width, height } = grayLike;
  const { threshold, smoothness, minArea } = params;
  const labeled = labelComponents(gray, width, height, threshold, minArea);
  const keptIds = labeled.components.map((c) => c.id);
  const cleaned = labeled.removedCount ? eraseRemoved(gray, labeled.labels, keptIds) : gray;
  const segments = materialize(cleaned, width, height, threshold);
  let rings = assembleRings(segments);
  // 先统一为顺时针（面积为正），孔洞环稍后按包含关系反转为逆时针
  rings = rings.map((ring) => (ringArea(ring) < 0 ? ring.slice().reverse() : ring));
  orientHoles(rings);
  const iterations = Math.max(0, Math.min(5, Math.round(smoothness)));
  const epsilon = Math.max(0, smoothness * 0.15);
  const ringEntries = [];
  let nodeCount = 0;
  rings.forEach((ring, index) => {
    const simplified = simplifyRing(ring, epsilon);
    const finalRing = iterations ? smoothRing(simplified, iterations) : simplified;
    nodeCount += finalRing.length;
    const comp = nearestComponent(finalRing, labeled.components);
    ringEntries.push({
      componentId: comp ? comp.id : -1,
      area: Math.abs(ringArea(ring)),
      bounds: ringBounds(finalRing),
      centroid: ringCentroid(finalRing),
      pointCount: finalRing.length,
      d: ringToPath(finalRing),
      points: finalRing.map((p) => [Number(p[0].toFixed(3)), Number(p[1].toFixed(3))]),
    });
  });
  // 同一组件的外环与内环合并为一条 evenodd 复合路径，保证孔洞正确镂空
  const byComponent = new Map();
  for (const entry of ringEntries) {
    if (!byComponent.has(entry.componentId)) byComponent.set(entry.componentId, []);
    byComponent.get(entry.componentId).push(entry);
  }
  const shapes = [];
  const componentIds = [...byComponent.keys()].sort((a, b) => a - b);
  componentIds.forEach((componentId, shapeIndex) => {
    const entries = byComponent.get(componentId)
      .sort((a, b) => b.area - a.area || a.centroid.x - b.centroid.x);
    const outer = entries[0];
    const holes = entries.slice(1);
    shapes.push({
      id: `shape_${shapeIndex}`,
      componentId,
      area: entries.reduce((sum, e) => sum + e.area, 0),
      bounds: outer.bounds,
      centroid: outer.centroid,
      pointCount: entries.reduce((sum, e) => sum + e.pointCount, 0),
      ringCount: entries.length,
      holes: holes.map((h) => h.d),
      d: entries.map((e) => e.d).join(' '),
      points: entries.flatMap((e) => e.points),
    });
  });
  nodeCount = shapes.reduce((sum, s) => sum + s.pointCount, 0);
  const svg = buildSvg(shapes, width, height, params);
  const summary = buildSummary({ width, height, params, shapes, nodeCount, labeled });
  return {
    width, height, params: { ...params },
    shapes, svg, nodeCount,
    stats: {
      componentCount: labeled.allCount,
      keptCount: labeled.components.length,
      removedCount: labeled.removedCount,
      ringCount: rings.length,
      nodeCount,
    },
    summary,
  };
}

function nearestComponent(ring, components) {
  if (!components.length) return null;
  const c = ringCentroid(ring);
  let best = null, bestD = Infinity;
  for (const comp of components) {
    const dx = comp.centroid.x - c.x, dy = comp.centroid.y - c.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = comp; }
  }
  return best;
}

function ringBounds(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function ringCentroid(ring) {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  return { x: sx / ring.length, y: sy / ring.length };
}

function buildSvg(shapes, width, height, params) {
  const body = shapes
    .map((s) => `  <path id="${s.id}" fill="#111111" fill-rule="evenodd" stroke="none" d="${s.d}"/>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n` +
    `  <title>vectorized threshold=${params.threshold} smoothness=${params.smoothness} minArea=${params.minArea}</title>\n${body}\n</svg>\n`;
}

function buildSummary({ width, height, params, shapes, nodeCount, labeled }) {
  const parts = shapes.map((s) => `${s.id}:${s.componentId}:${s.pointCount}:${s.d.length}`).join('|');
  const basis = `${width}x${height}|t${params.threshold}|s${params.smoothness}|m${params.minArea}|n${nodeCount}|c${labeled.components.length}|${parts}`;
  return {
    hash: fnv1a(basis),
    nodeCount,
    shapeCount: shapes.length,
    basis: basis.slice(0, 500),
  };
}

export { ringArea, ringToPath, assembleRings, materialize };
