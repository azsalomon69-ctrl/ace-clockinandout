-- Repair foreign keys in ace_debug that accidentally still reference public.
-- Run this once before running debug-workspace-seed.template.sql.
begin;

do $$
declare
  v_fk record;
  v_definition text;
begin
  for v_fk in
    select source.relname as table_name,
           constraint_row.conname as constraint_name,
           constraint_row.oid as constraint_oid,
           target.relname as target_table
    from pg_constraint constraint_row
    join pg_class source on source.oid = constraint_row.conrelid
    join pg_namespace source_ns on source_ns.oid = source.relnamespace
    join pg_class target on target.oid = constraint_row.confrelid
    join pg_namespace target_ns on target_ns.oid = target.relnamespace
    where constraint_row.contype = 'f'
      and source_ns.nspname = 'ace_debug'
      and target_ns.nspname = 'public'
      and target.relname = any(array[
        'departments', 'profiles', 'projects', 'invitations', 'user_projects',
        'time_entries', 'work_schedules', 'user_schedule_assignments',
        'admin_remarks', 'employee_messages', 'profile_tutorial_progress',
        'reports', 'report_exports', 'audit_logs'
      ])
  loop
    v_definition := pg_get_constraintdef(v_fk.constraint_oid);
    v_definition := replace(
      v_definition,
      format('REFERENCES public.%I', v_fk.target_table),
      format('REFERENCES ace_debug.%I', v_fk.target_table)
    );
    v_definition := replace(
      v_definition,
      format('REFERENCES %I(', v_fk.target_table),
      format('REFERENCES ace_debug.%I(', v_fk.target_table)
    );

    if position(format('REFERENCES ace_debug.%I', v_fk.target_table) in v_definition) = 0 then
      raise exception 'Could not safely rewrite foreign key %.% to ace_debug.%', v_fk.table_name, v_fk.constraint_name, v_fk.target_table;
    end if;

    execute format('alter table ace_debug.%I drop constraint %I', v_fk.table_name, v_fk.constraint_name);
    execute format('alter table ace_debug.%I add constraint %I %s', v_fk.table_name, v_fk.constraint_name, v_definition);
  end loop;
end;
$$;

commit;
