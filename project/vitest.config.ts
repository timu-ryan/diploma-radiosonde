import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Тесты работают с исходниками shared, чтобы не требовать предварительной сборки.
      '@rs/shared': `${root}packages/shared/src/index.ts`,
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    root,
    env: {
      // Эталонный прогон 2026080700 (хранится в git).
      DATA_DIR: 'data/fixtures',
      // Фиксированный ключ сессий, чтобы не шуметь предупреждением о случайном.
      SESSION_SECRET: 'test-session-secret',
    },
  },
});
