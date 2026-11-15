import { DEFAULT_PARAMS, LIGHTING_IDS, MATERIAL_IDS, PARAM_KEYS } from "./types";
import type { LightingId, MaterialId, ViewParams } from "./types";

export class ParameterError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "ParameterError";
    this.issues = issues;
  }
}

export function cloneParams(params: ViewParams): ViewParams {
  return { ...params };
}

export function defaultParams(): ViewParams {
  return { ...DEFAULT_PARAMS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAngle(angle: number): number {
  let normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180) normalized = 180;
  if (Object.is(normalized, -0)) normalized = 0;
  return normalized;
}

export function validateParams(input: unknown, base: ViewParams): ViewParams {
  if (!isRecord(input)) {
    throw new ParameterError(["Parameters must be a JSON object."]);
  }
  const issues: string[] = [];
  const unknownKeys = Object.keys(input).filter(
    (key) => !PARAM_KEYS.includes(key as keyof ViewParams)
  );
  if (unknownKeys.length > 0) {
    issues.push(`Unknown parameter${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`);
  }

  const next = cloneParams(base);
  if ("material" in input) {
    if (typeof input.material !== "string" || !MATERIAL_IDS.includes(input.material as MaterialId)) {
      issues.push(`material must be one of: ${MATERIAL_IDS.join(", ")}.`);
    } else {
      next.material = input.material as MaterialId;
    }
  }

  if ("lighting" in input) {
    if (
      typeof input.lighting !== "string" ||
      !LIGHTING_IDS.includes(input.lighting as LightingId)
    ) {
      issues.push(`lighting must be one of: ${LIGHTING_IDS.join(", ")}.`);
    } else {
      next.lighting = input.lighting as LightingId;
    }
  }

  if ("yaw" in input) {
    if (typeof input.yaw !== "number" || !Number.isFinite(input.yaw)) {
      issues.push("yaw must be a finite number.");
    } else if (input.yaw < -180 || input.yaw > 180) {
      issues.push("yaw must be between -180 and 180 degrees.");
    } else {
      next.yaw = normalizeAngle(input.yaw);
    }
  }

  if ("pitch" in input) {
    if (typeof input.pitch !== "number" || !Number.isFinite(input.pitch)) {
      issues.push("pitch must be a finite number.");
    } else if (input.pitch < -70 || input.pitch > 70) {
      issues.push("pitch must be between -70 and 70 degrees.");
    } else {
      next.pitch = input.pitch;
    }
  }

  if ("zoom" in input) {
    if (typeof input.zoom !== "number" || !Number.isFinite(input.zoom)) {
      issues.push("zoom must be a finite number.");
    } else if (input.zoom < 0.55 || input.zoom > 2.2) {
      issues.push("zoom must be between 0.55 and 2.2.");
    } else {
      next.zoom = input.zoom;
    }
  }

  if ("autoRotate" in input) {
    if (typeof input.autoRotate !== "boolean") {
      issues.push("autoRotate must be true or false.");
    } else {
      next.autoRotate = input.autoRotate;
    }
  }

  if (issues.length > 0) throw new ParameterError(issues);
  return next;
}

export class ParameterHistory {
  private entries: ViewParams[];
  private cursor: number;

  constructor(initial: ViewParams, private readonly limit = 60) {
    this.entries = [cloneParams(initial)];
    this.cursor = 0;
  }

  get current(): ViewParams {
    return cloneParams(this.entries[this.cursor]);
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  commit(next: ViewParams): void {
    if (paramsEqual(this.entries[this.cursor], next)) return;
    this.entries = this.entries.slice(0, this.cursor + 1);
    this.entries.push(cloneParams(next));
    if (this.entries.length > this.limit + 1) this.entries.shift();
    this.cursor = this.entries.length - 1;
  }

  undo(): ViewParams | null {
    if (!this.canUndo) return null;
    this.cursor -= 1;
    return this.current;
  }

  redo(): ViewParams | null {
    if (!this.canRedo) return null;
    this.cursor += 1;
    return this.current;
  }

}

export function paramsEqual(first: ViewParams, second: ViewParams): boolean {
  return (
    first.material === second.material &&
    first.lighting === second.lighting &&
    Math.abs(first.yaw - second.yaw) < 1e-9 &&
    Math.abs(first.pitch - second.pitch) < 1e-9 &&
    Math.abs(first.zoom - second.zoom) < 1e-9 &&
    first.autoRotate === second.autoRotate
  );
}
