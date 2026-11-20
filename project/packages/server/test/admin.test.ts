import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminUser, ApiError, CurrentUser } from '@rs/shared';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';
import { login } from './helpers.js';

process.env.LOG_LEVEL = 'silent';

let app: FastifyInstance;
let admin = '';

const request = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  cookie: string,
  payload?: object,
): Promise<LightMyRequestResponse> =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const errorOf = (response: LightMyRequestResponse): string => response.json<ApiError>().error;

beforeAll(async () => {
  const store = new MemoryUserStore();
  await new UserService(store).create({ login: 'admin', password: 'пароль-админа', isAdmin: true });

  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ users: store });
  admin = await login(app, 'admin', 'пароль-админа');
});

afterAll(async () => {
  await app?.close();
});

describe('админка пользователей', () => {
  let userId = 0;

  it('заводит пользователя', async () => {
    const response = await request('POST', '/api/admin/users', admin, {
      login: 'Omsk',
      password: 'пароль-омска',
      fio: 'Мордус Д. П.',
      comment: 'дежурная смена',
      email: ' omsk@example.ru ',
      organization: 'ФГБУ "Авиаметтелеком Росгидромета"',
      subdivision: 'ЗАМЦ Новосибирск',
    });
    expect(response.statusCode).toBe(201);
    const user = response.json<AdminUser>();
    userId = user.id;
    expect(user).toMatchObject({
      login: 'omsk',
      fio: 'Мордус Д. П.',
      comment: 'дежурная смена',
      email: 'omsk@example.ru',
      organization: 'ФГБУ "Авиаметтелеком Росгидромета"',
      filial: '',
      subdivision: 'ЗАМЦ Новосибирск',
      isAdmin: false,
      canCoordinates: false,
      active: true,
      lastLoginAt: null,
    });
    expect(Date.parse(user.createdAt)).not.toBeNaN();
  });

  it('перечисляет пользователей без хешей паролей', async () => {
    const response = await request('GET', '/api/admin/users', admin);
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminUser[]>().map((u) => u.login)).toEqual(['admin', 'omsk']);
    expect(response.body).not.toContain('scrypt');
  });

  it('проверяет данные нового пользователя', async () => {
    const create = (payload: object) => request('POST', '/api/admin/users', admin, payload);
    expect(errorOf(await create({ login: 'omsk', password: 'пароль-омска' }))).toBe('login_taken');
    expect(errorOf(await create({ login: 'x', password: 'пароль-омска' }))).toBe('bad_request');
    expect(errorOf(await create({ login: 'tomsk' }))).toBe('bad_request');
    expect(errorOf(await create({ login: 'tomsk', password: 'пароль-томска', isAdmin: 'да' }))).toBe(
      'bad_request',
    );
    expect(errorOf(await create({ login: 'tomsk', password: 'пароль-томска', email: 'tomsk.ru' }))).toBe(
      'bad_request',
    );
    expect(errorOf(await create({ login: 'tomsk', password: 'пароль-томска', filial: 7 }))).toBe('bad_request');
  });

  it('меняет только переданные поля места работы', async () => {
    const response = await request('PATCH', `/api/admin/users/${userId}`, admin, {
      filial: 'Сибирский филиал',
      email: '',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<AdminUser>()).toMatchObject({
      email: '',
      organization: 'ФГБУ "Авиаметтелеком Росгидромета"',
      filial: 'Сибирский филиал',
      subdivision: 'ЗАМЦ Новосибирск',
    });
  });

  it('выдаёт права, которые видны пользователю сразу', async () => {
    const omsk = await login(app, 'omsk', 'пароль-омска');
    expect((await request('GET', '/api/auth/me', omsk)).json<CurrentUser>().canCoordinates).toBe(false);

    const patched = await request('PATCH', `/api/admin/users/${userId}`, admin, { canCoordinates: true });
    expect(patched.statusCode).toBe(200);
    expect((await request('GET', '/api/auth/me', omsk)).json<CurrentUser>().canCoordinates).toBe(true);
    expect((await request('GET', '/api/admin/users', omsk)).statusCode).toBe(403);
  });

  it('новый пароль от администратора разлогинивает пользователя', async () => {
    const omsk = await login(app, 'omsk', 'пароль-омска');
    const patched = await request('PATCH', `/api/admin/users/${userId}`, admin, { password: 'новый-пароль' });
    expect(patched.statusCode).toBe(200);

    expect((await request('GET', '/api/stations', omsk)).statusCode).toBe(401);
    const old = await request('POST', '/api/auth/login', '', { login: 'omsk', password: 'пароль-омска' });
    expect(errorOf(old)).toBe('bad_credentials');
    await login(app, 'omsk', 'новый-пароль');
  });

  it('отключённый не входит и теряет сессию', async () => {
    const omsk = await login(app, 'omsk', 'новый-пароль');
    await request('PATCH', `/api/admin/users/${userId}`, admin, { active: false });

    expect((await request('GET', '/api/stations', omsk)).statusCode).toBe(401);
    const denied = await request('POST', '/api/auth/login', '', { login: 'omsk', password: 'новый-пароль' });
    expect(denied.statusCode).toBe(403);
    expect(errorOf(denied)).toBe('account_disabled');

    await request('PATCH', `/api/admin/users/${userId}`, admin, { active: true });
    await login(app, 'omsk', 'новый-пароль');
  });

  it('не даёт администратору лишить себя прав', async () => {
    const me = (await request('GET', '/api/auth/me', admin)).json<CurrentUser>();
    expect((await request('PATCH', `/api/admin/users/${me.id}`, admin, { isAdmin: false })).statusCode).toBe(400);
    expect((await request('DELETE', `/api/admin/users/${me.id}`, admin)).statusCode).toBe(400);
  });

  it('удаляет пользователя', async () => {
    expect((await request('DELETE', `/api/admin/users/${userId}`, admin)).statusCode).toBe(204);
    const again = await request('PATCH', `/api/admin/users/${userId}`, admin, { fio: 'x' });
    expect(again.statusCode).toBe(404);
    expect((await request('PATCH', '/api/admin/users/abc', admin, { fio: 'x' })).statusCode).toBe(400);
  });
});

