/**
 * Отрисовка планшета в SVG.
 *
 * Один и тот же код используется клиентом (интерактивная схема) и сервером
 * (`GET /api/chart.svg`), поэтому здесь нет ни DOM, ни React — только строки.
 */
import { CANVAS_CENTER } from './levels.js';
import { compassPoint } from './geo.js';
import type { ChartAirway, ChartGeometry, TrajectoryPathPoint, TrajectoryRow } from './types.js';

/** Поле вокруг планшета под румбы и засечки. */
export const CHART_PAD = 46;
/** Полоса снизу под подпись схемы. */
export const CHART_CAPTION = 30;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function baseViewBox(canvasSize: number): ViewBox {
  return {
    x: -CHART_PAD,
    y: -CHART_PAD,
    w: canvasSize + CHART_PAD * 2,
    h: canvasSize + CHART_PAD * 2 + CHART_CAPTION,
  };
}

export const viewBoxToString = (v: ViewBox): string => `${v.x} ${v.y} ${v.w} ${v.h}`;

/** Смещение в км → координаты холста планшета. */
export function kmToCanvas(
  chart: Pick<ChartGeometry, 'center' | 'pxPerKm'>,
  dxKm: number,
  dyKm: number,
): { x: number; y: number } {
  return {
    x: chart.center.x + dxKm * chart.pxPerKm,
    y: chart.center.y - dyKm * chart.pxPerKm,
  };
}

/** Координаты холста → смещение в км относительно станции. */
export function canvasToKm(
  chart: Pick<ChartGeometry, 'center' | 'pxPerKm'>,
  x: number,
  y: number,
): { dxKm: number; dyKm: number } {
  return {
    dxKm: (x - chart.center.x) / chart.pxPerKm,
    dyKm: (chart.center.y - y) / chart.pxPerKm,
  };
}

export interface AirwayLabel {
  caption: string;
  x: number;
  y: number;
  angleDeg: number;
}

const segmentLength = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(b.x - a.x, b.y - a.y);

function airwayLength(airway: ChartAirway): number {
  let total = 0;
  for (let i = 1; i < airway.points.length; i += 1) {
    total += segmentLength(airway.points[i - 1]!, airway.points[i]!);
  }
  return total;
}

/** Базовое название трассы: «Л93-1» и «Л93-2» — участки одной трассы Л93. */
export const airwayBaseName = (caption: string): string => caption.replace(/-\d*$/, '').trim();

/**
 * Подписи трасс: в XML трасса разбита на куски, поэтому группируем по базовому
 * названию и подписываем один раз — на середине самого длинного куска.
 */
export function airwayLabels(airways: ChartAirway[]): AirwayLabel[] {
  const groups = new Map<string, ChartAirway>();

  for (const airway of airways) {
    const caption = airwayBaseName(airway.caption);
    if (!caption) continue;
    const current = groups.get(caption);
    if (!current || airwayLength(airway) > airwayLength(current)) groups.set(caption, airway);
  }

  return [...groups.entries()].map(([caption, airway]) => {
    // Середина самого длинного сегмента — там меньше шансов налезть на изгиб.
    let best = { a: airway.points[0]!, b: airway.points[1] ?? airway.points[0]!, len: -1 };
    for (let i = 1; i < airway.points.length; i += 1) {
      const a = airway.points[i - 1]!;
      const b = airway.points[i]!;
      const len = segmentLength(a, b);
      if (len > best.len) best = { a, b, len };
    }

    let angleDeg = (Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x) * 180) / Math.PI;
    // Подпись всегда читается слева направо.
    if (angleDeg > 90) angleDeg -= 180;
    if (angleDeg < -90) angleDeg += 180;

    return { caption, x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, angleDeg };
  });
}

export interface ChartPalette {
  surface: string;
  ring: string;
  ringBold: string;
  ringOuter: string;
  axis: string;
  tick: string;
  cardinal: string;
  geometry: string;
  airway: string;
  airwayLabel: string;
  label: string;
  caption: string;
  halo: string;
  track: string;
  marker: string;
  markerText: string;
  markerActive: string;
  station: string;
}

