import { useEffect, useMemo, useState } from 'react';
import type {
  ChartGeometry,
  DiagramKind,
  ForecastResponse,
  LatLon,
  RunInfo,
  StationSummary,
} from '@rs/shared';
import {
  DEFAULT_DIAGRAM_KIND,
  DIAGRAM_KINDS,
  DIAGRAM_KIND_LABELS,
  SCALES,
  STATION_RADIUS_KM,
  chartPalette,
  coordsStamp,
  diagramPalette,
  emptyChart,
  formatDateTimeUtc,
  isDiagramKind,
  nearestWithin,
  parseUtc,
  releasePlace,
} from '@rs/shared';
import { ApiRequestError, api, type PlaceParams } from './api.js';
import { AeroDiagram } from './components/AeroDiagram.js';
import { AeroLegend } from './components/AeroLegend.js';
import { AeroPanel } from './components/AeroPanel.js';
import { CoordinatesField } from './components/CoordinatesField.js';
import { DownloadMenu } from './components/DownloadMenu.js';
import { ReleaseField, defaultRelease } from './components/ReleaseField.js';
import { ReportPanel } from './components/ReportPanel.js';
import { SondeChart } from './components/SondeChart.js';
import { StationPicker } from './components/StationPicker.js';
import { UserMenu } from './components/UserMenu.js';
import { useTheme } from './lib/theme.js';
import { useUser } from './lib/user.js';

const DEFAULT_STATION = 'ARCHNGL';
const STATION_STORAGE_KEY = 'rs-station';

/** Состояние формы живёт и в адресной строке — ссылкой на схему можно поделиться. */
function readUrlState(): {
  station?: string;
  release?: string;
  scale?: number;
  origin?: LatLon;
  diagram?: DiagramKind;
} {
  const params = new URLSearchParams(window.location.search);
  const station = params.get('station')?.toUpperCase();
  const release = params.get('release');
  const scale = Number(params.get('scale'));
  const coordinate = (name: string): number => Number(params.get(name) || Number.NaN);
  const lat = coordinate('lat');
  const lon = coordinate('lon');
  const diagram = params.get('diagram');

  return {
    ...(station ? { station } : {}),
    ...(release && !Number.isNaN(Date.parse(release))
      ? { release: new Date(release).toISOString() }
      : {}),
    ...(scale === 5 || scale === 10 ? { scale } : {}),
    ...(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { origin: { lat, lon } } : {}),
    ...(isDiagramKind(diagram) ? { diagram } : {}),
  };
}

function writeUrlState(state: {
  station: string;
  release: string;
  scale: number;
  origin: LatLon | null;
  diagram: DiagramKind;
}): void {
  const params = new URLSearchParams(window.location.search);
  params.set('station', state.station);
  params.set('release', state.release);
  params.set('scale', String(state.scale));
  params.set('diagram', state.diagram);
  if (state.origin) {
    params.set('lat', String(Math.round(state.origin.lat * 1e4) / 1e4));
    params.set('lon', String(Math.round(state.origin.lon * 1e4) / 1e4));
  } else {
    params.delete('lat');
    params.delete('lon');
  }
  window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
}

