import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import {fallbackTeamRoles} from '../shared/team-roles.js';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('role suggestions have a deterministic non-AI fallback and avoid duplicating the owner role',()=>{
  const fintech=fallbackTeamRoles('A mobile payments platform for small shops','Software engineer',3);
  assert.equal(fintech.length,3);
  assert.ok(new Set(fintech.map(x=>x.toLowerCase())).size===3);
  assert.ok(fintech.every(role=>!/engineer|developer|technical/i.test(role)));
  const healthcare=fallbackTeamRoles('A patient care service','Founder',2,['Clinical advisor']);
  assert.equal(healthcare.length,2);
  assert.equal(healthcare[0],'Clinical advisor');
  assert.ok(healthcare.some(role=>role!=='Clinical advisor'));
});

test('the authenticated API keeps teamMatch live and retires former Linky assistant actions',async()=>{
  let seen;
  let chatted;
  const linky={
    teamMatch:async(uid,input)=>{seen={uid,input};return {mode:input.mode,teams:[],roles:[]};},
    linkyChat:async(uid,input)=>{chatted={uid,input};return {action:'chat',reply:'hey',teams:[],roles:[],suggestions:[]};},
  };
  const module={exports:{}};
  const mocks={
    './_builderRuntime.js':{},'node:crypto':await import('node:crypto'), './_linky.js':linky,
    './_proof.js':{},'./_profileWriter.js':{writeMyProfile:async()=>({ok:false,reason:'not_used_here'})}, './_firebaseAdmin.js':{getDb:()=>({}),verifyRequestUser:async()=>({uid:'member-1'})},
    './_gemini.js':{handleOptions:()=>false,readJsonBody:req=>req.body,setCors:()=>{},sendError:(res,code,message)=>res.status(code).json({error:message})},
  };
  const code=ts.transpileModule(read('api/linky.js'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.ok(name in mocks,name);return mocks[name];},process:{env:{}},console,Date,Buffer,Set,Map});
  const response={status(code){this.code=code;return this;},json(body){this.body=body;}};
  await module.exports.default({method:'POST',query:{},body:{action:'teamMatch',mode:'find',idea:'A payments service for local shops'},headers:{}},response);
  assert.equal(response.code,200);assert.equal(response.body.mode,'find');assert.equal(seen.uid,'member-1');
  const chatResponse={status(code){this.code=code;return this;},json(body){this.body=body;}};
  await module.exports.default({method:'POST',query:{},body:{action:'chat',message:'I need a Flutter developer for my payments app'},headers:{}},chatResponse);
  assert.equal(chatResponse.code,200);assert.equal(chatResponse.body.action,'chat');
  assert.equal(chatted.uid,'member-1');assert.equal(chatted.input.message,'I need a Flutter developer for my payments app');
  assert.match(read('api/linky.js'),/retiredLinkyActions\.has\(action\)/);
  assert.match(read('api/linky.js'),/case 'teamMatch': out = await teamMatch/);
  assert.match(read('api/linky.js'),/case 'chat': out = await linkyChat/);
});

test('retired Linky automations are absent from cron and no bot rewrites remain',()=>{
  const cron=read('functions/linky-cron.mjs'),api=read('api/_builderRuntime.js'),linky=read('api/_linky.js'),vercel=read('vercel.json');
  assert.doesNotMatch(cron,/lvlup|testEmail|dailyPulseHourly|telegram=|githubCommitsRecorded/);
  assert.match(api,/retired:true,reminders:0,pulses:0,githubAutoSync:null/);
  assert.match(linky,/followups:\s*0,\s*briefsMade:\s*0/);
  assert.doesNotMatch(vercel,/"source": "\/?app?\/api\/(telegram|whatsapp)"/);
  assert.match(vercel,/"source": "\/api\/\(\.\*\)"/);
});
