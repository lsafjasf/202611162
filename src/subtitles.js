import {
  formatTime,
  getAudioEvents,
  projectFingerprint,
  roundTime,
  uid,
  validateProject,
} from "./project.js";

const TIMING_LINE =
  /((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,3}:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

export function parseTimestamp(value) {
  const parts = String(value).trim().replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`无效时间码：${value}`);
  }
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    throw new Error(`无效时间码：${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseSubtitleText(source) {
  const normalized = String(source)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) throw new Error("字幕文件为空。");

  const body = normalized.startsWith("WEBVTT") ? normalized.replace(/^WEBVTT[^\n]*\n?/, "") : normalized;
  const blocks = body.split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    if (!lines.length) continue;
    const first = lines.find((line) => line.trim())?.trim() || "";
    if (!first || /^(NOTE|STYLE|REGION)\b/.test(first) || /^WEBVTT\b/.test(first)) continue;

    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(TIMING_LINE);
    const start = roundTime(parseTimestamp(match[1]));
    const end = roundTime(parseTimestamp(match[2]));
    if (end <= start) throw new Error(`字幕出点必须晚于入点：${match[1]} --> ${match[2]}`);
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const identifier =
      lines
        .slice(0, timingIndex)
        .map((line) => line.trim())
        .find(Boolean) || "";
    cues.push({
      id: identifier && !/^\d+$/.test(identifier) ? identifier : uid("cue"),
      start,
      end,
      text,
    });
  }

  if (!cues.length) throw new Error("没有找到可导入的字幕条目。");
  const seen = new Set();
  for (const cue of cues) {
    if (!cue.id || seen.has(cue.id)) cue.id = uid("cue");
    seen.add(cue.id);
  }
  return cues;
}

export function exportWebVTT(project) {
  const validation = validateProject(project);
  if (!validation.ok) {
    const error = new Error(validation.errors.join(" "));
    error.validation = validation;
    throw error;
  }

  const metadata = [
    `NOTE CUTLINE-PROJECT`,
    `duration=${formatTime(project.duration, true)}`,
    `fingerprint=${projectFingerprint(project)}`,
    `bpm=${project.audio.bpm}`,
    `audio-start=${formatTime(project.audio.start, true)}`,
  ].join("\n");

  const blocks = project.subtitles.map((cue, index) => {
    const body = cue.text.replace(/\r\n?/g, "\n").trim();
    return [
      cue.id || `cue-${index + 1}`,
      `${formatTime(cue.start, true)} --> ${formatTime(cue.end, true)}`,
      body,
    ].join("\n");
  });

  return `WEBVTT\n\n${metadata}\n\n${blocks.join("\n\n")}\n`;
}

export function readVttDuration(vtt) {
  const match = String(vtt).match(/^duration=(\d{2}:\d{2}:\d{2}\.\d{3})$/m);
  return match ? parseTimestamp(match[1]) : null;
}

export function verifySubtitleRoundTrip(project) {
  const vtt = exportWebVTT(project);
  const parsed = parseSubtitleText(vtt);
  const expected = project.subtitles;
  const timingMatches =
    parsed.length === expected.length &&
    parsed.every(
      (cue, index) =>
        Math.abs(cue.start - expected[index].start) < 0.0005 &&
        Math.abs(cue.end - expected[index].end) < 0.0005,
    );
  const sequenceMatches =
    parsed.length === expected.length &&
    parsed.every((cue, index) => cue.id === expected[index].id);
  const exportedDuration = readVttDuration(vtt);
  const durationMatches =
    exportedDuration !== null && Math.abs(exportedDuration - project.duration) < 0.0005;
  return {
    ok: timingMatches && sequenceMatches && durationMatches,
    cueCount: parsed.length,
    timingMatches,
    sequenceMatches,
    durationMatches,
    duration: exportedDuration,
    vtt,
  };
}

export const LEGACY_SAMPLE = `WEBVTT

1
00:00:00.400 --> 00:00:02.800
旧字幕 01
保留导入顺序

2
00:00:03.400 --> 00:00:05.800
旧字幕 02
风从旧胶片里吹来

3
00:00:06.300 --> 00:00:08.900
旧字幕 03
节拍仍然准确
`;

export function audioEventSummary(project, time) {
  const events = getAudioEvents(project);
  let last = null;
  for (const event of events) {
    if (event.time > time + 0.0001) break;
    last = event;
  }
  return last;
}
