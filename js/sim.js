// ===== 玻璃退火线核心模拟 =====
// 产线: 3 个区, 每区 10m. 玻璃板 = 表面/芯部双节点温度模型.
const ZONE_LEN = 10;
const LINE_LEN = ZONE_LEN * 3;
const AMBIENT = 25;

const LIMITS = {
  speed: { min: 0.5, max: 6.0, unit: "m/min", label: "传送速度" },
  temp:  { min: 300, max: 700, unit: "°C",   label: "热风温度" },
  flow:  { min: 10,  max: 100, unit: "%",    label: "冷却风量" },
};

const OBSERVE_TIME = 20;      // 故障恢复后观察期(秒)
const SPAWN_INTERVAL = 6;     // 玻璃板进料间隔(秒)
const GOOD_TARGET = 3;        // 合格目标
const BAD_LIMIT = 5;          // 废品上限

class Simulation {
  constructor() {
    this.batchId = 0;
    this.listeners = { event: [], batchEnd: [], fault: [] };
  }

  on(name, fn) { this.listeners[name].push(fn); }
  emit(name, arg) { this.listeners[name].forEach((f) => f(arg)); }

  resetBatch(keepParams) {
    const p = keepParams ? this.params : { speed: 2.5, temp: 540, flow: 55 };
    this.batchId += 1;
    this.params = { ...p };
    this.time = 0;
    this.sheets = [];
    this.spawnTimer = 0;
    this.thickness = 6;                 // 当前来料厚度(mm), 会随机变化
    this.thicknessTimer = 30;
    this.running = true;
    this.paused = false;
    this.observeLeft = 0;               // >0 表示故障恢复观察期
    this.devices = {
      heater:   { label: "热风加热器", on: true,  fault: false, value: 0 },
      fan:      { label: "冷却风机",   on: true,  fault: false, value: 0 },
      conveyor: { label: "传送电机",   on: true,  fault: false, value: 0 },
    };
    this.zoneTemp = [AMBIENT, AMBIENT, AMBIENT];
    this.good = 0; this.bad = 0;
    this.peakPower = 0; this.power = 0;
    this.exceptions = [];               // 本批异常处理记录
    this.events = [];
    this.log("ok", `批次 #${this.batchId} 开始, 全部设备启动`);
    for (const k in this.devices) this.deviceLog(k, "启动");
  }

  log(type, msg) {
    const e = { t: this.time, type, msg };
    this.events.push(e);
    this.emit("event", e);
  }

  deviceLog(key, action) {
    this.log(action === "启动" ? "ok" : "warn",
      `${this.devices[key].label}${action} @ t=${this.time.toFixed(1)}s`);
  }

  setParam(key, raw) {
    const lim = LIMITS[key];
    const v = parseFloat(raw);
    if (v < lim.min || v > lim.max) {
      // 参数越限 -> 触发保护停机
      this.params[key] = Math.min(Math.max(v, lim.min), lim.max);
      const devKey = { speed: "conveyor", temp: "heater", flow: "fan" }[key];
      this.trip("limit", devKey,
        `${lim.label}设定 ${v}${lim.unit} 超出安全范围 ${lim.min}–${lim.max}${lim.unit}`,
        `${v}${lim.unit}`);
      return false;
    }
    this.params[key] = v;
    return true;
  }

  injectFault() {
    const keys = ["heater", "fan", "conveyor"];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const d = this.devices[key];
    if (d.fault) return;
    d.fault = true; d.on = false;
    const triggers = {
      heater:   `绕组温度 ${(185 + Math.random() * 10).toFixed(0)}°C > 上限 180°C`,
      fan:      `轴承振动 ${(9.2 + Math.random()).toFixed(1)}mm/s > 上限 7.1mm/s`,
      conveyor: `电机电流 ${(32 + Math.random() * 4).toFixed(0)}A > 上限 30A`,
    };
    this.trip("fault", key, `${d.label}故障: ${triggers[key]}`, triggers[key]);
  }

  // 停机(故障或越限): 记录异常, 弹窗由 UI 监听 fault 事件
  trip(kind, devKey, detail, triggerValue) {
    this.running = false;
    const rec = {
      t: this.time, kind, device: this.devices[devKey].label,
      detail, triggerValue, recovered: false,
    };
    this.exceptions.push(rec);
    this.log("fault", `【停机】${detail}`);
    this.deviceLog(devKey, "停止");
    this.emit("fault", rec);
  }

  // 用户确认修复 -> 重启设备, 进入观察期
  recover() {
    this.exceptions.forEach((e) => (e.recovered = true));
    for (const k in this.devices) {
      const d = this.devices[k];
      if (d.fault || !d.on) { d.fault = false; d.on = true; this.deviceLog(k, "启动"); }
    }
    this.observeLeft = OBSERVE_TIME;
    this.running = true;
    this.log("warn", `故障已处理, 进入 ${OBSERVE_TIME}s 恢复观察期`);
  }

