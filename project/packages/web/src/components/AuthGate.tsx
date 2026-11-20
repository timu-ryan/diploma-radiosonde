import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CurrentUser } from '@rs/shared';
import { ApiRequestError, api, setUnauthorizedHandler } from '../api.js';
import { App } from '../App.js';
import { pageUrl } from '../lib/paths.js';
import { UserContext } from '../lib/user.js';
import { adminSection, type AdminSection } from './AdminLayout.js';
import { AdminPage } from './AdminPage.js';
import { JournalPage } from './JournalPage.js';
import { KeysPage } from './KeysPage.js';
import { LoginPage } from './LoginPage.js';

type State =
  | { status: 'loading' }
  | { status: 'anonymous'; notice?: string }
  | { status: 'failed'; message: string }
  | { status: 'ready'; user: CurrentUser };

const ADMIN_PAGES: Record<AdminSection, () => React.JSX.Element> = {
  users: () => <AdminPage />,
  journal: () => <JournalPage />,
  keys: () => <KeysPage />,
};

/**
 * Весь сайт — только после входа: спрашиваем сервер, кто мы, и показываем либо
 * страницу входа, либо приложение. Админка — отдельные пути `/admin`, `/admin/journal`
 * и `/admin/keys` без роутера: сервер и Vite на любой путь отдают index.html.
 */
export function AuthGate(): React.JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Любой 401 посреди работы — сессия кончилась: возвращаемся ко входу с пояснением.
    setUnauthorizedHandler(() =>
      setState((current) =>
        current.status === 'ready'
          ? { status: 'anonymous', notice: 'Сессия завершена — войдите снова' }
          : current.status === 'anonymous'
            ? current
            : { status: 'anonymous' },
      ),
    );
    return () => setUnauthorizedHandler(undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.auth
      .me(controller.signal)
      .then((user) => setState({ status: 'ready', user }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiRequestError && err.status === 401) setState({ status: 'anonymous' });
        else setState({ status: 'failed', message: err instanceof Error ? err.message : 'Сервер недоступен' });
      });
    return () => controller.abort();
  }, [attempt]);

  const setUser = useCallback((user: CurrentUser) => setState({ status: 'ready', user }), []);
  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setState({ status: 'anonymous' });
    }
  }, []);

  const context = useMemo(
    () => (state.status === 'ready' ? { user: state.user, setUser, logout } : null),
    [state, setUser, logout],
  );

  if (state.status === 'loading') {
    return <div className="min-h-full bg-slate-50 dark:bg-slate-950" />;
  }
  if (state.status === 'failed') {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
          {state.message}. Проверьте, запущен ли сервер: <code>npm run dev</code>.
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
            className="mt-3 block rounded-lg border border-rose-300 px-3 py-1.5 font-medium transition hover:bg-rose-100 dark:border-rose-800 dark:hover:bg-rose-900/40"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (state.status === 'anonymous' || !context) {
    return <LoginPage notice={state.status === 'anonymous' ? state.notice : undefined} onLogin={setUser} />;
  }

  const section = adminSection(window.location.pathname);
  if (section && !context.user.isAdmin) window.history.replaceState(null, '', pageUrl());

  const page = !section || !context.user.isAdmin ? <App /> : ADMIN_PAGES[section]();
  return <UserContext.Provider value={context}>{page}</UserContext.Provider>;
}
