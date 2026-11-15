(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const SERIES = [
    { id: "revenue", name: "Net revenue", color: "#d9ff4f" },
    { id: "result", name: "Operating result", color: "#ff9764" },
    { id: "cost", name: "Operating cost", color: "#7da8ff" }
  ];

  const DATA = {
    default: {
      labels: [
        "Jan 01–07", "Jan 08–14", "Jan 15–21", "Jan 22–28",
        "Feb 01–07", "Feb 08–14", "Feb 15–21", "Feb 22–28"
      ],
      values: {
        revenue: [42.4, 58.2, null, 74.1, 62.8, -16.2, 91.3, 104.2],
        result: [14.2, 23.8, -7.4, 35.1, 18.6, null, 37.2, 38.5],
        cost: [28.2, 34.4, 41.1, 39.0, 44.2, 33.5, 54.1, 65.7]
      }
    },
    sparse: {
      labels: [
        "Week 01 · North America priority",
        "Week 02 · Europe expansion",
        "Week 03 · APAC enterprise",
        "Week 04 · LATAM pilot",
        "Week 05 · North America renewal",
        "Week 06 · Europe priority",
        "Week 07 · APAC expansion",
        "Week 08 · LATAM enterprise"
      ],
      values: {
        revenue: [38.6, null, null, 81.4, 70.2, 96.8, null, 112.4],
        result: [null, 21.1, -12.5, 38.7, null, 44.3, 31.8, null],
        cost: [26.8, 33.9, 44.5, null, 51.2, 59.4, 48.8, 64.1]
      }
    },
    extreme: {
      labels: [
        "Jan 01–07 · North America priority accounts",
        "Jan 08–14 · Europe expansion and renewals",
        "Jan 15–21 · APAC enterprise pipeline",
        "Jan 22–28 · LATAM early access pilot",
        "Feb 01–07 · North America strategic renewals",
        "Feb 08–14 · Europe priority expansion",
        "Feb 15–21 · APAC enterprise acceleration",
        "Feb 22–28 · LATAM enterprise launch"
      ],
      values: {
        revenue: [-642, 1284, null, 921, -378, 1542, -224, 1118],
        result: [-318, 744, 512, null, -421, 886, -176, 624],
        cost: [284, 468, 421, 512, 386, 614, 442, 392]
      }
    }
  };

  const DEFAULTS = () => ({
    sample: "default",
    type: "line",
    visible: { revenue: true, result: true, cost: true },
    autoDomain: true,
    domainMin: -49,
    domainMax: 104,
    zoom: 1,
    rotation: 0,
    opacity: 0.92,
    grid: true,
    labels: true
  });

  const SCENARIOS = {
    default: () => DEFAULTS(),
    extreme: () => ({
      ...DEFAULTS(),
      sample: "extreme",
      type: "bar",
      zoom: 1.06,
      rotation: 3,
      opacity: 0.62,
      domainMin: -760,
      domainMax: 1740
    }),
    invalid: () => ({
      ...DEFAULTS(),
      autoDomain: false,
      domainMin: 180,
      domainMax: -120
    })
  };

  const state = DEFAULTS();
  const undoStack = [];
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  let scene = null;
  let activeIndex = null;
  let lastRenderSignature = "";
  let legendSignature = "";
  let lastSvg = "";
  let saveStatusTimer = 0;

  const animation = {
    clock: 0,
    duration: 920,
    frame: 0,
    raf: 0,
    lastTime: 0
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = (value, digits = 3) => {
    const power = 10 ** digits;
    return Math.round(value * power) / power;
  };

  function cloneState(source = state) {
    return JSON.parse(JSON.stringify(source));
  }

  function hashString(text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code + index;
      h2 = Math.imul(h2, 0x85ebca6b);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256(text) {
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return hashString(text) + hashString(text.split("").reverse().join(""));
  }

  function datasetFor(sourceState) {
    return DATA[sourceState.sample] || DATA.default;
  }

  function visibleSeries(sourceState) {
    const sample = datasetFor(sourceState);
    return SERIES
      .filter((entry) => sourceState.visible?.[entry.id] !== false)
      .map((entry) => ({ ...entry, values: sample.values[entry.id] }));
  }

  function validateState(sourceState) {
    if (!DATA[sourceState.sample]) {
      return { ok: false, field: "sample", message: "Unknown dataset. The default sample is being shown instead." };
    }
    if (!["line", "bar", "scatter"].includes(sourceState.type)) {
      return { ok: false, field: "type", message: "Chart type must be line, bar, or scatter. The line renderer is being used." };
    }
    if (!SERIES.some((entry) => sourceState.visible?.[entry.id] !== false)) {
      return { ok: false, field: "visible", message: "At least one series must remain visible. Net revenue is being shown." };
    }
    if (!sourceState.autoDomain) {
      if (!Number.isFinite(Number(sourceState.domainMin)) || !Number.isFinite(Number(sourceState.domainMax))) {
        return { ok: false, field: "domain", message: "Axis bounds must be finite numbers. Auto-domain is being used as a safe fallback." };
      }
      if (Number(sourceState.domainMin) >= Number(sourceState.domainMax)) {
        return { ok: false, field: "domain", message: "Axis minimum must be lower than axis maximum. Auto-domain is being used as a safe fallback." };
      }
    }
    if (!Number.isFinite(Number(sourceState.zoom)) || sourceState.zoom < 0.75 || sourceState.zoom > 1.25) {
      return { ok: false, field: "zoom", message: "Zoom must stay between 75% and 125%. The nearest safe value is being used." };
    }
    if (!Number.isFinite(Number(sourceState.rotation)) || Math.abs(sourceState.rotation) > 8) {
      return { ok: false, field: "rotation", message: "Rotation must stay between −8° and 8°. The nearest safe value is being used." };
    }
    if (!Number.isFinite(Number(sourceState.opacity)) || sourceState.opacity < 0.2 || sourceState.opacity > 1) {
      return { ok: false, field: "opacity", message: "Mark opacity must stay between 20% and 100%." };
    }
    return { ok: true, field: null, message: "" };
  }

  function niceStep(range, target = 5) {
    const raw = range / Math.max(1, target);
    const power = 10 ** Math.floor(Math.log10(raw || 1));
    const fraction = raw / power;
    let niceFraction = 1;
    if (fraction >= 7.5) niceFraction = 10;
    else if (fraction >= 3.5) niceFraction = 5;
    else if (fraction >= 1.5) niceFraction = 2;
    return niceFraction * power;
  }

  function computeDomain(sourceState, series, type) {
    const values = series.flatMap((entry) => entry.values).filter(Number.isFinite);
    let rawMin = values.length ? Math.min(...values) : 0;
    let rawMax = values.length ? Math.max(...values) : 1;
    const manual = !sourceState.autoDomain
      && Number.isFinite(Number(sourceState.domainMin))
      && Number.isFinite(Number(sourceState.domainMax))
      && Number(sourceState.domainMin) < Number(sourceState.domainMax);

    if (manual) {
      rawMin = Number(sourceState.domainMin);
      rawMax = Number(sourceState.domainMax);
    } else {
      if (type === "bar") {
        rawMin = Math.min(0, rawMin);
        rawMax = Math.max(0, rawMax);
      }
      const span = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
      const pad = span * 0.1;
      rawMin -= pad;
      rawMax += pad;
    }

    if (rawMin === rawMax) {
      rawMin -= 1;
      rawMax += 1;
    }
    const step = niceStep(rawMax - rawMin, manual ? 4 : 5);
    const min = manual ? rawMin : Math.floor(rawMin / step) * step;
    const max = manual ? rawMax : Math.ceil(rawMax / step) * step;
    const safeStep = max === min ? 1 : (manual ? (max - min) / 4 : step);
    const ticks = [];
    for (let value = min; value <= max + safeStep * 0.001; value += safeStep) {
      ticks.push(round(value, 5));
    }
    if (ticks.length < 2) ticks.push(max);
    return { min, max, step: safeStep, ticks, manual };
  }

  function formatNumber(value) {
    const absolute = Math.abs(value);
    if (absolute >= 10000) return `${round(value / 1000, 1)}k`;
    if (absolute >= 1000) return `${round(value / 1000, 2)}k`;
    if (Number.isInteger(value)) return String(value);
    return String(round(value, 1));
  }

  function formatDomain(min, max) {
    return `${formatNumber(min).replace("-", "−")} – ${formatNumber(max).replace("-", "−")}`;
  }

  function ellipsize(text, maxWidth) {
    if (measureCtx.measureText(text).width <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && measureCtx.measureText(`${result}…`).width > maxWidth) {
      result = result.slice(0, -1);
    }
    return `${result.trimEnd()}…`;
  }

  function wrapLabel(text, maxWidth, maxLines = 2) {
    measureCtx.font = "400 9px 'Ubuntu Sans', 'DejaVu Sans', sans-serif";
    if (measureCtx.measureText(text).width <= maxWidth) return [text];
    const words = text.replaceAll("·", " · ").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (let index = 0; index < words.length; index += 1) {
      const candidate = current ? `${current} ${words[index]}` : words[index];
      if (measureCtx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = words[index];
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(index + 1)].join(" ");
        lines.push(ellipsize(rest, maxWidth));
        return lines;
      }
    }
    if (current) lines.push(ellipsize(current, maxWidth));
    return lines.slice(0, maxLines);
  }

  function makeTransform(plot, sourceState) {
    const zoom = clamp(Number(sourceState.zoom) || 1, 0.75, 1.25);
    const rotation = clamp(Number(sourceState.rotation) || 0, -8, 8) * (Math.PI / 180);
    return {
      zoom,
      rotation,
      centerX: plot.x + plot.w / 2,
      centerY: plot.y + plot.h / 2
    };
  }

  function transformPoint(point, transform) {
    const dx = (point.x - transform.centerX) * transform.zoom;
    const dy = (point.y - transform.centerY) * transform.zoom;
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    return {
      x: transform.centerX + dx * cos - dy * sin,
      y: transform.centerY + dx * sin + dy * cos
    };
  }

  function inversePoint(point, transform) {
    const dx = point.x - transform.centerX;
    const dy = point.y - transform.centerY;
    const cos = Math.cos(-transform.rotation);
    const sin = Math.sin(-transform.rotation);
    return {
      x: transform.centerX + (dx * cos - dy * sin) / transform.zoom,
      y: transform.centerY + (dx * sin + dy * cos) / transform.zoom
    };
  }

  function geometrySignature(sourceScene) {
    const core = sourceScene.objects
      .filter((object) => object.z < 40)
      .map((object) => ({
        type: object.type,
        z: object.z,
        x: round(object.x, 3),
        y: round(object.y, 3),
        w: round(object.w || 0, 3),
        h: round(object.h || 0, 3),
        r: round(object.radius || 0, 3),
        text: object.lines ? object.lines.join(" / ") : (object.text || "")
      }));
    return hashString(JSON.stringify({
      width: round(sourceScene.width, 3),
      height: round(sourceScene.height, 3),
      domain: [round(sourceScene.domain.min, 4), round(sourceScene.domain.max, 4)],
      transform: [round(sourceScene.transform.zoom, 4), round(sourceScene.transform.rotation, 6)],
      core
    }));
  }

  function buildScene(width, height, sourceState = state, options = {}) {
    const validation = validateState(sourceState);
    const safeState = cloneState(sourceState);
    safeState.zoom = clamp(Number(safeState.zoom) || 1, 0.75, 1.25);
    safeState.rotation = clamp(Number(safeState.rotation) || 0, -8, 8);
    safeState.opacity = clamp(Number(safeState.opacity) || 0.92, 0.2, 1);
    if (!DATA[safeState.sample]) safeState.sample = "default";
    if (!["line", "bar", "scatter"].includes(safeState.type)) safeState.type = "line";
    if (!SERIES.some((entry) => safeState.visible?.[entry.id] !== false)) {
      safeState.visible = { ...safeState.visible, revenue: true };
    }
    if (!validation.ok && validation.field === "domain") safeState.autoDomain = true;

    const data = datasetFor(safeState);
    const series = visibleSeries(safeState);
    const plot = {
      x: width < 520 ? 47 : 56,
      y: 25,
      w: width - (width < 520 ? 67 : 78),
      h: Math.max(150, height - 108)
    };
    const domain = computeDomain(safeState, series, safeState.type);
    const transform = makeTransform(plot, safeState);
    const objects = [];
    const labels = [];
    const annotations = [];
    const overlay = [];
    const slot = plot.w / data.labels.length;
    const zeroY = plot.y + ((domain.max - 0) / (domain.max - domain.min)) * plot.h;
    const mapY = (value) => plot.y + ((domain.max - value) / (domain.max - domain.min)) * plot.h;

    domain.ticks.forEach((tick) => {
      const y = mapY(tick);
      objects.push({
        type: "grid-line",
        z: 10,
        x: plot.x,
        y,
        w: plot.w,
        h: 0,
        value: tick
      });
      objects.push({
        type: "axis-label",
        z: 12,
        x: plot.x - 9,
        y: y + 3,
        lines: [formatNumber(tick)],
        anchor: "end",
        font: "400 9px 'Ubuntu Mono', 'DejaVu Sans Mono', monospace",
        color: "rgba(224, 234, 218, 0.48)"
      });
    });

    data.labels.forEach((label, index) => {
      const x = plot.x + slot * (index + 0.5);
      objects.push({
        type: "x-grid-line",
        z: 10,
        x,
        y: plot.y,
        w: 0,
        h: plot.h,
        index
      });
      const lines = wrapLabel(label, Math.max(34, slot - 10), 2);
      const labelObject = {
        type: "x-axis-label",
        z: 12,
        x,
        y: plot.y + plot.h + 17,
        lines,
        anchor: "middle",
        font: "400 9px 'Ubuntu Sans', 'DejaVu Sans', sans-serif",
        color: "rgba(224, 234, 218, 0.48)",
        slot,
        boxWidth: Math.max(34, slot - 8),
        boxHeight: lines.length === 1 ? 11 : 22,
        index
      };
      labels.push(labelObject);
      objects.push(labelObject);
    });

    if (domain.min < 0 && domain.max > 0) {
      objects.push({
        type: "zero-line",
        z: 11,
        x: plot.x,
        y: zeroY,
        w: plot.w,
        h: 0
      });
    }

    const seriesGeometry = series.map((entry, seriesIndex) => {
      const points = entry.values.map((value, index) => {
        if (!Number.isFinite(value)) return null;
        return {
          x: plot.x + slot * (index + 0.5),
          y: mapY(value),
          value,
          index,
          seriesId: entry.id,
          color: entry.color
        };
      });
      return { ...entry, seriesIndex, points };
    });

    if (safeState.type === "bar") {
      const count = Math.max(1, series.length);
      const groupWidth = Math.min(slot * 0.7, 72);
      const barWidth = Math.max(4, (groupWidth - (count - 1) * 3) / count);
      seriesGeometry.forEach((entry, seriesIndex) => {
        entry.points.forEach((point) => {
          if (!point) return;
          const x = point.x - groupWidth / 2 + seriesIndex * (barWidth + 3);
          const valueY = mapY(point.value);
          const y = Math.min(valueY, zeroY);
          const h = Math.max(1, Math.abs(zeroY - valueY));
          objects.push({
            type: "bar",
            z: 20 + seriesIndex,
            x,
            y,
            w: barWidth,
            h,
            color: entry.color,
            zeroY,
            value: point.value,
            seriesId: entry.id,
            index: point.index
          });
        });
      });
    } else if (safeState.type === "line") {
      seriesGeometry.forEach((entry, seriesIndex) => {
        const segments = [];
        let current = [];
        entry.points.forEach((point) => {
          if (point) {
            current.push(point);
          } else if (current.length) {
            segments.push(current);
            current = [];
          }
        });
        if (current.length) segments.push(current);
        entry.segments = segments;
        segments.forEach((segment) => {
          objects.push({
            type: "line-segment",
            z: 20 + seriesIndex,
            points: segment.map((point) => ({ x: round(point.x), y: round(point.y) })),
            color: entry.color,
            seriesId: entry.id
          });
        });
        entry.points.forEach((point) => {
          if (!point) return;
          objects.push({
            type: "point",
            z: 23 + seriesIndex,
            x: point.x,
            y: point.y,
            radius: 3.2,
            color: entry.color,
            value: point.value,
            seriesId: entry.id,
            index: point.index
          });
        });
      });
    } else {
      const offsetStep = 6;
      seriesGeometry.forEach((entry, seriesIndex) => {
        const offset = (seriesIndex - (series.length - 1) / 2) * offsetStep;
        entry.points.forEach((point) => {
          if (!point) return;
          objects.push({
            type: "scatter-point",
            z: 20 + seriesIndex,
            x: point.x + offset,
            y: point.y,
            radius: 4.3,
            color: entry.color,
            value: point.value,
            seriesId: entry.id,
            index: point.index
          });
        });
      });
    }

    if (safeState.labels) {
      const finite = seriesGeometry.flatMap((entry) => entry.points.filter(Boolean));
      if (finite.length) {
        const highest = finite.reduce((best, point) => point.value > best.value ? point : best, finite[0]);
        const lowest = finite.reduce((best, point) => point.value < best.value ? point : best, finite[0]);
        [highest, lowest].forEach((point, index) => {
          const entry = series.find((candidate) => candidate.id === point.seriesId);
          const boxWidth = 106;
          const boxHeight = 31;
          let x = point.x + 12;
          let y = point.y - boxHeight - 10;
          if (index === 1) y = point.y + 13;
          if (x + boxWidth > plot.x + plot.w - 4) x = point.x - boxWidth - 12;
          if (y < plot.y + 2) y = point.y + 13;
          if (y + boxHeight > plot.y + plot.h - 2) y = point.y - boxHeight - 10;
          const annotation = {
            type: "annotation",
            z: 30,
            id: index === 0 ? "peak" : "trough",
            x,
            y,
            w: boxWidth,
            h: boxHeight,
            anchor: { x: point.x, y: point.y },
            lines: [index === 0 ? "PEAK" : "LOW", entry?.name || "Series"],
            valueText: formatNumber(point.value),
            color: point.color,
            seriesId: point.seriesId,
            index: point.index
          };
          annotations.push(annotation);
          objects.push(annotation);
        });
      }
    }

    if (Number.isInteger(options.activeIndex)) {
      const x = plot.x + slot * (options.activeIndex + 0.5);
      overlay.push({ type: "hover-line", z: 40, x, y: plot.y, w: 0, h: plot.h });
      seriesGeometry.forEach((entry) => {
        const point = entry.points[options.activeIndex];
        if (point) {
          overlay.push({
            type: "hover-point",
            z: 41,
            x: point.x,
            y: point.y,
            radius: 6,
            color: entry.color
          });
        }
      });
    }

    const coreObjects = objects.slice();
    const result = {
      width,
      height,
      plot,
      slot,
      zeroY,
      mapY,
      data,
      series: seriesGeometry,
      domain,
      transform,
      ticks: domain.ticks,
      labels,
      annotations,
      objects,
      overlay,
      activeIndex: options.activeIndex ?? null,
      error: validation.ok ? null : validation,
      safeState
    };
    result.digest = geometrySignature(result);
    result.objectCount = coreObjects.length;
    return result;
  }

  function easeOutCubic(value) {
    return 1 - (1 - value) ** 3;
  }

  function animationProgress() {
    return easeOutCubic(clamp(animation.clock / animation.duration, 0, 1));
  }

  function roundRectPath(ctx, x, y, w, h, radius) {
    const safeRadius = Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + w - safeRadius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + safeRadius);
    ctx.lineTo(x + w, y + h - safeRadius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - safeRadius, y + h);
    ctx.lineTo(x + safeRadius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
  }

  function drawCanvasBackground(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#141a16";
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * 0.16, -20, 0, width * 0.16, -20, width * 0.76);
    glow.addColorStop(0, "rgba(217, 255, 79, 0.055)");
    glow.addColorStop(0.54, "rgba(217, 255, 79, 0.01)");
    glow.addColorStop(1, "rgba(217, 255, 79, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    const shade = ctx.createLinearGradient(0, height * 0.2, 0, height);
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(1, 4, 2, 0.16)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
  }

  function applyCamera(ctx, sourceScene) {
    const { centerX, centerY, zoom, rotation } = sourceScene.transform;
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);
  }

  function drawTextObject(ctx, object) {
    ctx.save();
    ctx.font = object.font || "400 9px 'Ubuntu Sans', 'DejaVu Sans', sans-serif";
    ctx.fillStyle = object.color || "rgba(230, 238, 224, 0.6)";
    ctx.textAlign = object.anchor || "start";
    ctx.textBaseline = "alphabetic";
    const lines = object.lines || [object.text || ""];
    lines.forEach((line, index) => {
      ctx.fillText(line, object.x, object.y + index * 11);
    });
    ctx.restore();
  }

  function drawGridLayer(ctx, sourceScene) {
    if (sourceScene.safeState.grid) {
      ctx.save();
      ctx.lineWidth = 1;
      sourceScene.objects.filter((object) => object.type === "grid-line").forEach((line, index) => {
        ctx.beginPath();
        ctx.setLineDash(index === 0 ? [] : [2, 5]);
        ctx.strokeStyle = index === 0 ? "rgba(230, 239, 223, 0.11)" : "rgba(225, 235, 218, 0.075)";
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x + line.w, line.y);
        ctx.stroke();
      });
      sourceScene.objects.filter((object) => object.type === "x-grid-line").forEach((line) => {
        ctx.beginPath();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(225, 235, 218, 0.035)";
        ctx.moveTo(line.x, line.y);
        ctx.lineTo(line.x, line.y + line.h);
        ctx.stroke();
      });
      ctx.restore();
    }

    const zero = sourceScene.objects.find((object) => object.type === "zero-line");
    if (zero) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(230, 239, 223, 0.24)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(zero.x, zero.y);
      ctx.lineTo(zero.x + zero.w, zero.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAxes(ctx, sourceScene) {
    sourceScene.objects
      .filter((object) => object.type === "axis-label" || object.type === "x-axis-label")
      .forEach((object) => drawTextObject(ctx, object));
    ctx.save();
    ctx.strokeStyle = "rgba(226, 236, 220, 0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sourceScene.plot.x, sourceScene.plot.y);
    ctx.lineTo(sourceScene.plot.x, sourceScene.plot.y + sourceScene.plot.h);
    ctx.stroke();
    ctx.restore();
  }

  function drawBars(ctx, sourceScene, progress) {
    const opacity = sourceScene.safeState.opacity;
    sourceScene.objects.filter((object) => object.type === "bar").forEach((bar) => {
      const animatedHeight = Math.max(0.5, bar.h * progress);
      const y = bar.value >= 0 ? bar.zeroY - animatedHeight : bar.zeroY;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = bar.color;
      roundRectPath(ctx, bar.x, y, bar.w, animatedHeight, 3);
      ctx.fill();
      ctx.globalAlpha = opacity * 0.24;
      ctx.strokeStyle = "#f2f6ed";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawLines(ctx, sourceScene, progress) {
    const opacity = sourceScene.safeState.opacity;
    const revealX = sourceScene.plot.x + sourceScene.plot.w * progress;
    const segments = sourceScene.objects.filter((object) => object.type === "line-segment");
    const points = sourceScene.objects.filter((object) => object.type === "point");
    ctx.save();
    ctx.beginPath();
    ctx.rect(sourceScene.plot.x, sourceScene.plot.y - 8, sourceScene.plot.w, sourceScene.plot.h + 16);
    ctx.clip();
    segments.forEach((segment) => {
      if (segment.points.length < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sourceScene.plot.x, sourceScene.plot.y - 8, Math.max(0, revealX - sourceScene.plot.x), sourceScene.plot.h + 16);
      ctx.clip();
      ctx.beginPath();
      segment.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = segment.color;
      ctx.lineWidth = 1.9;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = segment.color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    });
    points.forEach((point) => {
      if (point.x > revealX + 0.5) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius, 0, TAU);
      ctx.fillStyle = point.color;
      ctx.globalAlpha = opacity;
      ctx.fill();
      ctx.strokeStyle = "#19211b";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  function drawScatter(ctx, sourceScene, progress) {
    const opacity = sourceScene.safeState.opacity;
    sourceScene.objects.filter((object) => object.type === "scatter-point").forEach((point) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius * (0.7 + progress * 0.3), 0, TAU);
      ctx.globalAlpha = opacity * progress;
      ctx.fillStyle = point.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius + 3.5, 0, TAU);
      ctx.globalAlpha = opacity * 0.1;
      ctx.fillStyle = point.color;
      ctx.fill();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = "#151c17";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawAnnotations(ctx, sourceScene, progress) {
    if (progress < 0.35) return;
    const alpha = clamp((progress - 0.35) / 0.65, 0, 1);
    sourceScene.annotations.forEach((annotation) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.strokeStyle = annotation.color;
      ctx.globalAlpha = alpha * 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.moveTo(annotation.anchor.x, annotation.anchor.y);
      ctx.lineTo(annotation.x + (annotation.anchor.x > annotation.x + annotation.w / 2 ? annotation.w : 0), annotation.y + annotation.h / 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(21, 28, 23, 0.92)";
      ctx.strokeStyle = "rgba(241, 246, 236, 0.12)";
      roundRectPath(ctx, annotation.x, annotation.y, annotation.w, annotation.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = annotation.color;
      ctx.beginPath();
      ctx.arc(annotation.x + 9, annotation.y + 10, 2.3, 0, TAU);
      ctx.fill();
      ctx.font = "500 7px 'Ubuntu Mono', 'DejaVu Sans Mono', monospace";
      ctx.fillStyle = "rgba(232, 240, 226, 0.45)";
      ctx.fillText(annotation.lines[0], annotation.x + 16, annotation.y + 12);
      ctx.font = "400 9px 'Ubuntu Sans', 'DejaVu Sans', sans-serif";
      ctx.fillStyle = "rgba(242, 247, 237, 0.9)";
      ctx.fillText(annotation.lines[1], annotation.x + 9, annotation.y + 25);
      ctx.font = "500 9px 'Ubuntu Mono', 'DejaVu Sans Mono', monospace";
      ctx.fillStyle = annotation.color;
      ctx.textAlign = "right";
      ctx.fillText(annotation.valueText, annotation.x + annotation.w - 8, annotation.y + 25);
      ctx.restore();
    });
  }

  function drawOverlay(ctx, sourceScene, progress) {
    if (sourceScene.activeIndex === null) return;
    const line = sourceScene.overlay.find((object) => object.type === "hover-line");
    if (line) {
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(229, 240, 221, 0.28)";
      ctx.lineWidth = 1;
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.x, line.y + line.h);
      ctx.stroke();
      ctx.restore();
    }
    sourceScene.overlay.filter((object) => object.type === "hover-point").forEach((point) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.radius, 0, TAU);
      ctx.fillStyle = point.color;
      ctx.globalAlpha = 0.18 * progress;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#f2f6ed";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawEmptyMessage(ctx, sourceScene) {
    if (sourceScene.series.some((entry) => entry.points.some(Boolean))) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(239, 245, 233, 0.7)";
    ctx.font = "400 11px 'Ubuntu Sans', 'DejaVu Sans', sans-serif";
    ctx.fillText("No finite values in this data selection", sourceScene.plot.x + sourceScene.plot.w / 2, sourceScene.plot.y + sourceScene.plot.h / 2);
    ctx.restore();
  }

  function renderCanvas(updateChrome = true) {
    const canvas = $("#chartCanvas");
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width < 5 || height < 5) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCanvasBackground(ctx, width, height);
    scene = buildScene(width, height, state, { activeIndex });
    const progress = animationProgress();
    ctx.save();
    applyCamera(ctx, scene);
    drawGridLayer(ctx, scene);
    drawAxes(ctx, scene);
    ctx.save();
    ctx.beginPath();
    ctx.rect(scene.plot.x - 8, scene.plot.y - 14, scene.plot.w + 16, scene.plot.h + 24);
    ctx.clip();
    if (scene.safeState.type === "bar") drawBars(ctx, scene, progress);
    else if (scene.safeState.type === "scatter") drawScatter(ctx, scene, progress);
    else drawLines(ctx, scene, progress);
    ctx.restore();
    drawAnnotations(ctx, scene, progress);
    drawOverlay(ctx, scene, progress);
    drawEmptyMessage(ctx, scene);
    ctx.restore();
    scene.renderSignature = geometrySignature(scene);
    lastRenderSignature = scene.renderSignature;
    animation.frame += 1;
    $("#frameCount").textContent = `FRAME ${String(animation.frame).padStart(4, "0")}`;
    if (updateChrome) updateInterface();
  }

  function requestRender(updateChrome = true) {
    renderCanvas(updateChrome);
  }

  function xmlEscape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function svgText(object) {
    const lines = object.lines || [object.text || ""];
    const anchor = object.anchor || "start";
    const tspans = lines.map((line, index) => (
      `<tspan x="${round(object.x)}" dy="${index === 0 ? 0 : 11}">${xmlEscape(line)}</tspan>`
    )).join("");
    return `<text x="${round(object.x)}" y="${round(object.y)}" fill="${object.color || "rgba(230,238,224,.6)"}" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="${object.font?.includes("Mono") ? 9 : 9}" text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
  }

  function buildSvg(sourceScene = scene) {
    if (!sourceScene) return "";
    const { width, height, transform, plot } = sourceScene;
    const deg = round(transform.rotation * 180 / Math.PI, 5);
    const cameraTransform = `translate(${round(transform.centerX)} ${round(transform.centerY)}) rotate(${deg}) scale(${round(transform.zoom, 5)}) translate(${round(-transform.centerX)} ${round(-transform.centerY)})`;
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="strataTitle strataDesc">`);
    parts.push(`<title id="strataTitle">Net performance — Strata Signal Studio</title>`);
    parts.push(`<desc id="strataDesc">Code-generated ${sourceScene.safeState.type} chart with ${sourceScene.objectCount} geometry objects. Text remains editable.</desc>`);
    parts.push(`<metadata id="strataGeometry">${xmlEscape(JSON.stringify({ digest: sourceScene.digest, objects: sourceScene.objectCount, domain: [sourceScene.domain.min, sourceScene.domain.max], missing: sourceScene.series.flatMap((entry) => entry.points).filter((point) => !point).length }))}</metadata>`);
    parts.push(`<defs><clipPath id="strataPlotClip"><rect x="${round(plot.x - 8)}" y="${round(plot.y - 14)}" width="${round(plot.w + 16)}" height="${round(plot.h + 24)}"/></clipPath></defs>`);
    parts.push(`<rect width="${width}" height="${height}" fill="#141a16"/>`);
    parts.push(`<rect width="${width}" height="${height}" fill="url(#strataGlow)"/>`);
    parts.push(`<defs><radialGradient id="strataGlow" cx="16%" cy="0%" r="76%"><stop offset="0" stop-color="#d9ff4f" stop-opacity=".055"/><stop offset=".55" stop-color="#d9ff4f" stop-opacity=".01"/><stop offset="1" stop-color="#d9ff4f" stop-opacity="0"/></radialGradient></defs>`);
    parts.push(`<g transform="${cameraTransform}">`);
    if (sourceScene.safeState.grid) {
      sourceScene.objects.filter((object) => object.type === "grid-line").forEach((line, index) => {
        parts.push(`<line x1="${round(line.x)}" y1="${round(line.y)}" x2="${round(line.x + line.w)}" y2="${round(line.y)}" stroke="#e6efdf" stroke-opacity="${index === 0 ? 0.11 : 0.075}" stroke-width="1"${index === 0 ? "" : ' stroke-dasharray="2 5"'} data-layer="10" data-role="grid"/>`);
      });
      sourceScene.objects.filter((object) => object.type === "x-grid-line").forEach((line) => {
        parts.push(`<line x1="${round(line.x)}" y1="${round(line.y)}" x2="${round(line.x)}" y2="${round(line.y + line.h)}" stroke="#e6efdf" stroke-opacity=".035" stroke-width="1" data-layer="10" data-role="x-grid"/>`);
      });
    }
    const zero = sourceScene.objects.find((object) => object.type === "zero-line");
    if (zero) {
      parts.push(`<line x1="${round(zero.x)}" y1="${round(zero.y)}" x2="${round(zero.x + zero.w)}" y2="${round(zero.y)}" stroke="#e6efdf" stroke-opacity=".24" stroke-width="1" stroke-dasharray="4 4" data-layer="11" data-role="zero"/>`);
    }
    parts.push(`<line x1="${round(plot.x)}" y1="${round(plot.y)}" x2="${round(plot.x)}" y2="${round(plot.y + plot.h)}" stroke="#e6efdf" stroke-opacity=".13" stroke-width="1" data-layer="11" data-role="axis"/>`);
    sourceScene.objects.filter((object) => object.type === "axis-label" || object.type === "x-axis-label").forEach((object) => {
      parts.push(svgText(object).replace("<text ", `<text data-layer="${object.z}" data-role="${object.type}" `));
    });
    parts.push(`<g clip-path="url(#strataPlotClip)">`);
    sourceScene.objects.filter((object) => object.type === "bar").forEach((bar) => {
      parts.push(`<rect x="${round(bar.x)}" y="${round(bar.y)}" width="${round(bar.w)}" height="${round(bar.h)}" rx="3" fill="${bar.color}" fill-opacity="${sourceScene.safeState.opacity}" stroke="#f2f6ed" stroke-opacity="${round(sourceScene.safeState.opacity * 0.24, 3)}" stroke-width=".7" data-layer="${bar.z}" data-role="bar" data-series="${bar.seriesId}" data-value="${bar.value}"/>`);
    });
    sourceScene.objects.filter((object) => object.type === "line-segment").forEach((segment) => {
      const d = segment.points.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="${segment.color}" stroke-opacity="${sourceScene.safeState.opacity}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" data-layer="${segment.z}" data-role="line" data-series="${segment.seriesId}"/>`);
    });
    sourceScene.objects.filter((object) => object.type === "point" || object.type === "scatter-point").forEach((point) => {
      if (point.type === "scatter-point") {
        parts.push(`<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${round(point.radius + 3.5)}" fill="${point.color}" fill-opacity="${round(sourceScene.safeState.opacity * 0.1, 3)}" data-layer="${point.z}" data-role="scatter-halo"/>`);
      }
      parts.push(`<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${round(point.radius)}" fill="${point.color}" fill-opacity="${sourceScene.safeState.opacity}" stroke="#19211b" stroke-width="1.5" data-layer="${point.z}" data-role="${point.type}" data-series="${point.seriesId}" data-value="${point.value}"/>`);
    });
    parts.push("</g>");
    sourceScene.annotations.forEach((annotation) => {
      const connectorX = annotation.anchor.x > annotation.x + annotation.w / 2 ? annotation.x + annotation.w : annotation.x;
      parts.push(`<g data-layer="30" data-role="annotation" data-anchor-x="${round(annotation.anchor.x)}" data-anchor-y="${round(annotation.anchor.y)}">`);
      parts.push(`<line x1="${round(annotation.anchor.x)}" y1="${round(annotation.anchor.y)}" x2="${round(connectorX)}" y2="${round(annotation.y + annotation.h / 2)}" stroke="${annotation.color}" stroke-opacity=".55" stroke-width="1" stroke-dasharray="2 3"/>`);
      parts.push(`<rect x="${round(annotation.x)}" y="${round(annotation.y)}" width="${round(annotation.w)}" height="${round(annotation.h)}" rx="5" fill="#151c17" fill-opacity=".92" stroke="#f1f6ec" stroke-opacity=".12"/>`);
      parts.push(`<circle cx="${round(annotation.x + 9)}" cy="${round(annotation.y + 10)}" r="2.3" fill="${annotation.color}"/>`);
      parts.push(`<text x="${round(annotation.x + 16)}" y="${round(annotation.y + 12)}" fill="#e8f0e2" fill-opacity=".45" font-family="Ubuntu Mono, DejaVu Sans Mono, monospace" font-size="7">${xmlEscape(annotation.lines[0])}</text>`);
      parts.push(`<text x="${round(annotation.x + 9)}" y="${round(annotation.y + 25)}" fill="#f2f7ed" fill-opacity=".9" font-family="Ubuntu Sans, DejaVu Sans, sans-serif" font-size="9">${xmlEscape(annotation.lines[1])}</text>`);
      parts.push(`<text x="${round(annotation.x + annotation.w - 8)}" y="${round(annotation.y + 25)}" fill="${annotation.color}" font-family="Ubuntu Mono, DejaVu Sans Mono, monospace" font-size="9" text-anchor="end">${xmlEscape(annotation.valueText)}</text>`);
      parts.push("</g>");
    });
    parts.push("</g>");
    parts.push("</svg>");
    return parts.join("");
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadDataUrl(filename, dataUrl) {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function showToast(message, kind = "success") {
    const stack = $("#toastStack");
    if (stack.children.length >= 3) stack.firstElementChild?.remove();
    const toast = document.createElement("div");
    toast.className = `toast${kind === "error" ? " is-error" : kind === "warning" ? " is-warning" : ""}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(5px)";
      setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function markSaveStatus(text) {
    const element = $("#saveStatus");
    element.textContent = text;
    window.clearTimeout(saveStatusTimer);
    if (text === "Unsaved changes") {
      saveStatusTimer = window.setTimeout(() => { element.textContent = "Draft"; }, 2200);
    }
  }

  function sceneSeriesRange(entry) {
    const values = entry.values.filter(Number.isFinite);
    if (!values.length) return "no data";
    return formatDomain(Math.min(...values), Math.max(...values));
  }

  function updateLegend(sourceScene) {
    const signature = JSON.stringify({
      sample: sourceScene.safeState.sample,
      visible: sourceScene.safeState.visible,
      domain: [sourceScene.domain.min, sourceScene.domain.max]
    });
    if (signature === legendSignature) return;
    legendSignature = signature;
    const legend = $("#legend");
    legend.innerHTML = "";
    SERIES.forEach((entry) => {
      const visible = sourceScene.safeState.visible[entry.id] !== false;
      const values = sourceScene.data.values[entry.id];
      const range = sceneSeriesRange({ values });
      const button = document.createElement("button");
      button.className = `legend-item${visible ? "" : " is-off"}`;
      button.type = "button";
      button.title = `${visible ? "Hide" : "Show"} ${entry.name}`;
      button.innerHTML = `<span class="legend-dot" style="background:${entry.color}"></span><span>${entry.name}</span><span class="legend-range">${range}</span>`;
      button.addEventListener("click", () => toggleSeries(entry.id));
      legend.appendChild(button);
    });
  }

  function updateSeriesControls(sourceScene) {
    const container = $("#seriesControls");
    const signature = JSON.stringify(sourceScene.safeState.visible);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    container.innerHTML = "";
    SERIES.forEach((entry) => {
      const visible = sourceScene.safeState.visible[entry.id] !== false;
      const button = document.createElement("button");
      button.className = `series-toggle${visible ? "" : " is-off"}`;
      button.type = "button";
      button.setAttribute("aria-pressed", String(visible));
      button.innerHTML = `<i style="background:${entry.color}"></i><span>${entry.name}</span><em>${visible ? "VISIBLE" : "HIDDEN"}</em>`;
      button.addEventListener("click", () => toggleSeries(entry.id));
      container.appendChild(button);
    });
  }

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const percent = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--range", `${clamp(percent, 0, 100)}%`);
  }

  function updateInterface() {
    if (!scene) return;
    updateLegend(scene);
    updateSeriesControls(scene);
    $("#axisRange").textContent = formatDomain(scene.domain.min, scene.domain.max);
    $("#axisRange").title = scene.error ? "Safe fallback domain is active" : "Axis range follows visible series";
    $("#objectCount").textContent = String(scene.objectCount);
    $("#geometryDigest").textContent = scene.digest;
    $("#geometryDigest").title = scene.digest;
    const visibleCount = scene.series.length;
    $("#seriesCount").textContent = `${visibleCount} / ${SERIES.length}`;
    const missing = scene.series.flatMap((entry) => entry.points).filter((point) => !point).length;
    $("#chartSubtitle").textContent = `${scene.data.labels.length} intervals · ${visibleCount} series · ${missing} missing`;

    const errorBox = $("#chartError");
    if (scene.error) {
      errorBox.hidden = false;
      $("#chartErrorText").textContent = scene.error.message;
      $("#renderStatus").textContent = "Invalid input · safe fallback active";
    } else {
      errorBox.hidden = true;
      $("#renderStatus").textContent = state.paused
        ? `Paused at ${Math.round(animation.clock)} ms`
        : animation.clock >= animation.duration
          ? "Canvas renderer ready"
          : `Rendering ${Math.round(animation.clock / animation.duration * 100)}%`;
    }

    const domainError = scene.error?.field === "domain";
    $("#domainMin").classList.toggle("has-error", domainError);
    $("#domainMax").classList.toggle("has-error", domainError);
    $("#domainMin").disabled = state.autoDomain;
    $("#domainMax").disabled = state.autoDomain;
    if (state.autoDomain) {
      $("#domainMin").value = round(scene.domain.min, 2);
      $("#domainMax").value = round(scene.domain.max, 2);
    } else {
      $("#domainMin").value = state.domainMin;
      $("#domainMax").value = state.domainMax;
    }
    $("#domainAuto").setAttribute("aria-checked", String(state.autoDomain));

    $("#zoomRange").value = String(Math.round(state.zoom * 100));
    $("#rotateRange").value = String(state.rotation);
    $("#opacityRange").value = String(Math.round(state.opacity * 100));
    $("#zoomOutput").textContent = `${Math.round(state.zoom * 100)}%`;
    $("#rotateOutput").textContent = `${state.rotation}°`;
    $("#rotationValue").textContent = `${state.rotation}°`;
    $("#opacityOutput").textContent = `${Math.round(state.opacity * 100)}%`;
    $("#opacityValue").textContent = `${Math.round(state.opacity * 100)}%`;
    $("#zoomValue").textContent = String(Math.round(state.zoom * 100));
    $("#gridToggle").checked = state.grid;
    $("#pointToggle").checked = state.labels;
    ["zoomRange", "rotateRange", "opacityRange"].forEach((id) => updateRangeFill($(`#${id}`)));
    $$(".type-switch button").forEach((button) => button.classList.toggle("is-active", button.dataset.type === state.type));
    $("#sampleSelect").value = state.sample;
    $("#pauseBtn").classList.toggle("is-paused", state.paused);
    $("#pauseBtn").setAttribute("aria-label", state.paused ? "Resume animation" : "Pause animation");
    $("#pausedPill").hidden = !state.paused;
    $("#pausedClock").textContent = `${Math.round(animation.clock)} ms`;
    $("#undoBtn").disabled = undoStack.length === 0;
  }

  function pushUndo(source = state) {
    undoStack.push(cloneState(source));
    if (undoStack.length > 50) undoStack.shift();
    $("#undoBtn").disabled = false;
  }

  function replaceState(next) {
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, cloneState(next));
    activeIndex = null;
  }

  function afterStateChange({ animate = true } = {}) {
    markSaveStatus("Unsaved changes");
    legendSignature = "";
    $("#seriesControls").dataset.signature = "";
    $("#previewHash").textContent = "—";
    $("#previewHash").classList.remove("is-pass", "is-fail");
    if (animate) startAnimation(true);
    else requestRender(true);
  }

  function commit(mutator, options = {}) {
    pushUndo();
    mutator(state);
    afterStateChange(options);
  }

  function toggleSeries(id) {
    const visibleCount = SERIES.filter((entry) => state.visible[entry.id] !== false).length;
    if (state.visible[id] !== false && visibleCount <= 1) {
      showToast("One series must stay visible. Toggle another series first.", "warning");
      return;
    }
    commit((draft) => {
      draft.visible[id] = draft.visible[id] === false;
    });
  }

  function animationLoop(timestamp) {
    if (!animation.lastTime) animation.lastTime = timestamp;
    const delta = Math.min(Math.max(0, timestamp - animation.lastTime), 50);
    animation.lastTime = timestamp;
    if (!state.paused && animation.clock < animation.duration) {
      animation.clock = Math.min(animation.duration, animation.clock + delta);
      renderCanvas(false);
    }
    if (!state.paused && animation.clock < animation.duration) {
      animation.raf = requestAnimationFrame(animationLoop);
    } else {
      animation.raf = 0;
      updateInterface();
    }
  }

  function startAnimation(restart = true) {
    if (restart) animation.clock = 0;
    animation.lastTime = 0;
    if (animation.raf) cancelAnimationFrame(animation.raf);
    animation.raf = 0;
    renderCanvas(true);
    if (!state.paused && animation.clock < animation.duration) {
      animation.raf = requestAnimationFrame(animationLoop);
    }
  }

  function pauseAnimation() {
    if (state.paused) return;
    state.paused = true;
    if (animation.raf) cancelAnimationFrame(animation.raf);
    animation.raf = 0;
    animation.lastTime = 0;
    renderCanvas(true);
  }

  function resumeAnimation() {
    if (!state.paused) return;
    state.paused = false;
    animation.lastTime = 0;
    if (animation.clock < animation.duration) {
      animation.raf = requestAnimationFrame(animationLoop);
    }
    renderCanvas(true);
  }

  function settleAnimation() {
    animation.clock = animation.duration;
    animation.lastTime = 0;
    if (animation.raf) cancelAnimationFrame(animation.raf);
    animation.raf = 0;
    activeIndex = null;
    renderCanvas(true);
  }

  function applyScenario(name) {
    const factory = SCENARIOS[name] || SCENARIOS.default;
    pushUndo();
    replaceState(factory());
    state.paused = false;
    animation.clock = 0;
    afterStateChange({ animate: true });
    const messages = {
      default: "Default scenario loaded.",
      extreme: "Extreme scenario loaded: long labels, negatives and a tighter camera.",
      invalid: "Invalid domain loaded. A clear fallback chart remains visible."
    };
    showToast(messages[name] || messages.default, name === "invalid" ? "warning" : "success");
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    replaceState(previous);
    state.paused = false;
    legendSignature = "";
    $("#seriesControls").dataset.signature = "";
    startAnimation(true);
    $("#undoBtn").disabled = undoStack.length === 0;
    showToast("Previous parameter set restored.");
  }

  function geometrySnapshot(sourceScene) {
    return sourceScene.objects
      .filter((object) => object.z < 40)
      .map((object) => ({
        type: object.type,
        z: object.z,
        x: round(object.x || 0, 4),
        y: round(object.y || 0, 4),
        w: round(object.w || 0, 4),
        h: round(object.h || 0, 4),
        radius: round(object.radius || 0, 4),
        points: object.points ? object.points.map((point) => ({ x: round(point.x, 4), y: round(point.y, 4) })) : undefined
      }));
  }

  function compareGeometrySnapshots(before, after) {
    let maxDelta = 0;
    const count = Math.max(before.length, after.length);
    for (let index = 0; index < count; index += 1) {
      const a = before[index];
      const b = after[index];
      if (!a || !b || a.type !== b.type) {
        return { equal: false, maxDelta: Infinity, reason: `object ${index} missing or type changed` };
      }
      const keys = ["x", "y", "w", "h", "radius"];
      keys.forEach((key) => {
        maxDelta = Math.max(maxDelta, Math.abs((a[key] || 0) - (b[key] || 0)));
      });
      if (a.points || b.points) {
        const pointsA = a.points || [];
        const pointsB = b.points || [];
        if (pointsA.length !== pointsB.length) {
          return { equal: false, maxDelta: Infinity, reason: `segment ${index} point count changed` };
        }
        pointsA.forEach((point, pointIndex) => {
          maxDelta = Math.max(
            maxDelta,
            Math.abs(point.x - pointsB[pointIndex].x),
            Math.abs(point.y - pointsB[pointIndex].y)
          );
        });
      }
    }
    return { equal: maxDelta < 0.001, maxDelta: round(maxDelta, 6), reason: "" };
  }

  function canvasCoverage() {
    const canvas = $("#chartCanvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const stride = Math.max(4, Math.floor(canvas.width / 160)) * 4;
    const colors = new Set();
    let sum = 0;
    let sumSquares = 0;
    let samples = 0;
    for (let index = 0; index < data.length; index += stride) {
      const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      colors.add(`${data[index] >> 3}-${data[index + 1] >> 3}-${data[index + 2] >> 3}`);
      sum += luminance;
      sumSquares += luminance * luminance;
      samples += 1;
    }
    const mean = sum / Math.max(1, samples);
    return {
      colors: colors.size,
      variance: round(sumSquares / Math.max(1, samples) - mean * mean, 3),
      samples,
      nonBlank: colors.size > 16 && sumSquares / Math.max(1, samples) - mean * mean > 2
    };
  }

  async function captureVisual() {
    const canvas = $("#chartCanvas");
    const dataUrl = canvas.toDataURL("image/png");
    const svg = buildSvg(scene);
    const [previewHash, svgHash] = await Promise.all([sha256(dataUrl), sha256(svg)]);
    return {
      digest: scene.digest,
      objectCount: scene.objectCount,
      geometry: geometrySnapshot(scene),
      previewHash,
      svgHash,
      svg,
      svgTextCount: (svg.match(/<text/g) || []).length,
      coverage: canvasCoverage(),
      labelOverlaps: labelOverlapCount(scene),
      domain: { ...scene.domain },
      error: scene.error ? { ...scene.error } : null
    };
  }

  function shortHash(hash) {
    return hash && hash.length > 12 ? `${hash.slice(0, 12)}…` : hash || "—";
  }

  function setPreviewMetric(hash, stateClass = "") {
    const element = $("#previewHash");
    element.textContent = shortHash(hash);
    element.title = hash || "";
    element.classList.remove("is-pass", "is-fail");
    if (stateClass) element.classList.add(stateClass);
  }

  function setAuditStatus(text, stateClass = "") {
    const element = $("#auditStatus");
    element.textContent = text;
    element.classList.remove("is-pass", "is-fail", "is-idle");
    if (stateClass) element.classList.add(stateClass);
  }

  async function takeSnapshot() {
    settleAnimation();
    const metrics = await captureVisual();
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
    downloadDataUrl(`strata-signal-${timestamp}.png`, $("#chartCanvas").toDataURL("image/png"));
    setPreviewMetric(metrics.previewHash, "is-pass");
    setAuditStatus("Snapshot saved", "is-pass");
    $("#auditLog").textContent = `PNG ${metrics.previewHash.slice(0, 24)}… · ${metrics.objectCount} geometry objects · preview hash stored.`;
    showToast(`Snapshot saved · ${shortHash(metrics.previewHash)}`);
    return metrics;
  }

  function exportSvg() {
    settleAnimation();
    const svg = buildSvg(scene);
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
    download(`strata-signal-${timestamp}.svg`, svg, "image/svg+xml;charset=utf-8");
    const textCount = (svg.match(/<text/g) || []).length;
    const svgHash = hashString(svg);
    lastSvg = svg;
    $("#auditLog").textContent = `SVG exported with ${textCount} editable text nodes and ${scene.objectCount} internal geometry objects.`;
    setAuditStatus("SVG exported", "is-pass");
    showToast(`SVG exported · ${textCount} editable text nodes · ${shortHash(svgHash)}`);
    return { svg, textCount, svgHash };
  }

  const STORAGE_KEY = "strata.signal.views.v1";
  let memoryViews = [];

  function readSavedViews() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return memoryViews;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : memoryViews;
    } catch {
      return memoryViews;
    }
  }

  function writeSavedViews(views) {
    memoryViews = views;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
    } catch {
      /* Local storage can be disabled; the in-memory list still works. */
    }
  }

  function renderSavedViews() {
    const views = readSavedViews();
    const container = $("#savedList");
    if (!views.length) {
      container.innerHTML = '<p class="empty-copy">No saved views yet.<br>Capture a working state to reuse it.</p>';
      return;
    }
    container.innerHTML = "";
    views.forEach((view) => {
      const button = document.createElement("button");
      button.className = "saved-item";
      button.type = "button";
      button.title = `Load ${view.name} and verify its hash`;
      button.innerHTML = `<i></i><span>${xmlEscape(view.name)}</span>`;
      button.addEventListener("click", () => loadSavedView(view.id));
      container.appendChild(button);
    });
  }

  async function saveCurrentView(options = {}) {
    settleAnimation();
    const metrics = await captureVisual();
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const view = {
      id: `view-${Date.now()}-${Math.round(Math.random() * 9999)}`,
      name: options.name || `${state.type[0].toUpperCase()}${state.type.slice(1)} · ${state.sample} · ${time}`,
      createdAt: new Date().toISOString(),
      state: cloneState(state),
      metrics: {
        digest: metrics.digest,
        objectCount: metrics.objectCount,
        previewHash: metrics.previewHash,
        svgHash: metrics.svgHash
      }
    };
    const views = [view, ...readSavedViews().filter((entry) => entry.id !== view.id)].slice(0, 8);
    writeSavedViews(views);
    renderSavedViews();
    setPreviewMetric(metrics.previewHash, "is-pass");
    setAuditStatus("View saved", "is-pass");
    $("#auditLog").textContent = `Saved “${view.name}”. Preview, geometry digest and SVG hash are stored for reload verification.`;
    markSaveStatus("Saved locally");
    showToast(`View saved · ${shortHash(metrics.previewHash)}`);
    return view;
  }

  async function loadSavedView(id) {
    const view = readSavedViews().find((entry) => entry.id === id);
    if (!view) {
      showToast("Saved view could not be found.", "error");
      return null;
    }
    pushUndo();
    replaceState(view.state);
    state.paused = false;
    settleAnimation();
    const metrics = await captureVisual();
    const hashMatch = metrics.previewHash === view.metrics.previewHash;
    const digestMatch = metrics.digest === view.metrics.digest;
    const svgMatch = metrics.svgHash === view.metrics.svgHash;
    const passed = hashMatch && digestMatch && svgMatch;
    setPreviewMetric(metrics.previewHash, passed ? "is-pass" : "is-fail");
    setAuditStatus(passed ? "Reload verified" : "Reload mismatch", passed ? "is-pass" : "is-fail");
    $("#auditLog").textContent = passed
      ? `“${view.name}” reloaded: screenshot hash, structure digest and SVG hash all match (${shortHash(metrics.previewHash)}).`
      : `Reload mismatch: pixels ${hashMatch ? "match" : "differ"}, geometry ${digestMatch ? "matches" : "differs"}, SVG ${svgMatch ? "matches" : "differs"}.`;
    showToast(
      passed ? `Reload verified · ${shortHash(metrics.previewHash)}` : "Reload verification failed. See audit log.",
      passed ? "success" : "error"
    );
    return { passed, hashMatch, digestMatch, svgMatch, view, metrics };
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function transformedLabelBoxes(sourceScene) {
    return sourceScene.labels.map((label) => {
      const corners = [
        { x: label.x - label.boxWidth / 2, y: label.y - 9 },
        { x: label.x + label.boxWidth / 2, y: label.y - 9 },
        { x: label.x + label.boxWidth / 2, y: label.y + label.boxHeight - 8 },
        { x: label.x - label.boxWidth / 2, y: label.y + label.boxHeight - 8 }
      ].map((point) => transformPoint(point, sourceScene.transform));
      return {
        left: Math.min(...corners.map((point) => point.x)),
        right: Math.max(...corners.map((point) => point.x)),
        top: Math.min(...corners.map((point) => point.y)),
        bottom: Math.max(...corners.map((point) => point.y))
      };
    });
  }

  function labelOverlapCount(sourceScene) {
    const boxes = transformedLabelBoxes(sourceScene);
    let overlaps = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      for (let other = index + 1; other < boxes.length; other += 1) {
        const a = boxes[index];
        const b = boxes[other];
        const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (xOverlap > 1 && yOverlap > 1) overlaps += 1;
      }
    }
    return overlaps;
  }

  async function auditScenario(name) {
    replaceState(SCENARIOS[name]());
    state.paused = false;
    settleAnimation();
    const before = await captureVisual();
    renderCanvas(false);
    const after = await captureVisual();
    const geometry = compareGeometrySnapshots(before.geometry, after.geometry);
    const internalMatch = before.svg.includes(before.digest) && before.objectCount === before.geometry.length;
    const countMatch = before.objectCount === after.objectCount;
    const previewMatch = before.previewHash === after.previewHash;
    const svgMatch = before.svgHash === after.svgHash;
    const labelsClear = before.labelOverlaps === 0 && after.labelOverlaps === 0;
    const errorExpected = name === "invalid";
    const errorState = Boolean(before.error);
    const visibleFallback = errorExpected
      ? errorState && before.objectCount > 20 && before.coverage.nonBlank
      : !errorState && before.coverage.nonBlank;
    const passed = countMatch && geometry.equal && previewMatch && svgMatch && internalMatch && visibleFallback && labelsClear;
    return {
      name: `${name} recalculation`,
      passed,
      objectCount: before.objectCount,
      recalculatedObjectCount: after.objectCount,
      geometryDelta: geometry.maxDelta,
      previewMatch,
      svgMatch,
      internalMatch,
      coverage: before.coverage,
      labelOverlaps: before.labelOverlaps,
      error: before.error,
      expectedError: errorExpected,
      detail: `${before.objectCount}/${after.objectCount} objects · Δ${geometry.maxDelta}px · preview ${previewMatch ? "match" : "mismatch"} · SVG ${svgMatch ? "match" : "mismatch"} · overlaps ${before.labelOverlaps}${errorExpected ? " · fallback visible" : ""}`
    };
  }

  async function auditPauseResume() {
    replaceState(DEFAULTS());
    state.paused = false;
    animation.clock = 0;
    startAnimation(true);
    await wait(170);
    pauseAnimation();
    const pausedClock = animation.clock;
    const pausedFrame = animation.frame;
    await wait(230);
    const frozenClock = animation.clock;
    const frozenFrame = animation.frame;
    const frozen = frozenClock === pausedClock && frozenFrame === pausedFrame;
    resumeAnimation();
    await wait(110);
    const resumedClock = animation.clock;
    const resumedFrame = animation.frame;
    const advanced = resumedClock > frozenClock;
    const noJump = resumedClock - frozenClock <= 170;
    const frameAdvanced = resumedFrame > frozenFrame;
    settleAnimation();
    return {
      name: "pause + resume",
      passed: frozen && advanced && noJump && frameAdvanced,
      detail: `paused ${Math.round(pausedClock)}ms / frozen ${Math.round(frozenClock)}ms / resumed ${Math.round(resumedClock)}ms · Δ${Math.round(resumedClock - frozenClock)}ms`
    };
  }

  async function auditTransform() {
    replaceState(DEFAULTS());
    settleAnimation();
    const baseScene = scene;
    const baseLabelOverlaps = labelOverlapCount(baseScene);
    const baseAnnotation = baseScene.annotations[0];
    const baseScreenAnchor = baseAnnotation ? transformPoint(baseAnnotation.anchor, baseScene.transform) : null;
    const baseScreenLabel = baseAnnotation ? transformPoint({
      x: baseAnnotation.x + baseAnnotation.w / 2,
      y: baseAnnotation.y + baseAnnotation.h / 2
    }, baseScene.transform) : null;
    const baseOffset = baseScreenAnchor
      ? Math.hypot(baseScreenLabel.x - baseScreenAnchor.x, baseScreenLabel.y - baseScreenAnchor.y)
      : 0;

    replaceState({ ...DEFAULTS(), zoom: 1.08, rotation: 5 });
    settleAnimation();
    const transformedScene = scene;
    const annotation = transformedScene.annotations[0];
    const screenAnchor = annotation ? transformPoint(annotation.anchor, transformedScene.transform) : null;
    const screenLabel = annotation ? transformPoint({
      x: annotation.x + annotation.w / 2,
      y: annotation.y + annotation.h / 2
    }, transformedScene.transform) : null;
    const transformedOffset = screenAnchor
      ? Math.hypot(screenLabel.x - screenAnchor.x, screenLabel.y - screenAnchor.y)
      : 0;
    const expectedOffset = baseOffset * transformedScene.transform.zoom;
    const anchorDrift = annotation
      ? Math.hypot(annotation.anchor.x - baseAnnotation.anchor.x, annotation.anchor.y - baseAnnotation.anchor.y)
      : Infinity;
    const offsetDrift = Math.abs(transformedOffset - expectedOffset);
    const overlaps = labelOverlapCount(transformedScene);
    const relationStable = anchorDrift < 0.001 && offsetDrift < 0.001 && overlaps === 0;
    return {
      name: "zoom + rotation labels",
      passed: relationStable && baseLabelOverlaps === 0,
      detail: `anchor drift ${round(anchorDrift, 4)}px · offset drift ${round(offsetDrift, 4)}px · label overlaps ${overlaps}`
    };
  }

  async function auditOcclusion() {
    replaceState({ ...DEFAULTS(), type: "bar", opacity: 0.55 });
    settleAnimation();
    const firstDigest = scene.digest;
    renderCanvas(false);
    const secondDigest = scene.digest;
    const bars = scene.objects.filter((object) => object.type === "bar");
    const annotations = scene.objects.filter((object) => object.type === "annotation");
    const highestBarZ = Math.max(...bars.map((object) => object.z));
    const lowestAnnotationZ = Math.min(...annotations.map((object) => object.z));
    const hoverZ = 40;
    const orderStable = highestBarZ < lowestAnnotationZ && lowestAnnotationZ < hoverZ;
    const zStable = bars.every((bar) => bar.z === 20 + Math.max(0, scene.series.findIndex((entry) => entry.id === bar.seriesId)));
    return {
      name: "occlusion + transparency",
      passed: firstDigest === secondDigest && orderStable && zStable && bars.length > 0,
      detail: `z ${highestBarZ} < ${lowestAnnotationZ} < ${hoverZ} · digest ${firstDigest === secondDigest ? "stable" : "changed"} · opacity 55%`
    };
  }

  async function auditSaveReload() {
    replaceState({ ...DEFAULTS(), type: "scatter", sample: "sparse", zoom: 1.03, rotation: -2 });
    settleAnimation();
    const view = await saveCurrentView({ name: `QA baseline · ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` });
    replaceState(SCENARIOS.invalid());
    settleAnimation();
    const reload = await loadSavedView(view.id);
    return {
      name: "save + reload hashes",
      passed: Boolean(reload?.passed),
      detail: reload
        ? `preview ${reload.hashMatch ? "match" : "mismatch"} · digest ${reload.digestMatch ? "match" : "mismatch"} · SVG ${reload.svgMatch ? "match" : "mismatch"}`
        : "saved view not found"
    };
  }

  async function runFullAudit() {
    const button = $("#runAuditBtn");
    const original = cloneState(state);
    button.classList.add("is-busy");
    button.textContent = "Auditing…";
    setAuditStatus("Running", "");
    $("#auditLog").textContent = "Recomputing geometry, hashing the PNG preview, and reloading a saved parameter set…";
    const tests = [];
    try {
      for (const scenarioName of ["default", "extreme", "invalid"]) {
        tests.push(await auditScenario(scenarioName));
      }
      tests.push(await auditPauseResume());
      tests.push(await auditTransform());
      tests.push(await auditOcclusion());
      tests.push(await auditSaveReload());
      replaceState(original);
      state.paused = false;
      settleAnimation();
      const finalMetrics = await captureVisual();
      setPreviewMetric(finalMetrics.previewHash, tests.every((test) => test.passed) ? "is-pass" : "is-fail");
      const passed = tests.filter((test) => test.passed).length;
      const allPassed = passed === tests.length;
      setAuditStatus(`${passed} / ${tests.length} pass`, allPassed ? "is-pass" : "is-fail");
      $("#auditLog").textContent = `${tests.map((test) => `${test.passed ? "PASS" : "FAIL"} ${test.name}`).join(" · ")}`;
      $("#auditLog").title = tests.map((test) => `${test.passed ? "PASS" : "FAIL"} — ${test.name}: ${test.detail}`).join("\n");
      console.groupCollapsed(`Strata audit · ${passed}/${tests.length} pass`);
      tests.forEach((test) => console.log(test.passed ? "PASS" : "FAIL", test.name, test.detail));
      console.groupEnd();
      showToast(
        allPassed ? `Audit passed · ${tests.length}/${tests.length} checks` : `Audit found ${tests.length - passed} issue(s)`,
        allPassed ? "success" : "error"
      );
      return { passed: allPassed, tests, previewHash: finalMetrics.previewHash, digest: finalMetrics.digest };
    } catch (error) {
      setAuditStatus("Audit error", "is-fail");
      $("#auditLog").textContent = `Audit could not complete: ${error.message}`;
      showToast(`Audit error: ${error.message}`, "error");
      return { passed: false, tests, error: error.message };
    } finally {
      button.classList.remove("is-busy");
      button.textContent = "Run full audit";
    }
  }

  function updateTooltip(index, pointer) {
    const tooltip = $("#tooltip");
    if (index === null || !scene) {
      tooltip.hidden = true;
      return;
    }
    const label = scene.data.labels[index];
    const rows = scene.series.map((entry) => {
      const value = entry.points[index]?.value;
      const display = Number.isFinite(value) ? formatNumber(value) : "missing";
      return `<div class="tooltip-row"><i style="background:${entry.color}"></i><span>${entry.name}</span><b>${display === "missing" ? "—" : display}</b>${display === "missing" ? "<em>NO DATA</em>" : ""}</div>`;
    }).join("");
    tooltip.innerHTML = `<div class="tooltip-title">${xmlEscape(label)}</div>${rows}`;
    const stage = $("#chartStage");
    const stageRect = stage.getBoundingClientRect();
    const x = pointer?.x ?? stageRect.width / 2;
    const y = pointer?.y ?? stageRect.height / 2;
    tooltip.style.left = `${clamp(x, 12, stageRect.width - 12)}px`;
    tooltip.style.top = `${clamp(y, 48, stageRect.height - 48)}px`;
    tooltip.style.transform = x > stageRect.width - 210
      ? "translate(calc(-100% - 12px), -50%)"
      : "translate(12px, -50%)";
    tooltip.hidden = false;
  }

  function canvasPointer(event) {
    if (!scene) return;
    const canvas = $("#chartCanvas");
    const rect = canvas.getBoundingClientRect();
    const basePoint = inversePoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    }, scene.transform);
    if (
      basePoint.x < scene.plot.x - 8
      || basePoint.x > scene.plot.x + scene.plot.w + 8
      || basePoint.y < scene.plot.y - 12
      || basePoint.y > scene.plot.y + scene.plot.h + 30
    ) {
      if (activeIndex !== null) {
        activeIndex = null;
        renderCanvas(false);
        updateTooltip(null);
      }
      return;
    }
    const index = clamp(Math.floor((basePoint.x - scene.plot.x) / scene.slot), 0, scene.data.labels.length - 1);
    if (index !== activeIndex) {
      activeIndex = index;
      renderCanvas(false);
    }
    const screenPoint = transformPoint({
      x: scene.plot.x + scene.slot * (index + 0.5),
      y: scene.plot.y + scene.plot.h * 0.48
    }, scene.transform);
    updateTooltip(index, screenPoint);
  }

  function bindScrubSlider(selector, property, readValue) {
    const input = $(selector);
    let undoSnapshot = null;
    input.addEventListener("pointerdown", () => {
      undoSnapshot = cloneState();
    });
    input.addEventListener("keydown", () => {
      if (!undoSnapshot) undoSnapshot = cloneState();
    });
    input.addEventListener("input", () => {
      state[property] = readValue(input);
      afterStateChange({ animate: false });
    });
    input.addEventListener("change", () => {
      if (undoSnapshot) {
        undoStack.push(undoSnapshot);
        if (undoStack.length > 50) undoStack.shift();
      }
      undoSnapshot = null;
      $("#undoBtn").disabled = undoStack.length === 0;
    });
  }

  function bindControls() {
    $("#undoBtn").addEventListener("click", undo);
    $("#saveBtn").addEventListener("click", () => saveCurrentView());
    $("#captureBtn").addEventListener("click", () => takeSnapshot());
    $("#exportBtn").addEventListener("click", exportSvg);
    $("#runAuditBtn").addEventListener("click", runFullAudit);
    $("#resetBtn").addEventListener("click", () => {
      pushUndo();
      replaceState(DEFAULTS());
      state.paused = false;
      afterStateChange({ animate: true });
      showToast("Chart controls reset to the default sample.");
    });
    $("#pauseBtn").addEventListener("click", () => {
      if (state.paused) resumeAnimation();
      else pauseAnimation();
    });

    $$(".type-switch button").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.type === button.dataset.type) return;
        commit((draft) => { draft.type = button.dataset.type; });
      });
    });

    $("#sampleSelect").addEventListener("change", (event) => {
      commit((draft) => {
        draft.sample = event.target.value;
        draft.visible = { revenue: true, result: true, cost: true };
        draft.autoDomain = true;
      }, { animate: true });
    });

    $("#domainAuto").addEventListener("click", () => {
      pushUndo();
      if (state.autoDomain) {
        state.autoDomain = false;
        state.domainMin = round(scene.domain.min, 2);
        state.domainMax = round(scene.domain.max, 2);
      } else {
        state.autoDomain = true;
      }
      afterStateChange({ animate: false });
    });

    ["domainMin", "domainMax"].forEach((id) => {
      $(`#${id}`).addEventListener("change", (event) => {
        commit((draft) => {
          draft.autoDomain = false;
          draft[id] = event.target.value.trim() === "" ? "invalid" : Number(event.target.value);
        }, { animate: false });
      });
    });

    bindScrubSlider("#zoomRange", "zoom", (input) => Number(input.value) / 100);
    bindScrubSlider("#rotateRange", "rotation", (input) => Number(input.value));
    bindScrubSlider("#opacityRange", "opacity", (input) => Number(input.value) / 100);

    $("#gridToggle").addEventListener("change", (event) => {
      commit((draft) => { draft.grid = event.target.checked; }, { animate: false });
    });
    $("#pointToggle").addEventListener("change", (event) => {
      commit((draft) => { draft.labels = event.target.checked; }, { animate: false });
    });

    $("#zoomOutBtn").addEventListener("click", () => {
      commit((draft) => { draft.zoom = clamp(round(draft.zoom - 0.02, 2), 0.9, 1.12); }, { animate: false });
    });
    $("#zoomInBtn").addEventListener("click", () => {
      commit((draft) => { draft.zoom = clamp(round(draft.zoom + 0.02, 2), 0.9, 1.12); }, { animate: false });
    });

    $$(".scenario-buttons button").forEach((button) => {
      button.addEventListener("click", () => applyScenario(button.dataset.scenario));
    });

    $("#chartCanvas").addEventListener("pointermove", canvasPointer);
    $("#chartCanvas").addEventListener("pointerleave", () => {
      activeIndex = null;
      updateTooltip(null);
      renderCanvas(false);
    });
    $("#chartStage").addEventListener("pointerleave", () => {
      if (activeIndex !== null) {
        activeIndex = null;
        updateTooltip(null);
        renderCanvas(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        const tag = event.target.tagName;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
        event.preventDefault();
        undo();
      }
      if (event.code === "Space" && !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)) {
        event.preventDefault();
        if (state.paused) resumeAnimation();
        else pauseAnimation();
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => renderCanvas(true));
    });
    resizeObserver.observe($("#chartStage"));

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => renderCanvas(true));
    }
  }

  function publicSceneSummary() {
    if (!scene) renderCanvas(true);
    return {
      width: scene.width,
      height: scene.height,
      digest: scene.digest,
      objectCount: scene.objectCount,
      domain: { ...scene.domain },
      transform: { ...scene.transform },
      error: scene.error ? { ...scene.error } : null,
      series: scene.series.map((entry) => ({
        id: entry.id,
        points: entry.points.filter(Boolean).map((point) => ({
          x: round(point.x, 4),
          y: round(point.y, 4),
          value: point.value,
          index: point.index
        }))
      })),
      annotations: scene.annotations.map((annotation) => ({
        id: annotation.id,
        x: round(annotation.x, 4),
        y: round(annotation.y, 4),
        w: annotation.w,
        h: annotation.h,
        anchor: { x: round(annotation.anchor.x, 4), y: round(annotation.anchor.y, 4) }
      })),
      labels: scene.labels.map((label) => ({
        x: round(label.x, 4),
        y: round(label.y, 4),
        boxWidth: label.boxWidth,
        boxHeight: label.boxHeight,
        lines: label.lines
      })),
      labelOverlaps: labelOverlapCount(scene),
      layers: [...new Set(scene.objects.filter((object) => object.z < 40).map((object) => object.z))].sort((a, b) => a - b)
    };
  }

  function setPublicState(next, options = {}) {
    const current = cloneState(state);
    const merged = { ...current, ...cloneState(next) };
    if (next.visible) merged.visible = { ...current.visible, ...next.visible };
    replaceState(merged);
    state.paused = false;
    afterStateChange({ animate: options.animate === true });
    return cloneState(state);
  }

  window.Strata = {
    getState: () => cloneState(state),
    setState: (next, options) => setPublicState(next, options),
    getScene: () => publicSceneSummary(),
    getSceneGeometry: () => geometrySnapshot(scene),
    render: () => { renderCanvas(true); return publicSceneSummary(); },
    settle: () => { settleAnimation(); return publicSceneSummary(); },
    pause: () => { pauseAnimation(); return { paused: state.paused, clock: animation.clock, frame: animation.frame }; },
    resume: () => { resumeAnimation(); return { paused: state.paused, clock: animation.clock, frame: animation.frame }; },
    animation: () => ({ paused: Boolean(state.paused), clock: animation.clock, frame: animation.frame }),
    buildSvg: () => buildSvg(scene),
    capture: async () => { settleAnimation(); return captureVisual(); },
    saveView: (options) => saveCurrentView(options),
    loadView: (id) => loadSavedView(id),
    listViews: () => cloneState(readSavedViews()),
    applyScenario,
    runAudit: () => runFullAudit(),
    exportSvg: () => exportSvg(),
    snapshot: () => takeSnapshot(),
    labelOverlapCount: () => labelOverlapCount(scene),
    validate: () => validateState(state)
  };

  bindControls();
  renderSavedViews();
  state.paused = false;
  startAnimation(true);
  document.documentElement.dataset.strataReady = "true";
})();
