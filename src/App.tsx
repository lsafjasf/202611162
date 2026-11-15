import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  FlaskConical,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import {
  BrushConfig,
  TextureViewport,
  TextureViewportHandle,
  ViewState,
} from "./components/TextureViewport";
import { TilePreview } from "./components/TilePreview";
import { SelfTestModal } from "./components/SelfTestModal";
import {
  canvasToBlob,
  downloadBlob,
  downloadText,
  renderResultToCanvas,
  sha256,
} from "./texture/canvas";
import { clothWaveVector } from "./texture/geometry";
import {
  CURRENT_KEY,
  createStarterPresets,
  loadCurrentDocument,
  loadPresets,
  makePreset,
  parseDocument,
  persistPresets,
  saveCurrentDocument,
  serializeDocument,
} from "./texture/persistence";
import {
  downsamplePixels,
  PALETTE_LABELS,
  renderTexture,
  structureSimilarity,
} from "./texture/render";
import { runSelfTests } from "./texture/selftest";
import {
  DEFAULT_PARAMS,
  type BrushMode,
  type BrushStroke,
  type PaletteId,
  type RenderResult,
  type SavedPreset,
  type TextureDocument,
  type TextureKind,
  type TextureParams,
} from "./texture/types";

type ParameterKey = keyof Pick<
  TextureParams,
  "scale" | "direction" | "contrast" | "relief" | "grain" | "seed"
>;

interface LastExport {
  size: number;
  digest: string;
  geometryDigest: string;
  objectCount: number;
  similarity: number;
  seamDelta: number;
  at: string;
}

interface ToastState {
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
}

const STONE_PALETTES: PaletteId[] = ["sand", "slate"];
const CLOTH_PALETTES: PaletteId[] = ["indigo", "flax"];

