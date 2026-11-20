import type { ForecastResponse } from '@rs/shared';
import {
  STATION_RADIUS_KM,
  bearingDeg,
  compassPoint,
  distanceKm,
  formatDateUtc,
  formatLat,
  formatLon,
  formatTimeUtc,
  num,
  parseUtc,
} from '@rs/shared';

interface Props {
  forecast: ForecastResponse;
  hovered: number | null;
  onHover: (index: number | null) => void;
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}

/** Время от выпуска в виде 11:46 UTC. */
function clock(releaseIso: string, minutes: number): string {
  return formatTimeUtc(new Date(parseUtc(releaseIso).getTime() + minutes * 60_000));
}

/** Шапка места выпуска: станция или точка по координатам и планшет, на котором она нарисована. */
function PlaceFields({ forecast }: { forecast: ForecastResponse }): React.JSX.Element {
  const { station, origin } = forecast;
  const coordinates = `${formatLat(origin.lat)}, ${formatLon(origin.lon)}`;

  if (station && !origin.custom) {
    return (
      <>
        <Field label="Станция" value={station.caption} />
        <Field label="Индекс ВМО" value={station.index} />
        <Field label="Координаты" value={coordinates} />
        <Field label="АМЦ/АМСГ" value={station.amsg || '—'} />
      </>
    );
  }

  const azimuth = station ? bearingDeg(station, origin) : 0;
  return (
    <>
      <Field label="Точка выпуска" value={coordinates} />
      <Field label="Планшет станции" value={station?.caption ?? `нет в ${STATION_RADIUS_KM} км`} />
      <Field
        label="От станции"
        value={
          station
            ? `${num(distanceKm(station, origin), 1)} км, ${compassPoint(azimuth)} (${Math.round(azimuth) % 360}°)`
            : '—'
        }
      />
      <Field label="АМЦ/АМСГ" value={station?.amsg || '—'} />
    </>
  );
}

export function ReportPanel({ forecast, hovered, onHover }: Props): React.JSX.Element {
  const release = parseUtc(forecast.release);
  const runTime = parseUtc(forecast.run.runTime);

  return (
    <div className="flex h-full flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <PlaceFields forecast={forecast} />
        <Field label="Дата выпуска" value={formatDateUtc(release)} />
        <Field label="Время выпуска" value={`${formatTimeUtc(release)} UTC`} />
        <Field label="Прогноз" value={`${formatTimeUtc(runTime)} UTC ${formatDateUtc(runTime)}`} />
        <Field
          label="Заблаговременность"
          value={`${forecast.usedSteps.map((s) => `+${s}`).join(', ')} ч`}
        />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase leading-tight tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
              <th className="py-2 pr-2 font-medium">№</th>
              <th className="py-2 pr-2 text-right font-medium">Высота, м</th>
              <th className="py-2 pr-2 text-right font-medium">Время, мин</th>
              <th className="py-2 pr-2 text-right font-medium">Азимут, град</th>
              <th className="py-2 pr-2 text-right font-medium">Удаление, км</th>
              <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">Смещение, км</th>
              <th className="hidden whitespace-nowrap py-2 text-right font-medium sm:table-cell">
                Ветер, °/м/с
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {forecast.rows.map((row, index) => (
              <tr
                key={row.no}
                onPointerEnter={() => onHover(index)}
                onPointerLeave={() => onHover(null)}
                className={`border-b border-slate-100 transition-colors dark:border-slate-800 ${
                  hovered === index
                    ? 'bg-slate-100 dark:bg-slate-800/60'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <td className="py-2 pr-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      hovered === index
                        ? 'bg-slate-500 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {row.no}
                  </span>
                </td>
                <td className="py-2 pr-2 text-right font-medium text-slate-900 dark:text-slate-100">
                  {row.heightM}
                </td>
                <td className="py-2 pr-2 text-right text-slate-700 dark:text-slate-300">
                  {Math.round(row.timeMin)}
                </td>
                <td className="py-2 pr-2 text-right text-slate-700 dark:text-slate-300">
                  {Math.round(row.azimuthDeg) % 360}
                  <span className="ml-1 text-[11px] text-slate-400">
                    {compassPoint(row.azimuthDeg)}
                  </span>
                </td>
                <td className="py-2 pr-2 text-right font-medium text-slate-900 dark:text-slate-100">
                  {num(row.distanceKm, 1)}
                </td>
                <td className="hidden py-2 pr-2 text-right text-slate-500 dark:text-slate-400 sm:table-cell">
                  {num(row.layerDistanceKm, 1)}
                </td>
                <td className="hidden whitespace-nowrap py-2 text-right text-slate-500 dark:text-slate-400 sm:table-cell">
                  {Math.round(row.windDirDeg)}°/{Math.round(row.windSpeedMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-1 text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Пересекаемые трассы
        </h3>
        {forecast.crossings.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {forecast.station
              ? 'Трассы не пересекаются'
              : 'Не проверялись: рядом нет планшета станции'}
          </p>
        ) : (
          <ul className="space-y-1 text-sm tabular-nums text-slate-700 dark:text-slate-300">
            {forecast.crossings.map((crossing) => {
              const single = crossing.toHeightM - crossing.fromHeightM < 50;
              return (
                <li
                  key={`${crossing.airway}-${crossing.fromTimeMin}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {crossing.airway}
                  </span>
                  <span>
                    {single
                      ? `${Math.round(crossing.fromHeightM)} м`
                      : `${Math.round(crossing.fromHeightM)} – ${Math.round(crossing.toHeightM)} м`}
                  </span>
                  <span className="text-slate-400">
                    {single
                      ? clock(forecast.release, crossing.fromTimeMin)
                      : `${clock(forecast.release, crossing.fromTimeMin)} – ${clock(forecast.release, crossing.toTimeMin)}`}{' '}
                    UTC
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {forecast.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {forecast.warnings.map((warning) => (
            <li key={warning}>— {warning}</li>
          ))}
        </ul>
      )}

      <p className="mt-auto text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        Скорость подъёма {num(forecast.ascentRateMs, 1)} м/с, полное время подъёма{' '}
        {Math.round(forecast.totalTimeMin)} мин. Ветер на каждой высоте берётся с ближайшего
        изобарического уровня прогона; по времени — срок, действующий в момент подъёма
        (±1,5 ч от заблаговременности).
      </p>
    </div>
  );
}
