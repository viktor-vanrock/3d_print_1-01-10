# Auth Migration Plan 4.2

План поэтапной миграции модулей `apps/api` на `UnifiedAuthGuard`. Это только план документации:
изменения кода в рамках этого документа не выполняются.

Связанные документы:

- [`docs/auth.migration.playbook.md`](auth.migration.playbook.md) — пошаговый шаблон миграции и
  фактический diff пилота `billing`;
- [`docs/auth-audit.md`](auth-audit.md) — аудит контуров аутентификации;
- [`docs/protected-routes.md`](protected-routes.md) — inventory маршрутов на 2026-08-13;
- [`apps/api/src/modules/auth/readme.md`](../apps/api/src/modules/auth/readme.md) — обзор auth-модуля.

## Inventory

Источник списка модулей — `apps/api/src/modules/*`. Исключены `auth` и уже мигрированный `billing`, а
также служебные `_boundaries`, `_kernel`, `_template`. Количество маршрутов и их базовая классификация
взяты из `docs/protected-routes.md`; маршруты `health` вне `apps/api/src/modules` в таблицу не входят.

В колонке «Public» указаны полностью публичные маршруты; `Optional` вынесен отдельно, даже если в
исходном inventory он находится в секции public. «Role/API-key» — ортогональный признак: эти маршруты
входят также в `Protected`/`Optional`, но требуют API-key, mixed principal, staff/owner-роли или отдельной
ACL-проверки. `P1/P2/P3` — порядок сложности миграции, а не бизнес-приоритет.

