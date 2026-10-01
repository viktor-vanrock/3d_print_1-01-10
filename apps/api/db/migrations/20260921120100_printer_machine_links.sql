-- migrate:up

CREATE TABLE printer_machine_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id uuid NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_url text,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT printer_machine_links_printer_unique UNIQUE (printer_id),
  CONSTRAINT printer_machine_links_source_nonempty CHECK (btrim(source) <> ''),
  CONSTRAINT printer_machine_links_reviewer_nonempty CHECK (btrim(reviewed_by) <> ''),
  CONSTRAINT printer_machine_links_source_url_nonempty CHECK (source_url IS NULL OR btrim(source_url) <> '')
);

CREATE INDEX printer_machine_links_machine_idx ON printer_machine_links (machine_id);

-- migrate:down

DROP TABLE printer_machine_links;
