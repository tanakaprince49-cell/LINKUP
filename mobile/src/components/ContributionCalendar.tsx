import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,ActivityIndicator,Animated,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {builderCall} from '../lib/builder';
import {calendarWeeks} from '../../../shared/contributions.js';

type Snapshot={days:string[];points:number;totalUpdates:number;today:string};
export default function ContributionCalendar({userId,isDark=false,refreshKey='',onPublish,snapshot}:{userId:string;isDark?:boolean;refreshKey?:string;onPublish?:()=>void;snapshot?:Snapshot}){
 const focused=useIsFocused(),[data,setData]=useState<Snapshot|null>(snapshot||null),[error,setError]=useState(''),[reload,setReload]=useState(0),[reduced,setReduced]=useState(true);
 const pulse=useRef(new Animated.Value(1)).current;
 useEffect(()=>{let active=true;void AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(active)setReduced(v);}).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{active=false;sub.remove();};},[]);
 useEffect(()=>{if(snapshot){setData(snapshot);setError('');return;}if(!focused)return;let active=true;setData(null);setError('');void builderCall('contributions',{targetUid:userId}).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message||'Contribution calendar unavailable.');});return()=>{active=false;};},[focused,userId,refreshKey,snapshot,reload]);
 useEffect(()=>{if(!focused||snapshot)return;const timer=setTimeout(()=>setReload(v=>v+1),86400000-(Date.now()%86400000)+500);return()=>clearTimeout(timer);},[focused,snapshot,data?.today]);
 const weeks=useMemo(()=>calendarWeeks(data?.days||[],data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now()),[data]);
 const todayActive=weeks.some(w=>w.some(d=>d.today&&d.active));
 useEffect(()=>{pulse.setValue(1);if(!todayActive||reduced||!focused)return;const loop=Animated.loop(Animated.sequence([Animated.timing(pulse,{toValue:.65,duration:1300,useNativeDriver:true}),Animated.timing(pulse,{toValue:1,duration:1300,useNativeDriver:true})]));loop.start();return()=>loop.stop();},[todayActive,reduced,focused,pulse]);
 const ink=isDark?'#F2FAEC':'#173524',muted=isDark?'#A7B9AB':'#55725C',empty=isDark?'#233B2D':'#DFE9D7';
 const visible=weeks.flat().filter(d=>d.active),label=visible.length?`Recorded contribution days: ${visible.map(d=>d.day).join(', ')}. Dates use UTC.`:'No recorded contribution days in the last 12 weeks.';
 return <View style={[styles.card,{backgroundColor:isDark?'#111F18':'#F3F8EE',borderColor:isDark?'#31513B':'#D8E5CE'}]}>
  <View style={styles.heading}><View style={{flex:1}}><Text style={[styles.eyebrow,{color:muted}]}>BUILDER MOMENTUM</Text><Text style={[styles.title,{color:ink}]}>Small steps. Visible progress.</Text></View><View style={[styles.total,{backgroundColor:isDark?'#203B28':'#E2EFD7'}]}><Text style={[styles.points,{color:ink}]}>{data?.points??'—'}</Text><Text style={{fontSize:10,color:muted,fontWeight:'700'}}>contribution pts</Text></View></View>
  {error?<View style={{gap:8}}><Text style={{color:muted,fontSize:13}}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>setReload(v=>v+1)}><Text style={{color:ink,fontWeight:'800'}}>Retry calendar</Text></TouchableOpacity></View>:!data?<ActivityIndicator color={ink}/>:<>
   <View style={styles.grid} accessible accessibilityRole="image" accessibilityLabel={label}>
    <View style={styles.weekdays}>{['M','','W','','F','',''].map((d,i)=><View key={i} style={styles.weekday}><Text style={{color:muted,fontSize:10}}>{d}</Text></View>)}</View>
    <View style={styles.weeks}>{weeks.map((week,i)=><View key={i} style={styles.week}>{week.map(cell=><Animated.View key={cell.day} testID={`contribution-${cell.day}`} style={[styles.cell,{backgroundColor:cell.active?'#B8F260':empty,opacity:cell.future?0.28:cell.today&&cell.active?pulse:1},cell.active&&styles.glow,cell.today&&{borderColor:isDark?'#E0FFAE':'#426B26',borderWidth:1.5}]}/>)}</View>)}</View>
   </View>
   <View style={styles.legend}><Text style={{color:muted,fontSize:12,flex:1}}>{visible.length} recorded {visible.length===1?'day':'days'} · last 12 weeks</Text><View style={[styles.legendSquare,{backgroundColor:empty}]}/><Text style={{color:muted,fontSize:10}}>No update</Text><View style={[styles.legendSquare,{backgroundColor:'#B8F260'}]}/><Text style={{color:muted,fontSize:10}}>Recorded</Text></View>
   <Text style={{color:muted,fontSize:12,lineHeight:18}}>{todayActive?'Today is lit up. Your next useful step can be small.':'Your next progress update lights up a square. No streak to lose.'}</Text>
  </>}
  <Text style={{color:muted,fontSize:10,lineHeight:16}}>UTC calendar · 10 points per recorded update, at most one per day. Self-reported activity, not a skill score or verification.</Text>
  {onPublish&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Share a build update" onPress={onPublish} style={styles.action}><Text style={{color:'#173524',fontWeight:'800',fontSize:14}}>Share a build update →</Text></TouchableOpacity>}
 </View>;
}
const styles=StyleSheet.create({card:{borderWidth:1,borderRadius:24,padding:18,gap:16},heading:{flexDirection:'row',alignItems:'center',gap:12},eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.5,marginBottom:7},title:{fontSize:20,lineHeight:25,fontWeight:'800'},total:{padding:10,borderRadius:15,alignItems:'center'},points:{fontSize:26,fontWeight:'900'},grid:{flexDirection:'row',gap:6,maxWidth:410,width:'100%'},weekdays:{width:16,gap:5},weekday:{flex:1,justifyContent:'center'},weeks:{flex:1,flexDirection:'row',gap:5},week:{flex:1,gap:5},cell:{width:'100%',aspectRatio:1,borderRadius:4},glow:{shadowColor:'#9BE947',shadowOpacity:.8,shadowRadius:7,shadowOffset:{width:0,height:0},elevation:4},legend:{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'},legendSquare:{width:8,height:8,borderRadius:2},action:{padding:14,borderRadius:15,backgroundColor:'#D8F6AF',alignItems:'center'}});
