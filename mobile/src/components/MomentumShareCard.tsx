import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Image,Text,TouchableOpacity,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {useAuth} from '../contexts/AuthContext';
import {onMomentumVisibilityChanged} from '../lib/momentumEvents';
import {builderCall} from '../lib/builder';
import {momentumCardUrl,momentumPageUrl,shareMomentumCard} from '../lib/momentumShare';
export default function MomentumShareCard({isDark=false,refreshKey=''}:{isDark?:boolean;refreshKey?:string}){
 const {user}=useAuth(),uid=user?.uid,[revision,setRevision]=useState(0),[record,setRecord]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const h=record?.uid===uid?record:null;
 useEffect(()=>{let active=true;setRecord(null);setError('');if(uid)void builderCall('habit').then(r=>{if(active)setRecord({...r,uid});}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[uid,refreshKey,revision]);
 useEffect(()=>onMomentumVisibilityChanged(who=>{if(who===uid){setRecord(null);setRevision(v=>v+1);}}),[uid]);
 const ink=isDark?'#F5F5F5':'#0A0B0D',muted=isDark?'#A8B0BD':'#575B60';
 const run=async(fn:()=>Promise<any>)=>{if(busy||!uid)return;setBusy(true);setError('');try{await fn();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <View style={{padding:18,gap:13,borderRadius:24,borderWidth:1,borderColor:isDark?'#383A42':'#DDDAD1',backgroundColor:isDark?'#171A21':'white'}}><Text style={{color:ink,fontSize:20,fontWeight:'900'}}>Make your momentum shareable.</Text><Text style={{color:muted,lineHeight:20,fontSize:13}}>A LINKUP-yellow card with your profile photo, current build streak, recorded days and verified badges. Made for sharing—not a skill certificate. People can keep downloaded cards even if you later turn public Momentum off.</Text>
 {h?.publicMomentum?<><Image onError={()=>setError('Your public card could not load. Check profile visibility and your public Momentum setting.')} accessibilityLabel="Your shareable LINKUP Momentum card" source={{uri:momentumCardUrl(uid!)+`&v=${encodeURIComponent(refreshKey||h.today)}`}} style={{width:'100%',aspectRatio:1,borderRadius:20}}/><TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void run(()=>shareMomentumCard(uid!))} style={{padding:15,borderRadius:15,backgroundColor:'#FBE618'}}><Text style={{color:'#0A0B0D',fontWeight:'900',textAlign:'center'}}>Share / download my streak card</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>void run(()=>Clipboard.setStringAsync(momentumPageUrl(uid!)))}><Text style={{color:ink,fontWeight:'800',textAlign:'center',padding:9}}>Copy my public Momentum link</Text></TouchableOpacity></>:<Text style={{color:muted,lineHeight:20}}>First enable “Public league & Google momentum” above. That publishes your name, location, activity totals and calendar dates. It never publishes update text, links or private groups.</Text>}
 {error&&<Text accessibilityRole="alert" style={{color:muted}}>{error}</Text>}{busy&&<ActivityIndicator color={ink}/>}</View>;
}
