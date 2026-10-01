-- Confirm one reviewed printers.id -> machines.id link per invocation.
-- Dry-run is the default. Only the supplied UUID pair is considered.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply false
\endif
\if :{?source_url}
\else
  \set source_url ''
\endif

\if :{?printer_id}
\else
  \warn 'printer_id is required'
  \quit 2
\endif
\if :{?machine_id}
\else
  \warn 'machine_id is required'
  \quit 2
\endif
\if :{?source}
\else
  \warn 'source is required'
  \quit 2
\endif
\if :{?reviewed_by}
\else
  \warn 'reviewed_by is required'
  \quit 2
\endif
\if :{?reviewed_at}
\else
  \warn 'reviewed_at is required'
  \quit 2
\endif

begin;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '30s';

create temporary table requested_printer_machine_link (
  printer_id uuid primary key,
  machine_id uuid not null,
  source text not null check (btrim(source) <> ''),
  source_url text,
  reviewed_by text not null check (btrim(reviewed_by) <> ''),
  reviewed_at timestamptz not null
) on commit drop;

insert into requested_printer_machine_link(printer_id, machine_id, source, source_url, reviewed_by, reviewed_at)
values (
  :'printer_id'::uuid,
  :'machine_id'::uuid,
  :'source',
  nullif(btrim(:'source_url'), ''),
  :'reviewed_by',
  :'reviewed_at'::timestamptz
);

do $validation$
declare
  requested requested_printer_machine_link%rowtype;
  existing printer_machine_links%rowtype;
begin
  select * into strict requested from requested_printer_machine_link;

  perform 1 from printers
  where id = requested.printer_id and cardinality(sources) > 0
  for update;
  if not found then
    raise exception 'printer_id is missing or not public';
  end if;

  perform 1 from machines
  where id = requested.machine_id and status = 'active'
  for share;
  if not found then
    raise exception 'machine_id is missing or inactive';
  end if;

  select * into existing from printer_machine_links where printer_id = requested.printer_id;
  if found and not (
    existing.machine_id = requested.machine_id
    and existing.source = requested.source
    and existing.source_url is not distinct from requested.source_url
    and existing.reviewed_by = requested.reviewed_by
    and existing.reviewed_at = requested.reviewed_at
  ) then
    raise exception 'printer_id already has a conflicting confirmed link';
  end if;
end
$validation$;

with inserted as (
  insert into printer_machine_links(printer_id, machine_id, source, source_url, reviewed_by, reviewed_at)
  select printer_id, machine_id, source, source_url, reviewed_by, reviewed_at
  from requested_printer_machine_link
  on conflict (printer_id) do nothing
  returning printer_id
)
select
  case when exists (select 1 from inserted) then 'inserted' else 'already_identical' end as outcome,
  :'apply'::boolean as apply_requested;

\if :apply
  commit;
\else
  rollback;
\endif
