import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const start = source.indexOf('const emailHeader =');
const end = source.indexOf('const gmailApiError =');
const { emailHeader } = vm.runInNewContext(`${source.slice(start, end)}\n({ emailHeader });`, { Buffer });

test('invitation email headers are newline-safe and RFC 2047 encode non-ASCII text', () => {
  assert.equal(emailHeader('ACE Clock\r\nBcc: attacker@example.test'), 'ACE Clock Bcc: attacker@example.test');
  assert.equal(emailHeader('ACE Clock invitation'), 'ACE Clock invitation');
  assert.equal(emailHeader('You’re invited'), '=?UTF-8?B?WW914oCZcmUgaW52aXRlZA==?=');
});

test('the visible invitation subject is plain ASCII for every administrator', () => {
  assert.match(source, /subject: `ACE Clock In Out invitation - \$\{roleName\}`/);
  assert.match(source, /`Subject: \$\{emailHeader\(subject\)\}`/);
});
