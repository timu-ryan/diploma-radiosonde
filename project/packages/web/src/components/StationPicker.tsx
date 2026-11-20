import { useEffect, useMemo, useRef, useState } from 'react';
import type { StationSummary } from '@rs/shared';

interface Props {
  stations: StationSummary[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  /** Кнопка справа от подписи поля. */
  action?: React.ReactNode;
}

const normalize = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim();

export function StationPicker({
  stations,
  value,
  onChange,
  disabled,
  action,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = stations.find((s) => s.name === value);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return stations;
    return stations.filter((s) =>
      normalize(`${s.caption} ${s.name} ${s.index} ${s.amsg}`).includes(q),
    );
  }, [stations, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (station: StationSummary): void => {
    onChange(station.name);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => {
        const next = event.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(filtered.length - 1, next));
      });
      return;
    }
    if (event.key === 'Enter' && open) {
      const station = filtered[active];
      if (station) {
        event.preventDefault();
        pick(station);
      }
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label
          className="block text-xs font-medium text-slate-500 dark:text-slate-400"
          htmlFor="station-input"
        >
          Аэрологическая станция
        </label>
        {action}
      </div>
      <input
        id="station-input"
        role="combobox"
        aria-expanded={open}
        aria-controls="station-list"
        autoComplete="off"
        disabled={disabled}
        value={open ? query : (selected?.caption ?? '')}
        placeholder={stations.length ? 'Название, код или индекс ВМО' : 'Загрузка…'}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActive(Math.max(0, filtered.findIndex((s) => s.name === value)));
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
      />

      {open && (
        <ul
          id="station-list"
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Ничего не найдено</li>
          )}
          {filtered.map((station, index) => (
            <li key={station.name}>
              <button
                type="button"
                role="option"
                aria-selected={station.name === value}
                data-active={index === active}
                onPointerEnter={() => setActive(index)}
                onClick={() => pick(station)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition ${
                  index === active
                    ? 'bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-sky-100'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                <span className={station.name === value ? 'font-semibold' : ''}>
                  {station.caption}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500">
                  {station.index} · {station.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
