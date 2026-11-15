// 核心几何引擎：二值化 -> 连通域过滤 -> Marching Squares 轮廓 -> 简化/平滑
// 全部为纯函数，可同时在浏览器与 Node 测试中运行。

export function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // ITU-R BT.601 亮度
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, width, height };
}

// 4-连通组件标注，返回每个暗像素的组件 id（-1 表示背景）与组件清单
export function labelComponents(gray, width, height, threshold, minArea) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];
  for (let start = 0; start < gray.length; start += 1) {
    if (gray[start] > threshold || labels[start] !== -1) continue;
    const id = components.length;
    const comp = { id, area: 0, minX: width, minY: height, maxX: -1, maxY: -1, sumX: 0, sumY: 0 };
    labels[start] = id;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx / width) | 0;
      comp.area += 1;
      comp.sumX += x;
      comp.sumY += y;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      // 4 邻域，保证 1px 细线沿走向不会被撕裂
      if (x > 0) {
        const n = idx - 1;
        if (labels[n] === -1 && gray[n] <= threshold) { labels[n] = id; stack.push(n); }
      }
      if (x + 1 < width) {
        const n = idx + 1;
        if (labels[n] === -1 && gray[n] <= threshold) { labels[n] = id; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - width;
        if (labels[n] === -1 && gray[n] <= threshold) { labels[n] = id; stack.push(n); }
      }
      if (y + 1 < height) {
        const n = idx + width;
        if (labels[n] === -1 && gray[n] <= threshold) { labels[n] = id; stack.push(n); }
      }
    }
    components.push(comp);
  }
  // 过滤孤点与小于最小区域的组件
  const kept = [];
  for (const comp of components) {
    comp.centroid = { x: comp.sumX / comp.area, y: comp.sumY / comp.area };
    if (comp.area >= minArea) kept.push(comp);
  }
  const removed = components.length - kept.length;
  return { labels, components: kept, removedCount: removed, allCount: components.length };
}

// 在灰度图上抹除被过滤组件，使后续等值线追踪忽略孤点
export function eraseRemoved(gray, labels, keptIds) {
  const keep = new Set(keptIds);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const lab = labels[i];
    out[i] = lab === -1 || keep.has(lab) ? gray[i] : 255;
  }
  return out;
}

// Douglas-Peucker 简化（闭合环）
export function simplifyRing(points, epsilon) {
  if (epsilon <= 0 || points.length <= 4) return points.slice();
  const n = points.length;
  const keep = new Uint8Array(n).fill(1);
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    if (last <= first + 1) continue;
    const ax = points[first][0], ay = points[first][1];
    const bx = points[last][0], by = points[last][1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let maxD = -1, maxIdx = -1;
    for (let i = first + 1; i < last; i += 1) {
      if (!keep[i]) continue;
      const px = points[i][0], py = points[i][1];
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(len2);
      if (d > maxD) { maxD = d; maxIdx = i; }
    }
    if (maxD > epsilon && maxIdx > 0) {
      stack.push([first, maxIdx], [maxIdx, last]);
    } else {
      for (let i = first + 1; i < last; i += 1) keep[i] = 0;
    }
  }
  const result = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) result.push(points[i]);
  return result;
}

// Chaikin 切角平滑（闭合环），iterations 越大越平滑
export function smoothRing(points, iterations) {
  let ring = points;
  for (let it = 0; it < iterations; it += 1) {
    const next = [];
    const n = ring.length;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    ring = next;
  }
  return ring;
}

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
