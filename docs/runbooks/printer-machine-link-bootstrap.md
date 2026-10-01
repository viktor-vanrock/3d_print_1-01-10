# Confirmed printer-machine link bootstrap

This operator script records one explicitly reviewed `printers.id` to `machines.id` relation. It performs no name matching and accepts no candidate state. Run it first with the default dry-run behavior:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v printer_id=11111111-1111-4111-8111-111111111111 \
  -v machine_id=22222222-2222-4222-8222-222222222222 \
  -v source=manual-catalog-review \
  -v source_url=https://catalog.example/review/123 \
  -v reviewed_by=catalog-team \
  -v reviewed_at=2026-09-21T10:00:00Z \
  -f docs/runbooks/printer-machine-link-bootstrap.sql
```

The validation rejects a printer that is absent or not public under the existing `sources` rule, an absent or inactive machine, empty review metadata, and an existing link whose machine or review metadata differs. An exactly identical rerun reports `already_identical`. Dry-run executes the same validation and insert path and then rolls the transaction back.

After reviewing the dry-run output, an authorized operator can repeat the exact command with `-v apply=true`. One invocation handles exactly one pair, so the input is bounded and reviewable. Applying this SQL to shared data is a separately authorized operation; repository tests do not execute it against dev or production databases.
