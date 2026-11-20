import {
  REPORT_HEIGHTS_M,
  REPORT_HEIGHT_TOLERANCE_M,
  STATION_RADIUS_KM,
  activeStep,
  analyzeAerology,
  eastNorthKm,
  nearestWithin,
  parseUtc,
  stepPeriods,
  type AirwayCrossing,
  type ChartGeometry,
  type ForecastRequest,
  type ForecastResponse,
  type InterpMode,
  type LatLon,
  type ReleaseOrigin,
  type Station,
} from '@rs/shared';
import type { GribCatalog, LevelInfo, Run } from '../grib/catalog.js';
import { toRunInfo } from '../grib/catalog.js';
import type { GribFieldCache, GribField, GribSample } from '../grib/reader.js';
import { StationRegistry, toSummary } from '../stations/registry.js';
import { sampleAlongPath } from '../trajectory/aerology.js';
import { integrateTrajectory, type LevelSampler } from '../trajectory/compute.js';
import { findAirwayCrossings } from '../trajectory/crossings.js';

const HOUR_MS = 3600_000;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface StepField {
  step: number;
  field: GribField;
}

/**
 * Уровень с полями по срокам. В каждый момент берётся срок, который в этот момент
 * действует (±1,5 ч вокруг заблаговременности), — без интерполяции по времени.
 */
class StepLevel implements LevelSampler {
  private readonly steps: number[];

  constructor(
    readonly mb: number,
    readonly fl: number,
    readonly heightM: number,
    private readonly runTimeMs: number,
    private readonly fields: StepField[],
    private readonly interp: InterpMode,
  ) {
    this.steps = fields.map((f) => f.step);
  }

  sampleAt(point: LatLon, timeMs: number): GribSample {
    const step = activeStep(this.steps, (timeMs - this.runTimeMs) / HOUR_MS);
    const current = this.fields.find((f) => f.step === step) ?? (this.fields[0] as StepField);
    return current.field.sample(point.lon, point.lat, this.interp);
  }
}

/** Сроки, действующие в интервале полёта (при отсутствии файлов — ближайшие имеющиеся). */
function stepsForWindow(available: number[], fromHours: number, toHours: number): number[] {
  const first = activeStep(available, fromHours);
  const last = activeStep(available, toHours);
  if (first === undefined || last === undefined) return [];
  return [...available].sort((a, b) => a - b).filter((s) => s >= first && s <= last);
}

export interface ForecastServiceOptions {
  ascentRateMs: number;
  stepSeconds: number;
}

export class ForecastService {
  constructor(
    private readonly stations: StationRegistry,
    private readonly catalog: GribCatalog,
    private readonly fields: GribFieldCache,
    private readonly options: ForecastServiceOptions,
  ) {}

  private async pickRun(release: Date, requested?: string): Promise<Run> {
    if (requested) {
      const run = await this.catalog.get(requested);
      if (!run) throw new HttpError(404, 'run_not_found', `Прогон ${requested} не найден`);
      return run;
    }

    const run = await this.catalog.pickRun(release);
    if (run) return run;

    const runs = await this.catalog.list();
    throw new HttpError(
      400,
      'no_data_for_time',
      'На указанное время выпуска нет данных прогноза',
      {
        available: runs.map((r) => ({
          run: r.id,
          from: this.catalog.validFrom(r).toISOString(),
          to: this.catalog.validTo(r).toISOString(),
        })),
      },
    );
  }

  /**
   * Точка выпуска и станция, чей планшет под неё: при выпуске по координатам —
   * ближайшая в пределах STATION_RADIUS_KM, точка смещена от центра её планшета.
   */
  private resolveOrigin(request: ForecastRequest): { origin: ReleaseOrigin; station?: Station } {
    if (request.origin) {
      const point = request.origin;
      const station = nearestWithin(this.stations.all(), point, STATION_RADIUS_KM);
      const offset = station ? eastNorthKm(station, point) : { dxKm: 0, dyKm: 0 };
      return { origin: { lat: point.lat, lon: point.lon, custom: true, ...offset }, station };
    }

    if (!request.station) {
      throw new HttpError(400, 'bad_request', 'Не указана станция или точка выпуска');
    }
    const station = this.stations.get(request.station);
    if (!station) {
      throw new HttpError(404, 'station_not_found', `Станция ${request.station} не найдена`);
    }
    return {
      origin: { lat: station.lat, lon: station.lon, custom: false, dxKm: 0, dyKm: 0 },
      station,
    };
  }

