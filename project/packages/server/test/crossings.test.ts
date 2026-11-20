import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANVAS_CENTER,
  CANVAS_SIZE,
  kmToCanvas,
  pxPerKm,
  type ChartAirway,
  type ChartGeometry,
  type TrajectoryPathPoint,
} from '@rs/shared';
import { readStationFile } from '../src/stations/parser.js';
import { findAirwayCrossings } from '../src/trajectory/crossings.js';

const stationsDir = resolve(import.meta.dirname, '../../../stations');

const chartWith = (airways: ChartAirway[]): ChartGeometry => ({
  scaleKm: 10,
  radiusKm: 100,
  pxPerKm: pxPerKm(10),
  canvasSize: CANVAS_SIZE,
  center: { x: CANVAS_CENTER, y: CANVAS_CENTER },
  rings: 10,
  boldRing: 5,
  polylines: [],
  airways,
  labels: [],
});

/** Линия трассы по точкам в км от станции. */
const line = (caption: string, ...km: [number, number][]): ChartAirway => ({
  caption,
  points: km.map(([dx, dy]) => kmToCanvas(chartWith([]), dx, dy)),
});

/** Путь по точкам в км; на каждые 0,5 км — шаг 1 мин и 100 м высоты. */
function pathThrough(...km: [number, number][]): TrajectoryPathPoint[] {
  const path: TrajectoryPathPoint[] = [];
  for (let i = 1; i < km.length; i += 1) {
    const [x0, y0] = km[i - 1] as [number, number];
    const [x1, y1] = km[i] as [number, number];
    const steps = Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.5);
    for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) {
      const n = path.length;
      path.push({
        timeMin: n,
        heightM: n * 100,
        dxKm: x0 + ((x1 - x0) * s) / steps,
        dyKm: y0 + ((y1 - y0) * s) / steps,
        lat: 0,
        lon: 0,
      });
    }
  }
  return path;
}

/** Коридор с севера на юг между dx = from и dx = to, открытый с обоих концов. */
const meridianCorridor = (name: string, from: number, to: number): ChartAirway[] => [
  line(`${name}-1`, [from, -30], [from, 30]),
  line(`${name}-2`, [to, 30], [to, -30]),
];

