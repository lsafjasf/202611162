export const STORAGE_KEY = "cutline.project.v1";
export const PROJECT_VERSION = 1;

let idCounter = 0;

export function uid(prefix = "id") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function deepClone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

const DAWN_KEYFRAMES = [
  {
    t: 0,
    skyTop: "#142449",
    skyBottom: "#f19a67",
    horizon: "#ffc78b",
    ground: "#17283c",
    glow: "#ffb454",
    sunX: 0.12,
    sunY: 0.72,
    sunSize: 0.08,
    haze: 0.18,
    wave: 0.08,
    progress: 0,
  },
  {
    t: 5,
    skyTop: "#2b5b91",
    skyBottom: "#ffc17f",
    horizon: "#ffe0ae",
    ground: "#244662",
    glow: "#ffd27f",
    sunX: 0.5,
    sunY: 0.42,
    sunSize: 0.13,
    haze: 0.32,
    wave: 0.18,
    progress: 0.5,
  },
  {
    t: 10,
    skyTop: "#94c8da",
    skyBottom: "#fff0c9",
    horizon: "#fff8e8",
    ground: "#5a8392",
    glow: "#fff3cf",
    sunX: 0.82,
    sunY: 0.17,
    sunSize: 0.1,
    haze: 0.12,
    wave: 0.11,
    progress: 1,
  },
];

const NIGHT_KEYFRAMES = [
  {
    t: 0,
    skyTop: "#070d24",
    skyBottom: "#2e2756",
    horizon: "#e8797d",
    ground: "#101429",
    glow: "#ff8c9b",
    sunX: 0.76,
    sunY: 0.2,
    sunSize: 0.09,
    haze: 0.16,
    wave: 0.1,
    progress: 0,
  },
  {
    t: 5,
    skyTop: "#0b153b",
    skyBottom: "#493567",
    horizon: "#f2a95b",
    ground: "#12213b",
    glow: "#ffb454",
    sunX: 0.44,
    sunY: 0.31,
    sunSize: 0.12,
    haze: 0.3,
    wave: 0.22,
    progress: 0.55,
  },
  {
    t: 10,
    skyTop: "#141b48",
    skyBottom: "#78416d",
    horizon: "#ffc36d",
    ground: "#1a2744",
    glow: "#ffca75",
    sunX: 0.16,
    sunY: 0.52,
    sunSize: 0.07,
    haze: 0.2,
    wave: 0.14,
    progress: 1,
  },
];

export function createDefaultProject() {
  return {
    version: PROJECT_VERSION,
    name: "城市节拍 · 完整示例",
    duration: 20,
    scenes: [
      {
        id: "scene-dawn",
        name: "晨光",
        start: 0,
        end: 10,
        color: "#ffb454",
        keyframes: deepClone(DAWN_KEYFRAMES),
      },
      {
        id: "scene-night",
        name: "夜航",
        start: 10,
        end: 20,
        color: "#6fc9ff",
        keyframes: deepClone(NIGHT_KEYFRAMES),
      },
    ],
    transitions: [
      {
        id: "transition-main",
        type: "crossfade",
        from: "scene-dawn",
        to: "scene-night",
        start: 8.6,
        duration: 2.8,
      },
    ],
    subtitles: [
      {
        id: "cue-1",
        start: 0.6,
        end: 3.2,
        text: "清晨 6:40\n城市刚刚醒来",
      },
      {
        id: "cue-2",
        start: 3.8,
        end: 6.4,
        text: "第一班地铁\n穿过薄雾",
      },
      {
        id: "cue-3",
        start: 7,
        end: 9.6,
        text: "把今天的第一拍\n留给街角",
      },
      {
        id: "cue-4",
        start: 10.2,
        end: 12.8,
        text: "夜色落下\n霓虹接管天际线",
      },
      {
        id: "cue-5",
        start: 13.6,
        end: 16.2,
        text: "每一次呼吸\n都踩在节拍上",
      },
      {
        id: "cue-6",
        start: 17,
        end: 19.3,
        text: "现在，跟着光\n继续向前",
      },
    ],
    audio: {
      bpm: 120,
      start: 0.25,
      master: 0.18,
    },
  };
}

