import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../src/auth/limiter.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signSession, verifySession } from '../src/auth/session.js';
import { MemoryUserStore } from '../src/auth/store.js';
import { UserService } from '../src/auth/users.js';
import type { HttpError } from '../src/forecast/service.js';

/** Код ошибки, которую бросило обещание. */
async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as HttpError).code;
  }
  throw new Error('Ожидалась ошибка');
}

describe('пароли', () => {
  it('проверяет пароль по хешу', async () => {
    const hash = await hashPassword('Синоптик-2026');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[\w+/=]+\$[\w+/=]+$/);
    expect(await verifyPassword('Синоптик-2026', hash)).toBe(true);
    expect(await verifyPassword('синоптик-2026', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('солит каждый хеш отдельно', async () => {
    expect(await hashPassword('одинаковый')).not.toBe(await hashPassword('одинаковый'));
  });

  it('не падает на чужом формате хеша', async () => {
    // Так хранил пароли старый сайт: MD5 и отдельная соль
    expect(await verifyPassword('пароль', '5f4dcc3b5aa765d61d8327deb882cf99')).toBe(false);
    expect(await verifyPassword('пароль', 'scrypt$x$8$1$AAAA$AAAA')).toBe(false);
  });
});

describe('cookie сессии', () => {
  const SECRET = 'секрет';
  const claims = { userId: 7, version: 2, expiresAt: Date.UTC(2026, 9, 1) };

  it('читает подписанную cookie', () => {
    const token = signSession(claims, SECRET);
    expect(token).toMatch(/^7\.2\.\d+\.[\w-]+$/);
    expect(verifySession(token, SECRET, Date.UTC(2026, 8, 1))).toEqual(claims);
  });

  it('отвергает подделку, чужой ключ и истёкшую', () => {
    const now = Date.UTC(2026, 8, 1);
    const token = signSession(claims, SECRET);
    expect(verifySession(token.replace(/^7\./, '1.'), SECRET, now)).toBeUndefined();
    expect(verifySession(token.replace('.2.', '.3.'), SECRET, now)).toBeUndefined();
    expect(verifySession(token, 'другой', now)).toBeUndefined();
    expect(verifySession(token, SECRET, claims.expiresAt)).toBeUndefined();
    expect(verifySession('мусор', SECRET, now)).toBeUndefined();
  });
});

describe('ограничение попыток входа', () => {
  it('блокирует после серии неудач до конца окна', () => {
    const limiter = new LoginLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterMs('ip|login', 1000 + i)).toBe(0);
      limiter.fail('ip|login', 1000 + i);
    }
    expect(limiter.retryAfterMs('ip|login', 2000)).toBe(59_000);
    expect(limiter.retryAfterMs('ip|другой', 2000)).toBe(0);
    expect(limiter.retryAfterMs('ip|login', 61_001)).toBe(0);
  });

  it('успешный вход сбрасывает счёт', () => {
    const limiter = new LoginLimiter(2, 60_000);
    limiter.fail('k', 0);
    limiter.reset('k');
    limiter.fail('k', 1);
    expect(limiter.retryAfterMs('k', 2)).toBe(0);
  });
});

describe('UserService', () => {
  const setup = async (): Promise<{ users: UserService; adminId: number; userId: number }> => {
    const users = new UserService(new MemoryUserStore());
    const admin = await users.create({ login: 'Admin', password: 'пароль-админа', isAdmin: true });
    const user = await users.create({ login: 'user', password: 'пароль-юзера', fio: '  Иванов И. И. ' });
    return { users, adminId: admin.id, userId: user.id };
  };

  it('заводит пользователя с логином в нижнем регистре', async () => {
    const { users } = await setup();
    const list = await users.list();
    expect(list.map((u) => [u.login, u.fio, u.isAdmin, u.canCoordinates, u.active])).toEqual([
      ['admin', '', true, false, true],
      ['user', 'Иванов И. И.', false, false, true],
    ]);
  });

  it('проверяет логин, пароль и уникальность', async () => {
    const { users } = await setup();
    expect(await errorCode(users.create({ login: 'ab', password: 'достаточно-длинный' }))).toBe('bad_request');
    expect(await errorCode(users.create({ login: 'кириллица', password: 'достаточно-длинный' }))).toBe('bad_request');
    expect(await errorCode(users.create({ login: 'new', password: 'short' }))).toBe('bad_request');
    expect(await errorCode(users.create({ login: 'USER', password: 'достаточно-длинный' }))).toBe('login_taken');
  });

  it('пускает по логину в любом регистре и верному паролю', async () => {
    const { users, userId } = await setup();
    expect((await users.authenticate(' USER ', 'пароль-юзера'))?.id).toBe(userId);
    expect(await users.authenticate('user', 'не тот')).toBeUndefined();
    expect(await users.authenticate('nobody', 'пароль-юзера')).toBeUndefined();
    expect((await users.list()).find((u) => u.id === userId)?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('новый пароль и отключение закрывают сессии', async () => {
    const { users, adminId, userId } = await setup();
    const changed = await users.update(adminId, userId, { password: 'новый-пароль' });
    expect(changed.sessionVersion).toBe(1);
    expect(await users.sessionUser(userId, 0)).toBeUndefined();
    expect((await users.sessionUser(userId, 1))?.id).toBe(userId);

    const disabled = await users.update(adminId, userId, { active: false });
    expect(disabled.sessionVersion).toBe(2);
    expect(await users.sessionUser(userId, 2)).toBeUndefined();
    expect(await errorCode(users.authenticate('user', 'новый-пароль'))).toBe('account_disabled');

    // Правка флагов сессии не трогает
    const enabled = await users.update(adminId, userId, { active: true, canCoordinates: true });
    expect(enabled.sessionVersion).toBe(2);
    expect((await users.sessionUser(userId, 2))?.canCoordinates).toBe(true);
  });

  it('не даёт администратору лишить прав или удалить самого себя', async () => {
    const { users, adminId } = await setup();
    expect(await errorCode(users.update(adminId, adminId, { isAdmin: false }))).toBe('bad_request');
    expect(await errorCode(users.update(adminId, adminId, { active: false }))).toBe('bad_request');
    expect(await errorCode(users.delete(adminId, adminId))).toBe('bad_request');
  });

  it('не оставляет систему без администратора', async () => {
    const { users, adminId, userId } = await setup();
    // Из командной строки (без автора) последнего администратора тоже не снять
    expect(await errorCode(users.update(null, adminId, { isAdmin: false }))).toBe('last_admin');
    expect(await errorCode(users.delete(null, adminId))).toBe('last_admin');

    await users.update(adminId, userId, { isAdmin: true });
    await users.update(userId, adminId, { isAdmin: false });
    expect(await users.hasActiveAdmin()).toBe(true);
  });

  it('меняет свой пароль только по действующему', async () => {
    const { users, userId } = await setup();
    expect(await errorCode(users.changeOwnPassword(userId, 'не тот', 'новый-пароль'))).toBe('wrong_password');
    const changed = await users.changeOwnPassword(userId, 'пароль-юзера', 'новый-пароль');
    expect(changed.sessionVersion).toBe(1);
    expect(await users.authenticate('user', 'новый-пароль')).toBeDefined();
  });

  it('сообщает о несуществующем пользователе', async () => {
    const { users, adminId } = await setup();
    expect(await errorCode(users.update(adminId, 999, { fio: 'x' }))).toBe('user_not_found');
    expect(await errorCode(users.delete(adminId, 999))).toBe('user_not_found');
  });
});
