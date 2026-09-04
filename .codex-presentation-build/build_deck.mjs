import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = 'C:\\Users\\azsal\\OneDrive\\Documents\\ACE Projects\\ACE Clock in Clock out\\ACE-clockinandout';
const SKILL_DIR = 'C:\\Users\\azsal\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.903.11726\\skills\\presentations';
const TMP_DIR = path.join(workspaceDir, '.codex-presentation-build');
const FINAL_PPTX = path.join(workspaceDir, 'deliverables', 'ACE-Clock-In-Out-System-Walkthrough-v2.pptx');
const RUNTIME_PYTHON = 'C:\\Users\\azsal\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);

const W = 1280, H = 720;
const C = { ink:'#063B4B', ink2:'#0A4A5C', cyan:'#0B97B5', cyan2:'#19B8D0', blue:'#1769D8', pale:'#E8F8FB', bg:'#F7FCFD', line:'#CFE8EE', muted:'#55727C', white:'#FFFFFF', soft:'#EDF5F7', black:'#021C26' };
const F_HEAD = 'Montserrat';
const F_BODY = 'Open Sans';
const asset = rel => path.join(workspaceDir, rel);
const bytes = async rel => new Uint8Array(await fs.readFile(asset(rel)));
const fabric = await bytes('assets/images/ace-fabric-master-v1.png');
const office = await bytes('assets/images/ace-operations-office-v1.png');
const logoWhite = await bytes('assets/images/ace-logo-white.png');
const logoColor = await bytes('assets/images/ace-logo-hd-cropped.png');
const iconCache = new Map();
async function icon(name){ if(!iconCache.has(name)) iconCache.set(name, await bytes(`assets/icons/${name}.svg`)); return iconCache.get(name); }

const p = Presentation.create({ slideSize:{ width:W, height:H } });

function rect(slide,x,y,w,h,fill,line='none',radius=0){ return slide.shapes.add({ geometry: radius ? 'roundRect':'rect', position:{left:x,top:y,width:w,height:h}, fill, line: line==='none'?{fill:'none',width:0}:{style:'solid',fill:line,width:1}, ...(radius?{borderRadius:radius}:{}) }); }
function text(slide, value, x,y,w,h, size=20, color=C.ink, bold=false, align='left', font=F_BODY){
  const s=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  s.text=value;
  s.text.style={typeface:font,fontSize:size,color,bold,alignment:align,verticalAlignment:'middle',autoFit:'shrinkText'};
  return s;
}
function line(slide,x,y,w,color=C.line,width=2){ return slide.shapes.add({geometry:'line',position:{left:x,top:y,width:w,height:0},fill:'none',line:{style:'solid',fill:color,width}}); }
async function addIcon(slide,name,x,y,size=34,bg=C.pale){ rect(slide,x,y,size,size,bg,'none',9); slide.images.add({blob:await icon(name),contentType:'image/svg+xml',alt:`${name} icon`,fit:'contain',position:{left:x+7,top:y+7,width:size-14,height:size-14}}); }
function addLogo(slide,dark=false){ slide.images.add({blob:dark?logoWhite:logoColor,contentType:'image/png',alt:'ACE Outsource Solutions',fit:'contain',position:{left:1110,top:34,width:105,height:52}}); }
function addPage(slide,n,dark=false){ text(slide,String(n).padStart(2,'0'),1160,662,54,24,12,dark?'#A9D7DF':C.muted,true,'right',F_HEAD); }
function title(slide,t,sub,n,{dark=false}={}){
  const color=dark?C.white:C.ink, muted=dark?'#B9D8DE':C.muted;
  text(slide,t,64,42,970,56,34,color,true,'left',F_HEAD);
  if(sub) text(slide,sub,64,99,980,38,17,muted,false,'left',F_BODY);
  line(slide,64,143,1152,dark?'#2B6574':C.line,2);
  addLogo(slide,dark); addPage(slide,n,dark);
}
function base(light=true){ const s=p.slides.add(); s.background.fill=light?C.bg:C.ink; return s; }
function note(slide,sources){ slide.speakerNotes.textFrame.setText(`Sources inspected for this slide:\n${sources.map(s=>`- ${s}`).join('\n')}`); }
function stat(slide,number,label,x,y,w=220){ text(slide,number,x,y,w,48,32,C.cyan,true,'left',F_HEAD); text(slide,label,x,y+47,w,36,15,C.muted,true,'left',F_BODY); }
function flowNode(slide,num,label,detail,x,y,w=180,h=124,color=C.cyan){
  rect(slide,x,y,w,h,C.white,C.line,13); rect(slide,x,y,7,h,color,'none',8);
  text(slide,String(num).padStart(2,'0'),x+22,y+16,48,22,12,color,true,'left',F_HEAD);
  text(slide,label,x+22,y+42,w-38,32,19,C.ink,true,'left',F_HEAD);
  text(slide,detail,x+22,y+77,w-38,h-86,12,C.muted,false,'left',F_BODY); return {x,y,w,h};
}
function arrow(slide,x,y,w,color=C.cyan){ slide.shapes.add({geometry:'rightArrow',position:{left:x,top:y,width:w,height:20},fill:color,line:{fill:'none',width:0}}); }
function sectionLabel(slide,label,x,y,color=C.cyan){ text(slide,label.toUpperCase(),x,y,300,22,11,color,true,'left',F_HEAD); }
function roleBand(slide,label,items,x,y,w,color){
  text(slide,label,x,y,w,34,23,color,true,'left',F_HEAD); line(slide,x,y+42,w,color,3);
  items.forEach((item,i)=>{ text(slide,item,x,y+58+i*43,w,33,16,C.ink,i===0,'left',F_BODY); });
}