export function beatInterval(project) {
  return 60 / Number(project.audio?.bpm || 120);
}

export function getAudioEvents(project) {
  const interval = beatInterval(project);
  const offset = Math.max(0, Number(project.audio?.start) || 0);
  const events = [];
  for (let index = 0, t = offset; t < project.duration + 0.0001; index += 1, t = offset + index * interval) {
    events.push({ index, time: t, accent: index % 4 === 0 });
  }
  return events;
}

export function getAudioEventAt(project, time) {
  const interval = beatInterval(project);
  const offset = Math.max(0, Number(project.audio?.start) || 0);
  if (time + 0.0001 < offset) return null;
  const index = Math.floor((time - offset) / interval + 0.0001);
  return {
    index,
    time: offset + index * interval,
    accent: index % 4 === 0,
    phase: (time - offset) / interval - index,
  };
}

export function getCueAt(project, time) {
  return project.subtitles.find(
    (cue) => time >= cue.start - 0.0001 && time < cue.end - 0.0001,
  );
}

export function getSceneAt(project, time) {
  const scenes = project.scenes;
  if (!scenes.length) return null;
  return (
    scenes.find((scene) => time >= scene.start && time < scene.end) ||
    [...scenes].reverse().find((scene) => time >= scene.start) ||
    scenes[0]
  );
}

