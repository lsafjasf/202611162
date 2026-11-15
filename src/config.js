export const CONFIG = {
  timeLimit: 240,
  fuelMax: 130,
  startPoles: 3,

  accel: 118,
  reverseAccel: 70,
  brake: 165,
  maxSpeed: 215,
  maxReverse: 70,
  turnRate: 2.35,
  steeringReturn: 3.1,

  windAccel: 34,
  maxWind: 1.0,
  windInterval: 1.0,

  fuelDriving: 1.25,
  fuelIdle: 0.22,
  collisionStrandSpeed: 128,

  calibrateTime: 1.5,
  calibrationRange: 170,
  maxCompassError: 0.42,
  calibrationError: 0.03,
  windErrorGain: 0.012,

  recoverFuelCost: 6,
  recoverTimeCost: 5,
  recoverCooldown: 2,

  targetRange: 64,
  pickupRange: 60,
  landmarkRange: 170,
  vehicleRadius: 16,
  pathInterval: 0.25,
  rutInterval: 0.06,
  maxRuts: 1400,
  maxEvents: 40,
  // 仅用于自动化测试：关闭随机风，保证脚本路径稳定。
  noWind: false
};

export const STATUS = {
  DRIVING: 'driving',
  PAUSED: 'paused',
  STRANDED: 'stranded',
  WON: 'won',
  FAILED: 'failed'
};
