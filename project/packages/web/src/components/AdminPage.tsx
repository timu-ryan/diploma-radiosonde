import { useEffect, useMemo, useState } from 'react';
import type { AdminUser, CreateUserRequest, UpdateUserRequest } from '@rs/shared';
import { MIN_PASSWORD_LENGTH, formatDateTimeUtc, parseUtc } from '@rs/shared';
import { api } from '../api.js';
import { useUser } from '../lib/user.js';
import { AdminLayout } from './AdminLayout.js';
import {
  CheckboxField,
  Notice,
  TextField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './Field.js';
import { Modal } from './Modal.js';

/** Без похожих символов (l/1, O/0): пароль диктуют по телефону. */
function generatePassword(length = 12): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(random, (n) => alphabet[n % alphabet.length]).join('');
}

const byLogin = (a: AdminUser, b: AdminUser): number => a.login.localeCompare(b.login);

type PlaceField = 'organization' | 'filial' | 'subdivision';

/** Уже введённые названия — подсказки в форме, чтобы одно и то же писали одинаково. */
type Suggestions = Record<PlaceField, string[]>;

/** «АМСГ-1 Уфа · Приволжский филиал · ФГБУ …» — от частного к общему. */
const placeOf = (u: AdminUser): string => [u.subdivision, u.filial, u.organization].filter(Boolean).join(' · ');

