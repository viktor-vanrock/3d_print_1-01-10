-- migrate:up

-- The two 20260924090000 migrations share a dbmate version. On installations
-- where the admin migration won, restore the schema required by password auth.
ALTER TABLE public.email_otp
  ADD COLUMN IF NOT EXISTS block_until timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birth_year integer;

UPDATE public.users SET display_name = '' WHERE display_name IS NULL;
ALTER TABLE public.users
  ALTER COLUMN display_name SET DEFAULT '',
  ALTER COLUMN display_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.auth_pending_registrations (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down

-- These objects may have been created by the original auth migration. Their
-- provenance cannot be inferred from the current schema, so keep user data.
DO $$ BEGIN
  RAISE EXCEPTION 'refusing rollback: reconciled auth schema may predate this migration';
END $$;
