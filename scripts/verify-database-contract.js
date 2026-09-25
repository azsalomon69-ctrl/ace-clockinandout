// Akio <3: Project source maintained by Akio Zaki Salomon.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

async function requireQuery(label, query) {
  const { error } = await query;
  if (error) throw new Error(`${label} is missing or incompatible: ${error.message}`);
}

async function requireRpc(name, args) {
  const { error } = await db.rpc(name, args);
  // A P0001 error is expected for a deliberately non-existent entry ID. It
  // proves PostgREST found and invoked the function without changing data.
  if (error && error.code !== 'P0001') throw new Error(`RPC ${name} is missing or incompatible: ${error.message}`);
}

await requireQuery('profiles columns', db.from('profiles').select('id,last_seen_at,profile_picture_url,profile_picture_public_id,permanently_deleted_at,tutorial_status,tutorial_step,tutorial_version').limit(1));
await requireQuery('time entry schedule columns', db.from('time_entries').select('id,break_started_at,break_seconds,deleted_at,schedule_id,schedule_type,scheduled_start_time,scheduled_end_time,target_seconds,break_limit_seconds').limit(1));
await requireQuery('employee chat table', db.from('employee_messages').select('id,sender_id,recipient_id,body,edited_at,deleted_at,read_at').limit(1));
await requireQuery('admin remark notification column', db.from('admin_remarks').select('id,seen_at').limit(1));
await requireQuery('access request columns', db.from('access_requests').select('id,profile_id,requested_role,expires_at,request_ip,status,reviewed_at,reviewed_by_user_id').limit(1));
await requireQuery('audit log table', db.from('audit_logs').select('id,user_id,action,entity_type,entity_id,description,request_id,created_at').limit(1));

const absentId = '00000000-0000-4000-8000-000000000000';
await requireRpc('compute_schedule_compliance', { p_entry_id: absentId });
await requireRpc('end_break_entry', { p_actor_user_id: absentId, p_entry_id: absentId, p_actor_role: 'USER' });
await requireRpc('clock_out_entry', { p_actor_user_id: absentId, p_entry_id: absentId, p_actor_role: 'USER', p_final_note: 'contract check' });
await requireRpc('admin_stop_entry', { p_entry_id: absentId, p_actor_user_id: absentId });
await requireRpc('admin_correct_entry', { p_entry_id: absentId, p_actor_user_id: absentId, p_clock_in: '2020-01-01T00:00:00.000Z', p_clock_out: '2020-01-01T00:00:01.000Z' });
await requireRpc('permanently_remove_archived_login', { target_user_id: absentId });
await requireRpc('review_access_request', { p_request_id: absentId, p_actor_user_id: absentId, p_decision: 'APPROVE', p_role: 'USER', p_department_id: null, p_correlation_id: absentId });
await requireRpc('submit_access_request', { p_existing_request_id: absentId, p_profile_id: absentId, p_email: 'contract-check@example.com', p_full_name: 'Contract check', p_requested_department: null, p_message: null, p_request_ip: null, p_expires_at: '2030-01-01T00:00:00.000Z', p_request_id: absentId });
await requireRpc('admin_update_profile_with_audit', { p_target_user_id: absentId, p_actor_user_id: absentId, p_operation: 'CHANGE_ROLE', p_role: 'USER', p_status: null, p_department_id: null, p_request_id: absentId });
await requireRpc('change_user_status_with_audit', { p_target_user_id: absentId, p_actor_user_id: absentId, p_status: 'ACTIVE', p_request_id: absentId });
await requireRpc('change_user_role_with_audit', { p_target_user_id: absentId, p_actor_user_id: absentId, p_role: 'USER', p_request_id: absentId });
await requireRpc('archive_time_entry_with_audit', { p_entry_id: absentId, p_actor_user_id: absentId, p_operation: 'DELETE', p_request_id: absentId });
await requireRpc('permanently_remove_archived_login', { p_target_user_id: absentId, p_actor_user_id: absentId, p_request_id: absentId });

console.log('Database contract checks passed.');
