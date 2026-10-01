import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tutorialBackend } from './tutorial-backend.mjs';
import { removeScripts } from '../../../scripts/html-transforms.mjs';

const root = path.resolve(fileURLToPath(new URL('../../../frontend/', import.meta.url)));
let backend = tutorialBackend(), options = {}, results = [];
const readBody = async req => { let text = ''; for await (const chunk of req) text += chunk; return text ? JSON.parse(text) : {}; };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    const json = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/control' && req.method === 'POST') {
      options = await readBody(req); backend = tutorialBackend(options); return json({ ok: true });
    }
    if (url.pathname === '/promote') { backend.promote((await readBody(req)).role); return json({ ok: true }); }
    if (url.pathname === '/options') return json(options);
    if (url.pathname === '/fault') { Object.assign(options, await readBody(req)); return json({ ok: true }); }
    if (url.pathname === '/storage') return json(backend.tables);
    if (url.pathname === '/results' && req.method === 'POST') {
      const result = await readBody(req); results.push(result); console.log(JSON.stringify(result)); return json({ ok: true });
    }
    if (url.pathname === '/results') return json(results);
    if (url.pathname.startsWith('/v1/')) {
      if (options.offline && req.method === 'PATCH') return json({ error: 'Fixture simulated offline' }, 503);
      const result = await backend.request(req.method, url.pathname, await readBody(req));
      return json(result.body, result.code);
    }
    if (url.pathname === '/runner') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Tutorial behavior tests</title><h1>Tutorial behavior tests</h1><pre id="results">Running…</pre><iframe id="app" title="Real tutorial fixture" style="width:100%;height:850px;border:1px solid"></iframe><script type="module" src="/fixture-runner.js"></script>');
    }
    if (['/fixture-boot.js', '/fixture-runner.js'].includes(url.pathname)) {
      res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(new URL(`.${url.pathname}`, import.meta.url)));
    }
    if (url.pathname === '/production-fragments.js') {
      const shell = await readFile(path.join(root, 'js/script.js'), 'utf8');
      const admin = await readFile(path.join(root, 'js/admin-sections.js'), 'utf8');
      const action = admin.slice(admin.indexOf('function action('), admin.indexOf('\nfunction ', admin.indexOf('function action(') + 1));
      const profile = shell.split(/\r?\n/).find(line => line.startsWith('const profileRecord ='));
      const clock = shell.slice(shell.indexOf('    // Update clock buttons'), shell.indexOf('    // Update current session card'));
      const schedule = shell.slice(shell.indexOf('function loadUserDashboard() {'), shell.indexOf('    const userEntriesForStats', shell.indexOf('function loadUserDashboard() {'))) + '}';
      const chat = shell.slice(shell.indexOf('function initializeEmployeeChat() {'), shell.indexOf('    const launcher = chat.querySelector', shell.indexOf('function initializeEmployeeChat() {'))) + '}';
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`${profile}\nwindow.fixtureProfileRecord=profileRecord;\nconst esc = s => String(s ?? ''); const icon = () => '';\n${action}\nwindow.fixtureRowAction=action;\nwindow.fixtureClock=function(){${clock}};\nconst isScheduledToday=()=>true;\n${schedule}\nwindow.fixtureSchedule=loadUserDashboard;\n${chat}\nwindow.fixtureChat=initializeEmployeeChat;`);
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep) && filename !== root) return json({ error: 'Invalid path' }, 403);
    let data = await readFile(filename);
    if (filename.endsWith('.html')) {
      // Actual page markup/CSS, with test-only authentication/bootstrap. No production tutorial edits.
      data = removeScripts(data.toString()).replace('</body>', '<script src="/js/onboarding-config.js"></script><script src="/production-fragments.js"></script><script src="/js/onboarding.js"></script><script type="module" src="/fixture-boot.js"></script></body>');
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); res.end(data);
  } catch (error) { console.error(error); res.writeHead(500); res.end('Fixture request failed'); }
});
server.listen(4179, '127.0.0.1', () => console.log('Tutorial fixture listening at http://127.0.0.1:4179/runner'));
