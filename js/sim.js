// ================= 海草床修复模拟核心 =================
const GRID_X = 12, GRID_Y = 8;
const TOTAL_DAYS = 30;
const DAY_MS = 6000;            // 1 倍速下一天的现实毫秒数
const TARGET_COVER = 0.60;      // 目标覆盖率
const TARGET_TURB = 15;         // 目标浊度 NTU
const LIGHT_OK = 45;            // 生长所需光照
const TURB_OK = 18;             // 生长所需浊度上限
const TURB_CRIT = 24;           // 临界浊度
const COVER_CRIT = 0.30;        // 临界覆盖率
const STAKE_SAFE = 6;           // 固定桩安全数量,超过则水流紊乱
const STAKE_FAIL = 8;           // 达到即判定一次失败操作

const WEATHER_NAME = { sunny: '晴', cloudy: '阴', storm: '风暴' };
const LANE_NAME = ['近岸航线', '中间航线', '外海航线'];

function createSim(seed) {
  const sched = buildSchedule(seed, TOTAL_DAYS);
  const grid = [];
  for (let i = 0; i < GRID_X * GRID_Y; i++) grid.push(0.25);
  // 目标个体(重点斑块)初始密度更高,位置由 seed 决定
  for (const t of sched.targets) {
    grid[t.gy * GRID_X + t.gx] = 0.5;
  }
  return {
    seed, sched,
    day: 0,                  // 浮点天数
    funds: 800,              // 初始资金(seed 决定? 需求:同 seed 初始资源一致 -> 固定+seed微调)
    seedlings: 60,
    grid,
    stakes: [],              // {gx,gy}
    shade: 0,                // 遮棚档位 0/1/2
    lanePolicy: 1,           // 0近 1中 2远
    light: 60, turb: 10,     // 连续平滑量
    turbKick: 0,             // 事件冲量(锚害搅沙),指数衰减、平滑作用
    flow: 1.0,               // 水流系数
    stableDays: 0,           // 连续稳定天数
    ships: [],               // 活动船只
    shipIdx: 0,              // 已调度到 schedule 的位置
    enclosureUntil: -1,      // 围网封育截止天
    paused: false,
    speed: 1,
    over: false, success: false,
    steadyRecord: null, criticalRecord: null, failureRecord: null,
    lastStakesFail: false,
    log: [],
    lastOp: null,            // {text, good}
    anchorHits: 0,
  };
}

function coverageOf(sim) {
  let n = 0;
  for (const d of sim.grid) if (d > 0.35) n++;
  return n / sim.grid.length;
}
function meanDensity(sim) {
  let s = 0;
  for (const d of sim.grid) s += d;
  return s / sim.grid.length;
}
function snapshot(sim) {
  return {
    day: +sim.day.toFixed(1),
    funds: Math.round(sim.funds),
    seedlings: sim.seedlings,
    cover: +coverageOf(sim).toFixed(3),
    turb: +sim.turb.toFixed(1),
    light: Math.round(sim.light),
    stable: sim.stableDays,
  };
}
function logEvent(sim, text) {
  sim.log.push({ day: +sim.day.toFixed(1), text });
  if (sim.log.length > 200) sim.log.shift();
}

