(() => {
 window.mountClientAccess=async()=>{
  const form=document.getElementById('clientAccessForm');if(!form||form.dataset.mounted)return;form.dataset.mounted='true';
  const select=document.getElementById('accessClient'),list=document.getElementById('clientAccessProjects'),message=document.getElementById('clientAccessMessage'),save=document.getElementById('saveClientAccess');
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data,busy=false;
  const draw=()=>{const assigned=new Set(data.access.filter(a=>a.user_id===select.value).map(a=>a.project_id));list.innerHTML=select.value?data.projects.map(p=>'<label><input type="checkbox" value="'+escape(p.id)+'"'+(assigned.has(p.id)?' checked':'')+'><span>'+escape(p.name)+'<small>'+(p.is_active?'Active project':'Inactive · history access only')+'</small></span></label>').join(''):'';save.disabled=!select.value||!data.projects.length;document.getElementById('clientAccessDetails').hidden=!select.value;message.textContent=select.value&&!data.projects.length?'No projects available. Create a project first.':'';};
  try{data=await window.ACEAuth.request('/v1/admin/client-access');select.innerHTML='<option value="">Choose a client</option>'+data.clients.map(c=>'<option value="'+escape(c.id)+'">'+escape(c.full_name||c.email)+' · '+escape(c.email)+(c.status==='ACTIVE'?'':' · inactive')+'</option>').join('');draw();if(!data.clients.length)message.textContent='No Client accounts yet. Invite one or change an existing account to Client in Users.';}catch(e){message.textContent=e.message;return;}
  select.addEventListener('change',draw);
  form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!select.value)return;busy=true;save.disabled=true;select.disabled=true;const id=select.value;const projectIds=[...list.querySelectorAll('input:checked')].map(input=>input.value);try{await window.ACEAuth.request('/v1/admin/client-access/'+id,{method:'PUT',body:JSON.stringify({projectIds})});data.access=data.access.filter(a=>a.user_id!==id).concat(projectIds.map(project_id=>({user_id:id,project_id})));message.textContent='';window.showToast('Access saved.', 'success');}catch(error){message.textContent=error.message;}finally{busy=false;save.disabled=false;select.disabled=false;}});
 };
 document.addEventListener('DOMContentLoaded',()=>void window.mountClientAccess());
})();
