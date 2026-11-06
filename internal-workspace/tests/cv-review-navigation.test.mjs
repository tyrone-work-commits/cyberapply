import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const dir='.sites-runtime/cv-review-navigation';await mkdir(dir,{recursive:true});
await writeFile(`${dir}/navigation.mjs`,ts.transpileModule(await readFile('lib/cv-review-navigation.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {cvReviewHref,cvReviewDestination}=await import('../'+dir+'/navigation.mjs');
const route=query=>cvReviewDestination(new URLSearchParams(query));

test('matching and optimization bookmarks open inside CV review without losing record identity',()=>{
 for(const tool of ['scan','optimize'])for(const id of ['saved-record','sample','an id/with & characters']){
  const legacy=route(new URLSearchParams({view:tool+':'+id}).toString());
  assert.equal(legacy.tool,tool);assert.equal(legacy.id,id);
  assert.equal(new URLSearchParams(legacy.href.split('?')[1]).get('view'),'workspace');
  assert.deepEqual(route(legacy.href.split('?')[1]),legacy);
 }
});
test('old start links preserve job or scan context but drop unrelated query parameters',()=>{
 assert.equal(route('view=optimize&scan=report-1&unrelated=drop').href,'/workspace?view=workspace&tool=optimize&scan=report-1');
 assert.equal(route('view=scan&job=vacancy-1').href,'/workspace?view=workspace&tool=scan&job=vacancy-1');
});
test('CV files remain the default and unknown sections cannot open a separate tool page',()=>{
 assert.equal(cvReviewHref(),'/workspace?view=workspace');
 assert.equal(route('view=workspace&tool=unrecognized').tool,'files');
 assert.equal(route('view=workspace&tool=scan').href,cvReviewHref('scan'));
 for(const view of ['explore','applications','scans','builder','builder:saved'])assert.equal(route('view='+view),null);
});

test('LinkedIn optimizer links open the embedded profile tools and survive refresh',()=>{
 const destination=route('view=linkedin');
 assert.equal(destination.tool,'linkedin');
 assert.equal(destination.href,cvReviewHref('linkedin'));
 assert.deepEqual(route(destination.href.split('?')[1]),destination);
 for(const view of ['scans','cover-letters','cover-letters:saved-letter'])assert.equal(route('view='+view),null);
});