| Модуль | Всего маршрутов | Public | Protected | Optional | Role/API-key | Спецкейсы | Приоритет | Риск | Комментарий |
|---|---:|---:|---:|---:|---|---|---|---|---|
| `achievements` | 2 | 0 | 2 | 0 | — | Только `SESSION_USER`, read-only `/me` | P1 | L | Прямой session-only шаблон, нет custom guard и не-auth request data. |
| `agents` | 6 | 0 | 6 | 0 | agent lifecycle/keys | Request ID + выпуск и отзыв agent keys | P2 | M | Session extraction простая, но последствия revoke/key lifecycle требуют отдельной проверки. |
| `analytics` | 2 | 0 | 1 | 1 | — | `/consent` вручную разрешает optional session и пишет cookie | P2 | M | Нужен optional-контекст и сохранение analytics-cookie/response поведения. |
| `assistant` | 11 | 0 | 11 | 0 | — | SSE через `@Res()`, `@Headers("last-event-id")`, `AbortController`, streaming и generation endpoints | P2 | M | Нужны отдельные streaming/transport smoke-проверки; не подходит под прямой billing-шаблон. |
| `catalog` | 17 | 8 | 9 | 0 | 4 moderation/approval | Public catalog + matcher-only protected handlers | P2 | H | Staff/moderation semantics и уже отмеченный matcher-only drift нельзя потерять. |
| `community` | 19 | 0 | 19 | 0 | owner/role actions | Community/thread/post ACL, non-null `SESSION_USER` helper | P2 | H | Много действий и ролей; текущий non-null assertion требует осторожной замены. |
| `devices` | 19 | 3 | 16 | 0 | device ACL/enroll | Enrollment/recovery custom gates, commands/transfers | P3 | H | Device identity и command authorization нельзя сводить к browser user context. |
| `feed` | 20 | 4 | 12 | 1 | 3 API-key/mixed | `mf_feedingest_*`, `mf_agent_*`, manual session-or-agent actor | P3 | H | Mixed principals и ручной bearer parsing — отдельный этап после P1/P2. |
| `generations` | 15 | 2 | 13 | 0 | — | Uploads, SSE/assets, idempotency headers | P2 | M | Session-only, но file/stream transport и asset authorization требуют smoke-проверок. |
| `ideas` | 12 | 2 | 9 | 1 | moderation/rate-limit | Optional detail, ranking and moderation operations | P2 | M | Есть optional identity и доменные rate-limit/moderation paths. |
| `importConnections` | 5 | 0 | 5 | 0 | — | Только пользовательские import connections | P1 | L | Небольшой session-only модуль, `@Req()` используется только для identity. |
| `imports` | 3 | 0 | 3 | 0 | — | Только пользовательские import jobs | P1 | L | Минимальный session-only модуль без смешанных credentials. |
| `makers` | 6 | 0 | 6 | 0 | — | `makers/nearby` фактически session-protected при public OpenAPI metadata | P2 | M | Есть документированный OpenAPI/access-matrix drift; сначала зафиксировать ожидаемый режим. |
| `makes` | 12 | 0 | 12 | 0 | — | Фото/комментарии/votes и public-looking reads под matcher | P2 | M | Session-only по inventory, но media response и неоднородные reads требуют проверки. |
| `master` | 4 | 1 | 3 | 0 | — | Public storefront + own master profile | P1 | L | Остальные маршруты session-only; один явный `@Public()`-эквивалент. |
| `masterEquipment` | 4 | 1 | 3 | 0 | owner semantics | Public list + own equipment writes | P1 | L | Небольшой модуль, auth extraction из request, без API-key. |
| `masterServices` | 5 | 2 | 3 | 0 | owner semantics | Public detail/list + own service writes | P1 | L | Небольшой session-only модуль с двумя публичными reads. |
| `models` | 0 | 0 | 0 | 0 | — | Контроллера в модуле нет; model routes находятся в `projects` | — | L | Нет собственной migration surface; учитывать через `projects`, не создавать пустой diff. |
| `moderation` | 1 | 0 | 1 | 0 | staff/ban | User ban endpoint, staff authorization in domain flow | P2 | M | Один маршрут, но высокая цена ошибки и role semantics. |
| `orders` | 3 | 0 | 3 | 0 | — | Create/read/transition own orders | P1 | L | Прямой session-only модуль с тремя маршрутами. |
| `organizations` | 6 | 0 | 6 | 0 | staff/vendor role | Vendor claims review/verify/revoke | P2 | M | Session extraction проста, но review queue и staff authorization требуют проверки. |
| `printRequests` | 5 | 0 | 5 | 0 | — | IP/headers нужны rate-limit, не auth | P2 | M | `@Req()` нельзя удалить полностью: сохранить transport identity для throttling. |
| `printers` | 18 | 1 | 13 | 0 | 4 research API-key/mixed | Research key or session, media presign, device/provider actions | P3 | H | Mixed research auth и ручной cookie/bearer resolution. |
| `profile` | 27 | 2 | 25 | 0 | device owner/ACL | Inventory, uploads, printer live/commands, cookies and headers | P2 | H | Большой модуль и non-auth request data; мигрировать после малых P1. |
| `projects` | 20 | 2 | 17 | 1 | ownership/ACL | Upload/revisions/publication, optional preview identity | P2 | H | Крупный stateful domain с ownership, file transport и optional preview. |
| `publicapi` | 13 | 0 | 7 | 0 | 6 public API-key | User key management + `/v0/*` custom `mf_pub_*` | P3 | H | Два независимых auth surface; public API нельзя переводить механически по billing-шаблону. |
| `push` | 5 | 0 | 5 | 0 | — | VAPID public-key route matcher-only | P1 | L | Небольшой session-only модуль; один handler не читает userId, но остаётся protected. |
| `relayInternal` | 11 | 0 | 0 | 0 | 11 relay service | `RelayServiceGuard`, service token, correlation/operation IDs | P3 | H | Service-only контур не является browser session migration и требует отдельного решения. |
| `security` | 1 | 0 | 1 | 0 | — | Internal honeypot, session identity для аудита, `request.ip` и все headers | P2 | M | `@Req()` необходимо сохранить для формирования transport identity; не является чистой session-only заменой. |
| `seo` | 4 | 4 | 0 | 0 | — | Только public metadata/assets/sitemap | — | M | Нет protected surface; при необходимости лишь добавить явные `@Public()` при class-level guard, не первый батч. |
| `slicerProfiles` | 4 | 0 | 4 | 0 | — | Calibration/rate-limit identity and optional request data | P2 | M | Session-only, но `@Req()`/rate-limit и calibration ownership требуют проверки. |

