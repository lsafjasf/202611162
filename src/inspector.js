import { ASPECTS } from './model.js';
import { checkConstraints } from './crop.js';

function row(label, value) {
  return `<div>${label}</div><div class="num">${value}</div>`;
}

export function createInspector(tabsEl, inspectorEl, subtitleEl, options) {
  const { getScene, getActiveClipId, selectClip, updateClip, updateCrop } = options;

  function renderTabs() {
    const scene = getScene();
    tabsEl.innerHTML = '';
    for (const clip of scene.clips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = clip.id === getActiveClipId() ? 'active' : '';
      btn.textContent = ASPECTS[clip.aspect].label;
      btn.addEventListener('click', () => selectClip(clip.id));
      tabsEl.appendChild(btn);
    }
  }

  function renderInspector() {
    const scene = getScene();
    const clip = scene.clips.find((c) => c.id === getActiveClipId());
    const check = checkConstraints(scene, clip);
    inspectorEl.innerHTML = `
      ${row('画幅', ASPECTS[clip.aspect].label)}
      ${row('入点', `${clip.inPoint.toFixed(3)} s`)}
      ${row('出点', `${clip.outPoint.toFixed(3)} s`)}
      ${row('总时长', `${(clip.outPoint - clip.inPoint).toFixed(3)} s`)}
      ${row('裁剪 x/y', `${clip.crop.x.toFixed(1)}, ${clip.crop.y.toFixed(1)}`)}
      ${row('裁剪 w/h', `${clip.crop.w.toFixed(1)} × ${clip.crop.h.toFixed(1)}`)}
      <div>淡入</div><input type="range" min="0" max="1" step="0.05" data-field="fadeIn" value="${clip.transition.fadeIn}" />
      <div>淡出</div><input type="range" min="0" max="1" step="0.05" data-field="fadeOut" value="${clip.transition.fadeOut}" />
      <div>裁剪宽度</div><input type="range" min="120" max="960" step="2" data-field="cropW" value="${clip.crop.w}" />
      <div class="full constraint ${check.valid ? 'constraint-ok' : 'constraint-bad'}">
        ${check.valid ? '✓ 主体全程位于安全区内' : `✗ ${check.violationCount} 处越界（示例 ${JSON.stringify(check.violations[0])}）`}
      </div>
    `;
    inspectorEl.querySelector('[data-field="fadeIn"]').addEventListener('input', (event) => {
      updateClip(clip.id, { transition: { ...clip.transition, fadeIn: Number(event.target.value) } });
    });
    inspectorEl.querySelector('[data-field="fadeOut"]').addEventListener('input', (event) => {
      updateClip(clip.id, { transition: { ...clip.transition, fadeOut: Number(event.target.value) } });
    });
    inspectorEl.querySelector('[data-field="cropW"]').addEventListener('input', (event) => {
      const w = Number(event.target.value);
      const h = w / ASPECTS[clip.aspect].ratio;
      updateCrop(clip.id, { ...clip.crop, w, h });
    });
  }

  function renderSubtitles() {
    const scene = getScene();
    subtitleEl.innerHTML = '';
    for (const sub of scene.subtitles) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="t">${sub.start.toFixed(1)}–${sub.end.toFixed(1)}s</span><span></span>`;
      li.lastElementChild.textContent = sub.text;
      subtitleEl.appendChild(li);
    }
  }

  function render() {
    renderTabs();
    renderInspector();
    renderSubtitles();
  }

  return { render };
}
