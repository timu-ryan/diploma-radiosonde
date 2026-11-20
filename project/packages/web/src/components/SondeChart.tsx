import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartGeometry, ChartPalette, ForecastResponse, ViewBox } from '@rs/shared';
import {
  CHART_FONT,
  baseViewBox,
  compassPoint,
  kmToCanvas,
  num,
  renderChartBody,
  viewBoxToString,
} from '@rs/shared';

interface Props {
  chart: ChartGeometry;
  forecast: ForecastResponse | null;
  palette: ChartPalette;
  hovered: number | null;
  onHover: (index: number | null) => void;
  captionLeft: string;
  showAirwayLabels: boolean;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/**
 * Схема планшета. Статическая часть рисуется тем же кодом, что и на сервере
 * (`renderChartBody`), поверх неё React добавляет только слой взаимодействия.
 */
export function SondeChart({
  chart,
  forecast,
  palette,
  hovered,
  onHover,
  captionLeft,
  showAirwayLabels,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const base = useMemo(() => baseViewBox(chart.canvasSize), [chart.canvasSize]);
  const [view, setView] = useState<ViewBox>(base);
  const [tip, setTip] = useState<{ index: number; left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // Новый планшет (другая станция или масштаб) — сбрасываем зум и панораму.
  useEffect(() => setView(base), [base, chart]);

  const body = useMemo(
    () =>
      renderChartBody({
        chart,
        rows: forecast?.rows ?? [],
        path: forecast?.path ?? [],
        origin: forecast?.origin,
        palette,
        captionLeft,
        showAirwayLabels,
      }),
    [chart, forecast, palette, captionLeft, showAirwayLabels],
  );

  const zoom = base.w / view.w;

  const clampView = useCallback(
    (next: ViewBox): ViewBox => {
      const w = Math.min(base.w / MIN_ZOOM, Math.max(base.w / MAX_ZOOM, next.w));
      const h = w * (base.h / base.w);
      const x = Math.min(base.x + base.w - w, Math.max(base.x, next.x));
      const y = Math.min(base.y + base.h - h, Math.max(base.y, next.y));
      return { x, y, w, h };
    },
    [base],
  );

  // Колесо мыши слушаем напрямую: React вешает onWheel пассивно.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;

      setView((current) => {
        const factor = Math.exp(event.deltaY * 0.0018);
        const w = current.w * factor;
        const h = current.h * factor;
        return clampView({
          x: current.x + (current.w - w) * px,
          y: current.y + (current.h - h) * py,
          w,
          h,
        });
      });
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [clampView]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - drag.x) * view.w) / rect.width;
    const dy = ((event.clientY - drag.y) * view.h) / rect.height;
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    setView((current) => clampView({ ...current, x: current.x - dx, y: current.y - dy }));
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
    }
  };

  const zoomBy = (factor: number): void =>
    setView((current) =>
      clampView({
        x: current.x + (current.w - current.w * factor) / 2,
        y: current.y + (current.h - current.h * factor) / 2,
        w: current.w * factor,
        h: current.h * factor,
      }),
    );

  const showTip = (index: number, event: React.PointerEvent<SVGElement>): void => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTip({ index, left: event.clientX - rect.left, top: event.clientY - rect.top });
    onHover(index);
  };

  const hideTip = (): void => {
    setTip(null);
    onHover(null);
  };

  const hoveredRow = hovered !== null ? forecast?.rows[hovered] : undefined;

  return (
    <div ref={containerRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={viewBoxToString(view)}
        className="chart-surface w-full cursor-grab rounded-lg active:cursor-grabbing"
        style={{ aspectRatio: `${base.w} / ${base.h}`, backgroundColor: palette.surface }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView(base)}
        fontFamily={CHART_FONT}
        role="img"
        aria-label={`Схема смещения радиозонда, 1 деление — ${chart.scaleKm} км`}
      >
        <g dangerouslySetInnerHTML={{ __html: body }} />

        {/* Слой взаимодействия: попадание курсора и подсветка активной высоты */}
        {forecast?.rows.map((row, index) => {
          const p = kmToCanvas(
            chart,
            forecast.origin.dxKm + row.dxKm,
            forecast.origin.dyKm + row.dyKm,
          );
          const active = hovered === index;
          return (
            <g
              key={row.no}
              onPointerEnter={(event) => showTip(index, event)}
              onPointerLeave={hideTip}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={p.x} cy={p.y} r={13} fill="transparent" />
              {active && (
                <>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={10}
                    fill={palette.marker}
                    stroke={palette.markerActive}
                    strokeWidth={2.4}
                  />
                  <text
                    x={p.x}
                    y={p.y}
                    fill={palette.markerText}
                    fontSize={11}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="central"
                    pointerEvents="none"
                  >
                    {row.no}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Управление масштабом просмотра */}
      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.4)}
          className="px-2.5 py-1.5 text-base leading-none text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Приблизить"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.4)}
          className="border-t border-slate-200 px-2.5 py-1.5 text-base leading-none text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Отдалить"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setView(base)}
          className="border-t border-slate-200 px-2.5 py-1.5 text-[10px] leading-none text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          title="Сбросить масштаб"
        >
          1:1
        </button>
      </div>

      {zoom > 1.01 && (
        <div className="absolute left-3 top-3 rounded-md bg-slate-900/70 px-2 py-1 text-[11px] font-medium text-white">
          ×{num(zoom, 1)}
        </div>
      )}

      {tip && hoveredRow && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[220px] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            №{hoveredRow.no} · {num(hoveredRow.heightM / 1000, 1)} км
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
            <dt>Время</dt>
            <dd className="tabular-nums">{Math.round(hoveredRow.timeMin)} мин</dd>
            <dt>Азимут</dt>
            <dd className="tabular-nums">
              {Math.round(hoveredRow.azimuthDeg)}° ({compassPoint(hoveredRow.azimuthDeg)})
            </dd>
            <dt>Удаление</dt>
            <dd className="tabular-nums">{num(hoveredRow.distanceKm, 1)} км</dd>
            <dt>Ветер</dt>
            <dd className="tabular-nums">
              {Math.round(hoveredRow.windDirDeg)}° {Math.round(hoveredRow.windSpeedMs)} м/с
            </dd>
            <dt>Температура</dt>
            <dd className="tabular-nums">{Math.round(hoveredRow.tempC)} °C</dd>
          </dl>
        </div>
      )}
    </div>
  );
}
