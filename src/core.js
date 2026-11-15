import { createDefaultProject } from "./defaults.js";

export const EPSILON = 1e-7;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, p) => a + (b - a) * p;
export const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
export const roundTime = (value, fps = 30) => Math.round(value * fps) / fps;

export const cloneProject = (project) => JSON.parse(JSON.stringify(project));

export function formatTimecode(seconds, fps = 30) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, mins, secs, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatSeconds(seconds, decimals = 3) {
  return `${Math.max(0, Number(seconds) || 0).toFixed(decimals)}s`;
}

export function formatShort(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = (safe % 60).toFixed(3).padStart(6, "0");
  return `${String(mins).padStart(2, "0")}:${secs}`;
}

export function durationOf(project) {
  return roundTime(Math.max(0, project.outPoint - project.inPoint), project.fps);
}

export function cameraById(project, id) {
  return project.cameras.find((camera) => camera.id === id) || project.cameras[0];
}

export function sceneById(project, id) {
  return project.scenes.find((scene) => scene.id === id) || project.scenes[0];
}

export function sortedCuts(project) {
  return [...project.cuts].sort((a, b) => a.t - b.t);
}

export function activeCutIndexAt(project, t) {
  const cuts = sortedCuts(project);
  let index = 0;
  for (let i = 0; i < cuts.length; i += 1) {
    if (cuts[i].t <= t + EPSILON) index = i;
    else break;
  }
  return index;
}

export function activeCutAt(project, t) {
  return sortedCuts(project)[activeCutIndexAt(project, t)];
}

export function shotSpans(project) {
  const cuts = sortedCuts(project);
  return cuts.map((cut, index) => ({
    ...cut,
    index,
    start: cut.t,
    end: index < cuts.length - 1 ? cuts[index + 1].t : project.outPoint,
    duration: (index < cuts.length - 1 ? cuts[index + 1].t : project.outPoint) - cut.t,
  }));
}

export function transitionStateAt(project, t) {
  const cuts = sortedCuts(project);
  const index = activeCutIndexAt(project, t);
  const cut = cuts[index];
  const duration = Math.max(0, Number(cut?.transition?.duration) || 0);
  const type = cut?.transition?.type || "none";
  if (!cut || index === 0 || type === "none" || duration <= 0) {
    return { activeIndex: index, cut, progress: 1, active: false, type, duration: 0, outgoing: null };
  }
  const elapsed = t - cut.t;
  const progress = clamp(elapsed / duration, 0, 1);
  return {
    activeIndex: index,
    cut,
    progress,
    active: progress < 1 - EPSILON,
    type,
    duration,
    outgoing: cuts[index - 1],
  };
}

export function nextCut(project, t) {
  const cuts = sortedCuts(project);
  return cuts.find((cut) => cut.t > t + EPSILON) || null;
}

export function previousCut(project, t) {
  const cuts = sortedCuts(project);
  return [...cuts].reverse().find((cut) => cut.t < t - EPSILON) || cuts[0];
}

export function subtitleAt(project, t) {
  return (
    project.subtitles.find(
      (subtitle) => t >= subtitle.start - EPSILON && t < subtitle.end - EPSILON,
    ) || null
  );
}

export function beatInfoAt(project, t) {
  const bpm = Math.max(1, project.audio.bpm);
  const beatDuration = 60 / bpm;
  const audioDuration = Math.max(0, project.outPoint - project.audio.start);
  if (t < project.audio.start - EPSILON || t > project.outPoint + EPSILON) {
    return {
      beatDuration,
      beatIndex: -1,
      beatInBar: -1,
      nextBeatTime: project.audio.start,
      pulse: 0,
      audible: false,
    };
  }
  const elapsed = Math.max(0, t - project.audio.start);
  const beatIndex = Math.floor(elapsed / beatDuration + EPSILON);
  const beatInBar = beatIndex % project.audio.beatsPerBar;
  const sinceBeat = elapsed - beatIndex * beatDuration;
  const pulse = clamp(1 - sinceBeat / Math.min(0.22, beatDuration), 0, 1);
  return {
    beatDuration,
    beatIndex,
    beatInBar,
    beatTime: project.audio.start + beatIndex * beatDuration,
    nextBeatTime: project.audio.start + (beatIndex + 1) * beatDuration,
    pulse,
    audible: audioDuration > 0,
  };
}