  async compute(request: ForecastRequest): Promise<ForecastResponse> {
    const { origin, station } = this.resolveOrigin(request);

    let release: Date;
    try {
      release = parseUtc(request.release);
    } catch {
      throw new HttpError(400, 'bad_release', `Некорректное время выпуска: ${request.release}`);
    }

    const run = await this.pickRun(release, request.run);
    const interp: InterpMode = request.interp === 'bilinear' ? 'bilinear' : 'nearest';
    const ascentRateMs = clampAscent(request.ascent ?? this.options.ascentRateMs);

    if (run.levels.length === 0) {
      throw new HttpError(500, 'run_empty', `В прогоне ${run.id} нет данных по уровням`);
    }

    const warnings: string[] = [];

    // Отчёт строится по фиксированной лестнице высот; берём те, что обеспечены
    // данными (верхний уровень 100 гПа = 15 900 м покрывает строку 16 000 м).
    const topLevelHeight = Math.max(...run.levels.map((l) => l.heightM));
    const reportHeights = REPORT_HEIGHTS_M.filter(
      (h) => h <= topLevelHeight + REPORT_HEIGHT_TOLERANCE_M,
    );
    if (reportHeights.length === 0) {
      throw new HttpError(
        500,
        'run_too_low',
        `В прогоне ${run.id} нет уровней выше ${REPORT_HEIGHTS_M[0]} м`,
      );
    }
    if (reportHeights.length < REPORT_HEIGHTS_M.length) {
      warnings.push(
        `В прогоне есть уровни до ${topLevelHeight} м, поэтому отчёт доведён до ` +
          `${reportHeights.at(-1)} м вместо ${REPORT_HEIGHTS_M.at(-1)} м.`,
      );
    }

    const topHeight = reportHeights.at(-1) as number;
    const flightSeconds = topHeight / ascentRateMs;
    const releaseMs = release.getTime();
    const endMs = releaseMs + flightSeconds * 1000;

    const validFrom = this.catalog.validFrom(run).getTime();
    const validTo = this.catalog.validTo(run).getTime();
    if (releaseMs < validFrom || releaseMs >= validTo) {
      warnings.push(
        `Время выпуска выходит за период действия прогона ${run.id}; использованы крайние сроки.`,
      );
    } else if (endMs > validTo) {
      warnings.push(
        `Конец подъёма выходит за период действия прогона ${run.id}; для верхних уровней взят последний срок.`,
      );
    }

    const fromHours = (releaseMs - run.runTime.getTime()) / HOUR_MS;
    const toHours = (endMs - run.runTime.getTime()) / HOUR_MS;

    const levels = (
      await Promise.all(
        run.levels.map(async (level) =>
          this.buildLevel(run, level, fromHours, toHours, interp, warnings),
        ),
      )
    ).filter((l): l is StepLevel => l !== undefined);
    const periods = stepPeriods(run.runTime.getTime(), run.steps, releaseMs, endMs);

    const { rows, path } = integrateTrajectory({
      origin: { lat: origin.lat, lon: origin.lon },
      releaseMs,
      levels,
      reportHeights: [...reportHeights],
      ascentRateMs,
      stepSeconds: this.options.stepSeconds,
    });

    // Путь отсчитан от точки выпуска, трассы — от центра планшета станции.
    let crossings: AirwayCrossing[] = [];
    if (station) {
      const onChart = path.map((p) => ({
        ...p,
        dxKm: p.dxKm + origin.dxKm,
        dyKm: p.dyKm + origin.dyKm,
      }));
      crossings = findAirwayCrossings(chartWithAirways(station), onChart);
    } else {
      warnings.push(
        `В ${STATION_RADIUS_KM} км от точки выпуска нет станции с планшетом — пересечение трасс не проверялось.`,
      );
    }
    const aeroLevels = sampleAlongPath(levels, path, releaseMs);

    return {
      ...(station ? { station: toSummary(station) } : {}),
      origin,
      release: release.toISOString(),
      run: toRunInfo(run),
      usedSteps: periods.map((p) => p.step),
      stepPeriods: periods,
      ascentRateMs,
      interp,
      rows,
      path,
      crossings,
      aerology: { levels: aeroLevels, analysis: analyzeAerology(aeroLevels, rows) },
      totalTimeMin: rows.at(-1)?.timeMin ?? 0,
      topHeightM: topHeight,
      warnings,
      generatedAt: new Date().toISOString(),
    };
  }

  private async buildLevel(
    run: Run,
    level: LevelInfo,
    fromHours: number,
    toHours: number,
    interp: InterpMode,
    warnings: string[],
  ): Promise<StepLevel | undefined> {
    const steps = stepsForWindow(level.steps, fromHours, toHours);
    if (steps.length === 0) {
      warnings.push(`Для уровня ${level.mb} гПа нет файлов прогноза — уровень пропущен.`);
      return undefined;
    }

    const loaded: StepField[] = [];
    for (const step of steps) {
      const path = this.catalog.filePath(run, level.mb, step);
      if (!path) continue;
      try {
        loaded.push({ step, field: await this.fields.load(path) });
      } catch (error) {
        warnings.push(
          `Файл ${level.mb} гПа +${step} ч не прочитан: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (loaded.length === 0) {
      warnings.push(`Уровень ${level.mb} гПа пропущен: нет читаемых файлов.`);
      return undefined;
    }

    loaded.sort((a, b) => a.step - b.step);
    return new StepLevel(level.mb, level.fl, level.heightM, run.runTime.getTime(), loaded, interp);
  }
}

/** Планшет, на котором нарисованы именованные трассы (обычно масштаб 10 км). */
function chartWithAirways(station: Station): ChartGeometry {
  const charts = Object.values(station.charts);
  const withAirways = charts.find((c) => c.airways.length > 0);
  return withAirways ?? (charts[0] as ChartGeometry);
}

function clampAscent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 5;
  return Math.min(15, Math.max(1, value));
}
