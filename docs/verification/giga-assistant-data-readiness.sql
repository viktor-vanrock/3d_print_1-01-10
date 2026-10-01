-- Giga assistant v1: aggregate-only readiness checks.
-- Run with psql. The transaction is read-only and prints no row-level user content.
-- Example:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v environment=dev \
--     -f docs/verification/giga-assistant-data-readiness.sql
--
-- EXPLAIN ANALYZE is disabled by default. Enable it only on an approved read replica
-- or disposable production-like copy:
--   ... -v run_explain=true

\set ON_ERROR_STOP on
\if :{?environment}
\else
  \set environment unspecified
\endif
\if :{?run_explain}
\else
  \set run_explain false
\endif

begin transaction isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '60s';

select
  :'environment'::text as environment,
  clock_timestamp() as observed_at,
  current_setting('server_version_num')::integer as server_version_num,
  txid_current_if_assigned() is null as no_transaction_id_assigned;

-- Fail before data queries when the current baseline schema does not match the
-- columns used below. Only the aggregate number of missing columns is printed.
with required(table_name, column_name) as (
  values
    ('printers', 'id'), ('printers', 'slug'), ('printers', 'brand'),
    ('printers', 'model'), ('printers', 'aliases'), ('printers', 'status'),
    ('printers', 'type'), ('printers', 'sources'), ('printers', 'field_provenance'),
    ('printers', 'confidence'), ('printers', 'verified'),
    ('printers', 'price_ru_updated_at'), ('printers', 'build_volume_x'),
    ('printers', 'build_volume_y'), ('printers', 'build_volume_z'),
    ('printers', 'hotend_max_temp_c'), ('printers', 'bed_max_temp_c'),
    ('printers', 'specs'),
    ('machines', 'id'), ('machines', 'kind'), ('machines', 'status'),
    ('machines', 'model'), ('machines', 'aliases'), ('machines', 'specs'),
    ('machines', 'field_provenance'), ('machines', 'source'),
    ('machines', 'verified'),
    ('user_printers', 'id'), ('user_printers', 'user_id'),
    ('user_printers', 'printer_id'), ('user_printers', 'catalog_printer_id'),
    ('materials', 'id'), ('materials', 'kind'), ('materials', 'status'),
    ('materials', 'name'), ('materials', 'slug'), ('materials', 'specs'),
    ('materials', 'source'), ('materials', 'material_type_id'),
    ('materials', 'updated_at'),
    ('material_types', 'id'), ('material_types', 'slug'),
    ('material_types', 'default_extruder_temp_min_c'),
    ('material_types', 'default_extruder_temp_max_c'),
    ('material_types', 'default_extruder_temp_c'),
    ('material_types', 'requires_chamber'),
    ('material_types', 'requires_drying'),
    ('material_types', 'requires_direct_drive'),
    ('material_variants', 'id'), ('material_variants', 'material_id'),
    ('material_variants', 'diameter_mm'), ('material_variants', 'specs'),
    ('material_variants', 'source'),
    ('feed_posts', 'id'), ('feed_posts', 'status'),
    ('feed_posts', 'title'), ('feed_posts', 'body'),
    ('feed_posts', 'body_html'), ('feed_posts', 'source_url'),
    ('feed_posts', 'source_fingerprint'), ('feed_posts', 'ingest_provider'),
    ('feed_posts', 'ingest_model'), ('feed_posts', 'ingest_prompt_version'),
    ('feed_posts', 'gitverse_meta'), ('feed_posts', 'community_id'),
    ('feed_posts', 'created_at'), ('feed_posts', 'published_at'),
    ('feed_posts', 'updated_at'),
    ('assistant_runs', 'status'), ('assistant_runs', 'created_at'),
    ('assistant_runs', 'lease_expires_at'), ('assistant_runs', 'attempts')
), missing as (
  select required.table_name, required.column_name
  from required
  left join information_schema.columns columns
    on columns.table_schema = 'public'
   and columns.table_name = required.table_name
   and columns.column_name = required.column_name
  where columns.column_name is null
)
select count(*) = 0 as schema_ok, count(*)::integer as missing_required_columns
from missing
\gset

