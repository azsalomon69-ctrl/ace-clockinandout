begin;

-- Supports the review queue, chronological paging, report generation, and export history.
create index if not exists time_entries_active_clock_in_idx on public.time_entries (clock_in_at desc) where deleted_at is null;
create index if not exists time_entries_user_clock_in_idx on public.time_entries (user_id, clock_in_at desc) where deleted_at is null;
create index if not exists time_entries_project_clock_in_idx on public.time_entries (project_id, clock_in_at desc) where deleted_at is null;
create index if not exists time_entries_completed_clock_out_idx on public.time_entries (clock_out_at desc) where deleted_at is null and clock_out_at is not null;
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_created_at_idx on public.audit_logs (action, created_at desc);
create index if not exists reports_generated_at_idx on public.reports (generated_at desc);
create index if not exists report_exports_exported_at_idx on public.report_exports (exported_at desc);

commit;
