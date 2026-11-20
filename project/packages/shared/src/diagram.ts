/**
 * Аэрологическая диаграмма в SVG — косоугольная АДК (skew-T log p) или прямоугольная
 * АДП (диаграмма Штюве). Виды отличаются только проекцией (`diagramProjection`),
 * бланк, кривая, подписи и флажки рисуются одним кодом.
 *
 * Как и схема в chart.ts, это только строки, без DOM и React: ту же разметку
 * вставляет в страницу браузер и отдаёт на скачивание сервер (`GET /api/diagram.svg`).
 */
import {
  dryAdiabatTemp,
  mixingRatioTemp,
  moistAdiabat,
  standardAtmosphere,
  JET_MIN_SPEED_MS,
  KAPPA,
  TURBULENCE_RI,
  ZERO_C_K,
} from './aerology.js';
import { CHART_FONT } from './chart.js';
import {
  formatDateTimeUtc,
  formatLat,
  formatLon,
  formatMeters,
  formatTemp,
  num,
  parseUtc,
} from './format.js';
import { toRad } from './geo.js';
import { mbToMeters } from './levels.js';
import type { AeroLevel, AeroSounding } from './types.js';

/** Размер диаграммы без шапки (единицы viewBox). */
export const DIAGRAM_WIDTH = 880;
export const DIAGRAM_HEIGHT = 784;
/** Поле диаграммы: давление по вертикали, температура по горизонтали (на АДК — по наклонной). */
export const DIAGRAM_PLOT = { x: 64, y: 24, w: 640, h: 720 } as const;
export const DIAGRAM_TOP_MB = 100;
export const DIAGRAM_BOTTOM_MB = 1050;

const PLOT_LEFT = DIAGRAM_PLOT.x;
const PLOT_TOP = DIAGRAM_PLOT.y;
const PLOT_RIGHT = DIAGRAM_PLOT.x + DIAGRAM_PLOT.w;
const PLOT_BOTTOM = DIAGRAM_PLOT.y + DIAGRAM_PLOT.h;

/** Колонка ветра справа от поля: центр флажков и начало подписей. */
export const DIAGRAM_WIND_X = PLOT_RIGHT + 66;
const WIND_LABEL_X = DIAGRAM_WIND_X + 44;

/** Изобары с подписями. */
const ISOBARS_MB = [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100];

/** Вид диаграммы: косоугольная АДК (skew-T log p) или прямоугольная АДП (Штюве). */
export type DiagramKind = 'skewt' | 'stuve';

export const DIAGRAM_KINDS: readonly DiagramKind[] = ['skewt', 'stuve'];
export const DEFAULT_DIAGRAM_KIND: DiagramKind = 'skewt';

export const isDiagramKind = (value: unknown): value is DiagramKind =>
  DIAGRAM_KINDS.includes(value as DiagramKind);

/** Подписи видов: шифр, название и пояснение — для переключателя и шапки. */
export const DIAGRAM_KIND_LABELS: Record<DiagramKind, { short: string; name: string; hint: string }> = {
  skewt: {
    short: 'АДК',
    name: 'Skew-T',
    hint: 'Косоугольная: давление по ln p, изотермы наклонены на 45°',
  },
  stuve: {
    short: 'АДП',
    name: 'Stüve',
    hint: 'Прямоугольная (Штюве): давление по p^κ, изотермы вертикальные, сухие адиабаты — прямые',
  },
};

/** Как вид диаграммы переводит давление и температуру в точку поля. */
export interface DiagramProjection {
  /** Вертикальная координата уровня давления. */
  y: (mb: number) => number;
  /** Горизонтальная координата температуры на уровне давления. */
  x: (tempC: number, mb: number) => number;
  /** Наклон изотерм: сдвиг вправо на единицу подъёма; 0 — изотермы вертикальны. */
  skew: number;
  /** Потенциальные температуры крайних сухих адиабат бланка, °C (шаг 10) — чтобы покрыть поле. */
  dryAdiabatsC: readonly [number, number];
}

/** АДК: ln p по вертикали; −35 °C в левом нижнем углу, 8 единиц на градус, изотермы под 45°. */
const SKEWT_LEFT_C = -35;
const SKEWT_PX_PER_C = 8;
const SKEWT_SKEW = 1;
const LN_TOP = Math.log(DIAGRAM_TOP_MB);
const LN_SPAN = Math.log(DIAGRAM_BOTTOM_MB) - LN_TOP;
const skewtY = (mb: number): number => PLOT_TOP + (DIAGRAM_PLOT.h * (Math.log(mb) - LN_TOP)) / LN_SPAN;

/**
 * АДП: p^κ по вертикали (κ = R/cp) — так сухие адиабаты T = θ·(p/1000)^κ становятся прямыми;
 * температура по горизонтали от −85 до +43 °C, 5 единиц на градус.
 */
const STUVE_LEFT_C = -85;
const STUVE_PX_PER_C = 5;
const P_KAPPA_TOP = DIAGRAM_TOP_MB ** KAPPA;
const P_KAPPA_SPAN = DIAGRAM_BOTTOM_MB ** KAPPA - P_KAPPA_TOP;

