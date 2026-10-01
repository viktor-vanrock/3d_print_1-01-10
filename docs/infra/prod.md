# Prod-контур в OpenShift (ветка `main`) — раннбук

Зеркало dev-контура ([dev.md](dev.md)), namespace `p-rndml-aiportal` в кластере
`api.advosp.sberdevices.ru:6443`. Собирается тем же kaniko, выкатывается тем же
`helm-template`, что и dev — отличаются values, кластер, домен и Vault-пути.

> **Кластер у прода ДРУГОЙ, чем у dev.** dev живёт в `advosd`, прод-проект заведён в
> `advosp` (`os-clusters/bootstrap/advosp/projects/p-rndml-aiportal-values.yaml`).
> Отсюда другой `OC_SERVER` и другой домен Route'ов (`*.apps.advosp.sberdevices.ru`).
> Все 29 прод-vhost'ов в `inventory/files/nginx/p-rndml-nginx-adv-msk/conf.d/` проксируют
> в `advosp` — это подтверждает, что прод-трафик идёт именно туда.

> **Это НЕ то же, что VDS-деплой.** Автодеплой `main` на VDS
> (`deploy/portal.deploy.sh` + `portal.deploy.timer`, см. [readme.md](readme.md)) продолжает
> работать и остаётся источником `3mf.tech`. Прод в OpenShift — второй, независимый контур
> под `materialize.sberdevices.ru`. Пока оба живы, у прода ДВА места правды; план схлопывания —
> §6. Не выключать таймер на VDS, не сверив, что кубер-контур обслуживает трафик.

## 0. Квота namespace — почему лимиты именно такие

`ResourceQuota` прод-проекта — **16 CPU / 16 Gi** на `limits` и на `requests`
(в dev вдвое больше по лимитам: 32/32). Превышение = поды не создаются вообще,
с понятной ошибкой в `oc get events`, но без падения helm-релиза.

Текущая сумма в пике (включая migration-Job, который на `pre-upgrade` живёт
одновременно со старым подом api и берёт **те же** `resources`):

| | limits | requests |
|---|---|---|
| сумма всех сервисов + migration-Job | 14 CPU / 14 Gi | 2.8 CPU / 5.5 Gi |
| квота | 16 CPU / 16 Gi | 16 CPU / 16 Gi |

Запас ~2 CPU / 2 Gi оставлен осознанно: `web` при `RollingUpdate` c `maxSurge: 1`
поднимает третий под. Перед увеличением любых лимитов или `replicaCount`
пересчитать сумму, иначе выкатка встанет на квоте. Проверка:
`oc describe quota -n p-rndml-aiportal`.

`persistentvolumeclaims: 2` — PVC под git-репозитории api занимает один из двух.

## 1. Цепочка выкатки

```
push в main
  → get_version         (version.json + CI_PIPELINE_IID → version.txt)
  → build_prod_*         kaniko, 7 образов, АВТОМАТИЧЕСКИ
  → deploy_prod_*        helm upgrade --install, ПО КНОПКЕ (manual, блокирующая)
```

Сборка автоматическая: образ в registry ничего не ломает. Выкатка — только руками:
`when: manual` + `allow_failure: false` в `.rules/prod_deploy` (`.gitlab-ci.yml`).

Порядок кнопок:
1. `deploy_prod_api` — тянет за собой pre-upgrade Job миграций (`dbmate`);
2. `deploy_prod_web` — зависит от api (`needs`), раньше не запустится;
3. `deploy_prod_mesh` / `deploy_prod_giga` / `deploy_prod_relay` — в любом порядке;
4. `deploy_prod_search` / `deploy_prod_scout` — когда появятся данные для обработки.

**Миграции в проде вынесены в helm-хук**, а не в команду старта (как в dev):
упавшая миграция должна остановить деплой ДО замены пода, а не уронить сам сервис.
`helm.sh/hook-weight: 10`, `HELM_TIMEOUT: 20m0s` — с запасом на долгие миграции.

### Несовместимые миграции API

