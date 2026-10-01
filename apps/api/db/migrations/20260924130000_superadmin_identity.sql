-- migrate:up

CREATE TABLE public.platform_superadmin_identity (
  identity_key text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE RESTRICT,
  binding_mode text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_superadmin_identity_singleton_check CHECK (identity_key = 'superadmin'),
  CONSTRAINT platform_superadmin_identity_binding_mode_check CHECK (binding_mode IN ('new_installation', 'existing_installation'))
);

CREATE VIEW public.superadmin_identity_read_v1 AS
SELECT user_id FROM public.platform_superadmin_identity WHERE identity_key = 'superadmin';

-- migrate:down

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.platform_superadmin_identity) THEN
    RAISE EXCEPTION 'cannot roll back superadmin identity while a binding exists';
  END IF;
END
$$;

DROP VIEW public.superadmin_identity_read_v1;
DROP TABLE public.platform_superadmin_identity;
