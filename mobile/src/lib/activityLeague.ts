import {linkupWebBaseUrl} from './profileLinks';
export async function fetchActivityLeague(period='week',options:{uid?:string;city?:string;country?:string}={}){
 const params=new URLSearchParams({mode:'league-json',period});for(const [k,v] of Object.entries(options))if(v)params.set(k,v);
 const r=await fetch(linkupWebBaseUrl()+'/api/publicSeo?'+params.toString(),{cache:'no-store'});if(!r.ok)throw new Error('The live standings are unavailable. Please retry.');return r.json();
}
