const DAY=86400000;
export function momentumCardStats(c={},at=Date.now()){
 const today=new Date(at).toISOString().slice(0,10),days=new Set((c.days||[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=today));let cursor=Date.parse(today+'T00:00:00Z'),streak=0;if(!days.has(today))cursor-=DAY;
 while(streak<366&&days.has(new Date(cursor).toISOString().slice(0,10))){streak++;cursor-=DAY;}
 return {streak,totalUpdates:Number(c.totalUpdates)||0,points:Number(c.points)||0,today,days:[...days].sort()};
}