// 1 Cover
{
 const s=base(false);
 s.images.add({blob:fabric,contentType:'image/png',alt:'Dark navy fabric background',fit:'cover',position:{left:0,top:0,width:W,height:H}});
 rect(s,0,0,W,H,'#062F3ECC','none');
 s.images.add({blob:logoWhite,contentType:'image/png',alt:'ACE Outsource Solutions',fit:'contain',position:{left:72,top:62,width:160,height:95}});
 sectionLabel(s,'System walkthrough',72,190,C.cyan2);
 text(s,'ACE Clock In / Out',72,222,820,74,48,C.white,true,'left',F_HEAD);
 text(s,'How the workforce time tracking platform works',72,302,790,50,25,'#C4E2E7',false,'left',F_BODY);
 line(s,72,390,235,C.cyan2,5);
 text(s,'Frontend, API, authentication, data model, reports, and operational controls',72,416,770,70,18,'#C4E2E7',false,'left',F_BODY);
 text(s,'ACE Outsource Solutions',72,642,360,28,14,C.white,true,'left',F_HEAD);
 note(s,['README.md','index.html','server/index.js','supabase/schema.sql']);
}

// 2 Scope
{
 const s=base(); title(s,'What the platform covers','A single internal workspace for employees and administrators',2);
 stat(s,'19','HTML pages',66,180,190); stat(s,'49','API routes',302,180,190); stat(s,'12','database table definitions',538,180,260); stat(s,'2','role experiences',846,180,230);
 line(s,64,284,1152,C.line,2);
 roleBand(s,'Employee workspace',['Clock in and out','Review personal entries','Read administrator remarks','Message active employees'],70,320,500,C.cyan);
 roleBand(s,'Administrator workspace',['Monitor team activity','Manage access and assignments','Review, remark, archive, and restore','Generate reports and inspect audit history'],690,320,520,C.blue);
 note(s,['All 19 *.html files','server/index.js','js/script.js','js/admin-sections.js']);
}

