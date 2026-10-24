import ProfileAvatar from '../components/ProfileAvatar';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Linking,Platform,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {Crown,Trophy,ArrowUpRight,Flame} from 'lucide-react-native';
import {useAuth} from '../contexts/AuthContext';
import {useTheme} from '../contexts/ThemeContext';
import {fetchBuilderLeague,fetchActivityLeague,type LeaguePeriod} from '../lib/activityLeague';
import {builderCall} from '../lib/builder';
import ScreenHeader from '../components/ScreenHeader';
import MemberBadges from '../components/MemberBadges';

const YELLOW='#FBE618',INK='#0A0B0D';

function resetLabel(period:string){
 if(period==='all')return 'Lifetime points · no reset';
 const now=new Date();let end:number;
 if(period==='week'){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));const offset=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-offset+7);end=+d;}
 else if(period==='month'){end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1);}
 else {end=Date.UTC(now.getUTCFullYear()+1,0,1);}
 const hours=Math.max(0,Math.floor((end-Date.now())/3600000));
 return `Resets in ${Math.floor(hours/24)}d ${hours%24}h · UTC`;
}

const PERIODS:[string,string][]=[['week','This week'],['month','This month'],['year','This year']];

/** #1 keeps the crown. The first four are featured above the full board. */
function Podium({rows,onOpen,dark,period}:{rows:any[];onOpen:(uid:string)=>void;dark:boolean;period:string}){
 const ink=dark?'#F4F5F7':INK,muted=dark?'#A8B0BD':'#575B60';
 if(!rows.length)return null;
 const [first,...challengers]=rows;
 const label=period==='week'?'this week':period==='month'?'this month':'this year';
 return <View style={{gap:10}}>
  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${first.name}, number 1 ${label}`} onPress={()=>onOpen(first.uid)} style={styles.championCard}>
   <View style={{flexDirection:'row',alignItems:'center',gap:7}}>
    <Crown size={16} color={INK} fill={INK}/>
    <Text numberOfLines={1} style={{color:INK,fontSize:11,fontWeight:'900',letterSpacing:1.4}}>NUMBER 1 · {label.toUpperCase()}</Text>
   </View>
   <View style={{flexDirection:'row',alignItems:'center',gap:14,width:'100%'}}>
    <View style={styles.championAvatar}><ProfileAvatar uri={first.image} name={first.name} size={72} dark={false}/></View>
    <View style={{flex:1,gap:3}}>
     <View style={{flexDirection:'row',alignItems:'center',gap:5}}><Text numberOfLines={1} style={{color:INK,fontWeight:'900',fontSize:23,flexShrink:1}}>{first.name}</Text><MemberBadges userId={first.uid} verified={first.verified} size={16}/></View>
     <Text numberOfLines={1} style={{color:'#4B4415',fontSize:12}}>{first.occupation||'LINKUP builder'}</Text>
    </View>
    <View style={{alignItems:'flex-end'}}><Text style={{color:INK,fontSize:34,fontWeight:'900'}}>{first.points}</Text><Text style={{color:'#4B4415',fontSize:10,fontWeight:'800'}}>POINTS</Text></View>
   </View>
   <View style={styles.championDivider}/>
   <Text style={{color:'#4B4415',fontSize:11,fontWeight:'700'}}>{first.buildDays} recorded build days · {first.helpful??0} helpful steps · tap to open their profile</Text>
  </TouchableOpacity>
  {challengers.length>0&&<View style={{flexDirection:'row',gap:9}}>
   {challengers.map((p:any)=>(
    <TouchableOpacity key={p.uid} accessibilityRole="button" accessibilityLabel={`Open ${p.name}, number ${p.rank}`} onPress={()=>onOpen(p.uid)} style={[styles.runnerUp,{backgroundColor:dark?'#171A21':'#FFFFFF',borderColor:dark?'#35373D':'#E6E1CB'}]}>
     <View style={styles.rankChip}><Text style={{color:INK,fontSize:12,fontWeight:'900'}}>{p.rank}</Text></View>
     <ProfileAvatar uri={p.image} name={p.name} size={44} dark={dark}/>
     <Text numberOfLines={1} style={{color:ink,fontSize:12,fontWeight:'900',textAlign:'center'}}>{p.name.split(' ')[0]}</Text>
     <Text style={{color:muted,fontSize:12,fontWeight:'800'}}>{p.points}</Text>
    </TouchableOpacity>
   ))}
  </View>}
 </View>;
}

export default function TrendingBuildersScreen({navigation,local=false}:any){
 const {user,profile}=useAuth(),{theme}=useTheme(),dark=theme==='dark',focused=useIsFocused();
 const [view,setView]=useState('builders'); // Builders is the first page; positions load with it.
 const [period,setPeriod]=useState<LeaguePeriod>('week'),[board,setBoard]=useState<any>(null),[habit,setHabit]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[joining,setJoining]=useState(false),[clock,tick]=useState(0);
 const city=local?String(profile?.city||''):'',country=local?String(profile?.country||''):'';
 const builders=view==='builders';
 const scope=[view,period,user?.uid,city,country].join('|'),identity=useRef(scope);identity.current=scope;const generation=useRef(0);
 const current=board?.scopeKey===scope?board:null;
 const load=useCallback(async()=>{
  const g=++generation.current;setLoading(true);setError('');
  try{
   const data=builders
    ? await fetchBuilderLeague({uid:user?.uid,city,country}).then(async b=>{
       const act=await fetchActivityLeague(period,{uid:user?.uid,city,country}).catch(()=>null);
       const ranks:Record<string,{rank:number;points:number}>={};
       for(const r of act?.rows||[])ranks[r.uid]={rank:r.rank,points:r.points};
       return {...b,ranks,champions:act?.champions||b.champions||null};
      })
    : await fetchActivityLeague(period,{uid:user?.uid,city,country});
   const h=user?.uid?await builderCall('habit').catch(()=>null):null;
   if(g!==generation.current||identity.current!==scope)return;
   setBoard({...data,scopeKey:scope});setHabit(h);
  }catch(e:any){if(g===generation.current)setError(e.message);}finally{if(g===generation.current)setLoading(false);}
 },[builders,period,user?.uid,city,country]);
 useEffect(()=>{if(focused)void load();return()=>{generation.current++;};},[focused,load]);
 useEffect(()=>{if(!focused)return;const timer=setInterval(()=>tick(v=>v+1),60000);return()=>clearInterval(timer);},[focused]);

 const ink=dark?'#F4F5F7':INK,muted=dark?'#A8B0BD':'#575B60',panel={backgroundColor:dark?'#171A21':'#FFFFFF',borderColor:dark?'#35373D':'#E6E1CB'};
 const consent=current?habit:null;
 const my=current?.me||current?.rows?.find((r:any)=>r.uid===user?.uid),next=current?.next||(my?current?.rows?.filter((r:any)=>r.rank<my.rank).at(-1):null);
 const rows:any[]=current?.rows||[];
 const featured=builders?[]:rows.slice(0,4);
 const rest=builders?rows:rows.slice(4);
 const champions=current?.champions||null;
 const openProfile=(uid:string)=>navigation.navigate('Profile',{userId:uid});

 const join=()=>{const confirm=async()=>{setJoining(true);setError('');try{await builderCall('habitPrefs',{publicMomentum:true});await load();}catch(e:any){setError(e.message);}finally{setJoining(false);}};const message='Your public name, location, earned activity totals and recorded calendar dates may appear on Google. Your update text, wallet and chats stay private. You can turn this off in Progress Log, though search caches may take time to refresh.';if(Platform.OS==='web'){if((globalThis as any).confirm?.(message))void confirm();}else Alert.alert('Enter the public Builder League?',message,[{text:'Not now',style:'cancel'},{text:'Make momentum public',onPress:()=>void confirm()}]);};
 const button=(title:string,fn:()=>void,secondary=false)=><TouchableOpacity accessibilityRole="button" disabled={joining} onPress={fn} style={[styles.button,{backgroundColor:secondary?(dark?'#2A2D34':'#EFEAD5'):YELLOW}]}><Text style={{color:secondary?ink:INK,fontSize:13,fontWeight:'900',textAlign:'center'}}>{title}</Text></TouchableOpacity>;
 const title=local?(city||country?'Your local league':'Global league'):'Builder League';

 return <SafeAreaView style={{flex:1,backgroundColor:dark?'#0A0B0D':'#F6F3E6'}}>
  <ScreenHeader title={title} subtitle="Good people. Useful connections." isDark={dark} onBack={()=>navigation.goBack()}/>
  <FlatList data={rest} keyExtractor={(r:any)=>r.uid} refreshing={loading} onRefresh={()=>void load()} contentContainerStyle={styles.content}
   ListHeaderComponent={<View style={{gap:14}}>
    {/* The gold arena. No black band: the brand colour carries the header. */}
    <View style={styles.hero}>
     <Text style={styles.eyebrow}>LINKUP / THE BUILDER NETWORK{local&&city?' · '+city.toUpperCase():''}</Text>
     <Text style={styles.heroTitle}>{builders?'Find your people.':'Build. Help. Climb.'}</Text>
     <Text style={styles.heroBody}>{builders?'Real eligible public builders, each with their league position when they compete. Tap a face to open the person.':'Record a build day, help someone honestly, and watch your number move. Every point is a recorded contribution—never a paid boost.'}</Text>
     <View style={styles.heroRow}>
      <View style={styles.pill}><Text style={styles.pillText}>{builders?'NO ACTIVITY OPT-IN NEEDED':resetLabel(period)}</Text></View>
      {!builders&&my?<View style={[styles.pill,{backgroundColor:INK}]}><Text style={[styles.pillText,{color:YELLOW}]}>YOU · #{my.rank} · {my.points} PTS</Text></View>:null}
     </View>
    </View>

    <View style={styles.row}>{[['builders','Builders'],['activity','Activity competition']].map(([value,label])=><TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{selected:view===value}} onPress={()=>setView(value)} style={[styles.tab,{backgroundColor:view===value?INK:panel.backgroundColor,borderColor:view===value?INK:panel.borderColor}]}><Text style={{color:view===value?YELLOW:ink,fontWeight:'900',fontSize:12}}>{label}</Text></TouchableOpacity>)}</View>
    <View style={styles.row}>{PERIODS.map(([value,label])=><TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{selected:period===value}} onPress={()=>setPeriod(value as LeaguePeriod)} style={[styles.tab,{backgroundColor:period===value?YELLOW:panel.backgroundColor,borderColor:period===value?INK:panel.borderColor}]}><Text style={{color:period===value?INK:ink,fontWeight:'900',fontSize:12}}>{label}</Text></TouchableOpacity>)}</View>

    {error&&<View accessibilityRole="alert" style={[styles.card,panel]}><Text style={{color:muted}}>{error}</Text>{button('Retry standings',()=>void load())}</View>}

    {!builders&&!!featured.length&&<Podium rows={featured} onOpen={openProfile} dark={dark} period={period}/>}

    {!builders&&!!rows.length&&<View style={[styles.card,panel]}>
     <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Flame size={16} color={ink}/><Text style={{color:ink,fontWeight:'900',fontSize:15}}>Your place</Text></View>
     <Text style={{color:ink,fontSize:24,fontWeight:'900'}}>{my?`#${my.rank} · ${my.points} pts`:consent?.publicMomentum?'Ready to score':'Not entered yet'}</Text>
     <Text style={{color:muted,fontSize:13,lineHeight:19}}>{next?`${Math.max(5,next.points-my.points+5)} more points to outscore #${next.rank}. One recorded build day earns 10.`:my?.rank===1?'You hold number 1. The crown is only as good as the next useful step.':consent?.publicMomentum?'Record an update or earn acknowledged helpful-feedback points to enter these standings.':'Entering is voluntary. Your update text, links and group chat never appear here.'}</Text>
     {!consent?.publicMomentum?button(joining?'Entering…':'Enter the public league',join):button('Record progress · +10',()=>navigation.navigate('ShipLog'))}
    </View>}

    {!builders&&!!(champions?.month||champions?.year)&&<View style={[styles.card,panel]}>
     <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Trophy size={16} color={ink}/><Text style={{color:ink,fontWeight:'900',fontSize:15}}>Season champions</Text></View>
     {champions.year?<TouchableOpacity accessibilityRole="button" onPress={()=>openProfile(champions.year.uid)} style={styles.championRow}><View style={styles.smallCrown}><Crown size={12} color={INK} fill={INK}/></View><Text style={{color:ink,fontWeight:'900',fontSize:13}}>{champions.year.key} champion</Text><Text numberOfLines={1} style={{color:muted,fontSize:12,flex:1}}>{champions.year.name} · {champions.year.points} pts</Text><ArrowUpRight size={14} color={muted}/></TouchableOpacity>:null}
     {champions.month?<TouchableOpacity accessibilityRole="button" onPress={()=>openProfile(champions.month.uid)} style={styles.championRow}><View style={styles.smallCrown}><Crown size={12} color={INK} fill={INK}/></View><Text style={{color:ink,fontWeight:'900',fontSize:13}}>{champions.month.key} champion</Text><Text numberOfLines={1} style={{color:muted,fontSize:12,flex:1}}>{champions.month.name} · {champions.month.points} pts</Text><ArrowUpRight size={14} color={muted}/></TouchableOpacity>:null}
     <Text style={{color:muted,fontSize:11,lineHeight:17}}>A month or year with no recorded public activity has no champion. Titles are never carried over or invented.</Text>
    </View>}

    <View style={[styles.card,{backgroundColor:dark?'#141B12':'#EFF7E2',borderColor:dark?'#2C3A25':'#D7E6BE'}]}>
     <View style={{flexDirection:'row',alignItems:'center',gap:8}}><Crown size={16} color={ink}/><Text style={{color:ink,fontWeight:'900',fontSize:15}}>What winning gets you</Text></View>
     <Text style={{color:ink,fontSize:13,lineHeight:20,fontWeight:'700'}}>Win the week and you run one campaign of your own for exactly seven days.</Text>
     <Text style={{color:muted,fontSize:12,lineHeight:19}}>Claim it on the Campaigns page within seven days of the win, publish it once it is approved, and it stays live for one week. When that week ends the campaign is deleted for good and the reward locks—no extension, no second campaign, nothing carried to next week.</Text>
     <Text style={{color:muted,fontSize:12,lineHeight:19}}>Win the month or the year and you keep the title permanently: your name in the champions list and a champion version of your streak card.</Text>
     {button('Open my campaigns',()=>navigation.navigate('Campaigns'),true)}
    </View>

    <View style={[styles.row,{justifyContent:'space-between'}]}><Text style={{color:ink,fontWeight:'900',fontSize:18}}>{builders?'Meet the builders':'Full board'}</Text><Text style={{color:muted,fontSize:11}}>{current?.participants??'—'} participants</Text></View>
   </View>}
   renderItem={({item:r}:any)=>{
    const standing=builders?current?.ranks?.[r.uid]:null;
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open ${r.name} profile`} onPress={()=>openProfile(r.uid)} style={[styles.standing,panel,r.uid===user?.uid&&{borderColor:'#A49B52'}]}>
     <View style={[styles.listRank,{backgroundColor:builders&&!standing?'transparent':YELLOW}]}><Text style={{color:INK,fontSize:13,fontWeight:'900'}}>{builders?(standing?`#${standing.rank}`:'—'):`${r.rank}`}</Text></View>
     <ProfileAvatar uri={r.image} name={r.name} size={54} dark={dark}/>
     <View style={{flex:1,gap:4}}>
      <View style={{flexDirection:'row',alignItems:'center',gap:5}}><Text numberOfLines={1} style={{color:ink,fontWeight:'900',fontSize:15,flexShrink:1}}>{r.name}</Text><MemberBadges userId={r.uid} verified={r.verified} size={14}/></View>
      <Text numberOfLines={1} style={{color:muted,fontSize:12}}>{r.occupation||'LINKUP builder'}</Text>
      <Text numberOfLines={1} style={{color:muted,fontSize:11}}>{[r.city,r.country].filter(Boolean).join(', ')||'Building on LINKUP'}{builders&&r.skills?.length?` · ${r.skills.slice(0,2).join(' · ')}`:''}</Text>
     </View>
     <View style={{alignItems:'flex-end',gap:6}}>{builders
      ?<><Text style={{color:ink,fontSize:14,fontWeight:'900'}}>{standing?`${standing.points}`:'—'}</Text><Text style={{color:muted,fontSize:9}}>{standing?'PTS':'NO PTS'}</Text></>
      :<><Text style={{color:ink,fontSize:21,fontWeight:'900'}}>{r.points}</Text><Text style={{color:muted,fontSize:10}}>points</Text></>}
      <ArrowUpRight size={14} color={muted}/>
     </View>
    </TouchableOpacity>;
   }}
   ListEmptyComponent={!loading?<View style={[styles.card,panel]}><Text style={{color:ink,fontSize:20,fontWeight:'900'}}>{builders?'No public builders in this location yet.':'The next name here could be yours.'}</Text><Text style={{color:muted,lineHeight:21}}>{builders?'Try the global league; hidden and stealth profiles stay excluded.':'No eligible public participants with points in this period yet. No fake leaders, no filler profiles.'}</Text>{button('Record a build day · +10',()=>navigation.navigate('ShipLog'))}</View>:<ActivityIndicator color={ink} style={{margin:20}}/>}
   ListFooterComponent={<View style={[styles.card,panel]}><Text style={{color:ink,fontWeight:'900'}}>{builders?'A clearer picture. A better introduction.':'Recorded activity, transparent rules.'}</Text><Text style={{color:muted,fontSize:12,lineHeight:19}}>{current?.rules||(builders?'Eligible public member profiles. Profile score is completeness, not skill.':'10 points per build day + 5 per rewarded helpful contribution. Activity, not verified skill.')}</Text><Text style={{color:muted,fontSize:11,lineHeight:18}}>{current?.scope} Activity points use recorded contributions only. Profile completeness is shown separately and never proves skill.</Text>{button(local?'See the global competition':'Find your local competition',()=>navigation.navigate(local?'TrendingBuilders':'CityLeague'),true)}{button('How the public page looks ↗',()=>void Linking.openURL('https://www.linkupbuild.com/app/builder-league'+(period==='week'?'':'/'+period)),true)}</View>}/>
 </SafeAreaView>;
}

