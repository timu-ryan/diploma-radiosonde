/**
 * Аэрологическая диаграмма: термодинамика бланка (адиабаты, линии массовой доли,
 * стандартная атмосфера) и обработка профиля — то, что можно получить из температуры
 * и ветра на изобарических уровнях. Влажности в прогнозе нет, поэтому точки росы,
 * уровня конденсации, кривой состояния и индексов гроз здесь нет.
 */
import { normalizeDeg, windToVector } from './geo.js';
import type {
  AeroAnalysis,
  AeroIsotherm,
  AeroLayer,
  AeroLevel,
  AeroMaxWind,
  AeroMeanWind,
  AeroStableLayer,
  AeroTropopause,
  AeroTurbulence,
  TrajectoryRow,
} from './types.js';

/** Газовая постоянная сухого воздуха, Дж/(кг·К). */
export const RD = 287.04;
/** Теплоёмкость сухого воздуха при постоянном давлении, Дж/(кг·К). */
export const CP = 1005.7;
export const KAPPA = RD / CP;
/** Удельная теплота парообразования, Дж/кг. */
export const LV = 2.501e6;
/** Отношение молярных масс водяного пара и сухого воздуха. */
export const EPSILON = 0.622;
/** Ускорение свободного падения, м/с². */
export const G = 9.80665;
export const ZERO_C_K = 273.15;

/** Давление насыщенного пара над водой, гПа (формула Bolton, 1980). */
export function saturationVaporPressure(tempC: number): number {
  return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
}

/** Насыщающая массовая доля (отношение смеси), кг/кг. */
export function saturationMixingRatio(tempC: number, mb: number): number {
  const e = saturationVaporPressure(tempC);
  return (EPSILON * e) / (mb - e);
}

/** Потенциальная температура, K. */
export function potentialTemperature(tempC: number, mb: number): number {
  return (tempC + ZERO_C_K) * (1000 / mb) ** KAPPA;
}

/** Температура на сухой адиабате с потенциальной температурой `thetaK` при давлении `mb`, °C. */
export function dryAdiabatTemp(thetaK: number, mb: number): number {
  return thetaK * (mb / 1000) ** KAPPA - ZERO_C_K;
}

/** Температура, при которой насыщающая массовая доля равна `gPerKg` (г/кг), °C. */
export function mixingRatioTemp(gPerKg: number, mb: number): number {
  const w = gPerKg / 1000;
  const e = (w * mb) / (EPSILON + w);
  const l = Math.log(e / 6.112);
  return (243.5 * l) / (17.67 - l);
}

/** dT/dp на псевдоадиабате, К/гПа. */
function moistLapse(tempK: number, mb: number): number {
  const rs = saturationMixingRatio(tempK - ZERO_C_K, mb);
  return (
    (RD * tempK + LV * rs) /
    (mb * (CP + (LV * LV * rs * EPSILON) / (RD * tempK * tempK)))
  );
}

export interface PressureTemp {
  mb: number;
  tempC: number;
}

/**
 * Влажная (псевдо)адиабата из точки (`tempC`, `fromMb`) до `toMb`:
 * интегрирование по давлению методом средней точки с шагом `stepMb`.
 */
export function moistAdiabat(tempC: number, fromMb: number, toMb: number, stepMb = 5): PressureTemp[] {
  const sign = toMb < fromMb ? -1 : 1;
  let tempK = tempC + ZERO_C_K;
  let mb = fromMb;
  const points: PressureTemp[] = [{ mb, tempC }];

  while (sign * (toMb - mb) > 1e-9) {
    const dp = sign * Math.min(stepMb, Math.abs(toMb - mb));
    const half = moistLapse(tempK, mb);
    tempK += moistLapse(tempK + (half * dp) / 2, mb + dp / 2) * dp;
    mb += dp;
    points.push({ mb, tempC: tempK - ZERO_C_K });
  }
  return points;
}

/** Газовая постоянная и градиент стандартной атмосферы ГОСТ 4401-81 (совпадает с ISA). */
const ISA_R = 287.05287;
const ISA_LAPSE = 0.0065;
const ISA_T0 = 288.15;
const ISA_P0 = 1013.25;
const ISA_TROPOPAUSE_M = 11_000;
const ISA_T11 = ISA_T0 - ISA_LAPSE * ISA_TROPOPAUSE_M;
const ISA_P11 = ISA_P0 * (ISA_T11 / ISA_T0) ** (G / (ISA_R * ISA_LAPSE));

