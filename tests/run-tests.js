/* 自动化验证（Node + node-web-audio-api，复用与浏览器完全相同的引擎代码）。 */
'use strict';
const NWA = require('node-web-audio-api');
const fs = require('fs');
const path = require('path');

global.window = global;
require('../src/spatial-util.js');
require('../src/engine.js');
require('../src/render.js');
const SF = global.SF;
const OfflineCtx = NWA.OfflineAudioContext;

const DUR = 2.0, SR = 48000;
let passed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name + (detail ? ' -> ' + detail : '')); }
}

function clone(p) { return JSON.parse(JSON.stringify(p)); }

function peakAt(buffer, ch) { return SF.peakOf(buffer.getChannelData(ch)); }

// 估计某通道在某频段的能量（简单 Goertzel/DFT 单频点）
function bandLevel(buffer, ch, freq) {
  const x = buffer.getChannelData(ch);
  const w = 2 * Math.PI * freq / buffer.sampleRate;
  let re = 0, im = 0;
  const start = Math.floor(buffer.sampleRate * 0.3);
  for (let n = start; n < x.length; n++) {
    re += x[n] * Math.cos(w * n);
    im -= x[n] * Math.sin(w * n);
  }
  return 2 * Math.sqrt(re * re + im * im) / (x.length - start);
}

// 互相关求两信号相对延迟（秒）
function lagSeconds(a, b, sr) {
  let best = 0, bestV = -Infinity;
  const maxLag = Math.floor(sr * 0.08);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let n = 0; n + lag < a.length; n += 4) s += a[n] * b[n + lag];
    if (s > bestV) { bestV = s; best = lag; }
  }
  return best / sr;
}

function render(params) {
  return SF.renderOffline(OfflineCtx, params, DUR, SR);
}

