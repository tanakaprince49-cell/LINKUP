import {getDb} from './_firebaseAdmin.js';
import {isPlusUser} from './_linky.js';
import {createBuilderService} from './_builder.js';
import {validId,problem} from './_builderCore.js';
import {awardWeeklyChampion,reconcileCampaignRewards} from './_campaignReward.js';
import {awardSeasonChampions} from './_leagueChampions.js';
async function nativePush(uid,{title,body,url,campaign='builder_retention',category=''}){
 const db=getDb(),snap=await db.collection('userPrivate').doc(uid).get();
 const tokens=[...new Set((snap.exists?snap.data().pushTokens:[] )||[])].filter(t=>typeof t==='string'&&/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(t)).slice(0,20);
 if(!tokens.length)return {sent:0};
 try{
  const response=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.EXPO_ACCESS_TOKEN?{Authorization:'Bearer '+process.env.EXPO_ACCESS_TOKEN}:{})},body:JSON.stringify(tokens.map(to=>({to,title:String(title).slice(0,100),body:String(body).slice(0,180),data:{url,targetUrl:url,type:'builder',campaign,category},sound:'default',priority:'high',channelId:'default'}))),signal:AbortSignal.timeout(8000)});
  const result=await response.json();return {sent:response.ok&&Array.isArray(result.data)?result.data.filter(t=>t.status==='ok').length:0};
 }catch{return {sent:0};}
}
export function builderService(){return createBuilderService({db:getDb(),plus:isPlusUser,push:nativePush});}
export async function builderCron(input={}){
 const db=getDb(),r=db.collection('builderScheduler').doc('hourly'),snapshot=await r.get();
 const after=Object.hasOwn(input,'after')?input.after:(snapshot.exists?snapshot.data().after:'');
 if(after&& !validId(after))throw problem('Invalid schedule cursor.');
 const result=await builderService().runReminderPage({after:after||'',limit:30});
 await r.set({after:result.nextCursor||'',at:Date.now()});
 // Builder League prizes. Reminders must still be delivered if a league job
 // fails, so each block is isolated: a throw here can never 500 the cron.
 let reward=null,rewardSweep=null,seasons=null;
 try{reward=await awardWeeklyChampion(db);}catch{reward=null;}
 try{rewardSweep=await reconcileCampaignRewards(db);}catch{rewardSweep=null;}
 try{seasons=await awardSeasonChampions(db);}catch{seasons=null;}
 return {...result,reward,rewardSweep,seasons};
}
// Email is intentionally fail-closed until a verified provider is configured.
// A future adapter must enforce opt-in, suppression, signed unsubscribe URLs,
// authenticated domain setup and idempotency before enabling preferences.
export const builderEmailStatus=()=>({available:false,reason:'Provider setup required'});
