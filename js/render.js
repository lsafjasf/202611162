/*
 * Canvas 渲染：三块滩涂、水深渐变、觅食区、鸟群、游客路线与巡查点。
 * 只读取 sim 的小时级状态，动画相位由 wallClock 驱动且不回写模拟，
 * 因此画面可以流畅运动而模拟状态仍然按小时连续演化。
 */
(function (root) {
  'use strict';

  function pseudo(i, salt) {
    var x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawBird(ctx, x, y, s, flap) {
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x - s * 0.4, y - s * (0.7 + 0.5 * flap), x, y);
    ctx.quadraticCurveTo(x + s * 0.4, y - s * (0.7 + 0.5 * flap), x + s, y);
    ctx.stroke();
  }

  function drawSite(ctx, sim, s, x, y, w, h, now) {
    var depthRatio = s.depth / 90;
    var waterH = h * (0.25 + depthRatio * 0.65);
    var ff = root.SIM.forageFraction(s.depth);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // 天空
    var sky = ctx.createLinearGradient(0, y, 0, y + h * 0.4);
    sky.addColorStop(0, '#cfe8f3'); sky.addColorStop(1, '#eaf4ef');
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, w, h * 0.4);

    // 滩涂底质
    ctx.fillStyle = '#d8c49a';
    ctx.fillRect(x, y + h * 0.32, w, h * 0.68);

    // 水面（水深越深，水面越高、颜色越深）
    var wy = y + h - waterH;
    var water = ctx.createLinearGradient(0, wy, 0, y + h);
    water.addColorStop(0, 'rgba(70,130,160,0.55)');
    water.addColorStop(1, 'rgba(30,70,100,0.85)');
    ctx.fillStyle = water;
    ctx.fillRect(x, wy, w, waterH);

    // 波纹（随 wallClock 平移，不影响模拟）
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (var r = 0; r < 3; r++) {
      ctx.beginPath();
      var ry = wy + 8 + r * 10;
      for (var wx = x - 10; wx <= x + w + 10; wx += 8) {
        var off = Math.sin((wx + now * 0.02 + r * 20) * 0.08) * 2;
        if (wx === x - 10) ctx.moveTo(wx, ry + off); else ctx.lineTo(wx, ry + off);
      }
      ctx.stroke();
    }

    // 觅食区：绿色斑块，面积随 forageFraction 变化
    var patchW = w * 0.7 * ff;
    ctx.fillStyle = 'rgba(90,150,90,' + (0.25 + 0.45 * ff) + ')';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, wy + 14, Math.max(2, patchW / 2), 10 + 8 * ff, 0, 0, Math.PI * 2);
    ctx.fill();

    // 食物：滩上的小型浅色点
    var foodDots = Math.round(s.food / 4);
    ctx.fillStyle = '#8a6d3b';
    for (var f = 0; f < foodDots; f++) {
      var fx = x + 12 + pseudo(f, s.index) * (w - 24);
      var fy = y + h * 0.4 + pseudo(f, s.index + 9) * (h * 0.5);
      if (fy > wy + 4) continue;
      ctx.fillRect(fx, fy, 2, 2);
    }

    // 鸟群：确定性位置 + 轻微飞行相位
    if (s.flock) {
      var shown = Math.min(s.flock.count, 26);
      ctx.strokeStyle = '#2b3a55';
      ctx.lineWidth = 1.4;
      for (var b = 0; b < shown; b++) {
        var bx = x + 18 + pseudo(b, s.index) * (w - 36);
        var by = y + h * 0.36 + pseudo(b, s.index + 3) * (h * 0.34) +
          Math.sin(now * 0.004 + b) * 1.5;
        drawBird(ctx, bx, by, 3.2 + pseudo(b, s.index + 5) * 1.6,
          Math.sin(now * 0.01 + b * 1.7) > 0 ? 1 : 0.1);
      }
    }

    // 游客路线（虚线）与游客点
    var routeY = [y + h * 0.30, y + h * 0.20, y + h * 0.10][s.route];
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = ['#c0392b', '#e67e22', '#27866b'][s.route];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, routeY);
    ctx.lineTo(x + w - 6, routeY + Math.sin(s.route) * 4);
    ctx.stroke();
    ctx.setLineDash([]);
    var visitorDots = Math.min(10, Math.round(s.visitors / 18));
    ctx.fillStyle = ['#c0392b', '#e67e22', '#27866b'][s.route];
    for (var v = 0; v < visitorDots; v++) {
      var vx = x + 14 + ((now * 0.03 * (s.route === 0 ? 1.4 : 0.8) + v * 34) % (w - 28));
      ctx.beginPath();
      ctx.arc(vx, routeY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 巡查点：闪烁的小旗
    if (s.patrol > 0) {
      var px = x + w - 20, py = y + h - 18;
      ctx.strokeStyle = '#34495e';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 12); ctx.stroke();
      ctx.fillStyle = s.patrol === 2 ? '#8e44ad' : '#2980b9';
      var wave = Math.sin(now * 0.008) * 2;
      ctx.beginPath();
      ctx.moveTo(px, py - 12);
      ctx.lineTo(px + 9 + wave, py - 9);
      ctx.lineTo(px, py - 6);
      ctx.fill();
    }
    ctx.restore();

    // 边框颜色按状态变化
    var st = root.SIM.siteStatus(s);
    ctx.strokeStyle = { steady: '#2e7d32', critical: '#ef6c00', failed: '#c62828' }[st];
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function render(canvas, sim, now) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, W, H);
    var pad = 14, gap = 14;
    var pw = (W - pad * 2 - gap * 2) / 3;
    var ph = H - pad * 2;
    for (var i = 0; i < 3; i++) {
      drawSite(ctx, sim, sim.sites[i], pad + i * (pw + gap), pad, pw, ph, now);
    }
  }

  root.RENDER = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
