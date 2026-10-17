import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const module={exports:{}};
const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/src/lib/saveProfileSections.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports});
const {saveProfileSections,ProfileSectionSaveError}=module.exports;
test('profile sections are saved sequentially and resolved only after both succeed',async()=>{
 const writes=[];await saveProfileSections(async patch=>{writes.push(patch);},{bio:'New bio'},{socialLinks:{portfolio:'https://example.com'}});
 assert.equal(writes.length,2);assert.equal(writes[0].bio,'New bio');assert.equal(writes[1].socialLinks.portfolio,'https://example.com');
});
test('a failed core save never writes optional data or reports partial success',async()=>{
 let writes=0;const error=new Error('permission-denied');
 await assert.rejects(saveProfileSections(async()=>{writes++;throw error;},{bio:'New'},{projects:[]}),e=>e===error);
 assert.equal(writes,1);
});
test('optional failure is surfaced as partial save instead of being silently swallowed',async()=>{
 let writes=0;const error=new Error('permission-denied');
 await assert.rejects(saveProfileSections(async()=>{if(++writes===2)throw error;},{bio:'New'},{projects:[]}),e=>e instanceof ProfileSectionSaveError && e.cause===error && /basic profile changes were saved/.test(e.message));
 assert.equal(writes,2);
});
test('the screen only applies all local fields and exits editing after the awaited save',()=>{
 const source=fs.readFileSync(new URL('../mobile/src/screens/ProfileScreen.tsx',import.meta.url),'utf8');
 const save=source.slice(source.indexOf('  const handleSave ='),source.indexOf('  const updatePreference ='));
 assert.ok(save.indexOf('await saveProfileSections(')<save.indexOf('updateLocalProfile('));
 assert.ok(save.indexOf('await saveProfileSections(')<save.indexOf('setIsEditing(false)'));
 assert.match(save,/err instanceof ProfileSectionSaveError/);
 assert.doesNotMatch(save,/Optional profile sections were not saved|app needs the latest rules deployed/);
});
