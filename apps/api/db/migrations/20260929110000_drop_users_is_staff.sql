-- The permission-grant cutover is complete. The legacy staff flag is no longer an authority source.
-- migrate:up

ALTER TABLE public.users
  DROP COLUMN is_staff;

-- migrate:down

ALTER TABLE public.users
  ADD COLUMN is_staff boolean NOT NULL DEFAULT false;
