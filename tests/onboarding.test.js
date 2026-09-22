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
      // The configuration deliberately uses simple IDs, making this both a
      // complete syntax check and easy to maintain without a browser DOM.
      assert.match(step.target, /^#[A-Za-z][A-Za-z0-9_-]*$/, `${role}: ${step.target}`);
    }
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
