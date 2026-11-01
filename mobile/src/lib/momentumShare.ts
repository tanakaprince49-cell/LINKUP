import {Platform,Share} from 'react-native';
import {linkupWebBaseUrl} from './profileLinks';
export const momentumPageUrl=(uid:string)=>'https://www.linkupbuild.com/app/momentum/'+encodeURIComponent(uid);
export const momentumCardUrl=(uid:string)=>linkupWebBaseUrl()+'/api/publicSeo?mode=momentum-card&uid='+encodeURIComponent(uid);
export const leaguePageUrl=(period:'week'|'month'|'year'='week')=>'https://www.linkupbuild.com/app/builder-league'+(period==='week'?'':'/'+period);
export const leagueCardUrl=(period:'week'|'month'|'year'='week')=>linkupWebBaseUrl()+'/api/publicSeo?mode=league-card&period='+encodeURIComponent(period);

export async function shareMomentumCard(uid:string){
 const page=momentumPageUrl(uid),url=momentumCardUrl(uid),message='My build streak on LINKUP. '+page+' · linkupbuild.com';
 if(Platform.OS==='web'){
  const response=await fetch(url,{cache:'no-store'});if(!response.ok||!response.headers.get('content-type')?.includes('image/png'))throw new Error('Enable public Momentum sharing and keep your profile public before making a card.');
  const blob=await response.blob(),file=new File([blob],'linkup-momentum.png',{type:'image/png'}),nav=(globalThis as any).navigator;
  if(nav?.canShare?.({files:[file]})){try{await nav.share({title:'My LINKUP Momentum',text:message,files:[file]});}catch(e:any){if(e?.name!=='AbortError')throw e;}return;}
  const objectUrl=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectUrl;a.download='linkup-momentum.png';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);return;
 }
 const Sharing=await import('expo-sharing').catch(()=>null);if(Sharing&&await Sharing.isAvailableAsync().catch(()=>false)){
  const FS=await import('expo-file-system/legacy'),uri=FS.cacheDirectory+'linkup-momentum-'+Date.now()+'.png';
  try{const result=await FS.downloadAsync(url,uri);if(result.status!==200||!String(result.headers?.['Content-Type']||result.headers?.['content-type']||'').includes('image/png'))throw new Error('Your public Momentum card is unavailable.');await Sharing.shareAsync(uri,{mimeType:'image/png',dialogTitle:'Share your LINKUP build streak',UTI:'public.png'});}finally{await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});}return;
 }
 await Share.share({message,url:page,title:'My LINKUP Momentum'});
}

export async function shareLeagueCard(period:'week'|'month'|'year'='week'){
 const cleanPeriod=period==='month'||period==='year'?period:'week';
 const page=leaguePageUrl(cleanPeriod),url=leagueCardUrl(cleanPeriod),message='Builder League standings on LINKUP · '+page;
 if(Platform.OS==='web'){
  const response=await fetch(url,{cache:'no-store'});if(!response.ok||!response.headers.get('content-type')?.includes('image/png'))throw new Error('Builder League card is temporarily unavailable.');
  const blob=await response.blob(),file=new File([blob],`linkup-league-${cleanPeriod}.png`,{type:'image/png'}),nav=(globalThis as any).navigator;
  if(nav?.canShare?.({files:[file]})){try{await nav.share({title:'LINKUP Builder League',text:message,files:[file]});}catch(e:any){if(e?.name!=='AbortError')throw e;}return;}
  const objectUrl=URL.createObjectURL(blob),a=document.createElement('a');a.href=objectUrl;a.download=`linkup-league-${cleanPeriod}.png`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);return;
 }
 const Sharing=await import('expo-sharing').catch(()=>null);if(Sharing&&await Sharing.isAvailableAsync().catch(()=>false)){
  const FS=await import('expo-file-system/legacy'),uri=FS.cacheDirectory+`linkup-league-${cleanPeriod}-${Date.now()}.png`;
  try{const result=await FS.downloadAsync(url,uri);if(result.status!==200||!String(result.headers?.['Content-Type']||result.headers?.['content-type']||'').includes('image/png'))throw new Error('Builder League card is unavailable.');await Sharing.shareAsync(uri,{mimeType:'image/png',dialogTitle:'Share LINKUP Builder League card',UTI:'public.png'});}finally{await FS.deleteAsync(uri,{idempotent:true}).catch(()=>{});}return;
 }
 await Share.share({message,url:page,title:'LINKUP Builder League'});
}