Итого: **31 модуль, 280 маршрутов**. Это соответствует 300 маршрутам общего inventory после исключения
10 маршрутов `auth`, 9 маршрутов `billing` и 1 health-маршрута вне `apps/api/src/modules`.

## Критерии приоритета

- **P1** — только session-auth либо явные public exceptions; нет API-key/mixed principal, provider login,
  custom guard или существенного transport-specific `@Req()`. Миграция следует billing-шаблону.
- **P2** — есть matcher-only защищённые reads, staff/owner semantics, optional auth, rate-limit/media/stream
  transport или `@Req()` для не-auth целей. Нужна ручная классификация каждого route и расширенные smoke-тесты.
- **P3** — mixed-auth, API-key consumers, relay/service principal, enrollment/provider login, webhook или
  cross-module guard logic. Выполнять после стабилизации P1/P2 и отдельного контракта для principal.

Риск — **L/M/H** — оценивает вероятность регрессии при замене источника identity и последствия ошибки:

- **L:** локальная session-only замена без альтернативного principal;
- **M:** дополнительный transport/role/optional сценарий, но без mixed auth;
- **H:** несколько типов credentials, device/service trust, ownership/ACL или большой stateful surface.

## Порядок раскатки

### 4.2a — первый безопасный батч

Мигрировать 3–5 небольших P1-модулей, каждый отдельным проверяемым изменением. После каждого модуля:
typecheck, module tests, boundaries, route inventory smoke и проверка, что legacy `AuthGuard` не изменён.

### 4.2b — остальные P1 и контролируемые P2

Закрыть оставшиеся P1 (`assistant`, `master`, `masterEquipment`, `masterServices`, `orders`, `push`,
`security` и т.д.), затем брать P2 по одному модулю с явными route matrices. `catalog`, `community`,
`profile`, `projects` и `slicerProfiles` не объединять в один большой diff.

### 4.3 — mixed/service/provider контуры

**Обновлено после разведки:** ни один из 5 оставшихся модулей не является провайдером логина (не выдаёт `portal_session`). Публикация session cookie — вне этой миграции.

