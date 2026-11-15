// 参数定义、校验与预设持久化（localStorage）

export const PARAM_SCHEMA = {
  threshold: { min: 0, max: 255, integer: true, label: '阈值' },
  smoothness: { min: 0, max: 5, integer: true, label: '平滑度' },
  minArea: { min: 1, max: 5000, integer: true, label: '最小区域' },
};

export const DEFAULT_PARAMS = { threshold: 128, smoothness: 2, minArea: 20 };

export function validateParams(raw) {
  const errors = [];
  const safe = { ...DEFAULT_PARAMS };
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, errors: ['参数必须是对象'], params: safe };
  }
  for (const key of Object.keys(PARAM_SCHEMA)) {
    const rule = PARAM_SCHEMA[key];
    const value = raw[key];
    if (value === undefined || value === null || value === '') {
      errors.push(`${rule.label}(${key}) 缺失`);
      continue;
    }
    if (typeof value === 'boolean' || Number.isNaN(Number(value))) {
      errors.push(`${rule.label}(${key}) 必须是数字，收到: ${JSON.stringify(value)}`);
      continue;
    }
    const num = rule.integer ? Math.trunc(Number(value)) : Number(value);
    if (num < rule.min || num > rule.max) {
      errors.push(`${rule.label}(${key}) 超出范围 [${rule.min}, ${rule.max}]，收到: ${value}`);
      continue;
    }
    safe[key] = num;
  }
  return { ok: errors.length === 0, errors, params: safe };
}

const STORE_KEY = 'lineart.presets.v1';

export function listPresets(storage = localStorage) {
  try {
    const raw = storage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePreset(name, params, storage = localStorage) {
  const check = validateParams(params);
  if (!check.ok) {
    const err = new Error(`参数无效: ${check.errors.join('；')}`);
    err.validationErrors = check.errors;
    throw err;
  }
  const presets = listPresets(storage);
  const record = {
    name: String(name).slice(0, 40),
    params: check.params,
    savedAt: new Date().toISOString(),
  };
  const idx = presets.findIndex((p) => p.name === record.name);
  if (idx >= 0) presets[idx] = record; else presets.push(record);
  storage.setItem(STORE_KEY, JSON.stringify(presets));
  return record;
}

export function loadPreset(name, storage = localStorage) {
  const preset = listPresets(storage).find((p) => p.name === name);
  if (!preset) throw new Error(`预设不存在: ${name}`);
  const check = validateParams(preset.params);
  if (!check.ok) throw new Error(`预设已损坏: ${check.errors.join('；')}`);
  return check.params;
}

export function deletePreset(name, storage = localStorage) {
  const presets = listPresets(storage).filter((p) => p.name !== name);
  storage.setItem(STORE_KEY, JSON.stringify(presets));
}