describe('пересечение трасс', () => {
  it('отдаёт высоты входа в коридор и выхода из него', () => {
    const chart = chartWith(meridianCorridor('Т1', 10, 15));
    const crossings = findAirwayCrossings(chart, pathThrough([0, 0], [30, 0]));

    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.airway).toBe('Т1');
    // вход на 10 км (2000 м), выход на 15 км (3000 м); сетка ≈0,2 км
    expect(crossings[0]!.fromHeightM).toBeCloseTo(2000, -2);
    expect(crossings[0]!.toHeightM).toBeCloseTo(3000, -2);
    expect(crossings[0]!.fromTimeMin).toBeCloseTo(20, 0);
    expect(crossings[0]!.toTimeMin).toBeCloseTo(30, 0);
    expect(crossings[0]!.fromAzimuthDeg).toBeCloseTo(90, 6);
    expect(crossings[0]!.toAzimuthDeg).toBeCloseTo(90, 6);
    expect(crossings[0]!.fromDistanceKm).toBeCloseTo(10, 0);
    expect(crossings[0]!.toDistanceKm).toBeCloseTo(15, 0);
    expect(crossings[0]!.exited).toBe(true);
  });

  it('при выпуске внутри коридора вход — сам выпуск', () => {
    const chart = chartWith(meridianCorridor('Л1', -2.5, 2.5));
    const crossings = findAirwayCrossings(chart, pathThrough([0, 0], [30, 0]));

    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.fromHeightM).toBe(0);
    expect(crossings[0]!.fromTimeMin).toBe(0);
    expect(crossings[0]!.fromAzimuthDeg).toBe(0);
    expect(crossings[0]!.fromDistanceKm).toBe(0);
    expect(crossings[0]!.toHeightM).toBeCloseTo(500, -2);
  });

  it('если зонд весь подъём внутри коридора, трасса занимает весь путь', () => {
    const chart = chartWith(meridianCorridor('Л1', -2.5, 2.5));
    const path = pathThrough([0, 0], [0, 25]);
    const crossings = findAirwayCrossings(chart, path);

    expect(crossings).toEqual([
      {
        airway: 'Л1',
        fromHeightM: 0,
        toHeightM: path.at(-1)!.heightM,
        fromTimeMin: 0,
        toTimeMin: path.at(-1)!.timeMin,
        fromAzimuthDeg: 0,
        toAzimuthDeg: 0,
        fromDistanceKm: 0,
        toDistanceKm: 25,
        exited: false,
      },
    ]);
  });

  it('если зонд не вышел из коридора, выход — конец пути', () => {
    const chart = chartWith(meridianCorridor('Т1', 10, 15));
    const path = pathThrough([0, 0], [12, 0], [12, 20]);
    const crossings = findAirwayCrossings(chart, path);

    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.fromHeightM).toBeCloseTo(2000, -2);
    expect(crossings[0]!.toHeightM).toBe(path.at(-1)!.heightM);
    expect(crossings[0]!.toDistanceKm).toBeCloseTo(Math.hypot(12, 20), 6);
    expect(crossings[0]!.exited).toBe(false);
  });

  it('считает полярные координаты границ от станции при смещённой точке выпуска', () => {
    const chart = chartWith(meridianCorridor('Т1', 10, 15));
    const crossing = findAirwayCrossings(chart, pathThrough([5, 10], [20, 10]))[0]!;

    // На входе dx ≈ 10, dy = 10: азимут ≈ 45°, удаление ≈ 14 км от станции,
    // хотя от точки выпуска зонд прошёл только ≈ 5 км.
    expect(crossing.fromAzimuthDeg).toBeCloseTo(45, 0);
    expect(crossing.fromDistanceKm).toBeCloseTo(Math.hypot(10, 10), 0);
    expect(crossing.toAzimuthDeg).toBeCloseTo(56.3, 0);
    expect(crossing.toDistanceKm).toBeCloseTo(Math.hypot(15, 10), 0);
  });

  it('нормализует азимут западнее севера в диапазон 0–360°', () => {
    const chart = chartWith(meridianCorridor('Т1', -15, -10));
    const crossing = findAirwayCrossings(chart, pathThrough([0, 10], [-20, 10]))[0]!;

    expect(crossing.fromAzimuthDeg).toBeCloseTo(315, 0);
    expect(crossing.toAzimuthDeg).toBeCloseTo(303.7, 0);
  });

  it('на каждый заход в трассу — отдельная запись', () => {
    const chart = chartWith(meridianCorridor('Т1', 10, 15));
    // на восток через коридор и обратно
    const crossings = findAirwayCrossings(chart, pathThrough([0, 0], [20, 0], [0, 0]));

    expect(crossings.map((c) => c.airway)).toEqual(['Т1', 'Т1']);
    expect(crossings[0]!.fromHeightM).toBeCloseTo(2000, -2);
    expect(crossings[0]!.toHeightM).toBeCloseTo(3000, -2);
    // обратно: вход на 15 км (5000 м), выход на 10 км (6000 м)
    expect(crossings[1]!.fromHeightM).toBeCloseTo(5000, -2);
    expect(crossings[1]!.toHeightM).toBeCloseTo(6000, -2);
  });

  it('терпит недотянутые стыки и не считает хвост за перемычкой трассой', () => {
    // Коридор на север между dx = 8 и 13 км с перемычкой на dy = 7 км. Перемычка
    // не дотянута до левой границы на ~0,5 км, левая граница торчит хвостом до dy = −3 км.
    const chart = chartWith([
      line('Б1-1', [8, 40], [8, -3]),
      line('Б1-2', [13, 40], [13, 7]),
      line('Б1-3', [8.5, 7], [13, 7]),
    ]);

    // на восток вдоль dy = 0 — пересекает только хвост
    expect(findAirwayCrossings(chart, pathThrough([0, 0], [30, 0]))).toEqual([]);

    // на север по dx = 10 — входит через перемычку на 7 км (1400 м)
    const north = findAirwayCrossings(chart, pathThrough([10, 0], [10, 30]));
    expect(north).toHaveLength(1);
    expect(north[0]!.fromHeightM).toBeCloseTo(1400, -2);
  });

  it('разные трассы отдаются в порядке входа', () => {
    const chart = chartWith([...meridianCorridor('Т1', 10, 15), ...meridianCorridor('Т2', 20, 25)]);
    const crossings = findAirwayCrossings(chart, pathThrough([0, 0], [30, 0]));
    expect(crossings.map((c) => c.airway)).toEqual(['Т1', 'Т2']);
  });

  it('Архангельск: Л93 проходит через точку выпуска', async () => {
    const station = await readStationFile(resolve(stationsDir, 'ARCHNGL.xml'));
    const chart = station.charts['10']!;

    // на восток: из Л93 зонд выходит, а не входит в неё
    const east = findAirwayCrossings(chart, pathThrough([0, 0], [30, 0]));
    expect(east[0]).toMatchObject({ airway: 'Л93', fromHeightM: 0 });
    expect(east[0]!.toHeightM).toBeGreaterThan(0);

    // вдоль Л93 на юго-восток (азимут ≈138°) — внутри неё весь путь
    const az = (138 * Math.PI) / 180;
    const along = pathThrough([0, 0], [20 * Math.sin(az), 20 * Math.cos(az)]);
    expect(findAirwayCrossings(chart, along)).toEqual([
      {
        airway: 'Л93',
        fromHeightM: 0,
        toHeightM: along.at(-1)!.heightM,
        fromTimeMin: 0,
        toTimeMin: along.at(-1)!.timeMin,
        fromAzimuthDeg: 0,
        toAzimuthDeg: expect.closeTo(138, 6),
        fromDistanceKm: 0,
        toDistanceKm: expect.closeTo(20, 6),
        exited: false,
      },
    ]);
  });
});
