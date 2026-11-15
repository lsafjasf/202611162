/* 确定性伪随机数：所有模拟随机量都经由此模块，保证同 seed 完全复现。 */
(function (global) {
  'use strict';

  function hashSeed(str) {
    var h = 1779033703 ^ String(str).length;
    for (var i = 0; i < String(str).length; i++) {
      h = Math.imul(h ^ String(str).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(seed) {
    var a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) {
    this.seed = seed;
    this.a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  }
  Rng.prototype.next = function () {
    this.a |= 0;
    this.a = (this.a + 0x6d2b79f5) | 0;
    var t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.float = function (min, max) {
    return min + this.next() * (max - min);
  };
  Rng.prototype.int = function (min, max) {
    return Math.floor(this.float(min, max + 1));
  };
  Rng.prototype.chance = function (p) {
    return this.next() < p;
  };
  Rng.prototype.pick = function (arr) {
    return arr[Math.floor(this.next() * arr.length)];
  };
  Rng.prototype.getState = function () { return this.a >>> 0; };
  Rng.prototype.setState = function (a) { this.a = a >>> 0; };

  var api = { hashSeed: hashSeed, mulberry32: mulberry32, Rng: Rng };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RNG = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