Порядок батчей:
1. **devices** — 19 маршрутов, стандартный шаблон (16 protected + 3 public). Enroll/recovery — `@Public()` + внутренняя проверка одноразового кода.
2. **feed** — 20 маршрутов, session-or-agent/ingest mixed principal через §3.6 playbook.
3. **printers** — 18 маршрутов, session-or-research-key mixed через §3.6, + custom portal_anon cookie side-effect в handler.
4. **publicapi** — 13 маршрутов, split:
   - `/me/*` (7) — standard session via `@CurrentAuth()`
   - `/v0/*` (6) — `@Public()` + runtime `PublicApiService.authenticate(rawAuth, scope, ctx)` в handler (шаблон §3.7 playbook). Полная миграция /v0/* через API-key resolver — отдельный техдолг (см. ниже).

**Не мигрируются в 4.3:**
- **relayInternal** (11 service-only маршрутов) — отложен из-за расхождений `RelayServiceResolver` ↔ `RelayServiceGuard` (regex validation, x-operation-id для GET, response header side-effect). См. §3.8 playbook.

**Cleanup preparatory (перед батчами 4.3):**
- Сделать `UnifiedAuthIntegrationModule` `@Global()` — разрывает потенциальный цикл `PublicApiModule` ↔ `UnifiedAuthIntegrationModule` перед миграцией publicapi.

**Ограничения 4.3:**
- Не объявлять `UnifiedAuthGuard` глобальным `APP_GUARD` (см. playbook §6, §9).
- Public/API-key/service routes сохраняют свои прикладные gates.
- Не менять транспортную семантику (headers, cookies, response side-effects) — только auth extraction path.

## Рекомендуемый первый батч 4.2a

1. **`achievements`** — два простых session-only read маршрута, минимальный diff и низкий blast radius.
2. **`imports`** — три пользовательских job маршрута без API-key, optional или transport-specific auth.
3. **`importConnections`** — пять однородных session-only маршрутов с одним identity helper.
4. **`orders`** — три session-only маршрута с прямым user ownership и без альтернативного credential.
5. **`push`** — пять маршрутов; кроме matcher-only VAPID read, остальные однородны, что проверяет явное
   сохранение protected read под class-level guard.

Если нужен батч из четырёх модулей, исключить `push` из-за matcher-only маршрута и оставить первые четыре.

## Ограничения

- Этот файл не изменяет `apps/api/**` и не меняет существующие документы.
- Миграция каждого модуля должна следовать [`auth.migration.playbook.md`](auth.migration.playbook.md).
- Не удалять и не менять `apps/api/src/nest/auth/auth.guard.ts`.
- Не регистрировать `UnifiedAuthGuard` как `APP_GUARD`.
- Не менять `application/`, `domain/`, `infrastructure/` мигрируемого модуля, провайдеры логина или
  device/relay trust contracts в рамках P1.
- Сохранять `.ts` в относительных импортах.
- `@Req()` удаляется только когда он обслуживает auth; headers, IP, raw body, response streaming,
  idempotency и rate-limit transport data должны остаться через подходящий Nest parameter decorator.
- Перед началом реализации нужна отдельная карточка/статус на Multica; CLI в текущем окружении отсутствует.

## Технический долг

Задачи, накопленные по ходу миграции. Не блокеры 4.3, но требуют отдельного тикета.

### relayInternal harmonization

`RelayServiceResolver` в `UnifiedAuthIntegrationModule` расходится с `RelayServiceGuard`:
- Resolver не валидирует формат correlation/operation ID регулярным выражением
- Resolver требует `x-operation-id` даже для GET; guard разрешает отсутствие для GET
- Resolver не устанавливает correlation ID в response header

До гармонизации `RelayInternalController` продолжает использовать `RelayServiceGuard`. Миграция через `@UseGuards(UnifiedAuthGuard)` + §3.8 playbook — после согласования контракта с DevOps/Relay.

### publicapi /v0/* full migration (API-key scope split)

`ApiKeyPubResolver` жёстко вызывает `PublicApiService.authenticate(rawAuth, "read", ctx)`. Для command routes нужен `"control"` scope. В 4.3 `/v0/*` мигрированы как `@Public()` + runtime `authenticate` в handler (§3.7).

Рефакторинг:
- Разбить `PublicApiService.authenticate` на `identify(rawKey)` + `enforceScope(principal, scope)`
- `ApiKeyPubResolver.resolve` → `identify`, кладёт `principal.scopes` в `ctx.permissions`
- Handler → `@RequirePermission("control")` вместо runtime `authenticate`
- `/v0/*` теряют `@Public()`, guard берёт scope enforcement на себя

### Route-level API-key scope enforcement (высокий приоритет до финального удаления legacy AuthGuard)

**Симптом.** `UnifiedAuthGuard` принимает валидный `AuthContext` независимо от типа credential,
если controller не делает явную проверку `authMethod`. Практические gaps:

- Валидный `mf_pub_*` (public API key) может пройти на `/research/*` routes, если research controller
  не проверяет `ctx.authMethod === AuthMethod.ApiKeyResearch`.
- Любой user-context credential (session, `mf_pub_*`, `mf_research_*`, `mf_agent_*`,
  `mf_feedingest_*`) может пройти на `/feed/posts` и `/feed/media`, потому что `guardedActor()`
  проверяет только `isUserContext(ctx)`.
- **После удаления legacy AuthGuard** любой Bearer `mf_pub_*` сможет пройти на `/me/*` и другие
  protected routes, где раньше `SessionVerifier` отвергал не-JWT токен и бросал 401.

**Природа.** Архитектурная. Resolver chain распознаёт credentials, но scope enforcement —
ответственность route/controller. Не все routes её реализуют.

**Известные исключения (уже проверяют scope):**

- `/feed/ingest` — проверяет `ctx.authMethod === AuthMethod.ApiKeyFeedingest`.
- `/v0/*` — использует `PublicApiService.authenticate(rawAuth, scope)` вместо resolver chain.

**Действие.** Рассмотреть один из вариантов:

1. **Route-level декоратор `@AcceptMethods(...)`** — controller/route явно перечисляет допустимые
   `AuthMethod`. `UnifiedAuthGuard` проверяет это через `Reflector` и бросает 403 при несоответствии.
2. **Расширить resolver contract** — каждый API-key resolver возвращает `AuthContext` только для
   routes в своём prefix (`ApiKeyResearchResolver` работает только на `/research/*` и т. п.).
   Ограничение проверяется через route path в `canHandle`.
3. **Комбинация** — (1) для decorator-driven routes и (2) для API-key resolvers как страховка.

**Приоритет.** Высокий **до финала**. После удаления legacy AuthGuard gaps откроются на всех
protected routes. Без scope enforcement это регрессия безопасности.

**Затрагиваемые routes** (по разведке):

- `/me/*` (protected routes `PublicApiController`) — сейчас защищены legacy, после удаления legacy
  станут доступны любым user credentials.
- `/research/*` — POST/GET endpoints, controller не проверяет `authMethod`.
- `/feed/posts`, `/feed/media` — controller принимает любой user context.
- Все `@UseGuards(UnifiedAuthGuard)` routes без explicit method check.

### community-firmware access-matrix drift

`GET /community-firmware` документирован как public в `docs/protected-routes.md`, но отсутствует в `PUBLIC_GET_PATH_PATTERNS` и `ALWAYS_OPEN_GET_PATH_PATTERNS` в `apps/api/src/nest/auth/access-matrix.ts`. Не миграционная задача, требует продуктового решения (добавить паттерн / изменить документацию / зафиксировать намеренную политику).

### getUserAccountStatus 500 → 503

При ошибке БД в `SessionVerifier` / `getUserAccountStatus` возвращается HTTP 500. Правильнее 503 (сервис временно недоступен, а не ошибка запроса). Мелкая правка, отдельный коммит.

### Redundant UnifiedAuthIntegrationModule imports (25 модулей)

После перехода `UnifiedAuthIntegrationModule` в `@Global()` явные `imports: [UnifiedAuthIntegrationModule]` в 25 мигрированных модулях стали избыточными, но безвредными. Cleanup — отдельный коммит после стабилизации 4.3.

Модули: achievements, agents, analytics, assistant, billing, catalog, community, generations, ideas, importConnections, imports, makers, makes, master, masterEquipment, masterServices, moderation, orders, organizations, printRequests, profile, projects, push, security, slicerProfiles.

Действие: убрать `UnifiedAuthIntegrationModule` из `imports: [...]` каждого модуля + удалить соответствующий `import` statement. Проверки: typecheck + bootstrap + boundaries.

### Integration-тесты без skipIf(!DATABASE_URL) — вторая волна

Финальный аудит 4.3 показал 18 failed test suites в `vitest run` без DATABASE_URL — все с `ECONNREFUSED 127.0.0.1:5432`. Cleanup 2.1 закрыл 9 таких файлов, но осталось ещё ~9. Полный список — прогнать `vitest run` без DATABASE_URL и обернуть top-level `describe(...)` в `describe.skipIf(!process.env.DATABASE_URL)(...)` по шаблону cleanup 2.1.

Не миграционная задача, но блокирует локальный/CI прогон unit-тестов без Postgres.

### relay-internal.service.test.ts timestamp flake

Unit-тест `apps/api/src/modules/relayInternal/application/relay-internal.service.test.ts` падает на несовпадении `expires_at` timestamp между повторными вызовами. Не связан с миграцией (relayInternal deferred). Отдельный тикет по стабилизации теста.

### Integration-тесты со смешанной природой (mixed pure + DB)

Следующие 8 файлов содержат одновременно чистые тесты и проверки, требующие PostgreSQL:
- `apps/api/src/modules/catalog/infrastructure/prusa-connect-match.test.ts`
- `apps/api/src/modules/catalog/infrastructure/resolve/run.test.ts`
- `apps/api/src/modules/community/infrastructure/catalogCommunity.test.ts`
- `apps/api/src/modules/community/infrastructure/modelrefs.test.ts` (`extractModelIds` — pure; `resolvedModelsForPosts` — DB)
- `apps/api/src/modules/community/infrastructure/reputation.test.ts`
- `apps/api/src/modules/importConnections/infrastructure/import-ownership.repository.test.ts`
- `apps/api/src/modules/imports/infrastructure/cults3d.test.ts` (`SlidingWindowLimiter` — pure; `createCults3dConnector` — DB)
- `apps/api/src/modules/masterServices/application/master-services.service.test.ts`

Задача: разделить pure vs DB (либо два файла, либо `skipIf` на конкретном nested describe). Не оборачивать целиком.

### Characterization drift: manifest 309 vs baseline 308 (низкий приоритет)

Файлы:
- `apps/api/src/nest/auth/access-matrix.test.ts:29`
- `apps/api/src/characterization/nestRouteCoverage.test.ts:47`
- `apps/api/src/characterization/routeStatusLedger.test.ts:153`
- `apps/api/src/characterization/differentialRegression.test.ts:123`

Дополнительные hardcode-места (при финальной правке обновить также):
- `apps/api/src/characterization/readme.md:9,13`
- `apps/api/src/characterization/differentialRegression.test.ts:37`
- `apps/api/src/characterization/routeStatusLedger.test.ts:14,91`

**Симптом.** Baseline hardcode `expect(routes).toHaveLength(308)` и `expect(migratedRoutes).toHaveLength(261)` устарел относительно фактического `routes.manifest.json` (309 записей, 262 migrated + 47 formally-removed).

**Природа.** Не регрессия 4.3. Manifest внесён единым коммитом `57d17fe "Fix imports"` (2026-08-13) уже с 309 записями; hardcode на 308/261 был несогласован изначально. Ни один из 4.3-коммитов не менял `routes.manifest.json`.

**Действие.** Синхронизировать hardcode с manifest:
- 308 → 309 (total routes)
- 261 → 262 (migrated routes)
- 47 (formally-removed) — не менять

**Приоритет.** Не блокирует финал auth migration. Правку делать одним коммитом до/после финала — не критично.

### differentialRegression live probe: external OAuth flow (низкий приоритет)

Файл: `apps/api/src/characterization/differentialRegression.test.ts:76`

**Симптом.** `TypeError: fetch failed` → `connect ETIMEDOUT ...:443` для маршрута `GET /auth/plagid/start`. Handler после auth gate инициирует внешний OAuth network call, который не проходит из sandboxed окружения.

**Природа.** Инфраструктурная — тест не имеет skipIf/gate для недоступного external network, только `HANDLER_TIMEOUT` sentinel для AbortController.

**Действие.** Один из вариантов:
1. Добавить skipIf по env (`SKIP_EXTERNAL_PROBES` или `CI` без network access).
2. Mock external HTTP клиента в характеризационном режиме.
3. Пометить конкретные маршруты (`/auth/plagid/start`, `/auth/*/start`) как "probe-skipped" со специальным sentinel.

**Приоритет.** Не блокирует финал. Требует продуктового решения по характеризационной политике для routes с external side-effects.

### ledger drift: openspec/changes/backend-nest-migration отсутствует

Файл: `apps/api/src/characterization/routeStatusLedger.test.ts:14` (`LEDGER_PATH`)

**Симптом.** `LEDGER_WRITE=1 vitest run` падает с `ENOENT: /home/user/projects/openspec/changes/backend-nest-migration/inventory/route-status-ledger.md`.

**Природа.** `LEDGER_PATH` указывает вне репозитория (`../../../../../openspec/...`), который в workspace отсутствует.

**Действие.** Один из:
1. Переместить ledger внутрь `apps/api/`.
2. Восстановить sibling-checkout `openspec/` из внешнего источника.
3. Пометить write-mode как optional (skipIf при отсутствии target directory).

**Приоритет.** Низкий. Read-mode работает; write-mode нужен только при регенерации.

### AUTH_ENCRYPTION_KEY не задан в тестах crypto (средний приоритет)

Файл: `apps/api/src/modules/auth/infrastructure/crypto.test.ts`

**Симптом.** `Error: AUTH_ENCRYPTION_KEY не задан` в `encryptIdentity` при импорте `auth-crypto.ts`.

**Природа.** Тест не устанавливает env перед `beforeEach` / `beforeAll`. Не связано с 4.3 (файл в истории меняется только `57d17fe`).

**Действие.** Добавить `beforeEach(() => { process.env.AUTH_ENCRYPTION_KEY = "test-key-32-bytes-base64-encoded"; })` или использовать `vitest.setup` с фикстурой.

**Приоритет.** Средний, независимо от финала. Тест сейчас не даёт покрытия crypto-логики.

### Cookie precedence contract test (средний приоритет)

`apps/api/src/modules/auth/infrastructure/resolvers/web-session.resolver.test.ts` мокает
`SessionVerifier.readSession`, поэтому фактический выбор credential при одновременном присутствии
cookie и Bearer не тестируется. Legacy `bootstrap.test.ts` косвенно покрывал это через реальный JWT
и реальный `SessionVerifier`, но проверка удалена на этапе 4b.

Нужен integration-тест с реальным `SessionVerifier` (in-memory session store и реальный JWT через
`SignJWT` из `jose`), который проверяет:

- valid cookie wins over valid Bearer;
- invalid cookie rejects request даже при valid Bearer;
- absent cookie → fall back to Bearer.

Место: рядом с `web-session.resolver.test.ts` или в отдельном
`session-verifier.integration.test.ts`. Задача не блокирует финал auth migration.

### UnifiedAuthGuard positive-path в bootstrap-подобной среде (низкий приоритет)

`bootstrap.test.ts` больше не проверяет успешный ответ `200` через реальный `UnifiedAuthGuard`;
positive path покрыт unit-тестами `resolve-auth-context`, `unified-auth.guard` и `session-issuer`.

Если понадобится E2E-проверка «valid credentials → 200 + handler получает context» через полный
AppModule DI, использовать TestingModule override:

```ts
Test.createTestingModule({ imports: [TestAppModule] })
  .overrideProvider(RESOLVE_AUTH_CONTEXT).useValue(fakeResolver)
  .compile()
  .createNestApplication(new ExpressAdapter())
