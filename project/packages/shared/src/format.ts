/** Форматирование для отчёта и интерфейса (русская локаль, UTC). */
import type { LatLon } from './geo.js';
import type { ForecastResponse } from './types.js';

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** ISO-строка → Date; бросает исключение при неразборчивом значении. */
export function parseUtc(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Некорректное время: ${iso}`);
  return d;
}

/** 11.09.2026 */
export function formatDateUtc(d: Date): string {
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

/** 11:30 */
export function formatTimeUtc(d: Date): string {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 11.09.2026 11:30 UTC */
export function formatDateTimeUtc(d: Date): string {
  return `${formatDateUtc(d)} ${formatTimeUtc(d)} UTC`;
}

/** Значение для <input type="datetime-local">, трактуемого как UTC. */
export function toDateTimeLocalValue(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

/** Значение из <input type="datetime-local"> → ISO UTC. */
export function fromDateTimeLocalValue(value: string): string {
  return new Date(`${value}:00Z`).toISOString();
}

/** Отметка времени для имён файлов: 20260807_1130. */
export function fileStamp(iso: string): string {
  const d = parseUtc(iso);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

/** Точка для имён файлов: 64.70N_40.51E. */
export function coordsStamp(point: LatLon): string {
  const lon = point.lon > 180 ? point.lon - 360 : point.lon;
  return (
    `${Math.abs(point.lat).toFixed(2)}${point.lat >= 0 ? 'N' : 'S'}` +
    `_${Math.abs(lon).toFixed(2)}${lon >= 0 ? 'E' : 'W'}`
  );
}

/** Место выпуска в именах файлов: код станции или координаты точки. */
export function placeStamp(forecast: Pick<ForecastResponse, 'station' | 'origin'>): string {
  const { station, origin } = forecast;
  return station && !origin.custom ? station.name : coordsStamp(origin);
}

export interface ReleasePlace {
  caption: string;
  /** Индекс ВМО; у точки по координатам пустой. */
  index: string;
  lat: number;
  lon: number;
}

/** Место выпуска для заголовков: станция или точка по координатам (у какой станции). */
export function releasePlace(forecast: Pick<ForecastResponse, 'station' | 'origin'>): ReleasePlace {
  const { station, origin } = forecast;
  if (station && !origin.custom) {
    return { caption: station.caption, index: station.index, lat: station.lat, lon: station.lon };
  }
  return {
    caption: station ? `Точка выпуска у ст. ${station.caption}` : 'Точка выпуска',
    index: '',
    lat: origin.lat,
    lon: origin.lon,
  };
}

/** Число с запятой в качестве десятичного разделителя. */
export function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Координата в виде «64,62 с.ш.» / «40,51 в.д.». */
export function formatLat(lat: number): string {
  return `${num(Math.abs(lat), 2)} ${lat >= 0 ? 'с.ш.' : 'ю.ш.'}`;
}

export function formatLon(lon: number): string {
  const l = lon > 180 ? lon - 360 : lon;
  return `${num(Math.abs(l), 2)} ${l >= 0 ? 'в.д.' : 'з.д.'}`;
}

/** Температура со знаком: −41, +8, 0. */
export function formatTemp(tempC: number): string {
  if (tempC === 0) return '0';
  return `${tempC > 0 ? '+' : '−'}${Math.abs(tempC)}`;
}

/** «1 610 м» — высота до 10 м с разделителем тысяч: точнее данные прогноза не позволяют. */
export function formatMeters(heightM: number): string {
  const rounded = Math.round(heightM / 10) * 10;
  return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} м`;
}
