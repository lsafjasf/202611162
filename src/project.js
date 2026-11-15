const STORE_KEY = 'clip-workbench.project.v1';
const BACKUP_KEY = 'clip-workbench.backup.v1';

export function saveProject(project) {
  const payload = JSON.stringify(project);
  localStorage.setItem(STORE_KEY, payload);
  return { ok: true, bytes: payload.length, savedAt: new Date().toISOString() };
}

export function loadProject() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.scenes)) {
    throw new Error('工程文件版本或结构不兼容');
  }
  return parsed;
}

export function hasSavedProject() {
  return Boolean(localStorage.getItem(STORE_KEY));
}

export function snapshotProject(project) {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(project));
}

// 导出失败时调用：从快照恢复原工程，保证失败不破坏当前数据。
export function restoreBackup() {
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) return null;
  const project = JSON.parse(raw);
  localStorage.setItem(STORE_KEY, raw);
  return project;
}

export function clearBackup() {
  localStorage.removeItem(BACKUP_KEY);
}