/** Стандартная атмосфера (СА-81) на геопотенциальной высоте до 20 км. */
export function standardAtmosphere(heightM: number): PressureTemp {
  if (heightM <= ISA_TROPOPAUSE_M) {
    const tempK = ISA_T0 - ISA_LAPSE * heightM;
    return { mb: ISA_P0 * (tempK / ISA_T0) ** (G / (ISA_R * ISA_LAPSE)), tempC: tempK - ZERO_C_K };
  }
  return {
    mb: ISA_P11 * Math.exp((-G * (heightM - ISA_TROPOPAUSE_M)) / (ISA_R * ISA_T11)),
    tempC: ISA_T11 - ZERO_C_K,
  };
}

// --- Обработка профиля ------------------------------------------------------------------------

/** Изотермы, высоты которых отмечаются на диаграмме, °C. */
export const AERO_ISOTHERMS_C: readonly number[] = [0, -10, -20];
/** Нижняя граница струйного течения, м/с (≈108 км/ч). */
export const JET_MIN_SPEED_MS = 30;
/** Число Ричардсона, ниже которого слой считается турбулентным (для грубой сетки уровней). */
export const TURBULENCE_RI = 1;
/** Градиент температуры на тропопаузе — не больше, °C/км (критерий ВМО). */
export const TROPOPAUSE_LAPSE = 2;
const TROPOPAUSE_DEPTH_M = 2000;
/** Тропопауза ищется только выше этого уровня, гПа. */
const TROPOPAUSE_MAX_MB = 500;
/** Вторая тропопауза — после слоя толщиной от 1 км с градиентом больше 3 °C/км. */
const SECOND_TROPOPAUSE_LAPSE = 3;
const SECOND_TROPOPAUSE_DEPTH_M = 1000;
/** Разница температур, которая ещё считается изотермией, °C (при билинейной выборке T дробная). */
const ISOTHERM_TOLERANCE_C = 0.1;

/** Вертикальный градиент температуры между уровнями, °C/км (положительный — убывание с высотой). */
const lapse = (lower: AeroLevel, upper: AeroLevel): number =>
  (-(upper.tempC - lower.tempC) / (upper.heightM - lower.heightM)) * 1000;

/** Давление на доле `t` высоты между уровнями: ln p линейно по высоте. */
const mbBetween = (lower: AeroLevel, upper: AeroLevel, t: number): number =>
  Math.exp(Math.log(lower.mb) + (Math.log(upper.mb) - Math.log(lower.mb)) * t);

/** Граница слоя на доле `t` между уровнями. */
function pointBetween(lower: AeroLevel, upper: AeroLevel, t: number): { heightM: number; mb: number } {
  return {
    heightM: lower.heightM + (upper.heightM - lower.heightM) * t,
    mb: mbBetween(lower, upper, t),
  };
}

const layerOf = (lower: AeroLevel, upper: AeroLevel): AeroLayer => ({
  fromHeightM: lower.heightM,
  toHeightM: upper.heightM,
  fromMb: lower.mb,
  toMb: upper.mb,
});

/** Уровень `i` — тропопауза: градиент над ним и средний градиент до уровней в 2 км выше ≤ 2 °C/км. */
function isTropopause(levels: AeroLevel[], i: number): boolean {
  const base = levels[i] as AeroLevel;
  if (i + 1 >= levels.length) return false;
  for (let j = i + 1; j < levels.length; j += 1) {
    const top = levels[j] as AeroLevel;
    if (j > i + 1 && top.heightM - base.heightM > TROPOPAUSE_DEPTH_M) break;
    if (lapse(base, top) > TROPOPAUSE_LAPSE) return false;
  }
  return true;
}

/** Индекс уровня, выше которого начинается поиск второй тропопаузы, или −1. */
function nextTroposphereAbove(levels: AeroLevel[], from: number): number {
  for (let k = from + 1; k < levels.length; k += 1) {
    const base = levels[k] as AeroLevel;
    const top = levels.find((l) => l.heightM - base.heightM >= SECOND_TROPOPAUSE_DEPTH_M);
    if (top && lapse(base, top) > SECOND_TROPOPAUSE_LAPSE) return levels.indexOf(top);
  }
  return -1;
}

