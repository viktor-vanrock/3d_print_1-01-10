-- migrate:up
CREATE INDEX IF NOT EXISTS audit_log_created_id_idx ON public.audit_log (created_at DESC, id DESC);

-- migrate:down
DROP INDEX IF EXISTS public.audit_log_created_id_idx;
