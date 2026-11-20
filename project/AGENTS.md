# AGENTS.md

Инструкции для Codex при работе со всем репозиторием.

Проект и комментарии в коде — на русском; новый код и сообщения об ошибках пишите так же.
Подробная предметная спецификация (формат планшетов, формат GRIB, бланк, список API, все
переменные окружения) — в [README.md](README.md); здесь только то, что нужно для работы с кодом.
Сборка и запуск на сервере — [docs/deploy.md](docs/deploy.md): меняя переменные окружения
или команды сборки, обновите и его.

## Порядок работы

- Отвечайте пользователю по-русски. Сохраняйте стиль соседнего кода и существующие границы пакетов.
- Проверяйте команды и возможности по текущему коду и `package.json`; не описывайте отсутствующие
  модули как реализованные. При изменениях архитектуры и команд обновляйте этот файл.
- Для изменений TypeScript запускайте `npm run typecheck` и относящиеся к изменению тесты;
  для изменений общих типов, расчёта, авторизации или API — `npm test` целиком.
  Для изменений сборки или зависимостей дополнительно запускайте `npm run build`.
- Тесты API запускайте с хранилищами в памяти, как в существующих тестах. Для обычных проверок
  не нужен запущенный сервер, токен прогнозов или доступ к MySQL. `TEST_DB_URL` предназначен
  только для отдельной тестовой базы: интеграционные тесты создают таблицы и меняют записи.
- `.env` и `db.env` — локальные файлы с секретами: не включайте их содержимое в ответы и коммиты.
  Образец настроек — [.env.example](.env.example).

## Команды

Node.js >= 20, npm workspaces. Все команды ниже выполняются из корня репозитория.

```bash
npm install
npm run dev           # shared (tsc --watch) + server :3001 + Vite :5173 с прокси /api
npm test              # vitest run, все пакеты
npm run typecheck     # сборка shared + tsc --noEmit для server и web — основной гейт качества
npm run build         # shared → server → web (порядок обязателен)
npm start             # production: Fastify на :3001 раздаёт API и packages/web/dist
npm run clean         # снести dist и tsbuildinfo, если инкрементальная сборка «залипла»
npm run user -- <логин> [--admin] [--coords]   # завести пользователя / сбросить пароль (DB_URL)
```

Один тест / один случай:

```bash
npx vitest run packages/server/test/api.test.ts
npx vitest run -t 'находит пересекаемые трассы'
npx vitest                                        # watch
```

Линтера и форматтера в проекте нет — стиль поддерживается вручную, проверка — `npm run typecheck`.

## Устройство репозитория

