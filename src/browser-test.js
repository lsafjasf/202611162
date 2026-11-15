/* 页内验证：在浏览器中用 OfflineAudioContext 跑真实音频断言。 */
(function (root) {
  'use strict';
  var SF = root.SF;

  function clone(p) { return JSON.parse(JSON.stringify(p)); }
  function peakAt(b, c) { return SF.peakOf(b.getChannelData(c)); }

  function bandLevel(buffer, ch, freq) {
    var x = buffer.getChannelData(ch), w = 2 * Math.PI * freq / buffer.sampleRate;
    var re = 0, im = 0, start = Math.floor(buffer.sampleRate * 0.3);
    for (var n = start; n < x.length; n++) {
      re += x[n] * Math.cos(w * n);
      im -= x[n] * Math.sin(w * n);
    }
    return 2 * Math.sqrt(re * re + im * im) / (x.length - start);
  }
  function lagSeconds(a, b, sr) {
    var best = 0, bestV = -Infinity, maxLag = Math.floor(sr * 0.08);
    for (var lag = 0; lag <= maxLag; lag++) {
      var s = 0;
      for (var n = 0; n + lag < a.length; n += 4) s += a[n] * b[n + lag];
      if (s > bestV) { bestV = s; best = lag; }
    }
    return best / sr;
  }
  function envVariance(buf) {
    var x = buf.getChannelData(0), win = 480, env = [];
    for (var i = 0; i + win < x.length; i += win) {
      var s = 0; for (var j = 0; j < win; j++) s += x[i + j] * x[i + j];
      env.push(Math.sqrt(s / win));
    }
    var m = env.reduce(function (a, b) { return a + b; }, 0) / env.length;
    return env.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / env.length;
  }

  SF.runBrowserSelfTest = function (log) {
    var DUR = 1.5, SR = 48000, passed = 0, failed = 0;
    function check(name, cond, detail) {
      if (cond) { passed++; log('  PASS ' + name, 'pass'); }
      else { failed++; log('  FAIL ' + name + (detail ? ' -> ' + detail : ''), 'fail'); }
    }
    function render(params, stopAt) {
      return SF.renderOffline(root.OfflineAudioContext, params, DUR, SR, stopAt);
    }

    return Promise.resolve().then(function () {
      log('[1] 左右声道：声源左右拖动', 'info');
      var pL = SF.DEFAULT_PARAMS(); pL.mode = 'stereo';
      pL.sources[0].x = 0.5; pL.sources[1].gain = 0; pL.sources[2].gain = 0;
      var pR = clone(pL); pR.sources[0].x = 9.5;
      return Promise.all([render(pL), render(pR)]);
    }).then(function (r) {
      var bL = r[0], bR = r[1];
      var dL = peakAt(bL, 0) - peakAt(bL, 1), dR = peakAt(bR, 0) - peakAt(bR, 1);
      check('左移 L 强于 R', dL > 0.05, 'L-R=' + dL.toFixed(3));
      check('右移 R 强于 L', dR < -0.05, 'L-R=' + dR.toFixed(3));

      log('[2] 频段：频率设置改变频谱', 'info');
      var f1 = SF.DEFAULT_PARAMS(); f1.sources[1].gain = 0; f1.sources[2].gain = 0; f1.sources[0].freq = 220;
      var f2 = clone(f1); f2.sources[0].freq = 440;
      return Promise.all([render(f1), render(f2)]);
    }).then(function (r) {
      var b1 = r[0], b2 = r[1];
      check('220 设置的低频能量更高', bandLevel(b1, 0, 220) > bandLevel(b1, 0, 440) * 1.5);
      check('440 设置的高频能量更高', bandLevel(b2, 0, 440) > bandLevel(b2, 0, 220) * 1.5);

      log('[3] 节拍：tremolo 改变包络', 'info');
      var b0p = SF.DEFAULT_PARAMS(); b0p.sources[1].gain = 0; b0p.sources[2].gain = 0;
      b0p.sources[0].beat = 0; b0p.sources[0].beatDepth = 0;
      var b1p = clone(b0p); b1p.sources[0].beat = 5; b1p.sources[0].beatDepth = 0.8;
      return Promise.all([render(b0p), render(b1p)]);
    }).then(function (r) {
      check('节拍开启后包络方差增大', envVariance(r[1]) > envVariance(r[0]) * 2);

      log('[4] 导出检查：静音 / 削波 / 声道缺失', 'info');
      var ok = SF.DEFAULT_PARAMS(); ok.mode = 'surround';
      var silent = clone(ok); silent.sources.forEach(function (s) { s.gain = 0; });
      var clip = clone(ok); clip.sources.forEach(function (s) { s.gain = 2.5; });
      return Promise.all([render(ok), render(silent), render(clip)]);
    }).then(function (r) {
      check('正常参数通过检查', SF.checkBuffer(r[0], 'surround').ok);
      check('静音被检出', !SF.checkBuffer(r[1], 'surround').ok);
      check('削波被检出', SF.checkBuffer(r[2], 'surround').problems.some(function (p) {
        return p.type === 'clipping';
      }));

      log('[5] 保存 -> 重载 -> 再导出一致性', 'info');
      var a = SF.DEFAULT_PARAMS(); a.mode = 'surround'; a.sources[0].freq = 330;
      var json = JSON.stringify(a);
      var b = JSON.parse(json);
      check('重载参数逐字段一致', json === JSON.stringify(b));
      return Promise.all([render(a), render(b)]);
    }).then(function (r) {
      var bA = r[0], bB = r[1];
      check('导出时长一致', bA.length === bB.length);
      var maxDiff = 0;
      [0, 1, 2, 3].forEach(function (c) {
        maxDiff = Math.max(maxDiff, Math.abs(peakAt(bA, c) - peakAt(bB, c)));
      });
      check('四声道峰值一致', maxDiff < 1e-6, 'maxDiff=' + maxDiff.toExponential(2));
      check('关键音高一致', Math.abs(bandLevel(bA, 0, 330) - bandLevel(bB, 0, 330)) < 1e-6);
      check('延迟一致（零互相关偏移）', lagSeconds(bA.getChannelData(0), bB.getChannelData(0), SR) === 0);
      log('结果：' + passed + ' 通过, ' + failed + ' 失败', failed ? 'fail' : 'pass');
      return { passed: passed, failed: failed };
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
