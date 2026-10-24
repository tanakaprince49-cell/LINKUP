import {linkyCall} from './linkyApi';
export const BUILDER_SECTIONS=['Today','Plan','People','Follow-ups','Groups','Help board','Leads','Settings'] as const;
export type BuilderSection=typeof BUILDER_SECTIONS[number];
export const builderCall=<T=any>(op:string,input:Record<string,unknown>={})=>linkyCall<T>('builder',{op,input});
export const coachRequestKey=()=>`review_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
export function builderSection(value:unknown):BuilderSection{if(value==='Rooms')return 'Groups';return BUILDER_SECTIONS.includes(value as BuilderSection)?value as BuilderSection:'Today';}
