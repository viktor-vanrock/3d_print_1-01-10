# Giga assistant v1: readiness данных и runtime

Дата статического аудита: 2026-09-21. Change: `expand-giga-portal-assistant`, пакет P01.

## Назначение и граница безопасности

Скрипт [`giga-assistant-data-readiness.sql`](./giga-assistant-data-readiness.sql) отвечает на одиннадцать вопросов из design до включения capability в конкретном окружении. Он запускается в `REPEATABLE READ READ ONLY`, ограничивает время statement/lock, выводит только counts, coverage, возраст очереди и метаданные индексов. Идентификаторы пользователей, принтеров и runs, тексты сообщений, новости, URL, credentials и значения окружения не выводятся.

Запускать отдельно для каждого разрешённого target:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v environment=dev \
  -f docs/verification/giga-assistant-data-readiness.sql \
  > /tmp/giga-assistant-readiness-dev.txt
```

Для production-like используется отдельное имя `environment=production-like`. Значение `DATABASE_URL` нельзя помещать в командный лог или evidence. `run_explain=true` допустим только на согласованной read replica или одноразовой копии с production-like cardinality; по умолчанию планы не исполняются.

Скрипт сначала проверяет требуемые таблицы и колонки. Несовпадение baseline-схемы завершает прогон с ненулевым кодом до запросов данных. Будущая таблица `printer_machine_links` проверяется отдельно: её отсутствие или несовпадающий контракт блокируют только mapping-dependent capability и не включают fuzzy matching.

## Интерпретация результатов

| Проверка | Что подтверждает | Локальный gate |
| --- | --- | --- |
| `q01_public_printers` | покрытие карточек, реально видимых по `cardinality(sources) > 0` | нулевое покрытие выключает printer tools; отдельные пропуски становятся `missing_fields` |
| `q02_active_fdm_machines` | заполненность ключей `machines.specs`, которые читает compatibility | неполные строки дают `insufficient_data`, а не совместимость |
| `q03_confirmed_mapping` | только явно подтверждённые связи public printer → machine | отсутствие таблицы/строки не мешает search/detail/compare, но блокирует public-card compatibility |
| `q04_owned_references` | распределение двух независимых FK owned printer | доступен только owner-scoped путь; конфликт двух FK закрывается fail-closed |
| `q05_published_filaments` | опубликованные filament parents и наследуемая видимость variants | нулевые материалы выключают filament tools; draft/archive не разрешаются |
| `q06_*_contract_values` | соответствие ключей/enums текущему `compatibility.ts` | любое неподдерживаемое значение требует mapping/fix до доказательства compatibility |
| `q07_visible_news` | записи, соответствующие фиксированной news provenance policy | нулевое покрытие выключает news summaries; это не tool failure |
| `q08_hostile_news_shapes` | объём обязательных hostile-content fixtures | найденные формы становятся fixtures; содержимое остаётся недоверенными данными |
| `q09_name_ambiguity` | частота коллизий имён/aliases без раскрытия самих значений | неоднозначность ведёт к clarification, не к автоматическому выбору |
| `q10_index_inventory` | наличие индексов для основных bounded paths | это не latency proof; production-like `EXPLAIN` фиксируется отдельно |
| `q11_assistant_runtime_backlog` | глубина, возраст queued runs и просроченные leases | неизвестный или неразобранный backlog блокирует включение lifecycle |

В `feed_posts.published_at` записывается отдельное портальное событие первой публикации. Старые записи без этого значения не участвуют в датированном поиске новостей: восстановить их историческую дату из `created_at` нельзя. Исходная дата публикации остаётся отдельной и неизвестной, пока она не подтверждена.

## Инвентаризация claimant/runtime

Кодовый claimant очереди однозначен:

- entrypoint `giga-assistant-worker` из `apps/giga/pyproject.toml` вызывает `giga.assistant.lifecycle_worker:run_loop`;
- `run_loop` прекращает активацию без `DATABASE_URL` или при `ASSISTANT_LIFECYCLE_ENABLED != 1`;
- `AssistantRepository.claim` атомарно выбирает старейший `assistant_runs.status='queued'` через `FOR UPDATE SKIP LOCKED`, ставит lease и увеличивает `attempts`;
- обычный `giga-worker` обрабатывает очередь генераций и не является claimant `assistant_runs`.

Статический deployment inventory на 2026-09-21:

| Контур | Repo-declared процесс | Assistant flag | Отдельный workload/job | Вывод по repo state |
| --- | --- | --- | --- | --- |
| dev Kubernetes | один pod запускает `uvicorn` и `giga-worker` | `0` | отсутствует в `envs/dev` и `.deploy.yml` | claimant `assistant_runs` не объявлен |
| prod Kubernetes | один pod запускает только `uvicorn` | `0` | отсутствует в `envs/prod` и `.deploy.yml` | claimant `assistant_runs` не объявлен |
| VDS/systemd templates | есть `portal.giga-worker.service` для generation queue | зависит от локального env, который не читается в evidence | шаблона assistant unit нет | claimant `assistant_runs` не объявлен репозиторием |

Это инвентаризация деклараций репозитория, а не доказательство live-состояния кластера/VDS. Перед scale-up требуется отдельная свежая read-only проверка фактически запущенных workloads и `q11` в том же target database. При неизвестном backlog lifecycle остаётся выключенным.

## Исторические данные: dev (2026-09-21, до миграции `published_at`)

Числа ниже получены до миграции 2026-09-23 и не подтверждают текущий путь датированного поиска новостей. Перед использованием как актуального gate нужно повторить Q7, Q8, Q10 и необязательный news EXPLAIN на dev-базе после миграции. Исторические значения `published_at` миграция не восстанавливает.

| Поле | Результат |
| --- | --- |
| Время наблюдения | `2026-09-21T11:38:29Z` (`2026-09-21 14:38 Europe/Moscow`) |
| Источник схемы/runtime | версии `schema.sql`, `pyproject.toml`, `envs/dev/giga.yaml`, `.deploy.yml` и worker source на момент наблюдения |
| Database target | одобренная локальная dev-конфигурация `apps/api/.env.local`; значение URL не выводилось |
| Read-only proof | `transaction_read_only=on`; все проверки завершены `ROLLBACK` |
| Aggregate SQL | выполнена версия SELECT от 2026-09-21 через установленный `pg`, потому что `psql` на машине отсутствует |
| Queue depth / oldest queued age | `0 / 0 секунд`; running `0`, expired leases `0`; повторно подтверждено read-only запросом в `REPEATABLE READ` 2026-09-21T11:38:29Z |
| Live workload inventory | не выполнялся; repo declaration не запускает assistant worker |
| Gate | исторический data baseline получен; после изменения news date path требуется новый SQL-прогон, а для dev activation также нужны live runtime inventory и worker preflight |

Агрегатные результаты dev:

| Проверка | Evidence | Решение |
| --- | --- | --- |
| Public printers | 335 public; verified 0; confidence 335; provenance 296; price date 88; complete build volume 324; hotend temp 217; bed temp 193; chamber temp 0 | search/detail/compare могут использовать public rows с честным quality/missing state; нельзя утверждать verified; chamber temperature всегда unknown |
| Active FDM machines | 335 active; build volume 324; nozzle hardness 158; `max_hotend_temp_c`, chamber, extruder drive, filament diameter и complete set — 0 | machine-dependent compatibility остаётся `insufficient_data`, пока adapter/data normalization не подтвердят required keys |
| Confirmed mapping | таблицы `printer_machine_links` нет; 0 confirmed links | public-card compatibility отключена; fuzzy join запрещён; printer search/detail/compare не блокируются |
| Owned references | 0 строк во всех категориях | owned-printer resolution нельзя активировать/канареить на этом target без fixtures или реальных owner-scoped строк |
| Published filaments | 2957 materials; 15338 variants; typed 2957; temperature-ready 0; fill type 0; source timestamp 2957; diameter-ready/sourced variants 15338 | filament search наполнен; подтверждённая temperature/fill compatibility недоступна и должна давать `insufficient_data` |
| Contract values | invalid machine/material enum values 0 | известные присутствующие значения не нарушают enums; это не компенсирует отсутствующие decision-critical fields |
| Visible news | 1881 visible и eligible по прежней provenance policy; дата портальной публикации тогда отдельно не хранилась и её покрытие неизвестно; first-class/original source date 0; community 0 | прежний результат не подтверждает датированный поиск по `published_at`; нужен новый Q7 после миграции |
| Hostile news shapes | HTML 0; long body 0; prompt-like 29; non-HTTPS URL 0 по прежней выборке | новый Q8 нужен для текущих eligible rows; найденный текст всегда сериализуется как данные |
| Ambiguity | printer collisions 0; material collision groups 282, затронуто 1986 rows | printer names не показали коллизий в этом snapshot; material resolver обязан возвращать bounded candidates/clarification |
| Index inventory | printers 12, machines 7, materials 7, variants 5, feed 7 до новой миграции; feed-visible и assistant-queue indexes были, индекс `feed_posts_assistant_published_idx` тогда отсутствовал | наличие нового индекса и latency текущего запроса требуют нового Q10/EXPLAIN |

Дополнительный локальный `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` выполнялся в той же read-only транзакции и сохранялся только в агрегированном виде: printer query — sequential scan, `0.425 ms`; filament query — два sequential scan, `2.752 ms`; прежний news query по `created_at` — index scan, `0.151 ms`. Этот news plan не подтверждает путь через `published_at`; новых замеров пока нет.

## Runtime probe: доступность target

Повторная read-only проверка 2026-09-21T11:38:29Z установила, что в локальном kubeconfig доступен только context `kind-review-engine`. Он не является контуром additive-ai-portal, поэтому запросы workloads, pods или database через него намеренно не выполнялись. Контексты dev/prod OpenShift для портала и production-like/read-replica database configuration в локальной сессии отсутствуют.

Следовательно, безопасно подтверждён только локальный dev backlog (`queued=0`, `running=0`, `expired_leases=0`, `oldest_queued_seconds=0`). Для закрытия runtime gates нужны два явно выданных read-only target: production-like БД для полного `giga-assistant-data-readiness.sql` и соответствующий кластерный context/namespace для инвентаризации реально запущенных assistant workloads. До этого `ASSISTANT_LIFECYCLE_ENABLED` остаётся `0`, а запуск отдельного claimant запрещён.

## Evidence: production-like

| Поле | Результат |
| --- | --- |
| Время попытки | 2026-09-21, Europe/Moscow |
| Источник схемы/runtime | текущие `schema.sql`, `pyproject.toml`, `envs/prod/giga.yaml`, `.deploy.yml`, worker source |
| Database target | production-like/read-replica connection в локальной сессии отсутствует |
| Aggregate SQL | не запускался |
| Queue depth / oldest queued age | неизвестны |
| Live workload inventory | не выполнялся; repo declaration не запускает assistant worker |
| Gate | production activation blocked до отдельного успешного SQL-прогона и live runtime/backlog evidence |

## Статус задач P01

- `1.1`: артефакты и все одиннадцать проверок подготовлены; критерий выполнен статически.
- `1.2`: остаётся открытой. Dev aggregate evidence записан; нужен отдельный успешный production-like прогон.
- `1.5`: статическая часть runtime inventory и dev backlog evidence выполнены, но критерий целиком не закрыт: отсутствуют live workload evidence и production-like queue depth/oldest age.

Низкое или нулевое покрытие отключает только связанную capability. Отсутствие target evidence запрещает её активацию в этом окружении, но не блокирует fixture-based разработку остальных частей.