`pre-upgrade` hook запускается до обновления ресурсов Helm. Поэтому `Recreate` и
`replicaCount: 1` не гарантируют, что старый API остановлен во время миграции.
Для миграций, меняющих контракт старой версии приложения, обязателен контролируемый
downtime:

1. остановить автоматический rollout и выполнить
   `deploy/portal.openshift-api-stop-for-migration.sh p-rndml-aiportal`;
2. guard масштабирует `deployment/api` до `0` и завершается успешно только при
   `0` ready replicas;
3. запустить штатный `helm upgrade`, включающий migration hook;
4. убедиться, что Job миграции завершился успешно;
5. проверить запуск единственного нового API pod и `/health`;
6. при ошибке миграции не возвращать старый pod до явного rollback БД.

Для `admin.access` → `admin.portal.access` это обязательная процедура. Требование
zero-downtime потребовало бы отдельного двухрелизного expand/contract перехода с
временной поддержкой обоих ключей; текущий rename так не выкатывается.

## 2. Что нужно от вас — по шагам

### 2.1 GitLab CI/CD Variables (проект `rndml/additive-ai-portal`)

| Переменная | Тип | Значение | Обязательна |
|---|---|---|---|
| `OC_TOKEN_PROD` | masked, protected | ServiceAccount-токен в `p-rndml-aiportal` с правом `helm upgrade` | **да** |
| `FREEZE` | обычная | `true` на время стоп-выкаток, иначе не задавать | нет |
| `MM_NOTIFY` / `MM_NOTIFY_WEBHOOK` / `MM_NOTIFY_CHANNEL` | masked | оповещения о выкатке в Mattermost | нет |

`OC_TOKEN_PROD` — **отдельный от dev-`OC_TOKEN`**, специально: один скомпрометированный
токен не должен давать доступ в оба контура. Пометить **protected**, иначе он утечёт
в пайплайны обычных ветвей.

Ветку `main` в GitLab нужно сделать **protected** — иначе `protected`-переменная
`OC_TOKEN_PROD` не подставится и выкатка упадёт на `oc login`.

### 2.2 Vault (`rndml/aiportal/prod/*`)

Роль `p-rndml-aiportal` + 6 секретов. Значения **прод-овые**, ни одного
переиспользованного из dev: dev-контур доступен большему кругу, и его утечка
не должна открывать прод.

**Что кладём в Vault, а что в configMap.** В Vault — только секреты
(креды, токены, ключи). Имена бакетов и регион — НЕ секрет, они в `envs/prod/*.yaml`
(§2.2.3). Vault-агент делает `export` каждого ключа секрета, поэтому имя ключа
в Vault = имя переменной окружения. Ключ с опечаткой не сломает старт пода —
сервис просто молча уйдёт в деградацию (S3-клиент вернёт `None`/`null`), поэтому
имена сверять по таблице ниже, а не по памяти.

#### 2.2.1 Подготовка

```bash
export VAULT_ADDR=https://vault.sberdevices.ru
vault login -method=oidc            # или свой обычный метод входа

# Проверить, что путь и версия KV те же, что в dev (ожидаем kv-v2):
vault secrets list -detailed | grep -E '^rndml/'
```

Все команды ниже — `kv put`, т.е. **перезапись целиком**. Для добавления одного
ключа к уже существующему секрету использовать `vault kv patch` (иначе остальные
ключи будут стёрты).

#### 2.2.2 Генерация значений, которые мы придумываем сами

`JWT_SECRET`, `AUTH_ENCRYPTION_KEY`, `AUTH_HMAC_KEY`, `RELAY_SERVICE_TOKEN` —
не выдаются внешней системой, их генерируем локально. `AUTH_ENCRYPTION_KEY` —
AES-256-GCM, ровно 32 байта.

```bash
JWT_SECRET=$(openssl rand -base64 48)
AUTH_ENCRYPTION_KEY=$(openssl rand -base64 32)   # 32 байта → AES-256
AUTH_HMAC_KEY=$(openssl rand -base64 32)
RELAY_SERVICE_TOKEN=$(openssl rand -hex 32)
FEED_INGEST_KEY=$(openssl rand -hex 32)
```

