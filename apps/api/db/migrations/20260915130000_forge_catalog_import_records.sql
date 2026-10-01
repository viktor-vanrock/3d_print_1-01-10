-- migrate:up

CREATE TABLE forge_catalog_import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text NOT NULL,
  source_key text NOT NULL,
  payload jsonb NOT NULL,
  content_hash bytea NOT NULL,
  outcome text NOT NULL,
  matched_entity_type text,
  matched_entity_ids uuid[] NOT NULL DEFAULT '{}',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forge_catalog_import_records_source_unique UNIQUE (source_file, source_key),
  CONSTRAINT forge_catalog_import_records_outcome_check CHECK (outcome IN ('matched', 'quarantined')),
  CONSTRAINT forge_catalog_import_records_entity_type_check CHECK (matched_entity_type IS NULL OR matched_entity_type IN ('machine', 'printer', 'material', 'vendor')),
  CONSTRAINT forge_catalog_import_records_match_check CHECK (
    (outcome = 'matched' AND matched_entity_type IS NOT NULL AND cardinality(matched_entity_ids) > 0 AND reason IS NULL)
    OR
    (outcome = 'quarantined' AND matched_entity_type IS NULL AND cardinality(matched_entity_ids) = 0 AND reason IS NOT NULL)
  )
);

CREATE INDEX forge_catalog_import_records_outcome_idx
  ON forge_catalog_import_records (outcome, source_file, updated_at DESC);

CREATE INDEX forge_catalog_import_records_matched_entities_idx
  ON forge_catalog_import_records USING gin (matched_entity_ids);

-- migrate:down

DROP TABLE forge_catalog_import_records;
