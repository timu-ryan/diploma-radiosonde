import type { FastifyInstance } from 'fastify';
import type {
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreatedApiKey,
  CreateUserRequest,
  JournalEntry,
  JournalPage,
  JournalSource,
  UpdateUserRequest,
  UserContacts,
} from '@rs/shared';
import { HttpError } from '../forecast/service.js';
import { toAdminUser, toApiKeyInfo, type UserService } from '../auth/users.js';
import type { JournalRecord, JournalStore } from '../journal/store.js';
import { bodyObject, optionalBoolean, optionalString, requiredString, type Body } from './body.js';
import { currentUser, requireAdmin } from './auth.js';

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, 'bad_request', `Некорректный номер пользователя: ${value}`);
  }
  return id;
}

function parseContacts(body: Body): Partial<UserContacts> {
  return {
    email: optionalString(body, 'email'),
    organization: optionalString(body, 'organization'),
    filial: optionalString(body, 'filial'),
    subdivision: optionalString(body, 'subdivision'),
  };
}

function parseCreate(raw: unknown): CreateUserRequest {
  const body = bodyObject(raw);
  return {
    login: requiredString(body, 'login', 'логин'),
    password: requiredString(body, 'password', 'пароль'),
    fio: optionalString(body, 'fio'),
    comment: optionalString(body, 'comment'),
    ...parseContacts(body),
    isAdmin: optionalBoolean(body, 'isAdmin'),
    canCoordinates: optionalBoolean(body, 'canCoordinates'),
  };
}

function parseUpdate(raw: unknown): UpdateUserRequest {
  const body = bodyObject(raw);
  return {
    fio: optionalString(body, 'fio'),
    comment: optionalString(body, 'comment'),
    ...parseContacts(body),
    isAdmin: optionalBoolean(body, 'isAdmin'),
    canCoordinates: optionalBoolean(body, 'canCoordinates'),
    active: optionalBoolean(body, 'active'),
    password: optionalString(body, 'password'),
  };
}

const JOURNAL_PAGE = 100;
const JOURNAL_PAGE_MAX = 500;
const DAY_MS = 86_400_000;

interface JournalQueryString {
  /** id пользователя. */
  user?: string;
  /** Сутки UTC «с» и «по» включительно, ГГГГ-ММ-ДД. */
  from?: string;
  to?: string;
  /** id последней показанной записи — следующая страница. */
  before?: string;
  limit?: string;
  /** site — только с сайта, key — только по ключам API. */
  source?: string;
}

function parseSource(value: string | undefined): JournalSource | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text !== 'site' && text !== 'key') {
    throw new HttpError(400, 'bad_request', 'Параметр source — site (с сайта) или key (по ключу API)');
  }
  return text;
}

function parseCreateKey(raw: unknown): CreateApiKeyRequest {
  const body = bodyObject(raw);
  const { userId } = body;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new HttpError(400, 'bad_request', 'Не указан пользователь, которому выдаётся ключ (поле userId)');
  }
  return { userId, name: optionalString(body, 'name') ?? '' };
}

function parsePositive(value: string | undefined, param: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new HttpError(400, 'bad_request', `Параметр ${param} должен быть целым положительным числом`);
  }
  return number;
}

/** Начало суток UTC. */
function parseDay(value: string | undefined, param: string): Date | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const day = new Date(`${text}T00:00:00Z`);
  // Сверяем обратно: Date сам переносит 30 февраля на март.
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, 'bad_request', `Некорректная дата (параметр ${param}): ожидается ГГГГ-ММ-ДД`);
  }
  return day;
}

function toJournalEntry(record: JournalRecord): JournalEntry {
  return {
    id: record.id,
    at: record.createdAt.toISOString(),
    userId: record.userId,
    login: record.login,
    fio: record.fio,
    product: record.product,
    variant: record.variant,
    station: record.station,
    place: record.place,
    lat: record.lat,
    lon: record.lon,
    release: record.releaseAt.toISOString(),
    run: record.runId,
    apiKey: record.apiKeyId === null ? null : record.apiKeyName,
  };
}

/**
 * Управление пользователями, ключами API и журнал выпусков — только для администраторов.
 * Регистрации нет: заводит админ.
 */
export async function registerAdmin(
  app: FastifyInstance,
  deps: { users: UserService; journal: JournalStore },
): Promise<void> {
  const { users, journal } = deps;
  const adminOnly = { preHandler: requireAdmin };

  app.get<{ Querystring: JournalQueryString }>(
    '/api/admin/journal',
    adminOnly,
    async (request): Promise<JournalPage> => {
      const { query } = request;
      const to = parseDay(query.to, 'to');
      const limit = Math.min(parsePositive(query.limit, 'limit') ?? JOURNAL_PAGE, JOURNAL_PAGE_MAX);
      // Запрашиваем на одну больше — так видно, есть ли следующая страница.
      const records = await journal.list({
        userId: parsePositive(query.user, 'user'),
        from: parseDay(query.from, 'from'),
        to: to && new Date(to.getTime() + DAY_MS),
        beforeId: parsePositive(query.before, 'before'),
        source: parseSource(query.source),
        limit: limit + 1,
      });
      return { entries: records.slice(0, limit).map(toJournalEntry), more: records.length > limit };
    },
  );

  app.get('/api/admin/keys', adminOnly, async (): Promise<ApiKeyInfo[]> => {
    const logins = new Map((await users.list()).map((u) => [u.id, u.login]));
    return (await users.listKeys()).map((key) => toApiKeyInfo(key, logins.get(key.userId) ?? ''));
  });

  app.post('/api/admin/keys', adminOnly, async (request, reply) => {
    const input = parseCreateKey(request.body);
    const { record, key, user } = await users.createKey(input.userId, input.name);
    request.log.info(`${currentUser(request).login} выдал ключ API ${record.prefix}… пользователю ${user.login}`);
    const created: CreatedApiKey = { ...toApiKeyInfo(record, user.login), key };
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/keys/:id', adminOnly, async (request, reply) => {
    const id = parsePositive(request.params.id, 'id');
    if (id === undefined) throw new HttpError(400, 'bad_request', 'Не указан номер ключа');
    await users.deleteKey(id);
    request.log.info(`${currentUser(request).login} отозвал ключ API ${id}`);
    return reply.status(204).send();
  });

  app.get('/api/admin/users', adminOnly, async () => (await users.list()).map(toAdminUser));

  app.post('/api/admin/users', adminOnly, async (request, reply) => {
    const user = await users.create(parseCreate(request.body));
    request.log.info(`${currentUser(request).login} завёл пользователя ${user.login}`);
    return reply.status(201).send(toAdminUser(user));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', adminOnly, async (request) => {
    const actor = currentUser(request);
    const user = await users.update(actor.id, parseId(request.params.id), parseUpdate(request.body));
    request.log.info(`${actor.login} изменил пользователя ${user.login}`);
    return toAdminUser(user);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', adminOnly, async (request, reply) => {
    const actor = currentUser(request);
    await users.delete(actor.id, parseId(request.params.id));
    request.log.info(`${actor.login} удалил пользователя ${request.params.id}`);
    return reply.status(204).send();
  });
}
