import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Image,Text,TouchableOpacity,View} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../contexts/AuthContext';
import {builderCall} from '../lib/builder';
import GroupBadges from './GroupBadges';
export default function GroupInbox({navigation,isDark=false,archivedOnly=false}:any){
 const {user}=useAuth(),focused=useIsFocused(),[state,setState]=useState<any>(null),[error,setError]=useState('');const generation=useRef(0),uid=user?.uid;
 const data=state?.uid===uid?state:null,ink=isDark?'#F5F5F5':'#0A0B0D',muted=isDark?'#A8B0BD':'#62656B';
 useEffect(()=>{const gen=++generation.current;let running=false;setState(null);setError('');if(!uid||!focused)return;const load=async()=>{if(running||AppState.currentState==='background'||(globalThis as any).document?.visibilityState==='hidden')return;running=true;try{const r=await builderCall('groups');if(gen===generation.current){setState({...r,uid});setError('');}}catch(e:any){if(gen===generation.current)setError(e.message);}finally{running=false;}};void load();const timer=setInterval(()=>void load(),10000);return()=>{generation.current++;clearInterval(timer);};},[uid,focused]);
 const rows=(data?.groups||[]).filter((g:any)=>!!g.archived===archivedOnly);
 return <View style={{gap:12,marginBottom:22}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{color:ink,fontSize:17,fontWeight:'900'}}>Group conversations</Text><TouchableOpacity accessibilityRole="button" onPress={()=>navigation.navigate('BuilderWorkspace',{section:'Groups'})}><Text style={{color:'#0A0B0D',fontWeight:'900',backgroundColor:'#FBE618',padding:10,borderRadius:12}}>New group +</Text></TouchableOpacity></View>
 {!!data?.invitations?.length&&<TouchableOpacity accessibilityRole="button" onPress={()=>navigation.navigate('BuilderWorkspace',{section:'Groups'})}><Text style={{color:ink,fontWeight:'800'}}>{data.invitations.length} group invitation(s) to review →</Text></TouchableOpacity>}
 {error?<Text accessibilityRole="alert" style={{color:muted}}>{error}</Text>:!data?<ActivityIndicator color={ink}/>:null}
 {rows.map((g:any)=><TouchableOpacity key={g.id} accessibilityRole="button" accessibilityLabel={'Open group '+g.title} onPress={()=>navigation.navigate('GroupChat',{groupId:g.id})} style={{flexDirection:'row',gap:12,alignItems:'center',padding:14,borderRadius:19,borderWidth:1,borderColor:isDark?'#383A42':'#DDDAD1',backgroundColor:isDark?'#171A21':'#FFF'}}>
 {g.photo?<Image source={{uri:g.photo}} style={{width:52,height:52,borderRadius:18}}/>:<View style={{width:52,height:52,borderRadius:18,backgroundColor:'#FBE618',alignItems:'center',justifyContent:'center'}}><Text style={{color:'#0A0B0D',fontSize:22,fontWeight:'900'}}>{g.title.slice(0,1)}</Text></View>}
 <View style={{flex:1,gap:5}}><View style={{flexDirection:'row',gap:5,alignItems:'center'}}><Text numberOfLines={1} style={{color:ink,fontWeight:'900',maxWidth:'72%'}}>{g.title}</Text><GroupBadges verified={g.verified} gold={g.gold}/></View><Text numberOfLines={1} style={{color:muted,fontSize:12}}>{g.preferences?.pinned?'Pinned · ':''}{g.preferences?.muted?'Muted · ':''}{g.preview||`${g.memberCount} members`}</Text></View>{g.unread&&<View accessibilityLabel="Unread group messages" style={{width:11,height:11,borderRadius:6,backgroundColor:'#FBE618'}}/>}</TouchableOpacity>)}
 {data&&!rows.length&&<Text style={{color:muted,fontSize:12,lineHeight:19}}>Accepted groups appear here automatically. Create one or review your invitations.</Text>}<Text style={{color:ink,fontSize:17,fontWeight:'900',marginTop:8}}>Direct messages</Text></View>;
}