export const chartPalette = (dark: boolean): ChartPalette =>
  dark
    ? {
        surface: '#0f172a',
        ring: '#475569',
        ringBold: '#64748b',
        ringOuter: '#64748b',
        axis: '#334155',
        tick: '#64748b',
        cardinal: '#cbd5e1',
        geometry: '#5b6f86',
        airway: '#7f9cb8',
        airwayLabel: '#94a3b8',
        label: '#cbd5e1',
        caption: '#94a3b8',
        halo: '#0f172a',
        track: '#94a3b8',
        marker: '#94a3b8',
        markerText: '#0f172a',
        markerActive: '#cbd5e1',
        station: '#e2e8f0',
      }
    : {
        surface: '#ffffff',
        ring: '#a8b6c8',
        ringBold: '#7b8fa7',
        ringOuter: '#7b8fa7',
        axis: '#d5dde6',
        tick: '#94a3b8',
        cardinal: '#334155',
        geometry: '#93a3b6',
        airway: '#5b7391',
        airwayLabel: '#64748b',
        label: '#334155',
        caption: '#64748b',
        halo: '#ffffff',
        track: '#64748b',
        marker: '#64748b',
        markerText: '#ffffff',
        markerActive: '#475569',
        station: '#0f172a',
      };

export const CHART_FONT = "ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif";

export interface RenderChartOptions {
  chart: ChartGeometry;
  rows?: TrajectoryRow[];
  path?: TrajectoryPathPoint[];
  /**
   * Смещение точки выпуска от центра планшета, км: путь и высоты отчёта отсчитаны
   * от точки выпуска и рисуются от неё. Не задано — выпуск из центра.
   */
  origin?: { dxKm: number; dyKm: number };
  palette: ChartPalette;
  /** Печатное оформление: тонкая сетка, жирные оси и засечки внутрь окружности. */
  variant?: 'screen' | 'print';
  /** Подпись в левом нижнем углу схемы. */
  captionLeft?: string;
  /** Названия трасс из XML и Airway. По умолчанию на печати — только подписи XML. */
  showAirwayLabels?: boolean;
  /** Числовые азимуты по краю планшета (на бумажном бланке их нет). */
  showAzimuthNumbers?: boolean;
  /** Подписи колец в километрах по вертикальной оси. */
  showRingLabels?: boolean;
}

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const n = (value: number): string => (Math.round(value * 100) / 100).toString();