function findTropopauses(levels: AeroLevel[]): AeroTropopause[] {
  const result: AeroTropopause[] = [];
  let i = levels.findIndex((l) => l.mb <= TROPOPAUSE_MAX_MB);
  if (i < 0) return result;

  while (i < levels.length - 1) {
    if (!isTropopause(levels, i)) {
      i += 1;
      continue;
    }
    const level = levels[i] as AeroLevel;
    result.push({ mb: level.mb, heightM: level.heightM, tempC: level.tempC });
    const next = nextTroposphereAbove(levels, i);
    if (next < 0) break;
    i = next;
  }
  return result;
}

/** Все пересечения профиля с изотермами снизу вверх. */
function findIsotherms(levels: AeroLevel[]): AeroIsotherm[] {
  const lowest = levels[0] as AeroLevel;
  const result: AeroIsotherm[] = [];

  for (const tempC of AERO_ISOTHERMS_C) {
    if (lowest.tempC < tempC) {
      result.push({ tempC, heightM: lowest.heightM, mb: lowest.mb, belowData: true });
    }
    for (let i = 1; i < levels.length; i += 1) {
      const a = levels[i - 1] as AeroLevel;
      const b = levels[i] as AeroLevel;
      if ((a.tempC >= tempC) === (b.tempC >= tempC)) continue;
      const t = (a.tempC - tempC) / (a.tempC - b.tempC);
      result.push({ tempC, ...pointBetween(a, b, t) });
    }
  }
  return result.sort((a, b) => a.heightM - b.heightM || b.tempC - a.tempC);
}

/** Слой от первой нулевой изотермы до первой −20 °C над ней. */
function findIcing(levels: AeroLevel[], isotherms: AeroIsotherm[]): AeroAnalysis['icing'] {
  const zero = isotherms.find((i) => i.tempC === 0);
  if (!zero) return undefined;
  const cold = isotherms.find((i) => i.tempC === -20 && i.heightM >= zero.heightM);
  if (cold?.belowData) return undefined;
  const top = cold ?? (levels.at(-1) as AeroLevel);
  return {
    fromHeightM: zero.heightM,
    toHeightM: top.heightM,
    fromMb: zero.mb,
    toMb: top.mb,
    ...(zero.belowData ? { belowData: true } : {}),
  };
}

/** Инверсии и изотермии ниже тропопаузы; соседние слои одного рода сливаются. */
function findStableLayers(levels: AeroLevel[], ceilingM: number): AeroStableLayer[] {
  const result: AeroStableLayer[] = [];
  for (let i = 1; i < levels.length; i += 1) {
    const a = levels[i - 1] as AeroLevel;
    const b = levels[i] as AeroLevel;
    if (b.heightM > ceilingM) break;

    const deltaT = b.tempC - a.tempC;
    const kind =
      Math.abs(deltaT) <= ISOTHERM_TOLERANCE_C ? 'isotherm' : deltaT > 0 ? 'inversion' : undefined;
    if (!kind) continue;

    const last = result.at(-1);
    if (last && last.kind === kind && last.toHeightM === a.heightM) {
      last.toHeightM = b.heightM;
      last.toMb = b.mb;
      last.deltaT += deltaT;
    } else {
      result.push({ kind, ...layerOf(a, b), deltaT });
    }
  }
  return result;
}

function findMaxWind(levels: AeroLevel[]): { index: number; wind: AeroMaxWind } {
  let index = 0;
  levels.forEach((level, i) => {
    if (level.windSpeedMs > (levels[index] as AeroLevel).windSpeedMs) index = i;
  });
  const level = levels[index] as AeroLevel;
  return {
    index,
    wind: { mb: level.mb, heightM: level.heightM, dirDeg: level.windDirDeg, speedMs: level.windSpeedMs },
  };
}

/** Непрерывный слой со скоростью не меньше порога вокруг максимума; границы — по интерполяции. */
function findJet(levels: AeroLevel[], maxIndex: number): AeroLayer | undefined {
  const max = levels[maxIndex] as AeroLevel;
  if (max.windSpeedMs < JET_MIN_SPEED_MS) return undefined;

  const edge = (inside: AeroLevel, outside: AeroLevel): { heightM: number; mb: number } => {
    const t = (inside.windSpeedMs - JET_MIN_SPEED_MS) / (inside.windSpeedMs - outside.windSpeedMs);
    const [lower, upper, tt] =
      inside.heightM < outside.heightM ? [inside, outside, t] : [outside, inside, 1 - t];
    return pointBetween(lower, upper, tt);
  };

  let lo = maxIndex;
  while (lo > 0 && (levels[lo - 1] as AeroLevel).windSpeedMs >= JET_MIN_SPEED_MS) lo -= 1;
  let hi = maxIndex;
  while (hi < levels.length - 1 && (levels[hi + 1] as AeroLevel).windSpeedMs >= JET_MIN_SPEED_MS) {
    hi += 1;
  }

  const loLevel = levels[lo] as AeroLevel;
  const hiLevel = levels[hi] as AeroLevel;
  const bottom = lo > 0 ? edge(loLevel, levels[lo - 1] as AeroLevel) : loLevel;
  const top = hi < levels.length - 1 ? edge(hiLevel, levels[hi + 1] as AeroLevel) : hiLevel;
  return { fromHeightM: bottom.heightM, toHeightM: top.heightM, fromMb: bottom.mb, toMb: top.mb };
}

