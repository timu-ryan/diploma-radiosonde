import { readFile } from 'node:fs/promises';
import {
  normalizeLon,
  vectorToWind,
  windToVector,
  type InterpMode,
  type WindVector,
} from '@rs/shared';

/** Параметры сетки из спецификации формата. */
export const NX = 288;
export const NY = 145;
export const DENSITY = 0.8;
export const BIN_SIZE = 4;
export const FILE_SIZE = NX * NY * BIN_SIZE;

/** Маска бита знака температуры (11-й бит в поле направления ветра). */
const MASK_TEST_PLUS_TMP = 0b10000000000;
/** Маска сброса знака — остаётся собственно направление. */
const MASK_RESET_PLUS_TMP = 0b1111111111;

export interface GribSample {
  /** Температура воздуха, °C (со знаком). */
  tempC: number;
  /** Направление ветра (откуда дует), град. */
  windDirDeg: number;
  /** Скорость ветра, м/с. */
  windSpeedMs: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Одно поле прогноза: уровень + заблаговременность. */
export class GribField {
  constructor(readonly buffer: Buffer) {
    if (buffer.length !== FILE_SIZE) {
      throw new Error(
        `Ожидался файл размером ${FILE_SIZE} байт (${NX}×${NY}×${BIN_SIZE}), получено ${buffer.length}`,
      );
    }
  }

  /** Значение в узле сетки по индексам (x — долгота циклически, y — широта). */
  atIndex(ix: number, iy: number): GribSample {
    const x = ((ix % NX) + NX) % NX;
    const y = clamp(iy, 0, NY - 1);
    const offset = (y * NX + x) * BIN_SIZE;

    const tmp = this.buffer.readUInt8(offset);
    const raw = this.buffer.readUInt16BE(offset + 1);
    const speed = this.buffer.readUInt8(offset + 3);

    return {
      tempC: (raw & MASK_TEST_PLUS_TMP ? 1 : -1) * tmp,
      windDirDeg: raw & MASK_RESET_PLUS_TMP,
      windSpeedMs: speed,
    };
  }

  /** Ближайший узел сетки — способ выборки из спецификации формата. */
  nearest(lon: number, lat: number): GribSample {
    const x = Math.max(0, Math.round(normalizeLon(lon) * DENSITY));
    const y = Math.max(0, Math.round((lat + 90) * DENSITY));
    return this.atIndex(x, y);
  }

  /** Билинейная интерполяция по четырём узлам (ветер интерполируется покомпонентно). */
  bilinear(lon: number, lat: number): GribSample {
    const fx = normalizeLon(lon) * DENSITY;
    const fy = clamp((lat + 90) * DENSITY, 0, NY - 1);
    const x0 = Math.floor(fx);
    const y0 = clamp(Math.floor(fy), 0, NY - 2);
    const tx = fx - x0;
    const ty = fy - y0;

    const corners = [
      { s: this.atIndex(x0, y0), w: (1 - tx) * (1 - ty) },
      { s: this.atIndex(x0 + 1, y0), w: tx * (1 - ty) },
      { s: this.atIndex(x0, y0 + 1), w: (1 - tx) * ty },
      { s: this.atIndex(x0 + 1, y0 + 1), w: tx * ty },
    ];

    let tempC = 0;
    const vec: WindVector = { u: 0, v: 0 };
    for (const { s, w } of corners) {
      tempC += s.tempC * w;
      const c = windToVector(s.windDirDeg, s.windSpeedMs);
      vec.u += c.u * w;
      vec.v += c.v * w;
    }

    const wind = vectorToWind(vec);
    return { tempC, windDirDeg: wind.dirDeg, windSpeedMs: wind.speedMs };
  }

  sample(lon: number, lat: number, mode: InterpMode): GribSample {
    return mode === 'bilinear' ? this.bilinear(lon, lat) : this.nearest(lon, lat);
  }

  /** Вектор переноса в точке, м/с. */
  wind(lon: number, lat: number, mode: InterpMode): WindVector {
    const s = this.sample(lon, lat, mode);
    return windToVector(s.windDirDeg, s.windSpeedMs);
  }
}

/** LRU-кэш полей: файл ≈163 КБ, при 120 записях ≈20 МБ. */
export class GribFieldCache {
  private readonly cache = new Map<string, GribField>();
  private readonly pending = new Map<string, Promise<GribField>>();

  constructor(private readonly maxEntries: number) {}

  async load(path: string): Promise<GribField> {
    const cached = this.cache.get(path);
    if (cached) {
      this.cache.delete(path);
      this.cache.set(path, cached);
      return cached;
    }

    const inFlight = this.pending.get(path);
    if (inFlight) return inFlight;

    const promise = readFile(path)
      .then((buffer) => {
        const field = new GribField(buffer);
        this.cache.set(path, field);
        while (this.cache.size > this.maxEntries) {
          const oldest = this.cache.keys().next();
          if (oldest.done) break;
          this.cache.delete(oldest.value);
        }
        return field;
      })
      .finally(() => {
        this.pending.delete(path);
      });

    this.pending.set(path, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }
}
