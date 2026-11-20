import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { addMissingColumns, columnLines, createMysqlPool, type AddedColumn } from '../db.js';
import {
  loginTaken,
  type ApiKeyRecord,
  type NewApiKey,
  type NewUser,
  type UserPatch,
  type UserRecord,
  type UserStore,
} from './store.js';

/**
 * Колонки, появившиеся после первой версии таблицы. В новой таблице они есть сразу,
 * в уже созданной `init()` дописывает недостающие (для этого нужно право ALTER).
 * Новые колонки добавляются сюда, а не в текст CREATE TABLE.
 */
const ADDED_COLUMNS: AddedColumn[] = [
  ['email', `VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Почта'`],
  ['organization', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Организация'`],
  ['filial', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Филиал'`],
  ['subdivision', `VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Подразделение (АМЦ/АМСГ)'`],
];

/**
 * Таблица пользователей. DDL годится и для MySQL 8, и для MariaDB 5.5 (боевой сервер):
 * без JSON, без особых сортировок, без DEFAULT CURRENT_TIMESTAMP у DATETIME.
 * Даты пишет приложение, всегда в UTC.
 */
export const USERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  login           VARCHAR(32)  NOT NULL COMMENT 'Логин, в нижнем регистре',
  password_hash   VARCHAR(255) NOT NULL COMMENT 'scrypt$N$r$p$соль$ключ',
  fio             VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Ф.И.О.',
  comment         VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Примечание администратора',
  is_admin        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Управляет пользователями',
  can_coordinates TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Расчёт по произвольным координатам',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 — вход запрещён',
  session_version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '+1 — все сессии пользователя недействительны',
  created_at      DATETIME     NOT NULL COMMENT 'Когда заведён, UTC',
  last_login_at   DATETIME     NULL COMMENT 'Последний вход, UTC',
${columnLines(ADDED_COLUMNS, 15)}
  PRIMARY KEY (id),
  UNIQUE KEY users_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Пользователи сайта'`;

/**
 * Ключи API для других сайтов: запросы по ключу идут от имени пользователя `user_id`.
 * Хранится только SHA-256 ключа; при удалении пользователя его ключи удаляет `delete()`.
 */
export const API_KEYS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL COMMENT 'users.id — от чьего имени запросы',
  name         VARCHAR(100) NOT NULL COMMENT 'Для чего ключ: какой сайт или сервер',
  prefix       VARCHAR(16)  NOT NULL COMMENT 'Начало ключа — узнать его в списке',
  key_hash     CHAR(64)     NOT NULL COMMENT 'SHA-256 ключа, hex',
  created_at   DATETIME     NOT NULL COMMENT 'Когда выдан, UTC',
  last_used_at DATETIME     NULL COMMENT 'Последний запрос, UTC, с точностью до минуты',
  PRIMARY KEY (id),
  UNIQUE KEY api_keys_hash (key_hash),
  KEY api_keys_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Ключи API'`;

interface ApiKeyRow extends RowDataPacket {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: Date;
  last_used_at: Date | null;
}

const KEY_COLUMNS = 'id, user_id, name, prefix, key_hash, created_at, last_used_at';

function keyFromRow(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.key_hash,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

interface UserRow extends RowDataPacket {
  id: number;
  login: string;
  password_hash: string;
  fio: string;
  comment: string;
  is_admin: number;
  can_coordinates: number;
  is_active: number;
  session_version: number;
  created_at: Date;
  last_login_at: Date | null;
  email: string;
  organization: string;
  filial: string;
  subdivision: string;
}

const COLUMNS =
  'id, login, password_hash, fio, comment, is_admin, can_coordinates, is_active, session_version, created_at, last_login_at, ' +
  'email, organization, filial, subdivision';

const PATCH_COLUMNS: Record<keyof UserPatch, string> = {
  passwordHash: 'password_hash',
  fio: 'fio',
  comment: 'comment',
  isAdmin: 'is_admin',
  canCoordinates: 'can_coordinates',
  active: 'is_active',
  sessionVersion: 'session_version',
  email: 'email',
  organization: 'organization',
  filial: 'filial',
  subdivision: 'subdivision',
};

function fromRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    login: row.login,
    passwordHash: row.password_hash,
    fio: row.fio,
    comment: row.comment,
    isAdmin: row.is_admin === 1,
    canCoordinates: row.can_coordinates === 1,
    active: row.is_active === 1,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    email: row.email,
    organization: row.organization,
    filial: row.filial,
    subdivision: row.subdivision,
  };
}

const sqlValue = (value: string | number | boolean): string | number =>
  typeof value === 'boolean' ? Number(value) : value;

export class MysqlUserStore implements UserStore {
  private constructor(private readonly pool: Pool) {}

  static connect(url: string): MysqlUserStore {
    return new MysqlUserStore(createMysqlPool(url));
  }

  async init(): Promise<void> {
    await this.pool.query(USERS_TABLE_SQL);
    await addMissingColumns(this.pool, 'users', ADDED_COLUMNS);
    await this.pool.query(API_KEYS_TABLE_SQL);
  }

  async findById(id: number): Promise<UserRecord | undefined> {
    const [rows] = await this.pool.query<UserRow[]>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
    return rows[0] && fromRow(rows[0]);
  }

  async findByLogin(login: string): Promise<UserRecord | undefined> {
    const [rows] = await this.pool.query<UserRow[]>(`SELECT ${COLUMNS} FROM users WHERE login = ?`, [
      login,
    ]);
    return rows[0] && fromRow(rows[0]);
  }

  async list(): Promise<UserRecord[]> {
    const [rows] = await this.pool.query<UserRow[]>(`SELECT ${COLUMNS} FROM users ORDER BY login`);
    return rows.map(fromRow);
  }

  async create(user: NewUser): Promise<UserRecord> {
    try {
      const [result] = await this.pool.query<ResultSetHeader>(
        `INSERT INTO users (login, password_hash, fio, comment, is_admin, can_coordinates, created_at,
                            email, organization, filial, subdivision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.login,
          user.passwordHash,
          user.fio,
          user.comment,
          Number(user.isAdmin),
          Number(user.canCoordinates),
          new Date(),
          user.email,
          user.organization,
          user.filial,
          user.subdivision,
        ],
      );
      return (await this.findById(result.insertId)) as UserRecord;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw loginTaken(user.login);
      throw error;
    }
  }

  async update(id: number, patch: UserPatch): Promise<UserRecord | undefined> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
      keyof UserPatch,
      string | number | boolean,
    ][];
    if (entries.length > 0) {
      await this.pool.query(
        `UPDATE users SET ${entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, value]) => sqlValue(value)), id],
      );
    }
    return this.findById(id);
  }

  async delete(id: number): Promise<boolean> {
    await this.pool.query('DELETE FROM api_keys WHERE user_id = ?', [id]);
    const [result] = await this.pool.query<ResultSetHeader>('DELETE FROM users WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async touchLogin(id: number, at: Date): Promise<void> {
    await this.pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [at, id]);
  }

  async listKeys(): Promise<ApiKeyRecord[]> {
    const [rows] = await this.pool.query<ApiKeyRow[]>(`SELECT ${KEY_COLUMNS} FROM api_keys ORDER BY id`);
    return rows.map(keyFromRow);
  }

  async findKeyByHash(hash: string): Promise<ApiKeyRecord | undefined> {
    const [rows] = await this.pool.query<ApiKeyRow[]>(
      `SELECT ${KEY_COLUMNS} FROM api_keys WHERE key_hash = ?`,
      [hash],
    );
    return rows[0] && keyFromRow(rows[0]);
  }

  async createKey(key: NewApiKey): Promise<ApiKeyRecord> {
    const [result] = await this.pool.query<ResultSetHeader>(
      'INSERT INTO api_keys (user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      [key.userId, key.name, key.prefix, key.keyHash, new Date()],
    );
    const [rows] = await this.pool.query<ApiKeyRow[]>(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE id = ?`, [
      result.insertId,
    ]);
    return keyFromRow(rows[0] as ApiKeyRow);
  }

  async deleteKey(id: number): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>('DELETE FROM api_keys WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }

  async touchKey(id: number, at: Date): Promise<void> {
    await this.pool.query('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [at, id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
