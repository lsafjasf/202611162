import { App } from './app.mjs';

const ids = [
  'thresholdRange', 'thresholdNumber',
  'smoothnessRange', 'smoothnessNumber',
  'minAreaRange', 'minAreaNumber',
  'recomputeBtn', 'undoBtn', 'playBtn', 'exportBtn', 'shotBtn',
  'zoomInBtn', 'zoomOutBtn', 'rotateCwBtn', 'rotateCcwBtn', 'resetViewBtn',
  'savePresetBtn', 'loadPresetBtn', 'deletePresetBtn', 'presetName', 'presetSelect',
  'addAnnotationBtn', 'canvas', 'errorBanner', 'statsPanel', 'comparePanel', 'statusLine',
];

const elements = { canvas: document.getElementById('stageCanvas') };
for (const id of ids) {
  if (id === 'canvas') continue;
  elements[id] = document.getElementById(id);
}

const app = new App(elements);
app.refreshPresetList();
window.__app = app;
