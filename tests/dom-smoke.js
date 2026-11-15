/* DOM 冒烟测试：用最小桩件验证 app.js 初始化、控件事件与完整生产流程 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ids = ['stage', 'screw', 'tempSet', 'tension', 'screwVal', 'tempSetVal',
  'tensionVal', 'btnStart', 'btnPurge', 'btnPause', 'btnReset', 'btnMute',
  'btnAck', 'faultHeater', 'faultScrew', 'faultWinder', 'stateText', 'specText',
  'progText', 'progBar', 'meltText', 'diaText', 'powerText', 'peakText',
  'goodText', 'wasteText', 'timeText', 'defectText', 'recoveryText', 'alarmBox',
  'alarmKind', 'alarmDevice', 'alarmCode', 'alarmValue', 'alarmThreshold',
  'alarmMsg', 'eventLog', 'finishBox', 'finishTitle', 'finishBody',
  'btnSnapshot', 'btnNewBatch', 'snapshotSel', 'reScrew', 'reTemp', 'reTension',
  'btnRerun', 'cmpA', 'cmpB', 'historyBody', 'btnCompare', 'cmpResult', 'cmpBody'];

function makeEl(id) {
  return {
    id, style: {}, value: '0', textContent: '', innerHTML: '',
    width: 900, height: 380,
    listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) this.listeners.click(); },
    input(v) { this.value = String(v); if (this.listeners.input) this.listeners.input(); },
    getContext() {
      return new Proxy({}, { get: (t, p) => {
        if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
        return typeof p === 'string' ? function () {} : undefined;
      } });
    }
  };
}
const elements = {};
ids.forEach((id) => { elements[id] = makeEl(id); });
elements.screw.value = '45'; elements.tempSet.value = '180'; elements.tension.value = '18';

const sandbox = {
  console,
  document: { getElementById: (id) => elements[id] || makeEl(id) },
  setInterval: () => 1, clearInterval: () => {},
  performance: { now: () => Date.now() },
  confirm: () => true, prompt: () => '测试快照',
  AudioContext: function () {
    function node() {
      return {
        gain: { value: 0, setTargetAtTime() {}, exponentialRampToValueAtTime() {},
                setValueAtTime() {} },
        frequency: { value: 0, setTargetAtTime() {} },
        type: '',
        connect() { return node(); }, start() {}, stop() {}
      };
    }
    return {
      state: 'running', currentTime: 0, destination: {},
      createGain: node, createOscillator: node, resume() {}
    };
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['simulation.js', 'renderer.js', 'sound.js', 'app.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), sandbox);
});

const app = sandbox.window.CableApp || sandbox.CableApp;
const sim = app.sim;
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('  PASS  ' + msg); }
  else { console.error('  FAIL  ' + msg); failures++; }
}

console.log('\n[DOM 冒烟] 初始化与完整生产流程');
check(elements.stateText.textContent.includes('待机'), '初始状态渲染为待机');
check(elements.eventLog.innerHTML === '', '事件表初始为空');

// 通过滑块改参数（含一次越限）
elements.tempSet.input(300);
check(sim.alarm && sim.alarm.kind === 'limit', '滑块越限触发报警');
check(elements.alarmBox.style.display === 'block', '失败画面显示');
check(elements.alarmDevice.textContent.length > 0 && Number(elements.alarmValue.textContent) === 300,
      '失败画面指出设备与触发值');
elements.btnAck.click();
for (let i = 0; i < 100; i++) sim.tick();
check(sim.alarm === null && sim.recoveryLeft === 0, '恢复观察期结束无残留');

// 三段完整流程：清料 -> 生产
sim.meltTemp = 180;
sim.resetBatch();
app.renderPanels();
for (let seg = 0; seg < 3; seg++) {
  elements.btnPurge.click();
  for (let i = 0; i < 60 && sim.state === 'purging'; i++) { sim.tick(); app.renderPanels(); }
  check(sim.state === 'idle', '第 ' + (seg + 1) + ' 段清料完成');
  elements.btnStart.click();
  let guard = 0;
  while (sim.state === 'running' && guard++ < 5000) { sim.tick(); app.renderPanels(); }
}
check(sim.state === 'finished', '三段后批次结束');
check(elements.finishBox.style.display === 'block', '结束面板显示良品/废品/峰值功耗/停机原因');
check(/良品/.test(elements.finishBody.innerHTML) && /峰值功耗/.test(elements.finishBody.innerHTML),
      '结束面板包含要求的统计项');
check(sim.archived.length === 1 && Object.isFrozen(sim.archived[0]), '批次归档且冻结');

// 快照 + 改参重跑 + 比较
elements.btnNewBatch.click();
elements.btnSnapshot.click();
check(sim.snapshots.length === 1, '快照保存成功');
elements.reTemp.value = '260'; elements.reScrew.value = '70'; elements.reTension.value = '20';
elements.btnRerun.click();
check(sim.archived.length === 1, '重跑不影响已归档批次');
sim.meltTemp = 180;
for (let seg = 0; seg < 3; seg++) {
  elements.btnPurge.click();
  for (let i = 0; i < 60 && sim.state === 'purging'; i++) { sim.tick(); app.renderPanels(); }
  elements.btnStart.click();
  let guard = 0;
  while (sim.state === 'running' && guard++ < 5000) { sim.tick(); app.renderPanels(); }
}
check(sim.archived.length === 2, '第二个批次完成归档');
elements.btnCompare.click();
check(elements.cmpResult.style.display === 'block' &&
      /差值/.test(elements.cmpBody.innerHTML), '并排比较表渲染差值');

// HTML 中所有 getElementById 都真实存在
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const missing = ids.filter((id) => !html.includes('id="' + id + '"'));
check(missing.length === 0, '所有控件 ID 在 index.html 中存在' +
      (missing.length ? '：缺失 ' + missing.join(',') : ''));

console.log('\n' + (failures ? failures + ' 项失败' : 'DOM 冒烟全部通过') + '\n');
process.exitCode = failures ? 1 : 0;
