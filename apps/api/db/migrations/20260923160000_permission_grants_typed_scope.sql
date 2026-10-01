-- migrate:up

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.permission_grants
    WHERE scope NOT IN ('{}'::jsonb, '{"kind":"global"}'::jsonb)
  ) THEN
    RAISE EXCEPTION 'permission_grants contains unsupported legacy scopes';
  END IF;
END
$$;

WITH ranked_active_grants AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        user_id,
        permission,
        CASE
          WHEN scope = '{}'::jsonb THEN '{"kind":"global"}'::jsonb
          ELSE scope
        END
      ORDER BY granted_at, id
    ) AS duplicate_position
  FROM public.permission_grants
  WHERE revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
), reconciled_grants AS (
  UPDATE public.permission_grants AS permission_grant
  SET
    revoked_at = now(),
    revoked_by = permission_grant.granted_by,
    revoke_reason = 'automatic duplicate grant reconciliation'
  FROM ranked_active_grants
  WHERE permission_grant.id = ranked_active_grants.id
    AND ranked_active_grants.duplicate_position > 1
  RETURNING
    permission_grant.id,
    permission_grant.user_id,
    permission_grant.permission,
    permission_grant.granted_by
)
INSERT INTO public.audit_log(actor_user_id, action, target_type, target_id, details, created_at)
SELECT
  granted_by,
  'permission.revoked',
  'permission_grant',
  id,
  jsonb_build_object(
    'user_id', user_id,
    'permission', permission,
    'reason', 'automatic duplicate grant reconciliation',
    'initiated_by', 'migration'
  ),
  now()
FROM reconciled_grants;

UPDATE public.permission_grants
SET scope = '{"kind":"global"}'::jsonb
WHERE scope = '{}'::jsonb;

ALTER TABLE public.permission_grants
  ALTER COLUMN scope SET DEFAULT '{"kind":"global"}'::jsonb;

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_scope_object_check;

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_scope_shape_check CHECK (
    jsonb_typeof(scope) = 'object'
    AND COALESCE(
      scope = '{"kind":"global"}'::jsonb
      OR (
        (
          (
            scope ?& ARRAY['kind', 'communityId']
            AND scope - ARRAY['kind', 'communityId'] = '{}'::jsonb
            AND
            scope->>'kind' = 'community'
            AND jsonb_typeof(scope->'communityId') = 'string'
            AND btrim(scope->>'communityId') <> ''
          )
          OR (
            scope ?& ARRAY['kind', 'vendorId']
            AND scope - ARRAY['kind', 'vendorId'] = '{}'::jsonb
            AND
            scope->>'kind' = 'vendor'
            AND jsonb_typeof(scope->'vendorId') = 'string'
            AND btrim(scope->>'vendorId') <> ''
          )
          OR (
            scope ?& ARRAY['kind', 'catalog']
            AND scope - ARRAY['kind', 'catalog'] = '{}'::jsonb
            AND
            scope->>'kind' = 'catalog'
            AND scope->>'catalog' IN ('materials', 'printers')
          )
          OR (
            scope ?& ARRAY['kind', 'userId']
            AND scope - ARRAY['kind', 'userId'] = '{}'::jsonb
            AND
            scope->>'kind' = 'user'
            AND jsonb_typeof(scope->'userId') = 'string'
            AND btrim(scope->>'userId') <> ''
          )
        )
      ),
      false
    )
  );

-- migrate:down

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.permission_grants
    WHERE scope <> '{"kind":"global"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'cannot roll back typed permission scopes while resource-scoped grants exist';
  END IF;
END
$$;

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_scope_shape_check;

UPDATE public.permission_grants
SET scope = '{}'::jsonb
WHERE scope = '{"kind":"global"}'::jsonb;

ALTER TABLE public.permission_grants
  ALTER COLUMN scope SET DEFAULT '{}'::jsonb;

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_scope_object_check CHECK (jsonb_typeof(scope) = 'object');