const styles=StyleSheet.create({
 content:{padding:16,gap:12,paddingBottom:44,maxWidth:900,width:'100%',alignSelf:'center'},
 hero:{backgroundColor:YELLOW,borderRadius:26,padding:22,gap:10,overflow:'hidden'},
 eyebrow:{color:'#4B4415',fontSize:10,letterSpacing:1.4,fontWeight:'900'},
 heroTitle:{color:INK,fontWeight:'900',fontSize:36,lineHeight:40,letterSpacing:-1.1},
 heroBody:{color:'#3B360F',fontSize:13,lineHeight:19},
 heroRow:{flexDirection:'row',gap:7,flexWrap:'wrap',alignItems:'center'},
 pill:{backgroundColor:'#00000018',paddingHorizontal:11,paddingVertical:6,borderRadius:11},
 pillText:{color:INK,fontSize:10,fontWeight:'900',letterSpacing:0.6},
 row:{flexDirection:'row',gap:7,alignItems:'center',flexWrap:'wrap'},
 tab:{flex:1,paddingVertical:11,borderWidth:1.5,borderRadius:13,alignItems:'center',minWidth:92},
 button:{padding:14,minHeight:46,borderRadius:14,justifyContent:'center'},
 card:{padding:17,borderWidth:1,borderRadius:20,gap:10},
 championCard:{backgroundColor:YELLOW,borderRadius:24,padding:18,gap:12,borderWidth:2,borderColor:INK},
 championAvatar:{borderWidth:3,borderColor:INK,borderRadius:26,padding:2},
 championDivider:{height:2,backgroundColor:'#00000022',borderRadius:2},
 runnerUp:{flex:1,padding:12,borderRadius:18,borderWidth:1,alignItems:'center',gap:6},
 rankChip:{backgroundColor:YELLOW,borderRadius:9,paddingHorizontal:8,paddingVertical:2},
 championRow:{flexDirection:'row',alignItems:'center',gap:8},
 smallCrown:{backgroundColor:YELLOW,borderRadius:8,width:22,height:22,alignItems:'center',justifyContent:'center'},
 standing:{flexDirection:'row',alignItems:'center',gap:11,borderWidth:1,borderRadius:20,padding:13},
 listRank:{width:34,height:26,borderRadius:9,alignItems:'center',justifyContent:'center'},
});
