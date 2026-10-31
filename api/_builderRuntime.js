import {getDb} from './_firebaseAdmin.js';
import {isPlusUser} from './_linky.js';
import {createBuilderService} from './_builder.js';
import {validId,problem} from './_builderCore.js';
import {awardWeeklyChampion,reconcileCampaignRewards} from './_campaignReward.js';
import {awardSeasonChampions} from './_leagueChampions.js';
import {sendExpoPush} from './_expoPush.js';
async function nativePush(uid,{title,body,url,campaign='builder_retention',category=''}){
 return sendExpoPush(getDb(),uid,{title,body,url,campaign,category,type:'builder'});
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