export function audioEventAt(project, t) {
  const beat = beatInfoAt(project, t);
  if (!beat.audible || beat.beatIndex < 0) {
    return { type: "silence", beat: -1, time: null, amplitude: 0 };
  }
  const downbeat = beat.beatInBar === 0;
  return {
    type: downbeat ? "kick" : "tick",
    beat: beat.beatIndex,
    time: roundTime(beat.beatTime, project.fps),
    amplitude: downbeat ? 1 : 0.58,
  };
}

export function sampleAt(project, rawTime) {
  const t = clamp(roundTime(rawTime, project.fps), project.inPoint, project.outPoint);
  const transition = transitionStateAt(project, t);
  const beat = beatInfoAt(project, t);
  const subtitle = subtitleAt(project, t);
  return {
    t,
    frame: Math.round((t - project.inPoint) * project.fps),
    activeCamera: transition.cut.camera,
    outgoingCamera: transition.active ? transition.outgoing.camera : null,
    transition: {
      active: transition.active,
      progress: transition.progress,
      type: transition.type,
      duration: transition.duration,
    },
    cutIndex: transition.activeIndex,
    subtitle: subtitle ? { id: subtitle.id, text: subtitle.text } : null,
    beat,
    audioEvent: audioEventAt(project, t),
    sceneId: project.activeScene,
  };
}

