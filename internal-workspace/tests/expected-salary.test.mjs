import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('.sites-runtime/salary-tests',{recursive:true});
await writeFile('.sites-runtime/salary-tests/expected-salary.mjs',ts.transpileModule(await readFile('lib/expected-salary.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {convertUsdSalary}=await import('../.sites-runtime/salary-tests/expected-salary.mjs');
test('USD salary converts both ways and rounds cents',()=>{
 assert.equal(convertUsdSalary({amount:5000,currency:'USD',period:'month'},'year'),60000);
 assert.equal(convertUsdSalary({amount:60000,currency:'USD',period:'year'},'month'),5000);
 assert.equal(convertUsdSalary({amount:50000,currency:'USD',period:'year'},'month'),4166.67);
 assert.equal(convertUsdSalary({amount:1000.25,currency:'USD',period:'month'},'year'),12003);
});
test('unsupported amounts, currencies and hourly periods are not silently converted',()=>{
 for(const salary of [null,{amount:0,currency:'USD',period:'month'},{amount:NaN,currency:'USD',period:'year'},{amount:500000,currency:'NGN',period:'month'},{amount:20,currency:'USD',period:'hour'}])assert.equal(convertUsdSalary(salary,'year'),null);
});
