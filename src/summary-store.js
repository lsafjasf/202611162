export const LATEST_SUMMARY_KEY = "ice-ferry:latest-summary";
export const SUMMARY_HISTORY_KEY = "ice-ferry:summaries";
export const FAILURE_SUMMARY_KEY = "ice-ferry:last-failure";

function readJson(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function saveRunSummary(storage, summary, timestamp = new Date().toISOString()) {
  const stored = { ...summary, savedAt: timestamp };
  storage.setItem(LATEST_SUMMARY_KEY, JSON.stringify(stored));
  const history = readJson(storage, SUMMARY_HISTORY_KEY) || [];
  history.unshift(stored);
  storage.setItem(SUMMARY_HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  return stored;
}

export function saveFailedRun(storage, summary, timestamp = new Date().toISOString()) {
  const stored = { ...summary, savedAt: timestamp };
  storage.setItem(FAILURE_SUMMARY_KEY, JSON.stringify(stored));
  return stored;
}

export function loadLatestSummary(storage) {
  return readJson(storage, LATEST_SUMMARY_KEY);
}

export function loadSummaryHistory(storage) {
  return readJson(storage, SUMMARY_HISTORY_KEY) || [];
}
