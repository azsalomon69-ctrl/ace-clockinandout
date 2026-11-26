const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function projectPayload(body = {}, creating = false) {
 if(!body||typeof body!=='object'||Array.isArray(body))return {error:'Supply project fields as an object'};
 const changes = {};
 if (creating || body.name !== undefined) { if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160) return {error:'Enter a name up to 160 characters'}; changes.name=body.name.trim(); }
 for (const [key,max] of [['description',1000],['client_name',160]]) if (body[key] !== undefined) { if(body[key]!==null && (typeof body[key]!=='string'||body[key].length>max))return {error:key==='description'?'Description must be text up to 1000 characters':'Client name must be text up to 160 characters'};changes[key]=body[key]?.trim()||null; }
 for(const [key,values,fallback] of [['type',['PROJECT','CAMPAIGN'],'PROJECT'],['status',['ACTIVE','PAUSED','ARCHIVED'],'ACTIVE']])if(creating||body[key]!==undefined){const value=body[key]===undefined?fallback:body[key];if(!values.includes(value))return {error:'Choose a valid '+key};changes[key]=value;}
 if(creating||body.start_date!==undefined){const value=body.start_date===undefined?new Date(Date.now()+8*3600000).toISOString().slice(0,10):body.start_date;if(!day(value))return {error:'Choose a valid start date'};changes.start_date=value;}
 if(body.end_date!==undefined){if(body.end_date!==null&&!day(body.end_date))return {error:'Choose a valid end date'};changes.end_date=body.end_date;}
 if(changes.start_date&&changes.end_date&&changes.end_date<changes.start_date)return {error:'End date must be on or after start date'};
 if(body.color!==undefined){if(typeof body.color!=='string'||!/^#[0-9a-f]{6}$/i.test(body.color))return {error:'Choose a valid project color'};changes.color=body.color;}
 if(body.department_id!==undefined){if(body.department_id!==null&&!uuid(body.department_id))return {error:'Choose a valid department'};changes.department_id=body.department_id;}
 if(!Object.keys(changes).length)return {error:'No editable project fields supplied'};
 return {changes};
}
export const projectAvailable = (project, today = new Date(Date.now()+8*3600000).toISOString().slice(0,10)) => (project.status ? project.status==='ACTIVE' : project.is_active!==false) && (!project.start_date||project.start_date<=today) && (!project.end_date||project.end_date>=today);
