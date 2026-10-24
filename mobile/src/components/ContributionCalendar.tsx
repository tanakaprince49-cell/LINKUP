import React,{useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Linking,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {builderCall} from '../lib/builder';
import {calendarWeeks} from '../../../shared/contributions.js';

type Snapshot={days:string[];points:number;totalUpdates:number;today:string;publicMomentum?:boolean;publicUrl?:string};
export default function ContributionCalendar({userId,isDark=false,refreshKey='',onPublish,snapshot}:{userId:string;isDark?:boolean;refreshKey?:string;onPublish?:()=>void;snapshot?:Snapshot}){
 const focused=useIsFocused(),[data,setData]=useState<Snapshot|null>(snapshot||null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{if(snapshot){setData(snapshot);setError('');return;}if(!focused)return;let active=true;setData(null);setError('');void builderCall('contributions',{targetUid:userId}).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message||'Contribution calendar unavailable.');});return()=>{active=false;};},[focused,userId,refreshKey,snapshot,reload]);
 useEffect(()=>{if(!focused||snapshot)return;const timer=setTimeout(()=>setReload(v=>v+1),86400000-(Date.now()%86400000)+500);return()=>clearTimeout(timer);},[focused,snapshot,data?.today]);
 const weeks=useMemo(()=>calendarWeeks(data?.days||[],data?.today?Date.parse(data.today+'T12:00:00Z'):Date.now()),[data]);
 const todayActive=weeks.some(w=>w.some(d=>d.today&&d.active));
 const ink=isDark?'#F4F5F7':'#0A0B0D',muted=isDark?'#A8B0BD':'#575B60',empty=isDark?'#2A2D34':'#E3E1D8';
 const visible=weeks.flat().filter(d=>d.active),label=visible.length?`Recorded contribution days: ${visible.map(d=>d.day).join(', ')}. Dates use UTC.`:'No recorded contribution days in the last 12 weeks.';
 return <View style={[styles.card,{backgroundColor:isDark?'#171A21':'#FFFFFF',borderColor:isDark?'#383A42':'#DDDAD1'}]}>
  <View style={styles.heading}><View style={{flex:1}}><Text style={[styles.eyebrow,{color:muted}]}>BUILDER MOMENTUM</Text><Text style={[styles.title,{color:ink}]}>Small steps. Visible progress.</Text></View><View style={[styles.total,{backgroundColor:isDark?'#292B31':'#FBE618'}]}><Text style={[styles.points,{color:ink}]}>{data?.points??'—'}</Text><Text style={{fontSize:10,color:muted,fontWeight:'700'}}>contribution pts</Text></View></View>
  {error?<View style={{gap:8}}><Text style={{color:muted,fontSize:13}}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>setReload(v=>v+1)}><Text style={{color:ink,fontWeight:'800'}}>Retry calendar</Text></TouchableOpacity></View>:!data?<ActivityIndicator color={ink}/>:<>
   <View style={styles.grid} accessible accessibilityRole="image" accessibilityLabel={label}>
    <View style={styles.weekdays}>{['M','','W','','F','',''].map((d,i)=><View key={i} style={styles.weekday}><Text style={{color:muted,fontSize:10}}>{d}</Text></View>)}</View>
    <View style={styles.weeks}>{weeks.map((week,i)=><View key={i} style={styles.week}>{week.map(cell=><View key={cell.day} testID={`contribution-${cell.day}`} style={[styles.cell,{backgroundColor:cell.active?'#FBE618':empty,opacity:cell.future?0.28:1},cell.active&&styles.glow,cell.today&&{borderColor:isDark?'#FBE618':'#0A0B0D',borderWidth:1.5}]}/>)}</View>)}</View>
   </View>
   <View style={styles.legend}><Text style={{color:muted,fontSize:12,flex:1}}>{visible.length} recorded {visible.length===1?'day':'days'} · last 12 weeks</Text><View style={[styles.legendSquare,{backgroundColor:empty}]}/><Text style={{color:muted,fontSize:10}}>No update</Text><View style={[styles.legendSquare,{backgroundColor:'#FBE618'}]}/><Text style={{color:muted,fontSize:10}}>Recorded</Text></View>
   <Text style={{color:muted,fontSize:12,lineHeight:18}}>{todayActive?'Today is lit up. Your next useful step can be small.':'Your next progress update lights up a square. No streak to lose.'}</Text>
  </>}
  <Text style={{color:muted,fontSize:10,lineHeight:16}}>UTC calendar · 10 points per recorded update, at most one per day. Self-reported activity, not a skill score or verification.</Text>
  {data?.publicMomentum&&data?.publicUrl&&<TouchableOpacity accessibilityRole="link" onPress={()=>void Linking.openURL(data.publicUrl!)}><Text style={{color:ink,fontWeight:'800'}}>View searchable Momentum & streak card ↗</Text></TouchableOpacity>}
  {onPublish&&<TouchableOpacity accessibilityRole="button" accessibilityLabel="Share a build update" onPress={onPublish} style={styles.action}><Text style={{color:'#0A0B0D',fontWeight:'800',fontSize:14}}>Share a build update →</Text></TouchableOpacity>}
 </View>;
}
const styles=StyleSheet.create({card:{borderWidth:1,borderRadius:24,padding:18,gap:16},heading:{flexDirection:'row',alignItems:'center',gap:12},eyebrow:{fontSize:10,fontWeight:'900',letterSpacing:1.5,marginBottom:7},title:{fontSize:20,lineHeight:25,fontWeight:'800'},total:{padding:10,borderRadius:15,alignItems:'center'},points:{fontSize:26,fontWeight:'900'},grid:{flexDirection:'row',gap:6,maxWidth:410,width:'100%'},weekdays:{width:16,gap:5},weekday:{flex:1,justifyContent:'center'},weeks:{flex:1,flexDirection:'row',gap:5},week:{flex:1,gap:5},cell:{width:'100%',aspectRatio:1,borderRadius:4},glow:{shadowColor:'#FBE618',shadowOpacity:.8,shadowRadius:7,shadowOffset:{width:0,height:0},elevation:4},legend:{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'},legendSquare:{width:8,height:8,borderRadius:2},action:{padding:14,borderRadius:15,backgroundColor:'#FBE618',alignItems:'center'}});
