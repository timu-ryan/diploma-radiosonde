import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DIAGRAM_KIND,
  DIAGRAM_KINDS,
  DIAGRAM_KIND_LABELS,
  fileStamp,
  type DiagramKind,
} from '@rs/shared';
import { api, type PlaceParams } from '../api.js';
import { downloadSvgAsPng, triggerDownload } from '../lib/exportPng.js';

interface Props {
  /** Откуда выпуск: станция или точка по координатам. */
  place: PlaceParams;
  /** Место выпуска в имени файла: код станции или координаты. */
  fileTag: string;
  release: string;
  /** Масштабы, для которых у станции есть планшет. */
  scales: readonly number[];
  disabled: boolean;
  onError: (message: string) => void;
}

const itemClass =
  'flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';
const groupClass =
  'px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500';
const hintClass = 'text-xs text-slate-400 dark:text-slate-500';

/**
 * Меню выгрузок: отчёт, схемы всех масштабов и оба вида аэрологической диаграммы.
 * Схему и диаграмму рисует сервер, поэтому любой масштаб и любой вид скачиваются
 * без переключения того, что показано на экране.
 */
export function DownloadMenu({
  place,
  fileTag,
  release,
  scales,
  disabled,
  onError,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Масштаб схемы или вид диаграммы — что сейчас готовится к скачиванию.
  const [busy, setBusy] = useState<number | DiagramKind | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const report = (): void => {
    setOpen(false);
    triggerDownload(api.reportUrl({ ...place, release }));
  };

  const chartPng = async (scale: number): Promise<void> => {
    setOpen(false);
    setBusy(scale);
    try {
      const svg = await api.chartSvgText({ ...place, release, scale });
      await downloadSvgAsPng(svg, {
        fileName: `radiosonde_${fileTag}_${fileStamp(release)}_${scale * 10}km.png`,
        background: '#ffffff',
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось скачать схему');
    } finally {
      setBusy(null);
    }
  };

  const diagramPng = async (kind: DiagramKind): Promise<void> => {
    setOpen(false);
    setBusy(kind);
    try {
      const svg = await api.diagramSvgText({ ...place, release, kind });
      // Имя — как у сервера: у вида по умолчанию без суффикса.
      const suffix = kind === DEFAULT_DIAGRAM_KIND ? '' : `_${kind}`;
      await downloadSvgAsPng(svg, {
        fileName: `aerology_${fileTag}_${fileStamp(release)}${suffix}.png`,
        background: '#ffffff',
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось скачать диаграмму');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {busy !== null ? 'Готовлю…' : 'Скачать'}
        <span aria-hidden className="text-xs text-slate-400">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white pb-1 shadow-xl xl:left-auto xl:right-0 dark:border-slate-700 dark:bg-slate-900"
        >
          <div className={groupClass}>Отчёт</div>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={report}
            title="Бланк «Прогноз перемещения радиозонда»"
          >
            Бланк перемещения
            <span className={hintClass}>.txt</span>
          </button>

          <div className={groupClass}>Схема с траекторией</div>
          {[...scales]
            .sort((a, b) => b - a)
            .map((scale) => (
              <button
                key={scale}
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => void chartPng(scale)}
                title={`Схема с траекторией, 1 деление — ${scale} км`}
              >
                {scale * 10} км
                <span className={hintClass}>.png</span>
              </button>
            ))}

          <div className={groupClass}>Аэрологическая диаграмма</div>
          {DIAGRAM_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => void diagramPng(kind)}
              title={DIAGRAM_KIND_LABELS[kind].hint}
            >
              <span>
                {DIAGRAM_KIND_LABELS[kind].short}
                <span className={`ml-1.5 ${hintClass}`}>{DIAGRAM_KIND_LABELS[kind].name}</span>
              </span>
              <span className={hintClass}>.png</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
