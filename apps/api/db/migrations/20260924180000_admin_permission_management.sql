-- migrate:up

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_permission_check;

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
    'admin.portal.access', 'admin.view_permission_catalog',
    'user.view_any', 'user.lookup_identity', 'user.edit_any', 'user.deactivate',
    'user.grant_permission', 'user.revoke_permission', 'user.assign_admin',
    'user.remove_admin_assignment', 'user.revoke_all_admin_access',
    'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
    'moderation.manage_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
    'analytics.view_platform', 'analytics.export', 'analytics.view_health',
    'billing.manage_payouts', 'audit.view_log',
    'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
    'catalog.review_vendor_claims', 'catalog.review_printer_reports', 'feed.manage_news',
    'research.access', 'research.manage', 'research.manage_printers',
    'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
  ));

CREATE VIEW public.authorization_identity_read_v1 AS
  SELECT id AS user_id, status, session_version
  FROM public.users
  WHERE id <> '00000000-0000-0000-0000-000000000001'::uuid;

CREATE TABLE public.admin_permission_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  preset_key text NOT NULL,
  preset_version integer NOT NULL CHECK (preset_version > 0),
  preset_snapshot jsonb NOT NULL CHECK (jsonb_typeof(preset_snapshot) = 'array'),
  assigned_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  remove_reason text,
  CONSTRAINT admin_permission_assignments_removal_fields_check CHECK (
    (removed_at IS NULL AND removed_by IS NULL AND remove_reason IS NULL)
    OR
    (removed_at IS NOT NULL AND removed_by IS NOT NULL AND btrim(remove_reason) <> '')
  )
);

CREATE UNIQUE INDEX admin_permission_assignments_active_key
  ON public.admin_permission_assignments(user_id, preset_key)
  WHERE removed_at IS NULL;

CREATE TABLE public.admin_permission_assignment_items (
  assignment_id uuid NOT NULL REFERENCES public.admin_permission_assignments(id) ON DELETE RESTRICT,
  permission text NOT NULL,
  coverage_kind text NOT NULL CHECK (coverage_kind IN ('assignment_grant', 'direct_existing')),
  grant_id uuid NOT NULL REFERENCES public.permission_grants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, permission)
);

CREATE INDEX admin_permission_assignment_items_grant_idx
  ON public.admin_permission_assignment_items(grant_id);

CREATE TABLE public.permission_change_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  session_fingerprint text NOT NULL CHECK (session_fingerprint ~ '^[0-9a-f]{64}$'),
  session_version integer NOT NULL CHECK (session_version >= 0),
  action text NOT NULL CHECK (action IN ('assign_admin', 'remove_admin_assignment', 'revoke_all_admin_access', 'grant_permission', 'revoke_permission')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT permission_change_confirmations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT permission_change_confirmations_consumed_check CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX permission_change_confirmations_actor_idx
  ON public.permission_change_confirmations(actor_user_id, expires_at)
  WHERE consumed_at IS NULL;

-- migrate:down

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permission_grants WHERE permission IN (
    'user.assign_admin', 'user.remove_admin_assignment', 'user.revoke_all_admin_access'
  )) THEN
    RAISE EXCEPTION 'refusing rollback: Step 4 management grants exist; preserve grants and audit history';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_permission_assignments)
    OR EXISTS (SELECT 1 FROM public.permission_change_confirmations) THEN
    RAISE EXCEPTION 'refusing rollback: Step 4 provenance or confirmations exist';
  END IF;
END
$$;

DROP TABLE public.permission_change_confirmations;
DROP TABLE public.admin_permission_assignment_items;
DROP TABLE public.admin_permission_assignments;
DROP VIEW public.authorization_identity_read_v1;

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_permission_check;

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
    'admin.portal.access', 'admin.view_permission_catalog',
    'user.view_any', 'user.lookup_identity', 'user.edit_any', 'user.deactivate', 'user.grant_permission', 'user.revoke_permission',
    'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
    'moderation.manage_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
    'analytics.view_platform', 'analytics.export', 'analytics.view_health',
    'billing.manage_payouts', 'audit.view_log',
    'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
    'catalog.review_vendor_claims', 'catalog.review_printer_reports', 'feed.manage_news',
    'research.access', 'research.manage', 'research.manage_printers',
    'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
  ));
