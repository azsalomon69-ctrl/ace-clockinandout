import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the production route registrations and cache, not a copy of their logic.
// Only verified identity, Supabase storage, and the Express response are doubles.
export function tutorialBackend({ role = 'USER', cache = true, status = 'NOT_STARTED', step = 0, version } = {}) {
  const config = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../../../frontend/js/onboarding-config.js', import.meta.url), 'utf8'), config);
  version ??= config.window.ACETutorialConfig[role].version;
  const source = readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8');
  const tables = { profiles: [{ id: 'fixture-user', role, status: 'ACTIVE', tutorial_status: status, tutorial_step: step, tutorial_version: version }], profile_tutorial_progress: [] };
  const handlers = new Map();
  const profileCache = new Map();
  const clone = value => structuredClone(value);
  const db = { from(table) {
    if (!tables[table]) throw new Error(`Unexpected table: ${table}`);
    let filters = [], patch, upsert;
    const builder = {
      select() { return builder; }, eq(k, v) { filters.push([k, v]); return builder; },
      update(value) { patch = value; return builder; },
      upsert(value) { upsert = value; return builder; },
      async single() { const result = await builder.maybeSingle(); if (!result) throw new Error('No row'); return result; },
      async maybeSingle() {
        if (upsert) {
          let row = tables[table].find(r => r.profile_id === upsert.profile_id && r.role === upsert.role);
          if (row) Object.assign(row, clone(upsert)); else tables[table].push(clone(upsert));
          return clone(upsert);
        }
        const row = tables[table].find(r => filters.every(([k, v]) => r[k] === v));
        if (!row) return null;
        if (patch) Object.assign(row, clone(patch));
        return clone(row);
      }
    };
    return builder;
  } };
  const context = vm.createContext({ Date, Promise, Map, Number, db, profileCache, cacheMaxEntries: 500,
    query: async value => value, authenticate() {}, activeOnly() {}, isHeadAdmin: () => false,
    fail: (res, code, error) => res.status(code).json({ error }),
    app: { get(path, ...fns) { handlers.set(`GET ${path}`, fns.at(-1)); }, patch(path, ...fns) { handlers.set(`PATCH ${path}`, fns.at(-1)); } }
  });
  const section = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Production section missing: ${start}`);
    return source.slice(a, b);
  };
  vm.runInContext(section('const cached =', 'const tokenCacheKey =') + '\nglobalThis.readCached = cached;', context);
  vm.runInContext(section("app.get('/v1/me',", "app.patch('/v1/me',"), context);
  vm.runInContext(section("app.patch('/v1/me/tutorial',", "app.post('/v1/me/avatar-upload',"), context);
  return {
    tables, profileCache,
    promote(nextRole) { tables.profiles[0].role = nextRole; profileCache.clear(); },
    async request(method, path, body = {}) {
      const loader = async () => clone(tables.profiles[0]);
      const profile = cache ? await context.readCached(profileCache, 'fixture-user', 5000, loader) : await loader();
      let result, code = 200;
      const res = { status(value) { code = value; return res; }, json(value) { result = clone(value); return res; } };
      const handler = handlers.get(`${method} ${path}`);
      if (!handler) throw new Error(`Unexpected route: ${method} ${path}`);
      await handler({ profile, body }, res, error => { throw error; });
      return { code, body: result };
    }
  };
}
