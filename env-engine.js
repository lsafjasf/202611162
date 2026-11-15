/*
 * env-engine.js — 确定性城市环境监测模拟引擎
 * 同 seed 重开：监测站/污染源/指示生物位置、天气序列、故障时序、初始资源完全一致。
 * 可在浏览器与 Node 中运行（UMD 风格导出）。
 */
(function (global) {
  'use strict';

  const W = 28;                 // 街区网格宽
  const H = 18;                 // 街区网格高
  const TICK_DT = 2;            // 每个 tick 代表 2 个模拟秒
  const MAX_SAMPLERS = 8;

  const T_SAFE = 18;            // 稳态浓度上限
  const T_WARN = 30;            // 预警阈值
  const T_CRIT = 38;            // 临界阈值
  const T_COLLAPSE = 45;        // 生态指数崩溃线（多数指示生物严重受损）
  const CALIB_COOLDOWN = 10;    // 校准冷却（tick）
  const CALIB_BLIND = 4;        // 污染期间校准的致盲窗口（tick）
  const CALIB_GAP = 15;         // 频繁校准判定间隔

  const COST = { sampler: 8, calibrate: 12, calibrateRepeat: 6, investigate: 25, record: 4 };

  // 可复现的确定性 PRNG：mulberry32
  function mulberry32(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.state = function () { return a >>> 0; };
    return rng;
  }

  const R = {
    int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); },
    range(rng, lo, hi) { return lo + rng() * (hi - lo); },
    gauss(rng) {
      const u = Math.max(1e-9, rng()), v = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  };

  function idx(x, y) { return y * W + x; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 由 seed 生成全部固定要素：站点、污染源、指示生物、天气/故障时序、初始资源
  function generateWorld(seed) {
    const rng = mulberry32(seed);
    const margin = 3;

    function farPoint(used, minDist) {
      for (let tries = 0; tries < 200; tries++) {
        const p = { x: R.int(rng, margin, W - margin - 1), y: R.int(rng, margin, H - margin - 1) };
        if (used.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= minDist)) {
          used.push(p); return p;
        }
      }
      const p = { x: R.int(rng, margin, W - margin - 1), y: R.int(rng, margin, H - margin - 1) };
      used.push(p); return p;
    }

    const used = [];
    const stations = [];
    for (let i = 0; i < 3; i++) {
      const p = farPoint(used, 7);
      stations.push({ id: 'S' + (i + 1), x: p.x, y: p.y });
    }

    // 天气序列：先确定初始风向，再让每 18~30 tick 切换一次目标风向（相邻区间平滑过渡）
    const weather = [];
    const dir0 = R.range(rng, 0, Math.PI * 2);
    let dir = dir0;
    let at = 0;
    weather.push({ atTick: 0, dir, speed: R.range(rng, 1.1, 2.4) });
    while (at < 240) {
      at += R.int(rng, 24, 38);
      // 均值回归：风向围绕初始风向小幅摆动，避免羽流永久偏离监测点
      dir = clamp(dir0 + R.range(rng, -0.55, 0.55), 0, Math.PI * 2);
      weather.push({ atTick: at, dir, speed: R.range(rng, 1.2, 2.0) });
    }

    // 污染源布置在对应站点的逆风方向（沿 wind.dir+π），保证羽流能抵达监测点
    const sourceKinds = ['industrial', 'traffic', 'chemical'];
    const sources = [];
    for (let i = 0; i < 3; i++) {
      const st = stations[i];
      const upwind = dir0 + Math.PI + R.range(rng, -0.18, 0.18);
      const dist = R.int(rng, 5, 8);
      const p = {
        x: clamp(Math.round(st.x + Math.cos(upwind) * dist), 1, W - 2),
        y: clamp(Math.round(st.y + Math.sin(upwind) * dist), 1, H - 2)
      };
      used.push(p);
      sources.push({
        id: 'P' + (i + 1), x: p.x, y: p.y,
        kind: sourceKinds[i],
        startTick: R.int(rng, 10, 18) + i * R.int(rng, 16, 22),
        emission: R.range(rng, 88, 118),
        severity: R.range(rng, 0.8, 1.2),
        active: false, investigated: false, mitigated: false,
        mitigation: 1
      });
    }

    const sentinels = [];
    const speciesPool = ['苔藓', '蜜蜂', '鲫鱼', '麻雀', '蚯蚓'];
    // 全部指示生物确定性地分布在监测站下风方向的污染走廊内，使生态指标能反映整体污染
    for (let i = 0; i < 5; i++) {
      const st = stations[i % stations.length];
      const p = {
        x: clamp(st.x + R.int(rng, 1, 3) + (i >= 3 ? 1 : 0), 1, W - 2),
        y: clamp(st.y + R.int(rng, -2, 2), 1, H - 2)
      };
      used.push(p);
      sentinels.push({
        id: 'B' + (i + 1), x: p.x, y: p.y,
        health: 100, exposure: 0, species: speciesPool[i]
      });
    }

    // 设备故障时序：每个站两段尖峰窗口（确定性排程，而非每帧随机）
    const faults = stations.map((st, i) => [
      { start: R.int(rng, 26, 34) + i * 6, end: 0, spike: R.range(rng, 45, 80) },
      { start: R.int(rng, 90, 110) + i * 6, end: 0, spike: R.range(rng, 40, 70) }
    ].map(f => { f.end = f.start + R.int(rng, 2, 4); return f; }));

    const initialBudget = R.int(rng, 240, 260);

    return { stations, sources, sentinels, weather, faults, initialBudget };
  }

  global.EnvEngine = global.EnvEngine || {};
  global.EnvEngine.W = W;
  global.EnvEngine.H = H;
  global.EnvEngine.TICK_DT = TICK_DT;
  global.EnvEngine.MAX_SAMPLERS = MAX_SAMPLERS;
  global.EnvEngine.T = { SAFE: T_SAFE, WARN: T_WARN, CRIT: T_CRIT, COLLAPSE: T_COLLAPSE };
  global.EnvEngine.CALIB = { COOLDOWN: CALIB_COOLDOWN, BLIND: CALIB_BLIND, GAP: CALIB_GAP };
  global.EnvEngine.COST = COST;
  global.EnvEngine.mulberry32 = mulberry32;
  global.EnvEngine.generateWorld = generateWorld;
  global.EnvEngine.R = R;
  global.EnvEngine.clamp = clamp;
  global.EnvEngine.idx = idx;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.EnvEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================== 模拟主类 ============================== */
(function (global) {
  'use strict';
  const E = global.EnvEngine;
  const { W, H, TICK_DT, T, COST, mulberry32, generateWorld, R, clamp, idx } = E;

  class Simulation {
    constructor(seed) {
      this.seed = (seed >>> 0) || 1;
      this.world = generateWorld(this.seed);
      this.reset();
    }

    reset() {
      // reset 不重新生成世界，只重置运行态；世界只由 seed 决定，保证重开一致
      const w = this.world;
      this.tick = 0;
      this.time = 0;
      this.budget = w.initialBudget;
      this.initialBudget = w.initialBudget;
      this.field = new Float64Array(W * H);
      this.rng = mulberry32(this.seed ^ 0x9e3779b9);
      this.sensors = w.stations.map(st => ({
        stationId: st.id,
        drift: 0,
        lastCalib: -99,
        blindUntil: 0,
        reading: 0,
        faultNow: false,
        history: [],
        calibCount: 0
      }));
      this.sentinels = w.sentinels.map(b => ({ ...b, health: 100, exposure: 0 }));
      this.sources = w.sources.map(s => ({ ...s, active: false, investigated: false, mitigated: false, mitigation: 1 }));
      this.samplers = [];
      this.records = [];           // 可解释记录
      this.log = [];
      this.events = [];            // 关键事件顺序（用于同 seed 复现校验）
      this.failures = 0;
      this.eco = 100;
      this.status = 'running';     // running | success | failed
      this.recoveryApplied = null;
      this._windCache = { tick: -1, wind: null };
      this.lastAction = { kind: 'init', ok: true, text: '任务初始化，等待采样操作', atTick: 0 };
      this.logEvent('init', `载入 seed=${this.seed} 的街区任务`);
    }

    logEvent(kind, text) {
      const ev = { tick: this.tick, time: this.time, kind, text };
      this.events.push(ev);
      this.log.unshift(ev);
      if (this.log.length > 60) this.log.pop();
    }

    // 风场：由确定性天气序列在区间内平滑插值，同 seed 完全一致
    windAt(tick) {
      if (this._windCache.tick === tick) return this._windCache.wind;
      const seq = this.world.weather;
      let i = 0;
      while (i < seq.length - 1 && seq[i + 1].atTick <= tick) i++;
      const a = seq[i];
      const b = seq[Math.min(i + 1, seq.length - 1)];
      const span = Math.max(1, b.atTick - a.atTick);
      const f = i === seq.length - 1 ? 0 : clamp((tick - a.atTick) / span, 0, 1);
      const s = f * f * (3 - 2 * f);
      let d = a.dir + (b.dir - a.dir) * s;
      const wind = { dir: d, speed: a.speed + (b.speed - a.speed) * s };
      this._windCache = { tick, wind };
      return wind;
    }

    // 单个 tick 的物理更新：固定步长，连续演化（无每帧随机跳变）
    step() {
      if (this.status !== 'running') return;
      this.stepPhysics();
      this._checkEndConditions();
    }

    // 仅推进物理与传感器，不触发结束判定（用于治理后观察窗口/测试）
    stepPhysics() {
      const t = ++this.tick;
      this.time = t * TICK_DT;
      const wind = this.windAt(t);

      // 1) 污染源激活与排放（连续羽流，排放强度含确定性慢波动）
      for (const src of this.sources) {
        if (!src.active && t >= src.startTick) {
          src.active = true;
          this.logEvent('source-on', `${src.id}（${kindName(src.kind)}）开始排放`);
        }
        if (src.active) {
          const pulse = 1 + 0.25 * Math.sin(t * 0.17 + src.startTick);
          this.field[idx(src.x, src.y)] += src.emission * src.mitigation * pulse;
        }
      }

      // 2) 半拉格朗日风场平流：沿逆风方向回采样，场随时间连续平滑变化
      this._advect(wind);
      // 3) 扩散与自然衰减（治理策略可加速恢复）
      const decay = this.recoveryApplied && this.recoveryApplied.kind === 'A' && t < this.recoveryApplied.until
        ? 0.05 : 0.002;
      this._diffuseDecay(decay);

      // 4) 传感器读数：真实浓度 + 慢速漂移 + 小幅连续噪声 + 排程故障尖峰
      this._updateSensors(t);
      // 5) 指示生物受污染暴露影响
      this._updateSentinels();
      this.eco = this.sentinels.reduce((s, b) => s + b.health, 0) / this.sentinels.length;
    }

    _advect(wind) {
      const src = this.field, out = new Float64Array(W * H);
      const vx = Math.cos(wind.dir) * wind.speed * 0.9;
      const vy = Math.sin(wind.dir) * wind.speed * 0.9;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // 逆风回采样点
          const bx = x - vx, by = y - vy;
          const x0 = clamp(Math.floor(bx), 0, W - 2);
          const y0 = clamp(Math.floor(by), 0, H - 2);
          const fx = clamp(bx - x0, 0, 1), fy = clamp(by - y0, 0, 1);
          const c00 = src[idx(x0, y0)], c10 = src[idx(x0 + 1, y0)];
          const c01 = src[idx(x0, y0 + 1)], c11 = src[idx(x0 + 1, y0 + 1)];
          const top = c00 + (c10 - c00) * fx;
          const bot = c01 + (c11 - c01) * fx;
          out[idx(x, y)] = top + (bot - top) * fy;
        }
      }
      this.field = out;
    }

    _diffuseDecay(decayRate) {
      // 5 点拉普拉斯扩散，避免 8 邻域平均造成的过度数值稀释
      const f = this.field, out = new Float64Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = idx(x, y);
          const l = x > 0 ? f[idx(x - 1, y)] : f[i];
          const r = x < W - 1 ? f[idx(x + 1, y)] : f[i];
          const u = y > 0 ? f[idx(x, y - 1)] : f[i];
          const d = y < H - 1 ? f[idx(x, y + 1)] : f[i];
          const laplacian = l + r + u + d - 4 * f[i];
          out[i] = Math.max(0, f[i] * (1 - decayRate) + 0.02 * laplacian);
        }
      }
      this.field = out;
    }

    _updateSensors(t) {
      this.world.stations.forEach((st, i) => {
        const s = this.sensors[i];
        const trueC = this.field[idx(st.x, st.y)];
        // 漂移是缓动随机游走，使用确定性 rng，而非每帧白噪
        s.drift = clamp(s.drift + R.gauss(this.rng) * 0.35, -12, 12);
        let noise = R.gauss(this.rng) * 0.6;
        let fault = false;
        for (const f of this.world.faults[i]) {
          if (t >= f.start && t <= f.end) { fault = true; noise += f.spike * (0.7 + 0.3 * this.rng()); }
        }
        s.faultNow = fault;
        let reading = trueC + s.drift + noise;
        if (t < s.blindUntil) reading = trueC * 0.4 + noise * 0.2; // 校准致盲：真实变化被掩盖
        s.reading = Math.max(0, reading);
        s.history.push({ t, value: s.reading, true: trueC, fault });
        if (s.history.length > 120) s.history.shift();
        if (fault && (!this._lastFault || !this._lastFault[i])) {
          this.logEvent('fault', `${st.id} 传感器出现尖峰故障，需校准或采样核实`);
        }
        this._lastFault = this._lastFault || [];
        this._lastFault[i] = fault;
      });
    }

    _updateSentinels() {
      for (const b of this.sentinels) {
        const c = this.field[idx(b.x, b.y)];
        // 高污染时暴露持续累积，清洁时缓慢代谢
        b.exposure = c > T.SAFE
          ? b.exposure * 0.985 + c * 0.015
          : b.exposure * 0.995;
        // 慢性毒性：累积暴露越高，每拍损伤越大，长期不治理会走向崩溃
        const chronic = b.exposure * 0.004;
        if (c > T.WARN) b.health = clamp(b.health - 0.5 * (c / T.WARN) - chronic, 0, 100);
        else if (c > T.SAFE) b.health = clamp(b.health - 0.08 - chronic, 0, 100);
        else {
          // 累积暴露越高，自然恢复越慢（长期污染会留下不可逆损伤）
          const recover = Math.max(0, 0.05 - b.exposure * 0.0015);
          b.health = clamp(b.health + recover, 0, 100);
        }
      }
    }

    _checkEndConditions() {
      if (this.eco <= T.COLLAPSE) {
        this.status = 'failed';
        this.logEvent('fail', `生态指数跌破 ${T.COLLAPSE}，街区生态崩溃，任务失败`);
      } else if (this.budget < 0) {
        this.status = 'failed';
        this.logEvent('fail', '预算耗尽，无法继续监测，任务失败');
      } else if (this.records.filter(r => r.accepted).length >= 3) {
        const types = new Set(this.records.filter(r => r.accepted).map(r => r.type));
        if (types.has('steady') && types.has('critical') && types.has('trace')) {
          this.status = 'success';
          this.logEvent('success', '三组可解释记录齐备，任务成功');
        }
      }
    }

    snapshot() {
      return {
        tick: this.tick, time: this.time, budget: this.budget, eco: this.eco,
        meanHealth: this.eco,
        exposure: this.sentinels.reduce((s, b) => s + b.exposure, 0) / this.sentinels.length,
        status: this.status
      };
    }

    _spend(cost) {
      if (this.budget < cost) {
        this.failures++;
        this.lastAction = { kind: 'denied', ok: false, atTick: this.tick, text: `预算不足，需要 ${cost}，当前 ${this.budget}` };
        this.logEvent('denied', this.lastAction.text);
        return false;
      }
      this.budget -= cost;
      return true;
    }

    // 操作 1：选择采样位置（便携采样点，独立核实传感器读数与故障）
    placeSampler(x, y) {
      if (this.status !== 'running') return this._busy();
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || x >= W || y < 0 || y >= H) return this._bad('坐标超出街区范围');
      if (this.samplers.length >= E.MAX_SAMPLERS) return this._bad(`便携采样点上限 ${E.MAX_SAMPLERS} 个`);
      if (this.samplers.some(s => s.x === x && s.y === y)) return this._bad('该位置已有采样点');
      if (!this._spend(COST.sampler)) return this.lastAction;
      this.samplers.push({ x, y, atTick: this.tick, readings: [] });
      this.lastAction = { kind: 'sampler', ok: true, atTick: this.tick, text: `在 (${x},${y}) 部署便携采样点，花费 ${COST.sampler}` };
      this.logEvent('action', this.lastAction.text);
      return this.lastAction;
    }

    // 操作 2：校准传感器。冷却内重复校准更贵；污染中校准会产生致盲窗口，掩盖真实变化
    calibrate(stationId) {
      if (this.status !== 'running') return this._busy();
      const i = this.world.stations.findIndex(s => s.id === stationId);
      if (i < 0) return this._bad('找不到该监测站');
      const s = this.sensors[i];
      if (this.tick - s.lastCalib < E.CALIB.COOLDOWN) {
        return this._bad(`${stationId} 校准冷却中（${E.CALIB.COOLDOWN - (this.tick - s.lastCalib)} tick 后可用），频繁校准会掩盖真实变化`);
      }
      const repeat = s.calibCount > 0 && this.tick - s.lastCalib < E.CALIB.GAP;
      const cost = repeat ? COST.calibrate + COST.calibrateRepeat : COST.calibrate;
      if (!this._spend(cost)) return this.lastAction;
      const st = this.world.stations[i];
      const trueC = this.field[idx(st.x, st.y)];
      s.lastCalib = this.tick;
      s.calibCount++;
      s.drift = 0;
      let text = `${stationId} 校准完成，漂移清零，花费 ${cost}`;
      if (trueC > T.WARN) {
        // 污染仍在时校准：把真实高值当成漂移压掉，进入致盲窗口
        s.blindUntil = this.tick + E.CALIB.BLIND;
        text += `；但当前真实浓度 ${trueC.toFixed(1)} 超标，致盲 ${E.CALIB.BLIND} tick，真实变化被掩盖`;
        this.failures++;
      } else if (repeat) {
        text += '；短间隔重复校准，记录可信度下降';
      }
      this.lastAction = { kind: 'calibrate', ok: true, atTick: this.tick, text };
      this.logEvent('action', text);
      return this.lastAction;
    }

    // 操作 3：追查污染来源。需要附近存在采样点作为证据，成功后揭示污染源并解锁恢复策略
    investigate(stationId) {
      if (this.status !== 'running') return this._busy();
      const st = this.world.stations.find(s => s.id === stationId);
      if (!st) return this._bad('找不到该监测站');
      const wind = this.windAt(this.tick);
      // 沿逆风方向寻找最近的未揭示污染源
      const candidates = this.sources.filter(s => s.active && !s.investigated).map(s => {
        const dx = s.x - st.x, dy = s.y - st.y;
        const dist = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        let diff = Math.abs(ang - (wind.dir + Math.PI));
        diff = Math.min(diff, Math.PI * 2 - diff);
        return { s, dist, align: diff };
      }).filter(c => c.align < 1.1).sort((a, b) => a.dist - b.dist);
      const hasEvidence = this.samplers.some(p => Math.hypot(p.x - st.x, p.y - st.y) <= 6);
      if (!hasEvidence) {
        this.failures++;
        if (!this._spend(Math.floor(COST.investigate / 2))) return this.lastAction;
        const text = `${stationId} 溯源失败：6 格内缺少采样点证据，损失 ${Math.floor(COST.investigate / 2)} 预算`;
        this.lastAction = { kind: 'investigate', ok: false, atTick: this.tick, text };
        this.logEvent('fail-action', text);
        return this.lastAction;
      }
      if (!candidates.length) return this._bad('当前风向上没有可追溯的活跃污染源');
      if (!this._spend(COST.investigate)) return this.lastAction;
      const target = candidates[0].s;
      target.investigated = true;
      const text = `${stationId} 溯源成功：沿逆风方向锁定 ${target.id}（${E.kindName(target.kind)}），距离 ${candidates[0].dist.toFixed(1)} 格`;
      this.lastAction = { kind: 'investigate', ok: true, atTick: this.tick, text, sourceId: target.id };
      this.logEvent('source-found', text);
      return this.lastAction;
    }

    // 两种恢复策略，均只能在至少揭示一个污染源后使用
    applyRecovery(kind) {
      if (this.status !== 'running') return this._busy();
      if (!this.sources.some(s => s.investigated)) return this._bad('需先成功溯源，才能执行恢复策略');
      if (this.recoveryApplied) return this._bad('恢复策略已执行过一次');
      const before = this.snapshot();
      if (kind === 'A') {
        const cost = 60;
        if (!this._spend(cost)) return this.lastAction;
        for (const s of this.sources) if (s.investigated) { s.mitigated = true; s.mitigation = 0.25; }
        this.recoveryApplied = { kind: 'A', atTick: this.tick, until: this.tick + 20, cost, before };
        const text = `策略 A 源头减排：改造已揭示污染源（花费 ${cost}），排放降至 25%，20 tick 内全域衰减加速`;
        this.lastAction = { kind: 'recovery', ok: true, atTick: this.tick, text };
        this.logEvent('recovery', text);
      } else if (kind === 'B') {
        const cost = 18;
        if (!this._spend(cost)) return this.lastAction;
        // 低成本冲洗稀释：立即降低场浓度，但不解决源头，污染会反弹
        for (let i = 0; i < this.field.length; i++) this.field[i] *= 0.55;
        for (const b of this.sentinels) b.health = clamp(b.health + 6, 0, 100);
        this.recoveryApplied = { kind: 'B', atTick: this.tick, until: this.tick + 8, cost, before };
        const text = `策略 B 应急冲洗：全域浓度立即降至 55% 并修复生物（花费 ${cost}），源头仍在排放，后续可能反弹`;
        this.lastAction = { kind: 'recovery', ok: true, atTick: this.tick, text };
        this.logEvent('recovery', text);
      } else {
        return this._bad('未知恢复策略（A=源头减排，B=应急冲洗）');
      }
      this.recoveryApplied.after = this.snapshot();
      return this.lastAction;
    }

    // 提交可解释记录：steady 稳态 / critical 临界 / trace 溯源
    submitRecord(type, stationId) {
      if (this.status !== 'running') return this._busy();
      const i = this.world.stations.findIndex(s => s.id === stationId);
      if (i < 0) return this._bad('找不到该监测站');
      const st = this.world.stations[i], s = this.sensors[i];
      const trueC = this.field[idx(st.x, st.y)];
      const nearSampler = this.samplers.filter(p => Math.hypot(p.x - st.x, p.y - st.y) <= 6);
      let accepted = false, reason = '';
      if (type === 'steady') {
        const recent = s.history.slice(-8);
        const variation = recent.length ? Math.max(...recent.map(h => h.value)) - Math.min(...recent.map(h => h.value)) : 99;
        if (trueC <= T.SAFE && variation <= 6 && !s.faultNow && nearSampler.length) accepted = true;
        else reason = `需真实浓度≤${T.SAFE}（当前 ${trueC.toFixed(1)}）、8 拍波动≤6（当前 ${variation.toFixed(1)}）、无故障且附近有采样点`;
      } else if (type === 'critical') {
        if (trueC >= T.CRIT && !s.faultNow && nearSampler.length && s.blindUntil <= this.tick) accepted = true;
        else reason = `需真实浓度≥${T.CRIT}（当前 ${trueC.toFixed(1)}）、非故障尖峰、非致盲期且附近有采样点交叉验证`;
      } else if (type === 'trace') {
        const traced = this.sources.some(src => src.investigated);
        if (traced && nearSampler.length) accepted = true;
        else reason = '需先成功溯源并保留采样点证据链';
      } else {
        return this._bad('记录类型必须是 steady / critical / trace');
      }
      if (!this._spend(COST.record)) return this.lastAction;
      if (!accepted) this.failures++;
      const rec = {
        id: 'R' + (this.records.length + 1), type, stationId, accepted, reason,
        atTick: this.tick, time: this.time,
        concentration: Number(trueC.toFixed(2)), eco: Number(this.eco.toFixed(2)),
        budgetLeft: this.budget
      };
      this.records.push(rec);
      const label = { steady: '稳态记录', critical: '临界记录', trace: '溯源记录' }[type];
      const text = accepted
        ? `${label}（${stationId}）通过：浓度 ${rec.concentration}，生态 ${rec.eco}`
        : `${label}（${stationId}）被驳回：${reason}`;
      this.lastAction = { kind: 'record', ok: accepted, atTick: this.tick, text, record: rec };
      this.logEvent(accepted ? 'record-ok' : 'record-reject', text);
      if (accepted) this._checkEndConditions();
      return this.lastAction;
    }

    _bad(text) {
      this.failures++;
      this.lastAction = { kind: 'invalid', ok: false, atTick: this.tick, text };
      this.logEvent('invalid', text);
      return this.lastAction;
    }

    _busy() {
      this.lastAction = { kind: 'busy', ok: false, atTick: this.tick, text: `任务已结束（${this.status}），请重开新任务` };
      return this.lastAction;
    }
  }

  function kindName(k) {
    return ({ industrial: '工业排放', traffic: '交通尾气', chemical: '化学品泄漏' })[k] || k;
  }

  E.Simulation = Simulation;
  E.kindName = kindName;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
