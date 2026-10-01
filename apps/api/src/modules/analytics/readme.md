# Analytics module

Nest migration of `POST /consent`. The module owns all writes to
`consent_records` and `events`; other domains emit events through `ANALYTICS_PORT`. Analytics failures remain
non-blocking for product operations, while consent checks remain fail-closed.

The former aggregate product-health endpoint and its Administration permissions were retired.
Internal consent-gated event collection remains available to product domains.
