import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,FlatList,Keyboard,Linking,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../contexts/AuthContext';
import {useTheme} from '../contexts/ThemeContext';
import {COLORS,appBackground,textColor} from '../theme/theme';
import {normalizeShipLogs} from '../lib/dailyLoop';
import {builderCall,coachRequestKey} from '../lib/builder';
import ContributionCalendar from '../components/ContributionCalendar';
import ScreenHeader from '../components/ScreenHeader';
import VerifiedBadge from '../components/VerifiedBadge';

export default function ShipLogScreen({navigation}:any){
 const {user,profile}=useAuth(),{theme}=useTheme(),dark=theme==='dark',focused=useIsFocused();
 const [text,setText]=useState(''),[link,setLink]=useState(''),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [summary,setSummary]=useState<any>(null),[receipt,setReceipt]=useState<any>(null),[logs,setLogs]=useState<any[]>(()=>normalizeShipLogs(profile?.shipLogs));
 const pending=useRef<{key:string;text:string;link:string}|null>(null),generation=useRef(0),list=useRef<FlatList>(null);
 const load=useCallback(async()=>{const g=++generation.current;setLoading(true);setError('');try{const r=await builderCall('contributions');if(g!==generation.current)return;setSummary(r);setReceipt(r.updates?.[0]?.day===r.today?r.updates[0]:null);const saved=new Map((r.updates||[]).map((u:any)=>[u.id,u]));setLogs(normalizeShipLogs(r.shipLogs).map(l=>saved.get(l.id)||l));}catch(e:any){if(g===generation.current)setError(e.message||'Could not load your progress.');}finally{if(g===generation.current)setLoading(false);}},[]);
 useEffect(()=>{setSummary(null);setReceipt(null);setText('');setLink('');setLogs([]);pending.current=null;},[user?.uid]);
 useEffect(()=>{if(focused&&user?.uid)void load();return()=>{generation.current++;};},[focused,user?.uid,load]);
 useEffect(()=>{if(!focused)return;const untilMidnight=86400000-(Date.now()%86400000)+500;const timer=setTimeout(()=>{setReceipt(null);void load();},untilMidnight);return()=>clearTimeout(timer);},[focused,summary?.today,load]);
 const submit=async()=>{
  if(!user?.uid||saving)return;const line=text.trim(),url=link.trim();if(line.length<12){setError('Add at least 12 characters describing a result, learning or next step.');return;}
  if(!pending.current||pending.current.text!==line||pending.current.link!==url)pending.current={key:coachRequestKey(),text:line,link:url};
  setSaving(true);setError('');const g=generation.current;
  try{const r=await builderCall('shipUpdate',pending.current);if(g!==generation.current)return;
   setReceipt(r);const snap={days:r.days,points:r.contributionPoints,totalUpdates:r.totalUpdates,today:r.today||r.day};setSummary(snap);
   setLogs(r.shipLogs);
   setText('');setLink('');pending.current=null;Keyboard.dismiss();list.current?.scrollToOffset({offset:0,animated:true});
  }catch(e:any){if(g===generation.current)setError(e.message||'Could not record your update. Retry safely: the same request cannot earn points twice.');}
  finally{setSaving(false);}
 };
 const doneToday=!!summary?.days?.includes(summary?.today),ink=textColor(dark),muted=textColor(dark,'secondary');
 const panel={backgroundColor:dark?'#18251F':'#FFFFFF',borderColor:dark?'#314638':'#DCE6D5'};
 return <SafeAreaView style={[styles.root,appBackground(dark)]}>
  <ScreenHeader title="Progress log" subtitle="Record a step. Get a useful next one." onBack={()=>navigation.goBack()} isDark={dark}/>
  <FlatList ref={list} data={logs} keyExtractor={item=>item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} refreshing={loading} onRefresh={()=>void load()}
   ListHeaderComponent={<View style={{gap:16}}>
    {receipt&&<View accessibilityRole="alert" style={[styles.insight,{backgroundColor:dark?'#203B28':'#EBF6D9',borderColor:dark?'#527445':'#BED796'}]}>
     <View style={styles.row}><Text style={[styles.insightTitle,{color:ink}]}>Linky</Text><VerifiedBadge size={16}/><Text style={[styles.reward,{color:ink}]}>+{receipt.pointsAwarded} contribution pts{receipt.replayed?' · already recorded':''}</Text></View>
     <Text style={[styles.insightText,{color:ink}]}>{receipt.insight}</Text><Text style={{color:muted,fontSize:11}}>Instant topic-based coaching · no chat credit used · not a code audit</Text>
     <TouchableOpacity accessibilityRole="button" onPress={()=>navigation.navigate('BuilderWorkspace',{section:'Coach',coachKind:'blocker',material:receipt.text})}><Text style={{color:ink,fontWeight:'800',marginTop:6}}>Go deeper with Linky · uses your existing allowance →</Text></TouchableOpacity>
    </View>}
    <View style={[styles.composer,panel]}>
     <Text style={[styles.label,{color:ink}]}>What moved forward?</Text>
     <Text style={{fontSize:13,lineHeight:20,color:muted}}>A result, a customer insight or a build milestone. Do not include credentials or private customer data. New update text and Linky feedback stay private; the calendar follows your profile’s visibility.</Text>
     <TextInput accessibilityLabel="Build update" value={text} onChangeText={setText} editable={!saving&&!doneToday} placeholder={doneToday?'Your update is recorded for today.':'Tightened Firestore rules and added tests for blocked reads'} placeholderTextColor={muted} maxLength={180} multiline style={[styles.input,{color:ink,borderColor:panel.borderColor}]}/>
     <TextInput accessibilityLabel="Optional update link" value={link} onChangeText={setLink} editable={!saving&&!doneToday} placeholder="Optional HTTPS link" placeholderTextColor={muted} maxLength={2048} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[styles.link,{color:ink,borderColor:panel.borderColor}]}/>
     {error?<View accessibilityRole="alert"><Text style={{color:dark?'#FDA4AF':'#A51E35',lineHeight:20}}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={()=>void load()}><Text style={{color:ink,fontWeight:'800',marginTop:8}}>Refresh progress</Text></TouchableOpacity></View>:null}
     <TouchableOpacity accessibilityRole="button" accessibilityLabel={doneToday?'Today’s square is lit':'Publish update · earn 10 contribution points'} onPress={()=>void submit()} disabled={saving||loading||doneToday} style={[styles.button,{opacity:saving||loading||doneToday?0.6:1}]}>{saving?<ActivityIndicator color="#183522"/>:<Text style={styles.buttonText}>{doneToday?'Today’s square is lit':'Publish update · +10 contribution points'}</Text>}</TouchableOpacity>
     <Text style={{fontSize:11,lineHeight:17,color:muted}}>One rewarded update per UTC day. Retries never double-count. No missed-day penalties or automatic skill badges.</Text>
    </View>
    {user?.uid&&<ContributionCalendar userId={user.uid} isDark={dark} snapshot={summary||undefined}/>}
    <Text style={[styles.historyTitle,{color:ink}]}>Your build history</Text>
   </View>}
   renderItem={({item})=><View style={[styles.log,panel]}><Text style={{fontSize:15,lineHeight:23,color:ink,fontWeight:'600'}}>{item.text}</Text><Text style={{fontSize:11,color:muted,marginTop:8}}>{item.createdAt.slice(0,10)} · {item.pointsAwarded?`${item.pointsAwarded} contribution pts`:'Earlier self-reported update'}</Text>{item.insight&&<Text style={{fontSize:13,color:muted,lineHeight:21,marginTop:10}}>Linky: {item.insight}</Text>}{typeof item.link==='string'&&item.link.startsWith('https://')&&<TouchableOpacity accessibilityRole="link" onPress={()=>void Linking.openURL(item.link)}><Text style={{color:ink,fontWeight:'700',marginTop:8,textDecorationLine:'underline'}}>Open update link ↗</Text></TouchableOpacity>}</View>}
   ListEmptyComponent={!loading?<Text style={{color:muted,textAlign:'center',padding:20}}>Your first useful update starts the calendar. There is no streak to catch up on.</Text>:null}/>
 </SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},content:{padding:18,gap:12,width:'100%',maxWidth:760,alignSelf:'center',paddingBottom:40},composer:{padding:18,borderWidth:1,borderRadius:24,gap:12},label:{fontSize:20,fontWeight:'800'},input:{borderWidth:1,borderRadius:14,padding:13,minHeight:95,fontSize:15,lineHeight:23,textAlignVertical:'top'},link:{borderWidth:1,borderRadius:14,padding:13,minHeight:48,fontSize:14},button:{backgroundColor:'#D8F6AF',minHeight:52,padding:15,borderRadius:15,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:14,fontWeight:'800',color:'#183522'},insight:{borderWidth:1,borderRadius:24,padding:20,gap:12},row:{flexDirection:'row',alignItems:'center',gap:5,flexWrap:'wrap'},insightTitle:{fontSize:18,fontWeight:'900'},reward:{fontSize:11,fontWeight:'800',marginLeft:7},insightText:{fontSize:16,lineHeight:25,fontWeight:'600'},historyTitle:{fontSize:18,fontWeight:'800',marginTop:10,marginBottom:2},log:{padding:18,borderWidth:1,borderRadius:20}});
