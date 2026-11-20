/**
 * Контракт `/api/v1` — API для других сайтов (вход по ключу API, см. README).
 * В отличие от `/api/*`, которым пользуется свой фронтенд и который меняется вместе с ним,
 * здесь поля можно только добавлять: переименовать или убрать — только в новой версии.
 * Сервер собирает эти ответы явно, по полю, из внутренних типов (routes/v1.ts).
 */

/** Прогон модели (`GET /api/v1/runs`). */
export interface V1Run {
  /** Например 2026080700 — значение для параметра `run`. */
  id: string;
  /** Время прогона, ISO UTC. */
  runTime: string;
  /** По прогону можно считать выпуски с `validFrom` (включительно) до `validTo`, ISO UTC. */
  validFrom: string;
  validTo: string;
}

/** Аэрологическая станция (`GET /api/v1/stations`). */
export interface V1Station {
  /** Код — значение для параметра `station`, например ARCHNGL. */
  name: string;
  /** Название по-русски. */
  caption: string;
  /** Индекс ВМО. */
  index: string;
  /** АМЦ/АМСГ. */
  amsg: string;
  lat: number;
  lon: number;
}

/** Точка траектории. */
export interface V1Point {
  /** Время от выпуска, мин. */
  timeMin: number;
  /** Высота, м. */
  heightM: number;
  lat: number;
  lon: number;
}

/** Строка бланка на фиксированной высоте. */
export interface V1Level extends V1Point {
  /** Изобарический уровень, гПа, с которого взяты ветер и температура. */
  pressureHpa: number;
  /** Удаление от точки выпуска, км, и азимут на зонд, град. */
  distanceKm: number;
  azimuthDeg: number;
  tempC: number;
  /** Откуда дует ветер, град. */
  windDirDeg: number;
  windSpeedMs: number;
}

/** Заход зонда в коридор воздушной трассы. */
export interface V1AirwayCrossing {
  airway: string;
  /** Высота входа, м (0 — выпуск внутри коридора). */
  fromHeightM: number;
  /** Высота конца участка, м: выход из коридора или конец рассчитанного пути. */
  toHeightM: number;
  /** Время входа от выпуска, мин. */
  fromTimeMin: number;
  /** Время конца участка от выпуска, мин. */
  toTimeMin: number;
  /** Азимуты входа и конца участка от центра планшета станции, градусы в диапазоне [0, 360). */
  fromAzimuthDeg: number;
  toAzimuthDeg: number;
  /** Удаления входа и конца участка от центра планшета станции, км. */
  fromDistanceKm: number;
  toDistanceKm: number;
  /** Зонд вышел из коридора; false — рассчитанный путь закончился внутри него. */
  exited: boolean;
}

/** Расчёт траектории (`GET /api/v1/trajectory`). */
export interface V1Trajectory {
  /** Время выпуска зонда, ISO UTC. */
  release: string;
  run: V1Run;
  /** Точка выпуска. */
  origin: { lat: number; lon: number };
  /** Станция выпуска; null — выпуск по координатам. */
  station: V1Station | null;
  /** Скорость подъёма, м/с. */
  ascentRateMs: number;
  /** Сплошная линия траектории — для карты. */
  path: V1Point[];
  /** Строки бланка: фиксированные высоты до верхнего доступного уровня. */
  levels: V1Level[];
  /** Пересечения трасс — если рядом с точкой выпуска есть станция с трассами на планшете. */
  crossings: V1AirwayCrossing[];
  /** Неполнота данных: пропущенный уровень, укороченный бланк и т. п. */
  warnings: string[];
}
