import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/cv-review-navigation';await mkdir(dir,{recursive:true});
await writeFile(`${dir}/navigation.mjs`,ts.transpileModule(await readFile('lib/cv-review-navigation.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {cvReviewHref,cvReviewDestination}=await import('../'+dir+'/navigation.mjs');
const route=query=>cvReviewDestination(new URLSearchParams(query));

test('retired matching and optimization bookmarks return to CV files without report identity',()=>{
 for(const tool of ['scan','optimize'])for(const id of ['saved-record','sample','an id/with & characters']){
  const legacy=route(new URLSearchParams({view:tool+':'+id}).toString());
  assert.equal(legacy.tool,'files');assert.equal(legacy.id,undefined);
  assert.equal(legacy.href,cvReviewHref());
  assert.deepEqual(route(legacy.href.split('?')[1]),legacy);
  assert.equal(cvReviewHref(tool,id),cvReviewHref());
 }
});

test('retired tool links discard creation and saved-report context',()=>{
 for(const query of ['view=optimize&scan=report-1&unrelated=drop','view=scan&job=vacancy-1','view=workspace&tool=scan&report=old','view=workspace&tool=optimize&session=old']){
  assert.deepEqual(route(query),{tool:'files',id:undefined,href:cvReviewHref()});
 }
});

test('CV files stay the default without intercepting unrelated workspace views',()=>{
 assert.equal(cvReviewHref(),'/workspace?view=workspace');
 assert.equal(route('view=workspace&tool=unrecognized').tool,'files');
 for(const view of ['explore','applications','scans','builder','builder:saved','cover-letters','cover-letters:saved'])assert.equal(route('view='+view),null);
});

test('retired LinkedIn optimizer links continue to return to CV files',()=>{
 for(const query of ['view=linkedin','view=linkedin:old-profile','view=workspace&tool=linkedin','view=workspace&tool=linkedin&session=old-profile']){
  assert.deepEqual(route(query),{tool:'files',id:undefined,href:cvReviewHref()});
 }
});