select
  'schema_preflight'::text as check_name,
  :'schema_ok'::boolean as schema_ok,
  :missing_required_columns::integer as missing_required_columns;

\if :schema_ok
\else
  rollback;
  \quit 3
\endif

-- Q1. Public printer coverage. The public catalog rule in
-- printer-catalog.repository.ts is cardinality(sources) > 0.
with public_printers as (
  select * from public.printers where cardinality(sources) > 0
)
select
  'q01_public_printers'::text as check_name,
  count(*)::bigint as public_rows,
  count(*) filter (where verified)::bigint as verified_rows,
  count(*) filter (where confidence is not null)::bigint as confidence_rows,
  count(*) filter (where field_provenance <> '{}'::jsonb)::bigint as provenance_rows,
  count(*) filter (where price_ru_updated_at is not null)::bigint as priced_at_rows,
  count(*) filter (
    where build_volume_x is not null
      and build_volume_y is not null
      and build_volume_z is not null
  )::bigint as complete_build_volume_rows,
  count(*) filter (where hotend_max_temp_c is not null)::bigint as hotend_temp_rows,
  count(*) filter (where bed_max_temp_c is not null)::bigint as bed_temp_rows,
  count(*) filter (
    where specs ? 'chamber_max_temp_c'
       or specs #>> '{chamber,max_temp_c}' is not null
  )::bigint as chamber_temp_rows
from public_printers;

-- Q2. Active FDM machine coverage for the keys consumed by compatibility.ts.
with active_fdm as (
  select * from public.machines where status = 'active' and kind = 'fdm_printer'
)
select
  'q02_active_fdm_machines'::text as check_name,
  count(*)::bigint as active_rows,
  count(*) filter (
    where specs #>> '{build_volume,x}' is not null
      and specs #>> '{build_volume,y}' is not null
      and specs #>> '{build_volume,z}' is not null
  )::bigint as build_volume_rows,
  count(*) filter (where specs ? 'nozzle_hardened')::bigint as nozzle_hardness_rows,
  count(*) filter (where specs ? 'max_hotend_temp_c')::bigint as hotend_temp_rows,
  count(*) filter (where specs ? 'chamber')::bigint as chamber_rows,
  count(*) filter (where specs ? 'extruder_drive')::bigint as extruder_drive_rows,
  count(*) filter (where specs ? 'filament_dia_mm')::bigint as filament_diameter_rows,
  count(*) filter (
    where specs #>> '{build_volume,x}' is not null
      and specs #>> '{build_volume,y}' is not null
      and specs #>> '{build_volume,z}' is not null
      and specs ? 'nozzle_hardened'
      and specs ? 'max_hotend_temp_c'
      and specs ? 'chamber'
      and specs ? 'extruder_drive'
      and specs ? 'filament_dia_mm'
  )::bigint as complete_compatibility_rows,
  count(*) filter (where field_provenance <> '{}'::jsonb)::bigint as provenance_rows
from active_fdm;

-- Q3/Q4. The confirmed mapping table is introduced by a later packet. Its
-- absence is an explicit capability gap, not permission to fuzzy-join names.
select to_regclass('public.printer_machine_links') is not null as mapping_table_exists
\gset

\if :mapping_table_exists
  with required(column_name) as (
    values ('printer_id'), ('machine_id'), ('source'), ('reviewed_by'), ('reviewed_at')
  ), missing as (
    select required.column_name
    from required
    left join information_schema.columns columns
      on columns.table_schema = 'public'
     and columns.table_name = 'printer_machine_links'
     and columns.column_name = required.column_name
    where columns.column_name is null
  )
  select count(*) = 0 as mapping_schema_ok,
         count(*)::integer as missing_mapping_columns
  from missing
  \gset

  \if :mapping_schema_ok
    select
      'q03_confirmed_mapping'::text as check_name,
      count(*)::bigint as confirmed_links,
      count(distinct printer_id)::bigint as linked_public_printers,
      count(distinct machine_id)::bigint as linked_machines,
      count(*) filter (
        where nullif(btrim(source), '') is not null
          and reviewed_by is not null
          and reviewed_at is not null
      )::bigint as fully_reviewed_links
    from public.printer_machine_links;
  \else
    select
      'q03_confirmed_mapping'::text as check_name,
      false as mapping_schema_ready,
      :missing_mapping_columns::integer as missing_mapping_columns;
  \endif
