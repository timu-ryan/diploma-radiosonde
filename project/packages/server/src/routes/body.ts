import { HttpError } from '../forecast/service.js';

/** Разбор JSON-тела POST/PATCH: типы полей проверяются вручную, как и query в api.ts. */
export type Body = Record<string, unknown>;

export function bodyObject(body: unknown): Body {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'bad_request', 'Ожидается JSON-объект в теле запроса');
  }
  return body as Body;
}

export function optionalString(body: Body, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'bad_request', `Поле ${key} должно быть строкой`);
  }
  return value;
}

/** `label` — именительный падеж мужского рода: «логин», «пароль». */
export function requiredString(body: Body, key: string, label: string): string {
  const value = optionalString(body, key);
  if (!value) throw new HttpError(400, 'bad_request', `Не указан ${label} (поле ${key})`);
  return value;
}

export function optionalBoolean(body: Body, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'bad_request', `Поле ${key} должно быть true или false`);
  }
  return value;
}
