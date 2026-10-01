# Giga assistant v1 verification

This report separates local fixture/test evidence from provider and environment activation. The ordinary local suite uses a fake provider. A separate opt-in IFT probe proves the configured GigaChat model, OAuth, CA trust and function contract; it does not prove target-environment data coverage, deployment readiness or canary results.

## Cross-service journeys

The existing Nest API + PostgreSQL + Python worker composition contains exactly three product journeys in `apps/api/src/modules/assistant/api/assistant.controller.integration.test.ts`:

1. `journey 1: persists printer lookup and a comparison follow-up in one owned thread`;
2. `journey 2: recommends filament through the API compatibility adapter`;
3. `journey 3: summarizes news while hostile source instructions remain inert data`.

Foreign ownership remains a boundary test in `assistant-internal.controller.integration.test.ts`; hostile-content policy also remains a focused router test. No fourth product journey or reusable E2E framework was added.

## Requirement-to-test table

| Spec scenario | Closest named coverage |
| --- | --- |
| New grounded question | `journey 1: persists printer lookup and a comparison follow-up in one owned thread` |
| Thread reload restores run state | API `returns only runs linked to messages on the owned current page`; UI `восстанавливает завершённый ответ после reload без sessionStorage`, `возобновляет polling queued/running run после reload`, and `восстанавливает подтверждённую генерацию после reload` |
| Foreign thread | `rejects foreign ownership and mismatched triggering thread, content and role` |
| Successful GigaChat answer | `test_native_functions_system_ca_and_one_attempt`; opt-in IFT contract probe passed for the pinned exact model identity |
| Provider switch or rollback | `test_hyperpc_wrapper_preserves_slot_contract_and_normalizes_tool_call` |
| Follow-up refers to previous comparison | Journey 1; `keeps completed turns chronological and preserves visible comparison wording and order` |
| Context exceeds the budget | `retains newest whole turns at the exact 12,000 Unicode-character boundary`; `reports turns beyond the eight-turn limit and handles empty history` |
| Previously referenced entity is no longer visible | `replaces the entire answer when one reference is hidden without replaying facts or source labels` |
| Legacy factual assistant history has no provenance | `omits unverifiable legacy answers but retains their owned user messages` |
| Valid read-only tool call | `propagates only run identity and correlation to a schema-validated read handler` |
| Invented or unauthorized tool | `rejects invented, prototype, unimplemented and mutating tools without leaking arbitrary input in logs` |
| Tool budget exhausted | `test_third_call_returns_grounded_result_without_execution` |
| Deadline exhausted | `test_deadline_and_lease_fence_drop_late_results`; `test_spawned_attempt_is_terminated_and_joined_before_timeout_result` |
| Answer cites a printer and a news item | Journeys 1 and 3 persist server citations |
| Provider invents a citation | `test_model_cannot_invent_citation_ids_outside_provided_evidence` |
| Prompt injection in a news body | Journey 3; `test_hostile_sources_do_not_change_tools_policy_or_reveal_secrets` |
| User printer participates in a question | `test_filament_provider_receives_label_and_capabilities_but_not_internal_printer_ids`; `emits only safe typed evidence and structural printer references` |
| GigaChat unavailable with useful evidence | `test_provider_unavailable_with_evidence_is_cited_degradation` |
| GigaChat unavailable without useful evidence | `test_no_hyperpc_config_without_evidence_is_still_honest`; `test_timeout_is_stable_retryable_error` |
| User asks to research the web | `не отправляет research и make как обычный запрос` |
| Archived filament matches by name | `parameterizes filters, limits to ten and binds variants to published filament parents` |
| Purpose requested without a material family | `test_filament_inputs_bound_canonical_color_and_require_purpose_clarification` |
| Printer-specific recommendation is ambiguous | `fails closed on foreign owned ids and conflicting catalog-machine references`; router permits one clarification only |
| Abrasive filament and brass nozzle | `preserves abrasive rule codes, unknown hardness and brass blocking` |
| Nozzle material is unknown | `preserves abrasive rule codes, unknown hardness and brass blocking` |
| Chamber and drying warnings | `keeps chamber, bowden and drying warnings conditional when facts are known` |
| Several compatible products remain | `ranks at most five products with byte-equivalent output independent of input order` |
| No candidate can be proven compatible | `only confirms complete known critical facts`; `returns insufficient data without a confirmed public machine while public description works` |
| Previously cited news becomes hidden | `replaces the whole prior news answer after its source becomes hidden` |
| Default “что нового” request | `uses thirty UTC calendar dates by default and discloses exact exclusive bounds` |
| Overly broad period | `normalizes inclusive calendar dates and timezone-qualified instant bounds` |
| Source date and portal date differ | `keeps unknown source dates unknown and never substitutes observation/update time` |
| Source is stale or timestamp is unknown | `keeps unknown source dates unknown and never substitutes observation/update time`; UI `показывает опубликованную новость с портальной и исходной ссылками` |
| User requests external research | `не отправляет research и make как обычный запрос` |
| No news in range | `returns an honest successful empty period and forwards a bounded topic`; UI `показывает успешный пустой диапазон новостей отдельно от ошибки` |
| User printer has both references | `reports contradictory owned and confirmed references`; `fails closed on foreign owned ids and conflicting catalog-machine references` |
| Public and technical records share only a similar name | `resolves only the explicit confirmed printer id` |
| Public printer has no technical mapping | `returns insufficient data without a confirmed public machine while public description works` |
| Ambiguous model name | `returns bounded distinguishing candidates for an ambiguous K1 name`; UI `показывает неоднозначное название как отдельное уточнение` |
| Hidden or source-less record | `lets an exact UUID or slug win before text and excludes source-less rows in SQL` |
| Requested characteristic is missing | `keeps absent chamber temperature unknown and marks only an old RUB price stale`; UI `отдельно показывает устаревшую цену и отсутствующие характеристики` |
| Stale price with current static specifications | `keeps absent chamber temperature unknown and marks only an old RUB price stale` |
| Compare two resolved printers | `resolves two names inside one comparison and preserves their input order`; Journey 1 |
| One comparison reference is ambiguous | `uses no more than four shared resolver calls and caps all ambiguity candidates at ten` |
| Best printer without criteria | `test_best_without_criterion_policy_requires_one_clarification` |
| “Мой основной принтер” | `resolves primary through an owner predicate and returns only the safe projection` |
| Another user's printer id | `uses id plus owner predicate, so a foreign id is indistinguishable from absence` |
| Owned references conflict with confirmed mapping | `reports contradictory owned and confirmed references`; `fails closed on foreign owned ids and conflicting catalog-machine references` |

