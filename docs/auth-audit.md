# Аудит аутентификации `apps/api`

Дата аудита: 2026-08-13. Область: production-код `apps/api`; тестовые JWT-фабрики перечислены отдельно. Это статический аудит исходников и актуального `db/schema.sql`, без изменения кода и без проверки секретов из `.env`.

## Краткая схема

- Пользовательская сессия stateless: JWT `HS256` на 30 дней, `sub = user.id`, claim `username`; основной транспорт — HttpOnly-cookie `portal_session`, запасной — `Authorization: Bearer`. Токен выпускает [`AuthSessionService`](../apps/api/src/modules/auth/application/session.service.ts#L25-L43), проверяет [`SessionVerifier`](../apps/api/src/nest/auth/session-verifier.ts#L19-L48).
- Глобальный [`AuthGuard`](../apps/api/src/nest/auth/auth.guard.ts#L7-L26) по матрице открытых маршрутов требует сессию и прикрепляет identity к request через символ `SESSION_USER`. Список открытых поверхностей находится в [`access-matrix.ts`](../apps/api/src/nest/auth/access-matrix.ts#L3-L84).
- Серверной таблицы пользовательских `sessions` нет: logout только очищает cookie, а выпущенный JWT до истечения срока централизованно не отзывается.
- Помимо пользовательского JWT есть отдельные контуры: PlagID JWT, legacy device-agent JWT, короткий command JWT, хешированные public/user API keys, relay service token и mTLS fingerprint.

## 1. Где парсятся cookie, JWT и `Authorization`

### 1.1 Пользовательская сессия

- [`nest/auth/session-verifier.ts:19-29`](../apps/api/src/nest/auth/session-verifier.ts#L19-L29) — единственная центральная функция извлечения session token. Сначала парсит `request.headers.cookie` пакетом `cookie` и берёт `portal_session`; только если cookie-токена нет, принимает точный `Bearer <token>` из `request.headers.authorization`. Наличие даже невалидной cookie имеет приоритет над bearer.
- [`nest/auth/session-verifier.ts:35-48`](../apps/api/src/nest/auth/session-verifier.ts#L35-L48) — проверяет session JWT через `jose.jwtVerify` и `JWT_SECRET`, требует строковые `payload.sub` и `payload.username`, возвращает `{ id, username }`.
- [`modules/auth/application/session.service.ts:25-43`](../apps/api/src/modules/auth/application/session.service.ts#L25-L43) — создаёт session JWT (`HS256`, `sub`, `username`, `iat`, `exp=30d`) и кладёт его в `portal_session` с `HttpOnly`, `SameSite=Lax`, `Secure` в production.
- [`modules/auth/api/auth.controller.ts:48-64`](../apps/api/src/modules/auth/api/auth.controller.ts#L48-L64) — `/auth/session` повторно вызывает `SessionVerifier`, затем сверяет `sub` с активным пользователем БД.

Пакета `jsonwebtoken`, а также обращений `req.cookies`/`request.cookies` в `apps/api` нет. Используются `jose` и ручной разбор заголовка `Cookie`.

### 1.2 Другие входящие cookie

- [`modules/auth/api/auth.controller.ts:86-92`](../apps/api/src/modules/auth/api/auth.controller.ts#L86-L92) — `portal_anon` при email OTP verify; при регистрации связывает signup с анонимной аналитикой.
- [`modules/auth/api/auth.controller.ts:130-153`](../apps/api/src/modules/auth/api/auth.controller.ts#L130-L153) — `portal_anon` и `plagid_app` в callback PlagID; последний выбирает web/native redirect.
- [`modules/analytics/api/analytics.controller.ts:26-40`](../apps/api/src/modules/analytics/api/analytics.controller.ts#L26-L40) — `portal_anon` для consent и опционально читает пользовательскую сессию.
- [`modules/profile/api/profile-inventory.controller.ts:67-83`](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L67-L83) — `portal_anon` для activation event.
- [`modules/printers/api/printers.controller.ts:103-119`](../apps/api/src/modules/printers/api/printers.controller.ts#L103-L119) — `portal_anon` для research upsert.

Эти cookie не аутентифицируют пользователя; это analytics/native-intent state.

### 1.3 Другие JWT

- [`modules/auth/application/auth.service.ts:126-135`](../apps/api/src/modules/auth/application/auth.service.ts#L126-L135) — проверка входящего PlagID JWT через отдельный `PLAGID_EXTERNAL_TOKEN_SECRET`; обязательны `telegramId:number` и `firstName:string`.
- [`modules/devices/infrastructure/agent-session.ts:28-39`](../apps/api/src/modules/devices/infrastructure/agent-session.ts#L28-L39) — выпуск legacy device-agent JWT (`AGENT_JWT_SECRET`, `typ=agent`, `sub=agentId`, `owner_id`, `device_id`, `role`, TTL 400 дней).
- [`modules/devices/infrastructure/agent-session.ts:52-63`](../apps/api/src/modules/devices/infrastructure/agent-session.ts#L52-L63) — проверка legacy device-agent JWT и извлечение `agentId/ownerId/deviceId/role`. В текущем `apps/api` функция только экспортируется; HTTP-контроллер её не вызывает.
- [`modules/devices/infrastructure/command-token.ts:34-48`](../apps/api/src/modules/devices/infrastructure/command-token.ts#L34-L48) — выпуск EdDSA command JWT на 60 секунд с issuer/audience, `owner_id`, `actor_id`, `device_id`, role/scope/command/sequence. Проверка предназначена device-agent, не `apps/api`.
- [`modules/devices/infrastructure/devices.repository.ts:252-258`](../apps/api/src/modules/devices/infrastructure/devices.repository.ts#L252-L258) — `decodeJwt` без криптографической проверки используется только для чтения `exp` у JWT, который API только что сам выпустил.

### 1.4 Bearer/API-key поверхности

- [`modules/publicapi/api/publicapi.controller.ts:77-84`](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L77-L84) — передаёт `r.headers.authorization` в public API authenticator.
- [`modules/publicapi/application/publicapi.service.ts:166-188`](../apps/api/src/modules/publicapi/application/publicapi.service.ts#L166-L188) — парсит case-insensitive `Bearer`, требует префикс `mf_pub_`, SHA-256 lookup в `api_keys`, проверяет expiry/revocation и scope `read|control`; principal получает `ownerId` из БД.
- [`modules/feed/api/feed.controller.ts:64-65`](../apps/api/src/modules/feed/api/feed.controller.ts#L64-L65) — общий точный parser `Bearer <token>`.
- [`modules/feed/api/feed.controller.ts:103-110`](../apps/api/src/modules/feed/api/feed.controller.ts#L103-L110) — `/feed/ingest`: bearer `mf_feedingest_*` → `userId` service-user.
- [`modules/feed/api/feed.controller.ts:223-242`](../apps/api/src/modules/feed/api/feed.controller.ts#L223-L242) — create/upload: сначала browser session, иначе bearer `mf_agent_*` → owner user плюс `coAuthorAgentId`.
- [`nest/integration/feed.adapters.ts:62-75`](../apps/api/src/nest/integration/feed.adapters.ts#L62-L75) — преобразует agent/feed-ingest API-key principal в доменный actor.
- [`modules/printers/api/printers.controller.ts:39-42`](../apps/api/src/modules/printers/api/printers.controller.ts#L39-L42) и [`nest/integration/printers.adapters.ts:38-44`](../apps/api/src/nest/integration/printers.adapters.ts#L38-L44) — research-маршруты принимают обычную session cookie/JWT либо bearer `mf_research_*`.
- Верификаторы хешированных `user_api_keys`: [`research-api-key.ts:25-49`](../apps/api/src/modules/publicapi/infrastructure/research-api-key.ts#L25-L49), [`feed-ingest-api-key.ts:28-52`](../apps/api/src/modules/publicapi/infrastructure/feed-ingest-api-key.ts#L28-L52), [`agent-content-api-key.ts:31-57`](../apps/api/src/modules/publicapi/infrastructure/agent-content-api-key.ts#L31-L57). Все проверяют prefix, SHA-256 hash, scope/status/revocation/expiry; agent-content дополнительно проверяет активность `content_agents`.
- [`modules/relayInternal/api/relay-service.guard.ts:23-46`](../apps/api/src/modules/relayInternal/api/relay-service.guard.ts#L23-L46) — не bearer: читает `x-relay-service-token`, сравнивает SHA-256 digest в constant time с `RELAY_SERVICE_TOKEN`; параллельно валидирует correlation/operation IDs.

Исходящие `Authorization`, не относящиеся к аутентификации самого API: Prusa Connect bearer в [`prusa-connect.client.ts:67`](../apps/api/src/modules/printers/infrastructure/prusa-connect.client.ts#L67) и Cults3D Basic auth в [`cults3d.ts:150`](../apps/api/src/modules/imports/infrastructure/cults3d.ts#L150).

## 2. Где определяется `userId` / `username`

### 2.1 Основной путь identity

1. [`SessionVerifier`](../apps/api/src/nest/auth/session-verifier.ts#L35-L48) извлекает `id = JWT sub` и `username = JWT username`.
2. Глобальный [`AuthGuard`](../apps/api/src/nest/auth/auth.guard.ts#L14-L25) решает, нужна ли сессия, и пишет результат в `request[SESSION_USER]`.
3. Контроллеры читают `request[SESSION_USER].id`, обычно оборачивая его в branded `UserId`. Middleware, определяющего пользователя, нет; observability-interceptors identity не устанавливают.
4. `/auth/session` дополнительно загружает активную запись `users` через [`ProfileRepository.findSessionUser`](../apps/api/src/modules/profile/infrastructure/profile.repository.ts#L174-L180); возвращаемый наружу username берётся из БД, а не напрямую из JWT.

Контроллеры, локально извлекающие `userId` из `SESSION_USER`:

- [`achievements.controller.ts:9-13`](../apps/api/src/modules/achievements/api/achievements.controller.ts#L9-L13), [`agents.controller.ts:9-14`](../apps/api/src/modules/agents/api/agents.controller.ts#L9-L14), [`assistant.controller.ts:9-13`](../apps/api/src/modules/assistant/api/assistant.controller.ts#L9-L13), [`billing.controller.ts:7-11`](../apps/api/src/modules/billing/api/billing.controller.ts#L7-L11).
- [`catalog.controller.ts:118-122`](../apps/api/src/modules/catalog/api/catalog.controller.ts#L118-L122), [`community.controller.ts:27`](../apps/api/src/modules/community/api/community.controller.ts#L27), [`devices.controller.ts:22-26`](../apps/api/src/modules/devices/api/devices.controller.ts#L22-L26).
- [`feed.controller.ts:223-242`](../apps/api/src/modules/feed/api/feed.controller.ts#L223-L242), [`generations.controller.ts:15-19`](../apps/api/src/modules/generations/api/generations.controller.ts#L15-L19), [`ideas.controller.ts:30-39`](../apps/api/src/modules/ideas/api/ideas.controller.ts#L30-L39).
- [`import-connections.controller.ts:10-14`](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L10-L14), [`imports.controller.ts:10-14`](../apps/api/src/modules/imports/api/imports.controller.ts#L10-L14), [`makers.controller.ts:8-12`](../apps/api/src/modules/makers/api/makers.controller.ts#L8-L12), [`makes.controller.ts:37-41`](../apps/api/src/modules/makes/api/makes.controller.ts#L37-L41).
- [`master.controller.ts:8-12`](../apps/api/src/modules/master/api/master.controller.ts#L8-L12), [`master-equipment.controller.ts:8-12`](../apps/api/src/modules/masterEquipment/api/master-equipment.controller.ts#L8-L12), [`master-services.controller.ts:8-12`](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L8-L12), [`moderation.controller.ts:16-21`](../apps/api/src/modules/moderation/api/moderation.controller.ts#L16-L21).
- [`orders.controller.ts:8-12`](../apps/api/src/modules/orders/api/orders.controller.ts#L8-L12), [`organizations.controller.ts:8-12`](../apps/api/src/modules/organizations/api/organizations.controller.ts#L8-L12), [`print-requests.controller.ts:9-13`](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L9-L13), [`printers.controller.ts:22-26`](../apps/api/src/modules/printers/api/printers.controller.ts#L22-L26).
- [`profile-inventory.controller.ts:40-44`](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L40-L44), [`profile.controller.ts:19-23`](../apps/api/src/modules/profile/api/profile.controller.ts#L19-L23), [`projects.controller.ts:25-29`](../apps/api/src/modules/projects/api/projects.controller.ts#L25-L29).
- [`publicapi.controller.ts:22-26`](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L22-L26), [`push.controller.ts:17-21`](../apps/api/src/modules/push/api/push.controller.ts#L17-L21), [`security.controller.ts:20-24`](../apps/api/src/modules/security/api/security.controller.ts#L20-L24), [`slicer-profiles.controller.ts:29-33`](../apps/api/src/modules/slicerProfiles/api/slicer-profiles.controller.ts#L29-L33).

Дополнительное опциональное чтение сессии на открытых маршрутах: [`analytics.controller.ts:39-40`](../apps/api/src/modules/analytics/api/analytics.controller.ts#L39-L40), [`feed.controller.ts:229-240`](../apps/api/src/modules/feed/api/feed.controller.ts#L229-L240), [`projects.controller.ts:371-373`](../apps/api/src/modules/projects/api/projects.controller.ts#L371-L373), research adapter [`printers.adapters.ts:38-44`](../apps/api/src/nest/integration/printers.adapters.ts#L38-L44).

### 2.2 Где identity создаётся или разрешается не из session JWT

- Email: [`AuthService.verifyEmail`](../apps/api/src/modules/auth/application/auth.service.ts#L84-L123) разрешает `userId` через `(provider=email_corp, identifier_hash)` либо создаёт пользователя; username строится из local-part в [`handleFromLocalPart`](../apps/api/src/modules/auth/application/auth.service.ts#L41-L43).
- PlagID: [`AuthService.loginPlagId`](../apps/api/src/modules/auth/application/auth.service.ts#L126-L152) разрешает `userId` по хешу Telegram ID либо создаёт пользователя; username строится из Telegram username/ID в [`handleFromTelegram`](../apps/api/src/modules/auth/application/auth.service.ts#L45-L48).
- Password: [`AuthService.loginPassword`](../apps/api/src/modules/auth/application/auth.service.ts#L165-L176) нормализует username и получает `{id, username}` из `users JOIN user_password_credentials`; SQL — [`auth.repository.ts:62-77`](../apps/api/src/modules/auth/infrastructure/auth.repository.ts#L62-L77).
- Dev bypass: [`AuthService.devLogin`](../apps/api/src/modules/auth/application/auth.service.ts#L155-L163) и [`ProfileRepository.upsertDevUser`](../apps/api/src/modules/profile/infrastructure/profile.repository.ts#L206-L214) создают/возвращают фиксированного `devuser`.
- Public API key: [`PublicApiService.authenticate`](../apps/api/src/modules/publicapi/application/publicapi.service.ts#L166-L188) возвращает `ownerId` из `api_keys.owner_id`.
- Research/feed-ingest/agent-content keys возвращают соответственно `user_api_keys.user_id` или пару owner/agent: [`research-api-key.ts:32-45`](../apps/api/src/modules/publicapi/infrastructure/research-api-key.ts#L32-L45), [`feed-ingest-api-key.ts:35-48`](../apps/api/src/modules/publicapi/infrastructure/feed-ingest-api-key.ts#L35-L48), [`agent-content-api-key.ts:38-52`](../apps/api/src/modules/publicapi/infrastructure/agent-content-api-key.ts#L38-L52).
- Device-agent JWT возвращает `agentId`, `ownerId`, `deviceId` из claims: [`agent-session.ts:52-60`](../apps/api/src/modules/devices/infrastructure/agent-session.ts#L52-L60).
- Relay mTLS session разрешает gateway и владельца через `agents`: [`relay-control.repository.ts:121-163`](../apps/api/src/modules/devices/infrastructure/relay-control.repository.ts#L121-L163); для дальнейших команд owner берётся через join `relay_gateway_sessions → agents` в [`relay-control.repository.ts:314-328`](../apps/api/src/modules/devices/infrastructure/relay-control.repository.ts#L314-L328).

## 3. Провайдеры входа и точки создания сессии

Все реализованные пользовательские методы сходятся в [`AuthSessionService.issue`](../apps/api/src/modules/auth/application/session.service.ts#L34-L43), который создаёт один и тот же `portal_session` JWT.

| Провайдер | Вход и проверка | Создание/поиск пользователя | Где создаётся сессия | Статус |
|---|---|---|---|---|
| Corporate email OTP | [`POST /auth/email/start`, `POST /auth/email/verify`](../apps/api/src/modules/auth/api/auth.controller.ts#L75-L92); логика OTP [`auth.service.ts:65-123`](../apps/api/src/modules/auth/application/auth.service.ts#L65-L123) | `user_identities(email_corp)` либо новый `users`; допустимы только `sberbank.ru`, `sberdevices.ru` ([`domain/auth.ts:5`](../apps/api/src/modules/auth/domain/auth.ts#L5)) | [`auth.controller.ts:91`](../apps/api/src/modules/auth/api/auth.controller.ts#L91) | Реализован |
| PlagID / Telegram | start/callback [`auth.controller.ts:110-157`](../apps/api/src/modules/auth/api/auth.controller.ts#L110-L157), внешний JWT проверяется в [`auth.service.ts:126-135`](../apps/api/src/modules/auth/application/auth.service.ts#L126-L135) | `user_identities(plag_id)` либо новый `users` | Cookie — [`auth.controller.ts:149`](../apps/api/src/modules/auth/api/auth.controller.ts#L149); для native app дополнительно bearer JWT в redirect — [`auth.controller.ts:150-153`](../apps/api/src/modules/auth/api/auth.controller.ts#L150-L153) | Реализован |
| Local password / bootstrap admin | [`POST /auth/password`](../apps/api/src/modules/auth/api/auth.controller.ts#L95-L107), scrypt verify [`auth.service.ts:165-176`](../apps/api/src/modules/auth/application/auth.service.ts#L165-L176) | `users JOIN user_password_credentials`; bootstrap создаёт/активирует admin в [`admin-bootstrap.service.ts:16-30`](../apps/api/src/modules/auth/application/admin-bootstrap.service.ts#L16-L30) и [`auth.repository.ts:80-101`](../apps/api/src/modules/auth/infrastructure/auth.repository.ts#L80-L101) | [`auth.controller.ts:106`](../apps/api/src/modules/auth/api/auth.controller.ts#L106) | Реализован, служебный локальный провайдер |
| Dev bypass | [`POST /auth/dev`](../apps/api/src/modules/auth/api/auth.controller.ts#L171-L180); включается только `AUTH_DEV_BYPASS=1/true` вне production ([`auth.controller.ts:33-36`](../apps/api/src/modules/auth/api/auth.controller.ts#L33-L36)) | upsert фиксированного `devuser` [`profile.repository.ts:206-214`](../apps/api/src/modules/profile/infrastructure/profile.repository.ts#L206-L214) | [`auth.controller.ts:178`](../apps/api/src/modules/auth/api/auth.controller.ts#L178) | Реализован, non-production only |
| SberID / SSO | `/auth/sberid/start` и callback [`auth.controller.ts:159-169`](../apps/api/src/modules/auth/api/auth.controller.ts#L159-L169) | Нет | Нет; возвращается 501 [`auth.controller.ts:193-201`](../apps/api/src/modules/auth/api/auth.controller.ts#L193-L201) | Заглушка |
| GigaID | В БД зарезервирован provider `giga_id` ([`schema.sql:3820-3829`](../apps/api/db/schema.sql#L3820-L3829)) | Нет runtime-кода | Нет | Не реализован |

Logout [`auth.controller.ts:67-72`](../apps/api/src/modules/auth/api/auth.controller.ts#L67-L72) только очищает `portal_session` через [`session.service.ts:46-51`](../apps/api/src/modules/auth/application/session.service.ts#L46-L51).

## 4. Таблицы БД, связанные с аутентификацией

### Прямые таблицы пользовательской аутентификации

- [`users`](../apps/api/db/schema.sql#L1546-L1570) — canonical account: `id`, `username`, status, роли/флаги. Активность пользователя перепроверяется `/auth/session`, но не самим `SessionVerifier` на каждом защищённом запросе.
- [`user_identities`](../apps/api/db/schema.sql#L3820-L3829) — связь пользователя с внешними identity (`email_corp`, `plag_id`, зарезервированный `giga_id`); идентификатор хранится как hash, сырой encrypted identity — по S3 key.
- [`email_otp`](../apps/api/db/schema.sql#L1157-L1164) — хеш email, хеш OTP, expiry, attempts.
- [`user_password_credentials`](../apps/api/db/schema.sql#L3850-L3863) — приватный scrypt password hash bootstrap/local account.
- Таблицы `sessions` нет. `build_sessions` — производственный workflow, а `relay_gateway_sessions` — device relay; ни одна не является browser-login session.

### API keys и agent identity

- [`api_keys`](../apps/api/db/schema.sql#L306-L327) — public printer API bearer keys `mf_pub_*`, owner, SHA-256 hash, scopes `read/control`, revocation/expiry/last use.
- [`user_api_keys`](../apps/api/db/schema.sql#L3700-L3729) — user/service keys для `public_api`, `research`, `feed_ingest`, `agent_content`, а также printer/slicing credentials; хранит hash либо encrypted secret, scope/status/expiry и optional `agent_id`.
- [`agents`](../apps/api/db/schema.sql#L282-L299) — device/gateway agents, owner, status/revocation, relay certificate fingerprint и authorization revision. Legacy agent JWT plaintext здесь не хранится.
- [`content_agents`](../apps/api/db/schema.sql#L789-L800) — AI/content-agent identity, owner и revocation; `user_api_keys.agent_id` ссылается на неё.
- [`relay_gateway_sessions`](../apps/api/db/schema.sql#L3177-L3195) — stateful relay session по gateway, certificate fingerprint, generation/revision/state/heartbeat. Это не пользовательская web-сессия.
- [`device_enroll_codes`](../apps/api/db/schema.sql#L891-L921) — одноразовые enrollment/recovery credentials, связываемые с `agents`/device; относится к bootstrap аутентификации устройства.
- [`device_shares`](../apps/api/db/schema.sql#L1053-L1062) — ACL `device_id ↔ user_id ↔ role`, используемый при авторизации device-команд.

Манифест auth-домена сейчас объявляет только `email_otp`, `user_identities`, `users` ([`auth.tables.ts:3-6`](../apps/api/src/modules/auth/infrastructure/auth.tables.ts#L3-L6)); при этом runtime auth также напрямую использует `user_password_credentials` в [`auth.repository.ts:62-101`](../apps/api/src/modules/auth/infrastructure/auth.repository.ts#L62-L101).

## 5. NestJS Guards

В production-коде найдено два класса `CanActivate`:

1. [`AuthGuard`](../apps/api/src/nest/auth/auth.guard.ts#L7-L26) — глобальный `APP_GUARD`, зарегистрирован в [`nest/app.module.ts:129-139`](../apps/api/src/nest/app.module.ts#L129-L139). По [`access-matrix.ts`](../apps/api/src/nest/auth/access-matrix.ts#L70-L84) либо пропускает открытый маршрут, либо требует валидный session JWT и прикрепляет `SESSION_USER`.
2. [`RelayServiceGuard`](../apps/api/src/modules/relayInternal/api/relay-service.guard.ts#L19-L47) — controller-scoped guard для internal relay API; подключён через [`@UseGuards`](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L32-L37). Проверяет service token, correlation ID и operation ID. Провайдер зарегистрирован в [`relay-internal.module.ts:9-12`](../apps/api/src/modules/relayInternal/relay-internal.module.ts#L9-L12).

Отдельных role/staff Guards нет. Административные действия проверяются через endpoint permissions и `PermissionsService`; альтернативные principals проверяются внутри своих controllers/services/adapters: например, public API key — [`PublicApiService.authenticate`](../apps/api/src/modules/publicapi/application/publicapi.service.ts#L166-L188), device ACL — в devices/relay repositories.

## Наблюдения и риски

1. **Нет server-side revocation пользовательских сессий.** Browser-session JWT живёт до 30 дней; logout очищает только локальную cookie. Удаление/бан пользователя не инвалидирует JWT на большинстве защищённых endpoints, потому что глобальный guard проверяет claims, но не статус `users`; DB-проверка есть явно только у `/auth/session`.
2. **Один `JWT_SECRET`, токен без issuer/audience/typ.** Session JWT валидируется только по подписи и форме `sub/username`; собственные `iss`, `aud`, `typ` не задаются и не проверяются. Отдельный device-agent контур, напротив, использует отдельный secret и `typ=agent`.
3. **Cookie имеет абсолютный приоритет над Authorization.** Невалидная `portal_session` не позволяет fallback к валидному bearer. Это зафиксированное поведение центрального verifier.
4. **Identity extraction дублируется в контроллерах.** Более 30 локальных `user()/actor()/currentUserId()` helpers читают один `SESSION_USER`; это повышает риск различий в обработке отсутствующей identity. `community.controller` использует non-null assertion.
5. **Несколько параллельных bearer-схем.** Session JWT, `mf_pub_*`, `mf_user_*`, `mf_research_*`, `mf_feedingest_*`, `mf_agent_*` и legacy device-agent JWT разделяются префиксами/секретами, но маршрутизация выполняется локально в controllers/adapters, а не единым typed principal layer.
6. **`decodeJwt` без verify допустим только в текущем узком месте.** Он читает expiry только что выпущенного API токена; перенос этого приёма на входящий credential был бы уязвимостью.
7. **Есть drift в ownership metadata.** `auth.tables.ts` не перечисляет `user_password_credentials`, хотя `AuthRepository` читает и пишет таблицу.
8. **`mf_user_*` выпускается, но consumer не найден.** [`PublicApiService.createUserApiKey`](../apps/api/src/modules/publicapi/application/publicapi.service.ts#L133-L160) создаёт `user_api_keys(scope=public_api)` с префиксом `mf_user_`, однако production-поиск не нашёл verifier/authentication path для этого префикса; `/v0/*` принимает только `mf_pub_*` из таблицы `api_keys`.
9. **SSO не завершён.** SberID — явная 501-заглушка; `giga_id` существует только как допустимое значение в схеме.

## Тестовые JWT-фабрики

Тесты создают session/PlagID JWT через `SignJWT` в: `nest/bootstrap.test.ts`; controller/integration tests модулей `achievements`, `agents`, `analytics`, `assistant`, `auth`, `billing`, `catalog`, `feed`, `generations`, `importConnections`, `imports`, `masterServices`, `moderation`, `organizations`, `profile`, `projects`, `publicapi`, `push`, `security`, `slicerProfiles`. Они не являются production parsing points. Отдельный [`command-token.test.ts:21`](../apps/api/src/modules/devices/infrastructure/command-token.test.ts#L21) проверяет выпущенный command JWT публичным ключом.
