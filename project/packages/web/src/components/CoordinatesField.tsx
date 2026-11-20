import { useEffect, useState } from 'react';
import type { LatLon, StationSummary } from '@rs/shared';
import { STATION_RADIUS_KM, bearingDeg, compassPoint, distanceKm, num } from '@rs/shared';

interface Props {
  value: LatLon;
  onChange: (point: LatLon) => void;
  /** Станция, на планшете которой рисуется точка (ближайшая в пределах STATION_RADIUS_KM). */
  chartStation: StationSummary | undefined;
}

type Axis = 'lat' | 'lon';

/** «64,62», «-12.5», «64,62 с.ш.», «40.5E» — полушарие буквой задаёт знак. */
const COORDINATE = /^([-+−]?\d{1,3}(?:\.\d+)?)\s*°?\s*(?:([сювзnsew])\.?\s*(?:[шд]\.?)?)?$/i;

function parseCoordinate(text: string, axis: Axis): number | undefined {
  const m = COORDINATE.exec(text.trim().replace(',', '.'));
  if (!m) return undefined;
  let value = Number((m[1] as string).replace('−', '-'));
  const hemisphere = m[2]?.toLowerCase();
  if (hemisphere) {
    // Буква должна подходить к полю: «в.д.» в широте — ошибка.
    if ('сюns'.includes(hemisphere) !== (axis === 'lat')) return undefined;
    if ('юзsw'.includes(hemisphere)) value = -Math.abs(value);
  }
  const limit = axis === 'lat' ? 90 : 180;
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

/** 64.62 → «64,62»: до четырёх знаков (≈10 м), без хвостовых нулей. */
const formatCoordinate = (value: number): string =>
  String(Math.round(value * 1e4) / 1e4).replace('.', ',');

const fieldLabel = 'mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400';

/**
 * Точка выпуска по координатам — вместо станции. Значение применяется по Enter
 * или при уходе из поля, чтобы не пересчитывать на каждой набранной цифре.
 */
export function CoordinatesField({ value, onChange, chartStation }: Props): React.JSX.Element {
  const commit = (axis: Axis, coordinate: number): void => {
    if (coordinate !== value[axis]) onChange({ ...value, [axis]: coordinate });
  };

  const distance = chartStation ? distanceKm(chartStation, value) : 0;
  const azimuth = chartStation ? bearingDeg(chartStation, value) : 0;

  return (
    <div id="origin-coordinates" className="mt-3">
      <div className="grid grid-cols-2 gap-2">
        <CoordinateInput
          axis="lat"
          label="Широта, °"
          placeholder="64,62"
          value={value.lat}
          onCommit={(lat) => commit('lat', lat)}
        />
        <CoordinateInput
          axis="lon"
          label="Долгота, °"
          placeholder="40,51"
          value={value.lon}
          onCommit={(lon) => commit('lon', lon)}
        />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {chartStation ? (
          <>
            Схема — на планшете ст. {chartStation.caption}
            {distance >= 0.05 &&
              `, точка в ${num(distance, 1)} км от неё (азимут ${Math.round(azimuth) % 360}°, ${compassPoint(azimuth)})`}
            .
          </>
        ) : (
          `В ${STATION_RADIUS_KM} км нет станции — схема без чертежа, трассы не проверяются.`
        )}{' '}
        Южная широта и западная долгота — со знаком минус.
      </p>
    </div>
  );
}

function CoordinateInput({
  axis,
  label,
  placeholder,
  value,
  onCommit,
}: {
  axis: Axis;
  label: string;
  placeholder: string;
  value: number;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseCoordinate(draft, axis) === undefined;
  const id = `origin-${axis}`;

  // Значение сменилось снаружи (выбрана станция) — недописанный текст больше не нужен.
  useEffect(() => setDraft(null), [value]);

  const apply = (): void => {
    if (draft === null) return;
    const parsed = parseCoordinate(draft, axis);
    if (parsed === undefined) return;
    onCommit(parsed);
    setDraft(null);
  };

  return (
    <div>
      <label className={fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={invalid}
        title={axis === 'lat' ? 'от −90 до 90' : 'от −180 до 180'}
        value={draft ?? formatCoordinate(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
          else if (event.key === 'Escape') setDraft(null);
        }}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm tabular-nums text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-2 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${
          invalid
            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/25'
            : 'border-slate-300 focus:border-sky-500 focus:ring-sky-500/25 dark:border-slate-700'
        }`}
      />
    </div>
  );
}
