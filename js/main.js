// 主循环与控制:暂停 / 重开(同 seed 复现) / 变速 / 声音
let sim = createSim(Number(document.getElementById('seed-input').value));
const canvas = document.getElementById('sea');
const ctx = canvas.getContext('2d');
let lastTs = null;
function frame(ts) {
  if (lastTs === null) lastTs = ts;
  const dtMs = Math.min(100, ts - lastTs);
  lastTs = ts;
  const dtDays = (dtMs / DAY_MS) * sim.speed;
  updateSim(sim, dtDays);
  render(sim, ctx, canvas.width, canvas.height, ts);
  SeaAudio.update(sim);
  refreshUI(sim);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('btn-pause').onclick = () => {
  sim.paused = !sim.paused;
  document.getElementById('btn-pause').textContent = sim.paused ? '继续' : '暂停';
};
document.getElementById('btn-speed').onclick = () => {
  sim.speed = sim.speed === 1 ? 2 : sim.speed === 2 ? 4 : 1;
  document.getElementById('btn-speed').textContent = `速度 x${sim.speed}`;
};
document.getElementById('btn-restart').onclick = () => {
  // 同 seed 重开:天气序列、船只事件顺序、目标个体位置、初始资源完全一致
  sim = createSim(sim.seed);
  document.getElementById('btn-pause').textContent = '暂停';
};
document.getElementById('btn-newseed').onclick = () => {
  sim = createSim(Number(document.getElementById('seed-input').value));
  document.getElementById('btn-pause').textContent = '暂停';
};
document.getElementById('btn-sound').onclick = (e) => {
  const on = SeaAudio.toggle();
  e.target.textContent = `声音:${on ? '开' : '关'}`;
};
document.getElementById('op-stake').onclick = () => opStake(sim);
document.getElementById('op-light').onclick = () => opLight(sim);
document.getElementById('op-lane').onclick = () => opLane(sim);
document.getElementById('op-transplant').onclick = () => opTransplant(sim);
document.getElementById('op-enclosure').onclick = () => opEnclosure(sim);