const PROJECTIONS: Record<DiagramKind, DiagramProjection> = {
  skewt: {
    y: skewtY,
    x: (tempC, mb) =>
      PLOT_LEFT + (tempC - SKEWT_LEFT_C) * SKEWT_PX_PER_C + (PLOT_BOTTOM - skewtY(mb)) * SKEWT_SKEW,
    skew: SKEWT_SKEW,
    dryAdiabatsC: [-30, 170],
  },
  stuve: {
    y: (mb) => PLOT_TOP + (DIAGRAM_PLOT.h * (mb ** KAPPA - P_KAPPA_TOP)) / P_KAPPA_SPAN,
    x: (tempC) => PLOT_LEFT + (tempC - STUVE_LEFT_C) * STUVE_PX_PER_C,
    skew: 0,
    dryAdiabatsC: [-90, 340],
  },
};

export const diagramProjection = (kind: DiagramKind): DiagramProjection => PROJECTIONS[kind];

export interface DiagramPalette {
  surface: string;
  frame: string;
  isobar: string;
  isotherm: string;
  dryAdiabat: string;
  moistAdiabat: string;
  mixingRatio: string;
  standard: string;
  temperature: string;
  wind: string;
  windLabel: string;
  windMax: string;
  tropopause: string;
  tropopauseFill: string;
  isothermMark: string;
  stableFill: string;
  stableText: string;
  jet: string;
  icing: string;
  turbulence: string;
  text: string;
  muted: string;
  halo: string;
}

export const diagramPalette = (dark: boolean): DiagramPalette =>
  dark
    ? {
        surface: '#0f172a',
        frame: '#64748b',
        isobar: '#334155',
        isotherm: '#27365f',
        dryAdiabat: '#4b3a2a',
        moistAdiabat: '#1d4a35',
        mixingRatio: '#3d3470',
        standard: '#b08968',
        temperature: '#f87171',
        wind: '#e2e8f0',
        windLabel: '#cbd5e1',
        windMax: '#fbbf24',
        tropopause: '#fdba74',
        tropopauseFill: '#3d2a17',
        isothermMark: '#f87171',
        stableFill: '#57491a',
        stableText: '#fef3c7',
        jet: '#f97316',
        icing: '#a855f7',
        turbulence: '#94a3b8',
        text: '#cbd5e1',
        muted: '#94a3b8',
        halo: '#0f172a',
      }
    : {
        surface: '#ffffff',
        frame: '#475569',
        isobar: '#cbd5e1',
        isotherm: '#c3cdf0',
        dryAdiabat: '#e6c9ab',
        moistAdiabat: '#a7d7bb',
        mixingRatio: '#cdbff7',
        standard: '#8a6343',
        temperature: '#dc2626',
        wind: '#0f172a',
        windLabel: '#334155',
        windMax: '#b45309',
        tropopause: '#9a3412',
        tropopauseFill: '#fde7cf',
        isothermMark: '#dc2626',
        stableFill: '#fef08a',
        stableText: '#713f12',
        jet: '#ea580c',
        icing: '#c084fc',
        turbulence: '#64748b',
        text: '#334155',
        muted: '#64748b',
        halo: '#ffffff',
      };

const esc = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const n = (value: number): string => (Math.round(value * 100) / 100).toString();

type Point = [number, number];

const points = (list: Point[]): string => list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');

/** Давления от низа поля до верха с равным шагом по ln p. */
function pressureSteps(count: number, fromMb = DIAGRAM_BOTTOM_MB, toMb = DIAGRAM_TOP_MB): number[] {
  const a = Math.log(fromMb);
  const b = Math.log(toMb);
  return Array.from({ length: count + 1 }, (_, i) => Math.exp(a + ((b - a) * i) / count));
}

/** Подписи с подложкой цвета фона — читаются поверх линий бланка. */
const haloAttrs = (palette: DiagramPalette, width = 3): string =>
  `paint-order="stroke" stroke="${palette.halo}" stroke-width="${width}" stroke-linejoin="round"`;

