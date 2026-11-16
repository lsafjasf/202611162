import { hashText } from "./pipeline.js";

export const SCENE_OBJECTS = [
  {
    id: "solar-halo",
    name: "Solar halo",
    shortName: "HALO",
    kind: "ring",
    x: 0.715,
    y: 0.295,
    radius: 0.078,
    z: 20,
    opacity: 0.72,
    color: "#e9ff62",
    annotation: { anchor: { x: 0.715, y: 0.295 }, offset: [34, -42], label: "SUN / CORE" },
  },
  {
    id: "ridge-trace",
    name: "Ridge trace",
    shortName: "RIDGE",
    kind: "polyline",
    points: [
      [0.045, 0.535],
      [0.16, 0.505],
      [0.275, 0.55],
      [0.39, 0.515],
      [0.51, 0.565],
      [0.63, 0.53],
      [0.76, 0.575],
      [0.9, 0.535],
      [0.97, 0.56],
    ],
    z: 40,
    opacity: 0.62,
    color: "#64d9de",
    annotation: { anchor: { x: 0.275, y: 0.55 }, offset: [30, 34], label: "RIDGE / TRACE" },
  },
  {
    id: "signal-gate",
    name: "Signal gate",
    shortName: "SIGNAL",
    kind: "reticle",
    x: 0.235,
    y: 0.305,
    radius: 0.058,
    z: 60,
    opacity: 0.84,
    color: "#ff805f",
    annotation: { anchor: { x: 0.235, y: 0.305 }, offset: [-126, -37], label: "SIGNAL / GATE" },
  },
  {
    id: "glass-plane",
    name: "Glass plane",
    shortName: "GLASS",
    kind: "quad",
    points: [
      [0.53, 0.385],
      [0.73, 0.415],
      [0.675, 0.655],
      [0.485, 0.61],
    ],
    z: 80,
    opacity: 0.24,
    color: "#769cff",
    annotation: { anchor: { x: 0.605, y: 0.515 }, offset: [35, -8], label: "GLASS / 24%" },
  },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorWithAlpha(hex, alpha) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createSceneTransform(width, height, zoom = 100, rotation = 0) {
  const cx = width / 2;
  const cy = height / 2;
  const scale = zoom / 100;
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    width,
    height,
    zoom,
    rotation,
    scale,
    point(x, y) {
      const px = (x * width - cx) * scale;
      const py = (y * height - cy) * scale;
      return { x: cx + px * cos - py * sin, y: cy + px * sin + py * cos };
    },
    inverse(point) {
      const px = point.x - cx;
      const py = point.y - cy;
      const rx = px * cos + py * sin;
      const ry = -px * sin + py * cos;
      return { x: (rx / scale + cx) / width, y: (ry / scale + cy) / height };
    },
  };
}

function objectCenter(object) {
  if (Number.isFinite(object.x) && Number.isFinite(object.y)) {
    return { x: object.x, y: object.y };
  }
  const total = object.points.reduce(
    (sum, point) => ({ x: sum.x + point[0], y: sum.y + point[1] }),
    { x: 0, y: 0 },
  );
  return { x: total.x / object.points.length, y: total.y / object.points.length };
}

function objectPoints(object, transform) {
  if (object.kind === "polyline" || object.kind === "quad") {
    return object.points.map(([x, y]) => transform.point(x, y));
  }
  const center = transform.point(object.x, object.y);
  const radius = object.radius * Math.min(transform.width, transform.height) * transform.scale;
  return [{ ...center, radius }];
}

function labelBoxFor(object, anchor, width, height) {
  const offset = object.annotation.offset;
  const boxWidth = object.id === "signal-gate" ? 108 : 116;
  const boxHeight = 28;
  const preferredX = anchor.x + offset[0];
  const preferredY = anchor.y + offset[1];
  const x = clamp(preferredX, 12, width - boxWidth - 12);
  const y = clamp(preferredY, 12, height - boxHeight - 12);
  return { x, y, width: boxWidth, height: boxHeight };
}

