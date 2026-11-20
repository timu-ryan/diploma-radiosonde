import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Корень репозитория: там .env, общий с сервером. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Как normalizeBasePath в packages/server/src/config.ts: «zond», «/zond» → «/zond/», пусто — «/». */
function normalizeBasePath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  return parts.length > 0 ? `/${parts.join('/')}/` : '/';
}

export default defineConfig(({ mode }) => {
  // BASE_PATH — из того же .env, что читает сервер: сборка и сервер обязаны совпадать.
  // Переменная окружения главнее файла, как и у сервера.
  const base = normalizeBasePath(loadEnv(mode, repoRoot, '').BASE_PATH ?? '');

  return {
    base,
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        [`${base}api`]: {
          target: process.env.API_TARGET ?? 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
