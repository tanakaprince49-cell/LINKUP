import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/src/lib/imagekitUpload.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function uploader({authOk=true,uploadOk=true}={}) {
 const module={exports:{}},calls=[];
 vm.runInNewContext(code,{module,exports:module.exports,FormData,require(name){
  if(name==='./profileLinks')return {linkupWebBaseUrl:()=> 'https://example.com/app'};
  if(name==='./firebase')return {auth:{currentUser:{getIdToken:async()=> 'test-token'}}};
  throw new Error(`Unexpected import: ${name}`);
 },fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/api/imagekitAuth'))return {ok:authOk,json:async()=>({token:'one-shot',expire:123,signature:'signature'})};
  return {ok:uploadOk,json:async()=>({url:'https://ik.imagekit.io/example/unique-avatar.jpg'})};
 }});
 return {upload:module.exports.uploadAvatarToImageKit,calls};
}
test('hosted avatars use unique CDN URLs and authenticated upload authorization',async()=>{
 const {upload,calls}=uploader();
 assert.equal(await upload('owner','data:image/png;base64,AAAA'),'https://ik.imagekit.io/example/unique-avatar.jpg');
 assert.equal(calls.length,2);
 assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
 assert.equal(calls[1].options.body.get('useUniqueFileName'),'true');
 assert.equal(calls[1].options.body.get('folder'),'/linkup-avatars');
});
test('failed upload authorization leaves the inline-photo fallback intact',async()=>{
 const {upload,calls}=uploader({authOk:false});
 assert.equal(await upload('owner','data:image/png;base64,AAAA'),null);
 assert.equal(calls.length,1);
});
test('a failed CDN upload is not returned as a successful hosted avatar',async()=>{
 const {upload}=uploader({uploadOk:false});
 assert.equal(await upload('owner','data:image/png;base64,AAAA'),null);
});
test('avatar selection stays serialized through hosting and updates matching drafts only',()=>{
 const source=fs.readFileSync(new URL('../mobile/src/screens/ProfileScreen.tsx',import.meta.url),'utf8');
 const picker=source.slice(source.indexOf('  const pickProfilePic ='),source.indexOf('  const openChat ='));
 assert.match(picker,/if \(isViewingOther \|\| avatarUploadPending.current\) return/);
 assert.ok(picker.indexOf('avatarUploadPending.current = true')<picker.indexOf('launchImageLibraryAsync'));
 assert.match(picker,/await uploadAvatarToImageKit/);
 assert.match(picker,/finally \{\s*avatarUploadPending.current = false/);
 assert.match(picker,/current\?\.profilePic === dataUri/);
 assert.ok(picker.indexOf('await updateOwnProfileDoc({ profilePic: url')<picker.indexOf('updateLocalProfile({ profilePic: url'));
});