/** Сетка бланка: изотермы, адиабаты, линии массовой доли, стандартная атмосфера, изобары. */
function renderBlank(palette: DiagramPalette, proj: DiagramProjection): string {
  const parts: string[] = [];

  const isotherms: string[] = [];
  for (let t = -130; t <= 50; t += 10) {
    const x1 = proj.x(t, DIAGRAM_BOTTOM_MB);
    const x2 = proj.x(t, DIAGRAM_TOP_MB);
    const width = t === 0 ? 1.1 : 0.7;
    isotherms.push(
      `<line x1="${n(x1)}" y1="${PLOT_BOTTOM}" x2="${n(x2)}" y2="${PLOT_TOP}" stroke-width="${width}"/>`,
    );
  }
  parts.push(`<g stroke="${palette.isotherm}">${isotherms.join('')}</g>`);

  const steps = pressureSteps(36);
  const dry: string[] = [];
  const [thetaFrom, thetaTo] = proj.dryAdiabatsC;
  for (let thetaC = thetaFrom; thetaC <= thetaTo; thetaC += 10) {
    const line = steps.map((mb): Point => [proj.x(dryAdiabatTemp(thetaC + ZERO_C_K, mb), mb), proj.y(mb)]);
    dry.push(`<polyline points="${points(line)}"/>`);
  }
  parts.push(`<g fill="none" stroke="${palette.dryAdiabat}" stroke-width="0.8">${dry.join('')}</g>`);

  const moist: string[] = [];
  for (let t0 = -20; t0 <= 36; t0 += 4) {
    const down = moistAdiabat(t0, 1000, DIAGRAM_BOTTOM_MB, 10).reverse();
    const up = moistAdiabat(t0, 1000, DIAGRAM_TOP_MB, 10).slice(1);
    const line = [...down, ...up].map((p): Point => [proj.x(p.tempC, p.mb), proj.y(p.mb)]);
    moist.push(`<polyline points="${points(line)}"/>`);
  }
  parts.push(
    `<g fill="none" stroke="${palette.moistAdiabat}" stroke-width="0.8" stroke-dasharray="5 4">${moist.join('')}</g>`,
  );

  const mixing: string[] = [];
  const mixingLabels: string[] = [];
  for (const w of [1, 2, 4, 7, 10, 16, 24]) {
    const line = pressureSteps(18).map((mb): Point => [
      proj.x(mixingRatioTemp(w, mb), mb),
      proj.y(mb),
    ]);
    mixing.push(`<polyline points="${points(line)}"/>`);
    const [x, y] = line[0] as Point;
    mixingLabels.push(`<text x="${n(x)}" y="${n(y - 4)}">${w}</text>`);
  }
  parts.push(
    `<g fill="none" stroke="${palette.mixingRatio}" stroke-width="0.8" stroke-dasharray="2 3">${mixing.join('')}</g>`,
    `<g fill="${palette.mixingRatio}" font-size="8" text-anchor="middle">${mixingLabels.join('')}</g>`,
  );

  const standard: Point[] = [];
  for (let h = 0; h <= 16_500; h += 250) {
    const s = standardAtmosphere(h);
    if (s.mb < DIAGRAM_TOP_MB) break;
    standard.push([proj.x(s.tempC, s.mb), proj.y(s.mb)]);
  }
  parts.push(
    `<polyline points="${points(standard)}" fill="none" stroke="${palette.standard}" stroke-width="1" stroke-dasharray="7 4"/>`,
  );
  const top = standardAtmosphere(15_500);
  parts.push(
    `<text x="${n(proj.x(top.tempC, top.mb) + 6)}" y="${n(proj.y(top.mb))}" fill="${palette.standard}" font-size="9" ${haloAttrs(palette)}>СА-81</text>`,
  );

  const isobars = ISOBARS_MB.map(
    (mb) =>
      `<line x1="${PLOT_LEFT}" y1="${n(proj.y(mb))}" x2="${PLOT_RIGHT}" y2="${n(proj.y(mb))}"/>`,
  ).join('');
  parts.push(`<g stroke="${palette.isobar}" stroke-width="0.9">${isobars}</g>`);

  return parts.join('');
}

/** Подписи осей: давление и высота слева, температура снизу (на АДК — и сверху). */
function renderAxes(palette: DiagramPalette, proj: DiagramProjection): string {
  const parts: string[] = [];

  const pressure = ISOBARS_MB.map(
    (mb) => `<text x="${PLOT_LEFT - 6}" y="${n(proj.y(mb))}">${mb}</text>`,
  ).join('');
  parts.push(
    `<g fill="${palette.text}" font-size="11" font-weight="600" text-anchor="end" dominant-baseline="central">${pressure}</g>`,
  );

  const heights = ISOBARS_MB.map((mb) => {
    const h = mbToMeters(mb);
    return h === undefined
      ? ''
      : `<text x="${PLOT_LEFT + 4}" y="${n(proj.y(mb) + 11)}">${formatMeters(h)}</text>`;
  }).join('');
  parts.push(`<g fill="${palette.muted}" font-size="9" ${haloAttrs(palette)}>${heights}</g>`);

  const bottom: string[] = [];
  const topLabels: string[] = [];
  for (let t = -130; t <= 50; t += 10) {
    const xb = proj.x(t, DIAGRAM_BOTTOM_MB);
    if (xb >= PLOT_LEFT && xb <= PLOT_RIGHT) {
      bottom.push(`<text x="${n(xb)}" y="${PLOT_BOTTOM + 14}">${formatTemp(t)}°</text>`);
    }
    // Вертикальные изотермы сверху подписывать незачем — там те же значения, что снизу.
    const xt = proj.x(t, DIAGRAM_TOP_MB);
    if (proj.skew !== 0 && xt >= PLOT_LEFT + 10 && xt <= PLOT_RIGHT - 10) {
      topLabels.push(`<text x="${n(xt)}" y="${PLOT_TOP - 6}">${formatTemp(t)}°</text>`);
    }
  }
  parts.push(
    `<g fill="${palette.text}" font-size="10" text-anchor="middle">${bottom.join('')}</g>`,
    `<g fill="${palette.muted}" font-size="9" text-anchor="middle">${topLabels.join('')}</g>`,
    `<text x="${PLOT_LEFT - 6}" y="${PLOT_TOP - 6}" fill="${palette.muted}" font-size="10" text-anchor="end">гПа</text>`,
    `<text x="${PLOT_RIGHT}" y="${PLOT_BOTTOM + 30}" fill="${palette.muted}" font-size="10" text-anchor="end">T, °C</text>`,
    `<text x="${DIAGRAM_WIDTH - 4}" y="${PLOT_TOP - 12}" fill="${palette.muted}" font-size="10" text-anchor="end">ветер, °/м/с</text>`,
  );

  return parts.join('');
}

