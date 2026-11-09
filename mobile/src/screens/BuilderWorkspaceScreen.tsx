import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Image,Platform,RefreshControl,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../contexts/AuthContext';
import {useTheme} from '../contexts/ThemeContext';
import {COLORS,appBackground,textColor} from '../theme/theme';
import {GroupsPanel} from './GroupChatScreen';
import ScreenHeader from '../components/ScreenHeader';
import VerifiedBadge from '../components/VerifiedBadge';
import {builderCall,builderSection,BUILDER_SECTIONS,BuilderSection} from '../lib/builder';
import {ICON_VARIANTS,ICON_VARIANT_IMAGES,getLatestResolvedAppearance,loadSavedIconMode,launcherIconControlAvailable,setSavedIconMode,subscribeDynamicAppearance} from '../lib/dynamicAppearance';

export default function BuilderWorkspaceScreen({navigation,route}:any){
 const {user}=useAuth(),{theme}=useTheme(),dark=theme==='dark';
 const [section,setSection]=useState<BuilderSection>(builderSection(route?.params?.section));
 const [home,setHome]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[refreshing,setRefreshing]=useState(false);
 const generation=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 const refresh=useCallback(async(visit=false)=>{const g=++generation.current;setError('');try{const h=await builderCall(visit?'visit':'home');if(!alive.current||g!==generation.current)return;setHome(h);}catch(e:any){if(alive.current&&g===generation.current)setError(e.message||'Could not load your workspace.');}},[]);
 useEffect(()=>{setHome(null);void refresh(true);},[refresh,user?.uid]);
 useEffect(()=>{if(route?.params?.section)setSection(builderSection(route.params.section));},[route?.params?.section]);
 const choose=(s:BuilderSection)=>{setSection(s);setError('');};
 const [iconMode,setIconModeState]=useState('auto');
 useEffect(()=>{let alive=true;loadSavedIconMode().then((m)=>{if(alive)setIconModeState(m);}).catch(()=>{});return()=>{alive=false;};},[]);
 const [,setAppearanceTick]=useState(0);
 useEffect(()=>subscribeDynamicAppearance(()=>setAppearanceTick((t)=>t+1)),[]);
 // A tap must land on this device NOW: save + emit locally first (the icon
 // controller hears the emit and swaps the launcher icon), then persist to
 // the server. Before this, the local apply waited on the server round-trip
 // inside builderCall — and never happened at all on shells where that call
 // failed, so taps looked dead.
 const pickIcon=(id:string)=>{setIconModeState(id);void setSavedIconMode(id);void act('prefs',{iconMode:id});};
 const iconOptions=[{id:'auto',label:'Auto'},{id:'classic',label:'Classic'},...ICON_VARIANTS.map((v)=>({id:v.id,label:v.label}))];
 const run=async(label:string,action:()=>Promise<any>)=>{if(busy)return;setBusy(label);setError('');try{const result=await action();await refresh();return result;}catch(e:any){setError(e.message||'That action could not finish.');}finally{setBusy('');}};
 const act=(op:string,input:Record<string,unknown>={},after?:(r:any)=>void)=>run(op,async()=>{const r=await builderCall(op,input);after?.(r);return r;});
 const button=(label:string,onPress:()=>void,secondary=false)=> <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={!!busy} onPress={onPress} style={[styles.button,secondary&&styles.secondary,!!busy&&{opacity:.55}]}><Text style={[styles.buttonText,secondary&&{color:'#0A0B0D'}]}>{label}</Text></TouchableOpacity>;
 const text=(value:string)=> <Text style={[styles.body,{color:textColor(dark,'secondary')}]}>{value}</Text>;
 const isTabWorkspace=route?.name==='Workspace';
 if(!home)return <SafeAreaView edges={isTabWorkspace?[]:undefined} style={[styles.root,appBackground(dark)]}>{!isTabWorkspace?<ScreenHeader title="Your builder workspace" onBack={()=>navigation.goBack()} isDark={dark}/>:null}<View style={{padding:24,gap:16}}>{error?text(error):<ActivityIndicator color={COLORS.primaryStrong}/>} {error?button('Try again',()=>void refresh(true)):null}</View></SafeAreaView>;
 return <SafeAreaView edges={isTabWorkspace?[]:undefined} style={[styles.root,appBackground(dark)]}>
  {!isTabWorkspace?<ScreenHeader title="Builder workspace" subtitle="Your groups." onBack={()=>navigation.goBack()} isDark={dark} right={<VerifiedBadge size={20}/>}/>:null}
  {/* One section means no tab strip: the workspace IS Groups. */}
  {BUILDER_SECTIONS.length>1?<View style={{paddingHorizontal:18,paddingBottom:8}}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{BUILDER_SECTIONS.map(tab=><TouchableOpacity key={tab} accessibilityRole="button" accessibilityState={{selected:section===tab}} onPress={()=>choose(tab)} style={[styles.tab,section===tab&&styles.activeTab]}><Text style={{color:section===tab?'#0A0B0D':'#575B60',fontWeight:'800'}}>{tab}</Text></TouchableOpacity>)}</ScrollView></View>:null}
  <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async()=>{setRefreshing(true);await refresh();setRefreshing(false);}}/>}>
   {error?<View accessibilityRole="alert" style={styles.error}><Text style={{color:'#9f1239'}}>{error}</Text></View>:null}{busy?<ActivityIndicator color={COLORS.primaryStrong}/>:null}
   {section==='Groups'&&<GroupsPanel navigation={navigation} isDark={dark}/>}
   <View style={[styles.card,{borderColor:dark?'#2A2E35':'#E8E6DE',backgroundColor:dark?'#14161A':'#FFFFFF'}]}>
    <Text style={[styles.cardTitle,{color:textColor(dark)}]}>App logo</Text>
    <Text style={[styles.body,{color:textColor(dark,'secondary')}]}>Your launcher logo changes with your activity — away a day, on a streak, shipped something. Pin the one you love, or let LINKUP keep choosing. Right now it is showing: {getLatestResolvedAppearance().meta.label}.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:12,paddingVertical:4}}>
     {iconOptions.map((opt)=>{const selected=iconMode===opt.id;const img=ICON_VARIANT_IMAGES[opt.id]||ICON_VARIANT_IMAGES.default;return <TouchableOpacity key={opt.id} accessibilityRole="button" accessibilityLabel={`App logo: ${opt.label}`} accessibilityState={{selected}} disabled={!!busy} onPress={()=>pickIcon(opt.id)} style={{width:76,alignItems:'center',gap:6,opacity:busy?0.55:1}}><Image source={img} style={{width:60,height:60,borderRadius:16,borderWidth:selected?3:1,borderColor:selected?'#FBE618':'#E8E6DE'}}/><Text numberOfLines={2} style={{fontSize:10.5,fontWeight:selected?'900':'600',textAlign:'center',color:textColor(dark)}}>{opt.label}</Text></TouchableOpacity>;})}
    </ScrollView>
    <Text style={[styles.body,{color:textColor(dark,'secondary')}]}>{iconMode==='auto'?'Auto: LINKUP picks your logo from your activity. It settles back the moment you return.':iconMode==='classic'?'Classic: the original logo, always. Nothing changes it.':'Pinned: this logo stays until you change it here.'}</Text>
    {Platform.OS!=='web'&&!launcherIconControlAvailable()?<Text style={[styles.body,{color:textColor(dark,'secondary')}]}>This preview build can't switch the home-screen icon itself — your choice is saved and takes over in the installed LINKUP app.</Text>:null}
   </View>
   <View style={{height:24}}/>
  </ScrollView>
 </SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},content:{padding:18,gap:16,maxWidth:850,width:'100%',alignSelf:'center'},tab:{paddingHorizontal:15,paddingVertical:12,borderRadius:22,backgroundColor:'#E8E6DE'},activeTab:{backgroundColor:'#FBE618'},card:{borderWidth:1,borderRadius:22,padding:20,gap:12},cardTitle:{fontSize:19,fontWeight:'800'},body:{fontSize:14,lineHeight:22},button:{backgroundColor:'#FBE618',borderRadius:14,padding:14,alignItems:'center',marginVertical:3,minHeight:46},secondary:{backgroundColor:'#E8E6DE'},buttonText:{fontWeight:'800',fontSize:14,color:'#0A0B0D'},error:{padding:14,borderRadius:12,backgroundColor:'#ffe4e6'}});
