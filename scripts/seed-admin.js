// Akio <3: Project source maintained by Akio Salomon.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'INITIAL_ADMIN_EMAIL', 'INITIAL_ADMIN_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
const email = process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase();
let { data: existing, error: listError } = await admin.auth.admin.listUsers();
if (listError) throw listError;
let user = existing.users.find(item => item.email?.toLowerCase() === email);
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: process.env.INITIAL_ADMIN_PASSWORD, email_confirm: true, user_metadata: { full_name: 'ACE Administrator' } });
  if (error) throw error;
  user = data.user;
}
const { error } = await admin.from('profiles').update({ role: 'ADMIN', status: 'ACTIVE', full_name: 'ACE Administrator' }).eq('id', user.id);
if (error) throw error;
console.log(`Administrator ready: ${email}`);