/** Внутренняя разметка схемы без обёртки <svg>. */
export function renderChartBody(options: RenderChartOptions): string {
  const { chart, palette } = options;
  const rows = options.rows ?? [];
  const path = options.path ?? [];
  const base = baseViewBox(chart.canvasSize);
  const cx = chart.center.x;
  const cy = chart.center.y;
  const outer = CANVAS_CENTER;
  const ringStep = outer / chart.rings;
  const print = options.variant === 'print';
  const majorWidth = print ? 2.4 : 2;
  // На экране толщина колец и основных осей сохраняется при изменении размера и зума.
  const vectorEffect = print ? '' : ' vector-effect="non-scaling-stroke"';
  const parts: string[] = [];

  // На бланке фон уже задан листом: подложка планшета перекрыла бы шапку.
  if (!print) {
    parts.push(
      `<rect x="${base.x}" y="${base.y}" width="${base.w}" height="${base.h}" fill="${palette.surface}"/>`,
    );
  }

  // Кольца
  const rings = Array.from({ length: chart.rings }, (_, i) => i + 1)
    .map((i) => {
      const stroke =
        i === chart.rings ? palette.ringOuter : i === chart.boldRing ? palette.ringBold : palette.ring;
      // Среднее кольцо выделено жирным; на экране внешний край имеет ту же толщину.
      const width = print
        ? i === chart.boldRing ? majorWidth : 0.6
        : i === chart.boldRing || i === chart.rings ? majorWidth : 1;
      return `<circle cx="${cx}" cy="${cy}" r="${n(i * ringStep)}" stroke="${stroke}" stroke-width="${width}"${vectorEffect}/>`;
    })
    .join('');
  parts.push(`<g fill="none">${rings}</g>`);

  // Радиальные линии
  const radials = Array.from({ length: 12 }, (_, i) => i * 30)
    .filter((deg) => !print || deg % 90 === 0)
    .map((deg) => {
      const r = (deg * Math.PI) / 180;
      const cardinal = deg % 90 === 0;
      // На бумаге оси заканчиваются на внешнем кольце.
      const len = cardinal && !print ? outer + 18 : outer;
      const stroke = cardinal ? palette.ringBold : palette.axis;
      const width = cardinal ? majorWidth : 0.6;
      return `<line x1="${cx}" y1="${cy}" x2="${n(cx + len * Math.sin(r))}" y2="${n(cy - len * Math.cos(r))}" stroke="${stroke}" stroke-width="${width}"${cardinal ? vectorEffect : ''}/>`;
    })
    .join('');
  parts.push(`<g>${radials}</g>`);

  // Засечки по азимуту
  const ticks = Array.from({ length: print ? 36 : 72 }, (_, i) => i * (print ? 10 : 5))
    .map((deg) => {
      const r = (deg * Math.PI) / 180;
      const len = print ? -(deg % 30 === 0 ? 12 : 8) : deg % 45 === 0 ? 10 : deg % 15 === 0 ? 6 : 3;
      const width = print ? 0.6 : deg % 45 === 0 ? 1.2 : 0.7;
      return `<line x1="${n(cx + outer * Math.sin(r))}" y1="${n(cy - outer * Math.cos(r))}" x2="${n(cx + (outer + len) * Math.sin(r))}" y2="${n(cy - (outer + len) * Math.cos(r))}" stroke-width="${width}"/>`;
    })
    .join('');
  parts.push(`<g stroke="${palette.tick}">${ticks}</g>`);

  // Румбы и азимуты
  const withNumbers = options.showAzimuthNumbers ?? !print;
  const compass = Array.from({ length: 12 }, (_, i) => i * 30)
    .filter((deg) => withNumbers || deg % 90 === 0)
    .map((deg) => {
      const r = (deg * Math.PI) / 180;
      const cardinal = deg % 90 === 0;
      const offset = print ? 20 : 26;
      const x = n(cx + (outer + offset) * Math.sin(r));
      const y = n(cy - (outer + offset) * Math.cos(r));
      const fill = cardinal ? palette.cardinal : palette.tick;
      const size = cardinal ? 16 : 9;
      const weight = cardinal ? 700 : 500;
      const text = cardinal ? compassPoint(deg) : String(deg);
      return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${text}</text>`;
    })
    .join('');
  parts.push(`<g text-anchor="middle" dominant-baseline="central">${compass}</g>`);

  // Подписи колец по вертикальной оси
  if (options.showRingLabels ?? !print) {
    const ringLabels = Array.from(
      { length: Math.max(0, Math.floor(chart.rings / 2) - 1) },
      (_, i) => (i + 1) * 2,
    )
      .map((i) => `<text x="${cx + 3}" y="${n(cy - i * ringStep)}">${i * chart.scaleKm}</text>`)
      .join('');
    parts.push(
      `<g fill="${palette.tick}" font-size="8" text-anchor="start" dominant-baseline="central">${ringLabels}</g>`,
    );
  }

  // На печати чертёж и траектория остаются внутри окружности, даже при выходе за радиус.
  if (print) {
    parts.push(
      `<defs><clipPath id="chart-print-area" clipPathUnits="userSpaceOnUse">` +
        `<circle cx="${cx}" cy="${cy}" r="${outer}"/></clipPath></defs>` +
        `<g clip-path="url(#chart-print-area)">`,
    );
  }

  // Polyline — исходный чертёж станции. При его наличии границы Airway
  // используются для расчёта пересечений и подписей, чтобы не дублировать линии.
  const polylines = chart.polylines
    .map(
      (line) =>
        `<polyline points="${line.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke="${palette.geometry}" stroke-width="${print ? 0.6 : 0.9}"${line.dashed ? ' stroke-dasharray="3 3"' : ''}/>`,
    )
    .join('');
  const airways = (chart.polylines.length === 0 ? chart.airways : [])
    .map(
      (airway) =>
        `<polyline points="${airway.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke="${palette.airway}" stroke-width="${print ? 0.6 : 1.1}"/>`,
    )
    .join('');
  parts.push(
    `<g fill="none" stroke-linejoin="round" stroke-linecap="round">${polylines}${airways}</g>`,
  );

  // Обводка цвета фона отделяет подписи от линий на экране и на печати.
  const labelBackground =
    ` paint-order="stroke" stroke="${palette.halo}" stroke-width="3" stroke-linejoin="round"`;
  const labelParts: string[] = [];
  const captionKey = (caption: string): string => caption.replace(/\s+/g, '').toUpperCase();
  const airwayCaptions = new Set(
    chart.airways.map((airway) => captionKey(airwayBaseName(airway.caption))),
  );
  // На планшетах 50 км Airway нет: обозначения трасс распознаём и в обычных Label,
  // включая «КД265,ЛД201», «Б932 М152» и «◇B120». Подписи ориентиров сохраняем.
  const isAirwayCaption = (caption: string): boolean =>
    airwayCaptions.has(captionKey(caption)) ||
    /^\s*◇?\s*[a-zа-яё]{1,2}\s*\d{1,4}(?:[\s,/]+[a-zа-яё]{1,2}\s*\d{1,4})*\s*$/i.test(caption);

  if (options.showAirwayLabels ?? !print) {
    // Готовые подписи XML имеют приоритет над автоматически расставленными.
    const stationCaptions = new Set(chart.labels.map((label) => captionKey(label.caption)));
    const labels = airwayLabels(chart.airways)
      .filter((label) => !stationCaptions.has(captionKey(label.caption)))
      .map(
        (label) =>
          `<text x="${n(label.x)}" y="${n(label.y)}" dy="-3" transform="rotate(${n(label.angleDeg)} ${n(label.x)} ${n(label.y)})">${esc(label.caption)}</text>`,
      )
      .join('');
    labelParts.push(
      `<g font-size="9" fill="${palette.airwayLabel}" text-anchor="middle"${labelBackground}>${labels}</g>`,
    );
  }

  // angle в XML — против часовой стрелки, в SVG положительный угол по часовой
  const stationLabels = chart.labels
    .filter((label) => options.showAirwayLabels !== false || !isAirwayCaption(label.caption))
    .map(
      (label) =>
        `<text x="${label.x}" y="${label.y}" transform="rotate(${n(-label.angleDeg)} ${label.x} ${label.y})">${esc(label.caption)}</text>`,
    )
    .join('');
  labelParts.push(
    `<g font-size="9" fill="${palette.label}" dominant-baseline="hanging"${labelBackground}>${stationLabels}</g>`,
  );

  // Траектория
  const ox = options.origin?.dxKm ?? 0;
  const oy = options.origin?.dyKm ?? 0;
  if (path.length > 1) {
    const d = path
      .map((p, i) => {
        const point = kmToCanvas(chart, ox + p.dxKm, oy + p.dyKm);
        return `${i === 0 ? 'M' : 'L'}${n(point.x)} ${n(point.y)}`;
      })
      .join(' ');
    parts.push(
      `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
        (print ? '' : `<path d="${d}" stroke="${palette.halo}" stroke-width="5" opacity="0.85"/>`) +
        `<path d="${d}" stroke="${palette.track}" stroke-width="${print ? 0.8 : 2.2}"/></g>`,
    );
  }

  // Подписи лежат поверх всех линий, а точки с номерами — поверх подписей.
  parts.push(labelParts.join(''));

  // Точка выпуска
  const release = kmToCanvas(chart, ox, oy);
  parts.push(
    `<g>` +
      (print ? '' : `<circle cx="${n(release.x)}" cy="${n(release.y)}" r="4.5" fill="${palette.halo}"/>`) +
      `<circle cx="${n(release.x)}" cy="${n(release.y)}" r="${print ? 6.5 : 2.6}" fill="${palette.station}"/></g>`,
  );

  // Высоты отчёта
  const markers = rows
    .map((row) => {
      const p = kmToCanvas(chart, ox + row.dxKm, oy + row.dyKm);
      return (
        `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${print ? 7.5 : 8}" fill="${palette.marker}"${print ? '' : ` stroke="${palette.halo}" stroke-width="1.4"`}/>` +
        `<text x="${n(p.x)}" y="${n(p.y)}" fill="${palette.markerText}" font-size="${print ? 13 : 9.5}" font-weight="700" text-anchor="middle" dominant-baseline="central">${row.no}</text>`
      );
    })
    .join('');
  if (markers) parts.push(`<g>${markers}</g>`);

  if (print) parts.push('</g>');

  // Подпись схемы
  if (options.captionLeft !== undefined) {
    const captionY = chart.canvasSize + 62;
    const right = `1 деление — ${chart.scaleKm} км, радиус ${chart.radiusKm} км`;
    parts.push(
      `<g font-size="11" fill="${palette.caption}" dominant-baseline="central">` +
        `<text x="${base.x + 6}" y="${captionY}">${esc(options.captionLeft)}</text>` +
        `<text x="${base.x + base.w - 6}" y="${captionY}" text-anchor="end">${esc(right)}</text></g>`,
    );
  }

  return parts.join('');
}

/** Самостоятельный SVG-документ (для скачивания и растеризации). */
export function renderChartDocument(options: RenderChartOptions & { size?: number }): string {
  const base = baseViewBox(options.chart.canvasSize);
  const width = options.size ?? 900;
  const height = Math.round((width * base.h) / base.w);
  const title = options.captionLeft ? `<title>${esc(options.captionLeft)}</title>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxToString(base)}" ` +
    `width="${width}" height="${height}" font-family="${CHART_FONT}">${title}` +
    renderChartBody(options) +
    `</svg>`
  );
}
