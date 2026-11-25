-- Remove obsolete break-column references from the activity functions.
begin;
do $repair$
declare
  function_id regprocedure;
  definition text;
begin
  foreach function_id in array array[
    'public.record_project_activity(uuid,uuid,uuid,text,uuid,timestamptz)'::regprocedure,
    'public.finish_project_activities()'::regprocedure
  ] loop
    definition := pg_get_functiondef(function_id);
    definition := regexp_replace(
      definition,
      'if\s+v_entry\.break_started_at\s+is\s+not\s+null\s+then\s+raise\s+exception\s+''[^'']*'';\s*end\s+if;',
      '',
      'gi'
    );
    definition := regexp_replace(
      definition,
      '\s*-\s*(v_entry|new)\.break_seconds',
      '',
      'gi'
    );
    if definition ~* 'break_started_at|break_seconds' then
      raise exception 'Unexpected break reference in %', function_id;
    end if;
    execute definition;
  end loop;
end;
$repair$;
notify pgrst, 'reload schema';
commit;