/** Управление пользователями: заводить, выдавать права, менять пароли, отключать. */
export function AdminPage(): React.JSX.Element {
  const { user: me } = useUser();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; user: AdminUser } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.admin
      .users(controller.signal)
      .then(setUsers)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить пользователей');
        }
      });
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!users || !q) return users ?? [];
    return users.filter((u) =>
      `${u.login} ${u.fio} ${u.email} ${placeOf(u)} ${u.comment}`.toLowerCase().includes(q),
    );
  }, [users, query]);

  const suggestions = useMemo((): Suggestions => {
    const distinct = (field: PlaceField): string[] =>
      [...new Set((users ?? []).map((u) => u[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    return { organization: distinct('organization'), filial: distinct('filial'), subdivision: distinct('subdivision') };
  }, [users]);

  const report = (text: string | null, failure: string | null = null): void => {
    setMessage(text);
    setError(failure);
  };

  const replace = (updated: AdminUser): void =>
    setUsers((list) => list?.map((u) => (u.id === updated.id ? updated : u)) ?? null);

  const toggleFlag = async (
    target: AdminUser,
    patch: Pick<UpdateUserRequest, 'canCoordinates' | 'isAdmin' | 'active'>,
  ): Promise<void> => {
    // Флажок переключается сразу; если сервер откажет — возвращаем как было.
    replace({ ...target, ...patch });
    setBusyId(target.id);
    try {
      replace(await api.admin.update(target.id, patch));
      report(null);
    } catch (err) {
      replace(target);
      report(null, err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (target: AdminUser): Promise<void> => {
    if (!window.confirm(`Удалить пользователя ${target.login}? Это необратимо — можно вместо этого отключить.`)) {
      return;
    }
    setBusyId(target.id);
    try {
      await api.admin.remove(target.id);
      setUsers((list) => list?.filter((u) => u.id !== target.id) ?? null);
      report(`Пользователь ${target.login} удалён`);
    } catch (err) {
      report(null, err instanceof Error ? err.message : 'Не удалось удалить');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminLayout section="users">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по логину, Ф.И.О., почте, организации"
          className={`${inputClass} max-w-sm`}
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {users ? `Всего: ${users.length}` : 'Загрузка…'}
        </span>
        <button type="button" onClick={() => setDialog({ mode: 'create' })} className={`ml-auto ${primaryButtonClass}`}>
          Новый пользователь
        </button>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Логин</th>
              <th className="px-4 py-2.5">Ф.И.О., место работы, примечание</th>
              <th className="px-4 py-2.5" title="Расчёт по произвольным координатам, а не только со станции">
                Координаты
              </th>
              <th className="px-4 py-2.5">Администратор</th>
              <th className="px-4 py-2.5" title="Отключённый пользователь не может войти">
                Вход разрешён
              </th>
              <th className="px-4 py-2.5">Последний вход</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((u) => {
              const self = u.id === me.id;
              const busy = busyId === u.id;
              return (
                <tr key={u.id} className={u.active ? '' : 'text-slate-400 dark:text-slate-500'}>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">
                    {u.login}
                    {self && (
                      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-normal text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                        это вы
                      </span>
                    )}
                  </td>
                  <td className="min-w-[14rem] px-4 py-2.5">
                    <div>
                      {u.fio || <span className="text-slate-400">—</span>}
                      {u.email && (
                        <a
                          href={`mailto:${u.email}`}
                          className="ml-2 text-xs text-sky-600 hover:underline dark:text-sky-400"
                        >
                          {u.email}
                        </a>
                      )}
                    </div>
                    {placeOf(u) && <div className="text-xs text-slate-500 dark:text-slate-400">{placeOf(u)}</div>}
                    {u.comment && <div className="text-xs text-slate-500 dark:text-slate-400">{u.comment}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <FlagBox
                      checked={u.canCoordinates}
                      disabled={busy}
                      label={`Расчёт по координатам для ${u.login}`}
                      onChange={(value) => void toggleFlag(u, { canCoordinates: value })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <FlagBox
                      checked={u.isAdmin}
                      disabled={busy || self}
                      label={`Права администратора для ${u.login}`}
                      onChange={(value) => void toggleFlag(u, { isAdmin: value })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <FlagBox
                      checked={u.active}
                      disabled={busy || self}
                      label={`Вход разрешён для ${u.login}`}
                      onChange={(value) => void toggleFlag(u, { active: value })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-500 dark:text-slate-400">
                    {u.lastLoginAt ? formatDateTimeUtc(parseUtc(u.lastLoginAt)) : 'не входил'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: 'edit', user: u })}
                      disabled={busy}
                      className="rounded-md px-2 py-1 text-xs font-medium text-sky-600 transition hover:bg-sky-50 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
                    >
                      Изменить
                    </button>
                    {!self && (
                      <button
                        type="button"
                        onClick={() => void remove(u)}
                        disabled={busy}
                        className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                      >
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  {users.length === 0 ? 'Пользователей пока нет' : 'Никого не найдено'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {dialog?.mode === 'create' && (
        <UserDialog
          suggestions={suggestions}
          onClose={() => setDialog(null)}
          onSaved={(created) => {
            setUsers((list) => [...(list ?? []), created].sort(byLogin));
            setDialog(null);
            report(`Пользователь ${created.login} заведён — передайте ему логин и пароль`);
          }}
        />
      )}
      {dialog?.mode === 'edit' && (
        <UserDialog
          user={dialog.user}
          self={dialog.user.id === me.id}
          suggestions={suggestions}
          onClose={() => setDialog(null)}
          onSaved={(updated, passwordChanged) => {
            replace(updated);
            setDialog(null);
            report(
              passwordChanged
                ? `Пароль пользователя ${updated.login} изменён, его сессии закрыты`
                : `Пользователь ${updated.login} сохранён`,
            );
          }}
        />
      )}
    </AdminLayout>
  );
}

function FlagBox(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <input
      type="checkbox"
      checked={props.checked}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      onChange={(event) => props.onChange(event.target.checked)}
      className="checkbox h-4 w-4 disabled:opacity-50"
    />
  );
}

interface UserDialogProps {
  /** Нет — заводим нового. */
  user?: AdminUser;
  /** Правка самого себя: права администратора и вход не снять. */
  self?: boolean;
  suggestions: Suggestions;
  onClose: () => void;
  onSaved: (user: AdminUser, passwordChanged: boolean) => void;
}

function UserDialog({ user, self = false, suggestions, onClose, onSaved }: UserDialogProps): React.JSX.Element {
  const creating = !user;
  const [login, setLogin] = useState(user?.login ?? '');
  const [password, setPassword] = useState('');
  const [fio, setFio] = useState(user?.fio ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [filial, setFilial] = useState(user?.filial ?? '');
  const [subdivision, setSubdivision] = useState(user?.subdivision ?? '');
  const [comment, setComment] = useState(user?.comment ?? '');
  const [canCoordinates, setCanCoordinates] = useState(user?.canCoordinates ?? false);
  const [isAdmin, setIsAdmin] = useState(user?.isAdmin ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = password.length >= MIN_PASSWORD_LENGTH || (!creating && password === '');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        const request: CreateUserRequest = {
          login,
          password,
          fio,
          email,
          organization,
          filial,
          subdivision,
          comment,
          canCoordinates,
          isAdmin,
        };
        onSaved(await api.admin.create(request), false);
      } else {
        // Отправляем только изменённое
        const patch: UpdateUserRequest = {};
        if (fio.trim() !== user.fio) patch.fio = fio;
        if (email.trim() !== user.email) patch.email = email;
        if (organization.trim() !== user.organization) patch.organization = organization;
        if (filial.trim() !== user.filial) patch.filial = filial;
        if (subdivision.trim() !== user.subdivision) patch.subdivision = subdivision;
        if (comment.trim() !== user.comment) patch.comment = comment;
        if (canCoordinates !== user.canCoordinates) patch.canCoordinates = canCoordinates;
        if (isAdmin !== user.isAdmin) patch.isAdmin = isAdmin;
        if (password) patch.password = password;
        onSaved(await api.admin.update(user.id, patch), Boolean(password));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const generate = (
    <button
      type="button"
      onClick={() => setPassword(generatePassword())}
      className="-mx-1.5 -my-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-sky-600 transition hover:bg-sky-50 hover:text-sky-700 dark:text-sky-400 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
    >
      Сгенерировать
    </button>
  );

  return (
    <Modal title={creating ? 'Новый пользователь' : `Пользователь ${user.login}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {creating && (
          <TextField
            label="Логин (латиница, цифры, . _ -)"
            value={login}
            onChange={setLogin}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            autoFocus
            required
          />
        )}
        {/* Пароль виден: администратор передаёт его пользователю. Свой — через меню, с текущим паролем. */}
        {self ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Свой пароль меняется в меню справа вверху: «Сменить пароль».
          </p>
        ) : (
          <TextField
            label={creating ? `Пароль (не короче ${MIN_PASSWORD_LENGTH} символов)` : 'Новый пароль (пусто — не менять)'}
            value={password}
            onChange={setPassword}
            autoComplete="off"
            spellCheck={false}
            action={generate}
            required={creating}
          />
        )}
        <TextField label="Ф.И.О." value={fio} onChange={setFio} maxLength={100} autoFocus={!creating} />
        <TextField
          label="Почта"
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={100}
          autoComplete="off"
          spellCheck={false}
        />
        <TextField
          label="Организация"
          value={organization}
          onChange={setOrganization}
          maxLength={255}
          suggestions={suggestions.organization}
        />
        <TextField label="Филиал" value={filial} onChange={setFilial} maxLength={255} suggestions={suggestions.filial} />
        <TextField
          label="Подразделение (АМЦ/АМСГ)"
          value={subdivision}
          onChange={setSubdivision}
          maxLength={255}
          suggestions={suggestions.subdivision}
        />
        <TextField label="Примечание" value={comment} onChange={setComment} maxLength={255} />
        <div className="space-y-2 pt-1">
          <CheckboxField
            label="Расчёт по координатам"
            checked={canCoordinates}
            onChange={setCanCoordinates}
            title="Без этого права доступен только выбор станции из списка"
          />
          <CheckboxField
            label="Администратор"
            checked={isAdmin}
            onChange={setIsAdmin}
            disabled={self}
            title={self ? 'С самого себя права администратора не снять' : 'Может управлять пользователями'}
          />
        </div>
        {!creating && password && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            После смены пароля пользователю придётся войти заново на всех устройствах.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Отмена
          </button>
          <button type="submit" disabled={busy || !passwordOk || (creating && login.length < 3)} className={primaryButtonClass}>
            {busy ? 'Сохранение…' : creating ? 'Завести' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
