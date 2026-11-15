/* 珊瑚苗圃模拟核心:纯逻辑、无 DOM,浏览器与 Node 均可加载。
 * 所有随机性来自种子初始化阶段;step() 内只使用连续微分式更新,
 * 不做逐帧随机跳变,保证同 seed 完全可复现。 */
(function (global) {
  'use strict';

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  const CONFIG = {
    totalDays: 12,
    coralCount: 14,
    initFunds: 1000,
    initFragments: 6,
    targetSurvival: 0.8,
    targetCoverage: 0.6,
    cleanCost: 40,
    transplantCost: 80,
    chillerCostPerDay: 7,
    pumpCostPerDay: 12,
    bleachTrigger: 0.3,
    sedimentTrigger: 0.5,
    foulingTrigger: 0.5,
  };

  const WEATHERS = ['sunny', 'cloudy', 'heatwave', 'calm', 'storm'];
  const WEATHER_W = [0.30, 0.25, 0.15, 0.15, 0.15];
  const WEATHER_TEMP = { sunny: 0.6, cloudy: -0.6, heatwave: 2.6, calm: 1.0, storm: -1.2 };
  const WEATHER_LIGHT = { sunny: 1.0, cloudy: 0.6, heatwave: 1.1, calm: 0.9, storm: 0.4 };
  const WEATHER_NAME = { sunny: '晴', cloudy: '阴', heatwave: '热浪', calm: '无风', storm: '风暴' };

  function pickWeather(rng) {
    const r = rng();
    let acc = 0;
    for (let i = 0; i < WEATHERS.length; i++) {
      acc += WEATHER_W[i];
      if (r < acc) return WEATHERS[i];
    }
    return 'sunny';
  }

  class CoralSim {
    constructor(seedStr) {
      this.seedStr = String(seedStr);
      const rng = mulberry32(hashSeed(this.seedStr));
      this.time = 0;
      this.funds = CONFIG.initFunds;
      this.fragments = CONFIG.initFragments;
      this.finished = false;
      this.success = false;
      this.log = [];
      this.opLog = [];
      this.strategyRecords = [];
      this.env = {
        temp: 27, flow: 0.5, shade: 0.3, tempSet: 26,
        chillerOn: false, sediment: 0.2, light: 0.8,
      };
      this.weather = [];
      for (let d = 0; d < CONFIG.totalDays; d++) this.weather.push(pickWeather(rng));
      this.corals = [];
      for (let i = 0; i < CONFIG.coralCount; i++) {
        this.corals.push({
          id: i,
          x: 0.06 + rng() * 0.88,
          y: 0.74 + rng() * 0.16,
          size: 0.25 + rng() * 0.2,
          health: 0.7 + rng() * 0.25,
          bleach: rng() * 0.1,
          fouling: rng() * 0.15,
          strain: 0,
          breakThreshold: 0.5 + rng() * 0.7,
          growthMul: 0.8 + rng() * 0.4,
          alive: true,
        });
      }
      this.corals.sort((a, b) => a.x - b.x);
      this.corals.forEach((c, i) => { c.id = i; });
      this.activeStrategy = null;
      this._log(0, '苗圃建立:14 株幼枝就位,资金 ' + CONFIG.initFunds + ',天气序列已生成');
    }

    weatherNow() {
      return this.weather[Math.min(Math.floor(this.time), CONFIG.totalDays - 1)];
    }

    _log(day, msg) {
      this.log.push({ day: Math.round(day * 1000) / 1000, msg });
    }

    metrics() {
      const alive = this.corals.filter(c => c.alive);
      const n = this.corals.length;
      const avg = (f) => alive.length ? alive.reduce((s, c) => s + f(c), 0) / alive.length : 0;
      return {
        day: Math.round(this.time * 100) / 100,
        funds: Math.round(this.funds),
        fragments: this.fragments,
        survival: alive.length / n,
        coverage: alive.reduce((s, c) => s + c.size, 0) / n,
        avgHealth: avg(c => c.health),
        avgBleach: avg(c => c.bleach),
        avgFouling: avg(c => c.fouling),
        sediment: this.env.sediment,
        temp: this.env.temp,
      };
    }

    /* 连续时间推进:dt 单位为天。所有变化率均为每天速率。 */
    step(dt) {
      if (this.finished || dt <= 0) return;
      const env = this.env;
      const w = this.weatherNow();
      const dayFrac = this.time % 1;
      // 昼夜:白天光照强、夜间弱;气温有日较差
      const daylight = Math.max(0.12, Math.sin(Math.PI * dayFrac));
      const diurnal = Math.sin((dayFrac - 0.25) * Math.PI * 2) * 0.8;
      // 水温:趋向天气目标,冷水机开启时向设定值拉伸
      const targetTemp = 27 + WEATHER_TEMP[w] + diurnal;
      const pull = env.chillerOn ? 0.65 : 0;
      const blended = targetTemp * (1 - pull) + env.tempSet * pull;
      env.temp += (blended - env.temp) * Math.min(1, dt * 3);
      // 光照:天气 × 遮光网 × 昼夜
      env.light = WEATHER_LIGHT[w] * (1 - env.shade * 0.85) * daylight;
      // 沉积物:流速过低积聚,中高流速清除,风暴扰动增加
      let ds = 0;
      if (env.flow < 0.35) ds += (0.35 - env.flow) * 0.6;
      else if (env.flow > 0.55) ds -= (env.flow - 0.55) * 0.5;
      if (w === 'storm') ds += 0.08;
      env.sediment = clamp(env.sediment + ds * dt, 0, 1);
      // 设备能耗
      if (env.chillerOn) {
        const cost = CONFIG.chillerCostPerDay * Math.abs(targetTemp - env.tempSet) * dt;
        this.funds = Math.max(0, this.funds - cost);
        if (this.activeStrategy && this.activeStrategy.name === 'A') this.activeStrategy.cost += cost;
      }
      if (env.flow > 0.7) {
        const cost = CONFIG.pumpCostPerDay * dt;
        this.funds = Math.max(0, this.funds - cost);
        if (this.activeStrategy && this.activeStrategy.name === 'B') this.activeStrategy.cost += cost;
      }
      // 珊瑚个体动力学
      for (const c of this.corals) {
        if (!c.alive) continue;
        // 白化:高温/强光加压,条件合适且附着少时恢复
        const stress = Math.max(0, env.temp - 29) * 0.10 + Math.max(0, env.light - 0.95) * 0.2;
        const recover = (env.temp < 28.5 && env.light < 0.8 && c.fouling < 0.4) ? 0.15 : 0;
        c.bleach = clamp(c.bleach + (stress - recover) * dt, 0, 1);
        // 附着物:低流速与高温加速
        c.fouling = clamp(c.fouling + 0.06 * (env.flow < 0.4 ? 1.6 : 1) * (env.temp > 28 ? 1.3 : 1) * dt, 0, 1);
        // 断枝:流速 >0.8 时累积应变,超过个体阈值即折断(确定性)
        if (env.flow > 0.8) {
          c.strain += (env.flow - 0.8) * 2 * dt;
          if (c.strain > c.breakThreshold) {
            c.strain = 0;
            c.size *= 0.72;
            c.health = clamp(c.health - 0.15, 0, 1);
            this._log(this.time, '珊瑚 #' + c.id + ' 幼枝被强流折断!');
          }
        } else {
          c.strain = Math.max(0, c.strain - 0.1 * dt);
        }
        // 生长:光照/温度/健康适宜时;遮光 >70% 显著降低生长率
        const shadePenalty = env.shade > 0.7 ? 0.35 : 1;
        if (c.health > 0.3 && c.bleach < 0.5 && c.fouling < 0.6 &&
            env.light > 0.25 && env.temp >= 24 && env.temp <= 30.5) {
          c.size = Math.min(1, c.size + 0.05 * c.growthMul * shadePenalty * dt);
        }
        // 健康:白化/沉积/附着过高时下降,条件良好时缓慢恢复
        let dh = 0;
        if (c.bleach > 0.6) dh -= (c.bleach - 0.6) * 0.25;
        if (env.sediment > 0.6) dh -= (env.sediment - 0.6) * 0.2;
        if (c.fouling > 0.7) dh -= (c.fouling - 0.7) * 0.2;
        if (dh === 0 && c.bleach < 0.3 && c.fouling < 0.4 && env.sediment < 0.5) dh += 0.02;
        c.health = clamp(c.health + dh * dt, 0, 1);
        if (c.health <= 0) {
          c.alive = false;
          this._log(this.time, '珊瑚 #' + c.id + ' 死亡。');
        }
      }
      this.time += dt;
      this._checkStrategyEnd();
      if (this.time >= CONFIG.totalDays) this._finish();
    }

    _finish() {
      this.finished = true;
      const m = this.metrics();
      this.success = m.survival >= CONFIG.targetSurvival && m.coverage >= CONFIG.targetCoverage;
      this._log(this.time, '模拟结束:存活率 ' + (m.survival * 100).toFixed(1) +
        '%,覆盖率 ' + (m.coverage * 100).toFixed(1) + '%,' + (this.success ? '达标成功!' : '未达标。'));
    }

    _recordOp(op, args) {
      this.opLog.push({ day: Math.round(this.time * 1000) / 1000, op, args });
    }

    setShade(v) {
      this.env.shade = clamp(v, 0, 0.9);
      this._recordOp('setShade', [this.env.shade]);
      return { ok: true, msg: '遮光网调整为 ' + Math.round(this.env.shade * 100) + '%' +
        (this.env.shade > 0.7 ? '(遮光过久将降低生长率)' : '') };
    }

    setFlow(v) {
      this.env.flow = clamp(v, 0, 1);
      this._recordOp('setFlow', [this.env.flow]);
      const warn = this.env.flow > 0.8 ? '(过强!幼枝可能折断)' :
        this.env.flow < 0.35 ? '(过弱,沉积物将积聚)' : '';
      return { ok: true, msg: '水流调整为 ' + Math.round(this.env.flow * 100) + '%' + warn };
    }

    setTemp(v) {
      this.env.tempSet = clamp(v, 20, 30);
      this.env.chillerOn = true;
      this._recordOp('setTemp', [this.env.tempSet]);
      return { ok: true, msg: '水温设定 ' + this.env.tempSet.toFixed(1) + '℃,冷水机运行中(按温差计费)' };
    }

    chillerOff() {
      this.env.chillerOn = false;
      this._recordOp('chillerOff', []);
      return { ok: true, msg: '冷水机已关闭' };
    }

    clean(idx) {
      if (this.funds < CONFIG.cleanCost) {
        return { ok: false, msg: '清洁失败:资金不足(需 ' + CONFIG.cleanCost + ',当前 ' + Math.round(this.funds) + ')' };
      }
      this.funds -= CONFIG.cleanCost;
      const targets = idx == null ? this.corals : this.corals.filter(c => c.id === idx);
      for (const c of targets) c.fouling = clamp(c.fouling - 0.75, 0, 1);
      this.env.sediment = clamp(this.env.sediment - 0.25, 0, 1);
      this._recordOp('clean', [idx == null ? null : idx]);
      this._log(this.time, (idx == null ? '全面清洁' : '清洁珊瑚 #' + idx) + ',花费 ' + CONFIG.cleanCost);
      return { ok: true, msg: (idx == null ? '全面清洁' : '清洁 #' + idx) + ' 完成,-' + CONFIG.cleanCost + ' 资金' };
    }

    transplant(idx) {
      const c = this.corals.find(k => k.id === idx);
      if (!c) return { ok: false, msg: '移栽失败:目标珊瑚不存在' };
      if (c.alive) return { ok: false, msg: '移栽失败:#' + idx + ' 仍存活,无需补植' };
      if (this.fragments <= 0) return { ok: false, msg: '移栽失败:备用幼枝不足' };
      if (this.funds < CONFIG.transplantCost) {
        return { ok: false, msg: '移栽失败:资金不足(需 ' + CONFIG.transplantCost + ')' };
      }
      this.funds -= CONFIG.transplantCost;
      this.fragments -= 1;
      Object.assign(c, { alive: true, health: 0.8, size: 0.3, bleach: 0, fouling: 0, strain: 0 });
      this._recordOp('transplant', [idx]);
      this._log(this.time, '珊瑚 #' + idx + ' 补植新幼枝,-' + CONFIG.transplantCost + ' 资金,-1 幼枝');
      return { ok: true, msg: '移栽完成:#' + idx + ' 已补植,-' + CONFIG.transplantCost + ' 资金' };
    }

    /* 恢复策略 A:遮阴+降温(触发阈值:平均白化 ≥0.3)
     * 恢复策略 B:强流冲洗+清洁(触发阈值:沉积物或附着 ≥0.5) */
    runStrategy(name) {
      if (this.activeStrategy) return { ok: false, msg: '已有策略在执行中,请先等待其结束' };
      const m = this.metrics();
      const before = this.metrics();
      if (name === 'A') {
        this.env.shade = 0.65;
        this.env.tempSet = 26;
        this.env.chillerOn = true;
        this.activeStrategy = { name: 'A', startDay: this.time, before, cost: 0,
          trigger: '平均白化 ' + m.avgBleach.toFixed(2) + ' / 阈值 ' + CONFIG.bleachTrigger };
        this._recordOp('runStrategy', ['A']);
        this._log(this.time, '启动策略A(遮阴65%+降温至26℃),触发:' + this.activeStrategy.trigger);
        return { ok: true, msg: '策略A启动:遮阴+降温,白化降至 0.15 以下自动结束' };
      }
      if (name === 'B') {
        if (this.funds < CONFIG.cleanCost) return { ok: false, msg: '策略B失败:资金不足以支付清洁' };
        this.env.flow = 0.78;
        const cleanRes = this.clean(null);
        this.opLog.pop(); // 内部清洁不单独入列,避免重放时重复扣费
        this.activeStrategy = { name: 'B', startDay: this.time, before, cost: CONFIG.cleanCost,
          trigger: '沉积 ' + m.sediment.toFixed(2) + '/附着 ' + m.avgFouling.toFixed(2) +
            ' / 阈值 ' + CONFIG.sedimentTrigger };
        this._recordOp('runStrategy', ['B']);
        this._log(this.time, '启动策略B(强流78%+全面清洁),触发:' + this.activeStrategy.trigger);
        return { ok: cleanRes.ok, msg: '策略B启动:强流冲洗+清洁,沉积与附着达标后自动结束' };
      }
      return { ok: false, msg: '未知策略: ' + name };
    }

    _checkStrategyEnd() {
      const s = this.activeStrategy;
      if (!s) return;
      const m = this.metrics();
      let done = false;
      if (s.name === 'A' && m.avgBleach < 0.15) { this.env.shade = 0.3; this.env.chillerOn = false; done = true; }
      if (s.name === 'B' && m.sediment < 0.25 && m.avgFouling < 0.25) { this.env.flow = 0.5; done = true; }
      if (done) {
        const after = this.metrics();
        this.strategyRecords.push({
          name: s.name, trigger: s.trigger,
          startDay: Math.round(s.startDay * 100) / 100,
          endDay: Math.round(this.time * 100) / 100,
          cost: Math.round(s.cost),
          before: s.before, after,
        });
        this._log(this.time, '策略' + s.name + ' 结束,累计代价 ' + Math.round(s.cost) + ' 资金');
        this.activeStrategy = null;
      }
    }

    /* 固定序列复现:按 opLog 重放操作 */
    applyOp(entry) {
      const { op, args } = entry;
      if (op === 'setShade') return this.setShade(args[0]);
      if (op === 'setFlow') return this.setFlow(args[0]);
      if (op === 'setTemp') return this.setTemp(args[0]);
      if (op === 'chillerOff') return this.chillerOff();
      if (op === 'clean') return this.clean(args[0]);
      if (op === 'transplant') return this.transplant(args[0]);
      if (op === 'runStrategy') return this.runStrategy(args[0]);
      return { ok: false, msg: '未知操作 ' + op };
    }
  }

  CoralSim.CONFIG = CONFIG;
  CoralSim.WEATHER_NAME = WEATHER_NAME;
  global.CoralSim = CoralSim;
  global.CoralSimShared = { clamp, WEATHER_TEMP, WEATHER_LIGHT, WEATHER_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = CoralSim;
})(typeof window !== 'undefined' ? window : globalThis);
