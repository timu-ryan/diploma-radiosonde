import { useMemo, useRef, useState } from 'react';
import type { AeroSounding, DiagramKind, DiagramPalette } from '@rs/shared';
import {
  CHART_FONT,
  DIAGRAM_HEIGHT,
  DIAGRAM_KIND_LABELS,
  DIAGRAM_PLOT,
  DIAGRAM_WIDTH,
  diagramProjection,
  formatMeters,
  formatTemp,
  formatTimeUtc,
  parseUtc,
  renderDiagramBody,
} from '@rs/shared';

interface Props {
  aerology: AeroSounding;
  palette: DiagramPalette;
  /** Вид диаграммы: АДК (skew-T) или АДП (Штюве). */
  kind: DiagramKind;
  /** Время выпуска, ISO UTC — для времени прохождения уровней. */
  release: string;
  /** Индекс подсвеченного уровня в `aerology.levels`. */
  hovered: number | null;
  onHover: (index: number | null) => void;
}

/**
 * Аэрологическая диаграмма. Статическую часть рисует общий код (`renderDiagramBody`),
 * тот же, что отдаёт сервер на скачивание; React добавляет только слой наведения на уровни.
 */
export function AeroDiagram({ aerology, palette, kind, release, hovered, onHover }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const proj = diagramProjection(kind);

  const body = useMemo(() => renderDiagramBody({ aerology, palette, kind }), [aerology, palette, kind]);

  // Полоса наведения уровня — от середины до соседей сверху и снизу.
  const bands = useMemo(() => {
    const ys = aerology.levels.map((level) => proj.y(level.mb));
    return ys.map((y, i) => {
      const below = ys[i - 1];
      const above = ys[i + 1];
      const bottom = below === undefined ? y + 12 : (y + below) / 2;
      const top = above === undefined ? y - 12 : (y + above) / 2;
      return { y, top, height: bottom - top };
    });
  }, [aerology, proj]);

  const showTip = (index: number, event: React.PointerEvent<SVGElement>): void => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTip({ left: event.clientX - rect.left, top: event.clientY - rect.top });
    onHover(index);
  };

  const hideTip = (): void => {
    setTip(null);
    onHover(null);
  };

  const active = hovered !== null ? aerology.levels[hovered] : undefined;
  const releaseMs = parseUtc(release).getTime();

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
        className="chart-surface w-full rounded-lg"
        style={{ aspectRatio: `${DIAGRAM_WIDTH} / ${DIAGRAM_HEIGHT}`, backgroundColor: palette.surface }}
        fontFamily={CHART_FONT}
        role="img"
        aria-label={`Аэрологическая диаграмма ${DIAGRAM_KIND_LABELS[kind].short} по профилю вдоль траектории зонда`}
      >
        <g dangerouslySetInnerHTML={{ __html: body }} />

        {active && (
          <g pointerEvents="none">
            <line
              x1={DIAGRAM_PLOT.x}
              x2={DIAGRAM_WIDTH - 4}
              y1={proj.y(active.mb)}
              y2={proj.y(active.mb)}
              stroke={palette.temperature}
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
            <circle
              cx={proj.x(active.tempC, active.mb)}
              cy={proj.y(active.mb)}
              r={5.5}
              fill={palette.surface}
              stroke={palette.temperature}
              strokeWidth={2.4}
            />
          </g>
        )}

        {/* Слой взаимодействия: полоса на каждый уровень через всю ширину */}
        {bands.map((band, index) => (
          <rect
            key={aerology.levels[index]?.mb ?? index}
            x={0}
            y={band.top}
            width={DIAGRAM_WIDTH}
            height={band.height}
            fill="transparent"
            onPointerEnter={(event) => showTip(index, event)}
            onPointerMove={(event) => showTip(index, event)}
            onPointerLeave={hideTip}
          />
        ))}
      </svg>

      {tip && active && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[240px] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
          style={{ left: tip.left, top: tip.top }}
        >
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {active.mb} гПа · {formatMeters(active.heightM)}
          </div>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
            <dt>Температура</dt>
            <dd className="tabular-nums">{formatTemp(Math.round(active.tempC))} °C</dd>
            <dt>Ветер</dt>
            <dd className="tabular-nums">
              {Math.round(active.windDirDeg)}° {Math.round(active.windSpeedMs)} м/с
            </dd>
            <dt>Зонд на уровне</dt>
            <dd className="tabular-nums">
              {Math.round(active.timeMin)} мин,{' '}
              {formatTimeUtc(new Date(releaseMs + active.timeMin * 60_000))} UTC
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