#### 2.2.3 `rndml/aiportal/prod/api`

Порт PostgreSQL в проде — **15432** (не 5432): именно он открыт egress-политикой
namespace'а, см. §2.5.

```bash
vault kv put rndml/aiportal/prod/api \
  DATABASE_URL='postgresql://portal:<PASS>@172.20.34.183:15432/portal?sslmode=require' \
  JWT_SECRET="$JWT_SECRET" \
  AUTH_ENCRYPTION_KEY="$AUTH_ENCRYPTION_KEY" \
  AUTH_HMAC_KEY="$AUTH_HMAC_KEY" \
  S3_ENDPOINT='https://s3.cloud.ru' \
  S3_ACCESS_KEY='<key>' \
  S3_SECRET_KEY='<secret>' \
  OIDC_CLIENT_ID='<plagid-client-id>' \
  OIDC_CLIENT_SECRET='<plagid-client-secret>' \
  OIDC_ISSUER='<plagid-issuer-url>' \
  SMTP_HOST='<host>' SMTP_PORT='587' \
  SMTP_USER='<user>' SMTP_PASSWORD='<pass>'
```

`S3_REGION` и `S3_BUCKET_*` здесь **не задаём** — они в `envs/prod/api.yaml`.
Vault-агент выполняется до configMap-переменных? Нет: `export` из
`/vault/secrets/config` идёт в `command`, поэтому **Vault перебивает configMap**.
Не дублировать `S3_BUCKET_*` в Vault — иначе значение из configMap перестанет работать.

#### 2.2.4 Воркеры

```bash
# mesh — конвертация/слайсинг, читает и пишет модели
vault kv put rndml/aiportal/prod/mesh \
  DATABASE_URL='postgresql://portal:<PASS>@172.20.34.183:15432/portal?sslmode=require' \
  S3_ENDPOINT='https://s3.cloud.ru' \
  S3_ACCESS_KEY='<key>' S3_SECRET_KEY='<secret>'

# search — индексация, только чтение моделей
vault kv put rndml/aiportal/prod/search \
  DATABASE_URL='postgresql://portal:<PASS>@172.20.34.183:15432/portal?sslmode=require' \
  S3_ENDPOINT='https://s3.cloud.ru' \
  S3_ACCESS_KEY='<key>' S3_SECRET_KEY='<secret>'

# giga — генерация, пишет артефакты и диагностику
vault kv put rndml/aiportal/prod/giga \
  DATABASE_URL='postgresql://portal:<PASS>@172.20.34.183:15432/portal?sslmode=require' \
  S3_ENDPOINT='https://s3.cloud.ru' \
  S3_ACCESS_KEY='<key>' S3_SECRET_KEY='<secret>' \
  GIGACHAT_CREDENTIALS='<base64-client-id:secret>'

# scout — S3 не нужен вообще (см. apps/scout/.env.example)
vault kv put rndml/aiportal/prod/scout \
  DATABASE_URL='postgresql://portal:<PASS>@172.20.34.183:15432/portal?sslmode=require' \
  GITHUB_TOKEN='<token>' \
  SCOUT_NEWS_FEED_INGEST_KEY="$FEED_INGEST_KEY"

# relay — mTLS-шлюз, БД не трогает
vault kv put rndml/aiportal/prod/relay \
  RELAY_SERVICE_TOKEN="$RELAY_SERVICE_TOKEN"
```

#### 2.2.5 Роль для namespace — это MR, а не CLI

Без роли Vault-агент в поде получит `permission denied`, `source /vault/secrets/config`
упадёт и под не стартует.

**Роли и политики Vault — Terraform-IaC, руками их не создают.** Репозиторий —
`vault-production` (`cloud/terraform/live/vault-production`), auth-бэкенд кубера
для прод-кластера называется ровно `advosp`
(`vault-production/auth_backend/kubernetes.yaml` → `kubernetes_host: https://api.advosp.sberdevices.ru:6443`).

