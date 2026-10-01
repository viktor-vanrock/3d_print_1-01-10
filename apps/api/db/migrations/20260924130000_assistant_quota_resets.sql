-- migrate:up

CREATE TABLE public.assistant_quota_resets (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    reset_at timestamp with time zone NOT NULL
);

-- migrate:down

DROP TABLE public.assistant_quota_resets;
