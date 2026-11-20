import type { JournalProduct, JournalSource } from '@rs/shared';

/** Запись журнала выпусков как она лежит в хранилище. Логин и Ф.И.О. — на момент выпуска. */
export interface JournalRecord {
  id: number;
  createdAt: Date;
  userId: number;
  login: string;
  fio: string;
  product: JournalProduct;
  /** Радиус схемы в км или вид диаграммы; у бланка .txt — пусто. */
  variant: string;
  /** Код станции; null — выпуск по координатам. */
  station: string | null;
  place: string;
  lat: number;
  lon: number;
  releaseAt: Date;
  runId: string;
  /** Ключ API, по которому скачано; null — с сайта. Название — на момент выпуска. */
  apiKeyId: number | null;
  apiKeyName: string;
}

export type NewJournalRecord = Omit<JournalRecord, 'id'>;

export interface JournalQuery {
  userId?: number;
  /** Записи не раньше этого момента. */
  from?: Date;
  /** Записи раньше этого момента (не включая). */
  to?: Date;
  /** Только записи с меньшим id — следующая страница. */
  beforeId?: number;
  source?: JournalSource;
  limit: number;
}

/**
 * Журнал выпусков: только добавление и чтение, новые записи — первыми (по id).
 * На сервере — MySQL, в тестах — память.
 */
export interface JournalStore {
  /** Создаёт таблицу, если её нет. */
  init(): Promise<void>;
  add(record: NewJournalRecord): Promise<void>;
  list(query: JournalQuery): Promise<JournalRecord[]>;
  close(): Promise<void>;
}

/** Журнал в памяти — для тестов: без базы и без файлов. */
export class MemoryJournalStore implements JournalStore {
  private readonly records: JournalRecord[] = [];

  async init(): Promise<void> {}

  async add(record: NewJournalRecord): Promise<void> {
    this.records.push({ ...structuredClone(record), id: this.records.length + 1 });
  }

  async list(query: JournalQuery): Promise<JournalRecord[]> {
    return this.records
      .filter(
        (r) =>
          (query.userId === undefined || r.userId === query.userId) &&
          (query.from === undefined || r.createdAt >= query.from) &&
          (query.to === undefined || r.createdAt < query.to) &&
          (query.beforeId === undefined || r.id < query.beforeId) &&
          (query.source === undefined || (query.source === 'key') === (r.apiKeyId !== null)),
      )
      .reverse()
      .slice(0, query.limit)
      .map((r) => structuredClone(r));
  }

  async close(): Promise<void> {}
}
