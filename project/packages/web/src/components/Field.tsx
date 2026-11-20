import { useId } from 'react';

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500';

export const primaryButtonClass =
  'rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-50';

export const secondaryButtonClass =
  'rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Кнопка справа от подписи. */
  action?: React.ReactNode;
  /** Варианты, которые браузер предложит при вводе. */
  suggestions?: readonly string[];
}

export function TextField({ label, value, onChange, action, suggestions, ...input }: TextFieldProps): React.JSX.Element {
  const id = useId();
  const listId = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-xs font-medium text-slate-500 dark:text-slate-400">
          {label}
        </label>
        {action}
      </div>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        list={suggestions ? listId : undefined}
        {...input}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </div>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
}

export function CheckboxField({ label, checked, onChange, disabled, title }: CheckboxFieldProps): React.JSX.Element {
  return (
    <label
      title={title}
      className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 has-[:disabled]:cursor-default has-[:disabled]:opacity-60 dark:text-slate-300"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="checkbox h-4 w-4"
      />
      {label}
    </label>
  );
}

/** Сообщение об ошибке или успехе над формой. */
export function Notice({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }): React.JSX.Element {
  const tone = {
    error: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
    info: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${tone}`}>
      {children}
    </div>
  );
}
