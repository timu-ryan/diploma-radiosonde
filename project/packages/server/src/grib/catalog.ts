import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mbToFl, flToMeters, runWindow, type RunInfo } from '@rs/shared';

const RUN_DIR_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})$/;
const FILE_RE = /^mb_(\d+)_fcst_(\d+)\.bin$/;

const HOUR_MS = 3600_000;

export interface LevelInfo {
  /** Изобарический уровень, гПа. */
  mb: number;
  /** Эшелон. */
  fl: number;
  /** Высота уровня, м (FL × 30). */
  heightM: number;
  /** Заблаговременности, для которых есть файл этого уровня. */
  steps: number[];
}

export interface Run {
  id: string;
  runTime: Date;
  steps: number[];
  levels: LevelInfo[];
  dir: string;
  /** Ключ `${mb}:${step}` → путь к файлу. */
  files: Map<string, string>;
}

export function runIdToDate(id: string): Date | undefined {
  const m = RUN_DIR_RE.exec(id);
  if (!m) return undefined;
  const [, y, mo, d, h] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h)));
}

/** Период действия прогона: от первого срока − 1,5 ч до последнего + 1,5 ч (не включительно). */
function coverage(run: Run): { from: Date; to: Date } {
  const window = runWindow(run.steps) ?? { from: 0, to: 0 };
  const t = run.runTime.getTime();
  return { from: new Date(t + window.from * HOUR_MS), to: new Date(t + window.to * HOUR_MS) };
}

export function toRunInfo(run: Run): RunInfo {
  const { from, to } = coverage(run);
  return {
    id: run.id,
    runTime: run.runTime.toISOString(),
    steps: run.steps,
    levels: run.levels.map((l) => l.mb),
    validFrom: from.toISOString(),
    validTo: to.toISOString(),
  };
}

/** Каталог прогонов модели. Пересканируется, когда меняется содержимое каталога данных. */
export class GribCatalog {
  private runs: Run[] = [];
  private scannedAt = 0;
  private signature = '';

  constructor(
    private readonly dataDir: string,
    private readonly ttlMs = 15_000,
  ) {}

  /** Актуальный список прогонов, от старых к новым. */
  async list(): Promise<Run[]> {
    await this.refresh();
    return this.runs;
  }

  async get(id: string): Promise<Run | undefined> {
    await this.refresh();
    return this.runs.find((r) => r.id === id);
  }

  /**
   * Последний прогон, покрывающий указанное время выпуска.
   * Предпочитается самый свежий: он точнее.
   */
  async pickRun(release: Date): Promise<Run | undefined> {
    await this.refresh();
    const t = release.getTime();
    return [...this.runs]
      .reverse()
      .find((run) => t >= this.validFrom(run).getTime() && t < this.validTo(run).getTime());
  }

  validFrom(run: Run): Date {
    return coverage(run).from;
  }

  validTo(run: Run): Date {
    return coverage(run).to;
  }

  filePath(run: Run, mb: number, step: number): string | undefined {
    return run.files.get(`${mb}:${step}`);
  }

  async refresh(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.scannedAt < this.ttlMs) return;
    this.scannedAt = now;

    const entries = await readdir(this.dataDir, { withFileTypes: true }).catch(() => []);
    const runDirs = entries
      .filter((e) => e.isDirectory() && RUN_DIR_RE.test(e.name))
      .map((e) => e.name)
      .sort();

    // Дёшево проверяем, изменилось ли что-нибудь, прежде чем читать содержимое папок.
    const stamps = await Promise.all(
      runDirs.map(async (name) => {
        const info = await stat(join(this.dataDir, name)).catch(() => undefined);
        return `${name}:${info?.mtimeMs ?? 0}`;
      }),
    );
    const signature = stamps.join('|');
    if (!force && signature === this.signature && this.runs.length > 0) return;
    this.signature = signature;

    const runs: Run[] = [];
    for (const id of runDirs) {
      const runTime = runIdToDate(id);
      if (!runTime) continue;

      const dir = join(this.dataDir, id);
      const files = new Map<string, string>();
      const stepsByMb = new Map<number, Set<number>>();
      const allSteps = new Set<number>();

      for (const file of await readdir(dir).catch(() => [])) {
        const m = FILE_RE.exec(file);
        if (!m) continue;
        const mb = Number(m[1]);
        const step = Number(m[2]);
        if (mbToFl(mb) === undefined) continue;

        files.set(`${mb}:${step}`, join(dir, file));
        allSteps.add(step);
        const set = stepsByMb.get(mb) ?? new Set<number>();
        set.add(step);
        stepsByMb.set(mb, set);
      }

      if (files.size === 0) continue;

      const levels: LevelInfo[] = [...stepsByMb.entries()]
        .map(([mb, steps]) => {
          const fl = mbToFl(mb) as number;
          return { mb, fl, heightM: flToMeters(fl), steps: [...steps].sort((a, b) => a - b) };
        })
        // снизу вверх: от большего давления к меньшему
        .sort((a, b) => b.mb - a.mb);

      runs.push({ id, runTime, steps: [...allSteps].sort((a, b) => a - b), levels, dir, files });
    }

    this.runs = runs;
  }
}
