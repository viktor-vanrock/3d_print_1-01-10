# Auth Migration Playbook

Инструкция по миграции модулей `apps/api` на `UnifiedAuthGuard`.

**Связанные документы:**

- [`docs/auth-audit.md`](auth-audit.md) — аудит аутентификации, этап 1;
- [`docs/protected-routes.md`](protected-routes.md) — inventory HTTP-маршрутов и способов входа;
- [`apps/api/src/modules/auth/readme.md`](../apps/api/src/modules/auth/readme.md) — обзор auth-модуля.

**Пилот:** `billing` — 9 маршрутов, выполнен успешно. Из них 8 защищены пользовательской сессией, один
webhook явно публичный.

## 1. Публичный API auth-модуля

Основная поверхность для контроллеров экспортируется из
`apps/api/src/modules/auth/public/index.ts`. Integration-обёртка является исключением: модуль-потребитель
импортирует её напрямую из `apps/api/src/nest/integration/unified-auth.module.ts`.

| Символ | Тип | Назначение |
|---|---|---|
| `UnifiedAuthGuard` | Nest guard | Разрешает `AuthContext`, обрабатывает `@Public()`, `@OptionalAuth()` и `@RequirePermission()` и кладёт контекст в request. |
| `UnifiedAuthIntegrationModule` | Nest module | Собирает production-резолверы и зависимости guard; подключается в `imports` модуля-потребителя. Не экспортируется из `auth/public/index.ts`. |
| `@Public()` | Route/class decorator | Полностью пропускает unified auth для маршрута или контроллера. |
| `@OptionalAuth()` | Route/class decorator | Разрешает анонимный запрос; валидная identity по-прежнему разрешается и становится доступна контроллеру. |
| `@RequirePermission(permission)` | Route/class decorator | После аутентификации требует permission; при отсутствии возвращается типизированная ошибка доступа. Фактический аргумент сейчас имеет тип `string`. |
| `@CurrentAuth()` | Parameter decorator | Возвращает обязательный `AuthContext`; при отсутствии контекста сообщает об ошибочном использовании декоратора. |
| `@OptionalAuthContext()` | Parameter decorator | Возвращает `AuthContext \| null` для optional-маршрута. В текущей реализации отсутствующий контекст представлен `null`, не `undefined`. |
| `AuthContext` | Type | Union `UserAuthContext \| ServiceAuthContext`. |
| `UserAuthContext` | Type | Пользовательский principal: `userId`, `username`, status, auth method, permissions и опциональные session/API-key metadata. |
| `ServiceAuthContext` | Type | Внутренний relay principal: имя сервиса, permissions, correlation ID и operation ID. |
| `isUserContext()` | Type guard | Сужает `AuthContext` до `UserAuthContext`. |
| `isServiceContext()` | Type guard | Сужает `AuthContext` до `ServiceAuthContext`. |

Импорты в модуле и контроллере:

```ts
import { UnifiedAuthIntegrationModule } from "../../nest/integration/unified-auth.module.ts";
```

```ts
import {
  CurrentAuth,
  type AuthContext,
  isUserContext,
  Public,
  UnifiedAuthGuard,
} from "../../auth/public/index.ts";
```

Не импортировать внутренние resolvers, decorators или guard напрямую из
`auth/application`, `auth/domain` либо `auth/infrastructure`. Если контроллеру не хватает легитимного
auth-символа и dependency-cruiser запрещает внутренний импорт, сначала расширить public barrel.

## 2. Шаблон миграции модуля

Реальный diff пилота из `apps/api/src/modules/billing/billing.module.ts`:

```diff
 import { Module } from "@nestjs/common";
 import { DatabaseModule } from "../../nest/database/database.module.ts";
+import { UnifiedAuthIntegrationModule } from "../../nest/integration/unified-auth.module.ts";
 import { BillingController } from "./api/billing.controller.ts";
 // ...

 @Module({
-  imports: [DatabaseModule],
+  imports: [DatabaseModule, UnifiedAuthIntegrationModule],
   controllers: [BillingController],
   // ...
 })
 export class BillingModule {}
```

`UnifiedAuthIntegrationModule` предоставляет `UnifiedAuthGuard` и production runner для разрешения
контекста. Сам guard не добавляется в `providers` модуля-потребителя и не регистрируется как
`APP_GUARD`.

## 3. Шаблон миграции контроллера

Ниже — реальные before/after-фрагменты из `apps/api/src/modules/billing/api/billing.controller.ts`.

### 3.1 Защищённый маршрут

До миграции контроллер вручную читал legacy session identity из request:

```ts
import { Req } from "@nestjs/common";
import { SESSION_USER, type RequestWithSession } from "../../../nest/auth/session-verifier.ts";

@Controller()
export class BillingController {
  @Get("purchases")
  purchases(@Req() request: RequestWithSession) {
    return this.billing.purchases(user(request));
  }
}
```

