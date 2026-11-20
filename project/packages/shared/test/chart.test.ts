import { describe, expect, it } from 'vitest';
import { chartPalette, emptyChart, nearestWithin, renderChartBody } from '../src/index.js';

describe('чертёж станции', () => {
  const palette = chartPalette(false);

  it.each(['screen', 'print'] as const)(
    'рисует исходный чертёж без дублирующих границ Airway (%s)',
    (variant) => {
      const chart = emptyChart(10);
      // Почти совпадающие линии Т825 из планшета Архангельска.
      chart.polylines.push({
        points: [{ x: 261, y: 192 }, { x: 273, y: 259 }],
        dashed: false,
      });
      chart.airways.push({
        caption: 'Т825-1',
        points: [{ x: 261, y: 189 }, { x: 275, y: 263 }],
      });

      const svg = renderChartBody({ chart, palette, variant, showAirwayLabels: true });
      expect(svg.match(/<polyline\b/g)).toHaveLength(1);
      expect(svg).toContain('points="261,192 273,259"');
      expect(svg).not.toContain('points="261,189 275,263"');
      expect(svg).toContain('>Т825</text>');
    },
  );

  it.each(['screen', 'print'] as const)('рисует Airway при отсутствии Polyline (%s)', (variant) => {
    const chart = emptyChart(10);
    chart.airways.push({
      caption: 'Т825-1',
      points: [{ x: 261, y: 189 }, { x: 275, y: 263 }],
    });

    const svg = renderChartBody({ chart, palette, variant, showAirwayLabels: true });
    expect(svg.match(/<polyline\b/g)).toHaveLength(1);
    expect(svg).toContain('points="261,189 275,263"');
    expect(svg).toContain('>Т825</text>');
  });

  it('автоматически подписывает только трассы без готовой подписи XML', () => {
    const chart = emptyChart(10);
    chart.airways.push(
      { caption: 'W194-1', points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] },
      { caption: 'R819-1', points: [{ x: 300, y: 200 }, { x: 400, y: 100 }] },
    );
    chart.labels.push(
      { caption: ' w194 ', x: 87, y: 112, angleDeg: -30 },
      { caption: '▲SEREK', x: 130, y: 261, angleDeg: 0 },
    );

    const svg = renderChartBody({ chart, palette, showAirwayLabels: true });
    expect(svg).toContain('> w194 </text>');
    expect(svg).not.toContain('>W194</text>');
    expect(svg).toContain('>R819</text>');
    expect(svg).toContain('>▲SEREK</text>');
  });

  it.each([10, 5])('переключает все подписи трасс, сохраняя ориентиры (1 деление — %s км)', (scale) => {
    const chart = emptyChart(scale);
    if (scale === 10) {
      chart.airways.push(
        { caption: 'W194-1', points: [{ x: 100, y: 100 }, { x: 200, y: 200 }] },
        { caption: 'R819-1', points: [{ x: 300, y: 200 }, { x: 400, y: 100 }] },
      );
    }
    const airways = ['W194', 'B912/N742', 'КД265,ЛД201', '◇B120', 'Б932 М152'];
    const landmarks = ['Алдан', 'КТА UEEA', '▲SEREK', '▲B120'];
    chart.labels.push(
      ...[...airways, ...landmarks].map((caption, index) => ({
        caption, x: 100, y: 100 + index * 10, angleDeg: 0,
      })),
    );

    const visible = renderChartBody({ chart, palette, showAirwayLabels: true });
    const hidden = renderChartBody({ chart, palette, showAirwayLabels: false });
    for (const caption of airways) {
      expect(visible).toContain(`>${caption}</text>`);
      expect(hidden).not.toContain(`>${caption}</text>`);
    }
    for (const caption of landmarks) {
      expect(visible).toContain(`>${caption}</text>`);
      expect(hidden).toContain(`>${caption}</text>`);
    }
    if (scale === 10) {
      expect(visible).toContain('>R819</text>');
      expect(hidden).not.toContain('>R819</text>');
    }
  });
});

describe('точка выпуска на планшете', () => {
  const chart = emptyChart(10); // 2,68 пикселя на км
  const palette = chartPalette(false);
  const path = [
    { timeMin: 0, heightM: 0, dxKm: 0, dyKm: 0, lat: 0, lon: 0 },
    { timeMin: 1, heightM: 300, dxKm: 0, dyKm: 10, lat: 0, lon: 0 },
  ];

  it.each([
    { scale: 10, northY: 241.2 },
    { scale: 5, northY: 214.4 },
  ])('без смещения рисуется в центре (1 деление — $scale км)', ({ scale, northY }) => {
    const svg = renderChartBody({ chart: emptyChart(scale), path, palette });
    expect(svg).toContain('<circle cx="268" cy="268" r="4.5"');
    expect(svg).toContain('<circle cx="268" cy="268" r="268"');
    expect(svg).toContain(`M268 268 L268 ${northY}`);
  });

  it('со смещением путь рисуется от точки выпуска', () => {
    const svg = renderChartBody({ chart, path, palette, origin: { dxKm: 10, dyKm: -5 } });
    expect(svg).toContain('<circle cx="294.8" cy="281.4" r="4.5"');
    expect(svg).toContain('M294.8 281.4 L294.8 254.6');
  });

  it('берёт ближайшую станцию только в пределах радиуса', () => {
    const stations = [
      { name: 'A', lat: 64.62, lon: 40.51 },
      { name: 'B', lat: 64.9, lon: 40.51 },
    ];
    expect(nearestWithin(stations, { lat: 64.7, lon: 40.51 }, 30)?.name).toBe('A');
    expect(nearestWithin(stations, { lat: 64.8, lon: 40.51 }, 30)?.name).toBe('B');
    expect(nearestWithin(stations, { lat: 66, lon: 40.51 }, 30)).toBeUndefined();
  });
});
