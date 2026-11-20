// Локальный стенд для иллюстраций ВКР. Запускается после npm run build.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fixture = process.argv.includes('--fixture');
Object.assign(process.env, {
  AVIAMET_TOKEN: '', DB_URL: '', COOKIE_SECURE: '', BASE_PATH: '/',
  SESSION_SECRET: randomBytes(32).toString('hex'),
  DATA_DIR: fileURLToPath(new URL(fixture ? './data/fixtures/' : './data/demo/', import.meta.url)),
  STATIONS_DIR: fileURLToPath(new URL('./stations/', import.meta.url)),
  WEB_DIR: fileURLToPath(new URL('./packages/web/dist/', import.meta.url)),
  ASCENT_RATE_MS: '5', STEP_SECONDS: '10', NODE_ENV: 'production', LOG_LEVEL: 'warn',
});
const { MemoryUserStore } = await import('./packages/server/dist/auth/store.js');
const { UserService } = await import('./packages/server/dist/auth/users.js');
const { buildApp } = await import('./packages/server/dist/app.js');
const users = new MemoryUserStore();
const service = new UserService(users);
const password = randomBytes(14).toString('hex');
await service.create({ login: 'demo', password, fio: 'Демонстрационный администратор', isAdmin: true, canCoordinates: true });
await service.create({ login: 'operator', password: randomBytes(18).toString('hex'), fio: 'Учебный оператор', organization: 'Учебная станция' });
const app = await buildApp({ users });
const address = await app.listen({ host: '127.0.0.1', port: fixture ? 43178 : 43177 });
const release = fixture ? '2026-08-07T11:30:00Z' : '2026-11-18T10:20:00Z';
console.log(address + '/?station=ARCHNGL&release=' + release);
console.log('Логин demo, временный пароль ' + password);
