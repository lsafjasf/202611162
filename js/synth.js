/* 音乐 + 警报合成：实时与离线渲染共用同一图构建与调度逻辑 */
"use strict";

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/* 和弦进行：Am - F - C - G（每和弦一小节） */
const PROG = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62]
];
const PENTA = [69, 72, 74, 76, 79, 81];

/* 构建混音图：musicBus -> filter -> duckGain -> master <- alarmBus */
function buildMixGraph(ctx, p) {
  const master = ctx.createGain();
  master.gain.value = 0.9;

  const duckGain = ctx.createGain();
  duckGain.gain.value = envState.smooth;
  duckGain.connect(master);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = p.cutoff;
  filter.Q.value = 0.7;
  filter.connect(duckGain);

  const musicBus = ctx.createGain();
  musicBus.gain.value = 0.5;
  musicBus.connect(filter);

  const alarmBus = ctx.createGain();
  alarmBus.gain.value = 0.5;
  alarmBus.connect(master);

  return { master, duckGain, filter, musicBus, alarmBus };
}

function noteEnv(ctx, dest, t, dur, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.015);
  g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
  g.connect(dest);
  return g;
}

/* 调度 [t0, t1) 窗口内的音乐事件（确定性，由 bpm/width 决定） */
function scheduleMusic(ctx, nodes, p, t0, t1) {
  const beat = 60 / p.bpm;
  const bar = beat * 4;
  const firstBar = Math.floor(t0 / bar);
  const lastBar = Math.ceil(t1 / bar);

  for (let b = firstBar; b < lastBar; b++) {
    const chord = PROG[((b % 4) + 4) % 4];
    const barStart = b * bar;

    // Pad：每和弦两个失谐锯齿声部，按 width 分左右
    for (const m of chord) {
      for (const side of [-1, 1]) {
        const t = barStart;
        if (t < t0 || t >= t1) continue; // 只在 barStart 所属窗口调度一次，避免重复叠加
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = midiToFreq(m) * (1 + side * 0.003);
        const pan = ctx.createStereoPanner();
        pan.pan.value = side * p.width;
        const g = noteEnv(ctx, pan, Math.max(t, t0), bar, 0.05);
        osc.connect(g);
        pan.connect(nodes.musicBus);
        osc.start(Math.max(t, t0));
        osc.stop(t + bar + 0.3);
      }
    }

    // Bass：每拍根音
    for (let q = 0; q < 4; q++) {
      const t = barStart + q * beat;
      if (t < t0 || t >= t1) continue;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(chord[0] - 12);
      const g = noteEnv(ctx, nodes.musicBus, t, beat * 0.9, 0.22);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + beat);
    }

    // Arp：八分音符五声音阶，按 width 交替左右声像
    for (let s = 0; s < 8; s++) {
      const t = barStart + s * beat * 0.5;
      if (t < t0 || t >= t1) continue;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = midiToFreq(PENTA[(b * 3 + s) % PENTA.length]);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (s % 2 === 0 ? -1 : 1) * p.width * 0.8;
      pan.connect(nodes.musicBus);
      const g = noteEnv(ctx, pan, t, beat * 0.45, 0.12);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + beat * 0.5);
    }
  }
}

/* 调度 [t0, t1) 窗口内的警报（警笛扫频，音高由 alarmHz 决定） */
function scheduleAlarm(ctx, nodes, p, t0, t1) {
  const firstCycle = Math.floor(t0 / ALARM_CYCLE);
  const lastCycle = Math.ceil(t1 / ALARM_CYCLE);
  for (let c = firstCycle; c <= lastCycle; c++) {
    const start = c * ALARM_CYCLE;
    const end = start + ALARM_ON;
    if (start < t0 || start >= t1) continue; // 只在周期起点所属窗口调度一次
    const t = start;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = p.alarmHz;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 2.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = p.alarmHz * 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, Math.max(t + 0.05, end - 0.08));
    g.gain.linearRampToValueAtTime(0, end);
    osc.connect(g);
    g.connect(nodes.alarmBus);

    osc.start(t);
    lfo.start(t);
    osc.stop(end + 0.05);
    lfo.stop(end + 0.05);
  }
}
