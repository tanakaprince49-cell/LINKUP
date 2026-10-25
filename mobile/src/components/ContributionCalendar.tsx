import React,{useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Linking,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {builderCall} from '../lib/builder';
import {calendarWeeks} from '../../../shared/contributions.js';
import {monthGrid,monthsWithActivity,weeksWithActivity,dayLabel,addMonth,monthKeyOf,MONTH_NAMES,WEEKDAY_INITIALS} from '../../../shared/calendar.js';

type Snapshot={days:string[];points:number;totalUpdates:number;today:string;publicMomentum?:boolean;publicUrl?:string;firstDay?:string;lastDay?:string;historyDays?:number;updatedDays?:string[]};

/**
 * Your build calendar, with real dates.
 *
 * Three ways in, because they answer different questions:
 *  · Month  — a true weekday-aligned month with every date printed, arrows to
 *             move through months and a jump list of months you actually used.
 *  · Recent — the classic 12-week heat grid, labelled by month.
 *  · Weeks  — every week you recorded something, newest first, with the dates.
 * Tapping a recorded day shows which day it is and, for your own calendar, the
 * private update from that day.
 */
export default function ContributionCalendar({userId,isDark=false,refreshKey='',onPublish,snapshot,displayName}:{userId:string;isDark?:boolean;refreshKey?:string;onPublish?:()=>void;snapshot?:Snapshot;displayName?:string}){
 const focused=useIsFocused(),[data,setData]=useState<Snapshot|null>(snapshot||null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [view,setView]=useState<'month'|'recent'|'weeks'>('month'),[picked,setPicked]=useState('');
 const todayKey=monthKeyOf(data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now());
 const [month,setMonth]=useState(todayKey);
 useEffect(()=>{if(snapshot){setData(snapshot);setError('');return;}if(!focused)return;let active=true;setData(null);setError('');void builderCall('contributions',{targetUid:userId}).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message||'Contribution calendar unavailable.');});return()=>{active=false;};},[focused,userId,refreshKey,snapshot,reload]);
 useEffect(()=>{if(!focused||snapshot)return;const timer=setTimeout(()=>setReload(v=>v+1),86400000-(Date.now()%86400000)+500);return()=>clearTimeout(timer);},[focused,snapshot,data?.today]);
 useEffect(()=>{if(todayKey&&month>todayKey)setMonth(todayKey);},[todayKey]);
 const days=data?.days||[];
 const grid=useMemo(()=>monthGrid(days,month,data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now()),[days,month,data?.today]);
 const recentWeeks=useMemo(()=>calendarWeeks(days,data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now()),[days,data?.today]);
 const weeks=useMemo(()=>weeksWithActivity(days),[days]);
 const months=useMemo(()=>monthsWithActivity(days,data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now()),[days,data?.today]);
 const todayActive=recentWeeks.some(w=>w.some(d=>d.today&&d.active));
 const canForward=month<todayKey;
 const ink=isDark?'#F4F5F7':'#0A0B0D',muted=isDark?'#A8B0BD':'#575B60',line=isDark?'#2A2D34':'#E3E1D8',empty=isDark?'#23262C':'#F1EFE6',panelTint=isDark?'#1E2128':'#FBFAF3';
 const visible=recentWeeks.flat().filter(d=>d.active);
 const pickedEntry=days.includes(picked)?picked:'';
 const privateUpdates=(data as any)?.updates||[];
 const pickedUpdate=privateUpdates.find((u:any)=>u.day===pickedEntry);
 const label=visible.length?`Recorded contribution days: ${visible.map(d=>d.day).join(', ')}. Dates use UTC.`:'No recorded contribution days yet.';
 const monthTabs=[addMonth(month,-1),month,addMonth(month,1)].filter((k,i,all)=>k&&all.indexOf(k)===i&&k<=todayKey);
 const ownerName=String(displayName||'').trim();
 const calendarTitle=ownerName?`${ownerName}${ownerName.toLowerCase().endsWith('s')?"'":"'s"} calendar, date by date`:'Your calendar, date by date';

 return <View style={[styles.card,{backgroundColor:isDark?'#171A21':'#FFFFFF',borderColor:isDark?'#383A42':'#DDDAD1'}]}>
  <View style={styles.heading}><View style={{flex:1}}><Text style={[styles.eyebrow,{color:muted}]}>BUILDER MOMENTUM</Text><Text style={[styles.title,{color:ink}]}>{calendarTitle}</Text></View><View style={[styles.total,{backgroundColor:isDark?'#292B31':'#FBE618'}]}><Text style={[styles.points,{color:ink}]}>{data?.points??'—'}</Text><Text style={{fontSize:10,color:muted,fontWeight:'700'}}>contribution pts</Text></View></View>

  {error?<View style={{gap:8}}><Text style={{color:muted,fontSize:13}}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>setReload(v=>v+1)}><Text style={{color:ink,fontWeight:'800'}}>Retry calendar</Text></TouchableOpacity></View>:!data?<ActivityIndicator color={ink}/>:<>
   <View style={styles.tabs}>{([['month','Month'],['recent','Recent'],['weeks','Weeks']] as const).map(([value,title])=><TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{selected:view===value}} accessibilityLabel={`${title} view`} onPress={()=>setView(value)} style={[styles.tab,{backgroundColor:view===value?'#FBE618':panelTint,borderColor:view===value?'#0A0B0D':line}]}><Text style={{color:ink,fontWeight:'900',fontSize:12}}>{title}</Text></TouchableOpacity>)}</View>

   {view==='month'&&<>
    <View style={styles.monthBar}>
     <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>setMonth(addMonth(month,-1))} style={[styles.arrow,{borderColor:line}]}><Text style={{color:ink,fontWeight:'900',fontSize:16}}>‹</Text></TouchableOpacity>
     <Text accessibilityRole="header" style={{color:ink,fontWeight:'900',fontSize:16,flex:1,textAlign:'center'}}>{grid.label||month}</Text>
     <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" disabled={!canForward} onPress={()=>canForward&&setMonth(addMonth(month,1))} style={[styles.arrow,{borderColor:line,opacity:canForward?1:.35}]}><Text style={{color:ink,fontWeight:'900',fontSize:16}}>›</Text></TouchableOpacity>
    </View>
    <View style={styles.weekHead}>{WEEKDAY_INITIALS.map((d,i)=><Text key={i} style={{flex:1,textAlign:'center',color:muted,fontSize:10,fontWeight:'800'}}>{d}</Text>)}</View>
    <View accessible accessibilityRole="image" accessibilityLabel={`${grid.label}: ${grid.recorded} recorded ${grid.recorded===1?'day':'days'} of ${grid.daysInMonth}. Dates run Monday to Sunday in UTC.`}>
     {grid.rows.map((row,i)=><View key={i} style={styles.monthRow}>{row.map(cell=><TouchableOpacity key={cell.day} accessibilityRole="button" accessibilityLabel={`${dayLabel(cell.day)}${cell.active?', recorded':', no update'}`} accessibilityState={{selected:pickedEntry===cell.day}} testID={`contribution-${cell.day}`} disabled={!cell.inMonth||cell.future} onPress={()=>setPicked(cell.day===pickedEntry?'':cell.day)} style={[styles.monthCell,{backgroundColor:cell.active?'#FBE618':empty,opacity:cell.inMonth?(cell.future?.45:1):.28,borderColor:cell.today?ink:(pickedEntry===cell.day?'#0A0B0D':line),borderWidth:cell.today||pickedEntry===cell.day?1.6:1},cell.active&&styles.glow]}><Text style={{color:cell.active?'#0A0B0D':muted,fontSize:11,fontWeight:cell.active?'900':'700'}}>{cell.label}</Text></TouchableOpacity>)}</View>)}
    </View>
    <View style={styles.legend}>
     <Text style={{color:muted,fontSize:12,flex:1}}>{grid.recorded} of {grid.daysInMonth} days recorded in {grid.label}</Text>
     <TouchableOpacity accessibilityRole="button" accessibilityLabel="Jump to today" onPress={()=>{setMonth(todayKey);setPicked(data.today);}}><Text style={{color:ink,fontWeight:'800',fontSize:11}}>Today</Text></TouchableOpacity>
    </View>
    {pickedEntry?<View style={[styles.dayCard,{backgroundColor:panelTint,borderColor:line}]}>
     <Text style={{color:ink,fontWeight:'900',fontSize:13}}>{dayLabel(pickedEntry)}</Text>
     {pickedUpdate?<><Text style={{color:ink,fontSize:13,lineHeight:20}}>{pickedUpdate.text}</Text>{pickedUpdate.insight?<Text style={{color:muted,fontSize:12,lineHeight:18}}>Linky: {pickedUpdate.insight}</Text>:null}<Text style={{color:muted,fontSize:11}}>Recorded update · {pickedUpdate.pointsAwarded||10} contribution points</Text></>:<Text style={{color:muted,fontSize:12}}>A recorded build day. Your private notes for it are not attached to this calendar row.</Text>}
    </View>:<Text style={{color:muted,fontSize:11,lineHeight:16}}>Tap any date to see the day. Empty dates are real rest or no-update days, kept exactly as they happened.</Text>}
    {months.length>1&&<View style={styles.jumpWrap}><Text style={{color:muted,fontSize:10,fontWeight:'900',letterSpacing:1}}>MONTHS WITH RECORDED DAYS</Text><View style={styles.jumpRow}>{months.slice(0,18).map(key=><TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={`Open ${key}`} onPress={()=>setMonth(key)} style={[styles.jump,{backgroundColor:key===month?'#FBE618':panelTint,borderColor:key===month?'#0A0B0D':line}]}><Text style={{color:ink,fontSize:11,fontWeight:'800'}}>{key.slice(5)}/{key.slice(2,4)}</Text></TouchableOpacity>)}</View><Text style={{color:muted,fontSize:10}}>{months[months.length-1].slice(5)}/{months[months.length-1].slice(2,4)} → {months[0].slice(5)}/{months[0].slice(2,4)} · {MONTH_NAMES[Number(months[0].slice(5,7))-1]} is your newest month</Text></View>}
   </>}

   {view==='recent'&&<>
    <View style={styles.grid} accessible accessibilityRole="image" accessibilityLabel={label}>
     <View style={styles.weekdays}>{WEEKDAY_INITIALS.map((d,i)=><View key={i} style={styles.weekday}><Text style={{color:muted,fontSize:10}}>{i%2===0?d:''}</Text></View>)}</View>
     <View style={styles.weeks}>{recentWeeks.map((week,i)=><View key={i} style={styles.week}>{week.map(cell=><TouchableOpacity key={cell.day} accessibilityRole="button" accessibilityLabel={`${dayLabel(cell.day)}${cell.active?', recorded':', no update'}`} onPress={()=>{setPicked(cell.day);setMonth(cell.day.slice(0,7));}} testID={`contribution-${cell.day}`} style={[styles.cell,{backgroundColor:cell.active?'#FBE618':empty,opacity:cell.future?0.28:1},cell.active&&styles.glow,cell.today&&{borderColor:isDark?'#FBE618':'#0A0B0D',borderWidth:1.5}]}/>)}</View>)}</View>
    </View>
    <View style={styles.monthLabels}>{recentWeeks.map((week,i)=><Text key={i} style={styles.monthLabel}>{i===0||week[0].day.slice(5,7)!==recentWeeks[i-1][0].day.slice(5,7)?MONTH_NAMES[Number(week[0].day.slice(5,7))-1].slice(0,3):''}</Text>)}</View>
    <View style={styles.legend}><Text style={{color:muted,fontSize:12,flex:1}}>{visible.length} recorded {visible.length===1?'day':'days'} · last 12 weeks, Mondays to Sundays</Text><View style={[styles.legendSquare,{backgroundColor:empty}]}/><Text style={{color:muted,fontSize:10}}>No update</Text><View style={[styles.legendSquare,{backgroundColor:'#FBE618'}]}/><Text style={{color:muted,fontSize:10}}>Recorded</Text></View>
    {pickedEntry?<View style={[styles.dayCard,{backgroundColor:panelTint,borderColor:line}]}><Text style={{color:ink,fontWeight:'900',fontSize:13}}>{dayLabel(pickedEntry)}</Text>{pickedUpdate?<Text style={{color:ink,fontSize:13,lineHeight:20}}>{pickedUpdate.text}</Text>:<Text style={{color:muted,fontSize:12}}>A recorded build day.</Text>}</View>:null}
   </>}

   {view==='weeks'&&<>
    {weeks.length?weeks.slice(0,26).map(entry=><View key={entry.weekStart} style={[styles.weekRow,{borderColor:line}]}>
     <View style={{flex:1}}>
      <Text style={{color:ink,fontWeight:'900',fontSize:13}}>Week of {dayLabel(entry.weekStart)}</Text>
      <Text style={{color:muted,fontSize:11,lineHeight:17}}>{entry.days.map(d=>dayLabel(d).slice(4)).join(' · ')}</Text>
     </View>
     <Text style={{color:ink,fontWeight:'900',fontSize:14}}>{entry.buildDays}×</Text>
    </View>):<Text style={{color:muted,fontSize:12}}>No weeks recorded yet. Your first update creates the first row here.</Text>}
    {weeks.length>26&&<Text style={{color:muted,fontSize:11}}>Showing the most recent 26 weeks of {weeks.length} recorded weeks.</Text>}
   </>}

   <Text style={{color:muted,fontSize:12,lineHeight:18}}>{todayActive?'Today is lit up. Your next useful step can be small.':'Your next progress update lights up a square. No streak to lose.'}</Text>
  </>}
  <Text style={{color:muted,fontSize:10,lineHeight:16}}>UTC calendar · 10 points per recorded update, at most one per day. Actual dates are kept; rest days are never rewritten as work. Self-reported activity, not a skill score or verification.</Text>
  {data?.publicMomentum&&data?.publicUrl&&<TouchableOpacity accessibilityRole="link" onPress={()=>void Linking.openURL(data.publicUrl!)}><Text style={{color:ink,fontWeight:'800'}}>View searchable Momentum & streak card ↗</Text></TouchableOpacity>}
  {onPublish&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Share a build update" onPress={onPublish} style={styles.action}><Text style={{color:'#0A0B0D',fontWeight:'800',fontSize:14}}>Share a build update →</Text></TouchableOpacity>}
 </View>;
}
const styles=StyleSheet.create({
 card:{borderWidth:1,borderRadius:24,padding:18,gap:16},
 heading:{flexDirection:'row',alignItems:'center',gap:12},
 eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.5,marginBottom:7},
 title:{fontSize:20,lineHeight:25,fontWeight:'800'},
 total:{padding:10,borderRadius:15,alignItems:'center'},
 points:{fontSize:26,fontWeight:'900'},
 tabs:{flexDirection:'row',gap:7},
 tab:{flex:1,paddingVertical:9,borderWidth:1.5,borderRadius:12,alignItems:'center'},
 monthBar:{flexDirection:'row',alignItems:'center',gap:10},
 arrow:{width:38,height:38,borderRadius:12,borderWidth:1,alignItems:'center',justifyContent:'center'},
 weekHead:{flexDirection:'row'},
 monthRow:{flexDirection:'row',gap:4,marginBottom:4},
 monthCell:{flex:1,aspectRatio:1.05,borderRadius:8,alignItems:'center',justifyContent:'center',maxWidth:'14.2%'},
 grid:{flexDirection:'row',gap:6,maxWidth:410,width:'100%'},
 weekdays:{width:16,gap:5},
 weekday:{flex:1,justifyContent:'center'},
 weeks:{flex:1,flexDirection:'row',gap:5},
 week:{flex:1,gap:5},
 cell:{width:'100%',aspectRatio:1,borderRadius:4},
 glow:{shadowColor:'#FBE618',shadowOpacity:.8,shadowRadius:7,shadowOffset:{width:0,height:0},elevation:4},
 monthLabels:{flexDirection:'row',marginLeft:22,maxWidth:410},
 monthLabel:{flex:1,color:'#8A8E96',fontSize:9},
 legend:{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'},
 legendSquare:{width:8,height:8,borderRadius:2},
 dayCard:{borderWidth:1,borderRadius:14,padding:12,gap:6},
 jumpWrap:{gap:6},
 jumpRow:{flexDirection:'row',flexWrap:'wrap',gap:6},
 jump:{paddingHorizontal:9,paddingVertical:6,borderRadius:9,borderWidth:1},
 weekRow:{flexDirection:'row',alignItems:'center',gap:10,borderBottomWidth:1,paddingBottom:10},
 action:{padding:14,borderRadius:15,backgroundColor:'#FBE618',alignItems:'center'},
});
