import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Параметры scrypt для новых паролей; старые хеши проверяются со своими, записанными в хеш. */
const COST = { N: 16_384, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, cost: typeof COST): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFC — чтобы «й», набранная разными способами, давала один и тот же пароль.
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, cost, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Хеш пароля в виде `scrypt$N$r$p$соль$ключ` (соль и ключ — base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every(Number.isSafeInteger)) return false;

  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), cost);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