export function formatTime(seconds, withHours = false) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalMilliseconds = Math.round(safe * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const ms = totalMilliseconds % 1000;
  const time = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    ms,
  ).padStart(3, "0")}`;
  return withHours || hours > 0 ? `${String(hours).padStart(2, "0")}:${time}` : time;
}

export function roundTime(seconds) {
  return Math.round((Number(seconds) + Number.EPSILON) * 1000) / 1000;
}

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export function validateProject(project) {
  const errors = [];
  const warnings = [];
  if (!project || typeof project !== "object") {
    return { ok: false, errors: ["工程数据无效。"], warnings };
  }

  const duration = Number(project.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push("视频总时长必须大于 0。");
  }
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    errors.push("工程至少需要一个场景。");
  }
  if (!Array.isArray(project.subtitles)) {
    errors.push("字幕列表无效。");
  }

  const subtitles = Array.isArray(project.subtitles) ? project.subtitles : [];
  const ordered = subtitles
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => Number(a.cue.start) - Number(b.cue.start) || a.index - b.index);

  subtitles.forEach((cue, index) => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      errors.push(`第 ${index + 1} 条字幕的入点或出点无效。`);
      return;
    }
    if (start < 0) errors.push(`第 ${index + 1} 条字幕的入点小于 0。`);
    if (end <= start) errors.push(`第 ${index + 1} 条字幕的出点必须晚于入点。`);
    if (end > duration + 0.0001) {
      errors.push(`第 ${index + 1} 条字幕超出视频范围（${duration.toFixed(2)}s）。`);
    }
  });

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (Number(current.cue.start) < Number(previous.cue.end) - 0.0001) {
      errors.push(
        `字幕「${String(previous.cue.text || "").split("\n")[0] || previous.index + 1}」与「${
          String(current.cue.text || "").split("\n")[0] || current.index + 1
        }」时间重叠。`,
      );
    }
  }

  if (Array.isArray(project.scenes)) {
    project.scenes.forEach((scene, index) => {
      const start = Number(scene.start);
      const end = Number(scene.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        errors.push(`场景「${scene.name || index + 1}」的范围无效。`);
      }
      if (start < 0 || end > duration + 0.0001) {
        errors.push(`场景「${scene.name || index + 1}」超出视频范围。`);
      }
      if (!Array.isArray(scene.keyframes) || scene.keyframes.length < 2) {
        errors.push(`场景「${scene.name || index + 1}」至少需要两个关键帧。`);
      } else {
        scene.keyframes.forEach((keyframe, keyIndex) => {
          if (!isFiniteNumber(Number(keyframe.t))) {
            errors.push(`场景「${scene.name}」第 ${keyIndex + 1} 个关键帧时间无效。`);
          }
        });
      }
    });
  }

  if (Array.isArray(project.transitions)) {
    project.transitions.forEach((transition, index) => {
      const start = Number(transition.start);
      const transitionDuration = Number(transition.duration);
      const fromExists = project.scenes.some((scene) => scene.id === transition.from);
      const toExists = project.scenes.some((scene) => scene.id === transition.to);
      if (!fromExists || !toExists) {
        errors.push(`第 ${index + 1} 个转场引用了不存在的场景。`);
      }
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(transitionDuration) ||
        transitionDuration <= 0 ||
        start < 0 ||
        transitionExceedsDuration(start, transitionDuration, duration)
      ) {
        errors.push(`第 ${index + 1} 个转场超出视频范围。`);
      }
    });
  }

  const audioStart = Number(project.audio?.start);
  if (!Number.isFinite(audioStart) || audioStart < 0 || audioStart >= duration) {
    errors.push("音频起始位置必须位于视频范围内。");
  }
  const bpm = Number(project.audio?.bpm);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    errors.push("BPM 必须在 40 到 240 之间。");
  }

  if (!errors.length && subtitles.length === 0) warnings.push("当前工程还没有字幕。");
  return { ok: errors.length === 0, errors, warnings };
}

function transitionExceedsDuration(start, transitionDuration, duration) {
  return start + transitionDuration > duration + 0.0001;
}

function normalizedKeyframes(keyframes) {
  if (!Array.isArray(keyframes)) return [];
  return keyframes
    .filter((keyframe) => keyframe && Number.isFinite(Number(keyframe.t)))
    .map((keyframe) => ({ ...keyframe, t: Number(keyframe.t) }))
    .sort((a, b) => a.t - b.t);
}

export function sanitizeProject(raw) {
  if (!raw || typeof raw !== "object") throw new Error("工程文件不是有效的 JSON 对象。");
  const fallback = createDefaultProject();
  const project = {
    version: PROJECT_VERSION,
    name: String(raw.name || fallback.name),
    duration: Number(raw.duration) || fallback.duration,
    scenes: Array.isArray(raw.scenes)
      ? raw.scenes.map((scene, index) => ({
          id: String(scene.id || uid("scene")),
          name: String(scene.name || `场景 ${index + 1}`),
          start: Number(scene.start) || 0,
          end: Number(scene.end) || Number(raw.duration) || fallback.duration,
          color: String(scene.color || fallback.scenes[index % fallback.scenes.length].color),
          keyframes: normalizedKeyframes(scene.keyframes),
        }))
      : deepClone(fallback.scenes),
    transitions: Array.isArray(raw.transitions)
      ? raw.transitions.map((transition) => ({
          id: String(transition.id || uid("transition")),
          type: String(transition.type || "crossfade"),
          from: String(transition.from || ""),
          to: String(transition.to || ""),
          start: Number(transition.start) || 0,
          duration: Number(transition.duration) || 1,
        }))
      : [],
    subtitles: Array.isArray(raw.subtitles)
      ? raw.subtitles.map((cue) => ({
          id: String(cue.id || uid("cue")),
          start: roundTime(Number(cue.start) || 0),
          end: roundTime(Number(cue.end) || 0),
          text: String(cue.text ?? ""),
        }))
      : [],
    audio: {
      bpm: Number(raw.audio?.bpm) || fallback.audio.bpm,
      start: Number(raw.audio?.start) || 0,
      master: Number(raw.audio?.master) || fallback.audio.master,
    },
  };

  const seen = new Set();
  project.subtitles = project.subtitles.map((cue) => {
    if (seen.has(cue.id)) cue.id = uid("cue");
    seen.add(cue.id);
    return cue;
  });
  return project;
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

export function projectFingerprint(project) {
  const source = JSON.stringify(project);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