Нужен один новый файл — `vault-production/roles/kubernetes/advosp/rndml/p-rndml-aiportal.json`,
по образцу соседнего `p-rndml-storybook.json`:

```json
{
  "p-rndml-aiportal": {
    "bound_service_account_names": ["vault"],
    "bound_service_account_namespaces": ["p-rndml-aiportal"],
    "token_type": "batch",
    "token_max_ttl": 300,
    "token_policies": ["rndml-deploy"],
    "type": "kubernetes"
  }
}
```

Отдельную политику писать **не нужно**: существующая `rndml-deploy`
(`vault-production/policy/rndml/rndml-deploy.json`) уже даёт `read` на `rndml/*`,
чего хватает для `rndml/aiportal/prod/*`. Движок `rndml` — KV **v2**
(`engines/secrets/rndml/rndml.json`), поэтому `vault kv put` из §2.2.3–2.2.4 корректен.

> **Долг, обнаруженный при разборе.** В `vault-development` тоже **нет** файла роли
> `d-rndml-aiportal`, хотя `envs/dev/*.yaml` на неё ссылаются и dev работает. Значит
> dev-роль заведена руками, в обход IaC, и потеряется при следующем `terraform apply`.
> Прод так делать не надо — завести через MR сразу. И отдельной задачей вернуть dev
> в IaC, иначе dev-контур однажды отвалится на `permission denied` без видимой причины.

#### 2.2.6 Проверка

```bash
vault kv get rndml/aiportal/prod/api          # ключи на месте?
diff <(vault kv get -format=json rndml/aiportal/api     | jq -r '.data.data|keys[]') \
     <(vault kv get -format=json rndml/aiportal/prod/api | jq -r '.data.data|keys[]')
```

Второй командой сверяем **набор ключей** прода с dev: пустой diff = ничего не забыли.
Значения при этом обязаны отличаться.

### 2.3 Kubernetes-объекты, создаваемые руками ДО первой выкатки

Helm их не создаёт — при их отсутствии поды встанут в `Pending`/`CreateContainerConfigError`:

| Объект | Что | Для кого |
|---|---|---|
| `gitlab-registry-secret` | `kubernetes.io/dockerconfigjson` на `registry.sberdevices.ru` | все 7 |
| ServiceAccount `vault` | привязан к Vault-роли `p-rndml-aiportal` | все, кроме web |
| PVC `aiportal-api-git-repos` | RWO, **≥50Gi** (в проде это растущие git-репозитории пользователей) | api |
| Secret `aiportal-relay-tls` | `tls.crt` / `tls.key` / `ca.crt` для mTLS-шлюза | relay |
| PostgreSQL | прод-инстанс + пустая БД под `dbmate` | api и воркеры |

### 2.4 Сеть и DNS

Домен прода — **`materialize.sberdevices.ru`** (переименован с `aiportal`;
namespace, Vault-пути и имена Route'ов при этом остались `aiportal` — их
переименование потребовало бы пересоздания проекта, что вне этой задачи).

Правки лежат в двух внешних репозиториях, **не закоммичены** — нужен MR от Ops:

| Репозиторий | Файл | Что добавлено |
|---|---|---|
| `inventory` (`cloud/ansible/inventory`) | `files/nginx/p-rndml-nginx-adv-msk/conf.d/materialize.sberdevices.ru.conf` | vhost, копия dev-конфига с прод-хостами |
| `dns` (`cloud/terraform/live/dns`) | `int/sberdevices.ru/A.yaml` | `materialize` → `172.20.10.90` (VIP прод-nginx), `fp: rndml` |
| `vault-production` | `roles/kubernetes/advosp/rndml/p-rndml-aiportal.json` | Vault-роль для SA `vault` в прод-namespace (§2.2.5) |

- vhost — drop-in: индекса/плейбука со списком конфигов нет, ansible синхронизирует
  весь каталог `conf.d`. Достаточно добавить файл.
