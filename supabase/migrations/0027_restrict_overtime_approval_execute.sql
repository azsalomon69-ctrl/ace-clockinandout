-- F01: preserve the function body and existing records; restrict only execution.
-- Independent of the unrelated 0026 reliability draft.
begin;

revoke execute on function public.approve_entry_overtime(uuid, uuid)
  from PUBLIC, anon, authenticated;
grant execute on function public.approve_entry_overtime(uuid, uuid)
  to service_role;

commit;
