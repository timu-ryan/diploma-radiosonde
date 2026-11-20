import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import iconv from 'iconv-lite';
import { XMLParser } from 'fast-xml-parser';
import {
  emptyChart,
  type ChartGeometry,
  type ChartLabel,
  type ChartPoint,
  type Station,
} from '@rs/shared';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
});

type AnyNode = Record<string, unknown>;

/** Приводит поле XML-узла к массиву: парсер сворачивает одиночные элементы в объект. */
function toArray(value: unknown): AnyNode[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === 'object') as AnyNode[];
  if (typeof value === 'object') return [value as AnyNode];
  return [];
}

function attr(node: AnyNode, name: string): string | undefined {
  const v = node[`@_${name}`];
  return v === undefined || v === null ? undefined : String(v);
}

/** «64,62» → 64.62 */
function decimal(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Number.parseFloat(value.replace(',', '.'));
}

/** Подстраховка на случай, если парсер оставил числовые ссылки вида &#9650;. */
function decodeNumericEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function readPoints(node: AnyNode): ChartPoint[] {
  return toArray(node.point)
    .map((p) => ({ x: Number(attr(p, 'x')), y: Number(attr(p, 'y')) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/**
 * Разбирает XML-планшет станции.
 *
 * Файлы в кодировке windows-1251, координаты — пиксели холста 536×536 с центром
 * в точке выпуска. Блоки Scale с одинаковым Value склеиваются (встречается в
 * BARNAUL, BRATSK, CHKURDK, KOLPASHV, PETRZVDSK, VANAVARA), пустые элементы
 * (<Polyline/>, <Airway/>) отбрасываются.
 */
export function parseStationXml(xmlBuffer: Buffer, fileName: string): Station {
  const decoded = iconv
    .decode(xmlBuffer, 'win1251')
    .replace(/encoding="windows-1251"/i, 'encoding="utf-8"');

  const doc = parser.parse(decoded) as AnyNode;
  const root = (doc.root ?? {}) as AnyNode;
  const pointNode = toArray(root.Point)[0];
  if (!pointNode) throw new Error(`В файле ${fileName} нет элемента <Point>`);

  const charts: Record<string, ChartGeometry> = {};

  for (const scaleNode of toArray(root.Scale)) {
    const scaleKm = Number(attr(scaleNode, 'Value'));
    if (!Number.isFinite(scaleKm) || scaleKm <= 0) continue;

    const key = String(scaleKm);
    const chart = charts[key] ?? (charts[key] = emptyChart(scaleKm));

    for (const polyline of toArray(scaleNode.Polyline)) {
      const points = readPoints(polyline);
      if (points.length < 2) continue;
      chart.polylines.push({ points, dashed: (attr(polyline, 'ps') ?? 'Solid') === 'Dot' });
    }

    for (const airway of toArray(scaleNode.Airway)) {
      const points = readPoints(airway);
      if (points.length < 2) continue;
      chart.airways.push({ caption: decodeNumericEntities(attr(airway, 'Caption') ?? ''), points });
    }

    for (const label of toArray(scaleNode.Label)) {
      const caption = decodeNumericEntities(attr(label, 'Caption') ?? '').trim();
      const x = Number(attr(label, 'x'));
      const y = Number(attr(label, 'y'));
      if (!caption || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      // angle в XML задан в десятых долях градуса
      const angleDeg = (Number(attr(label, 'angle')) || 0) / 10;
      chart.labels.push({ caption, x, y, angleDeg } satisfies ChartLabel);
    }
  }

  const name = attr(pointNode, 'Name') ?? basename(fileName, '.xml');
  const lon = decimal(attr(pointNode, 'Lon'));

  return {
    name,
    caption: decodeNumericEntities(attr(pointNode, 'Caption') ?? name),
    amsg: decodeNumericEntities(attr(pointNode, 'AMSG') ?? ''),
    index: attr(pointNode, 'Index') ?? '',
    lat: decimal(attr(pointNode, 'Lat')),
    lon,
    hms: decodeNumericEntities(attr(pointNode, 'HMS') ?? ''),
    cgms: attr(pointNode, 'CGMS') ?? '',
    ugms: attr(pointNode, 'UGMS') ?? '',
    scales: Object.values(charts)
      .map((c) => c.scaleKm)
      .sort((a, b) => b - a),
    charts,
    raw: {
      start: attr(pointNode, 'Start') ?? '',
      center: attr(pointNode, 'Center') ?? '',
      lastmess: attr(pointNode, 'Lastmess') ?? '',
      mailTo: attr(pointNode, 'MailTo') ?? '',
    },
  };
}

/** Читает и разбирает один файл планшета. */
export async function readStationFile(path: string): Promise<Station> {
  return parseStationXml(await readFile(path), basename(path));
}
