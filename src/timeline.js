const ROW_LABELS = { landscape: '横屏', square: '方形', portrait: '竖屏' };

function clientToTime(event, rulerEl, duration) {
  const rect = rulerEl.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return ratio * duration;
}

export function createTimeline(root, options) {
  const { clock, getScene, onClipChange, onSeek } = options;
  let scene = getScene();

  function render() {
    scene = getScene();
    const duration = scene.duration;
    root.innerHTML = '';
    const ruler = document.createElement('div');
    ruler.className = 'tl-ruler';
    for (let s = 0; s <= duration; s += 1) {
      const tick = document.createElement('span');
      tick.className = 'tl-tick';
      tick.style.left = `${(s / duration) * 100}%`;
      tick.textContent = `${s}s`;
      ruler.appendChild(tick);
    }
    ruler.addEventListener('pointerdown', (event) => {
      onSeek(clientToTime(event, ruler, duration));
    });
    root.appendChild(ruler);

    for (const clip of scene.clips) {
      const row = document.createElement('div');
      row.className = 'tl-row';
      const label = document.createElement('span');
      label.className = 'tl-label';
      label.textContent = ROW_LABELS[clip.aspect];
      row.appendChild(label);

      const bar = document.createElement('div');
      bar.className = `tl-clip ${clip.aspect}`;
      bar.dataset.clipId = clip.id;
      positionBar(bar, clip, duration);

      const handleIn = document.createElement('span');
      handleIn.className = 'tl-handle in';
      const handleOut = document.createElement('span');
      handleOut.className = 'tl-handle out';
      bar.append(handleIn, handleOut);
      wireDrag(bar, handleIn, handleOut, clip, duration);
      row.appendChild(bar);
      root.appendChild(row);
    }

    const playhead = document.createElement('div');
    playhead.className = 'tl-playhead';
    playhead.id = 'tlPlayhead';
    root.appendChild(playhead);
    updatePlayhead(clock.currentTime);
  }

  function positionBar(bar, clip, duration) {
    bar.style.left = `${(clip.inPoint / duration) * 100}%`;
    bar.style.width = `${((clip.outPoint - clip.inPoint) / duration) * 100}%`;
    bar.textContent = `${clip.inPoint.toFixed(2)} – ${clip.outPoint.toFixed(2)} (${(clip.outPoint - clip.inPoint).toFixed(2)}s)`;
  }

  function wireDrag(bar, handleIn, handleOut, clip, duration) {
    handleIn.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      beginDrag(event, 'in', clip, bar, duration);
    });
    handleOut.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      beginDrag(event, 'out', clip, bar, duration);
    });
    bar.addEventListener('pointerdown', (event) => {
      if (event.target.classList.contains('tl-handle')) return;
      beginDrag(event, 'move', clip, bar, duration);
    });
  }

  function beginDrag(startEvent, mode, clip, bar, duration) {
    startEvent.preventDefault();
    const startX = startEvent.clientX;
    const startIn = clip.inPoint;
    const startOut = clip.outPoint;
    const width = bar.parentElement.getBoundingClientRect().width;
    const pxToSec = duration / width;
    const minLen = 0.5;

    function move(event) {
      const delta = (event.clientX - startX) * pxToSec;
      let nextIn = startIn;
      let nextOut = startOut;
      if (mode === 'in') nextIn = Math.min(startOut - minLen, Math.max(0, startIn + delta));
      if (mode === 'out') nextOut = Math.max(startIn + minLen, Math.min(duration, startOut + delta));
      if (mode === 'move') {
        const len = startOut - startIn;
        nextIn = Math.min(duration - len, Math.max(0, startIn + delta));
        nextOut = nextIn + len;
      }
      onClipChange(clip.id, {
        inPoint: Number(nextIn.toFixed(3)),
        outPoint: Number(nextOut.toFixed(3)),
      });
      positionBar(bar, clip, duration);
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function updatePlayhead(time) {
    const playhead = root.querySelector('#tlPlayhead');
    if (!playhead) return;
    const pct = (time / scene.duration) * 100;
    playhead.style.left = `calc(8px + (100% - 16px) * ${pct / 100})`;
  }

  render();
  return { render, updatePlayhead };
}
