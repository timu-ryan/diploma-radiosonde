import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  DEFAULT_DIAGRAM_KIND,
  DIAGRAM_KINDS,
  SCALES,
  emptyChart,
  fileStamp,
  isDiagramKind,
  placeStamp,
  releasePlace,
  renderDiagramDocument,
  renderFormDocument,
  type DiagramKind,
  type ForecastRequest,
  type ForecastResponse,
  type InterpMode,
  type JournalProduct,
} from '@rs/shared';
import type { ApiKeyRecord, UserRecord } from '../auth/store.js';
import { toRunInfo, type GribCatalog } from '../grib/catalog.js';
import { HttpError, type ForecastService } from '../forecast/service.js';
import type { JournalStore, NewJournalRecord } from '../journal/store.js';
import { reportFileName, renderTxtReport } from '../report/txt.js';
import { toSummary, type StationRegistry } from '../stations/registry.js';
import { currentUser } from './auth.js';

interface Deps {
  stations: StationRegistry;
  catalog: GribCatalog;
  forecast: ForecastService;
  journal: JournalStore;
}

export interface ForecastQuery {
  station?: string;
  /** Точка выпуска по координатам — вместо станции. */
  lat?: string;
  lon?: string;
  release?: string;
  run?: string;
  interp?: string;
  ascent?: string;
}

/** Координата в десятичных градусах, разделитель — точка или запятая. */
function parseCoordinate(
  value: string | undefined,
  param: string,
  name: string,
  limit: number,
): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) {
    throw new HttpError(
      400,
      'bad_request',
      `Некорректная ${name} точки выпуска (параметр ${param}): ожидается число от −${limit} до ${limit}`,
    );
  }
  return parsed;
}

function parseForecastQuery(query: ForecastQuery): ForecastRequest {
  const station = query.station?.trim();
  const release = query.release?.trim();
  const lat = parseCoordinate(query.lat, 'lat', 'широта', 90);
  const lon = parseCoordinate(query.lon, 'lon', 'долгота', 180);
  if ((lat === undefined) !== (lon === undefined)) {
    throw new HttpError(400, 'bad_request', 'Для точки выпуска нужны обе координаты (параметры lat и lon)');
  }
  if (!station && lat === undefined) {
    throw new HttpError(
      400,
      'bad_request',
      'Не указана станция (параметр station) или точка выпуска (параметры lat и lon)',
    );
  }
  if (!release) {
    throw new HttpError(400, 'bad_request', 'Не указано время выпуска (параметр release)');
  }

  const interp: InterpMode | undefined =
    query.interp === 'bilinear' ? 'bilinear' : query.interp === 'nearest' ? 'nearest' : undefined;

  const ascent = query.ascent === undefined ? undefined : Number(query.ascent);
  if (ascent !== undefined && !Number.isFinite(ascent)) {
    throw new HttpError(400, 'bad_request', 'Некорректная скорость подъёма (параметр ascent)');
  }

  // Если заданы и станция, и координаты, выпуск — из точки по координатам.
  const request: ForecastRequest =
    lat !== undefined && lon !== undefined ? { origin: { lat, lon }, release } : { station, release };
  if (query.run) request.run = query.run;
  if (interp) request.interp = interp;
  if (ascent !== undefined) request.ascent = ascent;
  return request;
}

/** Вид аэрологической диаграммы (параметр kind); без параметра — АДК. */
function parseDiagramKind(value: string | undefined): DiagramKind {
  const kind = value?.trim() || DEFAULT_DIAGRAM_KIND;
  if (!isDiagramKind(kind)) {
    throw new HttpError(
      400,
      'bad_request',
      `Неизвестный вид диаграммы (параметр kind): ожидается ${DIAGRAM_KINDS.join(' или ')}`,
    );
  }
  return kind;
}

/** Запрос расчёта с проверкой прав: выпуск по координатам — только с флагом `canCoordinates`. */
export function forecastRequest(query: ForecastQuery, user: UserRecord | null): ForecastRequest {
  const request = parseForecastQuery(query);
  if (request.origin && !user?.canCoordinates) {
    throw new HttpError(
      403,
      'forbidden',
      'Расчёт по координатам вам недоступен — выберите станцию из списка',
    );
  }
  return request;
}

/** Запись журнала о скачанном бланке, схеме или диаграмме; `apiKey` — если скачано по ключу. */
function journalRecord(
  user: UserRecord,
  apiKey: ApiKeyRecord | null,
  product: JournalProduct,
  variant: string,
  result: ForecastResponse,
): NewJournalRecord {
  return {
    createdAt: new Date(),
    userId: user.id,
    login: user.login,
    fio: user.fio,
    product,
    variant,
    station: result.station && !result.origin.custom ? result.station.name : null,
    place: releasePlace(result).caption.slice(0, 100),
    lat: result.origin.lat,
    lon: result.origin.lon,
    releaseAt: new Date(result.release),
    runId: result.run.id,
    apiKeyId: apiKey?.id ?? null,
    apiKeyName: apiKey?.name ?? '',
  };
}

