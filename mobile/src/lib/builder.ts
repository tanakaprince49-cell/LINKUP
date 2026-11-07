import {linkyCall} from './linkyApi';
import {recordUserActionForAppearance,setSavedIconMode,syncIconModeFromServerPrefs} from './dynamicAppearance';
export const BUILDER_SECTIONS=['Groups','Settings'] as const;
export type BuilderSection=typeof BUILDER_SECTIONS[number];
export const builderCall=async<T=any>(op:string,input:Record<string,unknown>={}):Promise<T>=>{
 const res=await linkyCall<T>('builder',{op,input});
 if(op==='shipUpdate'||((op==='ventureConnectGithub'||op==='ventureSyncGithub')&&(res as any)?.autoLeagueSync?.dayCredited))recordUserActionForAppearance('shipped');
 else if(op==='home'||op==='visit'){syncIconModeFromServerPrefs((res as any)?.state?.prefs?.iconMode);recordUserActionForAppearance('interact');}
 else if(op==='prefs'&&typeof input.iconMode==='string')void setSavedIconMode(input.iconMode);
 return res;
};
export const coachRequestKey=()=>`review_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
export function builderSection(value:unknown):BuilderSection{if(value==='Settings')return 'Settings';return 'Groups';}
