import { describe, expect, it } from 'vitest';
import { analyzeAerology, dryAdiabatTemp } from '../src/aerology.js';
import {
  DIAGRAM_BOTTOM_MB,
  DIAGRAM_KINDS,
  DIAGRAM_PLOT,
  DIAGRAM_TOP_MB,
  diagramLegend,
  diagramPalette,
  diagramProjection,
  renderDiagramDocument,
  windBarb,
} from '../src/diagram.js';
import type { AeroLevel } from '../src/types.js';

const levels: AeroLevel[] = [
  [850, 1500, 5, 240, 8],
  [700, 3000, -5, 250, 14],
  [500, 5400, -21, 260, 22],
  [300, 9000, -45, 270, 34],
  [200, 11700, -56, 275, 27],
  [100, 15900, -57, 280, 0],
].map(([mb, heightM, tempC, windDirDeg, windSpeedMs]) => ({
  mb: mb as number,
  fl: (heightM as number) / 30,
  heightM: heightM as number,
  timeMin: (heightM as number) / 300,
  lat: 60,
  lon: 40,
  tempC: tempC as number,
  windDirDeg: windDirDeg as number,
  windSpeedMs: windSpeedMs as number,
}));

const document = (kind?: (typeof DIAGRAM_KINDS)[number]): string =>
  renderDiagramDocument({
    aerology: { levels, analysis: analyzeAerology(levels) },
    station: { caption: 'Архангельск', index: '22550', lat: 64.62, lon: 40.51 },
    releaseIso: '2026-08-07T11:30:00Z',
    runTimeIso: '2026-08-07T00:00:00Z',
    usedSteps: [12],
    ...(kind ? { kind } : {}),
  });

describe('аэрологическая диаграмма', () => {
  it('оба вида занимают поле по давлению от верха до низа', () => {
    for (const kind of DIAGRAM_KINDS) {
      const { y } = diagramProjection(kind);
      expect(y(DIAGRAM_TOP_MB)).toBeCloseTo(DIAGRAM_PLOT.y, 9);
      expect(y(DIAGRAM_BOTTOM_MB)).toBeCloseTo(DIAGRAM_PLOT.y + DIAGRAM_PLOT.h, 9);
    }
  });

  it('АДК: давление в логарифмическом масштабе, изотермы наклонены вправо', () => {
    const { x, y } = diagramProjection('skewt');
    // Равные отношения давлений — равные расстояния
    expect(y(1000) - y(500)).toBeCloseTo(y(200) - y(100), 9);
    // Наклон 45°: изотерма уходит вправо на столько же, на сколько поднимается
    expect(x(0, 500) - x(0, 1000)).toBeCloseTo(y(1000) - y(500), 9);
  });

  it('АДП: давление по p^κ, изотермы вертикальные, сухие адиабаты прямые', () => {
    const { x, y } = diagramProjection('stuve');
    expect(x(-20, 300)).toBe(x(-20, 1000));
    // Верхние слои сжаты сильнее, чем на ln p: 1000–500 гПа выше, чем 200–100 гПа
    expect(y(1000) - y(500)).toBeGreaterThan(y(200) - y(100));

    // Три точки сухой адиабаты θ = 300 K лежат на одной прямой
    const at = (mb: number): [number, number] => [x(dryAdiabatTemp(300, mb) - 273.15, mb), y(mb)];
    const [x1, y1] = at(1000);
    const [x2, y2] = at(500);
    const [x3, y3] = at(150);
    expect((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)).toBeCloseTo(0, 6);
  });

  it('рисует флажки ветра по скорости', () => {
    const color = '#000';
    expect(windBarb(0, 0, 270, 1, color)).toContain('<circle');
    // 25 м/с — один треугольник, без перьев
    const flag = windBarb(0, 0, 270, 25, color);
    expect(flag).toContain('Z');
    expect(flag.match(/l-?\d/g)).toBeNull();
    // 12 м/с ≈ 12,5 — два длинных пера и короткое
    expect(windBarb(0, 0, 270, 12, color).match(/l-?\d/g)).toHaveLength(3);
    // Древко смотрит туда, откуда дует ветер: западный — влево от точки
    expect(windBarb(100, 100, 270, 5, color)).toContain('M100 100L74 100');
  });

  it('собирает документ со шапкой, кривой и подписью ветра на каждом уровне', () => {
    const svg = document();

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('Прогностическая аэрологическая диаграмма · Архангельск (22550)');
    expect(svg).toContain('07.08.2026 11:30 UTC');
    expect(svg).toContain('сроки +12 ч');
    expect(svg).toContain(`stroke="${diagramPalette(false).temperature}" stroke-width="2.4"`);
    expect(svg.match(/>\d{3}\/\d+<\/text>/g)).toHaveLength(levels.length);
    expect(svg).toContain('Тропопауза');
    expect(svg).toContain('max 34 м/с · 9 000 м');
    expect(svg).toContain('VT = T850 − T500 = 26 °C');
    // Легенда — тот же список, что рядом с диаграммой на экране
    for (const item of diagramLegend(diagramPalette(false), 'skewt')) {
      expect(svg).toContain(item.caption.replace('<', '&lt;'));
    }
    // Скачиваемая картинка всегда светлая
    expect(svg).toContain(`fill="${diagramPalette(false).surface}"`);
    expect(svg).not.toContain(diagramPalette(true).moistAdiabat);
    // Вид по умолчанию — АДК
    expect(svg).toContain('>АДК · Skew-T<');
  });

  it('рисует АДП тем же кодом: те же подписи, вид — в шапке', () => {
    const skewt = document('skewt');
    const stuve = document('stuve');

    expect(document()).toBe(skewt);
    expect(stuve).not.toBe(skewt);
    expect(stuve).toContain('>АДП · Stüve<');
    expect(stuve).toContain('Прогностическая аэрологическая диаграмма · Архангельск (22550)');
    expect(stuve.match(/>\d{3}\/\d+<\/text>/g)).toHaveLength(levels.length);
    expect(stuve).toContain('Тропопауза');
    expect(stuve).toContain('max 34 м/с · 9 000 м');
    // Изотермы вертикальные — над полем температура не подписывается, легенда говорит то же
    const topLabels = /font-size="9" text-anchor="middle">(.*?)<\/g>/;
    expect(skewt.match(topLabels)?.[1]).toContain('°</text>');
    expect(stuve.match(topLabels)?.[1]).toBe('');
    const isotherms = diagramLegend(diagramPalette(false), 'stuve').find((i) => i.caption === 'изотермы');
    expect(isotherms?.hint).toContain('вертикальные');
  });
});
