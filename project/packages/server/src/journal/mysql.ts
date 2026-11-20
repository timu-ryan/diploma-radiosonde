import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { JournalProduct } from '@rs/shared';
import { addMissingColumns, columnLines, createMysqlPool, type AddedColumn } from '../db.js';
import type { JournalQuery, JournalRecord, JournalStore, NewJournalRecord } from './store.js';

/**
 * Колонки, появившиеся после первой версии таблицы; в уже созданную их дописывает `init()`.
 * Новые колонки добавляются сюда, а не в текст CREATE TABLE.
 */
const ADDED_COLUMNS: AddedColumn[] = [
  ['api_key_id', `INT UNSIGNED NULL COMMENT 'api_keys.id, если скачано по ключу API; NULL — с сайта'`],
  ['api_key_name', `VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Название ключа на момент выпуска'`],
];

/**
 * Журнал выпусков. DDL, как и у `users`, годится для MySQL 8 и MariaDB 5.5; даты пишет
 * приложение, в UTC. Внешнего ключа на `users` нет: удалённый пользователь остаётся
 * в журнале по логину и Ф.И.О.
 */
export const HISTORY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS history (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at  DATETIME     NOT NULL COMMENT 'Когда скачано, UTC',
  user_id     INT UNSIGNED NOT NULL COMMENT 'users.id',
  user_login  VARCHAR(32)  NOT NULL COMMENT 'Логин на момент выпуска',
  user_fio    VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Ф.И.О. на момент выпуска',
  product     VARCHAR(16)  NOT NULL COMMENT 'report — бланк .txt, chart — бланк со схемой, diagram — диаграмма',
  variant     VARCHAR(16)  NOT NULL DEFAULT '' COMMENT 'Радиус схемы, км, или вид диаграммы',
  station     VARCHAR(64)  NULL COMMENT 'Код станции; NULL — выпуск по координатам',
  place       VARCHAR(100) NOT NULL COMMENT 'Станция или точка выпуска',
  lat         DOUBLE       NOT NULL COMMENT 'Точка выпуска',
  lon         DOUBLE       NOT NULL,
  release_at  DATETIME     NOT NULL COMMENT 'Время выпуска зонда, UTC',
  run_id      VARCHAR(32)  NOT NULL COMMENT 'Прогон, по которому считано',
${columnLines(ADDED_COLUMNS, 11)}
  PRIMARY KEY (id),
  KEY history_created (created_at),
  KEY history_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Журнал выпусков: кто, когда и что скачал'`;

interface HistoryRow extends RowDataPacket {
  id: number;
  created_at: Date;
  user_id: number;
  user_login: string;
  user_fio: string;
  product: JournalProduct;
  variant: string;
  station: string | null;
  place: string;
  lat: number;
  lon: number;
  release_at: Date;
  run_id: string;
  api_key_id: number | null;
  api_key_name: string;
}

const COLUMNS =
  'id, created_at, user_id, user_login, user_fio, product, variant, station, place, lat, lon, release_at, run_id, ' +
  'api_key_id, api_key_name';

function fromRow(row: HistoryRow): JournalRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    userId: row.user_id,
    login: row.user_login,
    fio: row.user_fio,
    product: row.product,
    variant: row.variant,
    station: row.station,
    place: row.place,
    lat: row.lat,
    lon: row.lon,
    releaseAt: row.release_at,
    runId: row.run_id,
    apiKeyId: row.api_key_id,
    apiKeyName: row.api_key_name,
  };
}

export class MysqlJournalStore implements JournalStore {
  private constructor(private readonly pool: Pool) {}

  static connect(url: string): MysqlJournalStore {
    return new MysqlJournalStore(createMysqlPool(url));
  }

  async init(): Promise<void> {
    await this.pool.query(HISTORY_TABLE_SQL);
    await addMissingColumns(this.pool, 'history', ADDED_COLUMNS);
  }

  async add(record: NewJournalRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO history (created_at, user_id, user_login, user_fio, product, variant, station, place,
                            lat, lon, release_at, run_id, api_key_id, api_key_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.createdAt,
        record.userId,
        record.login,
        record.fio,
        record.product,
        record.variant,
        record.station,
        record.place,
        record.lat,
        record.lon,
        record.releaseAt,
        record.runId,
        record.apiKeyId,
        record.apiKeyName,
      ],
    );
  }

  async list(query: JournalQuery): Promise<JournalRecord[]> {
    const where: string[] = [];
    const params: (number | Date)[] = [];
    if (query.userId !== undefined) {
      where.push('user_id = ?');
      params.push(query.userId);
    }
    if (query.from) {
      where.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('created_at < ?');
      params.push(query.to);
    }
    if (query.beforeId !== undefined) {
      where.push('id < ?');
      params.push(query.beforeId);
    }
    if (query.source) where.push(query.source === 'key' ? 'api_key_id IS NOT NULL' : 'api_key_id IS NULL');
    const [rows] = await this.pool.query<HistoryRow[]>(
      `SELECT ${COLUMNS} FROM history ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT ?`,
      [...params, query.limit],
    );
    return rows.map(fromRow);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
