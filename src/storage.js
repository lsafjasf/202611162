const KEY = 'wind-plateau-survey:last-summary';

export function saveSummary(summary, download = false) {
  const record = { savedAt: new Date().toISOString(), ...summary };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // 浏览器禁用本地存储时仍可通过下载 JSON 保存。
  }
  if (download) try {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `survey-summary-${summary.seed}-${summary.status}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    // 非浏览器环境忽略。
  }
  return record;
}

export function loadLastSummary() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
