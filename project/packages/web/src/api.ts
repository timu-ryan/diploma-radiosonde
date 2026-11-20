import type {
  AdminUser,
  ApiError,
  ApiKeyInfo,
  ChartGeometry,
  CreateApiKeyRequest,
  CreatedApiKey,
  CreateUserRequest,
  CurrentUser,
  DiagramKind,
  ForecastResponse,
  JournalPage,
  JournalSource,
  RunInfo,
  StationSummary,
  UpdateUserRequest,
} from '@rs/shared';
import { BASE } from './lib/paths.js';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: ApiError,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | undefined>;

/** Откуда выпуск: станция или точка по координатам. */
export type PlaceParams = { station: string } | { lat: number; lon: number };

export function apiUrl(path: string, params: Params = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return `${BASE}api${path}${query ? `?${query}` : ''}`;
}

let unauthorizedHandler: (() => void) | undefined;

/** Вызывается на любой 401 «требуется вход»: сессия истекла или пользователя отключили. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

async function fail(response: Response, fallback = `Ошибка запроса (${response.status})`): Promise<never> {
  let payload: ApiError | undefined;
  try {
    payload = (await response.json()) as ApiError;
  } catch {
    payload = undefined;
  }
  // Неверный пароль при входе — тоже 401, но с другим кодом: на него не реагируем.
  if (payload?.error === 'unauthorized') unauthorizedHandler?.();
  throw new ApiRequestError(payload?.message ?? fallback, response.status, payload);
}

async function get<T>(path: string, params: Params = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path, params), { signal });
  if (!response.ok) await fail(response);
  return (await response.json()) as T;
}

/** POST/PATCH/DELETE с JSON-телом; 204 — undefined. */
async function send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: object): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) await fail(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  stations: (signal?: AbortSignal) => get<StationSummary[]>('/stations', {}, signal),

  chart: (name: string, scale: number, signal?: AbortSignal) =>
    get<ChartGeometry>(`/stations/${encodeURIComponent(name)}/chart`, { scale }, signal),

  runs: (signal?: AbortSignal) => get<RunInfo[]>('/runs', {}, signal),

  forecast: (
    params: PlaceParams & { release: string; run?: string; interp?: string; ascent?: number },
    signal?: AbortSignal,
  ) => get<ForecastResponse>('/forecast', params, signal),

  reportUrl: (params: PlaceParams & { release: string; run?: string; interp?: string }) =>
    apiUrl('/forecast.txt', params),

  /** Бланк со схемой рисует сервер — его можно скачать в любом масштабе, не меняя экран. */
  chartSvgUrl: (params: PlaceParams & { release: string; scale: number; download?: 1 }) =>
    apiUrl('/chart.svg', params),

  chartSvgText: async (
    params: PlaceParams & { release: string; scale: number },
    signal?: AbortSignal,
  ): Promise<string> => {
    const response = await fetch(apiUrl('/chart.svg', params), { signal });
    if (!response.ok) await fail(response, 'Не удалось получить схему');
    return response.text();
  },

  /** Аэрологическую диаграмму для скачивания тоже рисует сервер — всегда светлой. */
  diagramSvgText: async (
    params: PlaceParams & { release: string; kind: DiagramKind },
    signal?: AbortSignal,
  ): Promise<string> => {
    const response = await fetch(apiUrl('/diagram.svg', params), { signal });
    if (!response.ok) await fail(response, 'Не удалось получить диаграмму');
    return response.text();
  },

  auth: {
    me: (signal?: AbortSignal) => get<CurrentUser>('/auth/me', {}, signal),
    login: (login: string, password: string) =>
      send<CurrentUser>('POST', '/auth/login', { login, password }),
    logout: () => send<void>('POST', '/auth/logout'),
    changePassword: (current: string, next: string) =>
      send<CurrentUser>('POST', '/auth/password', { current, next }),
  },

  admin: {
    users: (signal?: AbortSignal) => get<AdminUser[]>('/admin/users', {}, signal),
    create: (user: CreateUserRequest) => send<AdminUser>('POST', '/admin/users', user),
    update: (id: number, patch: UpdateUserRequest) =>
      send<AdminUser>('PATCH', `/admin/users/${id}`, patch),
    remove: (id: number) => send<void>('DELETE', `/admin/users/${id}`),
    /** Даты — сутки UTC, ГГГГ-ММ-ДД, обе включительно; `before` — id последней показанной записи. */
    journal: (
      params: { user?: string; from?: string; to?: string; source?: JournalSource; before?: number },
      signal?: AbortSignal,
    ) => get<JournalPage>('/admin/journal', params, signal),
    keys: (signal?: AbortSignal) => get<ApiKeyInfo[]>('/admin/keys', {}, signal),
    createKey: (request: CreateApiKeyRequest) => send<CreatedApiKey>('POST', '/admin/keys', request),
    removeKey: (id: number) => send<void>('DELETE', `/admin/keys/${id}`),
  },
};
