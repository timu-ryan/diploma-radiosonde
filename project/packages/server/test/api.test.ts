import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, ChartGeometry, ForecastResponse, RunInfo, StationSummary } from '@rs/shared';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';
import { login } from './helpers.js';

process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
/** Cookie сессии пользователя со всеми правами, кроме админки. */
let session = '';
/** Cookie пользователя без права считать по координатам. */
let stationsOnly = '';

const get = (url: string, cookie = session): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'GET', url, headers: { cookie } });

beforeAll(async () => {
  const store = new MemoryUserStore();
  const users = new UserService(store);
  await users.create({ login: 'synoptic', password: 'пароль-синоптика', canCoordinates: true });
  await users.create({ login: 'station', password: 'пароль-станции' });

  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ users: store });
  session = await login(app, 'synoptic', 'пароль-синоптика');
  stationsOnly = await login(app, 'station', 'пароль-станции');
});

afterAll(async () => {
  await app?.close();
});

describe('API', () => {
  it('отдаёт список станций', async () => {
    const response = await get('/api/stations');
    expect(response.statusCode).toBe(200);

    const stations = response.json<StationSummary[]>();
    expect(stations.length).toBe(105);

    const arkh = stations.find((s) => s.name === 'ARCHNGL');
    expect(arkh).toMatchObject({ caption: 'Архангельск', index: '22550', scales: [10, 5] });
  });

  it('ищет станцию по названию и индексу', async () => {
    for (const q of ['арханг', '22550', 'archngl']) {
      const response = await get(`/api/stations?q=${encodeURIComponent(q)}`);
      expect(response.json<StationSummary[]>().map((s) => s.name)).toContain('ARCHNGL');
    }
  });

  it('отдаёт планшет в запрошенном масштабе', async () => {
    const response = await get('/api/stations/ARCHNGL/chart?scale=5');
    const chart = response.json<ChartGeometry>();
    expect(chart.scaleKm).toBe(5);
    expect(chart.radiusKm).toBe(50);
    expect(chart.canvasSize).toBe(536);
    expect(chart.center).toEqual({ x: 268, y: 268 });
    expect(chart.pxPerKm).toBeCloseTo(5.36, 6);
    expect(chart.polylines.length).toBeGreaterThan(0);
    expect(chart.labels.length).toBeGreaterThan(0);

    const missing = await get('/api/stations/KTELNIY/chart?scale=5');
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ApiError>().error).toBe('scale_not_found');
  });

  it('перечисляет прогоны с периодом действия', async () => {
    const runs = (await get('/api/runs')).json<RunInfo[]>();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: '2026080700',
      steps: [6, 9, 12],
      levels: [850, 700, 500, 300],
      // +6 ч действует с +4,5 ч, +12 ч — до +13,5 ч
      validFrom: '2026-08-07T04:30:00.000Z',
      validTo: '2026-08-07T13:30:00.000Z',
    });
  });

  it('считает перемещение радиозонда по реальным данным', async () => {
    const response = await get('/api/forecast?station=ARCHNGL&release=2026-08-07T11:30:00Z');
    expect(response.statusCode).toBe(200);

    const forecast = response.json<ForecastResponse>();
    // 11:30–12:00 целиком в периоде действия +12 ч (10:30–13:30)
    expect(forecast.usedSteps).toEqual([12]);
    expect(forecast.stepPeriods).toEqual([
      { step: 12, from: '2026-08-07T11:30:00.000Z', to: '2026-08-07T12:00:00.000Z' },
    ]);
    expect(forecast.ascentRateMs).toBe(5);
    // Лестница высот бланка, обрезанная по верхнему уровню прогона (300 гПа = 9000 м)
    expect(forecast.rows.map((r) => r.heightM)).toEqual([1500, 3000, 5000, 7000, 9000]);
    expect(forecast.rows.map((r) => Math.round(r.timeMin))).toEqual([5, 10, 17, 23, 30]);
    expect(forecast.rows.map((r) => Math.round(r.layerTimeMin))).toEqual([5, 5, 7, 7, 7]);
    expect(forecast.totalTimeMin).toBeCloseTo(30, 6);
    expect(forecast.topHeightM).toBe(9000);

    // Ветер западных румбов (241…277°) — снос на восток
    for (const row of forecast.rows) {
      expect(row.azimuthDeg).toBeGreaterThan(40);
      expect(row.azimuthDeg).toBeLessThan(120);
      expect(row.dxKm).toBeGreaterThan(0);
    }
    // Удаление растёт с высотой, сумма смещений по слоям не меньше удаления
    const distances = forecast.rows.map((r) => r.distanceKm);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    const layers = forecast.rows.reduce((sum, r) => sum + r.layerDistanceKm, 0);
    expect(layers).toBeGreaterThanOrEqual((distances.at(-1) as number) - 1e-6);

    expect(forecast.path.length).toBeGreaterThan(100);
    expect(forecast.warnings).toHaveLength(1);
    expect(forecast.warnings[0]).toContain('9000 м');
  });

  it('переключает срок прогноза на границе периода действия', async () => {
    const load = async (release: string): Promise<ForecastResponse> =>
      (
        await get(`/api/forecast?station=ARCHNGL&release=${release}`)
      ).json<ForecastResponse>();

    // Подъём 10:15–10:45 пересекает границу 10:30 между +9 и +12 ч
    const crossing = await load('2026-08-07T10:15:00Z');
    expect(crossing.usedSteps).toEqual([9, 12]);
    expect(crossing.stepPeriods.map((p) => [p.step, p.from, p.to])).toEqual([
      [9, '2026-08-07T10:15:00.000Z', '2026-08-07T10:30:00.000Z'],
      [12, '2026-08-07T10:30:00.000Z', '2026-08-07T10:45:00.000Z'],
    ]);

    // Ветер на нижних высотах совпадает с чистым +9 ч, на верхних — с чистым +12 ч
    const pure9 = await load('2026-08-07T08:00:00Z');
    const pure12 = await load('2026-08-07T11:00:00Z');
    expect(pure9.usedSteps).toEqual([9]);
    expect(pure12.usedSteps).toEqual([12]);
    expect(crossing.rows[0]?.windDirDeg).toBe(pure9.rows[0]?.windDirDeg);
    expect(crossing.rows.at(-1)?.windSpeedMs).toBe(pure12.rows.at(-1)?.windSpeedMs);

    // Начало периода действия прогона — 04:30, раньше данных нет
    expect((await get('/api/forecast?station=ARCHNGL&release=2026-08-07T04:30:00Z')).statusCode).toBe(200);
    expect((await get('/api/forecast?station=ARCHNGL&release=2026-08-07T04:29:00Z')).statusCode).toBe(400);
  });

  it('находит пересекаемые трассы', async () => {
    const forecast = (
      await get('/api/forecast?station=ARCHNGL&release=2026-08-07T11:30:00Z')
    ).json<ForecastResponse>();

    expect(forecast.crossings.length).toBeGreaterThan(0);
    for (const crossing of forecast.crossings) {
      expect(crossing.airway).toMatch(/^\S+$/);
      expect(crossing.fromHeightM).toBeLessThanOrEqual(crossing.toHeightM);
      expect(crossing.fromTimeMin).toBeLessThanOrEqual(crossing.toTimeMin);
      expect(crossing.toTimeMin).toBeLessThanOrEqual(forecast.totalTimeMin + 1e-6);
      // Трассы нарисованы на планшете 100 км — пересечение не может быть выше потолка отчёта
      expect(crossing.toHeightM).toBeLessThanOrEqual(forecast.topHeightM);
    }
  });

  it('строит профиль для аэрологической диаграммы вдоль траектории', async () => {
    const forecast = (
      await get('/api/forecast?station=ARCHNGL&release=2026-08-07T11:30:00Z')
    ).json<ForecastResponse>();

    const { levels, analysis } = forecast.aerology;
    expect(levels.map((l) => l.mb)).toEqual([850, 700, 500, 300]);
    // Высоты уровней 1500/3000/5400/9000 м при подъёме 5 м/с
    expect(levels.map((l) => Math.round(l.timeMin))).toEqual([5, 10, 18, 30]);
    // Верхний уровень — в конце пути, нижние — по пути от станции
    expect(levels.at(-1)).toMatchObject({ lat: forecast.path.at(-1)?.lat, lon: forecast.path.at(-1)?.lon });
    expect(levels[0]!.lon).toBeGreaterThan(forecast.station.lon);

    // Температура падает с высотой; на 300 гПа летом — около −40 °C
    expect(levels[0]!.tempC).toBeGreaterThan(levels.at(-1)!.tempC);
    expect(analysis.maxWind?.mb).toBeDefined();
    expect(analysis.verticalTotals).toBe(levels[0]!.tempC - levels[2]!.tempC);
    expect(analysis.meanWinds.map((w) => w.heightM)).toEqual(forecast.rows.map((r) => r.heightM));
  });

  it('отдаёт аэрологическую диаграмму в SVG', async () => {
    const response = await get('/api/diagram.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body).toContain('Прогностическая аэрологическая диаграмма · Архангельск (22550)');
    expect(response.body).toContain('ниже 850 гПа данных прогноза нет');
    expect(response.body.match(/>\d{3}\/\d+<\/text>/g)).toHaveLength(4);

    const download = await get('/api/diagram.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z&download=1');
    expect(download.headers['content-disposition']).toContain('aerology_ARCHNGL_20260807_1130.svg');
    expect(response.body).toContain('>АДК · Skew-T<');
  });

  it('отдаёт диаграмму АДП по параметру kind и отклоняет неизвестный вид', async () => {
    const stuve = await get('/api/diagram.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z&kind=stuve&download=1');
    expect(stuve.statusCode).toBe(200);
    expect(stuve.body).toContain('>АДП · Stüve<');
    expect(stuve.body.match(/>\d{3}\/\d+<\/text>/g)).toHaveLength(4);
    expect(stuve.headers['content-disposition']).toContain('aerology_ARCHNGL_20260807_1130_stuve.svg');

    const unknown = await get('/api/diagram.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z&kind=emagram');
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<ApiError>().error).toBe('bad_request');
    expect(unknown.json<ApiError>().message).toContain('skewt или stuve');
  });

  it('объясняет, почему на указанное время нет данных', async () => {
    const response = await get('/api/forecast?station=ARCHNGL&release=2026-08-06T00:00:00Z');
    expect(response.statusCode).toBe(400);

    const error = response.json<ApiError>();
    expect(error.error).toBe('no_data_for_time');
    expect(error.available).toEqual([
      { run: '2026080700', from: '2026-08-07T04:30:00.000Z', to: '2026-08-07T13:30:00.000Z' },
    ]);
  });

  it('проверяет параметры запроса', async () => {
    expect((await get('/api/forecast')).statusCode).toBe(400);
    expect(
      (await get('/api/forecast?station=НЕТ&release=2026-08-07T11:30:00Z'))
        .statusCode,
    ).toBe(404);
  });

  it('формирует текстовый отчёт', async () => {
    const response = await get('/api/forecast.txt?station=ARCHNGL&release=2026-08-07T11:30:00Z');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('charset=utf-8');
    expect(response.headers['content-disposition']).toContain('radiosonde_ARCHNGL_20260807_1130.txt');

    const text = response.body;
    expect(text).toContain('ПРОГНОЗ ПЕРЕМЕЩЕНИЯ РАДИОЗОНДА');
    expect(text).toContain('на 11:30 UTC  " 07 " 08 2026');
    expect(text).toContain('Архангельск');
    expect(text).toContain('Пересекаемые трассы, высоты, время:');
    expect(text).not.toContain('Радиозонд будет находится в пределах трасс');
    expect(text).toMatch(
      /Радиозонд будет пересекать трассу \S+ в аз\. \d+ - (?:\d+|XXX)° на уд\. \d+ - (?:\d+|XXX) км в слое \d+ - (?:\d+|XXX) м в \d{2}:\d{2}:\d{2} - (?:\d{2}:\d{2}:\d{2}|XXX) UTC/,
    );
    expect(text).toContain('Дежурный синоптик:');
    expect(text).toContain('РПА');

    // По строке на каждую высоту, смещение в слое — в той же строке.
    const heights = text.split('\r\n').filter((l) => l.startsWith(' Высота'));
    expect(heights).toHaveLength(5);
    expect(heights[0]).toMatch(
      /^ Высота 1500 {3}Ветер {2}\d{3}-\d{2} Время подъёма\(мин\) 5 {3}Азимут\(°\) \d{3} Удаление\(км\) \d{3} {2}Смещение\(км\) \d+$/,
    );
    expect(text.split('\r\n').filter((l) => l.startsWith('Смещение(км) '))).toHaveLength(0);
    expect(text).toContain('Примечания:');
    expect(text).toContain('9000 м вместо 16000 м');
  });

  it('отдаёт бланк со схемой в SVG в любом масштабе', async () => {
    const load = async (scale: number): Promise<string> => {
      const response = await get(`/api/chart.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z&scale=${scale}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('image/svg+xml');
      return response.body;
    };

    const wide = await load(10);
    const close = await load(5);

    expect(wide).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    // Шапка бланка
    expect(wide).toContain('ПРОГНОЗ СМЕЩЕНИЯ РАДИОЗОНДА');
    expect(wide).toContain('Предоставлено АМЦ/АМСГ');
    expect(wide).toContain('Аэрологическая станция');
    expect(wide).toContain('64,62 с.ш.');
    expect(wide).toContain('07 08 2026');
    expect(wide).toContain('Время выпуска р/з:');
    expect(wide).toContain('МАСШТАБ: 1 деление - 10 км');
    expect(close).toContain('МАСШТАБ: 1 деление - 5 км');
    // Таблица и поля для подписей
    expect(wide).toContain('Удаление,');
    expect(wide).toContain('Время вручения');
    expect(wide).toContain('Деж. синоптик');
    // Чёрно-белый: цветных заливок в бланке нет
    expect(wide).not.toMatch(/#(ea580c|f97316|0ea5e9|38bdf8)/i);

    // Подписи ориентиров есть только на планшете 5 км
    expect(close).toContain('ПЕТИР');
    expect(close).toContain('>Т825</text>');
    expect(wide).not.toBe(close);

    const download = await get('/api/chart.svg?station=ARCHNGL&release=2026-08-07T11:30:00Z&scale=5&download=1');
    expect(download.headers['content-disposition']).toContain(
      'radiosonde_ARCHNGL_20260807_1130_50km.svg',
    );
  });
});

describe('API: выпуск по координатам', () => {
  const RELEASE = 'release=2026-08-07T11:30:00Z';
  const load = async (query: string): Promise<ForecastResponse> => {
    const response = await get(`/api/forecast?${query}&${RELEASE}`);
    expect(response.statusCode).toBe(200);
    return response.json<ForecastResponse>();
  };

  it('из точки станции считает так же, как со станции', async () => {
    const fromStation = await load('station=ARCHNGL');
    const fromPoint = await load('lat=64.62&lon=40.51');

    expect(fromStation.origin).toEqual({ lat: 64.62, lon: 40.51, custom: false, dxKm: 0, dyKm: 0 });
    expect(fromPoint.origin).toMatchObject({ custom: true, dxKm: 0, dyKm: 0 });
    expect(fromPoint.station?.name).toBe('ARCHNGL');
    expect(fromPoint.rows).toEqual(fromStation.rows);
    expect(fromPoint.crossings).toEqual(fromStation.crossings);
  });

  it('рядом со станцией рисует точку на её планшете со смещением', async () => {
    // ≈9 км к северу и ≈4 км к востоку от Архангельска; запятая в числе допустима
    const forecast = await load('lat=64,70&lon=40,6');

    expect(forecast.station?.name).toBe('ARCHNGL');
    expect(forecast.origin).toMatchObject({ lat: 64.7, lon: 40.6, custom: true });
    expect(forecast.origin.dyKm).toBeCloseTo(8.9, 0);
    expect(forecast.origin.dxKm).toBeCloseTo(4.3, 0);
    // Путь по-прежнему отсчитан от точки выпуска
    expect(forecast.path[0]).toMatchObject({ dxKm: 0, dyKm: 0, lat: 64.7, lon: 40.6 });
    expect(forecast.warnings).toHaveLength(1);
  });

  it('вдали от станций считает без планшета и трасс', async () => {
    const forecast = await load('lat=45&lon=-40');

    expect(forecast.station).toBeUndefined();
    expect(forecast.origin).toEqual({ lat: 45, lon: -40, custom: true, dxKm: 0, dyKm: 0 });
    expect(forecast.rows).toHaveLength(5);
    expect(forecast.crossings).toEqual([]);
    expect(forecast.warnings.some((w) => w.includes('пересечение трасс не проверялось'))).toBe(true);
  });

  it('координаты главнее станции', async () => {
    const forecast = await load('station=ARCHNGL&lat=45&lon=-40');
    expect(forecast.station).toBeUndefined();
    expect(forecast.origin.custom).toBe(true);
  });

  it('проверяет координаты', async () => {
    const status = async (query: string): Promise<number> =>
      (await get(`/api/forecast?${query}&${RELEASE}`)).statusCode;

    expect(await status('lat=64.7')).toBe(400);
    expect(await status('lat=91&lon=40')).toBe(400);
    expect(await status('lat=64&lon=181')).toBe(400);
    expect(await status('lat=север&lon=40')).toBe(400);
  });

  it('формирует отчёт, бланк и диаграмму для точки', async () => {
    const txt = await get(`/api/forecast.txt?lat=64.7&lon=40.6&${RELEASE}`);
    expect(txt.statusCode).toBe(200);
    expect(txt.headers['content-disposition']).toContain('radiosonde_64.70N_40.60E_20260807_1130.txt');
    expect(txt.body).toContain('Точка выпуска у ст. Архангельск   64,70 с.ш. 40,60 в.д.');

    const near = await get(`/api/chart.svg?lat=64.7&lon=40.6&${RELEASE}&scale=5`);
    expect(near.statusCode).toBe(200);
    expect(near.body).toContain('Точка выпуска р/з');
    expect(near.body).toContain('у ст. Архангельск');
    expect(near.body).toContain('64,70 с.ш.');
    // Планшет станции: ориентиры на месте
    expect(near.body).toContain('ПЕТИР');

    const far = await get(`/api/chart.svg?lat=45&lon=-40&${RELEASE}&scale=10&download=1`);
    expect(far.statusCode).toBe(200);
    expect(far.body).toContain('по координатам');
    expect(far.body).toContain('40,00 з.д.');
    expect(far.headers['content-disposition']).toContain('radiosonde_45.00N_40.00W_20260807_1130_100km.svg');

    const diagram = await get(`/api/diagram.svg?lat=45&lon=-40&${RELEASE}`);
    expect(diagram.statusCode).toBe(200);
    expect(diagram.body).toContain('Прогностическая аэрологическая диаграмма · Точка выпуска<');
  });
});

describe('API: вход и права', () => {
  const POINT = 'lat=64.7&lon=40.6&release=2026-08-07T11:30:00Z';

  it('без входа закрыт весь API, кроме проверки здоровья', async () => {
    for (const url of [
      '/api/stations',
      '/api/runs',
      '/api/auth/me',
      '/api/forecast?station=ARCHNGL&release=2026-08-07T11:30:00Z',
      '/api/forecast.txt?station=ARCHNGL&release=2026-08-07T11:30:00Z',
      '/api/admin/users',
    ]) {
      const response = await get(url, '');
      expect(response.statusCode, url).toBe(401);
      expect(response.json<ApiError>().error).toBe('unauthorized');
    }
    expect((await get('/api/health', '')).statusCode).toBe(200);
    // Несуществующий адрес не раскрывает ничего, кроме 404
    expect((await get('/api/nonexistent', '')).statusCode).toBe(404);
  });

  it('не принимает подделанную cookie', async () => {
    // Чужой id с подписью от своей сессии
    const forged = session.replace(/^rs_session=1\./, 'rs_session=2.');
    expect(forged).not.toBe(session);
    expect((await get('/api/stations', forged)).statusCode).toBe(401);
    expect((await get('/api/stations', 'rs_session=1.0.9999999999.signature')).statusCode).toBe(401);
  });

  it('отвечает, кто вошёл', async () => {
    expect((await get('/api/auth/me')).json()).toEqual({
      id: 1,
      login: 'synoptic',
      fio: '',
      isAdmin: false,
      canCoordinates: true,
    });
  });

  it('без права на координаты считает только со станции', async () => {
    expect((await get('/api/forecast?station=ARCHNGL&release=2026-08-07T11:30:00Z', stationsOnly)).statusCode).toBe(200);
    for (const path of ['forecast', 'forecast.txt', 'chart.svg', 'diagram.svg']) {
      const response = await get(`/api/${path}?${POINT}`, stationsOnly);
      expect(response.statusCode, path).toBe(403);
      expect(response.json<ApiError>().error).toBe('forbidden');
    }
    expect((await get(`/api/forecast?${POINT}`)).statusCode).toBe(200);
  });

  it('не пускает в админку без прав администратора', async () => {
    expect((await get('/api/admin/users')).statusCode).toBe(403);
  });

  it('отвечает 400 на битый JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{не json',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ApiError>().error).toBe('bad_request');
  });
});