// ---------- 连续环境演化(dt 单位:天) ----------
function updateSim(sim, dt) {
  if (sim.paused || sim.over) return;
  const prevDay = Math.floor(sim.day);
  sim.day += dt;
  const dayIdx = Math.min(Math.floor(sim.day), TOTAL_DAYS - 1);
  const weather = sim.sched.weather[dayIdx];

  // --- 光照:天气决定目标值,指数平滑逼近,叠加日内正弦波动 ---
  const baseLight = weather === 'sunny' ? 85 : weather === 'cloudy' ? 55 : 30;
  const diurnal = 6 * Math.sin((sim.day % 1) * Math.PI * 2);
  const lightTarget = Math.max(5, baseLight - sim.shade * 15 + diurnal);
  sim.light += (lightTarget - sim.light) * Math.min(1, 3 * dt);

  // --- 浊度:天气基线 + 船只扰动 + 过密固定桩淤积,平滑逼近 ---
  let turbTarget = weather === 'sunny' ? 8 : weather === 'cloudy' ? 12 : 20;
  const overStake = Math.max(0, sim.stakes.length - STAKE_SAFE);
  turbTarget += overStake * 2.0;                 // 过密固定 -> 水流变缓 -> 淤积
  for (const sh of sim.ships) {
    if (sh.effLane === 0) turbTarget += 8;       // 近岸航行搅动
    else if (sh.effLane === 1) turbTarget += 2;
  }
  turbTarget += sim.turbKick;                    // 锚害冲量平滑融入
  sim.turbKick *= Math.exp(-3 * dt);
  sim.turb += (turbTarget - sim.turb) * Math.min(1, 1.6 * dt);

  // --- 水流:固定桩越多越缓(连续函数) ---
  sim.flow = Math.max(0.4, 1 - 0.06 * Math.max(0, sim.stakes.length - 4));

  // --- 船只调度:严格按 schedule 顺序触发(关键事件顺序可复现) ---
  while (sim.shipIdx < sim.sched.ships.length) {
    const ev = sim.sched.ships[sim.shipIdx];
    if (ev.day + ev.t > sim.day) break;
    sim.shipIdx++;
    const enclosed = sim.day < sim.enclosureUntil;
    const effLane = enclosed ? 2 : Math.max(ev.lane, sim.lanePolicy);
    sim.ships.push({ ...ev, effLane, x: ev.dir > 0 ? -0.05 : 1.05 });
    const fee = effLane === 0 ? 30 : effLane === 1 ? 15 : 0;
    sim.funds += fee;
    logEvent(sim, `船只通过(${LANE_NAME[effLane]})${fee ? ` 通行费+${fee}` : ''}`);
    if (ev.anchor && effLane < 2) anchorDamage(sim, ev, effLane);
  }
  // 船只移动与移除
  for (const sh of sim.ships) sh.x += sh.dir * sh.speed * dt * 0.5;
  sim.ships = sim.ships.filter(sh => sh.x > -0.08 && sh.x < 1.08);

  // --- 海草生长:需光照/浊度/水流同时适宜;连续稳定才有显著增长 ---
  const suitable = sim.light >= LIGHT_OK && sim.turb <= TURB_OK && sim.flow >= 0.6;
  const enclosedBoost = sim.day < sim.enclosureUntil ? 1.5 : 1;
  for (let i = 0; i < sim.grid.length; i++) {
    let d = sim.grid[i];
    if (suitable) {
      const boost = 1 + Math.min(sim.stableDays, 5) * 0.15; // 稳定越久长得越快
      d += 0.06 * boost * enclosedBoost * (1 - d) * dt;
    } else if (sim.turb > TURB_CRIT || sim.light < 25) {
      d -= 0.03 * d * dt;                                   // 胁迫衰退
    }
    sim.grid[i] = Math.min(1, Math.max(0, d));
  }

  // --- 每日结算:稳定计数、补贴、状态记录 ---
  if (Math.floor(sim.day) !== prevDay) {
    if (suitable) sim.stableDays++; else sim.stableDays = 0;
    sim.funds += 15; // 每日补贴
    sim.seedlings += 2;
    checkStates(sim);
  }

  // --- 结束判定 ---
  if (sim.day >= TOTAL_DAYS && !sim.over) {
    sim.over = true;
    sim.success = coverageOf(sim) >= TARGET_COVER && sim.turb <= TARGET_TURB;
    logEvent(sim, sim.success
      ? `✔ 第30天达标:覆盖率 ${(coverageOf(sim)*100).toFixed(0)}% ≥ 60%,浊度 ${sim.turb.toFixed(1)} ≤ 15`
      : `✘ 第30天未达标:覆盖率 ${(coverageOf(sim)*100).toFixed(0)}%,浊度 ${sim.turb.toFixed(1)}`);
  }
}

