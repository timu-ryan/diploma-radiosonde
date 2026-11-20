import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Station, StationSummary } from '@rs/shared';
import { readStationFile } from './parser.js';

export interface StationLoadResult {
  stations: Station[];
  /** Файлы, которые не удалось разобрать. */
  failed: { file: string; message: string }[];
  /** Файлы-заготовки без координат (например, XXXXX.xml) — в выдачу не попадают. */
  skipped: { file: string; reason: string }[];
}

const normalize = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim();

export class StationRegistry {
  private readonly byName = new Map<string, Station>();
  private readonly haystack = new Map<string, string>();
  readonly failed: StationLoadResult['failed'] = [];
  readonly skipped: StationLoadResult['skipped'] = [];

  private constructor(result: StationLoadResult) {
    this.skipped.push(...result.skipped);
    for (const station of result.stations) {
      this.byName.set(station.name.toUpperCase(), station);
      this.haystack.set(
        station.name.toUpperCase(),
        normalize([station.name, station.caption, station.amsg, station.index, station.cgms].join(' ')),
      );
    }
    this.failed.push(...result.failed);
  }

  static async load(dir: string): Promise<StationRegistry> {
    const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.xml')).sort();
    const stations: Station[] = [];
    const failed: StationLoadResult['failed'] = [];
    const skipped: StationLoadResult['skipped'] = [];

    await Promise.all(
      files.map(async (file) => {
        try {
          const station = await readStationFile(join(dir, file));
          if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) {
            skipped.push({ file, reason: 'не заданы координаты станции' });
            return;
          }
          if (station.scales.length === 0) {
            skipped.push({ file, reason: 'нет ни одного планшета' });
            return;
          }
          stations.push(station);
        } catch (error) {
          failed.push({ file, message: error instanceof Error ? error.message : String(error) });
        }
      }),
    );

    stations.sort((a, b) => a.caption.localeCompare(b.caption, 'ru'));
    return new StationRegistry({ stations, failed, skipped });
  }

  get size(): number {
    return this.byName.size;
  }

  get(name: string): Station | undefined {
    return this.byName.get(name.toUpperCase());
  }

  all(): Station[] {
    return [...this.byName.values()].sort((a, b) => a.caption.localeCompare(b.caption, 'ru'));
  }

  /** Поиск по названию, коду, индексу ВМО и коду АМСГ. */
  search(query: string): Station[] {
    const q = normalize(query);
    if (!q) return this.all();
    return this.all().filter((s) => this.haystack.get(s.name.toUpperCase())?.includes(q));
  }
}

export function toSummary(station: Station): StationSummary {
  const { charts, raw, ...summary } = station;
  void charts;
  void raw;
  return summary;
}
