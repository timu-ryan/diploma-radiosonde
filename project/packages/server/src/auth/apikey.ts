import { createHash, randomBytes } from 'node:crypto';

/** Ключи начинаются с `rsk_` — так их легко узнать в настройках и случайно не спутать с паролем. */
const KEY_START = 'rsk_';

/**
 * Новый ключ: 24 случайных байта (192 бита). Подбирать такой бессмысленно, поэтому
 * хранить можно простой SHA-256 без соли и искать ключ по нему — scrypt тут не нужен.
 */
export function generateApiKey(): string {
  return KEY_START + randomBytes(24).toString('base64url');
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Начало ключа для списка в админке: `rsk_` и ещё 8 символов. */
export const apiKeyPrefix = (key: string): string => key.slice(0, KEY_START.length + 8);