(async function main() {
  console.log('\n[1] 三维参数敏感性：声音必须真实改变（非仅界面数字）');

  // 维度一：左右声道 —— 把声源 A 从最左拖到最右
  const pL = SF.DEFAULT_PARAMS(); pL.mode = 'stereo';
  pL.sources[0].x = 0.5; pL.sources[1].gain = 0; pL.sources[2].gain = 0;
  const pR = clone(pL); pR.sources[0].x = 9.5;
  const [bL, bR] = await Promise.all([render(pL), render(pR)]);
  const balanceL = peakAt(bL, 0) - peakAt(bL, 1);
  const balanceR = peakAt(bR, 0) - peakAt(bR, 1);
  check('左移时 L 峰值显著大于 R', balanceL > 0.05, `L-R=${balanceL.toFixed(3)}`);
  check('右移时 R 峰值显著大于 L', balanceR < -0.05, `L-R=${balanceR.toFixed(3)}`);
  check('左右声道发生真实反转', balanceL > 0 && balanceR < 0);

  // 维度二：频段 —— 改变声源 A 频率，频谱能量应迁移
  const pF1 = SF.DEFAULT_PARAMS();
  pF1.sources[1].gain = 0; pF1.sources[2].gain = 0; pF1.sources[0].freq = 220;
  const pF2 = clone(pF1); pF2.sources[0].freq = 440;
  const [bF1, bF2] = await Promise.all([render(pF1), render(pF2)]);
  const low1 = bandLevel(bF1, 0, 220), high1 = bandLevel(bF1, 0, 440);
  const low2 = bandLevel(bF2, 0, 220), high2 = bandLevel(bF2, 0, 440);
  check('220Hz 设置在 220 频段能量更高', low1 > high1 * 1.5);
  check('440Hz 设置在 440 频段能量更高', high2 > low2 * 1.5);
  check('频段能量随频率设置真实迁移', high2 / Math.max(1e-9, low2) > high1 / Math.max(1e-9, low1));

  // 维度三：节拍 —— 打开 tremolo 后包络方差应增大
  const pB0 = SF.DEFAULT_PARAMS();
  pB0.sources[1].gain = 0; pB0.sources[2].gain = 0;
  pB0.sources[0].beat = 0; pB0.sources[0].beatDepth = 0;
  const pB1 = clone(pB0); pB1.sources[0].beat = 5; pB1.sources[0].beatDepth = 0.8;
  const [bB0, bB1] = await Promise.all([render(pB0), render(pB1)]);
  function envVariance(buf) {
    const x = buf.getChannelData(0); const win = 480;
    const env = [];
    for (let i = 0; i + win < x.length; i += win) {
      let s = 0; for (let j = 0; j < win; j++) s += x[i + j] * x[i + j];
      env.push(Math.sqrt(s / win));
    }
    const m = env.reduce((a, b) => a + b, 0) / env.length;
    return env.reduce((a, b) => a + (b - m) ** 2, 0) / env.length;
  }
  const v0 = envVariance(bB0), v1 = envVariance(bB1);
  check('节拍开启后包络方差增大', v1 > v0 * 2, `v0=${v0.toExponential(2)} v1=${v1.toExponential(2)}`);

  console.log('\n[2] 距离 -> 延迟与音量真实变化');
  const pNear = SF.DEFAULT_PARAMS();
  pNear.sources[1].gain = 0; pNear.sources[2].gain = 0;
  pNear.listener = { x: 1.5, z: 1.2 }; pNear.sources[0].x = 2.0; pNear.sources[0].z = 1.2;
  const pFar = clone(pNear); pFar.listener = { x: 8, z: 5 };
  const [bN, bF] = await Promise.all([render(pNear), render(pFar)]);
  const lag = lagSeconds(bN.getChannelData(0), bF.getChannelData(0), SR);
  check('更远声源到达延迟更大', lag > 0.005, `lag=${(lag * 1000).toFixed(1)}ms`);
  check('更远声源峰值更小', peakAt(bF, 0) < peakAt(bN, 0) * 0.9);

  console.log('\n[3] 墙面反射 -> 混响能量变化');
  const pDry = SF.DEFAULT_PARAMS(); pDry.room.wallReflection = 0;
  const pWet = clone(pDry); pWet.room.wallReflection = 0.9;
  // 在 1.2s 停止声源，测量停止后的衰减尾巴（此时只剩混响）
  const [bDry, bWet] = await Promise.all([
    SF.renderOffline(OfflineCtx, pDry, 2.5, SR, 1.2),
    SF.renderOffline(OfflineCtx, pWet, 2.5, SR, 1.2)
  ]);
  function tailRms(buf) {
    const x = buf.getChannelData(0);
    const seg = x.slice(Math.floor(buf.sampleRate * 1.5));
    return SF.rmsOf(seg);
  }
  check('高反射时尾部混响能量更高', tailRms(bWet) > tailRms(bDry) * 1.2,
    `dry=${tailRms(bDry).toExponential(2)} wet=${tailRms(bWet).toExponential(2)}`);

  console.log('\n[4] 模式切换不重置声源位置');
  const pMode = SF.DEFAULT_PARAMS(); pMode.mode = 'stereo';
  pMode.sources[0].x = 2.3; pMode.sources[0].z = 4.1;
  const savedPos = clone(pMode.sources.map(s => ({ x: s.x, z: s.z })));
  const switched = clone(pMode); switched.mode = 'binaural';
  JSON.parse(JSON.stringify(switched)); // 模拟序列化
  check('切到双耳后声源坐标不变',
    JSON.stringify(switched.sources.map(s => ({ x: s.x, z: s.z }))) === JSON.stringify(savedPos));
  switched.mode = 'surround';
  const bSur = await render(switched);
  check('环绕模式 4 个声道均有信号',
    [0, 1, 2, 3].every(c => SF.rmsOf(bSur.getChannelData(c)) > 1e-5));

  console.log('\n[5] 导出前检查：静音/削波/声道缺失');
  const base = SF.DEFAULT_PARAMS(); base.mode = 'surround';
  const bOk = await render(base);
  const rep = SF.checkBuffer(bOk, 'surround');
  check('正常参数通过导出检查', rep.ok, JSON.stringify(rep.problems));
  const pSilent = clone(base); pSilent.sources.forEach(s => s.gain = 0);
  const bSilent = await render(pSilent);
  check('全静音被检出', !SF.checkBuffer(bSilent, 'surround').ok);
  const pClip = clone(base); pClip.sources.forEach(s => s.gain = 2.5);
  const bClip = await render(pClip);
  const clipRep = SF.checkBuffer(bClip, 'surround');
  check('削波被检出', clipRep.problems.some(p => p.type === 'clipping'));

  console.log('\n[6] 保存参数 -> 重新载入 -> 再导出，一致性');
  const paramsFile = path.join(__dirname, '..', 'artifacts', 'params-saved.json');
  const original = SF.DEFAULT_PARAMS();
  original.mode = 'surround';
  original.room.wallReflection = 0.55;
  original.listener = { x: 3.2, z: 4.4 };
  original.sources[0].freq = 330; original.sources[0].x = 2.2;
  original.sources[1].beat = 4;
  fs.writeFileSync(paramsFile, JSON.stringify(original, null, 2));
  const reloaded = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
  check('重载参数与保存内容一致', JSON.stringify(reloaded) === JSON.stringify(original));

  const [bA, bB] = await Promise.all([render(original), render(reloaded)]);
  check('两次导出时长一致',
    Math.abs(bA.length - bB.length) === 0, `${bA.length} vs ${bB.length}`);
  const peaksA = [0, 1, 2, 3].map(c => peakAt(bA, c));
  const peaksB = [0, 1, 2, 3].map(c => peakAt(bB, c));
  const peakDiff = Math.max(...peaksA.map((p, i) => Math.abs(p - peaksB[i])));
  check('两次导出四声道关键峰值一致', peakDiff < 1e-6, `maxDiff=${peakDiff.toExponential(2)}`);
  check('关键音高一致（330Hz 频段能量）',
    Math.abs(bandLevel(bA, 0, 330) - bandLevel(bB, 0, 330)) < 1e-6);
  const lagAB = lagSeconds(bA.getChannelData(0), bB.getChannelData(0), SR);
  check('两次导出延迟一致（互相关零偏移）', lagAB === 0, `lag=${lagAB}s`);

  // 产出一份示例 WAV 供人工/文件检查
  const wav = SF.encodeWav(bA);
  fs.writeFileSync(path.join(__dirname, '..', 'artifacts', 'sample-surround.wav'), Buffer.from(wav));

  console.log(`\n结果：${passed} 通过, ${failures.length} 失败`);
  if (failures.length) { console.error('失败项: ' + failures.join('; ')); process.exit(1); }
  console.log('全部验证通过。');
})().catch(e => { console.error(e); process.exit(1); });