// 锚链刮伤:沿船轨迹附近斑块密度骤降
function anchorDamage(sim, ev, effLane) {
  const laneY = [0.25, 0.5, 0.75][effLane];
  const gy = Math.round(laneY * (GRID_Y - 1));
  let hit = 0;
  for (let dx = 0; dx < GRID_X; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = gy + dy;
      if (y < 0 || y >= GRID_Y) continue;
      const i = y * GRID_X + dx;
      if (sim.grid[i] > 0.05 && ((dx + dy + ev.day) % 3 === 0)) {
        sim.grid[i] = Math.max(0, sim.grid[i] - 0.35);
        hit++;
      }
    }
  }
  if (hit > 0) {
    sim.anchorHits += hit;
    sim.turbKick += 6; // 抛锚搅沙:冲量注入,平滑上冲后指数回落
    logEvent(sim, `⚠ 锚链刮伤 ${hit} 个斑块,浊度上冲`);
  }
}

// ---------- 稳态 / 临界 / 失败 记录 ----------
function checkStates(sim) {
  const cover = coverageOf(sim);
  if (!sim.steadyRecord && sim.stableDays >= 3) {
    sim.steadyRecord = { before: snapshot(sim), after: null };
    logEvent(sim, `★ 进入稳态:连续稳定 ${sim.stableDays} 天`);
  }
  if (sim.steadyRecord && !sim.steadyRecord.after && sim.stableDays >= 6) {
    sim.steadyRecord.after = snapshot(sim); // 稳态持续 3 天后的对比
  }
  if (!sim.criticalRecord && (sim.turb > TURB_CRIT || cover < COVER_CRIT)) {
    sim.criticalRecord = { before: snapshot(sim), after: null,
      reason: sim.turb > TURB_CRIT ? `浊度 ${sim.turb.toFixed(1)} > ${TURB_CRIT}` : `覆盖率 ${(cover*100).toFixed(0)}% < 30%` };
    logEvent(sim, `⚠ 临界状态:${sim.criticalRecord.reason}`);
  }
  if (sim.criticalRecord && !sim.criticalRecord.after &&
      sim.turb <= TURB_OK && cover >= COVER_CRIT) {
    sim.criticalRecord.after = snapshot(sim); // 脱离临界后的对比
    logEvent(sim, '✔ 脱离临界状态');
  }
  if (sim.failureRecord && !sim.failureRecord.after && sim.day >= sim.failureRecord.pendingDay) {
    sim.failureRecord.after = snapshot(sim); // 失败操作 2 天后的影响对比
  }
}

function recordFailure(sim, why, before) {
  if (!sim.failureRecord) {
    sim.failureRecord = { why, before, after: null, pendingDay: sim.day + 2 };
    logEvent(sim, `✘ 失败操作:${why}`);
  }
}

// ---------- 玩家操作(均记录前后对比) ----------
function opStake(sim) {
  if (sim.funds < 120) return setLastOp(sim, '资金不足,无法打桩', false);
  const before = snapshot(sim);
  sim.funds -= 120;
  // 打在密度最低的目标斑块附近(确定性选址)
  let best = 0, bestD = 2;
  for (let i = 0; i < sim.grid.length; i++) {
    if (sim.grid[i] < bestD && !sim.stakes.some(s => s.gy * GRID_X + s.gx === i)) {
      best = i; bestD = sim.grid[i];
    }
  }
  const gx = best % GRID_X, gy = Math.floor(best / GRID_X);
  sim.stakes.push({ gx, gy });
  const n = sim.stakes.length;
  if (n >= STAKE_FAIL && !sim.lastStakesFail) {
    sim.lastStakesFail = true;
    recordFailure(sim, `固定桩过密(${n} 根 > ${STAKE_FAIL - 1}),沙床水流紊乱、淤积加剧`, before);
    setLastOp(sim, `打桩第 ${n} 根:过密!水流降至 ${sim.flow.toFixed(2)},淤积风险↑`, false);
  } else {
    setLastOp(sim, `打桩第 ${n} 根于 (${gx},${gy}),斑块受锚害概率下降`, true);
  }
  logEvent(sim, `操作:打固定桩 #${n},资金 -120`);
}

