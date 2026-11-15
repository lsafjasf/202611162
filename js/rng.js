/*
 * 确定性随机数工具：同 seed 下所有随机序列完全一致。
 * 模拟内核只允许通过 mulberry32 / hashSeed 获取随机数，
 * 并且所有需要随机的量（天气、鸟群、初始资源、偷猎事件等）
 * 都在初始化阶段按 tick 预生成，运行期逐小时顺序消费，
 * 因此状态随时间连续演化，不会出现每帧随机跳变。
 */
(function (root) {
  'use strict';

  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed, salt) {
    return mulberry32(hashSeed(seed + ':' + salt));
  }

  function intIn(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  var api = { hashSeed: hashSeed, mulberry32: mulberry32, makeRng: makeRng, intIn: intIn, pick: pick };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RNG = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
