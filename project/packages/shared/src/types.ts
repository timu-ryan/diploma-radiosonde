/** Типы, общие для сервера и клиента. */

import type { LatLon } from './geo.js';
import type { StepPeriod } from './steps.js';

/** Точка на холсте планшета (536×536). */
export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartPolyline {
  points: ChartPoint[];
  /** ps="Dot" в XML — пунктир. */
  dashed: boolean;
}

export interface ChartAirway {
  caption: string;
  points: ChartPoint[];
}

export interface ChartLabel {
  caption: string;
  x: number;
  y: number;
  /** angle в XML задан в десятых долях градуса; здесь — градусы. */
  angleDeg: number;
}

/** Чертёж станции в одном масштабе. */
export interface ChartGeometry {
  /** Км на одно деление (кольцо): 10 или 5. */
  scaleKm: number;
  /** Радиус планшета в км. */
  radiusKm: number;
  /** Пикселей на километр на холсте 536×536. */
  pxPerKm: number;
  canvasSize: number;
  center: ChartPoint;
  rings: number;
  boldRing: number;
  polylines: ChartPolyline[];
  airways: ChartAirway[];
  labels: ChartLabel[];
}

/** Краткая карточка станции для списка и поиска. */
export interface StationSummary {
  /** Латинский код (имя файла), например ARCHNGL. */
  name: string;
  /** Название по-русски. */
  caption: string;
  /** Название АМЦ/АМСГ. */
  amsg: string;
  /** Индекс ВМО. */
  index: string;
  lat: number;
  lon: number;
  hms: string;
  cgms: string;
  ugms: string;
  /** Масштабы, для которых есть чертёж. */
  scales: number[];
}

export interface Station extends StationSummary {
  charts: Record<string, ChartGeometry>;
  /** Служебные атрибуты исходного XML, в расчёте не используются. */
  raw: { start: string; center: string; lastmess: string; mailTo: string };
}

/** Прогон модели и его наполнение. */
export interface RunInfo {
  /** Имя папки, например 2026080700. */
  id: string;
  /** Момент выпуска прогноза, ISO UTC. */
  runTime: string;
  /** Заблаговременности в часах. */
  steps: number[];
  /** Изобарические уровни в гПа, снизу вверх. */
  levels: number[];
  /** Начало периода действия: первый срок − 1,5 ч (ISO UTC, включительно). */
  validFrom: string;
  /** Конец периода действия: последний срок + 1,5 ч (ISO UTC, не включительно). */
  validTo: string;
}

export type InterpMode = 'nearest' | 'bilinear';

/** Строка таблицы смещения — одна высота отчёта. */
export interface TrajectoryRow {
  /** Порядковый номер строки. */
  no: number;
  /** Ближайший изобарический уровень, гПа: с него взяты ветер и температура. */
  mb: number;
  /** Эшелон ближайшего уровня. */
  fl: number;
  /** Высота, м. */
  heightM: number;
  /** Время подъёма от выпуска, мин (нарастающим итогом). */
  timeMin: number;
  /** Время подъёма в слое от предыдущей высоты, мин. */
  layerTimeMin: number;
  /** Смещение в слое от предыдущей высоты, км. */
  layerDistanceKm: number;
  /** Азимут со станции на точку, град. */
  azimuthDeg: number;
  /** Удаление от станции, км. */
  distanceKm: number;
  lat: number;
  lon: number;
  /** Смещение к востоку/северу от станции, км (для отрисовки). */
  dxKm: number;
  dyKm: number;
  /** Температура воздуха на уровне, °C. */
  tempC: number;
  /** Направление ветра (откуда), град. */
  windDirDeg: number;
  /** Скорость ветра, м/с. */
  windSpeedMs: number;
}

/** Точка сплошной траектории. */
export interface TrajectoryPathPoint {
  timeMin: number;
  heightM: number;
  dxKm: number;
  dyKm: number;
  lat: number;
  lon: number;
}

/** Один заход радиозонда в коридор трассы: от входа до выхода. */
export interface AirwayCrossing {
  /** Название трассы (без номера участка). */
  airway: string;
  /** Высота входа в трассу, м (0 — выпуск внутри коридора). */
  fromHeightM: number;
  /** Высота выхода, м (если зонд не вышел — конец пути). */
  toHeightM: number;
  /** Время входа от выпуска, мин. */
  fromTimeMin: number;
  /** Время выхода от выпуска, мин. */
  toTimeMin: number;
  /** Азимуты входа и конца участка от центра планшета станции, град. */
  fromAzimuthDeg: number;
  toAzimuthDeg: number;
  /** Удаления входа и конца участка от центра планшета станции, км. */
  fromDistanceKm: number;
  toDistanceKm: number;
  /** Зонд вышел из коридора; false — рассчитанный путь закончился внутри него. */
  exited: boolean;
}

