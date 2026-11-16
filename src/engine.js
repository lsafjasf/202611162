// Text-on-curve layout engine. Pure & deterministic: no DOM, no canvas.
// A measurer function is injected so the same code runs in the browser
// (canvas measureText) and in Node tests (deterministic fallback metrics).

export const DEFAULTS = Object.freeze({
  text: '你好 World 2026',
  fontSize: 48,
  letterSpacing: 4,
  baselineOffset: 0,
  radius: 420,
  arcAngle: 120,
  align: 'center',
  minGapRatio: 0.08,
  animSpeed: 12,
  zoom: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
  showSafeArea: true,
  width: 960,
  height: 600,
  safeMargin: 48,
});

export const LIMITS = Object.freeze({
  fontSize: [4, 400],
  letterSpacing: [-100, 500],
  baselineOffset: [-1000, 1000],
  radius: [20, 1e6],
  arcAngle: [1, 360],
  minGapRatio: [0, 1],
  animSpeed: [-500, 500],
  zoom: [0.05, 40],
  rotation: [-3600, 3600],
  safeMargin: [0, 400],
  width: [100, 8192],
  height: [100, 8192],
});

const ALIGN_VALUES = ['start', 'center', 'end'];

export function validateParams(raw) {
  const errors = [];
  const params = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      if (raw[key] !== undefined) params[key] = raw[key];
    }
  }
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(params[key]);
    if (!Number.isFinite(v)) {
      errors.push(`参数 ${key} 不是有效数字: ${JSON.stringify(params[key])}`);
      params[key] = DEFAULTS[key];
      continue;
    }
    if (v < lo || v > hi) {
      errors.push(`参数 ${key}=${v} 超出范围 [${lo}, ${hi}]，已夹取`);
      params[key] = Math.min(hi, Math.max(lo, v));
    } else {
      params[key] = v;
    }
  }
  if (typeof params.text !== 'string' || params.text.length === 0) {
    errors.push('文字内容不能为空');
    params.text = DEFAULTS.text;
  }
  if (params.text.length > 500) {
    errors.push(`文字过长 (${params.text.length} 字符)，已截断到 500`);
    params.text = params.text.slice(0, 500);
  }
  if (!ALIGN_VALUES.includes(params.align)) {
    errors.push(`未知对齐方式 ${JSON.stringify(params.align)}，已重置为 center`);
    params.align = 'center';
  }
  params.showSafeArea = Boolean(params.showSafeArea);
  return { params, errors };
}

