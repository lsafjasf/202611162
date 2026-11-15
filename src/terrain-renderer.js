import {
  HEIGHT_SCALE_METERS,
  clamp,
  digestString,
  lerp,
  sampleSectionAt,
} from "./terrain-engine.js";

export const DEFAULT_CAMERA = Object.freeze({
  yaw: 34,
  pitch: 34,
  zoom: 1,
  panX: 0,
  panY: 0,
});

export const CAMERA_LIMITS = Object.freeze({
  minYaw: -180,
  maxYaw: 180,
  minPitch: 12,
  maxPitch: 76,
  minZoom: 0.52,
  maxZoom: 2.4,
  maxPan: 0.3,
});

export function normalizeCamera(input = {}) {
  return {
    yaw: clamp(Number(input.yaw ?? DEFAULT_CAMERA.yaw), CAMERA_LIMITS.minYaw, CAMERA_LIMITS.maxYaw),
    pitch: clamp(Number(input.pitch ?? DEFAULT_CAMERA.pitch), CAMERA_LIMITS.minPitch, CAMERA_LIMITS.maxPitch),
    zoom: clamp(Number(input.zoom ?? DEFAULT_CAMERA.zoom), CAMERA_LIMITS.minZoom, CAMERA_LIMITS.maxZoom),
    panX: clamp(Number(input.panX ?? DEFAULT_CAMERA.panX), -CAMERA_LIMITS.maxPan, CAMERA_LIMITS.maxPan),
    panY: clamp(Number(input.panY ?? DEFAULT_CAMERA.panY), -CAMERA_LIMITS.maxPan, CAMERA_LIMITS.maxPan),
  };
}

