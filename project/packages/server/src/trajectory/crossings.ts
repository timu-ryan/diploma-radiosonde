import {
  airwayBaseName,
  kmToCanvas,
  normalizeDeg,
  toDeg,
  type AirwayCrossing,
  type ChartGeometry,
  type ChartPoint,
  type TrajectoryPathPoint,
} from '@rs/shared';

/*
 * Трасса на планшете — коридор: две боковые границы, у аэродрома обычно перемычка,
 * у края планшета коридор открыт. Нарисованы границы вручную: концы отрезков
 * не всегда сходятся, встречаются хвосты за перемычкой и линии, порезанные на куски.
 * Поэтому коридор не собирается в многоугольник, а заливается: границы рисуются
 * на мелкой сетке, стыки и открытые концы замыкаются отрезками, сетка заливается
 * снаружи — всё, куда заливка не дошла, лежит внутри трассы. Хвосты и лишние
 * перемычки на результат не влияют.
 */

/** Конец линии, не дотянутый до другой линии той же трассы не больше чем на столько пикселей, к ней пришивается. */
const JOIN_PX = 4;
/** Свободные концы линий замыкаются попарно, если между ними не больше этого, км (ширина устья коридора). */
const MAX_MOUTH_KM = 40;
/** Ячеек сетки на пиксель холста: при масштабе 10 км ячейка ≈ 0,19 км. */
const CELLS_PER_PX = 2;
/** Сколько раз делится пополам шаг пути, на котором зонд входит в коридор или выходит из него. */
const BISECT_STEPS = 16;

type Segment = [ChartPoint, ChartPoint];

