import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DEFAULT_ASCENT_RATE_MS, DEFAULT_STEP_SECONDS } from '@rs/shared';

/** Корень репозитория: packages/server/src → ../../.. */
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const env = (key: string, fallback: string): string => process.env[key] || fallback;

/**
 * BASE_PATH «zond», «/zond» или «/zond/» → «/zond/»; пусто — «/».
 * Так же его разбирает packages/web/vite.config.ts — правьте оба места вместе.
 */
export function normalizeBasePath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts.length > 0 ? `/${parts.join('/')}/` : '/';
}

/** Токен сервера прогнозов; без него прогоны берутся только с диска. */
const aviametToken = env('AVIAMET_TOKEN', '');

export const config = {
  host: env('HOST', '0.0.0.0'),
  port: Number(env('PORT', '3001')),

  /**
   * Путь, под которым сайт открыт снаружи, если не в корне домена: `/zond/` за Apache или nginx.
   * Фронтенд собирается под него (`npm run build` читает тот же .env), сервер принимает адреса
   * и с этим префиксом, и без него, cookie входа ставится только на этот путь.
   */
  basePath: normalizeBasePath(env('BASE_PATH', '/')),

  /** Каталог с XML-планшетами станций. */
  stationsDir: resolve(repoRoot, env('STATIONS_DIR', 'stations')),

  /**
   * Каталог с прогонами модели (папки вида YYYYMMDDHH). При загрузке с сервера
   * старые прогоны в нём удаляются.
   */
  dataDir: resolve(repoRoot, env('DATA_DIR', 'data')),

  /** Загрузка прогонов с сервера АМЦ (включается токеном). */
  aviamet: {
    url: env('AVIAMET_URL', 'https://aviametserver.ru'),
    token: aviametToken,
    /** Как часто спрашивать сервер о новом прогоне, мин. */
    syncMinutes: Number(env('AVIAMET_SYNC_MINUTES', '10')),
    /** Сколько последних прогонов держать на диске. */
    keepRuns: Number(env('AVIAMET_KEEP_RUNS', '2')),
  },

  /** База пользователей сайта: mysql://пользователь:пароль@хост:порт/база. Без неё сервер не стартует. */
  db: {
    url: env('DB_URL', ''),
  },

  auth: {
    /** Ключ подписи cookie сессии; пусто — случайный на каждый запуск (сессии сбрасываются при перезапуске). */
    sessionSecret: env('SESSION_SECRET', ''),
    /** Сколько дней действует вход. */
    sessionDays: Number(env('SESSION_DAYS', '30')),
    /** Флаг Secure у cookie — включать, когда сайт открывают по https. */
    cookieSecure: env('COOKIE_SECURE', '') === '1',
  },

  /** Каталог собранного фронтенда (раздаётся в production). */
  webDir: resolve(repoRoot, env('WEB_DIR', 'packages/web/dist')),

  /** Скорость подъёма радиозонда по умолчанию, м/с. */
  ascentRateMs: Number(env('ASCENT_RATE_MS', String(DEFAULT_ASCENT_RATE_MS))),

  /** Шаг интегрирования траектории, с. */
  stepSeconds: Number(env('STEP_SECONDS', String(DEFAULT_STEP_SECONDS))),

  /** Максимум буферов GRIB в кэше (один буфер ≈ 163 КБ). */
  gribCacheSize: Number(env('GRIB_CACHE_SIZE', '120')),

  repoRoot,
} as const;
