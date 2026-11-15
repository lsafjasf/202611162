// 全局可调参数与判定阈值。
(function (root) {
  "use strict";

  var HOURS = 24;
  var TOTAL_DAYS = 30;
  var TOTAL_HOURS = TOTAL_DAYS * HOURS;

  // 四层土壤剖面（深度单位 mm），index 0 为表层。
  var LAYERS = [
    { name: "耕作层", depth: 200, porosity: 0.45, fc: 0.24, wp: 0.10 },
    { name: "根区层", depth: 300, porosity: 0.43, fc: 0.23, wp: 0.10 },
    { name: "过渡层", depth: 300, porosity: 0.40, fc: 0.22, wp: 0.09 },
    { name: "底土层", depth: 400, porosity: 0.38, fc: 0.21, wp: 0.08 }
  ];
  var ROOT_LAYERS = 2; // 根区 = 前两层
  var PROFILE_DEPTH = LAYERS.reduce(function (s, l) { return s + l.depth; }, 0); // 1200mm

  var CONFIG = {
    HOURS_PER_DAY: HOURS,
    TOTAL_DAYS: TOTAL_DAYS,
    TOTAL_HOURS: TOTAL_HOURS,
    LAYERS: LAYERS,
    ROOT_LAYERS: ROOT_LAYERS,
    PROFILE_DEPTH: PROFILE_DEPTH,
    PLOT_AREA_M2: 100, // 模拟地块面积
    MM_PER_M3: 10, // 1 m³ 铺在 100 m² 上 = 10mm
    SEAWATER_SALT: 35.0, // 海水盐分 g/L
    DRAIN_SALT: 1.2, // 排水略富集（g/L 基准，按层浓度另算）

    // 初始资源
    INIT: {
      water: 60, // m³
      energy: 340, // kWh
      mulch: 6, // 片
      gwDepth: 1050 // mm，地下水位距地表
    },

    // 泵与覆盖物
    IRR_RATE_MM_H: 8, // 每小时灌水 8mm
    IRR_ENERGY_H: 1.2, // kWh/小时
    DRAIN_RATE_MM_H: 34,
    DRAIN_ENERGY_H: 2.0,
    MULCH_EVAP_CUT: 0.75, // 覆盖后蒸发下降比例

    // 水盐运移（每小时系数）
    PERCOL_K: 0.18, // 超田间持水时下渗
    CAPILLARY_K: 0.05, // 毛细上升
    GW_DRAIN_H: 1.2, // 自然出流使水位下降 mm/h（集中参数平衡）
    GW_MAX_DEPTH: 1500, // 地下水位距地表上限 mm
    GW_MIN_DEPTH: 250,
    EVAP_BASE_MM_H: 0.32,
    TRAN_BASE_MM_H: 0.22,

    // 天气
    RAIN_PROB: 0.34,
    RAIN_MEAN_MM: 9,
    TIDE_PROB: 0.16,
    TIDE_LEVEL_MEAN: 1.0,
    PET_MEAN_MM_D: 5.2,

    // 作物
    CROP: {
      health0: 0.96,
      biomass0: 0.30,
      targetBiomass: 0.80,
      minHealth: 0.45,
      deathHealth: 0.05,
      ecStress: 2.2, // dS/m 开始受盐胁迫
      ecSevere: 4.5,
      gwStress: 700, // 地下水位浅于该深度开始渍水缺氧
      gwSevere: 400,
      waterStress: 0.12, // 根区体积含水率低于该值受旱
      growthRate: 0.030 // 无胁迫时每日生物量增量
    },

    // 成功判定（30 天结束）
    WIN: {
      maxRootEC: 2.0,
      maxGWDepthRise: 600, // 地下水位距地表不得浅于 600mm
      minBiomass: 0.80,
      minHealth: 0.70
    },

    // 触发阈值（策略与报告共用）
    THRESHOLDS: {
      ecHigh: 2.4,
      ecCritical: 3.5,
      gwShallow: 700,
      gwCritical: 500,
      waterLow: 12,
      energyLow: 40
    },

    // 恢复代价单价（元）
    PRICE: { water: 0.8, energy: 0.65, mulch: 12 }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
  } else {
    root.CONFIG = CONFIG;
  }
})(typeof window !== "undefined" ? window : globalThis);
