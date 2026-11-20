import {
  bearingDeg,
  distanceKm,
  offsetByMeters,
  toRad,
  windToVector,
  type LatLon,
  type TrajectoryPathPoint,
  type TrajectoryRow,
  type WindVector,
} from '@rs/shared';
import type { GribSample } from '../grib/reader.js';

/** Уровень с возможностью выборки в произвольной точке и в произвольный момент. */
export interface LevelSampler {
  mb: number;
  fl: number;
  /** Высота уровня, м. */
  heightM: number;
  /** Значения на уровне в момент `timeMs`: выбор срока прогноза выполняется внутри. */
  sampleAt(point: LatLon, timeMs: number): GribSample;
}

export interface IntegrationOptions {
  /** Точка выпуска. */
  origin: LatLon;
  /** Время выпуска, мс от эпохи. */
  releaseMs: number;
  /** Уровни прогноза снизу вверх. */
  levels: LevelSampler[];
  /** Высоты, для которых нужны строки отчёта, м. */
  reportHeights: number[];
  /** Скорость подъёма, м/с. */
  ascentRateMs: number;
  /** Шаг интегрирования, с. */
  stepSeconds: number;
}

export interface IntegrationResult {
  rows: TrajectoryRow[];
  path: TrajectoryPathPoint[];
}

function windOf(sample: GribSample): WindVector {
  return windToVector(sample.windDirDeg, sample.windSpeedMs);
}

/**
 * Интегрирует подъём радиозонда в поле ветра.
 *
 * Зонд поднимается с постоянной вертикальной скоростью; горизонтальный снос на
 * каждом шаге берётся по ветру в текущей точке, на текущей высоте и на текущий
 * момент времени. По высоте ветер не интерполируется: берётся ближайший
 * изобарический уровень, ниже нижнего и выше верхнего — крайний (приземных
 * данных в наборе нет).
 */
export function integrateTrajectory(options: IntegrationOptions): IntegrationResult {
  const { origin, releaseMs, ascentRateMs, stepSeconds } = options;
  const levels = [...options.levels].sort((a, b) => a.heightM - b.heightM);

  if (levels.length === 0) throw new Error('Нет ни одного уровня для расчёта');
  if (!(ascentRateMs > 0)) throw new Error('Скорость подъёма должна быть положительной');

  const reportHeights = [...new Set(options.reportHeights)]
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  if (reportHeights.length === 0) throw new Error('Не задано ни одной высоты отчёта');

  /**
   * Ближайший изобарический уровень (посередине между двумя — нижний): с него
   * берутся ветер и температура, он же подписывается в строке отчёта.
   */
  const nearestLevel = (heightM: number): LevelSampler =>
    levels.reduce((best, level) =>
      Math.abs(level.heightM - heightM) < Math.abs(best.heightM - heightM) ? level : best,
    );

  const windAt = (heightM: number, point: LatLon, timeMs: number): WindVector =>
    windOf(nearestLevel(heightM).sampleAt(point, timeMs));

  let position: LatLon = { ...origin };
  let elapsed = 0;
  let height = 0;
  let previous = { position: { ...origin }, elapsed: 0 };

  const path: TrajectoryPathPoint[] = [{ timeMin: 0, heightM: 0, dxKm: 0, dyKm: 0, ...origin }];
  const rows: TrajectoryRow[] = [];

  const pushPath = (): void => {
    const d = distanceKm(origin, position);
    const az = toRad(bearingDeg(origin, position));
    path.push({
      timeMin: elapsed / 60,
      heightM: height,
      dxKm: d * Math.sin(az),
      dyKm: d * Math.cos(az),
      lat: position.lat,
      lon: position.lon,
    });
  };

  reportHeights.forEach((target, index) => {
    const segmentSeconds = (target - height) / ascentRateMs;
    const steps = Math.max(1, Math.ceil(segmentSeconds / stepSeconds));
    const dt = segmentSeconds / steps;

    for (let s = 0; s < steps; s += 1) {
      // Ветер берём в середине шага — это точнее, чем на его границе.
      const midHeight = height + ascentRateMs * dt * 0.5;
      const midTimeMs = releaseMs + (elapsed + dt * 0.5) * 1000;
      const wind = windAt(midHeight, position, midTimeMs);

      position = offsetByMeters(position, wind.u * dt, wind.v * dt);
      elapsed += dt;
      height += ascentRateMs * dt;
      pushPath();
    }

    // Компенсируем накопление ошибки округления по высоте.
    height = target;

    const level = nearestLevel(target);
    const sample = level.sampleAt(position, releaseMs + elapsed * 1000);
    const dist = distanceKm(origin, position);
    const azimuth = bearingDeg(origin, position);
    const azRad = toRad(azimuth);

    rows.push({
      no: index + 1,
      mb: level.mb,
      fl: level.fl,
      heightM: target,
      timeMin: elapsed / 60,
      layerTimeMin: (elapsed - previous.elapsed) / 60,
      layerDistanceKm: distanceKm(previous.position, position),
      azimuthDeg: azimuth,
      distanceKm: dist,
      lat: position.lat,
      lon: position.lon,
      dxKm: dist * Math.sin(azRad),
      dyKm: dist * Math.cos(azRad),
      tempC: sample.tempC,
      windDirDeg: sample.windDirDeg,
      windSpeedMs: sample.windSpeedMs,
    });

    previous = { position: { ...position }, elapsed };
  });

  return { rows, path };
}
