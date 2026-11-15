// Persist the full session (cue layout + every cue's synth parameters).
// Two equivalent channels: a downloadable JSON file and localStorage,
// so automated tests can round-trip without a download dialog.

const STORAGE_KEY = 'cue-tone-studio/session/v1';

export function serializeSession(cues, paramsById) {
  return JSON.stringify(
    {
      version: 1,
      savedAt: new Date().toISOString(),
      cues,
      params: Object.fromEntries(paramsById),
    },
    null,
    2,
  );
}

export function parseSession(text) {
  const data = JSON.parse(text);
  if (data.version !== 1) throw new Error(`Unsupported session version: ${data.version}`);
  if (!Array.isArray(data.cues) || typeof data.params !== 'object') {
    throw new Error('Session file is missing cues or params');
  }
  return { cues: data.cues, params: data.params };
}

export function saveLocal(text) {
  localStorage.setItem(STORAGE_KEY, text);
}

export function loadLocal() {
  const text = localStorage.getItem(STORAGE_KEY);
  return text ? parseSession(text) : null;
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
