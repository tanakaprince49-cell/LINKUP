import React,{useEffect,useState} from 'react';
import {Image,Text,View} from 'react-native';
export default function ProfileAvatar({uri,name='Builder',size=56,dark=false}: {uri?:string;name?:string;size?:number;dark?:boolean}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[uri]);return <View style={{width:size,height:size,borderRadius:size*.3,overflow:'hidden',backgroundColor:dark?'#30322B':'#EAE8DB',alignItems:'center',justifyContent:'center'}}>{uri&&!failed?<Image accessibilityLabel={name+' profile photo'} onError={()=>setFailed(true)} source={{uri}} style={{width:size,height:size}}/>:<Text style={{color:dark?'#FBE618':'#33382A',fontSize:size*.36,fontWeight:'900'}}>{name.trim().slice(0,1).toUpperCase()||'B'}</Text>}</View>;
}