export async function registerApi(app: FastifyInstance, deps: Deps): Promise<void> {
  const { stations, catalog, forecast, journal } = deps;

  // Скачанный бланк, схема или диаграмма — это выпуск: пишем в журнал. Расчёт для экрана
  // (/api/forecast) — нет. Сбой журнала выпуск не срывает: пользователь своё получит.
  const record = async (
    request: FastifyRequest,
    product: JournalProduct,
    variant: string,
    result: ForecastResponse,
  ): Promise<void> => {
    try {
      await journal.add(journalRecord(currentUser(request), request.apiKey, product, variant, result));
    } catch (error) {
      request.log.error(error, 'Выпуск не записан в журнал');
    }
  };

  app.get<{ Querystring: { q?: string } }>('/api/stations', async (request) => {
    const q = request.query.q?.trim();
    const found = q ? stations.search(q) : stations.all();
    return found.map(toSummary);
  });

  app.get<{ Params: { name: string } }>('/api/stations/:name', async (request) => {
    const station = stations.get(request.params.name);
    if (!station) {
      throw new HttpError(404, 'station_not_found', `Станция ${request.params.name} не найдена`);
    }
    return station;
  });

  app.get<{ Params: { name: string }; Querystring: { scale?: string } }>(
    '/api/stations/:name/chart',
    async (request) => {
      const station = stations.get(request.params.name);
      if (!station) {
        throw new HttpError(404, 'station_not_found', `Станция ${request.params.name} не найдена`);
      }

      const scale = request.query.scale ?? String(station.scales[0] ?? 10);
      const chart = station.charts[String(Number(scale))];
      if (!chart) {
        throw new HttpError(
          404,
          'scale_not_found',
          `Для станции ${station.caption} нет планшета в масштабе ${scale} км`,
          { scales: station.scales },
        );
      }
      return chart;
    },
  );

  app.get('/api/runs', async () => {
    const runs = await catalog.list();
    return runs.map(toRunInfo);
  });

  app.get<{ Querystring: ForecastQuery }>('/api/forecast', async (request) =>
    forecast.compute(forecastRequest(request.query, request.user)),
  );

  // Бланки и диаграмма — файлы для выдачи. Те же обработчики работают и для своего фронтенда,
  // и в /api/v1 для других сайтов (бланк .txt там — report.txt); у v1 стабильны адрес и параметры.
  for (const url of ['/api/forecast.txt', '/api/v1/report.txt']) {
    app.get<{ Querystring: ForecastQuery }>(url, async (request, reply) => {
      const result = await forecast.compute(forecastRequest(request.query, request.user));
      const text = renderTxtReport(result);
      await record(request, 'report', '', result);
      return reply
        .type('text/plain; charset=utf-8')
        .header('content-disposition', `attachment; filename="${reportFileName(result)}"`)
        .send(text);
    });
  }

  // Бланк со схемой в SVG: этим же адресом пользуется кнопка скачивания,
  // поэтому обе схемы (100 и 50 км) можно получить, не переключая масштаб.
  for (const url of ['/api/chart.svg', '/api/v1/chart.svg']) {
    app.get<{ Querystring: ForecastQuery & { scale?: string; download?: string } }>(
      url,
      async (request, reply) => {
        const result = await forecast.compute(forecastRequest(request.query, request.user));
        // Вдали от станций точка по координатам рисуется на пустом планшете.
        const station = result.station ? stations.get(result.station.name) : undefined;
        const scales: readonly number[] = station?.scales ?? SCALES;

        const scale = Number(request.query.scale ?? scales[0] ?? 10);
        const chart = station
          ? station.charts[String(scale)]
          : scales.includes(scale)
            ? emptyChart(scale)
            : undefined;
        if (!chart) {
          throw new HttpError(
            404,
            'scale_not_found',
            station
              ? `Для станции ${station.caption} нет планшета в масштабе ${scale} км`
              : `Нет планшета в масштабе ${scale} км`,
            { scales },
          );
        }

        const svg = renderFormDocument({
          chart,
          rows: result.rows,
          path: result.path,
          station: result.station,
          origin: result.origin,
          releaseIso: result.release,
          runTimeIso: result.run.runTime,
        });
        await record(request, 'chart', String(chart.radiusKm), result);

        reply.type('image/svg+xml; charset=utf-8');
        if (request.query.download !== undefined && request.query.download !== '0') {
          const name = `radiosonde_${placeStamp(result)}_${fileStamp(result.release)}_${chart.radiusKm}km.svg`;
          reply.header('content-disposition', `attachment; filename="${name}"`);
        }
        return reply.send(svg);
      },
    );
  }

  // Аэрологическая диаграмма по профилю вдоль траектории — для скачивания, всегда светлая.
  // kind=skewt (АДК, по умолчанию) или kind=stuve (АДП).
  for (const url of ['/api/diagram.svg', '/api/v1/diagram.svg']) {
    app.get<{ Querystring: ForecastQuery & { kind?: string; download?: string } }>(
      url,
      async (request, reply) => {
        const kind = parseDiagramKind(request.query.kind);
        const result = await forecast.compute(forecastRequest(request.query, request.user));
        const svg = renderDiagramDocument({
          aerology: result.aerology,
          station: releasePlace(result),
          releaseIso: result.release,
          runTimeIso: result.run.runTime,
          usedSteps: result.usedSteps,
          kind,
        });
        await record(request, 'diagram', kind, result);

        reply.type('image/svg+xml; charset=utf-8');
        if (request.query.download !== undefined && request.query.download !== '0') {
          const suffix = kind === DEFAULT_DIAGRAM_KIND ? '' : `_${kind}`;
          const name = `aerology_${placeStamp(result)}_${fileStamp(result.release)}${suffix}.svg`;
          reply.header('content-disposition', `attachment; filename="${name}"`);
        }
        return reply.send(svg);
      },
    );
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    stations: stations.size,
    runs: (await catalog.list()).length,
  }));
}
