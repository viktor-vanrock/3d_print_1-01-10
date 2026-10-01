-- migrate:up

ALTER TABLE feed_posts ADD COLUMN published_at timestamptz;

CREATE INDEX feed_posts_assistant_published_idx
  ON feed_posts (published_at DESC, id DESC)
  WHERE status = 'visible' AND published_at IS NOT NULL;

-- migrate:down

DROP INDEX feed_posts_assistant_published_idx;
ALTER TABLE feed_posts DROP COLUMN published_at;