- TLS отдельный **не нужен**: на прод-nginx `bundle.crt` — симлинк на
  `le-wildcard-sberdevices-ru` (`group_vars/p-rndml-nginx-adv-msk/symlinks/vars.yml`),
  wildcard `*.sberdevices.ru` покрывает новое имя.
- Копия vhost'а лежит и в этом репо (`deploy/nginx.materialize.sberdevices.ru.conf`)
  для истории рядом с кодом. **Канонична версия в `inventory`** — правки вносить в оба
  места, иначе ansible перезатрёт ручную правку на хосте.
- Запись добавлена только во **внутреннюю** зону (`int/`), как у dev. Если портал
  должен быть доступен из интернета — нужна ещё запись в `ext/sberdevices.ru/A.yaml`
  с публичным адресом (у соседних прод-сервисов `fp: rndml` это `95.181.177.x`).
  Конкретный IP выделяет Ops — **не выдумывать**, он зависит от того, какой внешний
  балансировщик отдадут проекту.
- Имена Route'ов в конфиге (`web-p-rndml-aiportal.apps.advosp...`) **сверить** после
  первой выкатки: `oc get route -n p-rndml-aiportal`. Они генерируются кластером.
- relay наружу через Route публиковать нельзя (edge-termination убивает клиентские
  сертификаты) — нужен L4/TLS-passthrough или отдельный LB. Решение за Ops.

### 2.5 Egress NetworkPolicy — почему S3 может не заработать

У прод-проекта в `os-clusters` **явно задан egress**, и в нём только PostgreSQL:

```yaml
networkPolicy:
  egress:
    - ips:
        - cidr: 172.20.34.183/32   # p-rndml-pgsql-adv-msk01
        - cidr: 172.20.34.175/32   # p-rndml-pgsql-adv-msk02
      ports:
        - port: 15432
```

В dev-проекте `egress: []` — то есть ограничений нет. Из этого следуют два вывода:

1. **Порт БД в проде — 15432**, а не 5432. `DATABASE_URL` с 5432 не подключится.
2. Исходящий трафик к **S3 (`s3.cloud.ru`), GigaChat, GitHub и источникам scout,
   вероятно, заблокирован.** Тогда api/mesh/giga/search поднимутся, но будут
   таймаутиться на аплоаде/генерации, а scout — на обходе источников.

Что сделать до первой выкатки: запросить у Ops расширение egress прод-проекта
(MR в `os-clusters/bootstrap/advosp/projects/p-rndml-aiportal-values.yaml`) на
S3-эндпоинт, GigaChat API и внешний HTTPS для scout. Проверка изнутри пода:

```bash
oc rsh -n p-rndml-aiportal deploy/api -- curl -sS -m 5 -o /dev/null -w '%{http_code}\n' https://s3.cloud.ru
```

### 2.6 Имена S3-бакетов

В k8s-контуре бакет **один на namespace** и называется как namespace —
`p-rndml-aiportal` (так уже сделано в dev, `envs/dev/*.yaml`), а не `3mf`/`auth`/
`generations`, как на VDS.

Имя бакета — не секрет, поэтому оно в `envs/prod/*.yaml`, в Vault только
эндпоинт и креды. Раскладка по сервисам:

| Сервис | Переменные бакетов |
|---|---|
| api | `S3_BUCKET_MODELS`, `S3_BUCKET_AUTH`, `S3_BUCKET_GENERATIONS`, `S3_BUCKET_PRINTERS_RESEARCH` |
| mesh, search | `S3_BUCKET_MODELS` |
| giga | `S3_BUCKET_GENERATIONS`, `S3_BUCKET_DIAGNOSTICS` |
| relay, scout | S3 не используют |

> **Исправлено в этой задаче.** У `api` не было задано ни одной `S3_BUCKET_*`, хотя
> у воркеров они были. Дефолты в коде (`apps/api/src/storage/s3.ts`) — VDS-овые
> `3mf`/`auth`/`generations`, поэтому api искал бы объекты в бакете `3mf`, а mesh
> писал бы их в `p-rndml-aiportal`: загруженная модель «пропадает», ошибки нет.
> Ровно такой рассинхрон уже ловили вживую на dev с `generations-dev`
> (readme.md § 2026-07-20). Теперь все четыре переменные заданы явно.

