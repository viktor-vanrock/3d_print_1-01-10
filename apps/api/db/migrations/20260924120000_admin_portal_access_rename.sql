-- migrate:up

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_permission_check;

UPDATE public.permission_grants
SET permission = 'admin.portal.access'
WHERE permission = 'admin.access';

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
    'admin.portal.access', 'admin.view_permission_catalog',
    'user.view_any', 'user.edit_any', 'user.deactivate', 'user.grant_permission', 'user.revoke_permission',
    'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
    'moderation.manage_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
    'analytics.view_platform', 'analytics.export', 'analytics.view_health',
    'billing.manage_payouts', 'audit.view_log',
    'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
    'catalog.review_vendor_claims', 'catalog.review_printer_reports', 'feed.manage_news',
    'research.access', 'research.manage', 'research.manage_printers',
    'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
  ));

-- migrate:down

ALTER TABLE public.permission_grants
  DROP CONSTRAINT permission_grants_permission_check;

UPDATE public.permission_grants
SET permission = 'admin.access'
WHERE permission = 'admin.portal.access';

ALTER TABLE public.permission_grants
  ADD CONSTRAINT permission_grants_permission_check CHECK (permission IN (
    'admin.access', 'admin.view_permission_catalog',
    'user.view_any', 'user.edit_any', 'user.deactivate', 'user.grant_permission', 'user.revoke_permission',
    'moderation.delete_content', 'moderation.ban_user', 'moderation.view_reports', 'moderation.resolve_report',
    'moderation.manage_sanctions', 'moderation.resolve_appeal', 'moderation.manage_community_members',
    'analytics.view_platform', 'analytics.export', 'analytics.view_health',
    'billing.manage_payouts', 'audit.view_log',
    'catalog.publish_any', 'catalog.unpublish_any', 'catalog.edit_any', 'catalog.feature', 'catalog.review_candidates',
    'catalog.review_vendor_claims', 'catalog.review_printer_reports', 'feed.manage_news',
    'research.access', 'research.manage', 'research.manage_printers',
    'support.view_tickets', 'support.manage_devices', 'support.view_device_incidents', 'support.resolve_device_incidents'
  ));
