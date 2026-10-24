import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {builderCall} from '../lib/builder';
const EMPTY:any[]=[];
export default function useDailyPicks(uid?:string,focused=true){
 const [clock,tick]=useState(Date.now()),[record,setRecord]=useState<any>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);const generation=useRef(0);
 const day=new Date(clock).toLocaleDateString('en-CA'),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',scope=uid+'|'+day+'|'+timeZone,identity=useRef(scope);identity.current=scope;
 const refresh=useCallback(async()=>{const g=++generation.current;if(!uid)return;setLoading(true);setError('');try{const r=await builderCall('dailyPicks',{timeZone});if(g===generation.current&&identity.current===scope)setRecord({...r,scope});}catch(e:any){if(g===generation.current){setRecord(null);setError(e.message||'Could not load your daily picks.');}}finally{if(g===generation.current)setLoading(false);}},[scope]);
 useEffect(()=>{if(focused)void refresh();return()=>{generation.current++;};},[focused,refresh]);
 useEffect(()=>{const timer=setInterval(()=>tick(Date.now()),30000),sub=AppState.addEventListener('change',v=>{if(v==='active')tick(Date.now());});return()=>{clearInterval(timer);sub.remove();};},[]);
 const data=record?.scope===scope?record:null;return {people:data?.people||EMPTY,note:data?.note||'',day:data?.day,loading,error,refresh};
}
