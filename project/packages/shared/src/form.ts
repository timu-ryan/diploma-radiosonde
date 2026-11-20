/**
 * Бланк «Прогноз смещения радиозонда» целиком в SVG: шапка, планшет с траекторией,
 * таблица и поля для подписей. Чёрно-белый — его печатают и подшивают.
 */
import { renderChartBody, type ChartPalette } from './chart.js';
import { formatDateUtc, formatLat, formatLon, formatTimeUtc, num, parseUtc } from './format.js';
import type {
  ChartGeometry,
  ReleaseOrigin,
  TrajectoryPathPoint,
  TrajectoryRow,
} from './types.js';

/** Размер листа: пропорция близка к A4. */
export const SHEET_WIDTH = 600;
export const SHEET_HEIGHT = 846;

/** Гарнитура бланка — как в исходном печатном документе. */
export const FORM_FONT = "'Times New Roman', 'Liberation Serif', Times, serif";

/** Чёрно-белая палитра планшета. */
export const MONO_PALETTE: ChartPalette = {
  surface: '#ffffff',
  ring: '#000000',
  ringBold: '#000000',
  ringOuter: '#000000',
  axis: '#000000',
  tick: '#000000',
  cardinal: '#000000',
  geometry: '#000000',
  airway: '#000000',
  airwayLabel: '#000000',
  label: '#000000',
  caption: '#000000',
  halo: '#ffffff',
  track: '#000000',
  marker: '#000000',
  markerText: '#ffffff',
  markerActive: '#000000',
  station: '#000000',
};

export interface FormStation {
  caption: string;
  amsg: string;
  lat: number;
  lon: number;
}

export interface RenderFormOptions {
  chart: ChartGeometry;
  rows: TrajectoryRow[];
  path: TrajectoryPathPoint[];
  /** Станция, чей планшет на бланке; нет — выпуск по координатам вдали от станций. */
  station?: FormStation;
  origin: ReleaseOrigin;
  /** Время выпуска радиозонда, ISO UTC. */
  releaseIso: string;
  /** Время прогона модели, ISO UTC. */
  runTimeIso: string;
  /** Подписи трасс; по умолчанию сохраняются исходные подписи XML. */
  showAirwayLabels?: boolean;
  /** Ширина картинки в пикселях (высота считается по пропорции листа). */
  width?: number;
}

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const n = (value: number): string => (Math.round(value * 100) / 100).toString();

const text = (
  x: number,
  y: number,
  value: string,
  attrs: { size?: number; bold?: boolean; anchor?: 'start' | 'middle' | 'end' } = {},
): string =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${attrs.size ?? 15}"` +
  `${attrs.bold ? ' font-weight="700"' : ''}` +
  `${attrs.anchor ? ` text-anchor="${attrs.anchor}"` : ''}>${esc(value)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number, width = 0.6): string =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#000000" stroke-width="${width}"/>`;

const box = (x: number, y: number, w: number, h: number, width = 0.8): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" stroke="#000000" stroke-width="${width}"/>`;

