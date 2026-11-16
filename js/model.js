(function () {
  "use strict";

  const C = 343;
  const WORLD_HALF = 55;
  const EXPORT_SECONDS = 9;
  const SAMPLE_RATE = 44100;
  const JOINT_SPACING = 14;
  const DEFAULTS = Object.freeze({
    speedKmh: 92,
    gauge: 1.435,
    listener: 0
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (gain) => 20 * Math.log10(Math.max(gain, 1e-8));

  function normalizeParams(input) {
    const source = input || {};
    return {
      speedKmh: clamp(Number(source.speedKmh) || DEFAULTS.speedKmh, 50, 140),
      gauge: clamp(Number(source.gauge) || DEFAULTS.gauge, 1, 2.4),
      listener: clamp(Number(source.listener) || 0, -38, 38)
    };
  }

  function acousticsAt(params, trainX) {
    const p = normalizeParams(params);
    const speedMps = p.speedKmh / 3.6;
    const dx = trainX - p.listener;
    const lateral = 0.65 + p.gauge * 2.2;
    const distance = Math.hypot(dx, lateral);
    const lineOfSight = (p.listener - trainX) / Math.max(distance, 0.001);
    const effectiveVelocity = clamp(lineOfSight * speedMps * 1.9, -0.72 * C, 0.72 * C);
    const doppler = clamp(C / (C - effectiveVelocity), 0.72, 1.6);
    const panWidth = 0.45 + p.gauge * 0.48;
    const pan = clamp((dx / 18) * panWidth, -1, 1);
    const distanceGain = 0.12 + 0.62 / (1 + distance / 18);
    const filterHz = 340 + 3400 / (1 + distance / 8);
    const active = trainX >= -WORLD_HALF && trainX <= WORLD_HALF;
    const clickGain = 0.2 + 0.55 / (1 + distance / 20);

    return {
      active,
      trainX,
      dx,
      distance,
      doppler,
      pan,
      panWidth,
      distanceGain,
      filterHz,
      clickGain,
      engineHz: 48 * doppler,
      motorHz: 96 * doppler,
      hornHz: 329.63 * doppler,
      rumbleHz: 25 * doppler,
      phase: Math.abs(dx) < 0.08 ? "PASS" : dx < 0 ? "APPROACH" : "RECEDE"
    };
  }

  function trainXAt(params, elapsed) {
    const p = normalizeParams(params);
    return -WORLD_HALF + (p.speedKmh / 3.6) * Math.max(0, elapsed);
  }

  function passTime(params) {
    const p = normalizeParams(params);
    return (p.listener + WORLD_HALF) / (p.speedKmh / 3.6);
  }

  function exitTime(params) {
    const p = normalizeParams(params);
    return (2 * WORLD_HALF) / (p.speedKmh / 3.6);
  }

  function beatTimes(params, duration, offsetX) {
    const p = normalizeParams(params);
    const speedMps = p.speedKmh / 3.6;
    const list = [];
    const start = offsetX === undefined ? -WORLD_HALF : offsetX;
    const first = Math.ceil((start + WORLD_HALF) / JOINT_SPACING);
    for (let k = first; ; k += 1) {
      const x = -WORLD_HALF + k * JOINT_SPACING;
      if (x > WORLD_HALF) break;
      const t = (x - start) / speedMps;
      if (t >= 0 && t < duration) {
        list.push({ time: t, x, acoustics: acousticsAt(p, x) });
      }
    }
    return list;
  }

  function beatBpm(params) {
    const p = normalizeParams(params);
    return (p.speedKmh / 3.6) / JOINT_SPACING * 60;
  }

  function formatSigned(value, digits) {
    const n = Number(value);
    const fixed = Math.abs(n).toFixed(digits);
    if (Math.abs(n) < Math.pow(10, -digits) / 2) return `0.${"0".repeat(digits)}`;
    return `${n > 0 ? "+" : "−"}${fixed}`;
  }

  function hashParams(params) {
    const p = normalizeParams(params);
    return `${p.speedKmh.toFixed(0)}:${p.gauge.toFixed(3)}:${p.listener.toFixed(1)}`;
  }

  window.RailModel = Object.freeze({
    C,
    WORLD_HALF,
    EXPORT_SECONDS,
    SAMPLE_RATE,
    JOINT_SPACING,
    DEFAULTS,
    clamp,
    lerp,
    dbToGain,
    gainToDb,
    normalizeParams,
    acousticsAt,
    trainXAt,
    passTime,
    exitTime,
    beatTimes,
    beatBpm,
    formatSigned,
    hashParams
  });
})();
