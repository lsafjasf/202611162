/* 主控：固定步进游戏循环、输入反馈、检查点恢复、失败场景、暂停/重开、状态摘要 */
(function (global) {
  const { C, createInitialState, snapshotCheckpoint, restoreCheckpoint, buildSummary, formatTime, advanceStuck, reachedCamp } = globalThis.SnowState;
  const { generateWorld, layoutHash, zoneAt } = globalThis.SnowWorld;
  const { stepTruck, surfaceAt } = globalThis.SnowPhysics;

  const STORAGE_KEY = 'snowmail.summary.v1';
  const DEFAULT_SEED = 'POSTAL-ROUTE-649';

  class SnowMailGame {
    constructor(canvas, ui) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ui = ui;
      this.seed = DEFAULT_SEED;
      this.rngSeedText = this.seed;
      this.audio = globalThis.SnowAudio.createAudioEngine();
      this.muted = false;
      this.keys = new Set();
      this.flash = 0;
      this.toastText = '';
      this.toastTimer = 0;
      this.windParticles = [];
      this.accumulator = 0;
      this.lastFrame = 0;
      this.runningTime = 0;
      this.particlesRng = globalThis.SnowRng.makeRng('wind-particles');
      this.input = { throttle: 0, brake: false, steer: 0 };
      this.selfTestResult = this.runSelfTest();
      this.resetGame(false);
      this.bindInput();
      requestAnimationFrame((t) => this.loop(t));
    }

    resetGame(announce) {
      this.world = generateWorld(this.seed);
      this.layoutDigest = layoutHash(this.world);
      this.state = createInitialState(this.world);
      this.checkpointSnap = snapshotCheckpoint(this.state, 0);
      this.accumulator = 0;
      this.runningTime = 0;
      this.windParticles = [];
      this.flash = 0;
      if (announce) this.toast(`新局已开启 · seed=${this.seed} · 布局#${this.layoutDigest}`);
      this.renderOverlay();
      this.refreshHud();
    }

    toast(text) {
      this.toastText = text;
      this.toastTimer = 2.4;
    }

    bindInput() {
      window.addEventListener('keydown', (e) => {
        const raw = e.key.toLowerCase();
        const k = { w: 'arrowup', s: 'arrowdown', a: 'arrowleft', d: 'arrowright', ' ': 'arrowdown' }[raw] || raw;
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        if (e.repeat) return;
        this.keys.add(k);
        this.handleTap(k);
        this.flashControl(k, true);
      });
      window.addEventListener('keyup', (e) => {
        const k = e.key.toLowerCase();
        this.keys.delete(k);
        this.flashControl(k, false);
      });
      const map = [
        ['btn-up', 'arrowup'], ['btn-down', 'arrowdown'],
        ['btn-left', 'arrowleft'], ['btn-right', 'arrowright'],
        ['btn-chain', 'c'], ['btn-rescue', 'r'],
      ];
      for (const [id, key] of map) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          this.audio.init();
          this.keys.add(key);
          this.handleTap(key);
          this.flashControl(key, true);
        });
        const release = () => { this.keys.delete(key); this.flashControl(key, false); };
        el.addEventListener('pointerup', release);
        el.addEventListener('pointerleave', release);
      }
      document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
      document.getElementById('btn-restart').addEventListener('click', () => this.resetGame(true));
      document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());
      document.getElementById('btn-overlay-resume')?.addEventListener('click', () => this.togglePause());
      document.getElementById('btn-overlay-restart')?.addEventListener('click', () => this.resetGame(true));
      document.getElementById('btn-overlay-recover')?.addEventListener('click', () => this.recover('手动检查点恢复'));
    }

    flashControl(key, on) {
      const keyToBtn = {
        arrowup: 'btn-up', arrowdown: 'btn-down', arrowleft: 'btn-left',
        arrowright: 'btn-right', c: 'btn-chain', r: 'btn-rescue',
      };
      const id = keyToBtn[key];
      if (id) document.getElementById(id).classList.toggle('active', on);
      const bar = document.getElementById('input-feedback');
      if (bar && on) {
        bar.textContent = `已识别输入：${key} → ${this.describeInput(key)}`;
        bar.classList.remove('pulse');
        void bar.offsetWidth;
        bar.classList.add('pulse');
      }
    }

    describeInput(key) {
      return {
        arrowup: '油门↑', arrowdown: '刹车/倒车↓', arrowleft: '左转←', arrowright: '右转→',
        c: '切换防滑链', r: '从检查点恢复', p: '暂停/继续', n: '重开（同 seed）', m: '静音', ' ': '刹车/倒车',
      }[key] || key;
    }

    handleTap(key) {
      this.audio.init();
      if (key === 'c') this.toggleChains();
      else if (key === 'r') this.recover('手动检查点恢复');
      else if (key === 'p') this.togglePause();
      else if (key === 'n') this.resetGame(true);
      else if (key === 'm') this.toggleMute();
    }

    toggleChains() {
      if (this.state.status !== 'running') return;
      this.state.chains = !this.state.chains;
      this.state.chainToggledAt = this.state.elapsed;
      document.getElementById('btn-chain').classList.toggle('chains-on', this.state.chains);
      this.toast(this.state.chains ? '防滑链已挂载：抓地力提升' : '防滑链已卸除');
      this.audio.beep(this.state.chains ? 660 : 440, 0.12);
      this.refreshHud();
    }

    togglePause() {
      if (this.state.status === 'win' || this.state.status === 'fail') return;
      this.state.status = this.state.status === 'paused' ? 'running' : 'paused';
      this.toast(this.state.status === 'paused' ? '已暂停' : '继续行驶');
      this.renderOverlay();
    }

    toggleMute() {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      document.getElementById('btn-mute').textContent = this.muted ? '🔇 已静音' : '🔊 音效';
    }

    readInput() {
      const throttle = this.keys.has('arrowup') ? 1 : 0;
      const brake = this.keys.has('arrowdown');
      let steer = 0;
      if (this.keys.has('arrowleft')) steer -= 1;
      if (this.keys.has('arrowright')) steer += 1;
      return { throttle, brake, steer };
    }

    update(dt) {
      const s = this.state;
      if (s.status !== 'running') return;
      const input = this.readInput();
      this.input = input;
      s.elapsed += dt;
      s.throttle = input.throttle;
      s.brake = input.brake;
      s.steering = input.steer;

      const fuelBurn = (C.FUEL_IDLE + C.FUEL_THROTTLE * input.throttle) * dt;
      if (s.fuel <= 0) {
        s.fuel = 0;
        this.fail('燃油耗尽，邮车在雪原熄火');
        return;
      }
      s.fuel = Math.max(0, s.fuel - fuelBurn);

      const result = stepTruck(s, input, this.world, dt);
      s.currentZone = zoneAt(s.y);

      for (const hit of result.hits) {
        if (hit.impact > 45) {
          s.health = Math.max(0, s.health - C.HIT_DAMAGE);
          this.flash = 1;
          this.audio.thump(hit.impact);
          this.toast(`撞上${this.obstacleName(hit.obstacle.type)}：车体 -${C.HIT_DAMAGE}`);
          if (s.health <= 0) {
            this.fail('车体损坏超限，无法继续行驶');
            return;
          }
        }
      }

      this.collectMails();
      this.activateCheckpoints();
      this.recordPath(dt, result.surf);
      this.updateStuck(dt, input, result.surf);

      if (reachedCamp(s, this.world)) {
        this.win();
      }
    }

    obstacleName(type) {
      return { rock: '岩石', tree: '雪树', drift: '雪堆', iceblock: '冰块' }[type] || '障碍';
    }

    collectMails() {
      const s = this.state;
      for (const m of s.mails) {
        if (!m.collected && Math.hypot(s.x - m.x, s.y - m.y) <= C.MAIL_RADIUS + 14) {
          m.collected = true;
          s.mail += 1;
          this.audio.beep(880, 0.15);
          this.toast(`拾取邮袋 ${s.mail}/${C.MAIL_REQUIRED}（邮件越重，刹车越慢）`);
        }
      }
    }

    activateCheckpoints() {
      const s = this.state;
      for (let i = 0; i < s.checkpoints.length; i++) {
        const cp = s.checkpoints[i];
        if (!cp.reached && Math.hypot(s.x - cp.x, s.y - cp.y) <= C.CHECKPOINT_RADIUS) {
          cp.reached = true;
          s.lastCheckpoint = i;
          this.checkpointSnap = snapshotCheckpoint(s, i);
          this.audio.beep(520, 0.2);
          this.toast(`检查点 ${i + 1} 已激活，可按 R 回到此处`);
        }
      }
    }

    recordPath(dt, surf) {
      const s = this.state;
      const last = s.path[s.path.length - 1];
      if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 18) {
        s.path.push({ x: s.x, y: s.y });
      }
      if (s.speed > 12) {
        s.ruts.push({ x: s.x, y: s.y, heading: s.heading });
        if (s.ruts.length > 900) s.ruts.shift();
      }
      this.flash = Math.max(0, this.flash - dt * 2.2);
      this.toastTimer = Math.max(0, this.toastTimer - dt);
      if (this.toastTimer === 0) this.toastText = '';
      void surf;
    }

    updateStuck(dt, input, surf) {
      const s = this.state;
      const isStuck = advanceStuck(s, input.throttle > 0, surf.kind, dt);
      if (isStuck) {
        this.fail(surf.kind === 'ice' ? '车轮在冰面持续打滑，车辆搁浅' : '深陷积雪无法脱困，车辆搁浅');
      } else if (s.stuckTimer > 0 && Math.abs(s.stuckTimer - (C.STUCK_SECONDS - 1.5)) < dt) {
        this.toast('警告：车轮持续打滑，即将搁浅！');
      }
    }

    fail(reason) {
      const s = this.state;
      s.status = 'fail';
      s.failReason = reason;
      s.finishedAt = s.elapsed;
      this.saveSummary();
      this.renderOverlay();
      this.refreshHud();
    }

    win() {
      const s = this.state;
      s.status = 'win';
      s.finishedAt = s.elapsed;
      this.audio.beep(720, 0.18);
      setTimeout(() => this.audio.beep(960, 0.22), 160);
      this.saveSummary();
      this.renderOverlay();
      this.refreshHud();
    }

    recover(reason) {
      const s = this.state;
      if (s.status === 'paused') s.status = 'running';
      if (s.status === 'win') return;
      const wasFail = s.status === 'fail';
      restoreCheckpoint(s, this.checkpointSnap);
      s.rescueCount += 1;
      if (wasFail) {
        s.fuel = Math.min(C.FUEL_MAX, s.fuel + C.RESCUE_FUEL_GIFT);
        s.health = Math.min(C.HEALTH_MAX, s.health + C.RESCUE_HEALTH_GIFT);
      } else {
        s.fuel = Math.max(0, s.fuel - C.RESCUE_FUEL_COST);
      }
      this.keys.clear();
      this.toast(`${reason}：回到检查点 ${s.lastCheckpoint + 1}`);
      this.audio.beep(380, 0.2);
      this.renderOverlay();
      this.refreshHud();
    }

    saveSummary() {
      const summary = buildSummary(this.world, this.state, this.seed);
      summary.layoutHash = this.layoutDigest;
      summary.savedAt = new Date().toISOString();
      try {
        const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"history":[]}');
        prev.latest = summary;
        prev.history = [summary, ...(prev.history || [])].slice(0, 5);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
      } catch (err) {
        console.warn('状态摘要写入失败', err);
      }
      console.table ? console.table(summary) : console.log(summary);
      this.lastSummary = summary;
    }

    spawnWindParticles() {
      const s = this.state;
      while (this.windParticles.length < 46) {
        const zone = zoneAt(s.y);
        this.windParticles.push({
          x: s.x + this.particlesRng.range(-this.canvas.width / 2 - 60, this.canvas.width / 2 + 60),
          y: s.y + this.particlesRng.range(-this.canvas.height / 2 - 60, this.canvas.height / 2 + 60),
          len: this.particlesRng.range(10, 34),
          zone,
        });
      }
      const wind = this.world.zones[s.currentZone].wind;
      for (const p of this.windParticles) {
        p.x += wind.x * wind.strength * 0.9 * C.FIXED_DT;
        p.y += wind.y * wind.strength * 0.9 * C.FIXED_DT;
        if (Math.abs(p.x - s.x) > this.canvas.width / 2 + 80 || Math.abs(p.y - s.y) > this.canvas.height / 2 + 80) {
          p.x = s.x + this.particlesRng.range(-this.canvas.width / 2, this.canvas.width / 2);
          p.y = s.y + this.particlesRng.range(-this.canvas.height / 2, this.canvas.height / 2);
          p.zone = s.currentZone;
        }
      }
    }

    loop(timestamp) {
      if (!this.lastFrame) this.lastFrame = timestamp;
      const frameDt = Math.min(0.1, (timestamp - this.lastFrame) / 1000);
      this.lastFrame = timestamp;
      this.runningTime += frameDt;
      if (this.state.status === 'running') {
        this.accumulator += frameDt;
        let guard = 0;
        while (this.accumulator >= C.FIXED_DT && guard < 8) {
          this.update(C.FIXED_DT);
          this.accumulator -= C.FIXED_DT;
          guard++;
        }
        this.spawnWindParticles();
      }
      this.audio.update({
        speedRatio: this.state.speed / C.MAX_SPEED,
        throttle: this.input.throttle,
        engineOn: this.state.status === 'running' && this.state.fuel > 0,
        skid: this.state.stuckTimer > 0.6 ? 0.16 : 0,
        wind: this.world.zones[this.state.currentZone].wind.strength / 120,
      });
      globalThis.SnowRender.render(this.ctx, this.canvas, this.world, this.state, this.windParticles, this.runningTime, this.flash);
      this.drawToast();
      this.refreshHud();
      requestAnimationFrame((t) => this.loop(t));
    }

    drawToast() {
      if (!this.toastText) return;
      const ctx = this.ctx;
      ctx.font = 'bold 16px sans-serif';
      const w = ctx.measureText(this.toastText).width + 28;
      ctx.fillStyle = 'rgba(25,40,58,0.82)';
      ctx.fillRect(this.canvas.width / 2 - w / 2, 64, w, 34);
      ctx.fillStyle = '#f3f7fb';
      ctx.textAlign = 'center';
      ctx.fillText(this.toastText, this.canvas.width / 2, 86);
      ctx.textAlign = 'left';
    }

    refreshHud() {
      const s = this.state;
      const zone = this.world.zones[s.currentZone];
      const surf = surfaceAt(this.world, s);
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('hud-mail', `邮袋 ${s.mail}/${C.MAIL_REQUIRED}`);
      set('hud-time', `用时 ${formatTime(s.elapsed)}`);
      set('hud-zone', `第${s.currentZone + 1}开阔地 · ${zone.wind.name} · 积雪${Math.round(zone.snowDepth * 100)}%`);
      set('hud-grip', `路面：${surf.kind === 'deep' ? '深雪' : surf.kind === 'ice' ? '冰面' : '普通积雪'} · 抓地${Math.round(surf.grip * 100)}%${s.chains ? ' · 防滑链' : ''}`);
      set('hud-speed', `速度 ${Math.round(s.speed)}`);
      set('hud-status', s.status === 'paused' ? '已暂停' : s.status === 'fail' ? `失败：${s.failReason}` : s.status === 'win' ? '送达成功' : '行驶中');
      const fuel = document.getElementById('bar-fuel');
      const health = document.getElementById('bar-health');
      if (fuel) fuel.style.width = `${s.fuel}%`;
      if (health) health.style.width = `${s.health}%`;
      set('hud-fuel-text', `燃油 ${Math.round(s.fuel)}%`);
      set('hud-health-text', `车体 ${Math.round(s.health)}%`);
      const stuck = document.getElementById('hud-stuck');
      if (stuck) {
        const ratio = Math.min(1, s.stuckTimer / C.STUCK_SECONDS);
        stuck.style.width = `${ratio * 100}%`;
        stuck.parentElement.style.opacity = ratio > 0.02 ? 1 : 0;
      }
    }

    renderOverlay() {
      const overlay = document.getElementById('overlay');
      const title = document.getElementById('overlay-title');
      const body = document.getElementById('overlay-body');
      const recoverBtn = document.getElementById('btn-overlay-recover');
      const resumeBtn = document.getElementById('btn-overlay-resume');
      if (this.state.status === 'running') {
        overlay.classList.add('hidden');
        return;
      }
      overlay.classList.remove('hidden');
      const summary = buildSummary(this.world, this.state, this.seed);
      summary.layoutHash = this.layoutDigest;
      if (this.state.status === 'paused') {
        title.textContent = '已暂停';
        body.innerHTML = this.summaryHtml(summary, false);
        recoverBtn.classList.remove('hidden');
        resumeBtn.classList.remove('hidden');
      } else {
        title.textContent = this.state.status === 'win' ? '邮件全部送达！' : '任务失败';
        body.innerHTML = this.summaryHtml(summary, true);
        recoverBtn.classList.toggle('hidden', this.state.status !== 'fail');
        resumeBtn.classList.add('hidden');
      }
    }

    summaryHtml(summary, includeReason) {
      const rows = [
        ['固定 seed', summary.seed],
        ['布局哈希', `#${summary.layoutHash}`],
        ['目标邮袋', `${summary.mailCollected} / ${summary.targetsTotal}（剩余 ${summary.mailRemaining}）`],
        ['检查点', `${summary.checkpointsReached} / ${summary.checkpointsTotal}`],
        ['剩余燃油', `${summary.fuelLeft}%`],
        ['剩余车体', `${summary.healthLeft}%`],
        ['最终用时', summary.elapsedText],
        ['路径记录点', summary.pathPoints],
        ['恢复次数', summary.rescueCount],
      ];
      if (includeReason) rows.push(['失败原因', summary.failReason || '无（成功送达）']);
      return `<table class="summary">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
        <p class="hint">路径已显示在右上小地图；完整状态摘要已写入 localStorage（键：${STORAGE_KEY}）。</p>`;
    }

    runSelfTest() {
      const w1 = generateWorld(DEFAULT_SEED);
      const w2 = generateWorld(DEFAULT_SEED);
      const w3 = generateWorld('OTHER-SEED-9');
      const sameLayout = layoutHash(w1) === layoutHash(w2);
      const diffLayout = layoutHash(w1) !== layoutHash(w3);
      const counts = w1.mails.length === C.MAIL_REQUIRED && w1.checkpoints.length === C.ZONES && w1.obstacles.length > 0;
      const windDiff = new Set(w1.zones.map((z) => Math.round(z.wind.angle * 100))).size === 3;
      const s1 = createInitialState(w1);
      const s2 = createInitialState(w1);
      const input = { throttle: 1, brake: false, steer: 0.6 };
      for (let i = 0; i < 300; i++) {
        stepTruck(s1, input, w1, C.FIXED_DT);
        stepTruck(s2, input, w1, C.FIXED_DT);
      }
      const replayMatch = Math.abs(s1.x - s2.x) < 1e-9 && Math.abs(s1.y - s2.y) < 1e-9;
      const pass = sameLayout && diffLayout && counts && windDiff && replayMatch;
      const result = { pass, sameLayout, diffLayout, counts, windDiff, replayMatch, layoutHash: layoutHash(w1) };
      console.info('自检测试结果', result);
      return result;
    }
  }

  globalThis.SnowMailGame = SnowMailGame;
  globalThis.DEFAULT_SEED = DEFAULT_SEED;
})(typeof globalThis !== 'undefined' ? globalThis : this);
