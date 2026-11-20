import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GribCatalog } from '../src/grib/catalog.js';
import { FILE_SIZE } from '../src/grib/reader.js';
import { AviametClient, GribSync, shiftRunId } from '../src/grib/remote.js';

const TOKEN = 'test-token';
const silent = { info: () => {}, warn: () => {}, error: () => {} };

interface FakeServer {
  latest: string;
  /** Прогоны, которые есть на сервере. */
  runs: Set<string>;
  /** Файлы, которых нет: `${run}:${mb}:${step}`. */
  missing: Set<string>;
  requests: string[];
}

function fakeFetch(server: FakeServer): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    server.requests.push(url.search);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${TOKEN}`) return new Response('Forbidden.', { status: 401 });
    if (url.searchParams.has('latest')) return new Response(server.latest);

    const d = url.searchParams.get('d') ?? '';
    const mb = url.searchParams.get('mb');
    const fcst = url.searchParams.get('fcst');
    if (!server.runs.has(d) || server.missing.has(`${d}:${mb}:${fcst}`)) {
      return new Response(`Not found mb/fcst: ${mb}/${fcst}.`, { status: 404 });
    }
    return new Response(new Uint8Array(FILE_SIZE));
  }) as typeof fetch;
}

describe('загрузка прогонов с сервера', () => {
  let dataDir: string;
  let server: FakeServer;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'rs-remote-'));
    now = Date.UTC(2026, 8, 16, 7);
    server = {
      latest: '2026091606',
      runs: new Set(['2026091606', '2026091600']),
      missing: new Set(),
      requests: [],
    };
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  let now = Date.UTC(2026, 8, 16, 7);

  const makeSync = (keepRuns = 2, token = TOKEN) =>
    new GribSync(
      new AviametClient({ baseUrl: 'https://example.test/', token, fetch: fakeFetch(server) }),
      { dataDir, keepRuns, levels: [850, 500], steps: [6, 9, 12], now: () => now },
      silent,
    );

  it('сдвигает идентификатор прогона через границу суток', () => {
    expect(shiftRunId('2026091606', -6)).toBe('2026091600');
    expect(shiftRunId('2026090100', -6)).toBe('2026083118');
  });

  it('качает последние прогоны в формате, который понимает каталог', async () => {
    server.missing.add('2026091606:500:12');
    expect(await makeSync().sync()).toEqual(['2026091606', '2026091600']);

    expect((await readdir(dataDir)).sort()).toEqual(['2026091600', '2026091606']);
    expect(server.requests[1]).toBe('?d=2026091606&mb=850&fcst=6');

    const runs = await new GribCatalog(dataDir).list();
    expect(runs.map((r) => r.id)).toEqual(['2026091600', '2026091606']);
    const latest = runs[1];
    expect(latest?.steps).toEqual([6, 9, 12]);
    expect(latest?.levels.map((l) => [l.mb, l.steps])).toEqual([
      [850, [6, 9, 12]],
      [500, [6, 9]],
    ]);
  });

  it('не качает повторно и удаляет устаревшие прогоны', async () => {
    const sync = makeSync();
    await sync.sync();

    server.requests = [];
    expect(await sync.sync()).toEqual([]);
    expect(server.requests).toEqual(['?latest']);

    server.latest = '2026091612';
    server.runs.add('2026091612');
    expect(await sync.sync()).toEqual(['2026091612']);
    expect((await readdir(dataDir)).sort()).toEqual(['2026091606', '2026091612']);
  });

  it('находит свежие прогоны, даже если ?latest отстаёт', async () => {
    const sync = makeSync();
    await sync.sync();

    // Прошли сутки: на сервере появились новые прогоны, а ?latest всё ещё 2026091606
    now = Date.UTC(2026, 8, 17, 8, 30);
    server.runs.add('2026091612').add('2026091618').add('2026091700');
    expect(await sync.sync()).toEqual(['2026091700', '2026091618']);
    expect((await readdir(dataDir)).sort()).toEqual(['2026091618', '2026091700']);

    // Слот 06 ещё пуст — проверен одним запросом, а до уже скачанного 00 не спускаемся
    server.requests = [];
    expect(await sync.sync()).toEqual([]);
    expect(server.requests).toEqual(['?latest', '?d=2026091706&mb=500&fcst=6']);
  });

  it('пропускает прогон, которого нет на сервере, по одному запросу', async () => {
    server.runs.delete('2026091600');
    expect(await makeSync().sync()).toEqual(['2026091606']);
    expect(server.requests.filter((q) => q.includes('d=2026091600'))).toHaveLength(1);
  });

  it('не оставляет недокачанный прогон при ошибке', async () => {
    await mkdir(join(dataDir, '.2026091606.partial'));
    await expect(makeSync(1, 'wrong').sync()).rejects.toThrow(/HTTP 401/);

    const failing = new GribSync(
      new AviametClient({
        baseUrl: 'https://example.test',
        token: TOKEN,
        fetch: (async (input: string | URL | Request, init?: RequestInit) =>
          String(input).includes('fcst=9')
            ? new Response('oops', { status: 500 })
            : fakeFetch(server)(input, init)) as typeof fetch,
      }),
      { dataDir, keepRuns: 1, levels: [850, 500], steps: [6, 9, 12], concurrency: 3 },
      silent,
    );
    await expect(failing.sync()).rejects.toThrow(/HTTP 500/);
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('проверяет размер файла', async () => {
    const client = new AviametClient({
      baseUrl: 'https://example.test',
      token: TOKEN,
      fetch: (async () => new Response(new Uint8Array(10))) as typeof fetch,
    });
    await expect(client.field('2026091606', 500, 6)).rejects.toThrow(/167040/);
  });
});
