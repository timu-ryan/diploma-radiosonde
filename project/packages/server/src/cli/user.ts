import './env.js';
import { parseArgs } from 'node:util';
import { config } from '../config.js';
import { MysqlUserStore } from '../auth/mysql.js';
import { UserService, normalizeLogin } from '../auth/users.js';

const USAGE = `Заводит пользователя или задаёт ему новый пароль (база — DB_URL из .env).

  npm run user -- <логин> [--admin] [--coords] [--fio "Иванов И. И."]

  --admin    сделать администратором
  --coords   разрешить расчёт по координатам
  --fio      Ф.И.О.

Пароль спрашивается в терминале; в скриптах его можно подать на stdin.
Существующему пользователю пароль меняется, а сам он включается, если был отключён.`;

/** Пароль без эха в терминале; из канала (не TTY) — первая строка как есть. */
function askPassword(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    return new Promise((resolve) => {
      let text = '';
      input.setEncoding('utf8');
      input.on('data', (chunk: string) => (text += chunk));
      input.on('end', () => resolve(text.split(/\r?\n/)[0] ?? ''));
    });
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (): void => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new Error('Прервано'));
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      admin: { type: 'boolean', default: false },
      coords: { type: 'boolean', default: false },
      fio: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const login = positionals[0];
  if (values.help || !login || positionals.length > 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  if (!config.db.url) throw new Error('Не задан DB_URL — адрес базы пользователей, см. README');

  const password = await askPassword('Пароль: ');
  if (process.stdin.isTTY && (await askPassword('Ещё раз: ')) !== password) {
    throw new Error('Пароли не совпадают');
  }

  const store = MysqlUserStore.connect(config.db.url);
  try {
    await store.init();
    const users = new UserService(store);
    const flags = {
      ...(values.admin ? { isAdmin: true } : {}),
      ...(values.coords ? { canCoordinates: true } : {}),
      ...(values.fio !== undefined ? { fio: values.fio } : {}),
    };

    const existing = await store.findByLogin(normalizeLogin(login));
    if (existing) {
      await users.update(null, existing.id, { ...flags, password, active: true });
      console.log(`Пользователю ${existing.login} задан новый пароль`);
    } else {
      const user = await users.create({ login, password, ...flags });
      console.log(`Заведён пользователь ${user.login}${user.isAdmin ? ' (администратор)' : ''}`);
    }
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
