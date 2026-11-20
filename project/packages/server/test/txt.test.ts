import { describe, expect, it } from 'vitest';
import type { ForecastResponse } from '@rs/shared';
import { renderTxtReport } from '../src/report/txt.js';

/** Числа из предоставленного образца отчёта; формат проверяется независимо от GRIB. */
function exampleForecast(): ForecastResponse {
  const values = [
    [1500, 219, 12, 5, 45, 4, 4],
    [3000, 222, 12, 5, 43, 7, 4],
    [5000, 225, 17, 7, 44, 14, 7],
    [7000, 225, 19, 7, 44, 21, 8],
    [9000, 224, 21, 7, 44, 30, 9],
    [12000, 225, 23, 10, 45, 43, 14],
    [16000, 238, 20, 13, 48, 57, 16],
  ] as const;

  return {
    station: {
      name: 'ARCHNGL', caption: 'Архангельск', index: '22550', amsg: '',
      lat: 64.62, lon: 40.51, hms: '', cgms: '', ugms: '', scales: [10, 5],
    },
    origin: { lat: 64.62, lon: 40.51, custom: false, dxKm: 0, dyKm: 0 },
    release: '2026-11-17T11:30:00Z',
    run: {
      id: '2026111700', runTime: '2026-11-17T00:00:00Z', steps: [12], levels: [],
      validFrom: '2026-11-17T10:30:00Z', validTo: '2026-11-17T13:30:00Z',
    },
    usedSteps: [12],
    stepPeriods: [],
    ascentRateMs: 5,
    interp: 'nearest',
    rows: values.map(([heightM, windDirDeg, windSpeedMs, layerTimeMin, azimuthDeg, distanceKm, layerDistanceKm], i) => ({
      no: i + 1, mb: 850, fl: 50, heightM, timeMin: heightM / 300, layerTimeMin,
      layerDistanceKm, azimuthDeg, distanceKm, lat: 64.62, lon: 40.51,
      dxKm: 0, dyKm: 0, tempC: 0, windDirDeg, windSpeedMs,
    })),
    path: [],
    crossings: [
      {
        airway: 'Л93', fromHeightM: 0, toHeightM: 600, fromTimeMin: 0, toTimeMin: 2,
        fromAzimuthDeg: 0, toAzimuthDeg: 63, fromDistanceKm: 0, toDistanceKm: 1, exited: true,
      },
      {
        airway: 'Т825', fromHeightM: 1200, toHeightM: 16000, fromTimeMin: 4, toTimeMin: 16000 / 300,
        fromAzimuthDeg: 54, toAzimuthDeg: 48, fromDistanceKm: 3, toDistanceKm: 57, exited: false,
      },
    ],
    aerology: {
      levels: [],
      analysis: { tropopauses: [], isotherms: [], stableLayers: [], turbulence: [], meanWinds: [] },
    },
    totalTimeMin: 16000 / 300,
    topHeightM: 16000,
    warnings: [],
    generatedAt: '2026-11-17T11:01:16Z',
  };
}

describe('текстовый бланк', () => {
  it('повторяет предоставленный образец с правильным написанием «подъёма»', () => {
    const expected = `        ПРОГНОЗ ПЕРЕМЕЩЕНИЯ РАДИОЗОНДА
 на 11:30 UTC  " 17 " 11 2026
            Архангельск
 Высота 1500   Ветер  219-12 Время подъёма(мин) 5   Азимут(°) 045 Удаление(км) 004  Смещение(км) 4
 Высота 3000   Ветер  222-12 Время подъёма(мин) 5   Азимут(°) 043 Удаление(км) 007  Смещение(км) 4
 Высота 5000   Ветер  225-17 Время подъёма(мин) 7   Азимут(°) 044 Удаление(км) 014  Смещение(км) 7
 Высота 7000   Ветер  225-19 Время подъёма(мин) 7   Азимут(°) 044 Удаление(км) 021  Смещение(км) 8
 Высота 9000   Ветер  224-21 Время подъёма(мин) 7   Азимут(°) 044 Удаление(км) 030  Смещение(км) 9
 Высота 12000  Ветер  225-23 Время подъёма(мин) 10  Азимут(°) 045 Удаление(км) 043  Смещение(км) 14
 Высота 16000  Ветер  238-20 Время подъёма(мин) 13  Азимут(°) 048 Удаление(км) 057  Смещение(км) 16

 Пересекаемые трассы, высоты, время:
 Радиозонд будет пересекать трассу Л93 в аз. 0 - 63° на уд. 0 - 1 км в слое 0 - 600 м в 11:30:00 - 11:32:00 UTC
 Радиозонд будет пересекать трассу Т825 в аз. 54 - XXX° на уд. 3 - XXX км в слое 1200 - XXX м в 11:34:00 - XXX UTC

 Дежурный синоптик:  _________________________  UTC



 РПА            ____________________________ ч. ________ мин. UTC
`;
    expect(renderTxtReport(exampleForecast())).toBe(expected.replace(/\n/g, '\r\n'));
  });

  it('сохраняет обе границы короткого пересечения и округляет азимут 360° в 0°', () => {
    const forecast = exampleForecast();
    const crossing = forecast.crossings[0] as ForecastResponse['crossings'][number];
    forecast.crossings = [{
      ...crossing, fromHeightM: 0, toHeightM: 30, toTimeMin: 0.1,
      fromAzimuthDeg: 359.6, toAzimuthDeg: 359.9,
    }];
    forecast.release = '2026-11-17T23:59:58Z';

    expect(renderTxtReport(forecast)).toContain(
      'трассу Л93 в аз. 0 - 0° на уд. 0 - 1 км в слое 0 - 30 м в 23:59:58 - 00:00:04 UTC',
    );
  });

  it('объясняет отсутствие пересечений и сохраняет предупреждения о данных', () => {
    const forecast = exampleForecast();
    forecast.crossings = [];
    forecast.warnings = ['В прогоне нет верхних уровней.'];

    const text = renderTxtReport(forecast);
    expect(text).toContain('Пересечений трасс на рассчитанном участке не найдено.');
    expect(text).toContain('Примечания:\r\n  — В прогоне нет верхних уровней.');
    expect(text).not.toContain('Радиозонд будет');
  });

  it('отличает отсутствие планшета от отсутствия пересечений', () => {
    const forecast = exampleForecast();
    delete forecast.station;
    forecast.origin = { lat: 45, lon: -40, custom: true, dxKm: 0, dyKm: 0 };
    forecast.crossings = [];

    const text = renderTxtReport(forecast);
    expect(text).toContain('Точка выпуска   45,00 с.ш. 40,00 з.д.');
    expect(text).toContain('Пересечение трасс не проверялось: рядом нет планшета станции.');
    expect(text).not.toContain('Пересечений трасс на рассчитанном участке не найдено.');
  });
});