// 3 End-to-end flow
{
 const s=base(); title(s,'End-to-end operating flow','From account access to an auditable report',3);
 const nodes=[
  ['Access','Invitation or Google access request'],['Authenticate','Supabase verifies the Google session'],['Authorize','Role and status determine the workspace'],['Track','Employee opens and completes time entries'],['Review','Administrators manage records and remarks'],['Report','Filtered PDF output and export history']
 ];
 nodes.forEach((n,i)=>{flowNode(s,i+1,n[0],n[1],50+i*202,235,172,150,i===5?C.blue:C.cyan); if(i<5) arrow(s,224+i*202,298,25,i===4?C.blue:C.cyan);});
 text(s,'Every protected action passes through the API. Important changes create an audit event.',64,450,1152,52,22,C.ink,true,'center',F_HEAD);
 text(s,'The same flow supports an invited employee, a pending access request, or an administrator account.',150,515,980,46,16,C.muted,false,'center',F_BODY);
 note(s,['README.md','server/index.js: authenticate/adminOnly/activeOnly middleware','supabase/schema.sql: profile trigger and audit trigger']);
}

// 4 Sign in
{
 const s=base(false); title(s,'Sign-in and access approval','The current interface uses Google authentication through Supabase',4,{dark:true});
 s.images.add({blob:office,contentType:'image/png',alt:'Dark ACE operations office environment',fit:'cover',geometry:'roundRect',borderRadius:18,position:{left:64,top:178,width:520,height:430}});
 rect(s,64,178,520,430,'#032C3BB8','none',18);
 text(s,'Google session',104,218,390,44,28,C.white,true,'left',F_HEAD);
 text(s,'The browser receives a Supabase session and sends its bearer token to the Render API.',104,276,390,94,18,'#C4E2E7',false,'left',F_BODY);
 const steps=[['01','Invited email','The profile activates automatically when the invitation is valid.'],['02','Uninvited account','The profile remains pending and can submit a two-minute access request.'],['03','Administrator review','Approval sets the role, department, and ACTIVE status.']];
 steps.forEach((v,i)=>{text(s,v[0],642,194+i*126,48,28,13,C.cyan2,true,'left',F_HEAD); text(s,v[1],700,188+i*126,450,32,21,C.white,true,'left',F_HEAD); text(s,v[2],700,224+i*126,450,64,15,'#B9D8DE',false,'left',F_BODY);});
 note(s,['login.html','js/script.js: handleGoogleLogin and beginGoogleAccessRequest','server/index.js: /v1/access-requests and /v1/invitations','supabase/schema.sql: create_profile_for_auth_user']);
}

// 5 Employee workspace
{
 const s=base(); title(s,'Employee workspace','A focused view of the current shift and personal work history',5);
 await addIcon(s,'timer',72,184,48); text(s,'Current shift',138,178,340,36,23,C.ink,true,'left',F_HEAD); text(s,'Live clock, active status, clock-in time, and running duration.',138,216,420,54,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'chart-column-big',72,304,48); text(s,'Time at a glance',138,298,340,36,23,C.ink,true,'left',F_HEAD); text(s,'Completed hours for today, the week, the month, and the total number of entries.',138,336,420,68,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'folder',72,442,48); text(s,'Assigned work',138,436,340,36,23,C.ink,true,'left',F_HEAD); text(s,'Projects appear as optional choices when the employee starts a session.',138,474,420,54,16,C.muted,false,'left',F_BODY);
 rect(s,630,182,540,360,C.ink,'none',20); text(s,'READY WHEN YOU ARE',672,220,300,22,11,C.cyan2,true,'left',F_HEAD); text(s,'9:02:14 AM',672,260,430,72,48,C.white,true,'left',F_HEAD); text(s,'Not clocked in',676,337,200,28,15,'#B9D8DE',true,'left',F_BODY); rect(s,904,395,206,56,C.cyan,'none',10); text(s,'Clock in',904,395,206,56,18,C.white,true,'center',F_HEAD); text(s,'Recent activity, administrator remarks, and projects continue below the shift area.',672,475,430,54,15,'#B9D8DE',false,'left',F_BODY);
 note(s,['user-dashboard.html','js/script.js: loadUserDashboard, startTimer, updateTimerDisplay']);
}

