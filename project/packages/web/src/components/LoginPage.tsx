import { useState } from 'react';
import type { CurrentUser } from '@rs/shared';
import { api } from '../api.js';
import { useTheme } from '../lib/theme.js';
import { Notice, TextField, primaryButtonClass } from './Field.js';

interface Props {
  /** Пояснение над формой, например «сессия завершена». */
  notice?: string;
  onLogin: (user: CurrentUser) => void;
}

/** Вход по логину и паролю. Регистрации нет — учётные записи заводит администратор. */
export function LoginPage({ notice, onLogin }: Props): React.JSX.Element {
  const { theme, toggle } = useTheme();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await api.auth.login(login, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex justify-end p-4">
        <button
          type="button"
          onClick={toggle}
          title="Сменить тему"
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh]">
        <form
          onSubmit={(event) => void submit(event)}
          className="w-full max-w-sm animate-rise space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <h1 className="text-lg font-semibold">Прогноз перемещения радиозонда</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              ФГБУ «Авиаметтелеком Росгидромета»
            </p>
          </div>

          {notice && !error && <Notice kind="info">{notice}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}

          <TextField
            label="Логин"
            value={login}
            onChange={setLogin}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
          <TextField
            label="Пароль"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />

          <button type="submit" disabled={busy || !login || !password} className={`w-full ${primaryButtonClass}`}>
            {busy ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </main>
    </div>
  );
}
