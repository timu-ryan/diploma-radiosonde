import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KNOWN_MB_LEVELS } from '@rs/shared';
import { runIdToDate } from './catalog.js';
import { FILE_SIZE } from './reader.js';

const RUN_DIR_RE = /^\d{10}$/;
const PARTIAL_SUFFIX = '.partial';
const HOUR_MS = 3600_000;

/** Путь к обработчику на сервере АМЦ: `?latest` и `?d=…&mb=…&fcst=…`. */
const GETBIN_PATH = '/sigmet/modules/gmc/getbin.php';

/** Прогоны выпускаются каждые 6 ч. */
export const RUN_INTERVAL_HOURS = 6;

/** Заблаговременности, которые отдаёт сервер: +6 … +72 ч через 3 ч. */
export const REMOTE_STEPS: readonly number[] = Array.from({ length: 23 }, (_, i) => 6 + i * 3);

export const fileName = (mb: number, step: number): string =>
  `mb_${mb}_fcst_${String(step).padStart(3, '0')}.bin`;

/** Сколько 6-часовых слотов назад от текущего времени проверять, если `?latest` отстаёт. */
const MAX_PROBE_SLOTS = 16;

/** Поле, по которому проверяется наличие прогона на сервере. */
const PROBE = { mb: 500, step: 6 };

const formatRunId = (ms: number): string => new Date(ms).toISOString().slice(0, 13).replace(/\D/g, '');

/** Идентификатор прогона, сдвинутый на `hours` часов (ГГГГММДДЧЧ). */
export function shiftRunId(id: string, hours: number): string {
  const date = runIdToDate(id);
  if (!date) throw new Error(`Некорректный идентификатор прогона: ${id}`);
  return formatRunId(date.getTime() + hours * HOUR_MS);
}

/** Слот прогона (00/06/12/18 UTC), в который попадает момент `ms`. */
export function runSlotAt(ms: number): string {
  const slot = RUN_INTERVAL_HOURS * HOUR_MS;
  return formatRunId(Math.floor(ms / slot) * slot);
}

export interface AviametClientOptions {
  /** Хост сервера, например https://aviametserver.ru */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Клиент сервера с обработанными файлами GRIB2 в двоичном виде. */
export class AviametClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: AviametClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Последний доступный прогон. */
  async latest(): Promise<string> {
    const response = await this.request('latest');
    const id = (await response.text()).trim();
    if (!RUN_DIR_RE.test(id) || !runIdToDate(id)) {
      throw new Error(`Сервер вернул некорректную дату прогона: ${id.slice(0, 50)}`);
    }
    return id;
  }

  /** Есть ли прогон на сервере (проверяется одно поле). */
  async has(run: string): Promise<boolean> {
    const response = await this.request(`d=${run}&mb=${PROBE.mb}&fcst=${PROBE.step}`, true);
    await response?.body?.cancel();
    return response !== undefined;
  }

