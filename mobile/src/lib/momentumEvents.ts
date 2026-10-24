const listeners=new Set<(uid:string)=>void>();
export const momentumVisibilityChanged=(uid:string)=>listeners.forEach(fn=>fn(uid));
export const onMomentumVisibilityChanged=(fn:(uid:string)=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
