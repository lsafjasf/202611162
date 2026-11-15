import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type {
  BrushPoint,
  BrushStroke,
  GeometryState,
} from "../texture/types";

export interface ViewState {
  zoom: number;
  rotation: number;
  showGeometry: boolean;
  showAnnotations: boolean;
}

export interface BrushConfig {
  enabled: boolean;
  mode: BrushStroke["mode"];
  size: number;
  strength: number;
}

export interface TextureViewportHandle {
  getCanvas(): HTMLCanvasElement | null;
  getAnnotationAnchors(): Array<{
    id: string;
    worldX: number;
    worldY: number;
    screenX: number;
    screenY: number;
  }>;
}

interface Layout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  tile: number;
}

interface TextureViewportProps {
  texture: HTMLCanvasElement | null;
  geometry: GeometryState | null;
  view: ViewState;
  paused: boolean;
  brush: BrushConfig;
  onStroke: (stroke: BrushStroke) => void;
  onAnimationUpdate?: (milliseconds: number, frame: number) => void;
}

const DPR_LIMIT = 2;

function rotateVector(x: number, y: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function projection(layout: Layout, view: ViewState) {
  const radians = (view.rotation * Math.PI) / 180;
  return {
    radians,
    tile: layout.tile * view.zoom,
    toScreen(worldX: number, worldY: number) {
      const local = rotateVector(
        (worldX - 0.5) * layout.tile * view.zoom,
        (worldY - 0.5) * layout.tile * view.zoom,
        radians,
      );
      return { x: layout.cx + local.x, y: layout.cy + local.y };
    },
    toWorld(screenX: number, screenY: number) {
      const local = rotateVector(
        screenX - layout.cx,
        screenY - layout.cy,
        -radians,
      );
      return {
        x: local.x / (layout.tile * view.zoom) + 0.5,
        y: local.y / (layout.tile * view.zoom) + 0.5,
      };
    },
  };
}

export const TextureViewport = forwardRef<TextureViewportHandle, TextureViewportProps>(
  function TextureViewport(
    { texture, geometry, view, paused, brush, onStroke, onAnimationUpdate },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const layoutRef = useRef<Layout>({ width: 1, height: 1, cx: 0.5, cy: 0.5, tile: 1 });
    const activeMsRef = useRef(0);
    const frameRef = useRef(0);
    const pausedRef = useRef(paused);
    const hoverRef = useRef<{ x: number; y: number } | null>(null);
    const dragRef = useRef<{ stroke: BrushStroke; last: BrushPoint } | null>(null);
    const viewRef = useRef(view);
    const brushRef = useRef(brush);
    const textureRef = useRef(texture);
    const geometryRef = useRef(geometry);

    viewRef.current = view;
    brushRef.current = brush;
    textureRef.current = texture;
    geometryRef.current = geometry;
    pausedRef.current = paused;

    const anchors = useCallback((layout: Layout, currentView: ViewState) => {
      const points = [
        { id: "left", x: 0, y: 0.5 },
        { id: "right", x: 1, y: 0.5 },
        { id: "top", x: 0.5, y: 0 },
        { id: "bottom", x: 0.5, y: 1 },
      ];
      const project = projection(layout, currentView);
      return points.map((point) => {
        const screen = project.toScreen(point.x, point.y);
        return {
          id: point.id,
          worldX: point.x,
          worldY: point.y,
          screenX: screen.x,
          screenY: screen.y,
        };
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        getAnnotationAnchors: () => anchors(layoutRef.current, viewRef.current),
      }),
      [anchors],
    );

    const resize = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      layoutRef.current = {
        width,
        height,
        cx: width / 2,
        cy: height / 2,
        tile: Math.max(120, Math.min(width, height) * 0.74),
      };
    }, []);

    const drawDraft = useCallback(
      (
        context: CanvasRenderingContext2D,
        layout: Layout,
        currentView: ViewState,
      ) => {
        const draft = dragRef.current;
        if (!draft || draft.stroke.points.length === 0) return;
        const project = projection(layout, currentView);
        context.save();
        context.globalCompositeOperation =
          draft.stroke.mode === "burn" ? "multiply" : "screen";
        const radius = draft.stroke.size * 0.5 * project.tile;
        for (const point of draft.stroke.points) {
          for (let ox = -1; ox <= 1; ox += 1) {
            for (let oy = -1; oy <= 1; oy += 1) {
              const screen = project.toScreen(point.x + ox, point.y + oy);
              if (
                screen.x < -radius ||
                screen.y < -radius ||
                screen.x > layout.width + radius ||
                screen.y > layout.height + radius
              ) {
                continue;
              }
              const gradient = context.createRadialGradient(
                screen.x,
                screen.y,
                radius * 0.08,
                screen.x,
                screen.y,
                radius,
              );
              const strength = 0.11 + draft.stroke.strength * 0.22;
              const channels = draft.stroke.mode === "burn" ? "20,18,14" : "255,248,226";
              gradient.addColorStop(0, `rgba(${channels},${strength})`);
              gradient.addColorStop(0.65, `rgba(${channels},${strength * 0.32})`);
              gradient.addColorStop(1, "rgba(0,0,0,0)");
              context.fillStyle = gradient;
              context.beginPath();
              context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
              context.fill();
            }
          }
        }
        context.restore();
      },
      [],
    );

    const drawScene = useCallback(
      (milliseconds: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const layout = layoutRef.current;
        const currentView = viewRef.current;
        const currentBrush = brushRef.current;
        const currentTexture = textureRef.current;
        const currentGeometry = geometryRef.current;
        const dpr = canvas.width / Math.max(1, layout.width);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, layout.width, layout.height);

        const background = context.createRadialGradient(
          layout.cx,
          layout.cy * 0.85,
          20,
          layout.cx,
          layout.cy,
          Math.max(layout.width, layout.height) * 0.78,
        );
        background.addColorStop(0, "#24251f");
        background.addColorStop(0.54, "#181915");
        background.addColorStop(1, "#0d0e0c");
        context.fillStyle = background;
        context.fillRect(0, 0, layout.width, layout.height);

        context.save();
        context.strokeStyle = "rgba(236, 232, 217, 0.045)";
        context.lineWidth = 1;
        for (let x = (layout.cx % 32) - 32; x < layout.width; x += 32) {
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, layout.height);
          context.stroke();
        }
        for (let y = (layout.cy % 32) - 32; y < layout.height; y += 32) {
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(layout.width, y);
          context.stroke();
        }
        context.restore();

        const project = projection(layout, currentView);
        const radians = project.radians;
        const tileSize = project.tile;
        const corners = [
          project.toScreen(0, 0),
          project.toScreen(1, 0),
          project.toScreen(1, 1),
          project.toScreen(0, 1),
        ];
        context.save();
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) {
          context.lineTo(corners[i].x, corners[i].y);
        }
        context.closePath();
        context.shadowColor = "rgba(0,0,0,0.72)";
        context.shadowBlur = 46;
        context.fillStyle = "#20211c";
        context.fill();
        context.restore();

        if (currentTexture) {
          context.save();
          context.translate(layout.cx, layout.cy);
          context.rotate(radians);
          context.drawImage(
            currentTexture,
            -tileSize / 2,
            -tileSize / 2,
            tileSize,
            tileSize,
          );
          context.restore();
        } else {
          context.fillStyle = "#282820";
          context.fillRect(
            layout.cx - tileSize / 2,
            layout.cy - tileSize / 2,
            tileSize,
            tileSize,
          );
        }

        if (currentGeometry && currentView.showGeometry) {
          const stride = Math.max(1, Math.ceil(currentGeometry.objects.length / 170));
          context.save();
          context.fillStyle = "rgba(255, 122, 74, 0.92)";
          context.strokeStyle = "rgba(255, 236, 208, 0.34)";
          context.lineWidth = 0.8;
          for (let index = 0; index < currentGeometry.objects.length; index += stride) {
            const object = currentGeometry.objects[index];
            const screen = project.toScreen(object.x, object.y);
            context.beginPath();
            context.arc(screen.x, screen.y, 1.75, 0, Math.PI * 2);
            context.fill();
            if (stride === 1 && index < 90) {
              context.beginPath();
              context.moveTo(screen.x - 3.5, screen.y);
              context.lineTo(screen.x + 3.5, screen.y);
              context.moveTo(screen.x, screen.y - 3.5);
              context.lineTo(screen.x, screen.y + 3.5);
              context.stroke();
            }
          }
          context.restore();
        }

        drawDraft(context, layout, currentView);

        if (!currentTexture) {
          context.save();
          context.fillStyle = "rgba(255,255,255,0.62)";
          context.font = '500 12px "SFMono-Regular", ui-monospace, monospace';
          context.textAlign = "center";
          context.fillText("正在生成纹理…", layout.cx, layout.cy);
          context.restore();
        }

        const sheenPhase = (milliseconds % 8200) / 8200;
        context.save();
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) {
          context.lineTo(corners[i].x, corners[i].y);
        }
        context.closePath();
        context.clip();
        context.globalCompositeOperation = "soft-light";
        const sheenX = layout.cx + (sheenPhase - 0.5) * layout.width * 1.5;
        const sheen = context.createLinearGradient(
          sheenX - 90,
          layout.cy - tileSize * 0.7,
          sheenX + 90,
          layout.cy + tileSize * 0.7,
        );
        sheen.addColorStop(0, "rgba(255,255,255,0)");
        sheen.addColorStop(0.48, "rgba(255,247,222,0.2)");
        sheen.addColorStop(0.55, "rgba(255,255,255,0.34)");
        sheen.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = sheen;
        context.fillRect(
          layout.cx - tileSize,
          layout.cy - tileSize,
          tileSize * 2,
          tileSize * 2,
        );
        context.restore();

        context.save();
        context.strokeStyle = "rgba(246, 239, 222, 0.62)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) {
          context.lineTo(corners[i].x, corners[i].y);
        }
        context.closePath();
        context.stroke();
        context.strokeStyle = "rgba(255, 103, 58, 0.92)";
        context.lineWidth = 2;
        const cornerLength = 10;
        for (const corner of corners) {
          const dx = corner.x - layout.cx;
          const dy = corner.y - layout.cy;
          const length = Math.max(1, Math.hypot(dx, dy));
          context.beginPath();
          context.moveTo(corner.x, corner.y);
          context.lineTo(
            corner.x - (dx / length) * cornerLength,
            corner.y - (dy / length) * cornerLength,
          );
          context.stroke();
        }
        context.restore();

        if (currentView.showAnnotations) {
          const markerAnchors = anchors(layout, currentView);
          context.save();
          context.setLineDash([2, 7]);
          context.strokeStyle = "rgba(246, 239, 222, 0.18)";
          context.lineWidth = 1;
          const left = markerAnchors.find((anchor) => anchor.id === "left")!;
          const right = markerAnchors.find((anchor) => anchor.id === "right")!;
          const top = markerAnchors.find((anchor) => anchor.id === "top")!;
          const bottom = markerAnchors.find((anchor) => anchor.id === "bottom")!;
          context.beginPath();
          context.moveTo(left.screenX, left.screenY);
          context.lineTo(right.screenX, right.screenY);
          context.moveTo(top.screenX, top.screenY);
          context.lineTo(bottom.screenX, bottom.screenY);
          context.stroke();
          context.setLineDash([]);
          for (const anchor of markerAnchors) {
            const isHorizontal =
              anchor.id === "left" || anchor.id === "right";
            const outwardX =
              anchor.id === "left"
                ? -18
                : anchor.id === "right"
                  ? 18
                  : 0;
            const outwardY =
              anchor.id === "top" ? -18 : anchor.id === "bottom" ? 18 : 0;
            context.strokeStyle = "rgba(255, 103, 58, 0.9)";
            context.beginPath();
            context.moveTo(anchor.screenX, anchor.screenY);
            context.lineTo(anchor.screenX + outwardX, anchor.screenY + outwardY);
            context.stroke();
            context.fillStyle = "#ff673a";
            context.beginPath();
            context.arc(anchor.screenX, anchor.screenY, 3, 0, Math.PI * 2);
            context.fill();
            const labels: Record<string, string> = {
              left: "A · 左缘",
              right: "A′ · 右缘",
              top: "B · 上缘",
              bottom: "B′ · 下缘",
            };
            const label = labels[anchor.id] ?? anchor.id;
            const labelX =
              anchor.screenX + outwardX + (isHorizontal ? (outwardX < 0 ? -5 : 5) : 0);
            const labelY =
              anchor.screenY + outwardY + (isHorizontal ? 0 : outwardY < 0 ? -7 : 7);
            context.font =
              '500 9px "SFMono-Regular", "Noto Sans SC Local", ui-monospace, sans-serif';
            context.textAlign =
              anchor.id === "left" ? "right" : anchor.id === "right" ? "left" : "center";
            context.textBaseline = "middle";
            const textWidth = context.measureText(label).width;
            const pillWidth = textWidth + 12;
            const pillHeight = 18;
            const pillX =
              context.textAlign === "right"
                ? labelX - pillWidth
                : context.textAlign === "center"
                  ? labelX - pillWidth / 2
                  : labelX;
            const pillY = labelY - pillHeight / 2;
            context.fillStyle = "rgba(12, 13, 11, 0.82)";
            context.fillRect(pillX, pillY, pillWidth, pillHeight);
            context.strokeStyle = "rgba(255, 255, 255, 0.13)";
            context.strokeRect(pillX, pillY, pillWidth, pillHeight);
            context.fillStyle = "rgba(248, 243, 229, 0.92)";
            context.fillText(label, labelX, labelY + 0.5);
          }
          context.restore();
        }

        const hover = hoverRef.current;
        if (hover && currentBrush.enabled) {
          const world = project.toWorld(hover.x, hover.y);
          const radius = Math.max(5, currentBrush.size * 0.5 * tileSize);
          const points = [{ x: world.x, y: world.y }];
          if (world.x < 0.08) points.push({ x: world.x + 1, y: world.y });
          if (world.x > 0.92) points.push({ x: world.x - 1, y: world.y });
          if (world.y < 0.08) points.push({ x: world.x, y: world.y + 1 });
          if (world.y > 0.92) points.push({ x: world.x, y: world.y - 1 });
          context.save();
          for (const point of points) {
            const screen = project.toScreen(point.x, point.y);
            context.strokeStyle =
              currentBrush.mode === "burn"
                ? "rgba(255, 103, 58, 0.92)"
                : "rgba(255, 245, 214, 0.92)";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.moveTo(screen.x - 5, screen.y);
            context.lineTo(screen.x + 5, screen.y);
            context.moveTo(screen.x, screen.y - 5);
            context.lineTo(screen.x, screen.y + 5);
            context.stroke();
          }
          context.restore();
        }

        canvas.dataset.animationTime = String(Math.round(milliseconds));
        canvas.dataset.frame = String(frameRef.current);
        canvas.dataset.paused = String(pausedRef.current);
      },
      [anchors, drawDraft],
    );

    const animationCallbackRef = useRef(onAnimationUpdate);
    const strokeCallbackRef = useRef(onStroke);
    animationCallbackRef.current = onAnimationUpdate;
    strokeCallbackRef.current = onStroke;

    useEffect(() => {
      resize();
      drawScene(activeMsRef.current);
    }, [drawScene, resize]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const parent = canvas?.parentElement;
      if (!parent) return;
      const observer = new ResizeObserver(() => {
        resize();
        drawScene(activeMsRef.current);
      });
      observer.observe(parent);
      return () => observer.disconnect();
    }, [drawScene, resize]);

    useEffect(() => {
      drawScene(activeMsRef.current);
      if (paused) {
        animationCallbackRef.current?.(
          Math.round(activeMsRef.current),
          frameRef.current,
        );
        return;
      }
      let raf = 0;
      let lastTimestamp: number | null = null;
      let lastReport = -1;
      const tick = (timestamp: number) => {
        if (lastTimestamp === null) {
          lastTimestamp = timestamp;
        } else {
          const delta = Math.min(50, Math.max(0, timestamp - lastTimestamp));
          lastTimestamp = timestamp;
          activeMsRef.current += delta;
          frameRef.current += 1;
        }
        drawScene(activeMsRef.current);
        if (activeMsRef.current - lastReport > 240) {
          lastReport = activeMsRef.current;
          animationCallbackRef.current?.(
            Math.round(activeMsRef.current),
            frameRef.current,
          );
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [drawScene, paused]);

    const localPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }, []);

    const worldPoint = useCallback((screenX: number, screenY: number) => {
      const world = projection(layoutRef.current, viewRef.current).toWorld(
        screenX,
        screenY,
      );
      return {
        x: world.x - Math.floor(world.x),
        y: world.y - Math.floor(world.y),
      };
    }, []);

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!brushRef.current.enabled || event.button !== 0) return;
      const screen = localPoint(event);
      hoverRef.current = screen;
      const point = worldPoint(screen.x, screen.y);
      dragRef.current = {
        stroke: {
          id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mode: brushRef.current.mode,
          size: brushRef.current.size,
          strength: brushRef.current.strength,
          points: [point],
        },
        last: point,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      drawScene(activeMsRef.current);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const screen = localPoint(event);
      hoverRef.current = screen;
      const draft = dragRef.current;
      if (draft) {
        const point = worldPoint(screen.x, screen.y);
        const threshold = Math.max(0.0025, draft.stroke.size * 0.08);
        const dx = Math.abs(point.x - draft.last.x);
        const dy = Math.abs(point.y - draft.last.y);
        if (Math.min(dx, 1 - dx) > threshold || Math.min(dy, 1 - dy) > threshold) {
          draft.stroke.points.push(point);
          draft.last = point;
        }
      }
      if (pausedRef.current) drawScene(activeMsRef.current);
    };

    const finishStroke = (commit: boolean) => {
      const draft = dragRef.current;
      dragRef.current = null;
      if (commit && draft && draft.stroke.points.length > 0) {
        strokeCallbackRef.current(draft.stroke);
      }
      drawScene(activeMsRef.current);
    };

    return (
      <div className="viewport-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="viewport-canvas"
          data-testid="viewport-canvas"
          aria-label="可平铺纹理主预览，可拖动笔刷修改石材或织物"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => finishStroke(true)}
          onPointerCancel={() => finishStroke(false)}
          onPointerLeave={() => {
            if (!dragRef.current) hoverRef.current = null;
            if (pausedRef.current) drawScene(activeMsRef.current);
          }}
        />
      </div>
    );
  },
);
