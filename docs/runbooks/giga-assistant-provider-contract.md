# Giga assistant provider contract

This runbook fixes the GigaChat contract that must pass before the `/giga`
assistant can be enabled in an environment. It covers provider compatibility
only; passing it does not authorize deployment or user traffic.

## Approved model identity

- Request model: `GigaChat-3-Pro`.
- Last known exact response identity: `GigaChat-3-Pro:32.4.30.3`, verified by
  the existing `device-review/review-engine` integration on 2026-09-15.
- The previous result is reference evidence, not proof for this portal or for a
  later model revision. The target account must return the request model from
  `GET /models`, and the opt-in probe must receive the exact configured response
  identity before activation.
- A revision change fails closed. Review the change, update
  `ASSISTANT_GIGACHAT_EXPECTED_RESPONSE_MODEL`, and rerun the probe; do not use
  prefix or wildcard matching.

The public GigaChat catalogue does not document this internal model alias. Its
availability is therefore established by the target account's `GET /models`
response and the live function-call probe, not by the public catalogue alone.

## Supported function contract

The assistant adapter must use the native GigaChat function dialect:

1. Send user functions in `functions` and select them with `function_call`.
2. Accept a call only when `finish_reason` is `function_call` and
   `message.function_call` contains the allow-listed name and object arguments.
3. Send a server-produced function result back as a JSON string in a message
   with role `function` and the matching function name.
4. Validate every deployed function schema with `POST /functions/validate`.
   Validation errors or warnings block this probe; warnings must be reviewed
   and resolved because they can reduce argument-generation quality.

Official references:

- <https://developers.sber.ru/docs/ru/gigachat/guides/functions/describing-custom-function>
- <https://developers.sber.ru/docs/ru/gigachat/guides/functions/generating-arguments-for-custom-functions>
- <https://developers.sber.ru/docs/ru/gigachat/guides/functions/function-calling-modes>
- <https://developers.sber.ru/docs/ru/gigachain/tools/python/gigachat>

The installed Python SDK contract is `gigachat==0.2.1`. The probe uses its
`Chat`, `Function`, `function_call`, `get_models()` and `get_token()` surfaces;
it does not implement the production provider adapter.

## Configuration names

Use runtime secrets. Never place values in this repository or paste them into
probe output.

| Purpose | Environment variable |
| --- | --- |
| Enable one non-production probe | `RUN_GIGACHAT_CONTRACT_PROBE=1` |
| Assistant request model | `ASSISTANT_GIGACHAT_MODEL=GigaChat-3-Pro` |
| Exact expected returned identity | `ASSISTANT_GIGACHAT_EXPECTED_RESPONSE_MODEL=GigaChat-3-Pro:32.4.30.3` |
| Official SDK authorization key | `GIGACHAT_CREDENTIALS` |
| Existing split OAuth alternative | `GIGACHAT_CLIENT_ID` and `GIGACHAT_API_KEY` |
| Fixed endpoint selection | `GIGACHAT_ENVIRONMENT=ift` or `prod` |
| API scope | `GIGACHAT_SCOPE` |
| Optional CA bundle | `GIGACHAT_CA_BUNDLE_FILE` |
| TLS verification guard | `GIGACHAT_VERIFY_SSL_CERTS=true` |

`GIGACHAT_CREDENTIALS` takes precedence. If it is absent, the probe composes
the existing `GIGACHAT_CLIENT_ID` and `GIGACHAT_API_KEY` in memory and does not
persist the result. The environment is an allow-listed selector, not a URL:

| Environment | API origin | OAuth origin |
| --- | --- | --- |
| `ift` | `https://gigachat.ift.sberdevices.ru/v1` | `https://gigachat.ift.sberdevices.ru/v1/token` |
| `prod` | `https://api.giga.chat/v1` | `https://ngw.devices.sberbank.ru:9443/api/v2/oauth` |

Arbitrary endpoint overrides are not accepted. The sample local environment
and dev manifest default to `ift`; the production manifest selects `prod`.
Vault environment variables may override the dev manifest selection.