Один бакет на все роли безопасен по ключам: они не пересекаются
(`protected/models/…`, `public/models/…`, `identities/…`, `generations/…`).
Но **bucket-policy на `public/*`** (публичный read для превью, приватное всё
остальное — readme.md § «Bucket-policy hardening») на новом бакете надо повесить
заново, иначе либо превью не откроются, либо приватные модели станут публичными.

## 3. Первая выкатка (порядок, который не разваливается)

1. Завести §2.1–2.3. Проверить: `oc get sa vault,secret,pvc -n p-rndml-aiportal`.
2. Прогнать MR'ы во внешних репах (§2.4 nginx+DNS, §2.5 egress) — до этого
   ни домен, ни S3 работать не будут.
3. Смерджить `dev → main`. Пайплайн сам соберёт 7 образов.
4. Нажать `deploy_prod_api`. Смотреть Job миграций:
   `oc logs job/api-migrations -n p-rndml-aiportal`.
5. `curl -k https://api-p-rndml-aiportal.apps.advosp.sberdevices.ru/health`.
6. Нажать `deploy_prod_web`, поднять nginx, проверить `https://materialize.sberdevices.ru`.
7. Смоук S3: загрузить модель и убедиться, что объект появился в бакете
   `p-rndml-aiportal`, а не в `3mf` (§2.6).
8. Остальные волны — по мере надобности, воркеры последними.

Откат: `helm rollback <api|web> -n p-rndml-aiportal`. **Миграции откатом не отменяются** —
несовместимую с прошлой версией миграцию откатывать вручную (`dbmate down`).

## 4. Почему почти везде `replicaCount: 1` (это не экономия)

Единственный сервис, который сейчас можно масштабировать горизонтально — **web**
(2 реплики + PDB + RollingUpdate). Остальные упираются в состояние:

| Сервис | Что мешает второй реплике | Что расшить, чтобы можно было |
|---|---|---|
| **api** | RWO-PVC с git-репозиториями монтируется в один под; `strategy: Recreate` | вынести репозитории в RWX (CephFS/NFS) или S3 → затем `replicaCount: N` + RollingUpdate |
| **mesh** | воркерные петли берут задачи из таблицы без блокировки | `SELECT … FOR UPDATE SKIP LOCKED` в выборке задач |
| **giga** | то же + двойной расход токенов GigaChat | то же |
| **search** | тот же паттерн очереди | то же |
| **scout** | ходит на внешние источники, вторая реплика удвоит трафик и поймает бан по IP | лизинг задач/шардирование источников |
| **relay** | WSS-сессии устройств живут в памяти пода | внешний реестр сессий (Redis) + sticky L4 |

Поэтому фоновые петли в проде выключены (`*_LIFECYCLE_ENABLED: "0"`,
`MESH_REVISION_WORKER_ENABLED: "0"`) — включать осознанно, по одной, после
блокировки задач в БД. Иначе первая же вторая реплика начнёт дублировать работу.

## 5. Масштаб на вырост