function opLight(sim) {
  if (sim.funds < 80) return setLastOp(sim, '资金不足,无法调节遮棚', false);
  sim.funds -= 80;
  sim.shade = (sim.shade + 1) % 3;
  const txt = ['撤除遮棚(全光照)', '轻度遮棚(-15 光照)', '重度遮棚(-30 光照)'][sim.shade];
  setLastOp(sim, `光照调节:${txt}`, true);
  logEvent(sim, `操作:光照调节 -> ${txt},资金 -80`);
}

function opLane(sim) {
  sim.lanePolicy = (sim.lanePolicy + 1) % 3;
  const warn = sim.lanePolicy === 0 ? '(通行费高,但浊度与锚害风险大)' :
               sim.lanePolicy === 2 ? '(无通行费,最生态)' : '(折中)';
  setLastOp(sim, `航线管制 -> ${LANE_NAME[sim.lanePolicy]} ${warn}`, sim.lanePolicy !== 0);
  logEvent(sim, `操作:航线 -> ${LANE_NAME[sim.lanePolicy]}`);
}

// 策略A 补植移植:触发阈值 覆盖率<45%;高成本、见效快
function opTransplant(sim) {
  const cover = coverageOf(sim);
  if (sim.funds < 300 || sim.seedlings < 20) {
    return setLastOp(sim, '策略A 需要 300 资金 + 20 种苗,资源不足', false);
  }
  const before = snapshot(sim);
  sim.funds -= 300; sim.seedlings -= 20;
  const idx = sim.grid.map((d, i) => [d, i]).sort((a, b) => a[0] - b[0]).slice(0, 6);
  for (const [, i] of idx) sim.grid[i] = Math.min(1, sim.grid[i] + 0.3);
  const after = snapshot(sim);
  sim.transplantRecord = { before, after, threshold: '覆盖率 < 45% 时建议触发' };
  setLastOp(sim, `策略A 补植移植:覆盖率 ${(before.cover*100).toFixed(0)}% -> ${(after.cover*100).toFixed(0)}%,资金 -300、种苗 -20`, true);
  logEvent(sim, `策略A 补植移植(阈值:覆盖率<45%):覆盖率 ${(before.cover*100).toFixed(0)}%->${(after.cover*100).toFixed(0)}%,-300 资金 -20 种苗`);
}

// 策略B 围网封育:触发阈值 浊度>18 或锚害频发;低成本、见效慢、5 天封育
function opEnclosure(sim) {
  if (sim.funds < 100) return setLastOp(sim, '策略B 需要 100 资金,不足', false);
  if (sim.day < sim.enclosureUntil) return setLastOp(sim, '围网封育进行中,请勿重复', false);
  const before = snapshot(sim);
  sim.funds -= 100;
  sim.enclosureUntil = sim.day + 5;
  sim.enclosureRecord = { before, threshold: '浊度 > 18 或锚害 ≥ 3 次时建议触发', until: +(sim.day + 5).toFixed(1) };
  setLastOp(sim, `策略B 围网封育:5 天内船只强制外海航线、生长 x1.5,资金 -100`, true);
  logEvent(sim, `策略B 围网封育(阈值:浊度>18 或锚害>=3):封育至第 ${(sim.day+5).toFixed(1)} 天,-100 资金`);
}

function setLastOp(sim, text, good) {
  sim.lastOp = { text, good };
}
