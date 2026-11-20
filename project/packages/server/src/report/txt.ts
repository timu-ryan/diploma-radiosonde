import {
  fileStamp,
  formatLat,
  formatLon,
  formatTimeUtc,
  parseUtc,
  placeStamp,
  releasePlace,
  type AirwayCrossing,
  type ForecastResponse,
} from '@rs/shared';

const pad = (value: string | number, width: number, filler = ' '): string =>
  String(value).padStart(width, filler);

const padEnd = (value: string, width: number): string => value.padEnd(width);

/** Время от выпуска в виде 11:30:00 UTC. */
function clock(releaseIso: string, minutes: number): string {
  const d = new Date(parseUtc(releaseIso).getTime() + Math.round(minutes * 60) * 1000);
  return `${formatTimeUtc(d)}:${pad(d.getUTCSeconds(), 2, '0')}`;
}

function crossingLine(crossing: AirwayCrossing, releaseIso: string): string {
  // Конец рассчитанного пути внутри трассы не означает выход из неё.
  const end = (value: number): string => crossing.exited ? String(Math.round(value)) : 'XXX';
  const endAzimuth = crossing.exited ? String(Math.round(crossing.toAzimuthDeg) % 360) : 'XXX';
  const endTime = crossing.exited ? clock(releaseIso, crossing.toTimeMin) : 'XXX';
  return (
    ` Радиозонд будет пересекать трассу ${crossing.airway}` +
    ` в аз. ${Math.round(crossing.fromAzimuthDeg) % 360} - ${endAzimuth}°` +
    ` на уд. ${Math.round(crossing.fromDistanceKm)} - ${end(crossing.toDistanceKm)} км` +
    ` в слое ${Math.round(crossing.fromHeightM)} - ${end(crossing.toHeightM)} м` +
    ` в ${clock(releaseIso, crossing.fromTimeMin)} - ${endTime} UTC`
  );
}

/**
 * Текстовый отчёт по бланку «Прогноз перемещения радиозонда»:
 * по строке на каждую высоту, включая смещение в слое; пересечения — в полярных координатах.
 */
export function renderTxtReport(forecast: ForecastResponse): string {
  const release = parseUtc(forecast.release);
  const place = releasePlace(forecast);

  const lines: string[] = [];
  lines.push('        ПРОГНОЗ ПЕРЕМЕЩЕНИЯ РАДИОЗОНДА');
  lines.push(
    ` на ${formatTimeUtc(release)} UTC  " ${pad(release.getUTCDate(), 2, '0')} " ` +
      `${pad(release.getUTCMonth() + 1, 2, '0')} ${release.getUTCFullYear()}`,
  );
  // Для выпуска по координатам сохраняем точку, к которой относится прогноз.
  const suffix = forecast.origin.custom
    ? `   ${formatLat(place.lat)} ${formatLon(place.lon)}`
    : '';
  lines.push(`            ${place.caption}${suffix}`);

  for (const row of forecast.rows) {
    lines.push(
      ` Высота ${padEnd(String(row.heightM), 5)}` +
        `  Ветер  ${pad(Math.round(row.windDirDeg) % 360, 3, '0')}-${pad(Math.round(row.windSpeedMs), 2, '0')}` +
        ` Время подъёма(мин) ${padEnd(String(Math.round(row.layerTimeMin)), 2)}` +
        `  Азимут(°) ${pad(Math.round(row.azimuthDeg) % 360, 3, '0')}` +
        ` Удаление(км) ${pad(Math.round(row.distanceKm), 3, '0')}` +
        `  Смещение(км) ${Math.round(row.layerDistanceKm)}`,
    );
  }

  lines.push('');
  lines.push(' Пересекаемые трассы, высоты, время:');
  for (const crossing of forecast.crossings) lines.push(crossingLine(crossing, forecast.release));
  if (forecast.crossings.length === 0) {
    lines.push(forecast.station
      ? ' Пересечений трасс на рассчитанном участке не найдено.'
      : ' Пересечение трасс не проверялось: рядом нет планшета станции.');
  }

  if (forecast.warnings.length > 0) {
    lines.push('');
    lines.push(' Примечания:');
    for (const warning of forecast.warnings) lines.push(`  — ${warning}`);
  }

  lines.push('');
  lines.push(' Дежурный синоптик:  _________________________  UTC');
  lines.push('');
  lines.push('');
  lines.push('');
  lines.push(' РПА            ____________________________ ч. ________ мин. UTC');
  lines.push('');
  return lines.join('\r\n');
}

/** Имя файла отчёта: radiosonde_ARCHNGL_20260807_1130.txt, radiosonde_64.70N_40.51E_20260807_1130.txt */
export function reportFileName(forecast: ForecastResponse): string {
  return `radiosonde_${placeStamp(forecast)}_${fileStamp(forecast.release)}.txt`;
}
