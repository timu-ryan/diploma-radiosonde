import { describe, expect, it } from 'vitest';
import {
  analyzeAerology,
  dryAdiabatTemp,
  mixingRatioTemp,
  moistAdiabat,
  potentialTemperature,
  saturationMixingRatio,
  standardAtmosphere,
} from '../src/aerology.js';
import type { AeroLevel, TrajectoryRow } from '../src/types.js';

const level = (
  mb: number,
  heightM: number,
  tempC: number,
  windDirDeg = 270,
  windSpeedMs = 10,
): AeroLevel => ({
  mb,
  fl: heightM / 30,
  heightM,
  timeMin: heightM / 300,
  lat: 60,
  lon: 40,
  tempC,
  windDirDeg,
  windSpeedMs,
});

/** Профиль средних широт: тропопауза на 200 гПа, ветер ровный. */
const STANDARD: AeroLevel[] = [
  level(850, 1500, 5),
  level(700, 3000, -5),
  level(500, 5400, -21),
  level(400, 7200, -33),
  level(300, 9000, -45),
  level(250, 10200, -50),
  level(200, 11700, -56),
  level(150, 13500, -56),
  level(100, 15900, -57),
];

describe('термодинамика бланка', () => {
  it('сухая адиабата сохраняет потенциальную температуру', () => {
    expect(potentialTemperature(15, 1000)).toBeCloseTo(288.15, 6);
    expect(dryAdiabatTemp(288.15, 1000)).toBeCloseTo(15, 6);
    expect(potentialTemperature(dryAdiabatTemp(300, 500), 500)).toBeCloseTo(300, 6);
    // При подъёме с 1000 до 500 гПа частица остывает примерно на 52 °C
    expect(dryAdiabatTemp(288.15, 500)).toBeCloseTo(-36.7, 1);
  });

  it('линия массовой доли обращает насыщающую массовую долю', () => {
    for (const [w, mb] of [
      [1, 1000],
      [7, 850],
      [24, 1050],
    ] as const) {
      expect(saturationMixingRatio(mixingRatioTemp(w, mb), mb) * 1000).toBeCloseTo(w, 6);
    }
  });

  it('влажная адиабата остывает медленнее сухой', () => {
    const line = moistAdiabat(20, 1000, 500);
    expect(line[0]).toEqual({ mb: 1000, tempC: 20 });
    expect(line.at(-1)?.mb).toBeCloseTo(500, 9);

    const t500 = line.at(-1)?.tempC as number;
    expect(t500).toBeGreaterThan(dryAdiabatTemp(293.15, 500) + 15);
    expect(t500).toBeLessThan(0);
    // Температура монотонно падает с давлением
    for (let i = 1; i < line.length; i += 1) {
      expect(line[i]!.tempC).toBeLessThan(line[i - 1]!.tempC);
    }
  });

  it('стандартная атмосфера СА-81', () => {
    expect(standardAtmosphere(0)).toEqual({ mb: 1013.25, tempC: 15 });
    expect(standardAtmosphere(5000).mb).toBeCloseTo(540.2, 1);
    expect(standardAtmosphere(5000).tempC).toBeCloseTo(-17.5, 6);
    expect(standardAtmosphere(11000).mb).toBeCloseTo(226.32, 1);
    expect(standardAtmosphere(11000).tempC).toBeCloseTo(-56.5, 6);
    expect(standardAtmosphere(16000).tempC).toBeCloseTo(-56.5, 6);
    expect(standardAtmosphere(16000).mb).toBeCloseTo(102.9, 0);
  });
});