// 6 Clocking
{
 const s=base(); title(s,'Clock-in and clock-out lifecycle','The database keeps one open entry per employee',6);
 flowNode(s,1,'Choose work','Select an optional project and add an optional starting note.',70,212,230,176,C.cyan);
 arrow(s,310,286,44);
 flowNode(s,2,'Start timer','The API checks for an existing open entry, records the device, and writes CLOCK_IN.',364,212,230,176,C.cyan);
 arrow(s,604,286,44);
 flowNode(s,3,'Track session','The frontend timer continues from the server timestamp. Presence heartbeat updates last seen.',658,212,230,176,C.blue);
 arrow(s,898,286,44,C.blue);
 flowNode(s,4,'Complete entry','Clock-out requires a note. PostgreSQL calculates duration from the two timestamps.',952,212,230,176,C.blue);
 text(s,'Database guard',76,456,200,28,17,C.cyan,true,'left',F_HEAD); text(s,'A partial unique index prevents a second open entry for the same user.',76,489,480,56,16,C.muted,false,'left',F_BODY);
 text(s,'Traceability',664,456,200,28,17,C.blue,true,'left',F_HEAD); text(s,'Clock events record whether the action came from mobile or PC web.',664,489,470,56,16,C.muted,false,'left',F_BODY);
 note(s,['server/index.js: /v1/time-entries/clock-in and /clock-out','supabase/schema.sql: time_entries and one_open_entry_per_user','js/script.js: handleClockIn, handleClockOut, startPresenceHeartbeat']);
}

// 7 Employee records and chat
{
 const s=base(false); title(s,'Employee records and collaboration','Employees see their own time, remarks, and active coworkers',7,{dark:true});
 const cols=[
  ['file-text','Personal entries','Date, project, status, duration, note, and administrator remarks.'],
  ['message-circle-more','Employee chat','Active employees can send, edit, read, and soft-delete direct messages.'],
  ['calendar-days','Planned end time','The data model supports a planned session end for scheduled clock-out work.']
 ];
 for(let i=0;i<3;i++){const x=68+i*402; await addIcon(s,cols[i][0],x,190,48,C.pale); text(s,cols[i][1],x,258,350,38,23,C.white,true,'left',F_HEAD); text(s,cols[i][2],x,304,340,110,16,'#B9D8DE',false,'left',F_BODY); line(s,x,438,330,i===1?C.blue:C.cyan2,4);}
 text(s,'Privacy boundary',68,500,300,34,21,C.cyan2,true,'left',F_HEAD); text(s,'Employees can only open conversations with other ACTIVE employees. The browser has no direct table policy for messages.',68,540,1080,58,17,'#C4E2E7',false,'left',F_BODY);
 note(s,['time-entries.html','remarks.html','js/script.js: initializeEmployeeChat and loadTimeEntries','server/index.js: employee chat routes','supabase/employee-chat.sql','supabase/scheduled-time-entries.sql']);
}

