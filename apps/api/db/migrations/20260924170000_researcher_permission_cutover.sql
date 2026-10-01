-- migrate:up

WITH inserted AS (
  INSERT INTO public.permission_grants(user_id,permission,scope,granted_by,reason,expires_at)
  SELECT u.id,'research.manage_printers','{"kind":"global"}'::jsonb,u.id,
         'legacy researcher permission cutover',NULL
    FROM public.users u
   WHERE u.role='researcher'
     AND u.status<>'deleted'
     AND NOT EXISTS (
       SELECT 1 FROM public.permission_grants g
        WHERE g.user_id=u.id
          AND g.permission='research.manage_printers'
          AND g.scope='{"kind":"global"}'::jsonb
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at>now())
     )
  RETURNING id,user_id,permission,reason
)
INSERT INTO public.audit_log(actor_user_id,action,target_type,target_id,details)
SELECT user_id,'permission.granted','permission_grant',id,
       jsonb_build_object('user_id',user_id,'permission',permission,'reason',reason,'source','legacy_researcher_cutover')
  FROM inserted;

-- migrate:down

WITH revoked AS (
  UPDATE public.permission_grants
     SET revoked_at=now(),revoked_by=user_id,revoke_reason='rollback legacy researcher permission cutover'
   WHERE reason='legacy researcher permission cutover'
     AND permission='research.manage_printers'
     AND scope='{"kind":"global"}'::jsonb
     AND revoked_at IS NULL
  RETURNING id,user_id,permission
)
INSERT INTO public.audit_log(actor_user_id,action,target_type,target_id,details)
SELECT user_id,'permission.revoked','permission_grant',id,
       jsonb_build_object('user_id',user_id,'permission',permission,'reason','rollback legacy researcher permission cutover','source','legacy_researcher_cutover')
  FROM revoked;
