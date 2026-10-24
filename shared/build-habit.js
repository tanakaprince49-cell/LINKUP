// Private, opt-in habit scaffolding. Activity never controls matching or verification.
const DAY=86400000;
export const dayOf=at=>new Date(at).toISOString().slice(0,10);
export function weekOf(day){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return dayOf(+d);}
const shift=(day,n)=>dayOf(Date.parse(day+'T00:00:00Z')+n*DAY);
export const MILESTONES=[1,3,7,14,30,50,100,365];
export function habitState(c={}){return {goals:[],rests:[],tokens:0,credits:0,earnedCredits:0,awards:[],purchases:[],nudges:[],...c.habit};}
export function habitSnapshot(c={},at=Date.now(),prefs={}){
 const h=habitState(c),today=dayOf(at),week=weekOf(today),days=new Set(c.days||[]),rests=new Set(h.rests.map(r=>r.day)),goal=[...h.goals].filter(g=>g.week<=week).sort((a,b)=>b.week.localeCompare(a.week))[0]?.target||3;
 const progress=[...days].filter(d=>d>=week&&d<=today).length;
 let cursor=days.has(today)||rests.has(today)?today:shift(today,-1),actual=0,protectedDays=0;
 for(let i=0;i<366;i++,cursor=shift(cursor,-1)){if(days.has(cursor))actual++;else if(rests.has(cursor))protectedDays++;else break;}
 const restDay=shift(today,-1),canProtectYesterday=!days.has(restDay)&&!rests.has(restDay)&&[1,2].some(n=>days.has(shift(restDay,-n)));
 const total=Number(c.totalUpdates)||0,done=days.has(today),resting=rests.has(today),pending=h.goals.find(g=>g.week>week);
 return {today,week,weekly:{target:goal,progress,complete:progress>=goal,pending:pending||null},rhythm:{actualDays:actual,protectedDays},
 milestones:MILESTONES.filter(n=>total>=n),nextMilestone:MILESTONES.find(n=>n>total)||null,totalUpdates:total,
 credits:h.credits,earnedCredits:h.earnedCredits,tokens:h.tokens,tokenCost:20,maxTokens:3,
 canRestToday:!done&&!resting&&[1,2].some(n=>days.has(shift(today,-n))),freeYesterdayAvailable:!h.rests.some(r=>r.kind==='free'&&weekOf(r.day)===weekOf(restDay)),freeRestAvailable:!h.rests.some(r=>r.kind==='free'&&weekOf(r.day)===week),resting,canProtectYesterday,yesterday:restDay,
 reminders:{enabled:prefs.dailyBuild===true,hour:prefs.buildHour??18,timezone:prefs.timezone||'UTC'},
 nudge:prefs.inApp!==false&&!done&&!resting&&progress<goal&&h.nudges[0]?.at>=at-7*DAY?{content:h.nudges[0].content,at:h.nudges[0].at}:null,
 mission:{done,resting,title:done?'Today’s mission: complete':resting?'Today’s mission: take your break':'Your 60-second build mission',
 prompt:done?'Square lit. Go build—or close the app. You have earned the breathing room.':resting?'Rest is part of the plan. No update, points or fake activity will be added.':'One sentence. Sixty seconds. Record one result, lesson or next step.',reward:'10 contribution points for a real update; no chat credit used.'}};
}
export function habitReminder(state,c,at){
 const p=state.prefs||{};if(!p.dailyBuild)return null;
 const h=habitSnapshot(c,at,p);if(h.mission.done||h.resting||h.weekly.complete)return null;
 const start=[...(c.days||[]),p.buildOptInDay||h.today].filter(d=>d<=h.today).sort().at(-1)||h.today;
 const gap=Math.floor((Date.parse(h.today)-Date.parse(start))/DAY),count=state.buildReminderCount||0;
 if(count>=3||gap<[1,3,5][count])return null;
 const scripts=['One sentence. Sixty seconds. Tell me what moved forward. Your square is waiting—not your investors.','Linky check-in: a tiny result beats a dramatic comeback. Got a lesson or next step to record?','I’ve parked the build nudges for now. Your points and matches are staying put. Resume whenever you want.'];
 return {key:'build-'+h.today,section:'Today',kind:'build',content:scripts[count],pause:count===2};
}
