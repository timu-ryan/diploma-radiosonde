import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';

/** Сайт под префиксом, как за Apache на /zond/. Конфиг читается при импорте app.js — ниже. */
process.env.LOG_LEVEL = 'silent';
process.env.BASE_PATH = 'zond';

let app: FastifyInstance;

beforeAll(async () => {
  const store = new MemoryUserStore();
  await new UserService(store).create({ login: 'admin', password: 'пароль-админа', isAdmin: true });
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ users: store });
});

afterAll(async () => {
  await app?.close();
  delete process.env.BASE_PATH;
});

describe('BASE_PATH', () => {
  it('ставит cookie входа только на путь сайта', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/zond/api/auth/login',
      payload: { login: 'admin', password: 'пароль-админа' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.cookies.find((c) => c.name === 'rs_session')?.path).toBe('/zond/');
  });

  it('принимает адреса и с префиксом, и без него', async () => {
    for (const url of ['/zond/api/health', '/api/health', '/zond/api/health?x=1']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
    // Похожий, но чужой префикс не срезается: 404 или index.html, если фронтенд собран — но не API
    expect((await app.inject({ method: 'GET', url: '/zondx/api/health' })).body).not.toContain('"status":"ok"');
    expect((await app.inject({ method: 'GET', url: '/zond/api/stations' })).statusCode).toBe(401);
  });
});
