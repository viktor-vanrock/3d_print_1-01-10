-- migrate:up
ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access','admin.view_permission_catalog','user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
  'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members','analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log','audit.export','catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news','research.access','research.manage','research.manage_printers','support.view_tickets','support.manage_devices','support.view_device_incidents','support.resolve_device_incidents'
) OR (permission IN ('support.revoke_device','support.rotate_device_credentials') AND revoked_at IS NOT NULL));
CREATE TABLE public.admin_audit_exports (
  id uuid PRIMARY KEY, actor_user_id uuid NOT NULL REFERENCES public.users(id), payload bytea NOT NULL,
  payload_sha256 bytea NOT NULL CHECK (octet_length(payload_sha256)=32), event_count integer NOT NULL CHECK(event_count>=0 AND event_count<=10000),
  byte_size integer NOT NULL CHECK(byte_size>=0 AND byte_size<=5242880), truncated boolean NOT NULL,
  range_from timestamptz NOT NULL, range_to timestamptz NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  CHECK (range_to>=range_from AND range_to-range_from<=interval '31 days'), CHECK(expires_at>created_at), CHECK(octet_length(payload)=byte_size)
);
CREATE INDEX admin_audit_exports_actor_expiry_idx ON public.admin_audit_exports(actor_user_id,expires_at);
CREATE INDEX admin_audit_exports_expiry_idx ON public.admin_audit_exports(expires_at,id);
-- migrate:down
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.permission_grants WHERE permission='audit.export') THEN RAISE EXCEPTION 'cannot rollback audit.export while grants exist'; END IF; END $$;
DROP TABLE public.admin_audit_exports;
ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access','admin.view_permission_catalog','user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
  'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members','analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log','catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news','research.access','research.manage','research.manage_printers','support.view_tickets','support.manage_devices','support.view_device_incidents','support.resolve_device_incidents'
) OR (permission IN ('support.revoke_device','support.rotate_device_credentials') AND revoked_at IS NOT NULL));
