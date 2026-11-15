/* 界面与实时音频控制。 */
(function () {
  'use strict';
  var SF = window.SF;
  var params = SF.DEFAULT_PARAMS();
  var selected = 0;

  var canvas = document.getElementById('room');
  var ctx2d = canvas.getContext('2d');
  var specCanvas = document.getElementById('spec-canvas') || document.getElementById('spectrum');
  var specCtx = specCanvas.getContext('2d');

  var audioCtx = null, graph = null, merger = null;
  var analysers = [], meterRaf = null, running = false, startAt = 0, pauseAt = 0;
  var COLORS = { A: '#ff6b6b', B: '#ffd166', C: '#4aa8ff', L: '#57d98c' };

  function roomToCanvas(x, z) {
    return { x: 40 + (x / SF.ROOM.width) * (canvas.width - 80),
             y: 30 + (z / SF.ROOM.depth) * (canvas.height - 70) };
  }
  function canvasToRoom(px, py) {
    return { x: SF.clamp((px - 40) / (canvas.width - 80) * SF.ROOM.width, 0.2, SF.ROOM.width - 0.2),
             z: SF.clamp((py - 30) / (canvas.height - 70) * SF.ROOM.depth, 0.2, SF.ROOM.depth - 0.2) };
  }

  function drawRoom() {
    var w = canvas.width, h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.strokeStyle = '#27303c'; ctx2d.lineWidth = 2;
    ctx2d.strokeRect(40, 30, w - 80, h - 70);
    ctx2d.fillStyle = '#8b98a7'; ctx2d.font = '11px sans-serif';
    ctx2d.fillText('前墙 z=0', 44, 24);
    ctx2d.fillText('后墙 z=' + SF.ROOM.depth, 44, h - 14);
    ctx2d.fillText('L', w - 60, 24); ctx2d.fillText('R', 46, 24);

    // 监听点到各声源连线
    params.sources.forEach(function (sp) {
      var a = roomToCanvas(sp.x, sp.z), b = roomToCanvas(params.listener.x, params.listener.z);
      ctx2d.strokeStyle = 'rgba(139,152,167,0.35)'; ctx2d.setLineDash([4, 4]);
      ctx2d.beginPath(); ctx2d.moveTo(a.x, a.y); ctx2d.lineTo(b.x, b.y); ctx2d.stroke();
      ctx2d.setLineDash([]);
    });
    function dot(x, z, label, color, r) {
      var p = roomToCanvas(x, z);
      ctx2d.beginPath(); ctx2d.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx2d.fillStyle = color; ctx2d.fill();
      ctx2d.fillStyle = '#0e1116'; ctx2d.font = 'bold 11px sans-serif';
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      ctx2d.fillText(label, p.x, p.y);
      ctx2d.textAlign = 'start'; ctx2d.textBaseline = 'alphabetic';
    }
    params.sources.forEach(function (sp, i) {
      dot(sp.x, sp.z, sp.id, COLORS[sp.id], i === selected ? 15 : 12);
    });
    dot(params.listener.x, params.listener.z, 'L', COLORS.L, 13);
  }

  // ---- 音频图生命周期 ----
  function ensureContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    merger = audioCtx.createChannelMerger(4);
    merger.channelInterpretation = 'discrete';
    merger.connect(audioCtx.destination);
    // 每声道分析器
    var splitter = audioCtx.createChannelSplitter(4);
    merger.connect(splitter);
    analysers = [0, 1, 2, 3].map(function (c) {
      var an = audioCtx.createAnalyser();
      an.fftSize = 1024;
      splitter.connect(an, c);
      return an;
    });
    graph = SF.buildGraph(audioCtx, params, merger);
    graph.sources.forEach(function (s) { s.start(audioCtx.currentTime); });
  }

  function applyParams() { if (graph) graph.update(params); }

  function setStatus(t) { document.getElementById('status').textContent = t; }

  function play() {
    ensureContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!running) { running = true; startMeters(); }
    setStatus('播放中 · ' + params.mode);
  }
  function pause() {
    if (audioCtx && audioCtx.state === 'running') { audioCtx.suspend(); setStatus('已暂停'); }
  }
  function replay() {
    if (!audioCtx) { play(); return; }
    teardownGraph();
    graph = SF.buildGraph(audioCtx, params, merger);
    graph.sources.forEach(function (s) { s.start(audioCtx.currentTime); });
    audioCtx.resume(); running = true; startMeters();
    setStatus('重播中 · ' + params.mode);
  }
  function teardownGraph() {
    if (graph) { graph.destroy(); graph = null; }
  }
  function resetAll() {
    params = SF.DEFAULT_PARAMS();
    selected = 0;
    if (graph) { teardownGraph(); graph = SF.buildGraph(audioCtx, params, merger);
      graph.sources.forEach(function (s) { s.start(audioCtx.currentTime); }); }
    document.querySelectorAll('#mode-group button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === params.mode);
    });
    document.getElementById('mode-badge').textContent = params.mode;
    syncControls(); drawRoom(); setStatus('参数已重置');
  }

  // 模式切换：只更新模式参数，绝不动声源坐标
  function setMode(mode) {
    params.mode = mode;
    document.querySelectorAll('#mode-group button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.getElementById('mode-badge').textContent = mode;
    applyParams();
    setStatus('模式：' + mode + '（声源位置保持不变）');
  }

  window.SF_DEBUG = { get params() { return params; } };

  // ---- Canvas 拖拽 ----
  var drag = null;
  function hitTest(px, py) {
    var hit = null;
    params.sources.forEach(function (sp, i) {
      var p = roomToCanvas(sp.x, sp.z);
      if (Math.hypot(px - p.x, py - p.y) < 18) hit = { kind: 'source', index: i };
    });
    if (!hit) {
      var lp = roomToCanvas(params.listener.x, params.listener.z);
      if (Math.hypot(px - lp.x, py - lp.y) < 18) hit = { kind: 'listener' };
    }
    return hit;
  }
  canvas.addEventListener('pointerdown', function (e) {
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) * (canvas.width / rect.width);
    var py = (e.clientY - rect.top) * (canvas.height / rect.height);
    drag = hitTest(px, py);
    if (drag && drag.kind === 'source') selected = drag.index;
    syncControls(); drawRoom();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var rect = canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) * (canvas.width / rect.width);
    var py = (e.clientY - rect.top) * (canvas.height / rect.height);
    var room = canvasToRoom(px, py);
    if (drag.kind === 'source') { params.sources[drag.index].x = room.x; params.sources[drag.index].z = room.z; }
    else { params.listener.x = room.x; params.listener.z = room.z; }
    applyParams(); drawRoom();
  });
  window.addEventListener('pointerup', function () { drag = null; });

  // ---- 控件同步 ----
  var tabsEl = document.getElementById('src-tabs');
  SF.SOURCE_DEFAULTS.forEach(function (d, i) {
    var b = document.createElement('button');
    b.className = 'btn'; b.textContent = '声源 ' + d.id;
    b.addEventListener('click', function () { selected = i; syncControls(); drawRoom(); });
    tabsEl.appendChild(b);
  });
  function bindRange(id, key, vid, fmt) {
    var el = document.getElementById(id);
    el.addEventListener('input', function () {
      var v = parseFloat(el.value);
      var sp = params.sources[selected];
      if (key === 'beat') sp.beat = v; else if (key === 'beatDepth') sp.beatDepth = v;
      else sp[key] = v;
      document.getElementById(vid).textContent = fmt(v);
      applyParams();
    });
  }
  bindRange('p-freq', 'freq', 'p-freq-v', function (v) { return v.toFixed(0) + ' Hz'; });
  bindRange('p-gain', 'gain', 'p-gain-v', function (v) { return v.toFixed(2); });
  bindRange('p-beat', 'beat', 'p-beat-v', function (v) { return v.toFixed(1); });
  bindRange('p-depth', 'beatDepth', 'p-depth-v', function (v) { return v.toFixed(2); });
  document.getElementById('p-wave').addEventListener('change', function (e) {
    params.sources[selected].waveform = e.target.value; applyParams();
  });
  document.getElementById('refl').addEventListener('input', function (e) {
    params.room.wallReflection = parseFloat(e.target.value);
    document.getElementById('refl-val').textContent = e.target.value;
    applyParams();
  });

  function syncControls() {
    var sp = params.sources[selected];
    document.getElementById('p-freq').value = sp.freq;
    document.getElementById('p-freq-v').textContent = sp.freq.toFixed(0) + ' Hz';
    document.getElementById('p-gain').value = sp.gain;
    document.getElementById('p-gain-v').textContent = sp.gain.toFixed(2);
    document.getElementById('p-beat').value = sp.beat;
    document.getElementById('p-beat-v').textContent = sp.beat.toFixed(1);
    document.getElementById('p-depth').value = sp.beatDepth;
    document.getElementById('p-depth-v').textContent = sp.beatDepth.toFixed(2);
    document.getElementById('p-wave').value = sp.waveform;
    document.getElementById('refl').value = params.room.wallReflection;
    document.getElementById('refl-val').textContent = params.room.wallReflection.toFixed(2);
    Array.prototype.forEach.call(tabsEl.children, function (b, i) {
      b.classList.toggle('active', i === selected);
    });
  }

  // ---- 仪表 ----
  var CH_NAMES = ['L 前左', 'R 前右', 'SL 环绕左', 'SR 环绕右'];
  function startMeters() {
    if (meterRaf) return;
    var bodies = [0, 1, 2, 3].map(function () { return []; });
    var meterBody = document.getElementById('meter-body');
    meterBody.innerHTML = CH_NAMES.map(function (n, i) {
      return '<tr><td>' + n + '</td><td id="pk' + i + '">-</td><td id="rms' + i + '">-</td>' +
             '<td><div class="meter-bar"><div class="meter-fill" id="mf' + i + '"></div></div></td></tr>';
    }).join('');
    var freqData;
    function frame() {
      meterRaf = requestAnimationFrame(frame);
      analysers.forEach(function (an, i) {
        var td = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(td);
        var pk = SF.peakOf(td), rms = SF.rmsOf(td);
        document.getElementById('pk' + i).textContent = pk.toFixed(3);
        document.getElementById('rms' + i).textContent = rms.toFixed(3);
        document.getElementById('mf' + i).style.width = Math.min(100, pk * 100) + '%';
      });
      // 频谱（取前两声道的第一个分析器）
      var an0 = analysers[0];
      if (!freqData || freqData.length !== an0.frequencyBinCount) freqData = new Uint8Array(an0.frequencyBinCount);
      an0.getByteFrequencyData(freqData);
      drawSpectrum(freqData, an0.context.sampleRate);
      updateParamTable();
    }
    frame();
  }
  function drawSpectrum(data, sr) {
    var w = specCanvas.width, h = specCanvas.height;
    specCtx.clearRect(0, 0, w, h);
    specCtx.fillStyle = '#0a0d12'; specCtx.fillRect(0, 0, w, h);
    var bins = data.length, maxF = 2000;
    var maxBin = Math.min(bins, Math.floor(maxF / (sr / 2) * bins));
    specCtx.fillStyle = '#4aa8ff';
    for (var i = 1; i < maxBin; i++) {
      var x = (i / maxBin) * w, bh = (data[i] / 255) * h;
      specCtx.fillRect(x, h - bh, Math.max(1, w / maxBin - 1), bh);
    }
    specCtx.fillStyle = '#8b98a7'; specCtx.font = '10px sans-serif';
    specCtx.fillText('0', 4, h - 4); specCtx.fillText('1k', w / 2 - 8, h - 4); specCtx.fillText('2k Hz', w - 38, h - 4);
  }
  function updateParamTable() {
    var html = params.sources.map(function (sp) {
      var d = SF.dist(sp, params.listener);
      return '<tr><td style="color:' + COLORS[sp.id] + '">' + sp.id + '</td><td>' + d.toFixed(2) +
        '</td><td>' + (SF.propagationDelay(d) * 1000).toFixed(1) +
        '</td><td>' + SF.distanceGain(d).toFixed(3) +
        '</td><td>' + sp.freq.toFixed(0) + '</td><td>' + sp.beat.toFixed(1) + '</td></tr>';
    }).join('');
    document.getElementById('param-body').innerHTML = html;
  }

  // ---- 导出与参数文件 ----
  function download(name, blobOrText, isText) {
    var blob = isText ? new Blob([blobOrText], { type: 'application/json' }) : blobOrText;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportStatus(msg, bad) {
    var el = document.getElementById('export-status');
    el.textContent = msg; el.style.color = bad ? 'var(--bad)' : 'var(--ok)';
  }
  document.getElementById('btn-export-wav').addEventListener('click', function () {
    var dur = parseFloat(document.getElementById('export-dur').value) || 3;
    exportStatus('离线渲染中…', false);
    SF.renderOffline(window.OfflineAudioContext, params, dur, (audioCtx ? audioCtx.sampleRate : 48000))
      .then(function (buffer) {
        var rep = SF.checkBuffer(buffer, params.mode);
        if (!rep.ok) {
          exportStatus('导出中止：' + rep.problems.map(function (p) {
            return p.type + '(ch' + p.channel + ')';
          }).join('; '), true);
          return;
        }
        var wav = SF.encodeWav(buffer);
        download('spatial-' + params.mode + '-' + dur + 's.wav', new Blob([wav], { type: 'audio/wav' }));
        exportStatus('已导出 WAV：' + buffer.numberOfChannels + ' 声道, ' +
          rep.duration.toFixed(2) + 's, 峰值 ' + rep.peaks.map(function (p) { return p.peak.toFixed(2); }).join('/'), false);
      });
  });
  document.getElementById('btn-save-json').addEventListener('click', function () {
    download('spatial-params.json', JSON.stringify(params, null, 2), true);
    exportStatus('参数 JSON 已保存', false);
  });
  document.getElementById('file-json').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var loaded = JSON.parse(reader.result);
        if (!loaded.sources || loaded.sources.length !== 3) throw new Error('参数结构不合法');
        params = loaded;
        if (graph) { teardownGraph(); graph = SF.buildGraph(audioCtx, params, merger);
          graph.sources.forEach(function (s) { s.start(audioCtx.currentTime); }); }
        setMode(params.mode); syncControls(); drawRoom();
        exportStatus('已载入参数（' + loaded.sources.length + ' 声源, 模式 ' + loaded.mode + '）', false);
      } catch (err) { exportStatus('载入失败：' + err.message, true); }
    };
    reader.readAsText(file);
  });

  // ---- 顶部按钮与自测 ----
  document.getElementById('btn-play').addEventListener('click', play);
  document.getElementById('btn-pause').addEventListener('click', pause);
  document.getElementById('btn-replay').addEventListener('click', replay);
  document.getElementById('btn-reset').addEventListener('click', resetAll);
  document.querySelectorAll('#mode-group button').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.mode); });
  });
  document.getElementById('btn-selftest').addEventListener('click', function () {
    var out = document.getElementById('test-out');
    out.textContent = '';
    function log(msg, cls) {
      var span = document.createElement('div');
      span.className = cls || ''; span.textContent = msg; out.appendChild(span);
    }
    SF.runBrowserSelfTest(log);
  });

  syncControls(); drawRoom();
  window.SF_UI = { play: play, pause: pause, replay: replay, resetAll: resetAll,
    setMode: setMode, params: function () { return params; } };
})();