\else
  select
    'q03_confirmed_mapping'::text as check_name,
    false as mapping_table_exists,
    0::bigint as confirmed_links;
\endif

select
  'q04_owned_references'::text as check_name,
  count(*)::bigint as owned_rows,
  count(*) filter (
    where catalog_printer_id is not null and printer_id is null
  )::bigint as catalog_only_rows,
  count(*) filter (
    where catalog_printer_id is null and printer_id is not null
  )::bigint as machine_only_rows,
  count(*) filter (
    where catalog_printer_id is not null and printer_id is not null
  )::bigint as both_reference_rows,
  count(*) filter (
    where catalog_printer_id is null and printer_id is null
  )::bigint as no_reference_rows,
  count(*) filter (where catalog_printer_id is not null)::bigint as catalog_reference_rows,
  count(*) filter (where printer_id is not null)::bigint as machine_reference_rows
from public.user_printers;

\if :mapping_table_exists
  \if :mapping_schema_ok
    select
      'q04_owned_mapping_consistency'::text as check_name,
      count(*)::bigint as both_reference_rows,
      count(*) filter (where links.machine_id = owned.printer_id)::bigint as confirmed_agreements,
      count(*) filter (
        where links.printer_id is not null and links.machine_id <> owned.printer_id
      )::bigint as confirmed_conflicts,
      count(*) filter (where links.printer_id is null)::bigint as mapping_missing_rows
    from public.user_printers owned
    left join public.printer_machine_links links
      on links.printer_id = owned.catalog_printer_id
    where owned.catalog_printer_id is not null and owned.printer_id is not null;
  \endif
\endif

-- Q5. Published filament and inherited variant visibility coverage.
with published_filaments as (
  select materials.*, material_types.slug as material_type_slug,
         material_types.default_extruder_temp_min_c,
         material_types.default_extruder_temp_max_c,
         material_types.default_extruder_temp_c,
         material_types.requires_chamber,
         material_types.requires_drying,
         material_types.requires_direct_drive
  from public.materials
  join public.material_types on material_types.id = materials.material_type_id
  where materials.status = 'published' and materials.kind = 'filament'
), visible_variants as (
  select variants.*
  from public.material_variants variants
  join published_filaments filaments on filaments.id = variants.material_id
)
select
  'q05_published_filaments'::text as check_name,
  (select count(*) from published_filaments)::bigint as published_materials,
  (select count(*) from visible_variants)::bigint as inherited_visible_variants,
  (select count(*) from published_filaments
    where material_type_slug is not null)::bigint as typed_materials,
  (select count(*) from published_filaments
    where default_extruder_temp_c is not null
       or (default_extruder_temp_min_c is not null
           and default_extruder_temp_max_c is not null))::bigint as temperature_ready_materials,
  (select count(*) from published_filaments
    where specs ? 'fill_type')::bigint as fill_type_rows,
  (select count(*) from published_filaments
    where source is not null and updated_at is not null)::bigint as source_timestamp_rows,
  (select count(*) from visible_variants
    where diameter_mm is not null)::bigint as diameter_ready_variants,
  (select count(*) from visible_variants
    where source is not null)::bigint as sourced_variants;

-- Q6. Values outside the exact compatibility.ts data contract.
select
  'q06_compatibility_contract_values'::text as check_name,
  count(*) filter (
    where specs ? 'nozzle_hardened'
      and jsonb_typeof(specs -> 'nozzle_hardened') <> 'boolean'
  )::bigint as invalid_nozzle_hardened,
  count(*) filter (
    where specs ? 'max_hotend_temp_c'
      and jsonb_typeof(specs -> 'max_hotend_temp_c') <> 'number'
  )::bigint as invalid_hotend_temperature,
  count(*) filter (
    where specs ? 'chamber'
      and (jsonb_typeof(specs -> 'chamber') <> 'string'
        or specs ->> 'chamber' not in ('none', 'passive', 'active'))
  )::bigint as invalid_chamber,
  count(*) filter (
    where specs ? 'extruder_drive'
      and (jsonb_typeof(specs -> 'extruder_drive') <> 'string'
        or specs ->> 'extruder_drive' not in ('direct', 'bowden'))
  )::bigint as invalid_extruder_drive,
  count(*) filter (
    where specs ? 'filament_dia_mm'
      and case
        when jsonb_typeof(specs -> 'filament_dia_mm') = 'number'
          then (specs ->> 'filament_dia_mm')::numeric not in (1.75, 2.85, 3.0)
        else true
      end
  )::bigint as unsupported_filament_diameter
