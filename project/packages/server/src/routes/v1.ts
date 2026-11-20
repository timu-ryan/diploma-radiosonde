import type { FastifyInstance } from 'fastify';
import type {
  ForecastResponse,
  RunInfo,
  StationSummary,
  V1Run,
  V1Station,
  V1Trajectory,
} from '@rs/shared';
import type { ForecastService } from '../forecast/service.js';
import { toRunInfo, type GribCatalog } from '../grib/catalog.js';
import type { StationRegistry } from '../stations/registry.js';
import { forecastRequest, type ForecastQuery } from './api.js';

interface Deps {
  stations: StationRegistry;
  catalog: GribCatalog;
  forecast: ForecastService;
}

// Ответы собираются по полю, а не пересылаются как есть: правка внутренних типов /api/*
// не должна менять форму /api/v1 (см. shared/v1.ts).

const toV1Run = (run: RunInfo): V1Run => ({
  id: run.id,
  runTime: run.runTime,
  validFrom: run.validFrom,
  validTo: run.validTo,
});

const toV1Station = (station: StationSummary): V1Station => ({
  name: station.name,
  caption: station.caption,
  index: station.index,
  amsg: station.amsg,
  lat: station.lat,
  lon: station.lon,
});

export function toV1Trajectory(result: ForecastResponse): V1Trajectory {
  return {
    release: result.release,
    run: toV1Run(result.run),
    origin: { lat: result.origin.lat, lon: result.origin.lon },
    station: result.station && !result.origin.custom ? toV1Station(result.station) : null,
    ascentRateMs: result.ascentRateMs,
    path: result.path.map((p) => ({ timeMin: p.timeMin, heightM: p.heightM, lat: p.lat, lon: p.lon })),
    levels: result.rows.map((row) => ({
      timeMin: row.timeMin,
      heightM: row.heightM,
      lat: row.lat,
      lon: row.lon,
      pressureHpa: row.mb,
      distanceKm: row.distanceKm,
      azimuthDeg: row.azimuthDeg,
      tempC: row.tempC,
      windDirDeg: row.windDirDeg,
      windSpeedMs: row.windSpeedMs,
    })),
    crossings: result.crossings.map((c) => ({
      airway: c.airway,
      fromHeightM: c.fromHeightM,
      toHeightM: c.toHeightM,
      fromTimeMin: c.fromTimeMin,
      toTimeMin: c.toTimeMin,
      fromAzimuthDeg: c.fromAzimuthDeg,
      toAzimuthDeg: c.toAzimuthDeg,
      fromDistanceKm: c.fromDistanceKm,
      toDistanceKm: c.toDistanceKm,
      exited: c.exited,
    })),
    warnings: [...result.warnings],
  };
}

/**
 * API для других сайтов: вход по ключу API (`Authorization: Bearer …`) или, для проверки
 * из браузера, обычной сессией. Здесь — данные в JSON; бланки и диаграмму под /api/v1
 * регистрирует routes/api.ts теми же обработчиками, что и для своего фронтенда.
 * Траектория в журнал не пишется — как и расчёт для экрана.
 */
export async function registerV1(app: FastifyInstance, deps: Deps): Promise<void> {
  const { stations, catalog, forecast } = deps;

  app.get('/api/v1/runs', async (): Promise<V1Run[]> =>
    (await catalog.list()).map((run) => toV1Run(toRunInfo(run))),
  );

  app.get('/api/v1/stations', async (): Promise<V1Station[]> => stations.all().map(toV1Station));

  app.get<{ Querystring: ForecastQuery }>('/api/v1/trajectory', async (request): Promise<V1Trajectory> =>
    toV1Trajectory(await forecast.compute(forecastRequest(request.query, request.user))),
  );
}
