import {fetchBuilderLeague} from './activityLeague';
// Real eligible profiles; public activity publication is not required.
export const invalidateLeaguePoolCache=()=>{};
export const loadLeaguePool=async(_options:{force?:boolean}={}):Promise<any[]>=>{
 const board=await fetchBuilderLeague();return board.rows.map((r:any)=>({...r,displayName:r.name,leagueKind:'builders',leagueRecorded:true,leaguePoints:r.points,profilePic:r.image||'',photos:[],industries:[],onboarded:true,isVisible:true,isVerified:r.verified}));
};
