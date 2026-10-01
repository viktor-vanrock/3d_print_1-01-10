# Защищённые HTTP-маршруты `apps/api`

Дата инвентаризации: 2026-08-13. Источник маршрутов — активные NestJS-декораторы `@Controller` + `@Get/@Post/@Put/@Patch/@Delete` в `apps/api/src`; источник решения о публичности — [`access-matrix.ts`](../apps/api/src/nest/auth/access-matrix.ts#L3). В отчёт вошло 300 активных маршрутов. Исторический `routes.manifest.json` использован только для сверки, поскольку он содержит formally-removed записи и уже расходится с текущими контроллерами.

В колонке «Способ входа» запись `session_cookie / session_bearer` означает два транспорта одного session JWT: cookie `portal_session` или `Authorization: Bearer`. Cookie имеет приоритет. Значение `mixed` оставлено для маршрутов, принимающих session JWT **или** отдельный API-key. `public` означает отсутствие пользовательской session/API-key аутентификации; у device enrollment и webhook при этом есть собственная прикладная проверка, указанная в «Особенностях».

## 1. Полностью публичные маршруты

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/consent` | POST | [analytics.controller.ts:23](../apps/api/src/modules/analytics/api/analytics.controller.ts#L23) | AuthGuard (глобальный, bypass matcher) | `public` | JWT claims (optional) | опциональная сессия через SessionVerifier; в CLOSED_DEV требует session |
| `/auth/logout` | POST | [auth.controller.ts:67](../apps/api/src/modules/auth/api/auth.controller.ts#L67) | AuthGuard (глобальный, bypass matcher) | `public` | none | только очищает cookie; server-side revocation нет |
| `/auth/email/start` | POST | [auth.controller.ts:75](../apps/api/src/modules/auth/api/auth.controller.ts#L75) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/auth/email/verify` | POST | [auth.controller.ts:83](../apps/api/src/modules/auth/api/auth.controller.ts#L83) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/auth/password` | POST | [auth.controller.ts:95](../apps/api/src/modules/auth/api/auth.controller.ts#L95) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/auth/plagid/start` | GET | [auth.controller.ts:110](../apps/api/src/modules/auth/api/auth.controller.ts#L110) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/auth/plagid/callback` | GET | [auth.controller.ts:128](../apps/api/src/modules/auth/api/auth.controller.ts#L128) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/auth/sberid/start` | GET | [auth.controller.ts:159](../apps/api/src/modules/auth/api/auth.controller.ts#L159) | AuthGuard (глобальный, bypass matcher) | `public` | none | SSO-заглушка: 501 |
| `/auth/sberid/callback` | GET | [auth.controller.ts:165](../apps/api/src/modules/auth/api/auth.controller.ts#L165) | AuthGuard (глобальный, bypass matcher) | `public` | none | SSO-заглушка: 501 |
| `/auth/dev` | POST | [auth.controller.ts:171](../apps/api/src/modules/auth/api/auth.controller.ts#L171) | AuthGuard (глобальный, bypass matcher) | `public` | none | dev-bypass доступен только вне production и при feature flag |
| `/releases` | GET | [catalog.controller.ts:10](../apps/api/src/modules/catalog/api/catalog.controller.ts#L10) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/materials` | GET | [catalog.controller.ts:16](../apps/api/src/modules/catalog/api/catalog.controller.ts#L16) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/materials/:id` | GET | [catalog.controller.ts:22](../apps/api/src/modules/catalog/api/catalog.controller.ts#L22) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/vendors` | GET | [catalog.controller.ts:28](../apps/api/src/modules/catalog/api/catalog.controller.ts#L28) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/machines` | GET | [catalog.controller.ts:34](../apps/api/src/modules/catalog/api/catalog.controller.ts#L34) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/machines/:id` | GET | [catalog.controller.ts:40](../apps/api/src/modules/catalog/api/catalog.controller.ts#L40) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/printers` | GET | [catalog.controller.ts:46](../apps/api/src/modules/catalog/api/catalog.controller.ts#L46) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/printers/:slug` | GET | [catalog.controller.ts:52](../apps/api/src/modules/catalog/api/catalog.controller.ts#L52) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/devices/agent/install.sh` | GET | [devices.controller.ts:52](../apps/api/src/modules/devices/api/devices.controller.ts#L52) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/devices/agent/enroll` | POST | [devices.controller.ts:59](../apps/api/src/modules/devices/api/devices.controller.ts#L59) | custom | `public` | none | AuthGuard bypass matcher; одноразовый enroll-code; проверка статуса БД; выдаёт agent JWT |
| `/devices/agent/recover` | POST | [devices.controller.ts:66](../apps/api/src/modules/devices/api/devices.controller.ts#L66) | custom | `public` | none | AuthGuard bypass matcher; одноразовый recovery-code; проверка статуса БД; выдаёт agent JWT |
| `/feed` | GET | [feed.controller.ts:87](../apps/api/src/modules/feed/api/feed.controller.ts#L87) | AuthGuard (глобальный, bypass matcher) | `public` | SESSION_USER / JWT claims (optional) | опциональная сессия через optionalActor; в CLOSED_DEV требует session |
| `/feed/posts/:id` | GET | [feed.controller.ts:115](../apps/api/src/modules/feed/api/feed.controller.ts#L115) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/feed/posts/:id/media` | GET | [feed.controller.ts:121](../apps/api/src/modules/feed/api/feed.controller.ts#L121) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/feed/posts/:id/poster` | GET | [feed.controller.ts:127](../apps/api/src/modules/feed/api/feed.controller.ts#L127) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/feed/posts/:id/images/:fileId` | GET | [feed.controller.ts:217](../apps/api/src/modules/feed/api/feed.controller.ts#L217) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/concepts` | GET | [generations.controller.ts:65](../apps/api/src/modules/generations/api/generations.controller.ts#L65) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/concepts/:id/preview` | GET | [generations.controller.ts:70](../apps/api/src/modules/generations/api/generations.controller.ts#L70) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |
| `/ideas` | GET | [ideas.controller.ts:54](../apps/api/src/modules/ideas/api/ideas.controller.ts#L54) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/ideas/:id/comments` | GET | [ideas.controller.ts:79](../apps/api/src/modules/ideas/api/ideas.controller.ts#L79) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/ideas/:id` | GET | [ideas.controller.ts:111](../apps/api/src/modules/ideas/api/ideas.controller.ts#L111) | AuthGuard (глобальный, bypass matcher) | `public` | SESSION_USER (optional) | в обычном режиме AuthGuard identity не прикрепляет; SESSION_USER появляется только в CLOSED_DEV; в CLOSED_DEV требует session |
| `/masters/:userId` | GET | [master.controller.ts:37](../apps/api/src/modules/master/api/master.controller.ts#L37) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/masters/:masterId/equipment` | GET | [master-equipment.controller.ts:36](../apps/api/src/modules/masterEquipment/api/master-equipment.controller.ts#L36) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/master-services/:id` | GET | [master-services.controller.ts:36](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L36) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/masters/:masterId/services` | GET | [master-services.controller.ts:39](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L39) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/community-firmware` | GET | [printers.controller.ts:45](../apps/api/src/modules/printers/api/printers.controller.ts#L45) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/avatars/:userId/snapshots/:side` | GET | [profile.controller.ts:88](../apps/api/src/modules/profile/api/profile.controller.ts#L88) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/avatars/:userId/snapshots/:revision/:side/:sha256.png` | GET | [profile.controller.ts:100](../apps/api/src/modules/profile/api/profile.controller.ts#L100) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/projects` | GET | [projects.controller.ts:74](../apps/api/src/modules/projects/api/projects.controller.ts#L74) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/projects/:projectId` | GET | [projects.controller.ts:100](../apps/api/src/modules/projects/api/projects.controller.ts#L100) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/projects/:projectId/models/:modelId/revisions/:revisionId/preview.glb` | GET | [projects.controller.ts:353](../apps/api/src/modules/projects/api/projects.controller.ts#L353) | AuthGuard (глобальный, bypass matcher) | `public` | JWT claims (optional) | опциональная сессия через SessionVerifier; в CLOSED_DEV требует session |
| `/seo/meta` | GET | [seo.controller.ts:11](../apps/api/src/modules/seo/api/seo.controller.ts#L11) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/seo/models/:id/og.webp` | GET | [seo.controller.ts:19](../apps/api/src/modules/seo/api/seo.controller.ts#L19) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/sitemap.xml` | GET | [seo.controller.ts:36](../apps/api/src/modules/seo/api/seo.controller.ts#L36) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/robots.txt` | GET | [seo.controller.ts:45](../apps/api/src/modules/seo/api/seo.controller.ts#L45) | AuthGuard (глобальный, bypass matcher) | `public` | none | в CLOSED_DEV требует session |
| `/health` | GET | [health.controller.ts:15](../apps/api/src/nest/health/health.controller.ts#L15) | AuthGuard (глобальный, bypass matcher) | `public` | none | — |

## 2. Маршруты, требующие session JWT

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/me/achievements` | GET | [achievements.controller.ts:19](../apps/api/src/modules/achievements/api/achievements.controller.ts#L19) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/wardrobe/unlocks` | GET | [achievements.controller.ts:25](../apps/api/src/modules/achievements/api/achievements.controller.ts#L25) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents` | POST | [agents.controller.ts:22](../apps/api/src/modules/agents/api/agents.controller.ts#L22) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents` | GET | [agents.controller.ts:28](../apps/api/src/modules/agents/api/agents.controller.ts#L28) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents/:id/revoke` | POST | [agents.controller.ts:34](../apps/api/src/modules/agents/api/agents.controller.ts#L34) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents/:id/keys` | POST | [agents.controller.ts:41](../apps/api/src/modules/agents/api/agents.controller.ts#L41) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents/:id/keys` | GET | [agents.controller.ts:47](../apps/api/src/modules/agents/api/agents.controller.ts#L47) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/agents/:id/keys/:keyId/revoke` | POST | [agents.controller.ts:53](../apps/api/src/modules/agents/api/agents.controller.ts#L53) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/analytics/health` | GET | [analytics.controller.ts:44](../apps/api/src/modules/analytics/api/analytics.controller.ts#L44) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/assistant/threads` | POST | [assistant.controller.ts:36](../apps/api/src/modules/assistant/api/assistant.controller.ts#L36) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads` | GET | [assistant.controller.ts:42](../apps/api/src/modules/assistant/api/assistant.controller.ts#L42) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id` | GET | [assistant.controller.ts:48](../apps/api/src/modules/assistant/api/assistant.controller.ts#L48) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/read` | POST | [assistant.controller.ts:54](../apps/api/src/modules/assistant/api/assistant.controller.ts#L54) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/events` | GET | [assistant.controller.ts:61](../apps/api/src/modules/assistant/api/assistant.controller.ts#L61) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/messages` | GET | [assistant.controller.ts:70](../apps/api/src/modules/assistant/api/assistant.controller.ts#L70) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/messages` | POST | [assistant.controller.ts:76](../apps/api/src/modules/assistant/api/assistant.controller.ts#L76) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/runs/:runId` | GET | [assistant.controller.ts:89](../apps/api/src/modules/assistant/api/assistant.controller.ts#L89) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/runs/:id/events` | GET | [assistant.controller.ts:95](../apps/api/src/modules/assistant/api/assistant.controller.ts#L95) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/threads/:id/generations` | POST | [assistant.controller.ts:104](../apps/api/src/modules/assistant/api/assistant.controller.ts#L104) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/assistant/prompt-variants` | POST | [assistant.controller.ts:112](../apps/api/src/modules/assistant/api/assistant.controller.ts#L112) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/auth/session` | GET | [auth.controller.ts:48](../apps/api/src/modules/auth/api/auth.controller.ts#L48) | custom | `session_cookie / session_bearer` | JWT claims | own gate через SessionVerifier; проверка статуса пользователя в БД |
| `/purchases` | POST | [billing.controller.ts:15](../apps/api/src/modules/billing/api/billing.controller.ts#L15) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/purchases` | GET | [billing.controller.ts:26](../apps/api/src/modules/billing/api/billing.controller.ts#L26) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/purchases/:id` | GET | [billing.controller.ts:31](../apps/api/src/modules/billing/api/billing.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/sales` | GET | [billing.controller.ts:36](../apps/api/src/modules/billing/api/billing.controller.ts#L36) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/balance` | GET | [billing.controller.ts:39](../apps/api/src/modules/billing/api/billing.controller.ts#L39) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/payouts` | POST | [billing.controller.ts:44](../apps/api/src/modules/billing/api/billing.controller.ts#L44) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/payouts` | GET | [billing.controller.ts:49](../apps/api/src/modules/billing/api/billing.controller.ts#L49) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/payouts/:id` | PATCH | [billing.controller.ts:54](../apps/api/src/modules/billing/api/billing.controller.ts#L54) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/catalog/metrics` | GET | [catalog.controller.ts:58](../apps/api/src/modules/catalog/api/catalog.controller.ts#L58) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/material-candidates` | GET | [catalog.controller.ts:64](../apps/api/src/modules/catalog/api/catalog.controller.ts#L64) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/material-candidates` | POST | [catalog.controller.ts:70](../apps/api/src/modules/catalog/api/catalog.controller.ts#L70) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/material-candidates/:id/approve` | POST | [catalog.controller.ts:77](../apps/api/src/modules/catalog/api/catalog.controller.ts#L77) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | нет явной staff/RBAC-проверки в controller/service; matcher требует session, но handler userId не читает |
| `/material-candidates/:id/reject` | POST | [catalog.controller.ts:84](../apps/api/src/modules/catalog/api/catalog.controller.ts#L84) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | нет явной staff/RBAC-проверки в controller/service; matcher требует session, но handler userId не читает |
| `/machine-candidates` | GET | [catalog.controller.ts:91](../apps/api/src/modules/catalog/api/catalog.controller.ts#L91) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/machine-candidates` | POST | [catalog.controller.ts:97](../apps/api/src/modules/catalog/api/catalog.controller.ts#L97) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/machine-candidates/:id/approve` | POST | [catalog.controller.ts:104](../apps/api/src/modules/catalog/api/catalog.controller.ts#L104) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | нет явной staff/RBAC-проверки в controller/service; matcher требует session, но handler userId не читает |
| `/machine-candidates/:id/reject` | POST | [catalog.controller.ts:111](../apps/api/src/modules/catalog/api/catalog.controller.ts#L111) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | нет явной staff/RBAC-проверки в controller/service; matcher требует session, но handler userId не читает |
| `/communities` | POST | [community.controller.ts:43](../apps/api/src/modules/community/api/community.controller.ts#L43) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities` | GET | [community.controller.ts:53](../apps/api/src/modules/community/api/community.controller.ts#L53) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id` | GET | [community.controller.ts:59](../apps/api/src/modules/community/api/community.controller.ts#L59) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/join` | POST | [community.controller.ts:62](../apps/api/src/modules/community/api/community.controller.ts#L62) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/leave` | POST | [community.controller.ts:65](../apps/api/src/modules/community/api/community.controller.ts#L65) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/subscribe` | POST | [community.controller.ts:68](../apps/api/src/modules/community/api/community.controller.ts#L68) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/subscribe` | DELETE | [community.controller.ts:76](../apps/api/src/modules/community/api/community.controller.ts#L76) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/members/:userId/role` | POST | [community.controller.ts:84](../apps/api/src/modules/community/api/community.controller.ts#L84) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/bootstrap-owner` | POST | [community.controller.ts:92](../apps/api/src/modules/community/api/community.controller.ts#L92) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/feed` | GET | [community.controller.ts:95](../apps/api/src/modules/community/api/community.controller.ts#L95) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/communities/:id/threads` | POST | [community.controller.ts:100](../apps/api/src/modules/community/api/community.controller.ts#L100) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/communities/:id/threads` | GET | [community.controller.ts:107](../apps/api/src/modules/community/api/community.controller.ts#L107) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/threads/:id` | GET | [community.controller.ts:113](../apps/api/src/modules/community/api/community.controller.ts#L113) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/threads/:id/posts` | POST | [community.controller.ts:116](../apps/api/src/modules/community/api/community.controller.ts#L116) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/threads/:id/vote` | POST | [community.controller.ts:119](../apps/api/src/modules/community/api/community.controller.ts#L119) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/posts/:id/vote` | POST | [community.controller.ts:122](../apps/api/src/modules/community/api/community.controller.ts#L122) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/posts/:id/attachments` | POST | [community.controller.ts:125](../apps/api/src/modules/community/api/community.controller.ts#L125) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/posts/:id/attachments/:attachmentId` | GET | [community.controller.ts:133](../apps/api/src/modules/community/api/community.controller.ts#L133) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/threads/:id/accept` | POST | [community.controller.ts:151](../apps/api/src/modules/community/api/community.controller.ts#L151) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | non-null assertion в uid() |
| `/me/devices/enroll-codes` | POST | [devices.controller.ts:32](../apps/api/src/modules/devices/api/devices.controller.ts#L32) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/enroll-codes/:enrollCodeId/revoke` | POST | [devices.controller.ts:39](../apps/api/src/modules/devices/api/devices.controller.ts#L39) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/revoke` | POST | [devices.controller.ts:46](../apps/api/src/modules/devices/api/devices.controller.ts#L46) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/shares` | POST | [devices.controller.ts:73](../apps/api/src/modules/devices/api/devices.controller.ts#L73) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/shares/:userId` | DELETE | [devices.controller.ts:80](../apps/api/src/modules/devices/api/devices.controller.ts#L80) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/commands` | POST | [devices.controller.ts:86](../apps/api/src/modules/devices/api/devices.controller.ts#L86) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/commands/:commandId` | GET | [devices.controller.ts:93](../apps/api/src/modules/devices/api/devices.controller.ts#L93) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/transfers` | POST | [devices.controller.ts:99](../apps/api/src/modules/devices/api/devices.controller.ts#L99) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/transfers/:transferId` | GET | [devices.controller.ts:106](../apps/api/src/modules/devices/api/devices.controller.ts#L106) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/incidents` | GET | [devices.controller.ts:112](../apps/api/src/modules/devices/api/devices.controller.ts#L112) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/incidents/:incidentId/acknowledge` | POST | [devices.controller.ts:118](../apps/api/src/modules/devices/api/devices.controller.ts#L118) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/incidents/:incidentId/resolve` | POST | [devices.controller.ts:124](../apps/api/src/modules/devices/api/devices.controller.ts#L124) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/profile-transfers` | POST | [devices.controller.ts:130](../apps/api/src/modules/devices/api/devices.controller.ts#L130) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/print-requests` | POST | [devices.controller.ts:137](../apps/api/src/modules/devices/api/devices.controller.ts#L137) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/print-requests/:id` | GET | [devices.controller.ts:144](../apps/api/src/modules/devices/api/devices.controller.ts#L144) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/devices/:deviceId/print-requests/:id/confirm-start` | POST | [devices.controller.ts:150](../apps/api/src/modules/devices/api/devices.controller.ts#L150) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/posts/:id/comments` | GET | [feed.controller.ts:145](../apps/api/src/modules/feed/api/feed.controller.ts#L145) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/feed/posts/:id/comments` | POST | [feed.controller.ts:151](../apps/api/src/modules/feed/api/feed.controller.ts#L151) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/comments/:id` | DELETE | [feed.controller.ts:157](../apps/api/src/modules/feed/api/feed.controller.ts#L157) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/posts/:id/vote` | POST | [feed.controller.ts:163](../apps/api/src/modules/feed/api/feed.controller.ts#L163) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/comments/:id/vote` | POST | [feed.controller.ts:170](../apps/api/src/modules/feed/api/feed.controller.ts#L170) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/posts/:id/save` | POST | [feed.controller.ts:177](../apps/api/src/modules/feed/api/feed.controller.ts#L177) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/posts/:id/save` | DELETE | [feed.controller.ts:184](../apps/api/src/modules/feed/api/feed.controller.ts#L184) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/events` | POST | [feed.controller.ts:190](../apps/api/src/modules/feed/api/feed.controller.ts#L190) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/gitverse/parse` | GET | [feed.controller.ts:197](../apps/api/src/modules/feed/api/feed.controller.ts#L197) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/feed/media` | POST | [feed.controller.ts:199](../apps/api/src/modules/feed/api/feed.controller.ts#L199) | AuthGuard + PermissionGuard | `session_cookie / session_bearer` | SESSION_USER | одновременно `feed.manage_news` и system-managed `feed.news_editor` |
| `/data/news` и `/data/news/:id` | GET/POST/PATCH | [feed-admin.controller.ts:15](../apps/api/src/modules/feed/api/feed-admin.controller.ts#L15) | AuthGuard + PermissionGuard | `session_cookie / session_bearer` | SESSION_USER | editorial rows с доказанным `editorial_origin`; одновременно `feed.manage_news` и `feed.news_editor` |
| `/data/news/:id/publish`, `/data/news/:id/hide` | POST | [feed-admin.controller.ts:31](../apps/api/src/modules/feed/api/feed-admin.controller.ts#L31) | AuthGuard + PermissionGuard | `session_cookie / session_bearer` | SESSION_USER | одновременно `feed.manage_news` и `feed.news_editor` |
| `/generations/health` | GET | [generations.controller.ts:32](../apps/api/src/modules/generations/api/generations.controller.ts#L32) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/scans` | POST | [generations.controller.ts:35](../apps/api/src/modules/generations/api/generations.controller.ts#L35) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/scans/:id/photos` | POST | [generations.controller.ts:38](../apps/api/src/modules/generations/api/generations.controller.ts#L38) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/scans/:id/manifest` | POST | [generations.controller.ts:46](../apps/api/src/modules/generations/api/generations.controller.ts#L46) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/scans/:id/start` | POST | [generations.controller.ts:53](../apps/api/src/modules/generations/api/generations.controller.ts#L53) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/:id` | GET | [generations.controller.ts:62](../apps/api/src/modules/generations/api/generations.controller.ts#L62) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/concepts` | POST | [generations.controller.ts:76](../apps/api/src/modules/generations/api/generations.controller.ts#L76) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations` | GET | [generations.controller.ts:82](../apps/api/src/modules/generations/api/generations.controller.ts#L82) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/:id/catalog-draft` | POST | [generations.controller.ts:85](../apps/api/src/modules/generations/api/generations.controller.ts#L85) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/:id/preview` | GET | [generations.controller.ts:93](../apps/api/src/modules/generations/api/generations.controller.ts#L93) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/:id/artifact` | GET | [generations.controller.ts:100](../apps/api/src/modules/generations/api/generations.controller.ts#L100) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations/:id/preview/:angle` | GET | [generations.controller.ts:107](../apps/api/src/modules/generations/api/generations.controller.ts#L107) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/generations` | POST | [generations.controller.ts:115](../apps/api/src/modules/generations/api/generations.controller.ts#L115) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/mine` | GET | [ideas.controller.ts:60](../apps/api/src/modules/ideas/api/ideas.controller.ts#L60) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/top` | GET | [ideas.controller.ts:66](../apps/api/src/modules/ideas/api/ideas.controller.ts#L66) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/similar` | GET | [ideas.controller.ts:73](../apps/api/src/modules/ideas/api/ideas.controller.ts#L73) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/:id/comments` | POST | [ideas.controller.ts:85](../apps/api/src/modules/ideas/api/ideas.controller.ts#L85) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/:id/vote` | POST | [ideas.controller.ts:91](../apps/api/src/modules/ideas/api/ideas.controller.ts#L91) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/:id/status` | PATCH | [ideas.controller.ts:98](../apps/api/src/modules/ideas/api/ideas.controller.ts#L98) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/:id/moderate` | POST | [ideas.controller.ts:104](../apps/api/src/modules/ideas/api/ideas.controller.ts#L104) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas/enrich` | POST | [ideas.controller.ts:117](../apps/api/src/modules/ideas/api/ideas.controller.ts#L117) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/ideas` | POST | [ideas.controller.ts:125](../apps/api/src/modules/ideas/api/ideas.controller.ts#L125) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/import-connections` | POST | [import-connections.controller.ts:25](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L25) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/import-connections` | GET | [import-connections.controller.ts:31](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/import-connections/:id/models` | GET | [import-connections.controller.ts:37](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L37) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/import-connections/:id/challenge` | POST | [import-connections.controller.ts:43](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L43) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/import-connections/:id/verify` | POST | [import-connections.controller.ts:49](../apps/api/src/modules/importConnections/api/import-connections.controller.ts#L49) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/imports/jobs` | POST | [imports.controller.ts:20](../apps/api/src/modules/imports/api/imports.controller.ts#L20) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/imports/jobs` | GET | [imports.controller.ts:26](../apps/api/src/modules/imports/api/imports.controller.ts#L26) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/imports/jobs/:id` | GET | [imports.controller.ts:32](../apps/api/src/modules/imports/api/imports.controller.ts#L32) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makers/feed` | GET | [makers.controller.ts:18](../apps/api/src/modules/makers/api/makers.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/users/:username/follow` | POST | [makers.controller.ts:24](../apps/api/src/modules/makers/api/makers.controller.ts#L24) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/users/:username/follow` | DELETE | [makers.controller.ts:31](../apps/api/src/modules/makers/api/makers.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/maker-profile` | GET | [makers.controller.ts:38](../apps/api/src/modules/makers/api/makers.controller.ts#L38) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/maker-profile` | PUT | [makers.controller.ts:44](../apps/api/src/modules/makers/api/makers.controller.ts#L44) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makers/nearby` | GET | [makers.controller.ts:50](../apps/api/src/modules/makers/api/makers.controller.ts#L50) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | OpenAPI помечает public, но access-matrix требует session; matcher требует session, но handler userId не читает |
| `/makes/:id/repost` | POST | [makes.controller.ts:47](../apps/api/src/modules/makes/api/makes.controller.ts#L47) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/makes/:id/view` | POST | [makes.controller.ts:54](../apps/api/src/modules/makes/api/makes.controller.ts#L54) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/makes/:id/report` | POST | [makes.controller.ts:61](../apps/api/src/modules/makes/api/makes.controller.ts#L61) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes/:makeId/photos/:photoId` | GET | [makes.controller.ts:68](../apps/api/src/modules/makes/api/makes.controller.ts#L68) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes/:id/vote` | POST | [makes.controller.ts:84](../apps/api/src/modules/makes/api/makes.controller.ts#L84) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes` | POST | [makes.controller.ts:91](../apps/api/src/modules/makes/api/makes.controller.ts#L91) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes` | GET | [makes.controller.ts:105](../apps/api/src/modules/makes/api/makes.controller.ts#L105) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/makes/:id/comments` | GET | [makes.controller.ts:111](../apps/api/src/modules/makes/api/makes.controller.ts#L111) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/makes/:id/comments` | POST | [makes.controller.ts:117](../apps/api/src/modules/makes/api/makes.controller.ts#L117) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes/mine` | GET | [makes.controller.ts:123](../apps/api/src/modules/makes/api/makes.controller.ts#L123) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/makes/:id` | GET | [makes.controller.ts:129](../apps/api/src/modules/makes/api/makes.controller.ts#L129) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/models/:id/makes/leaderboard` | GET | [makes.controller.ts:140](../apps/api/src/modules/makes/api/makes.controller.ts#L140) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/me/become-master` | POST | [master.controller.ts:18](../apps/api/src/modules/master/api/master.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/master` | GET | [master.controller.ts:25](../apps/api/src/modules/master/api/master.controller.ts#L25) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/master-profile` | PATCH | [master.controller.ts:31](../apps/api/src/modules/master/api/master.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-equipment` | POST | [master-equipment.controller.ts:18](../apps/api/src/modules/masterEquipment/api/master-equipment.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-equipment/:id` | PATCH | [master-equipment.controller.ts:24](../apps/api/src/modules/masterEquipment/api/master-equipment.controller.ts#L24) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-equipment/:id` | DELETE | [master-equipment.controller.ts:30](../apps/api/src/modules/masterEquipment/api/master-equipment.controller.ts#L30) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-services` | POST | [master-services.controller.ts:17](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L17) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-services/:id` | PATCH | [master-services.controller.ts:23](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L23) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/master-services/:id` | DELETE | [master-services.controller.ts:30](../apps/api/src/modules/masterServices/api/master-services.controller.ts#L30) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/users/:id/ban` | POST | [moderation.controller.ts:14](../apps/api/src/modules/moderation/api/moderation.controller.ts#L14) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/orders` | POST | [orders.controller.ts:18](../apps/api/src/modules/orders/api/orders.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/orders/:id` | GET | [orders.controller.ts:24](../apps/api/src/modules/orders/api/orders.controller.ts#L24) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/orders/:id/status` | PATCH | [orders.controller.ts:30](../apps/api/src/modules/orders/api/orders.controller.ts#L30) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/communities/:id/claim-owner` | POST | [organizations.controller.ts:18](../apps/api/src/modules/organizations/api/organizations.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/vendor-claims` | POST | [organizations.controller.ts:25](../apps/api/src/modules/organizations/api/organizations.controller.ts#L25) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/vendor-claims/mine` | GET | [organizations.controller.ts:31](../apps/api/src/modules/organizations/api/organizations.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/vendor-claims` | GET | [organizations.controller.ts:37](../apps/api/src/modules/organizations/api/organizations.controller.ts#L37) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/vendor-claims/:id/verify` | POST | [organizations.controller.ts:43](../apps/api/src/modules/organizations/api/organizations.controller.ts#L43) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/vendor-claims/:id/revoke` | POST | [organizations.controller.ts:50](../apps/api/src/modules/organizations/api/organizations.controller.ts#L50) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/community-firmware` | POST | [printers.controller.ts:50](../apps/api/src/modules/printers/api/printers.controller.ts#L50) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/community-firmware/:id` | PATCH | [printers.controller.ts:55](../apps/api/src/modules/printers/api/printers.controller.ts#L55) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/community-firmware/:id` | DELETE | [printers.controller.ts:60](../apps/api/src/modules/printers/api/printers.controller.ts#L60) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/printer-connect` | GET | [printers.controller.ts:67](../apps/api/src/modules/printers/api/printers.controller.ts#L67) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/printers/identify` | POST | [printers.controller.ts:73](../apps/api/src/modules/printers/api/printers.controller.ts#L73) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/connectors/prusa` | POST | [printers.controller.ts:81](../apps/api/src/modules/printers/api/printers.controller.ts#L81) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/connectors/prusa/sync` | POST | [printers.controller.ts:86](../apps/api/src/modules/printers/api/printers.controller.ts#L86) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/connectors/prusa` | GET | [printers.controller.ts:92](../apps/api/src/modules/printers/api/printers.controller.ts#L92) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/connectors/prusa` | DELETE | [printers.controller.ts:97](../apps/api/src/modules/printers/api/printers.controller.ts#L97) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/printers/:id/report` | POST | [printers.controller.ts:141](../apps/api/src/modules/printers/api/printers.controller.ts#L141) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/printers/reports` | GET | [printers.controller.ts:146](../apps/api/src/modules/printers/api/printers.controller.ts#L146) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | negative-lookahead исключает literal из публичного matcher `/printers/:slug` |
| `/printers/reports/:reportId/reject` | POST | [printers.controller.ts:151](../apps/api/src/modules/printers/api/printers.controller.ts#L151) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/printers/reports/:reportId/approve` | POST | [printers.controller.ts:157](../apps/api/src/modules/printers/api/printers.controller.ts#L157) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/print-requests` | POST | [print-requests.controller.ts:31](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L31) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/print-requests/incoming` | GET | [print-requests.controller.ts:50](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L50) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/print-requests/mine` | GET | [print-requests.controller.ts:56](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L56) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/print-requests/:id` | GET | [print-requests.controller.ts:62](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L62) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/print-requests/:id/status` | PATCH | [print-requests.controller.ts:68](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L68) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/activation` | GET | [profile-inventory.controller.ts:55](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L55) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/activation` | PATCH | [profile-inventory.controller.ts:61](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L61) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/activation/events` | POST | [profile-inventory.controller.ts:67](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L67) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/materials` | GET | [profile-inventory.controller.ts:86](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L86) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/materials` | POST | [profile-inventory.controller.ts:92](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L92) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/materials/:id` | PATCH | [profile-inventory.controller.ts:98](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L98) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/materials/:id` | DELETE | [profile-inventory.controller.ts:104](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L104) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/filaments` | GET | [profile-inventory.controller.ts:110](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L110) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/filaments` | POST | [profile-inventory.controller.ts:116](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L116) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/filaments/:id` | PATCH | [profile-inventory.controller.ts:122](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L122) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/filaments/:id` | DELETE | [profile-inventory.controller.ts:128](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L128) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers` | GET | [profile-inventory.controller.ts:139](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L139) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers` | POST | [profile-inventory.controller.ts:145](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L145) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id` | PATCH | [profile-inventory.controller.ts:151](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L151) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id` | DELETE | [profile-inventory.controller.ts:157](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L157) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id/compat` | GET | [profile-inventory.controller.ts:163](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L163) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id/live` | GET | [profile-inventory.controller.ts:169](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L169) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id/commands` | POST | [profile-inventory.controller.ts:175](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L175) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/printers/:id/commands/:commandId` | GET | [profile-inventory.controller.ts:193](../apps/api/src/modules/profile/api/profile-inventory.controller.ts#L193) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/users/:username` | GET | [profile.controller.ts:39](../apps/api/src/modules/profile/api/profile.controller.ts#L39) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | отсутствующая identity превращается в 404 |
| `/me` | PATCH | [profile.controller.ts:45](../apps/api/src/modules/profile/api/profile.controller.ts#L45) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | отсутствующая identity превращается в 404 |
| `/me/avatar` | GET | [profile.controller.ts:51](../apps/api/src/modules/profile/api/profile.controller.ts#L51) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | отсутствующая identity превращается в 404 |
| `/me/avatar` | PATCH | [profile.controller.ts:57](../apps/api/src/modules/profile/api/profile.controller.ts#L57) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | отсутствующая identity превращается в 404 |
| `/me/avatar-photo` | POST | [profile.controller.ts:63](../apps/api/src/modules/profile/api/profile.controller.ts#L63) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | отсутствующая identity превращается в 404 |
| `/avatars/:userId` | GET | [profile.controller.ts:70](../apps/api/src/modules/profile/api/profile.controller.ts#L70) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/projects` | POST | [projects.controller.ts:57](../apps/api/src/modules/projects/api/projects.controller.ts#L57) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/owned` | GET | [projects.controller.ts:87](../apps/api/src/modules/projects/api/projects.controller.ts#L87) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/draft` | GET | [projects.controller.ts:114](../apps/api/src/modules/projects/api/projects.controller.ts#L114) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId` | PATCH | [projects.controller.ts:128](../apps/api/src/modules/projects/api/projects.controller.ts#L128) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId` | DELETE | [projects.controller.ts:154](../apps/api/src/modules/projects/api/projects.controller.ts#L154) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models` | POST | [projects.controller.ts:169](../apps/api/src/modules/projects/api/projects.controller.ts#L169) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models` | GET | [projects.controller.ts:205](../apps/api/src/modules/projects/api/projects.controller.ts#L205) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId` | GET | [projects.controller.ts:219](../apps/api/src/modules/projects/api/projects.controller.ts#L219) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId` | DELETE | [projects.controller.ts:234](../apps/api/src/modules/projects/api/projects.controller.ts#L234) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId/revisions` | POST | [projects.controller.ts:257](../apps/api/src/modules/projects/api/projects.controller.ts#L257) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId/revisions` | GET | [projects.controller.ts:299](../apps/api/src/modules/projects/api/projects.controller.ts#L299) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId/revisions/:revisionId` | GET | [projects.controller.ts:314](../apps/api/src/modules/projects/api/projects.controller.ts#L314) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/models/:modelId/revisions/:revisionId/source` | GET | [projects.controller.ts:330](../apps/api/src/modules/projects/api/projects.controller.ts#L330) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/primary-model` | PUT | [projects.controller.ts:383](../apps/api/src/modules/projects/api/projects.controller.ts#L383) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/primary-model` | DELETE | [projects.controller.ts:410](../apps/api/src/modules/projects/api/projects.controller.ts#L410) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/publication` | PUT | [projects.controller.ts:431](../apps/api/src/modules/projects/api/projects.controller.ts#L431) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/projects/:projectId/publication` | DELETE | [projects.controller.ts:457](../apps/api/src/modules/projects/api/projects.controller.ts#L457) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/api-keys` | POST | [publicapi.controller.ts:36](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L36) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/api-keys` | GET | [publicapi.controller.ts:42](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L42) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/api-keys/:id` | DELETE | [publicapi.controller.ts:45](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L45) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/api-keys/:id/rotate` | POST | [publicapi.controller.ts:51](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L51) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/user-api-keys` | POST | [publicapi.controller.ts:58](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L58) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/user-api-keys` | GET | [publicapi.controller.ts:64](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L64) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/me/user-api-keys/:id` | DELETE | [publicapi.controller.ts:70](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L70) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/push/vapid-public-key` | GET | [push.controller.ts:27](../apps/api/src/modules/push/api/push.controller.ts#L27) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/push/subscriptions` | POST | [push.controller.ts:33](../apps/api/src/modules/push/api/push.controller.ts#L33) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/push/subscriptions` | DELETE | [push.controller.ts:47](../apps/api/src/modules/push/api/push.controller.ts#L47) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/push/preferences` | GET | [push.controller.ts:54](../apps/api/src/modules/push/api/push.controller.ts#L54) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/push/preferences` | PUT | [push.controller.ts:60](../apps/api/src/modules/push/api/push.controller.ts#L60) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/internal/project-index/scan` | GET | [security.controller.ts:18](../apps/api/src/modules/security/api/security.controller.ts#L18) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/slicer-profiles` | GET | [slicer-profiles.controller.ts:70](../apps/api/src/modules/slicerProfiles/api/slicer-profiles.controller.ts#L70) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/slicer-profiles/:id/calibrations` | POST | [slicer-profiles.controller.ts:76](../apps/api/src/modules/slicerProfiles/api/slicer-profiles.controller.ts#L76) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |
| `/slicer-profiles/:id/calibrations` | GET | [slicer-profiles.controller.ts:113](../apps/api/src/modules/slicerProfiles/api/slicer-profiles.controller.ts#L113) | AuthGuard (глобальный) | `session_cookie / session_bearer` | none | matcher требует session, но handler userId не читает |
| `/slicer-profiles/:printerId/:filamentId` | GET | [slicer-profiles.controller.ts:124](../apps/api/src/modules/slicerProfiles/api/slicer-profiles.controller.ts#L124) | AuthGuard (глобальный) | `session_cookie / session_bearer` | SESSION_USER | — |

## 3. Маршруты, принимающие API-ключи (по типам)

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/feed/ingest` | POST | [feed.controller.ts:86](../apps/api/src/modules/feed/api/feed.controller.ts#L86) | custom | `api_key_feedingest` | ownerId из user_api_keys | AuthGuard bypass exact matcher; точный prefix/hash, `scope='feed_ingest'`, `scopes=['write']`, status/revocation/expiry и community owner/moderator ACL проверяются в БД |
| `/v0/printers` | GET | [publicapi.controller.ts:80](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L80) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope read, revocation и expiry в БД |
| `/v0/printers/:id` | GET | [publicapi.controller.ts:83](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L83) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope read, revocation и expiry в БД |
| `/v0/printers/:id/telemetry` | GET | [publicapi.controller.ts:86](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L86) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope read, revocation и expiry в БД |
| `/v0/printers/:id/test-job/commands` | POST | [publicapi.controller.ts:93](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L93) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope control, revocation и expiry в БД |
| `/v0/printers/:id/commands` | POST | [publicapi.controller.ts:113](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L113) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope control, revocation и expiry в БД |
| `/v0/printers/:id/commands/:commandId` | GET | [publicapi.controller.ts:125](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L125) | custom | `api_key_pub` | ownerId из api_keys | AuthGuard bypass matcher; проверка scope read, revocation и expiry в БД |

## 4. Смешанные: session или API-key

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/research/printers` | POST | [printers.controller.ts:103](../apps/api/src/modules/printers/api/printers.controller.ts#L103) | custom | `mixed` | SESSION_USER / ownerId из api_keys | session_cookie или session_bearer ИЛИ api_key_research; AuthGuard bypass matcher; key status в БД |
| `/research/printers/:slug` | GET | [printers.controller.ts:123](../apps/api/src/modules/printers/api/printers.controller.ts#L123) | custom | `mixed` | SESSION_USER / ownerId из api_keys | session_cookie или session_bearer ИЛИ api_key_research; AuthGuard bypass matcher; key status в БД |
| `/research/printers/media/presign` | POST | [printers.controller.ts:128](../apps/api/src/modules/printers/api/printers.controller.ts#L128) | custom | `mixed` | SESSION_USER / ownerId из api_keys | session_cookie или session_bearer ИЛИ api_key_research; AuthGuard bypass matcher; key status в БД |
| `/research/media/*key` | GET | [printers.controller.ts:134](../apps/api/src/modules/printers/api/printers.controller.ts#L134) | custom | `mixed` | SESSION_USER / ownerId из api_keys | session_cookie или session_bearer ИЛИ api_key_research; AuthGuard bypass matcher; key status в БД |

## 5. Relay/service-only маршруты

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/internal/relay/v1/sessions/authorize` | POST | [relay-internal.controller.ts:41](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L41) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/sessions/:sessionId/heartbeat` | POST | [relay-internal.controller.ts:51](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L51) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/sessions/:sessionId/close` | POST | [relay-internal.controller.ts:62](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L62) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/gateways/revalidate` | POST | [relay-internal.controller.ts:73](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L73) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/commands/claim` | POST | [relay-internal.controller.ts:80](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L80) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/commands/:commandId/lease-heartbeat` | POST | [relay-internal.controller.ts:90](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L90) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/commands/:commandId/result` | PUT | [relay-internal.controller.ts:100](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L100) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/transfers/:transferId/metadata` | GET | [relay-internal.controller.ts:109](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L109) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/transfers/:transferId/source-url` | POST | [relay-internal.controller.ts:118](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L118) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/transfers/:transferId/progress` | PUT | [relay-internal.controller.ts:129](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L129) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |
| `/internal/relay/v1/transfers/:transferId/result` | PUT | [relay-internal.controller.ts:139](../apps/api/src/modules/relayInternal/api/relay-internal.controller.ts#L139) | RelayServiceGuard | `relay_service_token` | none | AuthGuard bypass matcher; x-relay-service-token; correlation/operation ID; service identity, не user identity |

## 6. Маршруты без явной защиты (аномалии)

| Маршрут | Метод | Файл:строка | Guard | Способ входа | Извлечение userId | Особенности |
|---|---|---|---|---|---|---|
| `/billing/webhooks/yookassa` | POST | [billing.controller.ts:20](../apps/api/src/modules/billing/api/billing.controller.ts#L20) | custom | `public` | none | AuthGuard bypass matcher; нет подписи входящего запроса; provider fetch выполняется только после dedupe и поиска purchase |

## Сводка

### Количество

| Категория | Маршрутов |
|---|---:|
| Полностью публичные по access-matrix | 46 |
| Session JWT, включая `/auth/session` с own gate | 229 |
| Только API-key, без session | 7 |
| Смешанные session или API-key | 6 |
| Relay service-only | 11 |
| Без явной защиты / аномалии | 1 |
| **Всего активных маршрутов** | **300** |

Разбивка по основному значению «Способ входа» (взаимоисключающая):

| Способ входа | Маршрутов | Примечание |
|---|---:|---|
| `public` | 47 | 46 открытых по access-matrix (включая 2 device bootstrap endpoint с own gate) + webhook anomaly |
| `session_cookie / session_bearer` | 229 | Один и тот же session JWT; 228 через глобальный guard, `/auth/session` через own gate |
| `api_key_pub` | 6 | `mf_pub_*`, таблица `api_keys` |
| `api_key_feedingest` | 1 | `mf_feedingest_*`, таблица `user_api_keys` |
| `mixed` | 6 | 4 × session/`api_key_research`; 2 × session/`api_key_agent` |
| `relay_service_token` | 11 | `x-relay-service-token` |
| **Всего** | **300** | |

Активных HTTP-consumer’ов для `api_key_user` (`mf_user_*`) и `agent_jwt` не найдено. Agent JWT только выдаётся enrollment/recovery endpoint’ами. Если считать принимаемые схемы с пересечением, `session_cookie` и `session_bearer` принимаются каждым из 235 session/mixed endpoint’ов; `api_key_research` принимают 4, `api_key_agent` — 2, `api_key_feedingest` — 1, `api_key_pub` — 6, `relay_service_token` — 11.

### Контроллеры с нестандартным извлечением identity

- [`AnalyticsController`](../apps/api/src/modules/analytics/api/analytics.controller.ts#L23) — открытый `/consent` вручную вызывает `SessionVerifier`; identity опциональна.
- [`AuthController`](../apps/api/src/modules/auth/api/auth.controller.ts#L48) — `/auth/session` сам проверяет JWT и затем статус пользователя в БД.
- [`CommunityController`](../apps/api/src/modules/community/api/community.controller.ts#L27) — helper `uid()` использует non-null assertion на `SESSION_USER`.
- [`FeedController`](../apps/api/src/modules/feed/api/feed.controller.ts#L223) — `guardedActor`, `optionalActor` и `sessionOrAgent`; последние два вручную объединяют session и agent key.
- [`GenerationsController`](../apps/api/src/modules/generations/api/generations.controller.ts#L125) — asset endpoints получают identity внутри приватного `generationAsset()`.
- [`IdeasController`](../apps/api/src/modules/ideas/api/ideas.controller.ts#L30) — `optionalUser` и `rateLimitIdentity`; public detail полагается только на уже прикреплённый `SESSION_USER`.
- [`PrintRequestsController`](../apps/api/src/modules/printRequests/api/print-requests.controller.ts#L37) — create извлекает identity внутри приватного `createAfterRateLimit()`.
- [`PrintersController`](../apps/api/src/modules/printers/api/printers.controller.ts#L38) — `researchUser()` делегирует выбор session/research key адаптеру.
- [`ProfileController`](../apps/api/src/modules/profile/api/profile.controller.ts#L19) — helper `sessionUserId()` маскирует отсутствие identity как 404.
- [`ProjectsController`](../apps/api/src/modules/projects/api/projects.controller.ts#L371) — public preview вручную читает опциональный session JWT.
- [`PublicApiController`](../apps/api/src/modules/publicapi/api/publicapi.controller.ts#L77) — principal и `ownerId` получаются из `api_keys`, а не из session claims.

### Аномалии и риски

1. **Non-null assertion в community.** [`uid()`](../apps/api/src/modules/community/api/community.controller.ts#L27) падает TypeError при расхождении matcher/handler вместо контролируемого 401.
2. **Webhook без аутентификации входящего сообщения.** [`POST /billing/webhooks/yookassa`](../apps/api/src/modules/billing/api/billing.controller.ts#L20) не проверяет подпись/секрет запроса. Сервис сверяет состояние через provider API только после записи dedupe и только если purchase найден; неизвестный payment ID принимается как `matched: false`.
3. **Нет явной staff/RBAC-проверки на catalog moderation.** Четыре approve/reject endpoint’а защищены лишь наличием session JWT; controller и service не читают userId и не вызывают staff-check.
4. **24 session-защищённых handler’ов не читают userId.** Это не обход guard, но защита основана только на matcher: `GET /analytics/health`, `GET /catalog/metrics`, `GET /material-candidates`, `POST /material-candidates/:id/approve`, `POST /material-candidates/:id/reject`, `GET /machine-candidates`, `POST /machine-candidates/:id/approve`, `POST /machine-candidates/:id/reject`, `GET /communities/:id/feed`, `GET /communities/:id/threads`, `GET /threads/:id`, `GET /posts/:id/attachments/:attachmentId`, `GET /feed/posts/:id/comments`, `GET /generations/health`, `GET /makers/nearby`, `POST /makes/:id/repost`, `POST /makes/:id/view`, `GET /makes`, `GET /makes/:id/comments`, `GET /models/:id/makes/leaderboard`, `GET /avatars/:userId`, `GET /push/vapid-public-key`, `GET /slicer-profiles`, `GET /slicer-profiles/:id/calibrations`.
5. **OpenAPI/access-matrix drift.** [`GET /makers/nearby`](../apps/api/src/modules/makers/api/makers.controller.ts#L50) помечен в OpenAPI как public, но матрица требует session. Аналогично несколько public-looking read/health endpoint’ов фактически закрыты.
6. **Отрицательный matcher.** `GET /printers/:slug` публичен, но literal `/printers/reports` специально исключён negative-lookahead; изменение порядка или regex может открыть очередь review.
7. **Опциональная identity неоднородна.** `/consent`, `/feed` и project preview сами вызывают verifier; `GET /ideas/:id` читает только `SESSION_USER`, поэтому обычный public request с валидной cookie всё равно выглядит анонимным. В CLOSED_DEV поведение меняется.
8. **Cookie имеет приоритет над bearer.** Невалидная `portal_session` блокирует fallback к валидному bearer на всех session/mixed путях.
9. **Session JWT не проверяет статус БД глобально.** Проверка active user есть у `/auth/session`, но не у остальных 228 session route; server-side revocation отсутствует.
10. **Drift route inventory.** В исходниках найдено 300 активных декораторов, тогда как immutable manifest сейчас содержит 309 записей при тестовом ожидании 308 и включает 47 formally-removed маршрутов. Поэтому manifest нельзя считать точным текущим inventory.