// 8 Admin overview
{
 const s=base(); title(s,'Administrator overview','Team activity and decisions share one dashboard',8);
 text(s,'Team performance',68,180,420,42,28,C.ink,true,'left',F_HEAD);
 text(s,'Date range, department, project, and employee filters drive the analytics view and its report output.',68,230,430,80,17,C.muted,false,'left',F_BODY);
 const bars=[82,56,92,68,38,76,62]; bars.forEach((h,i)=>{rect(s,86+i*54,454-h,32,h,i===2?C.blue:C.cyan,'none',5); text(s,['M','T','W','T','F','S','S'][i],80+i*54,462,44,24,12,C.muted,true,'center',F_BODY);}); line(s,72,455,404,C.line,2);
 text(s,'Weekly tracked hours',72,326,320,28,15,C.ink,true,'left',F_HEAD);
 await addIcon(s,'users',612,188,50); text(s,'People',680,184,400,34,22,C.ink,true,'left',F_HEAD); text(s,'Total users, active now, and pending approvals.',680,222,430,42,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'folder',612,310,50); text(s,'Work allocation',680,306,400,34,22,C.ink,true,'left',F_HEAD); text(s,'Project mix and team activity support operational review.',680,344,430,42,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'file-text',612,432,50); text(s,'Report handoff',680,428,400,34,22,C.ink,true,'left',F_HEAD); text(s,'The same filter state can generate a TEAM_PERFORMANCE report.',680,466,430,54,16,C.muted,false,'left',F_BODY);
 note(s,['admin-dashboard.html','js/script.js: initializeAnalyticsRangePicker, renderAdminAnalytics, generateAdminAnalyticsReport']);
}

// 9 People and access
{
 const s=base(); title(s,'People and access administration','Administrators control account status, role, department, and projects',9);
 const y=202;
 const n1=flowNode(s,1,'Pre-authorize','Invite an email and choose employee or administrator access.',54,y,210,160,C.cyan); arrow(s,270,272,34);
 const n2=flowNode(s,2,'Approve','Review pending Google access requests before they expire.',312,y,210,160,C.cyan); arrow(s,528,272,34);
 const n3=flowNode(s,3,'Assign','Set the department and add any number of project assignments.',570,y,210,160,C.blue); arrow(s,786,272,34,C.blue);
 const n4=flowNode(s,4,'Maintain','Change role, archive access, restore the account, or permanently remove login.',828,y,318,160,C.blue);
 line(s,64,424,1080,C.line,2);
 text(s,'Safeguards',64,456,200,30,20,C.ink,true,'left',F_HEAD);
 text(s,'An administrator cannot remove their own account. The system also prevents demoting or archiving the last active administrator.',64,494,1080,58,17,C.muted,false,'left',F_BODY);
 note(s,['users.html','access-requests.html','invitations.html','deleted-users.html','server/index.js: user approval, role, department, project, archive, restore, permanent delete routes']);
}

// 10 Departments and projects
{
 const s=base(false); title(s,'Departments and projects','Department membership stays optional while project assignment supports many-to-many work',10,{dark:true});
 rect(s,90,208,255,140,'#0E5263','#2E7180',16); text(s,'DEPARTMENT',116,226,200,20,11,C.cyan2,true,'left',F_HEAD); text(s,'Operations',116,258,200,40,27,C.white,true,'left',F_HEAD); text(s,'Optional on each profile',116,306,200,24,14,'#B9D8DE',false,'left',F_BODY);
 rect(s,505,188,270,180,C.white,'none',16); text(s,'EMPLOYEE',535,210,200,20,11,C.cyan,true,'left',F_HEAD); text(s,'Profile',535,244,210,42,29,C.ink,true,'left',F_HEAD); text(s,'Role · Status · Last seen',535,294,210,24,14,C.muted,false,'left',F_BODY); text(s,'No department is valid',535,328,210,24,14,C.muted,false,'left',F_BODY);
 rect(s,935,208,255,140,'#124D78','#326FA6',16); text(s,'PROJECTS',961,226,200,20,11,'#A9D8FF',true,'left',F_HEAD); text(s,'Multiple',961,258,200,40,27,C.white,true,'left',F_HEAD); text(s,'Optional per time entry',961,306,200,24,14,'#C9E1F7',false,'left',F_BODY);
 arrow(s,365,265,100,C.cyan2); arrow(s,795,265,100,C.blue);
 text(s,'Department assignment',90,430,300,30,19,C.cyan2,true,'left',F_HEAD); text(s,'One profile can belong to zero or one department.',90,468,340,58,16,'#B9D8DE',false,'left',F_BODY);
 text(s,'Project assignment',505,430,300,30,19,C.white,true,'left',F_HEAD); text(s,'The user_projects join table connects employees to any number of projects.',505,468,340,72,16,'#B9D8DE',false,'left',F_BODY);
 text(s,'Recorded work',935,430,260,30,19,'#A9D8FF',true,'left',F_HEAD); text(s,'Each time entry can reference one project or remain unassigned.',935,468,270,72,16,'#C9E1F7',false,'left',F_BODY);
 note(s,['departments.html','projects.html','server/index.js: department/project/user-project routes','supabase/schema.sql: departments, projects, profiles, user_projects, time_entries']);
}

