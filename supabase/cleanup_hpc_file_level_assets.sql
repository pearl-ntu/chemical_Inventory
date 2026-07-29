-- Optional cleanup after switching the HPC scanner from file-level records
-- to folder-level records. This only removes PEARL metadata rows, not NSCC files.

delete from public.research_assets
where source = 'hpc'
  and source_external_id is not null
  and (
    lower(source_external_id) like '%.log'
    or lower(source_external_id) like '%.out'
    or lower(source_external_id) like '%.inp'
    or lower(source_external_id) like '%.gjf'
    or lower(source_external_id) like '%.com'
  );

delete from public.research_assets
where source = 'hpc'
  and title ~* '\.(log|out|inp|gjf|com|xml)$';

notify pgrst, 'reload schema';
