import { useEffect, useRef, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@rs/shared';
import { api } from '../api.js';
import { pageUrl } from '../lib/paths.js';
import { useUser } from '../lib/user.js';
import { Notice, TextField, primaryButtonClass, secondaryButtonClass } from './Field.js';
import { Modal } from './Modal.js';

interface Props {
  /** Пункт «Пользователи» — для администратора вне админки. */
  showAdminLink?: boolean;
}

/** Кто вошёл, смена своего пароля, выход; администратору — ссылка на админку. */
export function UserMenu({ showAdminLink = true }: Props): React.JSX.Element {
  const { user, logout } = useUser();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const itemClass =
    'block w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className="truncate">{user.fio || user.login}</span>
        <span aria-hidden className="text-xs text-slate-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Вход выполнен: <span className="font-medium text-slate-700 dark:text-slate-200">{user.login}</span>
            {user.isAdmin && <span className="ml-1">· администратор</span>}
          </div>
          {showAdminLink && user.isAdmin && (
            <a role="menuitem" href={pageUrl('admin')} className={itemClass}>
              Пользователи
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
          >
            Сменить пароль
          </button>
          <button type="button" role="menuitem" className={itemClass} onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      )}

      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { setUser } = useUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = repeat !== '' && next !== repeat;

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (next !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      setUser(await api.auth.changePassword(current, next));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Смена пароля" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <Notice kind="success">Пароль изменён. На других устройствах нужно будет войти заново.</Notice>
          <button type="button" onClick={onClose} className={primaryButtonClass}>
            Готово
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          {error && <Notice kind="error">{error}</Notice>}
          <TextField
            label="Текущий пароль"
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            autoFocus
            required
          />
          <TextField
            label={`Новый пароль (не короче ${MIN_PASSWORD_LENGTH} символов)`}
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
          <TextField
            label="Новый пароль ещё раз"
            type="password"
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            required
          />
          {mismatch && <p className="text-xs text-rose-600 dark:text-rose-400">Пароли не совпадают</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={secondaryButtonClass}>
              Отмена
            </button>
            <button
              type="submit"
              disabled={busy || !current || next.length < MIN_PASSWORD_LENGTH || next !== repeat}
              className={primaryButtonClass}
            >
              {busy ? 'Сохранение…' : 'Сменить'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
