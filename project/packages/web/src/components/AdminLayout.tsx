import { pagePath, pageUrl } from '../lib/paths.js';
import { useTheme } from '../lib/theme.js';
import { secondaryButtonClass } from './Field.js';
import { UserMenu } from './UserMenu.js';

export type AdminSection = 'users' | 'journal' | 'keys';

const SECTIONS: Record<AdminSection, { path: string; title: string }> = {
  users: { path: 'admin', title: 'Пользователи' },
  journal: { path: 'admin/journal', title: 'Журнал выпусков' },
  keys: { path: 'admin/keys', title: 'Ключи API' },
};

const SECTION_KEYS = Object.keys(SECTIONS) as AdminSection[];

/**
 * Раздел админки по адресу страницы; не админка — undefined. Роутера нет:
 * сервер и Vite на любой путь отдают index.html, разделы — обычные ссылки.
 */
export function adminSection(pathname: string): AdminSection | undefined {
  const path = pagePath(pathname).replace(/\/+$/, '');
  return SECTION_KEYS.find((section) => SECTIONS[section].path === path);
}

/** Шапка админки с вкладками разделов; содержимое раздела — в `children`. */
export function AdminLayout({
  section,
  children,
}: {
  section: AdminSection;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="hidden min-w-0 md:block">
            <h1 className="truncate text-base font-semibold sm:text-lg">Администрирование</h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">Прогноз перемещения радиозонда</p>
          </div>
          <nav
            aria-label="Разделы администрирования"
            className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700"
          >
            {SECTION_KEYS.map((key) => (
              <a
                key={key}
                href={pageUrl(SECTIONS[key].path)}
                aria-current={key === section ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition ${
                  key === section
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {SECTIONS[key].title}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a href={pageUrl()} title="К прогнозу" className={`whitespace-nowrap ${secondaryButtonClass}`}>
              ←<span className="hidden sm:inline"> К прогнозу</span>
            </a>
            <UserMenu showAdminLink={false} />
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

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
