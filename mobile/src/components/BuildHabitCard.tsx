import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,StyleSheet,Switch,Text,TouchableOpacity,View} from 'react-native';
import {useAuth} from '../contexts/AuthContext';
import {useIsFocused} from '@react-navigation/native';
import {builderCall,coachRequestKey} from '../lib/builder';
export default function BuildHabitCard({navigation,isDark=false,compact=false,refreshKey=''}:{navigation:any;isDark?:boolean;compact?:boolean;refreshKey?:string}){
 const {user}=useAuth(),uid=user?.uid;
 const focused=useIsFocused(),[data,setH]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[expanded,setExpanded]=useState(false);
 const h=data?.owner===uid?data:null;
 const generation=useRef(0),purchase=useRef<string|null>(null);
 useEffect(()=>{purchase.current=null;setH(null);},[uid]);
 useEffect(()=>{if(!focused||!uid)return;const g=++generation.current;setError('');void builderCall('habit').then(r=>{if(g===generation.current)setH({...r,owner:uid});}).catch(e=>{if(g===generation.current)setError(e.message||'Could not load your build rhythm.');});return()=>{generation.current++;};},[focused,refreshKey,reload,uid]);
 useEffect(()=>{if(!focused)return;const timer=setTimeout(()=>setReload(n=>n+1),86400000-Date.now()%86400000+500);return()=>clearTimeout(timer);},[focused,h?.today]);
 const act=async(op:string,input:any={})=>{if(busy||!uid)return;setBusy(true);setError('');const g=generation.current;try{const r=await builderCall(op,input);if(g===generation.current)setH({...r,owner:uid});if(op==='habitToken')purchase.current=null;}catch(e:any){if(g===generation.current)setError(e.message||'Please retry.');}finally{setBusy(false);}};
 const ink=isDark?'#EBF8E8':'#173524',muted=isDark?'#B7C9BB':'#50634F';
 const label=(s:string)=> <Text style={{color:muted,fontSize:13,lineHeight:20}}>{s}</Text>;
 const button=(title:string,onPress:()=>void,disabled=false)=> <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} disabled={busy||disabled} onPress={onPress} style={[styles.button,{opacity:(busy||disabled)?0.5:1}]}><Text style={{color:'#173524',fontWeight:'800',fontSize:13,textAlign:'center'}}>{title}</Text></TouchableOpacity>;
 return <View style={[styles.card,{backgroundColor:isDark?'#14251E':'#F0F7E5',borderColor:isDark?'#385D42':'#CFE2B8'}]}>
  <Text style={{color:muted,fontSize:10,fontWeight:'900',letterSpacing:1.5}}>LINKY’S BUILD CLUB · OPTIONAL</Text>
  {error&&<View accessibilityRole="alert">{label(error)}{button('Retry build rhythm',()=>setReload(n=>n+1))}</View>}
  {!h?!error&&<ActivityIndicator color={ink}/>:<>
   <Text accessibilityRole="header" style={{color:ink,fontSize:22,lineHeight:28,fontWeight:'900'}}>{h.mission.title}</Text>
   {h.nudge&&<View accessibilityRole="alert" style={{borderLeftWidth:3,borderColor:'#7CA441',paddingLeft:12}}><Text style={{color:ink,fontWeight:'800'}}>Linky says</Text>{label(h.nudge.content)}</View>}
   {label(h.mission.prompt)}
   <View accessibilityLabel={`${h.weekly.progress} of ${h.weekly.target} build days this UTC week`} style={styles.track}>{Array.from({length:h.weekly.target},(_,i)=><View key={i} style={[styles.step,{backgroundColor:i<h.weekly.progress?'#A7DE59':isDark?'#38513B':'#D6E5C6'}]}/>)}</View>
   <Text style={{color:ink,fontWeight:'800',fontSize:14}}>{h.weekly.progress}/{h.weekly.target} build days this week{h.weekly.complete?' · target met':''}</Text>
   {label(`${h.rhythm.actualDays} actual build ${h.rhythm.actualDays===1?'day':'days'} in your current rhythm${h.rhythm.protectedDays?` · ${h.rhythm.protectedDays} protected rest ${h.rhythm.protectedDays===1?'day':'days'}`:''}. Earned points never expire when you miss a day.`)}
   {!h.mission.done&&!h.resting&&button('Log one sentence · about 60 seconds',()=>navigation.navigate('ShipLog'))}
   {compact?button('Choose goals, breaks and reminders',()=>navigation.navigate('ShipLog')):<>
    {button(expanded?'Hide goals, breaks and reminders':'Goals, breaks and reminders',()=>setExpanded(v=>!v))}
    {expanded&&<>
    <Text style={[styles.sub,{color:ink}]}>Choose your pace</Text><View style={styles.row}>{[3,5,7].map(n=><TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`${n} build days per week`} accessibilityState={{selected:n===(h.weekly.pending?.target||h.weekly.target)}} disabled={busy} onPress={()=>void act('habitPrefs',{target:n})} style={[styles.chip,n===(h.weekly.pending?.target||h.weekly.target)&&{backgroundColor:'#D4EEA7',borderColor:'#6D8E3E'}]}><Text style={{color:'#173524',fontWeight:'800'}}>{n} days</Text></TouchableOpacity>)}</View>
    {label(h.weekly.pending?`Next target: ${h.weekly.pending.target} days, from Monday ${h.weekly.pending.week} (UTC). This week stays unchanged.`:'Weekly targets use Monday–Sunday UTC. Once you start, target changes take effect next Monday.')}
    <Text style={[styles.sub,{color:ink}]}>Make room for real life</Text>
    {label(`One free protected rest day per UTC week. ${h.tokens}/3 break tokens · ${h.credits} community credits. Rest protects your rhythm; it never adds work, contribution points or a calendar square.`)}
    {h.canRestToday&&!h.resting&&button(h.freeRestAvailable?'Protect today’s rest · free':'Protect today’s rest · 1 break token',()=>void act('habitRest',{day:h.today}))}
    {h.canProtectYesterday&&button(h.freeYesterdayAvailable?'Protect yesterday’s gap · free':'Protect yesterday’s gap · 1 break token',()=>void act('habitRest',{day:h.yesterday}))}
    {h.resting&&<Text style={{color:ink,fontWeight:'800'}}>Today’s rest is protected. No check-in needed.</Text>}
    {button('Get a break token · 20 community credits',()=>{purchase.current ||= coachRequestKey();void act('habitToken',{key:purchase.current});},h.credits<20||h.tokens>=3)}
    {label('Earn 5 community credits when a request’s author recognises your feedback as helpful. Maximum two rewards/day, four/week, and one per recipient/week. Feedback needs 40+ characters and a specific 12+ character outcome. No rewards for posting alone or self-feedback.')}
    {button('Give useful feedback',()=>navigation.navigate('BuilderWorkspace',{section:'Help board'}))}
    <Text style={[styles.sub,{color:ink}]}>Milestones worth keeping</Text>
    <View style={styles.row}>{(h.milestones.length?h.milestones:[0]).map((n:number)=><View key={n} style={styles.chip}><Text style={{color:'#173524',fontWeight:'800'}}>{n?n+(n===1?' build day':' build days'):'Your first build day is next'}</Text></View>)}</View>
    {label(h.nextMilestone?`Next milestone: ${h.nextMilestone} recorded build days. This is activity, not a skill or investment rating.`:'A year of recorded build days. Activity, not a skill rating.')}
    <View style={[styles.row,{justifyContent:'space-between'}]}><Text style={{color:ink,fontWeight:'800',flex:1}}>Cheeky build reminders</Text><Switch accessibilityLabel="Cheeky build reminders" value={h.reminders.enabled} disabled={busy} onValueChange={v=>void act('habitPrefs',{dailyBuild:v})}/></View>
    {label(`Preferred time ${String(h.reminders.hour).padStart(2,'0')}:00 ${h.reminders.timezone}; quiet hours and delivery permissions win; delivery may be delayed or unavailable. Stops after today’s update, a protected rest, or your weekly target. Automatically pauses after three unanswered nudges.`)}
    {button('Reminder time, quiet hours and delivery',()=>navigation.navigate('BuilderWorkspace',{section:'Settings'}))}
    </>}
   </>}
   {busy&&<ActivityIndicator color={ink}/>}
  </>}
 </View>;
}
const styles=StyleSheet.create({card:{padding:20,borderWidth:1,borderRadius:24,gap:12},track:{flexDirection:'row',gap:6},step:{height:9,borderRadius:6,flex:1},row:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'},chip:{borderWidth:1,borderColor:'#D4E1C8',backgroundColor:'#E5EDDC',borderRadius:12,padding:10},sub:{fontSize:15,fontWeight:'800',marginTop:6},button:{backgroundColor:'#D8F1B6',padding:13,borderRadius:14,minHeight:46,justifyContent:'center'}});
