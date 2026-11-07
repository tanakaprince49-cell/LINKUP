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
const rooms=[];let quota=15;
const brief=()=>({next:{label:'Open your groups',section:'Groups'},completed:0,due:0,roomUpdates:0,invitations:0,momentumDays:0});
window.builderCall=async(op,input={})=>{window.calls.push({op,input});
 if(op==='habit')return habitSnapshot({},now,s.prefs);
 if(op==='visit'||op==='home')return {state:structuredClone(s),brief:brief(),rooms:structuredClone(rooms),invitations:[],messageQuota:{remaining:quota,period:'month'}};
 if(op==='groups')return {groups:structuredClone(rooms),invitations:[]};
 if(op==='groupCreate'){rooms.push({id:'group-1',title:input.title,ownerId:'alice',memberCount:1});return {groupId:'group-1'};}
 if(op==='export')return {state:structuredClone(s),contributions:{}};
 if(op==='forget')return {ok:true};
 throw Error('Unexpected offline action: '+op);
};
createRoot(document.getElementById('root')).render(<Screen route={{params:{section:'Groups'}}} navigation={{goBack(){},navigate(name,params){window.lastNavigation={name,params};}}}/>);`;
(async()=>{
 let browser,server;
 try{
  await build({stdin:{contents:source,resolveDir:mobile,loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(scratch,'app.js'),jsx:'automatic',nodePaths:[path.join(mobile,'node_modules')],define:{'process.env.NODE_ENV':'"production"',__DEV__:'false'},resolveExtensions:['.web.tsx','.tsx','.web.ts','.ts','.web.jsx','.jsx','.web.js','.js','.json'],alias:{'react-native':'react-native-web','react-native-svg':path.join(mobile,'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js')},plugins:[{name:'isolated-adapters',setup(b){
   b.onResolve({filter:/^lucide-react-native$|AuthContext$|ThemeContext$|\/lib\/builder$|\/lib\/notifications$|\/lib\/notify$|^@react-navigation\/native$|^expo-clipboard$|^react-native-safe-area-context$|\/components\/ScreenHeader$|\/components\/VerifiedBadge$|\/components\/LinkyRichText$|\/lib\/groupPhoto$/},args=>({path:args.path,namespace:'offline'}));
   b.onLoad({filter:/.*/,namespace:'offline'},({path:p})=>({loader:'jsx',resolveDir:mobile,contents:p==='lucide-react-native'?`export const Check=()=>null,CheckCircle2=()=>null,ChevronRight=()=>null,Users=()=>null,Target=()=>null,ArrowUpRight=()=>null;`:p.endsWith('AuthContext')?`export const useAuth=()=>({user:{uid:'alice'}});`:p.endsWith('ThemeContext')?`export const useTheme=()=>({theme:'light'});`:p.endsWith('/lib/builder')?`export const BUILDER_SECTIONS=['Groups','Settings'];export const builderSection=v=>v==='Settings'?'Settings':'Groups';export const builderCall=(...args)=>window.builderCall(...args);export const coachRequestKey=()=>crypto.randomUUID();`:p.includes('notifications')?`export const registerForPushNotificationsAsync=async()=>{};export const registerForWebNotificationsAsync=async()=>{};`:p.endsWith('/lib/notify')?`export const notifyUser=()=>{};`:p.endsWith('/lib/groupPhoto')?`export const pickGroupPhoto=async()=>null;`:p==='@react-navigation/native'?`export const useIsFocused=()=>true;`:p==='expo-clipboard'?`export const setStringAsync=async text=>{window.copied=text};`:p==='react-native-safe-area-context'?`export {View as SafeAreaView} from 'react-native-web';`:p.endsWith('VerifiedBadge')?`export default ()=>null;`:p.endsWith('LinkyRichText')?`import React from 'react';export default ({text})=><div>{text}</div>;`:`import React from 'react';export default ({title})=><h1>{title}</h1>;`}));
  }}]});
  server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(scratch,'app.js')));}else{res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="/app.js"></script></body></html>');}});
  await new Promise(r=>server.listen(0,'0.0.0.0',r));const port=server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [390,1150]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.goto('http://127.0.0.1:'+port);
   const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role="progressbar"]'));};
   for(const removed of ['Today','Plan','People','Follow-ups','Help board','Leads']){
    assert.equal(await page.getByRole('button',{name:removed,exact:true}).count(),0,removed);
   }
   await page.getByLabel('Group name',{exact:true}).fill('Offline pilot group');await click('Create group');assert.equal((await page.evaluate(()=>window.lastNavigation)).name,'GroupChat');await page.getByText('Offline pilot group',{exact:true}).waitFor();
   await click('Settings');await click('Copy private workspace export');
   assert.ok((await page.evaluate(()=>window.copied))?.includes('workspace'));
   assert.deepEqual(errors,[]);
   if(process.env.BUILDER_SCREENSHOT_DIR){fs.mkdirSync(process.env.BUILDER_SCREENSHOT_DIR,{recursive:true});await click('Groups');await page.screenshot({path:path.join(process.env.BUILDER_SCREENSHOT_DIR,`builder-${width}.png`),fullPage:true});}
   console.log(`PASS real workspace component, ${width}px: only Groups and Settings; no external network`);
   await context.close();
  }
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
