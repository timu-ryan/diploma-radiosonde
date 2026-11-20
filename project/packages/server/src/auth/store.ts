import type { UserContacts } from '@rs/shared';
import { HttpError } from '../forecast/service.js';

/** Пользователь сайта как он лежит в хранилище. */
export interface UserRecord extends UserContacts {
  id: number;
  /** В нижнем регистре. */
  login: string;
  passwordHash: string;
  fio: string;
  comment: string;
  isAdmin: boolean;
  canCoordinates: boolean;
  active: boolean;
  /** Сверяется с версией в cookie сессии; +1 — все сессии пользователя недействительны. */
  sessionVersion: number;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export type NewUser = Pick<
  UserRecord,
  'login' | 'passwordHash' | 'fio' | 'comment' | 'isAdmin' | 'canCoordinates' | keyof UserContacts
>;

export type UserPatch = Partial<
  Pick<
    UserRecord,
    | 'passwordHash'
    | 'fio'
    | 'comment'
    | 'isAdmin'
    | 'canCoordinates'
    | 'active'
    | 'sessionVersion'
    | keyof UserContacts
  >
>;

/** Ключ API как он лежит в хранилище: сам ключ не хранится, только его хеш. */
export interface ApiKeyRecord {
  id: number;
  /** От чьего имени идут запросы. */
  userId: number;
  name: string;
  /** Начало ключа — чтобы узнать его в списке. */
  prefix: string;
  keyHash: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type NewApiKey = Pick<ApiKeyRecord, 'userId' | 'name' | 'prefix' | 'keyHash'>;

/**
 * Хранилище пользователей и их ключей API. Правила (кто что может, хеширование, версии
 * сессий) — в `UserService`; здесь только чтение и запись. На сервере — MySQL, в тестах — память.
 */
export interface UserStore {
  /** Создаёт таблицу, если её нет. */
  init(): Promise<void>;
  findById(id: number): Promise<UserRecord | undefined>;
  findByLogin(login: string): Promise<UserRecord | undefined>;
  list(): Promise<UserRecord[]>;
  /** Занятый логин — `HttpError` 409 `login_taken`. */
  create(user: NewUser): Promise<UserRecord>;
  update(id: number, patch: UserPatch): Promise<UserRecord | undefined>;
  /** Вместе с ключами API пользователя. */
  delete(id: number): Promise<boolean>;
  touchLogin(id: number, at: Date): Promise<void>;
  listKeys(): Promise<ApiKeyRecord[]>;
  findKeyByHash(hash: string): Promise<ApiKeyRecord | undefined>;
  createKey(key: NewApiKey): Promise<ApiKeyRecord>;
  deleteKey(id: number): Promise<boolean>;
  touchKey(id: number, at: Date): Promise<void>;
  close(): Promise<void>;
}

export function loginTaken(login: string): HttpError {
  return new HttpError(409, 'login_taken', `Логин ${login} уже занят`);
}

/** Хранилище в памяти — для тестов: без базы и без файлов. */
export class MemoryUserStore implements UserStore {
  private readonly users = new Map<number, UserRecord>();
  private nextId = 1;
  private readonly keys = new Map<number, ApiKeyRecord>();
  private nextKeyId = 1;

  async init(): Promise<void> {}

  async findById(id: number): Promise<UserRecord | undefined> {
    const user = this.users.get(id);
    return user && structuredClone(user);
  }

  async findByLogin(login: string): Promise<UserRecord | undefined> {
    const user = [...this.users.values()].find((u) => u.login === login);
    return user && structuredClone(user);
  }

  async list(): Promise<UserRecord[]> {
    return [...this.users.values()]
      .sort((a, b) => a.login.localeCompare(b.login))
      .map((u) => structuredClone(u));
  }

  async create(user: NewUser): Promise<UserRecord> {
    if (await this.findByLogin(user.login)) throw loginTaken(user.login);
    const record: UserRecord = {
      ...user,
      id: this.nextId++,
      active: true,
      sessionVersion: 0,
      createdAt: new Date(),
      lastLoginAt: null,
    };
    this.users.set(record.id, record);
    return structuredClone(record);
  }

  async update(id: number, patch: UserPatch): Promise<UserRecord | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    // Как UPDATE в MySQL: незаданные поля не трогаем.
    Object.assign(user, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return structuredClone(user);
  }

  async delete(id: number): Promise<boolean> {
    for (const key of this.keys.values()) if (key.userId === id) this.keys.delete(key.id);
    return this.users.delete(id);
  }

  async touchLogin(id: number, at: Date): Promise<void> {
    const user = this.users.get(id);
    if (user) user.lastLoginAt = at;
  }

  async listKeys(): Promise<ApiKeyRecord[]> {
    return [...this.keys.values()].map((k) => structuredClone(k));
  }

  async findKeyByHash(hash: string): Promise<ApiKeyRecord | undefined> {
    const key = [...this.keys.values()].find((k) => k.keyHash === hash);
    return key && structuredClone(key);
  }

  async createKey(key: NewApiKey): Promise<ApiKeyRecord> {
    const record: ApiKeyRecord = { ...key, id: this.nextKeyId++, createdAt: new Date(), lastUsedAt: null };
    this.keys.set(record.id, record);
    return structuredClone(record);
  }

  async deleteKey(id: number): Promise<boolean> {
    return this.keys.delete(id);
  }

  async touchKey(id: number, at: Date): Promise<void> {
    const key = this.keys.get(id);
    if (key) key.lastUsedAt = at;
  }

  async close(): Promise<void> {}
}
