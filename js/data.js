export const OFFSET_LIMIT = 18;
export const OFFSET_WARN = 10;

export const CARTONS = {
  S: {
    id: "S",
    label: "S 紧凑",
    short: "S",
    dims: [280, 210, 150],
    volume: 8_820_000,
    note: "280×210×150"
  },
  M: {
    id: "M",
    label: "M 标准",
    short: "M",
    dims: [360, 280, 220],
    volume: 22_176_000,
    note: "360×280×220"
  },
  L: {
    id: "L",
    label: "L 大件",
    short: "L",
    dims: [450, 350, 300],
    volume: 47_250_000,
    note: "450×350×300"
  }
};

export const BUFFERS = {
  none: {
    id: "none",
    label: "无缓冲",
    short: "无",
    level: 0,
    thickness: 0,
    note: "紧贴纸箱"
  },
  foam: {
    id: "foam",
    label: "EPE 泡棉",
    short: "泡棉",
    level: 1,
    thickness: 12,
    note: "12 mm 回弹"
  },
  honey: {
    id: "honey",
    label: "蜂窝纸",
    short: "蜂窝",
    level: 2,
    thickness: 18,
    note: "18 mm 抗压"
  }
};

export const TAPE_PATHS = {
  H: { id: "H", label: "H 型", note: "单道横封" },
  C: { id: "C", label: "C 型", note: "双侧包边" },
  X: { id: "X", label: "X 型", note: "交叉加固" }
};

export const ORDERS = [
  {
    id: "ORD-2401",
    code: "GB-210",
    name: "微型齿轮箱",
    dims: [210, 160, 100],
    targetBox: "S",
    targetBuffer: "none",
    targetTape: "H",
    fragility: 1,
    mass: 4.2,
    accent: "#e8ad54",
    shape: "gear"
  },
  {
    id: "ORD-2402",
    code: "SN-245",
    name: "压力传感器",
    dims: [245, 175, 115],
    targetBox: "S",
    targetBuffer: "foam",
    targetTape: "H",
    fragility: 2,
    mass: 2.8,
    accent: "#6c9ee8",
    shape: "sensor"
  },
  {
    id: "ORD-2403",
    code: "CT-295",
    name: "控制模块",
    dims: [295, 220, 150],
    targetBox: "M",
    targetBuffer: "foam",
    targetTape: "H",
    fragility: 2,
    mass: 7.6,
    accent: "#7fb99e",
    shape: "module"
  },
  {
    id: "ORD-2404",
    code: "PM-230",
    name: "伺服泵体",
    dims: [230, 160, 110],
    targetBox: "S",
    targetBuffer: "foam",
    targetTape: "X",
    fragility: 3,
    mass: 11.4,
    accent: "#de7654",
    shape: "pump"
  },
  {
    id: "ORD-2405",
    code: "MT-255",
    name: "直流电机",
    dims: [255, 205, 165],
    targetBox: "M",
    targetBuffer: "honey",
    targetTape: "H",
    fragility: 3,
    mass: 14.8,
    accent: "#b59bd9",
    shape: "motor"
  },
  {
    id: "ORD-2406",
    code: "VL-190",
    name: "精密阀组",
    dims: [190, 130, 90],
    targetBox: "S",
    targetBuffer: "honey",
    targetTape: "C",
    fragility: 3,
    mass: 3.9,
    accent: "#e3cf5f",
    shape: "valve"
  },
  {
    id: "ORD-2407",
    code: "DR-280",
    name: "驱动控制器",
    dims: [280, 210, 145],
    targetBox: "M",
    targetBuffer: "foam",
    targetTape: "X",
    fragility: 2,
    mass: 8.7,
    accent: "#5eaeb8",
    shape: "drive"
  },
  {
    id: "ORD-2408",
    code: "LR-315",
    name: "线性导轨",
    dims: [315, 135, 100],
    targetBox: "M",
    targetBuffer: "honey",
    targetTape: "C",
    fragility: 3,
    mass: 9.2,
    accent: "#c889ab",
    shape: "rail"
  }
];

export const PHASES = [
  { id: "scan", label: "扫码", duration: 440, devices: ["scanner", "conveyor"] },
  { id: "feed", label: "入箱", duration: 680, devices: ["roboticArm", "conveyor"] },
  { id: "buffer", label: "缓冲", duration: 500, devices: ["bufferDispenser"] },
  { id: "seal", label: "封口", duration: 720, devices: ["sealer"] },
  { id: "eject", label: "下线", duration: 420, devices: ["conveyor"] }
];

export const DEVICES = {
  conveyor: { id: "CV-01", name: "输送机", power: 0.8 },
  scanner: { id: "SCN-01", name: "扫码器", power: 0.3 },
  roboticArm: { id: "ARM-01", name: "机械臂", power: 2.6 },
  bufferDispenser: { id: "BUF-01", name: "缓冲仓", power: 0.7 },
  sealer: { id: "SEAL-02", name: "封口器", power: 3.4 }
};

export const SCENARIOS = {
  normal: {
    id: "normal",
    label: "正常生产",
    description: "8 箱全检通过"
  },
  fault: {
    id: "fault",
    label: "设备故障",
    description: "封口器联锁 + 恢复复检"
  },
  limit: {
    id: "limit",
    label: "参数越限",
    description: "机械臂偏置触发值"
  }
};

export function recommendedRecipe(order) {
  return {
    boxSize: order.targetBox,
    buffer: order.targetBuffer,
    tapePath: order.targetTape
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