## Observability contract

The worker emits `assistant.run.completed.v1` as one JSON audit record and low-cardinality metrics through the existing queue metrics sink. The record contains provider, model, `assistant.evidence.v2`, tool names/count, evidence count, latency, context truncation, result kind and correlation id. API context/tool audit records contain only allow-listed counts, names, result kind, latency and correlation id.

Tests assert that prompt/thread bodies, credentials, service tokens and private printer fields cannot enter these records. Correlation id remains log-only because it is high cardinality and is intentionally not a metric label.

## Local verification

Commands are run from `portal.ru/`; the real-DB smoke uses only `sandbox_giga_assistant_test`. The live provider probe remains opt-in and is excluded from ordinary local CI pass criteria.

- `uv run --project apps/giga pytest -q apps/giga/tests/test_assistant_*.py`
- `uv run --project apps/giga ruff check apps/giga/src/giga/assistant apps/giga/tests/test_assistant_*.py`
- `pnpm --filter @portal/api exec vitest run ...assistant... ...printer... ...catalog... ...feed... --maxWorkers=1`
- `pnpm --filter @portal/api typecheck`
- `pnpm --filter @portal/api lint`
- `pnpm --filter @portal/api openapi:check`
- `pnpm --filter @portal/contracts test` and `pnpm --filter @portal/contracts typecheck`
- focused Web assistant tests, Web typecheck and targeted assistant ESLint
- `openspec validate expand-giga-portal-assistant --strict`

Results from the completion run:

- Giga assistant Python and contract probe suites: 267 passed, 7 skipped; Ruff passed.
- Opt-in GigaChat IFT probe: model lookup, split OAuth, TLS/CA, seven function validations with zero warnings and native function call passed; no credentials, token or raw provider payload was printed.
- API real-DB selection: 18 files passed, 1 skipped; 148 tests passed, 2 skipped (150 total). This includes the three cross-service journeys and the foreign-thread boundary.
- API typecheck, lint, OpenAPI check and dependency-cruiser passed.
- Focused assistant contracts: 77 passed; contracts typecheck passed.
- Focused Web assistant: 23 passed; Web typecheck and assistant ESLint passed. The targeted lint command reports one existing `headersearch.tsx` hooks warning.
- Strict OpenSpec validation passed.

## Unrelated repository baseline

The full suites were also sampled so local feature evidence is not confused with unrelated repository state:

- Full contracts before the restore-run amendment: 298 of 301 tests passed. The three failures were OpenAPI conformance for empty admin/sanctions schemas, missing success schemas for `GET /metrics` and `GET /models/{id}`, and the project inventory still containing `/models/{id}`. The amended assistant contract then passed its focused 77-test suite.
- Full Web Vitest before the restore-run amendment: 1169 of 1176 tests passed. Seven failures were outside `/giga`: the home CSS size gate; GenerateScreen accessibility state; two printing-park capability matrix assertions; two printer canon mock assertions; and SlicePrintScreen missing its overlay provider. The amended assistant UI then passed its focused 23-test suite.
- The GigaChat IFT provider probe passed. Deployment and canary traffic were not run and are not claimed by this report.
