import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';

/** Входит и возвращает заголовок Cookie с сессией. */
export async function login(app: FastifyInstance, login: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { login, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = response.cookies.find((c) => c.name === 'rs_session');
  expect(cookie).toBeDefined();
  return `rs_session=${cookie?.value}`;
}
