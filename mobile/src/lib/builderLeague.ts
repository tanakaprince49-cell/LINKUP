import type {UserProfile} from '../types';
// Compatibility for dashboard previews: only authoritative opted-in rows rank.
export const leagueHeat=(profile:any)=>profile?.leagueRecorded===true?Number(profile.leaguePoints)||0:0;
export const rankLeague=(people:any[],_me?:UserProfile|null)=>people.filter(p=>p?.leagueRecorded===true&&p.leaguePoints>0).sort((a,b)=>Number(a.rank)-Number(b.rank)||String(a.uid).localeCompare(String(b.uid))).slice(0,20);
// Clients must never announce a podium calculated from local caches.
export const notifyLeaguePodium=async(_podium:UserProfile[],_fromId:string)=>{};
