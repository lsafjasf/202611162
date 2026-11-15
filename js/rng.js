/* 确定性随机数模块：固定种子下所有序列完全一致，浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MarshRng = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seedText, salt) {
    var seed = hashSeed(String(seedText) + ':' + String(salt == null ? '' : salt));
    this._next = mulberry32(seed);
  }

  Rng.prototype.next = function () {
    return this._next();
  };

  Rng.prototype.int = function (min, max) {
    return min + Math.floor(this._next() * (max - min + 1));
  };

  Rng.prototype.float = function (min, max) {
    return min + this._next() * (max - min);
  };

  Rng.prototype.pick = function (arr) {
    return arr[Math.floor(this._next() * arr.length)];
  };

  Rng.prototype.chance = function (p) {
    return this._next() < p;
  };

  return { hashSeed: hashSeed, mulberry32: mulberry32, Rng: Rng };
});
