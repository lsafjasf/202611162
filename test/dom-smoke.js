'use strict';
var fs = require('fs');
var path = require('path');
var JSDOM = require('jsdom').JSDOM;

var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost/index.html'
});
var window = dom.window;
global.window = window;
global.document = window.document;
global.devicePixelRatio = 1;
window.requestAnimationFrame = function (cb) { return 0; };
window.HTMLCanvasElement.prototype.getContext = function () {
  var noop = function () {};
  return {
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, arc: noop,
    fill: noop, closePath: noop, save: noop, restore: noop, clip: noop,
    rect: noop, fillText: noop,
    createLinearGradient: function () {
      return { addColorStop: noop };
    }
  };
};
window.AudioContext = function () {
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 22050,
    destination: {},
    createOscillator: function () {
      return { type: '', frequency: { setValueAtTime: function () {} },
        connect: function () { return this; }, start: function () {},
        stop: function () {} };
    },
    createGain: function () {
      return { gain: { setValueAtTime: function () {},
        exponentialRampToValueAtTime: function () {} },
        connect: function () { return this; } };
    },
    createBuffer: function (ch, len) {
      return { getChannelData: function () { return new Float32Array(len); } };
    },
    createBufferSource: function () {
      return { connect: function () { return this; }, start: function () {} };
    },
    createBiquadFilter: function () {
      return { type: '', frequency: { value: 0 },
        connect: function () { return this; } };
    },
    resume: function () {}
  };
};

['js/rng.js', 'js/sim.js', 'js/audio.js', 'js/render.js', 'js/app.js']
  .forEach(function (f) {
    window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  });

var data = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'scenarios.json'), 'utf8'));

function fire(id) {
  var el = window.document.getElementById(id);
  el.dispatchClass = el.dispatchClass || 0;
  var evt = new window.Event('click');
  el.dispatchEvent(evt);
}

var App = window.PestApp;
var app = new App();
app.initScenarios(data);

var assert = require('assert');
assert.ok(app.sim, 'sim created');
assert.strictEqual(app.sim.seed, 'demo-seed-7');
assert.strictEqual(window.document.getElementById('day').textContent, '0.00');

/* 手动操作：在热区林班执行一次监测。 */
var hot0 = app.sim.hotspots[0];
app.tool = 'survey';
app.renderer.cellAt = function () { return { x: hot0.x, y: hot0.y }; };
app.handleClick({ clientX: 0, clientY: 0,
  target: window.document.getElementById('map') });
var c0 = window.PEST_SIM.CFG;
var cell = window.PEST_SIM;
assert.ok(app.sim.log.length === 1, 'survey logged');
assert.ok(/监测/.test(window.document.getElementById('last-op').textContent),
  'last-op updated');

/* 资源扣减与喷药误伤益虫。 */
var beforeBenefit = app.sim.cells[cell.idx(hot0.x, hot0.y)].benefit;
app.tool = 'spray';
app.sprayMode = 'target';
app.handleClick({ clientX: 0, clientY: 0 });
var after = app.sim.cells[cell.idx(hot0.x, hot0.y)];
assert.ok(after.benefit < beforeBenefit, 'spray harms benefit');
assert.ok(after.residue > 0, 'residue applied');

/* 暂停/继续与连续推进：跑若干固定子步，状态应单调演化。 */
app.running = false;
var pestBefore = app.sim.cells[cell.idx(hot0.x, hot0.y)].pest;
for (var i = 0; i < 8; i++) app.advance();
var pestAfter = app.sim.cells[cell.idx(hot0.x, hot0.y)].pest;
assert.ok(Math.abs(pestAfter - pestBefore) > 1e-9, 'state evolves over time');
assert.ok(app.sim.time > 0, 'time advances');

/* 固定序列复现：同 seed 两次重放，关键状态完全一致。 */
function replay() {
  app.loadScenario('steady');
  while (!app.sim.finished) app.advance();
  return app.sim.cells.map(function (c) {
    return c.pest.toFixed(5) + '|' + c.benefit.toFixed(5);
  }).join(';');
}
var r1 = replay();
var r2 = replay();
assert.strictEqual(r1, r2, 'same-seed replay deterministic');
assert.strictEqual(app.sim.result, 'success', 'steady scenario succeeds');

/* 失败档与临界档结论。 */
app.loadScenario('failure');
while (!app.sim.finished) app.advance();
assert.strictEqual(app.sim.result, 'fail', 'failure scenario fails');
app.loadScenario('critical');
while (!app.sim.finished) app.advance();
assert.strictEqual(app.sim.result, 'marginal', 'critical scenario marginal');

/* 对比表与恢复表已渲染。 */
app.showComparison();
app.showRecovery();
assert.ok(window.document.getElementById('compare-body').rows.length >= 6,
  'comparison rows');
assert.ok(window.document.getElementById('recovery-body').rows.length === 3,
  'recovery rows');

/* 同 seed 初始资源/天气/目标个体一致。 */
var sA = window.PEST_SIM.createSim('abc');
var sB = window.PEST_SIM.createSim('abc');
assert.deepStrictEqual(
  sA.cells.map(function (c) { return c.pest; }),
  sB.cells.map(function (c) { return c.pest; }),
  'initial hotspots identical');
assert.deepStrictEqual(sA.weather, sB.weather, 'weather identical');
assert.deepStrictEqual(sA.resources, sB.resources, 'resources identical');
var sC = window.PEST_SIM.createSim('xyz');
assert.notDeepStrictEqual(sA.weather, sC.weather, 'different seed differs');

console.log('DOM smoke test: all assertions passed');