npm workspaces, три пакета, все ESM (`"type": "module"`), общий [tsconfig.base.json](tsconfig.base.json)
(`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).

| Пакет | Роль |
|---|---|
| `packages/shared` (`@rs/shared`) | типы API, константы планшета и уровней, геодезия, временны́е окна сроков, **отрисовка схемы и бланка в SVG** |
| `packages/server` (`@rs/server`) | Fastify: станции, каталог прогонов, чтение GRIB, расчёт траектории, текстовый отчёт, `/api/chart.svg`, вход и пользователи |
| `packages/web` (`@rs/web`) | React + Vite + Tailwind 4 (через `@tailwindcss/vite`, без конфига) |

Ловушки сборки:

- Сайт может жить не в корне домена (`BASE_PATH=/zond/` за Apache). Vite читает `BASE_PATH`
  из корневого `.env` при сборке ([vite.config.ts](packages/web/vite.config.ts)), сервер срезает
  префикс через `rewriteUrl` (маршруты остаются от `/`) и ставит cookie на этот путь. На фронтенде
  адреса API и страниц — только через [lib/paths.ts](packages/web/src/lib/paths.ts) (`BASE`,
  `pageUrl`), никаких `/api` и `/admin` от корня.
- `@rs/shared` экспортируется из `dist`, а не из исходников. Поэтому server и web не собираются
  и не проверяются типами, пока shared не собран; `npm run dev`, `build` и `typecheck` делают это
  первым шагом сами. Тесты — исключение: [vitest.config.ts](vitest.config.ts) алиасит `@rs/shared`
  на `packages/shared/src/index.ts`, сборка им не нужна.
- shared и server — `module: NodeNext`, поэтому относительные импорты обязаны кончаться на `.js`
  (`./config.js` из `config.ts`). В web — `moduleResolution: bundler`, там расширения не нужны.
- `packages/server/src` и `packages/server/dist` лежат на одной глубине — на этом держатся
  `../../..` в [config.ts](packages/server/src/config.ts) и путь к `.env`
  в [index.ts](packages/server/src/index.ts). Не переносите эти файлы глубже.
- `noUncheckedIndexedAccess` включён: обращения по индексу в горячем коде расчёта пишутся
  с `as`-подсказкой (`levels[0] as LevelSampler`) — держитесь того же приёма, а не `!`.

## Как идёт расчёт

`GET /api/forecast` → [routes/api.ts](packages/server/src/routes/api.ts) (разбор и валидация query)
→ [ForecastService.compute](packages/server/src/forecast/service.ts) → чистая функция
[integrateTrajectory](packages/server/src/trajectory/compute.ts) →
[findAirwayCrossings](packages/server/src/trajectory/crossings.ts).

Что важно знать, прежде чем менять любой из этих файлов:

- **Прогон и срок выбираются, а не интерполируются по времени.** Правила лежат в одном месте —
  [shared/steps.ts](packages/shared/src/steps.ts) (`activeStep`, `stepWindow`, `runWindow`,
  `stepPeriods`): срок действует ±1,5 ч, граница принадлежит следующему сроку. Этими же функциями
  пользуются каталог прогонов (период действия прогона), сервис (`StepLevel.sampleAt` на каждом шаге
  интегрирования) и фронтенд (выноска «по какому прогону считается»). Менять семантику времени
  нужно здесь, а не в вызывающем коде.
- **Два разных набора высот.** Уровни прогноза — изобарические (`FL_MB`, высота = `FL × 30` м);
  строки отчёта — фиксированная лестница бланка `REPORT_HEIGHTS_M` (1500…16 000 м), которая
  обрезается по верхнему доступному уровню. Обе таблицы рядом
  в [shared/levels.ts](packages/shared/src/levels.ts). Неполнота данных не ошибка: сервис копит
  `warnings` (пропущенный уровень, укороченный отчёт, выход за период действия) и отдаёт их в ответе.
- **`integrateTrajectory` не знает про файлы и HTTP** — ей передают `LevelSampler`. Тесты расчёта
  работают на синтетических уровнях, без данных на диске; сохраняйте эту границу.
- **По высоте ветер не интерполируется:** `integrateTrajectory` берёт ближайший изобарический
  уровень (при равном расстоянии — нижний), за пределами набора — крайний. По горизонтали
  `interp=nearest` выбирает ближайший узел сетки, `interp=bilinear` — билинейную интерполяцию.
- `ForecastService.compute` обслуживает и станции, и произвольные координаты. В последнем случае
  `resolveOrigin` ищет ближайшую станцию в пределах `STATION_RADIUS_KM` (30 км). Путь отсчитан от
  точки выпуска; для поиска пересечений трасс его сдвигают на `origin.dxKm`/`origin.dyKm` относительно
  центра планшета. Без ближайшей станции расчёт идёт без трасс, с предупреждением.
- **Состояние сервера** собирается один раз в [app.ts](packages/server/src/app.ts):
  `StationRegistry` (все XML читаются при старте), `GribCatalog` (пересканирует каталог данных
  по mtime, TTL 15 с), `GribFieldCache` (LRU на буферы полей), опционально `GribSync`,
  хранилище пользователей. Тесты поднимают то же приложение через
  `buildApp({ users: new MemoryUserStore() })`.

## Вход и пользователи

Весь `/api/*`, кроме `/api/auth/login`, `/api/auth/logout`, `/api/health`, закрыт хуком `onRequest`
в [routes/auth.ts](packages/server/src/routes/auth.ts): без действующей сессии (или ключа API на `/api/v1/*`) — 401 `unauthorized`,
пользователь кладётся в `request.user`. Хук смотрит на шаблон маршрута (`routeOptions.url`),
а не на адрес; **новый маршрут под `/api/` закрыт автоматически**, открытый нужно явно добавить
в `PUBLIC_ROUTES`. Статика фронтенда открыта — на ней страница входа.

- Сессия — подписанная cookie `rs_session` (`userId.version.expires.hmac`,
  [auth/session.ts](packages/server/src/auth/session.ts)), таблицы сессий нет. `version` сверяется
  с `session_version` пользователя на каждом запросе; смена пароля и отключение её поднимают.
- Правила (валидация, хеширование scrypt, «нельзя снять админа с себя», «не оставлять без
  администратора») — в `UserService` ([auth/users.ts](packages/server/src/auth/users.ts));
  хранилище `UserStore` ([auth/store.ts](packages/server/src/auth/store.ts)) только читает и пишет.
  Реализации: `MysqlUserStore` ([auth/mysql.ts](packages/server/src/auth/mysql.ts), одна таблица
  `users`, создаётся при старте) и `MemoryUserStore` для тестов. Граница как у
  `integrateTrajectory`: логика не знает про MySQL.
- DDL обязан работать и на MySQL 8 (разработка), и на **MariaDB 5.5** (боевой сервер):
  без JSON, без `utf8mb4_0900_*`, без `DEFAULT CURRENT_TIMESTAMP` у `DATETIME`; даты пишет
  приложение в UTC (пул с `timezone: 'Z'`).
- Новая колонка в уже существующей таблице (`users`, `history`) добавляется в её `ADDED_COLUMNS`
  ([auth/mysql.ts](packages/server/src/auth/mysql.ts), [journal/mysql.ts](packages/server/src/journal/mysql.ts)),
  а не в текст `CREATE TABLE`: `init()` дописывает недостающие через `addMissingColumns`
  ([db.ts](packages/server/src/db.ts)). Нужны права `CREATE` и `ALTER`; настройки боевой базы —
  в [docs/deploy.md](docs/deploy.md).
- **Ключи API** (таблица `api_keys`, хранится SHA-256 ключа, [auth/apikey.ts](packages/server/src/auth/apikey.ts))
  — для других сайтов, server-to-server. Хук в routes/auth.ts: есть `Authorization: Bearer …` —
  проверяется только ключ (без отката на cookie), и **только на `/api/v1/*`**; `request.user` —
  владелец ключа, `request.apiKey` — сам ключ (у входа по cookie — null). Права и журнал работают
  от имени владельца. Отключение владельца закрывает ключ, удаление — удаляет его ключи (`UserStore.delete`).
- **`/api/v1`** — стабильный контракт для других сайтов: типы в [shared/v1.ts](packages/shared/src/v1.ts),
  JSON-ответы собираются по полю в [routes/v1.ts](packages/server/src/routes/v1.ts) — не отдавайте
  туда внутренние типы как есть, иначе правка `/api/*` сломает чужой сайт. Поля только добавлять.
  `report.txt`, `chart.svg`, `diagram.svg` под v1 — те же обработчики в routes/api.ts (цикл по двум адресам).
- Права: `isAdmin` (маршруты `/api/admin/*` с `preHandler: requireAdmin`) и `canCoordinates`
  (выпуск по `lat`/`lon` — проверка в `forecastRequest` в [routes/api.ts](packages/server/src/routes/api.ts);
  фронтенд прячет кнопку координат, но решает сервер).
- Без `DB_URL` `buildApp()` бросает ошибку — сервер не стартует открытым. CLI
  [cli/user.ts](packages/server/src/cli/user.ts) заводит пользователя или сбрасывает пароль.
- Тела POST/PATCH разбираются вручную хелперами [routes/body.ts](packages/server/src/routes/body.ts).
- **Журнал выпусков** — таблица `history`, `JournalStore` ([journal/store.ts](packages/server/src/journal/store.ts),
  `MysqlJournalStore` / `MemoryJournalStore`, та же граница, что у `UserStore`). Запись делает
  `record()` в [routes/api.ts](packages/server/src/routes/api.ts) в маршрутах скачивания
  (`forecast.txt`, `chart.svg`, `diagram.svg`) после успешного расчёта; `/api/forecast` (экран)
  не пишет. Новый маршрут, отдающий продукт для выдачи, тоже должен вызывать `record()`.
  Запросы по ключу пишутся с `api_key_id`/`api_key_name` (фильтр `source=site|key`).
  Сбой журнала не срывает ответ. `buildApp({ users })` без `journal` берёт журнал в памяти.
  Просмотр — `GET /api/admin/journal`, на фронте `/admin/journal`
  ([JournalPage](packages/web/src/components/JournalPage.tsx), вкладки — `AdminLayout`).
- Фронтенд: [AuthGate](packages/web/src/components/AuthGate.tsx) спрашивает `/api/auth/me` и
  показывает вход, приложение или админку (`/admin`, `/admin/journal`, `/admin/keys` — разделы
  в `AdminLayout`, без роутера); `useUser()` —
  в [lib/user.ts](packages/web/src/lib/user.ts). Любой 401 `unauthorized` из `api.ts` возвращает
  ко входу (`setUnauthorizedHandler`).

## Схема и бланк рисуются одним кодом

[shared/chart.ts](packages/shared/src/chart.ts) — генератор SVG-строк, без DOM и без React.
`renderChartBody` вызывают трое: сервер внутри `renderChartDocument` и внутри бланка
[shared/form.ts](packages/shared/src/form.ts) (чёрно-белая палитра, лист под печать),
и браузер в [SondeChart.tsx](packages/web/src/components/SondeChart.tsx), который вставляет ту же
разметку внутрь своего `<svg>` и добавляет сверху только слой наведения и зума.
Правка геометрии планшета делается один раз в `chart.ts` и должна выглядеть одинаково на экране,
в скачанном SVG и в PNG. Скачиваемую картинку всегда рисует сервер (`/api/chart.svg`), браузер
только растеризует её ([exportPng.ts](packages/web/src/lib/exportPng.ts)) — поэтому любой масштаб
выгружается независимо от того, что показано на экране.

Аэрологическая диаграмма устроена так же: [shared/diagram.ts](packages/shared/src/diagram.ts)
(`renderDiagramBody` для экрана в [AeroDiagram.tsx](packages/web/src/components/AeroDiagram.tsx),
`renderDiagramDocument` для `/api/diagram.svg`, всегда светлая). Два вида — `skewt` (АДК) и `stuve`
(АДП, Штюве); вся разница между ними — в `diagramProjection(kind)` (`x`, `y`, наклон изотерм, диапазон
сухих адиабат), остальной код рисует только через проекцию — новые элементы тоже. Профиль берётся вдоль траектории
([trajectory/aerology.ts](packages/server/src/trajectory/aerology.ts), без файлов — как
`integrateTrajectory`), обработка — чистые функции в [shared/aerology.ts](packages/shared/src/aerology.ts).
Влажности в GRIB нет: точку росы, LCL, кривую состояния и индексы гроз не добавлять без нового источника данных.

## Данные и тесты

- В git из `data/` хранится только `data/fixtures/2026080700/` — эталонный прогон (4 уровня × 3 срока).
  [vitest.config.ts](vitest.config.ts) выставляет `DATA_DIR=data/fixtures`, так что тесты
  детерминированы и не зависят от того, что лежит в `data/`. Верхний уровень фикстуры — 9000 м,
  поэтому отчёт в тестах содержит 5 строк и предупреждение; ассерты на это опираются.
- vitest выставляет `SESSION_SECRET`. API-тесты заводят пользователей в `MemoryUserStore`
  и входят через `/api/auth/login` ([test/helpers.ts](packages/server/test/helpers.ts)), запросы
  идут с cookie. [mysql.test.ts](packages/server/test/mysql.test.ts) работает только при
  `TEST_DB_URL` (живой MySQL/MariaDB), иначе пропускается.
- 106 XML-планшетов в [stations/](stations/) — часть реальных данных, а не фикстуры:
  парсер специально терпит повторяющиеся блоки `Scale`, станции с одним масштабом, пустые элементы
  и заготовку `XXXXX.xml` без координат (она не попадает в список).
  Регрессии на эти случаи — в [stations.test.ts](packages/server/test/stations.test.ts).
- **Осторожно с `DATA_DIR`.** Если в `.env` задан `AVIAMET_TOKEN`, сервер сам качает прогоны
  и **удаляет** из этого каталога всё сверх `AVIAMET_KEEP_RUNS`. Не направляйте `DATA_DIR`
  на папку с нужными данными и не запускайте `npm run dev` с токеном, указав `DATA_DIR=data/fixtures`.
- Сервер читает `.env` в [index.ts](packages/server/src/index.ts), пользовательский CLI — через
  [cli/env.ts](packages/server/src/cli/env.ts), до импорта конфигурации; уже заданные переменные
  окружения не перезаписываются. Vite читает тот же файл для `BASE_PATH`. Vitest сам `.env`
  не загружает: окружение тестов задаётся в `vitest.config.ts`.

## Контракт API

Типы запросов и ответов — в [shared/types.ts](packages/shared/src/types.ts); ими же типизирован
фронтенд ([web/src/api.ts](packages/web/src/api.ts)). Ошибки бросаются только как `HttpError`
(код + сообщение + произвольный `extra`), единый обработчик в `app.ts` превращает их в `ApiError`;
ошибки самого Fastify с кодом 4xx (битый JSON) — в 4xx `bad_request`, всё остальное становится 500. Меняя форму ответа, правьте `types.ts` — оба конца подхватят её сразу.