/** «11 09 2026» — как в бланке. */
function formSpacedDate(date: Date): string {
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(date.getUTCDate())} ${pad(date.getUTCMonth() + 1)} ${date.getUTCFullYear()}`;
}

/** Шапка бланка. */
function renderHeader(options: RenderFormOptions): string {
  const release = parseUtc(options.releaseIso);
  const runTime = parseUtc(options.runTimeIso);
  const { station, origin, chart } = options;
  // Точка по координатам: в строке станции — точка выпуска и станция, у которой она лежит.
  const place = origin.custom
    ? {
        label: 'Точка выпуска р/з',
        caption: station ? `у ст. ${station.caption}` : 'по координатам',
      }
    : { label: 'Аэрологическая станция', caption: station?.caption ?? '' };

  return ( 
    `<g>` +
    text(SHEET_WIDTH / 2, 44, 'ПРОГНОЗ СМЕЩЕНИЯ РАДИОЗОНДА', { size: 23, anchor: 'middle' }) +
    text(28, 68, 'Предоставлено АМЦ/АМСГ') +
    text(232, 68, station?.amsg || station?.caption || '', { bold: true }) +
    text(28, 88, place.label) +
    text(232, 88, place.caption, { bold: true }) +
    text(427, 88, formatLat(origin.lat)) +
    text(515, 88, formatLon(origin.lon)) +
    text(28, 108, 'Дата:') +
    text(72, 108, formSpacedDate(release)) +
    text(214, 108, 'Время выпуска р/з:') +
    text(350, 108, `${formatTimeUtc(release)} UTC`) +
    text(28, 127, 'Прогноз') +
    text(90, 127, 'Гидрометцентра России', { bold: true }) +
    text(28, 145, 'по данным наблюдений за') +
    text(222, 145, formatTimeUtc(runTime)) +
    text(273, 145, 'UTC') +
    text(312, 145, formatDateUtc(runTime)) +
    text(28, 163, `МАСШТАБ: 1 деление - ${chart.scaleKm} км`) +
    `</g>`
  );
}

const COLUMNS: { title: [string, string]; width: number }[] = [
  { title: ['№', ''], width: 24 },
  { title: ['Высота,', 'км'], width: 49 },
  { title: ['Время,', 'мин.'], width: 47 },
  { title: ['Азимут,', 'град'], width: 52 },
  { title: ['Удаление,', 'км'], width: 55 },
];

const TABLE_X = 10;
const TABLE_BOTTOM = 790;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 20;

/** Таблица смещения в левом нижнем углу листа. */
function renderTable(rows: TrajectoryRow[]): string {
  const width = COLUMNS.reduce((sum, c) => sum + c.width, 0);
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT;
  const top = TABLE_BOTTOM - height;
  const parts: string[] = [
    // Белая подложка: таблица ложится поверх планшета.
    `<rect x="${TABLE_X}" y="${n(top)}" width="${width}" height="${n(height)}" fill="#ffffff"/>`,
    box(TABLE_X, top, width, height, 0.4),
    line(TABLE_X, top + HEADER_HEIGHT, TABLE_X + width, top + HEADER_HEIGHT, 0.3),
  ];

  let x = TABLE_X;
  for (const [index, column] of COLUMNS.entries()) {
    if (index > 0) parts.push(line(x, top, x, top + height, 0.3));
    const center = x + column.width / 2;
    const [first, second] = column.title;
    parts.push(
      second
        ? text(center, top + 13, first, { size: 10, anchor: 'middle' }) +
            text(center, top + 25, second, { size: 10, anchor: 'middle' })
        : text(center, top + 19, first, { size: 10, anchor: 'middle' }),
    );
    x += column.width;
  }

  rows.forEach((row, index) => {
    const y = top + HEADER_HEIGHT + index * ROW_HEIGHT;
    if (index > 0) parts.push(line(TABLE_X, y, TABLE_X + width, y, 0.3));

    const values = [
      String(row.no),
      num(row.heightM / 1000, 1),
      String(Math.round(row.timeMin)),
      String(Math.round(row.azimuthDeg) % 360),
      String(Math.round(row.distanceKm)),
    ];

    let cellX = TABLE_X;
    for (const [column, value] of values.entries()) {
      const info = COLUMNS[column] as { width: number };
      parts.push(text(cellX + info.width / 2, y + 14, value, { size: 10, anchor: 'middle' }));
      cellX += info.width;
    }
  });

  return `<g>${parts.join('')}</g>`;
}

/** Поля «Время вручения» и «Деж. синоптик». */
function renderFooter(): string {
  return (
    `<g>` +
    text(257, 819, 'Время вручения', { size: 13, anchor: 'end' }) +
    box(264, 804, 104, 22, 0.5) +
    text(479, 819, 'Деж. синоптик', { size: 13, anchor: 'end' }) +
    box(486, 804, 104, 22, 0.5) +
    `</g>`
  );
}

/**
 * Полный лист бланка. Планшет рисуется тем же кодом, что и на экране,
 * только чёрно-белой палитрой и без экранных подписей.
 */
export function renderFormDocument(options: RenderFormOptions): string {
  const { chart } = options;

  // Планшет вписываем по ширине листа: центр (268,268) переносим в (300, 440).
  const scale = 0.95;
  const tx = SHEET_WIDTH / 2 - chart.center.x * scale;
  const ty = 440 - chart.center.y * scale;

  const plot = renderChartBody({
    chart,
    rows: options.rows,
    path: options.path,
    origin: options.origin,
    palette: MONO_PALETTE,
    variant: 'print',
    showAirwayLabels: options.showAirwayLabels,
  });

  const width = options.width ?? 900;
  const height = Math.round((width * SHEET_HEIGHT) / SHEET_WIDTH);
  const { station, origin } = options;
  const title = `Прогноз смещения радиозонда — ${
    station && !origin.custom
      ? station.caption
      : `точка ${formatLat(origin.lat)}, ${formatLon(origin.lon)}`
  }`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}" ` +
    `width="${width}" height="${height}" font-family="${FORM_FONT}" fill="#000000">` +
    `<title>${esc(title)}</title>` +
    `<rect x="0" y="0" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="#ffffff"/>` +
    renderHeader(options) +
    `<g transform="translate(${n(tx)} ${n(ty)}) scale(${scale})">${plot}</g>` +
    renderTable(options.rows) +
    renderFooter() +
    `</svg>`
  );
}
