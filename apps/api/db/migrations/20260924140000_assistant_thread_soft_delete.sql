-- migrate:up

ALTER TABLE public.assistant_threads
  ADD COLUMN deleted_at timestamp with time zone;

DROP INDEX public.assistant_threads_owner_idx;

CREATE INDEX assistant_threads_owner_idx
  ON public.assistant_threads (owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- migrate:down

DROP INDEX public.assistant_threads_owner_idx;

CREATE INDEX assistant_threads_owner_idx
  ON public.assistant_threads (owner_id, created_at DESC);

ALTER TABLE public.assistant_threads
  DROP COLUMN deleted_at;
