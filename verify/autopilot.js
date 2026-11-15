/* 确定性自动航行器：BFS 寻路 + 限速靠站，固定步长下复现胜利与失败。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/game.js'), require('../js/world.js'));
  } else {
    root.MarshAutopilot = factory(root.MarshGame, root.MarshWorld);
  }
})(typeof self !== 'undefined' ? self : this, function (Game, World) {
  'use strict';

  var STEP = Game.STEP;

  function neutral() {
    return { up: false, down: false, left: false, right: false, action: false };
  }

  function angleDiff(a, b) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function safeAt(world, tx, ty, time) {
    if (!World.inBounds(tx, ty)) return false;
    return Game.effectiveDepth(world.tiles[ty][tx], time) >= Game.DRAFT;
  }

  function bfs(world, start, goalTx, goalTy, timeNow) {
    var sx = Math.floor(start.x);
    var sy = Math.floor(start.y);
    var key = function (x, y) { return y * world.cols + x; };
    var queue = [[sx, sy]];
    var prev = {};
    prev[key(sx, sy)] = null;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (cur[0] === goalTx && cur[1] === goalTy) break;
      var estTime = timeNow + head * STEP * 8;
      for (var i = 0; i < 4; i++) {
        var nx = cur[0] + dirs[i][0];
        var ny = cur[1] + dirs[i][1];
        var k = key(nx, ny);
        if (k in prev) continue;
        if (!safeAt(world, nx, ny, estTime)) continue;
        prev[k] = cur;
        queue.push([nx, ny]);
      }
    }
    var goalKey = key(goalTx, goalTy);
    if (!(goalKey in prev)) return null;
    var path = [];
    var node = [goalTx, goalTy];
    while (node) {
      path.push(node);
      node = prev[key(node[0], node[1])];
    }
    path.reverse();
    return path;
  }

  function nearestUnsampled(state) {
    var boat = state.boat;
    var best = null;
    state.world.stations.forEach(function (s) {
      if (state.samples.indexOf(s.id) !== -1) return;
      var d = Math.hypot(boat.x - (s.x + 0.5), boat.y - (s.y + 0.5));
      if (!best || d < best.d) best = { id: s.id, x: s.x, y: s.y, d: d };
    });
    return best;
  }

  function steerToward(state, input, tx, ty, slow) {
    var boat = state.boat;
    var target = { x: tx + 0.5, y: ty + 0.5 };
    var desired = Math.atan2(target.y - boat.y, target.x - boat.x);
    var diff = angleDiff(boat.angle, desired);
    if (Math.abs(diff) > 0.22) {
      if (diff > 0) input.right = true;
      else input.left = true;
    }
    var aligned = Math.abs(diff) < 0.9;
    var aheadTx = Math.floor(boat.x + Math.cos(boat.angle) * 0.8);
    var aheadTy = Math.floor(boat.y + Math.sin(boat.angle) * 0.8);
    var blocked = !safeAt(state.world, aheadTx, aheadTy, state.time) && !(state.shield > 0);
    if (blocked) {
      input.up = false;
      if (diff > 0) input.right = true;
      else input.left = true;
      return;
    }
    if (aligned) {
      if (slow && boat.speed > 1.6) input.down = true;
      else input.up = true;
    }
  }

  function followerPolicy(state) {
    var input = neutral();
    if (state.entangled) {
      input.action = true;
      return input;
    }
    var boat = state.boat;

    if (state.collected >= 3) {
      var dock = state.world.dock;
      var dDock = Math.hypot(boat.x - (dock.x + 0.5), boat.y - (dock.y + 0.5));
      if (dDock < 0.8) return input;
      var dockPath = bfs(state.world, boat, dock.x, dock.y, state.time);
      if (dockPath && dockPath.length > 1) {
        var dn = dockPath[1];
        steerToward(state, input, dn[0], dn[1], dDock < 2.4);
      }
      return input;
    }

    var station = nearestUnsampled(state);
    var dStation = Math.hypot(boat.x - (station.x + 0.5), boat.y - (station.y + 0.5));
    if (dStation < 1.05) {
      if (boat.speed > 0.5) {
        input.down = true;
      } else {
        input.action = true;
      }
      return input;
    }

    var goal = adjacentGoal(state, station);
    var path = bfs(state.world, boat, goal.tx, goal.ty, state.time);
    if (!path || path.length < 2) {
      var direct = bfs(state.world, boat, station.x, station.y, state.time);
      if (direct && direct.length > 1) path = direct;
      else return input;
    }
    var next = path[1];
    steerToward(state, input, next[0], next[1], dStation < 2.6);
    return input;
  }

  function adjacentGoal(state, station) {
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var boat = state.boat;
    var best = null;
    dirs.forEach(function (d) {
      var nx = station.x + d[0];
      var ny = station.y + d[1];
      if (!safeAt(state.world, nx, ny, state.time)) return;
      var dist = Math.hypot(boat.x - (nx + 0.5), boat.y - (ny + 0.5));
      if (!best || dist < best.dist) best = { tx: nx, ty: ny, dist: dist };
    });
    return best || { tx: station.x, ty: station.y };
  }

  function wasterPolicy(state) {
    var input = neutral();
    if (state.entangled) {
      input.action = true;
      return input;
    }
    input.up = true;
    var aheadTx = Math.floor(state.boat.x + Math.cos(state.boat.angle) * 1.1);
    var aheadTy = Math.floor(state.boat.y + Math.sin(state.boat.angle) * 1.1);
    if (!safeAt(state.world, aheadTx, aheadTy, state.time) || state.time % 2.4 < 1.2) {
      input.right = true;
    }
    return input;
  }

  function applyInput(state, input) {
    Game.setInput(state, 'up', !!input.up);
    Game.setInput(state, 'down', !!input.down);
    Game.setInput(state, 'left', !!input.left);
    Game.setInput(state, 'right', !!input.right);
    Game.setInput(state, 'action', !!input.action);
  }

  function run(seed, policy, maxSteps) {
    var state = Game.createGame(seed);
    var steps = 0;
    var stuckTicks = 0;
    var lastPos = state.boat.x + ',' + state.boat.y;
    while (state.status === 'running' && steps < maxSteps) {
      applyInput(state, policy(state));
      Game.step(state);
      steps++;
      var posKey = state.boat.x.toFixed(1) + ',' + state.boat.y.toFixed(1);
      if (posKey === lastPos) stuckTicks++;
      else stuckTicks = 0;
      lastPos = posKey;
      if (stuckTicks > 240 && state.fuel >= Game.RECOVER_COST) {
        Game.recover(state);
        stuckTicks = 0;
      }
    }
    return Game.buildSummary(state);
  }

  return {
    run: run,
    followerPolicy: followerPolicy,
    wasterPolicy: wasterPolicy
  };
});
