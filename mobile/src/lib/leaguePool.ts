import {fetchActivityLeague} from './activityLeague';
// No cached/stale private profiles, raw users scans, fake attention heat or paid boosts.
export const invalidateLeaguePoolCache=()=>{};
export const loadLeaguePool=async(_options:{force?:boolean}={}):Promise<any[]>=>{
 const board=await fetchActivityLeague('week');return board.rows.map((r:any)=>({...r,displayName:r.name,leagueRecorded:true,leaguePoints:r.points,profilePic:'',photos:[],skills:[],industries:[],lookingFor:[],onboarded:true,isVisible:true,isVerified:r.verified}));
};
