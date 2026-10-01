-- migrate:up

CREATE INDEX assistant_runs_user_active_idx
  ON public.assistant_runs (user_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX assistant_threads_chat_owner_recent_idx
  ON public.assistant_threads (owner_id, created_at DESC)
  WHERE kind = 'chat';

CREATE INDEX feed_posts_assistant_title_trgm_idx
  ON public.feed_posts USING gin (title gin_trgm_ops)
  WHERE status = 'visible' AND published_at IS NOT NULL;

CREATE INDEX feed_posts_assistant_body_trgm_idx
  ON public.feed_posts USING gin (body gin_trgm_ops)
  WHERE status = 'visible' AND published_at IS NOT NULL;

CREATE INDEX materials_assistant_filament_name_idx
  ON public.materials (name COLLATE "C", id)
  WHERE kind = 'filament' AND status = 'published';

CREATE INDEX printers_assistant_slug_lower_idx
  ON public.printers (lower(slug))
  WHERE cardinality(sources) > 0;

CREATE INDEX project_revisions_assistant_title_trgm_idx
  ON public.project_revisions USING gin ((metadata_snapshot ->> 'title') gin_trgm_ops);

CREATE INDEX project_revisions_assistant_description_trgm_idx
  ON public.project_revisions USING gin ((metadata_snapshot ->> 'description') gin_trgm_ops);

-- migrate:down

DROP INDEX public.project_revisions_assistant_description_trgm_idx;
DROP INDEX public.project_revisions_assistant_title_trgm_idx;
DROP INDEX public.printers_assistant_slug_lower_idx;
DROP INDEX public.materials_assistant_filament_name_idx;
DROP INDEX public.feed_posts_assistant_body_trgm_idx;
DROP INDEX public.feed_posts_assistant_title_trgm_idx;
DROP INDEX public.assistant_threads_chat_owner_recent_idx;
DROP INDEX public.assistant_runs_user_active_idx;
