// Local-only fixture using production HTML, CSS, JS and clock handlers.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('frontend');
const output = path.resolve(process.env.TEMP || '.', 'ace-dashboard-review-v2');
await fs.mkdir(output, { recursive: true });
const fixture = `
window.fixtureCalls=[];
const now = new Date(); const day = new Date(now); day.setHours(0,0,0,0);
const rawEntries = [{id:'completed',user_id:'employee',clock_in_at:new Date(+day+3600000).toISOString(),clock_out_at:new Date(+day+7200000).toISOString(),duration_seconds:3600,project_id:'project'}];
window.ACEAuth={request:async(url,options={})=>{
 window.fixtureCalls.push({url,options});
 if(url==='/v1/me') return {profile:{id:'employee',full_name:'Alex Rivera',email:'alex@example.test',role:'USER',status:'ACTIVE'}};
 if(url==='/v1/projects') return [{id:'project',name:'Customer support',is_active:true}];
 if(url==='/v1/user-projects') return [{user_id:'employee',project_id:'project'}];
 if(url==='/v1/my-schedule') return {name:'As-needed support',schedule_type:'AS_NEEDED',daily_elapsed_minutes:480,scheduled_weekdays:[]};
 if(url==='/v1/time-entries/clock-in') { const entry={id:'active',user_id:'employee',clock_in_at:new Date().toISOString(),clock_out_at:null,duration_seconds:null,project_id:JSON.parse(options.body).projectId}; rawEntries.unshift(entry); return entry; }
 if(url.includes('/active/clock-out')) { Object.assign(rawEntries[0],{clock_out_at:new Date().toISOString(),duration_seconds:3,final_note:JSON.parse(options.body).note}); return rawEntries[0]; }
 if(url.startsWith('/v1/time-entries?')) return {items:rawEntries,total:rawEntries.length};
 if(url==='/v1/admin-remarks') return [{id:'remark',time_entry_id:'completed',remark:'Thank you for the handover.',created_at:now.toISOString(),seen_at:null,profiles:{full_name:'Team lead'}}];
 return [];
}};
`;
const server = http.createServer(async(req,res)=>{
 try {
 const url=new URL(req.url,'http://localhost');
 let name=url.pathname==='/'?'user-dashboard.html':url.pathname.slice(1);
 if(!path.extname(name)) name+='.html';
 if(name==='fixture.js'){res.setHeader('Content-Type','text/javascript');return res.end(fixture);}
 const target=path.resolve(root,name); if(!target.startsWith(root+path.sep)) {res.writeHead(403);return res.end();}
 let data=await fs.readFile(target);
 if(name.endsWith('.html')) data=data.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>','<script src="/js/initial-skeletons.js"></script><script src="/fixture.js"></script><script src="/js/script.js"></script></body>');
 res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');res.end(data);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(4187,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:"msedge"});
const results=[];
try {
 for(const [label,width,height] of [['laptop',1366,900],['tablet',820,1180],['mobile',390,844]]) {
  for(const theme of ['light','dark']) {
   const context=await browser.newContext({viewport:{width,height},timezoneId:'Asia/Manila',reducedMotion:'reduce',hasTouch:label!=='laptop'});
   const page=await context.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
   await page.addInitScript(theme=>localStorage.setItem('ace_appearance',JSON.stringify({theme})),theme);
   await page.goto('http://127.0.0.1:4187/user-dashboard.html');
   await page.waitForSelector('body.has-app-shell:not(.app-shell-pending)');
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   assert.equal(await page.locator('#mainClockInBtn').isVisible(),true);
   assert.equal(await page.locator('#employeeWeekChart button').count(),7);
   const headings=await page.locator('.dashboard-card-heading').evaluateAll(nodes=>nodes.map(node=>{const h=node.querySelector('h2'),card=node.closest('.dashboard-card'),style=getComputedStyle(card);return {top:Math.round(node.getBoundingClientRect().top-card.getBoundingClientRect().top),padding:parseFloat(style.paddingTop),lines:h.getBoundingClientRect().height/parseFloat(getComputedStyle(h).lineHeight)};}));
   assert(headings.every(h=>Math.abs(h.top-h.padding-1)<2&&h.lines<2.1),'Consistent card heading gutters');
   assert.equal(await page.locator('#weekHours').innerText(),'1h 0m');
   assert.equal(await page.locator('#todayWorked').innerText(),'1h 0m');
   await page.locator('#employeeWeekChart button').first().focus();
   assert.match(await page.locator('#employeeWeekDetail').innerText(),/completed sessions/);
   await page.locator('#employeeWeekChart button').last().click();
   assert.equal(await page.locator('#employeeWeekChart button').last().getAttribute('aria-pressed'),'true');
   await page.locator('.user-dashboard').evaluate(node=>node.scrollTop=0); await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(output,label+'-'+theme+'-idle.png'),fullPage:width>1000});
   await page.locator('#mainClockInBtn').click();
   await page.locator('#clockInModal .ace-select-trigger').click();
   await page.getByRole('option', {name:'Customer support',exact:true}).click();
   await page.locator('#clockInForm button[type=submit]').click();
   await page.waitForSelector('#mainClockOutBtn:visible');
   await page.waitForTimeout(2100);
   assert.notEqual(await page.locator('#sessionStateTime').innerText(),'00:00:00');
   assert.equal(await page.locator('#sessionProjectName').innerText(),'Customer support');
   await page.locator('.user-dashboard').evaluate(node=>node.scrollTop=0); await page.evaluate(()=>scrollTo(0,0));
   await page.screenshot({path:path.join(output,label+'-'+theme+'-notification.png'),fullPage:false});
   if(width<=1000) {
    const overlap=await page.evaluate(()=>{
     const box=s=>document.querySelector(s)?.getBoundingClientRect();const main=box('.user-dashboard'),toast=box('.toast-container'),chat=box('.employee-chat-launcher'),nav=box('.employee-bottom-nav');
     const intersects=(a,b)=>a&&b&&a.width&&b.width&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
     return {mainToast:intersects(main,toast),mainChat:intersects(main,chat),mainNav:intersects(main,nav),toastChat:intersects(toast,chat),chatNav:intersects(chat,nav)};
    });assert.equal(Object.values(overlap).some(Boolean),false,JSON.stringify(overlap));
    if(width<=768)assert.equal(await page.locator('.employee-bottom-nav-item span').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth)),false,'Navigation labels fit');
   }
   await page.getByRole('button',{name:'Dismiss notification'}).click();
   await page.waitForSelector('.toast',{state:'detached'});
   await page.screenshot({path:path.join(output,label+'-'+theme+'-active.png'),fullPage:width>1000});
   if(width<=1000) {
    await page.locator('.employee-week-card').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,label+'-'+theme+'-week.png')});
    await page.locator('.employee-work-grid').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,label+'-'+theme+'-sessions.png')});
    await page.locator('.employee-dashboard-support-grid').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,label+'-'+theme+'-support.png')});
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page overflow');
   await page.locator('#mainClockOutBtn').click();
   await page.locator('#clockOutNote').fill('Finished local test');
   await page.locator('#clockOutForm button[type=submit]').click();
   await page.waitForSelector('#mainClockInBtn:visible');
   assert.equal(await page.locator('.employee-session-detail').isVisible(),false);
   assert.equal(await page.locator('#employeeSessionFacts').isVisible(),false);
   const sectionOverflow=await page.locator('.employee-work-grid > section').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1));
   assert.equal(sectionOverflow,false,'No clipped supporting sections');
   // Exercise zero-data presentation and schedule refresh using existing display state.
   await page.evaluate(()=>{AppState.timeEntries=[];AppState.adminRemarks=[];AppState.userProjects=[];loadUserDashboard();});
   assert.equal(await page.locator('#todayWorked').innerText(),'0h 0m');
   assert.equal(await page.locator('#weekHours').innerText(),'0h 0m');
   assert.equal(await page.locator('#employeeWeekChart button').count(),7);
   await page.locator('.employee-work-grid').scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(output,label+'-'+theme+'-empty.png'),fullPage:width>1000});
   // Open/close the existing chat; no message is sent.
   await page.locator('.employee-chat-launcher').click();
   await page.waitForSelector('#employeeChatPanel:visible');
   if(width<=768) {
    const panel=await page.locator('#employeeChatPanel').boundingBox(),nav=await page.locator('.employee-bottom-nav').boundingBox();
    assert(panel.y+panel.height<=nav.y,'Chat clears navigation');
   }
   await page.locator('.employee-chat-close').click();
   await page.locator('#viewAllEntriesBtn').click();
   await page.waitForURL(/time-entries/);
   await page.waitForSelector('body.has-app-shell:not(.app-shell-pending)');
   await page.waitForFunction(()=>document.querySelector('.time-entries-title')?.textContent==='Time entries');
   assert.equal(await page.locator('.time-entries-title').innerText(),'Time entries');
   assert.deepEqual(errors,[]);
   results.push({label,theme,errors,overflow:false,clockCycle:true});
   await context.close();
  }
 }
 console.log(JSON.stringify({output,results},null,2));
 await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
} finally {await browser.close();server.close();}