  /** Поле уровня `mb` с заблаговременностью `step`; undefined, если на сервере его нет. */
  async field(run: string, mb: number, step: number): Promise<Buffer | undefined> {
    const response = await this.request(`d=${run}&mb=${mb}&fcst=${step}`, true);
    if (!response) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length !== FILE_SIZE) {
      throw new Error(
        `${run} ${mb} гПа +${step} ч: ожидалось ${FILE_SIZE} байт, получено ${buffer.length}`,
      );
    }
    return buffer;
  }

  private async request(query: string, allowMissing: true): Promise<Response | undefined>;
  private async request(query: string, allowMissing?: false): Promise<Response>;
  private async request(query: string, allowMissing = false): Promise<Response | undefined> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}${GETBIN_PATH}?${query}`;
    const response = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${this.options.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => '')).trim().slice(0, 200);
      throw new Error(`${GETBIN_PATH}?${query}: HTTP ${response.status}${text ? ` — ${text}` : ''}`);
    }
    return response;
  }
}

export interface GribSyncOptions {
  /** Каталог, куда складываются папки прогонов. */
  dataDir: string;
  /** Сколько последних прогонов держать на диске. */
  keepRuns: number;
  /** Одновременных загрузок. */
  concurrency?: number;
  levels?: readonly number[];
  steps?: readonly number[];
  /** Текущее время, мс (для тестов). */
  now?: () => number;
}

interface SyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Скачивает свежие прогоны в каталог данных, откуда их читает GribCatalog.
 * Прогон качается во временную папку и переименовывается целиком, поэтому
 * каталог никогда не видит недокачанный прогон.
 */
export class GribSync {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<string[]> | undefined;
  /** Отставший `?latest`, о котором уже предупредили, — чтобы не повторять каждый проход. */
  private warnedLatest: string | undefined;

  constructor(
    private readonly client: AviametClient,
    private readonly options: GribSyncOptions,
    private readonly log: SyncLogger,
    private readonly onUpdate: () => Promise<void> = async () => {},
  ) {}

  /** Синхронизация сразу и затем каждые `intervalMs`. */
  start(intervalMs: number): void {
    this.stop();
    const tick = (): void => {
      this.sync().catch(() => {});
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Один проход синхронизации; параллельные вызовы ждут уже идущий. Возвращает скачанные прогоны. */
  sync(): Promise<string[]> {
    this.running ??= this.syncOnce()
      .catch((error: unknown) => {
        this.log.error(`Синхронизация прогнозов не удалась: ${errorMessage(error)}`);
        throw error;
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async syncOnce(): Promise<string[]> {
    const { dataDir, keepRuns } = this.options;
    await mkdir(dataDir, { recursive: true });

    const present = new Set(await this.localRuns());
    const latest = await this.newestRun(present);
    const wanted = Array.from({ length: Math.max(1, keepRuns) }, (_, i) =>
      shiftRunId(latest, -i * RUN_INTERVAL_HOURS),
    );

    const downloaded: string[] = [];
    for (const id of wanted) {
      if (present.has(id)) continue;
      if (await this.download(id)) {
        downloaded.push(id);
        present.add(id);
      }
    }

    // Лишние старые прогоны убираем, только когда свежий уже на диске.
    const stale = [...present].sort().reverse().slice(Math.max(1, keepRuns));
    for (const id of stale) {
      await rm(join(dataDir, id), { recursive: true, force: true });
      this.log.info(`Удалён устаревший прогон ${id}`);
    }

    if (downloaded.length > 0 || stale.length > 0) await this.onUpdate();
    return downloaded;
  }

  /**
   * Последний прогон на сервере. `?latest` бывает, что отстаёт на сутки и больше,
   * поэтому слоты от текущего времени назад проверяются напрямую — до того,
   * что уже известно (`?latest` или скачанное).
   */
  private async newestRun(present: Set<string>): Promise<string> {
    let latest: string | undefined;
    try {
      latest = await this.client.latest();
    } catch (error) {
      this.log.warn(`Запрос ?latest не удался: ${errorMessage(error)}`);
    }

    const known = [latest, ...present].filter((id): id is string => id !== undefined).sort().at(-1);
    let slot = runSlotAt(this.options.now?.() ?? Date.now());
    for (let i = 0; i < MAX_PROBE_SLOTS && (known === undefined || slot > known); i += 1) {
      if (await this.client.has(slot)) {
        if (latest && slot > latest && this.warnedLatest !== latest) {
          this.warnedLatest = latest;
          this.log.warn(`Сервер в ?latest отдаёт ${latest}, хотя уже есть прогон ${slot}`);
        }
        return slot;
      }
      slot = shiftRunId(slot, -RUN_INTERVAL_HOURS);
    }

    if (known === undefined) throw new Error('Не удалось определить последний прогон на сервере');
    return known;
  }

  private async localRuns(): Promise<string[]> {
    const entries = await readdir(this.options.dataDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && RUN_DIR_RE.test(e.name)).map((e) => e.name);
  }

  /** Скачивает прогон целиком. false — на сервере нет ни одного файла прогона. */
  private async download(id: string): Promise<boolean> {
    const { dataDir, concurrency = 6, levels = KNOWN_MB_LEVELS, steps = REMOTE_STEPS } = this.options;
    const jobs = levels.flatMap((mb) => steps.map((step) => ({ mb, step })));
    const first = jobs[0];
    if (!first) return false;

    // Первый файл — проба: прогона, которого на сервере нет, не перебираем целиком.
    const probe = await this.client.field(id, first.mb, first.step);
    if (!probe) {
      this.log.warn(`Прогона ${id} на сервере нет`);
      return false;
    }

    const tmpDir = join(dataDir, `.${id}${PARTIAL_SUFFIX}`);
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const missing: string[] = [];
    let saved = 0;
    let next = 1;

    const started = Date.now();
    this.log.info(`Загрузка прогона ${id}: ${jobs.length} файлов`);

    try {
      await writeFile(join(tmpDir, fileName(first.mb, first.step)), probe);
      saved += 1;

      let failed = false;
      const worker = async (): Promise<void> => {
        while (!failed && next < jobs.length) {
          const { mb, step } = jobs[next++] as { mb: number; step: number };
          const buffer = await this.client.field(id, mb, step).catch((error: unknown) => {
            failed = true;
            throw error;
          });
          if (!buffer) {
            missing.push(`${mb}/+${step}`);
            continue;
          }
          await writeFile(join(tmpDir, fileName(mb, step)), buffer);
          saved += 1;
        }
      };
      // Ждём все воркеры, чтобы никто не писал во временную папку после её удаления.
      const results = await Promise.allSettled(
        Array.from({ length: Math.max(1, concurrency) }, worker),
      );
      const failure = results.find((r) => r.status === 'rejected');
      if (failure) throw failure.reason;

      await rename(tmpDir, join(dataDir, id));
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true });
      throw error;
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    this.log.info(`Прогон ${id} загружен: ${saved} файлов за ${seconds} с`);
    if (missing.length > 0) {
      this.log.warn(`В прогоне ${id} на сервере нет ${missing.length} файлов (гПа/срок): ${missing.join(', ')}`);
    }
    return true;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
