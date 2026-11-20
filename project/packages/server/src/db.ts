import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';

/**
 * Пул к MySQL/MariaDB по `mysql://пользователь:пароль@хост:порт/база`; соединения открываются
 * при первом запросе. timezone 'Z': DATETIME пишутся и читаются как UTC независимо
 * от часового пояса сервера.
 */
export function createMysqlPool(url: string): Pool {
  return createPool({ uri: url, connectionLimit: 5, timezone: 'Z', charset: 'utf8mb4_general_ci' });
}

/** Колонка, появившаяся после первой версии таблицы: имя и определение для DDL. */
export type AddedColumn = [name: string, definition: string];

/** Строки определений для CREATE TABLE, выровненные как остальные колонки. */
export const columnLines = (columns: readonly AddedColumn[], width: number): string =>
  columns.map(([name, definition]) => `  ${name.padEnd(width)} ${definition},`).join('\n');

/**
 * Дописывает в уже созданную таблицу колонки, которых в ней ещё нет (нужно право ALTER).
 * В новой таблице они есть сразу — их вставляет в CREATE TABLE `columnLines`.
 */
export async function addMissingColumns(pool: Pool, table: string, columns: readonly AddedColumn[]): Promise<void> {
  const [present] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM ${table}`);
  const names = new Set(present.map((column) => String(column.Field)));
  const missing = columns.filter(([name]) => !names.has(name));
  if (missing.length > 0) {
    await pool.query(
      `ALTER TABLE ${table} ${missing.map(([name, definition]) => `ADD COLUMN ${name} ${definition}`).join(', ')}`,
    );
  }
}
