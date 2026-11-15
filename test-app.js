// test-app.js — 用最小 DOM 桩对 app.js 做冒烟测试（不依赖真实浏览器）
'use strict';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}

// ---------- 最小 DOM 桩 ----------
function makeCtx() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '',
    fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fill: noop, strokeText: noop, fillText: noop,
  };
}

const elements = {};
function makeEl(id) {
  const listeners = {};
  const el = {
    id, value: '', textContent: '', innerHTML: '', checked: true,
    style: {}, children: [],
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    dispatch: (ev, arg) => { (listeners[ev] || []).forEach(fn => fn(arg || { target: el, preventDefault: () => {} })); },
    appendChild(c) { this.children.push(c); return c; },
    click() { this.dispatch('click'); },
    getContext: () => makeCtx(),
    toDataURL: () => 'data:image/png;base64,AAAA',
    width: 0, height: 0,
  };
  return el;
}
function getEl(id) { return elements[id] || (elements[id] = makeEl(id)); }

let rafCb = null;
const store = {};

global.window = {
  innerWidth: 1200, innerHeight: 700,
  addEventListener: () => {},
  IsoScene: require('./iso-scene.js'),
};
global.document = {
  getElementById: getEl,
  createElement: (tag) => makeEl('<' + tag + '>'),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
};
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.URL = { createObjectURL: () => 'blob:mock' };
global.Blob = function () {};
global.FileReader = function () { this.readAsText = () => {}; };

require('./app.js');

console.log('== app.js 冒烟测试 ==');
ok(typeof rafCb === 'function', '应用启动并注册了动画帧回调');
ok(getEl('p-seed').value !== '', '参数输入框已填充默认值');
ok(getEl('sel-building').children.length === 8, '建筑下拉框包含 8 栋建筑');

// 推进几帧（含暂停/恢复）
rafCb(0); rafCb(16); rafCb(32);
getEl('btn-pause').click();
ok(getEl('btn-pause').textContent === '恢复', '暂停按钮切换为“恢复”');
rafCb(48); rafCb(64);
getEl('btn-pause').click();
ok(getEl('btn-pause').textContent === '暂停', '恢复按钮切换回“暂停”');
rafCb(80);

// 非法参数 -> 错误提示，不崩不空白
getEl('p-buildingCount').value = '-5';
getEl('btn-apply').click();
ok(getEl('error').style.display === 'block' && getEl('error').textContent.includes('buildingCount'), '非法参数显示明确错误提示');
rafCb(96);
ok(getEl('status').textContent.includes('建筑8'), '非法参数后仍保留原场景（画面不空白）');

// 合法修改 + 撤销
getEl('p-buildingCount').value = '10';
getEl('btn-apply').click();
ok(getEl('error').style.display === 'none', '合法参数清除错误提示');
rafCb(97);
ok(getEl('status').textContent.includes('建筑10'), '应用后场景为 10 栋建筑');
getEl('btn-undo').click();
rafCb(98);
ok(getEl('status').textContent.includes('建筑8'), '撤销后恢复 8 栋建筑');

// 修改单栋高度
getEl('sel-building').value = '1';
getEl('in-height').value = '28';
getEl('btn-height').click();
ok(getEl('error').style.display === 'none', '修改高度成功');

// 保存 / 导出
getEl('btn-save').click();
ok(typeof store['iso-street-params'] === 'string' && JSON.parse(store['iso-street-params']).params.seed !== undefined, '参数已保存到 localStorage');
getEl('btn-export').click();
ok(true, '导出 PNG 不抛异常');

// 图层切换
const layerBoxes = getEl('layer-box').children;
ok(layerBoxes.length === 7, '提供 7 个图层开关');
layerBoxes[1].children[0].checked = false;
layerBoxes[1].children[0].dispatch('change');
rafCb(112);
ok(true, '隐藏建筑层后渲染不抛异常');

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
