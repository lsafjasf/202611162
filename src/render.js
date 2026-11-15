/* spatial-audio-lab
 * 离线渲染、WAV 编码与导出前检查。实时与导出共用 buildGraph。
 */
(function (root) {
  'use strict';
  var SF = root.SF || (root.SF = {});

  // 用 OfflineAudioContext 渲染 4 声道音频
  SF.renderOffline = function (OfflineCtx, params, durationSec, sampleRate, stopAt) {
    var sr = sampleRate || 48000;
    var frames = Math.max(1, Math.round(durationSec * sr));
    var ctx = new OfflineCtx(4, frames, sr);
    var merger = ctx.createChannelMerger(4);
    merger.channelInterpretation = 'discrete';
    merger.connect(ctx.destination);
    ctx.destination.channelCount = 4;
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';

    var graph = SF.buildGraph(ctx, params, merger);
    graph.sources.forEach(function (s) {
      s.start(0);
      if (stopAt != null) {
        s.osc.stop(stopAt);
        s.lfo.stop(stopAt);
      }
    });
    return ctx.startRendering().then(function (buffer) {
      graph.destroy();
      return buffer;
    });
  };

  // 16-bit PCM 多声道 WAV
  SF.encodeWav = function (buffer) {
    var numCh = buffer.numberOfChannels;
    var sr = buffer.sampleRate;
    var frames = buffer.length;
    var bytesPerSample = 2;
    var blockAlign = numCh * bytesPerSample;
    var dataSize = frames * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var dv = new DataView(ab);
    function ws(off, str) { for (var i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i)); }
    ws(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
    dv.setUint16(22, numCh, true); dv.setUint32(24, sr, true);
    dv.setUint32(28, sr * blockAlign, true); dv.setUint16(32, blockAlign, true);
    dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, dataSize, true);

    var chans = [];
    for (var c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    var off = 44;
    for (var f = 0; f < frames; f++) {
      for (var ch2 = 0; ch2 < numCh; ch2++) {
        var v = Math.max(-1, Math.min(1, chans[ch2][f]));
        dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        off += 2;
      }
    }
    return ab;
  };

  function peakOf(ch) {
    var p = 0;
    for (var i = 0; i < ch.length; i++) { var a = Math.abs(ch[i]); if (a > p) p = a; }
    return p;
  }

  function rmsOf(ch) {
    var s = 0;
    for (var i = 0; i < ch.length; i++) s += ch[i] * ch[i];
    return Math.sqrt(s / ch.length);
  }

  // 导出前检查：静音、削波、声道缺失
  SF.activeChannelsForMode = function (mode) {
    return mode === 'surround' ? [0, 1, 2, 3] : [0, 1];
  };

  SF.checkBuffer = function (buffer, mode) {
    var problems = [];
    var peaks = [];
    var active = SF.activeChannelsForMode(mode || 'surround');
    if (buffer.numberOfChannels < active.length) {
      problems.push({ type: 'channel-missing', expected: active.length,
                      actual: buffer.numberOfChannels });
    }
    for (var c = 0; c < buffer.numberOfChannels; c++) {
      var ch = buffer.getChannelData(c);
      var peak = peakOf(ch), rms = rmsOf(ch);
      peaks.push({ channel: c, peak: peak, rms: rms });
      if (active.indexOf(c) >= 0 && rms < 1e-5) {
        problems.push({ type: 'silent-or-missing', channel: c, rms: rms });
      }
      var clipped = 0;
      for (var i = 0; i < ch.length; i++) if (Math.abs(ch[i]) >= 0.999) clipped++;
      if (clipped > 0) problems.push({ type: 'clipping', channel: c, samples: clipped });
    }
    return { ok: problems.length === 0, problems: problems, peaks: peaks,
             duration: buffer.length / buffer.sampleRate };
  };

  SF.peakOf = peakOf;
  SF.rmsOf = rmsOf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
