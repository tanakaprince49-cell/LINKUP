// Paid fields are server-controlled by existing profile/rules/payment guards.
export async function memberHasPlus(db,uid,u={},at=Date.now()){
 const status=String(u.subscriptionStatus||'').toLowerCase();
 if(!['inactive','canceled','cancelled','expired','free'].includes(status)&&(u.isPro===true||['pro','plus'].includes(String(u.plan||'').toLowerCase())||['pro','plus'].includes(String(u.subscriptionPlan||'').toLowerCase())||u.entitlements?.pro===true||u.entitlements?.linkupPro===true||u.entitlements?.linkupPlus===true))return true;
 const s=await db.collection('webSubscriptions').doc(uid).get(),v=s.data()?.plus?.endsAt;const end=v?.toMillis?v.toMillis():typeof v==='number'?v:typeof v==='string'?Date.parse(v):0;return end>at;
}
