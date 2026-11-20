/**
 * Путь, под которым открыт сайт: `/` или `/zond/` (BASE_PATH из .env, Vite подставляет его
 * при сборке). Адреса API и страниц строятся только отсюда — `/api` или `/admin` от корня
 * домена за прокси с префиксом уходят мимо сайта.
 */
export const BASE = import.meta.env.BASE_URL;

/** Адрес страницы сайта: pageUrl('admin/keys') → /zond/admin/keys, pageUrl() → /zond/. */
export const pageUrl = (path = ''): string => `${BASE}${path}`;

/** Путь страницы без BASE: /zond/admin/keys → admin/keys. */
export function pagePath(pathname: string): string {
  return pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\/+/, '');
}
