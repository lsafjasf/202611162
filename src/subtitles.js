import { TIMELINE_DURATION } from './audio.js';

export const EPS = 0.001;

export function defaultCues() {
  return [
    {
      id: 'c1',
      start: 0.2,
      end: 1.6,
      words: [
        { text: '准备', start: 0.2, end: 0.9 },
        { text: '开始', start: 0.9, end: 1.6 },
      ],
    },
    {
      id: 'c2',
      start: 2.1,
      end: 3.6,
      words: [
        { text: '节拍', start: 2.1, end: 2.85 },
        { text: '提示', start: 2.85, end: 3.6 },
      ],
    },
    {
      id: 'c3',
      start: 4.1,
      end: 5.6,
      words: [
        { text: '结束', start: 4.1, end: 4.85 },
        { text: '确认', start: 4.85, end: 5.6 },
      ],
    },
  ];
}

export function formatVttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

export function parseVttTime(text) {
  const match = /^(\d+):(\d{2}):(\d{2})[.,](\d{3})$/.exec(text.trim());
  if (!match) throw new Error(`Invalid VTT timestamp: ${text}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

// Word timings ride inside the cue payload: inline <mm:ss.mmm> tags for
// standards-friendly recovery, plus a NOTE JSON block carrying full word
// (start,end) data losslessly.
export function exportVtt(cues) {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    lines.push(`${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`);
    const inline = cue.words
      .map((w) => `<${formatVttTime(w.start).slice(3)}>${w.text}`)
      .join(' ');
    lines.push(inline);
    lines.push('NOTE words ' + JSON.stringify(cue.words));
    lines.push('');
  }
  return lines.join('\n');
}

export function importVtt(text) {
  if (!text.trimStart().startsWith('WEBVTT')) throw new Error('Missing WEBVTT header');
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .filter((b) => b.trim() && !b.trim().startsWith('WEBVTT'));
  return blocks.map((block, index) => {
    const rawLines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeLine = rawLines.find((l) => l.includes('-->'));
    if (!timeLine) throw new Error(`Cue ${index + 1} has no timestamp line`);
    const [startText, endText] = timeLine.split('-->').map((s) => s.trim());
    const noteLine = rawLines.find((l) => l.startsWith('NOTE words '));
    const textLine = rawLines.find((l) => !l.includes('-->') && !l.startsWith('NOTE')) ?? '';
    let words;
    if (noteLine) {
      words = JSON.parse(noteLine.slice('NOTE words '.length));
    } else {
      const parts = textLine.split(/(<[^>]+>)/).filter(Boolean);
      words = [];
      for (let i = 0; i < parts.length; i += 1) {
        const tag = /^<(.+)>$/.exec(parts[i]);
        if (tag && parts[i + 1]) {
          const wordStart = parseVttTime(`00:${tag[1]}`);
          const wordText = parts[i + 1].trim();
          const next = parts[i + 2] && /^<(.+)>$/.exec(parts[i + 2]);
          const wordEnd = next ? parseVttTime(`00:${next[1]}`) : parseVttTime(endText);
          words.push({ text: wordText, start: wordStart, end: wordEnd });
          i += 1;
        }
      }
    }
    return {
      id: `c${index + 1}`,
      start: parseVttTime(startText),
      end: parseVttTime(endText),
      words,
    };
  });
}

export function validateCues(cues, duration = TIMELINE_DURATION) {
  const errors = [];
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  for (const cue of cues) {
    if (cue.start < 0 || cue.end > duration) {
      errors.push(`${cue.id}: out of timeline bounds [0, ${duration}s]`);
    }
    if (cue.end - cue.start <= EPS) {
      errors.push(`${cue.id}: duration must be positive`);
    }
    for (const word of cue.words) {
      if (word.start < cue.start - EPS || word.end > cue.end + EPS) {
        errors.push(`${cue.id}: word "${word.text}" escapes cue in/out points`);
      }
      if (word.end - word.start <= EPS) {
        errors.push(`${cue.id}: word "${word.text}" has non-positive duration`);
      }
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end - EPS) {
      errors.push(`${sorted[i - 1].id} and ${sorted[i].id}: cues overlap`);
    }
  }
  return errors;
}

export function moveCue(cue, start, end) {
  const shift = start - cue.start;
  const words = cue.words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
  return { ...cue, start, end, words };
}

export function resizeCue(cue, start, end) {
  return { ...cue, start, end };
}

export function moveWord(cue, wordIndex, start, end) {
  const words = cue.words.map((w, i) => (i === wordIndex ? { ...w, start, end } : w));
  return { ...cue, words };
}