describe('обработка профиля', () => {
  it('находит тропопаузу по критерию ВМО', () => {
    const { tropopauses, stableLayers } = analyzeAerology(STANDARD);
    expect(tropopauses).toEqual([{ mb: 200, heightM: 11700, tempC: -56 }]);
    // Изотермия 200–150 гПа выше тропопаузы — это стратосфера, а не слой инверсии
    expect(stableLayers).toEqual([]);
  });

  it('интерполирует высоты изотерм и слой обледенения', () => {
    const { isotherms, icing, verticalTotals } = analyzeAerology(STANDARD);
    expect(isotherms.map((i) => [i.tempC, i.heightM])).toEqual([
      [0, 2250],
      [-10, 3750],
      [-20, 5250],
    ]);
    // Давление — линейно по ln p: середина между 850 и 700 гПа
    expect(isotherms[0]!.mb).toBeCloseTo(Math.sqrt(850 * 700), 6);
    expect(icing).toMatchObject({ fromHeightM: 2250, toHeightM: 5250 });
    expect(icing?.belowData).toBeUndefined();
    expect(verticalTotals).toBe(26);
  });

  it('отмечает изотермы ниже нижнего уровня и все пересечения', () => {
    const levels = [
      level(850, 1500, -2),
      level(750, 2400, 0),
      level(700, 3000, 1),
      level(600, 4200, 1),
      level(500, 5400, -10),
    ];
    const { isotherms, icing, stableLayers } = analyzeAerology(levels);

    const zero = isotherms.filter((i) => i.tempC === 0);
    expect(zero.map((i) => [i.heightM, i.belowData ?? false])).toEqual([
      [1500, true],
      [2400, false],
      [4200 + 1200 / 11, false],
    ]);
    expect(icing).toMatchObject({ fromHeightM: 1500, belowData: true });

    // Две инверсии подряд сливаются, изотермия — отдельный слой
    expect(stableLayers).toEqual([
      { kind: 'inversion', fromHeightM: 1500, toHeightM: 3000, fromMb: 850, toMb: 700, deltaT: 3 },
      { kind: 'isotherm', fromHeightM: 3000, toHeightM: 4200, fromMb: 700, toMb: 600, deltaT: 0 },
    ]);
  });

  it('находит максимальный ветер и границы струйного течения', () => {
    const levels = [
      level(500, 5400, -21, 270, 20),
      level(300, 9000, -45, 270, 28),
      level(250, 10200, -50, 270, 36),
      level(200, 11700, -56, 270, 32),
      level(150, 13500, -56, 270, 20),
    ];
    const { maxWind, jet } = analyzeAerology(levels);
    expect(maxWind).toEqual({ mb: 250, heightM: 10200, dirDeg: 270, speedMs: 36 });
    expect(jet?.fromHeightM).toBeCloseTo(9300, 6);
    expect(jet?.toHeightM).toBeCloseTo(12000, 6);

    const calm = analyzeAerology(levels.map((l) => ({ ...l, windSpeedMs: l.windSpeedMs / 2 })));
    expect(calm.maxWind?.speedMs).toBe(18);
    expect(calm.jet).toBeUndefined();
  });

  it('отмечает болтанку при сильном сдвиге ветра в слабоустойчивом слое', () => {
    expect(analyzeAerology(STANDARD).turbulence).toEqual([]);

    const sheared = analyzeAerology([
      level(500, 5400, -21, 270, 10),
      level(400, 7200, -33, 270, 40),
      level(300, 9000, -45, 270, 42),
    ]);
    expect(sheared.turbulence).toHaveLength(1);
    expect(sheared.turbulence[0]).toMatchObject({ fromHeightM: 5400, toHeightM: 7200 });
    expect(sheared.turbulence[0]!.ri).toBeGreaterThan(0);
    expect(sheared.turbulence[0]!.ri).toBeLessThan(1);
    expect(sheared.turbulence[0]!.shearMsPerKm).toBeCloseTo(30 / 1.8, 6);
  });

  it('считает средний ветер слоя по смещению зонда', () => {
    const row = { heightM: 3000, timeMin: 10, distanceKm: 6, azimuthDeg: 90 } as TrajectoryRow;
    const [mean] = analyzeAerology(STANDARD, [row]).meanWinds;
    // Снос на восток 6 км за 10 мин — западный ветер 10 м/с
    expect(mean?.heightM).toBe(3000);
    expect(mean?.dirDeg).toBeCloseTo(270, 9);
    expect(mean?.speedMs).toBeCloseTo(10, 9);
  });

  it('не падает на пустом профиле', () => {
    expect(analyzeAerology([])).toEqual({
      tropopauses: [],
      isotherms: [],
      stableLayers: [],
      turbulence: [],
      meanWinds: [],
    });
  });
});
