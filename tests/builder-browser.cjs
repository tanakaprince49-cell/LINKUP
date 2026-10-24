// Offline component-browser smoke. It mounts the real workspace screen, with
// clearly isolated auth/API adapters. It does not log in, contact production,
// call an AI provider or claim to verify native push. Backend/rules are tested
// separately by test:firestore. Install esbuild + playwright in a scratch prefix
// and pass BUILDER_BROWSER_TOOLS=<prefix>/node_modules to run.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const tools=process.env.BUILDER_BROWSER_TOOLS||path.resolve('node_modules');
const {build}=require(path.join(tools,'esbuild')),{chromium}=require(path.join(tools,'playwright'));
const root=path.resolve(__dirname,'..'),mobile=path.join(root,'mobile'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'linkup-builder-browser-'));
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import Screen from '${mobile}/src/screens/BuilderWorkspaceScreen.tsx';
import {habitSnapshot} from '${root}/shared/build-habit.js';
window.calls=[];const now=Date.now();const s={context:{project:'',stage:'',goal:'',needs:'',skills:'',constraints:'',intent:'build'},prefs:{inApp:true,timezone:'UTC',quietStart:20,quietEnd:8},availability:{enabled:false,purpose:''},goals:[],followups:[],coachRuns:[],momentumDays:[]};
const rooms=[],asks=[];let quota=15;
const brief=()=>({next:{label:s.context.project?'Choose one outcome for this week':'Tell Linky what you are building',section:'Plan'},completed:s.goals.filter(g=>g.doneAt).length,due:0,roomUpdates:0,invitations:0,momentumDays:0});
window.builderCall=async(op,input={})=>{window.calls.push({op,input});
 if(op==='habit')return habitSnapshot({},now,s.prefs);
 if(op==='visit'||op==='home')return {state:structuredClone(s),brief:brief(),rooms:structuredClone(rooms),invitations:[],messageQuota:{remaining:quota,period:'month'}};
 if(op==='weeklyReview')return {review:{summary:'No completed outcomes yet.',completed:[],opportunities:[],meaningful:false,scope:'Offline browser adapter — no production data'}};
 if(op==='context'){s.context={...s.context,...input};return {ok:true};}
 if(op==='goal'){s.goals.unshift({id:'goal-1',text:input.text,week:'2026-10-19',doneAt:0});return {ok:true};}
 if(op==='goalDone'){s.goals[0].doneAt=now;return {ok:true};}
 if(op==='coach'){quota--;const r={key:input.key,kind:input.kind,text:'Clarify the customer problem. Next: interview three potential users.',status:'complete',at:now};s.coachRuns.unshift(r);return r;}
 if(op==='connections')return {people:[{uid:'bob',name:'Browser test connection'}]};
 if(op==='recommendations')return {people:[{uid:'bob',name:'Browser test connection',why:'Profile lists Python.',available:false}]};
 if(op==='followup'){s.followups.unshift({...input,id:'follow-1',targetName:'Browser test connection',status:'open'});return {ok:true};}
 if(op==='followupDraft')return {text:'Hi, following up on our next action.',sent:false};
 if(op==='followupStatus'){s.followups[0].status=input.status;return {ok:true};}
 if(op==='roomCreate'){rooms.push({id:'room-1',title:input.title,kind:input.kind,ownerId:'alice',memberIds:['alice'],members:[{uid:'alice',name:'Browser test builder'}],tasks:[],logs:[],messages:[],links:[]});return {roomId:'room-1'};}
 if(op==='room')return {room:structuredClone(rooms[0])};
 if(op==='roomAction'){if(input.action==='plan')Object.assign(rooms[0],{goal:input.goal,milestone:input.milestone});return {ok:true};}
 if(op==='asks')return {asks:structuredClone(asks),nextCursor:null};
 if(op==='askCreate'){asks.push({...input,id:'ask-1',ownerId:'alice',ownerName:'Browser test builder',status:'open',feedback:[],expiresAt:now+86400000});return {askId:'ask-1'};}
 if(op==='askClose'){asks[0].status='closed';return {ok:true};}
 if(op==='leads')return {leads:[{id:'test-source',name:'Offline source adapter',kind:'directory',region:'Africa',summary:'Test only; not a real lead.',checkedAt:new Date(now).toISOString(),attribution:'Offline fixture',url:'https://example.invalid',sourceUrl:'https://example.invalid',relevance:'Test source'}]};
 if(op==='prefs'){Object.assign(s.prefs,input);return {ok:true};}
 if(op==='export')return {state:structuredClone(s)};
 throw Error('Unexpected offline action: '+op);
};
createRoot(document.getElementById('root')).render(<Screen route={{params:{section:'Today'}}} navigation={{goBack(){},navigate(name,params){window.lastNavigation={name,params};}}}/>);`;
(async()=>{
 let browser,server;
 try{
  await build({stdin:{contents:source,resolveDir:mobile,loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(scratch,'app.js'),jsx:'automatic',nodePaths:[path.join(mobile,'node_modules')],define:{'process.env.NODE_ENV':'"production"',__DEV__:'false'},resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.jsx','.jsx','.web.js','.js','.json'],alias:{'react-native':'react-native-web','react-native-svg':path.join(mobile,'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js')},plugins:[{name:'isolated-adapters',setup(b){
   b.onResolve({filter:/^lucide-react-native$|AuthContext$|ThemeContext$|\/lib\/builder$|\/lib\/notifications$|\/lib\/notify$|^@react-navigation\/native$|^expo-clipboard$|^react-native-safe-area-context$|\/components\/ScreenHeader$|\/components\/VerifiedBadge$|\/components\/LinkyRichText$/},args=>({path:args.path,namespace:'offline'}));
   b.onLoad({filter:/.*/,namespace:'offline'},({path:p})=>({loader:'jsx',resolveDir:mobile,contents:p==='lucide-react-native'?`export const CheckCircle2=()=>null,ChevronRight=()=>null,Users=()=>null,Target=()=>null,ArrowUpRight=()=>null;`:p.endsWith('AuthContext')?`export const useAuth=()=>({user:{uid:'alice'}});`:p.endsWith('ThemeContext')?`export const useTheme=()=>({theme:'light'});`:p.endsWith('/lib/builder')?`export const BUILDER_SECTIONS=['Today','Plan','Coach','People','Follow-ups','Rooms','Help board','Leads','Settings'];export const builderSection=v=>BUILDER_SECTIONS.includes(v)?v:'Today';export const builderCall=(...args)=>window.builderCall(...args);export const coachRequestKey=()=>crypto.randomUUID();`:p.includes('notifications')?`export const registerForPushNotificationsAsync=async()=>{};export const registerForWebNotificationsAsync=async()=>{};`:p.endsWith('/lib/notify')?`export const notifyUser=()=>{};`:p==='@react-navigation/native'?`export const useIsFocused=()=>true;`:p==='expo-clipboard'?`export const setStringAsync=async text=>{window.copied=text};`:p==='react-native-safe-area-context'?`export {View as SafeAreaView} from 'react-native-web';`:p.endsWith('VerifiedBadge')?`export default ()=>null;`:p.endsWith('LinkyRichText')?`import React from 'react';export default ({text})=><div>{text}</div>;`:`import React from 'react';export default ({title})=><h1>{title}</h1>;`}));
  }}]});
  server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(scratch,'app.js')));}else{res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="/app.js"></script></body></html>');}});
  await new Promise(r=>server.listen(0,'0.0.0.0',r));const port=server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [390,1150]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto('http://127.0.0.1:'+port);await page.getByText('Tell Linky what you are building',{exact:true}).waitFor();
   const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role="progressbar"]'));};
   await click('Plan');await page.getByLabel('Project or current goal',{exact:true}).fill('Offline browser project');await page.getByLabel('What help or skills do you need?',{exact:true}).fill('Python');await click('Save my building context');
   await page.getByLabel('My weekly outcome',{exact:true}).fill('Interview three customers');await click('Commit to this week');await page.getByText('Interview three customers',{exact:true}).waitFor();
   await click('Coach');await page.getByLabel('Material to review',{exact:true}).fill('A test-only pitch for an actual UI workflow, no production provider call.');await click('Review with Linky · 1 message');await page.getByText('Clarify the customer problem. Next: interview three potential users.',{exact:true}).first().waitFor();
   await click('People');await page.getByText('Profile lists Python.',{exact:true}).waitFor();await click('View actual profile');assert.equal((await page.evaluate(()=>window.lastNavigation)).params.userId,'bob');
   await click('Follow-ups');await click('Browser test connection · bob');await page.getByLabel('Next agreed action',{exact:true}).fill('Review the pilot');await page.getByLabel('Private relationship note (never sent)',{exact:true}).fill('Private test note');await click('Save private follow-up');await click('Prepare a follow-up draft');await page.getByLabel('Editable message draft',{exact:true}).fill('Reviewed by the builder');await click('Copy approved draft');assert.equal(await page.evaluate(()=>window.copied),'Reviewed by the builder');
   await click('Rooms');await page.getByLabel('Room name',{exact:true}).fill('Offline pilot room');await click('Create room');await page.getByLabel('Room goal',{exact:true}).fill('Validate the pilot');await page.getByLabel('Next room milestone',{exact:true}).fill('Ship one tested flow');await click('Save shared room plan');await page.getByText('Goal: Validate the pilot',{exact:true}).waitFor();
   await click('Help board');await page.getByLabel('What do you need?',{exact:true}).fill('Review this test flow');await page.getByLabel('Context for contributors',{exact:true}).fill('Offline test context for a realistic feedback question.');await page.getByLabel('The specific question to answer',{exact:true}).fill('Where is the next action unclear?');await click('Publish help / feedback request');await click('Open feedback round');await click('Close this request');await click('My requests and history');await page.getByText('closed',{exact:true}).waitFor();
   await click('Leads');await page.getByText('Offline source adapter',{exact:true}).waitFor();await click('Settings');await click('Save preferences');
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.op==='coach').length),1);assert.deepEqual(errors,[]);
   if(process.env.BUILDER_SCREENSHOT_DIR){fs.mkdirSync(process.env.BUILDER_SCREENSHOT_DIR,{recursive:true});await click('Today');assert.equal(await page.getByText('Your real progress',{exact:true}).count(),1);await page.screenshot({path:path.join(process.env.BUILDER_SCREENSHOT_DIR,`builder-${width}.png`),fullPage:true});}
   console.log(`PASS real workspace component, ${width}px: context, goals, coach, profiles, follow-up draft, room plan, help history, leads, preferences; no external network`);
   await context.close();
  }
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