const distance = (a: ChartPoint, b: ChartPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

function closestOnSegment(p: ChartPoint, a: ChartPoint, b: ChartPoint): ChartPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Пересекаются ли отрезки внутренними точками (касание концами не считается). */
function segmentsCross([a1, a2]: Segment, [b1, b2]: Segment): boolean {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denom;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** Границы коридора одной трассы: её линии, пришитые стыки и замкнутые открытые концы. */
function corridorWalls(lines: ChartPoint[][], maxMouthPx: number): Segment[] {
  const walls: Segment[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) walls.push([line[i - 1] as ChartPoint, line[i] as ChartPoint]);
  }

  const loose: ChartPoint[] = [];
  lines.forEach((line, index) => {
    for (const end of [line[0], line.at(-1)] as ChartPoint[]) {
      let nearest: ChartPoint | undefined;
      lines.forEach((other, otherIndex) => {
        if (otherIndex === index) return;
        for (let i = 1; i < other.length; i += 1) {
          const q = closestOnSegment(end, other[i - 1] as ChartPoint, other[i] as ChartPoint);
          if (!nearest || distance(end, q) < distance(end, nearest)) nearest = q;
        }
      });
      if (nearest && distance(end, nearest) <= JOIN_PX) walls.push([end, nearest]);
      else loose.push(end);
    }
  });

  // Открытые концы: свободные концы попарно, начиная с ближайших; замыкающий
  // отрезок не должен пересекать уже имеющиеся границы.
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < loose.length; i += 1) {
    for (let j = i + 1; j < loose.length; j += 1) {
      const d = distance(loose[i] as ChartPoint, loose[j] as ChartPoint);
      if (d <= maxMouthPx) pairs.push({ i, j, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const used = new Set<number>();
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    const mouth: Segment = [loose[i] as ChartPoint, loose[j] as ChartPoint];
    if (walls.some((wall) => segmentsCross(mouth, wall))) continue;
    walls.push(mouth);
    used.add(i);
    used.add(j);
  }
  return walls;
}

/** Коридор трассы на холсте планшета. */
export class AirwayCorridor {
  constructor(
    readonly airway: string,
    private readonly x0: number,
    private readonly y0: number,
    /** По строкам сетки — пары [начало, конец) столбцов внутри коридора. */
    private readonly runs: Int32Array[],
  ) {}

  contains(point: ChartPoint): boolean {
    const row = this.runs[Math.floor((point.y - this.y0) * CELLS_PER_PX)];
    if (!row) return false;
    const col = Math.floor((point.x - this.x0) * CELLS_PER_PX);
    for (let i = 0; i < row.length; i += 2) {
      if (col < (row[i] as number)) return false;
      if (col < (row[i + 1] as number)) return true;
    }
    return false;
  }
}

const WALL = 1;
const OUTSIDE = 2;

function rasterize(airway: string, walls: Segment[]): AirwayCorridor {
  const xs = walls.flatMap(([a, b]) => [a.x, b.x]);
  const ys = walls.flatMap(([a, b]) => [a.y, b.y]);
  // Поле в пиксель вокруг границ, чтобы заливка обошла их со всех сторон.
  const x0 = Math.min(...xs) - 1;
  const y0 = Math.min(...ys) - 1;
  const cols = Math.ceil((Math.max(...xs) + 1 - x0) * CELLS_PER_PX) + 1;
  const rows = Math.ceil((Math.max(...ys) + 1 - y0) * CELLS_PER_PX) + 1;
  const grid = new Uint8Array(cols * rows);

  // Шаг в четверть ячейки даёт 8-связную линию: заливка по четырём направлениям её не пересечёт.
  for (const [a, b] of walls) {
    const ax = (a.x - x0) * CELLS_PER_PX;
    const ay = (a.y - y0) * CELLS_PER_PX;
    const bx = (b.x - x0) * CELLS_PER_PX;
    const by = (b.y - y0) * CELLS_PER_PX;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 4) + 1;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      grid[Math.floor(ay + (by - ay) * t) * cols + Math.floor(ax + (bx - ax) * t)] = WALL;
    }
  }

  const stack: number[] = [];
  const visit = (i: number): void => {
    if (grid[i] !== 0) return;
    grid[i] = OUTSIDE;
    stack.push(i);
  };
  for (let c = 0; c < cols; c += 1) {
    visit(c);
    visit((rows - 1) * cols + c);
  }
  for (let r = 0; r < rows; r += 1) {
    visit(r * cols);
    visit(r * cols + cols - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const c = i % cols;
    if (c > 0) visit(i - 1);
    if (c < cols - 1) visit(i + 1);
    if (i >= cols) visit(i - cols);
    if (i < (rows - 1) * cols) visit(i + cols);
  }

  // Внутри — незалитые ячейки и граница рядом с ними; хвосты снаружи коридора
  // окружены залитыми ячейками и внутрь не попадают.
  const enclosed = (i: number): boolean => grid[i] === 0;
  const runs: Int32Array[] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: number[] = [];
    let start = -1;
    for (let c = 0; c <= cols; c += 1) {
      const i = r * cols + c;
      const inside =
        c < cols &&
        (enclosed(i) ||
          (grid[i] === WALL &&
            ((c > 0 && enclosed(i - 1)) ||
              (c < cols - 1 && enclosed(i + 1)) ||
              (r > 0 && enclosed(i - cols)) ||
              (r < rows - 1 && enclosed(i + cols)))));
      if (inside && start < 0) start = c;
      if (!inside && start >= 0) {
        row.push(start, c);
        start = -1;
      }
    }
    runs.push(Int32Array.from(row));
  }

  return new AirwayCorridor(airway, x0, y0, runs);
}

const corridorCache = new WeakMap<ChartGeometry, AirwayCorridor[]>();

/**
 * Коридоры трасс чертежа. Трассы в XML нарисованы кусками («Л93-1», «Л93-2»),
 * поэтому куски собираются по базовому названию. Чертёж станции не меняется,
 * поэтому коридоры строятся один раз на чертёж.
 */
export function airwayCorridors(chart: ChartGeometry): AirwayCorridor[] {
  const cached = corridorCache.get(chart);
  if (cached) return cached;

  const lines = new Map<string, ChartPoint[][]>();
  for (const airway of chart.airways) {
    const name = airwayBaseName(airway.caption);
    if (!name) continue;
    const group = lines.get(name) ?? [];
    group.push(airway.points);
    lines.set(name, group);
  }

  const corridors = [...lines].map(([name, group]) =>
    rasterize(name, corridorWalls(group, MAX_MOUTH_KM * chart.pxPerKm)),
  );
  corridorCache.set(chart, corridors);
  return corridors;
}

type PathMoment = Pick<TrajectoryPathPoint, 'heightM' | 'timeMin' | 'dxKm' | 'dyKm'>;

/** Полярные координаты зонда относительно центра планшета станции. */
function polar(point: PathMoment): { azimuthDeg: number; distanceKm: number } {
  return {
    azimuthDeg: normalizeDeg(toDeg(Math.atan2(point.dxKm, point.dyKm))),
    distanceKm: Math.hypot(point.dxKm, point.dyKm),
  };
}

/** Точка на шаге пути, где зонд входит в коридор или выходит из него. */
function boundaryBetween(
  chart: ChartGeometry,
  corridor: AirwayCorridor,
  from: TrajectoryPathPoint,
  to: TrajectoryPathPoint,
): PathMoment {
  const pointAt = (t: number): ChartPoint =>
    kmToCanvas(chart, from.dxKm + (to.dxKm - from.dxKm) * t, from.dyKm + (to.dyKm - from.dyKm) * t);
  const startsInside = corridor.contains(pointAt(0));

  let lo = 0;
  let hi = 1;
  for (let k = 0; k < BISECT_STEPS; k += 1) {
    const mid = (lo + hi) / 2;
    if (corridor.contains(pointAt(mid)) === startsInside) lo = mid;
    else hi = mid;
  }

  const t = (lo + hi) / 2;
  return {
    heightM: from.heightM + (to.heightM - from.heightM) * t,
    timeMin: from.timeMin + (to.timeMin - from.timeMin) * t,
    dxKm: from.dxKm + (to.dxKm - from.dxKm) * t,
    dyKm: from.dyKm + (to.dyKm - from.dyKm) * t,
  };
}

/**
 * Участки подъёма внутри коридоров трасс чертежа станции: на каждый заход
 * в трассу — высоты, время и полярные координаты входа и выхода. Если зонд выпущен
 * внутри коридора, вход — сам выпуск; если не вышел до конца пути, конец участка —
 * конец пути, exited = false.
 */
export function findAirwayCrossings(
  chart: ChartGeometry,
  path: TrajectoryPathPoint[],
): AirwayCrossing[] {
  if (chart.airways.length === 0 || path.length < 2) return [];

  const crossings: AirwayCrossing[] = [];
  const inside = (corridor: AirwayCorridor, p: TrajectoryPathPoint): boolean =>
    corridor.contains(kmToCanvas(chart, p.dxKm, p.dyKm));

  for (const corridor of airwayCorridors(chart)) {
    const first = path[0] as TrajectoryPathPoint;
    let entry: PathMoment | undefined = inside(corridor, first) ? first : undefined;

    const close = (exit: PathMoment, exited: boolean): void => {
      if (!entry) return;
      const from = polar(entry);
      const to = polar(exit);
      crossings.push({
        airway: corridor.airway,
        fromHeightM: entry.heightM,
        toHeightM: exit.heightM,
        fromTimeMin: entry.timeMin,
        toTimeMin: exit.timeMin,
        fromAzimuthDeg: from.azimuthDeg,
        toAzimuthDeg: to.azimuthDeg,
        fromDistanceKm: from.distanceKm,
        toDistanceKm: to.distanceKm,
        exited,
      });
      entry = undefined;
    };

    for (let i = 1; i < path.length; i += 1) {
      const from = path[i - 1] as TrajectoryPathPoint;
      const to = path[i] as TrajectoryPathPoint;
      if (inside(corridor, to) === (entry !== undefined)) continue;

      const edge = boundaryBetween(chart, corridor, from, to);
      if (entry) close(edge, true);
      else entry = edge;
    }
    close(path.at(-1) as TrajectoryPathPoint, false);
  }

  return crossings.sort((a, b) => a.fromTimeMin - b.fromTimeMin);
}
