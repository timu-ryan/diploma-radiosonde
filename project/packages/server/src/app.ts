import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import type { ApiError } from '@rs/shared';
import { MysqlUserStore } from './auth/mysql.js';
import type { UserStore } from './auth/store.js';
import { UserService } from './auth/users.js';
import { config } from './config.js';
import { GribCatalog } from './grib/catalog.js';
import { GribFieldCache } from './grib/reader.js';
import { AviametClient, GribSync } from './grib/remote.js';
import { ForecastService, HttpError } from './forecast/service.js';
import { MysqlJournalStore } from './journal/mysql.js';
import { MemoryJournalStore, type JournalStore } from './journal/store.js';
import { registerAdmin } from './routes/admin.js';
import { registerApi } from './routes/api.js';
import { registerAuth } from './routes/auth.js';
import { registerV1 } from './routes/v1.js';
import { StationRegistry } from './stations/registry.js';

// цвета подобрать так чтобы в темной теме не скачивались картинки в темной сфере

// белый фон за текстом на картинках

// посмотреть по каким правилам определяется что радиозонд внутри трассы 
// возможно есть ситуации когда радиозонд полностью внутри трассы

// отказаться от tailwind css в пользу scss может (на фронте)

// react query ставить для запросов или нет (можно и не ставить будто)

// комменты почистить

export interface BuildOptions {
  /** Хранилище пользователей; по умолчанию — MySQL по DB_URL. Тесты передают MemoryUserStore. */
  users?: UserStore;
  /** Журнал выпусков; по умолчанию — та же база, а если передан `users` — в памяти. */
  journal?: JournalStore;
}

interface Stores {
  users: UserStore;
  journal: JournalStore;
}

/**
 * Срезает BASE_PATH с адреса запроса: прокси может передавать и `/zond/api/…`, и уже `/api/…` —
 * маршруты всегда от корня. Без BASE_PATH — undefined, адреса не трогаем.
 */
function stripBasePath(basePath: string): ((req: { url?: string }) => string) | undefined {
  const prefix = basePath.slice(0, -1);
  if (!prefix) return undefined;
  return (req) => {
    const url = req.url ?? '/';
    if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) return url;
    const rest = url.slice(prefix.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  };
}

/** Пользователи и журнал из DB_URL; без базы сайт не поднимаем, чтобы не открыть его всем. */
async function connectDatabase(app: FastifyInstance): Promise<Stores> {
  if (!config.db.url) {
    throw new Error(
      'Не задан DB_URL — адрес базы пользователей (mysql://пользователь:пароль@хост:порт/база), см. README',
    );
  }
  const stores = {
    users: MysqlUserStore.connect(config.db.url),
    journal: MysqlJournalStore.connect(config.db.url),
  };
  try {
    await stores.users.init();
    await stores.journal.init();
  } catch (error) {
    await Promise.all([stores.users.close(), stores.journal.close()]);
    throw new Error(`База пользователей недоступна: ${error instanceof Error ? error.message : error}`);
  }
  const { host, pathname } = new URL(config.db.url);
  app.log.info(`База пользователей: ${host}${pathname}`);
  return stores;
}

export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  // Человекочитаемый лог включаем только в режиме разработки: в тестах и
  // в production лишний воркер pino-pretty ни к чему.
  const pretty = process.env.NODE_ENV === 'development';
  const rewriteUrl = stripBasePath(config.basePath);

  const app = Fastify({
    ...(rewriteUrl ? { rewriteUrl } : {}),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  });

  await app.register(cors, { origin: true });
  await app.register(cookie);

  const stores: Stores = options.users
    ? { users: options.users, journal: options.journal ?? new MemoryJournalStore() }
    : await connectDatabase(app);
  app.addHook('onClose', async () => {
    await Promise.all([stores.users.close(), stores.journal.close()]);
  });
  const users = new UserService(stores.users);
  if (!(await users.hasActiveAdmin())) {
    app.log.warn('Нет ни одного администратора — заведите его: npm run user -- <логин> --admin');
  }

  let sessionSecret = config.auth.sessionSecret;
  if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString('hex');
    app.log.warn('SESSION_SECRET не задан: ключ сессий случайный, после перезапуска всем придётся войти заново');
  }

  const stations = await StationRegistry.load(config.stationsDir);
  app.log.info(`Загружено планшетов станций: ${stations.size}`);
  for (const failure of stations.failed) {
    app.log.warn(`Не разобран ${failure.file}: ${failure.message}`);
  }

  const catalog = new GribCatalog(config.dataDir);
  await catalog.refresh(true);
  const runs = await catalog.list();
  app.log.info(
    `Прогонов найдено: ${runs.length}${runs.length > 0 ? ` (${runs.map((r) => r.id).join(', ')})` : ''}`,
  );

  if (config.aviamet.token) {
    const client = new AviametClient({ baseUrl: config.aviamet.url, token: config.aviamet.token });
    const sync = new GribSync(
      client,
      { dataDir: config.dataDir, keepRuns: config.aviamet.keepRuns },
      {
        info: (message) => app.log.info(message),
        warn: (message) => app.log.warn(message),
        error: (message) => app.log.error(message),
      },
      () => catalog.refresh(true),
    );
    // Первая загрузка идёт в фоне: сервер поднимается сразу, прогоны появятся по готовности.
    sync.start(Math.max(1, config.aviamet.syncMinutes) * 60_000);
    app.addHook('onClose', async () => sync.stop());
    app.log.info(`Прогоны загружаются с ${config.aviamet.url} в ${config.dataDir}`);
  }

  const fields = new GribFieldCache(config.gribCacheSize);
  const forecast = new ForecastService(stations, catalog, fields, {
    ascentRateMs: config.ascentRateMs,
    stepSeconds: config.stepSeconds,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      const body: ApiError = { error: error.code, message: error.message, ...error.extra };
      return reply.status(error.statusCode).send(body);
    }
    // Ошибки самого Fastify с кодом 4xx (битый JSON, пустое тело и т. п.) — это ошибки клиента.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && error instanceof Error) {
      const body: ApiError = { error: 'bad_request', message: error.message };
      return reply.status(statusCode).send(body);
    }
    request.log.error(error);
    const body: ApiError = {
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Внутренняя ошибка сервера',
    };
    return reply.status(500).send(body);
  });

  await registerAuth(app, {
    users,
    sessionSecret,
    sessionDays: config.auth.sessionDays,
    cookieSecure: config.auth.cookieSecure,
    cookiePath: config.basePath,
  });
  await registerAdmin(app, { users, journal: stores.journal });
  await registerApi(app, { stations, catalog, forecast, journal: stores.journal });
  await registerV1(app, { stations, catalog, forecast });

  // В production отдаём собранный фронтенд; в dev его поднимает Vite.
  if (existsSync(join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'not_found', message: 'Метод не найден' });
      }
      return reply.sendFile('index.html');
    });
    app.log.info(`Фронтенд раздаётся из ${config.webDir}`);
    // Собран под другой BASE_PATH — страница откроется, но скрипты и стили не найдутся (404).
    const index = readFileSync(join(config.webDir, 'index.html'), 'utf8');
    if (!index.includes(`"${config.basePath}assets/`)) {
      app.log.warn(`Фронтенд собран не под BASE_PATH=${config.basePath} — пересоберите: npm run build`);
    }
  }

  return app;
}