If credentials are supplied as `GIGA_AUTH_KEY`, copy its Base64 value into
`GIGACHAT_CREDENTIALS` without the `Basic ` prefix. Alternatively, set both
`GIGACHAT_CLIENT_ID` and `GIGACHAT_API_KEY` from the corresponding client ID
and client secret. `GIGA_AUTH_KEY`, `GIGA_AUTH_URL` and `GIGA_COMPLETION_URL`
are not read by the assistant. The legacy completion origin
`https://gigachat.devices.sberbank.ru/api/v1` is not selected: the approved
model was available through the current production API origin during the local
read-only model lookup on 2026-09-29.

The working `review-engine` integration stores GigaChat OAuth metadata on its
model record rather than in dedicated environment variables. For a one-process
probe, map the resolved secret and metadata explicitly as follows:

| `review-engine` source | Probe variable |
| --- | --- |
| resolved model secret | `GIGACHAT_API_KEY` |
| `x-gigachat-client-id` | `GIGACHAT_CLIENT_ID` |
| `x-gigachat-scope` | `GIGACHAT_SCOPE` |
| IFT or PROD endpoint selected in Review UI | `GIGACHAT_ENVIRONMENT` |

Do not copy these values into a file. Generic `LLM_PRIMARY_URL`, `LLM_API_KEY`
and `LLM_MODEL` names are not consumed automatically because they can describe
a proxy or another provider. Map them only after verifying that their concrete
contract is the direct GigaChat OAuth/function endpoint expected by this probe.

## CA trust

TLS verification is mandatory. Install the required Russian Trusted root in
the runtime system trust store, following the working `review-engine` image
pattern, or provide a reviewed bundle through `GIGACHAT_CA_BUNDLE_FILE`.
The probe builds an `ssl.create_default_context()` context and optionally adds
that bundle. `verify_ssl_certs=False`, insecure HTTP and a missing bundle file
are hard failures.

## Running the probe

Run only against a non-production account and environment. Load secrets through
the normal secret mechanism, set the opt-in flag for this single process, then
execute:

```bash
cd portal.ru/apps/giga
RUN_GIGACHAT_CONTRACT_PROBE=1 uv run pytest \
  tests/test_gigachat_contract_probe.py -q
```

The probe checks, in order:

1. configuration completeness, approved request model, HTTPS and TLS policy;
2. model availability through `GET /models`;
3. OAuth without displaying the token;
4. all seven fixed tool schemas through `/functions/validate` with zero warnings;
5. exact returned model identity and native function-call response shape.

Any failure output contains only the step name, exception class or a fixed
redacted reason. It does not include credentials, tokens, endpoints, request or
response bodies. The normal test suite leaves the live test skipped.

Record only: UTC date, named non-production environment, request model, exact
returned model identity, pass/fail for model lookup, CA, validation and native
function shape, plus the validation warning count (zero for a passing probe).
Do not record headers, tokens, credential presence details, endpoint values,
prompts or raw payloads.

## Current local evidence

Checked on 2026-09-21:

- the offline probe checks pass;
- the opt-in live probe passed against `GIGACHAT_ENVIRONMENT=ift` using split
  OAuth credentials without printing either value or the minted access token;
- TLS 1.3 verification passed with a local two-certificate IFT chain stored
  outside the repository; verification was never disabled;
- `GET /models` contained `GigaChat-3-Pro`, the exact completion identity was
  `GigaChat-3-Pro:32.4.30.3`, and native function calling passed;
- all seven fixed tool schemas returned `Function is valid` with zero warnings.

Checked locally on 2026-09-29 with the configured `prod` credentials, without
printing secrets or model text: the official OAuth endpoint returned a token,
the current production API listed `GigaChat-3-Pro`, and the deployed adapter
returned a `compare_printers` function call followed by a successful terminal
turn. This verifies the local provider path; the dev worker-to-API route still
requires a deployed run to verify it.

## Activation gate

Task 1.3 is complete for an environment only after a successful probe using
that environment's secret and CA delivery path. Documentation and offline tests
are sufficient for local provider-adapter development with fakes, but they do
not prove live readiness. Missing credentials, an unavailable model, schema
errors, identity drift or a certificate failure keep provider activation off.
