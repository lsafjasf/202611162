// UI 刷新:指标、最近操作、策略说明、稳态/临界/失败对比、日志
function fmtSnap(s) {
  if (!s) return '--';
  return `第${s.day}天 资金${s.funds} 苗${s.seedlings} 覆盖${(s.cover*100).toFixed(0)}% 浊度${s.turb} 光照${s.light} 稳定${s.stable}天`;
}
function refreshUI(sim) {
  const dayIdx = Math.min(Math.floor(sim.day), TOTAL_DAYS - 1);
  document.getElementById('ui-day').textContent =
    `第 ${Math.min(Math.floor(sim.day) + 1, TOTAL_DAYS)} / ${TOTAL_DAYS} 天`;
  document.getElementById('ui-weather').textContent =
    `天气:${WEATHER_NAME[sim.sched.weather[dayIdx]]}`;
  document.getElementById('ui-stable').textContent =
    `稳定连续:${sim.stableDays} 天`;
  const cover = coverageOf(sim);
  const phase = sim.over ? (sim.success ? '成功' : '未达标')
    : (sim.turb > TURB_CRIT || cover < COVER_CRIT) ? '临界'
    : sim.stableDays >= 3 ? '稳态' : '恢复中';
  document.getElementById('ui-phase').textContent = `状态:${phase}`;
  const rows = [
    ['覆盖率', (cover * 100).toFixed(1) + ' %', cover >= TARGET_COVER ? '' : (cover < COVER_CRIT ? 'crit' : 'warn'), '目标 ≥ 60%'],
    ['平均密度', meanDensity(sim).toFixed(2), '', ''],
    ['浊度', sim.turb.toFixed(1) + ' NTU', sim.turb > TURB_CRIT ? 'crit' : (sim.turb > TURB_OK ? 'warn' : ''), '目标 ≤ 15'],
    ['光照', sim.light.toFixed(0) + ' lx', sim.light < LIGHT_OK ? 'warn' : '', `生长需 ≥ ${LIGHT_OK}`],
    ['水流系数', sim.flow.toFixed(2), sim.flow < 0.6 ? 'crit' : (sim.flow < 0.8 ? 'warn' : ''), '过密打桩会降低'],
    ['资金', Math.round(sim.funds), sim.funds < 100 ? 'warn' : '', ''],
    ['种苗', sim.seedlings, sim.seedlings < 20 ? 'warn' : '', ''],
    ['固定桩', sim.stakes.length + ` / 安全≤${STAKE_SAFE}`, sim.stakes.length > STAKE_SAFE ? 'crit' : '', ''],
    ['航线', LANE_NAME[sim.lanePolicy], sim.lanePolicy === 0 ? 'warn' : '', ''],
    ['遮棚档位', sim.shade + ' / 2', '', ''],
    ['锚害累计', sim.anchorHits + ' 斑块', sim.anchorHits >= 3 ? 'warn' : '', ''],
  ];
  document.getElementById('metrics').innerHTML =
    '<table>' + rows.map(r =>
      `<tr class="${r[2]}"><td>${r[0]}</td><td class="v">${r[1]}</td><td>${r[3]}</td></tr>`
    ).join('') + '</table>';
  const el = document.getElementById('last-op');
  if (sim.lastOp) {
    el.textContent = '最近操作:' + sim.lastOp.text;
    el.className = sim.lastOp.good ? 'good' : 'bad';
    el.id = 'last-op';
  }
  document.getElementById('strategy-info').innerHTML =
    `策略A 补植移植:阈值 覆盖率&lt;45% · 代价 300资金+20种苗 · 见效快(立即+覆盖)<br>` +
    `策略B 围网封育:阈值 浊度&gt;18 或锚害≥3 · 代价 100资金+5天封育(无通行费) · 见效慢但稳`;
  let html = '';
  if (sim.steadyRecord) {
    html += `<div class="card"><span class="tag steady">稳态</span>` +
      `前:${fmtSnap(sim.steadyRecord.before)}<br>后:${fmtSnap(sim.steadyRecord.after)}</div>`;
  }
  if (sim.criticalRecord) {
    html += `<div class="card"><span class="tag critical">临界</span>${sim.criticalRecord.reason}<br>` +
      `前:${fmtSnap(sim.criticalRecord.before)}<br>后:${fmtSnap(sim.criticalRecord.after)}</div>`;
  }
  if (sim.failureRecord) {
    html += `<div class="card"><span class="tag failure">失败</span>${sim.failureRecord.why}<br>` +
      `前:${fmtSnap(sim.failureRecord.before)}<br>后:${fmtSnap(sim.failureRecord.after)}</div>`;
  }
  if (sim.transplantRecord) {
    html += `<div class="card"><span class="tag steady">策略A</span>` +
      `前:${fmtSnap(sim.transplantRecord.before)}<br>后:${fmtSnap(sim.transplantRecord.after)}</div>`;
  }
  if (sim.enclosureRecord) {
    html += `<div class="card"><span class="tag steady">策略B</span>封育至第${sim.enclosureRecord.until}天<br>` +
      `前:${fmtSnap(sim.enclosureRecord.before)}</div>`;
  }
  document.getElementById('compare').innerHTML = html || '尚未触发';
  document.getElementById('log').innerHTML = sim.log.slice(-40).map(
    e => `<div><span class="t">[第${e.day}天]</span>${e.text}</div>`).join('');
  const logEl = document.getElementById('log');
  logEl.scrollTop = logEl.scrollHeight;
}
