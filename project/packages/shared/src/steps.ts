/**
 * Периоды действия сроков прогноза.
 *
 * Срок действует ±1,5 ч вокруг своей заблаговременности: +6 ч — с +4,5 до +7,5 ч,
 * +9 ч — с +7,5 до +10,5 ч и т. д. Граница принадлежит следующему сроку. Если какого-то
 * срока нет, соседние делят промежуток пополам.
 */

const HOUR_MS = 3600_000;

/** Полуширина периода действия крайних сроков, ч. */
export const STEP_HALF_WINDOW_HOURS = 1.5;

export interface HoursWindow {
  /** Начало, ч от прогона (включительно). */
  from: number;
  /** Конец, ч от прогона (не включительно). */
  to: number;
}

const sortedSteps = (steps: readonly number[]): number[] => [...new Set(steps)].sort((a, b) => a - b);

/** Период действия срока `step` среди доступных `steps`. */
export function stepWindow(steps: readonly number[], step: number): HoursWindow {
  const sorted = sortedSteps(steps);
  const i = sorted.indexOf(step);
  const prev = i > 0 ? sorted[i - 1] : undefined;
  const next = i >= 0 ? sorted[i + 1] : undefined;
  return {
    from: prev === undefined ? step - STEP_HALF_WINDOW_HOURS : (prev + step) / 2,
    to: next === undefined ? step + STEP_HALF_WINDOW_HOURS : (step + next) / 2,
  };
}

/** Срок, действующий через `hours` ч после прогона (за пределами прогона — крайний). */
export function activeStep(steps: readonly number[], hours: number): number | undefined {
  const sorted = sortedSteps(steps);
  return sorted.find((step) => hours < stepWindow(sorted, step).to) ?? sorted.at(-1);
}

/** Период действия прогона целиком, ч от прогона. */
export function runWindow(steps: readonly number[]): HoursWindow | undefined {
  const sorted = sortedSteps(steps);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return undefined;
  return { from: stepWindow(sorted, first).from, to: stepWindow(sorted, last).to };
}

export interface StepPeriod {
  step: number;
  /** ISO UTC. */
  from: string;
  /** ISO UTC. */
  to: string;
}

/** Какие сроки действуют на отрезке [fromMs; toMs) и в какие его части. */
export function stepPeriods(
  runTimeMs: number,
  steps: readonly number[],
  fromMs: number,
  toMs: number,
): StepPeriod[] {
  const periods: StepPeriod[] = [];
  const sorted = sortedSteps(steps);
  sorted.forEach((step, index) => {
    const window = stepWindow(sorted, step);
    // Крайние сроки действуют и за пределами прогона — расчёт тогда берёт их.
    const start = Math.max(fromMs, index === 0 ? -Infinity : runTimeMs + window.from * HOUR_MS);
    const end = Math.min(
      toMs,
      index === sorted.length - 1 ? Infinity : runTimeMs + window.to * HOUR_MS,
    );
    if (start < end) {
      periods.push({ step, from: new Date(start).toISOString(), to: new Date(end).toISOString() });
    }
  });
  return periods;
}
