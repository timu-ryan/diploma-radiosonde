import { useEffect, useRef, useState } from 'react';
import type { AdminUser, ApiKeyInfo, CreatedApiKey } from '@rs/shared';
import { formatDateTimeUtc, parseUtc } from '@rs/shared';
import { api } from '../api.js';
import { BASE } from '../lib/paths.js';
import { AdminLayout } from './AdminLayout.js';
import { Notice, TextField, inputClass, primaryButtonClass, secondaryButtonClass } from './Field.js';
import { Modal } from './Modal.js';

const labelClass = 'mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400';

/**
 * Ключи API для других сайтов: выдать (ключ виден один раз) и отозвать. Запросы по ключу
 * идут от имени пользователя, которому он выдан, и с его правами.
 */
export function KeysPage(): React.JSX.Element {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = (signal?: AbortSignal): Promise<void> =>
    Promise.all([api.admin.keys(signal), api.admin.users(signal)]).then(([keyList, userList]) => {
      setKeys(keyList);
      setUsers(userList);
    });

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить ключи');
    });
    return () => controller.abort();
  }, []);

  const revoke = async (key: ApiKeyInfo): Promise<void> => {
    if (!window.confirm(`Отозвать ключ «${key.name}» (${key.prefix}…)? Сайт, который им пользуется, сразу потеряет доступ.`)) {
      return;
    }
    setBusyId(key.id);
    try {
      await api.admin.removeKey(key.id);
      setKeys((list) => list?.filter((k) => k.id !== key.id) ?? null);
      setMessage(`Ключ «${key.name}» отозван`);
      setError(null);
    } catch (err) {
      setMessage(null);
      setError(err instanceof Error ? err.message : 'Не удалось отозвать ключ');
    } finally {
      setBusyId(null);
    }
  };

  const inactive = new Set(users.filter((u) => !u.active).map((u) => u.id));

  return (
    <AdminLayout section="keys">
      <div className="flex flex-wrap items-start gap-3">
        <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Ключ нужен другому сайту, чтобы обращаться к <code>{`${window.location.origin}${BASE}api/v1`}</code> со своего
          сервера — в заголовке{' '}
          <code>Authorization: Bearer …</code>. Запросы идут от имени пользователя, которому выдан ключ, и с его
          правами; скачанные бланки и диаграммы попадают в журнал с пометкой ключа.
        </p>
        <button type="button" onClick={() => setCreating(true)} className={`ml-auto ${primaryButtonClass}`}>
          Новый ключ
        </button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Для чего</th>
              <th className="px-4 py-2.5">От чьего имени</th>
              <th className="px-4 py-2.5">Ключ</th>
              <th className="px-4 py-2.5">Выдан</th>
              <th className="px-4 py-2.5">Последний запрос</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {keys?.map((key) => (
              <tr key={key.id}>
                <td className="px-4 py-2.5 font-medium">{key.name}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {key.login}
                  {inactive.has(key.userId) && (
                    <span className="ml-2 text-xs text-rose-600 dark:text-rose-400">отключён — ключ не действует</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {key.prefix}…
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                  {formatDateTimeUtc(parseUtc(key.createdAt))}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                  {key.lastUsedAt ? formatDateTimeUtc(parseUtc(key.lastUsedAt)) : 'не пользовались'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => void revoke(key)}
                    disabled={busyId === key.id}
                    className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    Отозвать
                  </button>
                </td>
              </tr>
            ))}
            {keys && keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Ключей пока нет
                </td>
              </tr>
            )}
            {!keys && !error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Загрузка…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {creating && (
        <CreateKeyDialog
          users={users.filter((u) => u.active)}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            setMessage(null);
            void load().catch(() => undefined);
          }}
        />
      )}
      {created && <ShowKeyDialog created={created} onClose={() => setCreated(null)} />}
    </AdminLayout>
  );
}

function CreateKeyDialog(props: {
  users: AdminUser[];
  onClose: () => void;
  onCreated: (key: CreatedApiKey) => void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      props.onCreated(await api.admin.createKey({ userId: Number(userId), name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выдать ключ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый ключ API" onClose={props.onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        <TextField
          label="Для чего: какой сайт или сервер"
          value={name}
          onChange={setName}
          maxLength={100}
          autoFocus
          required
        />
        <div>
          <label htmlFor="key-user" className={labelClass}>
            От чьего имени
          </label>
          <select
            id="key-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className={inputClass}
            required
          >
            <option value="" disabled>
              Выберите пользователя
            </option>
            {props.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.login}
                {u.fio ? ` — ${u.fio}` : ''}
                {u.canCoordinates ? '' : ' (без расчёта по координатам)'}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            Лучше завести для сайта отдельного пользователя: его запросы будут отдельно видны в журнале,
            и его можно отключить, не трогая людей. Для расчёта по точке на карте ему нужно право
            «Расчёт по координатам».
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} className={secondaryButtonClass}>
            Отмена
          </button>
          <button type="submit" disabled={busy || !userId || !name.trim()} className={primaryButtonClass}>
            {busy ? 'Выдаю…' : 'Выдать ключ'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Ключ целиком — один раз: сервер хранит только его хеш. */
function ShowKeyDialog({ created, onClose }: { created: CreatedApiKey; onClose: () => void }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      // Без https буфер обмена браузеру недоступен — выделяем ключ, копируется по Ctrl+C.
      input.current?.select();
    }
  };

  // Esc и щелчок мимо закрывают окно — переспрашиваем, если ключ ещё не скопирован.
  const close = (): void => {
    if (copied || window.confirm('Ключ больше не покажется. Закрыть окно?')) onClose();
  };

  return (
    <Modal title={`Ключ «${created.name}»`} onClose={close}>
      <div className="space-y-3">
        <Notice kind="info">
          Скопируйте ключ сейчас и положите в настройки сервера другого сайта. Потом его не показать — только
          отозвать и выдать новый.
        </Notice>
        <div className="flex gap-2">
          <input
            ref={input}
            readOnly
            value={created.key}
            onFocus={(event) => event.target.select()}
            aria-label="Ключ API"
            className={`${inputClass} font-mono text-xs`}
          />
          <button type="button" onClick={() => void copy()} className={`whitespace-nowrap ${secondaryButtonClass}`}>
            {copied ? 'Скопирован' : 'Копировать'}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Запросы с этим ключом пойдут от имени {created.login}.
        </p>
        <div className="flex justify-end pt-2">
          <button type="button" onClick={close} className={primaryButtonClass}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
