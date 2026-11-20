import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, ApiKeyInfo, CreatedApiKey, JournalPage, V1Run, V1Trajectory } from '@rs/shared';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';
import { MemoryJournalStore } from '../src/journal/store.js';
import { login } from './helpers.js';

process.env.LOG_LEVEL = 'silent';

const RELEASE = 'release=2026-08-07T11:30:00Z';
const POINT = `lat=64.7&lon=40.6&${RELEASE}`;

let app: FastifyInstance;
const journal = new MemoryJournalStore();
let admin = '';
let siteId = 0;
let stationId = 0;
/** Ключ сайта с правом расчёта по координатам. */
let key = '';
let keyId = 0;

const inject = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  payload?: object,
): Promise<LightMyRequestResponse> => app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

const asAdmin = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  inject(method, url, { cookie: admin }, payload);

const withKey = (url: string, apiKey = key): Promise<LightMyRequestResponse> =>
  inject('GET', url, { authorization: `Bearer ${apiKey}` });

const createKey = async (userId: number, name: string): Promise<CreatedApiKey> => {
  const response = await asAdmin('POST', '/api/admin/keys', { userId, name });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<CreatedApiKey>();
};

const keys = async (): Promise<ApiKeyInfo[]> => (await asAdmin('GET', '/api/admin/keys')).json<ApiKeyInfo[]>();

beforeAll(async () => {
  const store = new MemoryUserStore();
  const users = new UserService(store);
  await users.create({ login: 'admin', password: 'пароль-админа', isAdmin: true });
  siteId = (await users.create({ login: 'site-x', password: 'пароль-сайта', canCoordinates: true })).id;
  stationId = (await users.create({ login: 'station', password: 'пароль-станции' })).id;

  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ users: store, journal });
  admin = await login(app, 'admin', 'пароль-админа');
});

afterAll(async () => {
  await app?.close();
});

describe('ключи API', () => {
  it('выдаёт ключ один раз и не показывает его в списке', async () => {
    const created = await createKey(siteId, ' Карта АМЦ ');
    key = created.key;
    keyId = created.id;
    expect(created).toMatchObject({ userId: siteId, login: 'site-x', name: 'Карта АМЦ', lastUsedAt: null });
    expect(key).toMatch(/^rsk_[\w-]{32}$/);
    expect(created.prefix).toBe(key.slice(0, 12));

    const response = await asAdmin('GET', '/api/admin/keys');
    expect(response.json<ApiKeyInfo[]>().map((k) => [k.name, k.login, k.prefix])).toEqual([
      ['Карта АМЦ', 'site-x', created.prefix],
    ]);
    expect(response.body).not.toContain(key);
    expect(response.body).not.toContain('keyHash');
  });

  it('проверяет данные нового ключа и пускает только администратора', async () => {
    expect((await asAdmin('POST', '/api/admin/keys', { userId: siteId })).statusCode).toBe(400);
    expect((await asAdmin('POST', '/api/admin/keys', { userId: '2', name: 'x' })).statusCode).toBe(400);
    const unknown = await asAdmin('POST', '/api/admin/keys', { userId: 999, name: 'x' });
    expect(unknown.json<ApiError>().error).toBe('user_not_found');

    const site = await login(app, 'site-x', 'пароль-сайта');
    expect((await inject('GET', '/api/admin/keys', { cookie: site })).statusCode).toBe(403);
  });

  it('пускает по ключу только в /api/v1', async () => {
    const runs = await withKey('/api/v1/runs');
    expect(runs.statusCode).toBe(200);
    expect(runs.json<V1Run[]>()).toEqual([
      expect.objectContaining({ id: '2026080700', validFrom: expect.any(String), validTo: expect.any(String) }),
    ]);

    for (const url of ['/api/stations', '/api/auth/me', '/api/admin/users', `/api/forecast?${POINT}`]) {
      const response = await withKey(url);
      expect(response.statusCode, url).toBe(401);
      expect(response.json<ApiError>().error).toBe('unauthorized');
    }
    expect((await withKey('/api/v1/runs', 'rsk_неправильный')).statusCode).toBe(401);
    expect((await inject('GET', '/api/v1/runs', { authorization: 'Basic c2l0ZTp4' })).statusCode).toBe(401);
    expect((await inject('GET', '/api/v1/runs', {})).statusCode).toBe(401);
    // Из браузера с обычной сессией /api/v1 тоже открыт — для проверки
    expect((await asAdmin('GET', '/api/v1/runs')).statusCode).toBe(200);
  });

  it('запоминает время последнего запроса', async () => {
    expect((await keys())[0]?.lastUsedAt).not.toBeNull();
  });
});

