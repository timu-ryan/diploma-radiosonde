import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminUser, JournalEntry, JournalSource } from '@rs/shared';
import {
  DIAGRAM_KIND_LABELS,
  formatDateUtc,
  formatLat,
  formatLon,
  formatTimeUtc,
  isDiagramKind,
  parseUtc,
} from '@rs/shared';
import { api } from '../api.js';
import { AdminLayout } from './AdminLayout.js';
import { Notice, inputClass, secondaryButtonClass } from './Field.js';

/** Как в меню «Скачать»: «Бланк .txt», «Схема 100 км», «Диаграмма АДК». */
function productLabel(entry: JournalEntry): string {
  switch (entry.product) {
    case 'report':
      return 'Бланк .txt';
    case 'chart':
      return `Схема ${entry.variant} км`;
    case 'diagram':
      return `Диаграмма ${isDiagramKind(entry.variant) ? DIAGRAM_KIND_LABELS[entry.variant].short : entry.variant}`;
  }
}

/** 06.11.2026 10:21 — заголовок столбца уже говорит, что это UTC. */
const dateTime = (iso: string): string => {
  const d = parseUtc(iso);
  return `${formatDateUtc(d)} ${formatTimeUtc(d)}`;
};

/** 2026080700 → «07.08 00 UTC». */
function runLabel(id: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(id);
  return m ? `${m[3]}.${m[2]} ${m[4]} UTC` : id;
}

const labelClass = 'mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400';

/** Журнал выпусков: кто, когда и что скачал. Новые сверху, листается по 100. */
export function JournalPage(): React.JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState('');
  const [source, setSource] = useState<JournalSource | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ user: userId || undefined, source: source || undefined, from: from || undefined, to: to || undefined }),
    [userId, source, from, to],
  );
  // Фильтры, для которых показан список: ответ «Показать ещё» от прежних не приклеиваем.
  const shown = useRef(filters);

  useEffect(() => {
    const controller = new AbortController();
    // Список (сервер отдаёт его по логину) нужен только для фильтра: без него журнал всё равно виден.
    api.admin
      .users(controller.signal)
      .then(setUsers)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    shown.current = filters;
    setEntries(null);
    setError(null);
    api.admin
      .journal(filters, controller.signal)
      .then((page) => {
        setEntries(page.entries);
        setMore(page.more);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал');
        }
      });
    return () => controller.abort();
  }, [filters]);

  const loadMore = async (): Promise<void> => {
    const last = entries?.[entries.length - 1];
    if (!last) return;
    const requested = filters;
    setLoadingMore(true);
    try {
      const page = await api.admin.journal({ ...requested, before: last.id });
      if (shown.current !== requested) return;
      setEntries((list) => [...(list ?? []), ...page.entries]);
      setMore(page.more);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал');
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = Boolean(userId || source || from || to);

  return (
    <AdminLayout section="journal">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <label htmlFor="journal-user" className={labelClass}>
            Пользователь
          </label>
          <select
            id="journal-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className={inputClass}
          >
            <option value="">Все</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.login}
                {u.fio ? ` — ${u.fio}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="journal-source" className={labelClass}>
            Откуда
          </label>
          <select
            id="journal-source"
            value={source}
            onChange={(event) => setSource(event.target.value as JournalSource | '')}
            className={inputClass}
          >
            <option value="">Все</option>
            <option value="site">С сайта</option>
            <option value="key">По ключу API</option>
          </select>
        </div>
        <div>
          <label htmlFor="journal-from" className={labelClass}>
            С (UTC)
          </label>
          <input
            id="journal-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="journal-to" className={labelClass}>
            По (UTC)
          </label>
          <input
            id="journal-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className={inputClass}
          />
        </div>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setUserId('');
              setSource('');
              setFrom('');
              setTo('');
            }}
            className={secondaryButtonClass}
          >
            Сбросить
          </button>
        )}
        <span className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          {entries ? `Показано: ${entries.length}${more ? ', есть ещё' : ''}` : 'Загрузка…'}
        </span>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Скачано, UTC</th>
              <th className="px-4 py-2.5">Пользователь</th>
              <th className="px-4 py-2.5">Что</th>
              <th className="px-4 py-2.5">Место выпуска</th>
              <th className="px-4 py-2.5">Выпуск зонда, UTC</th>
              <th className="px-4 py-2.5">Прогон</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries?.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{dateTime(e.at)}</td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">
                    {e.login}
                    {e.apiKey !== null && (
                      <span
                        title="Скачано другим сайтом по ключу API"
                        className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      >
                        ключ «{e.apiKey}»
                      </span>
                    )}
                  </div>
                  {e.fio && <div className="text-xs text-slate-500 dark:text-slate-400">{e.fio}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">{productLabel(e)}</td>
                <td className="px-4 py-2.5">
                  <div>{e.place}</div>
                  <div className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {e.station ?? `${formatLat(e.lat)}, ${formatLon(e.lon)}`}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{dateTime(e.release)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                  {runLabel(e.run)}
                </td>
              </tr>
            ))}
            {entries && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {filtered ? 'За выбранное нет записей' : 'Журнал пока пуст: записи появляются при скачивании'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {more && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className={secondaryButtonClass}
          >
            {loadingMore ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </AdminLayout>
  );
}
