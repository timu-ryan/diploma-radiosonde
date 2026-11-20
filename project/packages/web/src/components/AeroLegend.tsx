import { useId, useMemo, useState } from 'react';
import type { DiagramKind, DiagramPalette } from '@rs/shared';
import { LEGEND_SAMPLE, diagramLegend } from '@rs/shared';

interface Props {
  palette: DiagramPalette;
  kind: DiagramKind;
}

/**
 * Обозначения диаграммы: тот же список и те же образцы, что под скачиваемой картинкой.
 * На экране по умолчанию свёрнуты и раскрываются по кнопке.
 */
export function AeroLegend({ palette, kind }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const items = useMemo(() => diagramLegend(palette, kind), [palette, kind]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
      >
        <span aria-hidden className={`text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`}>
          ▾
        </span>
        Условные обозначения
      </button>

      {open && (
        <ul id={listId} className="mt-2.5 grid gap-x-6 gap-y-2.5 px-1 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.caption} className="flex items-start gap-2.5">
              <svg
                viewBox={`0 ${-LEGEND_SAMPLE.height / 2} ${LEGEND_SAMPLE.width} ${LEGEND_SAMPLE.height}`}
                className="mt-0.5 h-4 w-7 shrink-0 overflow-visible"
                aria-hidden="true"
              >
                <g dangerouslySetInnerHTML={{ __html: item.sample }} />
              </svg>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-800 dark:text-slate-100">{item.caption}</div>
                <div className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{item.hint}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
