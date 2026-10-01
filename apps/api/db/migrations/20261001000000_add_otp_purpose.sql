-- migrate:up
ALTER TABLE public.email_otp
  ADD COLUMN purpose text NOT NULL DEFAULT 'login';

CREATE INDEX email_otp_email_purpose_idx
  ON public.email_otp(email_hash, purpose);

-- migrate:down
DROP INDEX IF EXISTS email_otp_email_purpose_idx;
ALTER TABLE public.email_otp DROP COLUMN IF EXISTS purpose;
