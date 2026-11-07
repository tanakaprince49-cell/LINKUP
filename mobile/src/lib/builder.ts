import {linkyCall} from './linkyApi';
import {recordUserActionForAppearance,setSavedIconMode,syncIconModeFromServerPrefs} from './dynamicAppearance';
// The workspace is Groups and nothing else. The old Settings tab (private
// context export / clear) is gone: data export now lives where leaving lives,
// on the profile, and it is optional.
export const BUILDER_SECTIONS=['Groups'] as const;
export type BuilderSection=typeof BUILDER_SECTIONS[number];
export const builderCall=async<T=any>(op:string,input:Record<string,unknown>={}):Promise<T>=>{
 const res=await linkyCall<T>('builder',{op,input});
 if(op==='shipUpdate'||((op==='ventureConnectGithub'||op==='ventureSyncGithub')&&(res as any)?.autoLeagueSync?.dayCredited))recordUserActionForAppearance('shipped');
 else if(op==='home'||op==='visit'){syncIconModeFromServerPrefs((res as any)?.state?.prefs?.iconMode);recordUserActionForAppearance('interact');}
 else if(op==='prefs'&&typeof input.iconMode==='string')void setSavedIconMode(input.iconMode);
 return res;
};
export const coachRequestKey=()=>`review_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
export function builderSection(_value?:unknown):BuilderSection{return 'Groups';}
