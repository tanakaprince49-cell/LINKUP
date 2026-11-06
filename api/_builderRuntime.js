import {getDb} from './_firebaseAdmin.js';
import {isPlusUser} from './_linky.js';
import {createBuilderService} from './_builder.js';
import {validId,problem} from './_builderCore.js';
import {awardSeasonChampions} from './_leagueChampions.js';
import {sendExpoPush} from './_expoPush.js';
import {emailStatus,verifyEmailUnsubscribe,unsubscribeUserEmail,sendLinkyDirectEmail} from './_emailNotify.js';
import {getVapidKeys,saveWebPushSubscription} from './_webPush.js';
import {ensureMissingBuilderStates} from './_builderStatesBackfill.js';
import {runDailyRetentionPulsePage} from './_dailyRetentionPulse.js';
import {verifyWebhookAuth,recordVerifiedCommitToLeague,autoProvisionOnIntroAccept,dispatchVcInvestmentOffer,sweepConnectedGithubCommits,maybeAutoSweepGithubCommits} from './_ventureEngine.js';
async function nativePush(uid,{title,body,url,mood='',campaign='builder_retention',category=''}){
 return sendExpoPush(getDb(),uid,{title,body,url,mood,campaign,category,type:'builder'});
}
export function builderService(){return createBuilderService({db:getDb(),plus:isPlusUser,push:nativePush});}
export async function builderCron(input={}){
 const db=getDb(),r=db.collection('builderScheduler').doc('hourly'),snapshot=await r.get();
 const after=Object.hasOwn(input,'after')?input.after:(snapshot.exists?snapshot.data().after:'');
 if(after&& !validId(after))throw problem('Invalid schedule cursor.');
 const result=await builderService().runReminderPage({after:after||'',limit:30});
 await r.set({after:result.nextCursor||'',at:Date.now()});

 // Randomized 2x/day full-retention pulses (expressive email + native/web push + in-app)
 let pulse={scanned:0,pulsed:0,emailsSent:0,pushesSent:0,nextCursor:''};
 try{
  const pr=db.collection('builderScheduler').doc('dailyPulseHourly'),ps=await pr.get();
  const pulseAfter=ps?.exists?(ps.data()?.after||''):'';
  pulse=await runDailyRetentionPulsePage(db,{after:validId(pulseAfter)?pulseAfter:'',limit:30,push:nativePush});
  await pr.set({after:pulse.nextCursor||'',at:Date.now()});
 }catch{pulse={scanned:0,pulsed:0,emailsSent:0,pushesSent:0,nextCursor:''};}

 // Builder League season prizes. Reminders must still be delivered if a league
 // job fails, so the block is isolated: a throw here can never 500 the cron.
 let seasons=null,githubAutoSync=null;
 try{seasons=await awardSeasonChampions(db);}catch{seasons=null;}
 if(!after){
  try{githubAutoSync=await sweepConnectedGithubCommits({db,maxProfiles:25,discoverFromProfiles:true});}catch{githubAutoSync=null;}
 }
 const combinedCursor=result.nextCursor||pulse.nextCursor||'';
 return {...result,nextCursor:combinedCursor,pulse,seasons,githubAutoSync,email:builderEmailStatus()};
}
export const builderEmailStatus=()=>{const s=emailStatus();return s.available?s:{available:false,reason:'Provider setup required'};};
export {getVapidKeys,saveWebPushSubscription,verifyEmailUnsubscribe,unsubscribeUserEmail,emailStatus,sendLinkyDirectEmail,ensureMissingBuilderStates,runDailyRetentionPulsePage,verifyWebhookAuth,recordVerifiedCommitToLeague,autoProvisionOnIntroAccept,dispatchVcInvestmentOffer,sweepConnectedGithubCommits,maybeAutoSweepGithubCommits};
