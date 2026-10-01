-- migrate:up

CREATE FUNCTION notify_assistant_run_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('assistant_run_changed', NEW.id::text);
  RETURN NEW;
END;
$$;

CREATE FUNCTION notify_assistant_thread_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('assistant_thread_changed', NEW.thread_id::text);
  RETURN NEW;
END;
$$;

CREATE FUNCTION notify_assistant_queue_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('assistant_queue_changed', NEW.id::text);
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_notify('assistant_queue_changed', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION notify_generation_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('generation_changed', NEW.id::text);
  PERFORM pg_notify('concept_changed', concept.id::text)
    FROM generated_concepts concept
   WHERE concept.generation_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE FUNCTION notify_concept_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('concept_changed', NEW.id::text);
  RETURN NEW;
END;
$$;

CREATE FUNCTION notify_generation_queue_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('generation_queue_changed', NEW.id::text);
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM pg_notify('generation_queue_changed', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assistant_runs_status_notify
AFTER UPDATE OF status, result, error_code, error ON assistant_runs
FOR EACH ROW EXECUTE FUNCTION notify_assistant_run_changed();

CREATE TRIGGER assistant_runs_queue_notify
AFTER INSERT OR UPDATE OF status ON assistant_runs
FOR EACH ROW EXECUTE FUNCTION notify_assistant_queue_changed();

CREATE TRIGGER assistant_thread_events_notify
AFTER INSERT ON assistant_thread_events
FOR EACH ROW EXECUTE FUNCTION notify_assistant_thread_changed();

CREATE TRIGGER generations_status_notify
AFTER UPDATE OF status, phase, progress, eta_seconds, estimate_updated_at, artifact_url, preview_url, preview_shots, error ON generations
FOR EACH ROW EXECUTE FUNCTION notify_generation_changed();

CREATE TRIGGER generations_queue_notify
AFTER INSERT OR UPDATE OF status ON generations
FOR EACH ROW EXECUTE FUNCTION notify_generation_queue_changed();

CREATE TRIGGER generated_concepts_status_notify
AFTER INSERT OR UPDATE OF generation_id, status ON generated_concepts
FOR EACH ROW EXECUTE FUNCTION notify_concept_changed();

-- migrate:down

DROP TRIGGER generated_concepts_status_notify ON generated_concepts;
DROP TRIGGER generations_queue_notify ON generations;
DROP TRIGGER generations_status_notify ON generations;
DROP TRIGGER assistant_thread_events_notify ON assistant_thread_events;
DROP TRIGGER assistant_runs_queue_notify ON assistant_runs;
DROP TRIGGER assistant_runs_status_notify ON assistant_runs;
DROP FUNCTION notify_generation_queue_changed();
DROP FUNCTION notify_generation_changed();
DROP FUNCTION notify_concept_changed();
DROP FUNCTION notify_assistant_queue_changed();
DROP FUNCTION notify_assistant_thread_changed();
DROP FUNCTION notify_assistant_run_changed();
