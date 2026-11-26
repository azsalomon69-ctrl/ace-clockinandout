import * as XLSX from 'xlsx';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
export function clientFilters(body = {}, exporting = false) {
 const projects=body.projectIds === undefined ? null : body.projectIds;
 if(projects!==null&&(!Array.isArray(projects)||projects.length>100||projects.some(id=>!uuid(id))))return null;
 if(!day(body.from)||!day(body.to)||body.to<body.from||(Date.parse(body.to)-Date.parse(body.from))/86400000>366)return null;
 const status=body.status||null,page=body.page??1;
 if(![null,'ACTIVE','COMPLETED'].includes(status)||!Number.isInteger(page)||page<1||page>100000)return null;
 return {p_projects:projects===null?null:[...new Set(projects)],p_from:body.from,p_to:body.to,p_status:status,p_page:exporting?1:page,p_size:exporting?10000:25};
}
export const safeSpreadsheetText = value => /^[\s\u0000-\u001f]*[=+\-@]/.test(String(value??'')) ? "'"+value : String(value??'');
export function registerClientRoutes(app,{db,authenticate,adminOnly,fail,audit}) {
 const errors=(res,error)=>{
  if(/CLIENT_ACCESS_REQUIRED|PROJECT_ACCESS_DENIED/.test(error.message))return fail(res,403,'Client project access is unavailable. Refresh your dashboard');
  if(/INVALID_FILTERS|INVALID_PROJECTS/.test(error.message))return fail(res,400,'Choose valid projects and a date range of up to 12 months');
  if(error.message.includes('CLIENT_UNAVAILABLE'))return fail(res,404,'Choose a client account');
  if(error.message.includes('EMPLOYEE_ASSIGNMENT_CONFLICT'))return fail(res,409,'Remove this account’s employee project assignment before granting client access');
  throw error;
 };
 const freshRead=async(req,args)=>{
  const {data,error}=await db.rpc('client_attendance',{p_actor:req.profile.id,...args});
  if(error)throw error;
  return data;
 };
 app.get('/v1/client/projects',authenticate,async(req,res,next)=>{try{
  const {data,error}=await db.rpc('client_projects',{p_actor:req.profile.id});if(error)return errors(res,error);
  res.set('Cache-Control','no-store').json(data);
 }catch(e){next(e);}});
 app.post('/v1/client/attendance/search',authenticate,async(req,res,next)=>{try{
  const args=clientFilters(req.body);if(!args)return fail(res,400,'Choose valid projects, dates and page');
  res.set('Cache-Control','no-store').json(await freshRead(req,args));
 }catch(e){try{errors(res,e);}catch(error){next(error);}}});
 app.post('/v1/client/attendance/export',authenticate,async(req,res,next)=>{try{
  const args=clientFilters(req.body,true);const format=req.body.format;
  if(!args||!['CSV','XLSX'].includes(format))return fail(res,400,'Choose CSV or Excel and valid filters');
  const data=await freshRead(req,args);
  if(data.total>10000)return fail(res,422,'Narrow the date range before exporting more than 10,000 shifts');
  const rows=[['Employee','Project','Clock in (Philippine time)','Clock out (Philippine time)','Worked seconds','Status','Recorded activities']];
  const time=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Manila',hour12:false}):'';
  for(const row of data.items)rows.push([safeSpreadsheetText(row.employee_name),safeSpreadsheetText(row.project_name),time(row.clock_in_at),time(row.clock_out_at),row.worked_seconds,row.clock_out_at?'Completed':'Active',safeSpreadsheetText(row.activities.map(a=>a.description+' ('+(a.ended_at?Number(a.duration_seconds)||0:Math.max(0,Math.floor((Date.now()-Date.parse(a.started_at))/1000)))+' seconds)').join('; '))]);
  await audit(req,'CLIENT_EXPORT','REPORT',null,`Exported ${data.total} authorized shifts as ${format}`);
  res.set('Cache-Control','no-store').attachment('client-attendance.'+format.toLowerCase());
  if(format==='CSV')return res.type('text/csv').send('\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n'));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Attendance');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
 }catch(e){try{errors(res,e);}catch(error){next(error);}}});
 app.get('/v1/admin/client-access',authenticate,adminOnly,async(req,res,next)=>{try{
  const queries=[db.from('profiles').select('id,full_name,email,status').eq('role','CLIENT').is('permanently_deleted_at',null).order('full_name'),db.from('projects').select('id,name,is_active').order('name'),db.from('client_project_access').select('user_id,project_id').is('revoked_at',null)];
  const results=await Promise.all(queries);const error=results.find(r=>r.error)?.error;if(error)throw error;
  res.set('Cache-Control','no-store').json({clients:results[0].data,projects:results[1].data,access:results[2].data});
 }catch(e){next(e);}});
 app.put('/v1/admin/client-access/:id',authenticate,adminOnly,async(req,res,next)=>{try{
  const ids=req.body.projectIds;if(!uuid(req.params.id)||!Array.isArray(ids)||ids.length>100||ids.some(id=>!uuid(id)))return fail(res,400,'Choose valid projects');
  const {error}=await db.rpc('set_client_project_access',{p_actor:req.profile.id,p_client:req.params.id,p_projects:[...new Set(ids)],p_request:req.requestId});if(error)return errors(res,error);
  res.status(204).end();
 }catch(e){next(e);}});
}
