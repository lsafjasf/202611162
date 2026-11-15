import {
  cloneProject,
  createExportManifest,
  createShotList,
  durationOf,
  formatTimecode,
  shotListCsv,
  validateProject,
} from "./core.js";
import fixWebmDuration from "fix-webm-duration";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const safeFilename = (value) =>
  String(value || "night-orbit")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);

export async function projectFingerprint(project) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  };
  const canonical = JSON.stringify(canonicalize(project));
  const bytes = new TextEncoder().encode(canonical);
  if (!crypto.subtle) return Array.from(bytes).reduce((hash, byte) => (hash * 31 + byte) >>> 0, 7);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function subtitleSrt(project) {
  const formatSrtTime = (seconds) => {
    const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
    const milliseconds = totalMilliseconds % 1000;
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
  };
  return project.subtitles
    .map(
      (subtitle, index) =>
        `${index + 1}\n${formatSrtTime(subtitle.start)} --> ${formatSrtTime(subtitle.end)}\n${subtitle.text}\n`,
    )
    .join("\n");
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

export class ProgramExporter {
  constructor({ renderer, audio, onProgress }) {
    this.renderer = renderer;
    this.audio = audio;
    this.onProgress = onProgress || (() => {});
    this.lastExport = null;
    this.busy = false;
  }

  progress(progress, status) {
    this.onProgress({
      progress: Math.max(0, Math.min(1, progress)),
      status,
    });
  }

  async run(projectInput, options = {}) {
    if (this.busy) throw new Error("已有导出任务正在进行");
    this.busy = true;
    const project = cloneProject(projectInput);
    const before = await projectFingerprint(project);
    const validation = validateProject(project);
    if (!validation.valid) throw new Error(validation.issues.join("；"));
    const includeVideo = options.video !== false;
    const includeShots = options.shots !== false;
    const filename = safeFilename(project.title);
    const startedAt = performance.now();
    let videoResult = null;
    let failure = null;

    try {
      this.progress(0.02, "正在校验时间线…");
      if (window.__NIGHT_ORBIT_FAIL_EXPORT__) {
        window.__NIGHT_ORBIT_FAIL_EXPORT__ = false;
        throw new Error("模拟导出故障：编码器初始化失败");
      }
      if (includeVideo) {
        videoResult = await this.recordProgram(project);
      } else {
        this.progress(0.72, "正在生成交付文件…");
      }

      const manifest = createExportManifest(project);
      if (videoResult) {
        manifest.video = {
          container: "WebM",
          mimeType: videoResult.mimeType || "video/webm",
          filename: `${filename}-program.webm`,
          bytes: videoResult.blob.size,
          measuredDuration: videoResult.measuredDuration ?? null,
          intendedFrames: manifest.range.frameCount,
          renderedFrames: videoResult.renderedFrames,
          recordedElapsed: videoResult.recordedElapsed,
          durationWithinOneFrame:
            videoResult.measuredDuration == null ||
            Math.abs(videoResult.measuredDuration - manifest.range.duration) <=
              1 / project.fps + 0.005,
        };
      }
      manifest.projectFingerprint = before;
      manifest.integrity = {
        projectUnchanged: (await projectFingerprint(project)) === before,
        rangePreserved: Math.abs(durationOf(project) - manifest.range.duration) < 1e-9,
        cutsOnTimeline: createShotList(project).every(
          (shot) => shot.start >= project.inPoint && shot.end <= project.outPoint + 1e-9,
        ),
      };

      const downloads = [];
      if (videoResult) {
        this.progress(0.94, "正在写入节目视频…");
        const videoName = `${filename}-program.webm`;
        downloadBlob(videoResult.blob, videoName);
        downloads.push(videoName);
      }
      if (includeShots) {
        const csv = new Blob([shotListCsv(project)], { type: "text/csv;charset=utf-8" });
        const json = new Blob([JSON.stringify(manifest, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        const srt = new Blob([subtitleSrt(project)], { type: "application/x-subrip;charset=utf-8" });
        const csvName = `${filename}-shotlist.csv`;
        const jsonName = `${filename}-manifest.json`;
        const srtName = `${filename}-subtitles.srt`;
        downloadBlob(csv, csvName);
        await wait(130);
        downloadBlob(json, jsonName);
        await wait(130);
        downloadBlob(srt, srtName);
        downloads.push(csvName, jsonName, srtName);
      }
      this.progress(1, "导出完成");

      const result = {
        ok: true,
        manifest,
        video: videoResult,
        downloads,
        elapsed: (performance.now() - startedAt) / 1000,
        fingerprint: before,
        inTimecode: formatTimecode(project.inPoint, project.fps),
        outTimecode: formatTimecode(project.outPoint, project.fps),
      };
      this.lastExport = result;
      return result;
    } catch (error) {
      failure = error;
      this.audio.stop("export-failed");
      const after = await projectFingerprint(project);
      const wrapped = new Error(error.message || "导出失败");
      wrapped.cause = error;
      wrapped.projectUnchanged = after === before;
      wrapped.fingerprint = before;
      wrapped.before = before;
      wrapped.after = after;
      throw wrapped;
    } finally {
      this.busy = false;
      if (failure) this.progress(0, "导出失败 · 工程未修改");
    }
  }

  async recordProgram(project) {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error("当前浏览器不支持画布视频录制");
    }
    const width = project.export.width;
    const height = project.export.height;
    const fps = project.fps;
    const duration = durationOf(project);
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    const videoStream = canvas.captureStream(fps);
    await this.audio.ensure();
    const audioStream = this.audio.mediaStream;
    if (!audioStream) throw new Error("无法创建音频导出轨道");
    const tracks = [
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks().map((track) => track.clone()),
    ];
    const combined = new MediaStream(tracks);
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    const chunks = [];
    let recorderError = null;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      recorderError = event.error || new Error("MediaRecorder 编码错误");
    };
    this.progress(0.04, "正在启动 WebM / Web Audio 编码器…");

    this.renderer.renderProgram(ctx, project, project.inPoint, width, height, {
      cameraMap: false,
    });
    const audioRun = await this.audio.startAt(project, project.inPoint, {
      export: true,
      immediate: true,
    });
    const audioDelay = Math.max(0, (audioRun.contextStart - this.audio.currentTime) * 1000);
    if (audioDelay > 0) await wait(audioDelay);
    recorder.start(400);
    const recordStart = performance.now();
    const frameInterval = 1000 / fps;
    let renderedFrames = 0;

    try {
      while (renderedFrames < totalFrames) {
        const expected = recordStart + renderedFrames * frameInterval;
        const waitTime = expected - performance.now();
        if (waitTime > 0) await wait(waitTime);
        if (recorderError) throw recorderError;
        const t = Math.min(project.outPoint, project.inPoint + renderedFrames / fps);
        this.renderer.renderProgram(ctx, project, t, width, height, {
          cameraMap: false,
        });
        renderedFrames += 1;
        if (renderedFrames % 3 === 0 || renderedFrames === totalFrames) {
          this.progress(
            0.06 + (renderedFrames / totalFrames) * 0.82,
            `正在渲染节目 ${renderedFrames} / ${totalFrames} 帧`,
          );
        }
      }
      const finalFrameAt = recordStart + totalFrames * frameInterval;
      const tail = finalFrameAt - performance.now();
      if (tail > 0) await wait(tail);
      if (recorderError) throw recorderError;
      await new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (event) => reject(event.error || new Error("编码器写入失败"));
        recorder.stop();
      });
    } catch (error) {
      if (recorder.state !== "inactive") recorder.stop();
      throw error;
    } finally {
      this.audio.stop("export-complete");
      videoStream.getTracks().forEach((track) => track.stop());
      tracks.forEach((track) => track.stop());
    }

    const rawBlob = new Blob(chunks, { type: mimeType || "video/webm" });
    if (!rawBlob.size) throw new Error("编码器未返回视频数据");
    const intendedDurationMs = Math.round((totalFrames / fps) * 1000);
    let blob = rawBlob;
    try {
      blob = await fixWebmDuration(rawBlob, intendedDurationMs, { logger: false });
    } catch {
      this.progress(0.9, "容器时长修复失败，保留可播放的原始 WebM");
    }
    const recordedElapsed = (performance.now() - recordStart) / 1000;
    const measuredDuration = await this.measureBlobDuration(blob);
    return {
      blob,
      mimeType: blob.type,
      renderedFrames,
      recordedElapsed,
      measuredDuration,
      width,
      height,
      fps,
    };
  }

  async measureBlobDuration(blob) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1800);
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error("无法读取导出视频元数据"));
        };
      });
      let duration = video.duration;
      if (!Number.isFinite(duration)) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 900);
          video.ondurationchange = () => {
            if (Number.isFinite(video.duration)) {
              clearTimeout(timer);
              resolve();
            }
          };
          try {
            video.currentTime = 1e9;
          } catch {
            clearTimeout(timer);
            resolve();
          }
        });
        duration = video.duration;
      }
      return Number.isFinite(duration) ? duration : null;
    } catch {
      return null;
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
}
