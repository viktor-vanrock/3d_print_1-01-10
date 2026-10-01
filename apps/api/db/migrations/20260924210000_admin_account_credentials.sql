-- migrate:up

ALTER TABLE public.users
  ADD COLUMN administrative_state text NOT NULL DEFAULT 'active',
  ADD COLUMN administrative_state_changed_at timestamptz,
  ADD COLUMN administrative_state_changed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN administrative_state_reason text,
  ADD CONSTRAINT users_administrative_state_check CHECK (administrative_state IN ('active','suspended','blocked')),
  ADD CONSTRAINT users_administrative_state_details_check CHECK (
    (administrative_state='active') OR
    (administrative_state<>'active' AND administrative_state_changed_at IS NOT NULL AND administrative_state_changed_by IS NOT NULL AND btrim(administrative_state_reason) <> '')
  );

CREATE TABLE public.browser_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  revoke_reason text,
  CONSTRAINT browser_sessions_expiry_check CHECK (expires_at>created_at),
  CONSTRAINT browser_sessions_revocation_check CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND btrim(revoke_reason)<>''))
);
CREATE INDEX browser_sessions_user_created_idx ON public.browser_sessions(user_id,created_at DESC,id DESC);

-- Existing JWTs have no jti and intentionally require sign-in again at rollout.
UPDATE public.users SET session_version=session_version+1,updated_at=now() WHERE status<>'deleted';

ALTER TABLE public.permission_change_confirmations DROP CONSTRAINT permission_change_confirmations_action_check;
ALTER TABLE public.permission_change_confirmations ADD CONSTRAINT permission_change_confirmations_action_check CHECK (action IN (
  'assign_admin','remove_admin_assignment','revoke_all_admin_access','grant_permission','revoke_permission',
  'suspend_account','block_account','restore_account','delete_account','export_account',
  'revoke_session','revoke_api_key','rotate_api_key','revoke_device','rotate_device_credential'
));

ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access','admin.view_permission_catalog',
  'user.view_any','user.lookup_identity','user.view_permissions','user.view_identities','user.view_credentials','user.view_sessions','user.manage_sessions',
  'user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key',
  'user.edit_any','user.deactivate','user.grant_permission','user.revoke_permission','user.assign_admin','user.remove_admin_assignment','user.revoke_all_admin_access',
  'moderation.delete_content','moderation.ban_user','moderation.view_reports','moderation.resolve_report','moderation.manage_sanctions','moderation.view_sanctions','moderation.resolve_appeal','moderation.manage_community_members',
  'analytics.view_platform','analytics.export','analytics.view_health','billing.manage_payouts','audit.view_log',
  'catalog.publish_any','catalog.unpublish_any','catalog.edit_any','catalog.feature','catalog.review_candidates','catalog.review_vendor_claims','catalog.review_printer_reports','feed.manage_news',
  'research.access','research.manage','research.manage_printers',
  'support.view_tickets','support.manage_devices','support.revoke_device','support.rotate_device_credentials','support.view_device_incidents','support.resolve_device_incidents'
));

-- migrate:down
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.browser_sessions) OR EXISTS (SELECT 1 FROM public.permission_change_confirmations WHERE action IN (
    'suspend_account','block_account','restore_account','delete_account','export_account','revoke_session','revoke_api_key','rotate_api_key','revoke_device','rotate_device_credential'
  )) OR EXISTS (SELECT 1 FROM public.permission_grants WHERE permission IN (
    'user.view_sessions','user.manage_sessions','user.suspend','user.block','user.restore','user.delete','user.export','user.revoke_api_key','user.rotate_api_key','support.revoke_device','support.rotate_device_credentials'
  )) THEN RAISE EXCEPTION 'refusing rollback: Step 6 state exists; use compatible schema and globally invalidate sessions before old verifier'; END IF;
END $$;

ALTER TABLE public.permission_change_confirmations DROP CONSTRAINT permission_change_confirmations_action_check;
ALTER TABLE public.permission_change_confirmations ADD CONSTRAINT permission_change_confirmations_action_check CHECK (action IN ('assign_admin','remove_admin_assignment','revoke_all_admin_access','grant_permission','revoke_permission'));
ALTER TABLE public.permission_grants DROP CONSTRAINT permission_grants_permission_check;
ALTER TABLE public.permission_grants ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
  'admin.portal.access', 'admin.view_permission_catalog',
  'user.view_any', 'user.lookup_identity', 'user.view_permissions', 'user.view_identities', 'user.view_credentials',
  'user.edit_any', 'user.deactivate', 'user.grant_permission', 'user.revoke_permission', 'user.assign_admin',
  'user.remove_admin_assignment', 'user.revoke_all_admin_access',
  'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
  'moderation.manage_sanctions', 'moderation.view_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
  'analytics.view_platform', 'analytics.export', 'analytics.view_health',
  'billing.manage_payouts', 'audit.view_log',
  'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
  'catalog.review_vendor_claims', 'catalog.review_printer_reports', 'feed.manage_news',
  'research.access', 'research.manage', 'research.manage_printers',
  'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
));
DROP TABLE public.browser_sessions;
ALTER TABLE public.users DROP CONSTRAINT users_administrative_state_details_check, DROP CONSTRAINT users_administrative_state_check,
  DROP COLUMN administrative_state_reason, DROP COLUMN administrative_state_changed_by, DROP COLUMN administrative_state_changed_at, DROP COLUMN administrative_state;
