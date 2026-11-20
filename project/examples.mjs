// Выгрузка материалов главы об эксперименте через те же маршруты, что и на сайте.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const output = process.argv[2];
if (!output) throw new Error('Укажите новый каталог для результатов');
await mkdir(output);
const fixture = process.argv.includes('--fixture');
Object.assign(process.env, {
  DATA_DIR: fixture ? 'data/fixtures' : 'data/demo', AVIAMET_TOKEN: '', DB_URL: '',
  STATIONS_DIR: fileURLToPath(new URL('./stations/', import.meta.url)),
  SESSION_SECRET: randomBytes(32).toString('hex'), LOG_LEVEL: 'silent', BASE_PATH: '/',
  ASCENT_RATE_MS: '5', STEP_SECONDS: '10', NODE_ENV: 'production',
});
const { MemoryUserStore } = await import('./packages/server/dist/auth/store.js');
const { UserService } = await import('./packages/server/dist/auth/users.js');
const { buildApp } = await import('./packages/server/dist/app.js');
const store = new MemoryUserStore();
const password = randomBytes(20).toString('hex');
await new UserService(store).create({ login: 'demo', password, canCoordinates: true });
const app = await buildApp({ users: store });
try {
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'demo', password } });
  const session = login.cookies.find(c => c.name === 'rs_session');
  if (!session) throw new Error('Не удалось открыть учебную сессию');
  const query = new URLSearchParams({ station: 'ARCHNGL', release: fixture ? '2026-08-07T11:30:00Z' : '2026-11-18T10:20:00Z' });
  const files = [
    ['forecast.json','/api/forecast'], ['v1.json','/api/v1/trajectory'],
    ['bilinear.json','/api/forecast','interp=bilinear'], ['ascent-4.json','/api/forecast','ascent=4'],
    ['report.txt','/api/forecast.txt'], ['form-100.svg','/api/chart.svg','scale=10'],
    ['form-50.svg','/api/chart.svg','scale=5'], ['skewt.svg','/api/diagram.svg','kind=skewt'],
    ['stuve.svg','/api/diagram.svg','kind=stuve'],
  ];
  for (const [name, path, options] of files) {
    const url = path + '?' + query + (options ? '&' + options : '');
    const res = await app.inject({ url, cookies: {rs_session: session.value} });
    if (res.statusCode !== 200) throw new Error(url + ' — ' + res.body);
    const body = name.endsWith('.json') ? JSON.stringify(res.json(), null, 2) + '\n' : res.body;
    await writeFile(join(output, name), body);
    if (name === 'forecast.json') {
      const rows = res.json().rows;
      const keys = Object.keys(rows[0]);
      const csv = [keys.join(','), ...rows.map(row => keys.map(k => row[k]).join(','))].join('\n');
      await writeFile(join(output, 'rows.csv'), csv + '\n');
    }
  }
} finally {
  await app.close();
}
