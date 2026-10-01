-- migrate:up

-- Step 6 device administration was deferred after the preceding migration had
-- reached some environments. Preserve legacy DB values as compatibility
-- tombstones so revoked grants and audit references remain readable, but refuse
-- rollout while any effective authority or executable intent still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_grants
     WHERE permission IN ('support.revoke_device','support.rotate_device_credentials')
       AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'active deferred device-admin grants exist; revoke them with audit before applying this migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.permission_change_confirmations
     WHERE action IN ('revoke_device','rotate_device_credential')
       AND consumed_at IS NULL AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'active deferred device-admin confirmation intents exist; expire or consume them before applying this migration';
  END IF;
END
$$;

ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (
  permission IN (
    'admin.portal.access','admin.view_permission_catalog','user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
    'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members','analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log','catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news','research.access','research.manage','research.manage_printers','support.view_tickets','support.manage_devices','support.view_device_incidents','support.resolve_device_incidents'
  )
  OR (
    permission IN ('support.revoke_device','support.rotate_device_credentials')
    AND revoked_at IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION public.reject_deferred_device_permission_grant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.permission IN ('support.revoke_device','support.rotate_device_credentials') THEN
    RAISE EXCEPTION 'deferred device-admin permissions cannot be granted';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS permission_grants_reject_deferred_device_permission ON public.permission_grants;
CREATE TRIGGER permission_grants_reject_deferred_device_permission
  BEFORE INSERT OR UPDATE OF permission ON public.permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.reject_deferred_device_permission_grant();

-- migrate:down

-- Compatibility-only migration. The fail-closed tombstone guard is intentionally
-- retained because runtime support cannot be restored by SQL.
SELECT 1;