// 11 Time review and remarks
{
 const s=base(); title(s,'Time review, remarks, and deleted data','Operational corrections stay recoverable until an administrator chooses permanent deletion',11);
 await addIcon(s,'eye',78,194,50); text(s,'Review',146,190,250,34,23,C.ink,true,'left',F_HEAD); text(s,'Administrators inspect employee, project, timestamps, duration, note, and status.',146,230,390,70,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'message-circle-more',78,330,50); text(s,'Remark',146,326,250,34,23,C.ink,true,'left',F_HEAD); text(s,'Administrator remarks remain separate from the employee clock-out note.',146,366,390,62,16,C.muted,false,'left',F_BODY);
 await addIcon(s,'trash',78,466,50); text(s,'Archive',146,462,250,34,23,C.ink,true,'left',F_HEAD); text(s,'Soft deletion removes an entry from dashboards and reports while preserving recovery.',146,502,390,66,16,C.muted,false,'left',F_BODY);
 rect(s,666,188,460,330,C.soft,'none',20); text(s,'Deleted time entry',710,226,370,34,24,C.ink,true,'left',F_HEAD); text(s,'Restore',710,300,145,42,19,C.cyan,true,'left',F_HEAD); text(s,'Returns the entry to normal views.',710,342,330,34,15,C.muted,false,'left',F_BODY); line(s,710,396,330,C.line,2); text(s,'Delete permanently',710,422,240,42,19,C.blue,true,'left',F_HEAD); text(s,'Allowed only after the entry has been archived.',710,464,340,42,15,C.muted,false,'left',F_BODY);
 note(s,['admin-time-entries.html','deleted-time-entries.html','remarks.html','server/index.js: remark/delete/restore/permanent routes','supabase/soft-delete-time-entries.sql']);
}

// 12 Reporting
{
 const s=base(); title(s,'Reports and PDF output','Admin filters produce a stored report record and a print-ready chart document',12);
 const labels=[['funnel','Filter','Date range, department, project, or employee'],['chart-column-big','Analyze','Daily hours, project allocation, totals, and averages'],['file-text','Preview','ACE-branded A4 report with detailed entries'],['printer','Export','Browser PDF output and a report_exports record']];
 for(let i=0;i<4;i++){const x=54+i*304; await addIcon(s,labels[i][0],x,198,48); text(s,labels[i][1],x,260,250,34,22,C.ink,true,'left',F_HEAD); text(s,labels[i][2],x,302,250,82,15,C.muted,false,'left',F_BODY); if(i<3) arrow(s,x+252,275,36,i<2?C.cyan:C.blue);}
 line(s,64,426,1152,C.line,2);
 text(s,'Stored report',72,466,250,30,19,C.cyan,true,'left',F_HEAD); text(s,'Type, date range, filters, creator, generated time, and record count.',72,504,330,68,16,C.muted,false,'left',F_BODY);
 text(s,'PDF contents',466,466,250,30,19,C.ink,true,'left',F_HEAD); text(s,'Summary metrics, tracked hours by day, hours by project, and time-entry detail.',466,504,350,68,16,C.muted,false,'left',F_BODY);
 text(s,'Export history',884,466,250,30,19,C.blue,true,'left',F_HEAD); text(s,'File type, file name, URL when available, exporter, and timestamp.',884,504,300,68,16,C.muted,false,'left',F_BODY);
 note(s,['reports.html','admin-dashboard.html','js/script.js: handleGenerateReport, renderGeneratedReport, printGeneratedReport','server/index.js: reports and exports routes','supabase/schema.sql: reports and report_exports']);
}

