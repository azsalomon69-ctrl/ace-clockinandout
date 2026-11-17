import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import vm from 'node:vm';
import { minify } from 'terser';
import { createObfuscationProfile, obfuscationOptions, encodePrivateLiterals } from '../frontend-obfuscation.mjs';

const authFile = 'frontend/js/supabase-auth.js';
const authSource = readFileSync(new URL('../../' + authFile, import.meta.url), 'utf8');

async function compile(file, source, settings = {}) {
  const profile = createObfuscationProfile(settings);
  const { compress, mangle, nameCache } = obfuscationOptions(profile, [file], false);
  const output = await minify({ [file]: source }, { compress, mangle, nameCache, sourceMap: { includeSources: true } });
  return { ...encodePrivateLiterals(output, profile.encodeStrings && file === authFile), nameCache };
}

async function runAuth(source) {
  const observations = [];
  let changeAccount;
  let timeOut = false;
  let account = { user: { id: 'employee' }, access_token: 'initial' };
  const auth = {
    onAuthStateChange(fn) { changeAccount = fn; },
    async getSession() { return { data: { session: account } }; },
    async refreshSession() { account = { ...account, access_token: 'rotated' }; return { data: { session: account } }; },
    async signOut() { observations.push('sign-out'); account = null; }
  };
  const context = vm.createContext({
    window: { ACE_API_URL: 'https://ace.example', setTimeout, clearTimeout,
      dispatchEvent: event => observations.push([event.type, event.detail]),
      location: { replace: url => observations.push(['redirect', url]) },
      supabase: { createClient: (url, key) => { observations.push([url, key]); return { auth }; } } },
    CustomEvent, AbortController, URL,
    localStorage: { setItem: key => observations.push(['save', key]), removeItem: key => observations.push(['remove', key]) },
    sessionStorage: { setItem: (key, value) => observations.push([key, value]) },
    fetch: async (url, options) => {
      if (url.endsWith('/v1/auth/config')) return Response.json({ supabaseUrl: 'https://supabase.example', supabasePublishableKey: 'test' });
      if (timeOut) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted'))));
      const token = options.headers.Authorization;
      observations.push([url, token ?? null]);
      if (token === 'Bearer initial' || url.endsWith('/denied')) return Response.json({}, { status: 401 });
      return Response.json({ status: 'ok' });
    }
  });
  vm.runInContext(source, context);
  const api = context.window.ACEAuth;
  await api.checkService();
  assert.equal((await api.session()).access_token, 'initial');
  assert.equal((await api.request('/v1/me')).status, 'ok');
  account = { user: { id: 'different' }, access_token: 'other' };
  changeAccount('SIGNED_IN', account);
  await assert.rejects(api.request('/v1/me', { expectedUserId: 'employee' }), { status: 401 });
  assert.equal((await api.session()).user.id, 'different');
  timeOut = true;
  await assert.rejects(api.request('/v1/slow', { timeoutMs: 1 }), { code: 'ETIMEDOUT', message: 'The ACE service did not respond in time.' });
  timeOut = false;
  await assert.rejects(api.request('/v1/denied'), { status: 401 });
  return observations;
}

test('advanced authentication bundle preserves the original SDK and request behavior', async () => {
  const transformed = await compile(authFile, authSource);
  assert.equal(transformed.strings.length, 3);
  assert.doesNotMatch(transformed.code, /The ACE service did not respond in time/);
  assert.deepEqual(await runAuth(transformed.code), await runAuth(authSource));
  const marker = transformed.code.indexOf('ace_public_auth_config');
  const traced = new SourceMap(JSON.parse(transformed.map)).findEntry(0, marker);
  assert.equal(traced.originalSource, authFile);
  assert.match(authSource.split(/\r?\n/)[traced.originalLine], /ace_public_auth_config/);
});

test('seeded styles are reproducible and preserve cross-script names and audited private data', async () => {
  const source = 'function report(start,end){const range={periodStart:start,periodEnd:end,publicKey:"kept"};return [range.periodStart,range.periodEnd,range.publicKey]}globalThis.result=report(3,11);';
  const build = (seed, strategy) => compile('frontend/js/script.js', source, { ACE_OBFUSCATION_SEED: seed, ACE_OBFUSCATION_NAMES: strategy });
  const first = await build('first', 'hex');
  assert.equal(first.code, (await build('first', 'hex')).code);
  assert.notEqual(first.code, (await build('second', 'hex')).code);
  assert.notEqual(first.code, (await build('first', 'base36')).code);
  assert.match(first.code, /function report\(/);
  assert.deepEqual(Object.keys(first.nameCache.props.props).sort(), ['$periodEnd', '$periodStart']);
  const original = {}, transformed = {};
  vm.runInNewContext(source, original);
  vm.runInNewContext(first.code, transformed);
  assert.equal(JSON.stringify(transformed.result), JSON.stringify(original.result));
});