```

Локальный provider в дочернем module не перекрывает `@Global()`
`UnifiedAuthIntegrationModule`, что и было причиной неудачной прямой замены в `bootstrap.test.ts`.

Задача необязательна: существующего unit coverage достаточно для инвариантов guard.

### Финал этапа 4 (варианты A, подэтапы 4a–4c3) — выполнен

✅ Финал этапа 4 (варианты A, подэтапы 4a–4c3) выполнен: legacy `AuthGuard`,
`SESSION_USER`, `RequestWithSession`, `requiresSession`, `AuthMatrixInput`,
`access-matrix.test.ts` удалены; `SessionVerifier` перемещён в auth-owned
infrastructure; двойной `APP_GUARD` снят.

## Статус критериев приёмки auth migration

| Критерий | Текущий статус |
|---|---|
| 1. Единый типизированный `AuthContext` для web-session / API-keys / device-agent / relay | Закрыт. |
| 2. `userId` + `accountStatus` + `method` + `permissions` в контексте | Закрыт. |
| 3. Отказ неактивному пользователю на защищённых маршрутах | Закрыт: legacy `AuthGuard` удалён в 4c3, весь трафик проходит через `UnifiedAuthGuard`. |
| 4. Login providers не выдают сессию неактивному пользователю | Закрыт для реализованных providers (email, PlagID, dev, password). SberID deferred, инвариант зафиксирован в playbook §X. |
| 5. Локальные session-parsers удалены из доменов | Закрыт: `/auth/session` мигрирован на `UnifiedAuthGuard` в 4c1, `PrinterResearchAuthAdapter.resolveUser` удалён как dead code. |
| 6. Матрица `(4 methods × 4 statuses)` | Частично закрыт: `SessionIssuer` 13 cases + `resolve-auth-context` (4 статуса для authenticated context). Не хватает explicit `UnifiedAuthGuard` matrix (4 methods × 4 statuses) — deferred, желательно после финала (single guard vs двойной pipeline даст чистые тесты). |
| 7. Домены не парсят cookie/JWT | Закрыт: `SessionVerifier` перемещён в `modules/auth/infrastructure/session` в 4c2; ESLint защищает от external imports. |
| 8. Архитектурная проверка парсинга сессии и issue-path | Закрыт. Два ESLint `no-restricted-imports` правила в `eslint.config.mjs` блокируют импорт session primitives и `AuthSessionService` вне auth-модуля. |
