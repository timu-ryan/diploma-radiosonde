import type { AeroLevel, TrajectoryPathPoint } from '@rs/shared';
import type { LevelSampler } from './compute.js';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Точка пути на заданной высоте: интерполяция между соседними точками; выше конца — конец пути. */
function pointAtHeight(path: TrajectoryPathPoint[], heightM: number): TrajectoryPathPoint {
  const last = path.at(-1) as TrajectoryPathPoint;
  if (heightM >= last.heightM) return last;

  for (let i = 1; i < path.length; i += 1) {
    const upper = path[i] as TrajectoryPathPoint;
    if (upper.heightM < heightM) continue;
    const lower = path[i - 1] as TrajectoryPathPoint;
    const span = upper.heightM - lower.heightM;
    const t = span > 0 ? (heightM - lower.heightM) / span : 0;
    return {
      timeMin: lerp(lower.timeMin, upper.timeMin, t),
      heightM,
      dxKm: lerp(lower.dxKm, upper.dxKm, t),
      dyKm: lerp(lower.dyKm, upper.dyKm, t),
      lat: lerp(lower.lat, upper.lat, t),
      lon: lerp(lower.lon, upper.lon, t),
    };
  }
  return last;
}

/**
 * Профиль для аэрологической диаграммы: каждый изобарический уровень берётся в той
 * точке и в тот момент, когда зонд проходит его высоту, — то, что «измерит»
 * прогнозируемый зонд. Уровни выше конца пути берутся в последней точке пути.
 */
export function sampleAlongPath(
  levels: LevelSampler[],
  path: TrajectoryPathPoint[],
  releaseMs: number,
): AeroLevel[] {
  if (path.length === 0) return [];

  return [...levels]
    .sort((a, b) => a.heightM - b.heightM)
    .map((level) => {
      const point = pointAtHeight(path, level.heightM);
      const sample = level.sampleAt(
        { lat: point.lat, lon: point.lon },
        releaseMs + point.timeMin * 60_000,
      );
      return {
        mb: level.mb,
        fl: level.fl,
        heightM: level.heightM,
        timeMin: point.timeMin,
        lat: point.lat,
        lon: point.lon,
        tempC: sample.tempC,
        windDirDeg: sample.windDirDeg,
        windSpeedMs: sample.windSpeedMs,
      };
    });
}
