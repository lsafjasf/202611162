const cameraKeyframes = (variant) => {
  const paths = {
    A: [
      { t: 0, position: { x: 0.0, y: 2.8, z: 10.8 }, target: { x: 0, y: 1.2, z: 0 }, fov: 40 },
      { t: 8.2, position: { x: 0.32, y: 2.65, z: 10.25 }, target: { x: 0.05, y: 1.18, z: 0 }, fov: 39 },
      { t: 16.5, position: { x: -0.18, y: 2.55, z: 9.9 }, target: { x: -0.03, y: 1.12, z: 0 }, fov: 38 },
    ],
    B: [
      { t: 0, position: { x: 4.7, y: 2.1, z: 4.55 }, target: { x: 0, y: 1.05, z: 0 }, fov: 34 },
      { t: 8.2, position: { x: 4.15, y: 2.22, z: 4.15 }, target: { x: -0.05, y: 1.1, z: 0 }, fov: 33 },
      { t: 16.5, position: { x: 4.45, y: 2.0, z: 4.8 }, target: { x: 0.05, y: 1.13, z: 0 }, fov: 35 },
    ],
    C: [
      { t: 0, position: { x: -5.05, y: 3.05, z: 3.9 }, target: { x: -0.1, y: 0.95, z: 0 }, fov: 43 },
      { t: 8.2, position: { x: -4.65, y: 3.2, z: 3.55 }, target: { x: 0.08, y: 1.02, z: 0 }, fov: 42 },
      { t: 16.5, position: { x: -4.9, y: 2.9, z: 4.15 }, target: { x: 0, y: 0.98, z: 0 }, fov: 44 },
    ],
  };
  return paths[variant];
};

export const CAMERA_COLORS = {
  A: "#66e3ff",
  B: "#ffcf66",
  C: "#fe7bb4",
};

export const createDefaultProject = () => ({
  schemaVersion: 1,
  id: "night-orbit-session-01",
  title: "夜航 · 现场版",
  createdAt: "2026-11-16T00:00:00.000Z",
  updatedAt: "2026-11-16T00:00:00.000Z",
  fps: 30,
  inPoint: 0,
  outPoint: 16.5,
  loop: true,
  activeScene: "aurora",
  scenes: [
    {
      id: "aurora",
      name: "极光",
      code: "SCENE 01 · AURORA",
      note: "极光穿过舞台，环境声为合成氛围。",
      colors: ["#66e3ff", "#8c7dff", "#fe7bb4"],
      sky: ["#071019", "#101126", "#090a10"],
    },
    {
      id: "ember",
      name: "余烬",
      code: "SCENE 02 · EMBER",
      note: "低频余烬升温，视觉节奏保持不变。",
      colors: ["#ffcf66", "#ff7a5c", "#55e0d1"],
      sky: ["#140c0a", "#1a1112", "#090a10"],
    },
  ],
  cameras: [
    {
      id: "A",
      name: "CAM A",
      role: "WIDE",
      lens: "24mm",
      color: CAMERA_COLORS.A,
      keyframes: cameraKeyframes("A"),
    },
    {
      id: "B",
      name: "CAM B",
      role: "CLOSE",
      lens: "50mm",
      color: CAMERA_COLORS.B,
      keyframes: cameraKeyframes("B"),
    },
    {
      id: "C",
      name: "CAM C",
      role: "SIDE",
      lens: "35mm",
      color: CAMERA_COLORS.C,
      keyframes: cameraKeyframes("C"),
    },
  ],
  cuts: [
    { id: "cut-01", t: 0, camera: "A", transition: { type: "none", duration: 0 } },
    { id: "cut-02", t: 3.6, camera: "B", transition: { type: "dissolve", duration: 0.55 } },
    { id: "cut-03", t: 7.2, camera: "C", transition: { type: "whip", duration: 0.45 } },
    { id: "cut-04", t: 10.8, camera: "A", transition: { type: "wipe", duration: 0.6 } },
    { id: "cut-05", t: 13.2, camera: "B", transition: { type: "dissolve", duration: 0.5 } },
  ],
  subtitles: [
    { id: "sub-01", start: 0.6, end: 3.3, text: "夜色在轨道上醒来" },
    { id: "sub-02", start: 3.9, end: 6.9, text: "灯光穿过每一帧，节拍落在切点" },
    { id: "sub-03", start: 7.5, end: 10.5, text: "我们沿着同一束光，换一个角度看舞台" },
    { id: "sub-04", start: 11.1, end: 13.0, text: "三台相机，一条不会中断的时间线" },
    { id: "sub-05", start: 13.5, end: 16.2, text: "现在，让画面和声音一起呼吸" },
  ],
  audio: {
    start: 0,
    bpm: 100,
    beatsPerBar: 4,
    source: "Web Audio · ambient synth",
    gain: 0.72,
  },
  export: {
    width: 1280,
    height: 720,
    fps: 30,
  },
});