**Шаг 1 (сейчас, без изменений кода).** Поднять `replicaCount` и включить HPA у **web**:
чарт умеет `autoscaling` (`hpa.yaml`, `autoscaling/v2` по CPU/memory). Это единственный
безопасный автоскейл на сегодня:

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70
```
При `autoscaling.enabled` чарт перестаёт рендерить `replicas` — HPA владеет числом
реплик. Держать `replicaCount` и HPA одновременно бессмысленно.

**Шаг 2 (малый рефакторинг).** `SKIP LOCKED` в выборке задач у mesh/giga/search →
эти три становятся горизонтальными, включаются lifecycle-петли, HPA по CPU.
Самый дешёвый рост пропускной способности слайсинга и генерации.

**Шаг 3 (инфраструктурный).** Git-репозитории api → RWX или S3-бэкенд. Снимает
`Recreate` и единственную реплику с самого нагруженного сервиса; заодно убирает
единственный кусок состояния, который мешает выкатке без простоя.

**Шаг 4 (профильный).** relay в отдельный контур: свой namespace/нодпул, внешний
реестр сессий, L4-балансировщик. Профиль нагрузки (сотни тысяч persistent WSS)
несовместим с stateless REST — их нельзя держать за одним LB. Соответствует
`relay.3mf.tech` из [domain.map.md](domain.map.md).

**Шаг 5 (данные).** PostgreSQL: read-replica под тяжёлые выборки, отдельный инстанс
или пул под воркеры. `dbmate` остаётся один — миграции применяет только api-хук,
чтобы не было гонки нескольких мигрантов.

**Тяжёлые ресурсы.** `mesh` (slicer, лимит 3 CPU / 4Gi) и `search` (эмбеддинги) —
кандидаты на выделенный нодпул через `nodeSelector`/`tolerations` (чарт поддерживает
оба). Иначе один слайс способен вытеснить api с ноды.

**Ограничения per-namespace — главный потолок роста.** Квота прод-проекта
**16 CPU / 16 Gi**, текущий пик — 14/14 (§0). То есть свободно ~2 CPU / 2 Gi:
этого хватит на пару реплик web, но не на HPA до 6 и не на вторую реплику mesh.

Любой из шагов 1–3 выше **требует сначала расширить квоту** — MR в
`os-clusters/bootstrap/advosp/projects/p-rndml-aiportal-values.yaml`. Просить
вместе с egress (§2.5), одним обращением к Ops. Ориентир для шага 1+2:
32 CPU / 32 Gi (как в dev) и `persistentvolumeclaims: 4`.

## 6. Известные риски и долги

1. **Два прод-контура одновременно.** VDS (`3mf.tech`) и OpenShift
   (`materialize.sberdevices.ru`) обслуживают один и тот же `main`. У них разные БД и разные
   S3-бакеты — данные НЕ синхронизируются. Пока это так, нельзя считать один контур
   резервом другого. Решение (кому-то придётся выбрать): либо кубер становится
   единственным продом и таймер на VDS выключается, либо VDS остаётся, а кубер-контур
   объявляется стендом.
2. **`CHART_REF: master`** у `helm-template` — прод переедет на новый чарт при чужом
   коммите в платформенный репозиторий. Единственный тег `0.1.1` старше текущих шаблонов,
   поэтому запинить нечего. Просить у DevOps-платформы версионный тег.
3. **Имена Route'ов в nginx-конфиге не проверены** — их генерирует кластер, сверить
   после первой выкатки (§2.4).
4. **Секрет `aiportal-relay-tls` и PVC создаются вручную** — не в Git, не в IaC.
   При пересоздании namespace их придётся восстанавливать по памяти.
5. **`imagePullSecrets` и SA `vault` тоже вне Git** — та же проблема.
6. **Публикация relay наружу не решена** (§2.4) — до этого прод-relay доступен только
   внутри кластера, устройства к нему не подключатся.
7. **Egress-политика namespace, скорее всего, режет S3/GigaChat/внешний HTTPS** (§2.5) —
   не проверено вживую, проверяется только после первой выкатки. Самый вероятный
   источник «поды поднялись, но ничего не работает».
8. **Домен переименован, а namespace/Vault-пути — нет.** Публичное имя —
   `materialize.sberdevices.ru`, а namespace, Vault-ветка (`rndml/aiportal/prod/*`),
   имена Route'ов, PVC и Secret'ов остались `aiportal`. Так сделано намеренно:
   переименование namespace = пересоздание проекта в `os-clusters` и перевыпуск
   всех секретов. Расхождение имён держать в голове при чтении логов.
9. **Bucket-policy на новом бакете `p-rndml-aiportal` не настроена** (§2.6) — до этого
   либо публичные превью не отдаются, либо приватные модели видны анонимно.
   Проверить до открытия доступа пользователям.