export function createProjection(cameraInput, width, height, maxHeight = 1.4) {
  const camera = normalizeCamera(cameraInput);
  const yaw = (camera.yaw * Math.PI) / 180;
  const pitch = (camera.pitch * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  const horizontalSpan = 2.05 * sinPitch * 0.72 + Math.max(1.2, maxHeight) * cosPitch * 0.92;
  const fittedScale = (height * 0.8) / Math.max(0.8, horizontalSpan);
  const scale = Math.min(width * 0.37, fittedScale) * camera.zoom;
  const originX = width / 2 + camera.panX * width;
  const originY = height * 0.52 + camera.panY * height;

  function project(point) {
    const x1 = point.x * cosYaw - point.z * sinYaw;
    const z1 = point.x * sinYaw + point.z * cosYaw;
    return {
      x: originX + x1 * scale,
      y: originY + z1 * sinPitch * scale * 0.72 - point.y * cosPitch * scale * 0.92,
      depth: x1 * cosPitch + z1 * sinPitch + point.y * cosPitch * 0.42,
    };
  }

  function unprojectBase(screenX, screenY) {
    const x1 = (screenX - originX) / scale;
    const z1 = (screenY - originY) / (sinPitch * scale * 0.72);
    return {
      x: x1 * cosYaw + z1 * sinYaw,
      z: -x1 * sinYaw + z1 * cosYaw,
    };
  }

  return { camera, project, unprojectBase, scale, originX, originY };
}

function mixColor(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

const COLOR_STOPS = [
  [0, [10, 37, 37]],
  [0.18, [18, 57, 50]],
  [0.38, [44, 92, 70]],
  [0.58, [102, 124, 82]],
  [0.76, [163, 159, 109]],
  [0.9, [214, 193, 144]],
  [1, [244, 225, 177]],
];

function terrainColor(t) {
  const value = clamp(t, 0, 1);
  for (let index = 1; index < COLOR_STOPS.length; index += 1) {
    if (value <= COLOR_STOPS[index][0]) {
      const [start, from] = COLOR_STOPS[index - 1];
      const [end, to] = COLOR_STOPS[index];
      return mixColor(from, to, (value - start) / (end - start));
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

function rgba(color, alpha = 1) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function shadeColor(color, amount) {
  return color.map((channel) => Math.round(clamp(channel * amount, 0, 255)));
}

function prepareCanvas(canvas, width, height, ratio = window.devicePixelRatio || 1) {
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

function hashNumbers(values) {
  return digestString(values.join(","));
}

let contourCache = new WeakMap();

function contourSegmentsFor(terrain) {
  if (contourCache.has(terrain)) return contourCache.get(terrain);
  const levels = [0.18, 0.32, 0.48, 0.64, 0.8, 0.96, 1.12, 1.28, 1.44];
  const segments = [];
  const stride = terrain.params.resolution + 1;
  const corners = terrain.field.points;

  function crossing(a, b, level) {
    const delta = b.y - a.y;
    if (Math.abs(delta) < 1e-8) return null;
    const t = clamp((level - a.y) / delta, 0, 1);
    return {
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      y: level,
    };
  }

  for (const level of levels) {
    for (let iz = 0; iz < terrain.params.resolution; iz += 1) {
      for (let ix = 0; ix < terrain.params.resolution; ix += 1) {
        const p00 = corners[iz * stride + ix];
        const p10 = corners[iz * stride + ix + 1];
        const p01 = corners[(iz + 1) * stride + ix];
        const p11 = corners[(iz + 1) * stride + ix + 1];
        for (const triangle of [
          [p00, p10, p11],
          [p00, p11, p01],
        ]) {
          const points = [];
          for (let edge = 0; edge < 3; edge += 1) {
            const a = triangle[edge];
            const b = triangle[(edge + 1) % 3];
            if ((a.y < level && b.y >= level) || (b.y < level && a.y >= level)) {
              const point = crossing(a, b, level);
              if (point) points.push(point);
            }
          }
          if (points.length === 2) {
            segments.push({
              id: segments.length,
              level,
              a: points[0],
              b: points[1],
            });
          }
        }
      }
    }
  }
  contourCache.set(terrain, segments);
  return segments;
}

function drawBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b2624");
  gradient.addColorStop(0.46, "#081e1e");
  gradient.addColorStop(1, "#061717");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const halo = context.createRadialGradient(
    width * 0.51,
    height * 0.56,
    height * 0.02,
    width * 0.51,
    height * 0.56,
    height * 0.72,
  );
  halo.addColorStop(0, "rgba(73, 130, 96, 0.16)");
  halo.addColorStop(0.52, "rgba(27, 70, 58, 0.07)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, width, height);
}

function drawBaseGrid(context, projection, terrain, time) {
  context.save();
  context.lineWidth = 0.6;
  context.strokeStyle = "rgba(171, 210, 183, 0.07)";
  const divisions = 8;
  for (let index = 0; index <= divisions; index += 1) {
    const value = -1 + (index / divisions) * 2;
    const a = projection.project({ x: value, z: -1, y: 0 });
    const b = projection.project({ x: value, z: 1, y: 0 });
    const c = projection.project({ x: -1, z: value, y: 0 });
    const d = projection.project({ x: 1, z: value, y: 0 });
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.beginPath();
    context.moveTo(c.x, c.y);
    context.lineTo(d.x, d.y);
    context.stroke();
  }

  const edgePoints = terrain.points.filter((point) => {
    return (
      point.ix === 0 ||
      point.iz === 0 ||
      point.ix === terrain.params.resolution ||
      point.iz === terrain.params.resolution
    );
  });
  context.beginPath();
  edgePoints.forEach((point, index) => {
    const projected = projection.project({ ...point, y: 0.005 });
    if (index === 0) context.moveTo(projected.x, projected.y);
    else context.lineTo(projected.x, projected.y);
  });
  context.closePath();
  context.strokeStyle = "rgba(193, 223, 196, 0.15)";
  context.lineWidth = 0.8;
  context.stroke();

  const sweep = ((time * 0.075) % 1.5) - 0.25;
  const start = projection.project({ x: sweep, z: -1.2, y: 0 });
  const end = projection.project({ x: sweep, z: 1.2, y: 0 });
  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
  gradient.addColorStop(0, "rgba(160, 255, 201, 0)");
  gradient.addColorStop(0.5, "rgba(160, 255, 201, 0.12)");
  gradient.addColorStop(1, "rgba(160, 255, 201, 0)");
  context.strokeStyle = gradient;
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawTerrainShadow(context, projection) {
  const corners = [
    projection.project({ x: -1.06, z: -1.06, y: 0 }),
    projection.project({ x: 1.06, z: -1.06, y: 0 }),
    projection.project({ x: 1.06, z: 1.06, y: 0 }),
    projection.project({ x: -1.06, z: 1.06, y: 0 }),
  ];
  context.save();
  context.filter = "blur(18px)";
  context.fillStyle = "rgba(0, 8, 8, 0.5)";
  context.beginPath();
  corners.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y + 14);
    else context.lineTo(point.x, point.y + 14);
  });
  context.closePath();
  context.fill();
  context.restore();
}

function drawPeakLabel(context, anchor, terrain, width, height) {
  const elevation = Math.round(terrain.stats.peak.elevation);
  const boxWidth = 126;
  const boxHeight = 47;
  let x = anchor.x + 14;
  let y = anchor.y - 70;
  if (x + boxWidth > width - 12) x = anchor.x - boxWidth - 14;
  if (y < 12) y = anchor.y + 18;
  if (y + boxHeight > height - 12) y = height - boxHeight - 12;

  context.save();
  context.strokeStyle = "rgba(183, 255, 218, 0.55)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(anchor.x, anchor.y - 7);
  context.lineTo(anchor.x, y + boxHeight - 7);
  context.lineTo(x + (x > anchor.x ? 0 : boxWidth), y + boxHeight - 7);
  context.stroke();

  context.fillStyle = "rgba(5, 22, 21, 0.91)";
  context.strokeStyle = "rgba(183, 255, 218, 0.25)";
  context.lineWidth = 1;
  roundedRect(context, x, y, boxWidth, boxHeight, 7);
  context.fill();
  context.stroke();

  context.fillStyle = "rgba(183, 255, 218, 0.55)";
  context.font = '600 7px "SFMono-Regular", Menlo, monospace';
  context.letterSpacing = "0.08em";
  context.fillText("GLOBAL HIGH POINT", x + 10, y + 13);
  context.fillStyle = "#f0f4e5";
  context.font = '500 18px "Iowan Old Style", Georgia, serif';
  context.fillText(`${elevation.toLocaleString("en-US")} m`, x + 10, y + 30);
  context.fillStyle = "rgba(210, 233, 212, 0.46)";
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  const position = `X ${terrain.stats.peak.x.toFixed(2)}  Z ${terrain.stats.peak.z.toFixed(2)}`;
  context.fillText(position, x + 10, y + 41);
  context.restore();
  return { x, y, width: boxWidth, height: boxHeight };
}

function drawHoverLabel(context, anchor, point, width, height) {
  const elevation = Math.round(point.elevation ?? point.y * HEIGHT_SCALE_METERS);
  const boxWidth = 108;
  const boxHeight = 32;
  let x = anchor.x + 13;
  let y = anchor.y - 47;
  if (x + boxWidth > width - 10) x = anchor.x - boxWidth - 13;
  if (y < 10) y = anchor.y + 14;
  if (y + boxHeight > height - 10) y = height - boxHeight - 10;

  context.save();
  context.fillStyle = "rgba(225, 255, 232, 0.94)";
  context.strokeStyle = "rgba(9, 31, 29, 0.32)";
  context.lineWidth = 0.8;
  roundedRect(context, x, y, boxWidth, boxHeight, 6);
  context.fill();
  context.stroke();
  context.fillStyle = "#16302b";
  context.font = '600 10px "SFMono-Regular", Menlo, monospace';
  context.fillText(`${elevation.toLocaleString("en-US")} m`, x + 9, y + 14);
  context.fillStyle = "rgba(22, 48, 43, 0.55)";
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  context.fillText(`X ${point.x.toFixed(2)}  Z ${point.z.toFixed(2)}`, x + 9, y + 25);
  context.restore();
  return { x, y, width: boxWidth, height: boxHeight };
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawCompass(context, width, height, camera, time) {
  const cx = width - 43;
  const cy = height - 38;
  const radius = 18;
  context.save();
  context.strokeStyle = "rgba(199, 228, 204, 0.2)";
  context.lineWidth = 0.7;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(cx, cy, radius + 4, 0.16 + time * 0.02, 1.3 + time * 0.02);
  context.strokeStyle = "rgba(183, 255, 218, 0.18)";
  context.stroke();

  const yaw = (camera.yaw * Math.PI) / 180;
  const northX = cx + Math.sin(yaw) * (radius - 5);
  const northY = cy - Math.cos(yaw) * (radius - 5);
  context.strokeStyle = "rgba(226, 255, 119, 0.78)";
  context.fillStyle = "rgba(226, 255, 119, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cx, cy);
  context.lineTo(northX, northY);
  context.stroke();
  context.beginPath();
  context.arc(northX, northY, 2, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(220, 241, 220, 0.56)";
  context.font = '600 7px "SFMono-Regular", Menlo, monospace';
  context.textAlign = "center";
  context.fillText("N", cx + Math.sin(yaw) * (radius + 8), cy - Math.cos(yaw) * (radius + 8) + 2.5);
  context.restore();
}

function drawSectionEndpoints(context, projection, section) {
  const start = projection.project({ ...section.line.start, y: 0.005 });
  const end = projection.project({ ...section.line.end, y: 0.005 });
  context.save();
  context.strokeStyle = "rgba(183, 255, 218, 0.48)";
  context.fillStyle = "rgba(5, 27, 24, 0.8)";
  context.lineWidth = 1;
  for (const [point, label] of [
    [start, "A"],
    [end, "B"],
  ]) {
    context.beginPath();
    context.arc(point.x, point.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(218, 247, 220, 0.72)";
    context.font = '600 7px "SFMono-Regular", Menlo, monospace';
    context.textAlign = "center";
    context.fillText(label, point.x, point.y + 2.5);
    context.fillStyle = "rgba(5, 27, 24, 0.8)";
  }
  context.restore();
}

export function renderTerrain(canvas, options) {
  const {
    terrain,
    section,
    camera: cameraInput,
    highlight = null,
    time = 0,
    width = canvas.clientWidth,
    height = canvas.clientHeight,
    ratio = window.devicePixelRatio || 1,
  } = options;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const context = prepareCanvas(canvas, safeWidth, safeHeight, ratio);
  const projection = createProjection(cameraInput, safeWidth, safeHeight, terrain.stats.peak.y);
  const camera = projection.camera;

  drawBackground(context, safeWidth, safeHeight);
  drawBaseGrid(context, projection, terrain, time);
  drawTerrainShadow(context, projection);

  const minY = terrain.stats.minimum.y;
  const maxY = terrain.stats.peak.y;
  const spanY = Math.max(1e-6, maxY - minY);
  const renderItems = [];
  let depthMin = Infinity;
  let depthMax = -Infinity;

  for (const cell of terrain.cells) {
    const points = cell.corners.map(projection.project);
    const depth = (points[0].depth + points[1].depth + points[2].depth + points[3].depth) / 4;
    depthMin = Math.min(depthMin, depth);
    depthMax = Math.max(depthMax, depth);
    renderItems.push({ kind: "cell", layer: 0, id: cell.id, cell, points, depth });
  }

  for (const segment of contourSegmentsFor(terrain)) {
    const a = projection.project(segment.a);
    const b = projection.project(segment.b);
    renderItems.push({
      kind: "contour",
      layer: 1,
      id: segment.id,
      level: segment.level,
      a,
      b,
      depth: (a.depth + b.depth) / 2 + 0.0008,
    });
  }

  renderItems.sort((a, b) => a.depth - b.depth || a.layer - b.layer || a.id - b.id);

  const drawStart = performance.now();
  for (const item of renderItems) {
    if (item.kind === "cell") {
      const { cell, points } = item;
      const normalizedHeight = clamp((cell.y - minY) / spanY, 0, 1);
      const depthNorm = clamp((item.depth - depthMin) / Math.max(0.001, depthMax - depthMin), 0, 1);
      const shimmer = Math.sin(cell.x * 6.2 + cell.z * 4.1 - time * 1.15) * 0.015;
      const slopeShade = clamp(1 - cell.slope * 0.16, 0.78, 1.04);
      const fog = 0.82 + depthNorm * 0.18;
      const color = shadeColor(terrainColor(normalizedHeight), slopeShade * fog + shimmer);
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      context.lineTo(points[1].x, points[1].y);
      context.lineTo(points[2].x, points[2].y);
      context.lineTo(points[3].x, points[3].y);
      context.closePath();
      context.fillStyle = rgba(color);
      context.fill();
      context.strokeStyle = rgba(color, 0.55);
      context.lineWidth = 0.48;
      context.stroke();
    } else {
      const contourAlpha = 0.1 + clamp(item.level / 1.6, 0, 1) * 0.14;
      context.strokeStyle =
        item.level >= 1.12
          ? `rgba(246, 229, 184, ${contourAlpha + 0.06})`
          : `rgba(206, 232, 196, ${contourAlpha})`;
      context.lineWidth = item.level >= 1.12 ? 0.65 : 0.55;
      context.beginPath();
      context.moveTo(item.a.x, item.a.y);
      context.lineTo(item.b.x, item.b.y);
      context.stroke();
    }
  }

  const sectionPoints = section.samples.map((sample) => projection.project(sample));
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  sectionPoints.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.strokeStyle = "rgba(198, 255, 222, 0.15)";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = "rgba(210, 255, 228, 0.94)";
  context.lineWidth = 1.65;
  context.stroke();
  context.restore();
  drawSectionEndpoints(context, projection, section);

  const peakProjection = projection.project({
    x: terrain.stats.peak.x,
    z: terrain.stats.peak.z,
    y: terrain.stats.peak.y,
  });
  const peakGround = projection.project({
    x: terrain.stats.peak.x,
    z: terrain.stats.peak.z,
    y: 0,
  });
  context.save();
  context.setLineDash([2, 4]);
  context.strokeStyle = "rgba(226, 255, 119, 0.34)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(peakProjection.x, peakProjection.y);
  context.lineTo(peakGround.x, peakGround.y);
  context.stroke();
  context.setLineDash([]);
  const pulse = 1 + Math.sin(time * 2.1) * 0.16;
  context.strokeStyle = "rgba(226, 255, 119, 0.32)";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(peakProjection.x, peakProjection.y, 13 * pulse, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#e2ff77";
  context.shadowColor = "rgba(226, 255, 119, 0.65)";
  context.shadowBlur = 9;
  context.beginPath();
  context.arc(peakProjection.x, peakProjection.y, 3.4, 0, Math.PI * 2);
  context.fill();
  context.restore();

  let highlightProjection = null;
  let hoverLabel = null;
  if (highlight) {
    highlightProjection = projection.project(highlight);
    const pulseRadius = 7.5 + Math.sin(time * 3.3) * 1.2;
    context.save();
    context.strokeStyle = "rgba(235, 255, 232, 0.96)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(highlightProjection.x, highlightProjection.y, pulseRadius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "rgba(226, 255, 119, 0.7)";
    context.lineWidth = 0.8;
    for (let index = 0; index < 4; index += 1) {
      const angle = index * (Math.PI / 2) + Math.PI / 4;
      context.beginPath();
      context.moveTo(
        highlightProjection.x + Math.cos(angle) * 10,
        highlightProjection.y + Math.sin(angle) * 10,
      );
      context.lineTo(
        highlightProjection.x + Math.cos(angle) * 14,
        highlightProjection.y + Math.sin(angle) * 14,
      );
      context.stroke();
    }
    context.fillStyle = "#f5ffed";
    context.beginPath();
    context.arc(highlightProjection.x, highlightProjection.y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    hoverLabel = drawHoverLabel(context, highlightProjection, highlight, safeWidth, safeHeight);
  }

  const peakLabel = drawPeakLabel(context, peakProjection, terrain, safeWidth, safeHeight);
  drawCompass(context, safeWidth, safeHeight, camera, time);

  const orderDigest = hashNumbers(
    renderItems.map((item) => `${item.kind[0]}${item.layer}${item.id}`),
  );
  return {
    camera,
    projectionScale: projection.scale,
    objectCounts: {
      cells: terrain.cells.length,
      contours: renderItems.length - terrain.cells.length,
      sectionSegments: section.samples.length - 1,
      renderItems: renderItems.length,
    },
    renderOrderDigest: orderDigest,
    drawCalls: renderItems.length + 9,
    renderMs: performance.now() - drawStart,
    anchors: {
      peak: {
        world: { x: terrain.stats.peak.x, y: terrain.stats.peak.y, z: terrain.stats.peak.z },
        screen: { x: peakProjection.x, y: peakProjection.y },
        label: peakLabel,
      },
      highlight: highlightProjection
        ? {
            world: { x: highlight.x, y: highlight.y, z: highlight.z },
            screen: { x: highlightProjection.x, y: highlightProjection.y },
            label: hoverLabel,
          }
        : null,
      sectionStart: projection.project({ x: section.line.start.x, y: 0, z: section.line.start.z }),
      sectionEnd: projection.project({ x: section.line.end.x, y: 0, z: section.line.end.z }),
    },
    projectionMode: {
      yaw: camera.yaw,
      pitch: camera.pitch,
      zoom: camera.zoom,
      panX: camera.panX,
      panY: camera.panY,
    },
  };
}

export function getProfileLayout(terrain, section, width, height) {
  const plot = {
    left: Math.max(41, width * 0.115),
    right: width - Math.max(17, width * 0.045),
    top: Math.max(28, height * 0.115),
    bottom: height - Math.max(28, height * 0.12),
  };
  plot.width = Math.max(1, plot.right - plot.left);
  plot.height = Math.max(1, plot.bottom - plot.top);
  const yMax = Math.max(
    terrain.stats.peak.elevation * 1.11,
    section.maxSample.elevation * 1.08,
    250,
  );
  const xMax = Math.max(1, section.lengthMeters);
  const mapSample = (sample) => ({
    x: plot.left + sample.t * plot.width,
    y: plot.bottom - (sample.elevation / yMax) * plot.height,
  });
  const mapElevation = (elevation) => plot.bottom - (elevation / yMax) * plot.height;
  return { plot, yMax, xMax, mapSample, mapElevation };
}

function drawProfileBackground(context, width, height, layout) {
  context.fillStyle = "#f7f2e7";
  context.fillRect(0, 0, width, height);
  const glow = context.createRadialGradient(
    width * 0.3,
    height * 0.1,
    0,
    width * 0.3,
    height * 0.1,
    width * 0.75,
  );
  glow.addColorStop(0, "rgba(216, 230, 185, 0.22)");
  glow.addColorStop(1, "rgba(247, 242, 231, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  const { plot } = layout;
  context.save();
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const t = index / 4;
    const y = plot.bottom - t * plot.height;
    context.strokeStyle = index === 0 ? "rgba(19, 33, 31, 0.25)" : "rgba(19, 33, 31, 0.085)";
    context.lineWidth = index === 0 ? 1 : 0.6;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillStyle = "rgba(19, 33, 31, 0.48)";
    context.textAlign = "right";
    context.fillText(`${Math.round((layout.yMax * t) / 10) * 10}`, plot.left - 8, y);
  }

  for (let index = 0; index <= 6; index += 1) {
    const x = plot.left + (index / 6) * plot.width;
    context.strokeStyle = "rgba(19, 33, 31, 0.055)";
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(x, plot.top);
    context.lineTo(x, plot.bottom);
    context.stroke();
  }

  context.fillStyle = "rgba(19, 33, 31, 0.42)";
  context.textAlign = "left";
  context.fillText("ELEV / M", 4, plot.top - 12);
  context.textAlign = "right";
  context.fillText("DISTANCE / KM", plot.right, plot.bottom + 16);
  context.fillStyle = "rgba(19, 33, 31, 0.28)";
  context.textAlign = "left";
  context.fillText("A", plot.left - 2, plot.bottom + 17);
  context.textAlign = "right";
  context.fillText("B", plot.right + 2, plot.bottom + 17);
  context.restore();
}

function buildSmoothPath(context, samples, layout) {
  const points = samples.map(layout.mapSample);
  context.beginPath();
  if (!points.length) return points;
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    context.quadraticCurveTo(current.x, current.y, midX, midY);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
  return points;
}

export function renderProfile(canvas, options) {
  const {
    terrain,
    section,
    cursorFraction = null,
    width = canvas.clientWidth,
    height = canvas.clientHeight,
    ratio = window.devicePixelRatio || 1,
    time = 0,
  } = options;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const context = prepareCanvas(canvas, safeWidth, safeHeight, ratio);
  const layout = getProfileLayout(terrain, section, safeWidth, safeHeight);
  drawProfileBackground(context, safeWidth, safeHeight, layout);
  const { plot } = layout;
  const start = performance.now();

  const areaGradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
  areaGradient.addColorStop(0, "rgba(27, 65, 53, 0.36)");
  areaGradient.addColorStop(0.5, "rgba(57, 108, 77, 0.22)");
  areaGradient.addColorStop(1, "rgba(158, 171, 102, 0.07)");
  context.save();
  context.beginPath();
  buildSmoothPath(context, section.samples, layout);
  context.lineTo(plot.right, plot.bottom);
  context.lineTo(plot.left, plot.bottom);
  context.closePath();
  context.fillStyle = areaGradient;
  context.fill();

  buildSmoothPath(context, section.samples, layout);
  context.strokeStyle = "rgba(18, 38, 34, 0.94)";
  context.lineWidth = 1.8;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  const peakLineY = layout.mapElevation(terrain.stats.peak.elevation);
  context.setLineDash([4, 5]);
  context.strokeStyle = "rgba(127, 150, 54, 0.55)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(plot.left, peakLineY);
  context.lineTo(plot.right, peakLineY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "rgba(97, 118, 39, 0.92)";
  context.font = '600 6px "SFMono-Regular", Menlo, monospace';
  context.textAlign = "right";
  context.fillText(
    `GLOBAL PEAK ${Math.round(terrain.stats.peak.elevation).toLocaleString("en-US")} M`,
    plot.right - 2,
    peakLineY - 6,
  );

  const profilePeak = layout.mapSample(section.maxSample);
  context.fillStyle = "#16302b";
  context.beginPath();
  context.arc(profilePeak.x, profilePeak.y, 3, 0, Math.PI * 2);
  context.fill();
  const peakTick = 9 + Math.sin(time * 2) * 1;
  context.strokeStyle = "rgba(22, 48, 43, 0.55)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(profilePeak.x, profilePeak.y - 4);
  context.lineTo(profilePeak.x, profilePeak.y - 4 - peakTick);
  context.stroke();
  context.fillStyle = "rgba(22, 48, 43, 0.68)";
  context.font = '600 7px "SFMono-Regular", Menlo, monospace';
  context.textAlign = "center";
  context.fillText(
    `${Math.round(section.maxSample.elevation).toLocaleString("en-US")} m`,
    profilePeak.x,
    Math.max(plot.top + 8, profilePeak.y - 17),
  );

  let highlightAnchor = null;
  if (Number.isFinite(cursorFraction)) {
    const sample = sampleSectionAt(section, cursorFraction);
    const point = layout.mapSample(sample);
    context.save();
    context.strokeStyle = "rgba(91, 125, 48, 0.38)";
    context.setLineDash([2, 3]);
    context.beginPath();
    context.moveTo(point.x, plot.top);
    context.lineTo(point.x, plot.bottom);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#f7f2e7";
    context.strokeStyle = "#486235";
    context.lineWidth = 1.4;
    context.beginPath();
    context.arc(point.x, point.y, 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#486235";
    context.beginPath();
    context.arc(point.x, point.y, 2, 0, Math.PI * 2);
    context.fill();

    const badgeWidth = 87;
    const badgeHeight = 19;
    const badgeX = clamp(point.x + 7, plot.left, plot.right - badgeWidth);
    const badgeY = clamp(point.y - 28, plot.top + 2, plot.bottom - badgeHeight - 2);
    context.fillStyle = "rgba(19, 33, 31, 0.9)";
    roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 4);
    context.fill();
    context.fillStyle = "#eef3df";
    context.font = '600 7px "SFMono-Regular", Menlo, monospace';
    context.textAlign = "left";
    context.fillText(`${Math.round(sample.elevation)} m · ${sample.t.toFixed(3)}`, badgeX + 6, badgeY + 12);
    context.restore();
    highlightAnchor = { x: point.x, y: point.y, sample };
  }
  context.restore();

  return {
    plot,
    yMax: layout.yMax,
    xMax: layout.xMax,
    drawCalls: section.samples.length + 18,
    renderMs: performance.now() - start,
    anchors: {
      profilePeak: { x: profilePeak.x, y: profilePeak.y, elevation: section.maxSample.elevation },
      globalPeakLine: { x: plot.right, y: peakLineY, elevation: terrain.stats.peak.elevation },
      highlight: highlightAnchor,
    },
    mapSample: layout.mapSample,
  };
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createProfileSVG(terrain, section, options = {}) {
  const width = options.width ?? 960;
  const height = options.height ?? 520;
  const layout = getProfileLayout(terrain, section, width, height);
  const { plot } = layout;
  const points = section.samples.map((sample) => {
    const point = layout.mapSample(sample);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  });
  const areaPath = [
    `M ${points[0]}`,
    ...points.slice(1).map((point) => `L ${point}`),
    `L ${plot.right.toFixed(2)} ${plot.bottom.toFixed(2)}`,
    `L ${plot.left.toFixed(2)} ${plot.bottom.toFixed(2)}`,
    "Z",
  ].join(" ");
  const profilePeak = layout.mapSample(section.maxSample);
  const peakLineY = layout.mapElevation(terrain.stats.peak.elevation);
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const t = index / 4;
    return {
      value: Math.round((layout.yMax * t) / 10) * 10,
      y: plot.bottom - t * plot.height,
    };
  });
  const xTicks = Array.from({ length: 5 }, (_, index) => {
    const t = index / 4;
    return {
      value: (section.lengthMeters * t) / 1000,
      x: plot.left + t * plot.width,
    };
  });
  const direction = `${Math.round(section.angle)}° / offset ${section.offset.toFixed(2)}`;
  const selected = Number.isFinite(options.cursorFraction)
    ? sampleSectionAt(section, options.cursorFraction)
    : null;
  const selectedPoint = selected ? layout.mapSample(selected) : null;
  const structuralDigest = digestString(
    [terrain.geometryDigest, section.profileDigest, points.join(";")].join("|"),
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  role="img" aria-labelledby="title desc"
  data-geometry-digest="${terrain.geometryDigest}" data-profile-digest="${section.profileDigest}"
  data-structural-digest="${structuralDigest}" data-point-count="${section.samples.length}"
  data-high-point="${terrain.stats.peak.elevation.toFixed(3)}"
  data-section-angle="${section.angle.toFixed(2)}" data-section-offset="${section.offset.toFixed(2)}">
  <title id="title">Ridgeline terrain profile — ${escapeXml(direction)}</title>
  <desc id="desc">Deterministic cross-section with ${section.samples.length} samples. Global high point ${Math.round(terrain.stats.peak.elevation)} meters.</desc>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbf8ef"/>
      <stop offset="1" stop-color="#eee7d8"/>
    </linearGradient>
    <linearGradient id="relief" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#335e49" stop-opacity="0.42"/>
      <stop offset="0.62" stop-color="#7c9156" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#d8cf9c" stop-opacity="0.08"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#paper)"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
    <text x="42" y="32" font-size="8" font-weight="700" letter-spacing="1.6" fill="#6b746f">RIDGELINE / CROSS SECTION</text>
    <text x="42" y="56" font-family="Georgia, serif" font-size="25" letter-spacing="0.5" fill="#13211f">TERRAIN PROFILE</text>
    <text x="${width - 42}" y="34" text-anchor="end" font-size="9" fill="#46534e">${escapeXml(direction)}</text>
    <text x="${width - 42}" y="51" text-anchor="end" font-size="8" fill="#7a827e">LENGTH ${(section.lengthMeters / 1000).toFixed(2)} KM · ${section.samples.length} SAMPLES</text>
    <text x="${plot.left - 10}" y="${plot.top - 10}" text-anchor="end" font-size="7" fill="#6b746f">ELEV / M</text>
  </g>
  <g stroke="#13211f" stroke-opacity="0.1" stroke-width="1">
    ${yTicks.map((tick) => `<line x1="${plot.left}" y1="${tick.y.toFixed(2)}" x2="${plot.right}" y2="${tick.y.toFixed(2)}"/>`).join("\n    ")}
    ${xTicks.map((tick) => `<line x1="${tick.x.toFixed(2)}" y1="${plot.top}" x2="${tick.x.toFixed(2)}" y2="${plot.bottom}"/>`).join("\n    ")}
  </g>
  <path d="${areaPath}" fill="url(#relief)"/>
  <polyline id="profile-line" points="${points.join(" ")}" fill="none" stroke="#152d27" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="${plot.left}" y1="${peakLineY.toFixed(2)}" x2="${plot.right}" y2="${peakLineY.toFixed(2)}" stroke="#778e3e" stroke-width="1" stroke-dasharray="5 6" opacity="0.72"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" fill="#59645e">
    ${yTicks.map((tick) => `<text x="${plot.left - 10}" y="${(tick.y + 3).toFixed(2)}" text-anchor="end">${tick.value}</text>`).join("\n    ")}
    ${xTicks.map((tick) => `<text x="${tick.x.toFixed(2)}" y="${plot.bottom + 20}" text-anchor="middle">${tick.value.toFixed(1)}</text>`).join("\n    ")}
    <text x="${plot.right}" y="${plot.bottom + 37}" text-anchor="end" fill="#818983">DISTANCE / KM</text>
    <text x="${plot.right - 3}" y="${(peakLineY - 8).toFixed(2)}" text-anchor="end" font-size="7" fill="#687d38">GLOBAL PEAK ${Math.round(terrain.stats.peak.elevation)} M</text>
  </g>
  <g>
    <line x1="${profilePeak.x.toFixed(2)}" y1="${profilePeak.y.toFixed(2)}" x2="${profilePeak.x.toFixed(2)}" y2="${(profilePeak.y - 14).toFixed(2)}" stroke="#263c35" stroke-width="0.8"/>
    <circle cx="${profilePeak.x.toFixed(2)}" cy="${profilePeak.y.toFixed(2)}" r="3.6" fill="#132b25" stroke="#f7f2e7" stroke-width="1.2"/>
    <text x="${profilePeak.x.toFixed(2)}" y="${Math.max(plot.top + 9, profilePeak.y - 20).toFixed(2)}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="8" font-weight="700" fill="#253c34">${Math.round(section.maxSample.elevation)} m</text>
  </g>
  ${
    selectedPoint
      ? `<g data-selected-fraction="${options.cursorFraction.toFixed(4)}">
    <line x1="${selectedPoint.x.toFixed(2)}" y1="${plot.top}" x2="${selectedPoint.x.toFixed(2)}" y2="${plot.bottom}" stroke="#657a45" stroke-width="1" stroke-dasharray="3 4" opacity="0.52"/>
    <circle cx="${selectedPoint.x.toFixed(2)}" cy="${selectedPoint.y.toFixed(2)}" r="5.2" fill="#f7f2e7" stroke="#4c6036" stroke-width="1.5"/>
    <circle cx="${selectedPoint.x.toFixed(2)}" cy="${selectedPoint.y.toFixed(2)}" r="2.2" fill="#4c6036"/>
    <text x="${selectedPoint.x.toFixed(2)}" y="${Math.max(plot.top + 10, selectedPoint.y - 24).toFixed(2)}" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="7" fill="#3f5130">${Math.round(selected.elevation)} m</text>
  </g>`
      : ""
  }
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="7" fill="#828a85">
    <text x="42" y="${height - 22}">MESH ${terrain.geometryDigest} / PROFILE ${section.profileDigest}</text>
    <text x="${width - 42}" y="${height - 22}" text-anchor="end">STRUCTURE ${structuralDigest} / ${terrain.counts.triangles} TRIANGLES</text>
  </g>
</svg>`;

  return {
    svg,
    structuralDigest,
    points,
    yMax: layout.yMax,
    plot,
    anchors: {
      profilePeak,
      globalPeakLineY: peakLineY,
      selected: selectedPoint,
    },
  };
}
