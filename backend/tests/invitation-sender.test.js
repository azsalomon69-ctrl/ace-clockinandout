import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../server/index.js',import.meta.url),'utf8');
const senderSource=source.slice(source.indexOf('const invitationSender ='),source.indexOf('const invitationMailIssue ='));
function harness(env,gmail=true){const messages=[];const context={process:{env},smtpUser:'smtp@example.test',gmailConfigured:gmail,mailTransport:{sendMail:async m=>messages.push(m)},sendWithGmailApi:async m=>messages.push(m),buildInvitationEmail:()=>({subject:'Invitation',text:'Hello',html:'<p>Hello</p>'})};vm.createContext(context);vm.runInContext(senderSource+';this.send=sendInvitationEmail;this.sender=invitationSender;',context);return {context,messages};}
test('both mail transports use ACE Outsource while retaining the configured sender address',async()=>{
 for(const gmail of [true,false])for(const env of [{GMAIL_FROM:'it@example.test'},{GMAIL_FROM:'Old Name <it@example.test>'},{SMTP_FROM:'"IT Team" <team@example.test>'},{}]){
 const h=harness(env,gmail);await h.context.send({email:'employee@example.test',role:'USER'});
 const expected=env.GMAIL_FROM?'it@example.test':env.SMTP_FROM?'team@example.test':'smtp@example.test';
 assert.equal(h.messages[0].from,`"ACE Outsource" <${expected}>`);assert.equal(h.messages[0].to,'employee@example.test');
 }
});
test('sender address selection retains Gmail precedence and rejects malformed headers',()=>{
 assert.equal(harness({GMAIL_FROM:'gmail@example.test',SMTP_FROM:'smtp@example.test'}).context.sender(),'"ACE Outsource" <gmail@example.test>');
 for(const address of ['it@example.test\r\nBcc: other@example.test','invalid','it@example.test,other@example.test'])assert.throws(()=>harness({GMAIL_FROM:address}).context.sender(),/Invalid invitation sender/);
});
