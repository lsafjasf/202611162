import { useCallback, useEffect, useRef } from "react";

interface TilePreviewProps {
  texture: HTMLCanvasElement | null;
  showSeams: boolean;
  repeat?: number;
}

export function TilePreview({ texture, showSeams, repeat = 3 }: TilePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#171814";
    context.fillRect(0, 0, width, height);
    if (!texture) return;
    const side = Math.min(width, height);
    const tile = side / repeat;
    const originX = (width - side) / 2;
    const originY = (height - side) / 2;
    context.save();
    context.beginPath();
    context.rect(originX, originY, side, side);
    context.clip();
    for (let row = 0; row < repeat; row += 1) {
      for (let column = 0; column < repeat; column += 1) {
        context.drawImage(
          texture,
          originX + column * tile,
          originY + row * tile,
          tile + 0.35,
          tile + 0.35,
        );
      }
    }
    context.restore();
    if (showSeams) {
      context.save();
      context.strokeStyle = "rgba(255, 103, 58, 0.56)";
      context.lineWidth = 1;
      context.setLineDash([3, 4]);
      for (let index = 1; index < repeat; index += 1) {
        const offset = originX + index * tile;
        context.beginPath();
        context.moveTo(offset + 0.5, originY);
        context.lineTo(offset + 0.5, originY + side);
        context.stroke();
        const offsetY = originY + index * tile;
        context.beginPath();
        context.moveTo(originX, offsetY + 0.5);
        context.lineTo(originX + side, offsetY + 0.5);
        context.stroke();
      }
      context.restore();
    }
    context.save();
    context.strokeStyle = "rgba(255,255,255,0.15)";
    context.strokeRect(originX + 0.5, originY + 0.5, side - 1, side - 1);
    context.fillStyle = "rgba(255,255,255,0.56)";
    context.font = '500 9px "SFMono-Regular", ui-monospace, monospace';
    context.textAlign = "center";
    context.fillText(`${repeat} × ${repeat} TILE`, width / 2, height - 8);
    context.restore();
  }, [repeat, showSeams, texture]);

  useEffect(() => {
    draw();
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div className="tile-preview-wrap">
      <canvas
        ref={canvasRef}
        className="tile-preview-canvas"
        data-testid="tile-preview"
        aria-label={`${repeat}乘${repeat}无接缝平铺预览`}
      />
    </div>
  );
}
