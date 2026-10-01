-- migrate:up

ALTER TABLE public.permission_change_confirmations DROP CONSTRAINT permission_change_confirmations_action_check;
ALTER TABLE public.permission_change_confirmations ADD CONSTRAINT permission_change_confirmations_action_check CHECK (action IN (
  'assign_admin','remove_admin_assignment','revoke_all_admin_access','grant_permission','revoke_permission','configure_access',
  'suspend_account','block_account','restore_account','delete_account','export_account',
  'revoke_session','revoke_api_key','rotate_api_key','revoke_device','rotate_device_credential'
));

-- migrate:down

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_change_confirmations
     WHERE action='configure_access' AND consumed_at IS NULL AND expires_at>now()
  ) THEN
    RAISE EXCEPTION 'refusing rollback: active configure_access confirmation intents exist';
  END IF;
END
$$;

ALTER TABLE public.permission_change_confirmations DROP CONSTRAINT permission_change_confirmations_action_check;
ALTER TABLE public.permission_change_confirmations ADD CONSTRAINT permission_change_confirmations_action_check CHECK (action IN (
  'assign_admin','remove_admin_assignment','revoke_all_admin_access','grant_permission','revoke_permission',
  'suspend_account','block_account','restore_account','delete_account','export_account',
  'revoke_session','revoke_api_key','rotate_api_key','revoke_device','rotate_device_credential'
));
