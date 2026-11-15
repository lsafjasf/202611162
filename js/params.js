/* 参数状态：默认值、localStorage 保存/载入、UI 绑定 */
"use strict";

const PARAM_DEFAULTS = {
  threshold: 0.25,   // 触发阈值（检测包络超过此值才开始衰减）
  releaseMs: 450,    // 释放时间
  maxAttenDb: 18,    // 最大衰减
  bpm: 104,          // 节拍
  cutoff: 2200,      // 音乐低通滤波截止
  width: 0.7,        // 立体声宽度
  alarmHz: 880       // 警报中心音高
};

const PARAM_KEYS = Object.keys(PARAM_DEFAULTS);
const STORAGE_KEY = "ducklab.params.v1";

const params = { ...PARAM_DEFAULTS };

function fmtParam(key, val) {
  if (key === "releaseMs") return `${Math.round(val)} ms`;
  if (key === "maxAttenDb") return `${Number(val).toFixed(1)} dB`;
  if (key === "bpm") return `${Math.round(val)}`;
  if (key === "cutoff" || key === "alarmHz") return `${Math.round(val)} Hz`;
  return Number(val).toFixed(2);
}

function syncParamUI() {
  for (const key of PARAM_KEYS) {
    const slider = document.getElementById(`p-${key}`);
    const label = document.getElementById(`v-${key}`);
    if (slider) slider.value = params[key];
    if (label) label.textContent = fmtParam(key, params[key]);
  }
}

function bindParamUI(onChange) {
  for (const key of PARAM_KEYS) {
    const slider = document.getElementById(`p-${key}`);
    if (!slider) continue;
    slider.addEventListener("input", () => {
      params[key] = parseFloat(slider.value);
      document.getElementById(`v-${key}`).textContent = fmtParam(key, params[key]);
      if (onChange) onChange(key);
    });
  }
  syncParamUI();
}

function resetParams() {
  Object.assign(params, PARAM_DEFAULTS);
  syncParamUI();
}

function saveParams() {
  const snapshot = {};
  for (const key of PARAM_KEYS) snapshot[key] = params[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function loadParams() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw);
    for (const key of PARAM_KEYS) {
      if (typeof snapshot[key] === "number") params[key] = snapshot[key];
    }
    syncParamUI();
    return snapshot;
  } catch (err) {
    return null;
  }
}
