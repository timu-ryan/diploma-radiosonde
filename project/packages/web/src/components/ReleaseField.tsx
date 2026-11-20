import { useState } from 'react';
import type { ForecastResponse, RunInfo } from '@rs/shared';
import {
  activeStep,
  formatDateUtc,
  formatTimeUtc,
  parseUtc,
  stepWindow,
} from '@rs/shared';

interface Props {
  /** Время выпуска, ISO UTC. */
  value: string;
  onChange: (iso: string) => void;
  runs: RunInfo[];
  /** Последний расчёт: из него видно, сменился ли срок прогноза в полёте. */
  forecast: ForecastResponse | null;
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const STANDARD_TIMES = [
  { label: '11:30', minutes: 11 * 60 + 30 },
  { label: '23:30', minutes: 23 * 60 + 30 },
];

const ms = (iso: string): number => parseUtc(iso).getTime();

/** Самый свежий прогон, действующий в момент `t` (то же правило, что на сервере). */
export function runAt(runs: RunInfo[], t: number): RunInfo | undefined {
  return [...runs]
    .sort((a, b) => ms(a.runTime) - ms(b.runTime))
    .reverse()
    .find((run) => t >= ms(run.validFrom) && t < ms(run.validTo));
}

/** Сутки (полночь UTC, мс), на которые приходится хоть какая-то часть данных. */
export function coverageDays(runs: RunInfo[]): number[] {
  const days = new Set<number>();
  for (const run of runs) {
    const end = ms(run.validTo);
    for (let day = Math.floor(ms(run.validFrom) / DAY_MS) * DAY_MS; day < end; day += DAY_MS) {
      days.add(day);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/** Время выпуска по умолчанию: текущее (с точностью до 10 мин), если на него есть прогноз. */
export function defaultRelease(runs: RunInfo[], now = Date.now()): string {
  const rounded = Math.floor(now / 600_000) * 600_000;
  if (runs.length === 0 || runAt(runs, rounded)) return new Date(rounded).toISOString();
  const from = Math.min(...runs.map((r) => ms(r.validFrom)));
  if (rounded < from) return new Date(from).toISOString();
  const latest = runs.reduce((a, b) => (ms(a.runTime) > ms(b.runTime) ? a : b));
  return latest.validFrom;
}

const dayOf = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;

/** 10:30, а если сутки другие — 10:30 17.09. */
function clock(t: number, day: number): string {
  const d = new Date(t);
  const time = formatTimeUtc(d);
  return dayOf(t) === day ? time : `${time} ${formatDateUtc(d).slice(0, 5)}`;
}

const fieldLabel = 'mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400';

export function ReleaseField({ value, onChange, runs, forecast }: Props): React.JSX.Element {
  const release = value ? ms(value) : Date.now();
  const day = dayOf(release);
  const days = coverageDays(runs);
  if (value && !days.includes(day)) days.push(day);
  days.sort((a, b) => a - b);

  const time = formatTimeUtc(new Date(release));
  const setDay = (next: number): void =>
    onChange(new Date(next + (release - day)).toISOString());
  const setTime = (minutes: number): void => {
    // Стрелками можно перейти через полночь — дата сдвигается вместе со временем.
    onChange(new Date(day + minutes * 60_000).toISOString());
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <span className={fieldLabel}>Дата выпуска, UTC</span>
          <div
            role="radiogroup"
            aria-label="Дата выпуска"
            className="inline-flex flex-wrap rounded-lg border border-slate-300 p-0.5 dark:border-slate-700"
          >
            {days.length === 0 && (
              <span className="px-3 py-1 text-sm text-slate-400">нет данных</span>
            )}
            {days.map((d) => {
              const date = new Date(d);
              const selected = d === day;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDay(d)}
                  className={`rounded-md px-2.5 py-1 text-sm tabular-nums transition ${
                    selected
                      ? 'bg-sky-500 font-medium text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className={selected ? 'text-sky-100' : 'text-slate-400'}>
                    {WEEKDAYS[date.getUTCDay()]}
                  </span>{' '}
                  {formatDateUtc(date).slice(0, 5)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0">
          <label className={fieldLabel} htmlFor="release-time">
            Время, UTC
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <TimeInput value={time} onChange={setTime} />
            {STANDARD_TIMES.map(({ label, minutes }) => (
              <button
                key={label}
                type="button"
                onClick={() => setTime(minutes)}
                aria-pressed={time === label}
                title={`Установить ${label} UTC без изменения даты`}
                className={`rounded-lg px-2 py-1.5 text-sm tabular-nums transition ${
                  time === label
                    ? 'bg-sky-50 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300'
                    : 'text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange(new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString())}
              className="rounded-lg px-2 py-1.5 text-sm text-sky-600 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
            >
              Сейчас
            </button>
          </div>
        </div>
      </div>

      <SourceCallout release={release} runs={runs} forecast={forecast} value={value} />
    </div>
  );
}

/** «9:5», «0905», «09:05» → минуты от полуночи; undefined, если время неразборчиво. */
function parseClock(text: string): number | undefined {
  const m = /^\s*(\d{1,2})(?::?(\d{2}))?\s*$/.exec(text) ?? /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(text);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? h * 60 + min : undefined;
}

/**
 * Время в 24-часовом формате. Нативный <input type="time"> в английской локали
 * показывает AM/PM — для UTC-сроков это путает, поэтому поле текстовое.
 * Стрелки ↑/↓ — ±10 мин, с Shift — ±1 ч.
 */
function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (minutes: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseClock(draft) === undefined;
  const current = parseClock(value) ?? 0;

  return (
    <input
      id="release-time"
      inputMode="numeric"
      autoComplete="off"
      placeholder="чч:мм"
      maxLength={5}
      aria-invalid={invalid}
      value={draft ?? value}
      onChange={(event) => {
        setDraft(event.target.value);
        const minutes = parseClock(event.target.value);
        if (minutes !== undefined && /^\d{1,2}:\d{2}$/.test(event.target.value.trim())) {
          onChange(minutes);
        }
      }}
      onBlur={() => {
        const minutes = draft === null ? undefined : parseClock(draft);
        if (minutes !== undefined) onChange(minutes);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const delta = (event.shiftKey ? 60 : 10) * (event.key === 'ArrowUp' ? 1 : -1);
          const base = draft === null ? current : (parseClock(draft) ?? current);
          setDraft(null);
          onChange(base + delta);
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
      className={`w-[4.75rem] rounded-lg border bg-white px-3 py-1.5 text-center text-sm tabular-nums text-slate-900 shadow-sm outline-none transition focus:ring-2 dark:bg-slate-900 dark:text-slate-100 ${
        invalid
          ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25'
          : 'border-slate-300 focus:border-sky-500 focus:ring-sky-500/25 dark:border-slate-700'
      }`}
    />
  );
}

/** Выноска: по какому прогону и сроку считается выбранное время. */
function SourceCallout({
  release,
  runs,
  forecast,
  value,
}: {
  release: number;
  runs: RunInfo[];
  forecast: ForecastResponse | null;
  value: string;
}): React.JSX.Element {
  const day = dayOf(release);
  const run = runAt(runs, release);

  let tone: 'info' | 'warn' = 'info';
  let body: React.ReactNode;

  if (runs.length === 0) {
    tone = 'warn';
    body = 'Прогноз ещё не загружен с сервера.';
  } else if (!run) {
    tone = 'warn';
    const from = Math.min(...runs.map((r) => ms(r.validFrom)));
    const to = Math.max(...runs.map((r) => ms(r.validTo)));
    body = (
      <>
        На это время прогноза нет. Данные есть с{' '}
        <b className="font-semibold">{formatDateUtc(new Date(from)).slice(0, 5)} {formatTimeUtc(new Date(from))}</b>{' '}
        до <b className="font-semibold">{formatDateUtc(new Date(to)).slice(0, 5)} {formatTimeUtc(new Date(to))}</b>{' '}
        UTC.
      </>
    );
  } else {
    const runTime = ms(run.runTime);
    const step = activeStep(run.steps, (release - runTime) / HOUR_MS) as number;
    const window = stepWindow(run.steps, step);
    const newest = runs.reduce((a, b) => (ms(a.runTime) > ms(b.runTime) ? a : b));
    // Смена срока в полёте видна только после расчёта именно этого времени.
    const periods =
      forecast && forecast.release === value && forecast.run.id === run.id
        ? forecast.stepPeriods
        : [];
    const switches = periods.slice(1);

    body = (
      <>
        <div>
          Прогноз от{' '}
          <b className="font-semibold">
            {formatDateUtc(new Date(runTime))} {formatTimeUtc(new Date(runTime))} UTC
          </b>
          , срок <b className="font-semibold">+{step} ч</b>
          <span className="text-slate-500 dark:text-slate-400">
            {' '}
            · действует {clock(runTime + window.from * HOUR_MS, day)}–
            {clock(runTime + window.to * HOUR_MS, day)}
          </span>
        </div>
        {switches.map((period) => (
          <div key={period.step} className="text-slate-500 dark:text-slate-400">
            с {clock(ms(period.from), day)} (≈{Math.round((ms(period.from) - release) / 60_000)}-я мин
            подъёма) — срок <b className="font-semibold text-slate-700 dark:text-slate-200">+{period.step} ч</b>
          </div>
        ))}
        {newest.id !== run.id && (
          <div className="text-slate-500 dark:text-slate-400">
            Свежий прогон {formatTimeUtc(parseUtc(newest.runTime))} UTC действует с{' '}
            {clock(ms(newest.validFrom), day)}.
          </div>
        )}
      </>
    );
  }

  const palette =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
      : 'border-sky-200 bg-sky-50 text-slate-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-slate-200';

  return (
    <div
      role="status"
      className={`relative mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed tabular-nums ${palette}`}
    >
      <span
        aria-hidden
        className={`absolute -top-[5px] left-6 h-2.5 w-2.5 rotate-45 border-l border-t ${palette}`}
      />
      {body}
    </div>
  );
}
