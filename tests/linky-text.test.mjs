import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const module={exports:{}};
const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/src/lib/linkyText.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,URL});
const {linkyTextParts,linkyWebUrl}=module.exports;
const profiles=[{name:'Alice Builder',uid:'alice'}];
test('ordinary URLs, www links and markdown labels are tappable without losing punctuation',()=>{
 const parts=linkyTextParts('See https://example.com/ideas. Or [their work](https://example.com/work) and www.example.com!');
 assert.equal(parts.filter(p=>p.url).length,3);
 assert.equal(parts.find(p=>p.text==='their work').url,'https://example.com/work');
 assert.equal(parts.find(p=>p.text==='www.example.com').url,'https://www.example.com/');
 assert.equal(parts.map(p=>p.text).join(''),'See https://example.com/ideas. Or their work and www.example.com!');
});
test('known profile mentions become profile links, never substring or ambiguous-name links',()=>{
 const parts=linkyTextParts('Meet Alice Builder; Alice Builderton is someone else.',profiles);
 assert.equal(parts.filter(p=>p.uid).length,1);assert.equal(parts.find(p=>p.uid).uid,'alice');
 assert.equal(linkyTextParts('Alice Builder',[...profiles,{name:'Alice Builder',uid:'other'}]).filter(p=>p.uid).length,0);
 assert.equal(linkyTextParts('Alice Builder',[]).filter(p=>p.uid).length,0);
});
test('profile matching cannot corrupt URLs; unsafe schemes or credentials never become openable links',()=>{
 assert.equal(linkyTextParts('https://example.com/AliceBuilder',[{name:'AliceBuilder',uid:'a'}]).filter(p=>p.uid).length,0);
 for(const s of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://user:pass@example.com'])assert.equal(linkyWebUrl(s),'');
 assert.equal(linkyTextParts('[Click](javascript:alert(1))').filter(p=>p.url).length,0);
});
test('balanced URL parentheses remain intact and unmatched punctuation stays plain text',()=>{
 const parts=linkyTextParts('(https://example.com/work(test)).');
 assert.equal(parts.find(p=>p.url).url,'https://example.com/work(test)');
 assert.equal(parts.map(p=>p.text).join(''),'(https://example.com/work(test)).');
});