После миграции guard ставится на класс, а handler принимает типизированный контекст:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import {
  CurrentAuth,
  type AuthContext,
  UnifiedAuthGuard,
} from "../../auth/public/index.ts";

@Controller()
@UseGuards(UnifiedAuthGuard)
export class BillingController {
  @Get("purchases")
  purchases(@CurrentAuth() ctx: AuthContext) {
    return this.billing.purchases(user(ctx));
  }
}
```

При class-level guard защищённый маршрут не требует отдельного auth-декоратора. Отсутствие
`@Public()` и `@OptionalAuth()` означает обязательную аутентификацию.

### 3.2 Публичный webhook

До миграции публичность webhook определялась только внешней legacy access matrix:

```ts
@Post("billing/webhooks/yookassa")
@HttpCode(200)
webhook(@Body() body: BillingLooseBodyDto) {
  return this.billing.webhook(body);
}
```

После миграции исключение становится явным рядом с маршрутом:

```ts
@Post("billing/webhooks/yookassa")
@Public()
@HttpCode(200)
webhook(@Body() body: BillingLooseBodyDto) {
  return this.billing.webhook(body);
}
```

Публичный handler не принимает `@CurrentAuth()` или `@OptionalAuthContext()`. `@Public()` полностью
пропускает guard и не разрешает identity даже при наличии credential.

### 3.3 Извлечение `userId`

До миграции:

```ts
function user(request: RequestWithSession): UserIdType {
  const value = request[SESSION_USER];
  if (value === undefined) throw new UnauthorizedException();
  return UserId(value.id);
}
```

После миграции:

```ts
function user(ctx: AuthContext): UserIdType {
  if (isUserContext(ctx)) return UserId(ctx.userId);
  throw new Error("Billing routes require a user auth context");
}
```

`AuthContext` является union: нельзя обращаться к `ctx.userId`, пока `isUserContext(ctx)` не сузил
тип. Не передавать целиком `AuthContext` в application/domain слой — на границе контроллера извлечь
уже существующий доменный идентификатор или другое необходимое значение.

Для маршрута с опциональной identity шаблон выглядит так:

```ts
@Get("example")
@OptionalAuth()
example(@OptionalAuthContext() ctx: AuthContext | null) {
  const userId = ctx !== null && isUserContext(ctx) ? UserId(ctx.userId) : undefined;
  return this.service.example(userId);
}
```

### 3.4 `@Req()` для не-auth целей

Некоторые контроллеры используют `@Req()` не для сессии, а для IP/headers/cookies. Такие вызовы
**сохраняются**, но тип меняется с `RequestWithSession` на чистый Request.

Стек проекта — **Express**, поэтому тип: `Request` из `express`.

Пример из `security.controller.ts` (когда security будет мигрирован):

```ts
// Было
async scan(@Req() request: RequestWithSession, @Body() body: ScanDto) {
  const session = request[SESSION_USER];
  if (!session) throw new UnauthorizedException();
  const identity = requestIdentity(request); // uses ip + headers
  return this.security.scan(session.id, body, identity);
}

// Стало
async scan(
  @CurrentAuth() ctx: AuthContext,
  @Req() request: Request,      // без RequestWithSession
  @Body() body: ScanDto,
) {
  if (!isUserContext(ctx)) throw new UnauthorizedException();
  const identity = requestIdentity(request);
  return this.security.scan(ctx.userId, body, identity);
}
```

Правила:

- `@Req()` **остаётся**, если request нужен для non-auth (ip/headers/cookies/rate-limit-identity)
- Тип — обычный `Request` из `express`
- `SESSION_USER` и `RequestWithSession` **удаляются** из импортов контроллера
- Helpers типа `requestIdentity(request)` не трогать

### 3.5 `@OptionalAuth` — маршрут работает и с сессией, и без

Пример из `ideas.controller.ts` (`GET /ideas/:id`) — публично видимый detail, но залогиненный получает персонализацию (свой голос, флаги владения).

```ts
import { OptionalAuth, OptionalAuthContext, isUserContext } from "../../auth/public/index.ts";
import type { AuthContext } from "../../auth/public/index.ts";

