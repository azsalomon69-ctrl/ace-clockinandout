// Add read-only comparison data without changing listing totals or attendance values.
export async function enrichPlannedAttendance(db, actor, rows) {
 const ids=[...new Set(rows.filter(row=>row.planned_shift_id).map(row=>row.id))];
 if(!ids.length)return rows;
 const {data,error}=await db.rpc('attendance_plan_details',{p_actor:actor,p_entries:ids});
 if(error?.message==='ATTENDANCE_ACCESS_REQUIRED')throw Object.assign(new Error('Attendance access is unavailable. Sign in again.'),{status:403,expose:true});
 if(error)throw error;
 return rows.map(row=>({...row,planning_comparison:data?.[row.id]||null}));
}
