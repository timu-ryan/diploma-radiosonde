import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../forecast/service.js';
import { LoginLimiter } from '../auth/limiter.js';
import { signSession, verifySession } from '../auth/session.js';
import type { ApiKeyRecord, UserRecord } from '../auth/store.js';
import { normalizeLogin, toCurrentUser, type UserService } from '../auth/users.js';
import { bodyObject, requiredString } from './body.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Вошедший пользователь; на открытых адресах — null. */
    user: UserRecord | null;
    /** Ключ API, по которому пришёл запрос; вход по паролю (cookie) — null. */
    apiKey: ApiKeyRecord | null;
  }
}

export const SESSION_COOKIE = 'rs_session';

/** Адреса API, открытые без входа. */
const PUBLIC_ROUTES = new Set(['/api/auth/login', '/api/auth/logout', '/api/health']);

/** Ключ API действует только здесь: в API для других сайтов нет ни админки, ни смены пароля. */
const KEY_ROUTES = '/api/v1/';

/** `Authorization: Bearer <ключ>`; без заголовка — undefined, с битым заголовком — пустая строка. */
function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  return /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? '';
}

interface AuthOptions {
  users: UserService;
  sessionSecret: string;
  sessionDays: number;
  /** Флаг Secure у cookie — когда сайт открывают по https. */
  cookieSecure: boolean;
  /** Путь cookie — BASE_PATH сайта, чтобы она не уходила соседним приложениям на том же домене. */
  cookiePath: string;
}

/** Пользователь запроса за проверкой входа; на открытом адресе — 401. */
export function currentUser(request: FastifyRequest): UserRecord {
  if (!request.user) throw new HttpError(401, 'unauthorized', 'Требуется вход');
  return request.user;
}

/** Для маршрутов админки: `{ preHandler: requireAdmin }`. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  if (!currentUser(request).isAdmin) {
    throw new HttpError(403, 'forbidden', 'Раздел доступен только администраторам');
  }
}

/**
 * Вход по логину и паролю, сессия — подписанная cookie. Весь `/api/*`, кроме
 * `PUBLIC_ROUTES`, без действующей сессии отвечает 401. Статика фронтенда открыта:
 * на ней страница входа. Другие сайты ходят в `/api/v1/*` с ключом API в заголовке
 * `Authorization: Bearer …` — от имени пользователя, которому выдан ключ.
 */
export async function registerAuth(app: FastifyInstance, options: AuthOptions): Promise<void> {
  const { users, sessionSecret } = options;
  const limiter = new LoginLimiter();
  const maxAgeS = Math.round(options.sessionDays * 86_400);
  const cookieOptions = {
    path: options.cookiePath,
    httpOnly: true,
    sameSite: 'lax',
    secure: options.cookieSecure,
  } as const;

  const issueSession = (reply: FastifyReply, user: UserRecord): void => {
    const token = signSession(
      { userId: user.id, version: user.sessionVersion, expiresAt: Date.now() + maxAgeS * 1000 },
      sessionSecret,
    );
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: maxAgeS });
  };

  app.decorateRequest('user', null);
  app.decorateRequest('apiKey', null);

  app.addHook('onRequest', async (request) => {
    // Шаблон маршрута, а не адрес из запроса: его не обойти кодированием или лишними слешами.
    // Несуществующие /api/* маршрута не имеют и просто получают 404.
    const route = request.routeOptions.url;
    if (!route?.startsWith('/api/') || PUBLIC_ROUTES.has(route)) return;

    // Пришёл с ключом — проверяем только ключ: на cookie при неверном ключе не откатываемся.
    const bearer = bearerToken(request.headers.authorization);
    if (bearer !== undefined) {
      if (!route.startsWith(KEY_ROUTES)) {
        throw new HttpError(401, 'unauthorized', `Ключ API действует только для адресов ${KEY_ROUTES}`);
      }
      const found = bearer ? await users.keyUser(bearer) : undefined;
      if (!found) throw new HttpError(401, 'unauthorized', 'Недействительный ключ API');
      request.user = found.user;
      request.apiKey = found.apiKey;
      return;
    }

    const token = request.cookies[SESSION_COOKIE];
    const claims = token ? verifySession(token, sessionSecret) : undefined;
    request.user = claims ? ((await users.sessionUser(claims.userId, claims.version)) ?? null) : null;
    if (!request.user) throw new HttpError(401, 'unauthorized', 'Требуется вход');
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = bodyObject(request.body);
    const login = requiredString(body, 'login', 'логин');
    const password = requiredString(body, 'password', 'пароль');

    const key = `${request.ip}|${normalizeLogin(login)}`;
    const waitMs = limiter.retryAfterMs(key);
    if (waitMs > 0) {
      throw new HttpError(
        429,
        'too_many_attempts',
        `Слишком много неудачных попыток входа. Повторите через ${Math.ceil(waitMs / 60_000)} мин`,
      );
    }

    const user = await users.authenticate(login, password);
    if (!user) {
      limiter.fail(key);
      throw new HttpError(401, 'bad_credentials', 'Неверный логин или пароль');
    }
    limiter.reset(key);
    issueSession(reply, user);
    request.log.info(`Вход: ${user.login}`);
    return toCurrentUser(user);
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (request) => toCurrentUser(currentUser(request)));

  // Смена своего пароля закрывает остальные сессии; текущей выдаём новую cookie.
  app.post('/api/auth/password', async (request, reply) => {
    const body = bodyObject(request.body);
    const user = await users.changeOwnPassword(
      currentUser(request).id,
      requiredString(body, 'current', 'текущий пароль'),
      requiredString(body, 'next', 'новый пароль'),
    );
    issueSession(reply, user);
    return toCurrentUser(user);
  });
}