  step(dt) {
    if (!this.running || this.paused) return;
    this.time += dt;
    const P = this.params;

    // 来料厚度随机变化, 要求重新调曲线
    this.thicknessTimer -= dt;
    if (this.thicknessTimer <= 0) {
      this.thicknessTimer = 30 + Math.random() * 20;
      const old = this.thickness;
      this.thickness = Math.round((3 + Math.random() * 9) * 2) / 2;
      if (old !== this.thickness)
        this.log("warn", `来料厚度变化: ${old}mm → ${this.thickness}mm, 请调整工艺曲线`);
    }

    // 设备状态 -> 实际输出
    const heaterOn = this.devices.heater.on && !this.devices.heater.fault;
    const fanOn = this.devices.fan.on && !this.devices.fan.fault;
    const convOn = this.devices.conveyor.on && !this.devices.conveyor.fault;
    const speed = convOn ? P.speed / 60 : 0;          // m/s
    const flow = fanOn ? P.flow : 0;

    // 各区环境温度趋向目标
    const targets = [
      heaterOn ? AMBIENT + (P.temp - AMBIENT) * 0.55 : AMBIENT,
      heaterOn ? P.temp : AMBIENT,
      // 冷却区: 风量越小越温和, 风量越大冷冲击越强
      heaterOn ? AMBIENT + Math.pow(1 - flow / 100, 2) * (P.temp - AMBIENT) * 0.8 : AMBIENT,
    ];
    for (let z = 0; z < 3; z++)
      this.zoneTemp[z] += (targets[z] - this.zoneTemp[z]) * Math.min(1, dt * 0.4);

    this.devices.heater.value = this.zoneTemp[1];
    this.devices.fan.value = flow;
    this.devices.conveyor.value = convOn ? P.speed : 0;

    // 功耗
    this.power =
      (heaterOn ? 20 + ((P.temp - 300) / 400) * 80 : 0) +
      Math.pow(flow / 100, 3) * 30 +
      (convOn ? (P.speed / 6) * 10 : 0);
    this.peakPower = Math.max(this.peakPower, this.power);

    // 进料
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && convOn) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.sheets.push({
        x: 0, thick: this.thickness,
        tSurf: AMBIENT, tCore: AMBIENT,
        soakTime: 0, stress: 0, maxStress: 0, cracked: false,
      });
    }

    // 玻璃板推进与传热
    for (const s of this.sheets) {
      s.x += speed * dt;
      const zone = Math.min(2, Math.floor(s.x / ZONE_LEN));
      const h = zone === 2 ? 0.02 + flow * 0.0008 : 0.12;
      s.tSurf += (this.zoneTemp[zone] - s.tSurf) * Math.min(1, h * dt);
      // 芯部热惯性 ∝ 厚度²
      s.tCore += (s.tSurf - s.tCore) * Math.min(1, (dt * 12) / (s.thick * s.thick));
      if (zone === 1) s.soakTime += dt;
      s.maxCore = Math.max(s.maxCore || 0, s.tCore);
      // 热应力 ∝ 表里温差
      s.stress = Math.abs(s.tSurf - s.tCore) / 130;
      s.maxStress = Math.max(s.maxStress, s.stress);
      if (!s.cracked && s.stress > 1.0) {
        s.cracked = true;
        this.log("fault", `玻璃板(厚${s.thick}mm)在 ${s.x.toFixed(1)}m 处开裂, 应力 ${s.stress.toFixed(2)} > 1.0`);
      }
    }

    // 出料判定
    this.sheets = this.sheets.filter((s) => {
      if (s.x < LINE_LEN) return true;
      const needSoak = 20 + s.thick * 10;         // 所需退火保温时间
      const exitGrad = Math.abs(s.tSurf - s.tCore);
      if (s.cracked) { this.bad++; this.log("warn", "废品: 裂纹"); }
      else if ((s.maxCore || 0) < 470) { this.bad++; this.log("warn", `废品: 退火温度不足 ${(s.maxCore || 0).toFixed(0)}°C < 470°C`); }
      else if (s.soakTime < needSoak) { this.bad++; this.log("warn", `废品: 退火不足 ${s.soakTime.toFixed(1)}s < ${needSoak.toFixed(1)}s`); }
      else if (s.tCore > 150) { this.bad++; this.log("warn", `废品: 冷却不充分 出口芯温 ${s.tCore.toFixed(0)}°C`); }
      else if (exitGrad > 40) { this.bad++; this.log("warn", `废品: 残余应力过大 ${exitGrad.toFixed(0)}°C`); }
      else { this.good++; this.log("ok", `良品出炉 (${this.good}/${GOOD_TARGET})`); }
      return false;
    });

    // 观察期倒计时
    if (this.observeLeft > 0) {
      this.observeLeft -= dt;
      if (this.observeLeft <= 0)
        this.log("ok", "恢复观察期结束: 无状态残留, 无错误累计, 运行正常");
    }

    // 批次结束判定
    if (this.good >= GOOD_TARGET) this.endBatch(`达成目标: ${GOOD_TARGET} 块合格`);
    else if (this.bad >= BAD_LIMIT) this.endBatch(`废品达到上限 ${BAD_LIMIT}`);
  }

  endBatch(reason) {
    this.running = false;
    const rec = {
      id: this.batchId, good: this.good, bad: this.bad,
      peakPower: +this.peakPower.toFixed(1),
      stopReason: reason, duration: +this.time.toFixed(1),
      params: { ...this.params },
      exceptions: this.exceptions.map((e) => ({ ...e })),
    };
    this.log("ok", `批次 #${this.batchId} 结束: ${reason}`);
    this.emit("batchEnd", rec);
  }
}
