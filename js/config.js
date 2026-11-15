(function () {
  "use strict";

  const WORLD = { width: 1000, height: 640 };
  const CLIP_DB = 92.5;

  const DEFAULT_PARAMS = Object.freeze({
    frequency: 174,
    balance: 0,
    delay: 90,
    gain: 24,
    tempo: 72
  });

  const BUILDINGS = [
    { id: "B01", x: 48, y: 48, w: 218, h: 150, label: "WAREHOUSE 04", sub: "仓储 / 混凝土" },
    { id: "B02", x: 324, y: 44, w: 256, h: 128, label: "BLOCK C2", sub: "商业 / 玻璃幕墙" },
    { id: "B03", x: 676, y: 42, w: 250, h: 155, label: "MARKET HALL", sub: "市场 / 砖石" },
    { id: "B04", x: 50, y: 326, w: 216, h: 185, label: "WORKS 12", sub: "工坊 / 金属板" },
    { id: "B05", x: 342, y: 378, w: 207, h: 150, label: "COURT B", sub: "住宅 / 石材" },
    { id: "B06", x: 654, y: 352, w: 260, h: 205, label: "POWER ANNEX", sub: "配电 / 混凝土" }
  ];

  const SOURCES = [
    { id: "S1", x: 165, y: 248, frequencyRatio: 0.50, period: 8.0, on: 5.2, offset: 0.3, label: "HVAC" },
    { id: "S2", x: 298, y: 116, frequencyRatio: 0.67, period: 9.5, on: 5.8, offset: 3.6, label: "FAN" },
    { id: "S3", x: 612, y: 111, frequencyRatio: 0.82, period: 7.2, on: 4.2, offset: 1.2, label: "VENT" },
    { id: "S4", x: 826, y: 303, frequencyRatio: 1.00, period: 10.5, on: 6.5, offset: 6.2, label: "PUMP" },
    { id: "S5", x: 304, y: 548, frequencyRatio: 1.24, period: 8.6, on: 5.2, offset: 2.1, label: "COMP" },
    { id: "S6", x: 592, y: 518, frequencyRatio: 1.52, period: 9.2, on: 5.3, offset: 5.0, label: "GRID" }
  ];

  const HOTSPOTS = [
    {
      id: "H1",
      x: 290,
      y: 255,
      radius: 58,
      detectRadius: 61,
      sources: [0, 1],
      name: "低频反射巷",
      hint: "西北窄巷",
      tone: "#79e8c6"
    },
    {
      id: "H2",
      x: 618,
      y: 292,
      radius: 56,
      detectRadius: 61,
      sources: [2, 3],
      name: "双墙回声角",
      hint: "中央纵巷",
      tone: "#ffbd68"
    },
    {
      id: "H3",
      x: 934,
      y: 438,
      radius: 55,
      detectRadius: 61,
      sources: [3, 5],
      name: "南侧设备井",
      hint: "东侧外墙",
      tone: "#ff8a70"
    }
  ];

  const START = { x: 483, y: 558 };
  const EXPORT_BEATS = 8;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
  }

  function mod(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function sourceIsOn(source, time) {
    return mod(time + source.offset, source.period) < source.on;
  }

  function getActiveSources(time) {
    return SOURCES.map((source) => sourceIsOn(source, time));
  }

  function sourceFrequency(source, params) {
    return params.frequency * source.frequencyRatio;
  }

  function hotspotBoost(x, y, sourceIndex, time) {
    let boost = 1;
    let peak = 0;
    for (const hotspot of HOTSPOTS) {
      if (!hotspot.sources.includes(sourceIndex)) continue;
      if (!sourceIsOn(SOURCES[sourceIndex], time)) continue;
      const dx = x - hotspot.x;
      const dy = y - hotspot.y;
      const distance = Math.hypot(dx, dy);
      const influence = Math.exp(-(distance * distance) / (2 * 82 * 82));
      boost += influence * 1.7;
      peak = Math.max(peak, influence);
    }
    return { boost, peak };
  }

  function fieldAt(x, y, time, params) {
    let pressure = 0;
    let reflection = 0;
    const active = getActiveSources(time);
    const sourceLevels = [];

    SOURCES.forEach((source, index) => {
      if (!active[index]) {
        sourceLevels.push(0);
        return;
      }
      const distance = Math.hypot(x - source.x, y - source.y);
      const attenuation = 1 / (1 + Math.pow(distance / 92, 1.35));
      const reflected = hotspotBoost(x, y, index, time);
      const amplitude = attenuation * reflected.boost;
      pressure += amplitude;
      reflection = Math.max(reflection, reflected.peak * attenuation);
      sourceLevels.push(amplitude);
    });

    const intrinsic = 42 + 20 * Math.log10(Math.max(0.002, pressure));
    const db = clamp(intrinsic + params.gain, 18, 138);
    return {
      db,
      pressure,
      reflection,
      activeCount: active.filter(Boolean).length,
      clipped: db >= CLIP_DB,
      sourceLevels
    };
  }

  function pointInBuilding(x, y, padding = 0) {
    return BUILDINGS.some((building) =>
      x > building.x - padding && x < building.x + building.w + padding &&
      y > building.y - padding && y < building.y + building.h + padding
    );
  }

  function resolveCollision(x, y, radius = 10) {
    let nextX = clamp(x, 18, WORLD.width - 18);
    let nextY = clamp(y, 18, WORLD.height - 18);
    for (const building of BUILDINGS) {
      const left = building.x - radius;
      const right = building.x + building.w + radius;
      const top = building.y - radius;
      const bottom = building.y + building.h + radius;
      if (nextX <= left || nextX >= right || nextY <= top || nextY >= bottom) continue;
      const distances = [
        { side: "left", value: Math.abs(nextX - left) },
        { side: "right", value: Math.abs(right - nextX) },
        { side: "top", value: Math.abs(nextY - top) },
        { side: "bottom", value: Math.abs(bottom - nextY) }
      ].sort((a, b) => a.value - b.value);
      const nearest = distances[0].side;
      if (nearest === "left") nextX = left;
      if (nearest === "right") nextX = right;
      if (nearest === "top") nextY = top;
      if (nearest === "bottom") nextY = bottom;
    }
    return { x: nextX, y: nextY };
  }

  function nearestHotspot(x, y) {
    let best = HOTSPOTS[0];
    let bestDistance = Infinity;
    HOTSPOTS.forEach((hotspot) => {
      const distance = Math.hypot(x - hotspot.x, y - hotspot.y);
      if (distance < bestDistance) {
        best = hotspot;
        bestDistance = distance;
      }
    });
    return { hotspot: best, distance: bestDistance };
  }

  function measureAt(x, y, time, params) {
    const field = fieldAt(x, y, time, params);
    return {
      ...field,
      x,
      y,
      valid: field.activeCount > 0 && !field.clipped,
      reason: field.activeCount === 0 ? "sources-off" : field.clipped ? "clipped" : "ok",
      time
    };
  }

  function exportDuration(params) {
    return EXPORT_BEATS * 60 / params.tempo;
  }

  function formatDb(value) {
    return Number.isFinite(value) ? value.toFixed(1) : "--";
  }

  function formatSigned(value) {
    const rounded = Math.round(value);
    if (rounded === 0) return "0";
    return rounded > 0 ? `+${rounded}` : `${rounded}`;
  }

  function balanceLabel(value) {
    if (Math.abs(value) < 2) return "CENTER";
    return `${Math.abs(value)}${value < 0 ? "L" : "R"}`;
  }

  function heatRgb(normalized) {
    const n = clamp(normalized, 0, 1);
    if (n < 0.48) {
      const t = n / 0.48;
      return [18 + 15 * t, 53 + 66 * t, 62 + 54 * t];
    }
    if (n < 0.78) {
      const t = (n - 0.48) / 0.30;
      return [33 + 84 * t, 119 + 58 * t, 116 - 35 * t];
    }
    const t = (n - 0.78) / 0.22;
    return [117 + 120 * t, 177 + 4 * t, 81 - 48 * t];
  }

  window.Echo = window.Echo || {};
  window.Echo.config = {
    WORLD,
    CLIP_DB,
    DEFAULT_PARAMS,
    BUILDINGS,
    SOURCES,
    HOTSPOTS,
    START,
    EXPORT_BEATS,
    EXPORT_SAMPLE_RATE: 44100
  };
  window.Echo.utils = {
    clamp,
    lerp,
    approach,
    mod,
    sourceIsOn,
    getActiveSources,
    sourceFrequency,
    fieldAt,
    pointInBuilding,
    resolveCollision,
    nearestHotspot,
    measureAt,
    exportDuration,
    formatDb,
    formatSigned,
    balanceLabel,
    heatRgb
  };
})();
