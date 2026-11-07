import {getDb} from './_firebaseAdmin.js';
import {isPlusUser} from './_linky.js';
import {createBuilderService} from './_builder.js';
import {validId,problem} from './_builderCore.js';
import {awardSeasonChampions} from './_leagueChampions.js';
import {runWeeklyFounderSpotlight} from './_weeklyFounderSpotlight.js';
import {sendExpoPush} from './_expoPush.js';
import {emailStatus,verifyEmailUnsubscribe,unsubscribeUserEmail,sendLinkyDirectEmail} from './_emailNotify.js';
import {getVapidKeys,saveWebPushSubscription} from './_webPush.js';
import {ensureMissingBuilderStates} from './_builderStatesBackfill.js';
async function nativePush(uid,{title,body,url,mood='',campaign='builder_retention',category=''}){
 return sendExpoPush(getDb(),uid,{title,body,url,mood,campaign,category,type:'builder'});
}
export function builderService(){return createBuilderService({db:getDb(),plus:isPlusUser,push:nativePush});}
export async function builderCron(){
 // Retired Linky reminder, retention-pulse, and GitHub-sync jobs are deliberately
 // not run. Keep the independent seasonal recognition award job intact.
 let seasons=null;
 try{seasons=await awardSeasonChampions(getDb());}catch{seasons=null;}
 return {retired:true,reminders:0,pulses:0,githubAutoSync:null,seasons,email:builderEmailStatus()};
}
export const builderEmailStatus=()=>{const s=emailStatus();return s.available?s:{available:false,reason:'Provider setup required'};};
export {getVapidKeys,saveWebPushSubscription,verifyEmailUnsubscribe,unsubscribeUserEmail,emailStatus,sendLinkyDirectEmail,ensureMissingBuilderStates,runWeeklyFounderSpotlight};
