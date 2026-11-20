import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env в корне репозитория (токен сервера прогнозов и т. п.). Читается до импорта
// конфигурации; уже заданные переменные окружения не перезаписываются.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { buildApp } = await import('./app.js');
const { config } = await import('./config.js');

const app = await buildApp().catch((error: unknown) => {
  // Ошибка конфигурации (нет DB_URL, база недоступна) — одной строкой, без стека.
  console.error(`Сервер не запущен: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`Получен ${signal}, останавливаюсь`);
    void app.close().then(() => process.exit(0));
  });
}
