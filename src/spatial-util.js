/* spatial-audio-lab
 * 纯函数工具：距离衰减、传播延迟、声像、房间反射混响。
 * 浏览器与 Node 共用，挂到全局 SF 命名空间。
 */
(function (root) {
  'use strict';
  var SF = root.SF || (root.SF = {});

  SF.ROOM = { width: 10, depth: 6, height: 2.6, listenerY: 1.2 };
  SF.SPEED_OF_SOUND = 343; // m/s
  SF.MAX_DELAY = 1.0; // DelayNode 上限秒

  SF.SOURCE_DEFAULTS = [
    { id: 'A', x: 1.5, z: 1.2, freq: 220, waveform: 'sine',     gain: 0.32, beat: 0,   beatDepth: 0 },
    { id: 'B', x: 5.0, z: 4.8, freq: 440, waveform: 'triangle', gain: 0.26, beat: 3,   beatDepth: 0.6 },
    { id: 'C', x: 8.5, z: 1.5, freq: 660, waveform: 'sawtooth', gain: 0.20, beat: 0,   beatDepth: 0 }
  ];

  SF.MODES = ['stereo', 'binaural', 'surround'];

  SF.DEFAULT_PARAMS = function () {
    return {
      version: 1,
      room: { wallReflection: 0.35 },
      listener: { x: 5, z: 3 },
      mode: 'stereo',
      sources: SF.SOURCE_DEFAULTS.map(function (s) { return Object.assign({}, s); })
    };
  };

  function dist(a, b) {
    var dx = a.x - b.x;
    var dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // 距离 -> 线性增益（1m 参考距离 + 1/r 衰减，限制范围保证可测且不爆炸）
  SF.distanceGain = function (distance) {
    var d = Math.max(0.2, distance);
    return Math.min(1, 1 / (1 + 0.35 * (d - 1)));
  };

  SF.propagationDelay = function (distance) {
    return Math.min(SF.MAX_DELAY, distance / SF.SPEED_OF_SOUND);
  };

  // 基于四面墙的镜像声源：返回每条反射路径长度
  SF.reflectionPaths = function (src, room) {
    return [
      src.x + src.x,                       // 左墙 x=0
      (room.width - src.x) * 2,            // 右墙
      src.z + src.z,                       // 前墙 z=0
      (room.depth - src.z) * 2             // 后墙
    ];
  };

  // 反射能量：墙面反射系数 * 随路径长度衰减
  SF.reflectionGain = function (pathLength, wallReflection) {
    return wallReflection * Math.max(0, 1 - pathLength / 24);
  };

  // 等功率声像（-1 全左, +1 全右）
  SF.equalPower = function (pan) {
    var theta = (SF.clamp(pan, -1, 1) + 1) * Math.PI * 0.25; // [0, pi/2]
    return { left: Math.cos(theta), right: Math.sin(theta) };
  };

  // 声源相对监听点的方位角（弧度，前方为 -z）
  SF.azimuth = function (src, listener) {
    var dx = src.x - listener.x;
    var dz = src.z - listener.z;
    return Math.atan2(dx, -dz);
  };

  SF.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  SF.dist = dist;

  if (typeof module !== 'undefined' && module.exports) module.exports = SF;
})(typeof globalThis !== 'undefined' ? globalThis : this);
