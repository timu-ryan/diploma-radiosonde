import { describe, expect, it } from 'vitest';
import type { LatLon } from '@rs/shared';
import { sampleAlongPath } from '../src/trajectory/aerology.js';
import { integrateTrajectory, type LevelSampler } from '../src/trajectory/compute.js';
import type { GribSample } from '../src/grib/reader.js';

const RELEASE = Date.UTC(2026, 7, 7, 11, 30);

/** Южный ветер 10 м/с; в температуре — минуты от выпуска, на которые взята выборка. */
const level = (mb: number, heightM: number): LevelSampler => ({
  mb,
  fl: heightM / 30,
  heightM,
  sampleAt: (_point: LatLon, timeMs: number): GribSample => ({
    tempC: (timeMs - RELEASE) / 60_000,
    windDirDeg: 180,
    windSpeedMs: 10,
  }),
});

describe('профиль вдоль траектории', () => {
  const levels = [level(850, 1500), level(700, 3000), level(500, 5400)];
  const { path } = integrateTrajectory({
    origin: { lat: 60, lon: 40 },
    releaseMs: RELEASE,
    levels,
    reportHeights: [1500, 3000],
    ascentRateMs: 5,
    stepSeconds: 10,
  });

  it('берёт уровень в точке и в момент прохождения его высоты', () => {
    const [low, mid] = sampleAlongPath(levels, path, RELEASE);

    // 1500 м при 5 м/с — 5 мин; снос на север 10 м/с × 300 с = 3 км
    expect(low).toMatchObject({ mb: 850, heightM: 1500 });
    expect(low!.timeMin).toBeCloseTo(5, 6);
    expect(low!.tempC).toBeCloseTo(5, 6);
    expect((low!.lat - 60) * 111.195).toBeCloseTo(3, 2);
    expect(low!.lon).toBeCloseTo(40, 9);

    expect(mid!.timeMin).toBeCloseTo(10, 6);
    expect((mid!.lat - 60) * 111.195).toBeCloseTo(6, 2);
  });

  it('уровни выше конца пути берёт в последней точке пути', () => {
    const top = sampleAlongPath(levels, path, RELEASE).at(-1);
    const end = path.at(-1);
    expect(top).toMatchObject({ mb: 500, heightM: 5400, lat: end?.lat, lon: end?.lon });
    expect(top!.timeMin).toBeCloseTo(10, 6);
  });

  it('упорядочивает уровни снизу вверх', () => {
    const shuffled = [levels[2]!, levels[0]!, levels[1]!];
    expect(sampleAlongPath(shuffled, path, RELEASE).map((l) => l.mb)).toEqual([850, 700, 500]);
    expect(sampleAlongPath(levels, [], RELEASE)).toEqual([]);
  });
});