export function normalizeProject(input) {
  const fallback = createDefaultProject();
  if (!input || typeof input !== "object") throw new Error("工程文件格式无效");
  if (input.schemaVersion !== fallback.schemaVersion) throw new Error("不支持的工程版本");
  const project = cloneProject(input);
  project.fps = [24, 25, 30, 60].includes(Number(project.fps)) ? Number(project.fps) : 30;
  project.inPoint = clamp(Number(project.inPoint) || 0, 0, 3600);
  project.outPoint = clamp(Number(project.outPoint) || 16.5, project.inPoint + 0.1, 3600);
  project.loop = Boolean(project.loop);
  if (!project.scenes?.length) project.scenes = fallback.scenes;
  if (!project.scenes.some((scene) => scene.id === project.activeScene)) {
    project.activeScene = project.scenes[0].id;
  }
  if (!Array.isArray(project.cameras) || project.cameras.length === 0) {
    project.cameras = fallback.cameras;
  }
  project.cameras.forEach((camera) => {
    if (!Array.isArray(camera.keyframes) || !camera.keyframes.length) {
      const fallbackCamera = fallback.cameras.find((candidate) => candidate.id === camera.id);
      camera.keyframes = cloneProject(fallbackCamera?.keyframes || fallback.cameras[0].keyframes);
    }
    camera.keyframes = camera.keyframes
      .map((key) => ({ ...key, t: Number(key.t) }))
      .sort((a, b) => a.t - b.t);
  });
  if (!Array.isArray(project.cuts) || !project.cuts.length) {
    project.cuts = fallback.cuts;
  }
  project.cuts = project.cuts
    .filter((cut) => Number.isFinite(Number(cut.t)) && cameraById(project, cut.camera))
    .map((cut) => ({
      id: String(cut.id || `cut-${Date.now()}`),
      t: clamp(roundTime(Number(cut.t), project.fps), project.inPoint, project.outPoint),
      camera: cut.camera,
      transition: {
        type: ["none", "dissolve", "whip", "wipe"].includes(cut.transition?.type)
          ? cut.transition.type
          : "dissolve",
        duration: clamp(Number(cut.transition?.duration) || 0, 0, 1.2),
      },
    }))
    .sort((a, b) => a.t - b.t);
  if (!project.cuts.some((cut) => Math.abs(cut.t - project.inPoint) < 1 / project.fps)) {
    project.cuts.unshift({
      id: `cut-in-${Date.now()}`,
      t: project.inPoint,
      camera: project.cuts[0].camera,
      transition: { type: "none", duration: 0 },
    });
  }
  const seen = new Set();
  project.cuts = project.cuts.filter((cut) => {
    const key = Math.round(cut.t * project.fps);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  project.cuts[0].t = project.inPoint;
  project.cuts[0].transition = { type: "none", duration: 0 };
  if (!Array.isArray(project.subtitles)) project.subtitles = [];
  project.subtitles = project.subtitles
    .filter((subtitle) => String(subtitle.text || "").trim())
    .map((subtitle, index) => ({
      id: String(subtitle.id || `sub-${index + 1}`),
      start: clamp(Number(subtitle.start) || 0, project.inPoint, project.outPoint),
      end: clamp(Number(subtitle.end) || project.outPoint, project.inPoint, project.outPoint),
      text: String(subtitle.text).slice(0, 120),
    }))
    .filter((subtitle) => subtitle.end > subtitle.start)
    .sort((a, b) => a.start - b.start);
  project.audio = {
    start: clamp(Number(project.audio?.start) || 0, 0, project.outPoint),
    bpm: clamp(Number(project.audio?.bpm) || 100, 40, 240),
    beatsPerBar: clamp(Number(project.audio?.beatsPerBar) || 4, 2, 8),
    source: project.audio?.source || "Web Audio · ambient synth",
    gain: clamp(Number(project.audio?.gain) || 0.72, 0, 1),
  };
  project.export = {
    width: Number(project.export?.width) || 1280,
    height: Number(project.export?.height) || 720,
    fps: Number(project.export?.fps) || project.fps,
  };
  return project;
}

export function validateProject(project) {
  const issues = [];
  const duration = durationOf(project);
  if (duration <= 0) issues.push("出点必须晚于入点");
  const cuts = sortedCuts(project);
  if (!cuts.length) issues.push("时间线至少需要一个机位切点");
  cuts.forEach((cut, index) => {
    if (cut.t < project.inPoint - EPSILON || cut.t > project.outPoint + EPSILON) {
      issues.push(`切点 ${index + 1} 超出入出点范围`);
    }
    if (index > 0 && Math.abs(cut.t - cuts[index - 1].t) < 1 / project.fps) {
      issues.push(`切点 ${index + 1} 与上一镜头重叠`);
    }
  });
  project.subtitles.forEach((subtitle) => {
    if (subtitle.end > project.outPoint + EPSILON) issues.push(`字幕「${subtitle.text}」超出出点`);
  });
  return { valid: issues.length === 0, issues, duration };
}

export function createShotList(project) {
  return shotSpans(project).map((shot, index) => {
    const camera = cameraById(project, shot.camera);
    const subtitle = project.subtitles.find(
      (item) => item.start < shot.end && item.end > shot.start,
    );
    return {
      shot: index + 1,
      camera: camera.id,
      cameraName: camera.name,
      lens: camera.lens,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
      transitionOut: shot.transition?.type || "none",
      transitionDuration: shot.transition?.duration || 0,
      timecodeIn: formatTimecode(shot.start, project.fps),
      timecodeOut: formatTimecode(shot.end, project.fps),
      subtitle: subtitle?.text || "",
    };
  });
}

export function createExportManifest(project) {
  const duration = durationOf(project);
  const frameCount = Math.round(duration * project.fps);
  return {
    schema: "night-orbit-export/v1",
    projectId: project.id,
    title: project.title,
    exportedAt: new Date().toISOString(),
    fps: project.fps,
    range: {
      in: project.inPoint,
      out: project.outPoint,
      duration,
      frameCount,
      timecodeIn: formatTimecode(project.inPoint, project.fps),
      timecodeOut: formatTimecode(project.outPoint, project.fps),
    },
    verification: {
      durationMatchesRange: Math.abs((project.outPoint - project.inPoint) - duration) < 1e-6,
      outMatchesFrameCount: Math.abs(frameCount / project.fps - duration) < 1e-6,
      cutCount: project.cuts.length,
      subtitleCount: project.subtitles.length,
      audioStart: project.audio.start,
      bpm: project.audio.bpm,
    },
    shots: createShotList(project),
    subtitles: cloneProject(project.subtitles),
    audio: cloneProject(project.audio),
  };
}

export function shotListCsv(project) {
  const shotList = createShotList(project);
  const header = [
    "shot",
    "camera",
    "camera_name",
    "lens",
    "in_seconds",
    "out_seconds",
    "duration_seconds",
    "in_timecode",
    "out_timecode",
    "transition",
    "transition_seconds",
    "subtitle",
  ];
  const rows = shotList.map((shot) => [
    shot.shot,
    shot.camera,
    shot.cameraName,
    shot.lens,
    shot.start.toFixed(3),
    shot.end.toFixed(3),
    shot.duration.toFixed(3),
    shot.timecodeIn,
    shot.timecodeOut,
    shot.transitionOut,
    shot.transitionDuration.toFixed(3),
    shot.subtitle,
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}