@Get(":id")
@OptionalAuth()
async detail(
  @Param("id") id: string,
  @OptionalAuthContext() ctx: AuthContext | null,
) {
  const userId = ctx !== null && isUserContext(ctx) ? ctx.userId : null;
  return this.ideas.detail(id, userId);
}
```

Правила:

- `@OptionalAuthContext()` возвращает `AuthContext | null` (**не `undefined`** — см. раздел 5)
- Проверка **`ctx !== null`**, не `if (ctx)`
- После null-проверки — `isUserContext(ctx)` для доступа к `ctx.userId`
- Handler передаёт в сервис `userId: string | null` — сервис отвечает за персонализацию

### 3.6 Mixed principal — session-or-API-key

Некоторые маршруты принимают несколько credential source: либо `portal_session` cookie/JWT, либо API-key (`mf_agent_*`, `mf_feedingest_*`, `mf_research_*`). Классические примеры — feed (POST /feed/posts, POST /feed/media, POST /feed/ingest) и printers (/research/*).

До миграции контроллеры вручную парсили Authorization header и делали fallback:

```ts
// Antipattern — не повторять
async function actor(request): Promise<Actor> {
  const session = await sessions.readSession(request);
  if (session) return { userId: session.id, method: "web" };
  const bearer = /^Bearer\s+(mf_agent_[^\s]+)/.exec(request.headers.authorization);
  if (bearer) return { userId: agentKey.verify(bearer[1]).ownerId, method: "agent" };
  throw new UnauthorizedException();
}
```

После миграции — `UnifiedAuthGuard` резолвит **любой** поддерживаемый credential автоматически. Handler читает `ctx.authMethod` для business-логики:

```ts
import { AuthContext, AuthMethod, isUserContext } from "../../auth/public/index.ts";

