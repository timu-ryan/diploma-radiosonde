import { describe, expect, it } from 'vitest';
import { activeStep, runWindow, stepPeriods, stepWindow } from '../src/steps.js';

const STEPS = [6, 9, 12, 15];
const RUN = Date.UTC(2026, 8, 16, 6);
const at = (hours: number): number => RUN + hours * 3600_000;

describe('периоды действия сроков', () => {
  it('срок действует ±1,5 ч, граница — у следующего срока', () => {
    expect(stepWindow(STEPS, 6)).toEqual({ from: 4.5, to: 7.5 });
    expect(stepWindow(STEPS, 9)).toEqual({ from: 7.5, to: 10.5 });
    expect(stepWindow(STEPS, 15)).toEqual({ from: 13.5, to: 16.5 });

    expect(activeStep(STEPS, 4.5)).toBe(6);
    expect(activeStep(STEPS, 7.49)).toBe(6);
    expect(activeStep(STEPS, 7.5)).toBe(9);
    expect(activeStep(STEPS, 10.5)).toBe(12);
    expect(activeStep(STEPS, 0)).toBe(6);
    expect(activeStep(STEPS, 99)).toBe(15);
    expect(activeStep([], 6)).toBeUndefined();
  });

  it('при пропуске срока соседние делят промежуток пополам', () => {
    expect(stepWindow([6, 12], 6)).toEqual({ from: 4.5, to: 9 });
    expect(activeStep([6, 12], 8.9)).toBe(6);
    expect(activeStep([6, 12], 9)).toBe(12);
  });

  it('прогон действует от первого срока − 1,5 ч до последнего + 1,5 ч', () => {
    expect(runWindow([6, 9, 12])).toEqual({ from: 4.5, to: 13.5 });
    expect(runWindow([])).toBeUndefined();
  });

  it('делит подъём на части по срокам', () => {
    expect(stepPeriods(RUN, STEPS, at(7), at(7.25))).toEqual([
      { step: 6, from: new Date(at(7)).toISOString(), to: new Date(at(7.25)).toISOString() },
    ]);
    expect(stepPeriods(RUN, STEPS, at(7), at(8)).map((p) => [p.step, p.to])).toEqual([
      [6, new Date(at(7.5)).toISOString()],
      [9, new Date(at(8)).toISOString()],
    ]);
    // Подъём, заканчивающийся ровно на границе, следующий срок не задевает
    expect(stepPeriods(RUN, STEPS, at(7), at(7.5)).map((p) => p.step)).toEqual([6]);
    // За пределами прогона действуют крайние сроки
    expect(stepPeriods(RUN, STEPS, at(16), at(17)).map((p) => p.step)).toEqual([15]);
  });
});
