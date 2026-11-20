import { describe, expect, it } from 'vitest';
import type { LatLon } from '@rs/shared';
import { integrateTrajectory, type LevelSampler } from '../src/trajectory/compute.js';
import type { GribSample } from '../src/grib/reader.js';

const constantLevel = (
  heightM: number,
  windDirDeg: number,
  windSpeedMs: number,
  tempC = 0,
): LevelSampler => ({
  mb: heightM,
  fl: heightM / 30,
  heightM,
  sampleAt: (): GribSample => ({ tempC, windDirDeg, windSpeedMs }),
});

const origin: LatLon = { lat: 60, lon: 40 };

describe('интегрирование подъёма радиозонда', () => {
  it('при южном ветре сносит строго на север на скорость × время', () => {
    const { rows } = integrateTrajectory({
      origin,
      releaseMs: Date.UTC(2026, 7, 7, 11, 30),
      // ветер «с юга» (180°) переносит зонд на север
      levels: [constantLevel(1500, 180, 10), constantLevel(3000, 180, 10)],
      reportHeights: [1500, 3000],
      ascentRateMs: 5,
      stepSeconds: 10,
    });

    expect(rows).toHaveLength(2);
    // 1500 м при 5 м/с — это 300 с, снос 10 м/с × 300 с = 3 км
    expect(rows[0]!.timeMin).toBeCloseTo(5, 6);
    expect(rows[0]!.layerTimeMin).toBeCloseTo(5, 6);
    expect(rows[0]!.distanceKm).toBeCloseTo(3, 2);
    expect(rows[0]!.azimuthDeg).toBeCloseTo(0, 3);
    expect(rows[0]!.dyKm).toBeCloseTo(3, 2);
    expect(Math.abs(rows[0]!.dxKm)).toBeLessThan(1e-6);

    expect(rows[1]!.timeMin).toBeCloseTo(10, 6);
    expect(rows[1]!.layerTimeMin).toBeCloseTo(5, 6);
    expect(rows[1]!.distanceKm).toBeCloseTo(6, 2);
    expect(rows[1]!.layerDistanceKm).toBeCloseTo(3, 2);
  });

  it('при западном ветре сносит на восток', () => {
    const { rows } = integrateTrajectory({
      origin,
      releaseMs: 0,
      levels: [constantLevel(3000, 270, 20)],
      reportHeights: [3000],
      ascentRateMs: 5,
      stepSeconds: 10,
    });

    // 3000 м / 5 м/с = 600 с, снос 20 × 600 = 12 км на восток.
    // Начальный пеленг ортодромии на точку строго к востоку чуть меньше 90°.
    expect(rows[0]!.azimuthDeg).toBeCloseTo(90, 0);
    expect(rows[0]!.distanceKm).toBeCloseTo(12, 1);
    expect(rows[0]!.dxKm).toBeCloseTo(12, 1);
  });

  it('берёт ветер ближайшего уровня без интерполяции и ниже нижнего уровня держит его постоянным', () => {
    const { rows, path } = integrateTrajectory({
      origin,
      releaseMs: 0,
      levels: [constantLevel(1500, 180, 10, 5), constantLevel(3000, 180, 20, -5)],
      reportHeights: [1500, 2000, 3000],
      ascentRateMs: 5,
      stepSeconds: 1,
    });

    // 0…1500 м: ветер нижнего уровня 10 м/с × 300 с = 3 км
    expect(rows[0]!.distanceKm).toBeCloseTo(3, 2);
    // 2000 м ближе к 1500 м: ветер и температура нижнего уровня, снос 10 м/с × 100 с = 1 км
    expect(rows[1]!.mb).toBe(1500);
    expect(rows[1]!.windSpeedMs).toBe(10);
    expect(rows[1]!.tempC).toBe(5);
    expect(rows[1]!.layerDistanceKm).toBeCloseTo(1, 2);
    // 2000…3000 м: до середины слоя (2250 м) 10 м/с × 50 с, выше 20 м/с × 150 с = 3,5 км
    expect(rows[2]!.layerDistanceKm).toBeCloseTo(3.5, 2);
    expect(rows[2]!.distanceKm).toBeCloseTo(7.5, 2);

    expect(path[0]).toMatchObject({ timeMin: 0, heightM: 0, dxKm: 0, dyKm: 0 });
    expect(path.at(-1)!.heightM).toBeCloseTo(3000, 6);
    expect(path.at(-1)!.timeMin).toBeCloseTo(10, 6);
  });

  it('высоты отчёта не обязаны совпадать с уровнями прогноза', () => {
    const { rows } = integrateTrajectory({
      origin,
      releaseMs: 0,
      // уровни 850/500/300 гПа по формуле FL × 30
      levels: [
        constantLevel(1500, 180, 10),
        constantLevel(5400, 180, 30),
        constantLevel(9000, 180, 50),
      ],
      reportHeights: [1500, 3000, 5000, 7000, 9000],
      ascentRateMs: 5,
      stepSeconds: 5,
    });

    expect(rows.map((r) => r.heightM)).toEqual([1500, 3000, 5000, 7000, 9000]);
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3, 4, 5]);
    // на 3000 м ближайший уровень — 1500 м: его ветер берётся как есть и он же подписывается
    expect(rows[1]!.mb).toBe(1500);
    expect(rows[1]!.windSpeedMs).toBe(10);
    // 5000 м и 7000 м ближе к 5400 м
    expect(rows[2]!.windSpeedMs).toBe(30);
    expect(rows[3]!.windSpeedMs).toBe(30);
    // суммарное время 9000 / 5 м/с = 30 мин
    expect(rows.at(-1)!.timeMin).toBeCloseTo(30, 6);
    expect(rows.reduce((sum, r) => sum + r.layerTimeMin, 0)).toBeCloseTo(30, 6);
  });

  it('не накапливает ошибку по высоте при некратном шаге', () => {
    const { rows } = integrateTrajectory({
      origin,
      releaseMs: 0,
      levels: [1500, 3000, 5400, 9000].map((h) => constantLevel(h, 225, 12)),
      reportHeights: [1500, 3000, 5000, 7000, 9000],
      ascentRateMs: 5,
      stepSeconds: 7, // намеренно не кратен длине слоёв
    });

    expect(rows.map((r) => r.heightM)).toEqual([1500, 3000, 5000, 7000, 9000]);
    // ветер с юго-запада (225°) → снос на северо-восток
    expect(rows.at(-1)!.azimuthDeg).toBeCloseTo(45, 0);
  });
});