from public.machines
where status = 'active' and kind = 'fdm_printer';

select
  'q06_material_contract_values'::text as check_name,
  count(*) filter (
    where specs ? 'fill_type'
      and (jsonb_typeof(specs -> 'fill_type') <> 'string'
        or specs ->> 'fill_type' not in
          ('none', 'carbon', 'glass', 'wood', 'metal', 'glitter', 'ceramic'))
  )::bigint as unsupported_fill_type
from public.materials
where status = 'published' and kind = 'filament';

-- Q7. News eligibility from the fixed v1 provenance policy. published_at is the
-- explicit portal publication event; source dates remain separate diagnostics.
with visible as (
  select * from public.feed_posts where status = 'visible'
), provenance_eligible as (
  select * from visible
  where nullif(btrim(source_url), '') is not null
    and nullif(btrim(source_fingerprint), '') is not null
    and nullif(btrim(ingest_provider), '') is not null
    and nullif(btrim(ingest_model), '') is not null
    and nullif(btrim(ingest_prompt_version), '') is not null
), eligible as (
  select * from provenance_eligible where published_at is not null
)
select
  'q07_visible_news'::text as check_name,
  (select count(*) from visible)::bigint as visible_posts,
  (select count(*) from eligible)::bigint as eligible_news_posts,
  (select count(*) from eligible)::bigint as portal_event_date_rows,
  (select count(*) from provenance_eligible where published_at is null)::bigint as legacy_missing_portal_date_rows,
  (select count(*) from eligible
    where gitverse_meta ? 'published_at'
       or gitverse_meta ? 'created_at')::bigint as json_source_date_candidates,
  0::bigint as first_class_source_publication_date_rows,
  (select count(*) from eligible where community_id is not null)::bigint as community_rows
from (select 1) singleton;

-- Q8. Hostile/oversized source shapes. Counts only; no title/body/URL is printed.
with eligible as (
  select * from public.feed_posts
  where status = 'visible'
    and published_at is not null
    and nullif(btrim(source_url), '') is not null
    and nullif(btrim(source_fingerprint), '') is not null
    and nullif(btrim(ingest_provider), '') is not null
    and nullif(btrim(ingest_model), '') is not null
    and nullif(btrim(ingest_prompt_version), '') is not null
)
select
  'q08_hostile_news_shapes'::text as check_name,
  count(*) filter (where body_html is not null and btrim(body_html) <> '')::bigint as html_rows,
  count(*) filter (where length(coalesce(body, '')) > 4000)::bigint as long_body_rows,
  count(*) filter (
    where coalesce(title, '') || ' ' || coalesce(body, '')
      ~* '(ignore|disregard|system prompt|developer message|инструкц|игнорир|секрет|token|credential)'
  )::bigint as prompt_like_rows,
  count(*) filter (
    where source_url !~* '^https://[^[:space:]]+$'
  )::bigint as non_https_source_url_rows
from eligible;

-- Q9. Aggregate ambiguity under conservative case/space/punctuation
-- normalization. No colliding label is emitted.
with public_printers as (
  select id, brand, model, aliases
  from public.printers where cardinality(sources) > 0
), printer_names as (
  select id,
         lower(regexp_replace(btrim(brand || ' ' || model), '[^[:alnum:]]+', '', 'g')) as key
  from public_printers
), printer_aliases as (
  select id,
         lower(regexp_replace(btrim(alias), '[^[:alnum:]]+', '', 'g')) as key
  from public_printers cross join lateral unnest(aliases) alias
  where btrim(alias) <> ''
), printer_keys as (
  select * from printer_names union all select * from printer_aliases
), duplicate_printer_keys as (
  select key, count(distinct id) as affected
  from printer_keys where key <> '' group by key having count(distinct id) > 1
), duplicate_material_keys as (
  select lower(regexp_replace(btrim(name), '[^[:alnum:]]+', '', 'g')) as key,
         count(*) as affected
  from public.materials
  where status = 'published' and kind = 'filament'
  group by 1 having count(*) > 1
)
select
  'q09_name_ambiguity'::text as check_name,
  (select count(*) from duplicate_printer_keys)::bigint as printer_collision_groups,
  (select coalesce(sum(affected), 0) from duplicate_printer_keys)::bigint as printer_rows_in_collisions,
  (select count(*) from duplicate_material_keys)::bigint as material_collision_groups,
  (select coalesce(sum(affected), 0) from duplicate_material_keys)::bigint as material_rows_in_collisions;