// Tokenizer: CJK chars are single atoms; Latin/digit runs are unbreakable
// word atoms; whitespace is flexible glue; everything else is punctuation.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;
const WORD_RE = /[A-Za-z0-9]/;
const WORD_JOIN_RE = /['’\-_+.]/;

export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      tokens.push({ kind: 'space', text: ' ' });
      i += 1;
      continue;
    }
    if (WORD_RE.test(ch)) {
      let j = i + 1;
      while (j < text.length) {
        const c = text[j];
        if (WORD_RE.test(c)) { j += 1; continue; }
        if (WORD_JOIN_RE.test(c) && j + 1 < text.length && WORD_RE.test(text[j + 1])) {
          j += 1; continue;
        }
        break;
      }
      tokens.push({ kind: 'word', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (CJK_RE.test(ch)) {
      tokens.push({ kind: 'cjk', text: ch });
      i += 1;
      continue;
    }
    tokens.push({ kind: 'punct', text: ch });
    i += 1;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Deterministic fallback measurer (used by Node tests and as a safety net
// when no canvas is available). Widths are fractions of fontSize.
// ---------------------------------------------------------------------------
export function createFallbackMeasurer(fontSize) {
  const widthOf = (ch) => {
    if (/\s/.test(ch)) return fontSize * 0.33;
    if (CJK_RE.test(ch)) return fontSize * 1.0;
    if (WORD_RE.test(ch)) return fontSize * 0.56;
    return fontSize * 0.36;
  };
  return {
    measure(atom) {
      let w = 0;
      for (const ch of atom.text) w += widthOf(ch);
      return w;
    },
    metrics: { ascent: fontSize * 0.8, descent: fontSize * 0.2 },
  };
}

// ---------------------------------------------------------------------------
// Curve: circular arc centered in the canvas. s = arc length from path start.
// The arc bulges upward (center of circle below the arc midpoint).
// ---------------------------------------------------------------------------
export function makeCurve(params) {
  const R = params.radius;
  const theta = (params.arcAngle * Math.PI) / 180;
  const length = R * theta;
  const cx = params.width / 2;
  const cy = params.height / 2 + R * Math.cos(theta / 2);
  const startAngle = -Math.PI / 2 - theta / 2; // leftmost point of the arc
  const pointAt = (s, normalOffset = 0) => {
    const a = startAngle + s / R;
    const r = R + normalOffset; // +offset moves outward (away from center)
    return {
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
      angle: a + Math.PI / 2, // tangent direction
      radius: r,
    };
  };
  return { R, theta, length, cx, cy, startAngle, pointAt };
}

// Stable layer table: occlusion/transparency order never changes at runtime.
export const LAYERS = Object.freeze([
  { name: 'background', z: 0, alpha: 1 },
  { name: 'grid', z: 10, alpha: 1 },
  { name: 'safeArea', z: 20, alpha: 1 },
  { name: 'curveGuide', z: 30, alpha: 0.55 },
  { name: 'text', z: 40, alpha: 1 },
  { name: 'annotation', z: 50, alpha: 1 },
  { name: 'overlay', z: 60, alpha: 1 },
]);

export function layerIndex(name) {
  const i = LAYERS.findIndex((l) => l.name === name);
  if (i < 0) throw new Error(`unknown layer ${name}`);
  return LAYERS[i].z;
}

// ---------------------------------------------------------------------------
// Layout. Returns a fully deterministic world-space scene:
//   drawList    - flat, z-ordered render items (stable occlusion order)
//   annotations - world-space anchors (safe area, baseline, atom anchors)
//   warnings    - non-fatal issues (e.g. outside safe area)
//   errors      - fatal issues; when non-empty ok=false and drawList is empty
// ---------------------------------------------------------------------------
export function layout(rawParams, measurer, opts = {}) {
  // Validation notices (clamped/invalid input, auto-corrected) are reported
  // as warnings; only fatal geometry problems go into `errors`.
  const { params, errors: notices } = validateParams(rawParams);
  const fatal = [];
  const warnings = [...notices];
  const time = Number.isFinite(opts.time) ? opts.time : 0;

  if (!measurer || typeof measurer.measure !== 'function') {
    measurer = createFallbackMeasurer(params.fontSize);
  }
  const ascent = measurer.metrics?.ascent ?? params.fontSize * 0.8;
  const descent = measurer.metrics?.descent ?? params.fontSize * 0.2;

  const curve = makeCurve(params);
  if (!(curve.length > 0)) {
    fatal.push('曲线路径长度为零，无法排布文字');
  }
  // Text band radii: baseline at R+offset, glyphs reach outward by ascent
  // and inward by descent. Spacing collapses at the smallest radius.
  const rBase = curve.R + params.baselineOffset;
  const rMin = rBase - descent;
  if (rBase <= 0) {
    fatal.push(`基线半径 ${rBase.toFixed(1)}px ≤ 0：请减小基线偏移或增大半径`);
  } else if (rMin <= 0) {
    fatal.push(
      `文字带内缘半径 ${rMin.toFixed(1)}px ≤ 0（弧度过急/基线偏移过大），` +
      '字形会穿过圆心，请增大半径或减小基线偏移'
    );
  }
  if (fatal.length > 0) {
    return {
      ok: false, errors: fatal, warnings, params, curve,
      atoms: [], drawList: [], annotations: [], stats: null,
    };
  }

  // --- measure atoms -------------------------------------------------------
  const tokens = tokenize(params.text);
  const atoms = tokens.map((tok, i) => ({
    id: `atom-${i}`,
    kind: tok.kind,
    text: tok.text,
    width: measurer.measure(tok),
    start: 0, // arc-length start, filled below
  }));

  // --- natural advances + anti-collapse at sharp bends ---------------------
  // Edge gap g at baseline radius rBase becomes g*r/rBase at radius r.
  // Enforce gap at rMin >= minGap so spacing never collapses on the inside
  // of a bend. Words are single atoms, so this never splits a word.
  const minGap = params.minGapRatio * params.fontSize;
  const neededGap = (minGap * rBase) / rMin;
  let cursor = 0;
  let collapseFixes = 0;
  for (let i = 0; i < atoms.length; i += 1) {
    let start = cursor;
    if (i > 0) {
      const prev = atoms[i - 1];
      const minStart = prev.start + prev.width + neededGap;
      if (start < minStart) { start = minStart; collapseFixes += 1; }
    }
    atoms[i].start = start;
    cursor = start + atoms[i].width + params.letterSpacing;
  }
  const total = atoms.length
    ? atoms[atoms.length - 1].start + atoms[atoms.length - 1].width
    : 0;

  // --- alignment + animation offset ---------------------------------------
  let alignOffset = 0;
  if (params.align === 'center') alignOffset = (curve.length - total) / 2;
  else if (params.align === 'end') alignOffset = curve.length - total;
  const animOffset = params.animSpeed * time;
  if (total > curve.length + 1e-6) {
    warnings.push(
      `文字总长 ${total.toFixed(1)}px 超出曲线长度 ${curve.length.toFixed(1)}px`
    );
  }
  if (collapseFixes > 0) {
    warnings.push(`急弯处已加宽 ${collapseFixes} 处字距以防止塌缩`);
  }

  // --- place atoms on the curve -------------------------------------------
  const safe = {
    x: params.safeMargin,
    y: params.safeMargin,
    w: params.width - params.safeMargin * 2,
    h: params.height - params.safeMargin * 2,
  };
  const placed = [];
  const outlierIds = [];
  for (const atom of atoms) {
    const sMid = atom.start + atom.width / 2 + alignOffset + animOffset;
    const p = curve.pointAt(sMid, params.baselineOffset);
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    // corners in the atom's tangent frame, then to world space
    const hw = atom.width / 2;
    const corners = [
      [-hw, -descent], [hw, -descent], [hw, ascent], [-hw, ascent],
    ].map(([tx, tn]) => ({
      x: p.x + tx * cos - tn * sin,
      y: p.y + tx * sin + tn * cos,
    }));
    const outside = corners.some(
      (c) => c.x < safe.x || c.x > safe.x + safe.w
          || c.y < safe.y || c.y > safe.y + safe.h
    );
    if (outside) outlierIds.push(atom.id);
    placed.push({ ...atom, sMid, x: p.x, y: p.y, angle: p.angle, corners, outside });
  }
  if (outlierIds.length > 0) {
    warnings.push(`⚠ ${outlierIds.length} 个文字单元超出安全区域`);
  }

  // --- annotations (world space; view transform applied at draw time) -----
  const baselineSamples = [];
  const guideSamples = [];
  const samples = 64;
  for (let i = 0; i <= samples; i += 1) {
    const s = (curve.length * i) / samples;
    const b = curve.pointAt(s, params.baselineOffset);
    const g = curve.pointAt(s, 0);
    baselineSamples.push([round3(b.x), round3(b.y)]);
    guideSamples.push([round3(g.x), round3(g.y)]);
  }
  const annotations = [
    { id: 'safe-area', kind: 'rect', layer: 'safeArea',
      points: [[safe.x, safe.y], [safe.x + safe.w, safe.y],
               [safe.x + safe.w, safe.y + safe.h], [safe.x, safe.y + safe.h]] },
    { id: 'curve-guide', kind: 'polyline', layer: 'curveGuide', points: guideSamples },
    { id: 'baseline', kind: 'polyline', layer: 'annotation', points: baselineSamples },
    ...placed.map((a) => ({
      id: `anchor-${a.id}`, kind: 'point', layer: 'annotation',
      points: [[round3(a.x), round3(a.y)]],
    })),
  ];

  // --- flat z-ordered draw list (stable occlusion/transparency order) -----
  const drawList = [
    { id: 'bg', type: 'background', layer: 'background',
      z: layerIndex('background'), alpha: 1 },
    { id: 'grid', type: 'grid', layer: 'grid', z: layerIndex('grid'), alpha: 1 },
    { id: 'safe-area', type: 'safeArea', layer: 'safeArea',
      z: layerIndex('safeArea'), alpha: 1, rect: safe },
    { id: 'curve-guide', type: 'polyline', layer: 'curveGuide',
      z: layerIndex('curveGuide'), alpha: 0.55, points: guideSamples },
    ...placed.map((a) => ({
      id: a.id, type: 'atom', layer: 'text', z: layerIndex('text'), alpha: 1,
      kind: a.kind, text: a.text, x: a.x, y: a.y, angle: a.angle,
      width: a.width, outside: a.outside,
    })),
    { id: 'baseline', type: 'polyline', layer: 'annotation',
      z: layerIndex('annotation'), alpha: 1, points: baselineSamples },
  ].sort((m, n) => m.z - n.z || (m.id < n.id ? -1 : 1));

  const stats = {
    atomCount: atoms.length,
    wordCount: atoms.filter((a) => a.kind === 'word').length,
    cjkCount: atoms.filter((a) => a.kind === 'cjk').length,
    drawCount: drawList.length,
    totalLength: round3(total),
    pathLength: round3(curve.length),
    collapseFixes,
    outOfSafeArea: outlierIds.length,
  };
  return {
    ok: true, errors: [], warnings, params, curve,
    atoms: placed, drawList, annotations, stats,
  };
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ---------------------------------------------------------------------------
// View transform: world -> screen. Annotations live in world space, so they
// cannot drift under zoom/rotate; this maps both text and annotations.
// ---------------------------------------------------------------------------
export function makeViewTransform(params) {
  const cx = params.width / 2;
  const cy = params.height / 2;
  const rot = (params.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const k = params.zoom;
  return {
    apply(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      return {
        x: cx + params.panX + k * (dx * cos - dy * sin),
        y: cy + params.panY + k * (dx * sin + dy * cos),
      };
    },
    scale: k,
    rotation: rot,
  };
}

// ---------------------------------------------------------------------------
// Animation clock: pause freezes accumulated time; resume continues from the
// frozen value, so phase is continuous and no frame is skipped.
// ---------------------------------------------------------------------------
export function createAnimClock() {
  let accumulated = 0;
  let startedAt = null;
  return {
    now(t) {
      return startedAt === null ? accumulated : accumulated + (t - startedAt);
    },
    pause(t) {
      if (startedAt !== null) {
        accumulated += t - startedAt;
        startedAt = null;
      }
      return accumulated;
    },
    resume(t) {
      if (startedAt === null) startedAt = t;
      return accumulated;
    },
    get paused() { return startedAt === null; },
    reset() { accumulated = 0; startedAt = null; },
  };
}

// ---------------------------------------------------------------------------
// Serialization: versioned JSON round-trip for save/load of parameter sets.
// ---------------------------------------------------------------------------
export const STATE_VERSION = 1;

export function serializeParams(params) {
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) clean[key] = params[key];
  return JSON.stringify({ version: STATE_VERSION, params: clean });
}

export function deserializeParams(json) {
  try {
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || !data.params) {
      return { params: null, errors: ['存档格式无效：缺少 params 字段'] };
    }
    if (data.version !== STATE_VERSION) {
      return { params: null, errors: [`存档版本 ${data.version} 不受支持`] };
    }
    const { params, errors } = validateParams(data.params);
    return { params, errors };
  } catch (e) {
    return { params: null, errors: [`存档解析失败: ${e.message}`] };
  }
}

// ---------------------------------------------------------------------------
// SVG export. Keeps the text-on-path: the curve is emitted as a <path> and
// the string as <textPath>, plus exact per-atom placements as a fallback
// group so the export renders identically everywhere.
// ---------------------------------------------------------------------------
export function exportSVG(scene) {
  const p = scene.params;
  const c = scene.curve;
  const start = c.pointAt(0, p.baselineOffset);
  const end = c.pointAt(c.length, p.baselineOffset);
  const r = c.R + p.baselineOffset;
  const largeArc = p.arcAngle > 180 ? 1 : 0;
  const d = `M ${round3(start.x)} ${round3(start.y)} ` +
    `A ${round3(r)} ${round3(r)} 0 ${largeArc} 1 ` +
    `${round3(end.x)} ${round3(end.y)}`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${p.width}" height="${p.height}" ` +
    `viewBox="0 0 ${p.width} ${p.height}">`);
  lines.push(`  <defs>`);
  lines.push(`    <path id="textCurve" d="${d}" fill="none"/>`);
  lines.push(`  </defs>`);
  lines.push(`  <rect width="100%" height="100%" fill="#ffffff"/>`);
  lines.push(`  <use href="#textCurve" stroke="#94a3b8" ` +
    `stroke-opacity="0.55" fill="none" stroke-dasharray="6 4"/>`);
  lines.push(`  <text font-family="sans-serif" font-size="${p.fontSize}" ` +
    `fill="#1e293b"><textPath href="#textCurve" ` +
    `startOffset="${round3(startOffsetOf(scene))}">${esc(p.text)}` +
    `</textPath></text>`);
  lines.push(`  <g id="exact-placement" font-family="sans-serif" ` +
    `font-size="${p.fontSize}" fill="#1e293b">`);
  for (const a of scene.atoms) {
    const deg = round3((a.angle * 180) / Math.PI);
    lines.push(`    <text transform="translate(${round3(a.x)} ` +
      `${round3(a.y)}) rotate(${deg})" text-anchor="middle" ` +
      `data-kind="${a.kind}">${esc(a.text)}</text>`);
  }
  lines.push(`  </g>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

function startOffsetOf(scene) {
  if (scene.atoms.length === 0) return 0;
  return scene.atoms[0].sMid - scene.atoms[0].width / 2;
}

// ---------------------------------------------------------------------------
// Structural summary + FNV-1a hash: a stable digest of object counts and
// geometry positions, used to compare recomputes and save/load round-trips.
// ---------------------------------------------------------------------------
export function summarizeScene(scene) {
  const parts = [];
  parts.push(`ok=${scene.ok}`);
  parts.push(`stats=${JSON.stringify(scene.stats)}`);
  for (const item of scene.drawList) {
    if (item.type === 'atom') {
      parts.push(`atom:${item.id}:${item.kind}:${item.text}:` +
        `${round3(item.x)},${round3(item.y)},${round3(item.angle)}:` +
        `${round3(item.width)}:z${item.z}:a${item.alpha}`);
    } else {
      parts.push(`${item.type}:${item.id}:z${item.z}:a${item.alpha}`);
    }
  }
  for (const ann of scene.annotations) {
    parts.push(`ann:${ann.id}:${JSON.stringify(ann.points)}`);
  }
  parts.push(`warn=${scene.warnings.join('|')}`);
  parts.push(`err=${scene.errors.join('|')}`);
  return parts.join('\n');
}

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function sceneHash(scene) {
  return fnv1a(summarizeScene(scene));
}
