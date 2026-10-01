-- migrate:up

ALTER TABLE public.feed_posts
  ADD COLUMN editorial_origin text,
  ADD CONSTRAINT feed_posts_editorial_origin_check
    CHECK (editorial_origin IN ('forge_import','scout_pipeline','manual_admin'));

UPDATE public.feed_posts
SET editorial_origin='forge_import'
WHERE editorial_origin IS NULL AND type='text'
  AND ingest_provider = 'forge-snapshot'
  AND ingest_prompt_version='forge-catalog-2026-09-04'
  AND source_url IS NOT NULL
  AND source_fingerprint ~ '^sha256:[0-9a-f]{64}$';

UPDATE public.feed_posts post
SET editorial_origin='manual_admin'
WHERE post.editorial_origin IS NULL AND post.type='text'
  AND EXISTS (
    SELECT 1 FROM public.audit_log audit
    WHERE audit.action = 'news.created'
      AND audit.target_type = 'feed_post'
      AND audit.target_id = post.id
  );

CREATE INDEX feed_posts_editorial_updated_idx
  ON public.feed_posts(editorial_origin,updated_at DESC,id DESC)
  WHERE editorial_origin IS NOT NULL;

ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access','admin.view_permission_catalog','user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
  'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members','analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log','audit.export','catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news','feed.news_editor','research.access','research.manage','research.manage_printers','support.view_tickets','support.manage_devices','support.view_device_incidents','support.resolve_device_incidents'
) OR (permission IN ('support.revoke_device','support.rotate_device_credentials') AND revoked_at IS NOT NULL));

DO $$
DECLARE
  system_actor_id constant uuid := '00000000-0000-0000-0000-000000000001';
  assignment record;
  companion_id uuid;
BEGIN
  FOR assignment IN
    SELECT item_owner.id,item_owner.user_id,item_owner.assigned_by
    FROM public.admin_permission_assignments item_owner
    WHERE item_owner.removed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.permission_grants grant_row
        WHERE grant_row.user_id=item_owner.user_id
          AND grant_row.permission='feed.manage_news'
          AND grant_row.scope='{"kind":"global"}'::jsonb
          AND grant_row.revoked_at IS NULL
          AND (grant_row.expires_at IS NULL OR grant_row.expires_at>now())
      )
  LOOP
    INSERT INTO public.permission_grants(user_id,permission,scope,granted_by,reason)
    VALUES(assignment.user_id,'feed.news_editor','{"kind":"global"}'::jsonb,system_actor_id,'Step 7 system-managed News editor companion')
    RETURNING id INTO companion_id;
    INSERT INTO public.admin_permission_assignment_items(assignment_id,permission,coverage_kind,grant_id)
    VALUES(assignment.id,'feed.news_editor','assignment_grant',companion_id);
    INSERT INTO public.audit_log(actor_user_id,action,target_type,target_id,details)
    VALUES(
      system_actor_id,
      'permission.granted',
      'permission_grant',
      companion_id,
      jsonb_build_object(
        'permission','feed.news_editor',
        'source','news_editorial_cutover',
        'assignment_id',assignment.id,
        'historical_assigned_by',assignment.assigned_by
      )
    );
  END LOOP;
END
$$;

-- migrate:down

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.feed_posts WHERE editorial_origin IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.permission_grants WHERE permission='feed.news_editor') THEN
    RAISE EXCEPTION 'refusing rollback: Step 7 News provenance or companion grants exist';
  END IF;
END
$$;
DROP INDEX public.feed_posts_editorial_updated_idx;
ALTER TABLE public.feed_posts DROP CONSTRAINT feed_posts_editorial_origin_check, DROP COLUMN editorial_origin;
ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access','admin.view_permission_catalog','user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
  'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members','analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log','audit.export','catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news','research.access','research.manage','research.manage_printers','support.view_tickets','support.manage_devices','support.view_device_incidents','support.resolve_device_incidents'
) OR (permission IN ('support.revoke_device','support.rotate_device_credentials') AND revoked_at IS NOT NULL));
