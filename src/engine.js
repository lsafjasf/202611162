/* spatial-audio-lab
 * 音频图引擎：同一套构建逻辑同时服务于实时 AudioContext 与 OfflineAudioContext，
 * 保证“听见的”和“导出的”一致。输出固定 4 声道 [L,R,SL,SR]。
 */
(function (root) {
  'use strict';
  var SF = root.SF || (root.SF = {});

  // 生成指数衰减噪声脉冲响应，时长由墙面反射决定
  function makeImpulse(ctx, wallReflection) {
    var seconds = 0.25 + wallReflection * 1.75;
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    // 确定性伪随机（mulberry32）：保证同一参数两次渲染逐样本一致
    var seed = Math.floor(wallReflection * 1e6) + 1;
    function rnd() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var decay = Math.pow(1 - i / len, 2.2);
        data[i] = (rnd() * 2 - 1) * decay;
      }
    }
    return buf;
  }

  // 方位角 -> 4 声道增益（L 前左, R 前右, SL 环绕左, SR 环绕右）
  function surroundGains(az) {
    var c = Math.cos(az), s = Math.sin(az);
    var front = SF.clamp(c, 0, 1), back = SF.clamp(-c, 0, 1);
    var left = SF.clamp(-s, 0, 1), right = SF.clamp(s, 0, 1);
    var norm = 1 / Math.SQRT2;
    return {
      L: front * (0.25 + left) * norm * 1.414,
      R: front * (0.25 + right) * norm * 1.414,
      SL: back * (0.25 + left) * norm * 1.414,
      SR: back * (0.25 + right) * norm * 1.414
    };
  }
  SF.surroundGains = surroundGains;

  // 模式相关的每声道增益（4 声道布局）
  function modeChannelGains(mode, az, pan) {
    if (mode === 'surround') return surroundGains(az);
    var ep = SF.equalPower(pan);
    if (mode === 'binaural') {
      // 双耳：在立体声基础上加入轻微前后/环绕能量，配合 PannerNode 的 ITD/ILD
      var rear = 0.18 * SF.clamp(-Math.cos(az), 0, 1);
      return { L: ep.left, R: ep.right, SL: ep.left * rear, SR: ep.right * rear };
    }
    return { L: ep.left, R: ep.right, SL: 0, SR: 0 };
  }

  // 构建完整音频图。返回控制器（节点引用、更新、销毁）。
  SF.buildGraph = function (ctx, params, outputMerger) {
    var room = SF.ROOM;
    var nodes = [];
    function keep(n) { nodes.push(n); return n; }

    positionListener(ctx, params);

    var convolver = keep(ctx.createConvolver());
    convolver.buffer = makeImpulse(ctx, params.room.wallReflection);

    // 4 声道母线：每通道一个 gain，便于分析与导出
    var bus = [0, 1, 2, 3].map(function () { return keep(ctx.createGain()); });
    convolver.connect(bus[0]); convolver.connect(bus[1]);
    convolver.connect(bus[2]); convolver.connect(bus[3]);
    bus.forEach(function (g, i) { g.connect(outputMerger, 0, i); });

    var sources = params.sources.map(function (sp) { return buildSource(ctx, sp, params, keep, bus, convolver); });

    return {
      nodes: nodes,
      sources: sources,
      destroy: function () {
        sources.forEach(function (s) {
          try { s.osc.stop(); } catch (e) {}
          try { s.lfo.stop(); } catch (e) {}
        });
        nodes.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
      },
      // 位置/监听点/墙面变化时平滑更新（不重建、不重置声源）
      update: function (nextParams) {
        params = nextParams;
        positionListener(ctx, params);
        sources.forEach(function (s, i) { updateSource(s, params.sources[i], params); });
        try { convolver.buffer = makeImpulse(ctx, params.room.wallReflection); } catch (e) {}
      }
    };
  };

  function buildSource(ctx, sp, params, keep, bus, convolver) {
    var osc = keep(ctx.createOscillator());
    osc.type = sp.waveform;
    osc.frequency.value = sp.freq;

    var lfo = keep(ctx.createOscillator());
    lfo.frequency.value = sp.beat;
    var lfoGain = keep(ctx.createGain());
    lfoGain.gain.value = sp.beatDepth;
    var tremolo = keep(ctx.createGain());
    tremolo.gain.value = 1;
    lfo.connect(lfoGain).connect(tremolo.gain);

    var srcGain = keep(ctx.createGain());
    srcGain.gain.value = sp.gain;
    osc.connect(tremolo).connect(srcGain);

    // 直达声：传播延迟 + 距离衰减，再按模式分配到 4 个声道
    var delay = keep(ctx.createDelay(SF.MAX_DELAY));
    var dryGain = keep(ctx.createGain());
    srcGain.connect(delay).connect(dryGain);

    // 反射声：每面墙一条延迟，汇入共享卷积混响
    var wetSend = keep(ctx.createGain());
    srcGain.connect(wetSend);
    var reflectionDelays = SF.reflectionPaths(sp, SF.ROOM).map(function (p) {
      var d = keep(ctx.createDelay(SF.MAX_DELAY));
      d.delayTime.value = p / SF.SPEED_OF_SOUND;
      wetSend.connect(d);
      return d;
    });
    // 每声源湿声按模式分配到 4 个声道，再进入共享卷积
    var wetOut = [0, 1, 2, 3].map(function () { return keep(ctx.createGain()); });
    wetOut.forEach(function (wo, i) {
      wo.connect(convolver);
      reflectionDelays.forEach(function (d) { d.connect(wo); });
    });

    // 4 声道输出增益
    var outGains = [0, 1, 2, 3].map(function () { return keep(ctx.createGain()); });
    outGains.forEach(function (og, i) { og.connect(bus[i]); });

    var panner = null;
    if (params.mode === 'binaural') {
      panner = keep(ctx.createPanner());
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.connect(outGains[0]);
      panner.connect(outGains[1]);
      dryGain.connect(panner);
    } else {
      dryGain.connect(outGains[0]);
      dryGain.connect(outGains[1]);
      dryGain.connect(outGains[2]);
      dryGain.connect(outGains[3]);
    }

    var ctrl = {
      osc: osc, lfo: lfo, lfoGain: lfoGain, srcGain: srcGain,
      delay: delay, dryGain: dryGain, wetSend: wetSend,
      reflectionDelays: reflectionDelays, wetOut: wetOut,
      outGains: outGains, panner: panner,
      start: function (t) { osc.start(t); lfo.start(t); }
    };
    updateSource(ctrl, sp, params);
    return ctrl;
  }

  function positionListener(ctx, params) {
    var l = ctx.listener;
    if (!l || typeof l.positionX === 'undefined') return;
    var t = ctx.currentTime;
    l.positionX.setValueAtTime(params.listener.x, t);
    l.positionY.setValueAtTime(SF.ROOM.listenerY, t);
    l.positionZ.setValueAtTime(params.listener.z, t);
    // 朝向 -z（房间前方），默认朝向即 -z，这里显式固定
    if (l.forwardX) {
      l.forwardX.setValueAtTime(0, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(-1, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    }
  }

  function updateSource(ctrl, sp, params) {
    var t = ctrl.osc.context.currentTime;
    var tc = 0.03;
    ctrl.osc.frequency.setTargetAtTime(sp.freq, t, tc);
    ctrl.srcGain.gain.setTargetAtTime(sp.gain, t, tc);
    ctrl.lfo.frequency.setTargetAtTime(sp.beat, t, tc);
    ctrl.lfoGain.gain.setTargetAtTime(sp.beatDepth, t, tc);

    var d = SF.dist(sp, params.listener);
    ctrl.delay.delayTime.setTargetAtTime(SF.propagationDelay(d), t, tc);
    ctrl.dryGain.gain.setTargetAtTime(SF.distanceGain(d), t, tc);

    var refl = SF.reflectionPaths(sp, SF.ROOM);
    var wet = 0;
    ctrl.reflectionDelays.forEach(function (dn, i) {
      dn.delayTime.setTargetAtTime(refl[i] / SF.SPEED_OF_SOUND, t, tc);
      wet += SF.reflectionGain(refl[i], params.room.wallReflection);
    });
    ctrl.wetSend.gain.setTargetAtTime(SF.clamp(wet, 0, 0.6), t, tc);

    var pan = SF.clamp((sp.x - params.listener.x) / (SF.ROOM.width / 4), -1, 1);
    var az = SF.azimuth(sp, params.listener);
    var g = modeChannelGains(params.mode, az, pan);
    var vals = [g.L, g.R, g.SL, g.SR];
    ctrl.outGains.forEach(function (og, i) { og.gain.setTargetAtTime(vals[i], t, tc); });
    // 湿声跟随同一声像，避免混响把左右/环绕定位糊掉
    ctrl.wetOut.forEach(function (wo, i) {
      wo.gain.setTargetAtTime(vals[i] * 0.5, t, tc);
    });

    if (ctrl.panner) {
      ctrl.panner.positionX.setValueAtTime(sp.x, t);
      ctrl.panner.positionY.setValueAtTime(SF.ROOM.listenerY, t);
      ctrl.panner.positionZ.setValueAtTime(sp.z, t);
      if (ctrl.panner.orientationX) {
        ctrl.panner.orientationX.setValueAtTime(1, t);
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
