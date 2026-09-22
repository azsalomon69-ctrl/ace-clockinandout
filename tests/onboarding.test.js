import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../js/onboarding-config.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../js/onboarding.js', import.meta.url), 'utf8');

function engineHarness() {
  const listeners = {};
  const window = { addEventListener(name, listener) { listeners[name] = listener; } };
  vm.runInNewContext(engineSource, { window, console, localStorage: {}, location: {} });
  return window.ACETutorial;
}

test('every tutorial step has editable required content and a valid selector', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const [role, tutorial] of Object.entries(context.window.ACETutorialConfig)) {
    assert.ok(['USER', 'ADMIN'].includes(role));
    assert.ok(Number.isInteger(tutorial.version) && tutorial.version >= 1);
    assert.ok(Array.isArray(tutorial.steps) && tutorial.steps.length > 0);
    for (const step of tutorial.steps) {
      assert.match(step.page, /^[a-z0-9-]+\.html$/);
      assert.equal(typeof step.title, 'string'); assert.ok(step.title.trim());
      assert.equal(typeof step.body, 'string'); assert.ok(step.body.trim());
      assert.equal(typeof step.target, 'string'); assert.ok(step.target.trim());
      if (step.navigation) {
        assert.equal(typeof step.navigation.group, 'string'); assert.ok(step.navigation.group.trim());
        assert.equal(typeof step.navigation.label, 'string'); assert.ok(step.navigation.label.trim());
      }
      // Keep editable targets to one stable ID or class. Both are valid CSS
      // selectors without requiring a browser DOM in this unit test.
      assert.match(step.target, /^(?:#[A-Za-z][A-Za-z0-9_-]*|\.[A-Za-z][A-Za-z0-9_-]*)$/, `${role}: ${step.target}`);
    }
  }
});

test('administrator tutorial covers every primary administration workspace', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  const steps = context.window.ACETutorialConfig.ADMIN.steps;
  const pages = new Set(steps.map(step => step.page));
  for (const page of [
    'admin-dashboard.html', 'access-requests.html', 'users.html', 'invitations.html',
    'departments.html', 'projects.html', 'schedule-flex.html', 'admin-time-entries.html',
    'deleted-time-entries.html', 'reports.html', 'individual-reports.html',
    'audit-logs.html', 'settings.html'
  ]) assert.ok(pages.has(page), `Admin tutorial should cover ${page}`);
  assert.ok(steps.length >= 18, 'Admin tutorial should be detailed enough to explain its distinct tools');
});

test('every administrator tutorial target exists on its configured page', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const step of context.window.ACETutorialConfig.ADMIN.steps) {
    assert.match(step.target, /^#[A-Za-z][A-Za-z0-9_-]*$/, 'Admin steps should use durable ID targets');
    const markup = readFileSync(new URL(`../${step.page}`, import.meta.url), 'utf8');
    assert.ok(markup.includes(`id="${step.target.slice(1)}"`), `${step.target} should exist in ${step.page}`);
  }
});

test('tutorial launch rules welcome, resume, or stay quiet as appropriate', () => {
  const tutorial = engineHarness();
  const config = { version: 1, steps: [{}] };
  const user = { Status: 'ACTIVE' };
  assert.equal(tutorial.launchMode(user, config, { status: 'NOT_STARTED' }), 'WELCOME');
  assert.equal(tutorial.launchMode(user, config, { status: 'IN_PROGRESS' }), 'RESUME');
  assert.equal(tutorial.launchMode(user, config, { status: 'COMPLETED' }), 'NONE');
  assert.equal(tutorial.launchMode(user, config, { status: 'SKIPPED' }), 'NONE');
  assert.equal(tutorial.launchMode({ Status: 'PENDING' }, config, { status: 'NOT_STARTED' }), 'NONE');
  assert.equal(tutorial.launchMode({ Status: 'DENIED' }, config, { status: 'IN_PROGRESS' }), 'NONE');
});

test('tutorial guides navigation instead of forcing a page change', () => {
  assert.doesNotMatch(engineSource, /location\.assign\(`\/\$\{step\.page/, 'Tutorial steps must not navigate pages automatically');
  assert.match(engineSource, /showNavigationStep/, 'Tutorial should explain where to navigate');
  assert.match(engineSource, /ace:route-ready/, 'Tutorial should resume after shell navigation');
  assert.match(engineSource, /shell-mobile-open/, 'Tutorial should detect a closed mobile sidebar');
  assert.match(engineSource, /shell-collapsed/, 'Tutorial should detect a collapsed desktop sidebar');
  assert.match(engineSource, /aria-label="Expand sidebar"/, 'Tutorial should recognize an icon-only desktop sidebar from its expand control');
  assert.match(engineSource, /expand it first/, 'Tutorial should teach users to expand a collapsed sidebar before naming a destination');
  assert.match(engineSource, /\.shell-collapse/, 'Tutorial should highlight the collapsed sidebar control before a destination link');
  assert.match(engineSource, /needsSidebarExpand/, 'Tutorial should omit its duplicate navigation action while teaching the actual expand control');
  assert.match(engineSource, /data-tutorial-forced-visible/, 'Tutorial should force the real expand control visible before measuring it');
  assert.match(engineSource, /needsSidebarExpand \? document\.querySelector\('\.shell-collapse'\)/, 'Tutorial should use one sidebar-state decision for both its instruction and target');
  const styles = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(styles, /\.ace-tutorial-target\.shell-collapse/, 'Tutorial should keep the actual sidebar expand control visible while highlighting it');
  assert.match(engineSource, /shell-nav-group-items/, 'Tutorial should detect a closed sidebar group');
  assert.match(engineSource, /navigationTarget/, 'Tutorial should identify the exact sidebar control to use');
  assert.match(engineSource, /ace-tutorial-navigation-overlay/, 'Tutorial navigation overlay should allow sidebar interaction');
});

test('employee time-entry navigation matches the visible sidebar label', () => {
    const context = { window: {} };
    vm.runInNewContext(configSource, context);
    const timeEntries = context.window.ACETutorialConfig.USER.steps.find(step => step.page === 'time-entries.html');
    assert.equal(timeEntries.navigation.label, 'My time entries');
    assert.equal(timeEntries.navigation.group, 'Work');
});

test('restarting a tutorial teaches users how to return to the dashboard first', () => {
  const context = { window: {} };
  vm.runInNewContext(configSource, context);
  for (const tutorial of Object.values(context.window.ACETutorialConfig)) {
    const firstStep = tutorial.steps[0];
    assert.equal(firstStep.navigation.label, 'Dashboard');
    assert.equal(firstStep.navigation.group, 'Workspace');
  }
});
