import type { AeroAnalysis, AeroSounding } from '@rs/shared';
import { JET_MIN_SPEED_MS, TURBULENCE_RI, formatMeters, formatTemp, num } from '@rs/shared';

interface Props {
  aerology: AeroSounding;
  /** Индекс подсвеченного уровня в `aerology.levels`. */
  hovered: number | null;
  onHover: (index: number | null) => void;
}

function Item({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,9.5rem)_1fr] gap-x-3 py-1">
      <dt className="text-xs text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="text-sm tabular-nums text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  );
}

const range = (from: number, to: number): string =>
  `${formatMeters(from).replace(' м', '')} – ${formatMeters(to)}`;

const temp = (tempC: number): string => `${formatTemp(Math.round(tempC))} °C`;

const wind = (dirDeg: number, speedMs: number): string =>
  `${String(Math.round(dirDeg) % 360).padStart(3, '0')}° ${Math.round(speedMs)} м/с`;

function isothermsText(analysis: AeroAnalysis, tempC: number, lowestM: number): string {
  const found = analysis.isotherms.filter((i) => i.tempC === tempC);
  if (found.length === 0) return 'не пересекается';
  return found
    .map((i) => (i.belowData ? `ниже ${formatMeters(lowestM)}` : formatMeters(i.heightM)))
    .join(', ');
}

/** Итоги обработки диаграммы и таблица уровней. */
export function AeroPanel({ aerology, hovered, onHover }: Props): React.JSX.Element {
  const { analysis, levels } = aerology;
  const lowestM = levels[0]?.heightM ?? 0;
  const { icing, maxWind, jet } = analysis;

  return (
    <div className="flex h-full flex-col gap-4">
      <dl className="divide-y divide-slate-100 dark:divide-slate-800">
        <Item label="Тропопауза">
          {analysis.tropopauses.length === 0
            ? 'не найдена'
            : analysis.tropopauses
                .map((t) => `${formatMeters(t.heightM)} (${t.mb} гПа), ${temp(t.tempC)}`)
                .join('; ')}
        </Item>
        {[0, -10, -20].map((t) => (
          <Item key={t} label={`Изотерма ${formatTemp(t)} °C`}>
            {isothermsText(analysis, t, lowestM)}
          </Item>
        ))}
        <Item label="Обледенение в облаках">
          {icing
            ? `${icing.belowData ? `ниже ${formatMeters(icing.fromHeightM)}` : formatMeters(icing.fromHeightM)} – ${formatMeters(icing.toHeightM)}`
            : '—'}
          <span className="block text-[11px] text-slate-400">слой 0…−20 °C; облачности в прогнозе нет</span>
        </Item>
        <Item label="Максимальный ветер">
          {maxWind
            ? `${wind(maxWind.dirDeg, maxWind.speedMs)} на ${formatMeters(maxWind.heightM)} (${maxWind.mb} гПа)`
            : '—'}
        </Item>
        <Item label="Струйное течение">
          {jet ? range(jet.fromHeightM, jet.toHeightM) : `нет (ветер меньше ${JET_MIN_SPEED_MS} м/с)`}
        </Item>
        <Item label="Инверсии, изотермии">
          {analysis.stableLayers.length === 0
            ? 'нет'
            : analysis.stableLayers.map((l) => (
                <span key={l.fromHeightM} className="block">
                  {l.kind === 'inversion' ? 'инверсия' : 'изотермия'} {range(l.fromHeightM, l.toHeightM)},
                  ΔT {l.deltaT > 0 ? '+' : ''}
                  {num(l.deltaT, Number.isInteger(l.deltaT) ? 0 : 1)} °C
                </span>
              ))}
        </Item>
        <Item label={`Болтанка (Ri < ${TURBULENCE_RI})`}>
          {analysis.turbulence.length === 0
            ? 'нет'
            : analysis.turbulence.map((l) => (
                <span key={l.fromHeightM} className="block">
                  {range(l.fromHeightM, l.toHeightM)}, сдвиг {Math.round(l.shearMsPerKm)} м/с на км
                </span>
              ))}
        </Item>
        <Item label="VT = T850 − T500">
          {analysis.verticalTotals === undefined ? '—' : `${num(analysis.verticalTotals, 0)} °C`}
        </Item>
        <Item label="Средний ветер в слое">
          {analysis.meanWinds.map((w) => (
            <span key={w.heightM} className="block">
              0 – {formatMeters(w.heightM)}: {wind(w.dirDeg, w.speedMs)}
            </span>
          ))}
        </Item>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase leading-tight tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
              <th className="py-2 pr-2 text-right font-medium">P, гПа</th>
              <th className="py-2 pr-2 text-right font-medium">H, м</th>
              <th className="py-2 pr-2 text-right font-medium">T, °C</th>
              <th className="whitespace-nowrap py-2 pr-2 text-right font-medium">Ветер, °/м/с</th>
              <th className="py-2 text-right font-medium">Время, мин</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {levels
              .map((level, index) => ({ level, index }))
              .reverse()
              .map(({ level, index }) => (
                <tr
                  key={level.mb}
                  onPointerEnter={() => onHover(index)}
                  onPointerLeave={() => onHover(null)}
                  className={`border-b border-slate-100 transition-colors dark:border-slate-800 ${
                    hovered === index
                      ? 'bg-red-50 dark:bg-red-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <td className="py-1.5 pr-2 text-right font-medium text-slate-900 dark:text-slate-100">
                    {level.mb}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                    {level.heightM}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-900 dark:text-slate-100">
                    {formatTemp(Math.round(level.tempC))}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                    {String(Math.round(level.windDirDeg) % 360).padStart(3, '0')}/
                    {Math.round(level.windSpeedMs)}
                  </td>
                  <td className="py-1.5 text-right text-slate-500 dark:text-slate-400">
                    {Math.round(level.timeMin)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="mt-auto text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Значения на уровнях взяты там и тогда, где зонд проходит высоту уровня. Влажности в прогнозе
        нет, поэтому точка росы, уровень конденсации, кривая состояния, облачность и индексы гроз не
        строятся; нижний уровень прогноза — 850 гПа, ветер и температура ниже него неизвестны.
      </p>
    </div>
  );
}
