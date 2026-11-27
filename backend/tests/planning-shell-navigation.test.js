import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('shared navigation resolves page links from the document base on the nested planner URL',()=>{
 const source=readFileSync(new URL('../../frontend/js/script.js',import.meta.url),'utf8'),start=source.indexOf('const cleanInternalRoute ='),end=source.indexOf('const cleanInternalPageLinks =',start);
 const context=vm.createContext({URL,document:{baseURI:'https://staging.example.test/'},window:{location:{href:'https://staging.example.test/shift-planning/',origin:'https://staging.example.test'}}});
 vm.runInContext(source.slice(start,end)+'globalThis.route=cleanInternalRoute;',context);
 assert.equal(context.route('projects.html'),'/projects');assert.equal(context.route('settings.html?tab=appearance#profile'),'/settings?tab=appearance#profile');assert.equal(context.route('https://other.example.test/page.html'),'https://other.example.test/page.html');
});
