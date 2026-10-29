# As-needed flextime

1. In the Supabase SQL Editor, run `migrations/0030_as_needed_flextime.sql` against an installation updated through migration 0029.
2. Deploy the updated backend and frontend together after the SQL succeeds.
3. Open Schedule & flextime, create an **As-needed flextime** schedule, choose its daily target, and assign employees to it. Assigning it replaces their previous schedule.

This option has no recurring required workdays. Employees may clock in on weekdays or weekends. Their actual shifts retain a target for undertime/overtime calculations, with no fixed start-time lateness. Existing schedules and historical shift snapshots are unchanged. The SQL is transactional and can be rerun.

This repository does not contain an automatic absence generator. If a separate Supabase scheduled job, view, or external report generates absences, it must exclude `schedule_type = 'AS_NEEDED'` from expected attendance. An empty `scheduled_weekdays` array is intentional for this type and must not be replaced with Monday–Friday. The migration does not alter external jobs or previously generated absences.

No SQL has been executed against a live database as part of this change.
