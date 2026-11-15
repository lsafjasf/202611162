/* 世界生成：地图、任务点、障碍物全部来自同一个固定 seed，结果可序列化与哈希。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rng.js'));
  } else {
    root.MarshWorld = factory(root.MarshRng);
  }
})(typeof self !== 'undefined' ? self : this, function (RngMod) {
  'use strict';

  var COLS = 40;
  var ROWS = 28;
  var TILE = 32;

  var DEPTH = {
    LAND: -1,
    MUDFLAT: 0.12,
    SHALLOW: 0.42,
    DEEP: 0.9,
    TIDE: 0.62
  };

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  function valueNoise(rng) {
    var gx = 6;
    var gy = 5;
    var grid = [];
    for (var i = 0; i < gx * gy; i++) grid.push(rng.next());
    function smooth(t) {
      return t * t * (3 - 2 * t);
    }
    return function (x, y) {
      var fx = (x / (COLS - 1)) * (gx - 1);
      var fy = (y / (ROWS - 1)) * (gy - 1);
      var x0 = Math.floor(fx);
      var y0 = Math.floor(fy);
      var x1 = Math.min(x0 + 1, gx - 1);
      var y1 = Math.min(y0 + 1, gy - 1);
      var tx = smooth(fx - x0);
      var ty = smooth(fy - y0);
      var a = grid[y0 * gx + x0];
      var b = grid[y0 * gx + x1];
      var c = grid[y1 * gx + x0];
      var d = grid[y1 * gx + x1];
      var top = a + (b - a) * tx;
      var bot = c + (d - c) * tx;
      return top + (bot - top) * ty;
    };
  }

  function makeTiles() {
    var tiles = [];
    for (var y = 0; y < ROWS; y++) {
      var row = [];
      for (var x = 0; x < COLS; x++) {
        row.push({ depth: DEPTH.LAND, reed: false, grass: false, decor: 0, tide: false, path: 0 });
      }
      tiles.push(row);
    }
    return tiles;
  }

  function generateWorld(seedText) {
    var rng = new RngMod.Rng(seedText, 'world');
    var noise = valueNoise(new RngMod.Rng(seedText, 'noise'));
    var decorRng = new RngMod.Rng(seedText, 'decor');
    var tiles = makeTiles();
    var x;
    var y;

    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        var n = noise(x, y);
        var edge = Math.min(x, y, COLS - 1 - x, ROWS - 1 - y) < 2;
        if (edge || n < 0.32) {
          tiles[y][x].depth = DEPTH.LAND;
        } else if (n < 0.45) {
          tiles[y][x].depth = DEPTH.MUDFLAT;
        } else if (n < 0.68) {
          tiles[y][x].depth = DEPTH.SHALLOW;
        } else {
          tiles[y][x].depth = DEPTH.DEEP;
        }
        tiles[y][x].decor = Math.floor(decorRng.next() * 1000);
      }
    }

    var dock = { x: 3, y: 14 };
    var stations = [
      { id: 1, x: 12, y: 6 },
      { id: 2, x: 25, y: 18 },
      { id: 3, x: 34, y: 8 }
    ];
    var checkpoints = [
      { id: 1, x: 8, y: 10 },
      { id: 2, x: 20, y: 14 },
      { id: 3, x: 30, y: 12 }
    ];

    var out1 = buildPath(rng, [dock, checkpoints[0], stations[0]], 2);
    var out2 = buildPath(rng, [stations[0], checkpoints[1], stations[1]], 3);
    var out3 = buildPath(rng, [stations[1], checkpoints[2], stations[2]], 3);
    var back = buildPath(rng, [stations[2], { x: 28, y: 20 }, { x: 15, y: 22 }, dock], 4);

    carve(tiles, out1, DEPTH.DEEP, false, 1);
    carve(tiles, out2, DEPTH.DEEP, false, 1);
    carve(tiles, out3, DEPTH.TIDE, true, 1);
    carve(tiles, back, DEPTH.TIDE, true, 2);

    stamp(tiles, dock.x, dock.y, 1, function (t) {
      t.depth = DEPTH.DEEP;
      t.tide = false;
      t.path = Math.max(t.path, 3);
    });
    stations.forEach(function (s) {
      stamp(tiles, s.x, s.y, 1, function (t) {
        t.depth = DEPTH.DEEP;
        t.tide = false;
        t.path = Math.max(t.path, 3);
      });
    });
    checkpoints.forEach(function (c) {
      stamp(tiles, c.x, c.y, 1, function (t) {
        t.depth = DEPTH.DEEP;
        t.tide = false;
        t.path = Math.max(t.path, 3);
      });
    });

    placeClusters(rng, tiles, 'grass', 26, 3, 0.35);
    placeClusters(rng, tiles, 'reed', 34, 2, 0.3);

    var safeRoute = uniquePoints(out1.concat(out2, out3, back));
    var layoutHash = computeHash(tiles, dock, stations, checkpoints);

    return {
      seed: String(seedText),
      cols: COLS,
      rows: ROWS,
      tile: TILE,
      tiles: tiles,
      dock: dock,
      stations: stations,
      checkpoints: checkpoints,
      safeRoute: safeRoute,
      layoutHash: layoutHash
    };
  }
    return {
      COLS: COLS,
      ROWS: ROWS,
      TILE: TILE,
      DEPTH: DEPTH,
      hashString: hashString,
      inBounds: inBounds,
      valueNoise: valueNoise,
      makeTiles: makeTiles,
      generateWorld: generateWorld
    };

  function buildPath(rng, points, jitter) {
    var route = [];
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      var x = a.x;
      var y = a.y;
      route.push({ x: x, y: y });
      var guard = 0;
      while ((x !== b.x || y !== b.y) && guard < 200) {
        guard++;
        var choices = [];
        if (x < b.x) choices.push([1, 0]);
        if (x > b.x) choices.push([-1, 0]);
        if (y < b.y) choices.push([0, 1]);
        if (y > b.y) choices.push([0, -1]);
        var step = rng.pick(choices);
        var nx = x + step[0];
        var ny = y + step[1];
        if (jitter > 0 && rng.chance(0.28)) {
          var jy = rng.int(-jitter, jitter);
          ny = Math.max(2, Math.min(ROWS - 3, ny + jy));
        }
        x = Math.max(1, Math.min(COLS - 2, nx));
        y = Math.max(1, Math.min(ROWS - 2, ny));
        route.push({ x: x, y: y });
      }
    }
    route.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
    return uniquePoints(route);
  }

  function carve(tiles, pathPoints, depth, tide, radius) {
    pathPoints.forEach(function (p) {
      stamp(tiles, p.x, p.y, radius, function (t) {
        t.depth = Math.max(t.depth, depth);
        if (tide) t.tide = true;
        t.path = Math.max(t.path, 2);
      });
    });
  }

  function stamp(tiles, cx, cy, radius, apply) {
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var x = cx + dx;
        var y = cy + dy;
        if (inBounds(x, y) && Math.abs(dx) + Math.abs(dy) <= radius + 1) {
          apply(tiles[y][x]);
        }
      }
    }
  }

  function placeClusters(rng, tiles, kind, clusters, size, spread) {
    var placed = 0;
    var guard = 0;
    while (placed < clusters && guard < 400) {
      guard++;
      var cx = rng.int(3, COLS - 4);
      var cy = rng.int(3, ROWS - 4);
      var center = tiles[cy][cx];
      if (center.path > 0 || center.depth < DEPTH.SHALLOW) continue;
      var cells = rng.int(size, size + 3);
      var made = 0;
      for (var i = 0; i < cells; i++) {
        var x = cx + rng.int(-size, size);
        var y = cy + rng.int(-size, size);
        if (!inBounds(x, y)) continue;
        var t = tiles[y][x];
        if (t.path > 0 || t.depth < DEPTH.SHALLOW) continue;
        if (rng.chance(spread) || made === 0) {
          t[kind] = true;
          made++;
        }
      }
      if (made > 0) placed++;
    }
  }

  function uniquePoints(points) {
    var out = [];
    var seen = {};
    points.forEach(function (p) {
      var key = p.x + ',' + p.y;
      if (!seen[key]) {
        seen[key] = true;
        out.push({ x: p.x, y: p.y });
      }
    });
    return out;
  }

  function computeHash(tiles, dock, stations, checkpoints) {
    var parts = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var t = tiles[y][x];
        parts.push([t.depth, t.reed ? 1 : 0, t.grass ? 1 : 0, t.tide ? 1 : 0].join(''));
      }
    }
    var obj = [
      JSON.stringify(parts),
      JSON.stringify(dock),
      JSON.stringify(stations),
      JSON.stringify(checkpoints)
    ].join('|');
    return hashString(obj);
  }

  return {
    COLS: COLS,
    ROWS: ROWS,
    TILE: TILE,
    DEPTH: DEPTH,
    hashString: hashString,
    inBounds: inBounds,
    valueNoise: valueNoise,
    makeTiles: makeTiles,
    generateWorld: generateWorld
  };
});