describe('/api/v1', () => {
  it('отдаёт траекторию для карты в своей, стабильной форме', async () => {
    const before = (await journal.list({ limit: 100 })).length;
    const response = await withKey(`/api/v1/trajectory?${POINT}`);
    expect(response.statusCode, response.body).toBe(200);
    const trajectory = response.json<V1Trajectory>();

    expect(Object.keys(trajectory).sort()).toEqual([
      'ascentRateMs',
      'crossings',
      'levels',
      'origin',
      'path',
      'release',
      'run',
      'station',
      'warnings',
    ]);
    expect(trajectory).toMatchObject({ release: '2026-08-07T11:30:00.000Z', origin: { lat: 64.7, lon: 40.6 }, station: null });
    expect(Object.keys(trajectory.run).sort()).toEqual(['id', 'runTime', 'validFrom', 'validTo']);
    expect(trajectory.path.length).toBeGreaterThan(10);
    expect(Object.keys(trajectory.path[0] ?? {}).sort()).toEqual(['heightM', 'lat', 'lon', 'timeMin']);
    expect(Object.keys(trajectory.levels[0] ?? {}).sort()).toEqual([
      'azimuthDeg',
      'distanceKm',
      'heightM',
      'lat',
      'lon',
      'pressureHpa',
      'tempC',
      'timeMin',
      'windDirDeg',
      'windSpeedMs',
    ]);
    // Траектория — как расчёт для экрана: в журнал не пишется
    expect((await journal.list({ limit: 100 })).length).toBe(before);
  });

  it('со станции отдаёт станцию выпуска', async () => {
    const trajectory = (await withKey(`/api/v1/trajectory?station=ARCHNGL&${RELEASE}`)).json<V1Trajectory>();
    expect(trajectory.station).toEqual({
      name: 'ARCHNGL',
      caption: 'Архангельск',
      index: expect.any(String),
      amsg: expect.any(String),
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
    const stations = (await withKey('/api/v1/stations')).json<{ name: string }[]>();
    expect(stations.some((s) => s.name === 'ARCHNGL')).toBe(true);
  });

  it('при выпуске по координатам отдаёт пересечение с азимутами и удалениями от станции', async () => {
    const response = await withKey(`/api/v1/trajectory?${POINT}`);
    expect(response.statusCode, response.body).toBe(200);
    const trajectory = response.json<V1Trajectory>();

    expect(trajectory.station).toBeNull();
    // Точка выпуска смещена от станции: полярные координаты относятся к её планшету.
    expect(trajectory.crossings).toEqual([
      {
        airway: 'М58',
        fromHeightM: expect.closeTo(2570.52, 1),
        toHeightM: expect.closeTo(6500.94, 1),
        fromTimeMin: expect.closeTo(8.57, 1),
        toTimeMin: expect.closeTo(21.67, 1),
        fromAzimuthDeg: expect.closeTo(51.59, 1),
        toAzimuthDeg: expect.closeTo(59.22, 1),
        fromDistanceKm: expect.closeTo(13.33, 1),
        toDistanceKm: expect.closeTo(24.97, 1),
        exited: true,
      },
    ]);
  });

  it('отличает конец пути внутри трассы от выхода и сохраняет числовые поля to*', async () => {
    const response = await withKey(`/api/v1/trajectory?station=ARCHNGL&${RELEASE}&ascent=15`);
    expect(response.statusCode, response.body).toBe(200);
    const trajectory = response.json<V1Trajectory>();
    const crossing = trajectory.crossings.find((c) => !c.exited);
    const end = trajectory.path.at(-1);

    expect(end).toBeDefined();
    expect(crossing).toMatchObject({
      airway: 'М58',
      toHeightM: end?.heightM,
      toTimeMin: end?.timeMin,
      toAzimuthDeg: expect.any(Number),
      toDistanceKm: expect.any(Number),
      exited: false,
    });
    expect(trajectory.crossings.some((c) => c.exited)).toBe(true);
  });

  it('по ключу соблюдает права владельца', async () => {
    const stationKey = (await createKey(stationId, 'Сайт станции')).key;
    expect((await withKey(`/api/v1/trajectory?station=ARCHNGL&${RELEASE}`, stationKey)).statusCode).toBe(200);
    const response = await withKey(`/api/v1/trajectory?${POINT}`, stationKey);
    expect(response.statusCode).toBe(403);
    expect(response.json<ApiError>().error).toBe('forbidden');
  });

  it('картинки и бланк по ключу пишутся в журнал с пометкой ключа', async () => {
    const diagram = await withKey(`/api/v1/diagram.svg?station=ARCHNGL&${RELEASE}&kind=skewt`);
    expect(diagram.statusCode).toBe(200);
    expect(diagram.headers['content-type']).toContain('image/svg+xml');
    expect((await withKey(`/api/v1/chart.svg?${POINT}&scale=5`)).statusCode).toBe(200);
    expect((await withKey(`/api/v1/report.txt?station=ARCHNGL&${RELEASE}`)).statusCode).toBe(200);
    // То же с сайта — без пометки
    expect((await asAdmin('GET', `/api/diagram.svg?station=ARCHNGL&${RELEASE}`)).statusCode).toBe(200);

    const byKey = (await asAdmin('GET', '/api/admin/journal?source=key')).json<JournalPage>().entries;
    expect(byKey.map((e) => [e.product, e.login, e.apiKey])).toEqual([
      ['report', 'site-x', 'Карта АМЦ'],
      ['chart', 'site-x', 'Карта АМЦ'],
      ['diagram', 'site-x', 'Карта АМЦ'],
    ]);
    const fromSite = (await asAdmin('GET', '/api/admin/journal?source=site')).json<JournalPage>().entries;
    expect(fromSite.map((e) => [e.product, e.login, e.apiKey])).toEqual([['diagram', 'admin', null]]);
    expect((await asAdmin('GET', '/api/admin/journal?source=api')).statusCode).toBe(400);
  });
});

describe('ключи API: отключение и отзыв', () => {
  it('отключение владельца закрывает ключ, включение — открывает', async () => {
    expect((await asAdmin('PATCH', `/api/admin/users/${siteId}`, { active: false })).statusCode).toBe(200);
    expect((await withKey('/api/v1/runs')).statusCode).toBe(401);
    expect((await asAdmin('PATCH', `/api/admin/users/${siteId}`, { active: true })).statusCode).toBe(200);
    expect((await withKey('/api/v1/runs')).statusCode).toBe(200);
  });

  it('отозванный ключ больше не действует', async () => {
    expect((await asAdmin('DELETE', `/api/admin/keys/${keyId}`)).statusCode).toBe(204);
    expect((await withKey('/api/v1/runs')).statusCode).toBe(401);
    const again = await asAdmin('DELETE', `/api/admin/keys/${keyId}`);
    expect(again.json<ApiError>().error).toBe('key_not_found');
  });

  it('удаляет ключи вместе с пользователем', async () => {
    const created = await createKey(stationId, 'Ещё один');
    expect((await asAdmin('DELETE', `/api/admin/users/${stationId}`)).statusCode).toBe(204);
    expect((await keys()).some((k) => k.userId === stationId)).toBe(false);
    expect((await withKey('/api/v1/runs', created.key)).statusCode).toBe(401);
  });
});
