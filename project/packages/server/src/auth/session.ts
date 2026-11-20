import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Содержимое cookie сессии. Таблицы сессий нет: cookie подписана ключом сервера,
 * а `version` сверяется с `session_version` пользователя — смена пароля или отключение
 * поднимают её, и все выданные раньше cookie перестают действовать.
 */
export interface SessionClaims {
  userId: number;
  version: number;
  /** Момент истечения, мс от эпохи (в cookie хранится с точностью до секунды). */
  expiresAt: number;
}

const mac = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/** `id.версия.истекает.подпись` — только цифры, точки и base64url, в cookie экранировать нечего. */
export function signSession(claims: SessionClaims, secret: string): string {
  const payload = `${claims.userId}.${claims.version}.${Math.floor(claims.expiresAt / 1000)}`;
  return `${payload}.${mac(payload, secret)}`;
}

/** Разбирает и проверяет cookie; подделанная, чужая или истёкшая — undefined. */
export function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): SessionClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 4) return undefined;
  const [id, version, expires, signature] = parts as [string, string, string, string];

  const expected = Buffer.from(mac(`${id}.${version}.${expires}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;

  const claims: SessionClaims = {
    userId: Number(id),
    version: Number(version),
    expiresAt: Number(expires) * 1000,
  };
  if (![claims.userId, claims.version, claims.expiresAt].every(Number.isSafeInteger)) return undefined;
  return claims.expiresAt > now ? claims : undefined;
}