// 13 Audit and governance
{
 const s=base(false); title(s,'Audit history and restricted oversight','The system records important actions and protects sensitive operational records',13,{dark:true});
 const actions=['LOGIN / LOGOUT','CLOCK_IN / CLOCK_OUT','APPROVE / DENY','CREATE / UPDATE / DELETE','GENERATE / EXPORT'];
 actions.forEach((a,i)=>{text(s,String(i+1).padStart(2,'0'),72,190+i*72,48,28,13,i<2?C.cyan2:'#79AEFF',true,'left',F_HEAD); text(s,a,130,184+i*72,360,38,20,C.white,true,'left',F_HEAD); line(s,130,229+i*72,350,'#2B6574',1);});
 text(s,'Each audit record can retain',610,186,480,34,24,C.white,true,'left',F_HEAD);
 const fields=['Actor','Entity and record ID','Description','IP address','User agent','Created timestamp'];
 fields.forEach((f,i)=>{rect(s,610+(i%2)*270,244+Math.floor(i/2)*86,238,56,'#0E5263','#2E7180',10); text(s,f,626+(i%2)*270,244+Math.floor(i/2)*86,206,56,16,'#D7EEF2',true,'left',F_BODY);});
 text(s,'Database rule',610,522,170,26,16,C.cyan2,true,'left',F_HEAD); text(s,'A trigger blocks updates and deletions from audit_logs. The administrator chat log has an additional account-level restriction.',610,554,520,62,15,'#B9D8DE',false,'left',F_BODY);
 note(s,['audit-logs.html','chat-log.html','server/index.js: audit helper and /v1/admin/chat-log','supabase/schema.sql: audit_logs and prevent_audit_log_changes']);
}

// 14 Architecture
{
 const s=base(); title(s,'System architecture','The browser never receives the Supabase secret key',14);
 const a=flowNode(s,1,'Vercel frontend','Static HTML, shared CSS, browser JavaScript, Supabase client session.',60,220,280,190,C.cyan);
 const b=flowNode(s,2,'Render API','Node.js and Express validate tokens, roles, inputs, and business rules.',500,220,280,190,C.cyan);
 const c=flowNode(s,3,'Supabase','Google Auth, PostgreSQL, server-side access, triggers, and RLS.',940,220,280,190,C.blue);
 arrow(s,365,300,105,C.cyan); arrow(s,805,300,105,C.blue);
 text(s,'Bearer access token',350,260,140,28,13,C.muted,true,'center',F_BODY); text(s,'Server-only key',790,260,140,28,13,C.muted,true,'center',F_BODY);
 text(s,'Production protections',64,474,260,30,20,C.ink,true,'left',F_HEAD);
 text(s,'Helmet response headers, explicit CORS origins, JSON size limits, input validation, and centralized error responses.',64,514,1090,60,17,C.muted,false,'left',F_BODY);
 note(s,['README.md','js/api-config.js','js/supabase-auth.js','server/index.js: setup, authenticate, middleware, error handler','vercel.json','render.yaml']);
}