-- Q10. Index inventory for the bounded v1 access paths. Counts/booleans are
-- evidence; they do not prove latency at production cardinality.
select
  'q10_index_inventory'::text as check_name,
  count(*) filter (where tablename = 'printers')::bigint as printer_indexes,
  count(*) filter (where tablename = 'machines')::bigint as machine_indexes,
  count(*) filter (where tablename = 'materials')::bigint as material_indexes,
  count(*) filter (where tablename = 'material_variants')::bigint as material_variant_indexes,
  count(*) filter (where tablename = 'feed_posts')::bigint as feed_indexes,
  bool_or(indexname = 'feed_posts_visible_created_idx') as has_feed_visible_created_index,
  bool_or(indexname = 'feed_posts_assistant_published_idx') as has_assistant_news_published_index,
  bool_or(indexname = 'assistant_runs_queue_claim_idx') as has_assistant_queue_claim_index,
  bool_or(
    tablename = 'printers'
    and indexdef ilike '%sources%'
  ) as has_printer_public_visibility_index,
  bool_or(
    tablename = 'materials'
    and indexdef ilike '%status%'
    and indexdef ilike '%kind%'
  ) as has_material_public_filament_index,
  bool_or(
    tablename = 'machines'
    and indexdef ilike '%status%'
    and indexdef ilike '%kind%'
  ) as has_active_machine_kind_index
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'printers', 'machines', 'materials', 'material_variants',
    'feed_posts', 'assistant_runs'
  );

-- Q11. Queue backlog. Age and counts are aggregate; no run/user/message is exposed.
select
  'q11_assistant_runtime_backlog'::text as check_name,
  count(*) filter (where status = 'queued')::bigint as queued_runs,
  coalesce(
    extract(epoch from clock_timestamp() - min(created_at)
      filter (where status = 'queued')),
    0
  )::bigint as oldest_queued_age_seconds,
  count(*) filter (where status = 'running')::bigint as running_runs,
  count(*) filter (
    where status = 'running' and lease_expires_at < clock_timestamp()
  )::bigint as expired_running_leases,
  coalesce(max(attempts) filter (where status in ('queued', 'running')), 0)::integer
    as max_active_attempts
from public.assistant_runs;

-- Optional performance evidence. Never enable against the primary production
-- database without an explicit operator decision.
\if :run_explain
  explain (analyze, buffers, timing off, summary on)
  select id
  from public.printers
  where cardinality(sources) > 0
    and (brand ilike '%readiness%' or model ilike '%readiness%')
  order by brand, model, id
  limit 10;

  explain (analyze, buffers, timing off, summary on)
  select materials.id
  from public.materials
  join public.material_types on material_types.id = materials.material_type_id
  where materials.status = 'published'
    and materials.kind = 'filament'
    and (materials.name ilike '%readiness%' or material_types.name ilike '%readiness%')
  order by materials.name, materials.id
  limit 10;

  explain (analyze, buffers, timing off, summary on)
  select id
  from public.feed_posts
  where status = 'visible'
    and source_url is not null and btrim(source_url) <> ''
    and source_fingerprint is not null and btrim(source_fingerprint) <> ''
    and ingest_provider is not null and btrim(ingest_provider) <> ''
    and ingest_model is not null and btrim(ingest_model) <> ''
    and ingest_prompt_version is not null and btrim(ingest_prompt_version) <> ''
    and published_at is not null
    and published_at >= clock_timestamp() - interval '30 days'
  order by published_at desc, id desc
  limit 10;
\endif

rollback;
