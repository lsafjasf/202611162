// 默认工程：两个场景，每个场景含横屏/方形/竖屏三个片段。

export const SOURCE_W = 960;
export const SOURCE_H = 540;
export const SCENE_DURATION = 6;

export const ASPECTS = {
  landscape: { ratio: 16 / 9, label: '横屏 16:9', out: [480, 270] },
  square: { ratio: 1, label: '方形 1:1', out: [360, 360] },
  portrait: { ratio: 9 / 16, label: '竖屏 9:16', out: [270, 480] },
};

function sceneA() {
  return {
    id: 'scene-a',
    name: '场景 A · 弹跳球',
    duration: SCENE_DURATION,
    subjects: [
      {
        id: 'orb', shape: 'circle', color: '#ffb02e', radius: 58,
        keyframes: [
          { t: 0, x: 420, y: 180, r: 58, rot: 0 },
          { t: 2, x: 470, y: 360, r: 58, rot: 2.2 },
          { t: 4, x: 520, y: 200, r: 58, rot: 4.4 },
          { t: 6, x: 540, y: 340, r: 58, rot: 6.6 },
        ],
      },
      {
        id: 'block', shape: 'square', safe: false, color: '#4cc2ff', radius: 42,
        keyframes: [
          { t: 0, x: 580, y: 420, r: 42, rot: 0 },
          { t: 3, x: 500, y: 150, r: 42, rot: 1.4 },
          { t: 6, x: 420, y: 320, r: 42, rot: 2.8 },
        ],
      },
    ],
    subtitles: [
      { id: 's1', start: 0.2, end: 2.6, text: '开场：主体进入安全区' },
      { id: 's2', start: 2.8, end: 5.8, text: '跟随：裁剪框锁定主体' },
    ],
    audio: {
      bpm: 120,
      beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5],
      cues: [
        { t: 0, freq: 880, name: 'start' },
        { t: 2.0, freq: 1320, name: 'bounce-1' },
        { t: 4.0, freq: 1320, name: 'bounce-2' },
      ],
      startAt: 0,
    },
    clips: [
      { id: 'landscape', aspect: 'landscape', inPoint: 0.4, outPoint: 4.4,
        crop: { x: 60, y: 40, w: 840, h: 472.5 },
        transition: { fadeIn: 0.25, fadeOut: 0.25 } },
      { id: 'square', aspect: 'square', inPoint: 1.2, outPoint: 5.2,
        crop: { x: 300, y: 30, w: 480, h: 480 },
        transition: { fadeIn: 0.2, fadeOut: 0.2 } },
      { id: 'portrait', aspect: 'portrait', inPoint: 2.0, outPoint: 5.6,
        crop: { x: 356.62, y: 28.35, w: 264, h: 469.33 },
        transition: { fadeIn: 0.15, fadeOut: 0.3 } },
    ],
  };
}

function sceneB() {
  return {
    id: 'scene-b',
    name: '场景 B · 旋转方块',
    duration: SCENE_DURATION,
    subjects: [
      {
        id: 'orb', shape: 'circle', color: '#7ee06b', radius: 50,
        keyframes: [
          { t: 0, x: 430, y: 380, r: 50, rot: 0 },
          { t: 2, x: 480, y: 180, r: 50, rot: 2.0 },
          { t: 4, x: 530, y: 340, r: 50, rot: 4.0 },
          { t: 6, x: 460, y: 160, r: 50, rot: 6.0 },
        ],
      },
      {
        id: 'block', shape: 'square', safe: false, color: '#ff7ad9', radius: 46,
        keyframes: [
          { t: 0, x: 560, y: 150, r: 46, rot: 0 },
          { t: 3, x: 400, y: 380, r: 46, rot: 2.1 },
          { t: 6, x: 540, y: 300, r: 46, rot: 4.2 },
        ],
      },
    ],
    subtitles: [
      { id: 's1', start: 0.4, end: 3.0, text: '第二场景：全新关键帧' },
      { id: 's2', start: 3.2, end: 5.9, text: '切场景后音频不会延续' },
    ],
    audio: {
      bpm: 96,
      beats: [0, 0.625, 1.25, 1.875, 2.5, 3.125, 3.75, 4.375, 5, 5.625],
      cues: [
        { t: 0, freq: 660, name: 'scene-b-start' },
        { t: 3.0, freq: 990, name: 'spin' },
      ],
      startAt: 0,
    },
    clips: [
      { id: 'landscape', aspect: 'landscape', inPoint: 0.2, outPoint: 4.0,
        crop: { x: 80, y: 60, w: 800, h: 450 },
        transition: { fadeIn: 0.2, fadeOut: 0.2 } },
      { id: 'square', aspect: 'square', inPoint: 1.0, outPoint: 4.8,
        crop: { x: 260, y: 40, w: 460, h: 460 },
        transition: { fadeIn: 0.25, fadeOut: 0.25 } },
      { id: 'portrait', aspect: 'portrait', inPoint: 1.6, outPoint: 5.4,
        crop: { x: 331.0, y: 36.22, w: 272, h: 483.56 },
        transition: { fadeIn: 0.3, fadeOut: 0.2 } },
    ],
  };
}

export function createDefaultProject() {
  return {
    version: 1,
    activeSceneId: 'scene-a',
    loop: true,
    muted: false,
    scenes: [sceneA(), sceneB()],
  };
}
