import { CONFIG, INPUTS } from '../js/config.js';
import { towWeight } from '../js/engine.js';

// 两阶段确定性航行器：
//  阶段 A 向上游推进，沿途抓取进入扇区的目标，负重满则到回收点卸货；
//  阶段 B 配额未满时，按“最近的未完成漂浮物”逐个回退补齐，最后再回回收点。
export default function makeBot({ avoidHazards = false } = {}) {
  return function decide(state) {
    const b = state.boat;
    const quota = CONFIG.quota;
    const input = {
      up: false, down: false, left: false, right: false,
      cableUp: false, cableDown: false
    };
    const pressed = { [INPUTS.GRAB]: false };

    const allMet = state.collected.wood >= quota.wood
      && state.collected.reed >= quota.reed
      && state.collected.drum >= quota.drum;
    const heavy = towWeight(state) >= CONFIG.cable.capacity - 2;

    function needed(d) {
      const ty = CONFIG.debrisTypes[d.type];
      if (avoidHazards && ty.hazard) return false;
      const towedSame = state.towed.filter((id) => {
        const td = state.world.debris.find((x) => x.id === id);
        return td && td.type === d.type;
      }).length;
      return state.collected[d.type] + towedSame < quota[d.type];
    }

    // 最近的未完成目标（全图），用于精确导航。
    const goal = state.world.debris
      .filter((d) => d.state === 'floating' && needed(d))
      .sort((a, z) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(z.x - b.x, z.y - b.y))[0] || null;

    // 只在目标落后很远且附近无桥墩时才倒车，避免在障碍区来回冲撞。
    // 只在桥墩正前方或紧贴时禁止倒车；越过桥墩后即可回退。
    const anyPierNear = state.world.piers.some((p) => p.x > b.x - 60 && p.x - b.x < 420);
    const backing = Boolean(goal && goal.x < b.x - 80) && !anyPierNear;

    // 航线：桥墩缝隙优先，其次目标，最后回收点中线。
    let aimY = goal ? goal.y : 0;
    const pierGroup = state.world.piers
      .filter((p) => p.x > b.x - 40 && p.x - b.x < 360)
      .sort((a, z) => a.x - z.x);
    if (pierGroup.length) {
      const gx = pierGroup[0].x;
      const group = state.world.piers.filter((p) => Math.abs(p.x - gx) < 60).sort((a, z) => a.y - z.y);
      if (group.length === 1) {
        const top = group[0].y - group[0].radius - 55;
        const bottom = group[0].y + group[0].radius + 55;
        aimY = Math.abs(b.y - top) < Math.abs(b.y - bottom) ? top : bottom;
      } else {
        aimY = (group[0].y + group[group.length - 1].y) / 2;
      }
      const distX = gx - b.x;
      if (distX < 300) aimY = b.y + (aimY - b.y) * (distX < 150 ? 2.2 : 1.5);
    } else if (heavy || allMet) {
      aimY = 0;
    }

    // 转向（死区防抖）。
    const desired = Math.atan2(aimY - b.y, 260);
    let diff = desired - b.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > 0.1) input.right = true;
    if (diff < -0.1) input.left = true;

    // 油门：回退用倒车，其余前进；接近目标减速。
    input.up = !backing;
    input.down = backing;
    if (goal && !pierGroup.length) {
      const dx = goal.x - b.x;
      const dy = Math.abs(goal.y - b.y);
      if (!backing && dx > 0 && dx < 150 && dy > 45) input.up = false;
    }

    // 缆绳与抓斗。
    if (towWeight(state) >= CONFIG.cable.capacity - 3) input.cableDown = true;
    else if (state.towed.length && towWeight(state) < 6) input.cableUp = true;
    if (goal) {
      const dist = Math.hypot(goal.x - b.x, goal.y - b.y);
      const ang = Math.atan2(goal.y - b.y, goal.x - b.x);
      let ad = Math.abs(ang - b.angle);
      ad = Math.min(ad, Math.PI * 2 - ad);
      if (dist < CONFIG.grab.reach - 2 && ad < CONFIG.grab.arc / 2) pressed[INPUTS.GRAB] = true;
    }
    return { input, pressed };
  };
}
