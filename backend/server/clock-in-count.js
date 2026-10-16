export async function countActiveEmployeeClockIns(db) {
  const { count, error } = await db.from('time_entries')
    .select('id,profiles!time_entries_user_id_fkey!inner(role)', { count: 'exact', head: true })
    .eq('profiles.role', 'USER')
    .is('deleted_at', null)
    .is('clock_out_at', null);
  if (error) throw error;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Active clock-in count is unavailable');
  return count;
}
