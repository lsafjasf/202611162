// 确定性伪随机：同一 seed 永远产生同一序列，禁止在模拟内核使用 Math.random/Date。
(function (root) {
  "use strict";

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
    var a = hashSeed(seed) >>> 0;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 独立流：用 “seed:tag” 派生，保证不同用途互不干扰、顺序无关。
  function stream(seed, tag) {
    return mulberry32(String(seed) + ":" + tag);
  }

  var api = { hashSeed: hashSeed, mulberry32: mulberry32, stream: stream };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.RNG = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
