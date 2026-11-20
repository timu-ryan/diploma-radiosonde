/**
 * Константы планшета (чертежа станции) и соответствие эшелонов изобарическим уровням.
 *
 * Планшеты в stations/*.xml нарисованы на холсте 536×536 с центром в точке станции.
 * Подпись «изображение 100км / 50км» в исходном продукте и положение утолщённого кольца
 * дают 10 делений по радиусу: Scale Value=10 → 100 км, Value=5 → 50 км.
 */
import type { ChartGeometry } from './types.js';

/** Размер холста планшета в пикселях (квадрат). */
export const CANVAS_SIZE = 536;

/** Центр планшета = точка выпуска радиозонда. */
export const CANVAS_CENTER = CANVAS_SIZE / 2;

/** Делений (колец) по радиусу планшета. */
export const RINGS = 10;

/** Номер утолщённого кольца. */
export const BOLD_RING = 5;

/** Радиус планшета в км для заданного масштаба (км на деление). */
export function radiusKm(scaleKm: number): number {
  return scaleKm * RINGS;
}

/** Пикселей на километр для заданного масштаба. */
export function pxPerKm(scaleKm: number): number {
  return CANVAS_CENTER / radiusKm(scaleKm);
}

/** Доступные масштабы планшетов (км на деление). */
export const SCALES = [10, 5] as const;
export type ScaleKm = (typeof SCALES)[number];

/**
 * Точка выпуска, заданная координатами, рисуется на планшете ближайшей станции,
 * если та не дальше этого, км; иначе — на пустом планшете с центром в самой точке.
 */
export const STATION_RADIUS_KM = 30;

/** Планшет без чертежа: только кольца и румбы. */
export function emptyChart(scaleKm: number): ChartGeometry {
  return {
    scaleKm,
    radiusKm: radiusKm(scaleKm),
    pxPerKm: pxPerKm(scaleKm),
    canvasSize: CANVAS_SIZE,
    center: { x: CANVAS_CENTER, y: CANVAS_CENTER },
    rings: RINGS,
    boldRing: BOLD_RING,
    polylines: [],
    airways: [],
    labels: [],
  };
}

/**
 * Соответствие эшелонов (FL) и изобарических уровней в гПа (mb) в GRIB2.
 */
export const FL_MB: Readonly<Record<number, number>> = {
  530: 100,
  480: 125,
  450: 150,
  410: 175,
  390: 200,
  360: 225,
  340: 250,
  320: 275,
  300: 300,
  270: 350,
  240: 400,
  210: 450,
  180: 500,
  140: 600,
  100: 700,
  80: 750,
  50: 850,
};

/** Обратное соответствие: гПа → эшелон. */
export const MB_FL: Readonly<Record<number, number>> = Object.fromEntries(
  Object.entries(FL_MB).map(([fl, mb]) => [mb, Number(fl)]),
);

/** Эшелон в метры: FL * 30. */
export function flToMeters(fl: number): number {
  return fl * 30;
}

/** Изобарический уровень (гПа) → эшелон, либо undefined для неизвестного уровня. */
export function mbToFl(mb: number): number | undefined {
  return MB_FL[mb];
}

/** Изобарический уровень (гПа) → высота в метрах. */
export function mbToMeters(mb: number): number | undefined {
  const fl = mbToFl(mb);
  return fl === undefined ? undefined : flToMeters(fl);
}

/** Все известные уровни в гПа, снизу вверх (по убыванию давления). */
export const KNOWN_MB_LEVELS: readonly number[] = Object.values(FL_MB).sort((a, b) => b - a);

/**
 * Высоты, по которым строится отчёт (м). Это фиксированная лестница из бланка
 * «Прогноз перемещения радиозонда», а не высоты изобарических уровней: ветер на
 * каждой из них берётся с ближайшего уровня.
 */
export const REPORT_HEIGHTS_M: readonly number[] = [1500, 3000, 5000, 7000, 9000, 12000, 16000];

/**
 * Насколько выше верхнего уровня прогноза разрешено брать высоту отчёта.
 * Верхний уровень 100 гПа — это FL530 = 15 900 м, а в бланке стоит 16 000 м.
 */
export const REPORT_HEIGHT_TOLERANCE_M = 600;

/** Скорость подъёма радиозонда по умолчанию, м/с (≈300 м/мин). */
export const DEFAULT_ASCENT_RATE_MS = 5;

/** Шаг интегрирования траектории по умолчанию, с. */
export const DEFAULT_STEP_SECONDS = 10;