@Post("posts")
async create(@CurrentAuth() ctx: AuthContext, @Body() body: CreatePostDto) {
  if (!isUserContext(ctx)) throw new ForbiddenException();

  return this.feed.createPost({
    userId: ctx.userId,
    authMethod: ctx.authMethod,          // web_session | api_key_agent | api_key_feedingest
    coAuthorAgentId: ctx.coAuthorAgentId, // undefined кроме ApiKeyAgent
    apiKeyId: ctx.apiKeyId,               // undefined для web_session
    body,
  });
}
```

**Правила:**
- Не парси Authorization/cookie в handler. Всё уже в `ctx`.
- `ctx.authMethod` — источник правды для audit/business-логики. Импортируй `AuthMethod` enum из `auth/public/index.ts` и сравнивай через enum member (`AuthMethod.WebSession`, `AuthMethod.ApiKeyAgent`, etc.) — не через string literal. Boundaries запрещает импорт из `auth/domain/`.
- `ctx.coAuthorAgentId` доступен **только** при `ctx.authMethod === AuthMethod.ApiKeyAgent`.
- `ctx.apiKeyId` доступен при любом API-key принципале.
- Для rate-limit/analytics/request-id по-прежнему используй `@Req()` — resolver не покрывает эти нужды (см. §3.4).

**Приоритет резолверов зафиксирован в `UnifiedAuthIntegrationModule` factory:**
1. RelayServiceResolver (x-relay-service-token)
2. WebSessionResolver (portal_session cookie / Bearer JWT)
3. ApiKeyPubResolver (mf_pub_*)
4. ApiKeyResearchResolver (mf_research_*)
5. ApiKeyFeedingestResolver (mf_feedingest_*)
6. ApiKeyAgentResolver (mf_agent_*)

Prefix'ы взаимоисключающие, конфликтов нет.

### 3.7 API-key endpoints с runtime scope check (переходная стратегия)

Отдельный шаблон для маршрутов, где resolver **не может** самостоятельно проверить scope из-за жёстко зашитого контракта. Актуальный пример: publicapi `/v0/*` — один тип ключа `mf_pub_*` может иметь scope `read` или `control`, но `ApiKeyPubResolver.resolve` жёстко вызывает `authenticate(..., "read", ...)`. Для command endpoint это не подходит.

До завершения рефакторинга `PublicApiService.authenticate` (см. §9) `/v0/*` остаются под `@Public()` + runtime `authenticate` в handler:

```ts
@Post("v0/printers/:id/commands")
@Public()
async command(
  @Req() request: RequestWithId,
  @Param("id") id: string,
  @Headers("idempotency-key") idempotencyKey: string,
  @Body() body: CommandDto,
) {
  const principal = await this.api.authenticate(
    request.headers.authorization,
    "control",
    { request, requestId: request.id },
  );
  return this.api.executeCommand({ printerId: id, ownerId: principal.ownerId, body });
}
```

**Правила:**
- `@Public()` = «UnifiedAuthGuard не проверяет», не «маршрут безусловно открыт» (см. §8).
- Legacy matcher (access-matrix.ts) остаётся первым фильтром — он и открывает /v0/* через prefix.
- Handler делает runtime scope check через `this.api.authenticate(rawAuth, scope, ctx)`.
- Это **переходная стратегия**. Целевое состояние — resolver + `@RequirePermission("control")` — описано в §9 (deferred tasks).

**Когда использовать этот шаблон:** только для publicapi /v0/*. Не масштабировать без обсуждения — обычный mixed principal (feed, printers /research/*) идёт через §3.6.

### 3.8 Service-only принципалы (deferred в 4.3)

Резерв для маршрутов с `ServiceAuthContext` (`kind: "service"`). Единственный текущий кандидат — `RelayInternalController`, использующий `RelayServiceResolver` (возвращает `serviceName: "relay"`, `correlationId`, `operationId`).

**В 4.3 не мигрируется.** Причины:
- Расхождения `RelayServiceResolver` ↔ `RelayServiceGuard`:
  - Resolver не валидирует формат correlation/operation ID regex'ом
  - Resolver требует `x-operation-id` даже для GET (guard разрешает пропуск для GET)
  - Resolver не устанавливает correlation ID в response header
- Playbook §6 запрещает менять транспортную семантику
- Custom `RelayInternalExceptionFilter` тесно связан с текущим guard

`RelayInternalController` остаётся на `@UseGuards(RelayServiceGuard)` до отдельной задачи гармонизации (см. `docs/auth.migration.plan.md` → «Технический долг»).

**Целевой шаблон (для будущей задачи):**

```ts
import { AuthContext, isServiceContext } from "../../auth/public/index.ts";

@UseGuards(UnifiedAuthGuard)
@Controller("internal/relay/v1")
export class RelayInternalController {
  @Post("sessions/:sessionId/heartbeat")
  async heartbeat(@CurrentAuth() ctx: AuthContext, @Body() body: HeartbeatDto) {
    if (!isServiceContext(ctx) || ctx.serviceName !== "relay") {
      throw new ForbiddenException();
    }
    // ctx.correlationId, ctx.operationId доступны
    return this.relay.heartbeat({
      sessionId: body.sessionId,
      correlationId: ctx.correlationId,
      operationId: ctx.operationId,
      body,
    });
  }
}
```

Custom filter `RelayInternalExceptionFilter` можно оставить (playbook §6 не запрещает custom filter поверх guard'а).

## 4. Чек-лист на модуль

- [ ] Подключён `UnifiedAuthIntegrationModule` в `<mod>.module.ts`.
- [ ] На классе контроллера установлен `@UseGuards(UnifiedAuthGuard)`.
- [ ] Все маршруты сверены с `docs/protected-routes.md` и классифицированы как `public`, `optional`, `protected` или `role`.
- [ ] Для исключений явно добавлены `@Public()`, `@OptionalAuth()` либо `@RequirePermission(...)`.
- [ ] Удалены используемые для auth `@Req()`, `SESSION_USER` и `RequestWithSession`.
- [ ] `@Req()` оставлен только для не-auth целей: headers, IP, raw body и подобных транспортных данных.
- [ ] Перед доступом к `ctx.userId` выполнен `isUserContext(ctx)`.
- [ ] Слой `application/`, `domain/` и `infrastructure/` мигрируемого модуля не изменён.
- [ ] Старый `apps/api/src/nest/auth/auth.guard.ts` не удалён и не изменён.
- [ ] `pnpm --filter @portal/api typecheck` проходит.
- [ ] Тесты модуля проходят, например `pnpm --filter @portal/api exec vitest run src/modules/<mod>`.
- [ ] `pnpm --filter @portal/api boundaries` проходит.
- [ ] `pnpm --filter @portal/api exec vitest run src/nest/bootstrap.test.ts --reporter=dot` — bootstrap полного AppModule зелёный
- [ ] `git diff --stat` содержит только `apps/api/src/modules/<mod>/`, а при необходимости — `apps/api/src/modules/auth/public/index.ts`; для integration wiring допустим отдельный согласованный шов.

Команда из чернового чек-листа `pnpm --filter @portal/api test --run <mod>` не является корректной для
текущего `package.json`: script `test` уже запускает `vitest run` и не принимает модуль как позиционный
фильтр. Использовать `pnpm --filter @portal/api exec vitest run src/modules/<mod>`.

## 5. Подводные камни из пилота `billing`

- Использовать `UnifiedAuthIntegrationModule`, а не внутренний `UnifiedAuthModule`: только integration-обёртка собирает production dependencies и auth resolvers.
- `UnifiedAuthIntegrationModule` сейчас не входит в `auth/public/index.ts`; импортировать его напрямую по точному пути `apps/api/src/nest/integration/unified-auth.module.ts`.
- Boundaries могут потребовать расширения `auth/public/index.ts`. При нарушении dependency-cruiser добавить необходимый стабильный символ в public barrel вместо импорта из внутренностей auth-модуля.
- На публичном webhook ставить `@Public()` и не принимать auth context в сигнатуре.
- Приоритет cookie над bearer обеспечивается resolvers; контроллер не должен повторять parsing или fallback.
- Маршруты, указанные в аудите как `session_cookie / session_bearer`, но не читающие `userId`, остаются под guard без `@Public()`. Параметр `ctx` им не нужен.
- `@OptionalAuthContext()` возвращает `null` при отсутствии identity. Не проверять только на `undefined`.
- `@RequirePermission()` проверяет permission на любом `AuthContext`; если handler принимает только пользователя, отдельно сузить контекст через `isUserContext()`.
- Class-level `@UseGuards(UnifiedAuthGuard)` делает все методы защищёнными по умолчанию. Любое публичное исключение должно быть явно и локально помечено.
- **DI-граф guard'а**: UnifiedAuthGuard провайдится в UnifiedAuthIntegrationModule (не в UnifiedAuthModule) — потому что его зависимость RESOLVE_AUTH_CONTEXT объявлена там же. Модульные тесты потребителей этого не видят: DI-ошибки проявляются только при bootstrap полного AppModule. Отсюда обязательный bootstrap-тест в чек-листе.
- **Стек HTTP-адаптера — Express (не Fastify)**. Для сохранённых `@Req()` использовать `Request` из `express`.
- **Unit-тесты контроллеров вызывают методы напрямую.** При замене сигнатуры (`(req) → (ctx, req)`) TypeScript будет требовать обновление вызовов в тестах. Это допустимо и ожидаемо: обновить fixture, передавать `AuthContext` в первом аргументе. **Не путать с бизнес-логикой** — если падают тесты сервисов, а не сигнатур контроллеров, это регрессия миграции, а не рефакторинг тестов.

## 6. Запрещено

- Регистрировать `UnifiedAuthGuard` как `APP_GUARD`.
- Удалять или менять `apps/api/src/nest/auth/auth.guard.ts` в рамках модульной миграции.
- Менять `application/`, `domain/` или `infrastructure/` мигрируемого модуля.
- Менять провайдеры входа: email OTP, PlagID или SberID.
- Убирать расширения `.ts` из относительных импортов.
- Импортировать внутренние части auth-модуля в контроллер в обход `auth/public/index.ts`.
- Помечать маршрут `@Public()` только потому, что handler не читает `userId`: источник классификации — inventory и требования доступа, а не сигнатура handler.

## 7. Integration-тесты после миграции

UnifiedAuthGuard проверяет статус пользователя через `getUserAccountStatus` (SQL-запрос к `users`). Это означает, что HTTP-integration-тесты **не могут** просто подписать JWT для произвольного UUID — пользователь должен реально существовать в БД.

### Установившийся паттерн

По образцу `billing`, `achievements`, `push`:

1. **Skip без БД**:
   ```ts
   const canRun = Boolean(process.env.DATABASE_URL);
   describe.skipIf(!canRun)("...", () => { ... });
   ```

2. **Создание пользователя перед запросом**:

   ```ts
   async function createUser(): Promise<string> {
     const result = await pool.query<{ id: string }>(
       `insert into users (username) values ($1) returning id`,
       [`nest-<module>-${randomUUID()}`],
     );
     const id = result.rows[0]!.id;
     userIds.push(id);
     return id;
   }
   ```

3. JWT подписывается для этого `userId` (`subject = id`).

4. **Очистка в `afterAll`**:

   ```ts
   await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
   ```

### Важное отличие поведения

Старый AuthGuard: сессия с несуществующим userId → 200 (пропускал).

UnifiedAuthGuard: сессия с несуществующим userId → 403 `AUTH_ACCOUNT_DELETED`.

Это улучшение безопасности. Тесты, которые «работали» на несуществующих UUID, были некорректными.

### Известный технический долг

При недоступной БД `getUserAccountStatus` бросает необёрнутое исключение → HTTP 500. Правильнее — 503. Отдельная задача, не блокирует миграцию.

### Unit-тесты контроллеров: fake RESOLVE_AUTH_CONTEXT

Class-level `@UseGuards(UnifiedAuthGuard)` требует, чтобы Nest мог инстанцировать guard даже в минимальном test module — иначе `UnknownDependenciesException: RESOLVE_AUTH_CONTEXT` на bootstrap.

Для unit-тестов, которые НЕ импортируют production module (а значит не тянут `UnifiedAuthIntegrationModule` транзитивно), добавь fake resolver в `providers`:

```ts
import { RESOLVE_AUTH_CONTEXT } from "../../auth/infrastructure/nest/unified-auth.guard.ts";
import { AuthUnauthorizedError, AuthErrorCode } from "../../auth/domain/index.ts";

{
  provide: RESOLVE_AUTH_CONTEXT,
  useValue: async () => {
    throw new AuthUnauthorizedError(AuthErrorCode.MissingToken);
  },
},
```

**Правила:**
- Legacy `AuthGuard`, `SessionVerifier`, `{ provide: APP_GUARD, useClass: AuthGuard }` **оставить** — они обеспечивают CLOSED_DEV/PORTAL_PUBLIC гейт, проверяемый в unit-тестах.
- Fake resolver срабатывает только на protected маршрутах, где legacy уже отклонил запрос — поведение эквивалентно проду.
- Для integration-тестов, импортирующих production module, fake resolver **не нужен** — resolver придёт транзитивно через `UnifiedAuthIntegrationModule`.

Прецеденты: `catalog.controller.test.ts`, `generations.controller.test.ts`.

## 8. Семантика @Public() и legacy matcher

`@Public()` в `UnifiedAuthGuard` означает **«этот guard не проверяет маршрут»**, а НЕ «маршрут безусловно открыт для всех».

**Пока legacy `AuthGuard` остаётся глобальным**, вся runtime-политика доступа (включая condicionional public — например, CLOSED_DEV режим) реализуется через `access-matrix.ts` и продолжает работать поверх новых миграций:

```
Request → Legacy AuthGuard (access-matrix) → UnifiedAuthGuard (class-level)
                    ↓                              ↓
              CLOSED_DEV rules              @Public()/@CurrentAuth()
```

### Практические следствия

- Маршрут, помеченный `@Public()`, всё равно может быть закрыт legacy matcher'ом в CLOSED_DEV.
- Маршрут, помеченный `@CurrentAuth()`, всегда требует session (guard блокирует до handler'а).
- Не пытаться моделировать «conditional public» через новые декораторы прямо сейчас — это отдельная задача этапа 5 (cleanup + удаление legacy guard).

### Примеры из миграции

- `analytics.controller` POST `/consent` — `@OptionalAuth()`, но CLOSED_DEV блокировка держится legacy matcher'ом.
- `catalog.controller` — 8 read-маршрутов `@Public()`, 6 из них в CLOSED_DEV блокируются legacy matcher'ом (`/releases`, `/materials`, `/vendors`, `/machines` и их детали). 2 маршрута (`/printers`, `/printers/:slug`) в `ALWAYS_OPEN_GET_PATH_PATTERNS` — безусловно открыты.

### Что нельзя делать

- Убирать legacy `AuthGuard` из глобальных guard'ов на этапе 4.
- Вводить новые декораторы для conditional-public без плана миграции access-matrix.
- Полагаться на `@Public()` как единственный источник правды об открытости маршрута.

## X. Session issuance: `SessionIssuer` is the only path

Любой существующий или новый login provider обязан выдавать пользовательскую сессию только через
`SessionIssuer` из `apps/api/src/modules/auth/application/session-issuer.ts`:

- `SessionIssuer.issueCookie(response, userId)` — browser session cookie;
- `SessionIssuer.createNativeToken(userId)` — native/mobile JWT.

Прямые вызовы `AuthSessionService.issue(response, user)` и
`AuthSessionService.createToken(user)` из controller'ов, application-сервисов или новых providers
запрещены. `AuthSessionService` остаётся low-level writer. Единственный допустимый прямой callsite
вне `SessionIssuer` — `AuthController.logout()`, который вызывает `sessions.clear(response)` для
удаления cookie; это не выдача credential.

`SessionIssuer` гарантирует единый порядок проверок:

1. Загружает account status через `PROFILE_AUTH_STATUS_PORT.getUserAccountStatus(userId)`.
2. Для любого статуса, отличного от `active`, отказывает типизированным HTTP 403 через
   `authErrorToHttpException(accountNotActive(status))` (`AUTH_ACCOUNT_BLOCKED` или
   `AUTH_ACCOUNT_DELETED`).
3. Загружает профиль через `PROFILE_AUTH_PORT.findSessionUser(userId)`; этот lookup также принимает
   только активных пользователей.
4. Только после успешных проверок записывает cookie или подписывает native JWT.

По состоянию на текущую фиксацию `SessionIssuer` используют все реализованные login paths:

| Endpoint | Выдача |
|---|---|
| `POST /auth/email/verify` | `issueCookie` |
| `GET /auth/plagid/callback` | `issueCookie` для web + `createNativeToken` для native app deep-link |
| `POST /auth/password` | `issueCookie` |
| `POST /auth/dev` | `issueCookie` |

### Defence-in-depth для email и PlagID

`AuthService.sessionUser()` также проверяет account status перед возвратом `AuthenticatedUser`.
Эта проверка идемпотентна относительно `SessionIssuer` (дополнительный SQL-запрос) и является
намеренной defence-in-depth гарантией для email/PlagID login.

### SberID — deferred provider

`/auth/sberid/start` и `/auth/sberid/callback` пока не реализованы и возвращают HTTP 501. При
реализации SberID callback обязан использовать `SessionIssuer.issueCookie`; прямой вызов
`AuthSessionService` нарушит критерий 4 (login providers не выдают сессию неактивным пользователям).

### Password path

`AuthRepository.findPasswordCredential()` уже фильтрует `status = 'active'` в SQL. Поэтому
неактивный пользователь получает HTTP 401 (`invalid_credentials`) до вызова `SessionIssuer`; это
первичный gate, а `SessionIssuer.issueCookie` является вторичным defence-in-depth gate.

### Статус `suspended`

Текущая схема БД разрешает только `active | banned | deleted`. `AccountStatus.Suspended` существует
в domain-типе, но persistence его не поддерживает. Если схема будет расширена, `SessionIssuer`
автоматически покроет новый статус той же веткой `status !== AccountStatus.Active`. Отдельная задача
по расширению persistence описана в техническом долге `docs/auth.migration.plan.md`.

### Архитектурный контроль (реализован)

Инвариант защищён двумя ESLint-правилами в `apps/api/eslint.config.mjs`:

- Импорт `nest/auth/session-verifier` (`SESSION_USER`, `RequestWithSession`, `SessionVerifier`,
  `SESSION_COOKIE_NAME`) запрещён в production-коде
  `src/modules/*/api|application|infrastructure/**` вне `modules/auth/**`.
- Импорт `modules/auth/application/session.service` (`AuthSessionService`) запрещён везде, кроме
  `src/modules/auth/application/**`, `src/modules/auth/auth.module.ts` и test-файлов.

Оба правила покрывают критерий 8: архитектурная проверка блокирует парсинг сессии и прямую выдачу
вне auth. Legacy allowlist (`nest/**`, `*.test.ts`) будет очищен на финале — см. §9.

## 9. Финал миграции: блокер удаления legacy AuthGuard

Удаление legacy `AuthGuard` из глобального `APP_GUARD` — **отдельная задача после завершения 4.3**, не часть штатной миграции модулей.

### Что блокирует удаление

`UnifiedAuthGuard` не читает env и не знает про matcher-логику. Вся runtime-политика доступа по-прежнему живёт в:
- `apps/api/src/nest/auth/access-matrix.ts` — паттерны `PUBLIC_GET_PATH_PATTERNS`, `ALWAYS_OPEN_GET_PATH_PATTERNS`, `OPEN_EXACT_POST_PATH_PATTERNS`, `CLOSED_OPEN_PATH_PREFIXES`, `PUBLIC_OPEN_PATH_PREFIXES`
- `apps/api/src/nest/auth/auth.guard.ts` — глобальный APP_GUARD

Если удалить legacy `AuthGuard` без переноса matcher-логики:
- `/materials`, `/vendors`, `/machines`, `/releases` при `CLOSED_DEV=1` перестанут возвращать 401 (сейчас legacy закрывает, UnifiedAuthGuard видит `@Public()` и пропускает)
- Открытые POST'ы (`/feed/ingest`, `/feed/posts`, `/feed/media`) сломаются без явных `@Public()` меток
- Prefix-based правила (`/health/`, `/auth/`, `/seo/`, `/sitemap.xml`, `/consent`, `/devices/agent/`, `/internal/relay/`, `/research/`, `/v0/`, `/billing/webhooks/`) сломаются без миграции

### Варианты решения (для отдельного тикета)

**Вариант A — EnvironmentGateGuard.** Выделить matcher-логику из legacy `AuthGuard` в отдельный `EnvironmentGateGuard`, оставить его глобальным `APP_GUARD`, `UnifiedAuthGuard` продолжает работать class-level. Legacy `AuthGuard` удаляется. Двойной pipeline сохраняется, но чище.

**Вариант B — merge в UnifiedAuthGuard.** Перенести matcher-логику внутрь `UnifiedAuthGuard.canActivate`, добавить env-injection через ConfigService. `@Public()` семантика меняется — теперь она означает «маршрут открыт с учётом env». Одноpipeline, но требует пересмотра всех уже мигрированных `@Public()` меток.

**Вариант C — декларативная миграция matcher → декораторы.** Заменить весь `access-matrix.ts` на явные `@Public()`, `@AlwaysOpen()`, `@OpenInPublic()` (новый декоратор) на каждом маршруте. Наиболее honest подход, но объёмный.

Выбор варианта — отдельное продуктовое решение. До того legacy `AuthGuard` **остаётся** в `app.module.ts`.

### Что должно быть сделано перед стартом финала

- [ ] Все 31 модуль мигрированы (`UnifiedAuthGuard` на class-level, декораторы на маршрутах)
- [ ] Cleanup 2.1/2.2/2.3 закрыт
- [ ] Выбран вариант A / B / C
- [ ] Написаны тесты для нового поведения matcher (эквивалентность access-matrix.test.ts)
- [ ] Обновлён `characterization/differentialRegression.test.ts`

### Что удалить после финала

Только после успешного переноса matcher-логики:

- `apps/api/src/nest/auth/auth.guard.ts` — legacy AuthGuard
- `apps/api/src/nest/auth/session-verifier.ts` — если больше не используется в prod. **Внимание:** проверить bootstrap.test.ts, publicapi и других потребителей.
- `apps/api/src/nest/auth/access-matrix.ts` — если matcher-логика полностью перенесена
- Все упоминания `SESSION_USER`, `RequestWithSession` через глобальный `git grep`
- Регистрация `{ provide: APP_GUARD, useClass: AuthGuard }` в `app.module.ts`

Финальный аудит:
```bash
git grep -n "class AuthGuard"          # 0 совпадений
git grep -n "@UseGuards(AuthGuard)"    # 0
git grep -n "SESSION_USER"             # 0
git grep -n "RequestWithSession"       # 0
git grep -n "access-matrix"            # 0 (если matcher перенесён полностью)
```

### §9.X Финал вариант A — исполнение

**Стратегия:** разделение единого legacy `AuthGuard` на два guard'а по ответственности:

- `EnvironmentGateGuard` — env-check (`CLOSED_DEV` + `PORTAL_PUBLIC`), без чтения credential.
- `UnifiedAuthGuard` — identity-check per-controller/route через `ResolveAuthContext` chain.

**Подэтапы:**

- **Этап 1 (Вариант A, EnvironmentGateGuard).** Введён рядом с legacy `AuthGuard` как второй
  `APP_GUARD`; env-логика вынесена, legacy оставлен для identity. Добавлены 20 unit tests матрицы
  `closedDev × method × url`.
- **Этап 2 (API-key prefix binding).** Четыре API-key resolver'а привязаны к route prefixes через
  расширенный `AuthRequest`; `canHandle=false` вне scope даёт тихий 401 через chain skip.
- **Этап 4a.** Девять test setups мигрированы с legacy `AuthGuard` на `EnvironmentGateGuard`.
- **Этап 4b.** `bootstrap.test.ts` очищен от `SESSION_USER` и `RequestWithSession`; positive path
  удалён и покрывается unit-тестами. Fake resolver через дочерний `overrideProvider` не сработал
  из-за `@Global()` `UnifiedAuthIntegrationModule`; cookie precedence отложен как tech debt.
- **Этап 4c1.** `/auth/session` мигрирован на `UnifiedAuthGuard` + `@CurrentAuth()`;
  `PrinterResearchAuthAdapter.resolveUser` удалён как dead code.
- **Этап 4c2.** `SessionVerifier` и `SESSION_COOKIE_NAME` перенесены в
  `modules/auth/infrastructure/session/session-verifier.ts`; ESLint rule перенастроен на новый path.
- **Этап 4c3.** Удалены `AuthGuard`, `SESSION_USER`, `RequestWithSession`, `requiresSession`,
  `AuthMatrixInput`, `access-matrix.test.ts`; снят второй `APP_GUARD`. `SessionVerifier` binding
  обеспечивает `@Global()` `UnifiedAuthIntegrationModule`.

**Финальная архитектура:**

- Один `APP_GUARD`: `EnvironmentGateGuard`.
- `UnifiedAuthGuard` — identity-gate per-controller/route через `@UseGuards(UnifiedAuthGuard)`.
- Canonical session parser — `SessionVerifier` в `modules/auth/infrastructure/session/`.
- Session issuance — `SessionIssuer` (единственный API, ESLint-enforced).
- Resolver chain — Relay → WebSession → четыре prefix-bound API-key resolver'а.

**Deferred (post-финал tech debt):**

- UnifiedAuthGuard matrix test (4 methods × 4 statuses) — довести критерий 6 до 100%.
- Cookie precedence integration test — фактический выбор cookie vs Bearer в `WebSessionResolver`.
- Characterization baseline sync (308 → 309, 261 → 262).
- Route-level `@AcceptMethods` decorator (low priority, defence-in-depth).

### Deferred tasks (не блокеры финала, но параллельный техдолг)

Задачи, которые не блокируют финальное удаление legacy AuthGuard, но накопились по ходу миграции и требуют отдельных тикетов. См. также `docs/auth.migration.plan.md` → «Технический долг».

**1. `PublicApiService.authenticate` split → identify/enforce**

`ApiKeyPubResolver` жёстко вызывает `authenticate(..., "read", ctx)`. Для scope `"control"` handler делает повторный вызов, что вынуждает `/v0/*` оставаться на `@Public()` + runtime auth (§3.7).

Рефакторинг:
- `PublicApiService.identify(rawKey): Promise<PublicApiPrincipal>` — без scope check, только token verification
- `PublicApiService.enforceScope(principal, scope): void` — throws на несоответствие scope
- `ApiKeyPubResolver.resolve` вызывает `identify`, кладёт `principal.scopes` в `ctx.permissions`
- Handler декларирует требование через `@RequirePermission("control")` — UnifiedAuthGuard берёт enforcement на себя
- `/v0/*` теряют `@Public()`, переходят на стандартный §3.1 шаблон

**2. `RelayServiceResolver` ↔ `RelayServiceGuard` harmonization**

Три расхождения (см. §3.8). Решение:
- Привести `RelayServiceResolver` к текущему контракту `RelayServiceGuard` (regex validation, GET-optional operation-id, response header)
- Мигрировать `RelayInternalController` на `@UseGuards(UnifiedAuthGuard)` + §3.8 шаблон
- `RelayServiceGuard` удаляется

**3. `community-firmware` access-matrix drift**

`GET /community-firmware` документирован как public в `protected-routes.md`, но отсутствует в matcher patterns. Не миграционная задача, требует продуктового решения.

**4. `getUserAccountStatus` 500 → 503**

При ошибке БД в `SessionVerifier` возвращается HTTP 500. Правильнее 503. Мелкая правка.
