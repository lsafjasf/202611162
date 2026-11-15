import { documentHash, parseDocument, serializeDocument } from "./persistence";
import {
  downsamplePixels,
  geometryPositionDigest,
  renderTexture,
  structureSimilarity,
} from "./render";
import {
  DEFAULT_PARAMS,
  type BrushStroke,
  type TextureDocument,
  type TextureParams,
} from "./types";

export interface SelfTestCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface SelfTestCase {
  id: string;
  label: string;
  pass: boolean;
  errors: string[];
  fallbackUsed: boolean;
  objectCountBefore: number;
  objectCountAfter: number;
  geometryDigest: string;
  geometryPositionDigest: string;
  imageDigestBefore: string;
  imageDigestAfter: string;
  previewExportSimilarity: number;
  seamDelta: number;
  variance: number;
  durationMs: number;
  checks: SelfTestCheck[];
}

const seamStroke: BrushStroke = {
  id: "selftest-seam-stroke",
  mode: "burn",
  size: 0.055,
  strength: 0.34,
  points: [
    { x: 0.992, y: 0.47 },
    { x: 0.006, y: 0.49 },
  ],
};

const extremeParams: TextureParams = {
  ...DEFAULT_PARAMS,
  scale: 48,
  direction: 179,
  contrast: 2.5,
  relief: 1,
  grain: 1,
  seed: 99999,
};

const extremeCloth: TextureParams = {
  ...DEFAULT_PARAMS,
  kind: "cloth",
  palette: "flax",
  scale: 48,
  direction: -179,
  contrast: 2.5,
  relief: 1,
  grain: 1,
  seed: 12347,
};

const invalidParams = {
  ...DEFAULT_PARAMS,
  kind: "granite",
  scale: Number.NaN,
  direction: "north",
  contrast: Number.POSITIVE_INFINITY,
  relief: -4,
  grain: Number.NaN,
  seed: 0,
  palette: "void",
};

function caseFrom(
  id: string,
  label: string,
  params: unknown,
  expectErrors: boolean,
): SelfTestCase {
  const checks: SelfTestCheck[] = [];
  const strokes = [seamStroke];
  const before = renderTexture(params, strokes, 192);
  const after = renderTexture(params, strokes, 192);
  const preview = renderTexture(params, strokes, 512);
  const exported = renderTexture(params, strokes, 256);
  const downsampled = downsamplePixels(
    preview.pixels,
    preview.width,
    preview.height,
    exported.width,
    exported.height,
  );
  const similarity = structureSimilarity(downsampled, exported.pixels);
  const countStable = before.geometry.count === after.geometry.count;
  const geometryStable = before.geometry.digest === after.geometry.digest;
  const positionsStable =
    geometryPositionDigest(before.geometry) === geometryPositionDigest(after.geometry);
  const imageStable = before.digest === after.digest;
  const previewExportStable = similarity > 0.78;
  const seamStable = before.stats.seamDelta < 1.6;
  const visible = before.stats.variance > 0.0015 && before.stats.max - before.stats.min > 0.08;
  const errorsOk = expectErrors ? before.errors.length >= 4 : before.errors.length === 0;

  checks.push({
    name: "重算前后对象数量",
    pass: countStable,
    detail: `${before.geometry.count} → ${after.geometry.count}`,
  });
  checks.push({
    name: "几何位置摘要",
    pass: positionsStable,
    detail: `${geometryPositionDigest(before.geometry)} → ${geometryPositionDigest(after.geometry)}`,
  });
  checks.push({
    name: "内部几何摘要",
    pass: geometryStable,
    detail: before.geometry.digest,
  });
  checks.push({
    name: "导出像素摘要",
    pass: imageStable,
    detail: `${before.digest} → ${after.digest}`,
  });
  checks.push({
    name: "预览缩小对比导出",
    pass: previewExportStable,
    detail: `结构相似度 ${(similarity * 100).toFixed(1)}%`,
  });
  checks.push({
    name: "四边接缝差值",
    pass: seamStable,
    detail: `邻接倍率 ${before.stats.seamDelta.toFixed(2)}×`,
  });
  checks.push({
    name: "非空画面",
    pass: visible,
    detail: `亮度范围 ${before.stats.min.toFixed(2)}–${before.stats.max.toFixed(2)}`,
  });
  checks.push({
    name: expectErrors ? "异常提示" : "参数合法",
    pass: errorsOk,
    detail:
      before.errors.length > 0
        ? before.errors.slice(0, 2).join(" ")
        : "无校验错误",
  });

  return {
    id,
    label,
    pass: checks.every((check) => check.pass),
    errors: before.errors,
    fallbackUsed: before.errors.length > 0,
    objectCountBefore: before.geometry.count,
    objectCountAfter: after.geometry.count,
    geometryDigest: before.geometry.digest,
    geometryPositionDigest: geometryPositionDigest(before.geometry),
    imageDigestBefore: before.digest,
    imageDigestAfter: after.digest,
    previewExportSimilarity: similarity,
    seamDelta: before.stats.seamDelta,
    variance: before.stats.variance,
    durationMs: before.durationMs + after.durationMs + preview.durationMs + exported.durationMs,
    checks,
  };
}

export function verifySaveReload(stroke: BrushStroke[] = [seamStroke]) {
  const document: TextureDocument = {
    params: DEFAULT_PARAMS,
    strokes: stroke,
  };
  const serialized = serializeDocument(document);
  const parsed = parseDocument(serialized);
  const original = renderTexture(document.params, document.strokes, 160);
  const restored = renderTexture(parsed.document.params, parsed.document.strokes, 160);
  return {
    pass:
      parsed.errors.length === 0 &&
      original.geometry.digest === restored.geometry.digest &&
      original.digest === restored.digest &&
      documentHash(document) === documentHash(parsed.document),
    originalDigest: original.digest,
    restoredDigest: restored.digest,
    geometryDigest: original.geometry.digest,
    documentDigest: documentHash(document),
    errors: parsed.errors,
  };
}

export function runSelfTests(): {
  cases: SelfTestCase[];
  saveReload: ReturnType<typeof verifySaveReload>;
  pass: boolean;
} {
  const cases = [
    caseFrom("default", "默认 · 暖砂岩", DEFAULT_PARAMS, false),
    caseFrom("extreme-stone", "极值 · 高对比石纹", extremeParams, false),
    caseFrom("extreme-cloth", "极值 · 反向布纹", extremeCloth, false),
    caseFrom("invalid", "异常 · 非法参数", invalidParams, true),
  ];
  const saveReload = verifySaveReload();
  return {
    cases,
    saveReload,
    pass: cases.every((testCase) => testCase.pass) && saveReload.pass,
  };
}