/**
 * Флажок ветра (северное полушарие): древко от точки к источнику ветра, перья —
 * по часовой стороне от древка с наклоном к его концу. Короткое перо — 2,5 м/с,
 * длинное — 5 м/с, треугольник — 25 м/с; меньше 1,25 м/с — кружок штиля.
 */
export function windBarb(x: number, y: number, dirDeg: number, speedMs: number, color: string): string {
  const rounded = Math.round(speedMs / 2.5) * 2.5;
  if (rounded < 2.5) {
    return `<circle cx="${n(x)}" cy="${n(y)}" r="3.5" fill="none" stroke="${color}" stroke-width="1.2"/>`;
  }

  const r = toRad(dirDeg);
  // Экранные координаты: ось y направлена вниз.
  const d = { x: Math.sin(r), y: -Math.cos(r) };
  const side = { x: -d.y, y: d.x };
  const featherLen = 11;
  const feather = {
    x: side.x * featherLen * 0.87 + d.x * featherLen * 0.5,
    y: side.y * featherLen * 0.87 + d.y * featherLen * 0.5,
  };

  let pennants = Math.floor(rounded / 25);
  let rest = rounded - pennants * 25;
  const full = Math.floor(rest / 5);
  rest -= full * 5;
  const half = rest >= 2.5;

  const pennantWidth = 6;
  const gap = 4;
  // Сколько места займут перья от конца древка — древко удлиняется при сильном ветре.
  const needed = pennants * (pennantWidth + 1) + full * gap + (half ? gap : 0) + 6;
  const length = Math.max(26, needed);
  const tip = { x: x + d.x * length, y: y + d.y * length };
  const at = (pos: number): { x: number; y: number } => ({ x: tip.x - d.x * pos, y: tip.y - d.y * pos });

  const lines: string[] = [`M${n(x)} ${n(y)}L${n(tip.x)} ${n(tip.y)}`];
  const flags: string[] = [];
  let pos = 0;

  for (; pennants > 0; pennants -= 1) {
    const outer = at(pos);
    const inner = at(pos + pennantWidth);
    flags.push(
      `M${n(outer.x)} ${n(outer.y)}L${n(inner.x + feather.x)} ${n(inner.y + feather.y)}L${n(inner.x)} ${n(inner.y)}Z`,
    );
    pos += pennantWidth + 1;
  }
  for (let i = 0; i < full; i += 1) {
    const base = at(pos);
    lines.push(`M${n(base.x)} ${n(base.y)}l${n(feather.x)} ${n(feather.y)}`);
    pos += gap;
  }
  if (half) {
    // Одиночное короткое перо отступает от конца древка, чтобы не путать его с длинным.
    const base = at(pos === 0 ? gap : pos);
    lines.push(`M${n(base.x)} ${n(base.y)}l${n(feather.x / 2)} ${n(feather.y / 2)}`);
  }

  return (
    `<path d="${lines.join('')}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>` +
    (flags.length ? `<path d="${flags.join('')}" fill="${color}"/>` : '')
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Раскладка подписей: новая подпись сдвигается вниз, пока не перестанет налезать на прежние. */
class LabelLayout {
  private readonly boxes: Box[] = [];

  place(box: Box): Box {
    const placed = { ...box };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const hit = this.boxes.find(
        (b) =>
          placed.x < b.x + b.w && b.x < placed.x + placed.w && placed.y < b.y + b.h && b.y < placed.y + placed.h,
      );
      if (!hit) break;
      placed.y = hit.y + hit.h + 1;
    }
    this.boxes.push(placed);
    return placed;
  }
}

/** Примерная ширина строки — для подложек и раскладки. */
const textWidth = (text: string, size: number): number => text.length * size * 0.56;

const levelOf = (levels: AeroLevel[], mb: number): AeroLevel | undefined =>
  levels.find((l) => l.mb === mb);

export interface RenderDiagramOptions {
  aerology: AeroSounding;
  palette: DiagramPalette;
  kind: DiagramKind;
}

/** Внутренняя разметка диаграммы без обёртки <svg> (поле 0…DIAGRAM_WIDTH × 0…DIAGRAM_HEIGHT). */
export function renderDiagramBody(options: RenderDiagramOptions): string {
  const { palette } = options;
  const proj = diagramProjection(options.kind);
  const { analysis } = options.aerology;
  const levels = [...options.aerology.levels].sort((a, b) => b.mb - a.mb);
  const layout = new LabelLayout();
  const parts: string[] = [];

  parts.push(
    `<rect x="0" y="0" width="${DIAGRAM_WIDTH}" height="${DIAGRAM_HEIGHT}" fill="${palette.surface}"/>`,
    `<defs><clipPath id="aero-plot"><rect x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${DIAGRAM_PLOT.w}" height="${DIAGRAM_PLOT.h}"/></clipPath></defs>`,
  );

  // Струйное течение — полоса через колонку ветра, под флажками.
  if (analysis.jet) {
    const y1 = proj.y(analysis.jet.toMb);
    const y2 = proj.y(analysis.jet.fromMb);
    parts.push(
      `<rect x="${PLOT_RIGHT + 18}" y="${n(y1)}" width="${DIAGRAM_WIDTH - PLOT_RIGHT - 22}" height="${n(Math.max(2, y2 - y1))}" fill="${palette.jet}" fill-opacity="0.13" stroke="${palette.jet}" stroke-width="0.8"/>`,
    );
  }

  parts.push(`<g clip-path="url(#aero-plot)">${renderBlank(palette, proj)}`);

  // Слой 0…−20 °C — полосой у левого края поля.
  if (analysis.icing) {
    const y1 = proj.y(analysis.icing.toMb);
    const y2 = proj.y(analysis.icing.fromMb);
    parts.push(
      `<rect x="${PLOT_LEFT + 1}" y="${n(y1)}" width="9" height="${n(Math.max(2, y2 - y1))}" fill="${palette.icing}" fill-opacity="0.6"/>`,
    );
  }

  const lowest = levels[0];
  if (lowest && lowest.mb < 1000) {
    parts.push(
      `<text x="${PLOT_LEFT + 16}" y="${n(proj.y(Math.min(985, (lowest.mb + DIAGRAM_BOTTOM_MB) / 2)))}" fill="${palette.muted}" font-size="10" font-style="italic" ${haloAttrs(palette)}>ниже ${lowest.mb} гПа данных прогноза нет</text>`,
    );
  }

  // Инверсии и изотермии подсвечиваются под кривой температуры.
  const stableTrails = analysis.stableLayers
    .map((layer) => {
      const trail = levels
        .filter((l) => l.mb <= layer.fromMb && l.mb >= layer.toMb)
        .map((l): Point => [proj.x(l.tempC, l.mb), proj.y(l.mb)]);
      return trail.length > 1 ? `<polyline points="${points(trail)}"/>` : '';
    })
    .join('');
  if (stableTrails) {
    parts.push(
      `<g fill="none" stroke="${palette.stableFill}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${stableTrails}</g>`,
    );
  }

  // Кривая температуры
  if (levels.length > 0) {
    const curve = levels.map((l): Point => [proj.x(l.tempC, l.mb), proj.y(l.mb)]);
    parts.push(
      `<polyline points="${points(curve)}" fill="none" stroke="${palette.temperature}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`,
      `<g fill="${palette.temperature}">${curve.map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r="2.4"/>`).join('')}</g>`,
    );
  }
  parts.push(`</g>`);

  // Болтанка — полосой между полем и колонкой ветра.
  const turbulence = analysis.turbulence
    .map((layer) => {
      const y1 = proj.y(layer.toMb);
      const y2 = proj.y(layer.fromMb);
      return `<rect x="${PLOT_RIGHT + 4}" y="${n(y1)}" width="9" height="${n(Math.max(2, y2 - y1))}"/>`;
    })
    .join('');
  if (turbulence) {
    parts.push(`<g fill="${palette.turbulence}" fill-opacity="0.75">${turbulence}</g>`);
  }

  parts.push(
    `<rect x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${DIAGRAM_PLOT.w}" height="${DIAGRAM_PLOT.h}" fill="none" stroke="${palette.frame}" stroke-width="1"/>`,
    renderAxes(palette, proj),
  );

  // Тропопауза: черта от кривой вправо и заливка над ней вдоль изотерм, как на бланке.
  for (const tp of analysis.tropopauses) {
    const x = proj.x(tp.tempC, tp.mb);
    const y = proj.y(tp.mb);
    const len = 112;
    const rise = 18;
    parts.push(
      `<polygon points="${points([
        [x, y],
        [x + len, y],
        [x + len + rise * proj.skew, y - rise],
        [x + rise * proj.skew, y - rise],
      ])}" fill="${palette.tropopauseFill}" fill-opacity="0.85"/>`,
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + len)}" y2="${n(y)}" stroke="${palette.tropopause}" stroke-width="1.6"/>`,
      `<text x="${n(x + 24)}" y="${n(y - 5)}" fill="${palette.tropopause}" font-size="10">Тропопауза</text>`,
    );
    const label = `${formatTemp(Math.round(tp.tempC))}° · ${formatMeters(tp.heightM)}`;
    const box = layout.place({ x: x + 4, y: y + 3, w: textWidth(label, 10), h: 12 });
    parts.push(
      `<text x="${n(box.x)}" y="${n(box.y + 9)}" fill="${palette.tropopause}" font-size="10" font-weight="600" ${haloAttrs(palette)}>${esc(label)}</text>`,
    );
  }

  // Высоты изотерм 0, −10, −20 °C; изотермы ниже нижнего уровня — подписью под кривой
  const below = analysis.isotherms.filter((iso) => iso.belowData);
  if (lowest && below.length > 0) {
    const label = `${below.map((iso) => `${formatTemp(iso.tempC)}°`).join(', ')} — ниже ${formatMeters(lowest.heightM)}`;
    const x = proj.x(lowest.tempC, lowest.mb) + 8;
    const box = layout.place({ x, y: proj.y(lowest.mb) + 4, w: textWidth(label, 10), h: 12 });
    parts.push(
      `<text x="${n(box.x)}" y="${n(box.y + 9)}" fill="${palette.isothermMark}" font-size="10" font-weight="600" ${haloAttrs(palette)}>${esc(label)}</text>`,
    );
  }
  for (const iso of analysis.isotherms) {
    if (iso.belowData) continue;
    const x = proj.x(iso.tempC, iso.mb);
    const y = proj.y(iso.mb);
    const label = `${formatTemp(iso.tempC)}° ${formatMeters(iso.heightM)}`;
    const box = layout.place({ x: x + 8, y: y - 13, w: textWidth(label, 10), h: 12 });
    parts.push(
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + 46)}" y2="${n(y)}" stroke="${palette.isothermMark}" stroke-width="1.4"/>`,
      `<text x="${n(box.x)}" y="${n(box.y + 9)}" fill="${palette.isothermMark}" font-size="10" font-weight="600" ${haloAttrs(palette)}>${esc(label)}</text>`,
    );
  }

  // Слои инверсии и изотермии: плашка справа от кривой
  for (const layer of analysis.stableLayers) {
    const bottom = levelOf(levels, layer.fromMb);
    const top = levelOf(levels, layer.toMb);
    if (!bottom || !top) continue;
    const x = Math.max(proj.x(bottom.tempC, bottom.mb), proj.x(top.tempC, top.mb)) + 10;
    const y = (proj.y(layer.fromMb) + proj.y(layer.toMb)) / 2;
    const sign = layer.deltaT > 0.05 ? '+' : '';
    const label = `ΔT=${sign}${num(layer.deltaT, Number.isInteger(layer.deltaT) ? 0 : 1)}° ΔH=${formatMeters(layer.toHeightM - layer.fromHeightM)}`;
    const w = textWidth(label, 9.5) + 8;
    const box = layout.place({ x, y: y - 7, w, h: 14 });
    parts.push(
      `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(w)}" height="14" rx="2" fill="${palette.stableFill}"/>`,
      `<text x="${n(box.x + 4)}" y="${n(box.y + 10.5)}" fill="${palette.stableText}" font-size="9.5">${esc(label)}</text>`,
    );
  }

  // Максимальный ветер и границы струйного течения — у правого края поля
  const max = analysis.maxWind;
  if (analysis.jet) {
    const { jet } = analysis;
    parts.push(
      `<g fill="${palette.jet}" font-size="9.5" text-anchor="end" ${haloAttrs(palette)}>` +
        `<text x="${PLOT_RIGHT - 4}" y="${n(proj.y(jet.toMb) + 10)}">${formatMeters(jet.toHeightM)}</text>` +
        `<text x="${PLOT_RIGHT - 4}" y="${n(proj.y(jet.fromMb) - 3)}">${formatMeters(jet.fromHeightM)}</text></g>`,
    );
  }
  if (max) {
    const label = `max ${Math.round(max.speedMs)} м/с · ${formatMeters(max.heightM)}`;
    parts.push(
      `<text x="${PLOT_RIGHT - 4}" y="${n(proj.y(max.mb))}" fill="${palette.windMax}" font-size="10" font-weight="600" text-anchor="end" dominant-baseline="central" ${haloAttrs(palette)}>${esc(label)}</text>`,
    );
  }

  // Флажки ветра и подписи «направление/скорость»
  const barbs = levels
    .map((level) => {
      const y = proj.y(level.mb);
      const isMax = max !== undefined && level.mb === max.mb;
      const color = isMax ? palette.windMax : palette.wind;
      const dir = String(Math.round(level.windDirDeg) % 360).padStart(3, '0');
      return (
        windBarb(DIAGRAM_WIND_X, y, level.windDirDeg, level.windSpeedMs, color) +
        `<text x="${WIND_LABEL_X}" y="${n(y)}" fill="${isMax ? palette.windMax : palette.windLabel}" font-size="10"${isMax ? ' font-weight="700"' : ''} dominant-baseline="central">${dir}/${Math.round(level.windSpeedMs)}</text>`
      );
    })
    .join('');
  parts.push(`<g>${barbs}</g>`);

  return parts.join('');
}