// 15 Data model
{
 const s=base(); title(s,'Data model by business domain','Twelve table definitions preserve identity, work, communication, and governance',15);
 sectionLabel(s,'Identity and access',72,178,C.cyan); text(s,'profiles\ndepartments\ninvitations\naccess_requests',72,214,230,144,18,C.ink,true,'left',F_BODY);
 sectionLabel(s,'Work structure',360,178,C.cyan); text(s,'projects\nuser_projects\ntime_entries',360,214,230,116,18,C.ink,true,'left',F_BODY);
 sectionLabel(s,'Collaboration',648,178,C.blue); text(s,'admin_remarks\nemployee_messages',648,214,230,88,18,C.ink,true,'left',F_BODY);
 sectionLabel(s,'Reporting and control',936,178,C.blue); text(s,'reports\nreport_exports\naudit_logs',936,214,230,116,18,C.ink,true,'left',F_BODY);
 line(s,64,386,1152,C.line,2);
 text(s,'Key relationships',72,424,250,32,22,C.ink,true,'left',F_HEAD);
 text(s,'profiles own time entries and reports',72,470,390,30,16,C.muted,false,'left',F_BODY);
 text(s,'user_projects connects people and projects',72,506,390,30,16,C.muted,false,'left',F_BODY);
 text(s,'remarks attach to time entries',500,470,330,30,16,C.muted,false,'left',F_BODY);
 text(s,'exports attach to reports',500,506,330,30,16,C.muted,false,'left',F_BODY);
 text(s,'audit logs reference actors and entities',874,470,330,30,16,C.muted,false,'left',F_BODY);
 text(s,'employee messages connect two profiles',874,506,330,30,16,C.muted,false,'left',F_BODY);
 note(s,['supabase/schema.sql','supabase/employee-chat.sql']);
}

// 16 Security + deployment
{
 const s=base(false); title(s,'Security and deployment checklist','The repository separates public configuration from server-only authority',16,{dark:true});
 const left=[['shield','Authentication','Supabase validates every bearer token before protected routes run.'],['key-round','Authorization','ACTIVE, ADMIN, USER, and restricted-admin checks guard the API.'],['brick-wall-shield','Data protection','RLS, immutable audit logs, unique constraints, and server-side validation limit unsafe states.']];
 for(let i=0;i<3;i++){await addIcon(s,left[i][0],68,188+i*126,48,C.pale); text(s,left[i][1],136,184+i*126,360,32,21,C.white,true,'left',F_HEAD); text(s,left[i][2],136,220+i*126,400,68,15,'#B9D8DE',false,'left',F_BODY);}
 text(s,'Deployment sequence',690,184,420,38,26,C.white,true,'left',F_HEAD);
 const deploy=['Run the Supabase schema and feature patches','Configure Google Auth and redirect URLs','Set Render secrets and allowed frontend origins','Deploy the static frontend to Vercel','Seed the first administrator and verify /health'];
 deploy.forEach((d,i)=>{text(s,String(i+1),690,242+i*66,34,34,15,C.ink,true,'center',F_HEAD); rect(s,690,242+i*66,34,34,i<3?C.cyan2:'#79AEFF','none',17).sendToBack(); text(s,d,742,236+i*66,420,46,16,C.white,i===4,'left',F_BODY);});
 text(s,'Current sign-in path: Google account approved through invitation or administrator review.',68,606,1080,34,16,'#D3E9ED',true,'left',F_BODY);
 note(s,['README.md','.env.example','scripts/seed-admin.js','render.yaml','vercel.json','server/index.js','supabase/*.sql']);
}

await fs.mkdir(path.join(workspaceDir,'.codex-finalizer'),{recursive:true});
await fs.mkdir(path.dirname(FINAL_PPTX),{recursive:true});
const candidatePath=path.join(workspaceDir,'.codex-finalizer','ace-system-walkthrough-candidate.pptx');
await (await PresentationFile.exportPptx(p)).save(candidatePath);

const requirements={
  explicitTotalSlideCount:16,
  requiredNativeTableOwnerSlides:[],
  requiredNativeChartOwnerSlides:[],
  materializeLiteralChartWorkbooks:false
};
const result=await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath:FINAL_PPTX,
  pythonExecutable:RUNTIME_PYTHON,
  integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],
  fontPolicy:{basis:'user_request',families:[F_HEAD,F_BODY]},
  verifyArtifactToolImport:true,
  receiptPath:path.join(workspaceDir,'.codex-finalizer','ACE-Clock-In-Out-System-Walkthrough-v2.validation.json')
});
console.log(JSON.stringify({final:FINAL_PPTX,result},null,2));
