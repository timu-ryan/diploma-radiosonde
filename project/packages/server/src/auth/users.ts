import {
  MIN_PASSWORD_LENGTH,
  type AdminUser,
  type ApiKeyInfo,
  type CreateUserRequest,
  type CurrentUser,
  type UpdateUserRequest,
} from '@rs/shared';
import { HttpError } from '../forecast/service.js';
import { apiKeyPrefix, generateApiKey, hashApiKey } from './apikey.js';
import { hashPassword, verifyPassword } from './password.js';
import type { ApiKeyRecord, UserPatch, UserRecord, UserStore } from './store.js';

/** Время последнего запроса по ключу обновляем не чаще раза в минуту — без записи на каждый запрос. */
const KEY_TOUCH_MS = 60_000;

const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;
/** Только от явных опечаток: что-то@что-то.что-то без пробелов. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_LENGTH = 200;

/** Логины не зависят от регистра: храним и ищем в нижнем. */
export const normalizeLogin = (login: string): string => login.trim().toLowerCase();

export function toCurrentUser(user: UserRecord): CurrentUser {
  return {
    id: user.id,
    login: user.login,
    fio: user.fio,
    isAdmin: user.isAdmin,
    canCoordinates: user.canCoordinates,
  };
}

export function toAdminUser(user: UserRecord): AdminUser {
  return {
    ...toCurrentUser(user),
    comment: user.comment,
    email: user.email,
    organization: user.organization,
    filial: user.filial,
    subdivision: user.subdivision,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function toApiKeyInfo(key: ApiKeyRecord, login: string): ApiKeyInfo {
  return {
    id: key.id,
    userId: key.userId,
    login,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
  };
}

const badRequest = (message: string): HttpError => new HttpError(400, 'bad_request', message);

function checkLogin(login: string): string {
  const normalized = normalizeLogin(login);
  if (!LOGIN_PATTERN.test(normalized)) {
    throw badRequest(
      'Логин — от 3 до 32 символов: латинские буквы, цифры, точка, дефис или подчёркивание',
    );
  }
  return normalized;
}

function checkPassword(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw badRequest(`Пароль должен быть не длиннее ${MAX_PASSWORD_LENGTH} символов`);
  }
  return password;
}

function checkText(value: string | undefined, name: string, max: number): string | undefined {
  const text = value?.trim();
  if (text !== undefined && text.length > max) {
    throw badRequest(`${name} — не длиннее ${max} символов`);
  }
  return text;
}

function checkEmail(value: string | undefined): string | undefined {
  const email = checkText(value, 'Почта', 100);
  if (email && !EMAIL_PATTERN.test(email)) throw badRequest(`Некорректный адрес почты: ${email}`);
  return email;
}

/**
 * Правила работы с пользователями поверх хранилища: проверка входа, хеширование,
 * сброс сессий при смене пароля и отключении, защита от потери последнего администратора.
 */
export class UserService {
  /** Хеш-пустышка: для несуществующего логина тоже считаем scrypt, чтобы по времени ответа его не отличить. */
  private dummyHash: Promise<string> | undefined;

  constructor(readonly store: UserStore) {}

  /**
   * Вход: пользователь при верных логине и пароле, иначе undefined.
   * Отключённому с верным паролем — 403, чтобы он знал, к кому обращаться.
   */
  async authenticate(login: string, password: string): Promise<UserRecord | undefined> {
    const user = await this.store.findByLogin(normalizeLogin(login));
    this.dummyHash ??= hashPassword('нет такого пользователя');
    const valid = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !valid) return undefined;
    if (!user.active) {
      throw new HttpError(403, 'account_disabled', 'Учётная запись отключена — обратитесь к администратору');
    }
    const now = new Date();
    await this.store.touchLogin(user.id, now);
    return { ...user, lastLoginAt: now };
  }

  /** Пользователь действующей сессии: существует, не отключён, версия сессии совпадает. */
  async sessionUser(id: number, version: number): Promise<UserRecord | undefined> {
    const user = await this.store.findById(id);
    return user?.active && user.sessionVersion === version ? user : undefined;
  }

  list(): Promise<UserRecord[]> {
    return this.store.list();
  }

  async create(input: CreateUserRequest): Promise<UserRecord> {
    const login = checkLogin(input.login);
    const password = checkPassword(input.password);
    return this.store.create({
      login,
      passwordHash: await hashPassword(password),
      fio: checkText(input.fio, 'Ф.И.О.', 100) ?? '',
      comment: checkText(input.comment, 'Примечание', 255) ?? '',
      email: checkEmail(input.email) ?? '',
      organization: checkText(input.organization, 'Организация', 255) ?? '',
      filial: checkText(input.filial, 'Филиал', 255) ?? '',
      subdivision: checkText(input.subdivision, 'Подразделение', 255) ?? '',
      isAdmin: input.isAdmin ?? false,
      canCoordinates: input.canCoordinates ?? false,
    });
  }

  /** Правка пользователя администратором `actorId` (null — из командной строки). */
  async update(actorId: number | null, id: number, input: UpdateUserRequest): Promise<UserRecord> {
    const user = await this.get(id);
    if (id === actorId && input.isAdmin === false) {
      throw badRequest('Нельзя снять права администратора с самого себя');
    }
    if (id === actorId && input.active === false) {
      throw badRequest('Нельзя отключить самого себя');
    }
    if (user.isAdmin && user.active && (input.isAdmin === false || input.active === false)) {
      await this.ensureAnotherAdmin(id);
    }

    const patch: UserPatch = {
      fio: checkText(input.fio, 'Ф.И.О.', 100),
      comment: checkText(input.comment, 'Примечание', 255),
      email: checkEmail(input.email),
      organization: checkText(input.organization, 'Организация', 255),
      filial: checkText(input.filial, 'Филиал', 255),
      subdivision: checkText(input.subdivision, 'Подразделение', 255),
      isAdmin: input.isAdmin,
      canCoordinates: input.canCoordinates,
      active: input.active,
    };
    if (input.password !== undefined) {
      patch.passwordHash = await hashPassword(checkPassword(input.password));
    }
    // Новый пароль или отключение — выданные раньше сессии больше не действуют.
    if (input.password !== undefined || (input.active === false && user.active)) {
      patch.sessionVersion = user.sessionVersion + 1;
    }
    return (await this.store.update(id, patch)) ?? this.notFound(id);
  }

  /** Смена своего пароля: нужен действующий. Другие сессии пользователя закрываются. */
  async changeOwnPassword(id: number, current: string, next: string): Promise<UserRecord> {
    const user = await this.get(id);
    if (!(await verifyPassword(current, user.passwordHash))) {
      throw new HttpError(400, 'wrong_password', 'Текущий пароль указан неверно');
    }
    return this.update(id, id, { password: next });
  }

  async delete(actorId: number | null, id: number): Promise<void> {
    if (id === actorId) throw badRequest('Нельзя удалить самого себя');
    const user = await this.get(id);
    if (user.isAdmin && user.active) await this.ensureAnotherAdmin(id);
    await this.store.delete(id);
  }

  listKeys(): Promise<ApiKeyRecord[]> {
    return this.store.listKeys();
  }

  /** Выдаёт ключ API пользователю `userId`; сам ключ возвращается только здесь, хранится его хеш. */
  async createKey(userId: number, name: string): Promise<{ record: ApiKeyRecord; key: string; user: UserRecord }> {
    const user = await this.get(userId);
    const label = checkText(name, 'Назначение ключа', 100);
    if (!label) throw badRequest('Укажите, для чего ключ: какой сайт или сервер');
    const key = generateApiKey();
    const record = await this.store.createKey({
      userId,
      name: label,
      prefix: apiKeyPrefix(key),
      keyHash: hashApiKey(key),
    });
    return { record, key, user };
  }

  async deleteKey(id: number): Promise<void> {
    if (!(await this.store.deleteKey(id))) {
      throw new HttpError(404, 'key_not_found', `Ключ ${id} не найден`);
    }
  }

  /** Пользователь запроса по ключу API: ключ выдан, владелец существует и не отключён. */
  async keyUser(key: string): Promise<{ user: UserRecord; apiKey: ApiKeyRecord } | undefined> {
    const apiKey = await this.store.findKeyByHash(hashApiKey(key));
    if (!apiKey) return undefined;
    const user = await this.store.findById(apiKey.userId);
    if (!user?.active) return undefined;
    const now = new Date();
    if (!apiKey.lastUsedAt || now.getTime() - apiKey.lastUsedAt.getTime() >= KEY_TOUCH_MS) {
      await this.store.touchKey(apiKey.id, now);
      apiKey.lastUsedAt = now;
    }
    return { user, apiKey };
  }

  async hasActiveAdmin(): Promise<boolean> {
    return (await this.store.list()).some((u) => u.isAdmin && u.active);
  }

  private async get(id: number): Promise<UserRecord> {
    return (await this.store.findById(id)) ?? this.notFound(id);
  }

  private notFound(id: number): never {
    throw new HttpError(404, 'user_not_found', `Пользователь ${id} не найден`);
  }

  private async ensureAnotherAdmin(id: number): Promise<void> {
    const others = (await this.store.list()).filter((u) => u.id !== id && u.isAdmin && u.active);
    if (others.length === 0) {
      throw new HttpError(409, 'last_admin', 'Это последний администратор — сначала назначьте другого');
    }
  }
}