/**
 * Изобарический уровень на аэрологической диаграмме: значения взяты в той точке
 * и в тот момент, когда зонд проходит высоту уровня.
 */
export interface AeroLevel {
  mb: number;
  fl: number;
  /** Высота уровня, м (FL × 30). */
  heightM: number;
  /** Время прохождения высоты уровня от выпуска, мин. */
  timeMin: number;
  lat: number;
  lon: number;
  tempC: number;
  /** Направление ветра (откуда), град. */
  windDirDeg: number;
  windSpeedMs: number;
}

/** Слой между двумя высотами; давление на границах — для отрисовки на диаграмме. */
export interface AeroLayer {
  fromHeightM: number;
  toHeightM: number;
  fromMb: number;
  toMb: number;
}

export interface AeroTropopause {
  mb: number;
  heightM: number;
  tempC: number;
}

/** Высота изотермы 0, −10 или −20 °C. */
export interface AeroIsotherm {
  tempC: number;
  heightM: number;
  mb: number;
  /** Температура нижнего уровня уже ниже изотермы: высота — нижний уровень, «ниже него». */
  belowData?: boolean;
}

/** Слой инверсии (температура растёт с высотой) или изотермии. */
export interface AeroStableLayer extends AeroLayer {
  kind: 'inversion' | 'isotherm';
  /** Изменение температуры в слое (верх − низ), °C. */
  deltaT: number;
}

/** Слой с числом Ричардсона ниже порога — возможна болтанка. */
export interface AeroTurbulence extends AeroLayer {
  /** Наименьшее число Ричардсона в слое. */
  ri: number;
  /** Наибольший вертикальный сдвиг ветра в слое, м/с на 1 км. */
  shearMsPerKm: number;
}

export interface AeroMaxWind {
  mb: number;
  heightM: number;
  dirDeg: number;
  speedMs: number;
}

/** Средний ветер в слое от точки выпуска до высоты строки отчёта. */
export interface AeroMeanWind {
  heightM: number;
  dirDeg: number;
  speedMs: number;
}

/** Обработка диаграммы — то, что можно получить без данных о влажности. */
export interface AeroAnalysis {
  tropopauses: AeroTropopause[];
  isotherms: AeroIsotherm[];
  /** Слой 0…−20 °C: обледенение возможно, если в нём есть облака. */
  icing?: AeroLayer & { belowData?: boolean };
  stableLayers: AeroStableLayer[];
  maxWind?: AeroMaxWind;
  /** Струйное течение: слой со скоростью не меньше порога вокруг максимального ветра. */
  jet?: AeroLayer;
  turbulence: AeroTurbulence[];
  meanWinds: AeroMeanWind[];
  /** Vertical Totals = T850 − T500, если оба уровня есть. */
  verticalTotals?: number;
}

export interface AeroSounding {
  levels: AeroLevel[];
  analysis: AeroAnalysis;
}

/** Точка выпуска радиозонда. */
export interface ReleaseOrigin extends LatLon {
  /** Задана координатами, а не выбором станции. */
  custom: boolean;
  /**
   * Смещение точки выпуска от центра планшета к востоку и северу, км. При выпуске
   * со станции и на пустом планшете — нули: точка выпуска и есть центр.
   */
  dxKm: number;
  dyKm: number;
}

export interface ForecastRequest {
  /** Станция выпуска; не нужна, если задана точка `origin`. */
  station?: string;
  /** Точка выпуска по координатам — вместо станции. */
  origin?: LatLon;
  /** Время выпуска радиозонда, ISO UTC. */
  release: string;
  run?: string;
  interp?: InterpMode;
  /** Скорость подъёма, м/с. */
  ascent?: number;
}

export interface ForecastResponse {
  /**
   * Станция, чей планшет использован: станция выпуска или, при выпуске по координатам,
   * ближайшая в пределах `STATION_RADIUS_KM`. Нет — рядом станций нет: планшет пустой,
   * трассы не проверяются.
   */
  station?: StationSummary;
  origin: ReleaseOrigin;
  /** Время выпуска, ISO UTC. */
  release: string;
  run: RunInfo;
  /** Заблаговременности прогноза, использованные при расчёте. */
  usedSteps: number[];
  /** Какой срок в какую часть подъёма действовал (по порядку). */
  stepPeriods: StepPeriod[];
  ascentRateMs: number;
  interp: InterpMode;
  rows: TrajectoryRow[];
  path: TrajectoryPathPoint[];
  /** Пересекаемые воздушные трассы по чертежу станции. */
  crossings: AirwayCrossing[];
  /** Аэрологическая диаграмма: уровни вдоль траектории и их обработка. */
  aerology: AeroSounding;
  /** Полное время подъёма до верхней высоты отчёта, мин. */
  totalTimeMin: number;
  /** Верхняя высота отчёта, м. */
  topHeightM: number;
  warnings: string[];
  /** Момент расчёта, ISO. */
  generatedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  /** Доступные периоды выпуска, если ошибка связана с отсутствием данных. */
  available?: { run: string; from: string; to: string }[];
}

