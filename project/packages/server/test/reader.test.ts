import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILE_SIZE, GribField, NX, NY } from '../src/grib/reader.js';

const dataDir = resolve(import.meta.dirname, '../../../data/fixtures/2026080700');

const load = async (name: string): Promise<GribField> =>
  new GribField(await readFile(resolve(dataDir, name)));

describe('GribField', () => {
  it('ожидает файл размером NX×NY×4 байта', async () => {
    const buffer = await readFile(resolve(dataDir, 'mb_850_fcst_006.bin'));
    expect(buffer.length).toBe(FILE_SIZE);
    expect(FILE_SIZE).toBe(NX * NY * 4);
    expect(() => new GribField(buffer.subarray(0, 100))).toThrow(/167040/);
  });

  it('распаковывает значения по образцу из спецификации формата', async () => {
    // Архангельск: 64,62 с.ш. 40,51 в.д.
    const lower = await load('mb_850_fcst_006.bin');
    expect(lower.nearest(40.51, 64.62)).toEqual({
      tempC: 8,
      windDirDeg: 229,
      windSpeedMs: 10,
    });

    const upper = await load('mb_300_fcst_006.bin');
    expect(upper.nearest(40.51, 64.62)).toEqual({
      tempC: -41,
      windDirDeg: 248,
      windSpeedMs: 43,
    });
  });

  it('раскладывает направление и знак температуры по битам', async () => {
    const field = await load('mb_500_fcst_006.bin');
    for (let iy = 0; iy < NY; iy += 17) {
      for (let ix = 0; ix < NX; ix += 31) {
        const s = field.atIndex(ix, iy);
        expect(s.windDirDeg).toBeGreaterThanOrEqual(0);
        expect(s.windDirDeg).toBeLessThanOrEqual(359);
        expect(Math.abs(s.tempC)).toBeLessThanOrEqual(255);
        expect(s.windSpeedMs).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('замыкает сетку по долготе и ограничивает по широте', async () => {
    const field = await load('mb_700_fcst_006.bin');
    expect(field.atIndex(NX, 10)).toEqual(field.atIndex(0, 10));
    expect(field.nearest(360, 0)).toEqual(field.nearest(0, 0));
    expect(field.nearest(40, 95)).toEqual(field.nearest(40, 90));
  });

  it('билинейная выборка совпадает с узловой в самом узле', async () => {
    const field = await load('mb_500_fcst_006.bin');
    const node = field.nearest(40, 65); // 40 = 32×1.25, 65 = 52×1.25 — точный узел
    const interpolated = field.bilinear(40, 65);
    expect(interpolated.tempC).toBeCloseTo(node.tempC, 6);
    expect(interpolated.windSpeedMs).toBeCloseTo(node.windSpeedMs, 6);
    expect(interpolated.windDirDeg).toBeCloseTo(node.windDirDeg, 4);
  });
});
