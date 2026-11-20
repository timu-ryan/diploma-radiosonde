import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JournalPage } from '@rs/shared';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';
import { MemoryJournalStore } from '../src/journal/store.js';
import { login } from './helpers.js';

process.env.LOG_LEVEL = 'silent';

const RELEASE = 'release=2026-08-07T11:30:00Z';

let app: FastifyInstance;
const journal = new MemoryJournalStore();
let admin = '';
let synoptic = '';
let synopticId = 0;
/** Без права считать по координатам. */
let stationsOnly = '';

const get = (url: string, cookie: string): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'GET', url, headers: { cookie } });

const page = async (query = ''): Promise<JournalPage> =>
  (await get(`/api/admin/journal${query}`, admin)).json<JournalPage>();

const recorded = async (): Promise<number> => (await journal.list({ limit: 1000 })).length;

beforeAll(async () => {
  const store = new MemoryUserStore();
  const users = new UserService(store);
  await users.create({ login: 'admin', password: 'пароль-админа', isAdmin: true });
  const user = await users.create({
    login: 'synoptic',
    password: 'пароль-синоптика',
    fio: 'Сазонова К. А.',
    canCoordinates: true,
  });
  synopticId = user.id;
  await users.create({ login: 'station', password: 'пароль-станции' });

  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ users: store, journal });
  admin = await login(app, 'admin', 'пароль-админа');
  synoptic = await login(app, 'synoptic', 'пароль-синоптика');
  stationsOnly = await login(app, 'station', 'пароль-станции');
});

afterAll(async () => {
  await app?.close();
});

describe('журнал выпусков', () => {
  it('записывает каждое скачивание, но не расчёт для экрана', async () => {
    expect((await get(`/api/forecast?station=ARCHNGL&${RELEASE}`, synoptic)).statusCode).toBe(200);
    expect(await recorded()).toBe(0);

    for (const url of [
      `/api/forecast.txt?station=ARCHNGL&${RELEASE}`,
      `/api/chart.svg?station=ARCHNGL&${RELEASE}&scale=10`,
      `/api/diagram.svg?station=ARCHNGL&${RELEASE}&kind=stuve`,
      `/api/chart.svg?lat=64.7&lon=40.6&${RELEASE}&scale=5`,
    ]) {
      expect((await get(url, synoptic)).statusCode, url).toBe(200);
    }

    const records = await journal.list({ limit: 10 });
    expect(records.map((r) => [r.product, r.variant, r.station])).toEqual([
      ['chart', '50', null],
      ['diagram', 'stuve', 'ARCHNGL'],
      ['chart', '100', 'ARCHNGL'],
      ['report', '', 'ARCHNGL'],
    ]);
    expect(records[3]).toMatchObject({
      userId: synopticId,
      login: 'synoptic',
      fio: 'Сазонова К. А.',
      place: 'Архангельск',
      runId: '2026080700',
    });
    expect(records[3]?.releaseAt.toISOString()).toBe('2026-08-07T11:30:00.000Z');
    // По координатам — сама точка выпуска, а не станция, чей планшет взят
    expect(records[0]).toMatchObject({ lat: 64.7, lon: 40.6, place: 'Точка выпуска у ст. Архангельск' });
  });

  it('не записывает отказы', async () => {
    const before = await recorded();
    expect((await get(`/api/chart.svg?station=ARCHNGL&${RELEASE}&scale=7`, synoptic)).statusCode).toBe(404);
    expect((await get(`/api/diagram.svg?station=ARCHNGL&${RELEASE}&kind=emagram`, synoptic)).statusCode).toBe(400);
    expect((await get(`/api/forecast.txt?lat=64.7&lon=40.6&${RELEASE}`, stationsOnly)).statusCode).toBe(403);
    expect(await recorded()).toBe(before);
  });

  it('показывает журнал администратору: новые сверху, по страницам', async () => {
    const full = await page();
    expect(full.more).toBe(false);
    expect(full.entries.map((e) => e.product)).toEqual(['chart', 'diagram', 'chart', 'report']);
    expect(full.entries[3]).toMatchObject({
      login: 'synoptic',
      fio: 'Сазонова К. А.',
      product: 'report',
      station: 'ARCHNGL',
      place: 'Архангельск',
      release: '2026-08-07T11:30:00.000Z',
      run: '2026080700',
    });
    expect(Date.parse(full.entries[0]?.at ?? '')).not.toBeNaN();

    const first = await page('?limit=3');
    expect(first.entries).toHaveLength(3);
    expect(first.more).toBe(true);
    const rest = await page(`?limit=3&before=${first.entries[2]?.id}`);
    expect(rest.entries.map((e) => e.product)).toEqual(['report']);
    expect(rest.more).toBe(false);
  });

  it('фильтрует по пользователю и суткам UTC', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await page(`?user=${synopticId}`)).entries).toHaveLength(4);
    expect((await page('?user=999')).entries).toHaveLength(0);
    expect((await page(`?from=${today}&to=${today}`)).entries).toHaveLength(4);
    expect((await page('?to=2020-01-01')).entries).toHaveLength(0);
    expect((await page('?from=2099-01-01')).entries).toHaveLength(0);
  });

  it('хранит Ф.И.О. на момент выпуска', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${synopticId}`,
      headers: { cookie: admin },
      payload: { fio: 'Иванова К. А.' },
    });
    expect(response.statusCode).toBe(200);
    expect((await page()).entries.every((e) => e.fio === 'Сазонова К. А.')).toBe(true);
  });

  it('проверяет параметры и пускает только администратора', async () => {
    for (const query of ['from=07.11.2026', 'to=2026-02-30', 'user=abc', 'before=0', 'limit=-5']) {
      expect((await get(`/api/admin/journal?${query}`, admin)).statusCode, query).toBe(400);
    }
    expect((await get('/api/admin/journal', synoptic)).statusCode).toBe(403);
    expect((await get('/api/admin/journal', '')).statusCode).toBe(401);
  });

  it('отдаёт файл, даже если журнал не записался', async () => {
    const add = journal.add.bind(journal);
    journal.add = async () => {
      throw new Error('база недоступна');
    };
    try {
      expect((await get(`/api/forecast.txt?station=ARCHNGL&${RELEASE}`, synoptic)).statusCode).toBe(200);
    } finally {
      journal.add = add;
    }
  });
});