/** Вошедший пользователь (`GET /api/auth/me`, ответ на вход). */
export interface CurrentUser {
  id: number;
  login: string;
  fio: string;
  /** Управляет пользователями в админке. */
  isAdmin: boolean;
  /** Может считать выпуск по произвольным координатам, а не только со станции. */
  canCoordinates: boolean;
}

export interface LoginRequest {
  login: string;
  password: string;
}

/** Смена собственного пароля. */
export interface ChangePasswordRequest {
  current: string;
  next: string;
}

/** Почта и место работы пользователя — справочно для администратора; пустая строка — не указано. */
export interface UserContacts {
  email: string;
  organization: string;
  filial: string;
  /** АМЦ/АМСГ. */
  subdivision: string;
}

/** Пользователь в списке админки. */
export interface AdminUser extends CurrentUser, UserContacts {
  comment: string;
  /** Отключённый пользователь не может войти, его сессии недействительны. */
  active: boolean;
  /** ISO UTC. */
  createdAt: string;
  /** ISO UTC; null — ещё не входил. */
  lastLoginAt: string | null;
}

/** Минимальная длина пароля: проверяет сервер, подсказывает форма. */
export const MIN_PASSWORD_LENGTH = 8;

export interface CreateUserRequest extends Partial<UserContacts> {
  login: string;
  password: string;
  fio?: string;
  comment?: string;
  isAdmin?: boolean;
  canCoordinates?: boolean;
}

/** Ключ API в списке админки (`GET /api/admin/keys`); сам ключ виден только при выдаче. */
export interface ApiKeyInfo {
  id: number;
  /** Владелец: запросы по ключу идут от его имени и с его правами. */
  userId: number;
  login: string;
  /** Для чего ключ: какой сайт или сервер. */
  name: string;
  /** Начало ключа, например `rsk_AbCd1234` — узнать его в настройках другого сайта. */
  prefix: string;
  /** ISO UTC. */
  createdAt: string;
  /** ISO UTC, с точностью до минуты; null — ключом ещё не пользовались. */
  lastUsedAt: string | null;
}

export interface CreateApiKeyRequest {
  userId: number;
  name: string;
}

/** Ответ на выдачу ключа — единственный раз, когда ключ виден целиком. */
export interface CreatedApiKey extends ApiKeyInfo {
  key: string;
}

/** Что скачано: бланк .txt, бланк со схемой или аэрологическая диаграмма. */
export type JournalProduct = 'report' | 'chart' | 'diagram';

/** Откуда скачано: с сайта (вход по паролю) или другим сайтом по ключу API. */
export type JournalSource = 'site' | 'key';

/** Запись журнала выпусков (`GET /api/admin/journal`): одно скачивание. */
export interface JournalEntry {
  id: number;
  /** Когда скачано, ISO UTC. */
  at: string;
  userId: number;
  /** Логин и Ф.И.О. на момент выпуска: пользователя могли переименовать или удалить. */
  login: string;
  fio: string;
  product: JournalProduct;
  /** Радиус схемы в км (100, 50) или вид диаграммы (`skewt`, `stuve`); у бланка .txt — пусто. */
  variant: string;
  /** Код станции; null — выпуск по координатам. */
  station: string | null;
  /** Название станции или «Точка выпуска у ст. …». */
  place: string;
  lat: number;
  lon: number;
  /** Время выпуска зонда, ISO UTC. */
  release: string;
  /** Прогон, по которому считано, например 2026080700. */
  run: string;
  /** Название ключа API на момент выпуска, если скачано по ключу; null — с сайта. */
  apiKey: string | null;
}

export interface JournalPage {
  /** Новые сверху. */
  entries: JournalEntry[];
  /** Есть записи старше: следующая страница — `before` = id последней. */
  more: boolean;
}

/** Правка пользователя: передаются только меняемые поля. */
export interface UpdateUserRequest extends Partial<UserContacts> {
  fio?: string;
  comment?: string;
  isAdmin?: boolean;
  canCoordinates?: boolean;
  active?: boolean;
  /** Новый пароль; старые сессии пользователя после смены недействительны. */
  password?: string;
}
