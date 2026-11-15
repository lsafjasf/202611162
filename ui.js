/* 沙暴滑翔机 —— 浏览器表现层：渲染 / 输入 / 音频 / 结算 */
'use strict';
(function () {
  const G = window.Glider;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;

  /* ---------- 游戏状态 ---------- */
  let world = G.createWorld(G.SEED);
  let state = G.createState(world);
  let paused = false;
  let muted = false;
  let finished = false;          // 是否已结算
  let deaths = 0;
  const toasts = [];             // 输入/事件可见反馈
  const particles = [];          // 压舱掉落等粒子

  function toast(text, color) {
    toasts.push({ text, color: color || '#ffe9a8', t: 2.2 });
    if (toasts.length > 5) toasts.shift();
  }

  /* ---------- 输入 ---------- */
  const input = { pitch: 0, wingsToggle: false, dropBallast: false };
  const keys = {};
  const KEY_FEEDBACK = {
    ArrowUp: '拉杆（抬头）', ArrowDown: '推杆（低头）',
    f: '切换翼展', b: '丢压舱', p: '暂停/继续', r: '检查点复活', m: '声音开关',
  };

  window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (KEY_FEEDBACK[k] || k === 'Enter') e.preventDefault();
    if (keys[k]) return; // 忽略长按重复
    keys[k] = true;
    audio.ensure();
    if (k === 'p') { togglePause(); return; }
    if (k === 'm') { muted = !muted; toast(muted ? '声音：关' : '声音：开'); return; }
    if (k === 'Enter') { restart(); return; }
    if (paused || finished) return;
    if (k === 'f') {
      input.wingsToggle = true;
      toast(state.wings === 1 ? '翼展 → 收拢（高速）' : '翼展 → 展开（高升力）', '#9fd6ff');
    }
    if (k === 'b') {
      if (state.ballast > 0) {
        input.dropBallast = true;
        spawnBallastParticles();
        toast(`丢压舱！剩余 ${state.ballast - 1}`, '#ffd27a');
      } else {
        toast('压舱已空！', '#e07a5f');
      }
    }
    if (k === 'r' && state.status === 'dead') {
      G.respawnAtCheckpoint(state);
      finished = false;
      hideSummary();
      toast('从检查点复活', '#9fd67a');
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = false;
  });

  function pollPitch() {
    let p = 0;
    if (keys.ArrowUp) p += 1;
    if (keys.ArrowDown) p -= 1;
    input.pitch = p;
  }

  function togglePause() {
    paused = !paused;
    toast(paused ? '已暂停' : '继续飞行');
  }

  function restart() {
    // 同一固定 seed 重开：布局必须一致
    const w2 = G.createWorld(G.SEED);
    const same = G.layoutHash(w2) === G.layoutHash(world);
    world = w2;
    state = G.createState(world);
    finished = false;
    deaths = 0;
    hideSummary();
    toast(`新局已开 · 布局 #${G.layoutHash(world)}${same ? '（与上局一致）' : '（不一致！）'}`,
      same ? '#9fd67a' : '#e07a5f');
  }

  function spawnBallastParticles() {
    for (let i = 0; i < 10; i++) {
      particles.push({
        x: state.x, y: state.y - 4,
        vx: state.vx * 0.6 + (Math.random() - 0.5) * 6,
        vy: -8 - Math.random() * 8, t: 1.6,
      });
    }
  }

  /* ---------- 相机 ---------- */
  const SCALE = 0.8;
  let camX = 0, camY = 0;
  function updateCamera() {
    camX = state.x - W / SCALE * 0.35;
    const targetY = Math.max(-100, Math.min(G.WORLD.ceiling - 500, state.y - 380));
    camY += (targetY - camY) * 0.08;
  }
  const sx = (x) => (x - camX) * SCALE;
  const sy = (y) => H - (y - camY) * SCALE;

  /* ---------- 渲染 ---------- */
  function drawSky(vis) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2c3e55');
    g.addColorStop(0.6, '#7a6a4d');
    g.addColorStop(1, '#a88a5a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 三层风带底色与风向箭头
    for (const b of world.windBands) {
      const y0 = sy(b.yMax), y1 = sy(b.yMin);
      ctx.fillStyle = b.dir > 0 ? 'rgba(180,120,60,0.10)' : 'rgba(90,140,190,0.10)';
      ctx.fillRect(0, y0, W, y1 - y0);
      ctx.fillStyle = 'rgba(255,240,200,0.5)';
      ctx.font = '13px monospace';
      const label = `${b.dir > 0 ? '→ 顺风' : '← 逆风'} ${b.speed.toFixed(0)}m/s` +
        (b.thermal > 0.3 ? ' ↑热气流' : b.thermal < -0.3 ? ' ↓下沉气流' : '');
      ctx.fillText(label, 12, (y0 + y1) / 2);
      // 风向箭头（滚动）
      const spacing = 130;
      const offset = ((state.t * b.speed * b.dir * 8) % spacing + spacing) % spacing;
      ctx.strokeStyle = 'rgba(255,240,200,0.35)';
      for (let x = -spacing + offset; x < W + spacing; x += spacing) {
        const ay = (y0 + y1) / 2 + 22;
        const dir = b.dir;
        ctx.beginPath();
        ctx.moveTo(x, ay);
        ctx.lineTo(x + 22 * dir, ay);
        ctx.lineTo(x + 14 * dir, ay - 5);
        ctx.moveTo(x + 22 * dir, ay);
        ctx.lineTo(x + 14 * dir, ay + 5);
        ctx.stroke();
      }
    }
  }

  function drawStorm(vis) {
    // 尘幕：从左侧推进的沙尘墙
    const x0 = sx(state.stormX);
    if (x0 > W) return;
    const g = ctx.createLinearGradient(x0 - 260, 0, x0, 0);
    g.addColorStop(0, 'rgba(120,80,40,0)');
    g.addColorStop(1, 'rgba(120,80,40,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(x0 - 260, 0, 260, H);
    ctx.fillStyle = 'rgba(90,58,28,0.9)';
    ctx.fillRect(0, 0, Math.max(0, x0), H);
    // 尘幕边缘翻滚
    ctx.fillStyle = 'rgba(160,110,60,0.5)';
    for (let i = 0; i < 24; i++) {
      const yy = (i * 97 + Math.floor(state.t * 3) * 31) % H;
      const rr = 12 + (i % 5) * 8;
      ctx.beginPath();
      ctx.arc(x0 - 8 - (i % 4) * 14, yy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTerrain() {
    ctx.beginPath();
    ctx.moveTo(0, H);
    const stepPx = 8;
    for (let px = 0; px <= W + stepPx; px += stepPx) {
      const wx = camX + px / SCALE;
      ctx.lineTo(px, sy(world.groundAt(wx)));
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, sy(300), 0, H);
    g.addColorStop(0, '#c9a25e');
    g.addColorStop(1, '#8a6835');
    ctx.fillStyle = g;
    ctx.fill();
    // 跑道
    const rw = world.runway;
    ctx.fillStyle = '#5c5c5c';
    ctx.fillRect(sx(rw.x), sy(rw.y), rw.w * SCALE, 6);
    ctx.fillStyle = '#ffe9a8';
    for (let x = rw.x + 20; x < rw.x + rw.w - 20; x += 50) {
      ctx.fillRect(sx(x), sy(rw.y) + 2, 18, 2);
    }
    ctx.fillStyle = '#9fd67a';
    ctx.font = '14px monospace';
    ctx.fillText('跑道 →', sx(rw.x), sy(rw.y) - 10);
    // 岩柱
    ctx.fillStyle = '#6d5a44';
    for (const rock of world.rocks) {
      const gy = world.groundAt(rock.x);
      ctx.fillRect(sx(rock.x - rock.w), sy(gy + rock.h), rock.w * 2 * SCALE, rock.h * SCALE);
      ctx.fillStyle = '#54453a';
      ctx.fillRect(sx(rock.x - rock.w), sy(gy + rock.h), rock.w * 2 * SCALE, 4);
      ctx.fillStyle = '#6d5a44';
    }
  }

  function drawRings() {
    const passed = state.checkpoint ? state.checkpoint.ringId : -1;
    for (const r of world.rings) {
      const hit = r.id <= passed;
      ctx.strokeStyle = hit ? 'rgba(120,200,110,0.35)' : 'rgba(255,220,120,0.9)';
      ctx.lineWidth = hit ? 2 : 4;
      ctx.beginPath();
      ctx.arc(sx(r.x), sy(r.y), r.r * SCALE, 0, Math.PI * 2);
      ctx.stroke();
      if (!hit) {
        ctx.fillStyle = 'rgba(255,220,120,0.9)';
        ctx.font = '12px monospace';
        ctx.fillText(`#${r.id + 1}`, sx(r.x) - 10, sy(r.y) - r.r * SCALE - 6);
      }
    }
    ctx.lineWidth = 1;
  }

  function drawPath() {
    if (state.path.length < 2) return;
    ctx.strokeStyle = 'rgba(160,220,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(sx(state.path[0].x), sy(state.path[0].y));
    for (const p of state.path) ctx.lineTo(sx(p.x), sy(p.y));
    ctx.stroke();
  }

  function drawGlider() {
    const x = sx(state.x), y = sy(state.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-state.pitch);
    const span = (state.wings === 1 ? 46 : 26) * SCALE;
    // 机翼
    ctx.strokeStyle = state.stalled ? '#e07a5f' : '#f0ead8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-span / 2, 0);
    ctx.lineTo(span / 2, 0);
    ctx.stroke();
    // 机身
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-16 * SCALE, 2);
    ctx.lineTo(18 * SCALE, -2);
    ctx.stroke();
    // 尾翼
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16 * SCALE, 2);
    ctx.lineTo(-20 * SCALE, -6);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
  }

  function drawParticles(dt) {
    ctx.fillStyle = '#d8c9a0';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t -= dt;
      if (p.t <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt * 3;
      p.y += p.vy * dt * 3;
      p.vy -= 9.8 * dt;
      ctx.globalAlpha = Math.min(1, p.t);
      ctx.fillRect(sx(p.x) - 2, sy(p.y) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawFog(vis) {
    // 沙尘降低能见度
    const a = (1 - vis) * 0.82;
    if (a <= 0.01) return;
    ctx.fillStyle = `rgba(150,105,55,${a})`;
    ctx.fillRect(0, 0, W, H);
  }

  function drawHUD(relV, vis) {
    const band = G.bandAt(world, state.y);
    ctx.fillStyle = 'rgba(20,14,8,0.55)';
    ctx.fillRect(8, 8, 300, 148);
    ctx.fillStyle = '#e8d9b8';
    ctx.font = '15px monospace';
    const lines = [
      `相对风速 ${relV.toFixed(1)} m/s${relV < 17 ? ' ⚠失速边缘' : ''}`,
      `高度     ${state.y.toFixed(0)} m`,
      `地速     ${state.vx.toFixed(1)} m/s`,
      `俯仰     ${(state.pitch * 57.3).toFixed(0)}°`,
      `翼展     ${state.wings === 1 ? '展开' : '收拢'}`,
      `压舱     ${'●'.repeat(state.ballast)}${'○'.repeat(G.WORLD.ballastStart - state.ballast)}`,
      `目标环   ${state.ringsHit}/${world.rings.length}`,
      `能见度   ${(vis * 100).toFixed(0)}%`,
      `风带     ${band.dir > 0 ? '顺风' : '逆风'} ${band.speed.toFixed(0)}m/s`,
    ];
    lines.forEach((t, i) => ctx.fillText(t, 16, 30 + i * 16));
    // 尘幕距离
    const d = state.x - state.stormX;
    ctx.fillStyle = d < 600 ? '#e07a5f' : '#e8d9b8';
    ctx.fillText(`尘幕距离 ${d.toFixed(0)} m`, 16, 30 + lines.length * 16);
    // 俯仰输入指示（每次输入的可见反馈）
    ctx.fillStyle = 'rgba(20,14,8,0.55)';
    ctx.fillRect(8, H - 60, 300, 44);
    ctx.fillStyle = '#8a6d3b';
    ctx.fillRect(24, H - 42, 240, 8);
    ctx.fillStyle = '#ffe9a8';
    const knob = 144 + input.pitch * 110;
    ctx.fillRect(knob - 6, H - 46, 12, 16);
    ctx.fillText('杆位', 270, H - 34);
    // 失速警报
    if (state.stalled && state.status === 'flying') {
      ctx.fillStyle = Math.floor(state.t * 6) % 2 ? '#e07a5f' : '#7a2c1a';
      ctx.font = 'bold 30px monospace';
      ctx.fillText('!! 失速 !!', W / 2 - 80, 90);
    }
    // 事件提示
    ctx.font = '16px monospace';
    toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.min(1, t.t);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, W / 2 - 120, 140 + i * 22);
    });
    ctx.globalAlpha = 1;
    // 布局指纹
    ctx.fillStyle = 'rgba(232,217,184,0.6)';
    ctx.font = '12px monospace';
    ctx.fillText(`seed ${world.seed} · 布局 #${G.layoutHash(world)}`, 12, H - 70);
  }

  function drawCenterText() {
    if (paused) {
      ctx.fillStyle = 'rgba(12,8,4,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'bold 40px monospace';
      ctx.fillText('已暂停', W / 2 - 70, H / 2);
      ctx.font = '18px monospace';
      ctx.fillText('按 P 继续', W / 2 - 50, H / 2 + 36);
    }
    if (state.status === 'dead') {
      ctx.fillStyle = 'rgba(80,20,10,0.55)';
      ctx.fillRect(0, H / 2 - 90, W, 130);
      ctx.fillStyle = '#ffb09a';
      ctx.font = 'bold 32px monospace';
      ctx.fillText(`坠毁：${state.failReason}`, W / 2 - 220, H / 2 - 40);
      ctx.font = '18px monospace';
      ctx.fillText(state.checkpoint ? '按 R 从检查点复活 · Enter 重开' : 'Enter 重开',
        W / 2 - 160, H / 2);
    }
  }

  /* ---------- 事件处理（可见/可听反馈） ---------- */
  function consumeEvents() {
    for (const ev of state.events) {
      if (ev.type === 'ring') {
        toast(`穿过目标环 #${ev.id + 1}！(${ev.hit}/${world.rings.length}) 检查点已记录`, '#9fd67a');
        audio.blip(660, 0.25, 0.2);
        audio.blip(990, 0.35, 0.15);
      } else if (ev.type === 'stall') {
        if (ev.on) toast('失速！推杆俯冲恢复', '#e07a5f');
      } else if (ev.type === 'crash') {
        deaths++;
        audio.blip(90, 0.8, 0.4);
        finishRun();
      } else if (ev.type === 'landed') {
        toast('成功降落！', '#9fd67a');
        audio.blip(523, 0.3, 0.2);
        audio.blip(784, 0.5, 0.2);
        finishRun();
      } else if (ev.type === 'respawn') {
        audio.blip(440, 0.2, 0.15);
      }
    }
  }

  /* ---------- 结算 ---------- */
  const summaryDiv = document.getElementById('summary');

  function finishRun() {
    if (finished) return;
    finished = true;
    const sum = G.buildSummary(world, state);
    sum.deaths = deaths;
    try { localStorage.setItem('glider_summary', JSON.stringify(sum)); } catch (e) { /* 隐私模式 */ }
    showSummary(sum);
  }

  function showSummary(sum) {
    const pathRows = sum.path.map((p, i) =>
      i % Math.ceil(sum.path.length / 12) === 0 ? `(${p.x}, ${p.y})` : null
    ).filter(Boolean).join(' → ');
    summaryDiv.innerHTML = `
      <h2 class="${sum.result === '成功降落' ? 'ok' : 'bad'}">${sum.result}</h2>
      <table>
        <tr><th>目标环</th><td>${sum.targets.hit} / ${sum.targets.total}</td></tr>
        <tr><th>剩余压舱</th><td>${sum.ballastLeft} / ${G.WORLD.ballastStart}</td></tr>
        <tr><th>最终用时</th><td>${sum.timeSec} s</td></tr>
        <tr><th>坠毁次数</th><td>${sum.deaths}</td></tr>
        <tr><th>失败原因</th><td>${sum.failReason || '—'}</td></tr>
        <tr><th>布局指纹</th><td>#${sum.layout}（seed ${sum.seed}，重开应一致）</td></tr>
      </table>
      <p>飞行路径（${sum.pathPoints} 个采样点）：<br>${pathRows}</p>
      <p>状态摘要已保存到 localStorage（键 glider_summary）。</p>
      <button onclick="document.getElementById('summary').style.display='none'">返回（可重开/复活）</button>`;
    summaryDiv.style.display = 'block';
  }

  function hideSummary() {
    summaryDiv.style.display = 'none';
  }

  /* ---------- 主循环（固定步长，保证确定性） ---------- */
  let last = 0, acc = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!last) last = ts;
    let dtReal = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (paused) dtReal = 0;
    acc += dtReal;
    while (acc >= G.DT) {
      acc -= G.DT;
      if (!finished && state.status === 'flying') {
        pollPitch();
        G.step(world, state, input, G.DT);
        input.wingsToggle = false;
        input.dropBallast = false;
        consumeEvents();
      }
      for (const t of toasts) t.t -= G.DT;
      while (toasts.length && toasts[0].t <= 0) toasts.shift();
    }

    updateCamera();
    const band = G.bandAt(world, state.y);
    const relV = Math.hypot(state.vx - band.speed * band.dir, state.vy - band.thermal);
    const vis = G.visibility(state);

    drawSky(vis);
    drawStorm(vis);
    drawTerrain();
    drawRings();
    drawPath();
    drawParticles(dtReal);
    drawGlider();
    drawFog(vis);
    drawHUD(relV, vis);
    drawCenterText();
    audio.update(relV, state.stalled && state.status === 'flying', vis);
  }

  document.getElementById('btnPause').onclick = () => { audio.ensure(); togglePause(); };
  document.getElementById('btnRestart').onclick = () => { audio.ensure(); restart(); };
  document.getElementById('btnMute').onclick = () => {
    audio.ensure();
    muted = !muted;
    toast(muted ? '声音：关' : '声音：开');
  };

  toast(`沙暴逼近！穿过目标环建立检查点，赶在尘幕前降落`, '#ffe9a8');
  toast(`布局 #${G.layoutHash(world)}（固定 seed ${G.SEED}）`, '#9fd6ff');
  requestAnimationFrame(frame);
})();
  const audio = {
    ctx: null, windGain: null, windFilter: null, alarmOsc: null, alarmGain: null,
    ensure() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // 风噪：循环白噪声 → 带通 → 增益（随相对风速）
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 400;
      this.windFilter.Q.value = 0.6;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      src.connect(this.windFilter).connect(this.windGain).connect(this.ctx.destination);
      src.start();
      // 失速警报：方波振荡，失速时鸣响
      this.alarmOsc = this.ctx.createOscillator();
      this.alarmOsc.type = 'square';
      this.alarmOsc.frequency.value = 880;
      this.alarmGain = this.ctx.createGain();
      this.alarmGain.gain.value = 0;
      this.alarmOsc.connect(this.alarmGain).connect(this.ctx.destination);
      this.alarmOsc.start();
    },
    update(relV, stalled, vis) {
      if (!this.ctx || muted) {
        if (this.windGain) this.windGain.gain.value = 0;
        if (this.alarmGain) this.alarmGain.gain.value = 0;
        return;
      }
      const t = this.ctx.currentTime;
      const wind = Math.min(0.5, relV / 90) * (0.4 + 0.6 * vis);
      this.windGain.gain.setTargetAtTime(wind, t, 0.1);
      this.windFilter.frequency.setTargetAtTime(250 + relV * 12, t, 0.1);
      if (stalled) {
        const beep = (Math.floor(t * 6) % 2) ? 0.16 : 0.0;
        this.alarmGain.gain.setTargetAtTime(beep, t, 0.02);
      } else {
        this.alarmGain.gain.setTargetAtTime(0, t, 0.05);
      }
    },
    blip(freq, dur, vol) {
      if (!this.ctx || muted) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + dur);
    },
  };
