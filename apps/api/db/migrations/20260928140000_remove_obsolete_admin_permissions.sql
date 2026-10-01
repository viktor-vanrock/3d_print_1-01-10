-- Remove grants and pending confirmations for Administration capabilities that no longer exist.
-- Historical assignment snapshots remain untouched as immutable audit evidence.
-- migrate:up
update permission_grants
   set revoked_at = coalesce(revoked_at, now()),
       revoked_by = '00000000-0000-0000-0000-000000000001'::uuid,
       revoke_reason = coalesce(revoke_reason, 'Permission retired from Administration')
 where revoked_at is null
   and permission in (
     'user.lookup_identity',
     'user.view_credentials',
     'user.revoke_api_key',
     'user.rotate_api_key',
     'analytics.view_platform',
     'analytics.export',
     'analytics.view_health'
   );

update permission_change_confirmations
   set consumed_at = coalesce(consumed_at, now())
 where consumed_at is null
   and (
     action in ('revoke_api_key', 'rotate_api_key')
     or payload->>'permission' in (
       'user.lookup_identity',
       'user.view_credentials',
       'user.revoke_api_key',
       'user.rotate_api_key',
       'analytics.view_platform',
       'analytics.export',
       'analytics.view_health'
     )
   );

-- migrate:down
-- Data retirement is intentionally irreversible: revoked grants and consumed confirmations
-- must not be reactivated by a schema rollback.
