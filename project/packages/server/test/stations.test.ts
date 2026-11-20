import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS_SIZE, RINGS, chartPalette, renderChartBody, type ChartGeometry } from '@rs/shared';
import { readStationFile } from '../src/stations/parser.js';
import { StationRegistry } from '../src/stations/registry.js';

const stationsDir = resolve(import.meta.dirname, '../../../stations');
const station = (name: string) => readStationFile(resolve(stationsDir, `${name}.xml`));

describe('разбор планшетов станций', () => {
  it('читает кириллицу из windows-1251 и координаты с запятой', async () => {
    const arkh = await station('ARCHNGL');
    expect(arkh.name).toBe('ARCHNGL');
    expect(arkh.caption).toBe('Архангельск');
    expect(arkh.index).toBe('22550');
    expect(arkh.lat).toBeCloseTo(64.62, 5);
    expect(arkh.lon).toBeCloseTo(40.51, 5);
    expect(arkh.scales).toEqual([10, 5]);
  });

  it('переводит angle из десятых долей градуса и разбирает стиль линии', async () => {
    const arkh = await station('ARCHNGL');
    const chart5 = arkh.charts['5'];
    expect(chart5).toBeDefined();
    expect(chart5?.canvasSize).toBe(CANVAS_SIZE);
    expect(chart5?.rings).toBe(RINGS);
    expect(chart5?.radiusKm).toBe(50);
    expect(chart5?.pxPerKm).toBeCloseTo(5.36, 6);

    const label = chart5?.labels.find((l) => l.caption === 'Т825');
    expect(label).toMatchObject({ x: 252, y: 156, angleDeg: -80 });

    const own = chart5?.labels.find((l) => l.caption === 'Архангельск');
    expect(own).toMatchObject({ x: 273, y: 255 });

    const airways = arkh.charts['10']?.airways ?? [];
    expect(airways.some((a) => a.caption === 'Л93-1')).toBe(true);
    expect(airways.every((a) => a.points.length >= 2)).toBe(true);
  });

  it('раскрывает числовые ссылки вида &#9650;', async () => {
    const arkh = await station('ARCHNGL');
    expect(arkh.charts['5']?.labels.some((l) => l.caption.startsWith('▲'))).toBe(true);
  });

  it.each(['screen', 'print'] as const)(
    'Алдан: готовые подписи трасс не дублируются автоматическими (%s)',
    async (variant) => {
      const aldan = await station('ALDAN');
      const chart = aldan.charts['10'] as ChartGeometry;
      const svg = renderChartBody({
        chart,
        palette: chartPalette(false),
        variant,
        showAirwayLabels: true,
      });

      for (const caption of ['W194', 'B953', 'B959', 'B912/N742', 'G495/N622', 'B152/M130', 'R819']) {
        const originalCount = chart.labels.filter((label) => label.caption === caption).length;
        expect(originalCount).toBeGreaterThan(0);
        expect(svg.split(`>${caption}</text>`).length - 1).toBe(originalCount);
      }
      expect(svg).toContain('>▲SEREK</text>');
      expect(svg).toContain('>Алдан</text>');
    },
  );

  it('склеивает повторяющиеся блоки Scale и переживает неполные наборы', async () => {
    const barnaul = await station('BARNAUL'); // в XML два блока Scale Value="5"
    expect(barnaul.scales).toEqual([10, 5]);
    expect((barnaul.charts['5']?.polylines.length ?? 0) > 0).toBe(true);

    const kotelny = await station('KTELNIY'); // только Scale Value="10"
    expect(kotelny.scales).toEqual([10]);

    const norilsk = await station('NORILSK'); // только Scale Value="5"
    expect(norilsk.scales).toEqual([5]);
  });

  it('загружает весь каталог станций и ищет по названию', async () => {
    const registry = await StationRegistry.load(stationsDir);
    expect(registry.failed).toEqual([]);
    // XXXXX.xml — заготовка без координат, в выдачу не попадает
    expect(registry.skipped.map((s) => s.file)).toEqual(['XXXXX.xml']);
    expect(registry.size).toBe(105);

    expect(registry.search('арханг').map((s) => s.name)).toContain('ARCHNGL');
    expect(registry.search('22550').map((s) => s.name)).toContain('ARCHNGL');
    expect(registry.get('archngl')?.caption).toBe('Архангельск');

    for (const s of registry.all()) {
      expect(Number.isFinite(s.lat), `${s.name}: широта`).toBe(true);
      expect(Number.isFinite(s.lon), `${s.name}: долгота`).toBe(true);
      expect(s.scales.length, `${s.name}: масштабы`).toBeGreaterThan(0);
    }
  });
});
