import { HEIGHT_SCALE_METERS, digestString } from "./terrain-engine.js";
import { renderProfile, renderTerrain } from "./terrain-renderer.js";

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawMonogram(context, x, y) {
  context.save();
  context.strokeStyle = "#182925";
  context.lineWidth = 1.2;
  context.beginPath();
  context.arc(x + 16, y + 16, 16, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#182925";
  for (let index = 0; index < 3; index += 1) {
    const height = [7, 14, 5][index];
    context.save();
    context.translate(x + 9 + index * 5, y + 26 - height);
    context.transform(1, -0.24, 0, 1, 0, 0);
    context.fillRect(0, 0, 3, height);
    context.restore();
  }
  context.restore();
}

function drawPanel(context, x, y, width, height, dark) {
  context.save();
  context.shadowColor = "rgba(20, 35, 30, 0.14)";
  context.shadowBlur = 32;
  context.shadowOffsetY = 14;
  context.fillStyle = dark ? "#081c1c" : "#f7f2e7";
  roundRect(context, x, y, width, height, 20);
  context.fill();
  context.restore();
}

function formatElevation(value) {
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

export function createScreenshotDataURL({
  terrain,
  section,
  camera,
  time,
  playing,
  cursorFraction,
  digests,
}) {
  const width = 1600;
  const height = 1000;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");

  const paper = context.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#eee9dd");
  paper.addColorStop(0.58, "#e6e0d2");
  paper.addColorStop(1, "#ded8c9");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(81, 104, 77, 0.08)";
  context.beginPath();
  context.arc(1480, 85, 270, 0, Math.PI * 2);
  context.fill();

  drawMonogram(context, 56, 40);
  context.fillStyle = "#142320";
  context.font = '500 30px "Iowan Old Style", Georgia, "Noto Serif SC", serif';
  context.fillText("RIDGELINE", 100, 66);
  context.fillStyle = "#6a7570";
  context.font = '600 9px "SFMono-Regular", Menlo, monospace';
  context.fillText("TERRAIN SECTION LAB / EXPORT", 102, 82);
  context.textAlign = "right";
  context.fillStyle = "#3c4b46";
  context.font = '600 9px "SFMono-Regular", Menlo, monospace';
  context.fillText(
    `${playing ? "LIVE PREVIEW" : "FROZEN PREVIEW"}  ·  MESH ${digests.geometry}  ·  PROFILE ${digests.profile}`,
    width - 56,
    57,
  );
  context.fillStyle = "#7a837e";
  context.font = '8px "SFMono-Regular", Menlo, monospace';
  context.fillText(`STRUCTURE ${digests.structural}  /  SEED ${terrain.params.seed}`, width - 56, 77);

  context.textAlign = "left";
  context.fillStyle = "#142320";
  context.font = '500 46px "Iowan Old Style", Georgia, "Noto Serif SC", serif';
  context.fillText("地形与剖面的同一份几何", 56, 138);
  context.fillStyle = "#69746f";
  context.font = '10px "SFMono-Regular", Menlo, monospace';
  context.fillText(
    `PEAK ${formatElevation(terrain.stats.peak.elevation)}  ·  SECTION ${Math.round(section.angle)}° / OFFSET ${section.offset.toFixed(2)}  ·  ${terrain.counts.triangles.toLocaleString("en-US")} TRIANGLES`,
    58,
    159,
  );

  drawPanel(context, 48, 186, 1030, 690, true);
  drawPanel(context, 1102, 186, 450, 690, false);

  const terrainCanvas = document.createElement("canvas");
  renderTerrain(terrainCanvas, {
    terrain,
    section,
    camera,
    highlight: null,
    time,
    width: 1014,
    height: 660,
    ratio: 1,
  });
  context.drawImage(terrainCanvas, 56, 202);

  context.fillStyle = "rgba(5, 22, 21, 0.8)";
  roundRect(context, 75, 219, 150, 27, 13);
  context.fill();
  context.fillStyle = "rgba(210, 244, 218, 0.78)";
  context.font = '600 8px "SFMono-Regular", Menlo, monospace';
  context.fillText("01 / TERRAIN FIELD", 92, 236);
  context.fillStyle = "#f4f0e5";
  context.font = '500 30px "Iowan Old Style", Georgia, "Noto Serif SC", serif';
  context.fillText("立体地形", 76, 285);

  context.fillStyle = "rgba(6, 24, 24, 0.82)";
  context.strokeStyle = "rgba(194, 228, 207, 0.15)";
  roundRect(context, 76, 824, 408, 32, 7);
  context.fill();
  context.stroke();
  context.textAlign = "left";
  context.fillStyle = "rgba(211, 236, 218, 0.48)";
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  context.fillText(
    `YAW ${Math.round(camera.yaw)}°   EL ${Math.round(camera.pitch)}°   ZOOM ${camera.zoom.toFixed(2)}×   GRID ${terrain.params.resolution + 1}²`,
    91,
    844,
  );

  context.fillStyle = "#67736d";
  context.font = '600 8px "SFMono-Regular", Menlo, monospace';
  context.fillText("02 / CROSS SECTION", 1129, 226);
  context.fillStyle = "#142320";
  context.font = '500 31px "Iowan Old Style", Georgia, "Noto Serif SC", serif';
  context.fillText("地形剖面", 1127, 263);
  context.fillStyle = "#78837d";
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  context.textAlign = "right";
  context.fillText("SCREEN / SVG SHARED SOURCE", 1524, 227);

  const profileCanvas = document.createElement("canvas");
  renderProfile(profileCanvas, {
    terrain,
    section,
    cursorFraction,
    time,
    width: 416,
    height: 424,
    ratio: 1,
  });
  context.textAlign = "left";
  context.fillStyle = "#f3efe4";
  roundRect(context, 1121, 285, 412, 428, 8);
  context.fill();
  context.drawImage(profileCanvas, 1119, 281);
  context.strokeStyle = "rgba(19, 33, 31, 0.12)";
  roundRect(context, 1119, 281, 416, 432, 5);
  context.stroke();

  const summary = [
    ["剖面最高", formatElevation(section.maxSample.elevation)],
    ["剖线长度", `${(section.lengthMeters / 1000).toFixed(2)} km`],
    ["采样点", `${section.samples.length}`],
  ];
  summary.forEach(([label, value], index) => {
    const x = 1129 + index * 135;
    context.fillStyle = "#7c8580";
    context.font = '7px "SFMono-Regular", Menlo, "Noto Sans SC", monospace';
    context.fillText(label, x, 746);
    context.fillStyle = "#1c302a";
    context.font = '500 18px "Iowan Old Style", Georgia, "Noto Serif SC", serif';
    context.fillText(value, x, 768);
  });

  context.fillStyle = "#eef4e9";
  roundRect(context, 1121, 791, 412, 57, 7);
  context.fill();
  context.fillStyle = "#65714d";
  context.font = '600 7px "SFMono-Regular", Menlo, monospace';
  context.fillText("LINKED CURSOR", 1137, 808);
  context.fillStyle = "#263a31";
  context.font = '600 10px "SFMono-Regular", Menlo, monospace';
  if (Number.isFinite(cursorFraction)) {
    const sample = cursorFraction;
    const elevation = section.samples[Math.round(sample * (section.samples.length - 1))].elevation;
    context.fillText(`T ${sample.toFixed(3)} · ${formatElevation(elevation)}`, 1137, 827);
  } else {
    context.fillText("NO CURSOR PINNED", 1137, 827);
  }

  context.fillStyle = "#7a837e";
  context.font = '8px "SFMono-Regular", Menlo, monospace';
  context.fillText(
    `MESH ${terrain.geometryDigest} / ${terrain.counts.triangles.toLocaleString("en-US")} TRIANGLES`,
    56,
    928,
  );
  context.fillText(`PROFILE ${section.profileDigest} / ${section.samples.length} SAMPLES`, 56, 946);
  context.textAlign = "right";
  context.fillText(
    `RENDER ORDER ${digests.renderOrder} / DETERMINISTIC DEPTH SORT`,
    width - 56,
    928,
  );
  context.fillText(`STRUCTURE ${digests.structural}`, width - 56, 946);
  context.fillStyle = "rgba(20, 35, 32, 0.32)";
  context.fillRect(56, 966, width - 112, 1);
  context.fillStyle = "#6f7b75";
  context.font = '7px "SFMono-Regular", Menlo, monospace';
  context.textAlign = "left";
  context.fillText(
    `RIDGELINE · ALL PIXELS GENERATED FROM CODE · ${Math.round(terrain.stats.meanElevation)} M MEAN ELEVATION`,
    56,
    986,
  );
  context.textAlign = "right";
  context.fillText(
    `RELIEF ${Math.round(terrain.stats.relief)} M · HEIGHT SCALE ${HEIGHT_SCALE_METERS} M`,
    width - 56,
    986,
  );

  const dataURL = output.toDataURL("image/png");
  return {
    dataURL,
    width,
    height,
    pixelDigest: digestString(dataURL),
  };
}
