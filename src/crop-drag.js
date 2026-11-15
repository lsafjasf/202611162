import { ASPECTS } from './model.js';
import { clampCrop, normalizeCrop } from './crop.js';

const HANDLE = 14;

export function wireCropDrag(canvas, options) {
  const { getScene, getActiveClipId, updateCrop } = options;

  function toCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function activeCrop() {
    const scene = getScene();
    const clip = scene.clips.find((c) => c.id === getActiveClipId());
    return { scene, clip };
  }

  function hitHandle(point, crop) {
    const near = (x, y) => Math.abs(point.x - x) <= HANDLE && Math.abs(point.y - y) <= HANDLE;
    if (near(crop.x + crop.w, crop.y + crop.h)) return 'se';
    if (near(crop.x, crop.y + crop.h)) return 'sw';
    if (near(crop.x + crop.w, crop.y)) return 'ne';
    if (near(crop.x, crop.y)) return 'nw';
    return null;
  }

  function hitBody(point, crop) {
    return point.x >= crop.x && point.x <= crop.x + crop.w
      && point.y >= crop.y && point.y <= crop.y + crop.h;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const point = toCanvasPoint(event);
    const { scene, clip } = activeCrop();
    const handle = hitHandle(point, clip.crop);
    const inside = hitBody(point, clip.crop);
    if (!handle && !inside) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const start = point;
    const startCrop = { ...clip.crop };
    const ratio = ASPECTS[clip.aspect].ratio;

    function onMove(moveEvent) {
      const current = toCanvasPoint(moveEvent);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      let next;
      if (handle) {
        let w = startCrop.w;
        if (handle.includes('e')) w += dx;
        if (handle.includes('w')) w -= dx;
        w = Math.max(120, w);
        let h = w / ratio;
        let x = startCrop.x;
        let y = startCrop.y;
        if (handle.includes('w')) x = startCrop.x + (startCrop.w - w);
        if (handle.includes('n')) y = startCrop.y + (startCrop.h - h);
        if (handle.includes('s')) y = startCrop.y;
        next = normalizeCrop({ x, y, w, h }, clip.aspect);
      } else {
        next = normalizeCrop({
          x: startCrop.x + dx,
          y: startCrop.y + dy,
          w: startCrop.w,
          h: startCrop.h,
        }, clip.aspect);
      }
      updateCrop(clip.id, clampCrop(scene, clip, clip.aspect, next));
    }
    function onUp() {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    }
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
  });
}
