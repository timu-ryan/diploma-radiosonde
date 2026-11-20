import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env в корне репозитория — до импорта конфигурации, поэтому импортируется первым.
// Скрипты лежат на уровень глубже index.ts, отсюда лишний «../».
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
