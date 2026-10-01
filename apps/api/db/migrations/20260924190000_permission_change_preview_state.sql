-- migrate:up

ALTER TABLE public.permission_change_confirmations
  ADD COLUMN state_hash text,
  ADD COLUMN effects jsonb;

ALTER TABLE public.permission_change_confirmations
  ADD CONSTRAINT permission_change_confirmations_preview_state_check CHECK (
    (state_hash IS NULL AND effects IS NULL)
    OR
    (state_hash ~ '^[0-9a-f]{64}$' AND jsonb_typeof(effects) = 'object')
  );

-- Existing intents deliberately remain without preview state. The new application
-- rejects them fail-closed; no secret, reason or request payload is backfilled.

-- migrate:down

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.permission_change_confirmations
    WHERE state_hash IS NOT NULL OR effects IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'refusing rollback: state-bound permission intents exist; preserve confirmation and audit history';
  END IF;
END
$$;

ALTER TABLE public.permission_change_confirmations
  DROP CONSTRAINT permission_change_confirmations_preview_state_check,
  DROP COLUMN effects,
  DROP COLUMN state_hash;