export function App(): React.JSX.Element {
  const { theme, toggle } = useTheme();
  // Без права на координаты — только выбор станции из списка (сервер проверяет то же самое).
  const { canCoordinates } = useUser().user;
  const palette = useMemo(() => chartPalette(theme === 'dark'), [theme]);
  const aeroPalette = useMemo(() => diagramPalette(theme === 'dark'), [theme]);

  const [stations, setStations] = useState<StationSummary[]>([]);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [station, setStation] = useState('');
  /** Точка выпуска по координатам; null — выпуск со станции. */
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [release, setRelease] = useState('');
  const [scale, setScale] = useState(10);
  const [diagramKind, setDiagramKind] = useState<DiagramKind>(
    () => readUrlState().diagram ?? DEFAULT_DIAGRAM_KIND,
  );
  const [chart, setChart] = useState<ChartGeometry | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);
  const [showAirwayLabels, setShowAirwayLabels] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const selected = stations.find((s) => s.name === station);
  const latestRun = runs.at(-1);
  // Точку по координатам рисуем на планшете ближайшей станции — по тому же правилу, что сервер.
  const chartStation = useMemo(
    () => (origin ? nearestWithin(stations, origin, STATION_RADIUS_KM) : selected),
    [origin, stations, selected],
  );
  const scales: readonly number[] = chartStation?.scales ?? SCALES;
  const place = useMemo<PlaceParams>(
    () => (origin ? { lat: origin.lat, lon: origin.lon } : { station }),
    [origin, station],
  );
  const ready = (origin !== null || station !== '') && release !== '';

  const pickStation = (name: string): void => {
    setStation(name);
    // В режиме координат выбор станции подставляет её координаты.
    const picked = stations.find((s) => s.name === name);
    if (origin && picked) setOrigin({ lat: picked.lat, lon: picked.lon });
  };

  const toggleOrigin = (): void =>
    setOrigin(origin || !selected ? null : { lat: selected.lat, lon: selected.lon });

  // Начальная загрузка: список станций и доступные прогоны.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const [stationList, runList] = await Promise.all([
          api.stations(controller.signal),
          api.runs(controller.signal),
        ]);
        setStations(stationList);
        setRuns(runList);

        const fromUrl = readUrlState();
        let storedStation: string | null = null;
        try {
          storedStation = localStorage.getItem(STATION_STORAGE_KEY);
        } catch {
          // Если хранилище недоступно, используем станцию из ссылки или станцию по умолчанию.
        }
        const initial =
          stationList.find((s) => s.name === fromUrl.station) ??
          stationList.find((s) => s.name === storedStation) ??
          stationList.find((s) => s.name === DEFAULT_STATION) ??
          stationList[0];
        if (initial) {
          setStation(initial.name);
          const wanted = fromUrl.scale ?? 10;
          setScale(initial.scales.includes(wanted) ? wanted : (initial.scales[0] ?? 10));
        }
        if (fromUrl.origin && canCoordinates) setOrigin(fromUrl.origin);
        setRelease(fromUrl.release ?? defaultRelease(runList));
      } catch (err) {
        if (controller.signal.aborted) return;
        setBootError(err instanceof Error ? err.message : 'Сервер недоступен');
      }
    })();

    return () => controller.abort();
  }, []);

  // Запоминаем выбранный планшет для следующего захода без параметров в ссылке.
  useEffect(() => {
    if (!station) return;
    try {
      localStorage.setItem(STATION_STORAGE_KEY, station);
    } catch {
      // Недоступность хранилища не мешает выбору планшета.
    }
  }, [station]);

  // Сервер докачивает свежие прогоны в фоне — периодически обновляем список.
  // Пока данных нет, спрашиваем чаще.
  useEffect(() => {
    if (bootError) return;
    const timer = setInterval(
      () => {
        void api
          .runs()
          .then((list) =>
            setRuns((current) => (JSON.stringify(current) === JSON.stringify(list) ? current : list)),
          )
          .catch(() => {});
      },
      runs.length === 0 ? 15_000 : 5 * 60_000,
    );
    return () => clearInterval(timer);
  }, [runs.length, bootError]);

  // Планшет станции в выбранном масштабе; точка по координатам вдали от станций — на пустом.
  // Сдвиг точки в пределах того же планшета его не перезагружает.
  const byCoordinates = origin !== null;
  useEffect(() => {
    if (!chartStation && !byCoordinates) return;
    const effective = scales.includes(scale) ? scale : (scales[0] ?? 10);
    if (effective !== scale) {
      setScale(effective);
      return;
    }
    if (!chartStation) {
      setChart(emptyChart(effective));
      return;
    }

    const controller = new AbortController();
    void api
      .chart(chartStation.name, effective, controller.signal)
      .then(setChart)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить планшет');
        }
      });
    return () => controller.abort();
  }, [chartStation, scale, scales, byCoordinates]);

  // Расчёт траектории: перезапускается при смене места или времени выпуска.
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void api
        .forecast({ ...place, release }, controller.signal)
        .then((result) => {
          setForecast(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setForecast(null);
          // Об отсутствии данных на это время уже говорит выноска под полем времени.
          if (err instanceof ApiRequestError && err.payload?.error === 'no_data_for_time') {
            setError(null);
            return;
          }
          setError(
            err instanceof ApiRequestError
              ? describeApiError(err)
              : err instanceof Error
                ? err.message
                : 'Не удалось рассчитать траекторию',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [place, release, ready, reloadToken]);

  useEffect(() => {
    if (station && release) writeUrlState({ station, release, scale, origin, diagram: diagramKind });
  }, [station, release, scale, origin, diagramKind]);

  const captionLeft = forecast
    ? `${releasePlace(forecast).caption} · выпуск ${formatDateTimeUtc(parseUtc(forecast.release))}`
    : origin
      ? 'Точка выпуска'
      : (selected?.caption ?? '');
  const chartTitle = origin
    ? chartStation
      ? `${chartStation.caption} · выпуск по координатам`
      : 'Выпуск по координатам'
    : (selected?.caption ?? 'Схема');

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold sm:text-lg">
              Прогноз перемещения радиозонда
            </h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              По прогнозам Гидрометцентра России на регулярной сетке 1,25°
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {latestRun && (
              <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 md:inline dark:bg-slate-800 dark:text-slate-300">
                Свежий прогон {formatDateTimeUtc(parseUtc(latestRun.runTime))}
              </span>
            )}
            <UserMenu />
            <button
              type="button"
              onClick={toggle}
              title="Сменить тему"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        {bootError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {bootError}. Проверьте, запущен ли сервер: <code>npm run dev</code>.
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
            <div>
              <StationPicker
                stations={stations}
                value={station}
                onChange={pickStation}
                disabled={stations.length === 0}
                action={
                  canCoordinates && (
                    <button
                      type="button"
                      onClick={toggleOrigin}
                      disabled={!origin && !selected}
                      aria-expanded={origin !== null}
                      aria-controls="origin-coordinates"
                      className="-mx-1.5 -my-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-sky-600 transition hover:bg-sky-50 hover:text-sky-700 disabled:opacity-50 disabled:hover:bg-transparent dark:text-sky-400 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                    >
                      {origin ? 'Выпуск со станции' : 'Задать координаты'}
                    </button>
                  )
                }
              />
              {origin && (
                <CoordinatesField value={origin} onChange={setOrigin} chartStation={chartStation} />
              )}
            </div>
            <ReleaseField value={release} onChange={setRelease} runs={runs} forecast={forecast} />

            <div className="flex flex-wrap items-end gap-2 pt-6">
              <button
                type="button"
                onClick={() => setReloadToken((n) => n + 1)}
                disabled={!ready}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600 disabled:opacity-50"
              >
                Показать
              </button>
              <DownloadMenu
                place={place}
                fileTag={origin ? coordsStamp(origin) : station}
                release={release}
                scales={scales}
                disabled={!forecast}
                onError={setError}
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,460px)]">
          <section className="relative animate-rise rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="text-sm font-semibold">
                {chartTitle}
                <span className="ml-2 font-normal text-slate-400">1 деление — {scale} км</span>
              </h2>

              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={showAirwayLabels}
                    onChange={(event) => setShowAirwayLabels(event.target.checked)}
                    className="checkbox h-3.5 w-3.5"
                  />
                  Подписи трасс
                </label>

                <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
                  {scales.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScale(value)}
                      className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                        scale === value
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {value * 10} км
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {chart ? (
              <div className="mx-auto w-full max-w-[760px]">
                <SondeChart
                  chart={chart}
                  forecast={forecast}
                  palette={palette}
                  hovered={hovered}
                  onHover={setHovered}
                  captionLeft={captionLeft}
                  showAirwayLabels={showAirwayLabels}
                />
              </div>
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400 dark:bg-slate-800">
                Планшет не загружен
              </div>
            )}

            {loading && (
              <div className="absolute right-6 top-16 rounded-full bg-sky-500/90 px-3 py-1 text-xs text-white">
                Расчёт…
              </div>
            )}
          </section>

          <section className="animate-rise rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {forecast ? (
              <ReportPanel forecast={forecast} hovered={hovered} onHover={setHovered} />
            ) : (
              <p className="text-sm text-slate-400">
                Выберите станцию и время выпуска — таблица перемещения появится здесь.
              </p>
            )}
          </section>
        </div>

        {forecast && (
          <section className="animate-rise rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <h2 className="text-sm font-semibold">
                Аэрологическая диаграмма
                <span className="ml-2 font-normal text-slate-400">
                  профиль вдоль траектории зонда, сроки{' '}
                  {forecast.usedSteps.map((s) => `+${s}`).join(', ')} ч
                </span>
              </h2>

              <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
                {DIAGRAM_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setDiagramKind(kind)}
                    title={DIAGRAM_KIND_LABELS[kind].hint}
                    aria-pressed={diagramKind === kind}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                      diagramKind === kind
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {DIAGRAM_KIND_LABELS[kind].short}
                    <span className={`ml-1.5 font-normal ${diagramKind === kind ? 'text-sky-100' : 'text-slate-400'}`}>
                      {DIAGRAM_KIND_LABELS[kind].name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(400px,460px)]">
              <div className="mx-auto w-full max-w-[900px] space-y-4">
                <AeroDiagram
                  aerology={forecast.aerology}
                  palette={aeroPalette}
                  kind={diagramKind}
                  release={forecast.release}
                  hovered={hoveredLevel}
                  onHover={setHoveredLevel}
                />
                <AeroLegend palette={aeroPalette} kind={diagramKind} />
              </div>
              <AeroPanel
                aerology={forecast.aerology}
                hovered={hoveredLevel}
                onHover={setHoveredLevel}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function describeApiError(error: ApiRequestError): string {
  const available = error.payload?.available;
  if (!available?.length) return error.message;
  const windows = available
    .map((w) => `${formatDateTimeUtc(parseUtc(w.from))} — ${formatDateTimeUtc(parseUtc(w.to))}`)
    .join('; ');
  return `${error.message}. Доступные периоды: ${windows}`;
}
