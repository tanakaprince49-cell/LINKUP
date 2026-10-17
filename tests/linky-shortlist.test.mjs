import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
const module={exports:{}};
const code=ts.transpileModule(fs.readFileSync(new URL('../mobile/src/lib/linkyShortlist.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports});
const {linkyShortlist}=module.exports;
const card={id:'a',status:'new',targetUid:'alice'};
const found={kind:'found',need:'Flutter developer',cardIds:['a'],cards:[card],none:false};
const home={lastAsk:found,cards:[card]};
test('current search renders its cards and supports responses without card IDs',()=>{
 assert.equal(linkyShortlist(found,home).cards.length,1);
 assert.equal(linkyShortlist({...found,cardIds:[]},home).cards.length,1);
 assert.equal(linkyShortlist(null,home).cards.length,1);
});
test('chat keeps a clearly labelled previous shortlist from the refreshed home',()=>{
 const list=linkyShortlist({kind:'chat',cards:[],cardIds:[]},home);
 assert.equal(list.cards.length,1);assert.equal(list.previous,true);
 assert.equal(list.need,'Flutter developer');
});
test('no-match, ambiguity and outside search never revive an unrelated shortlist',()=>{
 for(const kind of ['none','ambiguous','outside'])assert.equal(linkyShortlist({...found,kind},home).cards.length,0);
 assert.equal(linkyShortlist({...found,kind:undefined,none:true},home).cards.length,0);
 assert.equal(linkyShortlist({kind:'chat'}, {...home,lastAsk:{kind:'none',cardIds:[]}}).cards.length,0);
});
test('privacy refreshed removals and skipped or declined cards stay hidden',()=>{
 assert.equal(linkyShortlist(found,{...home,cards:[]}).cards.length,0);
 assert.equal(linkyShortlist({kind:'chat'}, {...home,cards:[]}).cards.length,0);
 for(const status of ['skipped','declined','expired'])assert.equal(linkyShortlist(found,{...home,cards:[{...card,status}]}).cards.length,0);
});
