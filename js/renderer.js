// Canvas 渲染：土壤剖面四层、盐度色阶、地下水位、作物、覆盖物、潮汐与雨。
(function (root) {
  "use strict";
  var Sim = root.Sim, CFG = root.CONFIG;

  function saltColor(ec) {
    // 低盐深褐 → 高盐泛白结晶
    var k = Math.min(ec / 5, 1);
    var r = Math.round(96 + k * 150);
    var g = Math.round(70 + k * 150);
    var b = Math.round(46 + k * 165);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawCrop(ctx, x, baseY, health, biomass, dead, phase) {
    var h = 26 + biomass * 64;
    var green = dead ? "#7a5a44" : ("rgb(" + Math.round(60 + (1 - health) * 120) + "," +
      Math.round(150 * health + 70) + ",60)");
    ctx.strokeStyle = green; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    var sway = Math.sin(phase) * 4 * biomass;
    ctx.quadraticCurveTo(x + sway, baseY - h * 0.55, x + sway * 1.6, baseY - h);
    ctx.stroke();
    if (!dead) {
      ctx.fillStyle = green;
      for (var i = 0; i < 4; i++) {
        var ly = baseY - h * (0.3 + i * 0.18);
        var dir = i % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(x + dir * (9 + biomass * 6) + sway, ly, 11, 4.5, dir * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (biomass > 0.7) {
        ctx.fillStyle = "#e8c15a";
        ctx.beginPath(); ctx.arc(x + sway * 1.6, baseY - h - 4, 5, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.strokeStyle = "#5b4636"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x - 8, baseY - h * 0.5); ctx.stroke();
    }
  }

  function render(canvas, s, interp, clock) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    var topY = 150, bottomY = H - 40;
    var soilH = bottomY - topY;
    var seaW = 70, soilX = 20, soilW = W - soilX - seaW - 20;
    var phase = clock / 600;

    ctx.clearRect(0, 0, W, H);
    // 天空
    var sky = ctx.createLinearGradient(0, 0, 0, topY);
    sky.addColorStop(0, "#bfe0f5"); sky.addColorStop(1, "#e8f3fb");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, topY);

    var day = Math.floor(s.hour / 24), tod = (s.hour + interp) % 24;
    if (tod >= 6 && tod <= 18) {
      var sunX = soilX + ((tod - 6) / 12) * soilW;
      ctx.fillStyle = "#ffd76b";
      ctx.beginPath(); ctx.arc(sunX, 34 + Math.sin(((tod - 6) / 12) * Math.PI) * -12, 14, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "#3d4c63";
      ctx.fillText("夜间", soilX + 8, 38);
    }

    // 降雨粒子（仅视觉，强度来自确定性天气）
    var wx = s.forecast[Math.min(day, CFG.TOTAL_DAYS - 1)];
    if (wx.rainMm > 0) {
      ctx.strokeStyle = "rgba(70,110,160,.55)"; ctx.lineWidth = 1.5;
      for (var i = 0; i < 26; i++) {
        var rx = (i * 53 + (clock * 0.25) % W) % W;
        var ry = (i * 37 + clock * 0.5) % topY;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 10); ctx.stroke();
      }
    }

    // 四层土壤 + 盐度色
    var ecs = Sim.profileEC(s);
    var acc = 0;
    CFG.LAYERS.forEach(function (L, i) {
      var frac = L.depth / CFG.PROFILE_DEPTH;
      var y0 = topY + acc * soilH, hh = frac * soilH;
      ctx.fillStyle = saltColor(ecs[i]);
      ctx.fillRect(soilX, y0, soilW, hh + 1);
      ctx.fillStyle = "rgba(0,0,0,.25)";
      ctx.font = "12px sans-serif";
      ctx.fillText(L.name + " " + ecs[i].toFixed(2) + " dS/m", soilX + 8, y0 + 18);
      ctx.strokeStyle = "rgba(0,0,0,.3)";
      ctx.strokeRect(soilX, y0, soilW, hh);
      acc += frac;
    });

    // 地下水位（深度 → y 坐标，含帧间平滑）
    var gwFrac = Math.min(s.gwDepth / CFG.GW_MAX_DEPTH, 1);
    var gwY = topY + gwFrac * soilH;
    ctx.fillStyle = "rgba(40,90,160,.35)";
    ctx.fillRect(soilX, gwY, soilW, bottomY - gwY);
    ctx.strokeStyle = "#2b6cb0"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var gx = soilX; gx <= soilX + soilW; gx += 8) {
      ctx.lineTo(gx, gwY + Math.sin(phase * 3 + gx * 0.05) * 2.5);
    }
    ctx.stroke();
    ctx.fillStyle = "#1d4e85"; ctx.font = "12px sans-serif";
    ctx.fillText("地下水位 " + s.gwDepth.toFixed(0) + "mm（咸度 " + s.gwSalt.toFixed(1) + " g/L）", soilX + soilW - 250, gwY - 6);

    // 覆盖物
    if (s.mulchOn) {
      ctx.fillStyle = "#3f3a33";
      ctx.fillRect(soilX, topY - 7, soilW, 7);
      ctx.fillStyle = "#c9b48a"; ctx.font = "11px sans-serif";
      ctx.fillText("秸秆覆盖层（蒸发 -" + Math.round(CFG.MULCH_EVAP_CUT * 100) + "%）", soilX + 8, topY - 10);
    }

    // 作物（3 株代表）
    for (var c = 0; c < 3; c++) {
      var cx = soilX + soilW * (0.25 + c * 0.25);
      drawCrop(ctx, cx, topY, s.crop.health, s.crop.biomass, s.crop.dead, phase + c);
    }

    // 海面与潮汐
    var tideToday = wx.tide;
    var seaLevel = bottomY - 30 - (tideToday.on ? tideToday.level * 22 : 0) - Math.sin(phase * 2) * 3;
    ctx.fillStyle = "#2f7fb5";
    ctx.fillRect(soilX + soilW, seaLevel, seaW, bottomY - seaLevel);
    ctx.fillStyle = "#d7ecfa"; ctx.font = "11px sans-serif";
    ctx.fillText("海", soilX + soilW + 26, seaLevel - 6);
    if (tideToday.on) {
      ctx.fillStyle = "#b5462f";
      ctx.fillText("潮 " + tideToday.level.toFixed(1) + "m", soilX + soilW + 12, seaLevel - 22);
    }

    // 泵与流动指示
    ctx.font = "12px sans-serif";
    if (s.irrigOn) {
      ctx.fillStyle = "#2f6b4f";
      ctx.fillText("💧 灌溉泵运行 " + CFG.IRR_RATE_MM_H + "mm/h", soilX + 8, 24);
    }
    if (s.drainOn) {
      ctx.fillStyle = "#8a5a1d";
      ctx.fillText("⛏ 排水泵运行", soilX + 160, 24);
    }

    // 顶部时间与状态
    ctx.fillStyle = "#132433";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("地块 " + s.plotId + " · " + s.cultivar + " · " + Sim.timeLabel(s.hour) +
      " / 第" + CFG.TOTAL_DAYS + "天", soilX, H - 14);
    var stText = s.status === "running" ? "进行中" : (s.status === "success" ? "治理成功" : "治理失败");
    ctx.fillStyle = s.status === "success" ? "#2f8f4f" : (s.status === "failed" ? "#c0392b" : "#33475b");
    ctx.fillText(stText, W - 90, H - 14);
  }

  root.Renderer = { render: render, saltColor: saltColor };
})(typeof window !== "undefined" ? window : globalThis);
