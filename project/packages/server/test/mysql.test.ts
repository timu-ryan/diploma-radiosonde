import { randomBytes } from 'node:crypto';
import { createConnection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MysqlUserStore } from '../src/auth/mysql.js';
import { UserService } from '../src/auth/users.js';
import type { HttpError } from '../src/forecast/service.js';
import { MysqlJournalStore } from '../src/journal/mysql.js';
import type { NewJournalRecord } from '../src/journal/store.js';

/**
 * Хранилища на живом MySQL/MariaDB. В обычном `npm test` пропускается; запуск:
 *   TEST_DB_URL=mysql://… npx vitest run packages/server/test/mysql.test.ts
 * Таблицы users, api_keys и history создаются, если их нет, недостающие колонки дописываются;
 * тестовые записи удаляются в конце.
 */
const url = process.env.TEST_DB_URL;

describe.skipIf(!url)('MySQL: хранилище пользователей', () => {
  let store: MysqlUserStore;
  const login = `test-${randomBytes(4).toString('hex')}`;
  let id = 0;

  beforeAll(async () => {
    store = MysqlUserStore.connect(url as string);
    await store.init();
    // Повторный init не падает на существующей таблице
    await store.init();
  });

  afterAll(async () => {
    if (id) await store.delete(id);
    await store?.close();
  });

  it('заводит, находит и правит пользователя', async () => {
    const users = new UserService(store);
    const before = Date.now();
    const created = await users.create({
      login,
      password: 'пароль-для-теста',
      fio: 'Тестов Т. Т. — ёлка',
      email: 'test@example.ru',
      subdivision: 'АМСГ-1 Уфа',
      canCoordinates: true,
    });
    id = created.id;

    expect(created).toMatchObject({
      login,
      fio: 'Тестов Т. Т. — ёлка',
      email: 'test@example.ru',
      organization: '',
      filial: '',
      subdivision: 'АМСГ-1 Уфа',
      isAdmin: false,
      canCoordinates: true,
      active: true,
      sessionVersion: 0,
      lastLoginAt: null,
    });
    // DATETIME без долей секунды: сравниваем с точностью до секунды
    expect(Math.abs(created.createdAt.getTime() - before)).toBeLessThan(5000);
    expect((await store.findByLogin(login))?.id).toBe(id);
    expect((await store.list()).some((u) => u.id === id)).toBe(true);

    const updated = await users.update(null, id, {
      password: 'другой-пароль',
      active: false,
      filial: 'Приволжский филиал',
    });
    expect(updated).toMatchObject({
      active: false,
      sessionVersion: 1,
      canCoordinates: true,
      filial: 'Приволжский филиал',
      subdivision: 'АМСГ-1 Уфа',
    });
    expect(updated.fio).toBe('Тестов Т. Т. — ёлка');

    await users.update(null, id, { active: true });
    const logged = await users.authenticate(login.toUpperCase(), 'другой-пароль');
    expect(logged?.id).toBe(id);
    const reread = await store.findById(id);
    expect(Math.abs((reread?.lastLoginAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5000);
  });

  it('не даёт завести логин повторно', async () => {
    const users = new UserService(store);
    await expect(users.create({ login, password: 'пароль-для-теста' })).rejects.toMatchObject({
      code: 'login_taken',
    } satisfies Partial<HttpError>);
  });

  /** Ключ, который остаётся у пользователя до его удаления. */
  let keptKey = '';

  it('выдаёт, находит и отзывает ключи API', async () => {
    const users = new UserService(store);
    const first = await users.createKey(id, 'Тестовый сайт — ёлка');
    const second = await users.createKey(id, 'Второй');
    keptKey = second.key;

    const found = await users.keyUser(first.key);
    expect(found?.user.id).toBe(id);
    expect(found?.apiKey).toMatchObject({ id: first.record.id, name: 'Тестовый сайт — ёлка', prefix: first.record.prefix });
    const touched = (await store.listKeys()).find((k) => k.id === first.record.id);
    expect(Math.abs((touched?.lastUsedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5000);

    await users.deleteKey(first.record.id);
    expect(await users.keyUser(first.key)).toBeUndefined();
    expect(await users.keyUser(keptKey)).toBeDefined();
  });

  it('удаляет пользователя вместе с ключами', async () => {
    expect(await store.delete(id)).toBe(true);
    expect(await store.findById(id)).toBeUndefined();
    expect(await store.delete(id)).toBe(false);
    expect((await store.listKeys()).some((k) => k.userId === id)).toBe(false);
    expect(await new UserService(store).keyUser(keptKey)).toBeUndefined();
    id = 0;
  });
});

describe.skipIf(!url)('MySQL: журнал выпусков', () => {
  let journal: MysqlJournalStore;
  // Заведомо не настоящий id: тестовые строки ищем и удаляем по нему.
  const userId = 4_000_000_000 + Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    journal = MysqlJournalStore.connect(url as string);
    await journal.init();
    // Повторный init не падает на существующей таблице
    await journal.init();
  });

  afterAll(async () => {
    const connection = await createConnection({ uri: url as string });
    await connection.query('DELETE FROM history WHERE user_id = ?', [userId]);
    await connection.end();
    await journal?.close();
  });

  it('пишет и читает записи, новые сверху', async () => {
    // DATETIME без долей секунды
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const report: NewJournalRecord = {
      createdAt,
      userId,
      login: 'test-journal',
      fio: 'Тестов Т. Т. — ёлка',
      product: 'report',
      variant: '',
      station: 'ARCHNGL',
      place: 'Архангельск',
      lat: 64.539393,
      lon: 40.516939,
      releaseAt: new Date('2026-08-07T11:30:00Z'),
      runId: '2026080700',
      apiKeyId: null,
      apiKeyName: '',
    };
    await journal.add(report);
    await journal.add({
      ...report,
      product: 'chart',
      variant: '100',
      station: null,
      place: 'Точка выпуска',
      apiKeyId: 7,
      apiKeyName: 'Тестовый ключ',
    });

    const records = await journal.list({ userId, limit: 10 });
    expect(records.map((r) => [r.product, r.variant, r.station])).toEqual([
      ['chart', '100', null],
      ['report', '', 'ARCHNGL'],
    ]);
    expect(records[1]).toMatchObject(report);
    expect(await journal.list({ userId, beforeId: records[0]?.id, limit: 10 })).toHaveLength(1);
    expect(await journal.list({ userId, from: new Date(createdAt.getTime() + 1000), limit: 10 })).toHaveLength(0);
    expect(await journal.list({ userId, to: createdAt, limit: 10 })).toHaveLength(0);

    const byKey = await journal.list({ userId, source: 'key', limit: 10 });
    expect(byKey.map((r) => [r.product, r.apiKeyId, r.apiKeyName])).toEqual([['chart', 7, 'Тестовый ключ']]);
    expect((await journal.list({ userId, source: 'site', limit: 10 })).map((r) => r.product)).toEqual(['report']);
  });
});
