-- Retire the Administration identity-metadata capability after its UI and product scenario were removed.
-- Historical grants and audit events remain available as immutable evidence.
-- migrate:up

UPDATE public.permission_grants
SET revoked_at = COALESCE(revoked_at, now()),
    revoked_by = '00000000-0000-0000-0000-000000000001'::uuid,
    revoke_reason = COALESCE(revoke_reason, 'Permission retired from Administration')
WHERE revoked_at IS NULL
  AND permission = 'user.view_identities';

UPDATE public.permission_change_confirmations
SET consumed_at = COALESCE(consumed_at, now())
WHERE consumed_at IS NULL
  AND payload->>'permission' = 'user.view_identities';

-- migrate:down
-- Data retirement is intentionally irreversible: revoked grants and consumed confirmations
-- must not be reactivated by a schema rollback.