describe('вход, выход и свой пароль', () => {
  it('меняет свой пароль и закрывает другие сессии', async () => {
    await request('POST', '/api/admin/users', admin, { login: 'kolpashevo', password: 'старый-пароль' });
    const first = await login(app, 'kolpashevo', 'старый-пароль');
    const second = await login(app, 'kolpashevo', 'старый-пароль');

    const wrong = await request('POST', '/api/auth/password', first, { current: 'не тот', next: 'новый-пароль' });
    expect(errorOf(wrong)).toBe('wrong_password');

    const changed = await request('POST', '/api/auth/password', first, {
      current: 'старый-пароль',
      next: 'новый-пароль',
    });
    expect(changed.statusCode).toBe(200);
    const renewed = changed.cookies.find((c) => c.name === 'rs_session');
    expect((await request('GET', '/api/stations', `rs_session=${renewed?.value}`)).statusCode).toBe(200);
    expect((await request('GET', '/api/stations', second)).statusCode).toBe(401);
  });

  it('выход стирает cookie', async () => {
    const response = await request('POST', '/api/auth/logout', admin);
    expect(response.statusCode).toBe(204);
    const cleared = response.cookies.find((c) => c.name === 'rs_session');
    expect(cleared?.value).toBe('');
    expect(cleared?.httpOnly).toBe(true);
  });

  it('cookie сессии недоступна скриптам страницы', async () => {
    const response = await request('POST', '/api/auth/login', '', {
      login: 'kolpashevo',
      password: 'новый-пароль',
    });
    expect(response.cookies.find((c) => c.name === 'rs_session')).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
    });
  });

  it('после серии неудачных попыток временно не пускает', async () => {
    const attempt = (password: string) =>
      request('POST', '/api/auth/login', '', { login: 'kolpashevo', password });
    for (let i = 0; i < 10; i++) expect((await attempt('подбираю')).statusCode).toBe(401);
    const blocked = await attempt('новый-пароль');
    expect(blocked.statusCode).toBe(429);
    expect(errorOf(blocked)).toBe('too_many_attempts');
  });
});
