# Giga assistant worker: deploy, preflight and rollback

`giga-assistant-worker` is a separate queue workload using the existing `giga`
image. It has no Service or Ingress and is never supervised by the HTTP or
generation containers. The checked-in production values use both
`replicaCount: 0` and `ASSISTANT_LIFECYCLE_ENABLED=0`.

## Activation gates

Do not change the lifecycle flag to `1` until all gates below are recorded for
the named environment:

1. the read-only data/runtime/backlog report is current, including waiting depth
   and oldest queued run;
2. the opt-in GigaChat probe in
   [giga-assistant-provider-contract.md](giga-assistant-provider-contract.md)
   has passed for the configured model and CA chain;
3. `rndml/aiportal/api` and the worker's Vault path contain the same random
   `ASSISTANT_SERVICE_TOKEN` (32–512 characters). Both worker environments reuse
   the corresponding Giga service's `rndml/aiportal/giga` path. This shared path
   must also contain `GIGACHAT_CREDENTIALS` or both `GIGACHAT_CLIENT_ID` and
   `GIGACHAT_API_KEY`;
4. the private origin in `ASSISTANT_INTERNAL_API_ORIGIN` resolves to the API
   service from the worker namespace.

Static manifests and fixture tests do not satisfy these environment gates.

## Required configuration

| Setting | Owner | Rule |
| --- | --- | --- |
| `DATABASE_URL` | worker Vault | queue database connection; required only by the worker process |
| `ASSISTANT_LIFECYCLE_ENABLED` | deployment | `0` by default; `1` only after all activation gates |
| `ASSISTANT_INTERNAL_API_ORIGIN` | deployment | private `http(s)` origin only, with no path, credentials or query |
| `ASSISTANT_SERVICE_TOKEN` | API + worker Vault | identical secret in both workloads; never ConfigMap or logs |
| `ASSISTANT_PROVIDER` | deployment | `gigachat` primary, `hyperpc` rollback |
| `ASSISTANT_GIGACHAT_MODEL` | deployment | pinned `GigaChat-3-Pro` |
| `ASSISTANT_GIGACHAT_EXPECTED_RESPONSE_MODEL` | deployment | exact probed response identity |
| `GIGACHAT_VERIFY_SSL_CERTS` | deployment | always `true` |
| `GIGACHAT_CA_BUNDLE_FILE` | worker Vault/mount | optional reviewed read-only bundle; empty uses system CA |
| `HYPERPC_STRUCTURED_URL` | worker Vault | required only when provider is `hyperpc` |
| `PORTAL_QUEUE_METRICS_DIR` | deployment | absolute writable textfile directory |

The container command runs `python3 -m giga.assistant.preflight preflight`
before `exec giga-assistant-worker`. It logs a warning when the selected
GigaChat provider lacks credentials, even while the lifecycle is disabled.
Secret values are never logged. With lifecycle enabled, the preflight:

- validates queue timing/budget settings and the writable metrics directory;
- calls the guarded internal context route with a deliberately invalid lease,
  expecting HTTP 400; this proves route reachability and the shared token without
  reading or claiming a real run;
- validates the selected provider, pinned GigaChat model, mandatory TLS
  verification and configured CA bundle, or checks HYPERPC `/v1/models`;
- writes a credential-free marker consumed by the exec probes.

Any failure exits before the queue lifecycle is constructed. The pod therefore
cannot claim `assistant_runs` with an invalid enabled configuration.

## Health and metrics

The readiness probe requires a successful preflight marker and, while lifecycle
is enabled, a recent `giga-assistant.prom` textfile containing `portal_queue_*`
metrics. The liveness probe allows a longer age bound. A disabled worker only
checks the marker and cannot consume queue rows.

After an authorized deployment, inspect only aggregate status:

```sh
oc -n <namespace> get pods -l app.kubernetes.io/instance=giga-assistant-worker
oc -n <namespace> exec deployment/giga-assistant-worker -- \
  python3 -m giga.assistant.preflight health --max-metrics-age-seconds 90
oc -n <namespace> exec deployment/giga-assistant-worker -- \
  sh -c 'grep "^portal_queue_" /tmp/giga-assistant-metrics/giga-assistant.prom'
```

Do not print `/vault/secrets/config`, environment variables, prompts, thread text
or provider responses as operational evidence.

## Rollback

Provider rollback keeps the same queue/run/result contracts:

1. set `ASSISTANT_PROVIDER=hyperpc` and a reviewed private
   `HYPERPC_STRUCTURED_URL` in worker configuration;
2. redeploy only `giga-assistant-worker`; preflight must pass `/v1/models`
   before the process can claim a run;
3. verify fresh aggregate queue metrics and one authorized staff scenario.

Immediate processing rollback is scale-to-zero:

```sh
oc -n <namespace> scale deployment \
  -l app.kubernetes.io/instance=giga-assistant-worker --replicas=0
oc -n <namespace> get deployment \
  -l app.kubernetes.io/instance=giga-assistant-worker
```

Keep `ASSISTANT_LIFECYCLE_ENABLED=0` in checked-in production values. A real
scale-down/scale-up rehearsal and staff canary require separate authorization
and belong to OpenSpec task 10.7; this change only supplies and locally validates
the rollback path.
