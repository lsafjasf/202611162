/* 应用控制器：绑定控件、主循环、报警/批次/快照/对比面板 */
(function () {
  'use strict';
  var sim = new CableSim.Simulation();
  var renderer = new CableRenderer(document.getElementById('stage'));
  var sound = new CableSound();
  var loopHandle = null;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  // 主循环：100ms 一个固定 tick，与模拟核心时钟一致
  function loop() {
    sim.tick();
    renderer.draw(sim);
    sound.update(sim);
    renderPanels();
    if (sim.state === 'finished') { stopLoop(); refreshHistory(); }
  }
  function startLoop() {
    sound.ensure();
    if (loopHandle === null) loopHandle = setInterval(loop, 100);
  }
  function stopLoop() {
    if (loopHandle !== null) { clearInterval(loopHandle); loopHandle = null; }
    sound.update(sim);
  }

  // ---- 控件绑定 ----
  ['screw', 'tempSet', 'tension'].forEach(function (key) {
    var input = $(key);
    input.addEventListener('input', function () {
      $(key + 'Val').textContent = input.value;
      sim.setParam(key, Number(input.value));
      renderPanels();
    });
  });

  $('btnStart').addEventListener('click', function () {
    if (sim.state === 'idle' && sim.start()) startLoop();
  });
  $('btnPurge').addEventListener('click', function () {
    if (sim.startPurge()) startLoop();
  });
  $('btnPause').addEventListener('click', function () {
    if (sim.paused) { sim.resume(); startLoop(); }
    else { sim.pause('manual'); stopLoop(); renderer.draw(sim); renderPanels(); }
  });
  $('btnReset').addEventListener('click', function () {
    if (!confirm('重置当前批次？未完成数据不会归档。')) return;
    sim.resetBatch();
    stopLoop();
    $('finishBox').style.display = 'none';
    syncInputs(); renderer.draw(sim); renderPanels();
  });
  $('btnMute').addEventListener('click', function () {
    sound.ensure();
    $('btnMute').textContent = sound.toggleMute() ? '🔇 已静音' : '🔊 声音';
  });
  $('btnAck').addEventListener('click', function () {
    sim.acknowledgeAlarm(); startLoop(); renderPanels();
  });

  // 故障注入（演示“设备故障”场景）
  ['faultHeater', 'faultScrew', 'faultWinder'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      var map = {
        faultHeater: ['heater', 'HEATER_BURNOUT', 0, '加热功率>0W'],
        faultScrew: ['screw', 'MOTOR_OVERCURRENT', 128, '120A'],
        faultWinder: ['winder', 'TAKEUP_JAM', 42, '40N']
      }[id];
      sound.ensure();
      sim.injectFault(map[0], map[1], map[2], map[3]);
      stopLoop(); renderer.draw(sim); renderPanels();
    });
  });

  function syncInputs() {
    $('screw').value = sim.params.screw; $('screwVal').textContent = sim.params.screw;
    $('tempSet').value = sim.params.tempSet; $('tempSetVal').textContent = sim.params.tempSet;
    $('tension').value = sim.params.tension; $('tensionVal').textContent = sim.params.tension;
  }

  var STATE_TEXT = {
    idle: '待机', running: '生产中', purging: '清料中',
    alarm: '报警停机', finished: '批次结束'
  };
  var DEV_CN = { heater: '加热器', screw: '螺杆电机', die: '模头',
                 hauloff: '牵引机', winder: '收线轴', line: '产线' };

  function renderPanels() {
    var sp = sim.spec();
    $('stateText').textContent = STATE_TEXT[sim.state] + (sim.paused ? '（已暂停）' : '');
    $('specText').textContent = sp.name + '（第 ' +
      Math.min(sim.segmentIndex + 1, 3) + '/3 段）';
    $('progText').textContent = fmt(sim.segProduced) + ' / ' + sp.segLen + ' m';
    $('progBar').style.width = Math.min(100, sim.segProduced / sp.segLen * 100) + '%';
    $('meltText').textContent = fmt(sim.meltTemp) + ' °C';
    $('diaText').textContent = sim.lastDiameter === null ? '—' :
      fmt(sim.lastDiameter) + ' mm（目标 ' + sp.targetD + '）';
    $('powerText').textContent = fmt(sim.currentPower) + ' W';
    $('peakText').textContent = fmt(sim.peakPower) + ' W';
    $('goodText').textContent = fmt(sim.totalGood) + ' m';
    $('wasteText').textContent = fmt(sim.totalWaste) + ' m';
    $('timeText').textContent = fmt(sim.simTime) + ' s';
    $('defectText').textContent = sim.lastDefect || '无';
    $('recoveryText').textContent = sim.recoveryLeft > 0 ?
      '恢复观察期剩余 ' + fmt(sim.recoveryLeft) + ' s' : '—';
    renderAlarm();
    renderEvents();
    if (sim.state === 'finished') renderFinished();
  }

  function renderAlarm() {
    var box = $('alarmBox');
    if (!sim.alarm) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    var a = sim.alarm;
    $('alarmKind').textContent = a.kind === 'fault' ? '设备故障' : '参数越限';
    $('alarmDevice').textContent = DEV_CN[a.device] || a.device;
    $('alarmCode').textContent = a.code;
    $('alarmValue').textContent = a.value;
    $('alarmThreshold').textContent = a.threshold;
    $('alarmMsg').textContent = a.message;
  }

  function renderEvents() {
    var box = $('eventLog');
    var list = sim.events.slice(-12).reverse();
    box.innerHTML = list.map(function (e) {
      var cn = DEV_CN[e.device] || e.device;
      return '<tr><td>' + fmt(e.t) + 's</td><td>' + cn + '</td><td>' +
        e.action + '</td><td>' + (e.detail || '') + '</td></tr>';
    }).join('');
  }

  function renderFinished() {
    var qc = sim.qc;
    $('finishBox').style.display = 'block';
    $('finishTitle').textContent = qc.pass ? '✅ 质量检查通过' : '❌ 质量检查未通过';
    $('finishBody').innerHTML =
      '批次 ' + sim.batchId + '｜停机原因：' + stopReasonCn(sim.stopReason) +
      '<br>良品 ' + fmt(qc.good) + ' m｜废品 ' + fmt(qc.waste) +
      ' m｜良率 ' + (qc.yieldRate * 100).toFixed(1) +
      '%<br>峰值功耗 ' + fmt(sim.peakPower) + ' W｜用时 ' + fmt(sim.simTime) + ' s';
  }

  function stopReasonCn(r) {
    return { completed: '三段正常完成', manual: '手动停机',
             reset: '批次重置' }[r] || r;
  }

  // ---- 快照：保存当前参数，改一组参数后重跑 ----
  $('btnSnapshot').addEventListener('click', function () {
    var label = prompt('快照名称：', '快照 ' + (sim.snapshots.length + 1));
    if (label === null) return;
    sim.saveSnapshot(label);
    refreshSnapshots();
  });

  $('btnNewBatch').addEventListener('click', function () {
    $('finishBox').style.display = 'none';
    sim.resetBatch();
    syncInputs(); renderer.draw(sim); renderPanels(); refreshSnapshots();
  });

  function refreshSnapshots() {
    var sel = $('snapshotSel');
    sel.innerHTML = sim.snapshots.map(function (s) {
      return '<option value="' + s.id + '">' + s.label +
        '（螺杆' + s.params.screw + ' / 温度' + s.params.tempSet +
        ' / 张力' + s.params.tension + '）</option>';
    }).join('');
  }

  $('btnRerun').addEventListener('click', function () {
    var id = $('snapshotSel').value;
    if (!id) { alert('请先保存一个快照'); return; }
    var overrides = {
      screw: Number($('reScrew').value),
      tempSet: Number($('reTemp').value),
      tension: Number($('reTension').value)
    };
    $('finishBox').style.display = 'none';
    sim.rerunFromSnapshot(id, overrides);
    syncInputs(); renderer.draw(sim); renderPanels();
    if (sim.alarm) { stopLoop(); renderer.draw(sim); }
  });

  // ---- 已完成批次（冻结）与并排比较 ----
  function refreshHistory() {
    var selA = $('cmpA'), selB = $('cmpB');
    var opts = sim.archived.map(function (r, i) {
      return '<option value="' + i + '">' + r.batchId + '｜' +
        stopReasonCn(r.stopReason) + '｜良率 ' + (r.yieldRate * 100).toFixed(1) + '%</option>';
    }).join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (sim.archived.length >= 2) {
      selA.value = String(sim.archived.length - 2);
      selB.value = String(sim.archived.length - 1);
    }
    var rows = sim.archived.map(function (r) {
      var alarms = r.events.filter(function (e) { return e.action === 'alarm'; }).length;
      return '<tr><td>' + r.batchId + '</td><td>' + fmt(r.good) + '</td><td>' +
        fmt(r.waste) + '</td><td>' + (r.yieldRate * 100).toFixed(1) + '%</td><td>' +
        fmt(r.peakPower) + '</td><td>' + stopReasonCn(r.stopReason) + '</td><td>' +
        alarms + '</td><td>' + (r.qc && r.qc.pass ? '通过' : '未通过') + '</td></tr>';
    }).join('');
    $('historyBody').innerHTML = rows;
  }

  $('btnCompare').addEventListener('click', function () {
    var a = sim.archived[Number($('cmpA').value)];
    var b = sim.archived[Number($('cmpB').value)];
    var cmp = CableSim.compareBatches(a, b);
    if (!cmp) { alert('需要至少两个已完成批次'); return; }
    var d = cmp.diff;
    $('cmpResult').style.display = 'block';
    $('cmpBody').innerHTML =
      '<tr><th>指标</th><th>批次 A</th><th>批次 B</th><th>差值(B-A)</th></tr>' +
      cmpRow('良品(m)', a.good, b.good, d.good) +
      cmpRow('废品(m)', a.waste, b.waste, d.waste) +
      cmpRow('良率', (a.yieldRate * 100).toFixed(1) + '%',
             (b.yieldRate * 100).toFixed(1) + '%', (d.yieldRate * 100).toFixed(1) + 'pt') +
      cmpRow('峰值功耗(W)', a.peakPower, b.peakPower, d.peakPower) +
      cmpRow('用时(s)', a.simTime, b.simTime, d.simTime) +
      cmpRow('异常记录数', d.alarmCount[0], d.alarmCount[1],
             d.alarmCount[1] - d.alarmCount[0]) +
      cmpRow('QC', d.qcPass[0] ? '通过' : '未通过',
             d.qcPass[1] ? '通过' : '未通过', '—');
  });

  function cmpRow(name, va, vb, diff) {
    return '<tr><td>' + name + '</td><td>' + va + '</td><td>' + vb +
      '</td><td>' + diff + '</td></tr>';
  }

  window.CableApp = { sim: sim, renderPanels: renderPanels, refreshHistory: refreshHistory };

  syncInputs();
  renderer.draw(sim);
  renderPanels();
})();