function formatTime(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function formatSigned(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}°`;
}

function downloadName(kind: TextureKind, seed: number, suffix: string): string {
  return `tessera-${kind}-${seed}-${suffix}`;
}

interface ParameterSliderProps {
  label: string;
  code: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function ParameterSlider({
  label,
  code,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: ParameterSliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className="parameter-slider">
      <span className="parameter-heading">
        <span>
          {label}
          <em>{code}</em>
        </span>
        <output>{display}</output>
      </span>
      <span className="range-track">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ "--range-progress": `${percent}%` } as React.CSSProperties}
          aria-label={label}
        />
      </span>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      aria-label={label}
    >
      <span />
    </button>
  );
}

function App() {
  const initialDocument = useRef<TextureDocument>(loadCurrentDocument().document);
  const [document, setDocumentState] = useState<TextureDocument>(
    initialDocument.current,
  );
  const documentRef = useRef(document);
  documentRef.current = document;
  const pastRef = useRef<TextureDocument[]>([]);
  const futureRef = useRef<TextureDocument[]>([]);
  const coalesceRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [historyVersion, setHistoryVersion] = useState(0);

  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [textureCanvas, setTextureCanvas] = useState<HTMLCanvasElement | null>(null);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [view, setView] = useState<ViewState>({
    zoom: 1,
    rotation: 0,
    showGeometry: false,
    showAnnotations: true,
  });
  const [showSeams, setShowSeams] = useState(true);
  const [paused, setPaused] = useState(false);
  const [animation, setAnimation] = useState({ milliseconds: 0, frame: 0 });
  const [brush, setBrush] = useState<BrushConfig>({
    enabled: true,
    mode: "burn",
    size: 0.055,
    strength: 0.38,
  });

  const [presets, setPresets] = useState<SavedPreset[]>(() => {
    const existing = loadPresets();
    if (existing.length > 0) return existing;
    const starters = createStarterPresets();
    persistPresets(starters);
    return starters;
  });
  const [presetName, setPresetName] = useState("");
  const [exportSize, setExportSize] = useState(512);
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<LastExport | null>(null);
  const [lastScreenshotHash, setLastScreenshotHash] = useState<string | null>(null);
  const [selftestOpen, setSelftestOpen] = useState(false);
  const [selftestRunning, setSelftestRunning] = useState(false);
  const [selftestReport, setSelftestReport] =
    useState<ReturnType<typeof runSelfTests> | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<TextureViewportHandle>(null);

  const notify = useCallback((next: ToastState) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const pushPast = useCallback((previous: TextureDocument) => {
    pastRef.current = [...pastRef.current, previous].slice(-40);
    futureRef.current = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  const commitDocument = useCallback(
    (next: TextureDocument, coalesceKey = "", force = false) => {
      const previous = documentRef.current;
      const now = performance.now();
      const shouldCheckpoint =
        force ||
        coalesceKey === "" ||
        coalesceRef.current.key !== coalesceKey ||
        now - coalesceRef.current.at > 700;
      if (shouldCheckpoint) {
        pushPast(previous);
      }
      coalesceRef.current = { key: coalesceKey, at: now };
      documentRef.current = next;
      setDocumentState(next);
      setValidationErrors([]);
    },
    [pushPast],
  );

  const updateParameter = useCallback(
    <Key extends ParameterKey>(key: Key, value: TextureParams[Key]) => {
      const previous = documentRef.current;
      commitDocument(
        {
          ...previous,
          params: { ...previous.params, [key]: value },
        },
        `param:${key}`,
      );
    },
    [commitDocument],
  );

  const applyKind = useCallback(
    (kind: TextureKind) => {
      if (kind === documentRef.current.params.kind) return;
      const previous = documentRef.current;
      const palettes = kind === "stone" ? STONE_PALETTES : CLOTH_PALETTES;
      const palette = palettes.includes(previous.params.palette)
        ? previous.params.palette
        : palettes[0];
      commitDocument(
        {
          ...previous,
          params: { ...previous.params, kind, palette },
        },
        "",
        true,
      );
      notify({
        kind: "info",
        title: kind === "stone" ? "已切换为石纹几何" : "已切换为布纹几何",
        detail: "环面接缝与笔刷联动保持启用。",
      });
    },
    [commitDocument, notify],
  );

  const applyPalette = useCallback(
    (palette: PaletteId) => {
      const previous = documentRef.current;
      if (previous.params.palette === palette) return;
      commitDocument(
        { ...previous, params: { ...previous.params, palette } },
        "",
        true,
      );
    },
    [commitDocument],
  );

  const resetParameters = useCallback(() => {
    const previous = documentRef.current;
    const kind = previous.params.kind;
    const palette = kind === "stone" ? "sand" : "indigo";
    commitDocument(
      {
        ...previous,
        params: { ...DEFAULT_PARAMS, kind, palette },
      },
      "",
      true,
    );
    notify({ kind: "info", title: "参数已复位", detail: "笔刷轨迹仍保留，可使用撤销恢复。" });
  }, [commitDocument, notify]);

  const handleUndo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(documentRef.current);
    documentRef.current = previous;
    setDocumentState(previous);
    coalesceRef.current = { key: "", at: 0 };
    setHistoryVersion((value) => value + 1);
    setValidationErrors([]);
  }, []);

  const handleRedo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(documentRef.current);
    documentRef.current = next;
    setDocumentState(next);
    coalesceRef.current = { key: "", at: 0 };
    setHistoryVersion((value) => value + 1);
    setValidationErrors([]);
  }, []);

  const handleStroke = useCallback(
    (stroke: BrushStroke) => {
      const previous = documentRef.current;
      pushPast(previous);
      const next = {
        ...previous,
        strokes: [...previous.strokes, stroke].slice(-80),
      };
      documentRef.current = next;
      setDocumentState(next);
      notify({
        kind: "success",
        title: "笔刷已写入四面接缝",
        detail: "对侧副本与导出层使用同一轨迹。",
      });
    },
    [notify, pushPast],
  );

  const handleAnimationUpdate = useCallback(
    (milliseconds: number, frame: number) => {
      setAnimation((previous) =>
        previous.milliseconds === milliseconds && previous.frame === frame
          ? previous
          : { milliseconds, frame },
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setRenderError(null);
    const timer = window.setTimeout(() => {
      try {
        const result = renderTexture(document.params, document.strokes, 512);
        if (cancelled) return;
        const canvas = renderResultToCanvas(result);
        setRenderResult(result);
        setTextureCanvas(canvas);
      } catch (error) {
        if (cancelled) return;
        setRenderError(
          error instanceof Error ? error.message : "纹理生成失败，已保留上一张有效画面。",
        );
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 24);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [document]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveCurrentDocument(document);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      }
      if (event.code === "Space") {
        event.preventDefault();
        setPaused((value) => !value);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleRedo, handleUndo]);

  const displayErrors = useMemo(() => {
    const values = [...validationErrors, ...(renderResult?.errors ?? [])];
    return Array.from(new Set(values));
  }, [renderResult?.errors, validationErrors]);

  const palettes =
    document.params.kind === "stone" ? STONE_PALETTES : CLOTH_PALETTES;
  const realizedAngle =
    document.params.kind === "cloth"
      ? (() => {
          const [m, n] = clothWaveVector(document.params);
          return (Math.atan2(n, m) * 180) / Math.PI;
        })()
      : document.params.direction;

  const savePreset = useCallback(() => {
    const name =
      presetName.trim() ||
      `${documentRef.current.params.kind === "stone" ? "石纹" : "布纹"} ${presets.length + 1}`;
    const preset = makePreset(name, documentRef.current, 128);
    const next = [preset, ...presets].slice(0, 12);
    setPresets(next);
    const errors = persistPresets(next);
    setPresetName("");
    if (errors.length > 0) {
      notify({ kind: "error", title: "预设保存失败", detail: errors[0] });
      return;
    }
    notify({
      kind: "success",
      title: `已保存「${preset.name}」`,
      detail: `几何 ${preset.geometryDigest.slice(0, 10)} · 像素 ${preset.previewDigest.slice(0, 10)}`,
    });
  }, [notify, presetName, presets]);

  const loadPreset = useCallback(
    (preset: SavedPreset) => {
      const previous = documentRef.current;
      pushPast(previous);
      const next = { params: preset.params, strokes: preset.strokes };
      documentRef.current = next;
      setDocumentState(next);
      setPresetName(preset.name);
      notify({
        kind: "success",
        title: `已载入「${preset.name}」`,
        detail: `几何摘要 ${preset.geometryDigest.slice(0, 12)}`,
      });
    },
    [notify, pushPast],
  );

  const removePreset = useCallback(
    (id: string) => {
      const next = presets.filter((preset) => preset.id !== id);
      setPresets(next);
      persistPresets(next);
    },
    [presets],
  );

  const importDocument = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = parseDocument(text);
      const previous = documentRef.current;
      pushPast(previous);
      documentRef.current = parsed.document;
      setDocumentState(parsed.document);
      setValidationErrors(parsed.errors);
      if (parsed.errors.length > 0) {
        notify({
          kind: "error",
          title: "参数已安全修正后载入",
          detail: parsed.errors[0],
        });
      } else {
        notify({
          kind: "success",
          title: "参数 JSON 已载入",
          detail: `${parsed.document.params.kind} · seed ${parsed.document.params.seed}`,
        });
      }
    },
    [notify, pushPast],
  );

  const exportPng = useCallback(async () => {
    setExporting(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    try {
      const current = documentRef.current;
      const result = renderTexture(current.params, current.strokes, exportSize);
      const canvas = renderResultToCanvas(result);
      const blob = await canvasToBlob(canvas);
      downloadBlob(
        blob,
        downloadName(current.params.kind, current.params.seed, `${result.width}px.png`),
      );
      let similarity = 1;
      if (renderResult) {
        if (exportSize >= renderResult.width) {
          const reduced = downsamplePixels(
            result.pixels,
            result.width,
            result.height,
            renderResult.width,
            renderResult.height,
          );
          similarity = structureSimilarity(reduced, renderResult.pixels);
        } else {
          const reduced = downsamplePixels(
            renderResult.pixels,
            renderResult.width,
            renderResult.height,
            result.width,
            result.height,
          );
          similarity = structureSimilarity(reduced, result.pixels);
        }
      }
      setLastExport({
        size: result.width,
        digest: result.digest,
        geometryDigest: result.geometry.digest,
        objectCount: result.geometry.count,
        similarity,
        seamDelta: result.stats.seamDelta,
        at: new Date().toISOString(),
      });
      notify({
        kind: "success",
        title: `已导出 ${result.width} × ${result.height} PNG`,
        detail: `结构 ${(similarity * 100).toFixed(1)}% · 几何 ${result.geometry.digest.slice(0, 10)}`,
      });
    } catch (error) {
      notify({
        kind: "error",
        title: "导出失败",
        detail: error instanceof Error ? error.message : "未知导出错误。",
      });
    } finally {
      setExporting(false);
    }
  }, [exportSize, notify, renderResult]);

  const captureScreenshot = useCallback(async () => {
    const canvas = viewportRef.current?.getCanvas();
    if (!canvas) {
      notify({ kind: "error", title: "截图失败", detail: "画布尚未就绪。" });
      return;
    }
    try {
      const blob = await canvasToBlob(canvas);
      const digest = await sha256(blob);
      setLastScreenshotHash(digest);
      downloadBlob(
        blob,
        downloadName(
          documentRef.current.params.kind,
          documentRef.current.params.seed,
          "screen.png",
        ),
      );
      notify({
        kind: "success",
        title: "预览截图已保存",
        detail: `SHA-256 ${digest.slice(0, 16)}…`,
      });
    } catch (error) {
      notify({
        kind: "error",
        title: "截图失败",
        detail: error instanceof Error ? error.message : "图片编码失败。",
      });
    }
  }, [notify]);

  const runTests = useCallback(async () => {
    setSelftestRunning(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
    try {
      const report = runSelfTests();
      setSelftestReport(report);
    } catch (error) {
      notify({
        kind: "error",
        title: "自检执行失败",
        detail: error instanceof Error ? error.message : "未知自检错误。",
      });
    } finally {
      setSelftestRunning(false);
    }
  }, [notify]);

  const openSelfTests = useCallback(() => {
    setSelftestOpen(true);
    if (!selftestReport && !selftestRunning) {
      void runTests();
    }
  }, [runTests, selftestReport, selftestRunning]);

  useEffect(() => {
    const api = {
      getSnapshot: () => ({
        params: documentRef.current.params,
        strokes: documentRef.current.strokes.length,
        geometry: renderResult?.geometry ?? null,
        previewDigest: renderResult?.digest ?? null,
        previewStats: renderResult?.stats ?? null,
        lastExport,
        lastScreenshotHash,
        view,
        paused,
        animation,
        anchors: viewportRef.current?.getAnnotationAnchors() ?? [],
        presets: presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          geometryDigest: preset.geometryDigest,
          previewDigest: preset.previewDigest,
        })),
        errors: displayErrors,
        storageKey: CURRENT_KEY,
      }),
    };
    (window as unknown as { __tessera: typeof api }).__tessera = api;
    return () => {
      delete (window as unknown as { __tessera?: typeof api }).__tessera;
    };
  }, [
    animation,
    displayErrors,
    lastExport,
    lastScreenshotHash,
    paused,
    presets,
    renderResult,
    view,
  ]);

  useEffect(
    () => () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const objectCount = renderResult?.geometry.count ?? 0;
  const seamDelta = renderResult?.stats.seamDelta ?? 0;
  const geometryDigest = renderResult?.geometry.digest ?? "pending";
  const previewDigest = renderResult?.digest ?? "pending";
  void historyVersion;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>织石</h1>
            <p>TESSERA / TEXTURE LAB</p>
          </div>
        </div>

        <div className="header-identity">
          <span className="live-indicator">
            <i />
            SEAMLESS LOOP
          </span>
          <span className="header-rule" />
          <span>逐像素生成 · 确定性导出</span>
        </div>

        <div className="top-actions">
          <div className="history-actions">
            <button
              className="icon-button"
              onClick={handleUndo}
              disabled={!canUndo}
              title="撤销 (Ctrl/⌘ Z)"
              aria-label="撤销"
              data-testid="undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-button"
              onClick={handleRedo}
              disabled={!canRedo}
              title="重做 (Ctrl/⌘ Shift Z)"
              aria-label="重做"
              data-testid="redo"
            >
              <Redo2 size={16} />
            </button>
          </div>
          <button className="top-button" onClick={savePreset} data-testid="save-preset">
            <Save size={15} />
            保存参数
          </button>
          <button
            className="top-button"
            onClick={() => importInputRef.current?.click()}
            data-testid="import-json"
          >
            <Upload size={15} />
            导入
          </button>
          <button className="top-button" onClick={openSelfTests} data-testid="open-selftest">
            <FlaskConical size={15} />
            自检
            {selftestReport && (
              <span className={`test-dot ${selftestReport.pass ? "pass" : "fail"}`} />
            )}
          </button>
          <button
            className="primary-button header-capture"
            onClick={captureScreenshot}
            data-testid="capture-screenshot"
          >
            <Camera size={15} />
            截图
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="side-panel left-panel">
          <div className="panel-scroll">
            <div className="section-kicker">
              <span>GENERATOR / 01</span>
              <SlidersHorizontal size={13} />
            </div>
            <h2 className="panel-title">纹理发生器</h2>
            <p className="panel-intro">
              所有纹理由周期函数逐像素计算，没有加载任何图片素材。
            </p>

            <div className="kind-switch" role="group" aria-label="纹理类型">
              {(["stone", "cloth"] as TextureKind[]).map((kind) => (
                <button
                  key={kind}
                  className={`kind-button ${document.params.kind === kind ? "active" : ""}`}
                  onClick={() => applyKind(kind)}
                  data-testid={`kind-${kind}`}
                >
                  <span className={`kind-glyph ${kind}`} aria-hidden="true">
                    {Array.from({ length: 9 }, (_, index) => (
                      <i key={index} />
                    ))}
                  </span>
                  <span>
                    <b>{kind === "stone" ? "石纹" : "布纹"}</b>
                    <small>{kind === "stone" ? "STONE" : "WOVEN"}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="field-block">
              <div className="field-heading">
                <span>色板</span>
                <em>PALETTE</em>
              </div>
              <div className="palette-row">
                {palettes.map((palette) => (
                  <button
                    key={palette}
                    className={`palette-chip ${document.params.palette === palette ? "active" : ""}`}
                    onClick={() => applyPalette(palette)}
                    aria-label={`使用${PALETTE_LABELS[palette]}色板`}
                    data-testid={`palette-${palette}`}
                  >
                    <span className={`palette-swatch ${palette}`} />
                    <span>{PALETTE_LABELS[palette]}</span>
                    {document.params.palette === palette && <Check size={12} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="parameter-stack">
              <ParameterSlider
                label="尺度"
                code="SCALE"
                value={document.params.scale}
                min={6}
                max={48}
                step={1}
                display={`${document.params.scale} ${document.params.kind === "stone" ? "格" : "线"}`}
                onChange={(value) => updateParameter("scale", value)}
              />
              <ParameterSlider
                label="方向"
                code="DIRECTION"
                value={document.params.direction}
                min={-180}
                max={180}
                step={1}
                display={formatSigned(document.params.direction)}
                onChange={(value) => updateParameter("direction", value)}
              />
              <ParameterSlider
                label="对比度"
                code="CONTRAST"
                value={document.params.contrast}
                min={0.5}
                max={2.5}
                step={0.01}
                display={`${document.params.contrast.toFixed(2)}×`}
                onChange={(value) => updateParameter("contrast", value)}
              />
              <div className="dual-parameter">
                <ParameterSlider
                  label="浮雕"
                  code="RELIEF"
                  value={document.params.relief}
                  min={0}
                  max={1}
                  step={0.01}
                  display={`${Math.round(document.params.relief * 100)}%`}
                  onChange={(value) => updateParameter("relief", value)}
                />
                <ParameterSlider
                  label="颗粒"
                  code="GRAIN"
                  value={document.params.grain}
                  min={0}
                  max={1}
                  step={0.01}
                  display={`${Math.round(document.params.grain * 100)}%`}
                  onChange={(value) => updateParameter("grain", value)}
                />
              </div>
              <div className="seed-row">
                <label>
                  <span>
                    随机种子 <em>SEED</em>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={99999}
                    value={document.params.seed}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        updateParameter("seed", Math.max(1, Math.min(99999, Math.round(value))));
                      }
                    }}
                    aria-label="随机种子"
                  />
                </label>
                <button
                  className="square-button"
                  onClick={() => updateParameter("seed", Math.floor(Math.random() * 89999) + 10000)}
                  title="生成新的随机种子"
                  aria-label="随机种子"
                >
                  <Shuffle size={15} />
                </button>
                <button
                  className="square-button"
                  onClick={resetParameters}
                  title="复位参数"
                  aria-label="复位参数"
                >
                  <RotateCcw size={15} />
                </button>
              </div>
              {document.params.kind === "cloth" && (
                <div className="mode-note">
                  整数波矢 <code>{clothWaveVector(document.params).join(" × ")}</code>
                  <span>实际方向 {realizedAngle.toFixed(1)}°</span>
                </div>
              )}
            </div>

            <div className="brush-section">
              <div className="brush-heading">
                <div>
                  <span className="section-kicker inline">BRUSH / 02</span>
                  <h3>接缝联动笔刷</h3>
                </div>
                <Toggle
                  checked={brush.enabled}
                  onChange={(enabled) => setBrush((value) => ({ ...value, enabled }))}
                  label="启用接缝笔刷"
                />
              </div>
              <div className="brush-mode">
                {(["burn", "lift"] as BrushMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={brush.mode === mode ? "active" : ""}
                    onClick={() => setBrush((value) => ({ ...value, mode }))}
                  >
                    <span className={`brush-mode-dot ${mode}`} />
                    {mode === "burn" ? "加深" : "提亮"}
                  </button>
                ))}
                <span className="brush-sync-badge">∞ 对侧同步</span>
              </div>
              <ParameterSlider
                label="笔径"
                code="SIZE"
                value={brush.size}
                min={0.015}
                max={0.12}
                step={0.001}
                display={`${Math.round(brush.size * 512)} px`}
                onChange={(size) => setBrush((value) => ({ ...value, size }))}
              />
              <ParameterSlider
                label="强度"
                code="FLOW"
                value={brush.strength}
                min={0.05}
                max={0.9}
                step={0.01}
                display={`${Math.round(brush.strength * 100)}%`}
                onChange={(strength) =>
                  setBrush((value) => ({ ...value, strength }))
                }
              />
              <p className="brush-hint">
                笔触越界时四边副本同时写入。合成顺序固定为
                <b> 纹理 → 结构 → 标记 → 光标</b>。
              </p>
            </div>

            <div className="preset-section">
              <div className="preset-heading">
                <div>
                  <span className="section-kicker inline">LIBRARY / 03</span>
                  <h3>参数库</h3>
                </div>
                <span className="preset-count">{presets.length.toString().padStart(2, "0")}</span>
              </div>
              <div className="preset-save-row">
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="命名当前参数…"
                  maxLength={40}
                  aria-label="预设名称"
                  data-testid="preset-name"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") savePreset();
                  }}
                />
                <button
                  className="square-button solid"
                  onClick={savePreset}
                  aria-label="保存当前参数为预设"
                  title="保存当前参数"
                >
                  <Save size={15} />
                </button>
              </div>
              <div className="preset-list">
                {presets.map((preset) => (
                  <div className="preset-row" key={preset.id}>
                    <button
                      className="preset-load"
                      onClick={() => loadPreset(preset)}
                      data-testid={`load-preset-${preset.name}`}
                    >
                      <span className={`preset-dot ${preset.params.kind}`} />
                      <span>
                        <b>{preset.name}</b>
                        <small>
                          {preset.params.kind === "stone" ? "石" : "布"} ·{" "}
                          {preset.previewDigest.slice(0, 8)}
                        </small>
                      </span>
                    </button>
                    <button
                      className="preset-delete"
                      onClick={() => removePreset(preset.id)}
                      aria-label={`删除预设 ${preset.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="stage-column">
          <div
            className="stage-shell"
            data-testid="stage"
            data-object-count={objectCount}
            data-geometry-digest={geometryDigest}
            data-preview-digest={previewDigest}
          >
            <div className="stage-topline">
              <div className={`run-state ${paused ? "paused" : ""}`}>
                <span className="live-dot" />
                <b>{paused ? "ANIMATION FROZEN" : "LIVE PIXEL FIELD"}</b>
                <span>
                  {rendering
                    ? "重算中…"
                    : `${renderResult?.width ?? 512}² · ${renderResult?.durationMs ?? 0} ms`}
                </span>
              </div>
              <div className="stage-coordinates">
                <span>
                  X 0.000—1.000
                </span>
                <span>
                  Y 0.000—1.000
                </span>
              </div>
            </div>

            <TextureViewport
              ref={viewportRef}
              texture={textureCanvas}
              geometry={renderResult?.geometry ?? null}
              view={view}
              paused={paused}
              brush={brush}
              onStroke={handleStroke}
              onAnimationUpdate={handleAnimationUpdate}
            />

            <div className="stage-tool-note">
              <span className="tool-crosshair" />
              <div>
                <b>{brush.enabled ? "接缝笔刷" : "观察模式"}</b>
                <span>
                  {brush.enabled
                    ? `${brush.mode === "burn" ? "加深" : "提亮"} · 拖拽修改`
                    : "开启笔刷后可编辑"}
                </span>
              </div>
            </div>

            {(renderError || displayErrors.length > 0) && (
              <div className="error-banner" role="alert" data-testid="error-banner">
                <AlertTriangle size={17} />
                <div>
                  <b>{renderError ? "渲染异常" : "参数校验提示"}</b>
                  <span>{renderError ?? displayErrors[0]}</span>
                  {!renderError && displayErrors.length > 1 && (
                    <small>另有 {displayErrors.length - 1} 条提示，已使用安全参数。</small>
                  )}
                </div>
                <button
                  className="banner-close"
                  onClick={() => {
                    setRenderError(null);
                    setValidationErrors([]);
                  }}
                  aria-label="关闭提示"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="stage-controls">
              <div className="stage-control-group playback-group">
                <button
                  className={`pause-button ${paused ? "paused" : ""}`}
                  onClick={() => setPaused((value) => !value)}
                  aria-label={paused ? "恢复动画" : "暂停动画"}
                  data-testid="toggle-animation"
                >
                  {paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
                  {paused ? "恢复" : "暂停"}
                </button>
                <div className="animation-readout">
                  <span>光扫相位</span>
                  <b data-testid="animation-time">
                    {formatTime(animation.milliseconds)}
                  </b>
                  <small>F{animation.frame.toString().padStart(4, "0")}</small>
                </div>
              </div>

              <div className="stage-control-group zoom-group">
                <button
                  className="mini-button"
                  aria-label="缩小视图"
                  onClick={() =>
                    setView((value) => ({ ...value, zoom: Math.max(0.72, value.zoom - 0.1) }))
                  }
                >
                  <ZoomOut size={14} />
                </button>
                <div className="compact-range">
                  <span>缩放</span>
                  <input
                    type="range"
                    min={0.72}
                    max={1.8}
                    step={0.01}
                    value={view.zoom}
                    onChange={(event) =>
                      setView((value) => ({ ...value, zoom: Number(event.target.value) }))
                    }
                    aria-label="视图缩放"
                    data-testid="zoom-slider"
                  />
                  <b>{Math.round(view.zoom * 100)}%</b>
                </div>
                <button
                  className="mini-button"
                  aria-label="放大视图"
                  onClick={() =>
                    setView((value) => ({ ...value, zoom: Math.min(1.8, value.zoom + 0.1) }))
                  }
                >
                  <ZoomIn size={14} />
                </button>
              </div>

              <div className="stage-control-group rotation-group">
                <span>视图旋转</span>
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={1}
                  value={view.rotation}
                  onChange={(event) =>
                    setView((value) => ({ ...value, rotation: Number(event.target.value) }))
                  }
                  aria-label="视图旋转"
                  data-testid="rotation-slider"
                />
                <b>{formatSigned(view.rotation)}</b>
              </div>

              <div className="stage-control-group layer-toggles">
                <button
                  className={view.showGeometry ? "active" : ""}
                  onClick={() =>
                    setView((value) => ({ ...value, showGeometry: !value.showGeometry }))
                  }
                  aria-pressed={view.showGeometry}
                >
                  结构
                </button>
                <button
                  className={view.showAnnotations ? "active" : ""}
                  onClick={() =>
                    setView((value) => ({
                      ...value,
                      showAnnotations: !value.showAnnotations,
                    }))
                  }
                  aria-pressed={view.showAnnotations}
                  data-testid="toggle-annotations"
                >
                  标注
                </button>
                <button
                  className={showSeams ? "active" : ""}
                  onClick={() => setShowSeams((value) => !value)}
                  aria-pressed={showSeams}
                >
                  缝线
                </button>
              </div>
            </div>
          </div>

          <div className="stage-footer">
            <span>
              <i className="status-led good" />
              四边连续 <b>×{seamDelta.toFixed(2)}</b>
            </span>
            <span>
              对象 <b>{objectCount.toString().padStart(4, "0")}</b>
            </span>
            <span>
              几何 <code>{geometryDigest.slice(0, 12)}</code>
            </span>
            <span className="footer-right">
              {paused ? "暂停不累计相位 · 恢复零跳帧" : "首帧 Δt = 0，切页不追帧"}
            </span>
          </div>
        </section>

        <aside className="side-panel right-panel">
          <div className="panel-scroll">
            <section className="preview-card">
              <div className="card-heading">
                <div>
                  <span className="section-kicker inline">TILING / 01</span>
                  <h2>无缝平铺</h2>
                </div>
                <label className="inline-toggle">
                  <span>缝线</span>
                  <Toggle checked={showSeams} onChange={setShowSeams} label="显示平铺缝线" />
                </label>
              </div>
              <TilePreview texture={textureCanvas} showSeams={showSeams} repeat={3} />
              <div className="preview-caption">
                <span>3 × 3 重复</span>
                <span>平铺边界无断点</span>
              </div>
            </section>

            <section className="diagnostic-card">
              <div className="card-heading">
                <div>
                  <span className="section-kicker inline">INSPECT / 02</span>
                  <h2>三层核对</h2>
                </div>
                <span className={`check-orb ${seamDelta < 1.6 ? "good" : "warn"}`}>
                  {seamDelta < 1.6 ? <Check size={13} /> : "!"}
                </span>
              </div>
              <p className="diagnostic-intro">
                屏幕预览、导出图像与内部几何共用同一参数指纹。
              </p>
              <div className="diagnostic-list">
                <div className="diagnostic-row">
                  <span>内部几何</span>
                  <code title={geometryDigest}>{geometryDigest.slice(0, 14)}</code>
                  <b className="ok">LIVE</b>
                </div>
                <div className="diagnostic-row">
                  <span>屏幕预览</span>
                  <code title={previewDigest}>{previewDigest.slice(0, 14)}</code>
                  <b className="ok">512²</b>
                </div>
                <div className="diagnostic-row">
                  <span>导出像素</span>
                  <code title={lastExport?.digest}>
                    {lastExport?.digest.slice(0, 14) ?? "等待导出"}
                  </code>
                  <b className={lastExport ? "ok" : "muted"}>
                    {lastExport ? `${lastExport.size}²` : "—"}
                  </b>
                </div>
                <div className="diagnostic-row">
                  <span>结构相似度</span>
                  <div className="mini-meter">
                    <span
                      style={{
                        width: `${Math.round((lastExport?.similarity ?? 1) * 100)}%`,
                      }}
                    />
                  </div>
                  <b className="ok">
                    {lastExport ? `${(lastExport.similarity * 100).toFixed(1)}%` : "待比"}
                  </b>
                </div>
                <div className="diagnostic-row">
                  <span>对象数量</span>
                  <code>{objectCount} objects</code>
                  <b className="ok">{renderResult?.geometry.kind ?? "—"}</b>
                </div>
                <div className="diagnostic-row">
                  <span>接缝邻接倍率</span>
                  <code>{seamDelta.toFixed(3)}×</code>
                  <b className={seamDelta < 1.6 ? "ok" : "warn"}>
                    {seamDelta < 1.6 ? "PASS" : "CHECK"}
                  </b>
                </div>
              </div>
              <button className="wide-quiet-button" onClick={openSelfTests}>
                <FlaskConical size={14} />
                运行默认 / 极值 / 异常自检
                {selftestReport && (
                  <span className={`inline-verdict ${selftestReport.pass ? "pass" : "fail"}`}>
                    {selftestReport.pass ? "全部通过" : "需检查"}
                  </span>
                )}
              </button>
            </section>

            <section className="export-card">
              <div className="card-heading">
                <div>
                  <span className="section-kicker inline">OUTPUT / 03</span>
                  <h2>导出</h2>
                </div>
                <Download size={16} />
              </div>
              <div className="size-options" role="group" aria-label="导出尺寸">
                {[256, 512, 1024, 2048].map((size) => (
                  <button
                    key={size}
                    className={exportSize === size ? "active" : ""}
                    onClick={() => setExportSize(size)}
                    data-testid={`export-size-${size}`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <button
                className="primary-button export-button"
                onClick={exportPng}
                disabled={exporting}
                data-testid="export-png"
              >
                <Download size={16} />
                {exporting ? "逐像素生成中…" : `导出 ${exportSize} × ${exportSize} PNG`}
              </button>
              <div className="export-secondary">
                <button
                  onClick={() =>
                    downloadText(
                      serializeDocument(documentRef.current),
                      downloadName(
                        documentRef.current.params.kind,
                        documentRef.current.params.seed,
                        "params.json",
                      ),
                    )
                  }
                >
                  参数 JSON
                </button>
                <button onClick={captureScreenshot}>
                  <Camera size={13} />
                  屏幕截图
                </button>
              </div>
              <div className="export-meta">
                {lastExport ? (
                  <>
                    <span>
                      {lastExport.objectCount} 对象 · 接缝 ×
                      {lastExport.seamDelta.toFixed(2)}
                    </span>
                    <code>SHA {lastExport.digest.slice(0, 12)}</code>
                  </>
                ) : (
                  <>
                    <span>导出后在此核对像素与几何摘要</span>
                    <code>PNG / LOSSLESS</code>
                  </>
                )}
              </div>
              {lastScreenshotHash && (
                <div className="screenshot-hash">
                  <span>最近截图哈希</span>
                  <code title={lastScreenshotHash}>
                    {lastScreenshotHash.slice(0, 20)}…
                  </code>
                </div>
              )}
            </section>

            <p className="system-note">
              <span>确定性内核 v1</span>
              <span>无外部贴图</span>
              <span>Canvas / RGBA</span>
            </p>
          </div>
        </aside>
      </main>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importDocument(file);
          event.target.value = "";
        }}
      />

      <SelfTestModal
        open={selftestOpen}
        running={selftestRunning}
        report={selftestReport}
        onClose={() => setSelftestOpen(false)}
        onRun={() => void runTests()}
      />

      {toast && (
        <div className={`toast ${toast.kind}`} role="status" data-testid="toast">
          <span className="toast-icon">
            {toast.kind === "success" ? (
              <Check size={15} />
            ) : toast.kind === "error" ? (
              <AlertTriangle size={15} />
            ) : (
              <SlidersHorizontal size={15} />
            )}
          </span>
          <div>
            <b>{toast.title}</b>
            {toast.detail && <span>{toast.detail}</span>}
          </div>
          <button onClick={() => setToast(null)} aria-label="关闭通知">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
