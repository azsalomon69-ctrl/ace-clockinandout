import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../frontend/js/script.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function rickAnimationFrame('), source.indexOf('function mountWorkspaceHelp(')), context);

test('Every state selects an existing frame, including rapid state changes', () => {
  for (let elapsed = 0; elapsed < 32000; elapsed += 37) {
    for (const state of ['idle', 'hover', 'talk', 'walk', 'pickup', 'landing']) {
      const pose = context.rickAnimationFrame(state, elapsed);
      assert.ok(['base', 'attention'].includes(pose.sheet));
      assert.ok(Number.isInteger(pose.frame) && pose.frame >= 0 && pose.frame <= 3);
    }
  }
});

test('Walking alternates four foot positions without replacing the approved body', () => {
  assert.deepEqual([0, 180, 360, 540].map(time => context.rickAnimationFrame('walk', time).step), [0, 1, 2, 3]);
  assert.equal(context.rickAnimationFrame('walk', 720).step, 0);
});

test('Hover finishes facing forward; idle includes both glances and a blink', () => {
  assert.equal(context.rickAnimationFrame('hover', 0).frame, 2);
  assert.equal(context.rickAnimationFrame('hover', 200).frame, 3);
  assert.equal(context.rickAnimationFrame('hover', 1600).sheet, 'base');
  assert.equal(context.rickAnimationFrame('hover', 1600).frame, 0);
  assert.equal(context.rickAnimationFrame('idle', 1300).sheet, 'attention');
  assert.equal(context.rickAnimationFrame('idle', 2700).frame, 1);
  assert.equal(context.rickAnimationFrame('idle', 4050).sheet, 'base');
  assert.equal(context.rickAnimationFrame('idle', 4050).frame, 1);
});

test('Reduced motion retains a static visible pose and pickup expression', () => {
  for (const state of ['idle', 'hover', 'talk', 'walk']) {
    const pose = context.rickAnimationFrame(state, 4050, true);
    assert.equal(pose.sheet, 'base');
    assert.equal(pose.frame, 0);
  }
  assert.equal(context.rickAnimationFrame('pickup', 0, true).frame, 3);
});
