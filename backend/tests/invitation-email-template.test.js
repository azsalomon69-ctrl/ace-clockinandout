import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
function template(origin='https://workspace.example.test'){
 const escape=source.slice(source.indexOf('const htmlEscape ='),source.indexOf('const optionalText ='));
 const fn=source.slice(source.indexOf('const buildInvitationEmail ='),source.indexOf('const sendInvitationEmail ='));
 return vm.runInNewContext(escape+'\n'+fn+'\nbuildInvitationEmail;', {applicationUrl:origin});
}
test('employee and admin invitations preserve configured login URL in HTML, Outlook button and plain text',()=>{
 for(const role of ['USER','ADMIN']){
  const mail=template()({email:'person@example.test',role,invitedBy:'A Person'});
  assert.ok(mail.html.includes('href="https://workspace.example.test/login"'));
  assert.ok(mail.html.includes('<v:roundrect href="https://workspace.example.test/login"'));
  assert.ok(mail.text.includes('Open ACE Clock: https://workspace.example.test/login'));
  assert.ok(mail.text.includes('Your Google account: person@example.test'));
  assert.ok(mail.html.includes('person@example.test'));
  assert.ok(mail.html.includes(role==='ADMIN'?'Open your admin workspace':'Start your first shift'));
  assert.ok(mail.text.includes(role==='ADMIN'?'Open your admin workspace':'Start your first shift'));
  assert.ok(!mail.html.includes('${'));
 }
});
test('invitation dynamic fields are HTML escaped and remain readable in plain text',()=>{
 const mail=template()({email:'a&b@example.test',role:'USER',invitedBy:'<img src=x onerror=alert(1)> & Admin'});
 assert.ok(mail.html.includes('a&amp;b@example.test'));
 assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; Admin'));
 assert.ok(!mail.html.includes('<img src=x'));
 assert.ok(mail.text.includes('a&b@example.test'));
});
test('email essentials are HTML text and brand assets follow the configured frontend origin',()=>{
 const mail=template()({email:'person@example.test',role:'USER'});
 assert.ok(mail.html.includes('Your workspace<br>is ready.'));
 assert.ok(mail.html.includes('https://workspace.example.test/assets/images/ace-logo.png'));
 assert.ok(mail.html.includes('https://workspace.example.test/assets/images/invitation-clock.png'));
 assert.ok(mail.html.includes('alt="ACE"'));
 assert.ok(mail.html.includes('Use this exact account'));
 assert.ok(mail.html.includes('prefers-color-scheme:dark'));
 assert.ok(mail.text.includes('an ACE administrator'));
});
