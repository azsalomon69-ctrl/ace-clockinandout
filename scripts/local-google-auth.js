import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createGoogleAuth } from '../backend/server/google-auth.js';

// Never load .env or accept a remote database as a fallback.
const { parsed: config, error } = dotenv.config({ path: new URL('../.env.green.local', import.meta.url) });
if (error) throw new Error('Missing .env.green.local');
if (config.PGHOST !== '127.0.0.1' || config.PGDATABASE !== 'ace_green_local' || config.PGPORT !== '5432') throw new Error('Local database target does not match');
for (const key of ['PGPASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'HEAD_ADMIN_EMAIL']) {
  if (!config[key] || config[key].startsWith('REPLACE_')) throw new Error(`Fill in ${key} in the local file`);
}
if (config.GREEN_FRONTEND_URL !== 'http://localhost:5500' || config.GOOGLE_REDIRECT_URI !== 'http://localhost:3000/v1/auth/google/callback') throw new Error('Local URLs do not match');
const pool = new pg.Pool({ host: '127.0.0.1', port: 5432, database: 'ace_green_local', user: config.PGUSER,
  password: config.PGPASSWORD, ssl: false, max: 5, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(572381, 1)');
  const { rows: [target] } = await client.query('select current_database() as name');
  if (target.name !== 'ace_green_local') throw new Error('Unexpected database');
  const { rows: [marker] } = await client.query("select to_regclass('public.local_auth_preview_version') as name");
  if (!marker.name) {
    const { rows: [tables] } = await client.query("select count(*)::int as count from information_schema.tables where table_schema='public'");
    if (tables.count !== 0) throw new Error('Local database is not empty; refusing to initialize');
    await client.query(await fs.readFile(new URL('./local-google-auth-schema.sql', import.meta.url), 'utf8'));
  }
  const { rows: versions } = await client.query('select version from public.local_auth_preview_version');
  if (versions.length !== 1 || versions[0].version !== 1) throw new Error('Unsupported local auth schema');
  await client.query('commit');
} catch (error) { await client.query('rollback'); throw error; }
finally { client.release(); }

const auth = createGoogleAuth(pool, { ...config, NODE_ENV: 'development', GOOGLE_AUTH_LOCAL_TEST: 'true', GREEN_BOOTSTRAP_HEAD_ADMIN: 'true' });
const api = express();
api.use(helmet());
api.use(cors({ origin: 'http://localhost:5500', methods: ['GET','POST'], allowedHeaders: ['Content-Type','Authorization'] }));
api.use(express.json({ limit: '8kb' }));
api.use((_req, res, next) => { res.set('Cache-Control','no-store'); next(); });
const limiter = rateLimit({ windowMs: 15*60*1000, limit: 60 });
api.use('/v1', limiter);
auth.register(api, (_req, _res, next) => next());
api.get('/health', (_req, res) => res.json({ localAuthPreview: true }));
api.get('/v1/auth/config', (_req, res) => res.json(auth.config));
api.get('/v1/me', async (req, res) => {
  try { res.json(await auth.readUser(req.get('authorization')?.replace(/^Bearer\s+/i, ''))); }
  catch { res.status(401).json({ error: 'Sign in to continue.' }); }
});
api.use((_error, _req, res, _next) => res.status(500).json({ error: 'Local sign-in could not be completed.' }));
const web = express();
web.use(helmet({ contentSecurityPolicy: { directives: { 'connect-src': ["'self'", 'http://localhost:3000'], 'upgrade-insecure-requests': null } }, strictTransportSecurity: false }));
web.use((_req, res, next) => { res.set('Cache-Control','no-store'); next(); });
const preview = new URL('./local-google-preview/', import.meta.url);
web.get(['/','/login'], (_req,res) => res.sendFile(fileURLToPath(new URL('index.html', preview))));
web.get('/preview.js', (_req,res) => res.sendFile(fileURLToPath(new URL('preview.js', preview))));
// The actual browser auth adapter is exercised, but no clock-app routes exist here.
web.get('/auth.js', (_req,res) => res.sendFile(fileURLToPath(new URL('../frontend/js/supabase-auth.js', import.meta.url))));
const servers = [];
for (const [app, port] of [[api,3000],[web,5500]]) {
  const server = app.listen(port, 'localhost');
  servers.push(server);
  await new Promise((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
}
console.log('Local Google sign-in test ready: http://localhost:5500');
console.log('Auth test only. No clock data or deployed services are connected.');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => {
  for (const server of servers) server.close();
  await pool.end();
  process.exit(0);
});
