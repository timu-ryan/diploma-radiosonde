/** Геодезия и преобразования ветра. */

export const EARTH_RADIUS_KM = 6371.0088;

/** Метров в одном градусе широты (сферическое приближение). */
export const METERS_PER_DEG_LAT = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Приводит угол к диапазону [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Приводит долготу к диапазону [0, 360) — сетка GRIB задана от 0 до 358.75. */
export function normalizeLon(lon: number): number {
  return normalizeDeg(lon);
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Ортодромия между точками, км. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Истинный пеленг из точки a в точку b, градусы [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Смещение точки `to` относительно `from` к востоку и северу, км (как на планшете). */
export function eastNorthKm(from: LatLon, to: LatLon): { dxKm: number; dyKm: number } {
  const d = distanceKm(from, to);
  const az = toRad(bearingDeg(from, to));
  return { dxKm: d * Math.sin(az), dyKm: d * Math.cos(az) };
}

/** Ближайшая к `point` из `candidates`, если она не дальше `maxKm`. */
export function nearestWithin<T extends LatLon>(
  candidates: readonly T[],
  point: LatLon,
  maxKm: number,
): T | undefined {
  let best: T | undefined;
  let bestKm = maxKm;
  for (const candidate of candidates) {
    const d = distanceKm(point, candidate);
    if (d <= bestKm) {
      best = candidate;
      bestKm = d;
    }
  }
  return best;
}

/**
 * Смещение точки на dxM метров к востоку и dyM метров к северу.
 * Для расстояний в десятки километров плоское приближение достаточно.
 */
export function offsetByMeters(p: LatLon, dxM: number, dyM: number): LatLon {
  const lat = p.lat + dyM / METERS_PER_DEG_LAT;
  const cosLat = Math.max(Math.cos(toRad(p.lat)), 1e-6);
  const lon = p.lon + dxM / (METERS_PER_DEG_LAT * cosLat);
  return { lat, lon };
}

export interface WindVector {
  /** Восточная составляющая, м/с. */
  u: number;
  /** Северная составляющая, м/с. */
  v: number;
}

/**
 * Метеорологическое направление (откуда дует) и скорость → компоненты вектора переноса.
 */
export function windToVector(dirDeg: number, speedMs: number): WindVector {
  const r = toRad(dirDeg);
  return { u: -speedMs * Math.sin(r), v: -speedMs * Math.cos(r) };
}

/** Компоненты вектора переноса → направление (откуда дует) и скорость. */
export function vectorToWind(w: WindVector): { dirDeg: number; speedMs: number } {
  const speedMs = Math.hypot(w.u, w.v);
  if (speedMs < 1e-9) return { dirDeg: 0, speedMs: 0 };
  return { dirDeg: normalizeDeg(toDeg(Math.atan2(-w.u, -w.v))), speedMs };
}

/** Румб по азимуту: С, ССВ, СВ, … */
const COMPASS = [
  'С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ',
  'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ',
] as const;

export function compassPoint(deg: number): string {
  const i = Math.round(normalizeDeg(deg) / 22.5) % 16;
  return COMPASS[i] as string;
}
