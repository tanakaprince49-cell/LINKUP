// Server-recorded activity only. No login/view/paid/skill-based boosts.
import {dayOf,weekOf} from './build-habit.js';
export const LEAGUE_RULES='10 points per recorded build day + 5 per rewarded helpful contribution. UTC periods. No paid boosts, profile views or login points. Activity is not verified skill or investment quality.';
export const LEAGUE_PERIODS=Object.freeze(['week','month','year','all']);
export function leagueScore(c={},period='week',at=Date.now()){
 const today=dayOf(at),start=period==='week'?weekOf(today):period==='month'?today.slice(0,7)+'-01':period==='year'?today.slice(0,4)+'-01-01':'';
 const days=[...new Set(c.days||[])].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today&&(!start||d>=start)).length;
 const helpful=period==='all'?Math.floor((Number(c.habit?.earnedCredits)||0)/5):(c.habit?.awards||[]).filter(a=>a.day<=today&&a.day>=start).length;
 const buildPoints=period==='all'?(Number(c.points)||0):days*10;
 return {points:buildPoints+helpful*5,buildDays:period==='all'?(Number(c.totalUpdates)||0):days,helpful,period,start,end:today};
}
export function rankActivity(rows){
 const sorted=[...rows].sort((a,b)=>b.points-a.points||b.buildDays-a.buildDays||a.uid.localeCompare(b.uid));let position=0;
 return sorted.map((r,i)=>{if(!i||r.points!==sorted[i-1].points||r.buildDays!==sorted[i-1].buildDays)position=i+1;return {...r,rank:position};});
}
