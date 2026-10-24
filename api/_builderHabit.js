import {createHash} from 'node:crypto';
import {normalizeUpdate} from '../shared/contributions.js';
import {DAY,problem,validId,stateOf,sanitizePrefs} from './_builderCore.js';
import {publicEligible} from './_publicSeo.js';
import {dayOf,weekOf,habitState,habitSnapshot} from '../shared/build-habit.js';
export function createHabitActions({db,now}){
 const cr=uid=>db.collection('builderContributions').doc(uid),sr=uid=>db.collection('builderStates').doc(uid);
 async function read(uid){const [c,s]=await Promise.all([cr(uid).get(),sr(uid).get()]);return habitSnapshot(c.data(),now(),s.data()?.prefs);}
 async function act(uid,op,input){
  return db.runTransaction(async tx=>{
   const [cd,sd,user]=await Promise.all([tx.get(cr(uid)),tx.get(sr(uid)),tx.get(db.collection('users').doc(uid))]);
   if(!user.exists||user.data().deleted||user.data().banned||user.data().onboarded!==true)throw problem('Your profile is unavailable.',403);
   const c=cd.data()||{},s=stateOf(sd.data(),now()),h=habitState(c),today=dayOf(now()),week=weekOf(today);
   if(op==='habitPrefs'){
    if('target'in input){if(![3,5,7].includes(input.target))throw problem('Choose 3, 5 or 7 build days per week.');const effective=!c.totalUpdates?week:dayOf(Date.parse(week)+7*DAY);h.goals=[...h.goals.filter(g=>g.week!==effective),{week:effective,target:input.target}].sort((a,b)=>a.week.localeCompare(b.week)).slice(-54);}
    const before=s.prefs.dailyBuild;s.prefs=sanitizePrefs(input,s.prefs);
    if(s.prefs.dailyBuild&&!before){s.prefs.buildOptInDay=today;s.buildReminderCount=0;}
   }else if(op==='habitRest'){
    const date=input.day,yesterday=dayOf(now()-DAY);
    if(![today,yesterday].includes(date))throw problem('Protect today or yesterday only.');
    if((c.days||[]).includes(date))throw problem('That day already has a real update.');
    if(h.rests.some(r=>r.day===date))return {...habitSnapshot(c,now(),s.prefs),replayed:true};
    if(!(c.days||[]).some(d=>d<date&&d>=dayOf(Date.parse(date)-2*DAY)))throw problem('Record progress before protecting a break in your rhythm.');
    const free=!h.rests.some(r=>r.kind==='free'&&weekOf(r.day)===weekOf(date));
    if(!free&&h.tokens<1)throw problem('Your weekly free protection is used. Earn community credits for another break token.');
    if(!free)h.tokens--;h.rests=[...h.rests,{day:date,kind:free?'free':'token'}].filter(r=>r.day>=dayOf(now()-365*DAY));
   }else if(op==='habitToken'){
    if(!validId(input.key))throw problem('Use a valid token request.');
    if(h.purchases.some(p=>p.key===input.key))return {...habitSnapshot(c,now(),s.prefs),replayed:true};
    if(h.credits<20)throw problem('A break token costs 20 community credits.');if(h.tokens>=3)throw problem('You can hold at most three break tokens.');
    h.credits-=20;h.tokens++;h.purchases=[{key:input.key,at:now()},...h.purchases].slice(0,20);
   }else throw problem('Unknown habit action.');
   tx.set(cr(uid),{...c,habit:h,updatedAt:now()});s.updatedAt=now();tx.set(sr(uid),s);
   return habitSnapshot({...c,habit:h},now(),s.prefs);
  });
 }
 async function rewardFeedback(tx,a,f,owner,outcome){
  if((f.text||'').trim().length<40||outcome.trim().length<12)return {amount:0,reason:'Recognition saved. Credit rewards need feedback of at least 40 characters and a specific outcome of at least 12 characters.'};
  const authorId=f.authorId;if(!validId(authorId)||authorId===owner)return {amount:0,reason:'No self-rewards.'};
  const [cd,author,recipient,outgoing,incoming]=await Promise.all([tx.get(cr(authorId)),tx.get(db.collection('users').doc(authorId)),tx.get(db.collection('users').doc(owner)),tx.get(db.collection('blocks').where('blockedById','==',owner).where('blockedUserId','==',authorId)),tx.get(db.collection('blocks').where('blockedById','==',authorId).where('blockedUserId','==',owner))]);
  if(!author.exists||author.data().banned||!publicEligible(author.data(),authorId)||!recipient.exists||recipient.data().banned||!publicEligible(recipient.data(),owner)||!outgoing.empty||!incoming.empty)return {amount:0,reason:'Rewards require eligible, unblocked members.'};
  if(a.status!=='open'||a.expiresAt<=now()||f.at<now()-14*DAY)return {amount:0,reason:'This feedback round has ended.'};
  const c=cd.data()||{},h=habitState(c),today=dayOf(now()),week=weekOf(today);h.awards=h.awards.filter(r=>r.day>=dayOf(now()-56*DAY));
  const hash=createHash('sha256').update(normalizeUpdate(f.text)).digest('hex');if(h.awards.some(r=>r.hash===hash))return {amount:0,reason:'This feedback text already earned credits. Tailor it to the project.'};
  if(h.awards.some(r=>r.owner===owner&&weekOf(r.day)===week))return {amount:0,reason:'One reward per recipient per UTC week.'};
  if(h.awards.filter(r=>r.day===today).length>=2||h.awards.filter(r=>weekOf(r.day)===week).length>=4)return {amount:0,reason:'Community reward cap reached: two per day, four per week.'};
  h.credits+=5;h.earnedCredits+=5;h.awards.push({owner,day:today,hash,key:a.id+'_'+f.id});tx.set(cr(authorId),{...c,habit:h,updatedAt:now()});
  return {amount:5,reason:'Five community credits awarded. Activity only—not a skill endorsement.'};
 }
 return {read,act,rewardFeedback};
}
