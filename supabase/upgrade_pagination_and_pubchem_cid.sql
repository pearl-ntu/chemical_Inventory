-- Two independent fixes bundled together:
--
-- 1. next_chemical_code() / next_research_asset_stable_id() move code/ID
--    allocation into the database instead of computing it client-side from
--    a `select code` / `select stable_id` query. PostgREST caps a plain
--    select at 1000 rows, so past that size the client-side computation was
--    silently working off a truncated set and could hand out a code that
--    collides with an existing one (unique constraint violation on insert).
--
-- 2. pubchem_cid caches each chemical's PubChem CID (resolved from CAS/name)
--    so structure search can use PubChem's own substructure/exact-match
--    search for rows that never got a hand-drawn structure_molfile, instead
--    of silently treating "no molfile" as "no match."

create or replace function public.next_chemical_code()
returns text
language sql
stable
set search_path = public
as $$
  select 'PEARL-' || lpad((
    coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 4, '0')
  from public.chemicals
  where code ~ '^PEARL-\d+$';
$$;

create or replace function public.next_research_asset_stable_id()
returns text
language sql
stable
set search_path = public
as $$
  select 'PEARL-RA-' || lpad((
    coalesce(max(nullif(regexp_replace(stable_id, '\D', '', 'g'), '')::bigint), 0) + 1
  )::text, 6, '0')
  from public.research_assets
  where stable_id ~ '^PEARL-RA-\d+$';
$$;

alter table chemicals add column if not exists pubchem_cid bigint;
create index if not exists chemicals_pubchem_cid_idx on chemicals(pubchem_cid) where pubchem_cid is not null;