export interface DiagramStation {
  caption: string;
  index: string;
  lat: number;
  lon: number;
}

export interface RenderDiagramDocumentOptions {
  aerology: AeroSounding;
  station: DiagramStation;
  /** Время выпуска радиозонда, ISO UTC. */
  releaseIso: string;
  /** Время прогона модели, ISO UTC. */
  runTimeIso: string;
  /** Использованные заблаговременности, ч. */
  usedSteps: number[];
  /** Вид диаграммы, по умолчанию АДК. */
  kind?: DiagramKind;
  /** Ширина картинки в пикселях. */
  width?: number;
}

const HEADER_HEIGHT = 64;
const FOOTER_HEIGHT = 128;

/** Обозначение на диаграмме: образец (SVG в поле 0…28 × −8…8), подпись и пояснение. */
export interface DiagramLegendItem {
  sample: string;
  caption: string;
  hint: string;
}

/** Размер образца в легенде (единицы SVG). */
export const LEGEND_SAMPLE = { width: 28, height: 16 } as const;

const sampleLine = (stroke: string, width: number, dash = ''): string =>
  `<line x1="2" y1="0" x2="26" y2="0" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

const sampleBox = (fill: string, opacity: number, stroke = ''): string =>
  `<rect x="5" y="-5" width="18" height="10" fill="${fill}" fill-opacity="${opacity}"${stroke ? ` stroke="${stroke}" stroke-width="0.8"` : ''}/>`;

/**
 * Обозначения диаграммы — одни и те же под скачиваемой картинкой и рядом с ней на экране.
 * Образцы нарисованы теми же цветами и приёмами, что и сама диаграмма.
 */
export function diagramLegend(palette: DiagramPalette, kind: DiagramKind): DiagramLegendItem[] {
  const skewed = diagramProjection(kind).skew !== 0;
  return [
    {
      sample: sampleLine(palette.temperature, 2.4),
      caption: 'температура по траектории',
      hint: 'Стратификационная кривая: температура на уровнях там и тогда, где проходит зонд.',
    },
    {
      sample: windBarb(26, 3, 270, 32.5, palette.wind),
      caption: 'флажок ветра (5 / 2,5 / 25 м/с)',
      hint:
        'Древко смотрит туда, откуда дует ветер; длинное перо — 5 м/с, короткое — 2,5, ' +
        'треугольник — 25. Подпись — направление/скорость.',
    },
    {
      sample:
        `<polygon points="2,3 20,3 26,-4 8,-4" fill="${palette.tropopauseFill}"/>` +
        `<line x1="2" y1="3" x2="20" y2="3" stroke="${palette.tropopause}" stroke-width="1.6"/>`,
      caption: 'тропопауза',
      hint: 'Верх тропосферы: выше неё температура почти не падает (не больше 2 °C/км, критерий ВМО).',
    },
    {
      sample:
        `<line x1="8" y1="0" x2="26" y2="0" stroke="${palette.isothermMark}" stroke-width="1.4"/>` +
        `<circle cx="6" cy="0" r="2.4" fill="${palette.temperature}"/>`,
      caption: 'высоты изотерм 0, −10, −20 °C',
      hint: '0 °C — уровень замерзания; −10 и −20 °C — ориентиры для обледенения и гроз.',
    },
    {
      sample:
        sampleLine(palette.stableFill, 8) +
        `<line x1="2" y1="0" x2="26" y2="0" stroke="${palette.temperature}" stroke-width="2.4"/>`,
      caption: 'инверсия, изотермия (ΔT, ΔH)',
      hint: 'Температура растёт с высотой или не меняется — задерживающий слой; на плашке ΔT и толщина слоя.',
    },
    {
      sample: sampleBox(palette.jet, 0.2, palette.jet),
      caption: `струйное течение (≥ ${JET_MIN_SPEED_MS} м/с)`,
      hint: 'Полоса в колонке ветра — слой сильного ветра; «max» — уровень наибольшей скорости.',
    },
    {
      sample: sampleBox(palette.icing, 0.6),
      caption: '0…−20 °C: обледенение в облаках',
      hint: 'Полоса у левого края поля: если в этом слое есть облака, возможно обледенение.',
    },
    {
      sample: sampleBox(palette.turbulence, 0.75),
      caption: `Ri < ${TURBULENCE_RI}: возможна болтанка`,
      hint: 'Полоса справа от поля: сдвиг ветра сильнее, чем устойчивость слоя (число Ричардсона).',
    },
    {
      sample: sampleLine(palette.standard, 1.2, '7 4'),
      caption: 'стандартная атмосфера СА-81',
      hint: 'Эталон ГОСТ 4401-81: +15 °C у земли, −6,5 °C/км до 11 км, выше −56,5 °C. Кривая правее — теплее нормы.',
    },
    {
      sample: sampleLine(palette.isotherm, 1.2),
      caption: 'изотермы',
      hint: skewed
        ? 'Линии одной температуры, наклонены на 45°; значения подписаны под полем и над ним.'
        : 'Линии одной температуры, вертикальные; значения подписаны под полем.',
    },
    {
      sample: sampleLine(palette.isobar, 1.2),
      caption: 'изобары',
      hint: 'Уровни давления; слева — гПа и высота уровня (FL × 30 м).',
    },
    {
      sample: sampleLine(palette.dryAdiabat, 1.4),
      caption: 'сухие адиабаты',
      hint:
        'Так остывает поднимающийся ненасыщенный воздух, ≈ 9,8 °C/км. Кривая круче них — слой неустойчив.' +
        (skewed ? '' : ' На АДП это прямые линии.'),
    },
    {
      sample: sampleLine(palette.moistAdiabat, 1.4, '5 4'),
      caption: 'влажные адиабаты',
      hint: 'Так остывает насыщенный воздух, ≈ 4–7 °C/км. Кривая между влажной и сухой — условная неустойчивость.',
    },
    {
      sample: sampleLine(palette.mixingRatio, 1.4, '2 3'),
      caption: 'массовая доля пара, г/кг',
      hint: 'Линии насыщения для точки росы. Влажности в прогнозе нет — это только сетка бланка.',
    },
  ];
}

/** Легенда под диаграммой в скачиваемом документе: образец и подпись, в три колонки. */
function renderLegend(palette: DiagramPalette, kind: DiagramKind, top: number): string {
  const columns = 3;
  const colWidth = (DIAGRAM_WIDTH - 2 * PLOT_LEFT) / columns;
  return diagramLegend(palette, kind)
    .map((item, i) => {
      const x = PLOT_LEFT + (i % columns) * colWidth;
      const y = top + Math.floor(i / columns) * 19;
      return (
        `<g transform="translate(${n(x)} ${n(y)})">${item.sample}` +
        `<text x="${LEGEND_SAMPLE.width + 6}" y="0" fill="${palette.text}" font-size="10" dominant-baseline="central">${esc(item.caption)}</text></g>`
      );
    })
    .join('');
}

/** Самостоятельный SVG-документ с шапкой и легендой — для скачивания. Всегда светлый. */
export function renderDiagramDocument(options: RenderDiagramDocumentOptions): string {
  const palette = diagramPalette(false);
  const { station, aerology } = options;
  const kind = options.kind ?? DEFAULT_DIAGRAM_KIND;
  const kindLabel = DIAGRAM_KIND_LABELS[kind];
  const release = parseUtc(options.releaseIso);
  const runTime = parseUtc(options.runTimeIso);
  const steps = options.usedSteps.map((s) => `+${s}`).join(', ');
  const vt = aerology.analysis.verticalTotals;

  const top = -HEADER_HEIGHT;
  const height = DIAGRAM_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;
  const width = options.width ?? 1000;
  const pixelHeight = Math.round((width * height) / DIAGRAM_WIDTH);
  const title = `Прогностическая аэрологическая диаграмма (${kindLabel.short}) — ${station.caption}`;

  const header =
    `<g fill="${palette.text}">` +
    `<text x="${PLOT_LEFT}" y="${top + 22}" font-size="16" font-weight="700">Прогностическая аэрологическая диаграмма · ${esc(station.caption)}${station.index ? ` (${esc(station.index)})` : ''}</text>` +
    `<text x="${PLOT_LEFT}" y="${top + 40}" font-size="11.5">${esc(
      `${formatLat(station.lat)}, ${formatLon(station.lon)} · выпуск радиозонда ${formatDateTimeUtc(release)}`,
    )}</text>` +
    `<text x="${DIAGRAM_WIDTH - 4}" y="${top + 40}" font-size="11.5" font-weight="600" text-anchor="end">${esc(
      `${kindLabel.short} · ${kindLabel.name}`,
    )}</text>` +
    `<text x="${PLOT_LEFT}" y="${top + 56}" font-size="11.5" fill="${palette.muted}">${esc(
      `Прогноз Гидрометцентра России от ${formatDateTimeUtc(runTime)}, сроки ${steps} ч · значения на уровнях — в точке и в момент прохождения зонда`,
    )}</text>` +
    `</g>`;

  const note =
    `<text x="${PLOT_LEFT}" y="${DIAGRAM_HEIGHT + 112}" fill="${palette.muted}" font-size="10">${esc(
      `${vt !== undefined ? `VT = T850 − T500 = ${num(vt, 0)} °C. ` : ''}` +
        'Влажности в прогнозе нет: точка росы, уровень конденсации, кривая состояния и индексы гроз не строятся.',
    )}</text>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${DIAGRAM_WIDTH} ${height}" ` +
    `width="${width}" height="${pixelHeight}" font-family="${CHART_FONT}">` +
    `<title>${esc(title)}</title>` +
    `<rect x="0" y="${top}" width="${DIAGRAM_WIDTH}" height="${height}" fill="${palette.surface}"/>` +
    header +
    renderDiagramBody({ aerology, palette, kind }) +
    renderLegend(palette, kind, DIAGRAM_HEIGHT + 8) +
    note +
    `</svg>`
  );
}