export function getObjectGeometry(width, height, zoom = 100, rotation = 0) {
  const transform = createSceneTransform(width, height, zoom, rotation);
  const sorted = [...SCENE_OBJECTS].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
  const objects = sorted.map((object) => {
    const centerNormalized = objectCenter(object);
    const anchorNormalized = object.annotation?.anchor || centerNormalized;
    const center = transform.point(centerNormalized.x, centerNormalized.y);
    const anchor = transform.point(anchorNormalized.x, anchorNormalized.y);
    const roundTrip = transform.inverse(anchor);
    const drift = Math.hypot(
      (roundTrip.x - anchorNormalized.x) * width,
      (roundTrip.y - anchorNormalized.y) * height,
    );
    return {
      id: object.id,
      name: object.name,
      kind: object.kind,
      z: object.z,
      opacity: object.opacity,
      center,
      anchor,
      anchorNormalized,
      points: objectPoints(object, transform),
      annotation: object.annotation
        ? {
            label: object.annotation.label,
            anchor,
            box: labelBoxFor(object, anchor, width, height),
          }
        : null,
      roundTrip,
      driftPx: drift,
    };
  });
  const digestSource = objects
    .map(
      (object) =>
        `${object.id}:${object.z}:${object.opacity}:${object.center.x.toFixed(3)},${object.center.y.toFixed(3)}:${object.anchor.x.toFixed(3)},${object.anchor.y.toFixed(3)}`,
    )
    .join("|");
  return {
    width,
    height,
    zoom,
    rotation,
    objects,
    order: objects.map((object) => object.id),
    objectCount: objects.length,
    annotationCount: objects.filter((object) => object.annotation).length,
    maxDriftPx: Math.max(...objects.map((object) => object.driftPx)),
    digest: hashText(digestSource),
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawRingObject(ctx, object, geometry, time, selected) {
  const circle = geometry.points[0];
  const pulse = selected ? 0.5 + Math.sin(time * 0.004) * 0.5 : 0;
  ctx.save();
  ctx.globalAlpha = object.opacity;
  ctx.strokeStyle = object.color;
  ctx.lineWidth = 1.15;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = object.opacity * (0.4 + pulse * 0.22);
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, circle.radius + 6 + pulse * 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = object.opacity * 0.6;
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
    const inner = circle.radius + 4;
    const outer = inner + (angle % (Math.PI / 2) < 0.01 ? 9 : 4);
    ctx.beginPath();
    ctx.moveTo(circle.x + Math.cos(angle) * inner, circle.y + Math.sin(angle) * inner);
    ctx.lineTo(circle.x + Math.cos(angle) * outer, circle.y + Math.sin(angle) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReticleObject(ctx, object, geometry, time, selected) {
  const circle = geometry.points[0];
  const pulse = selected ? 0.5 + Math.sin(time * 0.004) * 0.5 : 0;
  ctx.save();
  ctx.translate(circle.x, circle.y);
  ctx.strokeStyle = object.color;
  ctx.fillStyle = colorWithAlpha(object.color, object.opacity * 0.08);
  ctx.globalAlpha = object.opacity;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(0, 0, circle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, circle.radius * 0.52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-circle.radius - 8, 0);
  ctx.lineTo(-circle.radius + 4, 0);
  ctx.moveTo(circle.radius - 4, 0);
  ctx.lineTo(circle.radius + 8, 0);
  ctx.moveTo(0, -circle.radius - 8);
  ctx.lineTo(0, -circle.radius + 4);
  ctx.moveTo(0, circle.radius - 4);
  ctx.lineTo(0, circle.radius + 8);
  ctx.stroke();
  ctx.fillStyle = object.color;
  ctx.beginPath();
  ctx.arc(0, 0, 2 + pulse * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.font = '500 7px "DM Mono", monospace';
  ctx.fillText("TX / 08", 0, -circle.radius - 15);
  ctx.restore();
}

function drawPolylineObject(ctx, object, geometry) {
  const points = geometry.points;
  ctx.save();
  ctx.globalAlpha = object.opacity;
  ctx.strokeStyle = object.color;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.globalAlpha = object.opacity * 0.55;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y + 6);
    else ctx.lineTo(point.x, point.y + 6);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = object.color;
  for (const point of points.filter((_, index) => index % 2 === 0)) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawQuadObject(ctx, object, geometry, time, selected) {
  const points = geometry.points;
  const pulse = selected ? 0.5 + Math.sin(time * 0.004) * 0.5 : 0;
  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  const gradient = ctx.createLinearGradient(
    points[0].x,
    points[0].y,
    points[2].x,
    points[2].y,
  );
  gradient.addColorStop(0, colorWithAlpha(object.color, object.opacity * 0.5));
  gradient.addColorStop(0.48, colorWithAlpha(object.color, object.opacity * 0.1));
  gradient.addColorStop(1, colorWithAlpha(object.color, object.opacity * 0.34));
  ctx.fillStyle = gradient;
  ctx.globalAlpha = object.opacity;
  ctx.fill();
  ctx.strokeStyle = colorWithAlpha(object.color, 0.9);
  ctx.lineWidth = selected ? 1.8 + pulse : 1.15;
  ctx.stroke();
  ctx.clip();
  ctx.globalAlpha = object.opacity * 0.26;
  ctx.strokeStyle = object.color;
  ctx.lineWidth = 0.7;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  for (let offset = -maxY; offset < maxX; offset += 13) {
    ctx.beginPath();
    ctx.moveTo(minX + offset, maxY);
    ctx.lineTo(minX + offset + (maxY - minY), minY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnnotation(ctx, object, geometry, selected) {
  const annotation = geometry.annotation;
  const box = annotation.box;
  const anchor = annotation.anchor;
  const isLeft = box.x + box.width < anchor.x;
  const leaderEndX = isLeft ? box.x + box.width : box.x;
  const leaderEndY = clamp(anchor.y, box.y + 8, box.y + box.height - 8);
  ctx.save();
  ctx.strokeStyle = colorWithAlpha(object.color, selected ? 0.9 : 0.48);
  ctx.lineWidth = selected ? 1.1 : 0.8;
  ctx.beginPath();
  ctx.moveTo(anchor.x, anchor.y);
  ctx.lineTo(leaderEndX, leaderEndY);
  ctx.stroke();
  ctx.fillStyle = object.color;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, selected ? 2.8 : 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colorWithAlpha(object.color, 0.35);
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, selected ? 6.5 : 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(7, 10, 11, 0.79)";
  roundedRect(ctx, box.x, box.y, box.width, box.height, 4);
  ctx.fill();
  ctx.strokeStyle = colorWithAlpha(object.color, selected ? 0.45 : 0.2);
  ctx.stroke();
  ctx.fillStyle = object.color;
  ctx.fillRect(box.x, box.y, 2, box.height);
  ctx.font = '500 7px "DM Mono", monospace';
  ctx.textAlign = "left";
  ctx.fillStyle = colorWithAlpha(object.color, 0.92);
  ctx.fillText(annotation.label, box.x + 8, box.y + 11);
  ctx.fillStyle = "rgba(211, 215, 203, 0.52)";
  ctx.font = '400 6px "DM Mono", monospace';
  const x = object.annotation.anchor.x.toFixed(3);
  const y = object.annotation.anchor.y.toFixed(3);
  ctx.fillText(`X ${x}  Y ${y}  Z ${String(object.z).padStart(2, "0")}`, box.x + 8, box.y + 21);
  ctx.restore();
}

function drawMotionOverlay(ctx, width, height, time) {
  const scan = ((time * 0.018) % 1) * (height + 120) - 60;
  const gradient = ctx.createLinearGradient(0, scan - 42, 0, scan + 42);
  gradient.addColorStop(0, "rgba(233, 255, 98, 0)");
  gradient.addColorStop(0.5, "rgba(233, 255, 98, 0.048)");
  gradient.addColorStop(1, "rgba(233, 255, 98, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, scan - 42, width, 84);
  ctx.fillStyle = "rgba(233, 255, 98, 0.17)";
  for (let index = 0; index < 11; index += 1) {
    const x = ((index * 127.3 + time * 0.007) % (width + 80)) - 40;
    const y = 0.16 * height + index * 22 + Math.sin(time * 0.0006 + index) * 13;
    ctx.fillRect(x, y, index % 3 === 0 ? 6 : 2, 1);
  }
}

export function drawComposition(ctx, pixels, state) {
  const { width, height, zoom, rotation, time, selectedObjectId } = state;
  const geometry = getObjectGeometry(width, height, zoom, rotation);
  const objectsById = new Map(SCENE_OBJECTS.map((object) => [object.id, object]));
  const imageData = new ImageData(pixels, width, height);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(imageData, 0, 0);
  drawMotionOverlay(ctx, width, height, time);

  for (const rendered of geometry.objects) {
    const object = objectsById.get(rendered.id);
    const selected = rendered.id === selectedObjectId;
    if (rendered.kind === "ring") drawRingObject(ctx, object, rendered, time, selected);
    if (rendered.kind === "reticle") drawReticleObject(ctx, object, rendered, time, selected);
    if (rendered.kind === "polyline") drawPolylineObject(ctx, object, rendered);
    if (rendered.kind === "quad") drawQuadObject(ctx, object, rendered, time, selected);
  }
  for (const rendered of geometry.objects) {
    const object = objectsById.get(rendered.id);
    if (rendered.annotation) drawAnnotation(ctx, object, rendered, rendered.id === selectedObjectId);
  }
  ctx.restore();
  return geometry;
}

export function objectSummary(width, height, zoom, rotation) {
  return getObjectGeometry(width, height, zoom, rotation).objects.map((object) => ({
    id: object.id,
    name: object.name,
    z: object.z,
    opacity: object.opacity,
    center: object.center,
    anchor: object.anchor,
    driftPx: object.driftPx,
  }));
}
