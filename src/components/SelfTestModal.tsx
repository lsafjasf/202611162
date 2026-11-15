import { useEffect, useRef } from "react";
import { Check, FlaskConical, ShieldAlert, X } from "lucide-react";
import { renderResultToCanvas } from "../texture/canvas";
import { renderTexture } from "../texture/render";
import { DEFAULT_PARAMS, type TextureParams } from "../texture/types";
import type { runSelfTests } from "../texture/selftest";

type Report = ReturnType<typeof runSelfTests>;

interface SelfTestModalProps {
  open: boolean;
  running: boolean;
  report: Report | null;
  onClose: () => void;
  onRun: () => void;
}

const caseParams: Record<string, TextureParams> = {
  default: DEFAULT_PARAMS,
  "extreme-stone": {
    ...DEFAULT_PARAMS,
    scale: 48,
    direction: 179,
    contrast: 2.5,
    relief: 1,
    grain: 1,
    seed: 99999,
  },
  "extreme-cloth": {
    ...DEFAULT_PARAMS,
    kind: "cloth",
    palette: "flax",
    scale: 48,
    direction: -179,
    contrast: 2.5,
    relief: 1,
    grain: 1,
    seed: 12347,
  },
  invalid: {
    ...DEFAULT_PARAMS,
    kind: "cloth",
    palette: "slate",
    scale: 24,
  },
};

function CaseThumbnail({ id }: { id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = caseParams[id] ?? DEFAULT_PARAMS;
    const result = renderTexture(params, [], 96);
    const source = renderResultToCanvas(result);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, 72, 72);
    context.drawImage(source, 0, 0, 72, 72);
  }, [id]);
  return <canvas ref={canvasRef} width={72} height={72} className="case-thumb" />;
}

export function SelfTestModal({
  open,
  running,
  report,
  onClose,
  onRun,
}: SelfTestModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="selftest-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="selftest-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <div className="eyebrow">
              <FlaskConical size={13} />
              DETERMINISTIC CHECK
            </div>
            <h2 id="selftest-title">纹理结构与导出一致性自检</h2>
            <p>
              对默认、两组极值和异常参数重算两次，比较对象数量、几何位置、接缝与像素摘要。
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭自检">
            <X size={18} />
          </button>
        </header>

        <div className="selftest-content">
          <div className="selftest-run-row">
            <button className="primary-button compact" onClick={onRun} disabled={running}>
              <FlaskConical size={15} />
              {running ? "正在重算…" : report ? "重新运行自检" : "运行自检"}
            </button>
            {report && (
              <div className={`test-verdict ${report.pass ? "pass" : "fail"}`}>
                {report.pass ? <Check size={15} /> : <ShieldAlert size={15} />}
                {report.pass
                  ? `${report.cases.length} 组纹理与保存回载全部通过`
                  : "发现结构或导出不一致"}
              </div>
            )}
          </div>

          {!report && !running && (
            <div className="empty-test">
              <div className="empty-test-orbit" />
              <strong>尚未运行</strong>
              <span>测试会实际生成像素、导出缩小对比并重载序列化参数。</span>
            </div>
          )}

          {running && (
            <div className="test-loading">
              <span className="pulse-dot" />
              正在逐像素重算四组样本…
            </div>
          )}

          {report && !running && (
            <>
              <div className="case-grid">
                {report.cases.map((testCase) => (
                  <article
                    className={`test-case ${testCase.pass ? "pass" : "fail"}`}
                    key={testCase.id}
                  >
                    <div className="case-heading">
                      <div className="case-heading-main">
                        <CaseThumbnail id={testCase.id} />
                        <div>
                          <strong>{testCase.label}</strong>
                          <span>
                            {testCase.objectCountBefore} 对象 · {testCase.durationMs} ms
                          </span>
                        </div>
                      </div>
                      <span className={testCase.pass ? "tag-pass" : "tag-fail"}>
                        {testCase.pass ? "PASS" : "FAIL"}
                      </span>
                    </div>
                    <div className="hash-stack">
                      <div>
                        <span>几何位置</span>
                        <code>{testCase.geometryPositionDigest.slice(0, 12)}</code>
                      </div>
                      <div>
                        <span>导出摘要</span>
                        <code>{testCase.imageDigestBefore.slice(0, 12)}</code>
                      </div>
                      <div>
                        <span>预览↔导出</span>
                        <code>{(testCase.previewExportSimilarity * 100).toFixed(1)}%</code>
                      </div>
                    </div>
                    <div className="check-list">
                      {testCase.checks.map((check) => (
                        <div className={check.pass ? "check-pass" : "check-fail"} key={check.name}>
                          <span className="check-mark">{check.pass ? "✓" : "!"}</span>
                          <span>{check.name}</span>
                          <code title={check.detail}>{check.detail}</code>
                        </div>
                      ))}
                    </div>
                    {testCase.errors.length > 0 && (
                      <div className="case-error-note">
                        已识别 {testCase.errors.length} 个异常，使用安全参数继续渲染：
                        {testCase.errors[0]}
                      </div>
                    )}
                  </article>
                ))}
              </div>

              <div className={`savereload-row ${report.saveReload.pass ? "pass" : "fail"}`}>
                <div>
                  <strong>参数保存 → 序列化 → 重新载入</strong>
                  <span>
                    含跨接缝笔刷；比较文档摘要、几何摘要与 160px 像素摘要。
                  </span>
                </div>
                <div className="savereload-hashes">
                  <code>{report.saveReload.originalDigest}</code>
                  <span>→</span>
                  <code>{report.saveReload.restoredDigest}</code>
                  <b>{report.saveReload.pass ? "一致" : "不一致"}</b>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
