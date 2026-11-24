import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8');
const refresh=source.slice(source.indexOf('async function refreshUserProjectAssignments('),source.indexOf('const pause ='));
test('project refresh includes newly created projects and assignments while signed in',async()=>{
    const state={currentUser:{UserId:'employee'},projects:[],userProjects:[]};
    const requests=[];
    const context=vm.createContext({AppState:state,projectRecord:item=>({ProjectId:item.id,ProjectName:item.name,IsActive:item.is_active}),window:{ACEAuth:{request:async route=>{
        requests.push(route);
        return route==='/v1/projects'?[{id:'new-project',name:'New client',is_active:true}]:[{user_id:'employee',project_id:'new-project'}];
    }}}});
    vm.runInContext(refresh,context);
    await context.refreshUserProjectAssignments();
    assert.equal(state.projects[0].ProjectId,'new-project');
    assert.equal(state.userProjects[0].ProjectId,'new-project');
    assert.equal(state.userProjects[0].IsActive,true);
    assert.deepEqual(requests.sort(),['/v1/projects','/v1/user-projects']);
});
test('project refresh does not overwrite another signed-in account',async()=>{
    const state={currentUser:{UserId:'first'},projects:[],userProjects:[]};
    let finish;
    const waiting=new Promise(resolve=>{finish=resolve;});
    const context=vm.createContext({AppState:state,projectRecord:item=>item,window:{ACEAuth:{request:()=>waiting}}});
    vm.runInContext(refresh,context);
    const pending=context.refreshUserProjectAssignments();
    state.currentUser={UserId:'second'};
    finish([{id:'private-project'}]);
    await pending;
    assert.equal(state.projects.length,0);
    assert.equal(state.userProjects.length,0);
});