/**
 * Слои с числом Ричардсона Ri = N² / S² ниже порога. N² — по потенциальной
 * температуре, S — сдвиг ветра между соседними уровнями. Уровни отстоят на 0,6–1,5 км,
 * поэтому сдвиг занижен, а Ri завышено — порог взят мягче классического 0,25.
 */
function findTurbulence(levels: AeroLevel[]): AeroTurbulence[] {
  const result: AeroTurbulence[] = [];
  for (let i = 1; i < levels.length; i += 1) {
    const a = levels[i - 1] as AeroLevel;
    const b = levels[i] as AeroLevel;
    const dz = b.heightM - a.heightM;
    if (dz <= 0) continue;

    const thetaA = potentialTemperature(a.tempC, a.mb);
    const thetaB = potentialTemperature(b.tempC, b.mb);
    const n2 = ((G / ((thetaA + thetaB) / 2)) * (thetaB - thetaA)) / dz;
    const va = windToVector(a.windDirDeg, a.windSpeedMs);
    const vb = windToVector(b.windDirDeg, b.windSpeedMs);
    const shear = Math.hypot(vb.u - va.u, vb.v - va.v) / dz;
    if (shear <= 0) continue;

    const ri = n2 / (shear * shear);
    if (ri >= TURBULENCE_RI) continue;

    const last = result.at(-1);
    if (last && last.toHeightM === a.heightM) {
      last.toHeightM = b.heightM;
      last.toMb = b.mb;
      last.ri = Math.min(last.ri, ri);
      last.shearMsPerKm = Math.max(last.shearMsPerKm, shear * 1000);
    } else {
      result.push({ ...layerOf(a, b), ri, shearMsPerKm: shear * 1000 });
    }
  }
  return result;
}

/**
 * Средний ветер в слое от выпуска до высоты строки. При постоянной скорости подъёма
 * смещение зонда, делённое на время подъёма, — это и есть средний по высоте ветер слоя.
 */
function meanWinds(rows: TrajectoryRow[]): AeroMeanWind[] {
  return rows.map((row) => ({
    heightM: row.heightM,
    dirDeg: normalizeDeg(row.azimuthDeg + 180),
    speedMs: row.timeMin > 0 ? (row.distanceKm * 1000) / (row.timeMin * 60) : 0,
  }));
}

/** Обработка профиля для диаграммы. Уровни могут идти в любом порядке. */
export function analyzeAerology(levels: AeroLevel[], rows: TrajectoryRow[] = []): AeroAnalysis {
  const sorted = [...levels].sort((a, b) => a.heightM - b.heightM);
  if (sorted.length === 0) {
    return { tropopauses: [], isotherms: [], stableLayers: [], turbulence: [], meanWinds: meanWinds(rows) };
  }

  const tropopauses = findTropopauses(sorted);
  const isotherms = findIsotherms(sorted);
  const max = findMaxWind(sorted);
  const t850 = sorted.find((l) => l.mb === 850)?.tempC;
  const t500 = sorted.find((l) => l.mb === 500)?.tempC;
  const icing = findIcing(sorted, isotherms);
  const jet = findJet(sorted, max.index);

  return {
    tropopauses,
    isotherms,
    ...(icing ? { icing } : {}),
    stableLayers: findStableLayers(sorted, tropopauses[0]?.heightM ?? Infinity),
    maxWind: max.wind,
    ...(jet ? { jet } : {}),
    turbulence: findTurbulence(sorted),
    meanWinds: meanWinds(rows),
    ...(t850 !== undefined && t500 !== undefined ? { verticalTotals: t850 - t500 } : {}),
  };
}
